import assert from "node:assert/strict";
import test from "node:test";

import {
  createEncryptedIngressPayload,
  createMappingReceipt,
  decryptIngressPayload,
  ingressJournalRecordDigest,
  projectIngressJournalHealth,
  validateIngressDelivery
} from "../../src/customer-ingress-contracts.js";

const delivery = {
  source_operation_id: "FORM-LEAD-1001",
  source_delivery_id: "lead-event-1001-a",
  occurred_at: "2026-07-16T14:00:00.000Z",
  payload: { email: "maya@example.test", company: "Ridgeview HVAC" }
};

test("ingress delivery validation is exact and bounded", () => {
  assert.deepEqual(validateIngressDelivery(delivery), delivery);
  assert.throws(() => validateIngressDelivery({ ...delivery, reporting_grant_id: "forbidden" }),
    /unknown fields/i);
  assert.throws(() => validateIngressDelivery({ ...delivery, payload: null }), /payload/i);
});

test("payload encryption authenticates bytes and preserves only a digest in journal material", () => {
  const encrypted = createEncryptedIngressPayload(delivery.payload,
    "customer-ingress-payload-secret-with-sufficient-length-v1");
  assert.deepEqual(decryptIngressPayload(encrypted,
    "customer-ingress-payload-secret-with-sufficient-length-v1"), delivery.payload);
  assert.doesNotMatch(JSON.stringify(encrypted), /maya@example\.test|Ridgeview HVAC/);
  assert.throws(() => decryptIngressPayload({ ...encrypted, authentication_tag: "AA" },
    "customer-ingress-payload-secret-with-sufficient-length-v1"));
});

test("journal and mapping receipts bind opaque correlation without raw source identity", () => {
  const material = {
    journal_sequence: "1",
    delivery_id: "delivery:opaque-a",
    logical_operation_id: "operation:opaque",
    source_identity_token: "eq:v1:source",
    delivery_identity_equality_token: "eq:v1:delivery",
    payload_digest: `sha256:${"a".repeat(64)}`,
    occurred_at: delivery.occurred_at,
    received_at: "2026-07-16T14:00:01.000Z"
  };
  const journalDigest = ingressJournalRecordDigest(material);
  const receipt = createMappingReceipt({
    mapping_receipt_id: "mapping:opaque",
    source_binding_id: "source:lead-form",
    source_identity_token: material.source_identity_token,
    logical_operation_id: material.logical_operation_id,
    first_journal_sequence: material.journal_sequence,
    first_journal_record_digest: journalDigest,
    mapping_service_id: "customer-ingress-adapter",
    created_at: material.received_at
  }, "customer-ingress-mapping-secret-with-sufficient-length-v1");
  assert.match(journalDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(receipt.receipt_digest, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(receipt.signed_receipt_bytes, /FORM-LEAD-1001|lead-event-1001-a/);
});

test("journal health exposes backlog and pressure without inventing loss", () => {
  assert.deepEqual(projectIngressJournalHealth({
    unreported_count: 2,
    oldest_unreported_at: "2026-07-16T14:00:00.000Z",
    encrypted_payload_bytes: 900,
    retention_capacity_bytes: 1000,
    durable_loss_marker_count: 0,
    forward_retry_count: 1,
    report_retry_count: 3,
    last_accepted_sequence: "0"
  }), {
    unreported_count: 2,
    oldest_unreported_at: "2026-07-16T14:00:00.000Z",
    encrypted_payload_bytes: 900,
    retention_capacity_bytes: 1000,
    retention_utilization: 0.9,
    retention_pressure: "critical",
    durable_loss_marker_count: 0,
    evidence_loss_declared: false,
    forward_retry_count: 1,
    report_retry_count: 3,
    last_accepted_sequence: "0"
  });
});
