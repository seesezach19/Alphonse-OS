import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import {
  calculateRetentionRequirements,
  validateDiagnosticRetentionPolicy,
  validateEvidenceSelectionPolicy
} from "./diagnostic-evidence-contracts.js";
import { KernelError } from "./errors.js";

export const EVIDENCE_POLICY_ACTIVATION_SCHEMA = "alphonse.evidence-policy-activation.v0.1";
export const EVIDENCE_COLLECTION_LEASE_SCHEMA = "alphonse.evidence-collection-retention-lease.v0.1";
export const EVIDENCE_COLLECTION_LEASE_RELEASE_SCHEMA =
  "alphonse.evidence-collection-lease-release.v0.1";

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function fail(code, message, details = {}) {
  throw new KernelError(500, code, message, details);
}

function iso(value) {
  return new Date(value).toISOString();
}

function addSeconds(instant, seconds) {
  const startMilliseconds = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  const milliseconds = startMilliseconds + seconds * 1000;
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(milliseconds)) {
    fail("DIAGNOSTIC_RETENTION_HORIZON_OVERFLOW", "Retention horizon exceeds the supported time range.");
  }
  return new Date(milliseconds).toISOString();
}

function canonicalReferences(references) {
  return references.map((reference) => ({
    reference_type: reference.reference_type,
    reference_id: reference.reference_id,
    reference_digest: reference.reference_digest,
    artifact_digest: reference.artifact_digest ?? null
  })).sort((left, right) => {
    const leftBytes = canonicalize(left);
    const rightBytes = canonicalize(right);
    return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
  });
}

export function verifyEvidencePolicyActivationRow(row, installationId, environmentId) {
  const document = row?.activation_document;
  if (!row || document?.schema_version !== EVIDENCE_POLICY_ACTIVATION_SCHEMA
      || sha256Digest(document) !== row.activation_digest
      || document.evidence_policy_activation_id !== row.evidence_policy_activation_id
      || document.installation_id !== installationId
      || document.environment_id !== environmentId
      || document.interpretation_activation_id !== row.interpretation_activation_id
      || document.deployment_id !== row.deployment_id
      || document.package_version_id !== row.package_version_id
      || document.package_artifact_digest !== row.package_artifact_digest
      || document.exports.evidence_selection_policy.export_id !== row.selection_export_id
      || document.exports.evidence_selection_policy.export_digest !== row.selection_policy_digest
      || document.exports.diagnostic_retention_policy.export_id !== row.retention_export_id
      || document.exports.diagnostic_retention_policy.export_digest !== row.retention_policy_digest
      || sha256Digest(row.selection_policy) !== row.selection_policy_digest
      || sha256Digest(row.retention_policy) !== row.retention_policy_digest
      || !same(document.retention_requirements, row.retention_requirements)
      || !same(document.stage.artifact_manifest, row.stage_artifact_manifest)
      || document.stage.artifact_digest !== row.stage_artifact_digest
      || sha256Digest(row.stage_artifact_manifest) !== row.stage_artifact_digest
      || document.stage.selection_rules_digest !== row.selection_rules_digest) {
    fail("DIAGNOSTIC_EVIDENCE_POLICY_ACTIVATION_INTEGRITY_VIOLATION",
      "Stored evidence policy activation does not match its immutable material.");
  }
  validateEvidenceSelectionPolicy(row.selection_policy);
  validateDiagnosticRetentionPolicy(row.retention_policy);
  if (!same(calculateRetentionRequirements(row.retention_policy), row.retention_requirements)) {
    fail("DIAGNOSTIC_EVIDENCE_POLICY_ACTIVATION_INTEGRITY_VIOLATION",
      "Stored cumulative retention requirements do not recompute from the activated policy.");
  }
  return row;
}

export async function getEvidencePolicyActivation(client, {
  installationId,
  environmentId,
  evidencePolicyActivationId
}) {
  const row = (await client.query(
    `SELECT * FROM diagnostic_evidence_policy_activations
     WHERE installation_id=$1 AND environment_id=$2 AND evidence_policy_activation_id=$3`,
    [installationId, environmentId, evidencePolicyActivationId]
  )).rows[0];
  if (!row) {
    throw new KernelError(404, "DIAGNOSTIC_EVIDENCE_POLICY_ACTIVATION_NOT_FOUND",
      "Evidence policy activation does not exist.");
  }
  return verifyEvidencePolicyActivationRow(row, installationId, environmentId);
}

function verifyLeaseRow(row, installationId = row?.installation_id, environmentId = row?.environment_id) {
  const document = row?.lease_document;
  if (!row || document?.schema_version !== EVIDENCE_COLLECTION_LEASE_SCHEMA
      || sha256Digest(document) !== row.lease_digest
      || document.lease_id !== row.lease_id
      || document.installation_id !== installationId
      || document.environment_id !== environmentId
      || row.installation_id !== installationId
      || row.environment_id !== environmentId
      || document.case_id !== row.case_id
      || document.trigger_id !== row.trigger_id
      || document.evidence_policy_activation_id !== row.evidence_policy_activation_id
      || document.collection_deadline !== iso(row.collection_deadline)
      || document.lease_expires_at !== iso(row.lease_expires_at)
      || document.created_at !== iso(row.created_at)) {
    fail("DIAGNOSTIC_EVIDENCE_COLLECTION_LEASE_INTEGRITY_VIOLATION",
      "Stored Evidence Collection Retention Lease does not match its immutable digest.");
  }
  return row;
}

function referenceMaterial(references) {
  return canonicalReferences(references.map((reference) => ({
    reference_type: reference.reference_type,
    reference_id: reference.reference_id,
    reference_digest: reference.reference_digest,
    artifact_digest: reference.artifact_digest
  })));
}

function verifyJobRow(job, row) {
  const expectedJobId = deterministicUuid({ namespace: "diagnostic-evidence-collection-job",
    lease_id: row.lease_id });
  if (!job || job.job_id !== expectedJobId || job.installation_id !== row.installation_id
      || job.environment_id !== row.environment_id || job.case_id !== row.case_id
      || job.lease_id !== row.lease_id || iso(job.wake_at) !== iso(row.collection_deadline)
      || iso(job.created_at) !== iso(row.created_at)) {
    fail("DIAGNOSTIC_EVIDENCE_COLLECTION_JOB_INTEGRITY_VIOLATION",
      "Durable collection scheduler state does not bind the exact immutable lease.");
  }
  return job;
}

function verifyReleaseMaterial({ release, row, references, packageRow, pins, retentionPolicy }) {
  const document = release?.release_document;
  const expectedReferenceManifest = sha256Digest(referenceMaterial(references));
  const pinMaterials = [
    {
      reference_type: "diagnostic_evidence_package",
      reference_id: packageRow?.evidence_package_id,
      reference_digest: packageRow?.semantic_digest,
      artifact_digest: packageRow?.package_artifact_digest
    },
    ...referenceMaterial(references)
  ].sort((left, right) => {
    const leftBytes = canonicalize(left);
    const rightBytes = canonicalize(right);
    return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
  });
  const storedPinMaterials = pins.map((pin) => ({
    reference_type: pin.object_type,
    reference_id: pin.object_id,
    reference_digest: pin.object_digest,
    artifact_digest: pin.artifact_digest
  })).sort((left, right) => {
    const leftBytes = canonicalize(left);
    const rightBytes = canonicalize(right);
    return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
  });
  const expectedExpiry = addSeconds(release.released_at, retentionPolicy.package_pin_seconds);
  if (!document || document.schema_version !== EVIDENCE_COLLECTION_LEASE_RELEASE_SCHEMA
      || sha256Digest(document) !== release.release_digest
      || release.lease_id !== row.lease_id || release.installation_id !== row.installation_id
      || document.lease_id !== row.lease_id || document.lease_digest !== row.lease_digest
      || document.evidence_package_id !== packageRow?.evidence_package_id
      || release.evidence_package_id !== packageRow?.evidence_package_id
      || document.evidence_package_semantic_digest !== packageRow?.semantic_digest
      || document.package_artifact_digest !== packageRow?.package_artifact_digest
      || document.reference_manifest_digest !== expectedReferenceManifest
      || document.retention_pin_manifest_digest !== sha256Digest(pinMaterials)
      || document.released_at !== iso(release.released_at)
      || !same(pinMaterials, storedPinMaterials)
      || pins.some((pin) => pin.evidence_package_id !== packageRow.evidence_package_id
        || pin.installation_id !== row.installation_id
        || pin.retention_policy_digest !== row.lease_document.retention_policy_digest
        || iso(pin.expires_at) !== expectedExpiry)) {
    fail("DIAGNOSTIC_EVIDENCE_COLLECTION_RELEASE_INTEGRITY_VIOLATION",
      "Lease release does not match the exact package, reference manifest, and replacement retention pins.");
  }
}

function leaseView(row, references, release, job) {
  return {
    lease_id: row.lease_id,
    case_id: row.case_id,
    trigger_id: row.trigger_id,
    evidence_policy_activation_id: row.evidence_policy_activation_id,
    collection_deadline: iso(row.collection_deadline),
    lease_expires_at: iso(row.lease_expires_at),
    lease_digest: row.lease_digest,
    references: references.map((reference) => ({
      reference_type: reference.reference_type,
      reference_id: reference.reference_id,
      reference_digest: reference.reference_digest,
      artifact_digest: reference.artifact_digest,
      reference_stage: reference.reference_stage,
      created_at: iso(reference.created_at)
    })),
    state: release ? "released_to_package_pins" : "active",
    release: release ? {
      evidence_package_id: release.evidence_package_id,
      release_digest: release.release_digest,
      released_at: iso(release.released_at)
    } : null,
    scheduler: job ? {
      job_id: job.job_id,
      status: job.status,
      wake_at: iso(job.wake_at),
      attempt_count: job.attempt_count,
      last_attempt_at: job.last_attempt_at ? iso(job.last_attempt_at) : null,
      completed_at: job.completed_at ? iso(job.completed_at) : null,
      last_error_code: job.last_error_code
    } : null,
    immutable: true
  };
}

export async function loadEvidenceCollection(client, installationId, caseId, options = {}) {
  const suffix = options.forUpdate ? " FOR UPDATE" : "";
  const row = (await client.query(
    `SELECT * FROM diagnostic_evidence_collection_leases
     WHERE installation_id=$1 AND case_id=$2${suffix}`,
    [installationId, caseId]
  )).rows[0];
  if (!row) {
    throw new KernelError(404, "DIAGNOSTIC_EVIDENCE_COLLECTION_NOT_FOUND",
      "Evidence collection does not exist for this case.");
  }
  verifyLeaseRow(row, installationId, row.environment_id);
  const references = (await client.query(
    `SELECT * FROM diagnostic_evidence_collection_lease_references
     WHERE lease_id=$1 ORDER BY reference_type,reference_id`, [row.lease_id]
  )).rows;
  const release = (await client.query(
    "SELECT * FROM diagnostic_evidence_collection_lease_releases WHERE lease_id=$1", [row.lease_id]
  )).rows[0] ?? null;
  const job = (await client.query(
    "SELECT * FROM diagnostic_evidence_collection_jobs WHERE lease_id=$1", [row.lease_id]
  )).rows[0] ?? null;
  const policyActivation = await getEvidencePolicyActivation(client, {
    installationId,
    environmentId: row.environment_id,
    evidencePolicyActivationId: row.evidence_policy_activation_id
  });
  const trigger = (await client.query(
    "SELECT trigger_digest FROM diagnostic_behavior_triggers WHERE trigger_id=$1", [row.trigger_id]
  )).rows[0];
  const initialReferences = references.filter((reference) => reference.reference_stage === "trigger_input");
  if (!trigger || row.lease_document.trigger_digest !== trigger.trigger_digest
      || row.lease_document.evidence_policy_activation_digest !== policyActivation.activation_digest
      || row.lease_document.retention_policy_digest !== policyActivation.retention_policy_digest
      || !same(row.lease_document.retention_requirements, policyActivation.retention_requirements)
      || row.lease_document.initial_reference_manifest_digest
        !== sha256Digest(referenceMaterial(initialReferences))) {
    fail("DIAGNOSTIC_EVIDENCE_COLLECTION_LEASE_INTEGRITY_VIOLATION",
      "Evidence Collection Retention Lease does not bind its exact trigger, policy, and initial references.");
  }
  verifyJobRow(job, row);
  if (release) {
    const packageRow = (await client.query(
      "SELECT * FROM diagnostic_evidence_packages WHERE evidence_package_id=$1",
      [release.evidence_package_id]
    )).rows[0];
    const pins = (await client.query(
      `SELECT * FROM diagnostic_artifact_retention_pins
       WHERE evidence_package_id=$1 ORDER BY object_type,object_id`, [release.evidence_package_id]
    )).rows;
    verifyReleaseMaterial({ release, row, references, packageRow, pins,
      retentionPolicy: policyActivation.retention_policy });
  }
  return { row, references, release, job, view: leaseView(row, references, release, job) };
}

export async function createEvidenceCollectionForTrigger({
  client,
  installationId,
  environmentId,
  caseId,
  triggerId,
  triggerDigest,
  evidencePolicyActivation,
  initialReferences,
  createdAt
}) {
  const references = canonicalReferences(initialReferences);
  const collectionDeadline = addSeconds(createdAt,
    evidencePolicyActivation.retention_policy.collection_window_seconds);
  const leaseExpiresAt = addSeconds(createdAt,
    evidencePolicyActivation.retention_policy.collection_lease_seconds);
  const leaseId = deterministicUuid({
    namespace: "diagnostic-evidence-collection-lease",
    trigger_id: triggerId,
    evidence_policy_activation_digest: evidencePolicyActivation.activation_digest
  });
  const document = {
    schema_version: EVIDENCE_COLLECTION_LEASE_SCHEMA,
    lease_id: leaseId,
    installation_id: installationId,
    environment_id: environmentId,
    case_id: caseId,
    trigger_id: triggerId,
    trigger_digest: triggerDigest,
    evidence_policy_activation_id: evidencePolicyActivation.evidence_policy_activation_id,
    evidence_policy_activation_digest: evidencePolicyActivation.activation_digest,
    retention_policy_digest: evidencePolicyActivation.retention_policy_digest,
    retention_requirements: structuredClone(evidencePolicyActivation.retention_requirements),
    initial_reference_manifest_digest: sha256Digest(references),
    collection_deadline: collectionDeadline,
    lease_expires_at: leaseExpiresAt,
    created_at: createdAt
  };
  const leaseDigest = sha256Digest(document);
  const row = (await client.query(
    `INSERT INTO diagnostic_evidence_collection_leases
      (lease_id,installation_id,environment_id,case_id,trigger_id,evidence_policy_activation_id,
       collection_deadline,lease_expires_at,lease_document,lease_digest,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [leaseId, installationId, environmentId, caseId, triggerId,
      evidencePolicyActivation.evidence_policy_activation_id, collectionDeadline, leaseExpiresAt,
      document, leaseDigest, createdAt]
  )).rows[0];
  for (const reference of references) {
    await client.query(
      `INSERT INTO diagnostic_evidence_collection_lease_references
        (lease_id,installation_id,reference_type,reference_id,reference_digest,artifact_digest,
         reference_stage,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'trigger_input',$7)`,
      [leaseId, installationId, reference.reference_type, reference.reference_id,
        reference.reference_digest, reference.artifact_digest, createdAt]
    );
  }
  const jobId = deterministicUuid({ namespace: "diagnostic-evidence-collection-job", lease_id: leaseId });
  await client.query(
    `INSERT INTO diagnostic_evidence_collection_jobs
      (job_id,installation_id,environment_id,case_id,lease_id,status,wake_at,attempt_count,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'pending',$6,0,$7,$7)`,
    [jobId, installationId, environmentId, caseId, leaseId, collectionDeadline, createdAt]
  );
  return loadEvidenceCollection(client, installationId, caseId);
}

export async function extendEvidenceCollectionReferences({
  client,
  installationId,
  collection,
  references,
  createdAt
}) {
  if (collection.release) {
    fail("DIAGNOSTIC_EVIDENCE_COLLECTION_ALREADY_RELEASED",
      "Released collection leases cannot acquire new references.");
  }
  for (const reference of canonicalReferences(references)) {
    const existing = (await client.query(
      `SELECT * FROM diagnostic_evidence_collection_lease_references
       WHERE lease_id=$1 AND reference_type=$2 AND reference_id=$3`,
      [collection.row.lease_id, reference.reference_type, reference.reference_id]
    )).rows[0];
    if (existing) {
      if (existing.reference_digest !== reference.reference_digest
          || existing.artifact_digest !== reference.artifact_digest) {
        fail("DIAGNOSTIC_EVIDENCE_COLLECTION_REFERENCE_CONFLICT",
          "A collection reference identity resolved to different immutable material.", reference);
      }
      continue;
    }
    await client.query(
      `INSERT INTO diagnostic_evidence_collection_lease_references
        (lease_id,installation_id,reference_type,reference_id,reference_digest,artifact_digest,
         reference_stage,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'collection_extension',$7)`,
      [collection.row.lease_id, installationId, reference.reference_type, reference.reference_id,
        reference.reference_digest, reference.artifact_digest, createdAt]
    );
  }
}

export function evidencePolicyActivationView(row) {
  return {
    evidence_policy_activation_id: row.evidence_policy_activation_id,
    interpretation_activation_id: row.interpretation_activation_id,
    deployment_id: row.deployment_id,
    package_version_id: row.package_version_id,
    package_artifact_digest: row.package_artifact_digest,
    exports: row.activation_document.exports,
    retention_requirements: row.retention_requirements,
    stage: row.activation_document.stage,
    activation_digest: row.activation_digest,
    activated_by: row.activated_by,
    activated_at: iso(row.activated_at),
    authority_granted: false,
    immutable: true
  };
}
