import http from "node:http";

import { verifyScopedCredential } from "./scoped-credential.js";

const port = Number(process.env.PORT ?? 3200);
const credentialIssuerSecret = process.env.STOREFRONT_CREDENTIAL_ISSUER_SECRET;
if (!credentialIssuerSecret) throw new Error("STOREFRONT_CREDENTIAL_ISSUER_SECRET is required.");

const inventory = new Map([["SKU-100", 18]]);
const receipts = new Map();

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/healthz") return send(response, 200, { status: "healthy" });
  const credential = request.headers.authorization?.startsWith("Bearer ")
    ? verifyScopedCredential(request.headers.authorization.slice(7), credentialIssuerSecret) : null;
  if (!credential || !credential.scopes?.some((scope) => ["storefront.inventory.read", "storefront.inventory.write"].includes(scope))) {
    return send(response, 403, { error: "scoped_credential_required" });
  }
  const match = request.url?.match(/^\/v0\/inventory\/([^/]+)$/);
  const receiptMatch = request.url?.match(/^\/v0\/effect-receipts\/([^/]+)$/);
  if (!match && !receiptMatch) return send(response, 404, { error: "not_found" });
  if (receiptMatch) {
    if (request.method !== "GET") return send(response, 405, { error: "method_not_allowed" });
    const idempotencyKey = decodeURIComponent(receiptMatch[1]);
    if (credential.effect_idempotency_key !== idempotencyKey || credential.action !== "observe_quantity") {
      return send(response, 403, { error: "credential_receipt_mismatch" });
    }
    const receipt = receipts.get(idempotencyKey);
    if (!receipt) return send(response, 200, { found: false, idempotency_key: idempotencyKey });
    if (credential.target?.system !== "storefront-staging" || credential.target?.resource !== "storefront.inventory"
      || credential.target?.subject !== receipt.request.sku || credential.action !== "observe_quantity") {
      return send(response, 403, { error: "credential_target_mismatch" });
    }
    return send(response, 200, { found: true, idempotency_key: idempotencyKey,
      request: receipt.request, response: receipt.response });
  }
  const sku = decodeURIComponent(match[1]);
  const canRead = credential.scopes.includes("storefront.inventory.read") && credential.action === "observe_quantity";
  const canWrite = credential.scopes.includes("storefront.inventory.write") && credential.action === "set_quantity";
  if (credential.target?.system !== "storefront-staging" || credential.target?.resource !== "storefront.inventory"
    || credential.target?.subject !== sku || (!canRead && !canWrite)) {
    return send(response, 403, { error: "credential_target_mismatch" });
  }
  if (request.method === "GET") {
    if (canRead) return send(response, 200, { sku, quantity: inventory.get(sku) ?? 0 });
    const idempotencyKey = request.headers["idempotency-key"];
    const receipt = typeof idempotencyKey === "string" ? receipts.get(idempotencyKey) : null;
    if (!canWrite || credential.effect_idempotency_key !== idempotencyKey || receipt?.request.sku !== sku) {
      return send(response, 403, { error: "verification_scope_required" });
    }
    return send(response, 200, { sku, quantity: inventory.get(sku) ?? 0 });
  }
  if (request.method !== "PUT") return send(response, 405, { error: "method_not_allowed" });
  if (!canWrite) return send(response, 403, { error: "write_scope_required" });
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || !idempotencyKey) return send(response, 400, { error: "idempotency_key_required" });
  const input = await body(request);
  if (!Number.isInteger(input.quantity) || input.quantity < 0) return send(response, 400, { error: "invalid_quantity" });
  const requestIdentity = JSON.stringify({ sku, quantity: input.quantity });
  const previous = receipts.get(idempotencyKey);
  if (previous) {
    if (previous.request_identity !== requestIdentity) return send(response, 409, { error: "idempotency_conflict" });
    return send(response, 200, { ...previous.response, replayed: true });
  }
  const before = inventory.get(sku) ?? 0;
  inventory.set(sku, input.quantity);
  const result = { status: "applied", sku, previous_quantity: before, quantity: input.quantity, replayed: false };
  receipts.set(idempotencyKey, { request_identity: requestIdentity,
    request: { sku, quantity: input.quantity }, response: result });
  return send(response, 200, result);
});

server.listen(port, "0.0.0.0");
