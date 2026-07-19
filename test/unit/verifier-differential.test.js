import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildCorrelationProjection as productionProjection,
  buildCorrelationProjectorInput as productionInput,
  CORRELATION_PROJECTOR_ARTIFACT_DIGEST,
  CORRELATION_RULES_DIGEST as productionCorrelationRulesDigest
} from "../../src/correlation-projector.js";
import {
  DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST as productionSelectionRulesDigest
} from "../../src/diagnostic-evidence-selector.js";
import {
  buildCorrelationProjection as verifierProjection,
  buildCorrelationProjectorInput as verifierInput,
  CORRELATION_RULES_DIGEST as verifierCorrelationRulesDigest
} from "../../verifier/correlation.js";
import {
  DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST as verifierSelectionRulesDigest
} from "../../verifier/selection.js";

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

function token(id, tokenValue, fieldRole, claimField) {
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
    equality_token: tokenValue
  };
}

function observation(position, type, claims, dependencies = []) {
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
    dependencies
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
  return {
    observations,
    intakeOutcomes: observations.map((item) => ({ intake_position: item.intake_position,
      outcome_type: "accepted", outcome_id: item.receipt_id, outcome_digest: item.receipt_digest })),
    receiptManifest: observations.map((item) => ({ intake_position: item.intake_position,
      receipt_id: item.receipt_id, receipt_digest: item.receipt_digest })),
    schemaManifest: [...new Set(observations.map((item) => item.observation_type))].map((type) => ({
      schema_id: `schema:${type}`, schema_digest: digest(`schema:${type}`)
    })),
    tokenizationManifest: [sourceOneToken, sourceTwoToken, requestOneToken, requestTwoToken]
      .map(({ equality_token: _equalityToken, ...item }) => item)
  };
}

test("kernel and verifier keep load-bearing rule digests identical", () => {
  assert.equal(productionCorrelationRulesDigest, verifierCorrelationRulesDigest);
  assert.equal(productionSelectionRulesDigest, verifierSelectionRulesDigest);
});

test("kernel and verifier emit identical correlation projector inputs for the same fixture", () => {
  const material = fixture();
  const args = {
    registration,
    logicalOperationId: operationId,
    cutoff: "8",
    ...material,
    conflicts: [],
    rejections: []
  };
  const fromKernel = productionInput(args);
  const fromVerifier = verifierInput(args);
  assert.equal(sha256Digest(fromKernel), sha256Digest(fromVerifier));
  assert.deepEqual(fromKernel, fromVerifier);
});

test("kernel and verifier emit identical correlation semantic digests for the same fixture", () => {
  const material = fixture();
  const projectorInput = productionInput({
    registration,
    logicalOperationId: operationId,
    cutoff: "8",
    ...material,
    conflicts: [],
    rejections: []
  });
  const kernel = productionProjection(projectorInput);
  const independent = verifierProjection(projectorInput, {
    projectorArtifactDigest: CORRELATION_PROJECTOR_ARTIFACT_DIGEST
  });
  assert.equal(kernel.projector_input_digest, independent.projector_input_digest);
  assert.equal(kernel.semantic_digest, independent.semantic_digest);
  assert.deepEqual(kernel.semantic_projection.graph, independent.semantic_projection.graph);
  assert.deepEqual(kernel.semantic_projection, independent.semantic_projection);
});
