import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const DIAGNOSTIC_EVIDENCE_MATERIAL_SCHEMA =
  "alphonse.diagnostic-evidence-package-material.v0.1";
export const DIAGNOSTIC_EVIDENCE_REVISION_ASSESSMENT_SCHEMA =
  "alphonse.diagnostic-evidence-revision-assessment.v0.1";
export const DIAGNOSTIC_REEVALUATION_NOTICE_SCHEMA =
  "alphonse.diagnostic-reevaluation-available.v0.1";

export const DIAGNOSTIC_EVIDENCE_MATERIAL_CHANGE_CLASSES = Object.freeze([
  "behavior_evaluation_changed",
  "contradiction_added",
  "contradiction_resolved",
  "contributing_coverage_changed",
  "governed_reinterpretation_requested",
  "required_relationship_became_unresolved",
  "required_relationship_resolved",
  "required_role_connected",
  "required_role_disconnected",
  "selected_evidence_changed"
]);

export const DIAGNOSTIC_EVIDENCE_REVISION_RULES = Object.freeze({
  schema_version: "alphonse.diagnostic-evidence-revision-rules.v0.1",
  comparison_identity: "package_material_digest",
  assessment_order: "committed_intake_cutoff_then_case_lock",
  default_action: "notify_only",
  behavior_change_basis: "evaluator_assertion_group_count_and_result",
  ordinary_activation_behavior: "reuse_exact_case_pinned_activations",
  contract_change_behavior: "explicit_governed_reinterpretation_only",
  claimed_assignment_behavior: "notification_only",
  nondeterminism_definition:
    "same_predecessor_cutoff_activations_rules_and_verified_inputs_produced_different_assessment",
  material_change_classes: DIAGNOSTIC_EVIDENCE_MATERIAL_CHANGE_CLASSES
});
export const DIAGNOSTIC_EVIDENCE_REVISION_RULES_DIGEST =
  sha256Digest(DIAGNOSTIC_EVIDENCE_REVISION_RULES);

export function assertEvidenceRevisionStageIdentity(activation, {
  artifactDigest,
  artifactManifest,
  selectionRulesDigest
}) {
  if (activation?.stage_artifact_digest !== artifactDigest
      || canonicalize(activation?.stage_artifact_manifest) !== canonicalize(artifactManifest)
      || activation?.selection_rules_digest !== selectionRulesDigest) {
    throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_MISMATCH",
      "Case-pinned evidence policy differs from the running deterministic evidence stage.");
  }
  return activation;
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function sorted(value) {
  return [...value].sort((left, right) => {
    const leftBytes = canonicalize(left);
    const rightBytes = canonicalize(right);
    return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
  });
}

function withoutEffectIdentity(effect) {
  const copy = structuredClone(effect);
  delete copy.effect_id;
  return copy;
}

function normalizedEvaluation(evaluation, originalEffects) {
  const normalizedDigestById = new Map(originalEffects.map((effect) => [
    effect.effect_id, sha256Digest(withoutEffectIdentity(effect))
  ]));
  const matched = evaluation.measurement.matched_effects.map((entry) =>
    normalizedDigestById.get(entry.effect_id) ?? entry.effect_digest).sort();
  return {
    evaluator: structuredClone(evaluation.evaluator),
    assertion: structuredClone(evaluation.assertion),
    measurement: {
      group_field: evaluation.measurement.group_field,
      group_value: evaluation.measurement.group_value,
      matched_effect_count: evaluation.measurement.matched_effect_count,
      matched_material_digests: matched
    },
    coverage: structuredClone(evaluation.coverage),
    result: evaluation.result
  };
}

export function buildEvidencePackageMaterial({
  scope,
  governedDependencies,
  selection,
  effectProjection,
  evaluation,
  caseClaims = []
}) {
  const normalizedEffects = sorted(effectProjection.effects.map(withoutEffectIdentity));
  const document = {
    schema_version: DIAGNOSTIC_EVIDENCE_MATERIAL_SCHEMA,
    scope: structuredClone(scope),
    governed_dependencies: sorted(governedDependencies),
    authenticated_evidence: {
      observations: sorted(selection.selected_observations),
      provenance_dependencies: sorted(selection.authenticated_provenance_dependencies)
    },
    selected_graph: {
      nodes: sorted(selection.selected_nodes),
      edges: sorted(selection.selected_edges)
    },
    coverage_and_limitations: structuredClone(selection.coverage_and_limitations),
    role_completion: structuredClone(selection.role_completion),
    disclosure_accounting: structuredClone(selection.disclosure_accounting),
    deterministic_interpretation: {
      effects: normalizedEffects,
      behavior_evaluation: normalizedEvaluation(evaluation, effectProjection.effects),
      case_claims: sorted(caseClaims.map((claim) => ({
        claim_id: claim.claim_id,
        claim_digest: claim.claim_digest,
        claim_type: claim.claim_type,
        effective_support: claim.effective_support
      })))
    }
  };
  return { document, digest: sha256Digest(document) };
}

function canonicalSet(value) {
  return new Set(value.map((entry) => canonicalize(entry)));
}

function setAdded(left, right) {
  const before = canonicalSet(left);
  return right.some((entry) => !before.has(canonicalize(entry)));
}

function setRemoved(left, right) {
  const after = canonicalSet(right);
  return left.some((entry) => !after.has(canonicalize(entry)));
}

function missingRoleKeys(material) {
  return material.role_completion.missing_roles.map((entry) => canonicalize(entry));
}

function behaviorDecisionMaterial(material) {
  const evaluation = material.deterministic_interpretation.behavior_evaluation;
  return {
    evaluator: evaluation.evaluator,
    assertion: evaluation.assertion,
    measurement: {
      group_field: evaluation.measurement.group_field,
      group_value: evaluation.measurement.group_value,
      matched_effect_count: evaluation.measurement.matched_effect_count
    },
    result: evaluation.result
  };
}

export function classifyEvidenceMaterialChange(previous, candidate, {
  governedReinterpretation = false
} = {}) {
  if (previous?.schema_version !== DIAGNOSTIC_EVIDENCE_MATERIAL_SCHEMA
      || candidate?.schema_version !== DIAGNOSTIC_EVIDENCE_MATERIAL_SCHEMA) {
    throw new KernelError(500, "DIAGNOSTIC_EVIDENCE_MATERIAL_SCHEMA_MISMATCH",
      "Evidence revision comparison requires exact package-material documents.");
  }
  if (same(previous, candidate)) return [];
  const changes = new Set();
  if (!same(previous.governed_dependencies, candidate.governed_dependencies)) {
    if (!governedReinterpretation) {
      throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_REVISION_ACTIVATION_DRIFT",
        "Ordinary late evidence cannot substitute different governed interpretation material.");
    }
    changes.add("governed_reinterpretation_requested");
  }
  if (!same(previous.authenticated_evidence, candidate.authenticated_evidence)
      || !same(previous.selected_graph, candidate.selected_graph)
      || !same(previous.disclosure_accounting, candidate.disclosure_accounting)
      || !same(previous.deterministic_interpretation.effects,
        candidate.deterministic_interpretation.effects)) {
    changes.add("selected_evidence_changed");
  }
  const previousMissing = missingRoleKeys(previous);
  const candidateMissing = missingRoleKeys(candidate);
  if (setRemoved(previousMissing, candidateMissing)) changes.add("required_role_connected");
  if (setAdded(previousMissing, candidateMissing)) changes.add("required_role_disconnected");
  const previousContradictions = previous.coverage_and_limitations.contradictions;
  const candidateContradictions = candidate.coverage_and_limitations.contradictions;
  if (setAdded(previousContradictions, candidateContradictions)) changes.add("contradiction_added");
  if (setRemoved(previousContradictions, candidateContradictions)) changes.add("contradiction_resolved");
  const previousUnresolved = previous.coverage_and_limitations.unresolved_relationships;
  const candidateUnresolved = candidate.coverage_and_limitations.unresolved_relationships;
  if (setRemoved(previousUnresolved, candidateUnresolved)) changes.add("required_relationship_resolved");
  if (setAdded(previousUnresolved, candidateUnresolved)) {
    changes.add("required_relationship_became_unresolved");
  }
  if (!same({
    streams: previous.coverage_and_limitations.streams,
    gaps: previous.coverage_and_limitations.gaps,
    conflicts: previous.coverage_and_limitations.conflicts,
    rejections: previous.coverage_and_limitations.rejections,
    limitations: previous.coverage_and_limitations.limitations
  }, {
    streams: candidate.coverage_and_limitations.streams,
    gaps: candidate.coverage_and_limitations.gaps,
    conflicts: candidate.coverage_and_limitations.conflicts,
    rejections: candidate.coverage_and_limitations.rejections,
    limitations: candidate.coverage_and_limitations.limitations
  })) changes.add("contributing_coverage_changed");
  if (!same(behaviorDecisionMaterial(previous), behaviorDecisionMaterial(candidate))) {
    changes.add("behavior_evaluation_changed");
  }
  if (!changes.size) {
    throw new KernelError(500, "DIAGNOSTIC_EVIDENCE_MATERIAL_CHANGE_UNCLASSIFIED",
      "Package material changed without an exact closed material-change classification.");
  }
  return [...changes].sort();
}

export function decideInitialAssignmentHandoff({
  assignmentPolicyActivationId,
  frozenTransitions,
  stageRecord,
  affectedAssignments
}) {
  if (!assignmentPolicyActivationId) return { ready: true, status: "not_assignment_eligible" };
  if (!Array.isArray(frozenTransitions) || frozenTransitions.length !== 1) {
    throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_HANDOFF_INTEGRITY_VIOLATION",
      "An assignment-eligible case must have one exact frozen-package source transition.");
  }
  const frozen = frozenTransitions[0];
  if (frozen.payload?.assignment_policy_activation_id !== assignmentPolicyActivationId) {
    throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_HANDOFF_INTEGRITY_VIOLATION",
      "Frozen-package assignment intent does not bind the case-pinned Assignment Policy.");
  }
  if (!stageRecord) {
    return {
      ready: false,
      status: "awaiting_initial_assignment_handoff",
      source_transition_id: frozen.transition_id
    };
  }
  if (stageRecord.source_transition_id !== frozen.transition_id) {
    throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_HANDOFF_INTEGRITY_VIOLATION",
      "Initial Assignment stage outcome does not bind the frozen-package source transition.");
  }
  if (stageRecord.outcome === "terminal_failure") {
    return { ready: true, status: "initial_assignment_terminal_failure" };
  }
  if (stageRecord.outcome !== "assignment_created" || !stageRecord.assignment_id
      || !affectedAssignments.some((entry) => entry.assignment_id === stageRecord.assignment_id)) {
    throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_HANDOFF_INTEGRITY_VIOLATION",
      "Initial Assignment stage outcome does not resolve to its immutable case assignment.");
  }
  return { ready: true, status: "initial_assignment_created" };
}
