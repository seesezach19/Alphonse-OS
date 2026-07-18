import { canonicalize, sha256Digest } from "./canonical-json.js";
import { DIAGNOSTIC_EVIDENCE_MATERIAL_CHANGE_CLASSES } from "./diagnostic-evidence-revision.js";
import { KernelError } from "./errors.js";

export const DIAGNOSTIC_ASSIGNMENT_POLICY_SCHEMA_V0_1 = "alphonse.diagnostic-assignment-policy.v0.1";
export const DIAGNOSTIC_ASSIGNMENT_POLICY_SCHEMA = "alphonse.diagnostic-assignment-policy.v0.2";
export const DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_SCHEMA =
  "alphonse.diagnostic-assignment-policy-activation.v0.1";
export const DIAGNOSTIC_ASSIGNMENT_STAGE_INPUT_SCHEMA =
  "alphonse.diagnostic-assignment-stage-input.v0.1";
export const DIAGNOSTIC_ASSIGNMENT_SCHEMA = "alphonse.diagnostic-assignment.v0.1";
export const DIAGNOSTIC_ASSIGNMENT_RECORD_SCHEMA = "alphonse.diagnostic-assignment-record.v0.1";
export const DIAGNOSTIC_ASSIGNMENT_STAGE_RECORD_SCHEMA =
  "alphonse.diagnostic-assignment-stage-record.v0.1";
export const DIAGNOSTIC_ASSIGNMENT_EXPORT_KINDS = Object.freeze(["diagnostic_assignment_policy"]);

const IDENTIFIER = /^[a-z][a-z0-9._:-]{2,199}$/;
const MAX_TTL_SECONDS = 604_800;

export const DIAGNOSTIC_WORKER_INSTRUCTION_V0_1 = Object.freeze({
  schema_version: "alphonse.diagnostic-worker-instruction.v0.1",
  task: "analyze_assigned_frozen_evidence_package",
  evidence_boundary: "assigned_package_only",
  conclusion_policy: "best_supported_hypothesis_with_alternatives_and_falsifiers",
  uncertainty_policy: "preserve_not_established_and_contradicted_material",
  authority_policy: "diagnostic_interpretation_and_proposal_only"
});

export const DIAGNOSTIC_WORKER_OUTPUT_SCHEMA_V0_1 = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "alphonse.diagnostic-worker-output.v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "best_supported_hypothesis", "supporting_claims", "counterevidence", "alternatives",
    "not_established", "falsifiers", "next_best_observation"
  ],
  properties: {
    best_supported_hypothesis: {
      type: "object",
      additionalProperties: false,
      required: ["mechanism", "scope", "support", "confidence"],
      properties: {
        mechanism: { type: "string", enum: [
          "identity_scope_mismatch", "workflow_configuration_error", "provider_behavior_change",
          "observation_gap", "competing_supported_mechanism", "unknown"
        ] },
        scope: { type: "string", enum: [
          "logical_operation", "delivery", "workflow", "integration", "provider", "unknown"
        ] },
        support: { type: "string", enum: [
          "BEST_SUPPORTED_HYPOTHESIS", "PLAUSIBLE", "NOT_ESTABLISHED", "CONTRADICTED"
        ] },
        confidence: { type: "string", enum: ["high", "medium", "low"] }
      }
    },
    supporting_claims: { type: "array", items: { type: "string" }, uniqueItems: true },
    counterevidence: { type: "array", items: { type: "string" }, uniqueItems: true },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hypothesis", "status", "reason"],
        properties: {
          hypothesis: { type: "string" },
          status: { type: "string", enum: ["supported", "weakened", "unresolved", "contradicted"] },
          reason: { type: "string" }
        }
      }
    },
    not_established: { type: "array", items: { type: "string" }, uniqueItems: true },
    falsifiers: { type: "array", items: { type: "string" }, uniqueItems: true },
    next_best_observation: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["type", "purpose"],
      properties: { type: { type: "string" }, purpose: { type: "string" } }
    }
  }
});

export const DIAGNOSTIC_ASSIGNMENT_RULES = Object.freeze({
  schema_version: "alphonse.diagnostic-assignment-rules.v0.1",
  identity_namespace: "diagnostic-assignment",
  series_identity_namespace: "diagnostic-assignment-series",
  initial_ordinal: "1",
  initial_state: "unclaimed",
  authority_granted: "none",
  granted_capabilities: [],
  source_authority: "immutable_diagnostic_transition",
  semantic_time_source: "source_transition_occurred_at",
  nondeterminism_definition:
    "same_verified_input_stage_rules_and_schema_produced_different_semantic_assignment"
});
export const DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST = sha256Digest(DIAGNOSTIC_ASSIGNMENT_RULES);

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function fail(message, details = {}) {
  throw new KernelError(400, "DIAGNOSTIC_ASSIGNMENT_POLICY_INVALID", message, details);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object.`, { path });
  return value;
}

function exact(value, path, fields) {
  object(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (!same(actual, expected)) fail(`${path} fields must be exact.`, { path, expected, received: actual });
  return value;
}

function exactStrings(value, path, expected) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")
      || new Set(value).size !== value.length
      || !same([...value].sort(), [...expected].sort())) {
    fail(`${path} must contain the exact closed vocabulary.`, { path, expected });
  }
  return [...value].sort();
}

export function validateDiagnosticAssignmentPolicy(value) {
  const baseFields = [
    "schema_version", "policy_id", "instruction", "output_schema", "required_passport_class",
    "required_worker_capabilities", "prohibitions", "model_requirements", "runtime_requirements",
    "isolation", "mounts", "network", "resources", "assignment_ttl_seconds",
    "data_classification", "disclosure"
  ];
  const versionedFields = value?.schema_version === DIAGNOSTIC_ASSIGNMENT_POLICY_SCHEMA
    ? [...baseFields, "late_evidence"] : baseFields;
  exact(value, "diagnostic_assignment_policy", versionedFields);
  if (![DIAGNOSTIC_ASSIGNMENT_POLICY_SCHEMA_V0_1,
    DIAGNOSTIC_ASSIGNMENT_POLICY_SCHEMA].includes(value.schema_version)) {
    fail("diagnostic_assignment_policy.schema_version is unsupported.");
  }
  if (typeof value.policy_id !== "string" || !IDENTIFIER.test(value.policy_id)) {
    fail("diagnostic_assignment_policy.policy_id must be a neutral bounded identifier.");
  }
  if (!same(value.instruction, DIAGNOSTIC_WORKER_INSTRUCTION_V0_1)) {
    fail("diagnostic_assignment_policy.instruction must use the answer-free v0.1 instruction contract.");
  }
  if (!same(value.output_schema, DIAGNOSTIC_WORKER_OUTPUT_SCHEMA_V0_1)) {
    fail("diagnostic_assignment_policy.output_schema must use the complete neutral v0.1 output contract.");
  }
  if (value.required_passport_class !== "diagnostic_interpreter") {
    fail("diagnostic_assignment_policy.required_passport_class is unsupported.");
  }
  exactStrings(value.required_worker_capabilities,
    "diagnostic_assignment_policy.required_worker_capabilities",
    ["read_exact_evidence_package", "produce_schema_validated_diagnostic_output"]);
  exactStrings(value.prohibitions, "diagnostic_assignment_policy.prohibitions", [
    "credential_access", "evidence_outside_assigned_package", "external_effect",
    "kernel_authority", "repair_execution", "unbrokered_model_access"
  ]);
  exact(value.model_requirements, "diagnostic_assignment_policy.model_requirements",
    ["selection", "capability_class", "access_delivery"]);
  if (value.model_requirements.selection !== "dispatch_time_exact_match"
      || value.model_requirements.capability_class !== "diagnostic_reasoning"
      || value.model_requirements.access_delivery !== "broker_after_claim_only") {
    fail("diagnostic_assignment_policy.model_requirements are unsupported.");
  }
  exact(value.runtime_requirements, "diagnostic_assignment_policy.runtime_requirements",
    ["kind", "image_selection"]);
  if (value.runtime_requirements.kind !== "isolated_diagnostic_worker"
      || value.runtime_requirements.image_selection !== "dispatch_time_exact_match") {
    fail("diagnostic_assignment_policy.runtime_requirements are unsupported.");
  }
  exact(value.isolation, "diagnostic_assignment_policy.isolation",
    ["fresh_container_per_run", "non_root", "read_only_root", "no_new_privileges", "drop_all_capabilities"]);
  if (Object.values(value.isolation).some((entry) => entry !== true)) {
    fail("diagnostic_assignment_policy.isolation controls must all be required.");
  }
  exact(value.mounts, "diagnostic_assignment_policy.mounts",
    ["input", "output", "temporary", "host_workspace"]);
  if (value.mounts.input !== "read_only_exact_package"
      || value.mounts.output !== "bounded_write_only_result"
      || value.mounts.temporary !== "bounded_tmpfs"
      || value.mounts.host_workspace !== "prohibited") {
    fail("diagnostic_assignment_policy.mounts are unsupported.");
  }
  exact(value.network, "diagnostic_assignment_policy.network", ["mode", "general_egress"]);
  if (value.network.mode !== "model_broker_only_after_claim" || value.network.general_egress !== false) {
    fail("diagnostic_assignment_policy.network is unsupported.");
  }
  exact(value.resources, "diagnostic_assignment_policy.resources",
    ["max_cpus", "max_memory_bytes", "max_pids", "max_output_bytes", "max_runtime_seconds"]);
  const ceilings = {
    max_cpus: 4,
    max_memory_bytes: 4 * 1024 * 1024 * 1024,
    max_pids: 512,
    max_output_bytes: 16 * 1024 * 1024,
    max_runtime_seconds: 3600
  };
  for (const [field, maximum] of Object.entries(ceilings)) {
    if (!Number.isSafeInteger(value.resources[field]) || value.resources[field] < 1
        || value.resources[field] > maximum) {
      fail(`diagnostic_assignment_policy.resources.${field} exceeds its closed ceiling.`, { field, maximum });
    }
  }
  if (!Number.isSafeInteger(value.assignment_ttl_seconds) || value.assignment_ttl_seconds < 1
      || value.assignment_ttl_seconds > MAX_TTL_SECONDS) {
    fail("diagnostic_assignment_policy.assignment_ttl_seconds is outside the supported bound.");
  }
  if (value.data_classification !== "diagnostic_internal") {
    fail("diagnostic_assignment_policy.data_classification is unsupported.");
  }
  exact(value.disclosure, "diagnostic_assignment_policy.disclosure",
    ["before_claim", "evidence_scope", "recipient", "provider_training"]);
  if (value.disclosure.before_claim !== "none"
      || value.disclosure.evidence_scope !== "exact_assigned_package_only"
      || value.disclosure.recipient !== "authorized_claimed_worker_run_only"
      || value.disclosure.provider_training !== "prohibited") {
    fail("diagnostic_assignment_policy.disclosure is unsupported.");
  }
  if (value.schema_version === DIAGNOSTIC_ASSIGNMENT_POLICY_SCHEMA) {
    exact(value.late_evidence, "diagnostic_assignment_policy.late_evidence", [
      "default_action", "material_change_actions", "claimed_assignment_action"
    ]);
    if (value.late_evidence.default_action !== "notify_only"
        || value.late_evidence.claimed_assignment_action !== "notify_only") {
      fail("Late-evidence defaults and claimed-assignment handling must remain notification only.");
    }
    if (!Array.isArray(value.late_evidence.material_change_actions)
        || value.late_evidence.material_change_actions.length >
          DIAGNOSTIC_EVIDENCE_MATERIAL_CHANGE_CLASSES.length) {
      fail("diagnostic_assignment_policy.late_evidence.material_change_actions is invalid.");
    }
    const seen = new Set();
    for (const [index, entry] of value.late_evidence.material_change_actions.entries()) {
      exact(entry, `diagnostic_assignment_policy.late_evidence.material_change_actions[${index}]`, [
        "material_change_class", "action"
      ]);
      if (!DIAGNOSTIC_EVIDENCE_MATERIAL_CHANGE_CLASSES.includes(entry.material_change_class)
          || !["notify_only", "replace_unclaimed"].includes(entry.action)
          || seen.has(entry.material_change_class)) {
        fail("Late-evidence material action must be unique and use the closed vocabulary.", { index });
      }
      seen.add(entry.material_change_class);
    }
  }
  return structuredClone(value);
}

export function resolveLateEvidenceAssignmentAction(policy, materialChangeClasses, assignmentState) {
  const validated = validateDiagnosticAssignmentPolicy(policy);
  if (assignmentState !== "unclaimed") return "notify_only";
  if (validated.schema_version === DIAGNOSTIC_ASSIGNMENT_POLICY_SCHEMA_V0_1) return "notify_only";
  const actions = new Map(validated.late_evidence.material_change_actions.map((entry) => [
    entry.material_change_class, entry.action
  ]));
  return materialChangeClasses.some((entry) => actions.get(entry) === "replace_unclaimed")
    ? "replace_unclaimed" : validated.late_evidence.default_action;
}

export function validateDiagnosticAssignmentExport(kind, content) {
  if (kind !== "diagnostic_assignment_policy") {
    fail("Diagnostic Assignment export kind is unsupported.", { kind });
  }
  return validateDiagnosticAssignmentPolicy(content);
}
