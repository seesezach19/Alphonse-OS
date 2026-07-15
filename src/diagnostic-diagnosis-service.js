import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  buildDiagnosisProposalMaterial,
  projectDiagnosisProposal,
  validateDiagnosisIntentBoundary,
  validateDiagnosisOutput,
  validateDiagnosisRequest,
  validateDiagnosisWorkerRegistration
} from "./diagnostic-diagnosis-contracts.js";
import { requireExact, requireObject, requireString, requireUuid } from "./diagnostic-repair-worker-contracts.js";
import { KernelError } from "./errors.js";

const AUTHORITY = Object.freeze({
  failure_truth: "not_granted", evidence_mutation: "not_granted", repair: "not_granted",
  verification: "not_granted", promotion: "not_granted", target_change: "not_granted"
});

function parseCommand(value, operationId) {
  const envelope = requireExact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) {
    throw new KernelError(400, "UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  }
  return { command_id: requireString(envelope.command_id, "command_id", 160), operation_id: operationId,
    input: requireObject(envelope.input, "input") };
}

function requestDigest(installationId, command) {
  return sha256Digest({ installation_id: installationId, ...command });
}

function actor(passport) {
  return { type: "agent", id: passport.agent_principal_id };
}

function eventView(row) {
  return { event_id: row.event_id, event_index: Number(row.event_index), event_type: row.event_type,
    detail: row.detail, actor: { type: row.actor_type, id: row.actor_id }, occurred_at: row.occurred_at,
    immutable: true };
}

function registrationView(row) {
  return { registration_id: row.registration_id, passport_id: row.passport_id,
    agent_principal_id: row.agent_principal_id, work_intent_id: row.work_intent_id,
    work_intent_digest: row.work_intent_digest, work_intent_scope: row.work_intent_scope,
    work_intent_constraints: row.work_intent_constraints, passport_expires_at: row.passport_expires_at,
    protocol_version: row.protocol_version, runtime_attribution: row.runtime_attribution,
    registration_digest: row.registration_digest, registered_at: row.registered_at,
    model_provider_credentials_stored: false, independent_verification: false,
    authority: { ...AUTHORITY }, immutable: true };
}

function requestView(row, events, proposalCount, now = Date.now()) {
  const failed = [...events].reverse().find((event) => event.event_type === "failed");
  const state = failed ? "failed" : now >= Date.parse(row.expires_at) ? "expired"
    : proposalCount > 0 ? "proposal_available" : "available";
  return { request_id: row.request_id, case_id: row.case_id,
    worker_registration_id: row.worker_registration_id, trace_references: [row.trace_id],
    failure_specification: { failure_specification_id: row.failure_specification_id,
      specification_digest: row.failure_specification_digest },
    revision: { revision_id: row.revision_id, artifact_digest: row.revision_artifact_digest },
    reproduction_bundle: { bundle_id: row.reproduction_bundle_id,
      artifact_digest: row.reproduction_bundle_artifact_digest, redacted: true },
    instruction: row.instruction, instruction_digest: row.instruction_digest,
    input_artifact_digests: [row.failure_specification_digest, row.revision_artifact_digest,
      row.reproduction_bundle_artifact_digest],
    request_digest: row.request_digest, expires_at: row.expires_at,
    created_by: { type: row.created_by_actor_type, id: row.created_by_actor_id }, created_at: row.created_at,
    events, proposal_count: proposalCount, projection: { state,
      legal_next_operations: state === "available" || state === "proposal_available"
        ? ["diagnostic.diagnosis_proposal.submit", "diagnostic.diagnosis_request.fail"] : [] },
    authority: { ...AUTHORITY }, immutable: true };
}

function proposalView(row, events) {
  return { proposal_id: row.proposal_id, request_id: row.request_id, case_id: row.case_id,
    worker_registration_id: row.worker_registration_id, proposal_digest: row.proposal_digest,
    diagnosis: row.diagnosis, model_provenance: row.model_provenance,
    submitted_by_agent_principal_id: row.submitted_by_agent_principal_id, submitted_at: row.submitted_at,
    events, projection: projectDiagnosisProposal(events), authority: { ...AUTHORITY }, immutable: true };
}

export function createDiagnosticDiagnosisService(database, artifactStore, installationId, identityIntent) {
  const { pool, executeCommand } = database;

  async function appendRequestEvent(client, requestId, eventType, detail, eventActor, occurredAt) {
    const count = await client.query(
      `SELECT COALESCE(MAX(event_index),0)+1 AS event_index FROM diagnostic_diagnosis_request_events
       WHERE installation_id=$1 AND request_id=$2`, [installationId, requestId]);
    await client.query(
      `INSERT INTO diagnostic_diagnosis_request_events
       (event_id,installation_id,request_id,event_index,event_type,detail,actor_type,actor_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), installationId, requestId, count.rows[0].event_index, eventType, detail,
        eventActor.type, eventActor.id, occurredAt]);
  }

  async function appendProposalEvent(client, proposalId, eventType, detail, eventActor, occurredAt) {
    const count = await client.query(
      `SELECT COALESCE(MAX(event_index),0)+1 AS event_index FROM diagnostic_diagnosis_proposal_events
       WHERE installation_id=$1 AND proposal_id=$2`, [installationId, proposalId]);
    await client.query(
      `INSERT INTO diagnostic_diagnosis_proposal_events
       (event_id,installation_id,proposal_id,event_index,event_type,detail,actor_type,actor_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), installationId, proposalId, count.rows[0].event_index, eventType, detail,
        eventActor.type, eventActor.id, occurredAt]);
  }

  async function getRequest(requestId, client = pool, now = Date.now()) {
    requireUuid(requestId, "request_id");
    const result = await client.query(
      `SELECT * FROM diagnostic_diagnosis_requests WHERE installation_id=$1 AND request_id=$2`,
      [installationId, requestId]);
    if (!result.rows[0]) throw new KernelError(404, "DIAGNOSIS_REQUEST_NOT_FOUND", "Diagnosis Request does not exist.");
    const events = await client.query(
      `SELECT * FROM diagnostic_diagnosis_request_events WHERE installation_id=$1 AND request_id=$2 ORDER BY event_index`,
      [installationId, requestId]);
    const proposals = await client.query(
      `SELECT COUNT(*) AS count FROM diagnostic_diagnosis_proposals WHERE installation_id=$1 AND request_id=$2`,
      [installationId, requestId]);
    return requestView(result.rows[0], events.rows.map(eventView), Number(proposals.rows[0].count), now);
  }

  async function getProposal(proposalId, client = pool) {
    requireUuid(proposalId, "proposal_id");
    const result = await client.query(
      `SELECT * FROM diagnostic_diagnosis_proposals WHERE installation_id=$1 AND proposal_id=$2`,
      [installationId, proposalId]);
    if (!result.rows[0]) throw new KernelError(404, "DIAGNOSIS_PROPOSAL_NOT_FOUND", "Diagnosis Proposal does not exist.");
    const events = await client.query(
      `SELECT * FROM diagnostic_diagnosis_proposal_events WHERE installation_id=$1 AND proposal_id=$2 ORDER BY event_index`,
      [installationId, proposalId]);
    return proposalView(result.rows[0], events.rows.map(eventView));
  }

  async function registerWorker(value, passport) {
    const envelope = parseCommand(value, "diagnostic.diagnosis_worker.register");
    const input = validateDiagnosisWorkerRegistration(envelope.input);
    if (input.passport_id !== passport.passport_id) {
      throw new KernelError(403, "PASSPORT_AUTHENTICATION_MISMATCH", "Authenticated Passport does not match registration.");
    }
    const intent = await identityIntent.getWorkIntent(input.work_intent_id);
    if (intent.passport_id !== input.passport_id || intent.agent_principal_id !== passport.agent_principal_id) {
      throw new KernelError(409, "PASSPORT_INTENT_MISMATCH", "Diagnostic Worker Passport and Work Intent do not match.");
    }
    if (intent.intent_class !== "diagnostic_analysis") {
      throw new KernelError(409, "DIAGNOSIS_INTENT_REQUIRED", "Worker requires a confirmed diagnostic_analysis intent.");
    }
    const accepted = { ...envelope, input, actor: actor(passport) };
    return executeCommand({ installationId, command: accepted,
      requestDigest: requestDigest(installationId, accepted), apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:diagnosis-worker:${input.passport_id}:${input.work_intent_id}`
        ]);
        const repairIdentity = await client.query(
          `SELECT registration_id FROM diagnostic_repair_worker_registrations
           WHERE installation_id=$1 AND agent_principal_id=$2 LIMIT 1`, [installationId, passport.agent_principal_id]);
        if (repairIdentity.rows[0]) {
          throw new KernelError(409, "DIAGNOSIS_WORKER_NOT_DISTINCT", "Diagnostic Worker must be distinct from Repair Worker.");
        }
        const registrationDigest = sha256Digest({ passport_id: input.passport_id,
          agent_principal_id: passport.agent_principal_id, work_intent_id: input.work_intent_id,
          work_intent_digest: intent.payload_digest, protocol_version: input.protocol_version,
          runtime_attribution: input.runtime_attribution });
        const existing = await client.query(
          `SELECT * FROM diagnostic_diagnosis_worker_registrations
           WHERE installation_id=$1 AND passport_id=$2 AND work_intent_id=$3`,
          [installationId, input.passport_id, input.work_intent_id]);
        if (existing.rows[0] && existing.rows[0].registration_digest !== registrationDigest) {
          throw new KernelError(409, "DIAGNOSIS_WORKER_REGISTRATION_CONFLICT", "Worker registration is immutable.");
        }
        let row = existing.rows[0];
        if (!row) {
          const inserted = await client.query(
            `INSERT INTO diagnostic_diagnosis_worker_registrations
             (registration_id,installation_id,passport_id,agent_principal_id,work_intent_id,work_intent_digest,
              work_intent_scope,work_intent_constraints,passport_expires_at,protocol_version,runtime_attribution,
              registration_digest,registered_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [randomUUID(), installationId, input.passport_id, passport.agent_principal_id, input.work_intent_id,
              intent.payload_digest, intent.scope, intent.constraints, passport.expires_at, input.protocol_version,
              input.runtime_attribution, registrationDigest, acceptedAt]);
          row = inserted.rows[0];
        }
        return { aggregateType: "diagnosis_worker", aggregateId: row.registration_id,
          transitionType: existing.rows[0] ? "diagnostic.diagnosis_worker.reused" : "diagnostic.diagnosis_worker.registered",
          fromRevision: existing.rows[0] ? 1 : 0, toRevision: 1,
          transitionPayload: { registration_id: row.registration_id },
          result: { diagnosis_worker: registrationView(row), created: !existing.rows[0] } };
      } });
  }

  async function createRequest(value, requestActor) {
    const envelope = parseCommand(value, "diagnostic.diagnosis_request.create");
    const input = validateDiagnosisRequest(envelope.input);
    const accepted = { ...envelope, input, actor: requestActor };
    return executeCommand({ installationId, command: accepted,
      requestDigest: requestDigest(installationId, accepted), apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:diagnosis-request:${input.case_id}:${input.worker_registration_id}`
        ]);
        const source = await client.query(
          `SELECT c.trace_id,c.revision_id,f.failure_specification_id,f.specification_digest,
                  r.snapshot_digest,b.bundle_id,b.artifact_digest AS bundle_artifact_digest,
                  w.*,r.workflow_id AS revision_workflow_id
           FROM diagnostic_cases c
           JOIN diagnostic_failure_specifications f ON f.installation_id=c.installation_id AND f.case_id=c.case_id
           JOIN diagnostic_reproduction_bundles b ON b.installation_id=c.installation_id AND b.case_id=c.case_id
           JOIN diagnostic_agent_revisions r ON r.installation_id=c.installation_id AND r.revision_id=c.revision_id
           JOIN diagnostic_diagnosis_worker_registrations w
             ON w.installation_id=c.installation_id AND w.registration_id=$3
           WHERE c.installation_id=$1 AND c.case_id=$2 AND b.bundle_id=$4`,
          [installationId, input.case_id, input.worker_registration_id, input.reproduction_bundle_id]);
        const row = source.rows[0];
        if (!row) throw new KernelError(409, "DIAGNOSIS_SOURCE_MISMATCH", "Exact confirmed diagnosis sources do not match.");
        validateDiagnosisIntentBoundary(row.work_intent_scope, row.work_intent_constraints, {
          case_id: input.case_id, revision_id: row.revision_id, reproduction_bundle_id: row.bundle_id
        });
        const expiresAt = Date.parse(input.expires_at);
        if (expiresAt <= Date.parse(acceptedAt) || expiresAt > Date.parse(acceptedAt) + 3600_000 ||
            expiresAt > Date.parse(row.passport_expires_at)) {
          throw new KernelError(409, "DIAGNOSIS_REQUEST_EXPIRY_INVALID",
            "Diagnosis Request must be future, at most one hour, and not outlive its Passport.");
        }
        const instructionDigest = sha256Digest({ instruction: input.instruction });
        const material = { case_id: input.case_id, worker_registration_id: input.worker_registration_id,
          trace_id: row.trace_id, failure_specification_digest: row.specification_digest,
          revision_id: row.revision_id, revision_artifact_digest: row.snapshot_digest,
          reproduction_bundle_id: row.bundle_id, reproduction_bundle_artifact_digest: row.bundle_artifact_digest,
          instruction_digest: instructionDigest, expires_at: input.expires_at };
        const materialDigest = sha256Digest(material);
        const existing = await client.query(
          `SELECT * FROM diagnostic_diagnosis_requests WHERE installation_id=$1 AND request_digest=$2`,
          [installationId, materialDigest]);
        let request = existing.rows[0];
        if (!request) {
          const inserted = await client.query(
            `INSERT INTO diagnostic_diagnosis_requests
             (request_id,installation_id,case_id,worker_registration_id,trace_id,failure_specification_id,
              failure_specification_digest,revision_id,revision_artifact_digest,reproduction_bundle_id,
              reproduction_bundle_artifact_digest,instruction,instruction_digest,request_digest,expires_at,
              created_by_actor_type,created_by_actor_id,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
            [randomUUID(), installationId, input.case_id, input.worker_registration_id, row.trace_id,
              row.failure_specification_id, row.specification_digest, row.revision_id, row.snapshot_digest,
              row.bundle_id, row.bundle_artifact_digest, input.instruction, instructionDigest, materialDigest,
              input.expires_at, requestActor.type, requestActor.id, acceptedAt]);
          request = inserted.rows[0];
          await appendRequestEvent(client, request.request_id, "available", { source_material_digest: materialDigest },
            requestActor, acceptedAt);
        }
        const view = await getRequest(request.request_id, client);
        return { aggregateType: "diagnosis_request", aggregateId: request.request_id,
          transitionType: existing.rows[0] ? "diagnostic.diagnosis_request.reused" : "diagnostic.diagnosis_request.created",
          fromRevision: existing.rows[0] ? 1 : 0, toRevision: 1,
          transitionPayload: { request_id: request.request_id, request_digest: materialDigest },
          result: { diagnosis_request: view, created: !existing.rows[0] } };
      } });
  }

  async function getWorkspace(requestId, passport) {
    const request = await getRequest(requestId);
    const registration = await pool.query(
      `SELECT * FROM diagnostic_diagnosis_worker_registrations
       WHERE installation_id=$1 AND registration_id=$2`, [installationId, request.worker_registration_id]);
    if (!registration.rows[0] || registration.rows[0].passport_id !== passport.passport_id ||
        registration.rows[0].agent_principal_id !== passport.agent_principal_id) {
      throw new KernelError(403, "DIAGNOSIS_WORKER_MISMATCH", "Diagnosis Request belongs to another worker.");
    }
    if (["expired", "failed"].includes(request.projection.state)) {
      throw new KernelError(409, "DIAGNOSIS_REQUEST_NOT_ACTIVE", "Diagnosis Request is not active.");
    }
    const sources = await pool.query(
      `SELECT f.*,r.runtime,r.nodes,r.model,r.configuration,r.adapter
       FROM diagnostic_diagnosis_requests q
       JOIN diagnostic_failure_specifications f ON f.failure_specification_id=q.failure_specification_id
       JOIN diagnostic_agent_revisions r ON r.revision_id=q.revision_id
       WHERE q.installation_id=$1 AND q.request_id=$2`, [installationId, requestId]);
    const revisionArtifact = await artifactStore.getJson(request.revision.artifact_digest);
    const bundleArtifact = await artifactStore.getJson(request.reproduction_bundle.artifact_digest);
    return { diagnosis_request: request, confirmed_failure_specification: sources.rows[0],
      agent_revision: { revision_id: request.revision.revision_id, runtime: sources.rows[0].runtime,
        nodes: sources.rows[0].nodes, model: sources.rows[0].model, configuration: sources.rows[0].configuration,
        adapter: sources.rows[0].adapter, artifact: revisionArtifact },
      redacted_reproduction_bundle: bundleArtifact, trace_references: request.trace_references,
      model_provider_credentials_supplied_by_alphonse: false, authority: { ...AUTHORITY } };
  }

  async function submitProposal(value, passport) {
    const envelope = parseCommand(value, "diagnostic.diagnosis_proposal.submit");
    const raw = requireExact(envelope.input, "input", ["request_id", "diagnosis"]);
    const input = { request_id: requireUuid(raw.request_id, "request_id"), diagnosis: validateDiagnosisOutput(raw.diagnosis) };
    const accepted = { ...envelope, input, actor: actor(passport) };
    return executeCommand({ installationId, command: accepted,
      requestDigest: requestDigest(installationId, accepted), apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:diagnosis-submit:${input.request_id}`
        ]);
        const request = await getRequest(input.request_id, client);
        const registration = await client.query(
          `SELECT * FROM diagnostic_diagnosis_worker_registrations WHERE installation_id=$1 AND registration_id=$2`,
          [installationId, request.worker_registration_id]);
        if (!registration.rows[0] || registration.rows[0].passport_id !== passport.passport_id ||
            registration.rows[0].agent_principal_id !== passport.agent_principal_id) {
          throw new KernelError(403, "DIAGNOSIS_WORKER_MISMATCH", "Only the assigned Diagnostic Worker may submit.");
        }
        if (["expired", "failed"].includes(request.projection.state)) {
          throw new KernelError(409, "DIAGNOSIS_REQUEST_NOT_ACTIVE", "Diagnosis Request is not active.");
        }
        const expectedDigests = [...request.input_artifact_digests].sort();
        if (input.diagnosis.provenance.instruction_digest !== request.instruction_digest ||
            JSON.stringify([...input.diagnosis.provenance.input_artifact_digests].sort()) !== JSON.stringify(expectedDigests)) {
          throw new KernelError(409, "DIAGNOSIS_PROVENANCE_MISMATCH", "Diagnosis provenance must bind exact request inputs.");
        }
        const referencedDigests = [
          ...input.diagnosis.artifact_references,
          ...input.diagnosis.facts.flatMap((item) => item.artifact_references),
          ...input.diagnosis.inferences.flatMap((item) => item.basis),
          ...input.diagnosis.hypotheses.flatMap((item) => [
            ...item.supporting_artifact_references, ...item.contradicting_artifact_references
          ]),
          ...input.diagnosis.recommended_investigation.flatMap((item) => item.artifact_references)
        ];
        if (referencedDigests.some((digest) => !expectedDigests.includes(digest))) {
          throw new KernelError(409, "DIAGNOSIS_ARTIFACT_REFERENCE_MISMATCH", "Diagnosis references an unbound artifact.");
        }
        const material = buildDiagnosisProposalMaterial({ requestId: request.request_id, caseId: request.case_id,
          workerRegistrationId: request.worker_registration_id, output: input.diagnosis });
        const existing = await client.query(
          `SELECT * FROM diagnostic_diagnosis_proposals
           WHERE installation_id=$1 AND request_id=$2 AND proposal_digest=$3`,
          [installationId, request.request_id, material.proposal_digest]);
        let proposal = existing.rows[0];
        if (!proposal) {
          const inserted = await client.query(
            `INSERT INTO diagnostic_diagnosis_proposals
             (proposal_id,installation_id,request_id,case_id,worker_registration_id,proposal_digest,diagnosis,
              model_provenance,submitted_by_agent_principal_id,submitted_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [randomUUID(), installationId, request.request_id, request.case_id, request.worker_registration_id,
              material.proposal_digest, input.diagnosis, input.diagnosis.provenance,
              passport.agent_principal_id, acceptedAt]);
          proposal = inserted.rows[0];
          await appendProposalEvent(client, proposal.proposal_id, "proposed", {
            proposal_digest: material.proposal_digest, independent_verification: false
          }, actor(passport), acceptedAt);
        }
        const view = await getProposal(proposal.proposal_id, client);
        return { aggregateType: "diagnosis_proposal", aggregateId: proposal.proposal_id,
          transitionType: existing.rows[0] ? "diagnostic.diagnosis_proposal.reused" : "diagnostic.diagnosis_proposal.submitted",
          fromRevision: existing.rows[0] ? 1 : 0, toRevision: 1,
          transitionPayload: { proposal_id: proposal.proposal_id, proposal_digest: material.proposal_digest },
          result: { diagnosis_proposal: view, created: !existing.rows[0] } };
      } });
  }

  async function failRequest(value, passport) {
    const envelope = parseCommand(value, "diagnostic.diagnosis_request.fail");
    const raw = requireExact(envelope.input, "input", ["request_id", "reason"]);
    const input = { request_id: requireUuid(raw.request_id, "request_id"), reason: requireString(raw.reason, "reason", 1000) };
    const accepted = { ...envelope, input, actor: actor(passport) };
    return executeCommand({ installationId, command: accepted,
      requestDigest: requestDigest(installationId, accepted), apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:diagnosis-submit:${input.request_id}`
        ]);
        const request = await getRequest(input.request_id, client);
        const registration = await client.query(
          `SELECT * FROM diagnostic_diagnosis_worker_registrations WHERE installation_id=$1 AND registration_id=$2`,
          [installationId, request.worker_registration_id]);
        if (!registration.rows[0] || registration.rows[0].passport_id !== passport.passport_id) {
          throw new KernelError(403, "DIAGNOSIS_WORKER_MISMATCH", "Only assigned Diagnostic Worker may fail request.");
        }
        if (["failed", "expired"].includes(request.projection.state)) {
          throw new KernelError(409, "DIAGNOSIS_REQUEST_NOT_ACTIVE", "Diagnosis Request is not active.");
        }
        await appendRequestEvent(client, request.request_id, "failed", { reason: input.reason }, actor(passport), acceptedAt);
        return { aggregateType: "diagnosis_request", aggregateId: request.request_id,
          transitionType: "diagnostic.diagnosis_request.failed", fromRevision: request.events.length,
          toRevision: request.events.length + 1, transitionPayload: { request_id: request.request_id },
          result: { diagnosis_request: await getRequest(request.request_id, client) } };
      } });
  }

  async function reviewProposal(value, reviewActor) {
    const envelope = parseCommand(value, "diagnostic.diagnosis_proposal.review");
    const raw = requireExact(envelope.input, "input", ["proposal_id", "decision", "rationale"]);
    const decision = requireString(raw.decision, "decision", 20);
    if (!["accepted", "rejected"].includes(decision)) {
      throw new KernelError(400, "INVALID_DIAGNOSIS_REVIEW", "decision must be accepted or rejected.");
    }
    const input = { proposal_id: requireUuid(raw.proposal_id, "proposal_id"), decision,
      rationale: requireString(raw.rationale, "rationale", 2000) };
    const accepted = { ...envelope, input, actor: reviewActor };
    return executeCommand({ installationId, command: accepted,
      requestDigest: requestDigest(installationId, accepted), apply: async (client, { acceptedAt }) => {
        await client.query(
          `SELECT proposal_id FROM diagnostic_diagnosis_proposals
           WHERE installation_id=$1 AND proposal_id=$2 FOR UPDATE`, [installationId, input.proposal_id]);
        const proposal = await getProposal(input.proposal_id, client);
        if (proposal.projection.usefulness !== "unreviewed") {
          throw new KernelError(409, "DIAGNOSIS_ALREADY_REVIEWED", "Diagnosis Proposal already has a usefulness review.");
        }
        await appendProposalEvent(client, proposal.proposal_id, input.decision,
          { rationale: input.rationale, truth_changed: false, authority_granted: false }, reviewActor, acceptedAt);
        return { aggregateType: "diagnosis_proposal", aggregateId: proposal.proposal_id,
          transitionType: `diagnostic.diagnosis_proposal.${input.decision}`,
          fromRevision: proposal.events.length, toRevision: proposal.events.length + 1,
          transitionPayload: { proposal_id: proposal.proposal_id, usefulness: input.decision },
          result: { diagnosis_proposal: await getProposal(proposal.proposal_id, client) } };
      } });
  }

  return { createRequest, failRequest, getProposal, getRequest, getWorkspace, registerWorker,
    reviewProposal, submitProposal };
}
