import http from "node:http";

import { sha256Digest } from "./canonical-json.js";

const port = Number(process.env.PORT ?? 3400);
const kernelToken = process.env.KERNEL_ADAPTER_TOKEN;
const brokerToken = process.env.ADAPTER_BROKER_TOKEN;
const brokerUrl = process.env.CREDENTIAL_BROKER_URL;
const storefrontUrl = process.env.STOREFRONT_URL;
const storefrontSystem = process.env.STOREFRONT_SYSTEM;
const testControlToken = process.env.ADAPTER_TEST_CONTROL_TOKEN;
const faultDelayMs = Number(process.env.ADAPTER_FAULT_DELAY_MS ?? 1_000);
if (!kernelToken || !brokerToken || !brokerUrl || !storefrontUrl || !storefrontSystem) {
  throw new Error("Trusted adapter configuration is required.");
}

let nextDispatchFault = null;
let nextReconciliationFault = null;

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function read(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/healthz") return send(response, 200, { status: "healthy" });
  if (request.method === "POST" && request.url === "/internal/test/faults/next-dispatch") {
    if (!testControlToken) return send(response, 404, { error: "not_found" });
    if (request.headers.authorization !== `Bearer ${testControlToken}`) return send(response, 403, { error: "test_control_required" });
    const input = await read(request);
    if (!["drop_before_apply", "timeout_after_apply"].includes(input.mode)) {
      return send(response, 400, { error: "invalid_fault_mode" });
    }
    nextDispatchFault = input.mode;
    return send(response, 201, { armed: true, mode: input.mode });
  }
  if (request.method === "POST" && request.url === "/internal/test/faults/next-reconciliation") {
    if (!testControlToken) return send(response, 404, { error: "not_found" });
    if (request.headers.authorization !== `Bearer ${testControlToken}`) return send(response, 403, { error: "test_control_required" });
    const input = await read(request);
    if (input.mode !== "drop_before_observation") return send(response, 400, { error: "invalid_fault_mode" });
    nextReconciliationFault = input.mode;
    return send(response, 201, { armed: true, mode: input.mode });
  }
  if (request.method !== "POST" || !["/v0/dispatch", "/v0/reconcile"].includes(request.url)) {
    return send(response, 404, { error: "not_found" });
  }
  if (request.headers.authorization !== `Bearer ${kernelToken}`) return send(response, 403, { error: "kernel_required" });
  const input = await read(request);
  const permit = input.permit_document;
  const effect = input.effect_request;
  if (request.url === "/v0/reconcile") {
    if (permit.permit_type !== "effect_reconciliation" || permit.effect_id !== effect.effect_id
      || permit.request_digest !== sha256Digest(effect)
      || permit.action !== "observe_quantity" || permit.target.system !== storefrontSystem
      || permit.target.resource !== "storefront.inventory" || permit.target.subject !== effect.target.subject
      || permit.requested_value?.quantity !== effect.requested_value?.quantity
      || permit.adapter.export_id !== "storefront_inventory_adapter") {
      return send(response, 409, { error: "reconciliation_permit_mismatch", checks: {
        permit_type: permit.permit_type === "effect_reconciliation", effect_id: permit.effect_id === effect.effect_id,
        request_digest: permit.request_digest === sha256Digest(effect), action: permit.action === "observe_quantity",
        system: permit.target?.system === storefrontSystem, resource: permit.target?.resource === "storefront.inventory",
        subject: permit.target?.subject === effect.target?.subject,
        requested_value: permit.requested_value?.quantity === effect.requested_value?.quantity,
        adapter: permit.adapter?.export_id === "storefront_inventory_adapter" } });
    }
    const brokerResponse = await fetch(`${brokerUrl}/v0/credentials/resolve`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${brokerToken}` },
      body: JSON.stringify({ permit_document: permit, permit_digest: input.permit_digest, signature: input.signature })
    });
    const broker = await brokerResponse.json();
    if (!brokerResponse.ok) return send(response, 409, { error: "credential_delivery_failed", reason: broker.error });
    const reconciliationFault = nextReconciliationFault;
    nextReconciliationFault = null;
    if (reconciliationFault === "drop_before_observation") return response.destroy();
    const target = `${storefrontUrl}/v0/inventory/${encodeURIComponent(effect.target.subject)}`;
    const credentialHeaders = { authorization: `Bearer ${broker.credential}` };
    const receiptResponse = await fetch(`${storefrontUrl}/v0/effect-receipts/${encodeURIComponent(effect.effect_idempotency_key)}`,
      { headers: credentialHeaders });
    const effectReceipt = await receiptResponse.json();
    if (!receiptResponse.ok || typeof effectReceipt.found !== "boolean") {
      return send(response, 409, { error: "effect_receipt_lookup_failed", effect_receipt: effectReceipt });
    }
    const observedResponse = await fetch(target, { headers: credentialHeaders });
    const observed = await observedResponse.json();
    if (!observedResponse.ok || !Number.isInteger(observed.quantity)) {
      return send(response, 409, { error: "target_observation_failed", observed });
    }
    return send(response, 200, { recovery_case_id: permit.recovery_case_id, effect_id: effect.effect_id,
      reconciliation_permit_id: permit.reconciliation_permit_id,
      credential: { binding_ref: broker.binding_ref, revision: broker.revision,
        scopes: broker.scopes, material_returned: false },
      effect_receipt: effectReceipt,
      observation: { system: permit.target.system, resource: permit.target.resource,
        subject: effect.target.subject, quantity: observed.quantity, observed_at: new Date().toISOString() },
      outcome: "observed" });
  }
  if (permit.effect_id !== effect.effect_id || permit.request_digest !== input.request_digest
    || sha256Digest(effect) !== permit.request_digest
    || permit.target.system !== storefrontSystem || permit.target.resource !== "storefront.inventory"
    || permit.action !== "set_quantity" || permit.adapter.export_id !== "storefront_inventory_adapter") {
    return send(response, 409, { error: "permit_request_mismatch" });
  }
  const brokerResponse = await fetch(`${brokerUrl}/v0/credentials/resolve`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${brokerToken}` },
    body: JSON.stringify({ permit_document: permit, permit_digest: input.permit_digest, signature: input.signature })
  });
  const broker = await brokerResponse.json();
  if (!brokerResponse.ok) return send(response, 409, { error: "credential_delivery_failed", reason: broker.error });
  const fault = nextDispatchFault;
  nextDispatchFault = null;
  if (fault === "drop_before_apply") return response.destroy();
  const target = `${storefrontUrl}/v0/inventory/${encodeURIComponent(effect.target.subject)}`;
  const write = await fetch(target, { method: "PUT", headers: { "content-type": "application/json",
    authorization: `Bearer ${broker.credential}`, "idempotency-key": effect.effect_idempotency_key },
  body: JSON.stringify(effect.requested_value) });
  const storefrontResponse = await write.json();
  if (!write.ok) return send(response, 409, { error: "storefront_write_failed", storefront_response: storefrontResponse });
  const verify = await fetch(target, { headers: { authorization: `Bearer ${broker.credential}`,
    "idempotency-key": effect.effect_idempotency_key } });
  const observed = await verify.json();
  if (!verify.ok || observed.quantity !== effect.requested_value.quantity) {
    return send(response, 409, { error: "post_write_verification_failed", observed });
  }
  if (fault === "timeout_after_apply") await new Promise((resolve) => setTimeout(resolve, faultDelayMs));
  return send(response, 200, { effect_id: effect.effect_id, permit_id: permit.permit_id,
    effect_idempotency_key: effect.effect_idempotency_key, adapter: permit.adapter,
    credential: { binding_ref: broker.binding_ref, revision: broker.revision, scopes: broker.scopes, material_returned: false },
    storefront_response: storefrontResponse,
    post_write_observation: { system: permit.target.system, resource: permit.target.resource,
      subject: effect.target.subject, quantity: observed.quantity, observed_at: new Date().toISOString() },
    outcome: "succeeded" });
});

server.listen(port, "0.0.0.0");
