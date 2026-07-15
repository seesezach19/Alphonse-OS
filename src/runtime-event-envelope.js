import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const RUNTIME_EVENT_SCHEMA_VERSION = "0.2.0";
export const RUNTIME_EVENT_LIFECYCLE_CLAIMS = Object.freeze([
  "accepted", "running", "succeeded", "failed", "cancelled"
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function fail(code, message, status = 400, details = {}) {
  throw new KernelError(status, code, message, details);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_RUNTIME_EVENT_ENVELOPE", `${label} must be an object.`);
  }
  return value;
}

function exact(value, fields, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("INVALID_RUNTIME_EVENT_ENVELOPE", `${label} fields must be exact.`, 400, {
      expected,
      received: actual
    });
  }
  return value;
}

function string(value, label, maximum = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    fail("INVALID_RUNTIME_EVENT_ENVELOPE", `${label} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function identifier(value, label, maximum = 200) {
  const result = string(value, label, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(result)) {
    fail("INVALID_RUNTIME_EVENT_ENVELOPE", `${label} contains unsupported characters.`);
  }
  return result;
}

function timestamp(value, label) {
  const result = string(value, label, 40);
  const milliseconds = Date.parse(result);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== result) {
    fail("INVALID_RUNTIME_EVENT_ENVELOPE", `${label} must be an exact UTC ISO-8601 timestamp.`);
  }
  return result;
}

function payloadReference(value) {
  const result = string(value, "payload.reference", 500);
  if (!/^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9._~:/-]+$/i.test(result)) {
    fail("RUNTIME_EVENT_PAYLOAD_REFERENCE_INVALID",
      "payload.reference must be an opaque hierarchical reference without inline data.");
  }
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    fail("RUNTIME_EVENT_PAYLOAD_REFERENCE_INVALID", "payload.reference must be an absolute non-secret reference.");
  }
  if (!parsed.protocol || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail("RUNTIME_EVENT_PAYLOAD_REFERENCE_INVALID", "payload.reference cannot contain credentials, query, or fragment material.");
  }
  return result;
}

export function normalizeRuntimeEventEnvelope(value) {
  exact(value, [
    "schema_version", "adapter", "workflow_id", "revision_id", "external_execution_id", "event_id",
    "event_sequence", "lifecycle_claim", "correlation_id", "idempotency_key", "occurred_at", "payload"
  ], "Runtime Event Envelope");
  if (value.schema_version !== RUNTIME_EVENT_SCHEMA_VERSION) {
    fail("RUNTIME_EVENT_SCHEMA_UNSUPPORTED", `schema_version must be ${RUNTIME_EVENT_SCHEMA_VERSION}.`);
  }
  const adapter = exact(value.adapter, ["adapter_id", "adapter_version"], "adapter");
  const payload = exact(value.payload, ["digest", "reference"], "payload");
  const hasDigest = payload.digest !== null;
  const hasReference = payload.reference !== null;
  if (hasDigest === hasReference) {
    fail("INVALID_RUNTIME_EVENT_ENVELOPE", "payload must contain exactly one digest or reference.");
  }
  if (!Number.isSafeInteger(value.event_sequence) || value.event_sequence < 0) {
    fail("INVALID_RUNTIME_EVENT_ENVELOPE", "event_sequence must be a non-negative safe integer.");
  }
  if (!RUNTIME_EVENT_LIFECYCLE_CLAIMS.includes(value.lifecycle_claim)) {
    fail("RUNTIME_EVENT_LIFECYCLE_UNSUPPORTED", "lifecycle_claim is unsupported.");
  }
  const revisionId = string(value.revision_id, "revision_id", 36);
  if (!UUID.test(revisionId)) fail("INVALID_RUNTIME_EVENT_ENVELOPE", "revision_id must be a UUID.");
  if (hasDigest && (typeof payload.digest !== "string" || !DIGEST.test(payload.digest))) {
    fail("INVALID_RUNTIME_EVENT_ENVELOPE", "payload.digest must be an exact SHA-256 digest.");
  }

  return {
    schema_version: RUNTIME_EVENT_SCHEMA_VERSION,
    adapter: {
      adapter_id: identifier(adapter.adapter_id, "adapter.adapter_id", 160),
      adapter_version: identifier(adapter.adapter_version, "adapter.adapter_version", 100)
    },
    workflow_id: identifier(value.workflow_id, "workflow_id", 160),
    revision_id: revisionId,
    external_execution_id: identifier(value.external_execution_id, "external_execution_id", 200),
    event_id: identifier(value.event_id, "event_id", 140),
    event_sequence: value.event_sequence,
    lifecycle_claim: value.lifecycle_claim,
    correlation_id: identifier(value.correlation_id, "correlation_id", 200),
    idempotency_key: identifier(value.idempotency_key, "idempotency_key", 200),
    occurred_at: timestamp(value.occurred_at, "occurred_at"),
    payload: {
      digest: hasDigest ? payload.digest : null,
      reference: hasReference ? payloadReference(payload.reference) : null
    }
  };
}

function signingBytes(envelope, keyId, signedAt) {
  return [
    "alphonse-runtime-event-hmac-v1",
    keyId,
    signedAt,
    canonicalize(envelope)
  ].join("\n");
}

export function runtimeEventEnvelopeDigest(value) {
  return sha256Digest(normalizeRuntimeEventEnvelope(value));
}

export function signRuntimeEventEnvelope(value, { keyId, secret, signedAt }) {
  const envelope = normalizeRuntimeEventEnvelope(value);
  const normalizedKeyId = string(keyId, "key_id", 160);
  const normalizedSignedAt = timestamp(signedAt, "signed_at");
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Runtime Event HMAC secret must be at least 32 characters.");
  return {
    key_id: normalizedKeyId,
    signed_at: normalizedSignedAt,
    signature: `hmac-sha256:${createHmac("sha256", secret)
      .update(signingBytes(envelope, normalizedKeyId, normalizedSignedAt), "utf8").digest("hex")}`
  };
}

export function verifyRuntimeEventEnvelope(value, authentication, binding, {
  now = new Date(), toleranceSeconds = 300
} = {}) {
  const envelope = normalizeRuntimeEventEnvelope(value);
  if (!authentication || typeof authentication !== "object" || Array.isArray(authentication)
      || typeof authentication.key_id !== "string" || typeof authentication.signed_at !== "string"
      || typeof authentication.signature !== "string") {
    fail("RUNTIME_EVENT_AUTHENTICATION_REQUIRED", "Runtime Event HMAC authentication is required.", 401);
  }
  object(binding, "Runtime Event binding");
  const keyId = string(authentication.key_id, "key_id", 160);
  const signedAt = timestamp(authentication.signed_at, "signed_at");
  if (keyId !== binding.key_id || envelope.adapter.adapter_id !== binding.adapter_id
      || envelope.adapter.adapter_version !== binding.adapter_version) {
    fail("RUNTIME_EVENT_KEY_MISMATCH", "Runtime Event authentication does not match the exact adapter binding.", 403);
  }
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 1 || toleranceSeconds > 900) {
    throw new Error("Runtime Event timestamp tolerance must be between 1 and 900 seconds.");
  }
  const ageMilliseconds = Math.abs(now.getTime() - Date.parse(signedAt));
  if (!Number.isFinite(now.getTime()) || ageMilliseconds > toleranceSeconds * 1000) {
    fail("RUNTIME_EVENT_TIMESTAMP_OUT_OF_WINDOW", "Runtime Event signature timestamp is outside the allowed window.", 401);
  }
  const expected = signRuntimeEventEnvelope(envelope, {
    keyId: binding.key_id,
    secret: binding.secret,
    signedAt
  }).signature;
  const supplied = Buffer.from(String(authentication.signature ?? ""), "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (supplied.length !== expectedBytes.length || !timingSafeEqual(supplied, expectedBytes)) {
    fail("RUNTIME_EVENT_SIGNATURE_INVALID", "Runtime Event signature is invalid.", 403);
  }
  return {
    envelope,
    envelope_digest: sha256Digest(envelope),
    authentication: { key_id: keyId, signed_at: signedAt, signature: expected }
  };
}
