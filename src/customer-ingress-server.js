import { timingSafeEqual, randomUUID } from "node:crypto";
import http from "node:http";

import { createCustomerIngressDatabase } from "./customer-ingress-database.js";
import { createCustomerIngressJournalService } from "./customer-ingress-journal-service.js";
import { KernelError } from "./errors.js";

const config = {
  port: Number(process.env.INGRESS_PORT ?? 3600),
  databaseUrl: process.env.INGRESS_DATABASE_URL,
  stimulusToken: process.env.INGRESS_STIMULUS_TOKEN,
  operatorToken: process.env.INGRESS_OPERATOR_TOKEN,
  tokenizationUrl: process.env.TOKENIZATION_URL,
  tokenizationRequesterToken: process.env.TOKENIZATION_REQUESTER_TOKEN,
  tokenizationPrincipalId: process.env.TOKENIZATION_REQUESTER_PRINCIPAL_ID,
  installationId: process.env.KERNEL_INSTALLATION_ID,
  environmentId: process.env.KERNEL_ENVIRONMENT_ID,
  integrationId: process.env.INGRESS_INTEGRATION_ID,
  sourceGrantId: process.env.INGRESS_SOURCE_TOKENIZATION_GRANT_ID,
  deliveryGrantId: process.env.INGRESS_DELIVERY_TOKENIZATION_GRANT_ID,
  sourceBindingId: process.env.INGRESS_SOURCE_BINDING_ID,
  payloadSecret: process.env.INGRESS_PAYLOAD_SECRET,
  mappingSecret: process.env.INGRESS_MAPPING_SECRET
};

if (Object.entries(config).some(([key, value]) => key !== "port" && !value)) {
  throw new Error("Customer ingress API configuration is incomplete.");
}

const database = createCustomerIngressDatabase(config.databaseUrl);
const journal = createCustomerIngressJournalService(database, {
  sourceBindingId: config.sourceBindingId,
  payloadSecret: config.payloadSecret,
  mappingSecret: config.mappingSecret,
  retentionCapacityBytes: Number(process.env.INGRESS_RETENTION_CAPACITY_BYTES ?? 10 * 1024 * 1024)
});

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new KernelError(413, "INGRESS_REQUEST_TOO_LARGE", "Ingress request exceeds limit.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
    throw new KernelError(400, "INGRESS_JSON_INVALID", "Ingress request must be valid JSON.");
  }
}

function bearer(request) {
  return request.headers.authorization?.startsWith("Bearer ")
    ? request.headers.authorization.slice("Bearer ".length) : "";
}

function authenticate(request, expected) {
  const left = Buffer.from(bearer(request), "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new KernelError(403, "INGRESS_AUTHENTICATION_FAILED", "Ingress authentication failed.");
  }
}

async function tokenize(grantId, fieldRole, claimField, namespace, rawValue) {
  const response = await fetch(`${config.tokenizationUrl}/v0/tokenize`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.tokenizationRequesterToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      request_id: randomUUID(), grant_id: grantId,
      requester_principal_id: config.tokenizationPrincipalId,
      installation_id: config.installationId, environment_id: config.environmentId,
      integration_id: config.integrationId, field_role: fieldRole, claim_field: claimField,
      namespace, algorithm_version: "hmac-sha256-length-prefixed.v1",
      input_base64: Buffer.from(rawValue, "utf8").toString("base64"),
      requested_at: new Date().toISOString()
    })
  });
  const body = await response.json();
  if (!response.ok) throw new KernelError(502, body.error?.code ?? "TOKENIZATION_FAILED",
    body.error?.message ?? "Tokenization failed.");
  return body.tokenization_result;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/healthz") {
      await database.ping();
      return send(response, 200, { status: "healthy", service_id: "customer-ingress-api" });
    }
    if (request.method === "POST" && url.pathname === "/agency-lab/lead-ingress") {
      authenticate(request, config.stimulusToken);
      const input = await readJson(request);
      const [sourceToken, deliveryToken] = await Promise.all([
        tokenize(config.sourceGrantId, "source.stable_operation_identity", "source_identity_token",
          "lead-source-identity", input.source_operation_id),
        tokenize(config.deliveryGrantId, "source.delivery_identity", "delivery_identity_equality_token",
          "lead-idempotency", input.source_delivery_id)
      ]);
      const accepted = await journal.acceptDelivery(input, { sourceToken, deliveryToken });
      return send(response, accepted.replayed ? 200 : 202, {
        accepted: true, replayed: accepted.replayed,
        delivery_id: accepted.delivery.delivery_id,
        logical_operation_id: accepted.delivery.logical_operation_id,
        journal_sequence: accepted.delivery.journal_sequence
      });
    }
    if (request.method === "GET" && url.pathname === "/internal/v0/status") {
      authenticate(request, config.operatorToken);
      return send(response, 200, await journal.getStatus());
    }
    return send(response, 404, { error: { code: "NOT_FOUND", message: "Route does not exist." } });
  } catch (error) {
    const status = error instanceof KernelError ? error.status : 500;
    return send(response, status, { error: { code: error.code ?? "INTERNAL_ERROR",
      message: status === 500 ? "Customer ingress failed." : error.message } });
  }
});

server.listen(config.port, "0.0.0.0", () => process.stdout.write(`Customer ingress listening on ${config.port}\n`));

async function shutdown() {
  await new Promise((resolve) => server.close(resolve));
  await database.close();
}
process.on("SIGINT", () => shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => shutdown().then(() => process.exit(0)));
