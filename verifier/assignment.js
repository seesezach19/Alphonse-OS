import { canonicalize, deterministicUuid, rawSha256Digest, same, sha256Digest } from "./canonical.js";

const MATERIAL_SCHEMA = "alphonse.diagnostic-assignment-verification-material.v0.1";
const ACTIVATION_SCHEMA = "alphonse.diagnostic-assignment-policy-activation.v0.1";
const STAGE_INPUT_SCHEMA = "alphonse.diagnostic-assignment-stage-input.v0.1";
const ASSIGNMENT_SCHEMA = "alphonse.diagnostic-assignment.v0.1";
const RECORD_SCHEMA = "alphonse.diagnostic-assignment-record.v0.1";
const STAGE_RECORD_SCHEMA = "alphonse.diagnostic-assignment-stage-record.v0.1";
const FROZEN_EVENT_SCHEMA = "alphonse.evidence-package-frozen-assignment-event.v0.1";
const REPLACEMENT_EVENT_SCHEMA = "alphonse.diagnostic-assignment-replacement-event.v0.1";
const DELIVERY_SCHEMA = "alphonse.diagnostic-assignment-delivery.v0.1";
const ASSIGNMENT_AUTHOR = "diagnostic-stage-worker:assignment-creation-v0.1";
const PACKAGE_AUTHORS = ["diagnostic-stage-worker:evidence-packaging-v0.1",
  "diagnostic-stage-worker:evidence-packaging-v0.2"];
const MATERIAL_CHANGE_CLASSES = [
  "behavior_evaluation_changed", "contradiction_added", "contradiction_resolved",
  "contributing_coverage_changed", "governed_reinterpretation_requested",
  "required_relationship_became_unresolved", "required_relationship_resolved",
  "required_role_connected", "required_role_disconnected", "selected_evidence_changed"
];
const RULES = {
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
};
const RULES_DIGEST = sha256Digest(RULES);
const EXPECTED_INSTRUCTION = {
  schema_version: "alphonse.diagnostic-worker-instruction.v0.1",
  task: "analyze_assigned_frozen_evidence_package",
  evidence_boundary: "assigned_package_only",
  conclusion_policy: "best_supported_hypothesis_with_alternatives_and_falsifiers",
  uncertainty_policy: "preserve_not_established_and_contradicted_material",
  authority_policy: "diagnostic_interpretation_and_proposal_only"
};
const EXPECTED_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "alphonse.diagnostic-worker-output.v0.1",
  type: "object",
  additionalProperties: false,
  required: ["best_supported_hypothesis", "supporting_claims", "counterevidence", "alternatives",
    "not_established", "falsifiers", "next_best_observation"],
  properties: {
    best_supported_hypothesis: {
      type: "object", additionalProperties: false,
      required: ["mechanism", "scope", "support", "confidence"],
      properties: {
        mechanism: { type: "string", enum: ["identity_scope_mismatch", "workflow_configuration_error",
          "provider_behavior_change", "observation_gap", "competing_supported_mechanism", "unknown"] },
        scope: { type: "string", enum: ["logical_operation", "delivery", "workflow", "integration",
          "provider", "unknown"] },
        support: { type: "string", enum: ["BEST_SUPPORTED_HYPOTHESIS", "PLAUSIBLE",
          "NOT_ESTABLISHED", "CONTRADICTED"] },
        confidence: { type: "string", enum: ["high", "medium", "low"] }
      }
    },
    supporting_claims: { type: "array", items: { type: "string" }, uniqueItems: true },
    counterevidence: { type: "array", items: { type: "string" }, uniqueItems: true },
    alternatives: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["hypothesis", "status", "reason"], properties: {
        hypothesis: { type: "string" },
        status: { type: "string", enum: ["supported", "weakened", "unresolved", "contradicted"] },
        reason: { type: "string" }
      } } },
    not_established: { type: "array", items: { type: "string" }, uniqueItems: true },
    falsifiers: { type: "array", items: { type: "string" }, uniqueItems: true },
    next_best_observation: { type: ["object", "null"], additionalProperties: false,
      required: ["type", "purpose"], properties: {
        type: { type: "string" }, purpose: { type: "string" }
      } }
  }
};

function violation(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function assert(condition, code, message, details = {}) {
  if (!condition) violation(code, message, details);
}

function exactKeys(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && same(Object.keys(value).sort(), [...keys].sort());
}

function exactStringSet(value, expected) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    && new Set(value).size === value.length && same([...value].sort(), [...expected].sort());
}

function iso(value) {
  try { return new Date(value).toISOString(); } catch { return null; }
}

function addSeconds(instant, seconds) {
  const milliseconds = Date.parse(instant) + seconds * 1000;
  assert(Number.isSafeInteger(milliseconds) && Number.isFinite(milliseconds),
    "VERIFIER_ASSIGNMENT_TIME_INVALID", "Assignment expiry exceeds the supported range.");
  return new Date(milliseconds).toISOString();
}

function verifyStageArchive(entry, expectedDigest) {
  const archive = entry?.archive;
  assert(entry?.stage_artifact_digest === expectedDigest
    && archive?.schema_version === "alphonse.stage-artifact-archive.v0.1"
    && archive.stage_artifact_digest === expectedDigest
    && sha256Digest(archive.artifact_manifest) === expectedDigest
    && sha256Digest(archive) === entry.archive_artifact_digest,
  "VERIFIER_ASSIGNMENT_STAGE_ARCHIVE_INTEGRITY_VIOLATION",
  "Assignment stage archive identity does not verify.");
  const manifestFiles = [...archive.artifact_manifest.module_closure,
    ...archive.artifact_manifest.bound_files].sort((left, right) => left.path < right.path ? -1 : 1);
  assert(manifestFiles.length === archive.files.length,
    "VERIFIER_ASSIGNMENT_STAGE_ARCHIVE_INTEGRITY_VIOLATION",
    "Assignment stage archive file set is incomplete.");
  for (let index = 0; index < manifestFiles.length; index += 1) {
    const expected = manifestFiles[index];
    const actual = archive.files[index];
    const bytes = Buffer.from(actual?.bytes_base64 ?? "", "base64");
    assert(actual?.path === expected.path && actual.size_bytes === expected.size_bytes
      && actual.digest === expected.digest && bytes.length === expected.size_bytes
      && rawSha256Digest(bytes) === expected.digest,
    "VERIFIER_ASSIGNMENT_STAGE_ARCHIVE_INTEGRITY_VIOLATION",
    "Assignment stage archive bytes do not match their manifest.", { path: expected.path });
  }
  const closure = new Set(archive.artifact_manifest.module_closure.map((item) => item.path));
  const bound = new Set(archive.artifact_manifest.bound_files.map((item) => item.path));
  assert(["src/diagnostic-assignment-service.js", "src/diagnostic-assignment-projector.js",
    "src/diagnostic-assignment-contracts.js", "src/diagnostic-assignment-persistence.js",
    "src/canonical-json.js"]
    .every((item) => closure.has(item))
    && bound.has("diagnostic-migrations/019_model_free_diagnostic_assignments.sql"),
  "VERIFIER_ASSIGNMENT_STAGE_ARCHIVE_INTEGRITY_VIOLATION",
  "Assignment stage archive omits a required semantic source or migration.");
}

export function verifyNeutralPolicy(policy) {
  const baseFields = ["schema_version", "policy_id", "instruction", "output_schema",
    "required_passport_class", "required_worker_capabilities", "prohibitions", "model_requirements",
    "runtime_requirements", "isolation", "mounts", "network", "resources", "assignment_ttl_seconds",
    "data_classification", "disclosure"];
  const fields = policy?.schema_version === "alphonse.diagnostic-assignment-policy.v0.2"
    ? [...baseFields, "late_evidence"] : baseFields;
  assert(exactKeys(policy, fields)
    && ["alphonse.diagnostic-assignment-policy.v0.1",
      "alphonse.diagnostic-assignment-policy.v0.2"].includes(policy.schema_version)
    && typeof policy.policy_id === "string" && /^[a-z][a-z0-9._:-]{2,199}$/.test(policy.policy_id)
    && same(policy.instruction, EXPECTED_INSTRUCTION),
  "VERIFIER_ASSIGNMENT_INSTRUCTION_NOT_NEUTRAL",
  "Assignment instruction is not the exact answer-free contract.");
  assert(same(policy.output_schema, EXPECTED_OUTPUT_SCHEMA),
  "VERIFIER_ASSIGNMENT_OUTPUT_SCHEMA_NOT_NEUTRAL",
  "Assignment output schema does not preserve the complete neutral hypothesis vocabulary.");
  const resources = policy.resources;
  const resourceCeilings = { max_cpus: 4, max_memory_bytes: 4 * 1024 * 1024 * 1024,
    max_pids: 512, max_output_bytes: 16 * 1024 * 1024, max_runtime_seconds: 3600 };
  assert(policy.required_passport_class === "diagnostic_interpreter"
    && exactStringSet(policy.required_worker_capabilities,
      ["read_exact_evidence_package", "produce_schema_validated_diagnostic_output"])
    && exactStringSet(policy.prohibitions, ["credential_access", "evidence_outside_assigned_package",
      "external_effect", "kernel_authority", "repair_execution", "unbrokered_model_access"])
    && same(policy.model_requirements, { selection: "dispatch_time_exact_match",
      capability_class: "diagnostic_reasoning", access_delivery: "broker_after_claim_only" })
    && same(policy.runtime_requirements, { kind: "isolated_diagnostic_worker",
      image_selection: "dispatch_time_exact_match" })
    && same(policy.isolation, { fresh_container_per_run: true, non_root: true, read_only_root: true,
      no_new_privileges: true, drop_all_capabilities: true })
    && same(policy.mounts, { input: "read_only_exact_package", output: "bounded_write_only_result",
      temporary: "bounded_tmpfs", host_workspace: "prohibited" })
    && same(policy.network, { mode: "model_broker_only_after_claim", general_egress: false })
    && exactKeys(resources, Object.keys(resourceCeilings))
    && Object.entries(resourceCeilings).every(([key, ceiling]) =>
      Number.isSafeInteger(resources[key]) && resources[key] >= 1 && resources[key] <= ceiling)
    && Number.isSafeInteger(policy.assignment_ttl_seconds) && policy.assignment_ttl_seconds >= 1
    && policy.assignment_ttl_seconds <= 604_800
    && policy.data_classification === "diagnostic_internal"
    && same(policy.disclosure, { before_claim: "none", evidence_scope: "exact_assigned_package_only",
      recipient: "authorized_claimed_worker_run_only", provider_training: "prohibited" }),
  "VERIFIER_ASSIGNMENT_POLICY_AUTHORITY_VIOLATION",
  "Assignment Policy does not preserve its exact bounded no-authority work contract.");
  if (policy.schema_version === "alphonse.diagnostic-assignment-policy.v0.2") {
    assert(exactKeys(policy.late_evidence,
      ["default_action", "material_change_actions", "claimed_assignment_action"])
      && policy.late_evidence.default_action === "notify_only"
      && policy.late_evidence.claimed_assignment_action === "notify_only"
      && Array.isArray(policy.late_evidence.material_change_actions)
      && policy.late_evidence.material_change_actions.length <= MATERIAL_CHANGE_CLASSES.length,
    "VERIFIER_ASSIGNMENT_LATE_EVIDENCE_POLICY_INVALID",
    "Assignment Policy late-evidence defaults exceed notification-only authority.");
    const seen = new Set();
    for (const entry of policy.late_evidence.material_change_actions) {
      assert(exactKeys(entry, ["material_change_class", "action"])
        && MATERIAL_CHANGE_CLASSES.includes(entry.material_change_class)
        && ["notify_only", "replace_unclaimed"].includes(entry.action)
        && !seen.has(entry.material_change_class),
      "VERIFIER_ASSIGNMENT_LATE_EVIDENCE_POLICY_INVALID",
      "Assignment Policy late-evidence actions are not one closed unique mapping.");
      seen.add(entry.material_change_class);
    }
  }
}

function sourceEvent(transition) {
  return {
    schema_version: transition.transition_type === "diagnostic.assignment.replacement_requested"
      ? REPLACEMENT_EVENT_SCHEMA : FROZEN_EVENT_SCHEMA,
    transition_id: transition.transition_id,
    installation_id: transition.installation_id,
    diagnostic_sequence: String(transition.diagnostic_sequence),
    aggregate_type: transition.aggregate_type,
    aggregate_id: transition.aggregate_id,
    event_type: transition.transition_type,
    from_revision: String(transition.from_revision),
    to_revision: String(transition.to_revision),
    command_id: transition.command_id,
    actor: { type: transition.actor_type, id: transition.actor_id },
    payload: structuredClone(transition.payload),
    occurred_at: iso(transition.occurred_at)
  };
}

function delivery(outbox) {
  return {
    schema_version: DELIVERY_SCHEMA,
    outbox_id: outbox.outbox_id,
    installation_id: outbox.installation_id,
    transition_id: outbox.transition_id,
    event_type: outbox.event_type,
    payload: structuredClone(outbox.payload),
    created_at: iso(outbox.created_at)
  };
}

function verifyAssignmentStateHistory(row, state, transitions) {
  assert(Array.isArray(transitions) && transitions.length > 0,
    "VERIFIER_ASSIGNMENT_STATE_HISTORY_MISMATCH",
    "Assignment requires one complete immutable transition history.");
  const ordered = [...transitions].sort((left, right) =>
    BigInt(left.diagnostic_sequence) < BigInt(right.diagnostic_sequence) ? -1 : 1);
  let expectedState = "unclaimed";
  for (let index = 0; index < ordered.length; index += 1) {
    const transition = ordered[index];
    assert(transition.installation_id === row.installation_id
      && transition.aggregate_type === "diagnostic_assignment"
      && transition.aggregate_id === row.assignment_id
      && String(transition.from_revision) === String(index)
      && String(transition.to_revision) === String(index + 1),
    "VERIFIER_ASSIGNMENT_STATE_HISTORY_MISMATCH",
    "Assignment transitions are not one contiguous aggregate chain.");
    if (index === 0) {
      assert(transition.transition_type === "diagnostic.assignment.created",
        "VERIFIER_ASSIGNMENT_STATE_HISTORY_MISMATCH",
        "Assignment history does not begin with immutable creation.");
      continue;
    }
    const nextState = {
      "diagnostic.assignment.claimed": "claimed",
      "diagnostic.assignment.expired": "expired",
      "diagnostic.assignment.cancelled": "cancelled"
    }[transition.transition_type];
    const allowed = expectedState === "unclaimed"
      ? ["claimed", "expired", "cancelled"].includes(nextState)
      : expectedState === "claimed" && nextState === "cancelled";
    assert(allowed && transition.payload?.assignment_id === row.assignment_id
      && transition.payload?.assignment_digest === row.assignment_digest,
    "VERIFIER_ASSIGNMENT_STATE_HISTORY_MISMATCH",
    "Assignment history contains an invalid state or identity transition.");
    expectedState = nextState;
  }
  const last = ordered.at(-1);
  assert(state.assignment_id === row.assignment_id && state.assignment_digest === row.assignment_digest
    && state.state === expectedState && String(state.state_revision) === String(ordered.length - 1)
    && state.last_transition_id === last.transition_id
    && iso(state.updated_at) === iso(last.occurred_at),
  "VERIFIER_ASSIGNMENT_STATE_HISTORY_MISMATCH",
  "Assignment state projection does not match its immutable transition chain.");
  return ordered;
}

function buildStageInput(material, event, policy) {
  const packageView = material.evidence_package;
  return {
    schema_version: STAGE_INPUT_SCHEMA,
    installation_id: event.installation_id,
    environment_id: material.assignment.environment_id,
    source_event: structuredClone(event),
    case: { case_id: packageView.case_id },
    evidence_package: {
      evidence_package_id: packageView.evidence_package_id,
      semantic_digest: packageView.semantic_digest,
      package_artifact_digest: packageView.package_artifact_digest,
      frozen_at: packageView.frozen_at
    },
    assignment_policy: {
      assignment_policy_activation_id: policy.assignment_policy_activation_id,
      activation_digest: policy.activation_digest,
      policy_export_id: policy.policy_export_id,
      policy_digest: policy.policy_digest,
      instruction_digest: policy.instruction_digest,
      output_schema_digest: policy.output_schema_digest
    },
    ordinal: RULES.initial_ordinal,
    stage: { artifact_digest: policy.stage_artifact_digest, assignment_rules_digest: RULES_DIGEST }
  };
}

function projectAssignment(stageInput, policy) {
  const inputDigest = sha256Digest(stageInput);
  const identity = {
    installation_id: stageInput.installation_id,
    environment_id: stageInput.environment_id,
    evidence_package_id: stageInput.evidence_package.evidence_package_id,
    evidence_package_semantic_digest: stageInput.evidence_package.semantic_digest,
    assignment_policy_activation_id: stageInput.assignment_policy.assignment_policy_activation_id,
    assignment_policy_activation_digest: stageInput.assignment_policy.activation_digest
  };
  const seriesId = deterministicUuid({ namespace: RULES.series_identity_namespace, ...identity });
  const assignmentId = deterministicUuid({ namespace: RULES.identity_namespace, ...identity,
    ordinal: stageInput.ordinal });
  const assignment = {
    schema_version: ASSIGNMENT_SCHEMA,
    assignment_id: assignmentId,
    assignment_series_id: seriesId,
    installation_id: stageInput.installation_id,
    environment_id: stageInput.environment_id,
    case_id: stageInput.case.case_id,
    evidence_package: structuredClone(stageInput.evidence_package),
    assignment_policy: {
      assignment_policy_activation_id: stageInput.assignment_policy.assignment_policy_activation_id,
      activation_digest: stageInput.assignment_policy.activation_digest,
      policy_export_id: stageInput.assignment_policy.policy_export_id,
      policy_digest: stageInput.assignment_policy.policy_digest,
      instruction: structuredClone(policy.instruction),
      instruction_digest: stageInput.assignment_policy.instruction_digest,
      output_schema: structuredClone(policy.output_schema),
      output_schema_digest: stageInput.assignment_policy.output_schema_digest
    },
    work_requirements: {
      required_passport_class: policy.required_passport_class,
      required_worker_capabilities: [...policy.required_worker_capabilities].sort(),
      prohibitions: [...policy.prohibitions].sort(),
      model: structuredClone(policy.model_requirements),
      runtime: structuredClone(policy.runtime_requirements),
      isolation: structuredClone(policy.isolation), mounts: structuredClone(policy.mounts),
      network: structuredClone(policy.network), resources: structuredClone(policy.resources),
      data_classification: policy.data_classification, disclosure: structuredClone(policy.disclosure)
    },
    temporal: { available_at: stageInput.source_event.occurred_at,
      expires_at: addSeconds(stageInput.source_event.occurred_at, policy.assignment_ttl_seconds),
      freshness: "current_until_expiry", time_source: RULES.semantic_time_source },
    ordinal: stageInput.ordinal,
    initial_state: RULES.initial_state,
    authority: { authority_granted: "none", granted_capabilities: [], worker_bound: false,
      dispatch_requested: false, dispatch_authorized: false, broker_token_created: false,
      execution_capability_created: false, evidence_disclosed: false, model_contacted: false,
      provider_request_created: false },
    stage: { component: ASSIGNMENT_AUTHOR, input_digest: inputDigest,
      artifact_digest: stageInput.stage.artifact_digest, assignment_rules_digest: RULES_DIGEST,
      processing_profile: "D0" }
  };
  return { assignmentId, seriesId, assignment, assignmentDigest: sha256Digest(assignment), inputDigest };
}

function verifyReplacementHistory(material, event, projected, policy, published) {
  const history = material.replacement_history;
  assert(history && published.reevaluation_notice
    && same(history.reevaluation_notice, published.reevaluation_notice),
  "VERIFIER_ASSIGNMENT_REPLACEMENT_HISTORY_MISMATCH",
  "Replacement does not bind the independently verified reevaluation notice.");
  const replacement = history.replacement;
  const notice = history.reevaluation_notice;
  const replaced = history.replaced_assignment;
  const replacedState = history.replaced_assignment_state;
  assert(sha256Digest(notice.notice_document) === notice.notice_digest
    && notice.reevaluation_notice_id === event.payload.reevaluation_notice_id
    && notice.predecessor_evidence_package_id === event.payload.predecessor_evidence_package_id
    && notice.successor_evidence_package_id === event.payload.successor_evidence_package_id
    && notice.recommended_action === "replace_unclaimed"
    && event.payload.replaced_assignment_id === replaced.assignment_id,
  "VERIFIER_ASSIGNMENT_REPLACEMENT_HISTORY_MISMATCH",
  "Replacement notice and source transition do not bind one exact package lineage.");
  assert(sha256Digest(replaced.assignment_document) === replaced.assignment_digest
    && sha256Digest(replaced.record_document) === replaced.record_digest
    && replaced.case_id === projected.assignment.case_id
    && notice.known_affected_assignments.some((entry) =>
      entry.assignment_id === replaced.assignment_id
        && entry.assignment_digest === replaced.assignment_digest
        && entry.evidence_package_id === replaced.evidence_package_id
        && entry.state === "unclaimed")
    && replaced.assignment_policy_activation_id === policy.assignment_policy_activation_id,
  "VERIFIER_ASSIGNMENT_REPLACEMENT_HISTORY_MISMATCH",
  "Replaced Assignment identity or policy lineage does not verify.");
  const replacedTransitions = verifyAssignmentStateHistory(
    replaced, replacedState, history.replaced_assignment_transitions);
  const expiry = replacedTransitions.find((entry) =>
    entry.transition_type === "diagnostic.assignment.expired"
      && entry.payload?.replacement_assignment_id === projected.assignmentId);
  const expectedExpiryPayload = {
    assignment_id: replaced.assignment_id,
    assignment_digest: replaced.assignment_digest,
    reason: "material_evidence_revision_policy",
    reevaluation_notice_id: notice.reevaluation_notice_id,
    replacement_assignment_id: projected.assignmentId,
    successor_evidence_package_id: projected.assignment.evidence_package.evidence_package_id
  };
  assert(expiry && same(expiry.payload, expectedExpiryPayload)
    && expiry.actor_type === "service" && expiry.actor_id === ASSIGNMENT_AUTHOR
    && replacedState.state === "expired"
    && history.expiry_command?.command_id === expiry.command_id
    && history.expiry_command.installation_id === replaced.installation_id
    && history.expiry_command.operation_id === "diagnostic.assignment.replace"
    && history.expiry_command.actor_type === "service"
    && history.expiry_command.actor_id === ASSIGNMENT_AUTHOR
    && history.expiry_command.request_digest === sha256Digest(event)
    && same(history.expiry_command.result, {
      replaced_assignment_id: replaced.assignment_id,
      replacement_assignment_id: projected.assignmentId,
      reevaluation_notice_id: notice.reevaluation_notice_id
    })
    && iso(history.expiry_command.accepted_at) === iso(expiry.occurred_at)
    && history.expiry_outbox?.transition_id === expiry.transition_id
    && history.expiry_outbox.event_type === "diagnostic.assignment.expired"
    && same(history.expiry_outbox.payload, { transition_id: expiry.transition_id,
      assignment_id: replaced.assignment_id, replacement_assignment_id: projected.assignmentId })
    && iso(history.expiry_outbox.created_at) === iso(expiry.occurred_at),
  "VERIFIER_ASSIGNMENT_REPLACEMENT_HISTORY_MISMATCH",
  "Replaced Assignment expiry command, transition, state, and outbox do not verify.");
  const expectedReplacement = {
    schema_version: "alphonse.diagnostic-assignment-replacement.v0.1",
    replacement_id: deterministicUuid({ namespace: "diagnostic-assignment-replacement",
      reevaluation_notice_id: notice.reevaluation_notice_id,
      replaced_assignment_id: replaced.assignment_id,
      replacement_assignment_id: projected.assignmentId }),
    case_id: projected.assignment.case_id,
    reevaluation_notice_id: notice.reevaluation_notice_id,
    replaced_assignment: { assignment_id: replaced.assignment_id,
      assignment_digest: replaced.assignment_digest,
      evidence_package_id: replaced.evidence_package_id, prior_state: "unclaimed" },
    replacement_assignment: { assignment_id: projected.assignmentId,
      assignment_digest: projected.assignmentDigest,
      evidence_package_id: projected.assignment.evidence_package.evidence_package_id,
      initial_state: "unclaimed" },
    assignment_policy_activation_id: policy.assignment_policy_activation_id,
    assignment_policy_activation_digest: policy.activation_digest,
    reason: "material_evidence_revision_policy",
    authority: "bounded_assignment_replacement_only",
    created_at: iso(expiry.occurred_at)
  };
  assert(same(expectedReplacement, replacement.replacement_document)
    && sha256Digest(expectedReplacement) === replacement.replacement_digest
    && replacement.replacement_id === expectedReplacement.replacement_id
    && replacement.replaced_assignment_id === replaced.assignment_id
    && replacement.replacement_assignment_id === projected.assignmentId
    && replacement.predecessor_evidence_package_id === event.payload.predecessor_evidence_package_id
    && replacement.successor_evidence_package_id === event.payload.successor_evidence_package_id
    && replacement.assignment_policy_activation_id === policy.assignment_policy_activation_id,
  "VERIFIER_ASSIGNMENT_REPLACEMENT_HISTORY_MISMATCH",
  "Immutable Assignment replacement record does not independently recompute.");
}

export function verifyDiagnosticAssignmentMaterial(material, independentlyVerifiedPackage) {
  assert(material?.schema_version === MATERIAL_SCHEMA,
    "VERIFIER_ASSIGNMENT_MATERIAL_INVALID", "Assignment verification material schema is unsupported.");
  const row = material.assignment;
  const state = material.assignment_state;
  const policy = material.assignment_policy_activation;
  const activation = policy?.activation_document;
  const exportedPolicy = material.assignment_policy_export;
  assert(activation?.schema_version === ACTIVATION_SCHEMA
    && sha256Digest(activation) === policy.activation_digest
    && activation.assignment_policy_activation_id === policy.assignment_policy_activation_id
    && activation.installation_id === policy.installation_id
    && activation.environment_id === policy.environment_id
    && activation.deployment_id === policy.deployment_id
    && activation.package_version_id === policy.package_version_id
    && activation.package_artifact_digest === policy.package_artifact_digest
    && activation.assignment_policy.export_id === policy.policy_export_id
    && activation.assignment_policy.export_digest === policy.policy_digest
    && sha256Digest(policy.policy_document) === policy.policy_digest
    && activation.assignment_policy.instruction_digest === policy.instruction_digest
    && activation.assignment_policy.output_schema_digest === policy.output_schema_digest
    && sha256Digest(policy.policy_document.instruction) === policy.instruction_digest
    && sha256Digest(policy.policy_document.output_schema) === policy.output_schema_digest
    && same(activation.stage.artifact_manifest, policy.stage_artifact_manifest)
    && activation.stage.artifact_digest === policy.stage_artifact_digest
    && sha256Digest(policy.stage_artifact_manifest) === policy.stage_artifact_digest
    && activation.stage.assignment_rules_digest === RULES_DIGEST
    && policy.assignment_rules_digest === RULES_DIGEST,
  "VERIFIER_ASSIGNMENT_POLICY_INTEGRITY_VIOLATION",
    "Assignment Policy activation does not match its exact policy and stage material.");
  assert(exportedPolicy?.deployment_id === policy.deployment_id
    && exportedPolicy.package_version_id === policy.package_version_id
    && exportedPolicy.package_artifact_digest === policy.package_artifact_digest
    && exportedPolicy.export_record?.kind === "diagnostic_assignment_policy"
    && exportedPolicy.export_record.export_id === policy.policy_export_id
    && exportedPolicy.export_record.contract_version ===
      (policy.policy_document.schema_version === "alphonse.diagnostic-assignment-policy.v0.2"
        ? "0.2.0" : "0.1.0")
    && sha256Digest(exportedPolicy.export_record.content) === policy.policy_digest
    && same(exportedPolicy.export_record.content, policy.policy_document),
  "VERIFIER_ASSIGNMENT_POLICY_EXPORT_MISMATCH",
  "Assignment Policy activation does not resolve to its exact deployed export.");
  verifyNeutralPolicy(policy.policy_document);
  verifyStageArchive(material.stage_artifact_archive, policy.stage_artifact_digest);

  const event = sourceEvent(material.source_transition);
  const delivered = delivery(material.source_outbox_delivery);
  const replacement = event.event_type === "diagnostic.assignment.replacement_requested";
  const expectedEventPayload = replacement ? [
    "assignment_policy_activation_digest", "assignment_policy_activation_id",
    "predecessor_evidence_package_id", "reevaluation_notice_id", "replaced_assignment_id",
    "successor_evidence_package_id", "successor_package_artifact_digest", "successor_semantic_digest"
  ] : [
    "assignment_policy_activation_digest", "assignment_policy_activation_id", "evidence_package_id",
    "freeze_reason", "package_artifact_digest", "semantic_digest"
  ];
  const expectedDeliveryPayload = replacement
    ? ["reevaluation_notice_id", "transition_id"] : ["evidence_package_id", "transition_id"];
  assert(["diagnostic.evidence_package.frozen",
    "diagnostic.assignment.replacement_requested"].includes(event.event_type)
    && event.aggregate_type === (replacement ? "diagnostic_assignment_replacement" : "diagnostic_case")
    && (!replacement || event.aggregate_id === event.payload.reevaluation_notice_id)
    && event.actor.type === "service" && PACKAGE_AUTHORS.includes(event.actor.id)
    && exactKeys(event.payload, expectedEventPayload)
    && exactKeys(delivered.payload, expectedDeliveryPayload)
    && delivered.transition_id === event.transition_id
    && delivered.event_type === event.event_type
    && delivered.created_at === event.occurred_at
    && delivered.payload.transition_id === event.transition_id
    && (replacement
      ? delivered.payload.reevaluation_notice_id === event.payload.reevaluation_notice_id
      : delivered.payload.evidence_package_id === event.payload.evidence_package_id)
    && sha256Digest(event) === material.inbox_receipt.source_event_digest
    && same(event, material.inbox_receipt.source_event_document)
    && sha256Digest(delivered) === material.inbox_receipt.delivery_digest
    && same(delivered, material.inbox_receipt.delivery_document)
    && material.inbox_receipt.status === "completed",
  "VERIFIER_ASSIGNMENT_SOURCE_EVENT_INTEGRITY_VIOLATION",
  "Assignment source delivery does not match its immutable package or replacement transition.");
  const publishedPackage = independentlyVerifiedPackage.bundle.published_outputs_to_compare.evidence_package;
  const published = independentlyVerifiedPackage.bundle.published_outputs_to_compare;
  const evidencePolicy = published.evidence_policy_activation;
  assert(material.evidence_package.evidence_package_id === publishedPackage.evidence_package_id
    && material.evidence_package.case_id === publishedPackage.case_id
    && material.evidence_package.semantic_digest === publishedPackage.semantic_digest
    && material.evidence_package.package_artifact_digest === publishedPackage.package_artifact_digest
    && material.evidence_package.frozen_at === iso(publishedPackage.frozen_at)
    && (replacement
      ? event.payload.successor_evidence_package_id === publishedPackage.evidence_package_id
        && event.payload.successor_semantic_digest === publishedPackage.semantic_digest
        && event.payload.successor_package_artifact_digest === publishedPackage.package_artifact_digest
      : event.payload.evidence_package_id === publishedPackage.evidence_package_id
        && event.payload.semantic_digest === publishedPackage.semantic_digest
        && event.payload.package_artifact_digest === publishedPackage.package_artifact_digest)
    && event.payload.assignment_policy_activation_id === policy.assignment_policy_activation_id
    && event.payload.assignment_policy_activation_digest === policy.activation_digest
    && policy.deployment_id === evidencePolicy.deployment_id
    && policy.package_version_id === evidencePolicy.package_version_id
    && policy.package_artifact_digest === evidencePolicy.package_artifact_digest,
  "VERIFIER_ASSIGNMENT_PACKAGE_LINEAGE_MISMATCH",
  "Assignment does not descend from the independently verified exact Evidence Package.");

  const stageInput = buildStageInput(material, event, policy);
  const projected = projectAssignment(stageInput, policy.policy_document);
  assert(same(stageInput, material.stage_record.stage_input)
    && projected.inputDigest === material.stage_record.stage_input_digest
    && projected.inputDigest === row.stage_input_digest,
  "VERIFIER_ASSIGNMENT_INPUT_MISMATCH", "Assignment stage input does not independently recompute.");
  assert(projected.assignmentId === row.assignment_id
    && projected.seriesId === row.assignment_series_id
    && same(projected.assignment, row.assignment_document)
    && projected.assignmentDigest === row.assignment_digest
    && row.installation_id === event.installation_id
    && row.environment_id === policy.environment_id
    && row.case_id === material.evidence_package.case_id
    && row.evidence_package_id === material.evidence_package.evidence_package_id
    && row.assignment_policy_activation_id === policy.assignment_policy_activation_id
    && String(row.ordinal) === RULES.initial_ordinal
    && row.stage_artifact_digest === policy.stage_artifact_digest
    && row.assignment_rules_digest === RULES_DIGEST
    && row.source_transition_id === event.transition_id
    && row.created_by === ASSIGNMENT_AUTHOR
    && iso(row.created_at) === event.occurred_at,
  "VERIFIER_ASSIGNMENT_OUTPUT_MISMATCH", "Diagnostic Assignment does not independently recompute.");
  const record = { schema_version: RECORD_SCHEMA, assignment_id: projected.assignmentId,
    assignment_digest: projected.assignmentDigest, stage_input_digest: projected.inputDigest,
    source_transition_id: event.transition_id, created_by: ASSIGNMENT_AUTHOR,
    created_at: event.occurred_at };
  assert(same(record, row.record_document) && sha256Digest(record) === row.record_digest,
    "VERIFIER_ASSIGNMENT_RECORD_MISMATCH", "Assignment immutable record document does not verify.");
  const stageResult = material.stage_record.result_document;
  assert(stageResult?.schema_version === STAGE_RECORD_SCHEMA
    && sha256Digest(stageResult) === material.stage_record.result_digest
    && stageResult.stage_record_id === material.stage_record.stage_record_id
    && material.stage_record.installation_id === event.installation_id
    && material.stage_record.environment_id === policy.environment_id
    && material.stage_record.source_transition_id === event.transition_id
    && material.stage_record.source_event_digest === sha256Digest(event)
    && material.stage_record.stage_artifact_digest === policy.stage_artifact_digest
    && material.stage_record.assignment_rules_digest === RULES_DIGEST
    && material.stage_record.outcome === "assignment_created"
    && material.stage_record.assignment_id === projected.assignmentId
    && stageResult.source_transition_id === event.transition_id
    && stageResult.source_event_digest === sha256Digest(event)
    && stageResult.stage_input_digest === projected.inputDigest
    && stageResult.stage_artifact_digest === policy.stage_artifact_digest
    && stageResult.assignment_rules_digest === RULES_DIGEST
    && stageResult.outcome === "assignment_created"
    && stageResult.assignment_id === projected.assignmentId
    && stageResult.assignment_digest === projected.assignmentDigest
    && stageResult.processed_at === iso(material.stage_record.processed_at),
  "VERIFIER_ASSIGNMENT_STAGE_RECORD_MISMATCH", "Assignment stage result record does not verify.");
  const creation = material.assignment_creation;
  const creationTransition = creation?.transition;
  const creationCommand = creation?.command;
  const creationOutbox = creation?.outbox;
  const creationPayload = {
    assignment_id: projected.assignmentId,
    assignment_digest: projected.assignmentDigest,
    evidence_package_id: row.evidence_package_id,
    evidence_package_semantic_digest: projected.assignment.evidence_package.semantic_digest,
    assignment_policy_activation_id: policy.assignment_policy_activation_id,
    assignment_policy_activation_digest: policy.activation_digest,
    initial_state: "unclaimed",
    authority_granted: "none"
  };
  assert(creationTransition?.installation_id === event.installation_id
    && creationTransition.aggregate_type === "diagnostic_assignment"
    && creationTransition.aggregate_id === projected.assignmentId
    && creationTransition.transition_type === "diagnostic.assignment.created"
    && String(creationTransition.from_revision) === "0"
    && String(creationTransition.to_revision) === "1"
    && creationTransition.command_id === creationCommand?.command_id
    && creationTransition.actor_type === "service"
    && creationTransition.actor_id === ASSIGNMENT_AUTHOR
    && same(creationTransition.payload, creationPayload)
    && iso(creationTransition.occurred_at) === iso(row.created_at)
    && creationCommand.installation_id === event.installation_id
    && creationCommand.operation_id === "diagnostic.assignment.create"
    && creationCommand.actor_type === "service" && creationCommand.actor_id === ASSIGNMENT_AUTHOR
    && creationCommand.request_digest === projected.inputDigest
    && same(creationCommand.result, { assignment_id: projected.assignmentId,
      assignment_digest: projected.assignmentDigest })
    && iso(creationCommand.accepted_at) === iso(creationTransition.occurred_at)
    && creationOutbox?.installation_id === event.installation_id
    && creationOutbox.transition_id === creationTransition.transition_id
    && creationOutbox.event_type === creationTransition.transition_type
    && same(creationOutbox.payload, { transition_id: creationTransition.transition_id,
      assignment_id: projected.assignmentId })
    && iso(creationOutbox.created_at) === iso(creationTransition.occurred_at),
  "VERIFIER_ASSIGNMENT_CREATION_HISTORY_MISMATCH",
  "Assignment state does not match its exact creation command, transition, and outbox.");
  verifyAssignmentStateHistory(row, state, material.assignment_transitions);
  if (replacement) verifyReplacementHistory(material, event, projected, policy, published);
  else assert(material.replacement_history === null,
    "VERIFIER_ASSIGNMENT_REPLACEMENT_HISTORY_MISMATCH",
    "Initial Assignment unexpectedly carries replacement history.");
  assert(state.assignment_id === projected.assignmentId && state.assignment_digest === projected.assignmentDigest
    && state.installation_id === event.installation_id && state.environment_id === policy.environment_id
    && ["unclaimed", "claimed", "expired", "cancelled"].includes(state.state)
    && projected.assignment.authority.authority_granted === "none"
    && projected.assignment.authority.granted_capabilities.length === 0
    && projected.assignment.authority.worker_bound === false
    && projected.assignment.authority.evidence_disclosed === false
    && projected.assignment.authority.model_contacted === false
    && projected.assignment.authority.provider_request_created === false,
  "VERIFIER_ASSIGNMENT_AUTHORITY_VIOLATION",
  "Assignment creation artifact exceeds the no-authority checkpoint.");
  return { assignment_id: projected.assignmentId, assignment_digest: projected.assignmentDigest,
    stage_input_digest: projected.inputDigest, state: state.state,
    assignment_policy_activation_digest: policy.activation_digest };
}
