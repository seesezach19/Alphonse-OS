import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_SCHEMA,
  DIAGNOSTIC_ASSIGNMENT_RECORD_SCHEMA,
  DIAGNOSTIC_ASSIGNMENT_SCHEMA,
  DIAGNOSTIC_ASSIGNMENT_STAGE_RECORD_SCHEMA,
  validateDiagnosticAssignmentPolicy
} from "./diagnostic-assignment-contracts.js";
import { KernelError } from "./errors.js";

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function iso(value) {
  return new Date(value).toISOString();
}

function fail(code, message, details = {}) {
  throw new KernelError(500, code, message, details);
}

export function verifyAssignmentPolicyActivationRow(row, installationId, environmentId) {
  const document = row?.activation_document;
  if (!row || document?.schema_version !== DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_SCHEMA
      || row.installation_id !== installationId || row.environment_id !== environmentId
      || sha256Digest(document) !== row.activation_digest
      || document.assignment_policy_activation_id !== row.assignment_policy_activation_id
      || document.installation_id !== installationId || document.environment_id !== environmentId
      || document.deployment_id !== row.deployment_id
      || document.package_version_id !== row.package_version_id
      || document.package_artifact_digest !== row.package_artifact_digest
      || document.assignment_policy.export_id !== row.policy_export_id
      || document.assignment_policy.export_digest !== row.policy_digest
      || sha256Digest(row.policy_document) !== row.policy_digest
      || document.assignment_policy.instruction_digest !== row.instruction_digest
      || document.assignment_policy.output_schema_digest !== row.output_schema_digest
      || sha256Digest(row.policy_document.instruction) !== row.instruction_digest
      || sha256Digest(row.policy_document.output_schema) !== row.output_schema_digest
      || !same(document.stage.artifact_manifest, row.stage_artifact_manifest)
      || document.stage.artifact_digest !== row.stage_artifact_digest
      || sha256Digest(row.stage_artifact_manifest) !== row.stage_artifact_digest
      || document.stage.assignment_rules_digest !== row.assignment_rules_digest) {
    fail("DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_INTEGRITY_VIOLATION",
      "Stored Diagnostic Assignment Policy activation does not match its immutable material.");
  }
  validateDiagnosticAssignmentPolicy(row.policy_document);
  return row;
}

export async function getAssignmentPolicyActivation(client, {
  installationId,
  environmentId,
  assignmentPolicyActivationId
}) {
  const row = (await client.query(
    `SELECT * FROM diagnostic_assignment_policy_activations
     WHERE installation_id=$1 AND environment_id=$2 AND assignment_policy_activation_id=$3`,
    [installationId, environmentId, assignmentPolicyActivationId]
  )).rows[0];
  if (!row) {
    throw new KernelError(404, "DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_NOT_FOUND",
      "Diagnostic Assignment Policy activation does not exist.");
  }
  return verifyAssignmentPolicyActivationRow(row, installationId, environmentId);
}

export function assignmentPolicyActivationView(row) {
  return {
    assignment_policy_activation_id: row.assignment_policy_activation_id,
    deployment_id: row.deployment_id,
    package_version_id: row.package_version_id,
    package_artifact_digest: row.package_artifact_digest,
    assignment_policy: {
      export_id: row.policy_export_id,
      export_digest: row.policy_digest,
      instruction_digest: row.instruction_digest,
      output_schema_digest: row.output_schema_digest,
      document: row.policy_document
    },
    stage: {
      artifact_manifest: row.stage_artifact_manifest,
      artifact_digest: row.stage_artifact_digest,
      assignment_rules_digest: row.assignment_rules_digest
    },
    activation_digest: row.activation_digest,
    activated_by: row.activated_by,
    activated_at: iso(row.activated_at),
    authority_granted: "none",
    immutable: true
  };
}

export function verifyAssignmentRow(row, state = null) {
  const assignment = row?.assignment_document;
  const record = row?.record_document;
  if (!row || assignment?.schema_version !== DIAGNOSTIC_ASSIGNMENT_SCHEMA
      || sha256Digest(assignment) !== row.assignment_digest
      || assignment.assignment_id !== row.assignment_id
      || assignment.assignment_series_id !== row.assignment_series_id
      || assignment.installation_id !== row.installation_id
      || assignment.environment_id !== row.environment_id
      || assignment.case_id !== row.case_id
      || assignment.evidence_package.evidence_package_id !== row.evidence_package_id
      || assignment.assignment_policy.assignment_policy_activation_id
        !== row.assignment_policy_activation_id
      || assignment.ordinal !== String(row.ordinal)
      || assignment.stage.input_digest !== row.stage_input_digest
      || assignment.stage.artifact_digest !== row.stage_artifact_digest
      || assignment.stage.assignment_rules_digest !== row.assignment_rules_digest
      || assignment.initial_state !== "unclaimed"
      || assignment.authority.authority_granted !== "none"
      || !Array.isArray(assignment.authority.granted_capabilities)
      || assignment.authority.granted_capabilities.length !== 0
      || record?.schema_version !== DIAGNOSTIC_ASSIGNMENT_RECORD_SCHEMA
      || sha256Digest(record) !== row.record_digest
      || record.assignment_id !== row.assignment_id
      || record.assignment_digest !== row.assignment_digest
      || record.stage_input_digest !== row.stage_input_digest
      || record.source_transition_id !== row.source_transition_id
      || record.created_by !== row.created_by
      || record.created_at !== iso(row.created_at)
      || assignment.temporal.available_at !== iso(row.created_at)) {
    fail("DIAGNOSTIC_ASSIGNMENT_INTEGRITY_VIOLATION",
      "Stored Diagnostic Assignment does not match its immutable semantic and record digests.");
  }
  if (state && (state.assignment_id !== row.assignment_id
      || state.installation_id !== row.installation_id
      || state.environment_id !== row.environment_id
      || state.assignment_digest !== row.assignment_digest
      || !["unclaimed", "claimed", "expired", "cancelled"].includes(state.state)
      || BigInt(state.state_revision) < 0n)) {
    fail("DIAGNOSTIC_ASSIGNMENT_STATE_INTEGRITY_VIOLATION",
      "Diagnostic Assignment state projection does not bind the immutable assignment.");
  }
  return row;
}

export function verifyAssignmentCreationMaterial({ row, state, transition, command, outbox }) {
  const expectedPayload = {
    assignment_id: row?.assignment_id,
    assignment_digest: row?.assignment_digest,
    evidence_package_id: row?.evidence_package_id,
    evidence_package_semantic_digest: row?.assignment_document?.evidence_package?.semantic_digest,
    assignment_policy_activation_id: row?.assignment_policy_activation_id,
    assignment_policy_activation_digest:
      row?.assignment_document?.assignment_policy?.activation_digest,
    initial_state: "unclaimed",
    authority_granted: "none"
  };
  const expectedResult = {
    assignment_id: row?.assignment_id,
    assignment_digest: row?.assignment_digest
  };
  const expectedOutboxPayload = {
    transition_id: transition?.transition_id,
    assignment_id: row?.assignment_id
  };
  if (!row || !state || !transition || !command || !outbox
      || transition.installation_id !== row.installation_id
      || transition.aggregate_type !== "diagnostic_assignment"
      || transition.aggregate_id !== row.assignment_id
      || transition.transition_type !== "diagnostic.assignment.created"
      || String(transition.from_revision) !== "0" || String(transition.to_revision) !== "1"
      || transition.command_id !== command.command_id
      || transition.actor_type !== "service" || transition.actor_id !== row.created_by
      || !same(transition.payload, expectedPayload)
      || iso(transition.occurred_at) !== iso(row.created_at)
      || command.installation_id !== row.installation_id
      || command.operation_id !== "diagnostic.assignment.create"
      || command.actor_type !== "service" || command.actor_id !== row.created_by
      || command.request_digest !== row.stage_input_digest
      || !same(command.result, expectedResult)
      || iso(command.accepted_at) !== iso(transition.occurred_at)
      || outbox.installation_id !== row.installation_id
      || outbox.transition_id !== transition.transition_id
      || outbox.event_type !== transition.transition_type
      || !same(outbox.payload, expectedOutboxPayload)
      || iso(outbox.created_at) !== iso(transition.occurred_at)) {
    fail("DIAGNOSTIC_ASSIGNMENT_CREATION_HISTORY_INTEGRITY_VIOLATION",
      "Assignment state does not match its exact creation command, transition, and outbox history.");
  }
  return { transition, command, outbox };
}

export function verifyAssignmentStateHistory({ row, state, transitions }) {
  if (!row || !state || !Array.isArray(transitions) || transitions.length === 0) {
    fail("DIAGNOSTIC_ASSIGNMENT_STATE_HISTORY_INTEGRITY_VIOLATION",
      "Assignment state requires one complete immutable transition history.");
  }
  const ordered = [...transitions].sort((left, right) =>
    BigInt(left.diagnostic_sequence) < BigInt(right.diagnostic_sequence) ? -1 : 1);
  const creation = ordered[0];
  let expectedState = "unclaimed";
  for (let index = 0; index < ordered.length; index += 1) {
    const transition = ordered[index];
    if (transition.installation_id !== row.installation_id
        || transition.aggregate_type !== "diagnostic_assignment"
        || transition.aggregate_id !== row.assignment_id
        || String(transition.from_revision) !== String(index)
        || String(transition.to_revision) !== String(index + 1)) {
      fail("DIAGNOSTIC_ASSIGNMENT_STATE_HISTORY_INTEGRITY_VIOLATION",
        "Assignment transition history is not one exact contiguous aggregate chain.");
    }
    if (index === 0) {
      if (transition.transition_type !== "diagnostic.assignment.created") {
        fail("DIAGNOSTIC_ASSIGNMENT_STATE_HISTORY_INTEGRITY_VIOLATION",
          "Assignment transition history must begin with its immutable creation.");
      }
      continue;
    }
    const nextState = {
      "diagnostic.assignment.claimed": "claimed",
      "diagnostic.assignment.expired": "expired",
      "diagnostic.assignment.cancelled": "cancelled"
    }[transition.transition_type];
    const allowed = (expectedState === "unclaimed"
      && ["claimed", "expired", "cancelled"].includes(nextState))
      || (expectedState === "claimed" && nextState === "cancelled");
    if (!allowed || transition.payload?.assignment_id !== row.assignment_id
        || transition.payload?.assignment_digest !== row.assignment_digest) {
      fail("DIAGNOSTIC_ASSIGNMENT_STATE_HISTORY_INTEGRITY_VIOLATION",
        "Assignment transition history contains an invalid state or identity binding.");
    }
    expectedState = nextState;
  }
  const last = ordered.at(-1);
  if (creation.transition_id === undefined
      || state.state !== expectedState
      || String(state.state_revision) !== String(ordered.length - 1)
      || state.last_transition_id !== last.transition_id
      || iso(state.updated_at) !== iso(last.occurred_at)) {
    fail("DIAGNOSTIC_ASSIGNMENT_STATE_HISTORY_INTEGRITY_VIOLATION",
      "Assignment state projection does not match its complete immutable transition chain.");
  }
  return ordered;
}

export function verifyAssignmentStageRecord(row, assignmentRow) {
  const result = row?.result_document;
  if (!row || result?.schema_version !== DIAGNOSTIC_ASSIGNMENT_STAGE_RECORD_SCHEMA
      || sha256Digest(row.stage_input) !== row.stage_input_digest
      || sha256Digest(result) !== row.result_digest
      || result.stage_record_id !== row.stage_record_id
      || result.source_transition_id !== row.source_transition_id
      || result.source_event_digest !== row.source_event_digest
      || result.stage_input_digest !== row.stage_input_digest
      || result.stage_artifact_digest !== row.stage_artifact_digest
      || result.assignment_rules_digest !== row.assignment_rules_digest
      || result.outcome !== row.outcome
      || result.processed_at !== iso(row.processed_at)
      || (row.outcome === "assignment_created"
        && (row.assignment_id !== assignmentRow?.assignment_id
          || result.assignment_id !== assignmentRow.assignment_id
          || result.assignment_digest !== assignmentRow.assignment_digest))
      || (row.outcome === "replacement_not_performed"
        && (row.assignment_id !== null || result.assignment_id !== null
          || result.reason !== "replaced_assignment_no_longer_unclaimed"))) {
    fail("DIAGNOSTIC_ASSIGNMENT_STAGE_RECORD_INTEGRITY_VIOLATION",
      "Stored Assignment Service stage record does not match its input and result digests.");
  }
  return row;
}

export function assignmentView(row, state) {
  verifyAssignmentRow(row, state);
  return {
    assignment_id: row.assignment_id,
    assignment_series_id: row.assignment_series_id,
    case_id: row.case_id,
    evidence_package_id: row.evidence_package_id,
    assignment_policy_activation_id: row.assignment_policy_activation_id,
    ordinal: String(row.ordinal),
    assignment: row.assignment_document,
    assignment_digest: row.assignment_digest,
    record_digest: row.record_digest,
    state: {
      current: state.state,
      revision: String(state.state_revision),
      last_transition_id: state.last_transition_id,
      updated_at: iso(state.updated_at)
    },
    authority_granted: "none",
    worker_bound: false,
    execution_capability_created: false,
    model_request_created: false,
    immutable_facts: true
  };
}
