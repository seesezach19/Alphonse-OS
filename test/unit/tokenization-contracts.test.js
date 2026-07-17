import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  authorizeTokenizationRequest,
  createEqualityToken,
  createSignedTokenizationResultReceipt,
  verifySignedTokenizationResultReceipt
} from "../../src/tokenization-contracts.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const rootSecret = "tokenization-domain-root-secret-with-sufficient-length-v1";

function request(overrides = {}) {
  return {
    request_id: "00000000-0000-4000-8000-000000000401",
    grant_id: "00000000-0000-4000-8000-000000000402",
    requester_principal_id: "observer:webhook-ingress",
    installation_id: "00000000-0000-4000-8000-00000000a001",
    environment_id: "00000000-0000-4000-8000-000000000001",
    integration_id: "integration:mock-crm",
    field_role: "source.delivery_identity",
    claim_field: "delivery_identity_equality_token",
    namespace: "lead-idempotency",
    algorithm_version: "hmac-sha256-length-prefixed.v1",
    input_base64: Buffer.from("delivery-001").toString("base64"),
    requested_at: "2026-07-16T18:00:00.000Z",
    ...overrides
  };
}

function grant(overrides = {}) {
  return {
    requester_principal_id: "observer:webhook-ingress",
    installation_id: "00000000-0000-4000-8000-00000000a001",
    environment_id: "00000000-0000-4000-8000-000000000001",
    integration_id: "integration:mock-crm",
    field_role: "source.delivery_identity",
    claim_field: "delivery_identity_equality_token",
    namespace: "lead-idempotency",
    algorithm_version: "hmac-sha256-length-prefixed.v1",
    service_binding: { service_id: "tokenization-service", version: "0.1.0" },
    valid_from: "2026-07-16T17:00:00.000Z",
    expires_at: "2026-07-16T19:00:00.000Z",
    max_input_bytes: 64,
    requests_per_minute: 20,
    collection_window_id: "collection:duplicate-delivery-proof",
    ...overrides
  };
}

test("equality tokens preserve exact byte equality and domain separation", () => {
  const base = request();
  const first = createEqualityToken(Buffer.from("delivery-001"), base, rootSecret);
  assert.equal(first, createEqualityToken(Buffer.from("delivery-001"), base, rootSecret));
  assert.notEqual(first, createEqualityToken(Buffer.from("delivery-001 "), base, rootSecret));
  assert.notEqual(first, createEqualityToken(Buffer.from("Delivery-001"), base, rootSecret));
  assert.equal(first, createEqualityToken(Buffer.from("delivery-001"), {
    ...base, field_role: "destination.idempotency_key"
  }, rootSecret));
  assert.notEqual(first, createEqualityToken(Buffer.from("delivery-001"), {
    ...base, namespace: "different-comparison-purpose"
  }, rootSecret));
});

test("use grants fail closed on requester, field, namespace, timing, and byte limits", () => {
  assert.equal(authorizeTokenizationRequest(request(), grant(), {
    grantId: request().grant_id, effectiveState: "active", now: "2026-07-16T18:00:01.000Z"
  }).authorized, true);
  for (const candidate of [
    request({ requester_principal_id: "observer:other" }),
    request({ field_role: "destination.idempotency_key" }),
    request({ namespace: "other" }),
    request({ input_base64: Buffer.alloc(65).toString("base64") })
  ]) {
    assert.throws(() => authorizeTokenizationRequest(candidate, grant(), {
      grantId: request().grant_id, effectiveState: "active", now: "2026-07-16T18:00:01.000Z"
    }), (error) => error.code === "TOKENIZATION_GRANT_SCOPE_VIOLATION");
  }
});

test("Ed25519 result receipts bind token, grant, requester, field, and service identity", () => {
  const value = request();
  const token = createEqualityToken(Buffer.from("delivery-001"), value, rootSecret);
  const signed = createSignedTokenizationResultReceipt({
    result_receipt_id: "00000000-0000-4000-8000-000000000403",
    request_id: value.request_id,
    grant_id: value.grant_id,
    requester_principal_id: value.requester_principal_id,
    installation_id: value.installation_id,
    environment_id: value.environment_id,
    integration_id: value.integration_id,
    field_role: value.field_role,
    claim_field: value.claim_field,
    namespace: value.namespace,
    algorithm_version: value.algorithm_version,
    equality_token: token,
    input_length: Buffer.from(value.input_base64, "base64").length,
    collection_window_id: "collection:duplicate-delivery-proof",
    service_id: "tokenization-service",
    service_version: "0.1.0",
    issued_at: "2026-07-16T18:00:01.000Z"
  }, { keyId: "tokenization-service-ed25519-v1", privateKey });
  const verified = verifySignedTokenizationResultReceipt(signed.bytes, {
    keyId: "tokenization-service-ed25519-v1", publicKey
  });
  assert.equal(verified.digest, signed.digest);
  assert.equal(verified.document.equality_token, token);

  const changed = JSON.parse(signed.bytes);
  changed.document.claim_field = "other";
  assert.throws(() => verifySignedTokenizationResultReceipt(JSON.stringify(changed), {
    keyId: "tokenization-service-ed25519-v1", publicKey
  }), (error) => error.code === "TOKENIZATION_RECEIPT_SIGNATURE_INVALID");
});
