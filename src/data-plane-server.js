import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import jsonLogic from "json-logic-js";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const port = Number(process.env.DATA_PLANE_PORT ?? 3100);
const kernelUrl = process.env.KERNEL_INTERNAL_URL ?? "http://kernel:3000";
const serviceToken = process.env.DATA_PLANE_SERVICE_TOKEN;
const receiptSecret = process.env.DATA_PLANE_RECEIPT_SECRET;
if (!serviceToken || !receiptSecret) throw new Error("Data Plane service credentials are required.");

const referenceTime = Date.now();

const inventory = {
  erp: {
    "SKU-100": { quantity: 24, observed_at: new Date(referenceTime - 60_000).toISOString(), authority: "authoritative", sensitivity: "internal", status: "active", internal_note: "cycle count verified" },
    "SKU-STALE": { quantity: 7, observed_at: new Date(referenceTime - 7_200_000).toISOString(), authority: "authoritative", sensitivity: "internal", status: "active" },
    "SKU-WITHDRAWN": { quantity: 0, observed_at: new Date(referenceTime - 30_000).toISOString(), authority: "authoritative", sensitivity: "internal", status: "withdrawn" }
  },
  storefront: {
    "SKU-100": { quantity: 18, observed_at: new Date(referenceTime - 45_000).toISOString(), authority: "representational", sensitivity: "internal", status: "active" },
    "SKU-STALE": { quantity: 9, observed_at: new Date(referenceTime - 7_200_000).toISOString(), authority: "representational", sensitivity: "internal", status: "active" },
    "SKU-WITHDRAWN": { quantity: 0, observed_at: new Date(referenceTime - 30_000).toISOString(), authority: "representational", sensitivity: "internal", status: "withdrawn" }
  }
};

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) fail(413, "REQUEST_TOO_LARGE", "Request body exceeds 64 KiB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(status, code, message) {
  throw new KernelError(status, code, message);
}

async function queryInventory(requestBody, agentToken) {
  const authorizationResponse = await fetch(`${kernelUrl}/internal/v0/context/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${serviceToken}`, "x-agent-token": agentToken },
    body: JSON.stringify({ grant_id: requestBody.grant_id, subjects: requestBody.subjects, sources: requestBody.sources })
  });
  const authorization = await authorizationResponse.json();
  if (!authorizationResponse.ok) fail(authorizationResponse.status, authorization.error.code, authorization.error.message);

  const deliveredAt = new Date();
  const payloadItems = [];
  const itemReferences = [];
  const authorityClaims = [];
  const freshnessClaims = [];
  const limitations = { fields_redacted: ["internal_note"], policy: "reference-inventory-v0.1" };

  for (const source of authorization.sources) {
    if (!new Set(["erp", "storefront"]).has(source)) fail(403, "DATA_PLANE_POLICY_DENIED", "Source is not disclosed by Data Plane policy.");
    for (const sku of authorization.subjects) {
      const record = inventory[source]?.[sku];
      if (!record) fail(404, "CONTEXT_SUBJECT_NOT_FOUND", "Inventory subject does not exist.");
      if (record.status === "withdrawn") fail(409, "CONTEXT_WITHDRAWN", "Inventory context was withdrawn.");
      if (!authorization.sensitivity_classes.includes(record.sensitivity)) fail(403, "DATA_PLANE_POLICY_DENIED", "Sensitivity is not permitted by both planes.");
      const observedAt = record.observed_at;
      const cacheAgeSeconds = Math.floor((deliveredAt.getTime() - Date.parse(observedAt)) / 1000);
      if (cacheAgeSeconds > authorization.max_age_seconds) fail(409, "STALE_CONTEXT", "Inventory context exceeds freshness bound.");
      const payload = { source, sku, quantity: record.quantity, observed_at: observedAt };
      const itemHash = sha256Digest(payload);
      payloadItems.push(payload);
      itemReferences.push({ source, subject: sku, release_id: `reference-${source}-v1`, item_hash: itemHash, observed_at: observedAt });
      authorityClaims.push({ source, subject: sku, authority: record.authority });
      freshnessClaims.push({ source, subject: sku, observed_at: observedAt, delivered_at: deliveredAt.toISOString(), cache_age_seconds: cacheAgeSeconds, cache_reset_observation_time: false });
    }
  }

  const packetHash = sha256Digest(payloadItems);
  const receipt = { receipt_id: randomUUID(), grant_id: authorization.grant_id, data_plane_id: "reference-data-plane",
    recipient_principal_id: authorization.recipient_principal_id, packet_hash: packetHash, item_references: itemReferences,
    authority_claims: authorityClaims, freshness_claims: freshnessClaims,
    provenance: { adapter: "reference-inventory", policy_version: "0.1.0" }, limitations,
    delivered_at: deliveredAt.toISOString() };
  const signature = `hmac-sha256:${createHmac("sha256", receiptSecret).update(canonicalize(receipt)).digest("hex")}`;
  const receiptResponse = await fetch(`${kernelUrl}/internal/v0/context/receipts`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${serviceToken}`, "x-receipt-signature": signature },
    body: JSON.stringify(receipt)
  });
  if (!receiptResponse.ok) {
    const receiptError = await receiptResponse.json();
    fail(receiptResponse.status, receiptError.error.code, receiptError.error.message);
  }
  return { data: payloadItems, delivery: { receipt_id: receipt.receipt_id, packet_hash: packetHash,
    observed_at_preserved: true, limitations } };
}

async function simulateInventory(requestBody, agentToken) {
  if (!/^sha256:[0-9a-f]{64}$/.test(requestBody.candidate_digest ?? "")
    || !/^[0-9a-f-]{36}$/i.test(requestBody.validation_receipt_id ?? "")
    || typeof requestBody.skill_export_id !== "string" || !requestBody.skill_export_id
    || !requestBody.skill_content || typeof requestBody.skill_content !== "object" || Array.isArray(requestBody.skill_content)
    || !requestBody.skill_content.program || typeof requestBody.skill_content.program !== "object") {
    fail(400, "INVALID_SIMULATION_BINDING", "Candidate, Validation Receipt, and Skill Export bindings are required.");
  }
  if (!Array.isArray(requestBody.subjects) || requestBody.subjects.length !== 1
    || !Array.isArray(requestBody.sources) || !requestBody.sources.includes("erp") || !requestBody.sources.includes("storefront")) {
    fail(400, "INVALID_SIMULATION_INPUT", "Reference simulation requires one subject with ERP and storefront sources.");
  }
  const delivery = await queryInventory({ grant_id: requestBody.grant_id, subjects: requestBody.subjects,
    sources: requestBody.sources }, agentToken);
  const sku = requestBody.subjects[0];
  const erp = delivery.data.find((item) => item.source === "erp" && item.sku === sku);
  const storefront = delivery.data.find((item) => item.source === "storefront" && item.sku === sku);
  const skillInput = { erp_quantity: erp.quantity, storefront_quantity: storefront.quantity };
  const result = Object.fromEntries(Object.entries(requestBody.skill_content.program)
    .map(([output, rule]) => [output, jsonLogic.apply(rule, skillInput)]));
  const skillExportDigest = sha256Digest(requestBody.skill_content);
  const attestation = { data_plane_id: "reference-data-plane", validation_receipt_id: requestBody.validation_receipt_id,
    candidate_digest: requestBody.candidate_digest, context_receipt_id: delivery.delivery.receipt_id,
    input_digest: delivery.delivery.packet_hash, result_digest: sha256Digest(result),
    skill_export_id: requestBody.skill_export_id, skill_export_digest: skillExportDigest,
    issued_at: new Date().toISOString() };
  const signature = `hmac-sha256:${createHmac("sha256", receiptSecret).update(canonicalize(attestation)).digest("hex")}`;
  return { data: result, observational_attestation: attestation, observational_attestation_signature: signature,
    limitations: ["read-only", "no correction dispatched"] };
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, { status: "healthy" });
    if (request.method === "GET" && url.pathname === "/v0/bootstrap") return send(response, 200, {
      data_plane_id: "reference-data-plane", contract_version: "0.1.0",
      resources: ["inventory_observation", "inventory_observational_simulation"]
    });
    if (request.method === "POST" && url.pathname === "/v0/inventory/query") {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Agent ")) fail(401, "AGENT_AUTHENTICATION_REQUIRED", "Agent credential is required.");
      return send(response, 200, await queryInventory(await body(request), authorization.slice("Agent ".length)));
    }
    if (request.method === "POST" && url.pathname === "/v0/inventory/simulate") {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Agent ")) fail(401, "AGENT_AUTHENTICATION_REQUIRED", "Agent credential is required.");
      return send(response, 200, await simulateInventory(await body(request), authorization.slice("Agent ".length)));
    }
    return send(response, 404, { error: { code: "ROUTE_NOT_FOUND", message: "Route does not exist." } });
  } catch (error) {
    const status = error instanceof KernelError ? error.status : (error.status ?? 500);
    const code = error instanceof KernelError ? error.code : (error.code ?? "INTERNAL_ERROR");
    return send(response, status, { error: { code, message: error.message } });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Reference Data Plane listening on ${port}`));
