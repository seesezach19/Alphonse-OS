import { createPrivateKey, timingSafeEqual } from "node:crypto";
import http from "node:http";

import { KernelError } from "./errors.js";
import { createTokenizationDatabase } from "./tokenization-database.js";
import { createTokenizationGrantApplicationService } from "./tokenization-grant-application-service.js";
import { createTokenizationService } from "./tokenization-service.js";

const port = Number(process.env.TOKENIZATION_PORT ?? 3500);
const databaseUrl = process.env.DIAGNOSTIC_DATABASE_URL;
const installationId = process.env.KERNEL_INSTALLATION_ID;
const environmentId = process.env.KERNEL_ENVIRONMENT_ID;
const authorityFeedToken = process.env.GRANT_AUTHORITY_FEED_TOKEN;
const authorityKey = {
  keyId: process.env.KERNEL_GRANT_SNAPSHOT_SIGNING_KEY_ID,
  secret: process.env.KERNEL_GRANT_SNAPSHOT_SIGNING_SECRET
};
const applicationKey = {
  keyId: process.env.TOKENIZATION_GRANT_APPLICATION_SIGNING_KEY_ID,
  secret: process.env.TOKENIZATION_GRANT_APPLICATION_SIGNING_SECRET
};
const serviceKeyId = process.env.TOKENIZATION_SERVICE_SIGNING_KEY_ID;
const servicePrivateKey = createPrivateKey({
  key: Buffer.from(process.env.TOKENIZATION_SERVICE_PRIVATE_KEY_DER_BASE64 ?? "", "base64"),
  format: "der",
  type: "pkcs8"
});
const rootSecret = process.env.TOKENIZATION_ROOT_SECRET;
const requesterTokens = JSON.parse(process.env.TOKENIZATION_REQUESTER_TOKENS ?? "{}");
const diagnosticResultUrl = process.env.DIAGNOSTIC_TOKENIZATION_RESULT_URL;
const diagnosticResultToken = process.env.DIAGNOSTIC_TOKENIZATION_RESULT_TOKEN;

if (!databaseUrl || !installationId || !environmentId || !authorityFeedToken || !applicationKey.keyId
    || !applicationKey.secret || !serviceKeyId || !rootSecret || !diagnosticResultUrl || !diagnosticResultToken) {
  throw new Error("Tokenization Service configuration is incomplete.");
}

const database = createTokenizationDatabase(databaseUrl);
await database.bootstrap(installationId);
const grantReceiver = createTokenizationGrantApplicationService(database, installationId, {
  serviceId: "tokenization-service", authorityKey, applicationKey
});
const service = createTokenizationService({
  database,
  installationId,
  environmentId,
  serviceKeyId,
  servicePrivateKey,
  rootSecret,
  proofClient: {
    async preserve(proof) {
      const response = await fetch(diagnosticResultUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${diagnosticResultToken}`, "content-type": "application/json" },
        body: JSON.stringify(proof)
      });
      const body = await response.json();
      if (!response.ok) throw new KernelError(response.status, body.error?.code ?? "DIAGNOSTIC_PROOF_REJECTED",
        body.error?.message ?? "Diagnostic Plane rejected the tokenization result proof.", body.error?.details);
      return body;
    }
  }
});

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

async function readJson(request, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new KernelError(413, "REQUEST_TOO_LARGE", "Request exceeds the service limit.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
    throw new KernelError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function bearer(request) {
  return request.headers.authorization?.startsWith("Bearer ")
    ? request.headers.authorization.slice("Bearer ".length) : "";
}

function sameSecret(received, expected) {
  const left = Buffer.from(received, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function authenticateRequester(request) {
  const credential = bearer(request);
  for (const [principalId, expected] of Object.entries(requesterTokens)) {
    if (sameSecret(credential, expected)) return principalId;
  }
  throw new KernelError(403, "TOKENIZATION_REQUESTER_AUTHENTICATION_FAILED",
    "Tokenization requester authentication failed.");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/healthz") {
      await database.ping();
      return send(response, 200, { status: "healthy", service_id: "tokenization-service",
        service_version: "0.1.0", raw_input_retention: false });
    }
    if (request.method === "POST" && url.pathname === "/internal/v0/grant-activation-snapshots") {
      if (!sameSecret(bearer(request), authorityFeedToken)) {
        throw new KernelError(403, "GRANT_AUTHORITY_FEED_AUTHENTICATION_FAILED",
          "Grant authority feed authentication failed.");
      }
      const body = await readJson(request, 256 * 1024);
      const accepted = await grantReceiver.applySnapshot(body.signed_snapshot_bytes);
      return send(response, accepted.replayed ? 200 : 201, accepted.result,
        { "idempotent-replayed": String(accepted.replayed) });
    }
    if (request.method === "POST" && url.pathname === "/v0/tokenize") {
      const principalId = authenticateRequester(request);
      const accepted = await service.tokenize(await readJson(request), principalId);
      return send(response, accepted.replayed ? 200 : 201, accepted.result,
        { "idempotent-replayed": String(accepted.replayed) });
    }
    return send(response, 404, { error: { code: "NOT_FOUND", message: "Route does not exist." } });
  } catch (error) {
    const status = error instanceof KernelError ? error.status : 500;
    return send(response, status, { error: {
      code: error.code ?? "INTERNAL_ERROR",
      message: status === 500 ? "Tokenization Service failed." : error.message,
      details: error.details ?? {}
    } });
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Tokenization Service listening on ${port}\n`);
});

async function shutdown() {
  await new Promise((resolve) => server.close(resolve));
  await database.close();
}
process.on("SIGINT", () => shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => shutdown().then(() => process.exit(0)));
