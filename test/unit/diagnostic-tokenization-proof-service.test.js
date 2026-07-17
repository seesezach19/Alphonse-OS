import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import { createDiagnosticTokenizationProofService } from "../../src/diagnostic-tokenization-proof-service.js";
import {
  createSignedGrantActivationSnapshot,
  createSignedGrantApplicationReceipt
} from "../../src/grant-authority-contracts.js";
import { createSignedTokenizationResultReceipt } from "../../src/tokenization-contracts.js";

const installationId = "00000000-0000-4000-8000-00000000a001";
const environmentId = "00000000-0000-4000-8000-000000000001";
const authorityKey = {
  keyId: "kernel-grant-authority-key-v1",
  secret: "authority-snapshot-secret-with-sufficient-length-v1"
};
const applicationKey = {
  keyId: "tokenization-application-key-v1",
  secret: "tokenization-application-secret-with-sufficient-length-v1"
};
const serviceKeyId = "tokenization-service-ed25519-v1";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

function proofRow() {
  const grantId = "00000000-0000-4000-8000-000000000831";
  const requestId = "00000000-0000-4000-8000-000000000832";
  const resultReceiptId = "00000000-0000-4000-8000-000000000833";
  const grantDocument = {
    requester_principal_id: "observer:webhook-ingress",
    installation_id: installationId,
    environment_id: environmentId,
    integration_id: "integration:mock-crm",
    field_role: "source.delivery_identity",
    claim_field: "delivery_identity_equality_token",
    namespace: "lead-idempotency",
    algorithm_version: "hmac-sha256-length-prefixed.v1",
    collection_window_id: "collection:test",
    service_binding: { service_id: "tokenization-service", version: "0.1.0" },
    valid_from: "2026-07-17T13:00:00.000Z",
    expires_at: "2026-07-17T14:00:00.000Z",
    max_input_bytes: 64
  };
  const snapshot = createSignedGrantActivationSnapshot({
    snapshot_id: "00000000-0000-4000-8000-000000000834",
    grant_id: grantId,
    grant_type: "tokenization_use",
    installation_id: installationId,
    environment_id: environmentId,
    receiver_service_id: "tokenization-service",
    grant_document: grantDocument,
    authority_sequence: "1",
    predecessor_snapshot_digest: null,
    target_state: "active",
    grant_digest: sha256Digest(grantDocument),
    readiness_receipt_digest: `sha256:${"1".repeat(64)}`,
    issued_at: "2026-07-17T13:00:00.000Z",
    expires_at: "2026-07-17T14:00:00.000Z"
  }, { ...authorityKey, signedAt: "2026-07-17T13:00:00.000Z" });
  const application = createSignedGrantApplicationReceipt({
    application_receipt_id: "00000000-0000-4000-8000-000000000835",
    service_id: "tokenization-service",
    installation_id: installationId,
    environment_id: environmentId,
    grant_id: grantId,
    snapshot_id: snapshot.document.snapshot_id,
    snapshot_digest: snapshot.digest,
    authority_sequence: "1",
    predecessor_snapshot_digest: null,
    applied_state: "active",
    service_transaction_id: "00000000-0000-4000-8000-000000000836",
    service_transaction_position: "1",
    applied_at: "2026-07-17T13:00:01.000Z"
  }, { ...applicationKey, signedAt: "2026-07-17T13:00:01.000Z" });
  const result = createSignedTokenizationResultReceipt({
    result_receipt_id: resultReceiptId,
    request_id: requestId,
    grant_id: grantId,
    requester_principal_id: grantDocument.requester_principal_id,
    installation_id: installationId,
    environment_id: environmentId,
    integration_id: grantDocument.integration_id,
    field_role: grantDocument.field_role,
    claim_field: grantDocument.claim_field,
    namespace: grantDocument.namespace,
    algorithm_version: grantDocument.algorithm_version,
    equality_token: "eq:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    input_length: 8,
    collection_window_id: grantDocument.collection_window_id,
    service_id: "tokenization-service",
    service_version: "0.1.0",
    issued_at: "2026-07-17T13:00:02.000Z"
  }, { keyId: serviceKeyId, privateKey });
  return {
    result_receipt_id: resultReceiptId,
    installation_id: installationId,
    environment_id: environmentId,
    request_id: requestId,
    grant_id: grantId,
    requester_principal_id: grantDocument.requester_principal_id,
    integration_id: grantDocument.integration_id,
    field_role: grantDocument.field_role,
    claim_field: grantDocument.claim_field,
    namespace: grantDocument.namespace,
    algorithm_version: grantDocument.algorithm_version,
    equality_token: result.document.equality_token,
    input_length: "8",
    collection_window_id: grantDocument.collection_window_id,
    service_id: "tokenization-service",
    service_version: "0.1.0",
    service_key_id: serviceKeyId,
    signed_receipt_bytes: Buffer.from(result.bytes, "utf8"),
    receipt_digest: result.digest,
    grant_snapshot_digest: snapshot.digest,
    grant_application_receipt_digest: application.digest,
    signed_grant_snapshot_bytes: Buffer.from(snapshot.bytes, "utf8"),
    signed_grant_application_receipt_bytes: Buffer.from(application.bytes, "utf8"),
    issued_at: new Date(result.document.issued_at)
  };
}

function service() {
  return createDiagnosticTokenizationProofService({ pool: {} }, installationId, environmentId, {
    serviceKeyId,
    servicePublicKey: publicKey,
    authorityKey,
    applicationKey
  });
}

test("stored tokenization proof fields are derived from exact signed bytes", () => {
  const verified = service().verifyStoredResultReceipt(proofRow());
  assert.equal(verified.claim_field, "delivery_identity_equality_token");
  assert.equal(verified.receipt_digest, proofRow().receipt_digest);
});

test("stored tokenization proof rejects denormalized and signed-byte tampering", () => {
  const changedField = proofRow();
  changedField.equality_token = "eq:v1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  assert.throws(() => service().verifyStoredResultReceipt(changedField),
    (error) => error.code === "CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION");

  const changedBytes = proofRow();
  const wrapper = JSON.parse(changedBytes.signed_receipt_bytes.toString("utf8"));
  wrapper.document.claim_field = "other";
  changedBytes.signed_receipt_bytes = Buffer.from(JSON.stringify(wrapper), "utf8");
  assert.throws(() => service().verifyStoredResultReceipt(changedBytes),
    (error) => error.code === "CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION");
});
