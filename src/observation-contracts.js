import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const INTEGER = /^(0|[1-9][0-9]*)$/;
const ENVELOPE_FIELDS = new Set([
  "schema_version", "observation_id", "observation_type", "schema", "principal_id", "grant_id",
  "key_id", "installation_id", "environment_id", "adapter_binding", "stream_id", "sequence",
  "workflow_id", "integration_id", "occurred_at", "observed_at", "claims", "limitations",
  "redaction", "detail", "provenance_dependencies"
]);

function fail(status, code, message, details = {}) {
  throw new KernelError(status, code, message, details);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(422, "OBSERVATION_ENVELOPE_INVALID", `${label} must be an object.`);
  }
  return value;
}

function exactFields(value, fields, label) {
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  if (unknown.length) fail(422, "OBSERVATION_ENVELOPE_INVALID", `${label} contains unknown fields.`, { unknown });
}

function string(value, label, min = 1, max = 200) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    fail(422, "OBSERVATION_ENVELOPE_INVALID", `${label} must be a bounded string.`);
  }
  return value;
}

function instant(value, label) {
  string(value, label, 20, 35);
  if (!Number.isFinite(Date.parse(value))) fail(422, "OBSERVATION_ENVELOPE_INVALID", `${label} must be an instant.`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(422, "OBSERVATION_ENVELOPE_INVALID", `${label} must be a SHA-256 digest.`);
  }
  return value;
}

function validateSchemaTuple(value) {
  object(value, "schema");
  exactFields(value, new Set(["schema_id", "schema_version", "schema_digest"]), "schema");
  string(value.schema_id, "schema.schema_id");
  string(value.schema_version, "schema.schema_version", 1, 32);
  digest(value.schema_digest, "schema.schema_digest");
  return value;
}

function validateAdapterBinding(value) {
  object(value, "adapter_binding");
  exactFields(value, new Set(["adapter_binding_id", "version", "digest"]), "adapter_binding");
  string(value.adapter_binding_id, "adapter_binding.adapter_binding_id");
  string(value.version, "adapter_binding.version", 1, 32);
  digest(value.digest, "adapter_binding.digest");
  return value;
}

export function validateObservationEnvelope(value) {
  object(value, "observation");
  exactFields(value, ENVELOPE_FIELDS, "observation");
  for (const field of ["schema_version", "observation_id", "observation_type", "principal_id", "grant_id",
    "key_id", "installation_id", "environment_id", "stream_id"]) string(value[field], field);
  validateSchemaTuple(value.schema);
  validateAdapterBinding(value.adapter_binding);
  if (typeof value.sequence !== "string" || !INTEGER.test(value.sequence) || BigInt(value.sequence) < 1n) {
    fail(422, "OBSERVATION_ENVELOPE_INVALID", "sequence must be a positive canonical integer string.");
  }
  for (const field of ["workflow_id", "integration_id"]) {
    if (value[field] !== null) string(value[field], field);
  }
  instant(value.occurred_at, "occurred_at");
  instant(value.observed_at, "observed_at");
  object(value.claims, "claims");
  if (!Array.isArray(value.limitations) || !value.limitations.every((item) => typeof item === "string")) {
    fail(422, "OBSERVATION_ENVELOPE_INVALID", "limitations must be an array of strings.");
  }
  object(value.redaction, "redaction");
  exactFields(value.redaction, new Set(["policy_id", "policy_digest"]), "redaction");
  string(value.redaction.policy_id, "redaction.policy_id");
  digest(value.redaction.policy_digest, "redaction.policy_digest");
  if (value.detail !== null) {
    object(value.detail, "detail");
    exactFields(value.detail, new Set(["digest", "media_type", "size_bytes"]), "detail");
    digest(value.detail.digest, "detail.digest");
    string(value.detail.media_type, "detail.media_type", 1, 120);
    if (!Number.isSafeInteger(value.detail.size_bytes) || value.detail.size_bytes < 0) {
      fail(422, "OBSERVATION_ENVELOPE_INVALID", "detail.size_bytes must be a non-negative safe integer.");
    }
  }
  if (!Array.isArray(value.provenance_dependencies)
      || !value.provenance_dependencies.every((item) => typeof item === "string" && item.length <= 200)) {
    fail(422, "OBSERVATION_ENVELOPE_INVALID", "provenance_dependencies must be bounded identifiers.");
  }
  return value;
}

function authenticationPreimage(envelope, { principal_id, grant_id, key_id, signed_at }) {
  return ["ALPHONSE_CANONICAL_OBSERVATION_V1", principal_id, grant_id, key_id, signed_at,
    canonicalize(envelope)].join("\n");
}

function hmac(secret, preimage) {
  return createHmac("sha256", secret).update(preimage).digest("hex");
}

export function createSignedObservation(value, { keyId, secret, signedAt = new Date().toISOString() }) {
  const envelope = validateObservationEnvelope(value);
  if (keyId !== envelope.key_id || typeof secret !== "string" || secret.length < 32) {
    throw new Error("Exact observation signing key is required.");
  }
  const authentication = {
    principal_id: envelope.principal_id,
    grant_id: envelope.grant_id,
    key_id: keyId,
    signed_at: signedAt
  };
  authentication.signature = hmac(secret, authenticationPreimage(envelope, authentication));
  return { bytes: canonicalize(envelope), envelope, envelope_digest: sha256Digest(envelope), authentication };
}

export function verifySignedObservation(bytes, authentication, {
  keyId, secret, now = new Date(), toleranceSeconds = 300
}) {
  if (typeof bytes !== "string" || Buffer.byteLength(bytes) > 1024 * 1024) {
    fail(413, "OBSERVATION_ENVELOPE_TOO_LARGE", "Observation envelope exceeds the transport limit.");
  }
  let envelope;
  try { envelope = JSON.parse(bytes); } catch {
    fail(400, "OBSERVATION_JSON_INVALID", "Observation envelope is not valid JSON.");
  }
  validateObservationEnvelope(envelope);
  if (!authentication || authentication.key_id !== keyId || envelope.key_id !== keyId
      || authentication.principal_id !== envelope.principal_id || authentication.grant_id !== envelope.grant_id) {
    fail(401, "OBSERVATION_AUTHENTICATION_INVALID", "Observation authentication binding does not match.");
  }
  if (typeof secret !== "string" || secret.length < 32 || typeof authentication.signature !== "string") {
    fail(401, "OBSERVATION_AUTHENTICATION_INVALID", "Observation authentication material is invalid.");
  }
  const signedAt = Date.parse(authentication.signed_at);
  const current = new Date(now).getTime();
  if (!Number.isFinite(signedAt) || Math.abs(current - signedAt) > toleranceSeconds * 1000) {
    fail(401, "OBSERVATION_SIGNATURE_STALE", "Observation signature is outside the freshness window.");
  }
  const expected = Buffer.from(hmac(secret, authenticationPreimage(envelope, authentication)), "hex");
  const received = Buffer.from(authentication.signature, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    fail(401, "OBSERVATION_SIGNATURE_INVALID", "Observation signature is invalid.");
  }
  return { envelope, envelope_digest: sha256Digest(envelope), authentication };
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

export function authorizeObservation(envelope, grant, {
  grantId, grantState, now = new Date(), envelopeBytes, detailBytes, highestSequenceSeen = "0"
}) {
  validateObservationEnvelope(envelope);
  if (grantState !== "active") fail(403, "OBSERVATION_GRANT_INACTIVE", "Reporting Grant is not active.");
  const current = new Date(now).getTime();
  const checks = [
    [envelope.grant_id === grantId, "grant_id"],
    [envelope.principal_id === grant.principal_id, "principal_id"],
    [envelope.installation_id === grant.installation_id, "installation_id"],
    [envelope.environment_id === grant.environment_id, "environment_id"],
    [same(envelope.adapter_binding, grant.adapter_binding), "adapter_binding"],
    [envelope.stream_id === grant.stream_id, "stream_id"],
    [envelope.key_id === grant.key_id, "key_id"],
    [grant.allowed_schema_tuples?.some((item) => same(item, envelope.schema)), "schema"],
    [envelope.workflow_id === null || grant.workflow_ids?.includes(envelope.workflow_id), "workflow_id"],
    [envelope.integration_id === null || grant.integration_ids?.includes(envelope.integration_id), "integration_id"],
    [current >= Date.parse(grant.valid_from) && current < Date.parse(grant.expires_at), "validity_window"],
    [envelopeBytes <= grant.limits?.max_envelope_bytes, "max_envelope_bytes"],
    [detailBytes <= grant.limits?.max_detail_bytes, "max_detail_bytes"],
    [BigInt(envelope.sequence) - BigInt(highestSequenceSeen) <= BigInt(grant.limits?.max_sequence_advance),
      "max_sequence_advance"]
  ];
  const failed = checks.find(([passed]) => !passed);
  if (failed) {
    const sizeFailure = ["max_envelope_bytes", "max_detail_bytes"].includes(failed[1]);
    fail(sizeFailure ? 413 : 403,
      sizeFailure ? "OBSERVATION_SIZE_LIMIT_EXCEEDED" : "OBSERVATION_GRANT_SCOPE_VIOLATION",
      "Observation exceeds Reporting Grant scope.", { failed_binding: failed[1] });
  }
  return {
    attribution: "authenticated_under_observer_specific_grant",
    exclusive_authorship_established: false,
    external_truth_established: false
  };
}

function validatePrimitive(value, rule, path) {
  if (rule.type === "string") {
    if (typeof value !== "string" || value.length < (rule.minLength ?? 0) || value.length > (rule.maxLength ?? Infinity)) {
      fail(422, "OBSERVATION_CLAIMS_INVALID", `${path} must satisfy its string contract.`);
    }
  } else if (rule.type === "integer") {
    if (!Number.isSafeInteger(value)) fail(422, "OBSERVATION_CLAIMS_INVALID", `${path} must be an integer.`);
  } else if (rule.type === "boolean") {
    if (typeof value !== "boolean") fail(422, "OBSERVATION_CLAIMS_INVALID", `${path} must be a boolean.`);
  } else {
    fail(422, "OBSERVATION_SCHEMA_UNSUPPORTED", `Unsupported claim type at ${path}.`);
  }
  if (rule.enum && !rule.enum.includes(value)) fail(422, "OBSERVATION_CLAIMS_INVALID", `${path} is not allowed.`);
}

export function validateObservationClaims(claims, schemaArtifact) {
  object(claims, "claims");
  object(schemaArtifact, "schema_artifact");
  const schema = object(schemaArtifact.claims_schema, "claims_schema");
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    fail(422, "OBSERVATION_SCHEMA_UNSUPPORTED", "Claims schema must be a closed object.");
  }
  const properties = object(schema.properties, "claims_schema.properties");
  const required = new Set(schema.required ?? []);
  const missing = [...required].filter((key) => !(key in claims));
  const unknown = Object.keys(claims).filter((key) => !(key in properties));
  if (missing.length || unknown.length) {
    fail(422, "OBSERVATION_CLAIMS_INVALID", "Claims do not match the deployed schema.", { missing, unknown });
  }
  for (const [key, value] of Object.entries(claims)) validatePrimitive(value, properties[key], `claims.${key}`);
  return claims;
}

function toRanges(values) {
  const sorted = [...new Set(values.map(BigInt))].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const ranges = [];
  for (const value of sorted) {
    const last = ranges.at(-1);
    if (last && value === last[1] + 1n) last[1] = value;
    else ranges.push([value, value]);
  }
  return ranges;
}

export function projectStreamCoverage(current, receivedSequence) {
  if (typeof receivedSequence !== "string" || !INTEGER.test(receivedSequence) || BigInt(receivedSequence) < 1n) {
    fail(422, "OBSERVATION_SEQUENCE_INVALID", "Stream sequence must be a positive canonical integer string.");
  }
  const values = [];
  for (const range of current?.received_ranges ?? []) {
    for (let value = BigInt(range[0]); value <= BigInt(range[1]); value += 1n) values.push(value);
  }
  values.push(BigInt(receivedSequence));
  const received = toRanges(values);
  const highest = received.at(-1)[1];
  let contiguous = 0n;
  for (const [start, end] of received) {
    if (start > contiguous + 1n) break;
    if (start <= contiguous + 1n) contiguous = end;
  }
  const missing = [];
  let cursor = 1n;
  for (const [start, end] of received) {
    if (start > cursor) missing.push([cursor, start - 1n]);
    cursor = end + 1n;
  }
  return {
    highest_sequence_seen: highest.toString(),
    contiguous_through: contiguous.toString(),
    received_ranges: received.map(([start, end]) => [start.toString(), end.toString()]),
    missing_ranges: missing.map(([start, end]) => [start.toString(), end.toString()]),
    coverage_status: missing.length ? "incomplete" : "complete_through_high_water"
  };
}
