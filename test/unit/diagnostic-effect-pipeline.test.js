import assert from "node:assert/strict";
import test from "node:test";

import { canonicalize, sha256Digest } from "../../src/canonical-json.js";
import {
  buildDiagnosticClaimEnvelope,
  validateDiagnosticClaimEnvelope
} from "../../src/diagnostic-claim-envelope.js";
import {
  validateBehaviorContract,
  validateDiagnosticEvaluator,
  validateIntegrationBehaviorContract
} from "../../src/diagnostic-effect-contracts.js";
import {
  COUNT_BY_CORRELATION_RULES_DIGEST,
  evaluateCountByCorrelation
} from "../../src/diagnostic-effect-evaluator.js";
import {
  buildDiagnosticEffectProjection,
  DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST
} from "../../src/diagnostic-effect-projector.js";

const digest = (value) => sha256Digest({ value });
const operationId = "operation:00000000-0000-4000-8000-000000000901";
const workflowId = "workflow:agency-lab:lead-ingestion";
const integrationId = "integration:mock-crm";

function integrationContract() {
  return {
    schema_version: "alphonse.integration-behavior-contract.v0.1",
    contract_id: "contract:destination-a-semantics",
    integration_id: integrationId,
    destination_id: "destination:crm-primary",
    idempotency: {
      key_location: "request.header.idempotency-key",
      comparison: "exact_string",
      matching_key_behavior: "return_existing_result_without_new_commit"
    },
    commit_feed: {
      feed_id: "mock_crm_append_only_ledger",
      feed_kind: "append_only_ledger",
      feed_identity_claim: "effect_feed",
      event_identity_claim: "commit_id",
      resource_identity_claim: "resource_id",
      request_identity_claim: "request_id",
      operation_claim: "operation",
      committed_at_claim: "committed_at",
      external_claim_field: "external_claim",
      commit_record_semantics: "record_means_resource_operation_committed",
      consistency: "append_visible_after_commit"
    },
    reconciliation: { strategy: "query_by_request_identity", unresolved_outcome: "ambiguous" }
  };
}

function behaviorContract() {
  return {
    schema_version: "alphonse.behavior-contract.v0.1",
    contract_id: "contract:operation-effect-cardinality",
    workflow_id: workflowId,
    integration_id: integrationId,
    correlation_role: "logical_operation_id",
    selector: {
      effect_class: "diagnostic_derived_external_effect",
      destination_id: "destination:crm-primary",
      operation: "create_lead",
      status: "committed",
      commitment_bases: ["designated_append_only_commit_record"]
    },
    assertion: { comparison: "less_than_or_equal", threshold: 1 }
  };
}

function evaluator() {
  return {
    schema_version: "alphonse.diagnostic-evaluator.v0.1",
    evaluator_id: "alphonse.count-by-correlation",
    evaluator_version: "0.1.0",
    operation: "count_by_correlation",
    input_schema_version: "alphonse.diagnostic-effect-projection.v0.1",
    group_field: "logical_operation_id",
    output_states: ["indeterminate", "satisfied", "violated"]
  };
}

function material() {
  const requestNodes = [1, 2].map((index) => ({
    node_key: `request-node-${index}`,
    node_type: "destination.request",
    claimed_identity: `request-${index}`,
    receipt_reference: { receipt_id: `00000000-0000-4000-8000-00000000091${index}`,
      receipt_digest: digest(`request-${index}`), intake_position: String(index) }
  }));
  const effectNodes = [1, 2].map((index) => ({
    node_key: `effect-node-${index}`,
    node_type: "destination.effect",
    claimed_identity: `commit-${index}`,
    receipt_reference: { receipt_id: `00000000-0000-4000-8000-00000000092${index}`,
      receipt_digest: digest(`effect-${index}`), intake_position: String(index + 2) }
  }));
  const projection = {
    schema_version: "alphonse.correlation-projection.v0.2",
    scope: {
      installation_id: "00000000-0000-4000-8000-00000000a001",
      environment_id: "00000000-0000-4000-8000-000000000001",
      workflow_id: workflowId,
      revision_id: "00000000-0000-4000-8000-000000000930",
      integration_id: integrationId,
      logical_operation_id: operationId
    },
    cutoff: { committed_through: "8", capture_basis: "diagnostic_intake_prefix_finalization_row_lock" },
    dependencies: { projector_input_digest: digest("input") },
    coverage: { streams: [{ coverage_status: "complete_through_high_water" }], conflicts: [], rejections: [],
      limitations: [] },
    graph: {
      nodes: [...requestNodes, ...effectNodes],
      edges: effectNodes.map((effectNode, index) => ({
        relationship: "request_reported_ledger_claim",
        from_node_key: requestNodes[index].node_key,
        to_node_key: effectNode.node_key
      })),
      unresolved_relationships: []
    }
  };
  const evidence = [1, 2].flatMap((index) => [{
    receipt_id: requestNodes[index - 1].receipt_reference.receipt_id,
    receipt_digest: requestNodes[index - 1].receipt_reference.receipt_digest,
    envelope: { claims: { logical_operation_id: operationId, request_id: `request-${index}`,
      operation: "create_lead", transport_status: 202 } }
  }, {
    receipt_id: effectNodes[index - 1].receipt_reference.receipt_id,
    receipt_digest: effectNodes[index - 1].receipt_reference.receipt_digest,
    envelope: { claims: { logical_operation_id: operationId, request_id: `request-${index}`,
      commit_id: `commit-${index}`, resource_id: `resource-${index}`, operation: "create_lead",
      effect_feed: "mock_crm_append_only_ledger", committed_at: `2026-07-17T14:00:0${index}.000Z`,
      external_claim: true } }
  }]);
  return { projection, evidence };
}

function project(overrides = {}) {
  const { projection, evidence } = material();
  return buildDiagnosticEffectProjection({
    correlationProjectionId: "00000000-0000-4000-8000-000000000940",
    correlationSemanticDigest: digest("correlation"),
    correlationProjection: projection,
    integrationActivationId: "00000000-0000-4000-8000-000000000941",
    integrationContract: integrationContract(),
    integrationContractDigest: digest("integration-contract"),
    interpreterArtifactDigest: digest("interpreter-artifact"),
    observationEvidence: evidence,
    ...overrides
  });
}

function evaluate(effect = project(), contract = behaviorContract()) {
  return evaluateCountByCorrelation({
    effectProjectionId: "00000000-0000-4000-8000-000000000942",
    effectSemanticDigest: effect.semantic_digest,
    effectProjection: effect.semantic_projection,
    behaviorActivationId: "00000000-0000-4000-8000-000000000941",
    behaviorContract: contract,
    behaviorContractDigest: digest("behavior-contract"),
    evaluatorActivationId: "00000000-0000-4000-8000-000000000941",
    evaluator: evaluator(),
    evaluatorDigest: digest("evaluator"),
    evaluatorArtifactDigest: digest("evaluator-artifact"),
    evaluatorRulesDigest: COUNT_BY_CORRELATION_RULES_DIGEST
  });
}

test("interpretation exports are closed and reject incident-answer leakage", () => {
  assert.equal(validateIntegrationBehaviorContract(integrationContract()).idempotency.comparison, "exact_string");
  assert.equal(validateBehaviorContract(behaviorContract()).assertion.threshold, 1);
  assert.equal(validateDiagnosticEvaluator(evaluator()).operation, "count_by_correlation");
  assert.throws(() => validateBehaviorContract({ ...behaviorContract(), notes: "root cause" }),
    (error) => error.code === "DIAGNOSTIC_INTERPRETATION_CONTRACT_INVALID");
  const leaked = behaviorContract();
  leaked.contract_id = "contract:scope-mismatch";
  assert.throws(() => validateBehaviorContract(leaked),
    (error) => error.code === "DIAGNOSTIC_INTERPRETATION_CONTRACT_INVALID");
});

test("designated append-only feed claims become authority-free committed effects", () => {
  const result = project();
  assert.equal(result.semantic_projection.effects.length, 2);
  assert.ok(result.semantic_projection.effects.every((effect) => effect.status === "committed"
    && effect.commitment_basis === "designated_append_only_commit_record"
    && effect.authority === "none"));
  assert.equal(result.semantic_projection.authority.external_truth_established, false);
  assert.equal(result.semantic_projection.dependencies.interpreter.rules_digest,
    DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST);

  const { projection, evidence } = material();
  evidence[1].envelope.claims.effect_feed = "unregistered_feed";
  const unknown = project({ correlationProjection: projection, observationEvidence: evidence });
  assert.equal(unknown.semantic_projection.effects.filter((effect) => effect.status === "unknown").length, 1);

  const changedCorrelation = project({ correlationSemanticDigest: digest("changed-correlation") });
  assert.notEqual(changedCorrelation.semantic_projection.effects[0].effect_id,
    result.semantic_projection.effects[0].effect_id);
});

test("bounded evaluator sees normalized effects only and proves two greater than one", () => {
  const evaluation = evaluate();
  assert.equal(evaluation.semantic_evaluation.result, "violated");
  assert.equal(evaluation.semantic_evaluation.measurement.matched_effect_count, 2);
  assert.deepEqual(evaluation.semantic_evaluation.evaluator.input_boundary,
    ["behavior_contract", "diagnostic_effect_projection", "diagnostic_evaluator"]);
  const bytes = canonicalize(evaluation.semantic_evaluation);
  for (const prohibited of ["transport_status", "effect_feed", "external_claim", "receipt_id"]) {
    assert.equal(bytes.includes(prohibited), false, prohibited);
  }

  const oneEffect = project();
  oneEffect.semantic_projection.effects = oneEffect.semantic_projection.effects.slice(0, 1);
  oneEffect.semantic_projection.coverage.required_sources_complete = false;
  assert.equal(evaluate({ semantic_projection: oneEffect.semantic_projection,
    semantic_digest: sha256Digest(oneEffect.semantic_projection) }).semantic_evaluation.result, "indeterminate");

  const wrongScope = behaviorContract();
  wrongScope.workflow_id = "workflow:other";
  assert.throws(() => evaluate(project(), wrongScope), /does not match/u);
});

test("minimal temporal Claim Envelope separates support from authority", () => {
  const claim = buildDiagnosticClaimEnvelope({
    claimType: "unresolved_conclusion",
    productionMethod: "deterministically_derived",
    proposition: { subject_type: "diagnostic_case", subject_id: "case:test", predicate: "root_cause", value: null },
    evidenceReferences: [{ record_type: "diagnostic_trigger", record_id: "trigger:test",
      record_digest: digest("trigger") }],
    verificationResults: ["evidence_references_verified"],
    assertedSupport: "NOT_ESTABLISHED",
    effectiveSupport: "NOT_ESTABLISHED",
    evidenceStatus: "partial",
    temporalScope: { valid_at: null, observed_at: null, accepted_at: null,
      assessed_at: "2026-07-17T14:01:00.000Z", freshness: "frozen_historical", expires_at: null },
    limitations: ["causal_mechanism_not_evaluated"],
    authorityDecision: { authority: "none", permitted_consequence: "none", decision_basis: "no_authority" }
  });
  assert.equal(validateDiagnosticClaimEnvelope(claim.document).effective_support, "NOT_ESTABLISHED");
  assert.equal(claim.document.authority_decision.authority, "none");
});
