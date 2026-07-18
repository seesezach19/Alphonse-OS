import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import { loadStageArtifactArchive } from "./stage-artifact-archive.js";

export const INDEPENDENT_VERIFICATION_BUNDLE_SCHEMA =
  "alphonse.independent-diagnostic-verification-bundle.v0.1";
export const INDEPENDENT_VERIFICATION_BUNDLE_ARTIFACT_SCHEMA =
  "alphonse.independent-diagnostic-verification-bundle-artifact.v0.1";

const RECORD_SCHEMA = "alphonse.independent-diagnostic-verification-bundle-record.v0.1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code, message, details = {}) {
  throw new KernelError(500, code, message, details);
}

function encodeValue(value) {
  if (Buffer.isBuffer(value)) return { encoding: "base64", bytes: value.toString("base64") };
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeValue(entry)]));
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function rows(result) {
  return result.rows.map((row) => encodeValue(row));
}

function row(result, code, message) {
  const found = result.rows[0];
  if (!found) throw new KernelError(404, code, message);
  return found;
}

function materialState(outcome, receiptByPosition, documentByPosition, conflictByPosition,
  rejectionByPosition) {
  const position = String(outcome.intake_position);
  if (outcome.outcome_type === "accepted") {
    const receipt = receiptByPosition.get(position);
    return receipt ? { state: "exact_material", material_type: "accepted_receipt",
      material_id: receipt.receipt_id, material_digest: receipt.receipt_digest }
      : { state: "missing_or_corrupt_material", material_type: "accepted_receipt",
        material_id: outcome.outcome_id, material_digest: outcome.outcome_digest };
  }
  const document = documentByPosition.get(position);
  if (document) return { state: document.material_origin === "native_v0.2"
    ? "exact_material" : "verified_legacy_reconstruction", material_type: outcome.outcome_type,
  material_id: document.outcome_id, material_digest: document.document_digest };
  const legacy = outcome.outcome_type === "conflict"
    ? conflictByPosition.get(position) : rejectionByPosition.get(position);
  return legacy ? { state: "unavailable_legacy_material", material_type: outcome.outcome_type,
    material_id: outcome.outcome_id, material_digest: outcome.outcome_digest }
    : { state: "missing_or_corrupt_material", material_type: outcome.outcome_type,
      material_id: outcome.outcome_id, material_digest: outcome.outcome_digest };
}

function bundleView(record, artifact) {
  return {
    verification_bundle_id: record.verification_bundle_id,
    evidence_package_id: record.evidence_package_id,
    committed_intake_cutoff: String(record.committed_intake_cutoff),
    bundle_digest: record.bundle_digest,
    bundle_artifact_digest: record.bundle_artifact_digest,
    bundle: artifact.bundle,
    immutable: true,
    authority: "none"
  };
}

export function createIndependentDiagnosticVerificationService({
  database,
  artifactStore,
  installationId,
  environmentId,
  tokenizationVerificationIdentity,
  resolveDeploymentExports,
  materialAuthority = null
}) {
  const { pool } = database;

  async function verifyStoredRecord(record) {
    if (!record || record.record_document?.schema_version !== RECORD_SCHEMA
        || sha256Digest(record.record_document) !== record.record_digest
        || record.record_document.verification_bundle_id !== record.verification_bundle_id
        || record.record_document.evidence_package_id !== record.evidence_package_id
        || record.record_document.bundle_digest !== record.bundle_digest
        || record.record_document.bundle_artifact_digest !== record.bundle_artifact_digest
        || record.record_document.exported_at !== new Date(record.exported_at).toISOString()) {
      fail("INDEPENDENT_VERIFICATION_BUNDLE_INTEGRITY_VIOLATION",
        "Stored independent verification bundle record does not match its immutable digest.");
    }
    const stored = await artifactStore.getJson(record.bundle_artifact_digest);
    const artifact = stored.content;
    if (artifact?.schema_version !== INDEPENDENT_VERIFICATION_BUNDLE_ARTIFACT_SCHEMA
        || artifact.bundle_digest !== record.bundle_digest
        || sha256Digest(artifact.bundle) !== record.bundle_digest
        || artifact.bundle?.schema_version !== INDEPENDENT_VERIFICATION_BUNDLE_SCHEMA) {
      fail("INDEPENDENT_VERIFICATION_BUNDLE_ARTIFACT_INTEGRITY_VIOLATION",
        "Stored independent verification bundle artifact does not match its record.");
    }
    return { record, artifact };
  }

  async function existingForPackage(evidencePackageId) {
    return (await pool.query(
      `SELECT * FROM diagnostic_independent_verification_bundles
       WHERE installation_id=$1 AND environment_id=$2 AND evidence_package_id=$3`,
      [installationId, environmentId, evidencePackageId]
    )).rows[0] ?? null;
  }

  async function assemble(evidencePackageId) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const packageRow = row(await client.query(
        `SELECT * FROM diagnostic_evidence_packages
         WHERE installation_id=$1 AND environment_id=$2 AND evidence_package_id=$3`,
        [installationId, environmentId, evidencePackageId]
      ), "DIAGNOSTIC_EVIDENCE_PACKAGE_NOT_FOUND", "Diagnostic Evidence Package does not exist.");
      const cutoff = String(packageRow.committed_intake_cutoff);
      const caseRow = row(await client.query(
        `SELECT * FROM diagnostic_cases WHERE installation_id=$1 AND case_id=$2
          AND case_origin='deterministic_behavior_trigger'`,
        [installationId, packageRow.case_id]
      ), "DIAGNOSTIC_CASE_NOT_FOUND", "Deterministic Diagnostic Case does not exist.");
      const triggerRow = row(await client.query(
        "SELECT * FROM diagnostic_behavior_triggers WHERE installation_id=$1 AND trigger_id=$2",
        [installationId, caseRow.trigger_id]
      ), "DIAGNOSTIC_TRIGGER_NOT_FOUND", "Diagnostic Trigger does not exist.");
      const evaluationRow = row(await client.query(
        "SELECT * FROM diagnostic_behavior_evaluations WHERE installation_id=$1 AND evaluation_id=$2",
        [installationId, packageRow.evaluation_id ?? triggerRow.evaluation_id]
      ), "BEHAVIOR_EVALUATION_NOT_FOUND", "Behavior Evaluation does not exist.");
      const effectRow = row(await client.query(
        "SELECT * FROM diagnostic_effect_projections WHERE installation_id=$1 AND effect_projection_id=$2",
        [installationId, packageRow.effect_projection_id ?? evaluationRow.effect_projection_id]
      ), "DIAGNOSTIC_EFFECT_PROJECTION_NOT_FOUND", "Diagnostic Effect Projection does not exist.");
      const projectionRow = row(await client.query(
        "SELECT * FROM diagnostic_correlation_projections WHERE installation_id=$1 AND projection_id=$2",
        [installationId, packageRow.correlation_projection_id ?? effectRow.correlation_projection_id]
      ), "CORRELATION_PROJECTION_NOT_FOUND", "Correlation Projection does not exist.");
      if (String(projectionRow.committed_intake_cutoff) !== cutoff) {
        fail("INDEPENDENT_VERIFICATION_LINEAGE_INTEGRITY_VIOLATION",
          "Evidence package and Correlation Projection bind different committed cutoffs.");
      }
      if ((packageRow.evaluation_id && packageRow.evaluation_id !== evaluationRow.evaluation_id)
          || (packageRow.effect_projection_id
            && packageRow.effect_projection_id !== effectRow.effect_projection_id)
          || (packageRow.correlation_projection_id
            && packageRow.correlation_projection_id !== projectionRow.projection_id)
          || evaluationRow.effect_projection_id !== effectRow.effect_projection_id
          || effectRow.correlation_projection_id !== projectionRow.projection_id) {
        fail("INDEPENDENT_VERIFICATION_REVISION_LINEAGE_INTEGRITY_VIOLATION",
          "Revision package does not bind one exact projection, effect, and evaluation chain.");
      }
      const registrationRow = row(await client.query(
        "SELECT * FROM diagnostic_correlation_registrations WHERE installation_id=$1 AND registration_id=$2",
        [installationId, projectionRow.registration_id]
      ), "CORRELATION_REGISTRATION_NOT_FOUND", "Correlation Registration does not exist.");
      const interpretationRow = row(await client.query(
        "SELECT * FROM diagnostic_interpretation_activations WHERE installation_id=$1 AND activation_id=$2",
        [installationId, effectRow.activation_id]
      ), "DIAGNOSTIC_INTERPRETATION_ACTIVATION_NOT_FOUND",
      "Diagnostic interpretation activation does not exist.");
      const policyRow = row(await client.query(
        `SELECT * FROM diagnostic_evidence_policy_activations
         WHERE installation_id=$1 AND evidence_policy_activation_id=$2`,
        [installationId, packageRow.evidence_policy_activation_id]
      ), "DIAGNOSTIC_EVIDENCE_POLICY_ACTIVATION_NOT_FOUND", "Evidence policy activation does not exist.");
      const assignmentPolicyRow = packageRow.assignment_policy_activation_id ? row(await client.query(
        `SELECT * FROM diagnostic_assignment_policy_activations
         WHERE installation_id=$1 AND environment_id=$2 AND assignment_policy_activation_id=$3`,
        [installationId, environmentId, packageRow.assignment_policy_activation_id]
      ), "DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_NOT_FOUND",
      "Revision Assignment Policy activation does not exist.") : null;
      let assignmentPolicyExport = null;
      if (assignmentPolicyRow) {
        const resolved = await resolveDeploymentExports(assignmentPolicyRow.deployment_id,
          [assignmentPolicyRow.policy_export_id]);
        const exportRecord = resolved.exports.get(assignmentPolicyRow.policy_export_id);
        if (resolved.package_version_id !== assignmentPolicyRow.package_version_id
            || resolved.package_artifact_digest !== assignmentPolicyRow.package_artifact_digest
            || exportRecord?.kind !== "diagnostic_assignment_policy") {
          fail("INDEPENDENT_VERIFICATION_ASSIGNMENT_POLICY_MATERIAL_UNAVAILABLE",
            "Revision Assignment Policy cannot be resolved from its exact deployed package.");
        }
        assignmentPolicyExport = encodeValue({ deployment_id: resolved.deployment_id,
          package_version_id: resolved.package_version_id,
          package_artifact_digest: resolved.package_artifact_digest, export_record: exportRecord });
      }

      const outcomeRows = rows(await client.query(
        `SELECT * FROM diagnostic_intake_outcomes
         WHERE installation_id=$1 AND intake_position<=$2 ORDER BY intake_position`,
        [installationId, cutoff]
      ));
      const receiptRows = rows(await client.query(
        `SELECT * FROM diagnostic_observation_receipts
         WHERE installation_id=$1 AND intake_position<=$2 ORDER BY intake_position,receipt_id`,
        [installationId, cutoff]
      ));
      const conflictRows = rows(await client.query(
        `SELECT * FROM diagnostic_observation_conflicts
         WHERE installation_id=$1 AND intake_position<=$2 ORDER BY intake_position`,
        [installationId, cutoff]
      ));
      const rejectionRows = rows(await client.query(
        `SELECT * FROM diagnostic_observation_rejections
         WHERE installation_id=$1 AND intake_position<=$2 ORDER BY intake_position`,
        [installationId, cutoff]
      ));
      const documentRows = rows(await client.query(
        `SELECT * FROM diagnostic_intake_outcome_documents
         WHERE installation_id=$1 AND intake_position<=$2 ORDER BY intake_position`,
        [installationId, cutoff]
      ));
      const receiptIds = receiptRows.map((receipt) => receipt.receipt_id);
      const schemaIds = [...new Set(receiptRows.map((receipt) => receipt.schema_activation_id))];
      const dependencyRows = receiptIds.length ? rows(await client.query(
        `SELECT * FROM diagnostic_observation_provenance_dependencies
         WHERE installation_id=$1 AND observation_receipt_id=ANY($2::uuid[])
         ORDER BY observation_receipt_id,dependency_id`, [installationId, receiptIds]
      )) : [];
      const tokenIds = [...new Set(dependencyRows.map((dependency) => dependency.dependency_id))];
      const tokenRows = tokenIds.length ? rows(await client.query(
        `SELECT * FROM diagnostic_tokenization_result_receipts
         WHERE installation_id=$1 AND result_receipt_id=ANY($2::uuid[])
         ORDER BY result_receipt_id`, [installationId, tokenIds]
      )) : [];
      const schemaRows = schemaIds.length ? rows(await client.query(
        `SELECT * FROM diagnostic_observation_schema_activations
         WHERE installation_id=$1 AND activation_id=ANY($2::uuid[]) ORDER BY activation_id`,
        [installationId, schemaIds]
      )) : [];
      if (schemaRows.length && typeof resolveDeploymentExports !== "function") {
        fail("INDEPENDENT_VERIFICATION_SCHEMA_MATERIAL_UNAVAILABLE",
          "Exact deployed Schema export resolution is unavailable.");
      }
      const schemaExportRows = [];
      for (const schema of schemaRows) {
        const resolved = await resolveDeploymentExports(schema.deployment_id, [schema.schema_id]);
        const exportRecord = resolved.exports.get(schema.schema_id);
        if (!exportRecord) {
          fail("INDEPENDENT_VERIFICATION_SCHEMA_MATERIAL_UNAVAILABLE",
            "An activated Schema export cannot be retrieved from its exact deployment.", {
              activation_id: schema.activation_id
            });
        }
        schemaExportRows.push(encodeValue({ activation_id: schema.activation_id,
          deployment_id: resolved.deployment_id, package_version_id: resolved.package_version_id,
          package_artifact_digest: resolved.package_artifact_digest, export_record: exportRecord }));
      }
      const grantDigests = [...new Set(receiptRows.map((receipt) => receipt.grant_snapshot_digest))];
      const grantSnapshotRows = grantDigests.length ? rows(await client.query(
        `SELECT * FROM diagnostic_grant_activation_snapshots
         WHERE installation_id=$1 AND snapshot_digest=ANY($2::text[]) ORDER BY snapshot_digest`,
        [installationId, grantDigests]
      )) : [];
      const grantSnapshotIds = grantSnapshotRows.map((snapshot) => snapshot.snapshot_id);
      const grantApplicationRows = grantSnapshotIds.length ? rows(await client.query(
        `SELECT * FROM diagnostic_grant_application_receipts
         WHERE installation_id=$1 AND snapshot_id=ANY($2::uuid[]) ORDER BY receipt_digest`,
        [installationId, grantSnapshotIds]
      )) : [];
      const coverageRows = rows(await client.query(
        `SELECT * FROM diagnostic_observation_stream_coverage
         WHERE installation_id=$1 ORDER BY grant_id,stream_id`, [installationId]
      ));
      const claimRows = rows(await client.query(
        `SELECT * FROM diagnostic_claim_envelopes
         WHERE installation_id=$1 AND case_id=$2 ORDER BY claim_type,claim_id`,
        [installationId, caseRow.case_id]
      ));
      const leaseRow = row(await client.query(
        "SELECT * FROM diagnostic_evidence_collection_leases WHERE installation_id=$1 AND case_id=$2",
        [installationId, caseRow.case_id]
      ), "DIAGNOSTIC_EVIDENCE_COLLECTION_NOT_FOUND", "Evidence collection does not exist.");
      const referenceRows = String(packageRow.revision_number) !== "1" ? rows(await client.query(
        `SELECT * FROM diagnostic_evidence_package_references
         WHERE evidence_package_id=$1 ORDER BY reference_type,reference_id`, [evidencePackageId]
      )) : rows(await client.query(
        `SELECT * FROM diagnostic_evidence_collection_lease_references
         WHERE lease_id=$1 ORDER BY reference_type,reference_id`, [leaseRow.lease_id]
      ));
      const jobRow = row(await client.query(
        "SELECT * FROM diagnostic_evidence_collection_jobs WHERE lease_id=$1", [leaseRow.lease_id]
      ), "DIAGNOSTIC_EVIDENCE_COLLECTION_NOT_FOUND", "Evidence collection job does not exist.");
      const releaseRow = (await client.query(
        "SELECT * FROM diagnostic_evidence_collection_lease_releases WHERE evidence_package_id=$1",
        [evidencePackageId]
      )).rows[0] ?? null;
      if (String(packageRow.revision_number) === "1" && !releaseRow) {
        throw new KernelError(404, "DIAGNOSTIC_EVIDENCE_COLLECTION_RELEASE_NOT_FOUND",
          "Initial evidence package collection release does not exist.");
      }
      const assessmentRow = packageRow.predecessor_evidence_package_id ? (await client.query(
        `SELECT * FROM diagnostic_evidence_revision_assessments
         WHERE resulting_evidence_package_id=$1`, [evidencePackageId]
      )).rows[0] ?? null : null;
      const noticeRow = assessmentRow ? (await client.query(
        "SELECT * FROM diagnostic_reevaluation_notices WHERE assessment_id=$1",
        [assessmentRow.assessment_id]
      )).rows[0] ?? null : null;
      const pinRows = rows(await client.query(
        `SELECT * FROM diagnostic_artifact_retention_pins
         WHERE evidence_package_id=$1 ORDER BY object_type,object_id`, [evidencePackageId]
      ));
      const packageArtifact = await artifactStore.getJson(packageRow.package_artifact_digest);
      let predecessorVerification = null;
      if (packageRow.predecessor_evidence_package_id) {
        const predecessorRecord = row(await client.query(
          `SELECT * FROM diagnostic_independent_verification_bundles
           WHERE installation_id=$1 AND evidence_package_id=$2`,
          [installationId, packageRow.predecessor_evidence_package_id]
        ), "INDEPENDENT_VERIFICATION_PREDECESSOR_BUNDLE_NOT_FOUND",
        "Revision package predecessor does not have a sealed independent verification bundle.");
        const predecessorArtifact = await artifactStore.getJson(predecessorRecord.bundle_artifact_digest);
        predecessorVerification = {
          record: encodeValue(predecessorRecord),
          artifact: encodeValue(predecessorArtifact.content)
        };
      }
      const stageArchives = [];
      for (const digest of [registrationRow.projector_artifact_digest,
        interpretationRow.stage_artifact_digest, policyRow.stage_artifact_digest]) {
        if (stageArchives.some((entry) => entry.stage_artifact_digest === digest)) continue;
        stageArchives.push(await loadStageArtifactArchive({ client, artifactStore, installationId,
          stageArtifactDigest: digest }));
      }

      const receiptByPosition = new Map(receiptRows.map((entry) => [String(entry.intake_position), entry]));
      const documentByPosition = new Map(documentRows.map((entry) => [String(entry.intake_position), entry]));
      const conflictByPosition = new Map(conflictRows.map((entry) => [String(entry.intake_position), entry]));
      const rejectionByPosition = new Map(rejectionRows.map((entry) => [String(entry.intake_position), entry]));
      const positions = outcomeRows.map((outcome) => ({
        intake_position: String(outcome.intake_position),
        outcome_type: outcome.outcome_type,
        outcome_id: outcome.outcome_id,
        outcome_digest: outcome.outcome_digest,
        material: materialState(outcome, receiptByPosition, documentByPosition,
          conflictByPosition, rejectionByPosition)
      }));

      const bundle = {
        schema_version: INDEPENDENT_VERIFICATION_BUNDLE_SCHEMA,
        target: {
          installation_id: installationId,
          environment_id: environmentId,
          evidence_package_id: evidencePackageId,
          committed_intake_cutoff: cutoff,
          expected_bundle_scope: "complete_installation_prefix_through_cutoff"
        },
        independent_inputs: {
          positions,
          intake_outcomes: outcomeRows,
          accepted_receipts: receiptRows,
          conflicts: conflictRows,
          rejections: rejectionRows,
          outcome_documents: documentRows,
          schema_activations: schemaRows,
          schema_exports: schemaExportRows,
          provenance_dependencies: dependencyRows,
          tokenization_result_receipts: tokenRows,
          observation_grant_snapshots: grantSnapshotRows,
          observation_grant_application_receipts: grantApplicationRows,
          stream_coverage_snapshot: coverageRows,
          predecessor_verification: predecessorVerification,
          stage_artifact_archives: stageArchives,
          verification_identities: {
            tokenization_result_receipt: {
              algorithm: "Ed25519",
              service_id: "tokenization-service",
              service_key_id: tokenizationVerificationIdentity?.service_key_id ?? null,
              public_key_der_base64: tokenizationVerificationIdentity?.public_key_der_base64 ?? null,
              independently_verifiable: true
            },
            observation_envelope_hmac: {
              independently_verifiable: false,
              assurance: "accepted_by_diagnostic_plane_not_independently_reverified"
            },
            grant_snapshot_and_application_hmac: {
              independently_verifiable: false,
              assurance: "not_independently_reverified"
            }
          }
        },
        published_outputs_to_compare: {
          correlation_registration: encodeValue(registrationRow),
          correlation_projection: encodeValue(projectionRow),
          interpretation_activation: encodeValue(interpretationRow),
          diagnostic_effect_projection: encodeValue(effectRow),
          behavior_evaluation: encodeValue(evaluationRow),
          diagnostic_trigger: encodeValue(triggerRow),
          diagnostic_case: encodeValue(caseRow),
          diagnostic_claims: claimRows,
          evidence_policy_activation: encodeValue(policyRow),
          assignment_policy_activation: assignmentPolicyRow ? encodeValue(assignmentPolicyRow) : null,
          assignment_policy_export: assignmentPolicyExport,
          evidence_collection_lease: encodeValue(leaseRow),
          evidence_collection_references: referenceRows,
          evidence_collection_job: encodeValue(jobRow),
          evidence_collection_release: releaseRow ? encodeValue(releaseRow) : null,
          retention_pins: pinRows,
          evidence_package: encodeValue(packageRow),
          evidence_package_artifact: encodeValue(packageArtifact.content),
          evidence_revision_assessment: assessmentRow ? encodeValue(assessmentRow) : null,
          reevaluation_notice: noticeRow ? encodeValue(noticeRow) : null
        },
        assurance_boundary: {
          processing_profile: "D0",
          freshness: "frozen_historical",
          authority: "none",
          external_truth_established: false,
          hostile_host_resistance_claimed: false,
          full_prefix_exposure_permitted_to_worker_or_model: false
        }
      };
      await client.query("COMMIT");
      return bundle;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function sealBundleFenced(evidencePackageId, actorId, now = new Date()) {
    if (!UUID.test(evidencePackageId)) {
      throw new KernelError(400, "INDEPENDENT_VERIFICATION_BUNDLE_INPUT_INVALID",
        "evidence_package_id must be a UUID.");
    }
    if (materialAuthority) {
      const availability = await materialAuthority.getPackageAvailability(evidencePackageId);
      if (!availability.execution_eligible) throw new KernelError(409,
        "DIAGNOSTIC_EVIDENCE_PACKAGE_MATERIAL_UNAVAILABLE",
        "Independent verification material cannot be sealed from an unavailable package.", {
          evidence_package_id: evidencePackageId,
          material_status: availability.material_status,
          integrity_status: availability.integrity_status
        });
    }
    const existing = await existingForPackage(evidencePackageId);
    if (existing) {
      const verified = await verifyStoredRecord(existing);
      return { replayed: true, result: { independent_verification_bundle: bundleView(
        verified.record, verified.artifact) } };
    }
    const bundle = await assemble(evidencePackageId);
    const bundleDigest = sha256Digest(bundle);
    const artifactDocument = {
      schema_version: INDEPENDENT_VERIFICATION_BUNDLE_ARTIFACT_SCHEMA,
      bundle_digest: bundleDigest,
      bundle
    };
    const stored = await artifactStore.putJson(artifactDocument);
    const verificationBundleId = deterministicUuid({ namespace: "independent-diagnostic-verification-bundle",
      evidence_package_id: evidencePackageId, bundle_digest: bundleDigest });
    const exportedAt = new Date(now).toISOString();
    const recordDocument = {
      schema_version: RECORD_SCHEMA,
      verification_bundle_id: verificationBundleId,
      evidence_package_id: evidencePackageId,
      committed_intake_cutoff: bundle.target.committed_intake_cutoff,
      bundle_digest: bundleDigest,
      bundle_artifact_digest: stored.artifact_digest,
      exported_by: actorId,
      exported_at: exportedAt
    };
    const recordDigest = sha256Digest(recordDocument);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (materialAuthority) {
        await materialAuthority.lockMaterialMutation(client);
        await materialAuthority.assertPackageMaterialAdmissible(
          client, evidencePackageId, "independent_verification_bundle_seal"
        );
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`independent-verification-bundle:${installationId}:${evidencePackageId}`]);
      const raced = (await client.query(
        `SELECT * FROM diagnostic_independent_verification_bundles
         WHERE installation_id=$1 AND evidence_package_id=$2`, [installationId, evidencePackageId]
      )).rows[0];
      if (raced) {
        await client.query("COMMIT");
        const verified = await verifyStoredRecord(raced);
        if (verified.record.bundle_digest !== bundleDigest) {
          fail("INDEPENDENT_VERIFICATION_BUNDLE_NONDETERMINISM",
            "The same frozen package lineage produced a different verification bundle.");
        }
        return { replayed: true, result: { independent_verification_bundle: bundleView(
          verified.record, verified.artifact) } };
      }
      await client.query(
        `INSERT INTO diagnostic_artifacts
          (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
        [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
          stored.storage_key, exportedAt]
      );
      const inserted = (await client.query(
        `INSERT INTO diagnostic_independent_verification_bundles
          (verification_bundle_id,installation_id,environment_id,evidence_package_id,
           committed_intake_cutoff,bundle_artifact_digest,bundle_digest,record_document,record_digest,
           exported_by,exported_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [verificationBundleId, installationId, environmentId, evidencePackageId,
          bundle.target.committed_intake_cutoff, stored.artifact_digest, bundleDigest,
          recordDocument, recordDigest, actorId, exportedAt]
      )).rows[0];
      await client.query("COMMIT");
      return { replayed: false, result: { independent_verification_bundle: bundleView(inserted,
        { bundle }) } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function sealBundle(evidencePackageId, actorId, now = new Date()) {
    return materialAuthority
      ? materialAuthority.runMaterialMutationExclusive(() =>
        sealBundleFenced(evidencePackageId, actorId, now))
      : sealBundleFenced(evidencePackageId, actorId, now);
  }

  async function getBundleFenced(evidencePackageId) {
    if (!UUID.test(evidencePackageId)) throw new KernelError(400,
      "INDEPENDENT_VERIFICATION_BUNDLE_INPUT_INVALID", "evidence_package_id must be a UUID.");
    if (materialAuthority) {
      const availability = await materialAuthority.getPackageAvailability(evidencePackageId);
      if (!availability.execution_eligible) throw new KernelError(409,
        "DIAGNOSTIC_EVIDENCE_PACKAGE_MATERIAL_UNAVAILABLE",
        "Independent verification bundle is no longer disclosable because package material is unavailable.", {
          evidence_package_id: evidencePackageId,
          material_status: availability.material_status
        });
    }
    const record = await existingForPackage(evidencePackageId);
    if (!record) throw new KernelError(404, "INDEPENDENT_VERIFICATION_BUNDLE_NOT_FOUND",
      "Independent verification bundle has not been sealed for this package.");
    const verified = await verifyStoredRecord(record);
    return bundleView(verified.record, verified.artifact);
  }

  async function getBundle(evidencePackageId) {
    return materialAuthority
      ? materialAuthority.runMaterialMutationExclusive(() => getBundleFenced(evidencePackageId))
      : getBundleFenced(evidencePackageId);
  }

  return { getBundle, sealBundle };
}
