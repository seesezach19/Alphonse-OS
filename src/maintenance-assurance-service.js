// @ts-check

import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {unknown} value @param {string} field @param {number} [maximum] */
function required(value, field, maximum = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new KernelError(400, "INVALID_MAINTENANCE_ASSURANCE_INPUT", `${field} is required.`);
  }
  return value.trim();
}

/** @param {unknown} value @param {string} field */
function uuid(value, field) {
  const result = required(value, field, 36);
  if (!UUID.test(result)) {
    throw new KernelError(400, "INVALID_MAINTENANCE_ASSURANCE_INPUT", `${field} must be a UUID.`);
  }
  return result;
}

/** @param {any} value @param {string} field @param {string[]} keys */
function exact(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_MAINTENANCE_ASSURANCE_INPUT", `${field} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new KernelError(400, "INVALID_MAINTENANCE_ASSURANCE_INPUT", `${field} fields must be exact.`, {
      expected, received: actual
    });
  }
  return value;
}

export const MAINTENANCE_AGENT_PROFILE = Object.freeze({
  schema_version: "alphonse.maintenance-agent-profile.v0.1",
  profile_id: "maintenance-agent:openclaw-codex:bounded-v1",
  runtime: Object.freeze({
    family: "openclaw-codex",
    replaceable_at_assignment_boundary: true,
    identity_source: "kernel_agent_passport_and_signed_dispatch",
    agent_held_production_authority: "none"
  }),
  work_queue: Object.freeze({
    diagnostic_assignments: "kernel_validated_single_use_claim",
    repair_tasks: "lease_epoch_fenced_customer_confirmed_work_intent",
    scope_expansion: "forbidden"
  }),
  budgets: Object.freeze({
    diagnostic_model_requests_per_run: 1,
    repair_external_effects: 0,
    repair_verification_operations: 0,
    repair_promotion_operations: 0,
    output_bytes: 1048576
  }),
  broker: Object.freeze({
    provider_credential_location: "model_broker_only",
    grant_use: "single_use",
    replay: "denied_and_recorded"
  }),
  tools: Object.freeze({
    diagnostic: Object.freeze(["frozen_evidence.read", "diagnosis.submit"]),
    repair: Object.freeze(["artifact.read", "candidate.submit", "task.heartbeat", "task.fail", "task.release"]),
    forbidden: Object.freeze(["credential.read", "verification.decide", "promotion.authorize", "target.mutate"])
  }),
  egress: Object.freeze({
    worker_network: "internal_broker_only",
    provider_api: "adapter_edge_only",
    customer_destination: "forbidden"
  }),
  leases: Object.freeze({
    diagnosis: "signed_short_lived_dispatch_authorization",
    repair: "bounded_lease_with_epoch_fence",
    restart_recovery: "durable_queue_state"
  }),
  checkpoints: Object.freeze([
    "assignment_claimed", "worker_started", "diagnosis_admitted", "repair_task_leased",
    "candidate_submitted", "candidate_inactive", "verification_admitted",
    "human_promotion_authorized", "target_confirmed_or_reconciled", "rollback_confirmed"
  ]),
  output_contracts: Object.freeze({
    diagnosis: "closed_schema_with_exact_evidence_citations",
    repair: "provider_neutral_patch_plus_targeted_regression_and_logs",
    invalid_output: "rejected_without_diagnosis_or_target_effect"
  })
});

export const MAINTENANCE_AGENT_PROFILE_DIGEST = sha256Digest(MAINTENANCE_AGENT_PROFILE);

function profileView() {
  return { ...structuredClone(MAINTENANCE_AGENT_PROFILE),
    profile_digest: MAINTENANCE_AGENT_PROFILE_DIGEST };
}

/** @param {any} row */
function exportView(row) {
  const computed = sha256Digest(row.assurance_document);
  if (computed !== row.assurance_digest) {
    throw new KernelError(500, "MAINTENANCE_ASSURANCE_INTEGRITY_VIOLATION",
      "Stored Maintenance Assurance document does not match its admitted digest.");
  }
  return {
    export_id: row.export_id,
    case_id: row.case_id,
    workflow_id: row.workflow_id,
    assurance_digest: row.assurance_digest,
    document: row.assurance_document,
    human_readable_markdown: row.human_readable_markdown,
    created_by: { type: row.created_by_actor_type, id: row.created_by_actor_id },
    created_at: row.created_at,
    immutable: true
  };
}

/** @param {any} document @param {string} assuranceDigest */
function markdown(document, assuranceDigest) {
  const facts = document.supported_facts.map((/** @type {any} */ entry) =>
    `- ${entry.statement}`).join("\n");
  const limitations = document.limitations.map((/** @type {string} */ entry) =>
    `- ${entry}`).join("\n");
  return [
    `# Maintenance Assurance — ${document.subject.workflow_id}`,
    "",
    `Case: ${document.subject.case_id}`,
    `Assurance profile: ${document.profile.profile_id} (${document.profile.profile_digest})`,
    "",
    "## Supported facts", facts,
    "", "## Interpretation",
    `- ${document.interpretation.mechanism} is ${document.interpretation.support}; confidence ${document.interpretation.confidence}.`,
    "", "## Limitations", limitations,
    "", "## Authorization",
    `- Repair Worker authority: ${document.authorization.repair_worker_authority}.`,
    `- Verification authority: ${document.authorization.verification_authority}.`,
    `- Promotion authorized by named human ${document.authorization.promoter.id}.`,
    "", "## Effects",
    `- Agent/model external business effects: ${document.effects.agent_external_business_effects}.`,
    `- Target journey state: ${document.effects.target_journey_state}.`,
    "", "## Recovery",
    `- ${document.recovery.outcome}; read-only reconciliation: ${document.recovery.read_only_reconciliation}.`,
    "", `Machine-verifiable assurance digest: ${assuranceDigest}`
  ].join("\n");
}

/** @param {{ database: any, installationId: string }} options */
export function createMaintenanceAssuranceService({ database, installationId }) {
  const { pool, executeCommand } = database;

  /** @param {any} input @param {any} [client] */
  async function source(input, client = pool) {
    const result = await client.query(
      `SELECT a.assignment_id,a.assignment_digest,a.case_id,a.evidence_package_id,
              dc.workflow_id,dc.revision_id,
              ep.semantic_digest AS evidence_semantic_digest,
              d.diagnosis_id,d.diagnosis_digest,d.diagnosis_document,d.worker_run_id,
              c.candidate_id,c.material_digest AS candidate_digest,c.task_id,
              t.agent_principal_id AS repair_agent_id,t.work_intent_id,t.work_intent_digest,
              t.work_intent_id AS repair_work_intent_id,rw.work_intent_constraints,
              rd.delivery_id,rd.adapter_receipt_digest,rd.target_candidate_id,
              rd.target_candidate_revision_digest,rd.target_candidate_state,
              v.verification_id,v.receipt_digest AS verification_receipt_digest,
              v.runner_id,v.overall_result,
              p.promotion_id,p.authorization_digest,p.owner_actor_type,p.owner_actor_id,
              p.expected_target_revision_digest,p.candidate_target_revision_digest
       FROM diagnostic_assignments a
       JOIN diagnostic_cases dc ON dc.installation_id=a.installation_id AND dc.case_id=a.case_id
       JOIN diagnostic_evidence_packages ep ON ep.installation_id=a.installation_id
         AND ep.evidence_package_id=a.evidence_package_id
       JOIN diagnostic_worker_run_diagnoses d ON d.installation_id=a.installation_id
         AND d.assignment_id=a.assignment_id
       JOIN diagnostic_repair_candidates c ON c.installation_id=a.installation_id
         AND c.case_id=a.case_id
       JOIN diagnostic_repair_tasks t ON t.installation_id=c.installation_id AND t.task_id=c.task_id
       JOIN diagnostic_repair_worker_registrations rw ON rw.installation_id=t.installation_id
         AND rw.registration_id=t.worker_registration_id
       JOIN diagnostic_repair_deliveries rd ON rd.installation_id=c.installation_id
         AND rd.candidate_id=c.candidate_id
       JOIN diagnostic_verification_receipts v ON v.installation_id=c.installation_id
         AND v.candidate_id=c.candidate_id AND v.delivery_id=rd.delivery_id
       JOIN diagnostic_promotions p ON p.installation_id=c.installation_id
         AND p.candidate_id=c.candidate_id AND p.delivery_id=rd.delivery_id
         AND p.verification_id=v.verification_id
       WHERE a.installation_id=$1 AND a.assignment_id=$2 AND d.worker_run_id=$3
         AND d.diagnosis_id=$4 AND c.candidate_id=$5 AND rd.delivery_id=$6
         AND v.verification_id=$7 AND p.promotion_id=$8`,
      [installationId, input.assignment_id, input.worker_run_id, input.diagnosis_id,
        input.repair_candidate_id, input.repair_delivery_id, input.verification_id,
        input.promotion_id]
    );
    if (!result.rows[0]) {
      throw new KernelError(409, "MAINTENANCE_ASSURANCE_SOURCE_MISMATCH",
        "Assurance sources do not form one exact diagnosis-to-repair journey.");
    }
    const events = await client.query(
      `SELECT event_index,event_type,detail,actor_type,actor_id,occurred_at
       FROM diagnostic_promotion_events WHERE installation_id=$1 AND promotion_id=$2
       ORDER BY event_index`, [installationId, input.promotion_id]
    );
    return { ...result.rows[0], promotion_events: events.rows };
  }

  /** @param {any} value @param {{ type: string, id: string }} actor */
  async function createExport(value, actor) {
    const envelope = exact(value, "command", ["command_id", "operation_id", "input"]);
    if (envelope.operation_id !== "diagnostic.maintenance_assurance.export") {
      throw new KernelError(400, "UNSUPPORTED_OPERATION",
        "operation_id must be diagnostic.maintenance_assurance.export.");
    }
    const raw = exact(envelope.input, "input", ["assignment_id", "worker_run_id", "diagnosis_id",
      "repair_candidate_id", "repair_delivery_id", "verification_id", "promotion_id"]);
    const input = Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, uuid(item, key)]));
    const accepted = { command_id: required(envelope.command_id, "command_id", 160),
      operation_id: envelope.operation_id, input, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: sha256Digest({ installation_id: installationId, ...accepted }),
      apply: async (/** @type {any} */ client, /** @type {any} */ { acceptedAt }) => {
        const record = await source(input, client);
        if (record.overall_result !== "passed" || record.target_candidate_state !== "inactive") {
          throw new KernelError(409, "MAINTENANCE_ASSURANCE_NOT_ELIGIBLE",
            "Exact inactive candidate and passing independent verification are required.");
        }
        const eventTypes = record.promotion_events.map((/** @type {any} */ entry) => entry.event_type);
        if (!eventTypes.includes("authorized") || !eventTypes.includes("confirmed")) {
          throw new KernelError(409, "MAINTENANCE_ASSURANCE_NOT_ELIGIBLE",
            "Named-human authorization and target confirmation are required.");
        }
        if (record.owner_actor_type !== "human"
            || String(record.repair_agent_id) === String(record.runner_id)
            || String(record.repair_agent_id) === String(record.owner_actor_id)) {
          throw new KernelError(409, "MAINTENANCE_ASSURANCE_IDENTITY_COLLISION",
            "Repair Worker, verifier, and promoter must remain distinct identities.");
        }
        const refs = [
          ["diagnostic_assignment", record.assignment_id, record.assignment_digest],
          ["evidence_package", record.evidence_package_id, record.evidence_semantic_digest],
          ["diagnosis", record.diagnosis_id, record.diagnosis_digest],
          ["repair_candidate", record.candidate_id, record.candidate_digest],
          ["repair_delivery", record.delivery_id, record.adapter_receipt_digest],
          ["verification_receipt", record.verification_id, record.verification_receipt_digest],
          ["promotion_authorization", record.promotion_id, record.authorization_digest]
        ].map(([type, id, digest]) => ({ type, id, digest }));
        const hypothesis = record.diagnosis_document.best_supported_hypothesis;
        const currentEvent = record.promotion_events.at(-1);
        /** @type {any} */
        const document = {
          schema_version: "alphonse.maintenance-assurance.v0.1",
          profile: { profile_id: MAINTENANCE_AGENT_PROFILE.profile_id,
            profile_digest: MAINTENANCE_AGENT_PROFILE_DIGEST },
          subject: { case_id: record.case_id, workflow_id: record.workflow_id,
            revision_id: record.revision_id },
          supported_facts: [
            { statement: "Frozen evidence was bound to one exact diagnostic assignment.",
              evidence: refs.slice(0, 2) },
            { statement: "A bounded worker submitted one schema-valid, citation-checked diagnosis.",
              evidence: [refs[2]] },
            { statement: "The repair was materialized as an inactive n8n candidate.",
              evidence: [refs[3], refs[4]] },
            { statement: "A distinct disposable runner passed the original defect and regressions.",
              evidence: [refs[5]] },
            { statement: "A named human authorized the exact candidate and target revision.",
              evidence: [refs[6]] }
          ],
          interpretation: { mechanism: hypothesis.mechanism, support: hypothesis.support,
            confidence: hypothesis.confidence, implementation_location: hypothesis.implementation_location,
            diagnosis_id: record.diagnosis_id },
          limitations: [
            ...record.diagnosis_document.not_established,
            "The reference model provider is synthetic; this proof does not establish frontier-model reliability.",
            "The n8n static-data deduplication candidate is pilot-scoped and requires retention policy review before production use.",
            "This local proof establishes one exact workflow journey, not universal connector or failure coverage."
          ],
          authorization: {
            repair_worker_authority: "candidate_proposal_only",
            verification_authority: "eligibility_only",
            promoter: { type: record.owner_actor_type, id: record.owner_actor_id },
            promotion_authorization_digest: record.authorization_digest,
            expected_target_revision_digest: record.expected_target_revision_digest,
            candidate_target_revision_digest: record.candidate_target_revision_digest
          },
          effects: { agent_external_business_effects: 0, candidate_state: record.target_candidate_state,
            target_journey_state: currentEvent.event_type,
            event_types: eventTypes },
          recovery: {
            outcome: eventTypes.includes("rolled_back") ? "owner_authorized_rollback_confirmed"
              : eventTypes.includes("uncertain") ? "timeout_reconciled_and_confirmed" : "target_confirmed",
            read_only_reconciliation: eventTypes.includes("uncertain"),
            rollback_available: true,
            final_event: currentEvent
          },
          machine_verification: { records: refs, promotion_events: record.promotion_events },
          integrity: {
            digest_algorithm: "sha256",
            canonicalization: "alphonse.canonical-json.v1",
            digest_location: "maintenance_assurance.assurance_digest"
          }
        };
        const admittedDocument = JSON.parse(JSON.stringify(document));
        const assuranceDigest = sha256Digest(admittedDocument);
        const humanReadable = markdown(admittedDocument, assuranceDigest);
        const exportId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO diagnostic_maintenance_assurance_exports
            (export_id,installation_id,case_id,workflow_id,assignment_id,worker_run_id,diagnosis_id,
             repair_candidate_id,repair_delivery_id,verification_id,promotion_id,assurance_document,
             assurance_digest,human_readable_markdown,created_by_actor_type,created_by_actor_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
          [exportId, installationId, record.case_id, record.workflow_id, record.assignment_id,
            record.worker_run_id, record.diagnosis_id, record.candidate_id, record.delivery_id,
            record.verification_id, record.promotion_id, admittedDocument, assuranceDigest, humanReadable,
            actor.type, actor.id, acceptedAt]
        );
        return {
          aggregateType: "maintenance_assurance", aggregateId: exportId,
          transitionType: "diagnostic.maintenance_assurance.exported", fromRevision: 0, toRevision: 1,
          transitionPayload: { export_id: exportId, case_id: record.case_id,
            assurance_digest: assuranceDigest },
          result: { maintenance_assurance: exportView(inserted.rows[0]), created: true }
        };
      }
    });
  }

  /** @param {string} exportId */
  async function getExport(exportId) {
    const result = await pool.query(
      `SELECT * FROM diagnostic_maintenance_assurance_exports
       WHERE installation_id=$1 AND export_id=$2`, [installationId, uuid(exportId, "export_id")]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "MAINTENANCE_ASSURANCE_NOT_FOUND",
        "Maintenance Assurance export does not exist.");
    }
    return exportView(result.rows[0]);
  }

  async function getQueue() {
    const [assignments, repairs] = await Promise.all([
      pool.query(
        `SELECT a.assignment_id,a.case_id,a.assignment_digest,a.created_at,s.state,s.state_revision,
                d.diagnosis_id,d.diagnosis_digest
         FROM diagnostic_assignments a JOIN diagnostic_assignment_states s USING (assignment_id)
         LEFT JOIN diagnostic_worker_run_diagnoses d ON d.assignment_id=a.assignment_id
           AND d.installation_id=a.installation_id
         WHERE a.installation_id=$1 ORDER BY a.created_at,a.assignment_id`, [installationId]),
      pool.query(
        `SELECT t.task_id,t.case_id,t.task_digest,t.agent_principal_id,t.lease_epoch,t.created_at,
                e.event_type,e.lease_expires_at,e.occurred_at
         FROM diagnostic_repair_tasks t JOIN LATERAL (
           SELECT event_type,lease_expires_at,occurred_at FROM diagnostic_repair_task_events
           WHERE installation_id=t.installation_id AND task_id=t.task_id ORDER BY event_index DESC LIMIT 1
         ) e ON true WHERE t.installation_id=$1 ORDER BY t.created_at,t.task_id`, [installationId])
    ]);
    return {
      schema_version: "alphonse.maintenance-work-queue.v0.1",
      profile: { profile_id: MAINTENANCE_AGENT_PROFILE.profile_id,
        profile_digest: MAINTENANCE_AGENT_PROFILE_DIGEST },
      diagnostic_assignments: assignments.rows.map((/** @type {any} */ row) => ({ ...row,
        state_revision: Number(row.state_revision), authority: "diagnosis_proposal_only" })),
      repair_tasks: repairs.rows.map((/** @type {any} */ row) => ({ ...row, lease_epoch: Number(row.lease_epoch),
        authority: "inactive_candidate_proposal_only" })),
      queue_authority: "none",
      durable: true
    };
  }

  return { createExport, getExport, getQueue, getProfile: profileView };
}
