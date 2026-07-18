import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  DIAGNOSTIC_ASSIGNMENT_POLICY_SCHEMA,
  DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
  DIAGNOSTIC_WORKER_INSTRUCTION_V0_1,
  DIAGNOSTIC_WORKER_OUTPUT_SCHEMA_V0_1,
  resolveLateEvidenceAssignmentAction,
  validateDiagnosticAssignmentPolicy
} from "../../src/diagnostic-assignment-contracts.js";
import {
  buildDiagnosticAssignmentArtifactManifest,
  collectDiagnosticAssignmentModuleClosure,
  DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST
} from "../../src/diagnostic-assignment-artifact.js";
import {
  buildDiagnosticAssignmentStageInput,
  projectDiagnosticAssignment
} from "../../src/diagnostic-assignment-projector.js";

function policy() {
  return {
    schema_version: DIAGNOSTIC_ASSIGNMENT_POLICY_SCHEMA,
    policy_id: "policy:model-free-diagnostic-analysis",
    instruction: structuredClone(DIAGNOSTIC_WORKER_INSTRUCTION_V0_1),
    output_schema: structuredClone(DIAGNOSTIC_WORKER_OUTPUT_SCHEMA_V0_1),
    required_passport_class: "diagnostic_interpreter",
    required_worker_capabilities: [
      "read_exact_evidence_package", "produce_schema_validated_diagnostic_output"
    ],
    prohibitions: [
      "credential_access", "evidence_outside_assigned_package", "external_effect",
      "kernel_authority", "repair_execution", "unbrokered_model_access"
    ],
    model_requirements: {
      selection: "dispatch_time_exact_match",
      capability_class: "diagnostic_reasoning",
      access_delivery: "broker_after_claim_only"
    },
    runtime_requirements: {
      kind: "isolated_diagnostic_worker", image_selection: "dispatch_time_exact_match"
    },
    isolation: {
      fresh_container_per_run: true, non_root: true, read_only_root: true,
      no_new_privileges: true, drop_all_capabilities: true
    },
    mounts: {
      input: "read_only_exact_package", output: "bounded_write_only_result",
      temporary: "bounded_tmpfs", host_workspace: "prohibited"
    },
    network: { mode: "model_broker_only_after_claim", general_egress: false },
    resources: {
      max_cpus: 1, max_memory_bytes: 536870912, max_pids: 64,
      max_output_bytes: 1048576, max_runtime_seconds: 600
    },
    assignment_ttl_seconds: 3600,
    data_classification: "diagnostic_internal",
    disclosure: {
      before_claim: "none", evidence_scope: "exact_assigned_package_only",
      recipient: "authorized_claimed_worker_run_only", provider_training: "prohibited"
    },
    late_evidence: {
      default_action: "notify_only",
      material_change_actions: [
        { material_change_class: "behavior_evaluation_changed", action: "replace_unclaimed" }
      ],
      claimed_assignment_action: "notify_only"
    }
  };
}

function projectionInput(overrides = {}) {
  const assignmentPolicy = policy();
  const activation = {
    assignment_policy_activation_id: "00000000-0000-4000-8000-000000000120",
    activation_digest: sha256Digest({ activation: 12 }),
    policy_export_id: "assignment:model-free-diagnostic-analysis",
    policy_digest: sha256Digest(assignmentPolicy),
    instruction_digest: sha256Digest(assignmentPolicy.instruction),
    output_schema_digest: sha256Digest(assignmentPolicy.output_schema)
  };
  const sourceEvent = {
    schema_version: "alphonse.evidence-package-frozen-assignment-event.v0.1",
    transition_id: "00000000-0000-4000-8000-000000000121",
    installation_id: "00000000-0000-4000-8000-00000000a001",
    diagnostic_sequence: "42",
    aggregate_type: "diagnostic_case",
    aggregate_id: "00000000-0000-4000-8000-000000000122",
    event_type: "diagnostic.evidence_package.frozen",
    from_revision: "1",
    to_revision: "2",
    command_id: "evidence-freeze:test",
    actor: { type: "service", id: "diagnostic-stage-worker:evidence-packaging-v0.1" },
    payload: {
      evidence_package_id: "00000000-0000-4000-8000-000000000123",
      semantic_digest: sha256Digest({ package: 12 }),
      package_artifact_digest: sha256Digest({ package_artifact: 12 }),
      freeze_reason: "required_sources_complete",
      assignment_policy_activation_id: activation.assignment_policy_activation_id,
      assignment_policy_activation_digest: activation.activation_digest
    },
    occurred_at: "2026-07-17T15:00:00.000Z"
  };
  const evidencePackage = {
    evidence_package_id: sourceEvent.payload.evidence_package_id,
    case_id: sourceEvent.aggregate_id,
    semantic_digest: sourceEvent.payload.semantic_digest,
    package_artifact_digest: sourceEvent.payload.package_artifact_digest,
    frozen_at: sourceEvent.occurred_at
  };
  return { assignmentPolicy, activation, sourceEvent, evidencePackage, ...overrides };
}

test("assignment policy is answer-free, neutral, closed, and authority-free", () => {
  const checked = validateDiagnosticAssignmentPolicy(policy());
  const schema = checked.output_schema.properties.best_supported_hypothesis.properties;
  assert.ok(schema.mechanism.enum.length > 4);
  assert.ok(schema.scope.enum.length > 4);
  assert.ok(schema.support.enum.includes("NOT_ESTABLISHED"));
  assert.equal(Object.hasOwn(checked.instruction, "expected_answer"), false);
  assert.equal(Object.hasOwn(checked.instruction, "root_cause"), false);
  assert.equal(checked.disclosure.before_claim, "none");
  assert.equal(resolveLateEvidenceAssignmentAction(checked,
    ["behavior_evaluation_changed"], "unclaimed"), "replace_unclaimed");
  assert.equal(resolveLateEvidenceAssignmentAction(checked,
    ["behavior_evaluation_changed"], "claimed"), "notify_only");
  assert.equal(resolveLateEvidenceAssignmentAction(checked,
    ["contradiction_added"], "unclaimed"), "notify_only");

  const narrowed = policy();
  narrowed.output_schema.properties.best_supported_hypothesis.properties.mechanism.enum =
    ["identity_scope_mismatch"];
  assert.throws(() => validateDiagnosticAssignmentPolicy(narrowed),
    (error) => error.code === "DIAGNOSTIC_ASSIGNMENT_POLICY_INVALID");
});

test("assignment projection is deterministic, installation-scoped, and uses frozen event time", () => {
  const input = projectionInput();
  const stageInput = buildDiagnosticAssignmentStageInput({
    installationId: input.sourceEvent.installation_id,
    environmentId: "00000000-0000-4000-8000-000000000001",
    sourceEvent: input.sourceEvent,
    evidencePackage: input.evidencePackage,
    assignmentPolicyActivation: input.activation,
    stageArtifactDigest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST
  });
  const first = projectDiagnosticAssignment({
    stageInput, assignmentPolicy: input.assignmentPolicy,
    stageArtifactDigest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST
  });
  const replay = projectDiagnosticAssignment({
    stageInput: structuredClone(stageInput), assignmentPolicy: structuredClone(input.assignmentPolicy),
    stageArtifactDigest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST
  });
  assert.deepEqual(replay, first);
  assert.equal(first.assignment.temporal.available_at, input.sourceEvent.occurred_at);
  assert.equal(first.assignment.temporal.expires_at, "2026-07-17T16:00:00.000Z");
  assert.equal(first.assignment.initial_state, "unclaimed");
  assert.deepEqual(first.assignment.authority.granted_capabilities, []);
  assert.equal(first.assignment.authority.authority_granted, "none");
  assert.equal(first.assignment.authority.model_contacted, false);
  assert.equal(first.assignment.stage.assignment_rules_digest, DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST);

  const anotherInstallation = structuredClone(stageInput);
  anotherInstallation.installation_id = "00000000-0000-4000-8000-00000000a002";
  const isolated = projectDiagnosticAssignment({ stageInput: anotherInstallation,
    assignmentPolicy: input.assignmentPolicy,
    stageArtifactDigest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST });
  assert.notEqual(isolated.assignment_id, first.assignment_id);
});

test("assignment stage identity covers the projector, policy contracts, persistence, and migration", () => {
  const closure = collectDiagnosticAssignmentModuleClosure();
  for (const required of [
    "src/diagnostic-assignment-service.js",
    "src/diagnostic-assignment-projector.js",
    "src/diagnostic-assignment-contracts.js",
    "src/diagnostic-assignment-persistence.js",
    "src/canonical-json.js"
  ]) assert.ok(closure.includes(required), required);
  const manifest = buildDiagnosticAssignmentArtifactManifest();
  assert.ok(manifest.bound_files.some((entry) =>
    entry.path === "diagnostic-migrations/019_model_free_diagnostic_assignments.sql"));
  assert.equal(sha256Digest(manifest), DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST);
});
