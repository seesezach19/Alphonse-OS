import { randomUUID } from "node:crypto";

import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import { verifyProjectedObservationMaterials } from "./correlation-input-integrity.js";
import {
  buildDiagnosticClaimEnvelope,
  validateDiagnosticClaimEnvelope
} from "./diagnostic-claim-envelope.js";
import {
  validateBehaviorContract,
  validateDiagnosticEvaluator,
  validateIntegrationBehaviorContract
} from "./diagnostic-effect-contracts.js";
import {
  createEvidenceCollectionForTrigger,
  getEvidencePolicyActivation,
  loadEvidenceCollection
} from "./diagnostic-evidence-collection-persistence.js";
import {
  DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST,
  DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_MANIFEST
} from "./diagnostic-effect-artifact.js";
import {
  BEHAVIOR_EVALUATION_SCHEMA,
  COUNT_BY_CORRELATION_RULES_DIGEST,
  evaluateCountByCorrelation
} from "./diagnostic-effect-evaluator.js";
import {
  buildDiagnosticEffectProjection,
  DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST,
  DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA
} from "./diagnostic-effect-projector.js";
import { KernelError } from "./errors.js";
import { prepareStageArtifactArchive, recordStageArtifactArchive } from "./stage-artifact-archive.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGE_ACTIVATION_SCHEMA = "alphonse.diagnostic-interpretation-activation.v0.1";
const EFFECT_RECORD_SCHEMA = "alphonse.diagnostic-effect-projection-record.v0.1";
const EVALUATION_RECORD_SCHEMA = "alphonse.behavior-evaluation-record.v0.1";
const TRIGGER_SCHEMA = "alphonse.diagnostic-trigger.v0.1";
const TRIGGER_SCHEMA_WITH_COLLECTION = "alphonse.diagnostic-trigger.v0.2";
const CASE_SCHEMA = "alphonse.diagnostic-case.v0.1";
const CASE_SCHEMA_WITH_COLLECTION = "alphonse.diagnostic-case.v0.2";
const STAGE_AUTHOR = "diagnostic-stage-worker:effect-evaluation-v0.1";

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function iso(value) {
  return new Date(value).toISOString();
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "DIAGNOSTIC_EFFECT_INPUT_INVALID", `${field} must be an object.`);
  }
  return value;
}

function exact(value, field, keys) {
  object(value, field);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!same(actual, expected)) {
    throw new KernelError(400, "DIAGNOSTIC_EFFECT_INPUT_INVALID", `${field} fields must be exact.`, {
      expected, received: actual
    });
  }
  return value;
}

function uuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new KernelError(400, "DIAGNOSTIC_EFFECT_INPUT_INVALID", `${field} must be a UUID.`);
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

function activationView(row) {
  return {
    activation_id: row.activation_id,
    deployment_id: row.deployment_id,
    package_version_id: row.package_version_id,
    package_artifact_digest: row.package_artifact_digest,
    exports: row.activation_document.exports,
    stage: row.activation_document.stage,
    activation_digest: row.activation_digest,
    activated_by: row.activated_by,
    activated_at: row.activated_at,
    immutable: true,
    authority_granted: false
  };
}

function verifyActivationRow(row, installationId, environmentId) {
  const document = row?.activation_document;
  if (!row || sha256Digest(document) !== row.activation_digest
      || document?.schema_version !== STAGE_ACTIVATION_SCHEMA
      || document.activation_id !== row.activation_id
      || document.installation_id !== installationId
      || document.environment_id !== environmentId
      || document.deployment_id !== row.deployment_id
      || document.package_version_id !== row.package_version_id
      || document.package_artifact_digest !== row.package_artifact_digest
      || document.exports.integration_behavior_contract.kind !== "integration_behavior_contract"
      || document.exports.integration_behavior_contract.export_id !== row.integration_export_id
      || document.exports.behavior_contract.kind !== "behavior_contract"
      || document.exports.behavior_contract.export_id !== row.behavior_export_id
      || document.exports.diagnostic_evaluator.kind !== "diagnostic_evaluator"
      || document.exports.diagnostic_evaluator.export_id !== row.evaluator_export_id
      || sha256Digest(row.integration_contract) !== row.integration_contract_digest
      || sha256Digest(row.behavior_contract) !== row.behavior_contract_digest
      || sha256Digest(row.evaluator_document) !== row.evaluator_digest
      || sha256Digest(row.stage_artifact_manifest) !== row.stage_artifact_digest
      || !same(document.stage.artifact_manifest, row.stage_artifact_manifest)
      || document.stage.artifact_digest !== row.stage_artifact_digest
      || document.stage.interpreter_rules_digest !== row.interpreter_rules_digest
      || document.stage.evaluator_rules_digest !== row.evaluator_rules_digest
      || document.exports.integration_behavior_contract.export_digest !== row.integration_contract_digest
      || document.exports.behavior_contract.export_digest !== row.behavior_contract_digest
      || document.exports.diagnostic_evaluator.export_digest !== row.evaluator_digest) {
    failIntegrity("DIAGNOSTIC_INTERPRETATION_ACTIVATION_INTEGRITY_VIOLATION",
      "Stored diagnostic interpretation activation does not match its immutable material.");
  }
  validateIntegrationBehaviorContract(row.integration_contract);
  validateBehaviorContract(row.behavior_contract);
  validateDiagnosticEvaluator(row.evaluator_document);
  return row;
}

function effectView(row) {
  return {
    effect_projection_id: row.effect_projection_id,
    correlation_projection_id: row.correlation_projection_id,
    activation_id: row.activation_id,
    logical_operation_id: row.logical_operation_id,
    semantic_projection: row.semantic_projection,
    semantic_digest: row.semantic_digest,
    record_digest: row.record_digest,
    created_at: row.created_at,
    immutable: true
  };
}

function verifyEffectRow(row) {
  if (!row || sha256Digest(row.semantic_projection) !== row.semantic_digest
      || row.semantic_projection.schema_version !== DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA
      || sha256Digest(row.record_document) !== row.record_digest
      || row.record_document.schema_version !== EFFECT_RECORD_SCHEMA
      || row.record_document.effect_projection_id !== row.effect_projection_id
      || row.record_document.correlation_projection_id !== row.correlation_projection_id
      || row.record_document.activation_id !== row.activation_id
      || row.record_document.semantic_digest !== row.semantic_digest
      || row.record_document.created_at !== iso(row.created_at)
      || row.semantic_projection.dependencies.correlation_projection_id !== row.correlation_projection_id
      || row.semantic_projection.dependencies.integration_activation_id !== row.activation_id
      || row.semantic_projection.scope.logical_operation_id !== row.logical_operation_id) {
    failIntegrity("DIAGNOSTIC_EFFECT_PROJECTION_INTEGRITY_VIOLATION",
      "Stored Diagnostic Effect Projection does not match its immutable digests.");
  }
  return row;
}

function evaluationView(row) {
  return {
    evaluation_id: row.evaluation_id,
    effect_projection_id: row.effect_projection_id,
    activation_id: row.activation_id,
    logical_operation_id: row.logical_operation_id,
    semantic_evaluation: row.semantic_evaluation,
    semantic_digest: row.semantic_digest,
    record_digest: row.record_digest,
    created_at: row.created_at,
    immutable: true
  };
}

function verifyEvaluationRow(row) {
  if (!row || sha256Digest(row.semantic_evaluation) !== row.semantic_digest
      || row.semantic_evaluation.schema_version !== BEHAVIOR_EVALUATION_SCHEMA
      || sha256Digest(row.record_document) !== row.record_digest
      || row.record_document.schema_version !== EVALUATION_RECORD_SCHEMA
      || row.record_document.evaluation_id !== row.evaluation_id
      || row.record_document.effect_projection_id !== row.effect_projection_id
      || row.record_document.activation_id !== row.activation_id
      || row.record_document.semantic_digest !== row.semantic_digest
      || row.record_document.created_at !== iso(row.created_at)
      || row.semantic_evaluation.dependencies.effect_projection_id !== row.effect_projection_id
      || row.semantic_evaluation.dependencies.behavior_activation_id !== row.activation_id
      || row.semantic_evaluation.dependencies.evaluator_activation_id !== row.activation_id
      || row.semantic_evaluation.scope.logical_operation_id !== row.logical_operation_id) {
    failIntegrity("BEHAVIOR_EVALUATION_INTEGRITY_VIOLATION",
      "Stored Behavior Evaluation does not match its immutable digests.");
  }
  return row;
}

function triggerView(row) {
  const withCollection = row?.trigger_document?.schema_version === TRIGGER_SCHEMA_WITH_COLLECTION;
  if (!row || sha256Digest(row.trigger_document) !== row.trigger_digest
      || ![TRIGGER_SCHEMA, TRIGGER_SCHEMA_WITH_COLLECTION].includes(row.trigger_document.schema_version)
      || row.trigger_document.trigger_id !== row.trigger_id
      || row.trigger_document.evaluation_id !== row.evaluation_id
      || row.trigger_document.logical_operation_id !== row.logical_operation_id
      || (withCollection
        ? row.trigger_document.evidence_policy_activation_id !== row.evidence_policy_activation_id
        : row.evidence_policy_activation_id !== null)
      || row.trigger_document.created_at !== iso(row.created_at)) {
    failIntegrity("DIAGNOSTIC_TRIGGER_INTEGRITY_VIOLATION",
      "Stored Diagnostic Trigger does not match its immutable digest.");
  }
  return { ...row.trigger_document, trigger_digest: row.trigger_digest, immutable: true };
}

function claimView(row) {
  if (!row || sha256Digest(row.claim_document) !== row.claim_digest
      || row.claim_document.claim_id !== row.claim_id
      || row.claim_document.claim_type !== row.claim_type) {
    failIntegrity("DIAGNOSTIC_CLAIM_INTEGRITY_VIOLATION",
      "Stored Diagnostic Claim Envelope does not match its immutable digest.");
  }
  validateDiagnosticClaimEnvelope(row.claim_document);
  return { ...row.claim_document, claim_digest: row.claim_digest, immutable: true };
}

function claimManifestDigest(claims) {
  return sha256Digest(claims.map((claim) => ({
    claim_id: claim.claim_id,
    claim_type: claim.claim_type,
    claim_digest: claim.claim_digest
  })).sort((left, right) => {
    const leftBytes = canonicalize(left);
    const rightBytes = canonicalize(right);
    return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
  }));
}

function caseView(row, trigger, claims) {
  const withCollection = row?.case_document?.schema_version === CASE_SCHEMA_WITH_COLLECTION;
  if (!row || row.case_origin !== "deterministic_behavior_trigger"
      || sha256Digest(row.case_document) !== row.case_digest
      || ![CASE_SCHEMA, CASE_SCHEMA_WITH_COLLECTION].includes(row.case_document.schema_version)
      || row.case_document.case_id !== row.case_id
      || row.case_document.trigger_id !== row.trigger_id
      || row.case_document.trigger_digest !== trigger.trigger_digest
      || (withCollection
        ? row.case_document.evidence_policy_activation_id !== trigger.evidence_policy_activation_id
          || row.case_document.evidence_collection_required !== true
        : trigger.evidence_policy_activation_id !== undefined)
      || row.case_document.opening_basis.evaluation_id !== trigger.evaluation_id
      || row.case_document.opening_basis.evaluation_semantic_digest !== trigger.evaluation_semantic_digest
      || row.case_document.claim_manifest_digest !== claimManifestDigest(claims)
      || row.report_digest !== row.case_digest) {
    failIntegrity("DIAGNOSTIC_CASE_INTEGRITY_VIOLATION",
      "Stored deterministic Diagnostic Case does not match its immutable digest.");
  }
  return {
    ...row.case_document,
    case_digest: row.case_digest,
    reported_by: { type: row.reported_by_actor_type, id: row.reported_by_actor_id },
    reported_at: row.reported_at,
    trigger,
    claims,
    immutable: true
  };
}

export function createDiagnosticEffectEvaluationService({
  database,
  artifactStore = null,
  installationId,
  environmentId,
  correlationReader,
  resolveDeploymentExports
}) {
  const { pool } = database;

  async function getActivation(activationId, client = pool) {
    uuid(activationId, "activation_id");
    const row = (await client.query(
      `SELECT * FROM diagnostic_interpretation_activations
       WHERE installation_id=$1 AND environment_id=$2 AND activation_id=$3`,
      [installationId, environmentId, activationId]
    )).rows[0];
    if (!row) throw new KernelError(404, "DIAGNOSTIC_INTERPRETATION_ACTIVATION_NOT_FOUND",
      "Diagnostic interpretation activation does not exist.");
    return verifyActivationRow(row, installationId, environmentId);
  }

  async function activate(input, actorId, now = new Date()) {
    exact(input, "input", [
      "activation_id", "deployment_id", "integration_contract_export_id",
      "behavior_contract_export_id", "evaluator_export_id"
    ]);
    const activationId = uuid(input.activation_id, "activation_id");
    const deploymentId = uuid(input.deployment_id, "deployment_id");
    const resolved = await resolveDeploymentExports(deploymentId, [
      input.integration_contract_export_id,
      input.behavior_contract_export_id,
      input.evaluator_export_id
    ]);
    if (resolved.deployment_id !== deploymentId) {
      throw new KernelError(500, "DIAGNOSTIC_INTERPRETATION_DEPLOYMENT_INTEGRITY_VIOLATION",
        "Resolved interpretation exports do not belong to the requested deployment.");
    }
    const [integrationExport, behaviorExport, evaluatorExport] = [
      resolved.exports.get(input.integration_contract_export_id),
      resolved.exports.get(input.behavior_contract_export_id),
      resolved.exports.get(input.evaluator_export_id)
    ];
    if (integrationExport?.kind !== "integration_behavior_contract"
        || behaviorExport?.kind !== "behavior_contract"
        || evaluatorExport?.kind !== "diagnostic_evaluator") {
      throw new KernelError(409, "DIAGNOSTIC_INTERPRETATION_EXPORT_MISMATCH",
        "Activation must reference one exact Integration Contract, Behavior Contract, and Diagnostic Evaluator export.");
    }
    const integrationContract = validateIntegrationBehaviorContract(integrationExport.content);
    const behaviorContract = validateBehaviorContract(behaviorExport.content);
    const evaluatorDocument = validateDiagnosticEvaluator(evaluatorExport.content);
    if (integrationContract.integration_id !== behaviorContract.integration_id
        || integrationContract.destination_id !== behaviorContract.selector.destination_id) {
      throw new KernelError(409, "DIAGNOSTIC_INTERPRETATION_SCOPE_MISMATCH",
        "Activated Integration and Behavior Contracts must describe one exact destination scope.");
    }
    const references = {
      integration_behavior_contract: exportReference(integrationExport),
      behavior_contract: exportReference(behaviorExport),
      diagnostic_evaluator: exportReference(evaluatorExport)
    };
    const document = {
      schema_version: STAGE_ACTIVATION_SCHEMA,
      activation_id: activationId,
      installation_id: installationId,
      environment_id: environmentId,
      deployment_id: deploymentId,
      package_version_id: resolved.package_version_id,
      package_artifact_digest: resolved.package_artifact_digest,
      exports: references,
      stage: {
        artifact_manifest: DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_MANIFEST,
        artifact_digest: DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST,
        interpreter_rules_digest: DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST,
        evaluator_rules_digest: COUNT_BY_CORRELATION_RULES_DIGEST
      }
    };
    const activationDigest = sha256Digest(document);
    const activatedAt = new Date(now).toISOString();
    const preparedStageArchive = artifactStore
      ? await prepareStageArtifactArchive(artifactStore, DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_MANIFEST) : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (preparedStageArchive) {
        await recordStageArtifactArchive({ client, installationId, prepared: preparedStageArchive,
          archivedAt: activatedAt });
      }
      const existing = (await client.query(
        "SELECT * FROM diagnostic_interpretation_activations WHERE installation_id=$1 AND activation_id=$2 FOR SHARE",
        [installationId, activationId]
      )).rows[0];
      if (existing) {
        verifyActivationRow(existing, installationId, environmentId);
        if (existing.activation_digest !== activationDigest) {
          throw new KernelError(409, "DIAGNOSTIC_INTERPRETATION_ACTIVATION_IDENTITY_CONFLICT",
            "Activation ID already binds different immutable interpretation material.");
        }
        await client.query("COMMIT");
        return { replayed: true, result: { interpretation_activation: activationView(existing) } };
      }
      const row = (await client.query(
        `INSERT INTO diagnostic_interpretation_activations
          (activation_id,installation_id,environment_id,deployment_id,package_version_id,
           package_artifact_digest,integration_export_id,integration_contract,integration_contract_digest,
           behavior_export_id,behavior_contract,behavior_contract_digest,evaluator_export_id,evaluator_document,
           evaluator_digest,stage_artifact_manifest,stage_artifact_digest,interpreter_rules_digest,
           evaluator_rules_digest,activation_document,activation_digest,activated_by,activated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING *`,
        [activationId, installationId, environmentId, deploymentId, resolved.package_version_id,
          resolved.package_artifact_digest, integrationExport.export_id, integrationContract,
          references.integration_behavior_contract.export_digest, behaviorExport.export_id, behaviorContract,
          references.behavior_contract.export_digest, evaluatorExport.export_id, evaluatorDocument,
          references.diagnostic_evaluator.export_digest, DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_MANIFEST,
          DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST, DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST,
          COUNT_BY_CORRELATION_RULES_DIGEST, document, activationDigest, actorId, activatedAt]
      )).rows[0];
      await client.query("COMMIT");
      return { replayed: false, result: { interpretation_activation: activationView(row) } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function loadExistingPipeline(client, effectRow) {
    verifyEffectRow(effectRow);
    const evaluationRow = verifyEvaluationRow((await client.query(
      "SELECT * FROM diagnostic_behavior_evaluations WHERE installation_id=$1 AND effect_projection_id=$2",
      [installationId, effectRow.effect_projection_id]
    )).rows[0]);
    const triggerRow = (await client.query(
      "SELECT * FROM diagnostic_behavior_triggers WHERE installation_id=$1 AND evaluation_id=$2",
      [installationId, evaluationRow.evaluation_id]
    )).rows[0];
    if (!triggerRow) failIntegrity("DIAGNOSTIC_PIPELINE_INTEGRITY_VIOLATION",
      "Violated Behavior Evaluation is missing its deterministic trigger.");
    const trigger = triggerView(triggerRow);
    if (trigger.evaluation_semantic_digest !== evaluationRow.semantic_digest
        || trigger.logical_operation_id !== evaluationRow.logical_operation_id) {
      failIntegrity("DIAGNOSTIC_PIPELINE_INTEGRITY_VIOLATION",
        "Diagnostic Trigger does not bind the exact Behavior Evaluation semantics and scope.");
    }
    const caseRow = (await client.query(
      "SELECT * FROM diagnostic_cases WHERE installation_id=$1 AND trigger_id=$2",
      [installationId, trigger.trigger_id]
    )).rows[0];
    const claimRows = (await client.query(
      "SELECT * FROM diagnostic_claim_envelopes WHERE installation_id=$1 AND case_id=$2 ORDER BY claim_type,claim_id",
      [installationId, caseRow?.case_id]
    )).rows;
    const claims = claimRows.map(claimView);
    const collection = trigger.evidence_policy_activation_id
      ? (await loadEvidenceCollection(client, installationId, caseRow.case_id)).view : null;
    return {
      diagnostic_effect_projection: effectView(effectRow),
      behavior_evaluation: evaluationView(evaluationRow),
      diagnostic_trigger: trigger,
      diagnostic_case: caseView(caseRow, trigger, claims),
      evidence_collection: collection
    };
  }

  function claimsForPipeline({ projection, effectProjection, evaluation, trigger, caseId, assessedAt }) {
    const commonTemporal = {
      valid_at: null,
      observed_at: null,
      accepted_at: null,
      assessed_at: assessedAt,
      freshness: "frozen_historical",
      expires_at: null
    };
    const claims = projection.semantic_projection.graph.nodes
      .filter((node) => node.receipt_reference)
      .map((node) => buildDiagnosticClaimEnvelope({
        claimType: "authenticated_observation",
        productionMethod: "observed",
        proposition: {
          subject_type: node.node_type,
          subject_id: node.claimed_identity,
          predicate: "authenticated_observation_preserved",
          value: "observer_specific_grant_attribution"
        },
        evidenceReferences: [{
          record_type: "diagnostic_observation_receipt",
          record_id: node.receipt_reference.receipt_id,
          record_digest: node.receipt_reference.receipt_digest
        }],
        verificationResults: ["source_identity_verified", "source_bytes_verified", "process_compliance_verified"],
        assertedSupport: "AUTHENTICATED_OBSERVATION",
        effectiveSupport: "AUTHENTICATED_OBSERVATION",
        evidenceStatus: "complete",
        temporalScope: commonTemporal,
        limitations: ["exclusive_authorship_not_established", "external_truth_not_established"],
        authorityDecision: { authority: "none", permitted_consequence: "none", decision_basis: "no_authority" }
      }));
    for (const effect of effectProjection.semantic_projection.effects.filter((item) => item.status === "committed")) {
      claims.push(buildDiagnosticClaimEnvelope({
        claimType: "committed_effect_interpretation",
        productionMethod: "deterministically_derived",
        proposition: {
          subject_type: "diagnostic_effect",
          subject_id: effect.effect_id,
          predicate: "contract_interpreted_status",
          value: "committed"
        },
        evidenceReferences: [{
          record_type: "diagnostic_effect_projection",
          record_id: effectProjection.effect_projection_id,
          record_digest: effectProjection.semantic_digest
        }, ...effect.supporting_receipts.map((receipt) => ({
          record_type: "diagnostic_observation_receipt",
          record_id: receipt.receipt_id,
          record_digest: receipt.receipt_digest
        }))],
        verificationResults: ["deterministically_recomputed", "evidence_references_verified"],
        assertedSupport: "DETERMINISTICALLY_ESTABLISHED",
        effectiveSupport: "DETERMINISTICALLY_ESTABLISHED",
        evidenceStatus: "complete",
        temporalScope: { ...commonTemporal, valid_at: effect.committed_at },
        limitations: effect.limitations,
        authorityDecision: { authority: "none", permitted_consequence: "none", decision_basis: "no_authority" }
      }));
    }
    claims.push(buildDiagnosticClaimEnvelope({
      claimType: "behavior_invariant_evaluation",
      productionMethod: "deterministically_derived",
      proposition: {
        subject_type: "behavior_contract",
        subject_id: evaluation.semantic_evaluation.dependencies.behavior_contract_digest,
        predicate: "evaluation_result",
        value: evaluation.semantic_evaluation.result
      },
      evidenceReferences: [{
        record_type: "behavior_evaluation",
        record_id: evaluation.evaluation_id,
        record_digest: evaluation.semantic_digest
      }],
      verificationResults: ["deterministically_recomputed", "evidence_references_verified"],
      assertedSupport: "DETERMINISTICALLY_ESTABLISHED",
      effectiveSupport: "DETERMINISTICALLY_ESTABLISHED",
      evidenceStatus: "complete",
      temporalScope: commonTemporal,
      authorityDecision: {
        authority: "diagnostic",
        permitted_consequence: "case_creation",
        decision_basis: "closed_deterministic_policy"
      }
    }));
    claims.push(buildDiagnosticClaimEnvelope({
      claimType: "unresolved_conclusion",
      productionMethod: "deterministically_derived",
      proposition: { subject_type: "diagnostic_case", subject_id: caseId, predicate: "root_cause", value: null },
      evidenceReferences: [{
        record_type: "diagnostic_trigger",
        record_id: trigger.trigger_id,
        record_digest: trigger.trigger_digest
      }],
      verificationResults: ["evidence_references_verified"],
      assertedSupport: "NOT_ESTABLISHED",
      effectiveSupport: "NOT_ESTABLISHED",
      evidenceStatus: "partial",
      temporalScope: commonTemporal,
      limitations: ["causal_mechanism_not_evaluated", "responsible_implementation_location_not_established"],
      authorityDecision: { authority: "none", permitted_consequence: "none", decision_basis: "no_authority" }
    }));
    return claims;
  }

  async function process(input, now = new Date()) {
    const withEvidenceCollection = Object.hasOwn(input ?? {}, "evidence_policy_activation_id");
    exact(input, "input", withEvidenceCollection
      ? ["correlation_projection_id", "activation_id", "evidence_policy_activation_id"]
      : ["correlation_projection_id", "activation_id"]);
    const correlationProjectionId = uuid(input.correlation_projection_id, "correlation_projection_id");
    const activationId = uuid(input.activation_id, "activation_id");
    const evidencePolicyActivationId = withEvidenceCollection
      ? uuid(input.evidence_policy_activation_id, "evidence_policy_activation_id") : null;
    const projection = await correlationReader.getProjection(correlationProjectionId);
    if (projection.semantic_projection.schema_version !== "alphonse.correlation-projection.v0.2") {
      throw new KernelError(409, "DIAGNOSTIC_EFFECT_PROJECTION_VERSION_UNSUPPORTED",
        "Ticket 09 requires one hardened v0.2 Correlation Projection.");
    }
    if (sha256Digest(projection.semantic_projection) !== projection.semantic_digest) {
      failIntegrity("CORRELATION_PROJECTION_INTEGRITY_VIOLATION",
        "Correlation Projection semantic material does not match its reported digest.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`diagnostic-effect:${installationId}:${correlationProjectionId}:${activationId}`]);
      const activation = await getActivation(activationId, client);
      const evidencePolicyActivation = evidencePolicyActivationId
        ? await getEvidencePolicyActivation(client, {
          installationId,
          environmentId,
          evidencePolicyActivationId
        }) : null;
      if (evidencePolicyActivation
          && (evidencePolicyActivation.interpretation_activation_id !== activationId
            || evidencePolicyActivation.deployment_id !== activation.deployment_id
            || evidencePolicyActivation.package_version_id !== activation.package_version_id
            || evidencePolicyActivation.package_artifact_digest !== activation.package_artifact_digest)) {
        throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_POLICY_SCOPE_MISMATCH",
          "Evidence policy activation does not bind the exact interpretation activation and deployed package.");
      }
      if (activation.stage_artifact_digest !== DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST
          || !same(activation.stage_artifact_manifest, DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_MANIFEST)
          || activation.interpreter_rules_digest !== DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST
          || activation.evaluator_rules_digest !== COUNT_BY_CORRELATION_RULES_DIGEST) {
        throw new KernelError(409, "DIAGNOSTIC_INTERPRETATION_ARTIFACT_MISMATCH",
          "Activated interpretation material differs from the running deterministic stage.");
      }
      const references = projection.semantic_projection.graph.nodes
        .filter((node) => ["destination.effect", "destination.request"].includes(node.node_type))
        .map((node) => node.receipt_reference);
      const receiptIds = references.map((reference) => reference.receipt_id);
      const observationRows = (await client.query(
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
        [installationId, receiptIds]
      )).rows;
      const observationEvidence = verifyProjectedObservationMaterials({
        receiptReferences: references,
        observationRows,
        installationId,
        environmentId
      });
      const interpreted = buildDiagnosticEffectProjection({
        correlationProjectionId,
        correlationSemanticDigest: projection.semantic_digest,
        correlationProjection: projection.semantic_projection,
        integrationActivationId: activationId,
        integrationContract: activation.integration_contract,
        integrationContractDigest: activation.integration_contract_digest,
        interpreterArtifactDigest: DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST,
        observationEvidence
      });
      const effectProjectionId = deterministicUuid({
        namespace: "diagnostic-effect-projection",
        correlation_projection_id: correlationProjectionId,
        activation_digest: activation.activation_digest
      });
      const recomputedEvaluation = () => evaluateCountByCorrelation({
        effectProjectionId,
        effectSemanticDigest: interpreted.semantic_digest,
        effectProjection: interpreted.semantic_projection,
        behaviorActivationId: activationId,
        behaviorContract: activation.behavior_contract,
        behaviorContractDigest: activation.behavior_contract_digest,
        evaluatorActivationId: activationId,
        evaluator: activation.evaluator_document,
        evaluatorDigest: activation.evaluator_digest,
        evaluatorArtifactDigest: DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST,
        evaluatorRulesDigest: COUNT_BY_CORRELATION_RULES_DIGEST
      });
      const existing = (await client.query(
        `SELECT * FROM diagnostic_effect_projections
         WHERE installation_id=$1 AND correlation_projection_id=$2 AND activation_id=$3`,
        [installationId, correlationProjectionId, activationId]
      )).rows[0];
      if (existing) {
        verifyEffectRow(existing);
        if (existing.effect_projection_id !== effectProjectionId
            || existing.semantic_digest !== interpreted.semantic_digest
            || !same(existing.semantic_projection, interpreted.semantic_projection)) {
          failIntegrity("DIAGNOSTIC_EFFECT_PROJECTION_NONDETERMINISM",
            "Exact projection, activation, and verified observation inputs produced different effect semantics.");
        }
        const result = await loadExistingPipeline(client, existing);
        if ((result.diagnostic_trigger.evidence_policy_activation_id ?? null) !== evidencePolicyActivationId) {
          throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_POLICY_TRIGGER_CONFLICT",
            "Existing deterministic trigger binds a different evidence collection policy.");
        }
        const expectedEvaluation = recomputedEvaluation();
        if (result.behavior_evaluation.evaluation_id !== expectedEvaluation.evaluation_id
            || result.behavior_evaluation.semantic_digest !== expectedEvaluation.semantic_digest
            || !same(result.behavior_evaluation.semantic_evaluation, expectedEvaluation.semantic_evaluation)) {
          failIntegrity("BEHAVIOR_EVALUATION_NONDETERMINISM",
            "Exact normalized effects and evaluator material produced different Behavior Evaluation semantics.");
        }
        await client.query("COMMIT");
        return { replayed: true, result };
      }
      const createdAt = new Date(now).toISOString();
      const effectRecord = {
        schema_version: EFFECT_RECORD_SCHEMA,
        effect_projection_id: effectProjectionId,
        correlation_projection_id: correlationProjectionId,
        activation_id: activationId,
        semantic_digest: interpreted.semantic_digest,
        created_at: createdAt
      };
      const effectRecordDigest = sha256Digest(effectRecord);
      const effectRow = (await client.query(
        `INSERT INTO diagnostic_effect_projections
          (effect_projection_id,installation_id,environment_id,correlation_projection_id,activation_id,
           logical_operation_id,semantic_projection,semantic_digest,record_document,record_digest,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [effectProjectionId, installationId, environmentId, correlationProjectionId, activationId,
          projection.logical_operation_id, interpreted.semantic_projection, interpreted.semantic_digest,
          effectRecord, effectRecordDigest, createdAt]
      )).rows[0];
      const evaluation = recomputedEvaluation();
      const evaluationRecord = {
        schema_version: EVALUATION_RECORD_SCHEMA,
        evaluation_id: evaluation.evaluation_id,
        effect_projection_id: effectProjectionId,
        activation_id: activationId,
        semantic_digest: evaluation.semantic_digest,
        created_at: createdAt
      };
      const evaluationRecordDigest = sha256Digest(evaluationRecord);
      const evaluationRow = (await client.query(
        `INSERT INTO diagnostic_behavior_evaluations
          (evaluation_id,installation_id,environment_id,effect_projection_id,activation_id,
           logical_operation_id,semantic_evaluation,semantic_digest,record_document,record_digest,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [evaluation.evaluation_id, installationId, environmentId, effectProjectionId, activationId,
          projection.logical_operation_id, evaluation.semantic_evaluation, evaluation.semantic_digest,
          evaluationRecord, evaluationRecordDigest, createdAt]
      )).rows[0];
      if (evaluation.semantic_evaluation.result !== "violated") {
        throw new KernelError(409, "BEHAVIOR_EVALUATION_NOT_VIOLATED",
          "Only a deterministically violated evaluation may create a Diagnostic Trigger and case.", {
            evaluation_id: evaluation.evaluation_id,
            result: evaluation.semantic_evaluation.result
          });
      }
      const triggerId = deterministicUuid({
        namespace: "diagnostic-trigger",
        behavior_contract_digest: activation.behavior_contract_digest,
        logical_operation_id: projection.logical_operation_id,
        evaluation_semantic_digest: evaluation.semantic_digest
      });
      const caseId = deterministicUuid({ namespace: "diagnostic-case", trigger_id: triggerId });
      const triggerDocument = {
        schema_version: evidencePolicyActivation ? TRIGGER_SCHEMA_WITH_COLLECTION : TRIGGER_SCHEMA,
        trigger_id: triggerId,
        case_id: caseId,
        evaluation_id: evaluation.evaluation_id,
        evaluation_semantic_digest: evaluation.semantic_digest,
        behavior_contract_digest: activation.behavior_contract_digest,
        logical_operation_id: projection.logical_operation_id,
        trigger_basis: "deterministically_violated_behavior_contract",
        root_cause_established: false,
        repair_authority_granted: false,
        kernel_effect_authority_granted: false,
        ...(evidencePolicyActivation ? {
          evidence_policy_activation_id: evidencePolicyActivation.evidence_policy_activation_id,
          evidence_policy_activation_digest: evidencePolicyActivation.activation_digest,
          evidence_collection_required: true
        } : {}),
        created_at: createdAt
      };
      const triggerDigest = sha256Digest(triggerDocument);
      const triggerRow = (await client.query(
        `INSERT INTO diagnostic_behavior_triggers
          (trigger_id,installation_id,environment_id,evaluation_id,logical_operation_id,
           trigger_document,trigger_digest,created_at,evidence_policy_activation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [triggerId, installationId, environmentId, evaluation.evaluation_id,
          projection.logical_operation_id, triggerDocument, triggerDigest, createdAt,
          evidencePolicyActivation?.evidence_policy_activation_id ?? null]
      )).rows[0];
      const trigger = triggerView(triggerRow);
      const claimMaterials = claimsForPipeline({
        projection,
        effectProjection: { effect_projection_id: effectProjectionId,
          semantic_digest: interpreted.semantic_digest, semantic_projection: interpreted.semantic_projection },
        evaluation: { evaluation_id: evaluation.evaluation_id,
          semantic_digest: evaluation.semantic_digest, semantic_evaluation: evaluation.semantic_evaluation },
        trigger,
        caseId,
        assessedAt: createdAt
      });
      const caseDocument = {
        schema_version: evidencePolicyActivation ? CASE_SCHEMA_WITH_COLLECTION : CASE_SCHEMA,
        case_id: caseId,
        trigger_id: triggerId,
        trigger_digest: triggerDigest,
        state: "open",
        scope: structuredClone(projection.semantic_projection.scope),
        opening_basis: {
          evaluation_id: evaluation.evaluation_id,
          evaluation_semantic_digest: evaluation.semantic_digest,
          result: "violated"
        },
        claim_manifest_digest: claimManifestDigest(claimMaterials.map((claim) => ({
          ...claim.document,
          claim_digest: claim.claim_digest
        }))),
        ...(evidencePolicyActivation ? {
          evidence_policy_activation_id: evidencePolicyActivation.evidence_policy_activation_id,
          evidence_policy_activation_digest: evidencePolicyActivation.activation_digest,
          evidence_collection_required: true
        } : {}),
        root_cause_status: "NOT_ESTABLISHED",
        authority: {
          diagnosis: "not_granted",
          repair: "not_granted",
          kernel_effect: "not_granted"
        }
      };
      const caseDigest = sha256Digest(caseDocument);
      const caseRow = (await client.query(
        `INSERT INTO diagnostic_cases
          (case_id,installation_id,trace_id,workflow_id,revision_id,summary,report_digest,
           reported_by_actor_type,reported_by_actor_id,reported_at,case_origin,trigger_id,case_document,case_digest)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,'service',$7,$8,'deterministic_behavior_trigger',$9,$10,$11)
         RETURNING *`,
        [caseId, installationId, projection.semantic_projection.scope.workflow_id,
          projection.semantic_projection.scope.revision_id,
          "A configured behavior invariant was deterministically violated.", caseDigest,
          STAGE_AUTHOR, createdAt, triggerId, caseDocument, caseDigest]
      )).rows[0];
      for (const claim of claimMaterials) {
        await client.query(
          `INSERT INTO diagnostic_claim_envelopes
            (claim_id,installation_id,environment_id,case_id,claim_type,claim_document,claim_digest,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [claim.document.claim_id, installationId, environmentId, caseId, claim.document.claim_type,
            claim.document, claim.claim_digest, createdAt]
        );
      }
      const evidenceCollection = evidencePolicyActivation
        ? await createEvidenceCollectionForTrigger({
          client,
          installationId,
          environmentId,
          caseId,
          triggerId,
          triggerDigest,
          evidencePolicyActivation,
          initialReferences: [
            { reference_type: "correlation_projection", reference_id: correlationProjectionId,
              reference_digest: projection.semantic_digest },
            { reference_type: "diagnostic_interpretation_activation", reference_id: activationId,
              reference_digest: activation.activation_digest },
            { reference_type: "evidence_policy_activation",
              reference_id: evidencePolicyActivation.evidence_policy_activation_id,
              reference_digest: evidencePolicyActivation.activation_digest },
            { reference_type: "diagnostic_effect_projection", reference_id: effectProjectionId,
              reference_digest: interpreted.semantic_digest },
            { reference_type: "behavior_evaluation", reference_id: evaluation.evaluation_id,
              reference_digest: evaluation.semantic_digest },
            { reference_type: "diagnostic_trigger", reference_id: triggerId,
              reference_digest: triggerDigest },
            { reference_type: "diagnostic_case", reference_id: caseId, reference_digest: caseDigest },
            ...claimMaterials.map((claim) => ({
              reference_type: "diagnostic_claim_envelope",
              reference_id: claim.document.claim_id,
              reference_digest: claim.claim_digest
            }))
          ],
          createdAt
        }) : null;
      const transitionId = randomUUID();
      const stageCommandId = `behavior-trigger:${triggerId}`;
      await client.query(
        `INSERT INTO diagnostic_commands
          (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
         VALUES ($1,$2,$3,'diagnostic.effect_evaluation.process','service',$4,$5,$6)`,
        [installationId, stageCommandId, sha256Digest({
          correlation_projection_id: correlationProjectionId,
          activation_id: activationId,
          evidence_policy_activation_id: evidencePolicyActivationId,
          evaluation_semantic_digest: evaluation.semantic_digest
        }), STAGE_AUTHOR, { trigger_id: triggerId, case_id: caseId, case_digest: caseDigest,
          evidence_collection_lease_id: evidenceCollection?.row.lease_id ?? null }, createdAt]
      );
      const node = (await client.query(
        "SELECT revision,next_sequence FROM diagnostic_nodes WHERE installation_id=$1 FOR UPDATE",
        [installationId]
      )).rows[0];
      await client.query(
        `INSERT INTO diagnostic_transitions
          (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
           from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
         VALUES ($1,$2,$3,'diagnostic_case',$4,'diagnostic.case.behavior_violation_opened',0,1,$5,
                 'service',$6,$7,$8)`,
        [transitionId, installationId, String(node.next_sequence), caseId,
          stageCommandId, STAGE_AUTHOR,
          { trigger_id: triggerId, trigger_digest: triggerDigest,
            evaluation_id: evaluation.evaluation_id, case_digest: caseDigest,
            evidence_collection_lease_id: evidenceCollection?.row.lease_id ?? null }, createdAt]
      );
      await client.query(
        "UPDATE diagnostic_nodes SET revision=revision+1,next_sequence=next_sequence+1,updated_at=$2 WHERE installation_id=$1",
        [installationId, createdAt]
      );
      const claimRows = (await client.query(
        "SELECT * FROM diagnostic_claim_envelopes WHERE installation_id=$1 AND case_id=$2 ORDER BY claim_type,claim_id",
        [installationId, caseId]
      )).rows;
      const claims = claimRows.map(claimView);
      await client.query("COMMIT");
      return { replayed: false, result: {
        diagnostic_effect_projection: effectView(effectRow),
        behavior_evaluation: evaluationView(evaluationRow),
        diagnostic_trigger: trigger,
        diagnostic_case: caseView(caseRow, trigger, claims),
        evidence_collection: evidenceCollection?.view ?? null
      } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function reevaluate(input, now = new Date()) {
    exact(input, "input", ["case_id", "correlation_projection_id", "activation_id"]);
    const caseId = uuid(input.case_id, "case_id");
    const correlationProjectionId = uuid(input.correlation_projection_id, "correlation_projection_id");
    const activationId = uuid(input.activation_id, "activation_id");
    const diagnosticCase = await getDeterministicCase(caseId);
    const openingEvaluation = await getEvaluation(diagnosticCase.opening_basis.evaluation_id);
    const openingEffectProjection = await getEffectProjection(openingEvaluation.effect_projection_id);
    if (openingEffectProjection.activation_id !== activationId) {
      throw new KernelError(409, "DIAGNOSTIC_REEVALUATION_ACTIVATION_DRIFT",
        "Ordinary late-evidence reevaluation must reuse the exact case-opening interpretation activation.");
    }
    const projection = await correlationReader.getProjection(correlationProjectionId);
    if (projection.logical_operation_id !== openingEffectProjection.logical_operation_id
        || projection.semantic_projection.scope.workflow_id !== diagnosticCase.scope.workflow_id
        || projection.semantic_projection.scope.integration_id !== diagnosticCase.scope.integration_id
        || sha256Digest(projection.semantic_projection) !== projection.semantic_digest) {
      throw new KernelError(409, "DIAGNOSTIC_REEVALUATION_SCOPE_MISMATCH",
        "Reevaluation projection does not match the exact existing Diagnostic Case scope.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`diagnostic-effect:${installationId}:${correlationProjectionId}:${activationId}`]);
      const activation = await getActivation(activationId, client);
      if (activation.stage_artifact_digest !== DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST
          || !same(activation.stage_artifact_manifest, DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_MANIFEST)
          || activation.interpreter_rules_digest !== DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST
          || activation.evaluator_rules_digest !== COUNT_BY_CORRELATION_RULES_DIGEST) {
        throw new KernelError(409, "DIAGNOSTIC_INTERPRETATION_ARTIFACT_MISMATCH",
          "Pinned interpretation material differs from the running deterministic reevaluation stage.");
      }
      const references = projection.semantic_projection.graph.nodes
        .filter((node) => ["destination.effect", "destination.request"].includes(node.node_type))
        .map((node) => node.receipt_reference);
      const observationRows = references.length ? (await client.query(
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
      )).rows : [];
      const observationEvidence = verifyProjectedObservationMaterials({
        receiptReferences: references,
        observationRows,
        installationId,
        environmentId
      });
      const interpreted = buildDiagnosticEffectProjection({
        correlationProjectionId,
        correlationSemanticDigest: projection.semantic_digest,
        correlationProjection: projection.semantic_projection,
        integrationActivationId: activationId,
        integrationContract: activation.integration_contract,
        integrationContractDigest: activation.integration_contract_digest,
        interpreterArtifactDigest: DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST,
        observationEvidence
      });
      const effectProjectionId = deterministicUuid({
        namespace: "diagnostic-effect-projection",
        correlation_projection_id: correlationProjectionId,
        activation_digest: activation.activation_digest
      });
      const evaluation = evaluateCountByCorrelation({
        effectProjectionId,
        effectSemanticDigest: interpreted.semantic_digest,
        effectProjection: interpreted.semantic_projection,
        behaviorActivationId: activationId,
        behaviorContract: activation.behavior_contract,
        behaviorContractDigest: activation.behavior_contract_digest,
        evaluatorActivationId: activationId,
        evaluator: activation.evaluator_document,
        evaluatorDigest: activation.evaluator_digest,
        evaluatorArtifactDigest: DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST,
        evaluatorRulesDigest: COUNT_BY_CORRELATION_RULES_DIGEST
      });
      const existing = (await client.query(
        `SELECT * FROM diagnostic_effect_projections
         WHERE installation_id=$1 AND correlation_projection_id=$2 AND activation_id=$3`,
        [installationId, correlationProjectionId, activationId]
      )).rows[0];
      if (existing) {
        verifyEffectRow(existing);
        if (existing.effect_projection_id !== effectProjectionId
            || existing.semantic_digest !== interpreted.semantic_digest
            || !same(existing.semantic_projection, interpreted.semantic_projection)) {
          failIntegrity("DIAGNOSTIC_EFFECT_PROJECTION_NONDETERMINISM",
            "Exact reevaluation inputs produced different effect semantics.");
        }
        const evaluationRow = verifyEvaluationRow((await client.query(
          `SELECT * FROM diagnostic_behavior_evaluations
           WHERE installation_id=$1 AND effect_projection_id=$2`,
          [installationId, effectProjectionId]
        )).rows[0]);
        if (evaluationRow.evaluation_id !== evaluation.evaluation_id
            || evaluationRow.semantic_digest !== evaluation.semantic_digest
            || !same(evaluationRow.semantic_evaluation, evaluation.semantic_evaluation)) {
          failIntegrity("BEHAVIOR_EVALUATION_NONDETERMINISM",
            "Exact reevaluation inputs produced different Behavior Evaluation semantics.");
        }
        await client.query("COMMIT");
        return { replayed: true, result: {
          diagnostic_effect_projection: effectView(existing),
          behavior_evaluation: evaluationView(evaluationRow),
          diagnostic_case: diagnosticCase,
          trigger_created: false,
          case_created: false
        } };
      }
      const createdAt = iso(now);
      const effectRecord = {
        schema_version: EFFECT_RECORD_SCHEMA,
        effect_projection_id: effectProjectionId,
        correlation_projection_id: correlationProjectionId,
        activation_id: activationId,
        semantic_digest: interpreted.semantic_digest,
        created_at: createdAt
      };
      const effectRow = (await client.query(
        `INSERT INTO diagnostic_effect_projections
          (effect_projection_id,installation_id,environment_id,correlation_projection_id,activation_id,
           logical_operation_id,semantic_projection,semantic_digest,record_document,record_digest,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [effectProjectionId, installationId, environmentId, correlationProjectionId, activationId,
          projection.logical_operation_id, interpreted.semantic_projection, interpreted.semantic_digest,
          effectRecord, sha256Digest(effectRecord), createdAt]
      )).rows[0];
      const evaluationRecord = {
        schema_version: EVALUATION_RECORD_SCHEMA,
        evaluation_id: evaluation.evaluation_id,
        effect_projection_id: effectProjectionId,
        activation_id: activationId,
        semantic_digest: evaluation.semantic_digest,
        created_at: createdAt
      };
      const evaluationRow = (await client.query(
        `INSERT INTO diagnostic_behavior_evaluations
          (evaluation_id,installation_id,environment_id,effect_projection_id,activation_id,
           logical_operation_id,semantic_evaluation,semantic_digest,record_document,record_digest,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [evaluation.evaluation_id, installationId, environmentId, effectProjectionId, activationId,
          projection.logical_operation_id, evaluation.semantic_evaluation, evaluation.semantic_digest,
          evaluationRecord, sha256Digest(evaluationRecord), createdAt]
      )).rows[0];
      await client.query("COMMIT");
      return { replayed: false, result: {
        diagnostic_effect_projection: effectView(verifyEffectRow(effectRow)),
        behavior_evaluation: evaluationView(verifyEvaluationRow(evaluationRow)),
        diagnostic_case: diagnosticCase,
        trigger_created: false,
        case_created: false
      } };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function getEffectProjection(effectProjectionId) {
    uuid(effectProjectionId, "effect_projection_id");
    const row = (await pool.query(
      "SELECT * FROM diagnostic_effect_projections WHERE installation_id=$1 AND effect_projection_id=$2",
      [installationId, effectProjectionId]
    )).rows[0];
    if (!row) throw new KernelError(404, "DIAGNOSTIC_EFFECT_PROJECTION_NOT_FOUND",
      "Diagnostic Effect Projection does not exist.");
    return effectView(verifyEffectRow(row));
  }

  async function getEvaluation(evaluationId) {
    uuid(evaluationId, "evaluation_id");
    const row = (await pool.query(
      "SELECT * FROM diagnostic_behavior_evaluations WHERE installation_id=$1 AND evaluation_id=$2",
      [installationId, evaluationId]
    )).rows[0];
    if (!row) throw new KernelError(404, "BEHAVIOR_EVALUATION_NOT_FOUND",
      "Behavior Evaluation does not exist.");
    return evaluationView(verifyEvaluationRow(row));
  }

  async function getTrigger(triggerId) {
    uuid(triggerId, "trigger_id");
    const row = (await pool.query(
      "SELECT * FROM diagnostic_behavior_triggers WHERE installation_id=$1 AND trigger_id=$2",
      [installationId, triggerId]
    )).rows[0];
    if (!row) throw new KernelError(404, "DIAGNOSTIC_TRIGGER_NOT_FOUND", "Diagnostic Trigger does not exist.");
    return triggerView(row);
  }

  async function getClaim(claimId) {
    uuid(claimId, "claim_id");
    const row = (await pool.query(
      "SELECT * FROM diagnostic_claim_envelopes WHERE installation_id=$1 AND claim_id=$2",
      [installationId, claimId]
    )).rows[0];
    if (!row) throw new KernelError(404, "DIAGNOSTIC_CLAIM_NOT_FOUND", "Diagnostic Claim does not exist.");
    return claimView(row);
  }

  async function getDeterministicCase(caseId) {
    uuid(caseId, "case_id");
    const caseRow = (await pool.query(
      "SELECT * FROM diagnostic_cases WHERE installation_id=$1 AND case_id=$2 AND case_origin='deterministic_behavior_trigger'",
      [installationId, caseId]
    )).rows[0];
    if (!caseRow) throw new KernelError(404, "DIAGNOSTIC_CASE_NOT_FOUND", "Diagnostic Case does not exist.");
    const trigger = await getTrigger(caseRow.trigger_id);
    const claims = (await pool.query(
      "SELECT * FROM diagnostic_claim_envelopes WHERE installation_id=$1 AND case_id=$2 ORDER BY claim_type,claim_id",
      [installationId, caseId]
    )).rows.map(claimView);
    return caseView(caseRow, trigger, claims);
  }

  return {
    activate,
    getActivation: async (id) => activationView(await getActivation(id)),
    process,
    reevaluate,
    getEffectProjection,
    getEvaluation,
    getTrigger,
    getClaim,
    getDeterministicCase
  };
}
