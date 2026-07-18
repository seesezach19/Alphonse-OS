import { deterministicUuid, sha256Digest } from "./canonical-json.js";
import {
  DIAGNOSTIC_ASSIGNMENT_RULES,
  DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
  DIAGNOSTIC_ASSIGNMENT_SCHEMA,
  DIAGNOSTIC_ASSIGNMENT_STAGE_INPUT_SCHEMA
} from "./diagnostic-assignment-contracts.js";

export const DIAGNOSTIC_ASSIGNMENT_STAGE_AUTHOR =
  "diagnostic-stage-worker:assignment-creation-v0.1";

function addSeconds(instant, seconds) {
  const milliseconds = Date.parse(instant) + seconds * 1000;
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(milliseconds)) {
    throw new Error("Diagnostic Assignment expiry exceeds the supported time range.");
  }
  return new Date(milliseconds).toISOString();
}

export function buildDiagnosticAssignmentStageInput({
  installationId,
  environmentId,
  sourceEvent,
  evidencePackage,
  assignmentPolicyActivation,
  stageArtifactDigest,
  ordinal = DIAGNOSTIC_ASSIGNMENT_RULES.initial_ordinal,
  consistencyTest = null,
  assignmentRulesDigest = DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST
}) {
  return {
    schema_version: DIAGNOSTIC_ASSIGNMENT_STAGE_INPUT_SCHEMA,
    installation_id: installationId,
    environment_id: environmentId,
    source_event: structuredClone(sourceEvent),
    case: { case_id: evidencePackage.case_id },
    evidence_package: {
      evidence_package_id: evidencePackage.evidence_package_id,
      semantic_digest: evidencePackage.semantic_digest,
      package_artifact_digest: evidencePackage.package_artifact_digest,
      frozen_at: evidencePackage.frozen_at
    },
    assignment_policy: {
      assignment_policy_activation_id: assignmentPolicyActivation.assignment_policy_activation_id,
      activation_digest: assignmentPolicyActivation.activation_digest,
      policy_export_id: assignmentPolicyActivation.policy_export_id,
      policy_digest: assignmentPolicyActivation.policy_digest,
      instruction_digest: assignmentPolicyActivation.instruction_digest,
      output_schema_digest: assignmentPolicyActivation.output_schema_digest
    },
    ordinal: String(ordinal),
    ...(consistencyTest ? { consistency_test: structuredClone(consistencyTest) } : {}),
    stage: {
      artifact_digest: stageArtifactDigest,
      assignment_rules_digest: assignmentRulesDigest
    }
  };
}

export function projectDiagnosticAssignment({
  stageInput,
  assignmentPolicy,
  stageArtifactDigest,
  stageAuthor = DIAGNOSTIC_ASSIGNMENT_STAGE_AUTHOR,
  assignmentRulesDigest = DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST
}) {
  const stageInputDigest = sha256Digest(stageInput);
  const seriesIdentity = {
    installation_id: stageInput.installation_id,
    environment_id: stageInput.environment_id,
    evidence_package_id: stageInput.evidence_package.evidence_package_id,
    evidence_package_semantic_digest: stageInput.evidence_package.semantic_digest,
    assignment_policy_activation_id: stageInput.assignment_policy.assignment_policy_activation_id,
    assignment_policy_activation_digest: stageInput.assignment_policy.activation_digest
  };
  const assignmentSeriesId = deterministicUuid({
    namespace: DIAGNOSTIC_ASSIGNMENT_RULES.series_identity_namespace,
    ...seriesIdentity
  });
  const assignmentId = deterministicUuid({
    namespace: DIAGNOSTIC_ASSIGNMENT_RULES.identity_namespace,
    ...seriesIdentity,
    ordinal: stageInput.ordinal
  });
  const availableAt = stageInput.source_event.occurred_at;
  const expiresAt = addSeconds(availableAt, assignmentPolicy.assignment_ttl_seconds);
  const assignment = {
    schema_version: DIAGNOSTIC_ASSIGNMENT_SCHEMA,
    assignment_id: assignmentId,
    assignment_series_id: assignmentSeriesId,
    installation_id: stageInput.installation_id,
    environment_id: stageInput.environment_id,
    case_id: stageInput.case.case_id,
    evidence_package: structuredClone(stageInput.evidence_package),
    assignment_policy: {
      assignment_policy_activation_id: stageInput.assignment_policy.assignment_policy_activation_id,
      activation_digest: stageInput.assignment_policy.activation_digest,
      policy_export_id: stageInput.assignment_policy.policy_export_id,
      policy_digest: stageInput.assignment_policy.policy_digest,
      instruction: structuredClone(assignmentPolicy.instruction),
      instruction_digest: stageInput.assignment_policy.instruction_digest,
      output_schema: structuredClone(assignmentPolicy.output_schema),
      output_schema_digest: stageInput.assignment_policy.output_schema_digest
    },
    work_requirements: {
      required_passport_class: assignmentPolicy.required_passport_class,
      required_worker_capabilities: [...assignmentPolicy.required_worker_capabilities].sort(),
      prohibitions: [...assignmentPolicy.prohibitions].sort(),
      model: structuredClone(assignmentPolicy.model_requirements),
      runtime: structuredClone(assignmentPolicy.runtime_requirements),
      isolation: structuredClone(assignmentPolicy.isolation),
      mounts: structuredClone(assignmentPolicy.mounts),
      network: structuredClone(assignmentPolicy.network),
      resources: structuredClone(assignmentPolicy.resources),
      data_classification: assignmentPolicy.data_classification,
      disclosure: structuredClone(assignmentPolicy.disclosure)
    },
    temporal: {
      available_at: availableAt,
      expires_at: expiresAt,
      freshness: "current_until_expiry",
      time_source: DIAGNOSTIC_ASSIGNMENT_RULES.semantic_time_source
    },
    ordinal: stageInput.ordinal,
    initial_state: DIAGNOSTIC_ASSIGNMENT_RULES.initial_state,
    authority: {
      authority_granted: DIAGNOSTIC_ASSIGNMENT_RULES.authority_granted,
      granted_capabilities: [],
      worker_bound: false,
      dispatch_requested: false,
      dispatch_authorized: false,
      broker_token_created: false,
      execution_capability_created: false,
      evidence_disclosed: false,
      model_contacted: false,
      provider_request_created: false
    },
    ...(stageInput.consistency_test
      ? { consistency_test: structuredClone(stageInput.consistency_test) } : {}),
    stage: {
      component: stageAuthor,
      input_digest: stageInputDigest,
      artifact_digest: stageArtifactDigest,
      assignment_rules_digest: assignmentRulesDigest,
      processing_profile: "D0"
    }
  };
  return {
    assignment_id: assignmentId,
    assignment_series_id: assignmentSeriesId,
    assignment,
    assignment_digest: sha256Digest(assignment),
    stage_input_digest: stageInputDigest
  };
}
