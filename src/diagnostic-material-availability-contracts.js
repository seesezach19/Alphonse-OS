import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const DIAGNOSTIC_MATERIAL_ERASURE_DECISION_SCHEMA =
  "alphonse.diagnostic-material-erasure-decision.v0.1";
export const DIAGNOSTIC_MATERIAL_IMPACT_MANIFEST_SCHEMA =
  "alphonse.diagnostic-material-erasure-impact.v0.1";
export const DIAGNOSTIC_MATERIAL_DELETION_ATTEMPT_SCHEMA =
  "alphonse.diagnostic-material-deletion-attempt.v0.1";
export const DIAGNOSTIC_MATERIAL_TOMBSTONE_SCHEMA =
  "alphonse.diagnostic-artifact-erasure-tombstone.v0.1";
export const DIAGNOSTIC_PACKAGE_MATERIAL_AVAILABILITY_SCHEMA =
  "alphonse.diagnostic-package-material-availability.v0.1";

export const DIAGNOSTIC_MATERIAL_ERASURE_POLICY = Object.freeze({
  schema_version: "alphonse.diagnostic-material-erasure-policy.v0.1",
  policy_id: "alphonse:local-diagnostic-material-erasure:v0.1",
  decision_effect: "availability_revoked_on_commit",
  physical_deletion: "idempotent_local_follow_up",
  overrideable_retention_classes: [
    "active_case", "audit", "diagnosis", "package_pin", "review", "worker_run"
  ],
  legal_hold_override: "prohibited",
  package_execution_after_revocation: "prohibited",
  external_deletion_claim: "prohibited_without_location_specific_verification"
});
export const DIAGNOSTIC_MATERIAL_ERASURE_POLICY_DIGEST =
  sha256Digest(DIAGNOSTIC_MATERIAL_ERASURE_POLICY);

export const DIAGNOSTIC_MATERIAL_REASON_CODES = Object.freeze([
  "privacy_request", "security_response", "legal_requirement", "customer_retention_request"
]);
export const DIAGNOSTIC_MATERIAL_OVERRIDE_CLASSES = Object.freeze([
  "active_case", "audit", "diagnosis", "package_pin", "review", "worker_run"
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function fail(message, details = {}) {
  throw new KernelError(400, "DIAGNOSTIC_MATERIAL_ERASURE_INPUT_INVALID", message, details);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object.`);
  return value;
}

function exact(value, field, keys) {
  object(value, field);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalize(actual) !== canonicalize(expected)) {
    fail(`${field} fields must be exact.`, { expected, received: actual });
  }
  return value;
}

function string(value, field, maximum = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    fail(`${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function uuid(value, field) {
  const result = string(value, field, 36);
  if (!UUID.test(result)) fail(`${field} must be a UUID.`);
  return result;
}

function digest(value, field) {
  const result = string(value, field, 80);
  if (!DIGEST.test(result)) fail(`${field} must be an exact SHA-256 digest.`);
  return result;
}

function exactSet(value, field, allowed) {
  if (!Array.isArray(value) || value.length > allowed.length
      || value.some((entry) => typeof entry !== "string" || !allowed.includes(entry))
      || new Set(value).size !== value.length) {
    fail(`${field} must be a unique subset of the closed vocabulary.`, { allowed });
  }
  return [...value].sort();
}

export function validateMaterialErasureCommand(value, operationId = "diagnostic.material_erasure.request") {
  const envelope = exact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) fail(`operation_id must be ${operationId}.`);
  const input = exact(envelope.input, "input", [
    "erasure_decision_id", "artifact_digest", "reason_code", "reason",
    "override_retention_classes"
  ]);
  const reasonCode = string(input.reason_code, "input.reason_code", 80);
  if (!DIAGNOSTIC_MATERIAL_REASON_CODES.includes(reasonCode)) {
    fail("input.reason_code is unsupported.", { allowed: DIAGNOSTIC_MATERIAL_REASON_CODES });
  }
  return {
    command_id: string(envelope.command_id, "command_id", 160),
    operation_id: operationId,
    input: {
      erasure_decision_id: uuid(input.erasure_decision_id, "input.erasure_decision_id"),
      artifact_digest: digest(input.artifact_digest, "input.artifact_digest"),
      reason_code: reasonCode,
      reason: string(input.reason, "input.reason", 500),
      override_retention_classes: exactSet(input.override_retention_classes,
        "input.override_retention_classes", DIAGNOSTIC_MATERIAL_OVERRIDE_CLASSES)
    }
  };
}

export function validateMaterialDeletionCommand(value) {
  const operationId = "diagnostic.material_erasure.complete";
  const envelope = exact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) fail(`operation_id must be ${operationId}.`);
  const input = exact(envelope.input, "input", ["erasure_decision_id"]);
  return {
    command_id: string(envelope.command_id, "command_id", 160),
    operation_id: operationId,
    input: { erasure_decision_id: uuid(input.erasure_decision_id, "input.erasure_decision_id") }
  };
}

export function canonicalImpactManifest({ artifactDigest, materialClass, affectedPackages,
  affectedAssignments, retainedRepresentations }) {
  const compareCanonical = (left, right) => {
    const leftBytes = canonicalize(left);
    const rightBytes = canonicalize(right);
    return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
  };
  const manifest = {
    schema_version: DIAGNOSTIC_MATERIAL_IMPACT_MANIFEST_SCHEMA,
    artifact_digest: digest(artifactDigest, "artifact_digest"),
    material_class: string(materialClass, "material_class", 100),
    affected_packages: [...affectedPackages].sort(compareCanonical),
    affected_assignments: [...affectedAssignments].sort(compareCanonical),
    local_locations: [{ location: "local_primary_cas", deletion_status: "pending" }],
    retained_representations: [...new Set(retainedRepresentations)].sort(),
    replica_and_provider_limitations: [
      { location_class: "local_backups_and_unregistered_replicas", status: "not_verified" },
      { location_class: "prior_worker_or_model_disclosures", status: "not_established" }
    ]
  };
  return { document: manifest, digest: sha256Digest(manifest) };
}

export function buildErasureDecisionDocument({ decisionId, installationId, environmentId,
  artifactDigest, materialClass, reasonCode, reason, overrideRetentionClasses,
  impactManifest, impactManifestDigest, actor, requestedAt }) {
  const document = {
    schema_version: DIAGNOSTIC_MATERIAL_ERASURE_DECISION_SCHEMA,
    erasure_decision_id: decisionId,
    installation_id: installationId,
    environment_id: environmentId,
    artifact_digest: artifactDigest,
    material_class: materialClass,
    reason_code: reasonCode,
    reason,
    governing_policy: structuredClone(DIAGNOSTIC_MATERIAL_ERASURE_POLICY),
    governing_policy_digest: DIAGNOSTIC_MATERIAL_ERASURE_POLICY_DIGEST,
    override_retention_classes: [...overrideRetentionClasses].sort(),
    impact_manifest: structuredClone(impactManifest),
    impact_manifest_digest: impactManifestDigest,
    authority_decision: {
      authenticated_actor: { type: actor.type, id: actor.id },
      authorization: structuredClone(actor.authorization ?? {})
    },
    requested_at: new Date(requestedAt).toISOString(),
    immediate_effect: {
      material_access: "revoked",
      package_execution_eligibility: "revoked",
      physical_deletion: "pending"
    }
  };
  return { document, digest: sha256Digest(document) };
}

export function projectPackageMaterialAvailability({ evidencePackageId, prior = null,
  erasureDecisionId, artifactDigest, rootMaterial, cause, currentAsOf }) {
  const decisionIds = [...new Set([
    ...(prior?.erasure_decision_ids ?? []), erasureDecisionId
  ])].sort();
  const artifactDigests = [...new Set([
    ...(prior?.affected_artifact_digests ?? []), artifactDigest
  ])].sort();
  const materialStatus = rootMaterial || prior?.material_status === "material_unavailable"
    ? "material_unavailable" : "partially_unavailable";
  const document = {
    schema_version: DIAGNOSTIC_PACKAGE_MATERIAL_AVAILABILITY_SCHEMA,
    evidence_package_id: evidencePackageId,
    material_status: materialStatus,
    execution_eligible: false,
    integrity_status: "verified_governed_erasure",
    cause,
    erasure_decision_ids: decisionIds,
    affected_artifact_digests: artifactDigests,
    current_as_of: new Date(currentAsOf).toISOString(),
    temporal_claim: "current_material_availability_not_historical_package_identity"
  };
  return { document, digest: sha256Digest(document) };
}

export function buildDeletionAttemptDocument({ attemptId, decision, outcome,
  verificationStatus, errorCode, attemptedBy, attemptedAt }) {
  const document = {
    schema_version: DIAGNOSTIC_MATERIAL_DELETION_ATTEMPT_SCHEMA,
    deletion_attempt_id: attemptId,
    erasure_decision_id: decision.erasure_decision_id,
    artifact_digest: decision.artifact_digest,
    local_location: "local_primary_cas",
    outcome,
    verification_status: verificationStatus,
    error_code: errorCode,
    attempted_by: attemptedBy,
    attempted_at: new Date(attemptedAt).toISOString()
  };
  return { document, digest: sha256Digest(document) };
}

export function buildMaterialTombstoneDocument({ decision, deletionAttempt, completedAt }) {
  const document = {
    schema_version: DIAGNOSTIC_MATERIAL_TOMBSTONE_SCHEMA,
    erasure_decision_id: decision.erasure_decision_id,
    decision_digest: decision.decision_digest,
    artifact_digest: decision.artifact_digest,
    material_class: decision.material_class,
    governing_policy_digest: decision.governing_policy_digest,
    impact_manifest_digest: decision.impact_manifest_digest,
    deletion_attempt_id: deletionAttempt.deletion_attempt_id,
    deletion_attempt_digest: deletionAttempt.attempt_digest,
    local_primary_cas: { status: "verified_absent", verified_at: new Date(completedAt).toISOString() },
    retained_representations: structuredClone(decision.impact_manifest.retained_representations),
    replica_and_provider_limitations:
      structuredClone(decision.impact_manifest.replica_and_provider_limitations),
    universal_deletion_established: false,
    completed_at: new Date(completedAt).toISOString()
  };
  return { document, digest: sha256Digest(document) };
}
