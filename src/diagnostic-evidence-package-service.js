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
import { KernelError } from "./errors.js";
import { prepareStageArtifactArchive, recordStageArtifactArchive } from "./stage-artifact-archive.js";
import { getAssignmentPolicyActivation } from "./diagnostic-assignment-persistence.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVATION_EXPORT_VERSION = "0.1.0";
const PACKAGE_SCHEMA = "alphonse.diagnostic-evidence-package.v0.1";
const PACKAGE_ARTIFACT_SCHEMA = "alphonse.diagnostic-evidence-package-artifact.v0.1";
const PACKAGE_RECORD_SCHEMA = "alphonse.diagnostic-evidence-package-record.v0.1";
const STAGE_AUTHOR = "diagnostic-stage-worker:evidence-packaging-v0.1";

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
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

function packageRowView(row) {
  return {
    evidence_package_id: row.evidence_package_id,
    case_id: row.case_id,
    trigger_id: row.trigger_id,
    evidence_policy_activation_id: row.evidence_policy_activation_id,
    revision_number: String(row.revision_number),
    committed_intake_cutoff: String(row.committed_intake_cutoff),
    freeze_reason: row.freeze_reason,
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
  if (!row || row.semantic_package?.schema_version !== PACKAGE_SCHEMA
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
      || row.record_document?.schema_version !== PACKAGE_RECORD_SCHEMA
      || row.record_document.evidence_package_id !== row.evidence_package_id
      || row.record_document.semantic_digest !== row.semantic_digest
      || row.record_document.package_artifact_digest !== row.package_artifact_digest
      || row.record_document.frozen_at !== new Date(row.frozen_at).toISOString()) {
    failIntegrity("DIAGNOSTIC_EVIDENCE_PACKAGE_INTEGRITY_VIOLATION",
      "Stored Diagnostic Evidence Package does not match its immutable semantic and record digests.");
  }
  const stored = await artifactStore.getJson(row.package_artifact_digest);
  const artifact = stored.content;
  if (artifact?.schema_version !== PACKAGE_ARTIFACT_SCHEMA
      || artifact.evidence_package_id !== row.evidence_package_id
      || artifact.semantic_digest !== row.semantic_digest
      || !same(artifact.semantic_package, row.semantic_package)) {
    failIntegrity("DIAGNOSTIC_EVIDENCE_PACKAGE_ARTIFACT_INTEGRITY_VIOLATION",
      "Content-addressed worker package does not match the frozen package row.");
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
      scope: structuredClone(projection.semantic_projection.scope),
      freeze: {
        reason: decision.reason,
        committed_intake_cutoff: projection.committed_intake_cutoff,
        collection_deadline: new Date(collectionBefore.row.collection_deadline).toISOString(),
        required_sources_complete: selection.required_sources_complete
      },
      manifest: {
        governed_interpretation_dependencies: governedDependencies({
          projection,
          interpretationActivation,
          policyActivation,
          effectProjection: pipeline.diagnostic_effect_projection.semantic_projection,
          evaluation: pipeline.behavior_evaluation.semantic_evaluation
        }),
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
           selection_rules_digest,record_document,record_digest,frozen_by,frozen_at)
         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [evidencePackageId, installationId, environmentId, caseId, trigger.trigger_id,
          policyActivation.evidence_policy_activation_id, projection.committed_intake_cutoff,
          decision.reason, semanticPackage, semanticDigest, stored.artifact_digest,
          DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST, DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST,
          recordDocument, recordDigest, STAGE_AUTHOR, frozenAt]
      )).rows[0];
      const finalReferences = (await client.query(
        `SELECT * FROM diagnostic_evidence_collection_lease_references
         WHERE lease_id=$1 ORDER BY reference_type,reference_id`, [collection.row.lease_id]
      )).rows;
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
    getCollection,
    getPackage
  };
}
