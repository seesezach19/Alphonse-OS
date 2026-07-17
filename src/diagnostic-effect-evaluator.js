import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import { validateBehaviorContract, validateDiagnosticEvaluator } from "./diagnostic-effect-contracts.js";
import { DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA } from "./diagnostic-effect-projector.js";

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

function compareCanonical(left, right) {
  const leftBytes = canonicalize(left);
  const rightBytes = canonicalize(right);
  return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
}

export function evaluateCountByCorrelation({
  effectProjectionId,
  effectSemanticDigest,
  effectProjection,
  behaviorActivationId,
  behaviorContract,
  behaviorContractDigest,
  evaluatorActivationId,
  evaluator,
  evaluatorDigest,
  evaluatorArtifactDigest,
  evaluatorRulesDigest
}) {
  const contract = validateBehaviorContract(behaviorContract);
  const evaluatorDocument = validateDiagnosticEvaluator(evaluator);
  if (effectProjection?.schema_version !== DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA) {
    throw new TypeError(`effectProjection must be ${DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA}.`);
  }
  if (contract.workflow_id !== effectProjection.scope.workflow_id
      || contract.integration_id !== effectProjection.scope.integration_id) {
    throw new TypeError("Behavior Contract does not match the Diagnostic Effect Projection scope.");
  }
  const matched = effectProjection.effects.filter((effect) =>
    effect.effect_class === contract.selector.effect_class
    && effect.destination_id === contract.selector.destination_id
    && effect.operation === contract.selector.operation
    && effect.status === contract.selector.status
    && contract.selector.commitment_bases.includes(effect.commitment_basis)
    && effect.logical_operation_id === effectProjection.scope.logical_operation_id);
  const count = matched.length;
  const violated = contract.assertion.comparison === "less_than_or_equal"
    && count > contract.assertion.threshold;
  const result = violated ? "violated"
    : effectProjection.coverage.required_sources_complete ? "satisfied" : "indeterminate";
  const semanticEvaluation = {
    schema_version: BEHAVIOR_EVALUATION_SCHEMA,
    scope: structuredClone(effectProjection.scope),
    dependencies: {
      effect_projection_id: effectProjectionId,
      effect_semantic_digest: effectSemanticDigest,
      behavior_activation_id: behaviorActivationId,
      behavior_contract_digest: behaviorContractDigest,
      evaluator_activation_id: evaluatorActivationId,
      evaluator_digest: evaluatorDigest,
      evaluator_artifact_digest: evaluatorArtifactDigest,
      evaluator_rules_digest: evaluatorRulesDigest
    },
    evaluator: {
      evaluator_id: evaluatorDocument.evaluator_id,
      evaluator_version: evaluatorDocument.evaluator_version,
      operation: evaluatorDocument.operation,
      input_boundary: ["behavior_contract", "diagnostic_effect_projection", "diagnostic_evaluator"]
    },
    assertion: structuredClone(contract.assertion),
    measurement: {
      group_field: evaluatorDocument.group_field,
      group_value: effectProjection.scope.logical_operation_id,
      matched_effect_count: count,
      matched_effects: matched.map((effect) => ({
        effect_id: effect.effect_id,
        effect_digest: sha256Digest(effect)
      })).sort(compareCanonical)
    },
    coverage: {
      required_sources_complete: effectProjection.coverage.required_sources_complete,
      satisfaction_established: result === "satisfied",
      violation_established: result === "violated"
    },
    result,
    authority: {
      diagnostic_case_creation: result === "violated",
      diagnosis_established: false,
      repair_authorized: false,
      kernel_effect_authorized: false
    }
  };
  return {
    evaluation_id: deterministicUuid({
      namespace: "behavior-evaluation",
      effect_semantic_digest: effectSemanticDigest,
      behavior_contract_digest: behaviorContractDigest,
      evaluator_digest: evaluatorDigest
    }),
    semantic_evaluation: semanticEvaluation,
    semantic_digest: sha256Digest(semanticEvaluation)
  };
}
