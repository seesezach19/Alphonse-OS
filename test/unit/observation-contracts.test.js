import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeObservation,
  createSignedObservation,
  projectStreamCoverage,
  validateObservationClaims,
  verifySignedObservation
} from "../../src/observation-contracts.js";
import { sha256Digest } from "../../src/canonical-json.js";

const secret = "observer-specific-secret-with-sufficient-length-v1";
const schemaArtifact = {
  schema_id: "observation:source.delivery",
  schema_version: "0.1.0",
  observation_type: "source.delivery",
  claims_schema: {
    type: "object",
    additionalProperties: false,
    required: ["delivery_id", "logical_operation_id"],
    properties: {
      delivery_id: { type: "string", minLength: 1, maxLength: 160 },
      logical_operation_id: { type: "string", minLength: 1, maxLength: 160 }
    }
  },
  allowed_detail_media_types: ["application/json"],
  required_correlation_roles: ["logical_operation"]
};
const schemaDigest = sha256Digest(schemaArtifact);

function envelope(overrides = {}) {
  return {
    schema_version: "0.1.0",
    observation_id: "00000000-0000-4000-8000-000000000301",
    observation_type: "source.delivery",
    schema: {
      schema_id: schemaArtifact.schema_id,
      schema_version: schemaArtifact.schema_version,
      schema_digest: schemaDigest
    },
    principal_id: "observer:webhook-ingress",
    grant_id: "00000000-0000-4000-8000-000000000302",
    key_id: "observer-webhook-key-v1",
    installation_id: "00000000-0000-4000-8000-00000000a001",
    environment_id: "00000000-0000-4000-8000-000000000001",
    adapter_binding: {
      adapter_binding_id: "adapter:webhook-ingress",
      version: "0.1.0",
      digest: `sha256:${"4".repeat(64)}`
    },
    stream_id: "stream:webhook-ingress",
    sequence: "1",
    workflow_id: "workflow:agency-lab:lead-ingestion",
    integration_id: null,
    occurred_at: "2026-07-16T18:00:00.000Z",
    observed_at: "2026-07-16T18:00:01.000Z",
    claims: { delivery_id: "delivery-1", logical_operation_id: "operation-1" },
    limitations: [],
    redaction: { policy_id: "redaction:claims-only", policy_digest: `sha256:${"5".repeat(64)}` },
    detail: null,
    provenance_dependencies: [],
    ...overrides
  };
}

function grantDocument(overrides = {}) {
  return {
    principal_id: "observer:webhook-ingress",
    installation_id: "00000000-0000-4000-8000-00000000a001",
    environment_id: "00000000-0000-4000-8000-000000000001",
    adapter_binding: envelope().adapter_binding,
    allowed_schema_tuples: [envelope().schema],
    workflow_ids: ["workflow:agency-lab:lead-ingestion"],
    integration_ids: [],
    stream_id: "stream:webhook-ingress",
    valid_from: "2026-07-16T17:00:00.000Z",
    expires_at: "2026-07-16T19:00:00.000Z",
    key_id: "observer-webhook-key-v1",
    limits: {
      max_envelope_bytes: 16384,
      max_detail_bytes: 4096,
      max_sequence_advance: 1000
    },
    ...overrides
  };
}

test("observation envelopes are canonical, HMAC authenticated, and tamper evident", () => {
  const signed = createSignedObservation(envelope(), {
    keyId: "observer-webhook-key-v1", secret, signedAt: "2026-07-16T18:00:02.000Z"
  });
  const verified = verifySignedObservation(signed.bytes, signed.authentication, {
    keyId: "observer-webhook-key-v1", secret, now: "2026-07-16T18:00:03.000Z"
  });
  assert.equal(verified.envelope_digest, signed.envelope_digest);
  assert.deepEqual(verified.envelope, envelope());

  const changed = JSON.parse(signed.bytes);
  changed.claims.delivery_id = "delivery-2";
  assert.throws(() => verifySignedObservation(JSON.stringify(changed), signed.authentication, {
    keyId: "observer-webhook-key-v1", secret, now: "2026-07-16T18:00:03.000Z"
  }), (error) => error.code === "OBSERVATION_SIGNATURE_INVALID");
});

test("reporting grants authorize only the exact observer, stream, schema, binding, and scope", () => {
  const authorized = authorizeObservation(envelope(), grantDocument(), {
    grantId: envelope().grant_id,
    grantState: "active",
    now: "2026-07-16T18:00:03.000Z",
    envelopeBytes: 1000,
    detailBytes: 0,
    highestSequenceSeen: "0"
  });
  assert.equal(authorized.attribution, "authenticated_under_observer_specific_grant");
  assert.equal(authorized.external_truth_established, false);
  assert.equal(authorized.exclusive_authorship_established, false);

  for (const candidate of [
    envelope({ principal_id: "observer:other" }),
    envelope({ stream_id: "stream:other" }),
    envelope({ schema: { ...envelope().schema, schema_version: "0.2.0" } }),
    envelope({ workflow_id: "workflow:other" })
  ]) {
    assert.throws(() => authorizeObservation(candidate, grantDocument(), {
      grantId: envelope().grant_id,
      grantState: "active",
      now: "2026-07-16T18:00:03.000Z",
      envelopeBytes: 1000,
      detailBytes: 0,
      highestSequenceSeen: "0"
    }), (error) => error.status === 403);
  }
});

test("claims validation is closed and does not inspect opaque detail", () => {
  assert.deepEqual(validateObservationClaims(envelope().claims, schemaArtifact), envelope().claims);
  assert.throws(
    () => validateObservationClaims({ ...envelope().claims, answer: "opaque" }, schemaArtifact),
    (error) => error.code === "OBSERVATION_CLAIMS_INVALID"
  );
  assert.throws(
    () => validateObservationClaims({ delivery_id: "delivery-1" }, schemaArtifact),
    (error) => error.code === "OBSERVATION_CLAIMS_INVALID"
  );
});

test("stream coverage records gaps compactly and accepts late fills", () => {
  let coverage = projectStreamCoverage(null, "1");
  coverage = projectStreamCoverage(coverage, "4");
  assert.deepEqual(coverage, {
    highest_sequence_seen: "4",
    contiguous_through: "1",
    received_ranges: [["1", "1"], ["4", "4"]],
    missing_ranges: [["2", "3"]],
    coverage_status: "incomplete"
  });
  coverage = projectStreamCoverage(coverage, "2");
  coverage = projectStreamCoverage(coverage, "3");
  assert.equal(coverage.contiguous_through, "4");
  assert.deepEqual(coverage.missing_ranges, []);
  assert.equal(coverage.coverage_status, "complete_through_high_water");
});
