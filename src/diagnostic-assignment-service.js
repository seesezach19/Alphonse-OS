import { randomUUID } from "node:crypto";

import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import {
  DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_SCHEMA,
  DIAGNOSTIC_ASSIGNMENT_RECORD_SCHEMA,
  DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
  DIAGNOSTIC_ASSIGNMENT_STAGE_INPUT_SCHEMA,
  DIAGNOSTIC_ASSIGNMENT_STAGE_RECORD_SCHEMA,
  validateDiagnosticAssignmentPolicy
} from "./diagnostic-assignment-contracts.js";
import {
  DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST,
  DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_MANIFEST
} from "./diagnostic-assignment-artifact.js";
import {
  buildDiagnosticAssignmentStageInput,
  DIAGNOSTIC_ASSIGNMENT_STAGE_AUTHOR,
  projectDiagnosticAssignment
} from "./diagnostic-assignment-projector.js";
import {
  assignmentPolicyActivationView,
  assignmentView,
  getAssignmentPolicyActivation,
  verifyAssignmentCreationMaterial,
  verifyAssignmentPolicyActivationRow,
  verifyAssignmentRow,
  verifyAssignmentStateHistory,
  verifyAssignmentStageRecord
} from "./diagnostic-assignment-persistence.js";
import { KernelError } from "./errors.js";
import {
  loadStageArtifactArchive,
  prepareStageArtifactArchive,
  recordStageArtifactArchive
} from "./stage-artifact-archive.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSIGNMENT_POLICY_EXPORT_VERSIONS = Object.freeze(["0.1.0", "0.2.0"]);
const FROZEN_EVENT_SCHEMA = "alphonse.evidence-package-frozen-assignment-event.v0.1";
const REPLACEMENT_EVENT_SCHEMA = "alphonse.diagnostic-assignment-replacement-event.v0.1";
const DELIVERY_SCHEMA = "alphonse.diagnostic-assignment-delivery.v0.1";
const NONDETERMINISM_SCHEMA = "alphonse.diagnostic-assignment-nondeterminism.v0.1";
const VERIFICATION_MATERIAL_SCHEMA = "alphonse.diagnostic-assignment-verification-material.v0.1";
const FAILURE_INPUT_SCHEMA = "alphonse.diagnostic-assignment-stage-failure-input.v0.1";
const EVIDENCE_PACKAGE_STAGE_AUTHORS = Object.freeze([
  "diagnostic-stage-worker:evidence-packaging-v0.1",
  "diagnostic-stage-worker:evidence-packaging-v0.2"
]);

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "DIAGNOSTIC_ASSIGNMENT_INPUT_INVALID", `${field} must be an object.`);
  }
  return value;
}

function exact(value, field, keys) {
  object(value, field);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!same(actual, expected)) {
    throw new KernelError(400, "DIAGNOSTIC_ASSIGNMENT_INPUT_INVALID", `${field} fields must be exact.`, {
      expected, received: actual
    });
  }
  return value;
}

function uuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new KernelError(400, "DIAGNOSTIC_ASSIGNMENT_INPUT_INVALID", `${field} must be a UUID.`);
  }
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
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

function sourceEventDocument(transition) {
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

function deliveryDocument(outbox) {
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

function verifyFrozenDelivery(outbox, transition, installationId) {
  const expectedTransitionPayload = [
    "assignment_policy_activation_digest", "assignment_policy_activation_id", "evidence_package_id",
    "freeze_reason", "package_artifact_digest", "semantic_digest"
  ];
  const expectedOutboxPayload = ["evidence_package_id", "transition_id"];
  if (!outbox || !transition || outbox.installation_id !== installationId
      || transition.installation_id !== installationId
      || outbox.transition_id !== transition.transition_id
      || outbox.event_type !== "diagnostic.evidence_package.frozen"
      || transition.transition_type !== outbox.event_type
      || transition.aggregate_type !== "diagnostic_case"
      || transition.actor_type !== "service" || !EVIDENCE_PACKAGE_STAGE_AUTHORS.includes(transition.actor_id)
      || iso(outbox.created_at) !== iso(transition.occurred_at)
      || !same(Object.keys(outbox.payload ?? {}).sort(), expectedOutboxPayload)
      || !same(Object.keys(transition.payload ?? {}).sort(), expectedTransitionPayload)
      || outbox.payload.transition_id !== transition.transition_id
      || outbox.payload.evidence_package_id !== transition.payload.evidence_package_id
      || !UUID.test(transition.payload.evidence_package_id)
      || !UUID.test(transition.payload.assignment_policy_activation_id)
      || !/^sha256:[0-9a-f]{64}$/.test(transition.payload.assignment_policy_activation_digest)
      || !/^sha256:[0-9a-f]{64}$/.test(transition.payload.semantic_digest)
      || !/^sha256:[0-9a-f]{64}$/.test(transition.payload.package_artifact_digest)) {
    throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_SOURCE_EVENT_INTEGRITY_VIOLATION",
      "Frozen-package delivery does not match its immutable Diagnostic Plane transition.");
  }
  return {
    sourceEvent: sourceEventDocument(transition),
    sourceEventDigest: sha256Digest(sourceEventDocument(transition)),
    delivery: deliveryDocument(outbox),
    deliveryDigest: sha256Digest(deliveryDocument(outbox))
  };
}

function verifyReplacementDelivery(outbox, transition, installationId) {
  const expectedTransitionPayload = [
    "assignment_policy_activation_digest", "assignment_policy_activation_id",
    "predecessor_evidence_package_id", "reevaluation_notice_id", "replaced_assignment_id",
    "successor_evidence_package_id", "successor_package_artifact_digest", "successor_semantic_digest"
  ];
  const expectedOutboxPayload = ["reevaluation_notice_id", "transition_id"];
  const payload = transition?.payload;
  if (!outbox || !transition || outbox.installation_id !== installationId
      || transition.installation_id !== installationId
      || outbox.transition_id !== transition.transition_id
      || outbox.event_type !== "diagnostic.assignment.replacement_requested"
      || transition.transition_type !== outbox.event_type
      || transition.aggregate_type !== "diagnostic_assignment_replacement"
      || transition.aggregate_id !== payload?.reevaluation_notice_id
      || transition.actor_type !== "service" || !EVIDENCE_PACKAGE_STAGE_AUTHORS.includes(transition.actor_id)
      || iso(outbox.created_at) !== iso(transition.occurred_at)
      || !same(Object.keys(outbox.payload ?? {}).sort(), expectedOutboxPayload)
      || !same(Object.keys(payload ?? {}).sort(), expectedTransitionPayload)
      || outbox.payload.transition_id !== transition.transition_id
      || outbox.payload.reevaluation_notice_id !== payload.reevaluation_notice_id
      || ![payload.reevaluation_notice_id, payload.replaced_assignment_id,
        payload.predecessor_evidence_package_id, payload.successor_evidence_package_id].every((entry) => UUID.test(entry))
      || !UUID.test(payload.assignment_policy_activation_id)
      || ![payload.assignment_policy_activation_digest, payload.successor_semantic_digest,
        payload.successor_package_artifact_digest].every((entry) => /^sha256:[0-9a-f]{64}$/.test(entry))) {
    throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_REPLACEMENT_SOURCE_INTEGRITY_VIOLATION",
      "Assignment replacement delivery does not match its exact governed transition.");
  }
  return {
    sourceEvent: sourceEventDocument(transition),
    sourceEventDigest: sha256Digest(sourceEventDocument(transition)),
    delivery: deliveryDocument(outbox),
    deliveryDigest: sha256Digest(deliveryDocument(outbox))
  };
}

function verifyAssignmentDelivery(outbox, transition, installationId) {
  return outbox?.event_type === "diagnostic.assignment.replacement_requested"
    ? verifyReplacementDelivery(outbox, transition, installationId)
    : verifyFrozenDelivery(outbox, transition, installationId);
}

function activationReference(exportRecord) {
  return {
    export_id: exportRecord.export_id,
    contract_version: exportRecord.contract_version,
    export_digest: sha256Digest(exportRecord.content),
    instruction_digest: sha256Digest(exportRecord.content.instruction),
    output_schema_digest: sha256Digest(exportRecord.content.output_schema)
  };
}

export function createDiagnosticAssignmentService({
  database,
  artifactStore,
  installationId,
  environmentId,
  packageReader,
  resolveDeploymentExports,
  assignmentProjector = projectDiagnosticAssignment
}) {
  const { pool } = database;
  let timer = null;
  let tickRunning = false;
  let lastLoopError = null;

  async function activatePolicy(input, actorId, now = new Date()) {
    exact(input, "input", [
      "assignment_policy_activation_id", "deployment_id", "assignment_policy_export_id"
    ]);
    const assignmentPolicyActivationId = uuid(input.assignment_policy_activation_id,
      "assignment_policy_activation_id");
    const deploymentId = uuid(input.deployment_id, "deployment_id");
    const resolved = await resolveDeploymentExports(deploymentId, [input.assignment_policy_export_id]);
    const exportRecord = resolved.exports.get(input.assignment_policy_export_id);
    if (resolved.deployment_id !== deploymentId || exportRecord?.kind !== "diagnostic_assignment_policy"
        || !ASSIGNMENT_POLICY_EXPORT_VERSIONS.includes(exportRecord.contract_version)) {
      throw new KernelError(409, "DIAGNOSTIC_ASSIGNMENT_POLICY_EXPORT_MISMATCH",
        "Activation must reference one supported exact deployed Diagnostic Assignment Policy export.");
    }
    validateDiagnosticAssignmentPolicy(exportRecord.content);
    const policyDocument = structuredClone(exportRecord.content);
    const reference = activationReference(exportRecord);
    const document = {
      schema_version: DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_SCHEMA,
      assignment_policy_activation_id: assignmentPolicyActivationId,
      installation_id: installationId,
      environment_id: environmentId,
      deployment_id: deploymentId,
      package_version_id: resolved.package_version_id,
      package_artifact_digest: resolved.package_artifact_digest,
      assignment_policy: reference,
      stage: {
        artifact_manifest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_MANIFEST,
        artifact_digest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST,
        assignment_rules_digest: DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST
      }
    };
    const activationDigest = sha256Digest(document);
    const activatedAt = iso(now);
    const preparedStageArchive = await prepareStageArtifactArchive(
      artifactStore, DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_MANIFEST);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await recordStageArtifactArchive({ client, installationId, prepared: preparedStageArchive,
        archivedAt: activatedAt });
      const existing = (await client.query(
        `SELECT * FROM diagnostic_assignment_policy_activations
         WHERE installation_id=$1 AND assignment_policy_activation_id=$2 FOR SHARE`,
        [installationId, assignmentPolicyActivationId]
      )).rows[0];
      if (existing) {
        verifyAssignmentPolicyActivationRow(existing, installationId, environmentId);
        if (existing.activation_digest !== activationDigest) {
          throw new KernelError(409, "DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_IDENTITY_CONFLICT",
            "Assignment Policy activation ID already binds different immutable material.");
        }
        await client.query("COMMIT");
        return { replayed: true, result: {
          assignment_policy_activation: assignmentPolicyActivationView(existing)
        } };
      }
      const row = (await client.query(
        `INSERT INTO diagnostic_assignment_policy_activations
          (assignment_policy_activation_id,installation_id,environment_id,deployment_id,
           package_version_id,package_artifact_digest,policy_export_id,policy_document,policy_digest,
           instruction_digest,output_schema_digest,stage_artifact_manifest,stage_artifact_digest,
           assignment_rules_digest,activation_document,activation_digest,activated_by,activated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [assignmentPolicyActivationId, installationId, environmentId, deploymentId,
          resolved.package_version_id, resolved.package_artifact_digest, exportRecord.export_id,
          policyDocument, reference.export_digest, reference.instruction_digest,
          reference.output_schema_digest, DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_MANIFEST,
          DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST, DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
          document, activationDigest, actorId, activatedAt]
      )).rows[0];
      verifyAssignmentPolicyActivationRow(row, installationId, environmentId);
      await client.query("COMMIT");
      return { replayed: false, result: {
        assignment_policy_activation: assignmentPolicyActivationView(row)
      } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getPolicyActivation(id) {
    uuid(id, "assignment_policy_activation_id");
    return assignmentPolicyActivationView(await getAssignmentPolicyActivation(pool, {
      installationId, environmentId, assignmentPolicyActivationId: id
    }));
  }

  async function loadDelivery(outboxId, client = pool, forUpdate = false) {
    uuid(outboxId, "outbox_id");
    const outbox = (await client.query(
      `SELECT * FROM diagnostic_outbox WHERE installation_id=$1 AND outbox_id=$2${forUpdate ? " FOR SHARE" : ""}`,
      [installationId, outboxId]
    )).rows[0];
    if (!outbox) {
      throw new KernelError(404, "DIAGNOSTIC_ASSIGNMENT_DELIVERY_NOT_FOUND",
        "Diagnostic Assignment delivery does not exist.");
    }
    const transition = (await client.query(
      `SELECT * FROM diagnostic_transitions WHERE installation_id=$1 AND transition_id=$2${forUpdate ? " FOR SHARE" : ""}`,
      [installationId, outbox.transition_id]
    )).rows[0];
    return { outbox, transition, ...verifyAssignmentDelivery(outbox, transition, installationId) };
  }

  async function receiveDelivery(outboxId, now = new Date()) {
    const material = await loadDelivery(outboxId);
    const receivedAt = iso(now);
    await pool.query(
      `INSERT INTO diagnostic_assignment_inbox
        (source_transition_id,installation_id,environment_id,outbox_id,source_event_document,
         source_event_digest,delivery_document,delivery_digest,status,attempt_count,received_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0,$9,$9)
       ON CONFLICT (source_transition_id) DO NOTHING`,
      [material.transition.transition_id, installationId, environmentId, outboxId,
        material.sourceEvent, material.sourceEventDigest, material.delivery, material.deliveryDigest, receivedAt]
    );
    const inbox = (await pool.query(
      "SELECT * FROM diagnostic_assignment_inbox WHERE source_transition_id=$1",
      [material.transition.transition_id]
    )).rows[0];
    if (!inbox || inbox.outbox_id !== outboxId || inbox.source_event_digest !== material.sourceEventDigest
        || inbox.delivery_digest !== material.deliveryDigest
        || !same(inbox.source_event_document, material.sourceEvent)
        || !same(inbox.delivery_document, material.delivery)) {
      throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_INBOX_INTEGRITY_VIOLATION",
        "Assignment inbox receipt does not bind the exact frozen-package delivery.");
    }
    return { ...material, inbox };
  }

  async function resolveStageInput(material) {
    const payload = material.sourceEvent.payload;
    const replacement = material.sourceEvent.event_type === "diagnostic.assignment.replacement_requested";
    const evidencePackage = await packageReader.getPackage(replacement
      ? payload.successor_evidence_package_id : payload.evidence_package_id);
    if ((!replacement && evidencePackage.case_id !== material.sourceEvent.aggregate_id)
        || evidencePackage.semantic_digest !== (replacement
          ? payload.successor_semantic_digest : payload.semantic_digest)
        || evidencePackage.package_artifact_digest !== (replacement
          ? payload.successor_package_artifact_digest : payload.package_artifact_digest)
        || evidencePackage.frozen_at !== material.sourceEvent.occurred_at) {
      throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_PACKAGE_INTEGRITY_VIOLATION",
        "Assignment source event does not bind the exact verified Evidence Package.");
    }
    const policy = await getAssignmentPolicyActivation(pool, {
      installationId,
      environmentId,
      assignmentPolicyActivationId: payload.assignment_policy_activation_id
    });
    if (policy.activation_digest !== payload.assignment_policy_activation_digest
        || policy.stage_artifact_digest !== DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST
        || !same(policy.stage_artifact_manifest, DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_MANIFEST)
        || policy.assignment_rules_digest !== DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST) {
      throw new KernelError(409, "DIAGNOSTIC_ASSIGNMENT_STAGE_OR_POLICY_MISMATCH",
        "Pinned Assignment Policy differs from the running deterministic assignment stage.");
    }
    const stageInput = buildDiagnosticAssignmentStageInput({
      installationId,
      environmentId,
      sourceEvent: material.sourceEvent,
      evidencePackage,
      assignmentPolicyActivation: policy,
      stageArtifactDigest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST
    });
    const projection = assignmentProjector({
      stageInput,
      assignmentPolicy: policy.policy_document,
      stageArtifactDigest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST
    });
    if (!replacement) return { evidencePackage, policy, stageInput, projection, replacement: null };
    const replacedAssignment = (await pool.query(
      `SELECT a.*,s.state,s.state_revision,s.last_transition_id,s.updated_at AS state_updated_at
       FROM diagnostic_assignments a JOIN diagnostic_assignment_states s ON s.assignment_id=a.assignment_id
       WHERE a.installation_id=$1 AND a.environment_id=$2 AND a.assignment_id=$3`,
      [installationId, environmentId, payload.replaced_assignment_id]
    )).rows[0];
    const notice = (await pool.query(
      `SELECT * FROM diagnostic_reevaluation_notices
       WHERE installation_id=$1 AND reevaluation_notice_id=$2`,
      [installationId, payload.reevaluation_notice_id]
    )).rows[0];
    const affectedAssignment = notice?.known_affected_assignments?.find((entry) =>
      entry.assignment_id === payload.replaced_assignment_id);
    if (!replacedAssignment || replacedAssignment.case_id !== evidencePackage.case_id
        || replacedAssignment.assignment_policy_activation_id !== payload.assignment_policy_activation_id
        || !notice || sha256Digest(notice.notice_document) !== notice.notice_digest
        || notice.predecessor_evidence_package_id !== payload.predecessor_evidence_package_id
        || notice.successor_evidence_package_id !== payload.successor_evidence_package_id
        || affectedAssignment?.assignment_digest !== replacedAssignment.assignment_digest
        || affectedAssignment?.evidence_package_id !== replacedAssignment.evidence_package_id
        || affectedAssignment?.state !== "unclaimed"
        || notice.recommended_action !== "replace_unclaimed") {
      throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_REPLACEMENT_LINEAGE_INTEGRITY_VIOLATION",
        "Replacement request does not bind one exact prior assignment, notice, policy, and package revision.");
    }
    return { evidencePackage, policy, stageInput, projection, replacement: {
      notice,
      replaced_assignment_id: replacedAssignment.assignment_id,
      predecessor_evidence_package_id: payload.predecessor_evidence_package_id
    } };
  }

  async function recordNondeterminism(client, { existing, material, resolved, detectedAt }) {
    const conflictDocument = {
      schema_version: NONDETERMINISM_SCHEMA,
      assignment_id: existing.assignment_id,
      source_transition_id: material.sourceEvent.transition_id,
      stage_input_digest: resolved.projection.stage_input_digest,
      stage_artifact_digest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST,
      assignment_rules_digest: DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
      accepted_assignment_digest: existing.assignment_digest,
      recomputed_assignment_digest: resolved.projection.assignment_digest,
      detected_at: detectedAt
    };
    const conflictDigest = sha256Digest(conflictDocument);
    const conflictId = deterministicUuid({ namespace: "diagnostic-assignment-nondeterminism-conflict",
      assignment_id: existing.assignment_id, recomputed_assignment_digest: resolved.projection.assignment_digest });
    await client.query(
      `INSERT INTO diagnostic_assignment_nondeterminism_conflicts
        (conflict_id,installation_id,environment_id,assignment_id,source_transition_id,
         stage_input_digest,accepted_assignment_digest,recomputed_assignment_digest,
         conflict_document,conflict_digest,detected_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (assignment_id,recomputed_assignment_digest) DO NOTHING`,
      [conflictId, installationId, environmentId, existing.assignment_id,
        material.sourceEvent.transition_id, resolved.projection.stage_input_digest,
        existing.assignment_digest, resolved.projection.assignment_digest,
        conflictDocument, conflictDigest, detectedAt]
    );
  }

  async function processOutboxEvent(outboxId, now = new Date()) {
    const received = await receiveDelivery(outboxId, now);
    const resolved = await resolveStageInput(received);
    const processedAt = iso(now);
    const client = await pool.connect();
    let nondeterminism = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `diagnostic-assignment:${installationId}:${received.sourceEvent.transition_id}`
      ]);
      const material = await loadDelivery(outboxId, client, true);
      if (material.sourceEventDigest !== received.sourceEventDigest
          || material.deliveryDigest !== received.deliveryDigest) {
        throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_INPUT_HISTORY_DIVERGENCE",
          "Frozen-package source or delivery changed after durable inbox receipt.");
      }
      const inbox = (await client.query(
        "SELECT * FROM diagnostic_assignment_inbox WHERE source_transition_id=$1 FOR UPDATE",
        [material.sourceEvent.transition_id]
      )).rows[0];
      if (!inbox || inbox.source_event_digest !== material.sourceEventDigest
          || inbox.delivery_digest !== material.deliveryDigest) {
        throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_INBOX_INTEGRITY_VIOLATION",
          "Assignment inbox changed after exact delivery receipt.");
      }
      const existingStage = (await client.query(
        "SELECT * FROM diagnostic_assignment_stage_records WHERE source_transition_id=$1",
        [material.sourceEvent.transition_id]
      )).rows[0];
      if (existingStage) {
        if (existingStage.outcome === "replacement_not_performed") {
          verifyAssignmentStageRecord(existingStage, null);
          if (existingStage.source_event_digest !== material.sourceEventDigest
              || existingStage.stage_input_digest !== resolved.projection.stage_input_digest) {
            throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_INPUT_HISTORY_DIVERGENCE",
              "Existing replacement no-op resolves to a different verified input digest.");
          }
          await client.query("COMMIT");
          return { replayed: true, result: {
            diagnostic_assignment: null,
            replacement_status: "not_performed_claimed_or_terminal"
          } };
        }
        const existingAssignment = (await client.query(
          "SELECT * FROM diagnostic_assignments WHERE assignment_id=$1",
          [existingStage.assignment_id]
        )).rows[0];
        const state = (await client.query(
          "SELECT * FROM diagnostic_assignment_states WHERE assignment_id=$1",
          [existingStage.assignment_id]
        )).rows[0];
        verifyAssignmentRow(existingAssignment, state);
        verifyAssignmentStageRecord(existingStage, existingAssignment);
        if (existingStage.source_event_digest !== material.sourceEventDigest
            || existingStage.stage_input_digest !== resolved.projection.stage_input_digest) {
          throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_INPUT_HISTORY_DIVERGENCE",
            "Existing assignment stage record resolves to a different verified input digest.");
        }
        if (existingAssignment.assignment_id !== resolved.projection.assignment_id) {
          throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_IDENTITY_COLLISION",
            "Exact stage input recomputed a different deterministic Assignment identity.");
        }
        if (existingAssignment.assignment_digest !== resolved.projection.assignment_digest
            || !same(existingAssignment.assignment_document, resolved.projection.assignment)) {
          await recordNondeterminism(client, { existing: existingAssignment, material, resolved, detectedAt: processedAt });
          nondeterminism = new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_NONDETERMINISM",
            "The same exact stage input and artifact identities produced different Assignment semantics.");
          await client.query("COMMIT");
        } else {
          await client.query("COMMIT");
          return { replayed: true, result: { diagnostic_assignment: assignmentView(existingAssignment, state) } };
        }
      } else {
        const replacedState = resolved.replacement ? (await client.query(
          `SELECT a.*,s.state,s.state_revision,s.last_transition_id,s.updated_at AS state_updated_at
           FROM diagnostic_assignments a JOIN diagnostic_assignment_states s ON s.assignment_id=a.assignment_id
           WHERE a.installation_id=$1 AND a.assignment_id=$2 FOR UPDATE OF s`,
          [installationId, resolved.replacement.replaced_assignment_id]
        )).rows[0] : null;
        if (resolved.replacement && (!replacedState || replacedState.state !== "unclaimed")) {
          const stageRecordId = deterministicUuid({ namespace: "diagnostic-assignment-replacement-noop",
            source_transition_id: material.sourceEvent.transition_id,
            stage_input_digest: resolved.projection.stage_input_digest });
          const resultDocument = {
            schema_version: DIAGNOSTIC_ASSIGNMENT_STAGE_RECORD_SCHEMA,
            stage_record_id: stageRecordId,
            source_transition_id: material.sourceEvent.transition_id,
            source_event_digest: material.sourceEventDigest,
            stage_input_digest: resolved.projection.stage_input_digest,
            stage_artifact_digest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST,
            assignment_rules_digest: DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
            outcome: "replacement_not_performed",
            assignment_id: null,
            reason: "replaced_assignment_no_longer_unclaimed",
            processed_at: processedAt
          };
          await client.query(
            `INSERT INTO diagnostic_assignment_stage_records
              (stage_record_id,installation_id,environment_id,source_transition_id,source_event_digest,
               stage_input,stage_input_digest,stage_artifact_digest,assignment_rules_digest,outcome,
               assignment_id,result_document,result_digest,processed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'replacement_not_performed',NULL,$10,$11,$12)`,
            [stageRecordId, installationId, environmentId, material.sourceEvent.transition_id,
              material.sourceEventDigest, resolved.stageInput, resolved.projection.stage_input_digest,
              DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST, DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
              resultDocument, sha256Digest(resultDocument), processedAt]
          );
          await client.query(
            `UPDATE diagnostic_assignment_inbox
             SET status='completed',attempt_count=attempt_count+1,last_error_code=NULL,
                 completed_at=$2,updated_at=$2 WHERE source_transition_id=$1 AND status='pending'`,
            [material.sourceEvent.transition_id, processedAt]
          );
          await client.query("COMMIT");
          return { replayed: false, result: {
            diagnostic_assignment: null,
            replacement_status: "not_performed_claimed_or_terminal"
          } };
        }
        const byIdentity = (await client.query(
          "SELECT * FROM diagnostic_assignments WHERE assignment_id=$1",
          [resolved.projection.assignment_id]
        )).rows[0];
        if (byIdentity) {
          verifyAssignmentRow(byIdentity);
          if (byIdentity.stage_input_digest !== resolved.projection.stage_input_digest) {
            throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_INPUT_HISTORY_DIVERGENCE",
              "Deterministic Assignment identity is already bound to a different verified input digest.");
          }
          if (byIdentity.assignment_digest !== resolved.projection.assignment_digest
              || !same(byIdentity.assignment_document, resolved.projection.assignment)) {
            await recordNondeterminism(client, { existing: byIdentity, material, resolved, detectedAt: processedAt });
            nondeterminism = new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_NONDETERMINISM",
              "The same exact Assignment identity produced different semantic bytes.");
            await client.query("COMMIT");
          } else {
            throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_SOURCE_HISTORY_DIVERGENCE",
              "An existing Assignment is bound to a different frozen-package source transition.");
          }
        } else {
          const createdAt = material.sourceEvent.occurred_at;
          const recordDocument = {
            schema_version: DIAGNOSTIC_ASSIGNMENT_RECORD_SCHEMA,
            assignment_id: resolved.projection.assignment_id,
            assignment_digest: resolved.projection.assignment_digest,
            stage_input_digest: resolved.projection.stage_input_digest,
            source_transition_id: material.sourceEvent.transition_id,
            created_by: DIAGNOSTIC_ASSIGNMENT_STAGE_AUTHOR,
            created_at: createdAt
          };
          const recordDigest = sha256Digest(recordDocument);
          const assignmentRow = (await client.query(
            `INSERT INTO diagnostic_assignments
              (assignment_id,assignment_series_id,installation_id,environment_id,case_id,
               evidence_package_id,assignment_policy_activation_id,ordinal,stage_input_digest,
               assignment_document,assignment_digest,record_document,record_digest,stage_artifact_digest,
               assignment_rules_digest,source_transition_id,created_by,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [resolved.projection.assignment_id, resolved.projection.assignment_series_id,
              installationId, environmentId, resolved.evidencePackage.case_id,
              resolved.evidencePackage.evidence_package_id, resolved.policy.assignment_policy_activation_id,
              resolved.projection.stage_input_digest, resolved.projection.assignment,
              resolved.projection.assignment_digest, recordDocument, recordDigest,
              DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST, DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
              material.sourceEvent.transition_id, DIAGNOSTIC_ASSIGNMENT_STAGE_AUTHOR, createdAt]
          )).rows[0];
          const node = (await client.query(
            "SELECT revision,next_sequence FROM diagnostic_nodes WHERE installation_id=$1 FOR UPDATE",
            [installationId]
          )).rows[0];
          const commandId = `assignment-create:${resolved.projection.assignment_id}`;
          const transitionId = randomUUID();
          await client.query(
            `INSERT INTO diagnostic_commands
              (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
             VALUES ($1,$2,$3,'diagnostic.assignment.create','service',$4,$5,$6)`,
            [installationId, commandId, resolved.projection.stage_input_digest,
              DIAGNOSTIC_ASSIGNMENT_STAGE_AUTHOR,
              { assignment_id: resolved.projection.assignment_id,
                assignment_digest: resolved.projection.assignment_digest }, createdAt]
          );
          await client.query(
            `INSERT INTO diagnostic_transitions
              (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
               from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
             VALUES ($1,$2,$3,'diagnostic_assignment',$4,'diagnostic.assignment.created',0,1,$5,
                     'service',$6,$7,$8)`,
            [transitionId, installationId, String(node.next_sequence), resolved.projection.assignment_id,
              commandId, DIAGNOSTIC_ASSIGNMENT_STAGE_AUTHOR,
              { assignment_id: resolved.projection.assignment_id,
                assignment_digest: resolved.projection.assignment_digest,
                evidence_package_id: resolved.evidencePackage.evidence_package_id,
                evidence_package_semantic_digest: resolved.evidencePackage.semantic_digest,
                assignment_policy_activation_id: resolved.policy.assignment_policy_activation_id,
                assignment_policy_activation_digest: resolved.policy.activation_digest,
                initial_state: "unclaimed", authority_granted: "none" }, createdAt]
          );
          const state = (await client.query(
            `INSERT INTO diagnostic_assignment_states
              (assignment_id,installation_id,environment_id,assignment_digest,state,state_revision,
               last_transition_id,updated_at)
             VALUES ($1,$2,$3,$4,'unclaimed',0,$5,$6) RETURNING *`,
            [resolved.projection.assignment_id, installationId, environmentId,
              resolved.projection.assignment_digest, transitionId, createdAt]
          )).rows[0];
          let expiredTransitionId = null;
          if (resolved.replacement) {
            const replaceCommandId = `assignment-replace:${resolved.replacement.notice.reevaluation_notice_id}`;
            expiredTransitionId = randomUUID();
            const replacementDocument = {
              schema_version: "alphonse.diagnostic-assignment-replacement.v0.1",
              replacement_id: deterministicUuid({ namespace: "diagnostic-assignment-replacement",
                reevaluation_notice_id: resolved.replacement.notice.reevaluation_notice_id,
                replaced_assignment_id: replacedState.assignment_id,
                replacement_assignment_id: resolved.projection.assignment_id }),
              case_id: resolved.evidencePackage.case_id,
              reevaluation_notice_id: resolved.replacement.notice.reevaluation_notice_id,
              replaced_assignment: {
                assignment_id: replacedState.assignment_id,
                assignment_digest: replacedState.assignment_digest,
                evidence_package_id: replacedState.evidence_package_id,
                prior_state: "unclaimed"
              },
              replacement_assignment: {
                assignment_id: resolved.projection.assignment_id,
                assignment_digest: resolved.projection.assignment_digest,
                evidence_package_id: resolved.evidencePackage.evidence_package_id,
                initial_state: "unclaimed"
              },
              assignment_policy_activation_id: resolved.policy.assignment_policy_activation_id,
              assignment_policy_activation_digest: resolved.policy.activation_digest,
              reason: "material_evidence_revision_policy",
              authority: "bounded_assignment_replacement_only",
              created_at: processedAt
            };
            const replacementDigest = sha256Digest(replacementDocument);
            await client.query(
              `INSERT INTO diagnostic_commands
                (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
               VALUES ($1,$2,$3,'diagnostic.assignment.replace','service',$4,$5,$6)`,
              [installationId, replaceCommandId, material.sourceEventDigest,
                DIAGNOSTIC_ASSIGNMENT_STAGE_AUTHOR,
                { replaced_assignment_id: replacedState.assignment_id,
                  replacement_assignment_id: resolved.projection.assignment_id,
                  reevaluation_notice_id: resolved.replacement.notice.reevaluation_notice_id }, processedAt]
            );
            await client.query(
              `INSERT INTO diagnostic_transitions
                (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
                 from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
               VALUES ($1,$2,$3,'diagnostic_assignment',$4,'diagnostic.assignment.expired',$5,$6,$7,
                 'service',$8,$9,$10)`,
              [expiredTransitionId, installationId, String(BigInt(node.next_sequence) + 1n),
                replacedState.assignment_id, String(BigInt(replacedState.state_revision) + 1n),
                String(BigInt(replacedState.state_revision) + 2n), replaceCommandId,
                DIAGNOSTIC_ASSIGNMENT_STAGE_AUTHOR,
                { assignment_id: replacedState.assignment_id,
                  assignment_digest: replacedState.assignment_digest,
                  reason: "material_evidence_revision_policy",
                  reevaluation_notice_id: resolved.replacement.notice.reevaluation_notice_id,
                  replacement_assignment_id: resolved.projection.assignment_id,
                  successor_evidence_package_id: resolved.evidencePackage.evidence_package_id }, processedAt]
            );
            const stateUpdate = await client.query(
              `UPDATE diagnostic_assignment_states
               SET state='expired',state_revision=state_revision+1,last_transition_id=$2,updated_at=$3
               WHERE assignment_id=$1 AND state='unclaimed' AND state_revision=$4`,
              [replacedState.assignment_id, expiredTransitionId, processedAt, replacedState.state_revision]
            );
            if (stateUpdate.rowCount !== 1) {
              throw new KernelError(409, "DIAGNOSTIC_ASSIGNMENT_REPLACEMENT_RACE_LOST",
                "Assignment was claimed or changed before governed replacement could commit.");
            }
            await client.query(
              `INSERT INTO diagnostic_assignment_replacements
                (replacement_id,installation_id,environment_id,case_id,reevaluation_notice_id,
                 replaced_assignment_id,replacement_assignment_id,predecessor_evidence_package_id,
                 successor_evidence_package_id,assignment_policy_activation_id,replacement_document,
                 replacement_digest,created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [replacementDocument.replacement_id, installationId, environmentId,
                resolved.evidencePackage.case_id, resolved.replacement.notice.reevaluation_notice_id,
                replacedState.assignment_id, resolved.projection.assignment_id,
                resolved.replacement.predecessor_evidence_package_id,
                resolved.evidencePackage.evidence_package_id,
                resolved.policy.assignment_policy_activation_id, replacementDocument,
                replacementDigest, processedAt]
            );
          }
          const stageRecordId = deterministicUuid({ namespace: "diagnostic-assignment-stage-record",
            source_transition_id: material.sourceEvent.transition_id,
            stage_input_digest: resolved.projection.stage_input_digest });
          const resultDocument = {
            schema_version: DIAGNOSTIC_ASSIGNMENT_STAGE_RECORD_SCHEMA,
            stage_record_id: stageRecordId,
            source_transition_id: material.sourceEvent.transition_id,
            source_event_digest: material.sourceEventDigest,
            stage_input_digest: resolved.projection.stage_input_digest,
            stage_artifact_digest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST,
            assignment_rules_digest: DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
            outcome: "assignment_created",
            assignment_id: resolved.projection.assignment_id,
            assignment_digest: resolved.projection.assignment_digest,
            processed_at: processedAt
          };
          await client.query(
            `INSERT INTO diagnostic_assignment_stage_records
              (stage_record_id,installation_id,environment_id,source_transition_id,source_event_digest,
               stage_input,stage_input_digest,stage_artifact_digest,assignment_rules_digest,outcome,
               assignment_id,result_document,result_digest,processed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'assignment_created',$10,$11,$12,$13)`,
            [stageRecordId, installationId, environmentId, material.sourceEvent.transition_id,
              material.sourceEventDigest, resolved.stageInput, resolved.projection.stage_input_digest,
              DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST, DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
              resolved.projection.assignment_id, resultDocument, sha256Digest(resultDocument), processedAt]
          );
          await client.query(
            `UPDATE diagnostic_assignment_inbox
             SET status='completed',attempt_count=attempt_count+1,last_error_code=NULL,
                 completed_at=$2,updated_at=$2 WHERE source_transition_id=$1 AND status='pending'`,
            [material.sourceEvent.transition_id, processedAt]
          );
          await client.query(
            `INSERT INTO diagnostic_outbox
              (outbox_id,installation_id,transition_id,event_type,payload,created_at)
             VALUES ($1,$2,$3,'diagnostic.assignment.created',$4,$5)`,
            [randomUUID(), installationId, transitionId,
              { transition_id: transitionId, assignment_id: resolved.projection.assignment_id }, createdAt]
          );
          if (expiredTransitionId) {
            await client.query(
              `INSERT INTO diagnostic_outbox
                (outbox_id,installation_id,transition_id,event_type,payload,created_at)
               VALUES ($1,$2,$3,'diagnostic.assignment.expired',$4,$5)`,
              [randomUUID(), installationId, expiredTransitionId,
                { transition_id: expiredTransitionId, assignment_id: replacedState.assignment_id,
                  replacement_assignment_id: resolved.projection.assignment_id }, processedAt]
            );
          }
          await client.query(
            `UPDATE diagnostic_nodes SET revision=revision+$2,next_sequence=next_sequence+$2,updated_at=$3
             WHERE installation_id=$1`, [installationId, expiredTransitionId ? "2" : "1", processedAt]
          );
          verifyAssignmentRow(assignmentRow, state);
          await client.query("COMMIT");
          return { replayed: false, result: { diagnostic_assignment: assignmentView(assignmentRow, state) } };
        }
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    if (nondeterminism) throw nondeterminism;
    throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_PROCESSING_FAILED",
      "Diagnostic Assignment processing ended without a durable outcome.");
  }

  function isTerminalStageError(error) {
    return error instanceof KernelError && error.code !== "DIAGNOSTIC_ASSIGNMENT_NONDETERMINISM"
      && (error.code.startsWith("DIAGNOSTIC_ASSIGNMENT_")
        || error.code.startsWith("DIAGNOSTIC_EVIDENCE_PACKAGE_")
        || error.code.startsWith("ARTIFACT_")
        || error.status === 404);
  }

  async function recordTerminalFailure(outboxId, error, now = new Date()) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const outbox = (await client.query(
        "SELECT * FROM diagnostic_outbox WHERE installation_id=$1 AND outbox_id=$2 FOR SHARE",
        [installationId, outboxId]
      )).rows[0];
      if (!outbox) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `diagnostic-assignment:${installationId}:${outbox.transition_id}`
      ]);
      const transition = (await client.query(
        "SELECT * FROM diagnostic_transitions WHERE installation_id=$1 AND transition_id=$2 FOR SHARE",
        [installationId, outbox.transition_id]
      )).rows[0];
      if (!transition) {
        await client.query("ROLLBACK");
        return null;
      }
      const observedSource = sourceEventDocument(transition);
      const observedDelivery = deliveryDocument(outbox);
      const failedAt = iso(now);
      await client.query(
        `INSERT INTO diagnostic_assignment_inbox
          (source_transition_id,installation_id,environment_id,outbox_id,source_event_document,
           source_event_digest,delivery_document,delivery_digest,status,attempt_count,received_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0,$9,$9)
         ON CONFLICT (source_transition_id) DO NOTHING`,
        [transition.transition_id, installationId, environmentId, outbox.outbox_id,
          observedSource, sha256Digest(observedSource), observedDelivery, sha256Digest(observedDelivery), failedAt]
      );
      const inbox = (await client.query(
        "SELECT * FROM diagnostic_assignment_inbox WHERE source_transition_id=$1 FOR UPDATE",
        [transition.transition_id]
      )).rows[0];
      if (!inbox || inbox.status !== "pending") {
        await client.query("COMMIT");
        return inbox;
      }
      const failureInput = {
        schema_version: FAILURE_INPUT_SCHEMA,
        source_event: inbox.source_event_document,
        accepted_source_event_digest: inbox.source_event_digest,
        accepted_delivery_digest: inbox.delivery_digest,
        observed_source_event_digest: sha256Digest(observedSource),
        observed_delivery_digest: sha256Digest(observedDelivery),
        failure_code: error.code
      };
      const stageInputDigest = sha256Digest(failureInput);
      const stageRecordId = deterministicUuid({ namespace: "diagnostic-assignment-stage-failure",
        source_transition_id: transition.transition_id, stage_input_digest: stageInputDigest });
      const resultDocument = {
        schema_version: DIAGNOSTIC_ASSIGNMENT_STAGE_RECORD_SCHEMA,
        stage_record_id: stageRecordId,
        source_transition_id: transition.transition_id,
        source_event_digest: inbox.source_event_digest,
        stage_input_digest: stageInputDigest,
        stage_artifact_digest: DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST,
        assignment_rules_digest: DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
        outcome: "terminal_failure",
        error: { code: error.code, message: error.message, details: error.details ?? {} },
        processed_at: failedAt
      };
      await client.query(
        `INSERT INTO diagnostic_assignment_stage_records
          (stage_record_id,installation_id,environment_id,source_transition_id,source_event_digest,
           stage_input,stage_input_digest,stage_artifact_digest,assignment_rules_digest,outcome,
           assignment_id,result_document,result_digest,processed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'terminal_failure',NULL,$10,$11,$12)
         ON CONFLICT (source_transition_id) DO NOTHING`,
        [stageRecordId, installationId, environmentId, transition.transition_id,
          inbox.source_event_digest, failureInput, stageInputDigest,
          DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST, DIAGNOSTIC_ASSIGNMENT_RULES_DIGEST,
          resultDocument, sha256Digest(resultDocument), failedAt]
      );
      await client.query(
        `UPDATE diagnostic_assignment_inbox
         SET status='terminal_failed',attempt_count=attempt_count+1,last_error_code=$2,
             completed_at=$3,updated_at=$3 WHERE source_transition_id=$1 AND status='pending'`,
        [transition.transition_id, error.code, failedAt]
      );
      await client.query("COMMIT");
      return inbox;
    } catch (failureError) {
      await client.query("ROLLBACK").catch(() => {});
      throw failureError;
    } finally {
      client.release();
    }
  }

  async function processAvailable({ limit = 16, now = new Date() } = {}) {
    const candidates = (await pool.query(
      `SELECT o.outbox_id
       FROM diagnostic_outbox o
       JOIN diagnostic_transitions t ON t.transition_id=o.transition_id
       LEFT JOIN diagnostic_assignment_inbox i ON i.source_transition_id=t.transition_id
       WHERE o.installation_id=$1
         AND o.event_type IN ('diagnostic.evidence_package.frozen','diagnostic.assignment.replacement_requested')
         AND t.payload ? 'assignment_policy_activation_id'
         AND (i.source_transition_id IS NULL OR i.status='pending')
       ORDER BY t.diagnostic_sequence,o.outbox_id LIMIT $2`,
      [installationId, limit]
    )).rows;
    const results = [];
    for (const candidate of candidates) {
      try {
        results.push(await processOutboxEvent(candidate.outbox_id, now));
      } catch (error) {
        if (isTerminalStageError(error)) {
          await recordTerminalFailure(candidate.outbox_id, error, now);
        } else {
          await pool.query(
            `UPDATE diagnostic_assignment_inbox
             SET attempt_count=attempt_count+1,last_error_code=$2,updated_at=$3
             WHERE outbox_id=$1 AND status='pending'`,
            [candidate.outbox_id, error.code ?? error.name ?? "UNEXPECTED_ASSIGNMENT_STAGE_ERROR", iso(now)]
          );
        }
        results.push({ error });
      }
    }
    return results;
  }

  async function loadAssignmentRow(assignmentId) {
    const row = (await pool.query(
      `SELECT * FROM diagnostic_assignments
       WHERE installation_id=$1 AND environment_id=$2 AND assignment_id=$3`,
      [installationId, environmentId, assignmentId]
    )).rows[0];
    if (!row) throw new KernelError(404, "DIAGNOSTIC_ASSIGNMENT_NOT_FOUND",
      "Diagnostic Assignment does not exist.");
    const state = (await pool.query(
      "SELECT * FROM diagnostic_assignment_states WHERE assignment_id=$1",
      [assignmentId]
    )).rows[0];
    verifyAssignmentRow(row, state);
    const transitions = (await pool.query(
      `SELECT * FROM diagnostic_transitions
       WHERE installation_id=$1 AND aggregate_type='diagnostic_assignment' AND aggregate_id=$2
       ORDER BY diagnostic_sequence`, [installationId, assignmentId]
    )).rows;
    verifyAssignmentStateHistory({ row, state, transitions });
    const transition = transitions.find((entry) => entry.transition_type === "diagnostic.assignment.created") ?? null;
    const command = transition ? (await pool.query(
      "SELECT * FROM diagnostic_commands WHERE installation_id=$1 AND command_id=$2",
      [installationId, transition.command_id]
    )).rows[0] : null;
    const outboxes = transition ? (await pool.query(
      `SELECT * FROM diagnostic_outbox
       WHERE installation_id=$1 AND transition_id=$2 AND event_type='diagnostic.assignment.created'`,
      [installationId, transition.transition_id]
    )).rows : [];
    if (outboxes.length !== 1) {
      throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_CREATION_HISTORY_INTEGRITY_VIOLATION",
        "Assignment creation transition must have exactly one immutable outbox record.");
    }
    const creation = verifyAssignmentCreationMaterial({
      row, state, transition, command, outbox: outboxes[0]
    });
    return { row, state, creation, transitions };
  }

  async function getAssignment(assignmentId) {
    uuid(assignmentId, "assignment_id");
    const material = await loadAssignmentRow(assignmentId);
    return assignmentView(material.row, material.state);
  }

  async function getAssignmentForPackage(evidencePackageId) {
    uuid(evidencePackageId, "evidence_package_id");
    const row = (await pool.query(
      `SELECT assignment_id FROM diagnostic_assignments
       WHERE installation_id=$1 AND environment_id=$2 AND evidence_package_id=$3
       ORDER BY ordinal DESC LIMIT 1`,
      [installationId, environmentId, evidencePackageId]
    )).rows[0];
    if (!row) throw new KernelError(404, "DIAGNOSTIC_ASSIGNMENT_NOT_FOUND",
      "No Diagnostic Assignment exists for this Evidence Package.");
    return getAssignment(row.assignment_id);
  }

  async function getProcessingStatusForPackage(evidencePackageId) {
    uuid(evidencePackageId, "evidence_package_id");
    await packageReader.getPackage(evidencePackageId);
    const transition = (await pool.query(
      `SELECT * FROM diagnostic_transitions
       WHERE installation_id=$1 AND (
         (transition_type='diagnostic.evidence_package.frozen' AND payload->>'evidence_package_id'=$2)
         OR (transition_type='diagnostic.assignment.replacement_requested'
           AND payload->>'successor_evidence_package_id'=$2))
       ORDER BY diagnostic_sequence DESC LIMIT 1`,
      [installationId, evidencePackageId]
    )).rows[0];
    if (!transition?.payload?.assignment_policy_activation_id) {
      return { evidence_package_id: evidencePackageId, status: "not_assignment_eligible_legacy_event",
        assignment_id: null, failure: null, authority_granted: "none" };
    }
    const inbox = (await pool.query(
      "SELECT * FROM diagnostic_assignment_inbox WHERE source_transition_id=$1",
      [transition.transition_id]
    )).rows[0];
    if (!inbox) {
      return { evidence_package_id: evidencePackageId, source_transition_id: transition.transition_id,
        status: "awaiting_delivery", assignment_id: null, failure: lastLoopError,
        authority_granted: "none" };
    }
    const stage = (await pool.query(
      "SELECT * FROM diagnostic_assignment_stage_records WHERE source_transition_id=$1",
      [transition.transition_id]
    )).rows[0];
    if (inbox.status === "terminal_failed") {
      verifyAssignmentStageRecord(stage, null);
      return { evidence_package_id: evidencePackageId, source_transition_id: transition.transition_id,
        status: "terminal_failed", assignment_id: null,
        failure: stage.result_document.error, authority_granted: "none" };
    }
    if (inbox.status === "completed" && stage?.outcome === "replacement_not_performed") {
      verifyAssignmentStageRecord(stage, null);
      return { evidence_package_id: evidencePackageId, source_transition_id: transition.transition_id,
        status: "replacement_not_performed", assignment_id: null,
        failure: null, authority_granted: "none" };
    }
    if (inbox.status !== "completed" || !stage) {
      return { evidence_package_id: evidencePackageId, source_transition_id: transition.transition_id,
        status: "pending", assignment_id: null,
        failure: inbox.last_error_code ? { code: inbox.last_error_code,
          attempt_count: inbox.attempt_count } : null, authority_granted: "none" };
    }
    const { row: assignment, state } = await loadAssignmentRow(stage.assignment_id);
    verifyAssignmentStageRecord(stage, assignment);
    const conflict = (await pool.query(
      `SELECT * FROM diagnostic_assignment_nondeterminism_conflicts
       WHERE assignment_id=$1 ORDER BY detected_at,conflict_id LIMIT 1`,
      [assignment.assignment_id]
    )).rows[0];
    if (conflict && (sha256Digest(conflict.conflict_document) !== conflict.conflict_digest
        || conflict.conflict_document.assignment_id !== assignment.assignment_id)) {
      throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_NONDETERMINISM_RECORD_INTEGRITY_VIOLATION",
        "Stored Assignment nondeterminism record does not match its immutable digest.");
    }
    return { evidence_package_id: evidencePackageId, source_transition_id: transition.transition_id,
      status: conflict ? "nondeterminism_conflict" : "assignment_created",
      assignment_id: assignment.assignment_id, assignment_digest: assignment.assignment_digest,
      assignment_state: state.state,
      failure: conflict ? { code: "DIAGNOSTIC_ASSIGNMENT_NONDETERMINISM",
        conflict_id: conflict.conflict_id, conflict_digest: conflict.conflict_digest } : null,
      authority_granted: "none" };
  }

  async function getVerificationMaterial(assignmentId) {
    uuid(assignmentId, "assignment_id");
    const { row: assignment, state, creation, transitions } = await loadAssignmentRow(assignmentId);
    const policy = await getAssignmentPolicyActivation(pool, {
      installationId, environmentId,
      assignmentPolicyActivationId: assignment.assignment_policy_activation_id
    });
    const stage = (await pool.query(
      "SELECT * FROM diagnostic_assignment_stage_records WHERE assignment_id=$1",
      [assignmentId]
    )).rows[0];
    verifyAssignmentStageRecord(stage, assignment);
    const inbox = (await pool.query(
      "SELECT * FROM diagnostic_assignment_inbox WHERE source_transition_id=$1",
      [assignment.source_transition_id]
    )).rows[0];
    const transition = (await pool.query(
      "SELECT * FROM diagnostic_transitions WHERE transition_id=$1",
      [assignment.source_transition_id]
    )).rows[0];
    const outbox = (await pool.query(
      "SELECT * FROM diagnostic_outbox WHERE outbox_id=$1",
      [inbox.outbox_id]
    )).rows[0];
    const delivery = verifyAssignmentDelivery(outbox, transition, installationId);
    if (delivery.sourceEventDigest !== inbox.source_event_digest
        || delivery.deliveryDigest !== inbox.delivery_digest || inbox.status !== "completed") {
      throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_INBOX_INTEGRITY_VIOLATION",
        "Assignment verification material does not match the completed durable inbox receipt.");
    }
    const archive = await loadStageArtifactArchive({
      client: pool, artifactStore, installationId, stageArtifactDigest: assignment.stage_artifact_digest
    });
    const resolvedPolicyExport = await resolveDeploymentExports(policy.deployment_id, [policy.policy_export_id]);
    const policyExport = resolvedPolicyExport.exports.get(policy.policy_export_id);
    if (resolvedPolicyExport.deployment_id !== policy.deployment_id
        || resolvedPolicyExport.package_version_id !== policy.package_version_id
        || resolvedPolicyExport.package_artifact_digest !== policy.package_artifact_digest
        || policyExport?.kind !== "diagnostic_assignment_policy"
        || sha256Digest(policyExport.content) !== policy.policy_digest) {
      throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_POLICY_EXPORT_INTEGRITY_VIOLATION",
        "Assignment Policy activation no longer resolves to its exact deployed export material.");
    }
    const evidencePackage = await packageReader.getPackage(assignment.evidence_package_id);
    let replacementHistory = null;
    if (transition.transition_type === "diagnostic.assignment.replacement_requested") {
      const replacement = (await pool.query(
        `SELECT * FROM diagnostic_assignment_replacements
         WHERE installation_id=$1 AND replacement_assignment_id=$2`,
        [installationId, assignmentId]
      )).rows[0];
      if (!replacement) {
        throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_REPLACEMENT_HISTORY_INTEGRITY_VIOLATION",
          "Replacement Assignment is missing its immutable replacement record.");
      }
      const notice = (await pool.query(
        `SELECT * FROM diagnostic_reevaluation_notices
         WHERE installation_id=$1 AND reevaluation_notice_id=$2`,
        [installationId, replacement.reevaluation_notice_id]
      )).rows[0];
      const replaced = await loadAssignmentRow(replacement.replaced_assignment_id);
      const expiry = replaced.transitions.find((entry) =>
        entry.transition_type === "diagnostic.assignment.expired"
          && entry.payload?.replacement_assignment_id === assignmentId);
      const expiryCommand = expiry ? (await pool.query(
        "SELECT * FROM diagnostic_commands WHERE installation_id=$1 AND command_id=$2",
        [installationId, expiry.command_id]
      )).rows[0] : null;
      const expiryOutboxes = expiry ? (await pool.query(
        `SELECT * FROM diagnostic_outbox
         WHERE installation_id=$1 AND transition_id=$2 AND event_type='diagnostic.assignment.expired'`,
        [installationId, expiry.transition_id]
      )).rows : [];
      if (!notice || !expiry || !expiryCommand || expiryOutboxes.length !== 1) {
        throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_REPLACEMENT_HISTORY_INTEGRITY_VIOLATION",
          "Replacement Assignment does not resolve one complete notice, expiry, and prior history.");
      }
      replacementHistory = {
        replacement,
        reevaluation_notice: notice,
        replaced_assignment: replaced.row,
        replaced_assignment_state: replaced.state,
        replaced_assignment_creation: replaced.creation,
        replaced_assignment_transitions: replaced.transitions,
        expiry_command: expiryCommand,
        expiry_outbox: expiryOutboxes[0]
      };
    }
    return encodeValue({
      schema_version: VERIFICATION_MATERIAL_SCHEMA,
      assignment: assignment,
      assignment_state: state,
      assignment_creation: creation,
      assignment_transitions: transitions,
      replacement_history: replacementHistory,
      assignment_policy_activation: policy,
      assignment_policy_export: {
        deployment_id: resolvedPolicyExport.deployment_id,
        package_version_id: resolvedPolicyExport.package_version_id,
        package_artifact_digest: resolvedPolicyExport.package_artifact_digest,
        export_record: policyExport
      },
      source_transition: transition,
      source_outbox_delivery: outbox,
      inbox_receipt: inbox,
      stage_record: stage,
      stage_artifact_archive: archive,
      evidence_package: evidencePackage,
      assurance_boundary: {
        processing_profile: "D0",
        authority: "none",
        model_request_created: false,
        verifier_required_for_creation: false
      }
    });
  }

  function start({ intervalMs = 100 } = {}) {
    if (timer) return;
    const tick = async () => {
      if (tickRunning) return;
      tickRunning = true;
      try { await processAvailable(); lastLoopError = null; }
      catch (error) { lastLoopError = { code: error.code ?? error.name ?? "ASSIGNMENT_STAGE_LOOP_ERROR",
        message: error.message }; }
      finally { tickRunning = false; }
    };
    timer = setInterval(tick, intervalMs);
    timer.unref();
    queueMicrotask(tick);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    activatePolicy,
    getPolicyActivation,
    processAvailable,
    processOutboxEvent,
    getAssignment,
    getAssignmentForPackage,
    getProcessingStatusForPackage,
    getVerificationMaterial,
    recordTerminalFailure,
    start,
    stop
  };
}
