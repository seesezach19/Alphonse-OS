import { randomUUID } from "node:crypto";

import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import { verifyProjectedObservationMaterials } from "./correlation-input-integrity.js";
import {
  calculateRetentionRequirements,
  validateDiagnosticRetentionPolicy,
  validateEvidenceSelectionPolicy
} from "./diagnostic-evidence-contracts.js";
import {
  evidencePolicyActivationView,
  extendEvidenceCollectionReferences,
  getEvidencePolicyActivation,
  loadEvidenceCollection,
  verifyEvidencePolicyActivationRow,
  EVIDENCE_COLLECTION_LEASE_RELEASE_SCHEMA,
  EVIDENCE_POLICY_ACTIVATION_SCHEMA
} from "./diagnostic-evidence-collection-persistence.js";
import {
  DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST,
  DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_MANIFEST
} from "./diagnostic-evidence-artifact.js";
import {
  decideEvidenceFreeze,
  DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST,
  selectDiagnosticEvidence
} from "./diagnostic-evidence-selector.js";
import {
  buildEvidencePackageMaterial,
  classifyEvidenceMaterialChange,
  DIAGNOSTIC_EVIDENCE_REVISION_ASSESSMENT_SCHEMA,
  DIAGNOSTIC_EVIDENCE_REVISION_RULES_DIGEST,
  DIAGNOSTIC_REEVALUATION_NOTICE_SCHEMA
} from "./diagnostic-evidence-revision.js";
import { KernelError } from "./errors.js";
import { prepareStageArtifactArchive, recordStageArtifactArchive } from "./stage-artifact-archive.js";
import { resolveLateEvidenceAssignmentAction } from "./diagnostic-assignment-contracts.js";
import { getAssignmentPolicyActivation } from "./diagnostic-assignment-persistence.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVATION_EXPORT_VERSION = "0.1.0";
const LEGACY_PACKAGE_SCHEMA = "alphonse.diagnostic-evidence-package.v0.1";
const PACKAGE_SCHEMA = "alphonse.diagnostic-evidence-package.v0.2";
const LEGACY_PACKAGE_ARTIFACT_SCHEMA = "alphonse.diagnostic-evidence-package-artifact.v0.1";
const PACKAGE_ARTIFACT_SCHEMA = "alphonse.diagnostic-evidence-package-artifact.v0.2";
const LEGACY_PACKAGE_RECORD_SCHEMA = "alphonse.diagnostic-evidence-package-record.v0.1";
const PACKAGE_RECORD_SCHEMA = "alphonse.diagnostic-evidence-package-record.v0.2";
const STAGE_AUTHOR = "diagnostic-stage-worker:evidence-packaging-v0.2";

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function iso(value) {
  return new Date(value).toISOString();
}

function compareCanonical(left, right) {
  const leftBytes = canonicalize(left);
  const rightBytes = canonicalize(right);
  return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "DIAGNOSTIC_EVIDENCE_INPUT_INVALID", `${field} must be an object.`);
  }
  return value;
}

function exact(value, field, keys) {
  object(value, field);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!same(actual, expected)) {
    throw new KernelError(400, "DIAGNOSTIC_EVIDENCE_INPUT_INVALID", `${field} fields must be exact.`, {
      expected, received: actual
    });
  }
  return value;
}

function uuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new KernelError(400, "DIAGNOSTIC_EVIDENCE_INPUT_INVALID", `${field} must be a UUID.`);
  }
  return value;
}

function failIntegrity(code, message, details = {}) {
  throw new KernelError(500, code, message, details);
}

function exportReference(entry) {
  return {
    kind: entry.kind,
    export_id: entry.export_id,
    contract_version: entry.contract_version,
    export_digest: sha256Digest(entry.content)
  };
}

function packageReference(type, id, digest, artifactDigest = null) {
  return {
    reference_type: type,
    reference_id: id,
    reference_digest: digest,
    artifact_digest: artifactDigest
  };
}

function uniquePackageReferences(references) {
  const byIdentity = new Map();
  for (const reference of references) {
    const key = `${reference.reference_type}\u0000${reference.reference_id}`;
    const existing = byIdentity.get(key);
    if (existing && (existing.reference_digest !== reference.reference_digest
        || existing.artifact_digest !== reference.artifact_digest)) {
      failIntegrity("DIAGNOSTIC_EVIDENCE_PACKAGE_REFERENCE_CONFLICT",
        "One package reference identity resolves to different immutable material.", { reference });
    }
    if (!existing) byIdentity.set(key, reference);
  }
  return [...byIdentity.values()].sort(compareCanonical);
}

function packageRowView(row) {
  return {
    evidence_package_id: row.evidence_package_id,
    case_id: row.case_id,
    trigger_id: row.trigger_id,
    evidence_policy_activation_id: row.evidence_policy_activation_id,
    revision_number: String(row.revision_number),
    committed_intake_cutoff: String(row.committed_intake_cutoff),
    freeze_reason: row.freeze_reason,
    predecessor_evidence_package_id: row.predecessor_evidence_package_id ?? null,
    package_material: row.package_material ?? null,
    package_material_digest: row.package_material_digest ?? null,
    correlation_projection_id: row.correlation_projection_id ?? null,
    effect_projection_id: row.effect_projection_id ?? null,
    evaluation_id: row.evaluation_id ?? null,
    assessment_kind: row.assessment_kind ?? null,
    assignment_policy_activation_id: row.assignment_policy_activation_id ?? null,
    semantic_package: row.semantic_package,
    semantic_digest: row.semantic_digest,
    package_artifact_digest: row.package_artifact_digest,
    selection_artifact_digest: row.selection_artifact_digest,
    selection_rules_digest: row.selection_rules_digest,
    record_digest: row.record_digest,
    frozen_by: row.frozen_by,
    frozen_at: new Date(row.frozen_at).toISOString(),
    authority: { assignment: false, dispatch: false, worker_run: false, model_request: false },
    immutable: true
  };
}

async function verifyPackageRow(row, artifactStore) {
  const legacy = row?.semantic_package?.schema_version === LEGACY_PACKAGE_SCHEMA;
  const expectedRecordSchema = legacy ? LEGACY_PACKAGE_RECORD_SCHEMA : PACKAGE_RECORD_SCHEMA;
  const expectedArtifactSchema = legacy ? LEGACY_PACKAGE_ARTIFACT_SCHEMA : PACKAGE_ARTIFACT_SCHEMA;
  if (!row || ![LEGACY_PACKAGE_SCHEMA, PACKAGE_SCHEMA].includes(row.semantic_package?.schema_version)
      || sha256Digest(row.semantic_package) !== row.semantic_digest
      || row.semantic_package.case_id !== row.case_id
      || row.semantic_package.trigger_id !== row.trigger_id
      || row.semantic_package.evidence_policy_activation_id !== row.evidence_policy_activation_id
      || row.semantic_package.revision_number !== String(row.revision_number)
      || row.semantic_package.freeze.committed_intake_cutoff !== String(row.committed_intake_cutoff)
      || row.semantic_package.freeze.reason !== row.freeze_reason
      || row.semantic_package.packager.artifact_digest !== row.selection_artifact_digest
      || row.semantic_package.packager.rules_digest !== row.selection_rules_digest
      || sha256Digest(row.record_document) !== row.record_digest
      || row.record_document?.schema_version !== expectedRecordSchema
      || row.record_document.evidence_package_id !== row.evidence_package_id
      || row.record_document.case_id !== row.case_id
      || row.record_document.revision_number !== String(row.revision_number)
      || row.record_document.semantic_digest !== row.semantic_digest
      || row.record_document.package_artifact_digest !== row.package_artifact_digest
      || row.record_document.frozen_by !== row.frozen_by
      || row.record_document.frozen_at !== new Date(row.frozen_at).toISOString()
      || (!legacy && (row.record_document.assessment_kind !== row.assessment_kind
        || row.record_document.package_material_digest !== row.package_material_digest
        || row.semantic_package.material.digest !== row.package_material_digest
        || !same(row.semantic_package.material.document, row.package_material)
        || sha256Digest(row.package_material) !== row.package_material_digest
        || row.semantic_package.lineage.correlation_projection_id !== row.correlation_projection_id
        || row.semantic_package.lineage.effect_projection_id !== row.effect_projection_id
        || row.semantic_package.lineage.evaluation_id !== row.evaluation_id
        || row.semantic_package.assessment.kind !== row.assessment_kind
        || (row.semantic_package.lineage.predecessor_evidence_package_id ?? null)
          !== (row.predecessor_evidence_package_id ?? null)))) {
    failIntegrity("DIAGNOSTIC_EVIDENCE_PACKAGE_INTEGRITY_VIOLATION",
      "Stored Diagnostic Evidence Package does not match its immutable semantic and record digests.");
  }
  const stored = await artifactStore.getJson(row.package_artifact_digest);
  const artifact = stored.content;
  if (artifact?.schema_version !== expectedArtifactSchema
      || artifact.evidence_package_id !== row.evidence_package_id
      || artifact.semantic_digest !== row.semantic_digest
      || !same(artifact.semantic_package, row.semantic_package)) {
    failIntegrity("DIAGNOSTIC_EVIDENCE_PACKAGE_ARTIFACT_INTEGRITY_VIOLATION",
      "Content-addressed worker package does not match the frozen package row.");
  }
  return row;
}

function assessmentView(row) {
  return {
    assessment_id: row.assessment_id,
    case_id: row.case_id,
    predecessor_evidence_package_id: row.predecessor_evidence_package_id,
    resulting_evidence_package_id: row.resulting_evidence_package_id,
    assessment_kind: row.assessment_kind,
    candidate_cutoff: String(row.candidate_cutoff),
    previous_material_digest: row.previous_material_digest,
    candidate_material_digest: row.candidate_material_digest,
    outcome: row.outcome,
    material_change_classes: row.material_change_classes,
    recommended_action: row.recommended_action,
    assessment_digest: row.assessment_digest,
    assessed_at: new Date(row.assessed_at).toISOString(),
    authority_granted: "none",
    immutable: true
  };
}

function noticeView(row) {
  return {
    reevaluation_notice_id: row.reevaluation_notice_id,
    case_id: row.case_id,
    assessment_id: row.assessment_id,
    predecessor_evidence_package_id: row.predecessor_evidence_package_id,
    successor_evidence_package_id: row.successor_evidence_package_id,
    known_affected_assignments: row.known_affected_assignments,
    known_affected_diagnoses: row.known_affected_diagnoses,
    recommended_action: row.recommended_action,
    notice: row.notice_document,
    notice_digest: row.notice_digest,
    created_at: new Date(row.created_at).toISOString(),
    authority_granted: "none",
    immutable: true
  };
}

function verifyAssessmentRow(row) {
  if (!row || row.assessment_document?.schema_version !==
      DIAGNOSTIC_EVIDENCE_REVISION_ASSESSMENT_SCHEMA
      || sha256Digest(row.candidate_material) !== row.candidate_material_digest
      || sha256Digest(row.assessment_document) !== row.assessment_digest
      || row.assessment_document.assessment_id !== row.assessment_id
      || row.assessment_document.case_id !== row.case_id
      || row.assessment_document.predecessor_evidence_package_id
        !== row.predecessor_evidence_package_id
      || row.assessment_document.resulting_evidence_package_id
        !== row.resulting_evidence_package_id
      || row.assessment_document.assessment_kind !== row.assessment_kind
      || row.assessment_document.candidate_cutoff !== String(row.candidate_cutoff)
      || row.assessment_document.previous_material_digest !== row.previous_material_digest
      || row.assessment_document.candidate_material_digest !== row.candidate_material_digest
      || row.assessment_document.candidate_projection?.correlation_projection_id
        !== row.candidate_projection_id
      || row.assessment_document.candidate_projection?.effect_projection_id
        !== row.candidate_effect_projection_id
      || row.assessment_document.candidate_projection?.evaluation_id !== row.candidate_evaluation_id
      || row.assessment_document.outcome !== row.outcome
      || !same(row.assessment_document.material_change_classes, row.material_change_classes)
      || row.assessment_document.recommended_action !== row.recommended_action
      || row.assessment_document.rules_digest !== row.rules_digest
      || row.assessment_document.assessed_at !== new Date(row.assessed_at).toISOString()) {
    failIntegrity("DIAGNOSTIC_EVIDENCE_REVISION_ASSESSMENT_INTEGRITY_VIOLATION",
      "Stored evidence revision assessment does not match its exact material and digest.");
  }
  return row;
}

function verifyNoticeRow(row) {
  if (!row || row.notice_document?.schema_version !== DIAGNOSTIC_REEVALUATION_NOTICE_SCHEMA
      || sha256Digest(row.notice_document) !== row.notice_digest
      || row.notice_document.reevaluation_notice_id !== row.reevaluation_notice_id
      || row.notice_document.case_id !== row.case_id
      || row.notice_document.assessment_id !== row.assessment_id
      || row.notice_document.predecessor_package.evidence_package_id
        !== row.predecessor_evidence_package_id
      || row.notice_document.successor_package.evidence_package_id
        !== row.successor_evidence_package_id
      || !same(row.notice_document.known_affected_assignments, row.known_affected_assignments)
      || !same(row.notice_document.known_affected_diagnoses, row.known_affected_diagnoses)
      || row.notice_document.recommended_action !== row.recommended_action
      || row.notice_document.created_at !== new Date(row.created_at).toISOString()) {
    failIntegrity("DIAGNOSTIC_REEVALUATION_NOTICE_INTEGRITY_VIOLATION",
      "Stored reevaluation notice does not match its immutable document digest.");
  }
  return row;
}

function governedDependencies({ projection, interpretationActivation, policyActivation,
  effectProjection, evaluation }) {
  return [
    { dependency_type: "correlation_registration",
      dependency_id: projection.semantic_projection.dependencies.correlation_registration_id,
      dependency_digest: projection.semantic_projection.dependencies.correlation_registration_digest },
    { dependency_type: "correlation_projector_artifact",
      dependency_id: projection.semantic_projection.dependencies.projector.projector_id,
      dependency_digest: projection.semantic_projection.dependencies.projector.artifact_digest },
    { dependency_type: "correlation_projector_rules",
      dependency_id: projection.semantic_projection.dependencies.projector.projector_version,
      dependency_digest: projection.semantic_projection.dependencies.projector.rules_digest },
    { dependency_type: "diagnostic_interpretation_activation",
      dependency_id: interpretationActivation.activation_id,
      dependency_digest: interpretationActivation.activation_digest },
    ...Object.values(interpretationActivation.exports).map((entry) => ({
      dependency_type: entry.kind,
      dependency_id: entry.export_id,
      dependency_digest: entry.export_digest
    })),
    { dependency_type: "evidence_policy_activation",
      dependency_id: policyActivation.evidence_policy_activation_id,
      dependency_digest: policyActivation.activation_digest },
    { dependency_type: "evidence_selection_policy",
      dependency_id: policyActivation.selection_export_id,
      dependency_digest: policyActivation.selection_policy_digest },
    { dependency_type: "diagnostic_retention_policy",
      dependency_id: policyActivation.retention_export_id,
      dependency_digest: policyActivation.retention_policy_digest },
    { dependency_type: "effect_interpreter_artifact",
      dependency_id: effectProjection.dependencies.interpreter.interpreter_id,
      dependency_digest: effectProjection.dependencies.interpreter.artifact_digest },
    { dependency_type: "effect_interpreter_rules",
      dependency_id: effectProjection.dependencies.interpreter.interpreter_version,
      dependency_digest: effectProjection.dependencies.interpreter.rules_digest },
    { dependency_type: "behavior_evaluator_artifact",
      dependency_id: evaluation.evaluator.evaluator_id,
      dependency_digest: evaluation.dependencies.evaluator_artifact_digest },
    { dependency_type: "behavior_evaluator_rules",
      dependency_id: evaluation.evaluator.evaluator_version,
      dependency_digest: evaluation.dependencies.evaluator_rules_digest }
  ].sort(compareCanonical);
}

function deterministicFacts({ projection, effectProjection, evaluation, trigger, diagnosticCase }) {
  return [
    { fact_type: "correlation_projection", record_id: projection.projection_id,
      record_digest: projection.semantic_digest, result: "exact_typed_correlation_graph" },
    { fact_type: "diagnostic_effect_projection", record_id: effectProjection.effect_projection_id,
      record_digest: effectProjection.semantic_digest, result: "contract_interpreted_effects" },
    { fact_type: "behavior_evaluation", record_id: evaluation.evaluation_id,
      record_digest: evaluation.semantic_digest, result: evaluation.semantic_evaluation.result },
    { fact_type: "diagnostic_trigger", record_id: trigger.trigger_id,
      record_digest: trigger.trigger_digest, result: "deterministic_case_creation" },
    { fact_type: "diagnostic_case", record_id: diagnosticCase.case_id,
      record_digest: diagnosticCase.case_digest, result: "open_root_cause_not_established" },
    ...diagnosticCase.claims.map((claim) => ({
      fact_type: "diagnostic_claim_envelope",
      record_id: claim.claim_id,
      record_digest: claim.claim_digest,
      result: claim.effective_support
    }))
  ].sort(compareCanonical);
}

export function createDiagnosticEvidencePackageService({
  database,
  artifactStore,
  installationId,
  environmentId,
  correlationReader,
  effectReader,
  verificationBundleWriter = null,
  resolveDeploymentExports
}) {
  const { pool } = database;
  let revisionTimer = null;
  let revisionTickRunning = false;
  let lastRevisionMonitorError = null;

  async function activatePolicy(input, actorId, now = new Date()) {
    exact(input, "input", [
      "evidence_policy_activation_id", "interpretation_activation_id", "deployment_id",
      "selection_policy_export_id", "retention_policy_export_id"
    ]);
    const evidencePolicyActivationId = uuid(input.evidence_policy_activation_id,
      "evidence_policy_activation_id");
    const interpretationActivationId = uuid(input.interpretation_activation_id,
      "interpretation_activation_id");
    const deploymentId = uuid(input.deployment_id, "deployment_id");
    const interpretationActivation = await effectReader.getActivation(interpretationActivationId);
    const resolved = await resolveDeploymentExports(deploymentId, [
      input.selection_policy_export_id,
      input.retention_policy_export_id
    ]);
    if (resolved.deployment_id !== deploymentId
        || interpretationActivation.deployment_id !== deploymentId
        || interpretationActivation.package_version_id !== resolved.package_version_id
        || interpretationActivation.package_artifact_digest !== resolved.package_artifact_digest) {
      throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_POLICY_SCOPE_MISMATCH",
        "Evidence policies must come from the exact deployment and package used by interpretation.");
    }
    const selectionExport = resolved.exports.get(input.selection_policy_export_id);
    const retentionExport = resolved.exports.get(input.retention_policy_export_id);
    if (selectionExport?.kind !== "evidence_selection_policy"
        || retentionExport?.kind !== "diagnostic_retention_policy"
        || selectionExport.contract_version !== ACTIVATION_EXPORT_VERSION
        || retentionExport.contract_version !== ACTIVATION_EXPORT_VERSION) {
      throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_POLICY_EXPORT_MISMATCH",
        "Activation must reference exact v0.1 Evidence Selection and Diagnostic Retention exports.");
    }
    validateEvidenceSelectionPolicy(selectionExport.content);
    validateDiagnosticRetentionPolicy(retentionExport.content);
    // The activation must retain the exact package-export bytes whose digests it cites.
    // Validation may normalize set-like fields for calculation, but that normalized
    // representation is not a substitute for the deployed export artifact.
    const selectionPolicy = structuredClone(selectionExport.content);
    const retentionPolicy = structuredClone(retentionExport.content);
    const retentionRequirements = calculateRetentionRequirements(retentionPolicy);
    const references = {
      evidence_selection_policy: exportReference(selectionExport),
      diagnostic_retention_policy: exportReference(retentionExport)
    };
    const document = {
      schema_version: EVIDENCE_POLICY_ACTIVATION_SCHEMA,
      evidence_policy_activation_id: evidencePolicyActivationId,
      installation_id: installationId,
      environment_id: environmentId,
      interpretation_activation_id: interpretationActivationId,
      interpretation_activation_digest: interpretationActivation.activation_digest,
      deployment_id: deploymentId,
      package_version_id: resolved.package_version_id,
      package_artifact_digest: resolved.package_artifact_digest,
      exports: references,
      retention_requirements: retentionRequirements,
      stage: {
        artifact_manifest: DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_MANIFEST,
        artifact_digest: DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST,
        selection_rules_digest: DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST
      }
    };
    const activationDigest = sha256Digest(document);
    const activatedAt = new Date(now).toISOString();
    const preparedStageArchive = await prepareStageArtifactArchive(
      artifactStore, DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_MANIFEST);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await recordStageArtifactArchive({ client, installationId, prepared: preparedStageArchive,
        archivedAt: activatedAt });
      const existing = (await client.query(
        `SELECT * FROM diagnostic_evidence_policy_activations
         WHERE installation_id=$1 AND evidence_policy_activation_id=$2 FOR SHARE`,
        [installationId, evidencePolicyActivationId]
      )).rows[0];
      if (existing) {
        verifyEvidencePolicyActivationRow(existing, installationId, environmentId);
        if (existing.activation_digest !== activationDigest) {
          throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_POLICY_ACTIVATION_IDENTITY_CONFLICT",
            "Evidence policy activation ID already binds different immutable material.");
        }
        await client.query("COMMIT");
        return { replayed: true, result: { evidence_policy_activation: evidencePolicyActivationView(existing) } };
      }
      const row = (await client.query(
        `INSERT INTO diagnostic_evidence_policy_activations
          (evidence_policy_activation_id,installation_id,environment_id,interpretation_activation_id,
           deployment_id,package_version_id,package_artifact_digest,selection_export_id,selection_policy,
           selection_policy_digest,retention_export_id,retention_policy,retention_policy_digest,
           retention_requirements,stage_artifact_manifest,stage_artifact_digest,selection_rules_digest,
           activation_document,activation_digest,activated_by,activated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING *`,
        [evidencePolicyActivationId, installationId, environmentId, interpretationActivationId,
          deploymentId, resolved.package_version_id, resolved.package_artifact_digest,
          selectionExport.export_id, selectionPolicy, references.evidence_selection_policy.export_digest,
          retentionExport.export_id, retentionPolicy, references.diagnostic_retention_policy.export_digest,
          retentionRequirements, DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_MANIFEST,
          DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST, DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST,
          document, activationDigest, actorId, activatedAt]
      )).rows[0];
      verifyEvidencePolicyActivationRow(row, installationId, environmentId);
      await client.query("COMMIT");
      return { replayed: false, result: { evidence_policy_activation: evidencePolicyActivationView(row) } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getPolicyActivation(id) {
    uuid(id, "evidence_policy_activation_id");
    return evidencePolicyActivationView(await getEvidencePolicyActivation(pool, {
      installationId,
      environmentId,
      evidencePolicyActivationId: id
    }));
  }

  async function verifiedObservationEvidence(projection) {
    const references = projection.semantic_projection.graph.nodes
      .filter((node) => node.receipt_reference).map((node) => node.receipt_reference);
    const rows = (await pool.query(
      `SELECT r.*,
              a.installation_id AS schema_installation_id,
              a.environment_id AS schema_environment_id,
              a.observation_type AS schema_observation_type,
              a.schema_id AS schema_activation_schema_id,
              a.schema_version AS schema_activation_schema_version,
              a.schema_digest AS schema_activation_schema_digest
       FROM diagnostic_observation_receipts r
       JOIN diagnostic_observation_schema_activations a
         ON a.installation_id=r.installation_id AND a.activation_id=r.schema_activation_id
       WHERE r.installation_id=$1 AND r.receipt_id=ANY($2::uuid[])
       ORDER BY r.intake_position,r.receipt_id`,
      [installationId, references.map((reference) => reference.receipt_id)]
    )).rows;
    return verifyProjectedObservationMaterials({
      receiptReferences: references,
      observationRows: rows,
      installationId,
      environmentId
    });
  }

  async function getPackageRowByCase(caseId) {
    return (await pool.query(
      `SELECT * FROM diagnostic_evidence_packages
       WHERE installation_id=$1 AND case_id=$2 ORDER BY revision_number DESC LIMIT 1`,
      [installationId, caseId]
    )).rows[0] ?? null;
  }

  async function processCollection(input, now = new Date()) {
    const withAssignmentPolicy = Object.hasOwn(input ?? {}, "assignment_policy_activation_id");
    exact(input, "input", withAssignmentPolicy
      ? ["case_id", "assignment_policy_activation_id"] : ["case_id"]);
    const caseId = uuid(input.case_id, "case_id");
    const assignmentPolicyActivationId = withAssignmentPolicy
      ? uuid(input.assignment_policy_activation_id, "assignment_policy_activation_id") : null;
    const existingPackage = await getPackageRowByCase(caseId);
    if (existingPackage) {
      await verifyPackageRow(existingPackage, artifactStore);
      if (assignmentPolicyActivationId) {
        const frozenTransition = (await pool.query(
          `SELECT payload FROM diagnostic_transitions
           WHERE installation_id=$1 AND aggregate_type='diagnostic_case' AND aggregate_id=$2
             AND transition_type='diagnostic.evidence_package.frozen'`,
          [installationId, caseId]
        )).rows[0];
        if (frozenTransition?.payload?.assignment_policy_activation_id !== assignmentPolicyActivationId) {
          throw new KernelError(409, "DIAGNOSTIC_ASSIGNMENT_POLICY_HISTORY_DIVERGENCE",
            "Frozen package transition is already bound to a different Assignment Policy history.");
        }
      }
      const verificationBundle = verificationBundleWriter
        ? await verificationBundleWriter.sealBundle(existingPackage.evidence_package_id, STAGE_AUTHOR,
          existingPackage.frozen_at) : null;
      const collection = await loadEvidenceCollection(pool, installationId, caseId);
      return { replayed: true, result: {
        collection: collection.view,
        evidence_package: packageRowView(existingPackage),
        independent_verification_bundle: verificationBundle?.result.independent_verification_bundle ?? null
      } };
    }

    const diagnosticCase = await effectReader.getDeterministicCase(caseId);
    const trigger = diagnosticCase.trigger;
    if (!trigger.evidence_policy_activation_id) {
      throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_POLICY_NOT_BOUND",
        "Diagnostic Trigger does not bind an Evidence Selection and Retention policy activation.");
    }
    const evaluation = await effectReader.getEvaluation(trigger.evaluation_id);
    const effectProjection = await effectReader.getEffectProjection(evaluation.effect_projection_id);
    const currentProjection = await correlationReader.getProjection(effectProjection.correlation_projection_id);
    const correlationReplay = await correlationReader.createProjection({
      registration_id: currentProjection.registration_id,
      logical_operation_id: currentProjection.logical_operation_id
    }, STAGE_AUTHOR);
    const projection = correlationReplay.result.correlation_projection;
    if (projection.projection_id !== currentProjection.projection_id
        || projection.semantic_digest !== currentProjection.semantic_digest) {
      failIntegrity("DIAGNOSTIC_EVIDENCE_CORRELATION_REPLAY_DIVERGENCE",
        "Evidence packaging did not replay the exact hardened Correlation Projection.");
    }
    const pipelineReplay = await effectReader.process({
      correlation_projection_id: projection.projection_id,
      activation_id: effectProjection.activation_id,
      evidence_policy_activation_id: trigger.evidence_policy_activation_id
    });
    const pipeline = pipelineReplay.result;
    if (pipeline.diagnostic_case.case_id !== caseId) {
      failIntegrity("DIAGNOSTIC_EVIDENCE_PIPELINE_REPLAY_DIVERGENCE",
        "Evidence packaging did not replay the exact deterministic Diagnostic Case.");
    }
    const interpretationActivation = await effectReader.getActivation(effectProjection.activation_id);
    const policyActivation = await getEvidencePolicyActivation(pool, {
      installationId,
      environmentId,
      evidencePolicyActivationId: trigger.evidence_policy_activation_id
    });
    if (policyActivation.stage_artifact_digest !== DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST
        || !same(policyActivation.stage_artifact_manifest, DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_MANIFEST)
        || policyActivation.selection_rules_digest !== DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST) {
      throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_MISMATCH",
        "Activated evidence policy differs from the running deterministic packaging stage.");
    }
    const assignmentPolicyActivation = assignmentPolicyActivationId
      ? await getAssignmentPolicyActivation(pool, {
        installationId, environmentId, assignmentPolicyActivationId
      }) : null;
    if (assignmentPolicyActivation
        && (assignmentPolicyActivation.deployment_id !== policyActivation.deployment_id
          || assignmentPolicyActivation.package_version_id !== policyActivation.package_version_id
          || assignmentPolicyActivation.package_artifact_digest !== policyActivation.package_artifact_digest)) {
      throw new KernelError(409, "DIAGNOSTIC_ASSIGNMENT_POLICY_SCOPE_MISMATCH",
        "Assignment Policy must come from the exact deployment and package used for evidence selection.");
    }
    const observationEvidence = await verifiedObservationEvidence(projection);
    const selection = selectDiagnosticEvidence({
      correlationProjection: projection.semantic_projection,
      effectProjection: pipeline.diagnostic_effect_projection.semantic_projection,
      behaviorEvaluation: pipeline.behavior_evaluation.semantic_evaluation,
      observationEvidence,
      selectionPolicy: policyActivation.selection_policy
    });
    const dependencies = governedDependencies({
      projection,
      interpretationActivation,
      policyActivation,
      effectProjection: pipeline.diagnostic_effect_projection.semantic_projection,
      evaluation: pipeline.behavior_evaluation.semantic_evaluation
    });
    const packageMaterial = buildEvidencePackageMaterial({
      scope: projection.semantic_projection.scope,
      governedDependencies: dependencies,
      selection,
      effectProjection: pipeline.diagnostic_effect_projection.semantic_projection,
      evaluation: pipeline.behavior_evaluation.semantic_evaluation,
      caseClaims: pipeline.diagnostic_case.claims
    });
    const collectionBefore = await loadEvidenceCollection(pool, installationId, caseId);
    const decision = decideEvidenceFreeze({
      requiredSourcesComplete: selection.required_sources_complete,
      collectionDeadline: collectionBefore.row.collection_deadline,
      now
    });
    if (!decision.ready) {
      await pool.query(
        `UPDATE diagnostic_evidence_collection_jobs
         SET attempt_count=attempt_count+1,last_attempt_at=$2,updated_at=$2,last_error_code=NULL
         WHERE installation_id=$1 AND case_id=$3 AND status='pending'`,
        [installationId, decision.assessed_at, caseId]
      );
      return { replayed: false, result: { collection: (await loadEvidenceCollection(
        pool, installationId, caseId)).view, evidence_package: null, readiness: decision } };
    }

    const semanticPackage = {
      schema_version: PACKAGE_SCHEMA,
      case_id: caseId,
      trigger_id: trigger.trigger_id,
      evidence_policy_activation_id: policyActivation.evidence_policy_activation_id,
      revision_number: "1",
      assessment: {
        kind: "initial_freeze",
        rules_digest: DIAGNOSTIC_EVIDENCE_REVISION_RULES_DIGEST
      },
      lineage: {
        predecessor_evidence_package_id: null,
        correlation_projection_id: projection.projection_id,
        correlation_semantic_digest: projection.semantic_digest,
        effect_projection_id: pipeline.diagnostic_effect_projection.effect_projection_id,
        effect_semantic_digest: pipeline.diagnostic_effect_projection.semantic_digest,
        evaluation_id: pipeline.behavior_evaluation.evaluation_id,
        evaluation_semantic_digest: pipeline.behavior_evaluation.semantic_digest
      },
      material: {
        digest: packageMaterial.digest,
        document: packageMaterial.document
      },
      scope: structuredClone(projection.semantic_projection.scope),
      freeze: {
        reason: decision.reason,
        committed_intake_cutoff: projection.committed_intake_cutoff,
        collection_deadline: new Date(collectionBefore.row.collection_deadline).toISOString(),
        required_sources_complete: selection.required_sources_complete
      },
      manifest: {
        governed_interpretation_dependencies: dependencies,
        authenticated_observations: {
          observations: selection.selected_observations,
          authenticated_provenance_dependencies: selection.authenticated_provenance_dependencies
        },
        deterministic_derived_facts: deterministicFacts({
          projection,
          effectProjection: pipeline.diagnostic_effect_projection,
          evaluation: pipeline.behavior_evaluation,
          trigger: pipeline.diagnostic_trigger,
          diagnosticCase: pipeline.diagnostic_case
        }),
        coverage_and_limitations: selection.coverage_and_limitations,
        disclosure_accounting: selection.disclosure_accounting,
        role_completion: selection.role_completion
      },
      selected_graph: {
        nodes: selection.selected_nodes,
        edges: selection.selected_edges
      },
      authority: {
        assignment_created: false,
        dispatch_authorized: false,
        worker_run_created: false,
        model_request_created: false,
        diagnosis_established: false,
        repair_authorized: false,
        kernel_effect_authorized: false
      },
      packager: {
        component: STAGE_AUTHOR,
        artifact_digest: DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST,
        rules_digest: DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST,
        model_selected_evidence: false
      }
    };
    const semanticDigest = sha256Digest(semanticPackage);
    const evidencePackageId = deterministicUuid({
      namespace: "diagnostic-evidence-package",
      case_id: caseId,
      semantic_digest: semanticDigest
    });
    const artifactDocument = {
      schema_version: PACKAGE_ARTIFACT_SCHEMA,
      evidence_package_id: evidencePackageId,
      semantic_digest: semanticDigest,
      semantic_package: semanticPackage
    };
    const stored = await artifactStore.putJson(artifactDocument);
    const frozenAt = decision.assessed_at;
    const recordDocument = {
      schema_version: PACKAGE_RECORD_SCHEMA,
      evidence_package_id: evidencePackageId,
      case_id: caseId,
      revision_number: "1",
      assessment_kind: "initial_freeze",
      package_material_digest: packageMaterial.digest,
      semantic_digest: semanticDigest,
      package_artifact_digest: stored.artifact_digest,
      frozen_by: STAGE_AUTHOR,
      frozen_at: frozenAt
    };
    const recordDigest = sha256Digest(recordDocument);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const collection = await loadEvidenceCollection(client, installationId, caseId, { forUpdate: true });
      if (collection.release || collection.job.status === "frozen") {
        const row = (await client.query(
          "SELECT * FROM diagnostic_evidence_packages WHERE installation_id=$1 AND case_id=$2",
          [installationId, caseId]
        )).rows[0];
        await verifyPackageRow(row, artifactStore);
        if (row.semantic_digest !== semanticDigest || row.package_artifact_digest !== stored.artifact_digest) {
          failIntegrity("DIAGNOSTIC_EVIDENCE_PACKAGE_NONDETERMINISM",
            "Exact collection inputs and policy produced different package semantics.");
        }
        await client.query("COMMIT");
        const verificationBundle = verificationBundleWriter
          ? await verificationBundleWriter.sealBundle(row.evidence_package_id, STAGE_AUTHOR, row.frozen_at) : null;
        return { replayed: true, result: { collection: (await loadEvidenceCollection(
          pool, installationId, caseId)).view, evidence_package: packageRowView(row),
        independent_verification_bundle: verificationBundle?.result.independent_verification_bundle ?? null } };
      }
      await extendEvidenceCollectionReferences({
        client,
        installationId,
        collection,
        createdAt: frozenAt,
        references: [
          ...selection.selected_observations.map((entry) => packageReference(
            "diagnostic_observation_receipt", entry.receipt_id, entry.receipt_digest)),
          ...selection.authenticated_provenance_dependencies.flatMap((entry) => [
            packageReference("tokenization_result_receipt", entry.result_receipt_id, entry.receipt_digest),
            packageReference("tokenization_grant_snapshot", entry.grant_snapshot_digest,
              entry.grant_snapshot_digest),
            packageReference("tokenization_grant_application_receipt", entry.grant_application_receipt_digest,
              entry.grant_application_receipt_digest)
          ]),
          packageReference("correlation_coverage", projection.projection_id,
            sha256Digest(selection.coverage_and_limitations)),
          packageReference("evidence_selection", evidencePackageId, sha256Digest(selection))
        ]
      });
      await client.query(
        `INSERT INTO diagnostic_artifacts
          (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
        [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type, stored.storage_key, frozenAt]
      );
      const packageRow = (await client.query(
        `INSERT INTO diagnostic_evidence_packages
          (evidence_package_id,installation_id,environment_id,case_id,trigger_id,
           evidence_policy_activation_id,revision_number,committed_intake_cutoff,freeze_reason,
           semantic_package,semantic_digest,package_artifact_digest,selection_artifact_digest,
           selection_rules_digest,record_document,record_digest,frozen_by,frozen_at,
           predecessor_evidence_package_id,package_material,package_material_digest,
           correlation_projection_id,effect_projection_id,evaluation_id,assessment_kind,
           assignment_policy_activation_id)
         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
           NULL,$18,$19,$20,$21,$22,'initial_freeze',$23)
         RETURNING *`,
        [evidencePackageId, installationId, environmentId, caseId, trigger.trigger_id,
          policyActivation.evidence_policy_activation_id, projection.committed_intake_cutoff,
          decision.reason, semanticPackage, semanticDigest, stored.artifact_digest,
          DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST, DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST,
          recordDocument, recordDigest, STAGE_AUTHOR, frozenAt, packageMaterial.document,
          packageMaterial.digest, projection.projection_id,
          pipeline.diagnostic_effect_projection.effect_projection_id,
          pipeline.behavior_evaluation.evaluation_id,
          assignmentPolicyActivation?.assignment_policy_activation_id ?? null]
      )).rows[0];
      const finalReferences = (await client.query(
        `SELECT * FROM diagnostic_evidence_collection_lease_references
         WHERE lease_id=$1 ORDER BY reference_type,reference_id`, [collection.row.lease_id]
      )).rows;
      for (const reference of finalReferences) {
        await client.query(
          `INSERT INTO diagnostic_evidence_package_references
            (evidence_package_id,installation_id,reference_type,reference_id,reference_digest,
             artifact_digest,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [evidencePackageId, installationId, reference.reference_type, reference.reference_id,
            reference.reference_digest, reference.artifact_digest, frozenAt]
        );
      }
      const pinExpiresAt = new Date(Date.parse(frozenAt)
        + policyActivation.retention_policy.package_pin_seconds * 1000).toISOString();
      const pinMaterials = [
        packageReference("diagnostic_evidence_package", evidencePackageId, semanticDigest,
          stored.artifact_digest),
        ...finalReferences.map((reference) => packageReference(reference.reference_type,
          reference.reference_id, reference.reference_digest, reference.artifact_digest))
      ].sort(compareCanonical);
      for (const pin of pinMaterials) {
        const pinId = deterministicUuid({
          namespace: "diagnostic-artifact-retention-pin",
          evidence_package_id: evidencePackageId,
          object_type: pin.reference_type,
          object_id: pin.reference_id,
          object_digest: pin.reference_digest
        });
        await client.query(
          `INSERT INTO diagnostic_artifact_retention_pins
            (pin_id,installation_id,evidence_package_id,object_type,object_id,object_digest,
             artifact_digest,retention_policy_digest,expires_at,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [pinId, installationId, evidencePackageId, pin.reference_type, pin.reference_id,
            pin.reference_digest, pin.artifact_digest, policyActivation.retention_policy_digest,
            pinExpiresAt, frozenAt]
        );
      }
      const releaseDocument = {
        schema_version: EVIDENCE_COLLECTION_LEASE_RELEASE_SCHEMA,
        lease_id: collection.row.lease_id,
        lease_digest: collection.row.lease_digest,
        evidence_package_id: evidencePackageId,
        evidence_package_semantic_digest: semanticDigest,
        package_artifact_digest: stored.artifact_digest,
        reference_manifest_digest: sha256Digest(finalReferences.map((reference) => ({
          reference_type: reference.reference_type,
          reference_id: reference.reference_id,
          reference_digest: reference.reference_digest,
          artifact_digest: reference.artifact_digest
        })).sort(compareCanonical)),
        retention_pin_manifest_digest: sha256Digest(pinMaterials),
        released_at: frozenAt
      };
      const releaseDigest = sha256Digest(releaseDocument);
      await client.query(
        `INSERT INTO diagnostic_evidence_collection_lease_releases
          (lease_id,installation_id,evidence_package_id,release_document,release_digest,released_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [collection.row.lease_id, installationId, evidencePackageId,
          releaseDocument, releaseDigest, frozenAt]
      );
      await client.query(
        `UPDATE diagnostic_evidence_collection_jobs
         SET status='frozen',attempt_count=attempt_count+1,last_attempt_at=$2,completed_at=$2,
             updated_at=$2,last_error_code=NULL
         WHERE installation_id=$1 AND case_id=$3 AND status IN ('pending','processing')`,
        [installationId, frozenAt, caseId]
      );
      await client.query(
        `INSERT INTO diagnostic_evidence_revision_monitors
          (case_id,installation_id,environment_id,registration_id,logical_operation_id,
           interpretation_activation_id,evidence_policy_activation_id,assignment_policy_activation_id,
           current_evidence_package_id,current_package_material_digest,last_assessed_cutoff,
           monitor_revision,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$12)`,
        [caseId, installationId, environmentId, projection.registration_id,
          projection.logical_operation_id, interpretationActivation.activation_id,
          policyActivation.evidence_policy_activation_id,
          assignmentPolicyActivation?.assignment_policy_activation_id ?? null,
          evidencePackageId, packageMaterial.digest, projection.committed_intake_cutoff, frozenAt]
      );

      const commandId = `evidence-freeze:${collection.job.job_id}`;
      const transitionId = randomUUID();
      const node = (await client.query(
        "SELECT revision,next_sequence FROM diagnostic_nodes WHERE installation_id=$1 FOR UPDATE",
        [installationId]
      )).rows[0];
      await client.query(
        `INSERT INTO diagnostic_commands
          (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
         VALUES ($1,$2,$3,'diagnostic.evidence_collection.process','service',$4,$5,$6)`,
        [installationId, commandId, sha256Digest({
          case_id: caseId,
          lease_digest: collection.row.lease_digest,
          semantic_digest: semanticDigest,
          assignment_policy_activation_id: assignmentPolicyActivation?.assignment_policy_activation_id ?? null,
          assignment_policy_activation_digest: assignmentPolicyActivation?.activation_digest ?? null
        }), STAGE_AUTHOR, { evidence_package_id: evidencePackageId,
          semantic_digest: semanticDigest, package_artifact_digest: stored.artifact_digest }, frozenAt]
      );
      await client.query(
        `INSERT INTO diagnostic_transitions
          (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
           from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
         VALUES ($1,$2,$3,'diagnostic_case',$4,'diagnostic.evidence_package.frozen',1,2,$5,
                 'service',$6,$7,$8)`,
        [transitionId, installationId, String(node.next_sequence), caseId, commandId, STAGE_AUTHOR,
          { evidence_package_id: evidencePackageId, semantic_digest: semanticDigest,
            package_artifact_digest: stored.artifact_digest, freeze_reason: decision.reason,
            ...(assignmentPolicyActivation ? {
              assignment_policy_activation_id: assignmentPolicyActivation.assignment_policy_activation_id,
              assignment_policy_activation_digest: assignmentPolicyActivation.activation_digest
            } : {}) }, frozenAt]
      );
      await client.query(
        `INSERT INTO diagnostic_outbox
          (outbox_id,installation_id,transition_id,event_type,payload,created_at)
         VALUES ($1,$2,$3,'diagnostic.evidence_package.frozen',$4,$5)`,
        [randomUUID(), installationId, transitionId,
          { transition_id: transitionId, evidence_package_id: evidencePackageId }, frozenAt]
      );
      await client.query(
        "UPDATE diagnostic_nodes SET revision=revision+1,next_sequence=next_sequence+1,updated_at=$2 WHERE installation_id=$1",
        [installationId, frozenAt]
      );
      await client.query("COMMIT");
      const verificationBundle = verificationBundleWriter
        ? await verificationBundleWriter.sealBundle(evidencePackageId, STAGE_AUTHOR, frozenAt) : null;
      return { replayed: false, result: {
        collection: (await loadEvidenceCollection(pool, installationId, caseId)).view,
        evidence_package: packageRowView(packageRow),
        independent_verification_bundle: verificationBundle?.result.independent_verification_bundle ?? null,
        readiness: decision
      } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function loadRevisionMonitor(caseId, client = pool, forUpdate = false) {
    const row = (await client.query(
      `SELECT * FROM diagnostic_evidence_revision_monitors
       WHERE installation_id=$1 AND environment_id=$2 AND case_id=$3${forUpdate ? " FOR UPDATE" : ""}`,
      [installationId, environmentId, caseId]
    )).rows[0];
    if (!row) throw new KernelError(404, "DIAGNOSTIC_EVIDENCE_REVISION_MONITOR_NOT_FOUND",
      "Diagnostic Case does not have a material-evidence revision monitor.");
    return row;
  }

  async function prepareRevisionCandidate(caseId, now) {
    const monitor = await loadRevisionMonitor(caseId);
    const predecessor = await verifyPackageRow((await pool.query(
      `SELECT * FROM diagnostic_evidence_packages
       WHERE installation_id=$1 AND evidence_package_id=$2`,
      [installationId, monitor.current_evidence_package_id]
    )).rows[0], artifactStore);
    if (!predecessor.package_material || predecessor.package_material_digest
        !== monitor.current_package_material_digest) {
      failIntegrity("DIAGNOSTIC_EVIDENCE_REVISION_MONITOR_INTEGRITY_VIOLATION",
        "Revision monitor does not bind the exact current package material.");
    }
    const projectionResult = await correlationReader.createProjection({
      registration_id: monitor.registration_id,
      logical_operation_id: monitor.logical_operation_id
    }, STAGE_AUTHOR, now);
    const projection = projectionResult.result.correlation_projection;
    if (BigInt(projection.committed_intake_cutoff) <= BigInt(monitor.last_assessed_cutoff)) {
      return { monitor, predecessor, stale: true };
    }
    const reevaluation = (await effectReader.reevaluate({
      case_id: caseId,
      correlation_projection_id: projection.projection_id,
      activation_id: monitor.interpretation_activation_id
    }, now)).result;
    const diagnosticCase = reevaluation.diagnostic_case;
    const trigger = diagnosticCase.trigger;
    const interpretationActivation = await effectReader.getActivation(monitor.interpretation_activation_id);
    const policyActivation = await getEvidencePolicyActivation(pool, {
      installationId,
      environmentId,
      evidencePolicyActivationId: monitor.evidence_policy_activation_id
    });
    const observationEvidence = await verifiedObservationEvidence(projection);
    const selection = selectDiagnosticEvidence({
      correlationProjection: projection.semantic_projection,
      effectProjection: reevaluation.diagnostic_effect_projection.semantic_projection,
      behaviorEvaluation: reevaluation.behavior_evaluation.semantic_evaluation,
      observationEvidence,
      selectionPolicy: policyActivation.selection_policy
    });
    const dependencies = governedDependencies({
      projection,
      interpretationActivation,
      policyActivation,
      effectProjection: reevaluation.diagnostic_effect_projection.semantic_projection,
      evaluation: reevaluation.behavior_evaluation.semantic_evaluation
    });
    const material = buildEvidencePackageMaterial({
      scope: projection.semantic_projection.scope,
      governedDependencies: dependencies,
      selection,
      effectProjection: reevaluation.diagnostic_effect_projection.semantic_projection,
      evaluation: reevaluation.behavior_evaluation.semantic_evaluation,
      caseClaims: diagnosticCase.claims
    });
    const materialChangeClasses = classifyEvidenceMaterialChange(
      predecessor.package_material, material.document);
    return {
      monitor,
      predecessor,
      projection,
      reevaluation,
      diagnosticCase,
      trigger,
      interpretationActivation,
      policyActivation,
      observationEvidence,
      selection,
      dependencies,
      material,
      materialChangeClasses,
      assessedAt: iso(now),
      stale: false
    };
  }

  function revisionPackageDocument(candidate, revisionNumber) {
    const { predecessor, projection, reevaluation, diagnosticCase, trigger, selection,
      dependencies, material, materialChangeClasses, assessedAt } = candidate;
    return {
      schema_version: PACKAGE_SCHEMA,
      case_id: diagnosticCase.case_id,
      trigger_id: trigger.trigger_id,
      evidence_policy_activation_id: predecessor.evidence_policy_activation_id,
      revision_number: revisionNumber,
      assessment: {
        kind: "late_evidence",
        rules_digest: DIAGNOSTIC_EVIDENCE_REVISION_RULES_DIGEST,
        material_change_classes: materialChangeClasses
      },
      lineage: {
        predecessor_evidence_package_id: predecessor.evidence_package_id,
        correlation_projection_id: projection.projection_id,
        correlation_semantic_digest: projection.semantic_digest,
        effect_projection_id: reevaluation.diagnostic_effect_projection.effect_projection_id,
        effect_semantic_digest: reevaluation.diagnostic_effect_projection.semantic_digest,
        evaluation_id: reevaluation.behavior_evaluation.evaluation_id,
        evaluation_semantic_digest: reevaluation.behavior_evaluation.semantic_digest
      },
      material: { digest: material.digest, document: material.document },
      scope: structuredClone(projection.semantic_projection.scope),
      freeze: {
        reason: "material_late_evidence",
        committed_intake_cutoff: projection.committed_intake_cutoff,
        collection_deadline: predecessor.semantic_package.freeze.collection_deadline,
        required_sources_complete: selection.required_sources_complete,
        assessed_at: assessedAt
      },
      manifest: {
        governed_interpretation_dependencies: dependencies,
        authenticated_observations: {
          observations: selection.selected_observations,
          authenticated_provenance_dependencies: selection.authenticated_provenance_dependencies
        },
        deterministic_derived_facts: deterministicFacts({
          projection,
          effectProjection: reevaluation.diagnostic_effect_projection,
          evaluation: reevaluation.behavior_evaluation,
          trigger,
          diagnosticCase
        }),
        coverage_and_limitations: selection.coverage_and_limitations,
        disclosure_accounting: selection.disclosure_accounting,
        role_completion: selection.role_completion
      },
      selected_graph: { nodes: selection.selected_nodes, edges: selection.selected_edges },
      authority: {
        assignment_created: false,
        dispatch_authorized: false,
        worker_run_created: false,
        model_request_created: false,
        diagnosis_established: false,
        repair_authorized: false,
        kernel_effect_authorized: false
      },
      packager: {
        component: STAGE_AUTHOR,
        artifact_digest: DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST,
        rules_digest: DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST,
        revision_rules_digest: DIAGNOSTIC_EVIDENCE_REVISION_RULES_DIGEST,
        model_selected_evidence: false
      }
    };
  }

  async function processRevisionAttempt(input, now) {
    exact(input, "input", ["case_id"]);
    const caseId = uuid(input.case_id, "case_id");
    const candidate = await prepareRevisionCandidate(caseId, now);
    if (candidate.stale) {
      return { replayed: true, result: {
        status: "no_new_committed_outcomes",
        evidence_package: packageRowView(candidate.predecessor),
        assessment: null,
        reevaluation_available: null
      } };
    }
    const materialChanged = candidate.material.digest !== candidate.predecessor.package_material_digest;
    if (materialChanged !== (candidate.materialChangeClasses.length > 0)) {
      failIntegrity("DIAGNOSTIC_EVIDENCE_MATERIAL_CLASSIFICATION_INTEGRITY_VIOLATION",
        "Material digest and exact change classification disagree.");
    }
    const revisionNumber = String(BigInt(candidate.predecessor.revision_number) + 1n);
    let evidencePackageId = null;
    let semanticPackage = null;
    let semanticDigest = null;
    let stored = null;
    let recordDocument = null;
    let recordDigest = null;
    if (materialChanged) {
      const identityMaterial = {
        case_id: caseId,
        predecessor_evidence_package_id: candidate.predecessor.evidence_package_id,
        revision_number: revisionNumber,
        package_material_digest: candidate.material.digest,
        committed_intake_cutoff: candidate.projection.committed_intake_cutoff
      };
      evidencePackageId = deterministicUuid({ namespace: "diagnostic-evidence-package-revision",
        ...identityMaterial });
      semanticPackage = revisionPackageDocument(candidate, revisionNumber);
      semanticDigest = sha256Digest(semanticPackage);
      stored = await artifactStore.putJson({
        schema_version: PACKAGE_ARTIFACT_SCHEMA,
        evidence_package_id: evidencePackageId,
        semantic_digest: semanticDigest,
        semantic_package: semanticPackage
      });
      recordDocument = {
        schema_version: PACKAGE_RECORD_SCHEMA,
        evidence_package_id: evidencePackageId,
        case_id: caseId,
        revision_number: revisionNumber,
        assessment_kind: "late_evidence",
        package_material_digest: candidate.material.digest,
        semantic_digest: semanticDigest,
        package_artifact_digest: stored.artifact_digest,
        frozen_by: STAGE_AUTHOR,
        frozen_at: candidate.assessedAt
      };
      recordDigest = sha256Digest(recordDocument);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`diagnostic-evidence-revision:${installationId}:${caseId}`]);
      const monitor = await loadRevisionMonitor(caseId, client, true);
      const existingAssessment = (await client.query(
        `SELECT * FROM diagnostic_evidence_revision_assessments
         WHERE case_id=$1 AND candidate_cutoff=$2 AND interpretation_activation_id=$3
           AND assessment_kind='late_evidence'`,
        [caseId, candidate.projection.committed_intake_cutoff, monitor.interpretation_activation_id]
      )).rows[0];
      if (existingAssessment) {
        verifyAssessmentRow(existingAssessment);
        if (existingAssessment.candidate_material_digest !== candidate.material.digest
            || existingAssessment.previous_material_digest
              !== candidate.predecessor.package_material_digest) {
          failIntegrity("DIAGNOSTIC_EVIDENCE_REVISION_NONDETERMINISM",
            "The same predecessor, cutoff, and pinned activations produced a different assessment.");
        }
        await client.query("COMMIT");
        const resulting = existingAssessment.resulting_evidence_package_id
          ? await getPackage(existingAssessment.resulting_evidence_package_id) : packageRowView(candidate.predecessor);
        const notice = existingAssessment.resulting_evidence_package_id ? (await pool.query(
          "SELECT * FROM diagnostic_reevaluation_notices WHERE assessment_id=$1",
          [existingAssessment.assessment_id]
        )).rows[0] : null;
        const verificationBundle = existingAssessment.resulting_evidence_package_id
          && verificationBundleWriter ? await verificationBundleWriter.sealBundle(
            existingAssessment.resulting_evidence_package_id, STAGE_AUTHOR,
            existingAssessment.assessed_at) : null;
        return { replayed: true, result: {
          status: existingAssessment.outcome,
          evidence_package: resulting,
          assessment: assessmentView(existingAssessment),
          reevaluation_available: notice ? noticeView(verifyNoticeRow(notice)) : null,
          independent_verification_bundle:
            verificationBundle?.result.independent_verification_bundle ?? null
        } };
      }
      if (monitor.current_evidence_package_id !== candidate.predecessor.evidence_package_id
          || monitor.current_package_material_digest !== candidate.predecessor.package_material_digest
          || BigInt(monitor.last_assessed_cutoff) >= BigInt(candidate.projection.committed_intake_cutoff)) {
        throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_REVISION_MONITOR_ADVANCED",
          "Revision monitor advanced while candidate material was being prepared; retry against the new predecessor.");
      }
      const affectedRows = (await client.query(
        `SELECT a.assignment_id,a.assignment_digest,a.evidence_package_id,s.state,s.state_revision
         FROM diagnostic_assignments a JOIN diagnostic_assignment_states s ON s.assignment_id=a.assignment_id
         WHERE a.installation_id=$1 AND a.environment_id=$2 AND a.case_id=$3
         ORDER BY a.created_at,a.assignment_id FOR UPDATE OF s`,
        [installationId, environmentId, caseId]
      )).rows;
      const affectedAssignments = affectedRows.map((row) => ({
        assignment_id: row.assignment_id,
        assignment_digest: row.assignment_digest,
        evidence_package_id: row.evidence_package_id,
        state: row.state,
        state_revision: String(row.state_revision)
      }));
      const replaceableRows = affectedRows.filter((row) => row.state === "unclaimed");
      if (replaceableRows.length > 1) {
        failIntegrity("DIAGNOSTIC_ASSIGNMENT_REPLACEMENT_CARDINALITY_VIOLATION",
          "One Diagnostic Case cannot have multiple simultaneously unclaimed assignments.");
      }
      const replaceable = replaceableRows[0] ?? null;
      const assignmentPolicy = monitor.assignment_policy_activation_id
        ? await getAssignmentPolicyActivation(client, {
          installationId, environmentId,
          assignmentPolicyActivationId: monitor.assignment_policy_activation_id
        }) : null;
      const recommendedAction = materialChanged && assignmentPolicy
        ? resolveLateEvidenceAssignmentAction(assignmentPolicy.policy_document,
          candidate.materialChangeClasses, replaceable?.state ?? "none") : "notify_only";
      const assessmentId = deterministicUuid({ namespace: "diagnostic-evidence-revision-assessment",
        case_id: caseId,
        predecessor_evidence_package_id: candidate.predecessor.evidence_package_id,
        candidate_cutoff: candidate.projection.committed_intake_cutoff,
        interpretation_activation_id: monitor.interpretation_activation_id,
        assessment_kind: "late_evidence" });
      const assessmentDocument = {
        schema_version: DIAGNOSTIC_EVIDENCE_REVISION_ASSESSMENT_SCHEMA,
        assessment_id: assessmentId,
        case_id: caseId,
        predecessor_evidence_package_id: candidate.predecessor.evidence_package_id,
        resulting_evidence_package_id: evidencePackageId,
        assessment_kind: "late_evidence",
        candidate_cutoff: candidate.projection.committed_intake_cutoff,
        previous_material_digest: candidate.predecessor.package_material_digest,
        candidate_material_digest: candidate.material.digest,
        candidate_projection: {
          correlation_projection_id: candidate.projection.projection_id,
          correlation_semantic_digest: candidate.projection.semantic_digest,
          effect_projection_id: candidate.reevaluation.diagnostic_effect_projection.effect_projection_id,
          effect_semantic_digest: candidate.reevaluation.diagnostic_effect_projection.semantic_digest,
          evaluation_id: candidate.reevaluation.behavior_evaluation.evaluation_id,
          evaluation_semantic_digest: candidate.reevaluation.behavior_evaluation.semantic_digest
        },
        outcome: materialChanged ? "revision_created" : "nonmaterial",
        material_change_classes: candidate.materialChangeClasses,
        recommended_action: recommendedAction,
        rules_digest: DIAGNOSTIC_EVIDENCE_REVISION_RULES_DIGEST,
        assessed_at: candidate.assessedAt,
        authority_granted: "none"
      };
      const assessmentDigest = sha256Digest(assessmentDocument);
      let packageRow = candidate.predecessor;
      let noticeRow = null;
      if (materialChanged) {
        await client.query(
          `INSERT INTO diagnostic_artifacts
            (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
          [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
            stored.storage_key, candidate.assessedAt]
        );
        packageRow = (await client.query(
          `INSERT INTO diagnostic_evidence_packages
            (evidence_package_id,installation_id,environment_id,case_id,trigger_id,
             evidence_policy_activation_id,revision_number,committed_intake_cutoff,freeze_reason,
             semantic_package,semantic_digest,package_artifact_digest,selection_artifact_digest,
             selection_rules_digest,record_document,record_digest,frozen_by,frozen_at,
             predecessor_evidence_package_id,package_material,package_material_digest,
             correlation_projection_id,effect_projection_id,evaluation_id,assessment_kind,
             assignment_policy_activation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'material_late_evidence',$9,$10,$11,$12,$13,$14,$15,$16,$17,
             $18,$19,$20,$21,$22,$23,'late_evidence',$24) RETURNING *`,
          [evidencePackageId, installationId, environmentId, caseId, candidate.trigger.trigger_id,
            candidate.predecessor.evidence_policy_activation_id, revisionNumber,
            candidate.projection.committed_intake_cutoff, semanticPackage, semanticDigest,
            stored.artifact_digest, DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST,
            DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST, recordDocument, recordDigest, STAGE_AUTHOR,
            candidate.assessedAt, candidate.predecessor.evidence_package_id, candidate.material.document,
            candidate.material.digest, candidate.projection.projection_id,
            candidate.reevaluation.diagnostic_effect_projection.effect_projection_id,
            candidate.reevaluation.behavior_evaluation.evaluation_id,
            monitor.assignment_policy_activation_id]
        )).rows[0];
        const packageReferences = uniquePackageReferences([
          ...candidate.selection.selected_observations.map((entry) => packageReference(
            "diagnostic_observation_receipt", entry.receipt_id, entry.receipt_digest)),
          ...candidate.selection.authenticated_provenance_dependencies.flatMap((entry) => [
            packageReference("tokenization_result_receipt", entry.result_receipt_id, entry.receipt_digest),
            packageReference("tokenization_grant_snapshot", entry.grant_snapshot_digest,
              entry.grant_snapshot_digest),
            packageReference("tokenization_grant_application_receipt", entry.grant_application_receipt_digest,
              entry.grant_application_receipt_digest)
          ]),
          packageReference("correlation_projection", candidate.projection.projection_id,
            candidate.projection.semantic_digest),
          packageReference("diagnostic_effect_projection",
            candidate.reevaluation.diagnostic_effect_projection.effect_projection_id,
            candidate.reevaluation.diagnostic_effect_projection.semantic_digest),
          packageReference("behavior_evaluation", candidate.reevaluation.behavior_evaluation.evaluation_id,
            candidate.reevaluation.behavior_evaluation.semantic_digest),
          packageReference("evidence_selection", evidencePackageId, sha256Digest(candidate.selection))
        ]);
        for (const reference of packageReferences) {
          await client.query(
            `INSERT INTO diagnostic_evidence_package_references
              (evidence_package_id,installation_id,reference_type,reference_id,reference_digest,
               artifact_digest,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [evidencePackageId, installationId, reference.reference_type, reference.reference_id,
              reference.reference_digest, reference.artifact_digest, candidate.assessedAt]
          );
        }
        const pinExpiresAt = new Date(Date.parse(candidate.assessedAt)
          + candidate.policyActivation.retention_policy.package_pin_seconds * 1000).toISOString();
        for (const reference of [packageReference("diagnostic_evidence_package", evidencePackageId,
          semanticDigest, stored.artifact_digest), ...packageReferences]) {
          const pinId = deterministicUuid({ namespace: "diagnostic-artifact-retention-pin",
            evidence_package_id: evidencePackageId,
            object_type: reference.reference_type,
            object_id: reference.reference_id,
            object_digest: reference.reference_digest });
          await client.query(
            `INSERT INTO diagnostic_artifact_retention_pins
              (pin_id,installation_id,evidence_package_id,object_type,object_id,object_digest,
               artifact_digest,retention_policy_digest,expires_at,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [pinId, installationId, evidencePackageId, reference.reference_type, reference.reference_id,
              reference.reference_digest, reference.artifact_digest,
              candidate.policyActivation.retention_policy_digest, pinExpiresAt, candidate.assessedAt]
          );
        }
      }
      const assessmentRow = (await client.query(
        `INSERT INTO diagnostic_evidence_revision_assessments
          (assessment_id,installation_id,environment_id,case_id,predecessor_evidence_package_id,
           resulting_evidence_package_id,assessment_kind,interpretation_activation_id,candidate_cutoff,
           previous_material_digest,candidate_material,candidate_material_digest,candidate_projection_id,
           candidate_effect_projection_id,candidate_evaluation_id,outcome,material_change_classes,
           recommended_action,rules_digest,assessment_document,assessment_digest,assessed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'late_evidence',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING *`,
        [assessmentId, installationId, environmentId, caseId,
          candidate.predecessor.evidence_package_id, evidencePackageId, monitor.interpretation_activation_id,
          candidate.projection.committed_intake_cutoff, candidate.predecessor.package_material_digest,
          candidate.material.document, candidate.material.digest, candidate.projection.projection_id,
          candidate.reevaluation.diagnostic_effect_projection.effect_projection_id,
          candidate.reevaluation.behavior_evaluation.evaluation_id,
          materialChanged ? "revision_created" : "nonmaterial",
          JSON.stringify(candidate.materialChangeClasses),
          recommendedAction, DIAGNOSTIC_EVIDENCE_REVISION_RULES_DIGEST, assessmentDocument,
          assessmentDigest, candidate.assessedAt]
      )).rows[0];
      if (materialChanged) {
        const noticeId = deterministicUuid({ namespace: "diagnostic-reevaluation-available",
          assessment_id: assessmentId, successor_evidence_package_id: evidencePackageId });
        const noticeDocument = {
          schema_version: DIAGNOSTIC_REEVALUATION_NOTICE_SCHEMA,
          reevaluation_notice_id: noticeId,
          case_id: caseId,
          assessment_id: assessmentId,
          predecessor_package: {
            evidence_package_id: candidate.predecessor.evidence_package_id,
            semantic_digest: candidate.predecessor.semantic_digest,
            material_digest: candidate.predecessor.package_material_digest
          },
          successor_package: {
            evidence_package_id: evidencePackageId,
            semantic_digest: semanticDigest,
            material_digest: candidate.material.digest
          },
          material_change_classes: candidate.materialChangeClasses,
          known_affected_assignments: affectedAssignments,
          known_affected_diagnoses: [],
          recommended_action: recommendedAction,
          policy: assignmentPolicy ? {
            assignment_policy_activation_id: assignmentPolicy.assignment_policy_activation_id,
            activation_digest: assignmentPolicy.activation_digest
          } : null,
          temporal: {
            predecessor_cutoff: String(candidate.predecessor.committed_intake_cutoff),
            successor_cutoff: candidate.projection.committed_intake_cutoff,
            assessed_at: candidate.assessedAt,
            freshness: "current_as_of_successor_cutoff"
          },
          authority_granted: "none",
          created_at: candidate.assessedAt
        };
        const noticeDigest = sha256Digest(noticeDocument);
        noticeRow = (await client.query(
          `INSERT INTO diagnostic_reevaluation_notices
            (reevaluation_notice_id,installation_id,environment_id,case_id,assessment_id,
             predecessor_evidence_package_id,successor_evidence_package_id,known_affected_assignments,
             known_affected_diagnoses,recommended_action,notice_document,notice_digest,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'[]'::jsonb,$9,$10,$11,$12) RETURNING *`,
          [noticeId, installationId, environmentId, caseId, assessmentId,
            candidate.predecessor.evidence_package_id, evidencePackageId,
            JSON.stringify(affectedAssignments),
            recommendedAction, noticeDocument, noticeDigest, candidate.assessedAt]
        )).rows[0];
        const node = (await client.query(
          "SELECT revision,next_sequence FROM diagnostic_nodes WHERE installation_id=$1 FOR UPDATE",
          [installationId]
        )).rows[0];
        const revisionCommandId = `evidence-revision:${assessmentId}`;
        const noticeCommandId = `reevaluation-notice:${noticeId}`;
        await client.query(
          `INSERT INTO diagnostic_commands
            (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
           VALUES ($1,$2,$3,'diagnostic.evidence_revision.process','service',$4,$5,$6),
                  ($1,$7,$8,'diagnostic.reevaluation.publish','service',$4,$9,$6)`,
          [installationId, revisionCommandId, assessmentDigest, STAGE_AUTHOR,
            { assessment_id: assessmentId, evidence_package_id: evidencePackageId,
              reevaluation_notice_id: noticeId }, candidate.assessedAt,
            noticeCommandId, noticeDigest,
            { reevaluation_notice_id: noticeId, assessment_id: assessmentId,
              predecessor_evidence_package_id: candidate.predecessor.evidence_package_id,
              successor_evidence_package_id: evidencePackageId }]
        );
        const revisedTransitionId = randomUUID();
        const noticeTransitionId = randomUUID();
        await client.query(
          `INSERT INTO diagnostic_transitions
            (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
             from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
           VALUES ($1,$2,$3,'diagnostic_case',$4,'diagnostic.evidence_package.revised',$5,$6,$7,
             'service',$8,$9,$10)`,
          [revisedTransitionId, installationId, String(node.next_sequence), caseId,
            revisionNumber, String(BigInt(revisionNumber) + 1n), revisionCommandId, STAGE_AUTHOR,
            { evidence_package_id: evidencePackageId, semantic_digest: semanticDigest,
              package_material_digest: candidate.material.digest,
              predecessor_evidence_package_id: candidate.predecessor.evidence_package_id,
              assessment_id: assessmentId }, candidate.assessedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_transitions
            (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
             from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
           VALUES ($1,$2,$3,'diagnostic_reevaluation',$4,'diagnostic.reevaluation.available',0,1,$5,
             'service',$6,$7,$8)`,
          [noticeTransitionId, installationId, String(BigInt(node.next_sequence) + 1n), noticeId,
            noticeCommandId, STAGE_AUTHOR,
            { reevaluation_notice_id: noticeId, assessment_id: assessmentId,
              predecessor_evidence_package_id: candidate.predecessor.evidence_package_id,
              successor_evidence_package_id: evidencePackageId,
              recommended_action: recommendedAction, authority_granted: "none" }, candidate.assessedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_outbox
            (outbox_id,installation_id,transition_id,event_type,payload,created_at)
           VALUES ($1,$2,$3,'diagnostic.evidence_package.revised',$4,$5),
                  ($6,$2,$7,'diagnostic.reevaluation.available',$8,$5)`,
          [randomUUID(), installationId, revisedTransitionId,
            { transition_id: revisedTransitionId, evidence_package_id: evidencePackageId },
            candidate.assessedAt, randomUUID(), noticeTransitionId,
            { transition_id: noticeTransitionId, reevaluation_notice_id: noticeId }]
        );
        let transitionCount = 2n;
        if (recommendedAction === "replace_unclaimed" && replaceable && assignmentPolicy) {
          const replacementTransitionId = randomUUID();
          const replacementRequestCommandId = `assignment-replacement-request:${noticeId}`;
          await client.query(
            `INSERT INTO diagnostic_commands
              (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
             VALUES ($1,$2,$3,'diagnostic.assignment.replacement.request','service',$4,$5,$6)`,
            [installationId, replacementRequestCommandId, noticeDigest, STAGE_AUTHOR,
              { reevaluation_notice_id: noticeId, replaced_assignment_id: replaceable.assignment_id,
                predecessor_evidence_package_id: candidate.predecessor.evidence_package_id,
                successor_evidence_package_id: evidencePackageId }, candidate.assessedAt]
          );
          await client.query(
            `INSERT INTO diagnostic_transitions
              (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
               from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
             VALUES ($1,$2,$3,'diagnostic_assignment_replacement',$4,
               'diagnostic.assignment.replacement_requested',0,1,$5,'service',$6,$7,$8)`,
            [replacementTransitionId, installationId, String(BigInt(node.next_sequence) + 2n), noticeId,
              replacementRequestCommandId, STAGE_AUTHOR,
              { reevaluation_notice_id: noticeId, replaced_assignment_id: replaceable.assignment_id,
                predecessor_evidence_package_id: candidate.predecessor.evidence_package_id,
                successor_evidence_package_id: evidencePackageId,
                successor_semantic_digest: semanticDigest,
                successor_package_artifact_digest: stored.artifact_digest,
                assignment_policy_activation_id: assignmentPolicy.assignment_policy_activation_id,
                assignment_policy_activation_digest: assignmentPolicy.activation_digest }, candidate.assessedAt]
          );
          await client.query(
            `INSERT INTO diagnostic_outbox
              (outbox_id,installation_id,transition_id,event_type,payload,created_at)
             VALUES ($1,$2,$3,'diagnostic.assignment.replacement_requested',$4,$5)`,
            [randomUUID(), installationId, replacementTransitionId,
              { transition_id: replacementTransitionId, reevaluation_notice_id: noticeId },
              candidate.assessedAt]
          );
          transitionCount = 3n;
        }
        await client.query(
          `UPDATE diagnostic_nodes SET revision=revision+$2,next_sequence=next_sequence+$2,updated_at=$3
           WHERE installation_id=$1`, [installationId, transitionCount.toString(), candidate.assessedAt]
        );
      }
      await client.query(
        `UPDATE diagnostic_evidence_revision_monitors
         SET current_evidence_package_id=$2,current_package_material_digest=$3,last_assessed_cutoff=$4,
             monitor_revision=monitor_revision+1,updated_at=$5 WHERE case_id=$1`,
        [caseId, materialChanged ? evidencePackageId : candidate.predecessor.evidence_package_id,
          materialChanged ? candidate.material.digest : candidate.predecessor.package_material_digest,
          candidate.projection.committed_intake_cutoff, candidate.assessedAt]
      );
      await client.query("COMMIT");
      const verificationBundle = materialChanged && verificationBundleWriter
        ? await verificationBundleWriter.sealBundle(evidencePackageId, STAGE_AUTHOR, candidate.assessedAt) : null;
      return { replayed: false, result: {
        status: materialChanged ? "revision_created" : "nonmaterial",
        evidence_package: packageRowView(packageRow),
        assessment: assessmentView(verifyAssessmentRow(assessmentRow)),
        reevaluation_available: noticeRow ? noticeView(verifyNoticeRow(noticeRow)) : null,
        independent_verification_bundle:
          verificationBundle?.result.independent_verification_bundle ?? null
      } };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function processRevision(input, now = new Date()) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await processRevisionAttempt(input, now);
      } catch (error) {
        if (error?.code !== "DIAGNOSTIC_EVIDENCE_REVISION_MONITOR_ADVANCED" || attempt === 2) {
          throw error;
        }
      }
    }
    throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_REVISION_MONITOR_ADVANCED",
      "Revision monitor continued to advance while candidate material was being prepared.");
  }

  async function processAvailableRevisions({ limit = 8, now = new Date() } = {}) {
    const cutoff = (await pool.query(
      `SELECT next_position-1 AS committed_cutoff FROM diagnostic_intake_prefixes
       WHERE installation_id=$1`, [installationId]
    )).rows[0]?.committed_cutoff;
    if (cutoff === undefined) return [];
    const candidates = (await pool.query(
      `SELECT case_id FROM diagnostic_evidence_revision_monitors
       WHERE installation_id=$1 AND environment_id=$2 AND last_assessed_cutoff<$3
       ORDER BY last_assessed_cutoff,case_id LIMIT $4`,
      [installationId, environmentId, cutoff, limit]
    )).rows;
    const results = [];
    for (const entry of candidates) {
      try {
        results.push(await processRevision({ case_id: entry.case_id }, now));
      } catch (error) {
        results.push({ case_id: entry.case_id, error });
      }
    }
    return results;
  }

  function startRevisionMonitor({ intervalMs = 250 } = {}) {
    if (revisionTimer) return;
    revisionTimer = setInterval(async () => {
      if (revisionTickRunning) return;
      revisionTickRunning = true;
      try {
        const results = await processAvailableRevisions();
        const failure = results.find((entry) => entry.error);
        lastRevisionMonitorError = failure ? {
          case_id: failure.case_id,
          code: failure.error?.code ?? failure.error?.name
            ?? "DIAGNOSTIC_EVIDENCE_REVISION_MONITOR_ERROR",
          message: failure.error?.message ?? "Evidence revision assessment failed."
        } : null;
      } catch (error) {
        lastRevisionMonitorError = {
          code: error?.code ?? error?.name ?? "DIAGNOSTIC_EVIDENCE_REVISION_MONITOR_ERROR",
          message: error?.message ?? "Evidence revision monitor failed."
        };
      } finally {
        revisionTickRunning = false;
      }
    }, intervalMs);
    revisionTimer.unref?.();
  }

  function stopRevisionMonitor() {
    if (revisionTimer) clearInterval(revisionTimer);
    revisionTimer = null;
  }

  async function getRevisionStatus(caseId) {
    uuid(caseId, "case_id");
    const monitor = await loadRevisionMonitor(caseId);
    const assessments = (await pool.query(
      `SELECT * FROM diagnostic_evidence_revision_assessments
       WHERE installation_id=$1 AND environment_id=$2 AND case_id=$3
       ORDER BY candidate_cutoff,assessed_at,assessment_id`, [installationId, environmentId, caseId]
    )).rows;
    const notices = assessments.length ? (await pool.query(
      `SELECT * FROM diagnostic_reevaluation_notices
       WHERE installation_id=$1 AND environment_id=$2 AND assessment_id=ANY($3::uuid[])
       ORDER BY created_at,reevaluation_notice_id`,
      [installationId, environmentId, assessments.map((entry) => entry.assessment_id)]
    )).rows : [];
    const noticesByAssessment = new Map(notices.map((entry) => [entry.assessment_id, entry]));
    const revisionHistory = assessments.map((entry) => {
      const notice = noticesByAssessment.get(entry.assessment_id) ?? null;
      return {
        assessment: assessmentView(verifyAssessmentRow(entry)),
        reevaluation_available: notice ? noticeView(verifyNoticeRow(notice)) : null
      };
    });
    const latest = revisionHistory.at(-1) ?? null;
    return {
      case_id: caseId,
      current_evidence_package_id: monitor.current_evidence_package_id,
      current_package_material_digest: monitor.current_package_material_digest,
      last_assessed_cutoff: String(monitor.last_assessed_cutoff),
      monitor_revision: String(monitor.monitor_revision),
      monitor_health: lastRevisionMonitorError
        ? { status: "degraded", last_error: lastRevisionMonitorError }
        : { status: "ready", last_error: null },
      latest_assessment: latest?.assessment ?? null,
      reevaluation_available: latest?.reevaluation_available ?? null,
      revision_history: revisionHistory
    };
  }

  async function getCollection(caseId) {
    uuid(caseId, "case_id");
    return (await loadEvidenceCollection(pool, installationId, caseId)).view;
  }

  async function getPackage(evidencePackageId) {
    uuid(evidencePackageId, "evidence_package_id");
    const row = (await pool.query(
      `SELECT * FROM diagnostic_evidence_packages
       WHERE installation_id=$1 AND environment_id=$2 AND evidence_package_id=$3`,
      [installationId, environmentId, evidencePackageId]
    )).rows[0];
    if (!row) {
      throw new KernelError(404, "DIAGNOSTIC_EVIDENCE_PACKAGE_NOT_FOUND",
        "Diagnostic Evidence Package does not exist.");
    }
    return packageRowView(await verifyPackageRow(row, artifactStore));
  }

  return {
    activatePolicy,
    getPolicyActivation,
    processCollection,
    processRevision,
    processAvailableRevisions,
    startRevisionMonitor,
    stopRevisionMonitor,
    getRevisionStatus,
    getCollection,
    getPackage
  };
}
