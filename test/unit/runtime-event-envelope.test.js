import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRuntimeEventEnvelope,
  signRuntimeEventEnvelope,
  verifyRuntimeEventEnvelope
} from "../../src/runtime-event-envelope.js";

const digest = (character) => `sha256:${character.repeat(64)}`;
const binding = {
  adapter_id: "example.workflow-runtime",
  adapter_version: "1.2.3",
  key_id: "example-runtime-key-v1",
  secret: "test-runtime-event-secret-with-sufficient-length"
};
const now = "2026-07-15T16:00:00.000Z";

function envelope(overrides = {}) {
  return {
    schema_version: "0.2.0",
    adapter: { adapter_id: binding.adapter_id, adapter_version: binding.adapter_version },
    workflow_id: "workflow:inventory-follow-up",
    revision_id: "00000000-0000-4000-8000-000000000201",
    external_execution_id: "external-execution-42",
    event_id: "event-42-2",
    event_sequence: 2,
    lifecycle_claim: "succeeded",
    correlation_id: "customer-order-42",
    idempotency_key: "external-execution-42:2",
    occurred_at: "2026-07-15T15:59:30.000Z",
    payload: { digest: digest("a"), reference: null },
    ...overrides
  };
}

test("Runtime Event signature binds canonical envelope, key, and timestamp", () => {
  const value = envelope();
  const authentication = signRuntimeEventEnvelope(value, {
    keyId: binding.key_id,
    secret: binding.secret,
    signedAt: now
  });
  const verified = verifyRuntimeEventEnvelope(value, authentication, binding, {
    now: new Date(now), toleranceSeconds: 300
  });

  assert.deepEqual(verified.envelope, normalizeRuntimeEventEnvelope(value));
  assert.equal(verified.authentication.key_id, binding.key_id);
  assert.match(verified.authentication.signature, /^hmac-sha256:[0-9a-f]{64}$/);

  const reordered = { payload: value.payload, ...value };
  assert.deepEqual(
    verifyRuntimeEventEnvelope(reordered, authentication, binding, {
      now: new Date(now), toleranceSeconds: 300
    }).envelope,
    verified.envelope
  );
  assert.throws(() => verifyRuntimeEventEnvelope({ ...value, lifecycle_claim: "failed" }, authentication, binding,
    { now: new Date(now), toleranceSeconds: 300 }), (error) => error.code === "RUNTIME_EVENT_SIGNATURE_INVALID");
  assert.throws(() => verifyRuntimeEventEnvelope(value, { ...authentication, key_id: "other-key" }, binding,
    { now: new Date(now), toleranceSeconds: 300 }), (error) => error.code === "RUNTIME_EVENT_KEY_MISMATCH");
});

test("Runtime Event signature enforces a bounded current timestamp", () => {
  const value = envelope();
  const stale = signRuntimeEventEnvelope(value, {
    keyId: binding.key_id,
    secret: binding.secret,
    signedAt: "2026-07-15T15:54:59.000Z"
  });
  assert.throws(() => verifyRuntimeEventEnvelope(value, stale, binding,
    { now: new Date(now), toleranceSeconds: 300 }), (error) => error.code === "RUNTIME_EVENT_TIMESTAMP_OUT_OF_WINDOW");

  const future = signRuntimeEventEnvelope(value, {
    keyId: binding.key_id,
    secret: binding.secret,
    signedAt: "2026-07-15T16:05:01.000Z"
  });
  assert.throws(() => verifyRuntimeEventEnvelope(value, future, binding,
    { now: new Date(now), toleranceSeconds: 300 }), (error) => error.code === "RUNTIME_EVENT_TIMESTAMP_OUT_OF_WINDOW");
});

test("Runtime Event intake distinguishes missing authentication from invalid input", () => {
  assert.throws(() => verifyRuntimeEventEnvelope(envelope(), {}, binding, { now: new Date(now) }),
    (error) => error.code === "RUNTIME_EVENT_AUTHENTICATION_REQUIRED" && error.status === 401);
});

test("Runtime Event envelope is minimal, provider-neutral, and rejects payloads or credentials", () => {
  const normalized = normalizeRuntimeEventEnvelope(envelope({
    payload: { digest: null, reference: "runtime-detail://execution/external-execution-42" }
  }));
  assert.equal(normalized.payload.digest, null);

  assert.throws(() => normalizeRuntimeEventEnvelope(envelope({ business_payload: { email: "private" } })),
    (error) => error.code === "INVALID_RUNTIME_EVENT_ENVELOPE" && error.status === 400);
  assert.throws(() => normalizeRuntimeEventEnvelope(envelope({
    payload: { digest: null, reference: "https://user:token@example.test/detail" }
  })), (error) => error.code === "RUNTIME_EVENT_PAYLOAD_REFERENCE_INVALID");
  assert.throws(() => normalizeRuntimeEventEnvelope(envelope({
    payload: { digest: null, reference: "data:text/plain,private-business-payload" }
  })), (error) => error.code === "RUNTIME_EVENT_PAYLOAD_REFERENCE_INVALID");
  assert.throws(() => normalizeRuntimeEventEnvelope(envelope({
    adapter: { adapter_id: binding.adapter_id, adapter_version: binding.adapter_version, provider_workflow_id: "42" }
  })), (error) => error.code === "INVALID_RUNTIME_EVENT_ENVELOPE");
});
