import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import { isAuthorizedOwner } from "./trusted-operator.js";
import {
  assertInterpretationCitations,
  buildCoverageAmbiguities,
  buildCoverageAmbiguityResolution,
  buildCoverageInterpretationAssignment,
  buildWorkflowInterpretation,
  validateCoverageAmbiguityResolveCommand,
  validateCoverageInterpretationAssignCommand,
  validateCoverageInterpretationSubmitCommand
} from "./workflow-interpretation-contracts.js";

function requestDigest(installationId, environmentId, command) {
  return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
}

function executionActor(actor) {
  return { type: actor.type, id: actor.id };
}

function humanPrincipal(actor) {
  if (!isAuthorizedOwner(actor)) {
    throw new KernelError(403, "COVERAGE_INTERPRETATION_OWNER_REQUIRED",
      "A named customer Owner or exact trusted-operator authorization is required.");
  }
  if (actor.type === "human") return actor.id;
  const principal = actor.authorization?.authorized_by;
  if (principal?.type !== "human" || typeof principal.id !== "string" || principal.id.length === 0) {
    throw new KernelError(403, "COVERAGE_INTERPRETATION_HUMAN_PRINCIPAL_REQUIRED",
      "Trusted-operator work must retain its exact named human authorizer.");
  }
  return principal.id;
}

function assignmentView(row) {
  if (sha256Digest(row.assignment_document) !== row.assignment_digest
      || row.assignment_document.assignment_id !== row.assignment_id
      || row.assignment_document.onboarding_id !== row.onboarding_id
      || row.assignment_document.snapshot_digest !== row.snapshot_digest
      || Number(row.assignment_document.onboarding_revision) !== Number(row.onboarding_revision)
      || row.assignment_document.event_head_digest !== row.event_head_digest) {
    throw new KernelError(500, "COVERAGE_INTERPRETATION_INTEGRITY_VIOLATION",
      "Interpretation Assignment does not match its immutable document.");
  }
  return {
    assignment_id: row.assignment_id,
    onboarding_id: row.onboarding_id,
    snapshot_digest: row.snapshot_digest,
    onboarding_revision: Number(row.onboarding_revision),
    event_head_digest: row.event_head_digest,
    passport_id: row.passport_id,
    agent_principal_id: row.agent_principal_id,
    work_intent_id: row.work_intent_id,
    work_intent_digest: row.work_intent_digest,
    assignment_digest: row.assignment_digest,
    assigned_by_principal_id: row.assigned_by_principal_id,
    executed_by: { type: row.executed_by_actor_type, id: row.executed_by_actor_id },
    assigned_at: new Date(row.assigned_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    constraints: row.assignment_document.constraints,
    authority: "none",
    immutable: true
  };
}

function interpretationView(stored, built, ambiguities) {
  return {
    interpretation_id: built.document.interpretation_id,
    artifact_digest: stored.artifact_digest,
    size_bytes: stored.size_bytes,
    media_type: stored.media_type,
    onboarding_id: built.document.onboarding_id,
    snapshot_digest: built.document.snapshot_digest,
    claims_digest: built.claims_digest,
    ambiguity_manifest_digest: ambiguities.manifest_digest,
    claim_count: built.document.claims.length,
    ambiguity_count: ambiguities.ambiguities.length,
    supersedes_interpretation_digest: built.document.supersedes_interpretation_digest,
    content_class: "untrusted_agent_proposal",
    instruction_authority: "none",
    authority: "none",
    immutable: true
  };
}

function assertWorkIntentBinding(intent, onboarding, assignment = null) {
  if (intent.work_intent_id !== onboarding.work_intent.work_intent_id
      || intent.payload_digest !== onboarding.work_intent.work_intent_digest
      || intent.passport_id !== onboarding.agent.passport_id
      || intent.agent_principal_id !== onboarding.agent.agent_principal_id
      || (assignment && (intent.work_intent_id !== assignment.work_intent_id
        || intent.payload_digest !== assignment.work_intent_digest))) {
    throw new KernelError(409, "COVERAGE_INTERPRETATION_INTENT_MISMATCH",
      "Interpretation work must bind the exact confirmed onboarding Work Intent, Passport, and agent Principal.");
  }
}

export function createWorkflowInterpretationService({ database, artifactStore, identityIntent,
  coverageOnboardingService, installationId, environmentId }) {
  const { pool, executeCommand } = database;
  const coverageInternal = coverageOnboardingService?.internal;
  if (!coverageInternal) throw new Error("Coverage Onboarding internal persistence seam is required.");

  async function commandReplay(command, digest) {
    const existing = await pool.query(
      `SELECT request_digest,result FROM diagnostic_commands
       WHERE installation_id=$1 AND command_id=$2`, [installationId, command.command_id]
    );
    if (!existing.rows[0]) return null;
    if (existing.rows[0].request_digest !== digest) {
      throw new KernelError(409, "IDEMPOTENCY_CONFLICT",
        "Diagnostic command ID was reused with different input.", {
          command_id: command.command_id,
          accepted_request_digest: existing.rows[0].request_digest,
          received_request_digest: digest
        });
    }
    return { replayed: true, result: existing.rows[0].result };
  }

  async function loadAssignment(assignmentId, client = pool) {
    const row = (await client.query(
      `SELECT * FROM diagnostic_coverage_interpretation_assignments
       WHERE installation_id=$1 AND assignment_id=$2`, [installationId, assignmentId]
    )).rows[0];
    if (!row) {
      throw new KernelError(404, "COVERAGE_INTERPRETATION_ASSIGNMENT_NOT_FOUND",
        "Coverage Interpretation Assignment does not exist.");
    }
    return assignmentView(row);
  }

  async function assign(value, ownerActor) {
    const envelope = validateCoverageInterpretationAssignCommand(value);
    const principalId = humanPrincipal(ownerActor);
    const command = { ...envelope, actor: ownerActor };
    const digest = requestDigest(installationId, environmentId, command);
    const replay = await commandReplay(command, digest);
    if (replay) return replay;
    const onboarding = await coverageInternal.loadOnboarding(envelope.input.onboarding_id);
    if (onboarding.environment_id !== environmentId
        || onboarding.revision !== envelope.input.expected_revision
        || onboarding.active_snapshot_digest !== envelope.input.snapshot_digest) {
      throw new KernelError(409, "COVERAGE_INTERPRETATION_BASE_CONFLICT",
        "Interpretation Assignment must bind the exact active snapshot and onboarding revision.");
    }
    if (onboarding.agent.passport_id !== envelope.input.passport_id
        || onboarding.agent.agent_principal_id !== envelope.input.agent_principal_id
        || onboarding.work_intent.work_intent_id !== envelope.input.work_intent_id) {
      throw new KernelError(409, "COVERAGE_INTERPRETATION_ASSIGNEE_MISMATCH",
        "Interpretation Assignment must bind the exact onboarding agent identity.");
    }
    const intent = await identityIntent.getWorkIntent(envelope.input.work_intent_id);
    assertWorkIntentBinding(intent, onboarding);
    const expiresAt = Date.parse(envelope.input.expires_at);
    if (expiresAt <= Date.now() || expiresAt > Date.now() + 7 * 24 * 60 * 60 * 1000) {
      throw new KernelError(400, "COVERAGE_INTERPRETATION_EXPIRY_INVALID",
        "Interpretation Assignment expiry must be in the future and no more than seven days away.");
    }
    const assignmentId = randomUUID();
    return executeCommand({
      installationId,
      command,
      requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-onboarding:${envelope.input.onboarding_id}`
        ]);
        const current = await coverageInternal.loadOnboarding(envelope.input.onboarding_id, client);
        if (current.revision !== envelope.input.expected_revision
            || current.event_head_digest !== onboarding.event_head_digest
            || current.active_snapshot_digest !== envelope.input.snapshot_digest) {
          throw new KernelError(409, "COVERAGE_INTERPRETATION_BASE_CONFLICT",
            "Coverage Onboarding changed before Interpretation Assignment admission.");
        }
        const built = buildCoverageInterpretationAssignment({
          assignmentId,
          onboarding: current,
          input: envelope.input,
          assignedByPrincipalId: principalId,
          executedBy: executionActor(ownerActor),
          assignedAt: acceptedAt,
          workIntentDigest: intent.payload_digest
        });
        const inserted = (await client.query(
          `INSERT INTO diagnostic_coverage_interpretation_assignments
            (assignment_id,installation_id,onboarding_id,snapshot_digest,onboarding_revision,event_head_digest,
             passport_id,agent_principal_id,work_intent_id,work_intent_digest,assignment_document,
             assignment_digest,assigned_by_principal_id,executed_by_actor_type,executed_by_actor_id,
             assigned_at,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
          [assignmentId, installationId, current.onboarding_id, current.active_snapshot_digest,
            current.revision, current.event_head_digest, envelope.input.passport_id,
            envelope.input.agent_principal_id, envelope.input.work_intent_id, intent.payload_digest,
            built.document, built.assignment_digest, principalId, ownerActor.type, ownerActor.id,
            acceptedAt, envelope.input.expires_at]
        )).rows[0];
        return {
          aggregateType: "coverage_interpretation_assignment",
          aggregateId: assignmentId,
          transitionType: "diagnostic.coverage_interpretation.assigned",
          fromRevision: 0,
          toRevision: 1,
          transitionPayload: { onboarding_id: current.onboarding_id,
            snapshot_digest: current.active_snapshot_digest, assignment_digest: built.assignment_digest },
          result: { coverage_interpretation_assignment: assignmentView(inserted), created: true }
        };
      }
    });
  }

  async function submit(value, authenticatedPassport) {
    const envelope = validateCoverageInterpretationSubmitCommand(value);
    const actor = { type: "agent", id: authenticatedPassport.agent_principal_id };
    const command = { ...envelope, actor };
    const digest = requestDigest(installationId, environmentId, command);
    const replay = await commandReplay(command, digest);
    if (replay) return replay;
    const assignment = await loadAssignment(envelope.input.assignment_id);
    if (assignment.onboarding_id !== envelope.input.onboarding_id
        || assignment.snapshot_digest !== envelope.input.snapshot_digest
        || assignment.onboarding_revision !== envelope.input.expected_revision
        || assignment.passport_id !== authenticatedPassport.passport_id
        || assignment.agent_principal_id !== authenticatedPassport.agent_principal_id
        || envelope.input.provenance.passport_id !== authenticatedPassport.passport_id
        || envelope.input.provenance.work_intent_id !== assignment.work_intent_id) {
      throw new KernelError(403, "COVERAGE_INTERPRETATION_ASSIGNMENT_MISMATCH",
        "Authenticated agent submission does not match the exact Interpretation Assignment.");
    }
    if (Date.now() >= Date.parse(assignment.expires_at)) {
      throw new KernelError(409, "COVERAGE_INTERPRETATION_ASSIGNMENT_EXPIRED",
        "Interpretation Assignment has expired.");
    }
    const proposedAt = Date.parse(envelope.input.proposed_at);
    if (proposedAt < Date.parse(assignment.assigned_at)
        || proposedAt > Date.now() + 5 * 60_000
        || proposedAt > Date.parse(assignment.expires_at)) {
      throw new KernelError(400, "COVERAGE_INTERPRETATION_PROPOSED_AT_INVALID",
        "Interpretation proposed_at must follow assignment and cannot exceed the assignment or current-time bound.");
    }
    const onboarding = await coverageInternal.loadOnboarding(envelope.input.onboarding_id);
    if (onboarding.revision !== assignment.onboarding_revision
        || onboarding.event_head_digest !== assignment.event_head_digest
        || onboarding.active_snapshot_digest !== assignment.snapshot_digest) {
      throw new KernelError(409, "COVERAGE_INTERPRETATION_ASSIGNMENT_STALE",
        "Coverage Onboarding evidence or revision changed after this assignment was created.");
    }
    if (envelope.input.supersedes_interpretation_digest !== onboarding.active_interpretation_digest) {
      throw new KernelError(409, "COVERAGE_INTERPRETATION_SUPERSESSION_CONFLICT",
        "Interpretation submission must supersede the exact active interpretation, or null when none exists.");
    }
    const intent = await identityIntent.getWorkIntent(assignment.work_intent_id);
    assertWorkIntentBinding(intent, onboarding, assignment);
    const snapshot = await artifactStore.getJson(assignment.snapshot_digest);
    if (snapshot.content?.schema_version !== "alphonse.workflow-discovery-snapshot.v0.1"
        || snapshot.content.onboarding_id !== onboarding.onboarding_id) {
      throw new KernelError(409, "COVERAGE_INTERPRETATION_SNAPSHOT_INVALID",
        "Assigned artifact is not the exact admitted Workflow Discovery Snapshot.");
    }
    assertInterpretationCitations(envelope.input, snapshot.content);
    const interpretationId = randomUUID();
    const built = buildWorkflowInterpretation({ interpretationId, assignment, input: envelope.input });
    const stored = await artifactStore.putJson(built.document);
    const ambiguityMaterial = buildCoverageAmbiguities({
      onboardingId: onboarding.onboarding_id,
      interpretationDigest: stored.artifact_digest,
      proposals: envelope.input.ambiguities
    });
    return executeCommand({
      installationId,
      command,
      requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-onboarding:${onboarding.onboarding_id}`
        ]);
        const current = await coverageInternal.loadOnboarding(onboarding.onboarding_id, client);
        if (current.revision !== assignment.onboarding_revision
            || current.event_head_digest !== assignment.event_head_digest
            || current.active_snapshot_digest !== assignment.snapshot_digest
            || current.active_interpretation_digest !== envelope.input.supersedes_interpretation_digest) {
          throw new KernelError(409, "COVERAGE_INTERPRETATION_ASSIGNMENT_STALE",
            "Coverage Onboarding changed before interpretation admission.");
        }
        const priorSubmission = await client.query(
          `SELECT interpretation_digest FROM diagnostic_workflow_interpretations
           WHERE installation_id=$1 AND assignment_id=$2`, [installationId, assignment.assignment_id]
        );
        if (priorSubmission.rows[0]) {
          throw new KernelError(409, "COVERAGE_INTERPRETATION_ASSIGNMENT_USED",
            "Interpretation Assignment already has one immutable submission.");
        }
        await client.query(
          `INSERT INTO diagnostic_artifacts
            (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
          [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
            stored.storage_key, acceptedAt]
        );
        const interpretationEventIndex = current.revision + 1;
        await client.query(
          `INSERT INTO diagnostic_workflow_interpretations
            (interpretation_id,installation_id,onboarding_id,assignment_id,snapshot_digest,
             base_onboarding_revision,base_event_head_digest,interpretation_digest,claims_digest,claim_index,
             ambiguity_manifest_digest,supersedes_interpretation_digest,event_index,
             submitted_by_agent_principal_id,proposed_at,accepted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [interpretationId, installationId, current.onboarding_id, assignment.assignment_id,
            assignment.snapshot_digest, assignment.onboarding_revision, assignment.event_head_digest,
            stored.artifact_digest, built.claims_digest, JSON.stringify(built.claim_index), ambiguityMaterial.manifest_digest,
            envelope.input.supersedes_interpretation_digest, interpretationEventIndex,
            authenticatedPassport.agent_principal_id, envelope.input.proposed_at, acceptedAt]
        );
        const interpretationPayload = {
          interpretation_digest: stored.artifact_digest,
          snapshot_digest: assignment.snapshot_digest,
          claims_digest: built.claims_digest,
          assignment_digest: assignment.assignment_digest,
          supersedes_interpretation_digest: envelope.input.supersedes_interpretation_digest,
          authority: "none"
        };
        const interpretationEventDigest = await coverageInternal.appendEvent(client, {
          onboardingId: current.onboarding_id,
          eventIndex: interpretationEventIndex,
          eventType: "interpretation_submitted",
          priorEventDigest: current.event_head_digest,
          payload: interpretationPayload,
          actor,
          occurredAt: acceptedAt
        });
        const ambiguityEventIndex = interpretationEventIndex + 1;
        for (const item of ambiguityMaterial.ambiguities) {
          await client.query(
            `INSERT INTO diagnostic_coverage_ambiguities
              (installation_id,onboarding_id,interpretation_digest,ambiguity_id,ambiguity_digest,
               ambiguity_document,blocking,projected_event_index,projected_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [installationId, current.onboarding_id, stored.artifact_digest,
              item.document.ambiguity_id, item.ambiguity_digest, item.document,
              item.document.blocking, ambiguityEventIndex, acceptedAt]
          );
        }
        const ambiguityPayload = {
          interpretation_digest: stored.artifact_digest,
          ambiguity_manifest_digest: ambiguityMaterial.manifest_digest,
          ambiguity_count: ambiguityMaterial.ambiguities.length,
          blocking_count: ambiguityMaterial.ambiguities.filter((item) => item.document.blocking).length,
          nonblocking_count: ambiguityMaterial.ambiguities.filter((item) => !item.document.blocking).length,
          authority: "none"
        };
        const ambiguityEventDigest = await coverageInternal.appendEvent(client, {
          onboardingId: current.onboarding_id,
          eventIndex: ambiguityEventIndex,
          eventType: "ambiguities_projected",
          priorEventDigest: interpretationEventDigest,
          payload: ambiguityPayload,
          actor,
          occurredAt: acceptedAt
        });
        await coverageInternal.appendReviewInvalidation(client, {
          current,
          eventIndex: ambiguityEventIndex + 1,
          priorEventDigest: ambiguityEventDigest,
          trigger: "interpretation_superseded",
          priorMaterialDigest: current.active_interpretation_digest ?? stored.artifact_digest,
          replacementMaterialDigest: stored.artifact_digest,
          actor,
          occurredAt: acceptedAt
        });
        const projection = await coverageInternal.loadOnboarding(current.onboarding_id, client);
        return {
          aggregateType: "coverage_onboarding",
          aggregateId: current.onboarding_id,
          transitionType: "diagnostic.coverage_interpretation.submitted",
          fromRevision: current.revision,
          toRevision: projection.revision,
          transitionPayload: { ...interpretationPayload,
            ambiguity_manifest_digest: ambiguityMaterial.manifest_digest },
          result: {
            coverage_onboarding: projection,
            workflow_interpretation: interpretationView(stored, built, ambiguityMaterial),
            created: true
          }
        };
      }
    });
  }

  async function resolveAmbiguity(value, ownerActor) {
    const envelope = validateCoverageAmbiguityResolveCommand(value);
    const principalId = humanPrincipal(ownerActor);
    const command = { ...envelope, actor: ownerActor };
    const digest = requestDigest(installationId, environmentId, command);
    const replay = await commandReplay(command, digest);
    if (replay) return replay;
    const onboarding = await coverageInternal.loadOnboarding(envelope.input.onboarding_id);
    if (onboarding.revision !== envelope.input.expected_revision
        || onboarding.work_intent.work_intent_id !== envelope.input.work_intent_id) {
      throw new KernelError(409, "COVERAGE_AMBIGUITY_REVISION_CONFLICT",
        "Ambiguity resolution must bind the exact current onboarding revision and Work Intent.");
    }
    const projected = onboarding.ambiguities.find((item) =>
      item.ambiguity_id === envelope.input.ambiguity_id
      && item.ambiguity_digest === envelope.input.ambiguity_digest);
    if (!projected || projected.status !== "open") {
      throw new KernelError(409, "COVERAGE_AMBIGUITY_NOT_OPEN",
        "The exact active Coverage Ambiguity is not open for resolution.");
    }
    const intent = await identityIntent.getWorkIntent(envelope.input.work_intent_id);
    assertWorkIntentBinding(intent, onboarding);
    return executeCommand({
      installationId,
      command,
      requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-onboarding:${onboarding.onboarding_id}`
        ]);
        const current = await coverageInternal.loadOnboarding(onboarding.onboarding_id, client);
        if (current.revision !== envelope.input.expected_revision
            || current.event_head_digest !== onboarding.event_head_digest
            || current.active_interpretation_digest !== onboarding.active_interpretation_digest) {
          throw new KernelError(409, "COVERAGE_AMBIGUITY_REVISION_CONFLICT",
            "Coverage Onboarding changed before ambiguity resolution admission.");
        }
        const ambiguity = (await client.query(
          `SELECT * FROM diagnostic_coverage_ambiguities
           WHERE installation_id=$1 AND onboarding_id=$2 AND ambiguity_id=$3 AND ambiguity_digest=$4
             AND interpretation_digest=$5`,
          [installationId, current.onboarding_id, envelope.input.ambiguity_id,
            envelope.input.ambiguity_digest, current.active_interpretation_digest]
        )).rows[0];
        if (!ambiguity) {
          throw new KernelError(409, "COVERAGE_AMBIGUITY_NOT_OPEN",
            "The exact ambiguity is not part of the active interpretation.");
        }
        const existing = await client.query(
          `SELECT resolution_id FROM diagnostic_coverage_ambiguity_resolutions
           WHERE installation_id=$1 AND onboarding_id=$2 AND ambiguity_digest=$3`,
          [installationId, current.onboarding_id, ambiguity.ambiguity_digest]
        );
        if (existing.rows[0]) {
          throw new KernelError(409, "COVERAGE_AMBIGUITY_ALREADY_RESOLVED",
            "Coverage Ambiguity already has one immutable resolution.");
        }
        const resolutionId = randomUUID();
        const built = buildCoverageAmbiguityResolution({
          resolutionId,
          onboarding: current,
          ambiguity,
          input: envelope.input,
          principalId,
          executedBy: executionActor(ownerActor),
          confirmedAt: acceptedAt,
          workIntentDigest: intent.payload_digest
        });
        const eventIndex = current.revision + 1;
        await client.query(
          `INSERT INTO diagnostic_coverage_ambiguity_resolutions
            (resolution_id,installation_id,onboarding_id,ambiguity_digest,confirmation_document,
             confirmation_digest,resolution_document,resolution_digest,status,resolved_event_index,
             resolved_by_principal_id,executed_by_actor_type,executed_by_actor_id,resolved_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [resolutionId, installationId, current.onboarding_id, ambiguity.ambiguity_digest,
            built.confirmation, built.confirmation_digest, built.resolution, built.resolution_digest,
            built.status, eventIndex, principalId, ownerActor.type, ownerActor.id, acceptedAt]
        );
        const payload = {
          ambiguity_id: ambiguity.ambiguity_id,
          ambiguity_digest: ambiguity.ambiguity_digest,
          confirmation_digest: built.confirmation_digest,
          resolution_digest: built.resolution_digest,
          status: built.status,
          principal_id: principalId,
          authority: "human_confirmation_only"
        };
        const resolutionEventDigest = await coverageInternal.appendEvent(client, {
          onboardingId: current.onboarding_id,
          eventIndex,
          eventType: "ambiguity_resolved",
          priorEventDigest: current.event_head_digest,
          payload,
          actor: executionActor(ownerActor),
          occurredAt: acceptedAt
        });
        await coverageInternal.appendReviewInvalidation(client, {
          current,
          eventIndex: eventIndex + 1,
          priorEventDigest: resolutionEventDigest,
          trigger: "ambiguity_resolution_changed",
          priorMaterialDigest: ambiguity.ambiguity_digest,
          replacementMaterialDigest: built.resolution_digest,
          actor: executionActor(ownerActor),
          occurredAt: acceptedAt
        });
        const projection = await coverageInternal.loadOnboarding(current.onboarding_id, client);
        return {
          aggregateType: "coverage_onboarding",
          aggregateId: current.onboarding_id,
          transitionType: "diagnostic.coverage_ambiguity.resolved",
          fromRevision: current.revision,
          toRevision: projection.revision,
          transitionPayload: payload,
          result: {
            coverage_onboarding: projection,
            coverage_ambiguity_resolution: {
              ...built.resolution,
              confirmation: built.confirmation,
              resolution_digest: built.resolution_digest,
              immutable: true
            },
            created: true
          }
        };
      }
    });
  }

  return { assign, submit, resolveAmbiguity, getAssignment: loadAssignment };
}
