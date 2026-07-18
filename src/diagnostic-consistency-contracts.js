import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const DIAGNOSTIC_CONSISTENCY_POLICY_SCHEMA =
  "alphonse.diagnostic-consistency-test-policy.v0.1";
export const DIAGNOSTIC_CONSISTENCY_RUBRIC_SCHEMA =
  "alphonse.diagnostic-consistency-hidden-rubric.v0.1";
export const DIAGNOSTIC_CONSISTENCY_TEST_SCHEMA =
  "alphonse.diagnostic-consistency-test.v0.1";
export const DIAGNOSTIC_WORKER_RUN_CONFIGURATION_SCHEMA =
  "alphonse.diagnostic-worker-run-configuration.v0.1";
export const DIAGNOSTIC_CONSISTENCY_SCORE_SCHEMA =
  "alphonse.diagnostic-consistency-score.v0.1";
export const DIAGNOSTIC_CONSISTENCY_REPORT_SCHEMA =
  "alphonse.diagnostic-consistency-report.v0.1";

export const DIAGNOSTIC_CONSISTENCY_REQUIRED_CITATION_ROLES = Object.freeze([
  "behavior_contract",
  "correlation_projection",
  "destination_request",
  "interpreted_effect",
  "source_delivery"
]);

export const DIAGNOSTIC_CONSISTENCY_POLICY_V0_1 = Object.freeze({
  schema_version: DIAGNOSTIC_CONSISTENCY_POLICY_SCHEMA,
  policy_id: "diagnostic-consistency:canonical-three-run-v0.1",
  run_count: 3,
  required_pass_count: 3,
  package_binding: "one_exact_frozen_package",
  assignment_strategy: "three_fresh_independent_assignments",
  configuration_rule: "identical_digest_required_before_launch",
  scoring_rule: "score_each_immutable_diagnosis_independently",
  consensus_rewrite: "prohibited",
  authority: {
    assignment_creation: "three_authority_free_assignments_only",
    dispatch: "separate_kernel_authorization_required_per_assignment",
    model_requests: "one_per_separately_authorized_worker_run",
    repair: "none",
    external_business_effects: "none"
  }
});

export const DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_RULES = Object.freeze({
  schema_version: "alphonse.diagnostic-consistency-assignment-rules.v0.1",
  source_authority: "registered_exact_consistency_test_policy",
  assignment_ordinals: ["2", "3", "4"],
  initial_state: "unclaimed",
  authority_granted: "none",
  required_configuration_equivalence: "prelaunch_digest",
  hidden_rubric_disclosure: "prohibited"
});
export const DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_RULES_DIGEST =
  sha256Digest(DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_RULES);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9._:-]{2,199}$/;
const MECHANISMS = new Set([
  "identity_scope_mismatch", "workflow_configuration_error", "provider_behavior_change",
  "observation_gap", "competing_supported_mechanism", "unknown"
]);
const SCOPES = new Set([
  "logical_operation", "delivery", "workflow", "integration", "provider", "unknown"
]);
const SUPPORT = new Set([
  "BEST_SUPPORTED_HYPOTHESIS", "PLAUSIBLE", "NOT_ESTABLISHED", "CONTRADICTED"
]);
const IMPLEMENTATION_LOCATIONS = new Set(["proven", "not_proven", "ambiguous", "unknown"]);

function fail(message, details = {}) {
  throw new KernelError(400, "DIAGNOSTIC_CONSISTENCY_INPUT_INVALID", message, details);
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object.`, { path });
  }
  return value;
}

function exact(value, path, fields) {
  object(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (!same(actual, expected)) {
    fail(`${path} fields must be exact.`, { path, expected, received: actual });
  }
  return value;
}

function uuid(value, path) {
  if (typeof value !== "string" || !UUID.test(value)) fail(`${path} must be a UUID.`, { path });
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(`${path} must be a SHA-256 digest.`, { path });
  }
  return value;
}

function identifier(value, path) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail(`${path} must be a bounded identifier.`, { path });
  }
  return value;
}

export function validateDiagnosticConsistencyPolicy(value) {
  if (!same(value, DIAGNOSTIC_CONSISTENCY_POLICY_V0_1)) {
    fail("Consistency tests must use the exact closed three-run policy.");
  }
  return structuredClone(value);
}

export function validateDiagnosticConsistencyRubric(value, expectedPackage) {
  exact(value, "hidden_rubric", [
    "schema_version", "rubric_id", "artifact", "expected_package", "expected_diagnosis",
    "required_citation_roles", "scoring"
  ]);
  if (value.schema_version !== DIAGNOSTIC_CONSISTENCY_RUBRIC_SCHEMA) {
    fail("hidden_rubric.schema_version is unsupported.");
  }
  uuid(value.rubric_id, "hidden_rubric.rubric_id");
  exact(value.artifact, "hidden_rubric.artifact", ["artifact_id", "version"]);
  identifier(value.artifact.artifact_id, "hidden_rubric.artifact.artifact_id");
  identifier(value.artifact.version, "hidden_rubric.artifact.version");
  exact(value.expected_package, "hidden_rubric.expected_package", [
    "evidence_package_id", "semantic_digest", "artifact_digest"
  ]);
  uuid(value.expected_package.evidence_package_id,
    "hidden_rubric.expected_package.evidence_package_id");
  digest(value.expected_package.semantic_digest, "hidden_rubric.expected_package.semantic_digest");
  digest(value.expected_package.artifact_digest, "hidden_rubric.expected_package.artifact_digest");
  if (!same(value.expected_package, expectedPackage)) {
    fail("Hidden rubric must bind the exact frozen Evidence Package.");
  }
  exact(value.expected_diagnosis, "hidden_rubric.expected_diagnosis", [
    "mechanism", "observed_identity_scope", "required_identity_scope", "support",
    "identity_cardinality", "implementation_location"
  ]);
  if (!MECHANISMS.has(value.expected_diagnosis.mechanism)
      || !SCOPES.has(value.expected_diagnosis.observed_identity_scope)
      || !SCOPES.has(value.expected_diagnosis.required_identity_scope)
      || !SUPPORT.has(value.expected_diagnosis.support)) {
    fail("Hidden rubric expected diagnosis is outside the neutral closed taxonomy.");
  }
  exact(value.expected_diagnosis.identity_cardinality,
    "hidden_rubric.expected_diagnosis.identity_cardinality", ["deliveries", "logical_operations"]);
  for (const field of ["deliveries", "logical_operations"]) {
    const count = value.expected_diagnosis.identity_cardinality[field];
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
      fail(`hidden_rubric.expected_diagnosis.identity_cardinality.${field} is invalid.`);
    }
  }
  exact(value.expected_diagnosis.implementation_location,
    "hidden_rubric.expected_diagnosis.implementation_location", ["status", "component_id"]);
  if (!IMPLEMENTATION_LOCATIONS.has(value.expected_diagnosis.implementation_location.status)
      || value.expected_diagnosis.implementation_location.component_id !== null) {
    fail("Canonical hidden rubric must not assert an implementation component.");
  }
  if (!same(value.required_citation_roles, DIAGNOSTIC_CONSISTENCY_REQUIRED_CITATION_ROLES)) {
    fail("Hidden rubric must require the exact closed citation-role coverage.");
  }
  exact(value.scoring, "hidden_rubric.scoring", [
    "required_runs", "required_passes", "confidence_scale"
  ]);
  if (value.scoring.required_runs !== 3 || value.scoring.required_passes !== 3) {
    fail("Hidden rubric must require three of three independent diagnoses.");
  }
  exact(value.scoring.confidence_scale, "hidden_rubric.scoring.confidence_scale",
    ["low", "medium", "high"]);
  for (const score of Object.values(value.scoring.confidence_scale)) {
    if (!Number.isSafeInteger(score) || score < 0 || score > 100) {
      fail("Hidden rubric confidence scale must use bounded integer scores.");
    }
  }
  return structuredClone(value);
}

export function buildWorkerRunConfiguration({ assignmentDocument, workerRunDocument, inputDocument }) {
  const boundary = workerRunDocument.runtime_boundary;
  const { configuration_digest: ignoredModelDigest, ...model } = boundary.model;
  const { policy_digest: ignoredPolicyDigest, token_status: ignoredTokenStatus, ...broker } = boundary.broker;
  const document = {
    schema_version: DIAGNOSTIC_WORKER_RUN_CONFIGURATION_SCHEMA,
    evidence_package: {
      evidence_package_id: assignmentDocument.evidence_package.evidence_package_id,
      semantic_digest: assignmentDocument.evidence_package.semantic_digest,
      artifact_digest: assignmentDocument.evidence_package.package_artifact_digest
    },
    worker_contract: {
      instruction: structuredClone(inputDocument.assignment.instruction),
      instruction_digest: sha256Digest(inputDocument.assignment.instruction),
      output_schema: structuredClone(inputDocument.assignment.output_schema),
      output_schema_digest: sha256Digest(inputDocument.assignment.output_schema),
      required_capabilities: [...assignmentDocument.work_requirements.required_worker_capabilities].sort(),
      prohibitions: [...assignmentDocument.work_requirements.prohibitions].sort()
    },
    runtime: structuredClone(boundary.runtime),
    model: structuredClone(model),
    broker: structuredClone(broker),
    resources: structuredClone(boundary.resources),
    data_policy: structuredClone(boundary.data_policy),
    egress_policy: structuredClone(boundary.egress_policy),
    tools: "none"
  };
  const limitations = [];
  if (model.snapshot?.verification !== "provider_verified") {
    limitations.push("model_snapshot_not_provider_verified");
  }
  if (model.seed?.verification !== "provider_verified") {
    limitations.push("seed_not_provider_verified");
  }
  if (model.provider === "reference-provider") {
    limitations.push("synthetic_reference_provider_not_model_quality_evidence");
  }
  return {
    document,
    configuration_digest: sha256Digest(document),
    limitations: [...new Set(limitations)].sort()
  };
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function pairwise(values, metric) {
  const results = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      results.push({ left: left + 1, right: right + 1,
        value: rounded(metric(values[left], values[right])) });
    }
  }
  return results;
}

function jaccard(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / union.size;
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  let prior = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        prior[rightIndex] + 1,
        prior[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    prior = current;
  }
  return prior[right.length];
}

function summary(values) {
  return {
    minimum: rounded(Math.min(...values)),
    mean: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
    maximum: rounded(Math.max(...values))
  };
}

export function measureDiagnosticConsistency(scores, confidenceScale) {
  if (!Array.isArray(scores) || scores.length !== 3) {
    throw new Error("Diagnostic consistency metrics require exactly three scores.");
  }
  const confidence = scores.map((score) => confidenceScale[
    score.score_document.observed.confidence
  ]);
  const confidenceMean = confidence.reduce((sum, value) => sum + value, 0) / confidence.length;
  const confidenceVariance = confidence.reduce((sum, value) =>
    sum + (value - confidenceMean) ** 2, 0) / confidence.length;
  const evidencePairs = pairwise(scores.map((score) => score.score_document.metrics.citation_keys),
    jaccard);
  const investigationPairs = pairwise(scores.map((score) =>
    score.score_document.metrics.investigation_types), jaccard);
  const prosePairs = pairwise(scores.map((score) => score.score_document.metrics.causal_summary),
    (left, right) => {
      const maximum = Math.max(left.length, right.length);
      return maximum === 0 ? 0 : levenshtein(left, right) / maximum;
    });
  return {
    confidence: {
      scale: structuredClone(confidenceScale),
      values: confidence,
      mean: rounded(confidenceMean),
      population_variance: rounded(confidenceVariance)
    },
    evidence_selection_overlap: {
      measure: "pairwise_jaccard",
      pairs: evidencePairs,
      summary: summary(evidencePairs.map((entry) => entry.value))
    },
    unsupported_claim_count: {
      scope: "closed_structured_diagnostic_fields_only",
      per_run: scores.map((score) => score.score_document.metrics.unsupported_claim_count),
      total: scores.reduce((sum, score) =>
        sum + score.score_document.metrics.unsupported_claim_count, 0),
      limitation: "free_prose_is_not_semantically_reclassified_by_deterministic_software"
    },
    recommended_investigation_convergence: {
      measure: "pairwise_jaccard_by_closed_investigation_type",
      pairs: investigationPairs,
      summary: summary(investigationPairs.map((entry) => entry.value))
    },
    prose_divergence: {
      measure: "pairwise_normalized_character_edit_distance",
      pairs: prosePairs,
      summary: summary(prosePairs.map((entry) => entry.value)),
      semantic_equivalence_inferred: false
    }
  };
}
