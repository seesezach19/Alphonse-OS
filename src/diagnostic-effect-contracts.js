import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const INTEGRATION_BEHAVIOR_CONTRACT_SCHEMA =
  "alphonse.integration-behavior-contract.v0.1";
export const BEHAVIOR_CONTRACT_SCHEMA = "alphonse.behavior-contract.v0.1";
export const DIAGNOSTIC_EVALUATOR_SCHEMA = "alphonse.diagnostic-evaluator.v0.1";

export const DIAGNOSTIC_INTERPRETATION_EXPORT_KINDS = Object.freeze([
  "integration_behavior_contract",
  "behavior_contract",
  "diagnostic_evaluator"
]);

const IDENTIFIER = /^[a-z][a-z0-9._:-]{2,199}$/;
const FORBIDDEN_KEYS = new Set([
  "description",
  "defect_path",
  "expected_diagnosis",
  "filename",
  "fixture_id",
  "implementation_hint",
  "incident_id",
  "label",
  "metadata",
  "notes",
  "root_cause",
  "workflow_node"
]);
const FORBIDDEN_TEXT = [
  "delivery-scoped",
  "delivery scoped",
  "duplicate webhook",
  "expected diagnosis",
  "implementation location",
  "responsible node",
  "retry defect",
  "root cause",
  "scope mismatch"
];

function fail(message, details = {}) {
  throw new KernelError(400, "DIAGNOSTIC_INTERPRETATION_CONTRACT_INVALID", message, details);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object.`, { path });
  }
  return value;
}

function exact(value, path, keys) {
  object(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
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

function enumValue(value, path, values) {
  if (!values.includes(value)) fail(`${path} is unsupported.`, { path, allowed: values });
  return value;
}

function strings(value, path, allowed) {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length
      || value.some((item) => !allowed.includes(item))) {
    fail(`${path} must be a unique non-empty subset of its closed vocabulary.`, { path, allowed });
  }
  return [...value].sort();
}

function findLeakage(value, path = "content") {
  if (typeof value === "string") {
    const normalized = value.toLowerCase().replaceAll("-", " ").replaceAll("_", " ");
    const phrase = FORBIDDEN_TEXT.find((item) => normalized.includes(item));
    return phrase ? { path, phrase } : null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findLeakage(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) return { path: `${path}.${key}`, phrase: key };
    const found = findLeakage(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

export function validateIntegrationBehaviorContract(value) {
  exact(value, "integration_behavior_contract", [
    "schema_version", "contract_id", "integration_id", "destination_id", "idempotency",
    "commit_feed", "reconciliation"
  ]);
  enumValue(value.schema_version, "integration_behavior_contract.schema_version",
    [INTEGRATION_BEHAVIOR_CONTRACT_SCHEMA]);
  identifier(value.contract_id, "integration_behavior_contract.contract_id");
  identifier(value.integration_id, "integration_behavior_contract.integration_id");
  identifier(value.destination_id, "integration_behavior_contract.destination_id");
  exact(value.idempotency, "integration_behavior_contract.idempotency", [
    "key_location", "comparison", "matching_key_behavior"
  ]);
  enumValue(value.idempotency.key_location, "integration_behavior_contract.idempotency.key_location",
    ["request.header.idempotency-key"]);
  enumValue(value.idempotency.comparison, "integration_behavior_contract.idempotency.comparison",
    ["exact_string"]);
  enumValue(value.idempotency.matching_key_behavior,
    "integration_behavior_contract.idempotency.matching_key_behavior",
    ["return_existing_result_without_new_commit"]);
  exact(value.commit_feed, "integration_behavior_contract.commit_feed", [
    "feed_id", "feed_kind", "feed_identity_claim", "event_identity_claim", "resource_identity_claim",
    "request_identity_claim", "operation_claim", "committed_at_claim", "external_claim_field",
    "commit_record_semantics", "consistency"
  ]);
  identifier(value.commit_feed.feed_id, "integration_behavior_contract.commit_feed.feed_id");
  enumValue(value.commit_feed.feed_kind, "integration_behavior_contract.commit_feed.feed_kind",
    ["append_only_ledger"]);
  for (const field of ["feed_identity_claim", "event_identity_claim", "resource_identity_claim", "request_identity_claim",
    "operation_claim", "committed_at_claim", "external_claim_field"]) {
    identifier(value.commit_feed[field], `integration_behavior_contract.commit_feed.${field}`);
  }
  enumValue(value.commit_feed.commit_record_semantics,
    "integration_behavior_contract.commit_feed.commit_record_semantics",
    ["record_means_resource_operation_committed"]);
  enumValue(value.commit_feed.consistency, "integration_behavior_contract.commit_feed.consistency",
    ["append_visible_after_commit"]);
  exact(value.reconciliation, "integration_behavior_contract.reconciliation", ["strategy", "unresolved_outcome"]);
  enumValue(value.reconciliation.strategy, "integration_behavior_contract.reconciliation.strategy",
    ["query_by_request_identity"]);
  enumValue(value.reconciliation.unresolved_outcome,
    "integration_behavior_contract.reconciliation.unresolved_outcome", ["ambiguous"]);
  const leakage = findLeakage(value);
  if (leakage) fail("Integration Behavior Contract contains prohibited incident-answer material.", leakage);
  return structuredClone(value);
}

export function validateBehaviorContract(value) {
  exact(value, "behavior_contract", [
    "schema_version", "contract_id", "workflow_id", "integration_id", "correlation_role",
    "selector", "assertion"
  ]);
  enumValue(value.schema_version, "behavior_contract.schema_version", [BEHAVIOR_CONTRACT_SCHEMA]);
  for (const field of ["contract_id", "workflow_id", "integration_id", "correlation_role"]) {
    identifier(value[field], `behavior_contract.${field}`);
  }
  enumValue(value.correlation_role, "behavior_contract.correlation_role", ["logical_operation_id"]);
  exact(value.selector, "behavior_contract.selector", [
    "effect_class", "destination_id", "operation", "status", "commitment_bases"
  ]);
  enumValue(value.selector.effect_class, "behavior_contract.selector.effect_class",
    ["diagnostic_derived_external_effect"]);
  identifier(value.selector.destination_id, "behavior_contract.selector.destination_id");
  identifier(value.selector.operation, "behavior_contract.selector.operation");
  enumValue(value.selector.status, "behavior_contract.selector.status", ["committed"]);
  strings(value.selector.commitment_bases,
    "behavior_contract.selector.commitment_bases", ["designated_append_only_commit_record"]);
  exact(value.assertion, "behavior_contract.assertion", ["comparison", "threshold"]);
  enumValue(value.assertion.comparison, "behavior_contract.assertion.comparison", ["less_than_or_equal"]);
  if (!Number.isSafeInteger(value.assertion.threshold) || value.assertion.threshold < 0
      || value.assertion.threshold > 1000) {
    fail("behavior_contract.assertion.threshold must be a bounded non-negative integer.", {
      path: "behavior_contract.assertion.threshold"
    });
  }
  const leakage = findLeakage(value);
  if (leakage) fail("Behavior Contract contains prohibited incident-answer material.", leakage);
  return structuredClone(value);
}

export function validateDiagnosticEvaluator(value) {
  exact(value, "diagnostic_evaluator", [
    "schema_version", "evaluator_id", "evaluator_version", "operation", "input_schema_version",
    "group_field", "output_states"
  ]);
  enumValue(value.schema_version, "diagnostic_evaluator.schema_version", [DIAGNOSTIC_EVALUATOR_SCHEMA]);
  identifier(value.evaluator_id, "diagnostic_evaluator.evaluator_id");
  enumValue(value.evaluator_id, "diagnostic_evaluator.evaluator_id", ["alphonse.count-by-correlation"]);
  enumValue(value.evaluator_version, "diagnostic_evaluator.evaluator_version", ["0.1.0"]);
  enumValue(value.operation, "diagnostic_evaluator.operation", ["count_by_correlation"]);
  enumValue(value.input_schema_version, "diagnostic_evaluator.input_schema_version",
    ["alphonse.diagnostic-effect-projection.v0.1"]);
  enumValue(value.group_field, "diagnostic_evaluator.group_field", ["logical_operation_id"]);
  const outputStates = strings(value.output_states, "diagnostic_evaluator.output_states",
    ["indeterminate", "satisfied", "violated"]);
  if (canonicalize(outputStates) !== canonicalize(["indeterminate", "satisfied", "violated"])) {
    fail("diagnostic_evaluator.output_states must declare the complete closed result set.", {
      path: "diagnostic_evaluator.output_states"
    });
  }
  const leakage = findLeakage(value);
  if (leakage) fail("Diagnostic Evaluator contains prohibited incident-answer material.", leakage);
  return structuredClone(value);
}

export function validateDiagnosticInterpretationExport(kind, content) {
  if (kind === "integration_behavior_contract") return validateIntegrationBehaviorContract(content);
  if (kind === "behavior_contract") return validateBehaviorContract(content);
  if (kind === "diagnostic_evaluator") return validateDiagnosticEvaluator(content);
  fail("Diagnostic interpretation export kind is unsupported.", { kind });
}

export function diagnosticInterpretationExportDigest(kind, content) {
  return sha256Digest({ kind, content: validateDiagnosticInterpretationExport(kind, content) });
}
