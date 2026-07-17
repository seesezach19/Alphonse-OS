import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const EVIDENCE_SELECTION_POLICY_SCHEMA = "alphonse.evidence-selection-policy.v0.1";
export const DIAGNOSTIC_RETENTION_POLICY_SCHEMA = "alphonse.diagnostic-retention-policy.v0.1";
export const DIAGNOSTIC_EVIDENCE_EXPORT_KINDS = Object.freeze([
  "evidence_selection_policy",
  "diagnostic_retention_policy"
]);

const IDENTIFIER = /^[a-z][a-z0-9._:-]{2,199}$/;
const MAX_SECONDS = 31_536_000;
const PRETRIGGER_STAGES = Object.freeze([
  "behavior_evaluation",
  "correlation_projection",
  "diagnostic_trigger",
  "effect_interpretation"
]);
const POST_TRIGGER_STAGES = Object.freeze([
  "assignment_creation",
  "evidence_collection",
  "evidence_packaging"
]);
const REQUIRED_ROLES = Object.freeze([
  "designated_commit",
  "destination_request",
  "source_delivery",
  "terminal_runtime_execution"
]);
const REQUIRED_RELATIONSHIPS = Object.freeze([
  "delivery_reported_execution",
  "delivery_reported_request",
  "logical_operation_contains_delivery",
  "request_reported_ledger_claim"
]);
const ALLOWED_RELATIONSHIPS = Object.freeze([
  ...REQUIRED_RELATIONSHIPS,
  "delivery_identity_equals_request_key",
  "request_keys_are_distinct"
].sort());

function fail(message, details = {}, status = 400) {
  throw new KernelError(status, "DIAGNOSTIC_EVIDENCE_POLICY_INVALID", message, details);
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
  if (canonicalize(actual) !== canonicalize(expected)) {
    fail(`${path} fields must be exact.`, { path, expected, received: actual });
  }
  return value;
}

function identifier(value, path) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail(`${path} must be a neutral bounded identifier.`, { path });
  }
  return value;
}

function enumValue(value, path, allowed) {
  if (!allowed.includes(value)) fail(`${path} is unsupported.`, { path, allowed });
  return value;
}

function boundedSeconds(value, path) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SECONDS) {
    fail(`${path} must be a bounded non-negative integer number of seconds.`, { path });
  }
  return value;
}

function exactStrings(value, path, expected) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")
      || new Set(value).size !== value.length
      || canonicalize([...value].sort()) !== canonicalize([...expected].sort())) {
    fail(`${path} must contain the complete exact closed vocabulary.`, { path, expected });
  }
  return [...value].sort();
}

function stageIntervals(value, path, expectedStages) {
  if (!Array.isArray(value) || value.length !== expectedStages.length) {
    fail(`${path} must contain one interval for every required stage.`, { path, expected_stages: expectedStages });
  }
  const normalized = value.map((entry, index) => {
    exact(entry, `${path}[${index}]`, [
      "stage", "max_scheduling_delay_seconds", "max_retry_delay_seconds"
    ]);
    return {
      stage: identifier(entry.stage, `${path}[${index}].stage`),
      max_scheduling_delay_seconds: boundedSeconds(entry.max_scheduling_delay_seconds,
        `${path}[${index}].max_scheduling_delay_seconds`),
      max_retry_delay_seconds: boundedSeconds(entry.max_retry_delay_seconds,
        `${path}[${index}].max_retry_delay_seconds`)
    };
  }).sort((left, right) => left.stage < right.stage ? -1 : left.stage > right.stage ? 1 : 0);
  exactStrings(normalized.map((entry) => entry.stage), `${path}.stages`, expectedStages);
  return normalized;
}

function safeSum(values, path) {
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result) || result > MAX_SECONDS) {
    fail(`${path} exceeds the supported cumulative horizon.`, { path });
  }
  return result;
}

export function validateEvidenceSelectionPolicy(value) {
  exact(value, "evidence_selection_policy", [
    "schema_version", "policy_id", "seed", "required_roles", "required_relationships",
    "allowed_relationships", "coverage", "provenance", "detail", "optional_roles"
  ]);
  enumValue(value.schema_version, "evidence_selection_policy.schema_version",
    [EVIDENCE_SELECTION_POLICY_SCHEMA]);
  identifier(value.policy_id, "evidence_selection_policy.policy_id");
  enumValue(value.seed, "evidence_selection_policy.seed", ["matched_committed_effects"]);
  exactStrings(value.required_roles, "evidence_selection_policy.required_roles", REQUIRED_ROLES);
  exactStrings(value.required_relationships,
    "evidence_selection_policy.required_relationships", REQUIRED_RELATIONSHIPS);
  exactStrings(value.allowed_relationships,
    "evidence_selection_policy.allowed_relationships", ALLOWED_RELATIONSHIPS);
  exact(value.coverage, "evidence_selection_policy.coverage", [
    "require_contributing_streams_complete", "include_gaps", "include_conflicts",
    "include_rejections", "include_unresolved_relationships", "include_limitations"
  ]);
  for (const field of Object.keys(value.coverage)) {
    if (value.coverage[field] !== true) {
      fail(`evidence_selection_policy.coverage.${field} must be true for complete disclosure.`, { field });
    }
  }
  exact(value.provenance, "evidence_selection_policy.provenance", [
    "follow_tokenization_dependencies", "require_complete_proof_chain"
  ]);
  if (value.provenance.follow_tokenization_dependencies !== true
      || value.provenance.require_complete_proof_chain !== true) {
    fail("Evidence selection must follow complete authenticated tokenization provenance.");
  }
  exact(value.detail, "evidence_selection_policy.detail", ["allowed_media_types", "omission_reason"]);
  if (!Array.isArray(value.detail.allowed_media_types) || value.detail.allowed_media_types.length !== 0) {
    fail("The first evidence policy must not include opaque detail artifacts.");
  }
  enumValue(value.detail.omission_reason, "evidence_selection_policy.detail.omission_reason",
    ["policy_excludes_opaque_detail"]);
  exactStrings(value.optional_roles, "evidence_selection_policy.optional_roles", ["destination_snapshot"]);
  return structuredClone(value);
}

export function calculateRetentionRequirements(value) {
  const policy = validateDiagnosticRetentionPolicy(value, { calculateOnly: true });
  const pretriggerPipelineRetryHorizonSeconds = safeSum(policy.pretrigger_stage_intervals.flatMap((entry) =>
    [entry.max_scheduling_delay_seconds, entry.max_retry_delay_seconds]), "pretrigger_pipeline_retry_horizon");
  const postTriggerRetryHorizonSeconds = safeSum(policy.post_trigger_stage_intervals.flatMap((entry) =>
    [entry.max_scheduling_delay_seconds, entry.max_retry_delay_seconds]), "post_trigger_retry_horizon");
  return {
    pretrigger_observation_horizon_seconds: policy.pretrigger_observation_horizon_seconds,
    pretrigger_pipeline_retry_horizon_seconds: pretriggerPipelineRetryHorizonSeconds,
    ordinary_retention_min_seconds: safeSum([
      policy.pretrigger_observation_horizon_seconds,
      pretriggerPipelineRetryHorizonSeconds,
      policy.gc_margin_seconds
    ], "ordinary_retention_min"),
    collection_window_seconds: policy.collection_window_seconds,
    post_trigger_retry_horizon_seconds: postTriggerRetryHorizonSeconds,
    collection_lease_min_seconds: safeSum([
      policy.collection_window_seconds,
      postTriggerRetryHorizonSeconds,
      policy.gc_margin_seconds
    ], "collection_lease_min")
  };
}

export function validateDiagnosticRetentionPolicy(value, options = {}) {
  exact(value, "diagnostic_retention_policy", [
    "schema_version", "policy_id", "ordinary_retention_seconds", "collection_lease_seconds",
    "package_pin_seconds", "pretrigger_observation_horizon_seconds", "pretrigger_stage_intervals",
    "collection_window_seconds", "post_trigger_stage_intervals", "gc_margin_seconds"
  ]);
  enumValue(value.schema_version, "diagnostic_retention_policy.schema_version",
    [DIAGNOSTIC_RETENTION_POLICY_SCHEMA]);
  identifier(value.policy_id, "diagnostic_retention_policy.policy_id");
  for (const field of [
    "ordinary_retention_seconds", "collection_lease_seconds", "package_pin_seconds",
    "pretrigger_observation_horizon_seconds", "collection_window_seconds", "gc_margin_seconds"
  ]) boundedSeconds(value[field], `diagnostic_retention_policy.${field}`);
  if (value.collection_window_seconds === 0 || value.collection_lease_seconds === 0
      || value.ordinary_retention_seconds === 0 || value.package_pin_seconds === 0) {
    fail("Configured retention, collection, lease, and package-pin durations must be positive.");
  }
  const normalized = {
    ...structuredClone(value),
    pretrigger_stage_intervals: stageIntervals(value.pretrigger_stage_intervals,
      "diagnostic_retention_policy.pretrigger_stage_intervals", PRETRIGGER_STAGES),
    post_trigger_stage_intervals: stageIntervals(value.post_trigger_stage_intervals,
      "diagnostic_retention_policy.post_trigger_stage_intervals", POST_TRIGGER_STAGES)
  };
  if (options.calculateOnly) return normalized;
  const requirements = calculateRetentionRequirements(normalized);
  if (normalized.ordinary_retention_seconds < requirements.ordinary_retention_min_seconds
      || normalized.collection_lease_seconds < requirements.collection_lease_min_seconds) {
    fail("Configured retention does not cover the applicable cumulative critical path.", {
      configured_ordinary_retention_seconds: normalized.ordinary_retention_seconds,
      required_ordinary_retention_seconds: requirements.ordinary_retention_min_seconds,
      configured_collection_lease_seconds: normalized.collection_lease_seconds,
      required_collection_lease_seconds: requirements.collection_lease_min_seconds
    }, 409);
  }
  return normalized;
}

export function validateDiagnosticEvidenceExport(kind, content) {
  if (kind === "evidence_selection_policy") return validateEvidenceSelectionPolicy(content);
  if (kind === "diagnostic_retention_policy") return validateDiagnosticRetentionPolicy(content);
  fail("Diagnostic evidence export kind is unsupported.", { kind });
}

export function diagnosticEvidenceExportDigest(kind, content) {
  return sha256Digest({ kind, content: validateDiagnosticEvidenceExport(kind, content) });
}
