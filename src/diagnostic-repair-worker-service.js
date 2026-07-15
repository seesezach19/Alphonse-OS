import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  buildRepairCandidateMaterial,
  buildRepairWorkspaceManifest,
  projectRepairTask,
  requireDigest,
  requireExact,
  requireObject,
  requireString,
  requireUuid,
  validateRepairIntentBoundary,
  validateRepairCandidateOutput,
  validateRepairTaskBounds,
  validateWorkerRegistration
} from "./diagnostic-repair-worker-contracts.js";
import { KernelError } from "./errors.js";

const AUTHORITY = Object.freeze({
  verification: "not_granted",
  owner_authorization: "not_granted",
  promotion: "not_granted",
  rollback: "not_granted"
});

function parseCommand(value, operationId) {
  const envelope = requireExact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) {
    throw new KernelError(400, "UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  }
  return {
    command_id: requireString(envelope.command_id, "command_id", 160),
    operation_id: operationId,
    input: requireObject(envelope.input, "input")
  };
}

function requestDigest(installationId, command) {
  return sha256Digest({ installation_id: installationId, ...command });
}

function workerActor(passport) {
  return { type: "agent", id: passport.agent_principal_id };
}

function leaseEpoch(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new KernelError(400, "INVALID_LEASE_EPOCH", "lease_epoch must be a positive integer.");
  }
  return value;
}

function eventView(row) {
  return {
    event_id: row.event_id,
    event_index: Number(row.event_index),
    lease_epoch: Number(row.lease_epoch),
    event_type: row.event_type,
    reason_code: row.reason_code,
    detail: row.detail,
    lease_expires_at: row.lease_expires_at,
    actor: { type: row.actor_type, id: row.actor_id },
    occurred_at: row.occurred_at,
    immutable: true
  };
}

function candidateView(row, eventRows = []) {
  if (!row) return null;
  const events = eventRows.map((event) => ({
    event_id: event.event_id,
    event_index: Number(event.event_index),
    event_type: event.event_type,
    detail: event.detail,
    actor: { type: event.actor_type, id: event.actor_id },
    occurred_at: event.occurred_at,
    immutable: true
  }));
  return {
    candidate_id: row.candidate_id,
    case_id: row.case_id,
    task_id: row.task_id,
    worker_registration_id: row.worker_registration_id,
    lease_epoch: Number(row.lease_epoch),
    base_revision_id: row.base_revision_id,
    reproduction_bundle_id: row.reproduction_bundle_id,
    material_digest: row.material_digest,
    artifacts: {
      candidate: row.candidate_artifact_digest,
      targeted_regression: row.regression_artifact_digest,
      logs: row.logs_artifact_digest
    },
    intended_behavior_change: row.intended_behavior_change,
    runtime_attribution: row.runtime_attribution,
    status: events.at(-1)?.event_type ?? row.initial_status,
    submitted_by_agent_principal_id: row.submitted_by_agent_principal_id,
    submitted_at: row.submitted_at,
    events,
    authority: { ...AUTHORITY },
    immutable: true
  };
}

function registrationView(row) {
  return {
    registration_id: row.registration_id,
    passport_id: row.passport_id,
    agent_principal_id: row.agent_principal_id,
    work_intent_id: row.work_intent_id,
    work_intent_digest: row.work_intent_digest,
    work_intent_scope: row.work_intent_scope,
    work_intent_constraints: row.work_intent_constraints,
    protocol_version: row.protocol_version,
    runtime_attribution: row.runtime_attribution,
    registration_digest: row.registration_digest,
    registered_at: row.registered_at,
    provider_credentials_stored: false,
    repository_credentials_stored: false,
    authority: { ...AUTHORITY },
    immutable: true
  };
}

function taskRowView(row, events, candidate, now) {
  const bounds = {
    allowed_operations: row.allowed_operations,
    artifact_limits: row.artifact_limits,
    lease_duration_seconds: row.lease_duration_seconds,
    expected_outputs: row.expected_outputs
  };
  return {
    task_id: row.task_id,
    case_id: row.case_id,
    worker_registration_id: row.worker_registration_id,
    passport_id: row.passport_id,
    agent_principal_id: row.agent_principal_id,
    work_intent_id: row.work_intent_id,
    work_intent_digest: row.work_intent_digest,
    base_revision_id: row.base_revision_id,
    reproduction_bundle_id: row.reproduction_bundle_id,
    previous_task_id: row.previous_task_id,
    workspace_inputs: {
      base_revision_artifact_digest: row.base_revision_artifact_digest,
      reproduction_bundle_artifact_digest: row.reproduction_bundle_artifact_digest
    },
    bounds,
    lease_epoch: Number(row.lease_epoch),
    task_digest: row.task_digest,
    created_by: { type: row.created_by_actor_type, id: row.created_by_actor_id },
    created_at: row.created_at,
    events,
    candidate,
    projection: projectRepairTask({ lease_epoch: Number(row.lease_epoch) }, events, now),
    authority: { ...AUTHORITY },
    immutable: true
  };
}

export function createDiagnosticRepairWorkerService(
  database, artifactStore, installationId, identityIntent
) {
  const { pool, executeCommand } = database;

  async function getCandidate(candidateId, client = pool) {
    requireUuid(candidateId, "candidate_id");
    const result = await client.query(
      `SELECT * FROM diagnostic_repair_candidates WHERE installation_id=$1 AND candidate_id=$2`,
      [installationId, candidateId]
    );
    if (!result.rows[0]) throw new KernelError(404, "REPAIR_CANDIDATE_NOT_FOUND", "Repair Candidate does not exist.");
    const events = await client.query(
      `SELECT * FROM diagnostic_repair_candidate_events
       WHERE installation_id=$1 AND candidate_id=$2 ORDER BY event_index`, [installationId, candidateId]
    );
    return candidateView(result.rows[0], events.rows);
  }

  async function getTask(taskId, client = pool, now = Date.now()) {
    requireUuid(taskId, "task_id");
    const result = await client.query(
      `SELECT * FROM diagnostic_repair_tasks WHERE installation_id=$1 AND task_id=$2`,
      [installationId, taskId]
    );
    if (!result.rows[0]) throw new KernelError(404, "REPAIR_TASK_NOT_FOUND", "Repair Task does not exist.");
    const eventsResult = await client.query(
      `SELECT * FROM diagnostic_repair_task_events
       WHERE installation_id=$1 AND task_id=$2 ORDER BY event_index`, [installationId, taskId]
    );
    const candidateResult = await client.query(
      `SELECT * FROM diagnostic_repair_candidates WHERE installation_id=$1 AND task_id=$2`,
      [installationId, taskId]
    );
    let candidate = null;
    if (candidateResult.rows[0]) {
      const candidateEvents = await client.query(
        `SELECT * FROM diagnostic_repair_candidate_events
         WHERE installation_id=$1 AND candidate_id=$2 ORDER BY event_index`,
        [installationId, candidateResult.rows[0].candidate_id]
      );
      candidate = candidateView(candidateResult.rows[0], candidateEvents.rows);
    }
    return taskRowView(result.rows[0], eventsResult.rows.map(eventView), candidate, now);
  }

  async function appendTaskEvent(client, task, {
    eventType, reasonCode, detail = {}, leaseExpiresAt = null, actor, occurredAt
  }) {
    const count = await client.query(
      `SELECT COALESCE(MAX(event_index),0)+1 AS event_index FROM diagnostic_repair_task_events
       WHERE installation_id=$1 AND task_id=$2`, [installationId, task.task_id]
    );
    const event = await client.query(
      `INSERT INTO diagnostic_repair_task_events
        (event_id,installation_id,task_id,event_index,lease_epoch,event_type,reason_code,detail,
         lease_expires_at,actor_type,actor_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [randomUUID(), installationId, task.task_id, count.rows[0].event_index, task.lease_epoch,
        eventType, reasonCode, detail, leaseExpiresAt, actor.type, actor.id, occurredAt]
    );
    return eventView(event.rows[0]);
  }

  async function requireTaskWorker(task, passport) {
    if (task.passport_id !== passport.passport_id ||
        task.agent_principal_id !== passport.agent_principal_id) {
      throw new KernelError(403, "REPAIR_TASK_WORKER_MISMATCH", "Repair Task belongs to another worker identity.");
    }
  }

  function requireLiveLease(task, leaseEpoch, operation) {
    if (task.lease_epoch !== leaseEpoch) {
      throw new KernelError(409, "LEASE_EPOCH_FENCED", "Repair Task lease epoch is stale.");
    }
    if (task.projection.state === "expired") {
      throw new KernelError(409, "LEASE_EXPIRED", "Repair Task lease has expired.");
    }
    if (task.projection.state !== "leased") {
      throw new KernelError(409, "LEASE_NOT_ACTIVE", "Repair Task does not have an active lease.");
    }
    if (!task.bounds.allowed_operations.includes(operation)) {
      throw new KernelError(403, "REPAIR_OPERATION_NOT_ALLOWED", `Repair Task does not allow ${operation}.`);
    }
  }

  async function registerWorker(value, authenticatedPassport) {
    const envelope = parseCommand(value, "diagnostic.repair_worker.register");
    const input = validateWorkerRegistration(envelope.input);
    if (input.passport_id !== authenticatedPassport.passport_id) {
      throw new KernelError(403, "PASSPORT_AUTHENTICATION_MISMATCH", "Authenticated Passport does not match registration.");
    }
    const workIntent = await identityIntent.getWorkIntent(input.work_intent_id);
    if (workIntent.passport_id !== input.passport_id ||
        workIntent.agent_principal_id !== authenticatedPassport.agent_principal_id) {
      throw new KernelError(409, "PASSPORT_INTENT_MISMATCH", "Worker Passport and Work Intent do not match.");
    }
    if (workIntent.intent_class !== "repair_work") {
      throw new KernelError(409, "REPAIR_INTENT_REQUIRED", "Worker requires a confirmed repair_work intent.");
    }
    const actor = workerActor(authenticatedPassport);
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: requestDigest(installationId, accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:repair-worker:${input.passport_id}:${input.work_intent_id}`
        ]);
        const diagnosisIdentity = await client.query(
          `SELECT registration_id FROM diagnostic_diagnosis_worker_registrations
           WHERE installation_id=$1 AND agent_principal_id=$2 LIMIT 1`,
          [installationId, authenticatedPassport.agent_principal_id]
        );
        if (diagnosisIdentity.rows[0]) {
          throw new KernelError(409, "REPAIR_WORKER_NOT_DISTINCT",
            "Repair Worker must be distinct from Diagnostic Worker.");
        }
        const registrationDigest = sha256Digest({
          passport_id: input.passport_id,
          agent_principal_id: authenticatedPassport.agent_principal_id,
          work_intent_id: input.work_intent_id,
          work_intent_digest: workIntent.payload_digest,
          protocol_version: input.protocol_version,
          runtime_attribution: input.runtime_attribution
        });
        const existing = await client.query(
          `SELECT * FROM diagnostic_repair_worker_registrations
           WHERE installation_id=$1 AND passport_id=$2 AND work_intent_id=$3 FOR SHARE`,
          [installationId, input.passport_id, input.work_intent_id]
        );
        if (existing.rows[0] && existing.rows[0].registration_digest !== registrationDigest) {
          throw new KernelError(409, "REPAIR_WORKER_REGISTRATION_CONFLICT", "Worker registration is immutable.");
        }
        let row = existing.rows[0];
        if (!row) {
          const inserted = await client.query(
            `INSERT INTO diagnostic_repair_worker_registrations
              (registration_id,installation_id,passport_id,agent_principal_id,work_intent_id,
               work_intent_digest,work_intent_scope,work_intent_constraints,passport_expires_at,
               protocol_version,runtime_attribution,registration_digest,registered_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [randomUUID(), installationId, input.passport_id, authenticatedPassport.agent_principal_id,
              input.work_intent_id, workIntent.payload_digest, workIntent.scope, workIntent.constraints,
              authenticatedPassport.expires_at, input.protocol_version, input.runtime_attribution,
              registrationDigest, acceptedAt]
          );
          row = inserted.rows[0];
        }
        return {
          aggregateType: "repair_worker", aggregateId: row.registration_id,
          transitionType: existing.rows[0] ? "diagnostic.repair_worker.reused" : "diagnostic.repair_worker.registered",
          fromRevision: existing.rows[0] ? 1 : 0, toRevision: 1,
          transitionPayload: { registration_id: row.registration_id, passport_id: row.passport_id },
          result: { repair_worker: registrationView(row), created: !existing.rows[0] }
        };
      }
    });
  }

  async function createTask(value, actor) {
    const envelope = parseCommand(value, "diagnostic.repair_task.create");
    const raw = requireExact(envelope.input, "input", [
      "case_id", "worker_registration_id", "reproduction_bundle_id", "allowed_operations",
      "artifact_limits", "lease_duration_seconds", "expected_outputs"
    ]);
    const bounds = validateRepairTaskBounds({
      allowed_operations: raw.allowed_operations,
      artifact_limits: raw.artifact_limits,
      lease_duration_seconds: raw.lease_duration_seconds,
      expected_outputs: raw.expected_outputs
    });
    const input = {
      case_id: requireUuid(raw.case_id, "case_id"),
      worker_registration_id: requireUuid(raw.worker_registration_id, "worker_registration_id"),
      reproduction_bundle_id: requireUuid(raw.reproduction_bundle_id, "reproduction_bundle_id"),
      ...bounds
    };
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: requestDigest(installationId, accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:repair-case:${input.case_id}`
        ]);
        const source = await client.query(
          `SELECT c.revision_id,b.bundle_id,b.artifact_digest AS bundle_artifact_digest,
                  r.snapshot_digest AS revision_artifact_digest,w.*,
                  t.deleted_at AS bundle_deleted_at
           FROM diagnostic_cases c
           JOIN diagnostic_reproduction_bundles b
             ON b.installation_id=c.installation_id AND b.case_id=c.case_id
           JOIN diagnostic_agent_revisions r
             ON r.installation_id=c.installation_id AND r.revision_id=c.revision_id
           JOIN diagnostic_repair_worker_registrations w
             ON w.installation_id=c.installation_id AND w.registration_id=$3
           LEFT JOIN diagnostic_artifact_tombstones t
             ON t.installation_id=b.installation_id AND t.artifact_digest=b.artifact_digest
           WHERE c.installation_id=$1 AND c.case_id=$2 AND b.bundle_id=$4 AND b.reproduction_status='demonstrated'
           FOR SHARE OF c,b,r,w`,
          [installationId, input.case_id, input.worker_registration_id, input.reproduction_bundle_id]
        );
        const row = source.rows[0];
        if (!row) throw new KernelError(409, "REPAIR_TASK_INPUT_MISMATCH",
          "Case, demonstrated Reproduction Bundle, revision, and worker registration must exist and match.");
        if (row.bundle_deleted_at) throw new KernelError(409, "REPRODUCTION_BUNDLE_RETIRED",
          "Repair Task cannot use retired Reproduction Bundle bytes.");
        validateRepairIntentBoundary(
          row.work_intent_scope, row.work_intent_constraints, input.case_id, row.revision_id
        );
        if (Date.parse(row.passport_expires_at) <= Date.parse(acceptedAt)) {
          throw new KernelError(409, "PASSPORT_EXPIRED", "Repair Worker Passport has expired.");
        }
        const priorRows = await client.query(
          `SELECT task_id FROM diagnostic_repair_tasks
           WHERE installation_id=$1 AND case_id=$2 ORDER BY created_at,task_id`, [installationId, input.case_id]
        );
        let previousTask = null;
        if (priorRows.rows.length) previousTask = await getTask(priorRows.rows.at(-1).task_id, client, Date.parse(acceptedAt));
        if (previousTask && ["available", "leased"].includes(previousTask.projection.state)) {
          throw new KernelError(409, "ACTIVE_REPAIR_TASK_EXISTS", "Case already has active repair work.");
        }
        const candidateRows = await client.query(
          `SELECT c.candidate_id,e.event_type
           FROM diagnostic_repair_candidates c
           JOIN LATERAL (
             SELECT event_type FROM diagnostic_repair_candidate_events
             WHERE installation_id=c.installation_id AND candidate_id=c.candidate_id
             ORDER BY event_index DESC LIMIT 1
           ) e ON true
           WHERE c.installation_id=$1 AND c.case_id=$2`, [installationId, input.case_id]
        );
        if (candidateRows.rows.some((candidate) => ["proposed", "verification_pending", "verified"].includes(candidate.event_type))) {
          throw new KernelError(409, "REPAIR_CANDIDATE_ALREADY_AVAILABLE", "Case already has a live Repair Candidate.");
        }
        const taskId = randomUUID();
        const leaseEpoch = previousTask ? previousTask.lease_epoch + 1 : 1;
        const taskMaterial = {
          case_id: input.case_id,
          worker_registration_id: input.worker_registration_id,
          passport_id: row.passport_id,
          agent_principal_id: row.agent_principal_id,
          work_intent_id: row.work_intent_id,
          work_intent_digest: row.work_intent_digest,
          base_revision_id: row.revision_id,
          base_revision_artifact_digest: row.revision_artifact_digest,
          reproduction_bundle_id: row.bundle_id,
          reproduction_bundle_artifact_digest: row.bundle_artifact_digest,
          previous_task_id: previousTask?.task_id ?? null,
          bounds,
          lease_epoch: leaseEpoch
        };
        const inserted = await client.query(
          `INSERT INTO diagnostic_repair_tasks
            (task_id,installation_id,case_id,worker_registration_id,passport_id,agent_principal_id,
             work_intent_id,work_intent_digest,base_revision_id,base_revision_artifact_digest,reproduction_bundle_id,
             reproduction_bundle_artifact_digest,previous_task_id,allowed_operations,artifact_limits,
             expected_outputs,lease_duration_seconds,lease_epoch,task_digest,created_by_actor_type,
             created_by_actor_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           RETURNING *`,
          [taskId, installationId, input.case_id, input.worker_registration_id, row.passport_id,
            row.agent_principal_id, row.work_intent_id, row.work_intent_digest, row.revision_id, row.revision_artifact_digest,
            row.bundle_id, row.bundle_artifact_digest, previousTask?.task_id ?? null,
            JSON.stringify(bounds.allowed_operations), JSON.stringify(bounds.artifact_limits),
            JSON.stringify(bounds.expected_outputs),
            bounds.lease_duration_seconds, leaseEpoch, sha256Digest(taskMaterial), actor.type, actor.id, acceptedAt]
        );
        await appendTaskEvent(client, inserted.rows[0], {
          eventType: "available", reasonCode: "REPAIR_TASK_CREATED", actor, occurredAt: acceptedAt
        });
        return {
          aggregateType: "repair_task", aggregateId: taskId,
          transitionType: "diagnostic.repair_task.created", fromRevision: 0, toRevision: 1,
          transitionPayload: { task_id: taskId, case_id: input.case_id, lease_epoch: leaseEpoch },
          result: { repair_task: await getTask(taskId, client, Date.parse(acceptedAt)), created: true }
        };
      }
    });
  }

  async function discoverTasks(authenticatedPassport) {
    const registrations = await pool.query(
      `SELECT registration_id FROM diagnostic_repair_worker_registrations
       WHERE installation_id=$1 AND passport_id=$2 AND agent_principal_id=$3`,
      [installationId, authenticatedPassport.passport_id, authenticatedPassport.agent_principal_id]
    );
    if (!registrations.rows.length) throw new KernelError(403, "REPAIR_WORKER_NOT_REGISTERED",
      "Authenticated worker has no Diagnostic registration.");
    const taskRows = await pool.query(
      `SELECT task_id FROM diagnostic_repair_tasks
       WHERE installation_id=$1 AND worker_registration_id=ANY($2::uuid[]) ORDER BY created_at,task_id`,
      [installationId, registrations.rows.map((row) => row.registration_id)]
    );
    const tasks = [];
    for (const row of taskRows.rows) {
      const task = await getTask(row.task_id);
      if (["available", "leased"].includes(task.projection.state)) tasks.push(task);
    }
    return { repair_tasks: tasks, authority: { ...AUTHORITY } };
  }

  async function claimTask(value, authenticatedPassport) {
    const envelope = parseCommand(value, "diagnostic.repair_task.claim");
    const inputRaw = requireExact(envelope.input, "input", ["task_id"]);
    const input = { task_id: requireUuid(inputRaw.task_id, "task_id") };
    const actor = workerActor(authenticatedPassport);
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId, command: accepted, requestDigest: requestDigest(installationId, accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:repair-task:${input.task_id}`
        ]);
        const task = await getTask(input.task_id, client, Date.parse(acceptedAt));
        await requireTaskWorker(task, authenticatedPassport);
        if (task.projection.state !== "available") {
          throw new KernelError(409, "REPAIR_TASK_LEASE_CONFLICT", "Repair Task is not available for claim.");
        }
        const registration = await client.query(
          `SELECT passport_expires_at FROM diagnostic_repair_worker_registrations
           WHERE installation_id=$1 AND registration_id=$2 FOR SHARE`,
          [installationId, task.worker_registration_id]
        );
        const expiresAt = new Date(Math.min(
          Date.parse(acceptedAt) + task.bounds.lease_duration_seconds * 1000,
          Date.parse(registration.rows[0].passport_expires_at)
        )).toISOString();
        if (Date.parse(expiresAt) <= Date.parse(acceptedAt)) {
          throw new KernelError(409, "PASSPORT_EXPIRED", "Repair Worker Passport has expired.");
        }
        await appendTaskEvent(client, task, {
          eventType: "leased", reasonCode: "WORKER_CLAIMED", actor,
          leaseExpiresAt: expiresAt, occurredAt: acceptedAt
        });
        const claimed = await getTask(task.task_id, client, Date.parse(acceptedAt));
        return {
          aggregateType: "repair_task", aggregateId: task.task_id,
          transitionType: "diagnostic.repair_task.leased", fromRevision: 1, toRevision: 2,
          transitionPayload: { task_id: task.task_id, lease_epoch: task.lease_epoch, lease_expires_at: expiresAt },
          result: {
            repair_task: claimed,
            workspace_manifest: buildRepairWorkspaceManifest({
              taskId: task.task_id,
              leaseEpoch: task.lease_epoch,
              baseRevisionArtifactDigest: task.workspace_inputs.base_revision_artifact_digest,
              reproductionBundleArtifactDigest: task.workspace_inputs.reproduction_bundle_artifact_digest,
              bounds: task.bounds
            })
          }
        };
      }
    });
  }

  async function heartbeat(value, authenticatedPassport) {
    const envelope = parseCommand(value, "diagnostic.repair_task.heartbeat");
    const raw = requireExact(envelope.input, "input", ["task_id", "lease_epoch", "status_note"]);
    const input = {
      task_id: requireUuid(raw.task_id, "task_id"),
      lease_epoch: leaseEpoch(raw.lease_epoch),
      status_note: requireString(raw.status_note, "status_note", 500)
    };
    const actor = workerActor(authenticatedPassport);
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId, command: accepted, requestDigest: requestDigest(installationId, accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:repair-task:${input.task_id}`
        ]);
        const task = await getTask(input.task_id, client, Date.parse(acceptedAt));
        await requireTaskWorker(task, authenticatedPassport);
        requireLiveLease(task, input.lease_epoch, "task.heartbeat");
        const registration = await client.query(
          `SELECT passport_expires_at FROM diagnostic_repair_worker_registrations
           WHERE installation_id=$1 AND registration_id=$2`, [installationId, task.worker_registration_id]
        );
        const expiresAt = new Date(Math.min(
          Date.parse(acceptedAt) + task.bounds.lease_duration_seconds * 1000,
          Date.parse(registration.rows[0].passport_expires_at)
        )).toISOString();
        if (Date.parse(expiresAt) <= Date.parse(acceptedAt)) {
          throw new KernelError(409, "PASSPORT_EXPIRED", "Repair Worker Passport has expired.");
        }
        await appendTaskEvent(client, task, {
          eventType: "heartbeat", reasonCode: "WORKER_HEARTBEAT",
          detail: { status_note: input.status_note }, leaseExpiresAt: expiresAt, actor, occurredAt: acceptedAt
        });
        return {
          aggregateType: "repair_task", aggregateId: task.task_id,
          transitionType: "diagnostic.repair_task.heartbeat", fromRevision: 2, toRevision: 2,
          transitionPayload: { task_id: task.task_id, lease_epoch: task.lease_epoch, lease_expires_at: expiresAt },
          result: { repair_task: await getTask(task.task_id, client, Date.parse(acceptedAt)) }
        };
      }
    });
  }

  async function retrieveArtifact(taskId, artifactDigest, authenticatedPassport) {
    requireUuid(taskId, "task_id");
    requireDigest(artifactDigest, "artifact_digest");
    const task = await getTask(taskId);
    await requireTaskWorker(task, authenticatedPassport);
    requireLiveLease(task, task.lease_epoch, "artifact.read");
    const allowed = Object.values(task.workspace_inputs);
    if (!allowed.includes(artifactDigest)) throw new KernelError(403, "REPAIR_ARTIFACT_SCOPE_DENIED",
      "Artifact is not bound to this Repair Task workspace.");
    const metadata = await pool.query(
      `SELECT a.*,t.deleted_at FROM diagnostic_artifacts a
       LEFT JOIN diagnostic_artifact_tombstones t
         ON t.installation_id=a.installation_id AND t.artifact_digest=a.artifact_digest
       WHERE a.installation_id=$1 AND a.artifact_digest=$2`, [installationId, artifactDigest]
    );
    if (!metadata.rows[0] || metadata.rows[0].deleted_at) {
      throw new KernelError(410, "REPAIR_ARTIFACT_UNAVAILABLE", "Task-bound artifact bytes are unavailable.");
    }
    const artifact = await artifactStore.getJson(artifactDigest);
    return {
      artifact: {
        artifact_digest: artifact.artifact.artifact_digest,
        size_bytes: artifact.artifact.size_bytes,
        media_type: artifact.artifact.media_type,
        content: artifact.content,
        verified: artifact.artifact.verified,
        task_id: task.task_id,
        lease_epoch: task.lease_epoch
      }
    };
  }

  function artifactBody(kind, artifact) {
    return {
      schema_version: "0.2.0",
      kind,
      declared_media_type: artifact.media_type,
      content: artifact.content
    };
  }

  async function persistArtifact(client, body, acceptedAt) {
    const artifact = await artifactStore.putJson(body);
    await client.query(
      `INSERT INTO diagnostic_artifacts
        (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
      [installationId, artifact.artifact_digest, artifact.size_bytes, artifact.media_type,
        artifact.storage_key, acceptedAt]
    );
    return artifact;
  }

  async function submitCandidate(value, authenticatedPassport) {
    const envelope = parseCommand(value, "diagnostic.repair_candidate.submit");
    const raw = requireExact(envelope.input, "input", ["task_id", "lease_epoch", "output"]);
    const input = {
      task_id: requireUuid(raw.task_id, "task_id"),
      lease_epoch: leaseEpoch(raw.lease_epoch),
      output: requireObject(raw.output, "output")
    };
    const actor = workerActor(authenticatedPassport);
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId, command: accepted, requestDigest: requestDigest(installationId, accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:repair-task:${input.task_id}`
        ]);
        let task = await getTask(input.task_id, client, Date.parse(acceptedAt));
        await requireTaskWorker(task, authenticatedPassport);
        if (task.lease_epoch !== input.lease_epoch) {
          throw new KernelError(409, "LEASE_EPOCH_FENCED", "Repair Task lease epoch is stale.");
        }
        let output;
        let bodies;
        try {
          output = validateRepairCandidateOutput(input.output, task.bounds.artifact_limits);
          const registration = await client.query(
            `SELECT runtime_attribution FROM diagnostic_repair_worker_registrations
             WHERE installation_id=$1 AND registration_id=$2`, [installationId, task.worker_registration_id]
          );
          if (sha256Digest(output.runtime_attribution) !== sha256Digest(registration.rows[0].runtime_attribution)) {
            throw new KernelError(400, "RUNTIME_ATTRIBUTION_MISMATCH",
              "Candidate runtime attribution must match the immutable worker registration.");
          }
          bodies = {
            candidate: artifactBody("repair_candidate", output.candidate_artifact),
            targeted_regression: artifactBody("targeted_regression", output.targeted_regression_artifact),
            logs: artifactBody("worker_logs", output.logs_artifact)
          };
          const storedSizes = Object.values(bodies).map((body) => Buffer.byteLength(canonicalize(body), "utf8"));
          if (storedSizes.some((size) => size > task.bounds.artifact_limits.max_artifact_bytes) ||
              storedSizes.reduce((total, size) => total + size, 0) > task.bounds.artifact_limits.max_total_bytes) {
            throw new KernelError(400, "REPAIR_ARTIFACT_LIMIT_EXCEEDED",
              "Persisted Repair Candidate artifacts exceed task limits.");
          }
        } catch (error) {
          requireLiveLease(task, input.lease_epoch, "candidate.submit");
          const failedEvent = await appendTaskEvent(client, task, {
            eventType: "failed", reasonCode: error.code ?? "INVALID_WORKER_OUTPUT",
            detail: { output_accepted: false }, actor, occurredAt: acceptedAt
          });
          return {
            aggregateType: "repair_task", aggregateId: task.task_id,
            transitionType: "diagnostic.repair_task.failed", fromRevision: 2, toRevision: 3,
            transitionPayload: { task_id: task.task_id, reason_code: failedEvent.reason_code },
            result: {
              submission_attempt: { status: "rejected", reason_code: failedEvent.reason_code, event: failedEvent },
              repair_candidate: null,
              repair_task: await getTask(task.task_id, client, Date.parse(acceptedAt))
            }
          };
        }
        const artifactDigests = Object.fromEntries(
          Object.entries(bodies).map(([key, body]) => [key, sha256Digest(body)])
        );
        const material = buildRepairCandidateMaterial({
          taskId: task.task_id,
          caseId: task.case_id,
          baseRevisionId: task.base_revision_id,
          reproductionBundleId: task.reproduction_bundle_id,
          output,
          artifactDigests
        });
        const existing = await client.query(
          `SELECT * FROM diagnostic_repair_candidates WHERE installation_id=$1 AND task_id=$2 FOR SHARE`,
          [installationId, task.task_id]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].material_digest !== material.material_digest) {
            throw new KernelError(409, "REPAIR_CANDIDATE_CONFLICT",
              "Repair Task already has a different immutable candidate.");
          }
          return {
            aggregateType: "repair_candidate", aggregateId: existing.rows[0].candidate_id,
            transitionType: "diagnostic.repair_candidate.reused", fromRevision: 1, toRevision: 1,
            transitionPayload: { candidate_id: existing.rows[0].candidate_id,
              material_digest: existing.rows[0].material_digest },
            result: { submission_attempt: { status: "accepted", reused: true },
              repair_candidate: await getCandidate(existing.rows[0].candidate_id, client), created: false }
          };
        }
        requireLiveLease(task, input.lease_epoch, "candidate.submit");
        const persisted = {
          candidate: await persistArtifact(client, bodies.candidate, acceptedAt),
          targeted_regression: await persistArtifact(client, bodies.targeted_regression, acceptedAt),
          logs: await persistArtifact(client, bodies.logs, acceptedAt)
        };
        const candidateId = randomUUID();
        const candidate = await client.query(
          `INSERT INTO diagnostic_repair_candidates
            (candidate_id,installation_id,case_id,task_id,worker_registration_id,lease_epoch,
             base_revision_id,reproduction_bundle_id,material_digest,candidate_artifact_digest,
             regression_artifact_digest,logs_artifact_digest,intended_behavior_change,runtime_attribution,
             initial_status,submitted_by_agent_principal_id,submitted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'proposed',$15,$16) RETURNING *`,
          [candidateId, installationId, task.case_id, task.task_id, task.worker_registration_id,
            task.lease_epoch, task.base_revision_id, task.reproduction_bundle_id, material.material_digest,
            persisted.candidate.artifact_digest, persisted.targeted_regression.artifact_digest,
            persisted.logs.artifact_digest, output.intended_behavior_change, output.runtime_attribution,
            authenticatedPassport.agent_principal_id, acceptedAt]
        );
        const candidateEvent = await client.query(
          `INSERT INTO diagnostic_repair_candidate_events
            (event_id,installation_id,candidate_id,event_index,event_type,detail,actor_type,actor_id,occurred_at)
           VALUES ($1,$2,$3,1,'proposed',$4,$5,$6,$7) RETURNING *`,
          [randomUUID(), installationId, candidateId,
            { material_digest: material.material_digest }, actor.type, actor.id, acceptedAt]
        );
        await appendTaskEvent(client, task, {
          eventType: "submitted", reasonCode: "REPAIR_CANDIDATE_SUBMITTED",
          detail: { candidate_id: candidateId, material_digest: material.material_digest },
          actor, occurredAt: acceptedAt
        });
        return {
          aggregateType: "repair_candidate", aggregateId: candidateId,
          transitionType: "diagnostic.repair_candidate.submitted", fromRevision: 0, toRevision: 1,
          transitionPayload: { candidate_id: candidateId, task_id: task.task_id,
            material_digest: material.material_digest },
          result: {
            submission_attempt: { status: "accepted", reused: false },
            repair_candidate: candidateView(candidate.rows[0], candidateEvent.rows),
            created: true
          }
        };
      }
    });
  }

  async function finishTask(value, authenticatedPassport, operationId, eventType) {
    const envelope = parseCommand(value, operationId);
    const fields = eventType === "failed"
      ? ["task_id", "lease_epoch", "failure_type", "summary"]
      : ["task_id", "lease_epoch", "reason"];
    const raw = requireExact(envelope.input, "input", fields);
    const input = {
      task_id: requireUuid(raw.task_id, "task_id"),
      lease_epoch: leaseEpoch(raw.lease_epoch),
      ...(eventType === "failed"
        ? { failure_type: requireString(raw.failure_type, "failure_type", 80),
          summary: requireString(raw.summary, "summary", 500) }
        : { reason: requireString(raw.reason, "reason", 500) })
    };
    if (eventType === "failed" && !["timeout", "process_loss", "worker_error", "invalid_output"].includes(input.failure_type)) {
      throw new KernelError(400, "INVALID_FAILURE_TYPE", "Repair failure type is unsupported.");
    }
    const actor = workerActor(authenticatedPassport);
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId, command: accepted, requestDigest: requestDigest(installationId, accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:repair-task:${input.task_id}`
        ]);
        const task = await getTask(input.task_id, client, Date.parse(acceptedAt));
        await requireTaskWorker(task, authenticatedPassport);
        requireLiveLease(task, input.lease_epoch, eventType === "failed" ? "task.fail" : "task.release");
        const event = await appendTaskEvent(client, task, {
          eventType,
          reasonCode: eventType === "failed" ? input.failure_type.toUpperCase() : "WORKER_RELEASED",
          detail: eventType === "failed" ? { summary: input.summary } : { reason: input.reason },
          actor, occurredAt: acceptedAt
        });
        return {
          aggregateType: "repair_task", aggregateId: task.task_id,
          transitionType: `diagnostic.repair_task.${eventType}`, fromRevision: 2, toRevision: 3,
          transitionPayload: { task_id: task.task_id, reason_code: event.reason_code },
          result: { repair_task: await getTask(task.task_id, client, Date.parse(acceptedAt)) }
        };
      }
    });
  }

  async function failTask(value, authenticatedPassport) {
    return finishTask(value, authenticatedPassport, "diagnostic.repair_task.fail", "failed");
  }

  async function releaseTask(value, authenticatedPassport) {
    return finishTask(value, authenticatedPassport, "diagnostic.repair_task.release", "released");
  }

  async function cancelTask(value, actor) {
    const envelope = parseCommand(value, "diagnostic.repair_task.cancel");
    const raw = requireExact(envelope.input, "input", ["task_id", "reason"]);
    const input = { task_id: requireUuid(raw.task_id, "task_id"), reason: requireString(raw.reason, "reason", 500) };
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId, command: accepted, requestDigest: requestDigest(installationId, accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:repair-task:${input.task_id}`
        ]);
        const task = await getTask(input.task_id, client, Date.parse(acceptedAt));
        if (!["available", "leased"].includes(task.projection.state)) {
          throw new KernelError(409, "REPAIR_TASK_NOT_CANCELLABLE", "Repair Task is already terminal.");
        }
        await appendTaskEvent(client, task, {
          eventType: "cancelled", reasonCode: "OWNER_CANCELLED", detail: { reason: input.reason },
          actor, occurredAt: acceptedAt
        });
        return {
          aggregateType: "repair_task", aggregateId: task.task_id,
          transitionType: "diagnostic.repair_task.cancelled",
          fromRevision: task.projection.state === "available" ? 1 : 2, toRevision: 3,
          transitionPayload: { task_id: task.task_id },
          result: { repair_task: await getTask(task.task_id, client, Date.parse(acceptedAt)) }
        };
      }
    });
  }

  return {
    cancelTask,
    claimTask,
    createTask,
    discoverTasks,
    failTask,
    getCandidate,
    getTask,
    heartbeat,
    registerWorker,
    releaseTask,
    retrieveArtifact,
    submitCandidate
  };
}
