import { compareCanonical, deterministicUuid, sha256Digest } from "./canonical.js";

export const DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA = "alphonse.diagnostic-effect-projection.v0.1";
export const DIAGNOSTIC_EFFECT_INTERPRETER = Object.freeze({
  interpreter_id: "alphonse.designated-commit-feed-interpreter",
  interpreter_version: "0.1.0",
  input_projection_schema: "alphonse.correlation-projection.v0.2",
  output_projection_schema: DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA,
  statuses: ["ambiguous", "committed", "not_committed", "unknown"],
  committed_basis: "designated_append_only_commit_record",
  request_acknowledgement_is_commitment: false
});
export const DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST = sha256Digest(DIAGNOSTIC_EFFECT_INTERPRETER);
export const BEHAVIOR_EVALUATION_SCHEMA = "alphonse.behavior-evaluation.v0.1";
export const COUNT_BY_CORRELATION_RULES = Object.freeze({
  schema_version: "alphonse.count-by-correlation-rules.v0.1",
  input_boundary: ["behavior_contract", "diagnostic_effect_projection", "diagnostic_evaluator"],
  countable_effect_status: "committed",
  supported_comparison: "less_than_or_equal",
  violation_with_unrelated_gaps: true,
  satisfaction_requires_complete_sources: true
});
export const COUNT_BY_CORRELATION_RULES_DIGEST = sha256Digest(COUNT_BY_CORRELATION_RULES);

function stringClaim(envelope, field) {
  const value = envelope?.claims?.[field];
  return typeof value === "string" && value ? value : null;
}

function evidenceReference(evidence) {
  return { receipt_id: evidence.receipt_id, receipt_digest: evidence.receipt_digest };
}

function interpretedEffect({ effectNode, requestNode, effectEvidence, requestEvidence, contract,
  correlationProjection, correlationSemanticDigest, integrationContractDigest }) {
  const effectClaims = effectEvidence?.envelope?.claims;
  const feedId = stringClaim(effectEvidence?.envelope, contract.commit_feed.feed_identity_claim);
  const effectIdentity = stringClaim(effectEvidence?.envelope, contract.commit_feed.event_identity_claim);
  const resourceIdentity = stringClaim(effectEvidence?.envelope, contract.commit_feed.resource_identity_claim);
  const requestIdentity = stringClaim(effectEvidence?.envelope, contract.commit_feed.request_identity_claim);
  const operation = stringClaim(effectEvidence?.envelope, contract.commit_feed.operation_claim);
  const committedAt = stringClaim(effectEvidence?.envelope, contract.commit_feed.committed_at_claim);
  const externalClaim = effectClaims?.[contract.commit_feed.external_claim_field] === true;
  const requestBound = Boolean(requestNode && requestEvidence
    && requestNode.claimed_identity === requestIdentity
    && stringClaim(requestEvidence.envelope, contract.commit_feed.request_identity_claim) === requestIdentity
    && stringClaim(requestEvidence.envelope, contract.commit_feed.operation_claim) === operation
    && stringClaim(requestEvidence.envelope, "logical_operation_id")
      === correlationProjection.scope.logical_operation_id);
  const feedBound = feedId === contract.commit_feed.feed_id
    && contract.commit_feed.feed_kind === "append_only_ledger"
    && contract.commit_feed.commit_record_semantics === "record_means_resource_operation_committed"
    && contract.commit_feed.consistency === "append_visible_after_commit";
  const identityBound = effectNode.claimed_identity === effectIdentity
    && stringClaim(effectEvidence?.envelope, "logical_operation_id")
      === correlationProjection.scope.logical_operation_id
    && Boolean(effectIdentity && resourceIdentity && requestIdentity && operation && committedAt)
    && Number.isFinite(Date.parse(committedAt));
  const committed = feedBound && identityBound && requestBound && externalClaim;
  const status = committed ? "committed" : requestNode && effectEvidence ? "unknown" : "ambiguous";
  const limitations = ["contract_bound_interpretation_not_external_truth"];
  if (externalClaim) limitations.push("authenticated_external_commit_feed_claim");
  if (!committed) limitations.push("commitment_not_established_from_designated_feed");
  return {
    effect_id: deterministicUuid({ namespace: "diagnostic-effect",
      correlation_semantic_digest: correlationSemanticDigest,
      integration_contract_digest: integrationContractDigest,
      effect_receipt_digest: effectEvidence?.receipt_digest ?? effectNode.receipt_reference.receipt_digest }),
    effect_class: "diagnostic_derived_external_effect",
    logical_operation_id: correlationProjection.scope.logical_operation_id,
    destination_id: contract.destination_id,
    integration_id: contract.integration_id,
    operation,
    effect_identity: effectIdentity,
    resource_reference: resourceIdentity ? { resource_id: resourceIdentity } : null,
    request_reference: requestNode && requestEvidence ? { node_key: requestNode.node_key,
      request_id: requestNode.claimed_identity, ...evidenceReference(requestEvidence) } : null,
    status,
    commitment_basis: committed ? DIAGNOSTIC_EFFECT_INTERPRETER.committed_basis : null,
    committed_at: committed ? new Date(committedAt).toISOString() : null,
    supporting_receipts: [effectEvidence, requestEvidence].filter(Boolean)
      .map(evidenceReference).sort(compareCanonical),
    limitations: limitations.sort(),
    authority: "none"
  };
}

export function buildDiagnosticEffectProjection({ correlationProjectionId, correlationSemanticDigest,
  correlationProjection, integrationActivationId, integrationContract, integrationContractDigest,
  interpreterArtifactDigest, observationEvidence }) {
  if (correlationProjection?.schema_version !== "alphonse.correlation-projection.v0.2"
      || integrationContract.integration_id !== correlationProjection.scope.integration_id) {
    throw new Error("VERIFIER_EFFECT_INPUT_SCOPE_INVALID");
  }
  const evidenceByReceipt = new Map(observationEvidence.map((item) => [item.receipt_id, item]));
  const nodesByKey = new Map(correlationProjection.graph.nodes.map((node) => [node.node_key, node]));
  const effects = correlationProjection.graph.nodes.filter((node) => node.node_type === "destination.effect")
    .map((effectNode) => {
      const edges = correlationProjection.graph.edges.filter((edge) =>
        edge.relationship === "request_reported_ledger_claim" && edge.to_node_key === effectNode.node_key);
      const requestNode = edges.length === 1 ? nodesByKey.get(edges[0].from_node_key) : null;
      return interpretedEffect({ effectNode, requestNode,
        effectEvidence: evidenceByReceipt.get(effectNode.receipt_reference.receipt_id),
        requestEvidence: requestNode ? evidenceByReceipt.get(requestNode.receipt_reference.receipt_id) : null,
        contract: integrationContract, correlationProjection, correlationSemanticDigest,
        integrationContractDigest });
    }).sort(compareCanonical);
  const requiredSourcesComplete = correlationProjection.coverage.streams.every((stream) =>
    stream.coverage_status === "complete_through_high_water")
    && correlationProjection.coverage.conflicts.length === 0
    && correlationProjection.coverage.rejections.length === 0
    && !correlationProjection.graph.unresolved_relationships.some((item) =>
      ["required_observer_stream", "request_reported_ledger_claim"].includes(item.relationship));
  const semanticProjection = {
    schema_version: DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA,
    classification: "diagnostic_derived_external_effect",
    scope: structuredClone(correlationProjection.scope),
    dependencies: { correlation_projection_id: correlationProjectionId,
      correlation_semantic_digest: correlationSemanticDigest,
      integration_activation_id: integrationActivationId,
      integration_contract_digest: integrationContractDigest,
      interpreter: { interpreter_id: DIAGNOSTIC_EFFECT_INTERPRETER.interpreter_id,
        interpreter_version: DIAGNOSTIC_EFFECT_INTERPRETER.interpreter_version,
        artifact_digest: interpreterArtifactDigest,
        rules_digest: DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST } },
    cutoff: structuredClone(correlationProjection.cutoff),
    effects,
    coverage: { required_sources_complete: requiredSourcesComplete,
      contributing_streams_digest: sha256Digest(correlationProjection.coverage.streams),
      unresolved_relationships_digest: sha256Digest(correlationProjection.graph.unresolved_relationships),
      limitations: structuredClone(correlationProjection.coverage.limitations) },
    authority: { kernel_effect: false, execution_authorized: false,
      external_truth_established: false, diagnosis_established: false }
  };
  return { semantic_projection: semanticProjection, semantic_digest: sha256Digest(semanticProjection) };
}

export function evaluateCountByCorrelation({ effectProjectionId, effectSemanticDigest, effectProjection,
  behaviorActivationId, behaviorContract, behaviorContractDigest, evaluatorActivationId, evaluator,
  evaluatorDigest, evaluatorArtifactDigest, evaluatorRulesDigest }) {
  if (effectProjection?.schema_version !== DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA
      || behaviorContract.workflow_id !== effectProjection.scope.workflow_id
      || behaviorContract.integration_id !== effectProjection.scope.integration_id
      || evaluator.operation !== "count_by_correlation") {
    throw new Error("VERIFIER_EVALUATION_INPUT_SCOPE_INVALID");
  }
  const matched = effectProjection.effects.filter((effect) =>
    effect.effect_class === behaviorContract.selector.effect_class
    && effect.destination_id === behaviorContract.selector.destination_id
    && effect.operation === behaviorContract.selector.operation
    && effect.status === behaviorContract.selector.status
    && behaviorContract.selector.commitment_bases.includes(effect.commitment_basis)
    && effect.logical_operation_id === effectProjection.scope.logical_operation_id);
  const count = matched.length;
  const violated = behaviorContract.assertion.comparison === "less_than_or_equal"
    && count > behaviorContract.assertion.threshold;
  const result = violated ? "violated"
    : effectProjection.coverage.required_sources_complete ? "satisfied" : "indeterminate";
  const semanticEvaluation = {
    schema_version: BEHAVIOR_EVALUATION_SCHEMA,
    scope: structuredClone(effectProjection.scope),
    dependencies: { effect_projection_id: effectProjectionId, effect_semantic_digest: effectSemanticDigest,
      behavior_activation_id: behaviorActivationId, behavior_contract_digest: behaviorContractDigest,
      evaluator_activation_id: evaluatorActivationId, evaluator_digest: evaluatorDigest,
      evaluator_artifact_digest: evaluatorArtifactDigest, evaluator_rules_digest: evaluatorRulesDigest },
    evaluator: { evaluator_id: evaluator.evaluator_id, evaluator_version: evaluator.evaluator_version,
      operation: evaluator.operation,
      input_boundary: ["behavior_contract", "diagnostic_effect_projection", "diagnostic_evaluator"] },
    assertion: structuredClone(behaviorContract.assertion),
    measurement: { group_field: evaluator.group_field,
      group_value: effectProjection.scope.logical_operation_id,
      matched_effect_count: count,
      matched_effects: matched.map((effect) => ({ effect_id: effect.effect_id,
        effect_digest: sha256Digest(effect) })).sort(compareCanonical) },
    coverage: { required_sources_complete: effectProjection.coverage.required_sources_complete,
      satisfaction_established: result === "satisfied", violation_established: result === "violated" },
    result,
    authority: { diagnostic_case_creation: result === "violated", diagnosis_established: false,
      repair_authorized: false, kernel_effect_authorized: false }
  };
  return { evaluation_id: deterministicUuid({ namespace: "behavior-evaluation",
    effect_semantic_digest: effectSemanticDigest, behavior_contract_digest: behaviorContractDigest,
    evaluator_digest: evaluatorDigest }), semantic_evaluation: semanticEvaluation,
  semantic_digest: sha256Digest(semanticEvaluation) };
}
