import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import { verifyRuntimeEventEnvelope } from "./runtime-event-envelope.js";

const TERMINAL_CLAIMS = new Set(["succeeded", "failed", "cancelled"]);
const AUTHORITY = Object.freeze({
  kernel_run: "not_created",
  execution_envelope: "not_created",
  effect_evidence: "not_trusted",
  external_completion: "not_adjudicated"
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new KernelError(400, "INVALID_IDENTIFIER", `${label} must be a UUID.`);
  }
  return value;
}

function eventView(row) {
  return {
    receipt_id: row.receipt_id,
    event_id: row.event_id,
    event_sequence: String(row.event_sequence),
    lifecycle_claim: row.lifecycle_claim,
    correlation_id: row.correlation_id,
    occurred_at: row.occurred_at,
    received_at: row.received_at,
    delivery_delay_ms: String(row.delivery_delay_ms),
    out_of_order: row.out_of_order,
    payload: { digest: row.payload_digest, reference: row.payload_reference },
    envelope_digest: row.envelope_digest,
    authentication: {
      key_id: row.authentication_key_id,
      signed_at: row.authentication_signed_at,
      signature: row.authentication_signature
    }
  };
}

export function projectExternalActivityTrace(events) {
  const ordered = [...events].sort((left, right) => {
    const sequence = BigInt(left.event_sequence) - BigInt(right.event_sequence);
    if (sequence !== 0n) return sequence < 0n ? -1 : 1;
    return String(left.received_at).localeCompare(String(right.received_at));
  });
  const current = ordered.at(-1) ?? null;
  const terminalClaims = [...new Set(ordered
    .filter((event) => TERMINAL_CLAIMS.has(event.lifecycle_claim))
    .map((event) => event.lifecycle_claim))].sort();
  const terminalIndex = ordered.findIndex((event) => TERMINAL_CLAIMS.has(event.lifecycle_claim));
  const terminalRegression = terminalIndex >= 0
    && ordered.slice(terminalIndex + 1).some((event) => !TERMINAL_CLAIMS.has(event.lifecycle_claim));
  return {
    current_lifecycle_claim: current?.lifecycle_claim ?? null,
    current_event_sequence: current ? String(current.event_sequence) : null,
    projection_basis: "highest_event_sequence",
    out_of_order_observed: ordered.some((event) => event.out_of_order),
    terminal_claims_observed: terminalClaims,
    conflicting_terminal_claims: terminalClaims.length > 1,
    terminal_regression_observed: terminalRegression,
    claim_trusted_as_kernel_truth: false,
    lifecycle_history: ordered.map((event) => ({
      receipt_id: event.receipt_id,
      event_id: event.event_id,
      event_sequence: String(event.event_sequence),
      lifecycle_claim: event.lifecycle_claim,
      occurred_at: event.occurred_at,
      received_at: event.received_at,
      out_of_order: event.out_of_order
    }))
  };
}

function receivedIdentity(envelope) {
  return {
    adapter_id: envelope.adapter.adapter_id,
    adapter_version: envelope.adapter.adapter_version,
    workflow_id: envelope.workflow_id,
    revision_id: envelope.revision_id,
    external_execution_id: envelope.external_execution_id,
    event_id: envelope.event_id,
    event_sequence: String(envelope.event_sequence),
    idempotency_key: envelope.idempotency_key
  };
}

function conflictView(row) {
  return {
    conflict_id: row.conflict_id,
    conflict_digest: row.conflict_digest,
    received_envelope_digest: row.received_envelope_digest,
    received_identity: row.received_identity,
    conflict_types: row.conflict_types,
    accepted_receipt_ids: row.accepted_receipt_ids,
    detected_at: row.detected_at,
    preserved: true,
    authority: { ...AUTHORITY }
  };
}

export function createDiagnosticRuntimeService(database, installationId, adapterBinding, {
  timestampToleranceSeconds = 300
} = {}) {
  const { pool } = database;
  if (!adapterBinding?.adapter_id || !adapterBinding?.adapter_version || !adapterBinding?.key_id
      || typeof adapterBinding.secret !== "string" || adapterBinding.secret.length < 32) {
    throw new Error("Exact Workflow Runtime Adapter binding is required.");
  }
  if (!Number.isInteger(timestampToleranceSeconds)
      || timestampToleranceSeconds < 1 || timestampToleranceSeconds > 900) {
    throw new Error("Runtime Event timestamp tolerance must be an integer between 1 and 900 seconds.");
  }

  async function getTrace(traceId, client = pool) {
    uuid(traceId, "trace_id");
    const traceResult = await client.query(
      `SELECT * FROM diagnostic_external_activity_traces
       WHERE installation_id=$1 AND trace_id=$2`, [installationId, traceId]
    );
    if (!traceResult.rows[0]) {
      throw new KernelError(404, "EXTERNAL_ACTIVITY_TRACE_NOT_FOUND", "External Activity Trace does not exist.");
    }
    const eventResult = await client.query(
      `SELECT * FROM diagnostic_runtime_event_receipts
       WHERE installation_id=$1 AND trace_id=$2 ORDER BY event_sequence,received_at,receipt_id`,
      [installationId, traceId]
    );
    const trace = traceResult.rows[0];
    const events = eventResult.rows.map(eventView);
    return {
      trace_id: trace.trace_id,
      workflow_id: trace.workflow_id,
      revision_id: trace.revision_id,
      adapter: { adapter_id: trace.adapter_id, adapter_version: trace.adapter_version },
      external_execution_id: trace.external_execution_id,
      created_at: trace.created_at,
      classification: "untrusted_external_observation",
      immutable: true,
      authority: { ...AUTHORITY },
      event_count: String(events.length),
      projection: projectExternalActivityTrace(events),
      events
    };
  }

  async function getConflict(conflictId) {
    uuid(conflictId, "conflict_id");
    const result = await pool.query(
      `SELECT * FROM diagnostic_runtime_event_conflicts
       WHERE installation_id=$1 AND conflict_id=$2`, [installationId, conflictId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "RUNTIME_EVENT_CONFLICT_NOT_FOUND", "Runtime Event conflict does not exist.");
    }
    return conflictView(result.rows[0]);
  }

  async function receiveEvent(value, authentication, now = new Date()) {
    const verified = verifyRuntimeEventEnvelope(value, authentication, adapterBinding, {
      now,
      toleranceSeconds: timestampToleranceSeconds
    });
    const envelope = verified.envelope;
    const client = await pool.connect();
    let committed = false;
    let preservedConflict = null;
    try {
      await client.query("BEGIN");
      const lockKeys = [
        `runtime-event:${installationId}:event:${envelope.event_id}`,
        `runtime-event:${installationId}:execution:${envelope.adapter.adapter_id}:${envelope.external_execution_id}`,
        `runtime-event:${installationId}:idempotency:${envelope.idempotency_key}`,
        `runtime-event:${installationId}:sequence:${envelope.adapter.adapter_id}:${envelope.external_execution_id}:${envelope.event_sequence}`
      ].sort();
      for (const key of lockKeys) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      }

      const revisionResult = await client.query(
        `SELECT revision_id FROM diagnostic_agent_revisions
         WHERE installation_id=$1 AND workflow_id=$2 AND revision_id=$3`,
        [installationId, envelope.workflow_id, envelope.revision_id]
      );
      if (!revisionResult.rows[0]) {
        throw new KernelError(409, "AGENT_REVISION_IDENTITY_MISMATCH",
          "Runtime Event must bind an existing exact Agent Workflow and Agent Revision.");
      }

      const traceResult = await client.query(
        `SELECT * FROM diagnostic_external_activity_traces
         WHERE installation_id=$1 AND adapter_id=$2 AND external_execution_id=$3`,
        [installationId, envelope.adapter.adapter_id, envelope.external_execution_id]
      );
      let trace = traceResult.rows[0] ?? null;
      const candidateEvents = await client.query(
        `SELECT * FROM diagnostic_runtime_event_receipts
         WHERE installation_id=$1 AND (event_id=$2 OR idempotency_key=$3
           OR (trace_id=$4 AND event_sequence=$5))`,
        [installationId, envelope.event_id, envelope.idempotency_key,
          trace?.trace_id ?? "00000000-0000-0000-0000-000000000000", envelope.event_sequence]
      );

      const exactReplay = candidateEvents.rows.find((row) =>
        row.event_id === envelope.event_id
        && row.idempotency_key === envelope.idempotency_key
        && String(row.event_sequence) === String(envelope.event_sequence)
        && row.envelope_digest === verified.envelope_digest
        && trace
        && row.trace_id === trace.trace_id
        && trace.workflow_id === envelope.workflow_id
        && trace.revision_id === envelope.revision_id
        && trace.adapter_version === envelope.adapter.adapter_version
      );
      if (exactReplay) {
        await client.query("COMMIT");
        committed = true;
        return { replayed: true, result: exactReplay.receipt };
      }

      const conflictTypes = new Set();
      const acceptedReceiptIds = new Set();
      if (trace && (trace.workflow_id !== envelope.workflow_id || trace.revision_id !== envelope.revision_id
          || trace.adapter_version !== envelope.adapter.adapter_version)) {
        conflictTypes.add("external_execution_identity");
      }
      for (const row of candidateEvents.rows) {
        if (row.event_id === envelope.event_id) conflictTypes.add("event_identity");
        if (row.idempotency_key === envelope.idempotency_key) conflictTypes.add("idempotency_key");
        if (trace && row.trace_id === trace.trace_id
            && String(row.event_sequence) === String(envelope.event_sequence)) conflictTypes.add("event_sequence");
        acceptedReceiptIds.add(row.receipt_id);
      }

      if (conflictTypes.size) {
        const conflictDocument = {
          received_envelope_digest: verified.envelope_digest,
          received_identity: receivedIdentity(envelope),
          conflict_types: [...conflictTypes].sort(),
          accepted_receipt_ids: [...acceptedReceiptIds].sort()
        };
        const conflictDigest = sha256Digest(conflictDocument);
        const inserted = await client.query(
          `INSERT INTO diagnostic_runtime_event_conflicts
            (conflict_id,installation_id,conflict_digest,received_envelope_digest,received_identity,
             conflict_types,accepted_receipt_ids,detected_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (installation_id,conflict_digest) DO NOTHING RETURNING *`,
          [randomUUID(), installationId, conflictDigest, verified.envelope_digest,
            conflictDocument.received_identity, JSON.stringify(conflictDocument.conflict_types),
            JSON.stringify(conflictDocument.accepted_receipt_ids), now.toISOString()]
        );
        const conflictRow = inserted.rows[0] ?? (await client.query(
          `SELECT * FROM diagnostic_runtime_event_conflicts
           WHERE installation_id=$1 AND conflict_digest=$2`, [installationId, conflictDigest]
        )).rows[0];
        await client.query("COMMIT");
        committed = true;
        preservedConflict = conflictView(conflictRow);
      } else {
        const receivedAt = now.toISOString();
        if (!trace) {
          trace = (await client.query(
            `INSERT INTO diagnostic_external_activity_traces
              (trace_id,installation_id,workflow_id,revision_id,adapter_id,adapter_version,
               external_execution_id,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [randomUUID(), installationId, envelope.workflow_id, envelope.revision_id,
              envelope.adapter.adapter_id, envelope.adapter.adapter_version,
              envelope.external_execution_id, receivedAt]
          )).rows[0];
        }
        const prior = await client.query(
          `SELECT COALESCE(MAX(event_sequence),-1) AS max_sequence,COUNT(*) AS event_count
           FROM diagnostic_runtime_event_receipts WHERE installation_id=$1 AND trace_id=$2`,
          [installationId, trace.trace_id]
        );
        const outOfOrder = BigInt(envelope.event_sequence) < BigInt(prior.rows[0].max_sequence);
        const eventCount = BigInt(prior.rows[0].event_count);
        const node = (await client.query(
          `SELECT revision,next_sequence FROM diagnostic_nodes
           WHERE installation_id=$1 FOR UPDATE`, [installationId]
        )).rows[0];
        const receiptId = randomUUID();
        const transitionId = randomUUID();
        const diagnosticSequence = String(node.next_sequence);
        const transition = {
          transition_id: transitionId,
          type: "diagnostic.runtime_event.received",
          diagnostic_sequence: diagnosticSequence,
          from_revision: eventCount.toString(),
          to_revision: (eventCount + 1n).toString()
        };
        const receipt = {
          receipt_id: receiptId,
          trace_id: trace.trace_id,
          event_id: envelope.event_id,
          envelope_digest: verified.envelope_digest,
          accepted_at: receivedAt,
          http_acceptance: "event_preserved",
          external_lifecycle_claim: envelope.lifecycle_claim,
          classification: "untrusted_external_observation",
          authority: { ...AUTHORITY },
          transition
        };
        const commandId = `runtime-event:${envelope.event_id}`;
        await client.query(
          `INSERT INTO diagnostic_commands
            (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [installationId, commandId, verified.envelope_digest, "diagnostic.runtime_event.receive",
            "workflow_runtime_adapter", envelope.adapter.adapter_id, receipt, receivedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_transitions
            (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
             from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [transitionId, installationId, diagnosticSequence, "external_activity_trace", trace.trace_id,
            transition.type, transition.from_revision, transition.to_revision, commandId,
            "workflow_runtime_adapter", envelope.adapter.adapter_id,
            { receipt_id: receiptId, event_id: envelope.event_id, envelope_digest: verified.envelope_digest,
              lifecycle_claim: envelope.lifecycle_claim, out_of_order: outOfOrder }, receivedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_outbox
            (outbox_id,installation_id,transition_id,event_type,payload,created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), installationId, transitionId, transition.type,
            { trace_id: trace.trace_id, receipt_id: receiptId, event_id: envelope.event_id }, receivedAt]
        );
        const deliveryDelay = Math.max(0, now.getTime() - Date.parse(envelope.occurred_at));
        await client.query(
          `INSERT INTO diagnostic_runtime_event_receipts
            (receipt_id,installation_id,trace_id,event_id,idempotency_key,event_sequence,lifecycle_claim,
             correlation_id,occurred_at,received_at,delivery_delay_ms,out_of_order,payload_digest,payload_reference,
             envelope,envelope_digest,authentication_key_id,authentication_signed_at,authentication_signature,
             transition_id,receipt)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [receiptId, installationId, trace.trace_id, envelope.event_id, envelope.idempotency_key,
            envelope.event_sequence, envelope.lifecycle_claim, envelope.correlation_id, envelope.occurred_at,
            receivedAt, deliveryDelay, outOfOrder, envelope.payload.digest, envelope.payload.reference,
            envelope, verified.envelope_digest, verified.authentication.key_id, verified.authentication.signed_at,
            verified.authentication.signature, transitionId, receipt]
        );
        await client.query(
          `UPDATE diagnostic_nodes SET revision=revision+1,next_sequence=next_sequence+1,updated_at=$2
           WHERE installation_id=$1`, [installationId, receivedAt]
        );
        await client.query("COMMIT");
        committed = true;
        return { replayed: false, result: receipt };
      }
    } catch (error) {
      if (!committed) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (preservedConflict) {
      throw new KernelError(409, "RUNTIME_EVENT_IDENTITY_CONFLICT",
        "Runtime Event identity conflicts with an accepted immutable claim.", preservedConflict);
    }
    throw new Error("Runtime Event intake ended without an outcome.");
  }

  return { getConflict, getTrace, receiveEvent };
}
