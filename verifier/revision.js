import { canonicalize, compareCanonical, sha256Digest } from "./canonical.js";

export const MATERIAL_SCHEMA = "alphonse.diagnostic-evidence-package-material.v0.1";
export const REVISION_RULES = Object.freeze({
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
  material_change_classes: [
    "behavior_evaluation_changed", "contradiction_added", "contradiction_resolved",
    "contributing_coverage_changed", "governed_reinterpretation_requested",
    "required_relationship_became_unresolved", "required_relationship_resolved",
    "required_role_connected", "required_role_disconnected", "selected_evidence_changed"
  ]
});
export const REVISION_RULES_DIGEST = sha256Digest(REVISION_RULES);

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function withoutEffectIdentity(effect) {
  const copy = structuredClone(effect);
  delete copy.effect_id;
  return copy;
}

export function buildEvidencePackageMaterial({ scope, governedDependencies, selection,
  effectProjection, evaluation, caseClaims }) {
  const effects = effectProjection.effects.map(withoutEffectIdentity).sort(compareCanonical);
  const digestById = new Map(effectProjection.effects.map((effect) =>
    [effect.effect_id, sha256Digest(withoutEffectIdentity(effect))]));
  const document = {
    schema_version: MATERIAL_SCHEMA,
    scope: structuredClone(scope),
    governed_dependencies: [...governedDependencies].sort(compareCanonical),
    authenticated_evidence: {
      observations: [...selection.selected_observations].sort(compareCanonical),
      provenance_dependencies: [...selection.authenticated_provenance_dependencies].sort(compareCanonical)
    },
    selected_graph: { nodes: [...selection.selected_nodes].sort(compareCanonical),
      edges: [...selection.selected_edges].sort(compareCanonical) },
    coverage_and_limitations: structuredClone(selection.coverage_and_limitations),
    role_completion: structuredClone(selection.role_completion),
    disclosure_accounting: structuredClone(selection.disclosure_accounting),
    deterministic_interpretation: {
      effects,
      behavior_evaluation: {
        evaluator: structuredClone(evaluation.evaluator),
        assertion: structuredClone(evaluation.assertion),
        measurement: { group_field: evaluation.measurement.group_field,
          group_value: evaluation.measurement.group_value,
          matched_effect_count: evaluation.measurement.matched_effect_count,
          matched_material_digests: evaluation.measurement.matched_effects.map((entry) =>
            digestById.get(entry.effect_id) ?? entry.effect_digest).sort() },
        coverage: structuredClone(evaluation.coverage), result: evaluation.result
      },
      case_claims: caseClaims.map((claim) => ({ claim_id: claim.claim_id,
        claim_digest: claim.claim_digest, claim_type: claim.claim_type,
        effective_support: claim.effective_support })).sort(compareCanonical)
    }
  };
  return { document, digest: sha256Digest(document) };
}

function set(value) { return new Set(value.map((entry) => canonicalize(entry))); }
function added(left, right) { const before = set(left); return right.some((entry) => !before.has(canonicalize(entry))); }
function removed(left, right) { const after = set(right); return left.some((entry) => !after.has(canonicalize(entry))); }
function behaviorDecisionMaterial(material) {
  const evaluation = material.deterministic_interpretation.behavior_evaluation;
  return { evaluator: evaluation.evaluator, assertion: evaluation.assertion,
    measurement: { group_field: evaluation.measurement.group_field,
      group_value: evaluation.measurement.group_value,
      matched_effect_count: evaluation.measurement.matched_effect_count },
    result: evaluation.result };
}

export function classifyEvidenceMaterialChange(previous, candidate) {
  if (same(previous, candidate)) return [];
  if (!same(previous.governed_dependencies, candidate.governed_dependencies)) {
    throw new Error("VERIFIER_EVIDENCE_REVISION_ACTIVATION_DRIFT");
  }
  const changes = new Set();
  if (!same(previous.authenticated_evidence, candidate.authenticated_evidence)
      || !same(previous.selected_graph, candidate.selected_graph)
      || !same(previous.disclosure_accounting, candidate.disclosure_accounting)
      || !same(previous.deterministic_interpretation.effects,
        candidate.deterministic_interpretation.effects)) changes.add("selected_evidence_changed");
  const beforeMissing = previous.role_completion.missing_roles;
  const afterMissing = candidate.role_completion.missing_roles;
  if (removed(beforeMissing, afterMissing)) changes.add("required_role_connected");
  if (added(beforeMissing, afterMissing)) changes.add("required_role_disconnected");
  const beforeContradictions = previous.coverage_and_limitations.contradictions;
  const afterContradictions = candidate.coverage_and_limitations.contradictions;
  if (added(beforeContradictions, afterContradictions)) changes.add("contradiction_added");
  if (removed(beforeContradictions, afterContradictions)) changes.add("contradiction_resolved");
  const beforeUnresolved = previous.coverage_and_limitations.unresolved_relationships;
  const afterUnresolved = candidate.coverage_and_limitations.unresolved_relationships;
  if (removed(beforeUnresolved, afterUnresolved)) changes.add("required_relationship_resolved");
  if (added(beforeUnresolved, afterUnresolved)) changes.add("required_relationship_became_unresolved");
  const coverage = (value) => ({ streams: value.coverage_and_limitations.streams,
    gaps: value.coverage_and_limitations.gaps, conflicts: value.coverage_and_limitations.conflicts,
    rejections: value.coverage_and_limitations.rejections, limitations: value.coverage_and_limitations.limitations });
  if (!same(coverage(previous), coverage(candidate))) changes.add("contributing_coverage_changed");
  if (!same(behaviorDecisionMaterial(previous), behaviorDecisionMaterial(candidate))) {
    changes.add("behavior_evaluation_changed");
  }
  if (!changes.size) throw new Error("VERIFIER_EVIDENCE_MATERIAL_CHANGE_UNCLASSIFIED");
  return [...changes].sort();
}

export function resolveLateEvidenceAssignmentAction(policy, materialChangeClasses,
  knownAffectedAssignments) {
  if (!policy) return "notify_only";
  if (policy.schema_version === "alphonse.diagnostic-assignment-policy.v0.1") return "notify_only";
  if (policy.schema_version !== "alphonse.diagnostic-assignment-policy.v0.2"
      || canonicalize(Object.keys(policy.late_evidence ?? {}).sort()) !== canonicalize([
        "claimed_assignment_action", "default_action", "material_change_actions"
      ].sort())
      || policy.late_evidence.default_action !== "notify_only"
      || policy.late_evidence.claimed_assignment_action !== "notify_only"
      || !Array.isArray(policy.late_evidence.material_change_actions)) {
    throw new Error("VERIFIER_ASSIGNMENT_LATE_EVIDENCE_POLICY_INVALID");
  }
  const allowed = new Set(REVISION_RULES.material_change_classes);
  const actions = new Map();
  for (const entry of policy.late_evidence.material_change_actions) {
    if (canonicalize(Object.keys(entry ?? {}).sort()) !== canonicalize([
      "action", "material_change_class"
    ]) || !allowed.has(entry.material_change_class)
        || !["notify_only", "replace_unclaimed"].includes(entry.action)
        || actions.has(entry.material_change_class)) {
      throw new Error("VERIFIER_ASSIGNMENT_LATE_EVIDENCE_POLICY_INVALID");
    }
    actions.set(entry.material_change_class, entry.action);
  }
  if (!knownAffectedAssignments.some((entry) => entry.state === "unclaimed")) return "notify_only";
  return materialChangeClasses.some((entry) => actions.get(entry) === "replace_unclaimed")
    ? "replace_unclaimed" : policy.late_evidence.default_action;
}
