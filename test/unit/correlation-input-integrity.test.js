import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import { verifyCorrelationAcceptedInputs } from "../../src/correlation-input-integrity.js";
import { createSignedObservation } from "../../src/observation-contracts.js";

const installationId = "00000000-0000-4000-8000-00000000a001";
const environmentId = "00000000-0000-4000-8000-000000000001";
const receiptId = "00000000-0000-4000-8000-000000000811";
const observationId = "00000000-0000-4000-8000-000000000812";
const grantId = "00000000-0000-4000-8000-000000000813";
const transitionId = "00000000-0000-4000-8000-000000000814";
const dependencyId = "00000000-0000-4000-8000-000000000815";
const observerSecret = "observer-secret-with-sufficient-length-for-tests";
const schema = {
  schema_id: "schema:source.delivery",
  schema_version: "0.1.0",
  schema_digest: `sha256:${"3".repeat(64)}`
};

function material({ dependency = false } = {}) {
  const envelope = {
    schema_version: "alphonse.observation-envelope.v0.1",
    observation_id: observationId,
    observation_type: "source.delivery",
    schema,
    principal_id: "observer:webhook-ingress",
    grant_id: grantId,
    key_id: "observer-key-v1",
    installation_id: installationId,
    environment_id: environmentId,
    adapter_binding: {
      adapter_binding_id: "adapter:customer-ingress",
      version: "0.1.0",
      digest: `sha256:${"4".repeat(64)}`
    },
    stream_id: "stream:source.delivery",
    sequence: "1",
    workflow_id: "workflow:agency-lab:lead-ingestion",
    integration_id: "integration:mock-crm",
    occurred_at: "2026-07-17T12:00:00.000Z",
    observed_at: "2026-07-17T12:00:01.000Z",
    claims: {
      logical_operation_id: "operation:test",
      delivery_id: "delivery:test",
      ...(dependency ? { delivery_identity_equality_token: "eq:v1:verified" } : {})
    },
    limitations: [],
    redaction: { policy_id: "policy:test", policy_digest: `sha256:${"5".repeat(64)}` },
    detail: null,
    provenance_dependencies: dependency ? [dependencyId] : []
  };
  const signed = createSignedObservation(envelope, {
    keyId: envelope.key_id,
    secret: observerSecret,
    signedAt: "2026-07-17T12:00:02.000Z"
  });
  const receivedAt = "2026-07-17T12:00:03.000Z";
  const grantSnapshotDigest = `sha256:${"6".repeat(64)}`;
  const receipt = {
    receipt_id: receiptId,
    intake_position: "1",
    observation_id: observationId,
    observation_type: envelope.observation_type,
    envelope_digest: signed.envelope_digest,
    detail_artifact_digest: null,
    principal_id: envelope.principal_id,
    grant_id: envelope.grant_id,
    grant_snapshot_digest: grantSnapshotDigest,
    stream_id: envelope.stream_id,
    stream_sequence: envelope.sequence,
    schema,
    received_at: receivedAt,
    attribution: "authenticated_under_observer_specific_grant",
    exclusive_authorship_established: false,
    external_truth_established: false,
    coverage: {
      highest_sequence_seen: "1",
      contiguous_through: "1",
      received_ranges: [["1", "1"]],
      missing_ranges: [],
      coverage_status: "complete_through_high_water"
    },
    transition: {
      transition_id: transitionId,
      type: "diagnostic.observation.accepted",
      diagnostic_sequence: "1"
    }
  };
  const receiptDigest = sha256Digest(receipt);
  const row = {
    receipt_id: receiptId,
    installation_id: installationId,
    environment_id: environmentId,
    intake_position: "1",
    observation_id: observationId,
    principal_id: envelope.principal_id,
    grant_id: grantId,
    key_id: envelope.key_id,
    stream_id: envelope.stream_id,
    stream_sequence: "1",
    observation_type: envelope.observation_type,
    schema_id: schema.schema_id,
    schema_version: schema.schema_version,
    schema_digest: schema.schema_digest,
    workflow_id: envelope.workflow_id,
    integration_id: envelope.integration_id,
    envelope,
    envelope_bytes: Buffer.from(signed.bytes, "utf8"),
    envelope_digest: signed.envelope_digest,
    detail_artifact_digest: null,
    authentication: signed.authentication,
    grant_snapshot_digest: grantSnapshotDigest,
    attribution: receipt.attribution,
    external_truth_established: false,
    exclusive_authorship_established: false,
    received_at: new Date(receivedAt),
    transition_id: transitionId,
    receipt,
    receipt_digest: receiptDigest,
    schema_installation_id: installationId,
    schema_environment_id: environmentId,
    schema_observation_type: envelope.observation_type,
    schema_activation_schema_id: schema.schema_id,
    schema_activation_schema_version: schema.schema_version,
    schema_activation_schema_digest: schema.schema_digest
  };
  const outcome = {
    intake_position: "1",
    outcome_type: "accepted",
    outcome_id: receiptId,
    outcome_digest: receiptDigest
  };
  const proof = {
    result_receipt_id: dependencyId,
    receipt_digest: `sha256:${"7".repeat(64)}`,
    grant_snapshot_digest: `sha256:${"8".repeat(64)}`,
    grant_application_receipt_digest: `sha256:${"9".repeat(64)}`,
    requester_principal_id: envelope.principal_id,
    installation_id: installationId,
    environment_id: environmentId,
    integration_id: envelope.integration_id,
    field_role: "source.delivery_identity",
    claim_field: "delivery_identity_equality_token",
    namespace: "lead-idempotency",
    algorithm_version: "hmac-sha256-length-prefixed.v1",
    equality_token: envelope.claims.delivery_identity_equality_token
  };
  const dependencyRow = dependency ? {
    observation_receipt_id: receiptId,
    dependency_type: "tokenization_result_receipt",
    dependency_id: dependencyId,
    dependency_digest: proof.receipt_digest
  } : null;
  return { outcome, row, dependencyRow, proof };
}

async function verify(value, tokenizationVerifier = null) {
  return verifyCorrelationAcceptedInputs({
    outcomeRows: [value.outcome],
    observationRows: [value.row],
    dependencyRows: value.dependencyRow ? [value.dependencyRow] : [],
    installationId,
    environmentId,
    tokenizationVerifier
  });
}

test("correlation derives semantic observations from canonical envelope bytes", async () => {
  const value = material();
  const verified = await verify(value);
  assert.equal(verified.observations[0].observation_type, value.row.envelope.observation_type);
  assert.equal(verified.observations[0].workflow_id, value.row.envelope.workflow_id);
  assert.deepEqual(verified.schema_manifest, [{ observation_type: "source.delivery", ...schema }]);
  assert.equal("schema_activation_id" in verified.receipt_manifest[0], false);
});

test("every semantic denormalization mismatch fails accepted-receipt integrity", async () => {
  const mutations = [
    ["installation", (row) => { row.installation_id = "00000000-0000-4000-8000-00000000a002"; }],
    ["environment", (row) => { row.environment_id = "00000000-0000-4000-8000-000000000002"; }],
    ["type", (row) => { row.observation_type = "runtime.execution"; }],
    ["principal", (row) => { row.principal_id = "observer:other"; }],
    ["grant", (row) => { row.grant_id = "00000000-0000-4000-8000-000000000899"; }],
    ["key", (row) => { row.key_id = "other-key"; }],
    ["stream", (row) => { row.stream_id = "stream:other"; }],
    ["sequence", (row) => { row.stream_sequence = "2"; }],
    ["workflow", (row) => { row.workflow_id = "workflow:other"; }],
    ["integration", (row) => { row.integration_id = "integration:other"; }],
    ["schema", (row) => { row.schema_digest = `sha256:${"a".repeat(64)}`; }],
    ["schema activation", (row) => { row.schema_environment_id = "00000000-0000-4000-8000-000000000002"; }],
    ["grant snapshot", (row) => { row.grant_snapshot_digest = `sha256:${"b".repeat(64)}`; }],
    ["receipt digest", (row) => { row.receipt_digest = `sha256:${"c".repeat(64)}`; }]
  ];
  for (const [label, mutate] of mutations) {
    const value = material();
    mutate(value.row);
    await assert.rejects(() => verify(value), (error) => {
      assert.equal(error.code, "CORRELATION_ACCEPTED_RECEIPT_INTEGRITY_VIOLATION", label);
      return true;
    });
  }
});

test("token dependencies require an exact join and a signed proof bound to the envelope", async () => {
  const value = material({ dependency: true });
  const verifier = { verifyStoredResultReceipt: () => value.proof };
  const verified = await verify(value, verifier);
  assert.equal(verified.observations[0].dependencies[0].equality_token, "eq:v1:verified");
  assert.equal(verified.tokenization_manifest.length, 1);

  const missing = material({ dependency: true });
  missing.dependencyRow = null;
  await assert.rejects(() => verify(missing, verifier),
    (error) => error.code === "CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION");

  const changedDigest = material({ dependency: true });
  changedDigest.dependencyRow.dependency_digest = `sha256:${"f".repeat(64)}`;
  await assert.rejects(() => verify(changedDigest, {
    verifyStoredResultReceipt: () => changedDigest.proof
  }), (error) => error.code === "CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION");

  const changedClaim = material({ dependency: true });
  await assert.rejects(() => verify(changedClaim, {
    verifyStoredResultReceipt: () => ({ ...changedClaim.proof, equality_token: "eq:v1:other" })
  }), (error) => error.code === "CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION");
});
