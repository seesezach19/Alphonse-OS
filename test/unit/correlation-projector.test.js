import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildCorrelationProjection,
  CORRELATION_PROJECTOR_ARTIFACT_DIGEST,
  CORRELATION_RULES_DIGEST
} from "../../src/correlation-projector.js";

const digest = (value) => sha256Digest({ value });
const operationId = "op_00000000-0000-4000-8000-000000000808";

const registration = {
  registration_id: "00000000-0000-4000-8000-000000000801",
  installation_id: "00000000-0000-4000-8000-00000000a001",
  environment_id: "00000000-0000-4000-8000-000000000001",
  workflow_id: "workflow:agency-lab:lead-ingestion",
  revision_id: "00000000-0000-4000-8000-000000000802",
  integration_id: "integration:mock-crm",
  registration_digest: digest("registration"),
  contract_dependency_digests: [digest("contract"), digest("package")]
};

function token(id, tokenValue, fieldRole, claimField, overrides = {}) {
  return {
    result_receipt_id: `token-${id}`,
    receipt_digest: digest(`token-${id}`),
    grant_snapshot_digest: digest(`snapshot-${id}`),
    grant_application_receipt_digest: digest(`application-${id}`),
    requester_principal_id: fieldRole.startsWith("source") ? "observer:webhook-ingress" : "observer:crm-request",
    integration_id: "integration:mock-crm",
    field_role: fieldRole,
    claim_field: claimField,
    namespace: "lead-idempotency",
    algorithm_version: "hmac-sha256-length-prefixed.v1",
    equality_token: tokenValue,
    ...overrides
  };
}

function observation(position, type, claims, dependencies = [], overrides = {}) {
  return {
    receipt_id: `00000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
    receipt_digest: digest(`receipt-${position}`),
    intake_position: String(position),
    envelope_digest: digest(`envelope-${position}`),
    observation_type: type,
    principal_id: `observer:${type}`,
    grant_id: `grant:${type}`,
    stream_id: `stream:${type}`,
    stream_sequence: position <= 2 ? String(position) : String(position - (type === "runtime.execution" ? 2
      : type === "destination.request" ? 4 : 6)),
    workflow_id: registration.workflow_id,
    integration_id: type === "runtime.execution" ? null : registration.integration_id,
    claims: { logical_operation_id: operationId, ...claims },
    limitations: type === "destination.effect" ? ["authenticated_external_commit_feed_claim"] : [],
    dependencies,
    ...overrides
  };
}

function fixture() {
  const sourceOneToken = token("source-1", "eq:v1:A", "source.delivery_identity",
    "delivery_identity_equality_token");
  const sourceTwoToken = token("source-2", "eq:v1:B", "source.delivery_identity",
    "delivery_identity_equality_token");
  const requestOneToken = token("request-1", "eq:v1:A", "destination.idempotency_key",
    "idempotency_key_equality_token");
  const requestTwoToken = token("request-2", "eq:v1:B", "destination.idempotency_key",
    "idempotency_key_equality_token");
  const observations = [
    observation(1, "source.delivery", { delivery_id: "delivery-1",
      delivery_identity_equality_token: "eq:v1:A" }, [sourceOneToken]),
    observation(2, "source.delivery", { delivery_id: "delivery-2",
      delivery_identity_equality_token: "eq:v1:B" }, [sourceTwoToken]),
    observation(3, "runtime.execution", { execution_id: "execution-1", delivery_id: "delivery-1" }),
    observation(4, "runtime.execution", { execution_id: "execution-2", delivery_id: "delivery-2" }),
    observation(5, "destination.request", { request_id: "request-1", delivery_id: "delivery-1",
      idempotency_key_equality_token: "eq:v1:A" }, [requestOneToken]),
    observation(6, "destination.request", { request_id: "request-2", delivery_id: "delivery-2",
      idempotency_key_equality_token: "eq:v1:B" }, [requestTwoToken]),
    observation(7, "destination.effect", { commit_id: "commit-1", request_id: "request-1",
      delivery_id: "delivery-1" }),
    observation(8, "destination.effect", { commit_id: "commit-2", request_id: "request-2",
      delivery_id: "delivery-2" })
  ];
  const intakeOutcomes = observations.map((item) => ({ intake_position: item.intake_position,
    outcome_type: "accepted", outcome_id: item.receipt_id, outcome_digest: item.receipt_digest }));
  const receiptManifest = observations.map((item) => ({ intake_position: item.intake_position,
    receipt_id: item.receipt_id, receipt_digest: item.receipt_digest }));
  const schemaManifest = [...new Set(observations.map((item) => item.observation_type))].map((type) => ({
    schema_id: `schema:${type}`, schema_digest: digest(`schema:${type}`)
  }));
  const tokenizationManifest = [sourceOneToken, sourceTwoToken, requestOneToken, requestTwoToken]
    .map(({ equality_token: _equalityToken, ...item }) => item);
  return { observations, intakeOutcomes, receiptManifest, schemaManifest, tokenizationManifest };
}

function project(material = fixture(), overrides = {}) {
  return buildCorrelationProjection({ registration, logicalOperationId: operationId, cutoff: "8",
    ...material, conflicts: [], rejections: [], ...overrides });
}

test("correlation projector creates one inspectable operation with exact typed and tokenized paths", () => {
  const result = project();
  const graph = result.semantic_projection.graph;
  assert.deepEqual(graph.counts_by_type, {
    "destination.effect": 2,
    "destination.request": 2,
    "runtime.execution": 2,
    "source.delivery": 2
  });
  assert.equal(graph.nodes.length, 9);
  assert.equal(graph.edges.length, 11);
  assert.deepEqual(graph.unresolved_relationships, []);
  assert.equal(graph.edges.filter((edge) => edge.relationship === "delivery_identity_equals_request_key").length, 2);
  assert.equal(graph.edges.filter((edge) => edge.relationship === "request_keys_are_distinct").length, 1);
  assert.ok(graph.edges.every((edge) => edge.supporting_claim_locations.length > 0));
  assert.ok(graph.edges.filter((edge) => edge.relationship === "delivery_identity_equals_request_key")
    .every((edge) => edge.supporting_tokenization_provenance.length === 2));
  assert.equal(result.semantic_projection.dependencies.projector.artifact_digest,
    CORRELATION_PROJECTOR_ARTIFACT_DIGEST);
  assert.equal(result.semantic_projection.dependencies.projector.rules_digest, CORRELATION_RULES_DIGEST);
  assert.equal(result.semantic_projection.authority.defect_established, false);
});

test("exact inputs replay to one semantic digest regardless of row or dependency order", () => {
  const material = fixture();
  const first = project(material);
  const replay = project({
    observations: [...material.observations].reverse().map((item) => ({
      ...item,
      dependencies: [...item.dependencies].reverse()
    })),
    intakeOutcomes: [...material.intakeOutcomes].reverse(),
    receiptManifest: [...material.receiptManifest].reverse(),
    schemaManifest: [...material.schemaManifest].reverse(),
    tokenizationManifest: [...material.tokenizationManifest].reverse()
  });
  assert.equal(replay.semantic_digest, first.semantic_digest);
  assert.deepEqual(replay.semantic_projection, first.semantic_projection);
  assert.equal("projection_id" in first.semantic_projection, false);
  assert.equal("created_at" in first.semantic_projection, false);
});

test("copied operation identity without an exact delivery path remains unresolved", () => {
  const material = fixture();
  material.observations[2] = observation(3, "runtime.execution", {
    execution_id: "execution-copied-operation",
    delivery_id: "delivery-that-was-never-observed"
  });
  const graph = project(material).semantic_projection.graph;
  assert.equal(graph.edges.some((edge) => edge.relationship === "delivery_reported_execution"
    && edge.supporting_claim_locations.some((location) => location.receipt_id === material.observations[2].receipt_id)), false);
  assert.ok(graph.unresolved_relationships.some((item) =>
    item.relationship === "delivery_reported_execution"
    && item.reason === "missing_delivery_identity_match"));
});

test("tokenization version mismatch is not bridged into an equality edge", () => {
  const material = fixture();
  material.observations[4].dependencies[0] = {
    ...material.observations[4].dependencies[0], algorithm_version: "hmac-sha256-length-prefixed.v2"
  };
  const graph = project(material).semantic_projection.graph;
  const requestReceipt = material.observations[4].receipt_id;
  assert.equal(graph.edges.some((edge) => edge.relationship === "delivery_identity_equals_request_key"
    && edge.to_node_key === graph.nodes.find((node) => node.receipt_reference?.receipt_id === requestReceipt).node_key), false);
  assert.ok(graph.unresolved_relationships.some((item) =>
    item.relationship === "delivery_identity_equals_request_key"
    && item.subject === requestReceipt));
});

test("coverage gaps, conflicts, rejections, and observer limitations freeze at the cutoff", () => {
  const material = fixture();
  material.observations[1].stream_sequence = "4";
  const conflict = { conflict_id: "conflict-1", intake_position: "7",
    conflict_digest: digest("conflict"), conflict_types: ["stream_sequence"] };
  const rejection = { rejection_id: "rejection-1", intake_position: "8",
    body_digest: digest("rejection"), reason_code: "OBSERVATION_GRANT_INACTIVE" };
  const projection = project(material, { conflicts: [conflict], rejections: [rejection] }).semantic_projection;
  const sourceCoverage = projection.coverage.streams.find((stream) => stream.stream_id === "stream:source.delivery");
  assert.deepEqual(sourceCoverage.missing_ranges, [["2", "3"]]);
  assert.equal(sourceCoverage.coverage_status, "incomplete");
  assert.deepEqual(projection.coverage.conflicts, [conflict]);
  assert.deepEqual(projection.coverage.rejections, [rejection]);
  assert.equal(projection.coverage.limitations.filter((item) =>
    item.limitation === "authenticated_external_commit_feed_claim").length, 2);
});
