import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";

import { canonicalize } from "./canonical-json.js";
import { issueScopedCredential } from "./scoped-credential.js";

const port = Number(process.env.PORT ?? 3300);
const adapterToken = process.env.ADAPTER_BROKER_TOKEN;
const credentialIssuerSecret = process.env.STOREFRONT_CREDENTIAL_ISSUER_SECRET;
const permitSecret = process.env.DISPATCH_PERMIT_SIGNING_SECRET;
const kernelUrl = process.env.KERNEL_INTERNAL_URL;
const brokerToken = process.env.BROKER_SERVICE_TOKEN;
if (!adapterToken || !credentialIssuerSecret || !permitSecret || !kernelUrl || !brokerToken) throw new Error("Credential broker configuration is required.");

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function read(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validSignature(document, signature) {
  const expected = Buffer.from(`hmac-sha256:${createHmac("sha256", permitSecret)
    .update(canonicalize(document)).digest("hex")}`, "utf8");
  const supplied = Buffer.from(String(signature), "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/healthz") return send(response, 200, { status: "healthy" });
  if (request.method !== "POST" || request.url !== "/v0/credentials/resolve") return send(response, 404, { error: "not_found" });
  if (request.headers.authorization !== `Bearer ${adapterToken}`) return send(response, 403, { error: "trusted_adapter_required" });
  const input = await read(request);
  const permit = input.permit_document;
  if (!permit || !validSignature(permit, input.signature) || Date.now() >= Date.parse(permit.expires_at)) {
    return send(response, 403, { error: "invalid_dispatch_permit" });
  }
  const reconciliation = permit.permit_type === "effect_reconciliation";
  const expectedScopes = reconciliation ? ["storefront.inventory.read"] : ["storefront.inventory.write"];
  if (permit.credential_binding.binding_ref !== "credential://storefront/inventory-writer"
    || permit.credential_binding.revision !== "storefront-writer-rev-7"
    || JSON.stringify(permit.credential_binding.scopes) !== JSON.stringify(expectedScopes)) {
    return send(response, 403, { error: "credential_scope_mismatch" });
  }
  const permitId = reconciliation ? permit.reconciliation_permit_id : permit.permit_id;
  const gatePath = reconciliation ? "reconciliation-permits" : "dispatch-permits";
  const gate = await fetch(`${kernelUrl}/internal/v0/${gatePath}/${permitId}/credential-delivery`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${brokerToken}` },
    body: JSON.stringify({ permit_digest: input.permit_digest })
  });
  const gateBody = await gate.json();
  if (!gate.ok || gateBody.authorized !== true) return send(response, 409, { error: "kernel_gate_denied", reason: gateBody.error?.code });
  const credentialDocument = { credential_id: randomUUID(), permit_id: permitId,
    effect_id: permit.effect_id, binding_ref: gateBody.binding_ref, revision: gateBody.revision,
    scopes: gateBody.scopes, target: gateBody.target ?? permit.target, action: gateBody.action ?? permit.action,
    effect_idempotency_key: gateBody.effect_idempotency_key ?? permit.effect_idempotency_key,
    issued_at: new Date().toISOString(), expires_at: permit.expires_at };
  const credential = issueScopedCredential(credentialDocument, credentialIssuerSecret);
  return send(response, 200, { credential_type: "permit_scoped_bearer", credential, scopes: gateBody.scopes,
    expires_at: permit.expires_at, binding_ref: gateBody.binding_ref, revision: gateBody.revision });
});

server.listen(port, "0.0.0.0");
