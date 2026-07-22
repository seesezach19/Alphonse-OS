// @ts-check

import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  projectRepairTask,
  requireExact,
  requireObject,
  requireString,
  requireUuid
} from "./diagnostic-repair-worker-contracts.js";
import { KernelError } from "./errors.js";

const REASON_CODES = new Set([
  "emergency_operator_action", "security_concern", "unexpected_behavior", "manual_recovery"
]);

/** @param {any} value @param {string} operationId @param {string[]} inputKeys */
function parseCommand(value, operationId, inputKeys) {
  const envelope = requireExact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) {
    throw new KernelError(400, "UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  }
  return {
    command_id: requireString(envelope.command_id, "command_id", 160),
    operation_id: operationId,
    input: requireExact(requireObject(envelope.input, "input"), "input", inputKeys)
  };
}

/** @param {any} value */
function reason(value) {
  const selected = requireString(value, "reason_code", 80);
  if (!REASON_CODES.has(selected)) {
    throw new KernelError(400, "INVALID_CONSOLE_CONTROL_INPUT", "reason_code is unsupported.");
  }
  return selected;
}

/** @param {any} actor */
function actorRole(actor) {
  if (actor?.authorization?.mode === "console_viewer") return "viewer";
  if (actor?.authorization?.mode === "trusted_operator") return "operator";
  if (actor?.type === "human") return "owner";
  throw new KernelError(403, "CONSOLE_ROLE_REQUIRED",
    "Console access requires an authenticated Viewer, Operator, or Owner.");
}

/** @param {any} actor */
function controlAuthorization(actor) {
  const role = actorRole(actor);
  if (role === "viewer") {
    throw new KernelError(403, "CONSOLE_CONTROL_AUTHORITY_REQUIRED",
      "Viewer sessions cannot invoke Console controls.");
  }
  return {
    role,
    requested_by: actor.authorization?.requested_by ?? { type: actor.type, id: actor.id },
    authorized_by: actor.authorization?.authorized_by ?? { type: actor.type, id: actor.id },
    executed_by: actor.authorization?.executed_by ?? { type: actor.type, id: actor.id },
    authorization_mode: actor.authorization?.mode ?? "direct_owner",
    operation_id: actor.authorization?.operation_id ?? null,
    instruction_digest: actor.authorization?.instruction_digest ?? null,
    authorized_at: actor.authorization?.authorized_at ?? null
  };
}

/** @param {any} actor */
function requireOwnerRecovery(actor) {
  const authorization = controlAuthorization(actor);
  if (authorization.role !== "owner") {
    throw new KernelError(403, "OWNER_RECOVERY_AUTHORITY_REQUIRED",
      "Only an authenticated Owner may resume a worker or release workflow quarantine.");
  }
  return authorization;
}

/** @param {any} value */
function timestamp(value) {
  return value instanceof Date ? value.toISOString() : value;
}

/** @param {any} row @param {"worker" | "workflow"} kind */
function currentControlView(row, kind) {
  if (!row) return {
    state: kind === "worker" ? "active" : "available",
    event_index: 0,
    reason_code: null,
    rationale: null,
    actor: null,
    occurred_at: null,
    legal_next_operations: kind === "worker"
      ? ["diagnostic.console_worker.suspend"]
      : ["diagnostic.console_workflow.quarantine"]
  };
  const blocked = row.event_type === (kind === "worker" ? "suspended" : "quarantined");
  return {
    state: blocked ? row.event_type : kind === "worker" ? "active" : "available",
    event_index: Number(row.event_index),
    reason_code: row.reason_code,
    rationale: row.rationale,
    authorization: row.authorization_record,
    actor: { type: row.actor_type, id: row.actor_id },
    occurred_at: timestamp(row.occurred_at),
    legal_next_operations: blocked
      ? [kind === "worker" ? "diagnostic.console_worker.resume"
        : "diagnostic.console_workflow.release"]
      : [kind === "worker" ? "diagnostic.console_worker.suspend"
        : "diagnostic.console_workflow.quarantine"]
  };
}

/** @param {any} caseRecord */
function lifecycle(caseRecord) {
  const promotion = caseRecord.promotions.at(-1) ?? null;
  const promotionState = promotion?.projection?.state ?? null;
  const stages = [
    ["observed", true, "Failure report admitted"],
    ["specified", Boolean(caseRecord.failure_specification), "Human-confirmed failure specification"],
    ["reproduced", caseRecord.reproduction_bundles.length > 0, "Demonstrated reproduction bundle"],
    ["diagnosed", Boolean(caseRecord.diagnosis), "Evidence-bound diagnosis"],
    ["repair_proposed", caseRecord.repair_candidates.length > 0, "Repair candidate retained"],
    ["verified", caseRecord.verification_receipts.some((/** @type {any} */ entry) =>
      entry.overall_result === "passed"),
      "Independent Verification Receipt"],
    ["authorized", Boolean(promotion), "Named-human Promotion authorization"],
    ["target", ["confirmed", "rolled_back"].includes(promotionState),
      promotionState === "rolled_back" ? "Rollback confirmed" : "Target confirmation"]
  ];
  return stages.map(([stage, complete, detail]) => ({ stage, complete, detail }));
}

/** @param {any} caseRecord @param {any} quarantine */
function casePacket(caseRecord, quarantine) {
  const promotion = caseRecord.promotions.at(-1) ?? null;
  const verification = caseRecord.verification_receipts.at(-1) ?? null;
  const latestTask = caseRecord.repair_tasks.at(-1) ?? null;
  const latestCandidate = caseRecord.repair_candidates.at(-1) ?? null;
  const diagnosis = caseRecord.diagnosis ?? null;
  const limitations = [
    ...(diagnosis?.diagnosis_document?.not_established ?? []),
    ...(quarantine?.state === "quarantined"
      ? ["Workflow maintenance is quarantined; no new repair or Promotion application is eligible."] : [])
  ];
  const legal = quarantine?.state === "quarantined"
    ? ["diagnostic.console_workflow.release", "diagnostic.promotion.reconcile",
      "diagnostic.promotion.rollback", "diagnostic.case.get"]
    : caseRecord.projection.legal_next_operations;
  return {
    case_id: caseRecord.case_id,
    workflow_id: caseRecord.workflow_id,
    revision_id: caseRecord.revision_id,
    summary: caseRecord.summary,
    report_digest: caseRecord.report_digest,
    reported_by: caseRecord.reported_by,
    reported_at: timestamp(caseRecord.reported_at),
    state: quarantine?.state === "quarantined" ? "quarantined" : caseRecord.projection.state,
    legal_next_operations: legal,
    expected_behavior: caseRecord.failure_specification?.expected_behavior ?? null,
    actual_behavior: caseRecord.failure_specification?.actual_behavior ?? null,
    lifecycle: lifecycle(caseRecord),
    diagnosis: diagnosis ? {
      diagnosis_id: diagnosis.diagnosis_id,
      diagnosis_digest: diagnosis.diagnosis_digest,
      interpretation: diagnosis.diagnosis_document.best_supported_hypothesis,
      limitations: diagnosis.diagnosis_document.not_established,
      submitted_at: timestamp(diagnosis.submitted_at)
    } : null,
    repair: latestTask ? {
      task_id: latestTask.task_id,
      worker_id: latestTask.agent_principal_id,
      state: latestTask.projection.state,
      lease_epoch: latestTask.lease_epoch,
      candidate_id: latestCandidate?.candidate_id ?? null,
      candidate_digest: latestCandidate?.material_digest ?? null,
      candidate_state: latestCandidate?.status ?? null,
      legal_next_operations: latestTask.projection.legal_next_operations
    } : null,
    verification: verification ? {
      verification_id: verification.verification_id,
      receipt_digest: verification.receipt_digest,
      result: verification.overall_result,
      runner: verification.runner,
      verified_at: timestamp(verification.verified_at),
      authority: "eligibility_only"
    } : null,
    promotion: promotion ? {
      promotion_id: promotion.promotion_id,
      authorization_digest: promotion.authorization_digest,
      owner: promotion.owner,
      state: promotion.projection.state,
      legal_next_operations: promotion.projection.legal_next_operations,
      expected_target_revision_digest: promotion.expected_target_revision_digest,
      candidate_target_revision_digest: promotion.candidate_target_revision_digest,
      uncertainty: promotion.events.findLast((/** @type {any} */ entry) =>
        entry.event_type === "uncertain") ?? null,
      recovery: promotion.events.filter((/** @type {any} */ entry) =>
        ["confirmed", "failed", "target_mismatch", "rollback_authorized", "rolled_back"]
          .includes(entry.event_type))
    } : null,
    limitations,
    authority: { source: "kernel_and_diagnostic_records", console: "none" }
  };
}

/**
 * @param {{ database: any, installationId: string, reproductionReader: any }} options
 */
export function createDiagnosticConsoleService({ database, installationId, reproductionReader }) {
  const { pool, executeCommand } = database;

  /** @param {string} agentPrincipalId @param {any} [client] */
  async function latestWorkerControl(agentPrincipalId, client = pool) {
    const result = await client.query(
      `SELECT * FROM diagnostic_worker_control_events
       WHERE installation_id=$1 AND agent_principal_id=$2 ORDER BY event_index DESC LIMIT 1`,
      [installationId, agentPrincipalId]
    );
    return result.rows[0] ?? null;
  }

  /** @param {string} workflowId @param {any} [client] */
  async function latestWorkflowControl(workflowId, client = pool) {
    const result = await client.query(
      `SELECT * FROM diagnostic_workflow_quarantine_events
       WHERE installation_id=$1 AND workflow_id=$2 ORDER BY event_index DESC LIMIT 1`,
      [installationId, workflowId]
    );
    return result.rows[0] ?? null;
  }

  /** @param {string} agentPrincipalId @param {any} [client] */
  async function assertWorkerAvailable(agentPrincipalId, client = pool) {
    const current = await latestWorkerControl(agentPrincipalId, client);
    if (current?.event_type === "suspended") {
      throw new KernelError(409, "MAINTENANCE_WORKER_SUSPENDED",
        "The Maintenance Worker is suspended by an admitted Console control.", {
          agent_principal_id: agentPrincipalId, event_id: current.event_id
        });
    }
  }

  /** @param {string} workflowId @param {any} [client] */
  async function assertWorkflowAvailable(workflowId, client = pool) {
    const current = await latestWorkflowControl(workflowId, client);
    if (current?.event_type === "quarantined") {
      throw new KernelError(409, "WORKFLOW_MAINTENANCE_QUARANTINED",
        "Workflow maintenance is quarantined by an admitted Console control.", {
          workflow_id: workflowId, event_id: current.event_id
        });
    }
  }

  /** @param {string} caseId @param {any} [client] */
  async function assertCaseWorkflowAvailable(caseId, client = pool) {
    const result = await client.query(
      `SELECT workflow_id FROM diagnostic_cases WHERE installation_id=$1 AND case_id=$2`,
      [installationId, caseId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "DIAGNOSTIC_CASE_NOT_FOUND", "Diagnostic Case does not exist.");
    }
    await assertWorkflowAvailable(result.rows[0].workflow_id, client);
  }

  /** @param {any} value @param {any} actor @param {"suspended" | "resumed"} eventType */
  async function setWorkerControl(value, actor, eventType) {
    const operationId = eventType === "suspended"
      ? "diagnostic.console_worker.suspend" : "diagnostic.console_worker.resume";
    const envelope = parseCommand(value, operationId,
      ["agent_principal_id", "reason_code", "rationale"]);
    const input = {
      agent_principal_id: requireUuid(envelope.input.agent_principal_id, "agent_principal_id"),
      reason_code: reason(envelope.input.reason_code),
      rationale: requireString(envelope.input.rationale, "rationale", 1000)
    };
    const authorization = eventType === "resumed"
      ? requireOwnerRecovery(actor) : controlAuthorization(actor);
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: sha256Digest({ installation_id: installationId, ...accepted }),
      apply: async (/** @type {any} */ client, /** @type {any} */ { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:console-worker-control:${input.agent_principal_id}`
        ]);
        const registration = await client.query(
          `SELECT 1 FROM diagnostic_repair_worker_registrations
           WHERE installation_id=$1 AND agent_principal_id=$2 LIMIT 1`,
          [installationId, input.agent_principal_id]
        );
        if (!registration.rows[0]) {
          throw new KernelError(404, "MAINTENANCE_WORKER_NOT_FOUND",
            "No registered Maintenance Worker has that principal identity.");
        }
        const current = await latestWorkerControl(input.agent_principal_id, client);
        const expectedCurrent = eventType === "suspended" ? "resumed" : "suspended";
        if (current && current.event_type !== expectedCurrent) {
          throw new KernelError(409, eventType === "suspended"
            ? "MAINTENANCE_WORKER_ALREADY_SUSPENDED" : "MAINTENANCE_WORKER_NOT_SUSPENDED",
          "Maintenance Worker control is already in the requested state.");
        }
        if (!current && eventType === "resumed") {
          throw new KernelError(409, "MAINTENANCE_WORKER_NOT_SUSPENDED",
            "Maintenance Worker is not suspended.");
        }
        const eventIndex = Number(current?.event_index ?? 0) + 1;
        const inserted = await client.query(
          `INSERT INTO diagnostic_worker_control_events
            (event_id,installation_id,agent_principal_id,event_index,event_type,reason_code,
             rationale,authorization_record,actor_type,actor_id,occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [randomUUID(), installationId, input.agent_principal_id, eventIndex, eventType,
            input.reason_code, input.rationale, authorization, actor.type, actor.id, acceptedAt]
        );
        return {
          aggregateType: "maintenance_worker_control", aggregateId: input.agent_principal_id,
          transitionType: `diagnostic.console_worker.${eventType}`,
          fromRevision: eventIndex - 1, toRevision: eventIndex,
          transitionPayload: { agent_principal_id: input.agent_principal_id, event_type: eventType },
          result: { worker_control: currentControlView(inserted.rows[0], "worker") }
        };
      }
    });
  }

  /** @param {any} value @param {any} actor @param {"quarantined" | "released"} eventType */
  async function setWorkflowControl(value, actor, eventType) {
    const operationId = eventType === "quarantined"
      ? "diagnostic.console_workflow.quarantine" : "diagnostic.console_workflow.release";
    const envelope = parseCommand(value, operationId, ["workflow_id", "reason_code", "rationale"]);
    const input = {
      workflow_id: requireString(envelope.input.workflow_id, "workflow_id", 160),
      reason_code: reason(envelope.input.reason_code),
      rationale: requireString(envelope.input.rationale, "rationale", 1000)
    };
    const authorization = eventType === "released"
      ? requireOwnerRecovery(actor) : controlAuthorization(actor);
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: sha256Digest({ installation_id: installationId, ...accepted }),
      apply: async (/** @type {any} */ client, /** @type {any} */ { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:console-workflow-control:${input.workflow_id}`
        ]);
        const workflow = await client.query(
          `SELECT 1 FROM diagnostic_agent_workflows WHERE installation_id=$1 AND workflow_id=$2`,
          [installationId, input.workflow_id]
        );
        if (!workflow.rows[0]) {
          throw new KernelError(404, "AGENT_WORKFLOW_NOT_FOUND", "Agent Workflow does not exist.");
        }
        const current = await latestWorkflowControl(input.workflow_id, client);
        const expectedCurrent = eventType === "quarantined" ? "released" : "quarantined";
        if (current && current.event_type !== expectedCurrent) {
          throw new KernelError(409, eventType === "quarantined"
            ? "WORKFLOW_ALREADY_QUARANTINED" : "WORKFLOW_NOT_QUARANTINED",
          "Workflow quarantine is already in the requested state.");
        }
        if (!current && eventType === "released") {
          throw new KernelError(409, "WORKFLOW_NOT_QUARANTINED", "Workflow is not quarantined.");
        }
        const eventIndex = Number(current?.event_index ?? 0) + 1;
        const inserted = await client.query(
          `INSERT INTO diagnostic_workflow_quarantine_events
            (event_id,installation_id,workflow_id,event_index,event_type,reason_code,
             rationale,authorization_record,actor_type,actor_id,occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [randomUUID(), installationId, input.workflow_id, eventIndex, eventType,
            input.reason_code, input.rationale, authorization, actor.type, actor.id, acceptedAt]
        );
        return {
          aggregateType: "workflow_maintenance_control", aggregateId: input.workflow_id,
          transitionType: `diagnostic.console_workflow.${eventType}`,
          fromRevision: eventIndex - 1, toRevision: eventIndex,
          transitionPayload: { workflow_id: input.workflow_id, event_type: eventType },
          result: { workflow_control: currentControlView(inserted.rows[0], "workflow") }
        };
      }
    });
  }

  /** @param {any} actor */
  async function getSnapshot(actor) {
    const role = actorRole(actor);
    const generatedAt = new Date().toISOString();
    const [workflowRows, caseRows, diagnosisRows, workerRows, diagnosticWorkerRows, artifactRows,
      assuranceRows, onboardingRows] = await Promise.all([
      pool.query(
        `SELECT w.*,r.revision_id,r.material_digest,r.runtime,r.created_at AS revision_created_at,
                q.event_type AS quarantine_event_type,q.event_index AS quarantine_event_index,
                q.reason_code AS quarantine_reason_code,q.rationale AS quarantine_rationale,
                q.authorization_record AS quarantine_authorization,q.actor_type AS quarantine_actor_type,
                q.actor_id AS quarantine_actor_id,q.occurred_at AS quarantine_occurred_at
         FROM diagnostic_agent_workflows w
         LEFT JOIN LATERAL (
           SELECT * FROM diagnostic_agent_revisions WHERE installation_id=w.installation_id
             AND workflow_id=w.workflow_id ORDER BY created_at DESC,revision_id DESC LIMIT 1
         ) r ON true
         LEFT JOIN LATERAL (
           SELECT * FROM diagnostic_workflow_quarantine_events WHERE installation_id=w.installation_id
             AND workflow_id=w.workflow_id ORDER BY event_index DESC LIMIT 1
         ) q ON true
         WHERE w.installation_id=$1 ORDER BY w.created_at,w.workflow_id`, [installationId]),
      pool.query(
        `SELECT case_id FROM diagnostic_cases WHERE installation_id=$1 ORDER BY reported_at,case_id`,
        [installationId]),
      pool.query(
        `SELECT d.*,c.case_id FROM diagnostic_worker_run_diagnoses d
         JOIN diagnostic_cases c ON c.installation_id=d.installation_id
         JOIN diagnostic_assignments a ON a.installation_id=d.installation_id
           AND a.assignment_id=d.assignment_id AND a.case_id=c.case_id
         WHERE d.installation_id=$1 ORDER BY d.submitted_at,d.diagnosis_id`, [installationId]),
      pool.query(
        `SELECT r.*,t.task_id,t.case_id,t.lease_epoch,t.lease_duration_seconds,
                te.event_type AS task_event_type,te.lease_expires_at,te.occurred_at AS task_event_at,
                wc.event_type AS control_event_type,wc.event_index AS control_event_index,
                wc.reason_code AS control_reason_code,wc.rationale AS control_rationale,
                wc.authorization_record AS control_authorization,wc.actor_type AS control_actor_type,
                wc.actor_id AS control_actor_id,wc.occurred_at AS control_occurred_at
         FROM diagnostic_repair_worker_registrations r
         LEFT JOIN LATERAL (
           SELECT * FROM diagnostic_repair_tasks WHERE installation_id=r.installation_id
             AND worker_registration_id=r.registration_id ORDER BY created_at DESC,task_id DESC LIMIT 1
         ) t ON true
         LEFT JOIN LATERAL (
           SELECT * FROM diagnostic_repair_task_events WHERE installation_id=r.installation_id
             AND task_id=t.task_id ORDER BY event_index DESC LIMIT 1
         ) te ON true
         LEFT JOIN LATERAL (
           SELECT * FROM diagnostic_worker_control_events WHERE installation_id=r.installation_id
             AND agent_principal_id=r.agent_principal_id ORDER BY event_index DESC LIMIT 1
         ) wc ON true
         WHERE r.installation_id=$1 ORDER BY r.registered_at,r.registration_id`, [installationId]),
      pool.query(
        `SELECT r.worker_principal_id,r.worker_passport_id,r.worker_run_id,r.claimed_at,r.expires_at,
                s.state,s.updated_at,d.diagnosis_id,d.diagnosis_digest
         FROM diagnostic_worker_runs r JOIN diagnostic_worker_run_states s USING (worker_run_id)
         LEFT JOIN diagnostic_worker_run_diagnoses d USING (worker_run_id)
         WHERE r.installation_id=$1 ORDER BY r.claimed_at,r.worker_run_id`, [installationId]),
      pool.query(
        `SELECT a.artifact_digest,a.size_bytes,a.media_type,a.created_at,
                t.deleted_at,t.deletion_reason,t.bytes_deleted
         FROM diagnostic_artifacts a LEFT JOIN diagnostic_artifact_tombstones t
           ON t.installation_id=a.installation_id AND t.artifact_digest=a.artifact_digest
         WHERE a.installation_id=$1 ORDER BY a.created_at,a.artifact_digest`, [installationId]),
      pool.query(
        `SELECT export_id,case_id,workflow_id,assurance_digest,created_at
         FROM diagnostic_maintenance_assurance_exports WHERE installation_id=$1
         ORDER BY created_at,export_id`, [installationId]),
      pool.query(
        `SELECT o.onboarding_id,o.workflow_reference,o.opened_at,
                e.event_type AS onboarding_event_type,e.event_index AS onboarding_event_index,
                e.occurred_at AS onboarding_event_at,
                re.event_type AS reconciliation_event_type,re.payload AS reconciliation_payload,
                re.occurred_at AS reconciliation_event_at
         FROM diagnostic_coverage_onboardings o
         LEFT JOIN LATERAL (
           SELECT * FROM diagnostic_coverage_onboarding_events WHERE installation_id=o.installation_id
             AND onboarding_id=o.onboarding_id ORDER BY event_index DESC LIMIT 1
         ) e ON true
         LEFT JOIN LATERAL (
           SELECT * FROM diagnostic_coverage_reconciliation_events WHERE installation_id=o.installation_id
             AND onboarding_id=o.onboarding_id ORDER BY event_index DESC LIMIT 1
         ) re ON true
         WHERE o.installation_id=$1 ORDER BY o.opened_at,o.onboarding_id`, [installationId])
    ]);

    const cases = await Promise.all(caseRows.rows.map(async (/** @type {any} */ row) =>
      reproductionReader.getCase(row.case_id)));
    const diagnosisByCase = new Map(diagnosisRows.rows.map((/** @type {any} */ row) =>
      [row.case_id, row]));
    const quarantineByWorkflow = new Map(workflowRows.rows.map((/** @type {any} */ row) => [row.workflow_id,
      currentControlView(row.quarantine_event_type ? {
        event_type: row.quarantine_event_type, event_index: row.quarantine_event_index,
        reason_code: row.quarantine_reason_code, rationale: row.quarantine_rationale,
        authorization_record: row.quarantine_authorization, actor_type: row.quarantine_actor_type,
        actor_id: row.quarantine_actor_id, occurred_at: row.quarantine_occurred_at
      } : null, "workflow")]));
    const onboardingByProviderId = new Map(onboardingRows.rows.map((/** @type {any} */ row) =>
      [row.workflow_reference?.provider_workflow_id, row]));

    return {
      schema_version: "alphonse.console-snapshot.v0.1",
      generated_at: generatedAt,
      data_mode: "live",
      source: {
        system: "alphonse-kernel",
        projection: "authenticated_customer_safe_records",
        authoritative: true,
        direct_database_authority: false
      },
      session: { role, subject: { type: actor.type, id: actor.id } },
      workflows: workflowRows.rows.map((/** @type {any} */ row) => {
        const providerId = row.external_ref?.workflow_key ?? null;
        const onboarding = onboardingByProviderId.get(providerId);
        const quarantine = quarantineByWorkflow.get(row.workflow_id);
        const reconciliationState = onboarding?.reconciliation_event_type === "cycle_completed"
          ? onboarding.reconciliation_payload?.assessment
          : onboarding?.reconciliation_event_type === "reconciliation_degraded" ? "suspended" : "unavailable";
        return {
          workflow_id: row.workflow_id,
          display_name: row.display_name,
          objective: row.objective,
          external_ref: row.external_ref,
          identity_digest: row.identity_digest,
          revision: row.revision_id ? {
            revision_id: row.revision_id,
            material_digest: row.material_digest,
            runtime: row.runtime,
            registered_at: timestamp(row.revision_created_at)
          } : null,
          coverage: {
            onboarding_id: onboarding?.onboarding_id ?? null,
            onboarding_state: onboarding?.onboarding_event_type ?? "unavailable",
            reconciliation_state: reconciliationState ?? "unavailable",
            observed_at: timestamp(onboarding?.reconciliation_event_at
              ?? onboarding?.onboarding_event_at ?? null),
            limitations: onboarding ? [] : ["No approved Coverage Onboarding record is bound to this workflow."]
          },
          quarantine,
          case_ids: cases.filter((/** @type {any} */ entry) => entry.workflow_id === row.workflow_id)
            .map((/** @type {any} */ entry) => entry.case_id),
          legal_next_operations: quarantine?.legal_next_operations ?? []
        };
      }),
      cases: cases.map((/** @type {any} */ entry) => casePacket({ ...entry,
        diagnosis: diagnosisByCase.get(entry.case_id) ?? null
      }, quarantineByWorkflow.get(entry.workflow_id))),
      workers: [
        ...workerRows.rows.map((/** @type {any} */ row) => {
          const events = row.task_event_type ? [{ event_type: row.task_event_type,
            lease_epoch: Number(row.lease_epoch), lease_expires_at: row.lease_expires_at }] : [];
          const taskState = row.task_id ? projectRepairTask({ lease_epoch: Number(row.lease_epoch) },
            events, Date.parse(generatedAt)) : null;
          const control = currentControlView(row.control_event_type ? {
            event_type: row.control_event_type, event_index: row.control_event_index,
            reason_code: row.control_reason_code, rationale: row.control_rationale,
            authorization_record: row.control_authorization, actor_type: row.control_actor_type,
            actor_id: row.control_actor_id, occurred_at: row.control_occurred_at
          } : null, "worker");
          return {
            worker_id: row.agent_principal_id,
            worker_kind: "repair_worker",
            registration_id: row.registration_id,
            passport_id: row.passport_id,
            passport_expires_at: timestamp(row.passport_expires_at),
            work_intent_id: row.work_intent_id,
            runtime_attribution: row.runtime_attribution,
            task: row.task_id ? { task_id: row.task_id, case_id: row.case_id,
              state: taskState?.state ?? "unavailable", lease_epoch: Number(row.lease_epoch),
              lease_expires_at: timestamp(row.lease_expires_at),
              legal_next_operations: taskState?.legal_next_operations ?? [] } : null,
            control,
            effective_state: control.state === "suspended" ? "suspended"
              : Date.parse(row.passport_expires_at) <= Date.parse(generatedAt) ? "expired" : "active"
          };
        }),
        ...diagnosticWorkerRows.rows.map((/** @type {any} */ row) => ({
          worker_id: row.worker_principal_id,
          worker_kind: "diagnostic_worker",
          passport_id: row.worker_passport_id,
          worker_run_id: row.worker_run_id,
          state: row.state,
          claimed_at: timestamp(row.claimed_at),
          expires_at: timestamp(row.expires_at),
          updated_at: timestamp(row.updated_at),
          diagnosis_id: row.diagnosis_id,
          diagnosis_digest: row.diagnosis_digest,
          authority: "diagnosis_proposal_only"
        }))
      ],
      evidence: artifactRows.rows.map((/** @type {any} */ row) => ({
        artifact_digest: row.artifact_digest,
        size_bytes: Number(row.size_bytes),
        media_type: row.media_type,
        created_at: timestamp(row.created_at),
        availability: row.deleted_at ? "revoked" : "available",
        bytes_deleted: row.bytes_deleted ?? false,
        limitation: row.deleted_at ? row.deletion_reason : null
      })),
      assurances: assuranceRows.rows.map((/** @type {any} */ row) => ({ ...row,
        created_at: timestamp(row.created_at), legal_next_operations: ["diagnostic.maintenance_assurance.get"] })),
      limitations: [
        "Snapshot freshness is bounded by generated_at and each source record timestamp.",
        "Unavailable coverage remains unavailable; the Console does not infer it from workflow activity.",
        "Target state remains uncertain until an admitted confirmation or reconciliation record exists.",
        "Revoked artifact metadata remains visible while revoked bytes remain inaccessible."
      ],
      legal_next_operations: role === "viewer" ? [] : [
        "diagnostic.console_worker.suspend", "diagnostic.console_workflow.quarantine",
        ...(role === "owner" ? ["diagnostic.console_worker.resume",
          "diagnostic.console_workflow.release"] : [])
      ]
    };
  }

  return {
    getSnapshot,
    suspendWorker: (/** @type {any} */ value, /** @type {any} */ actor) =>
      setWorkerControl(value, actor, "suspended"),
    resumeWorker: (/** @type {any} */ value, /** @type {any} */ actor) =>
      setWorkerControl(value, actor, "resumed"),
    quarantineWorkflow: (/** @type {any} */ value, /** @type {any} */ actor) =>
      setWorkflowControl(value, actor, "quarantined"),
    releaseWorkflow: (/** @type {any} */ value, /** @type {any} */ actor) =>
      setWorkflowControl(value, actor, "released"),
    assertWorkerAvailable,
    assertWorkflowAvailable,
    assertCaseWorkflowAvailable
  };
}
