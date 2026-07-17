import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  createEncryptedIngressPayload,
  createMappingReceipt,
  ingressJournalRecordDigest,
  projectIngressJournalHealth,
  validateIngressDelivery
} from "./customer-ingress-contracts.js";
import { KernelError } from "./errors.js";

function iso(value) { return value instanceof Date ? value.toISOString() : value; }
function retryAt(now, delay = 250) { return new Date(new Date(now).getTime() + delay).toISOString(); }

export function createCustomerIngressJournalService(database, {
  sourceBindingId,
  payloadSecret,
  mappingSecret,
  retentionCapacityBytes = 10 * 1024 * 1024
}) {
  const { pool } = database;

  async function acceptDelivery(input, { sourceToken, deliveryToken }, now = new Date()) {
    validateIngressDelivery(input);
    if (!sourceToken?.result_receipt_id || !sourceToken?.equality_token
        || !deliveryToken?.result_receipt_id || !deliveryToken?.equality_token) {
      throw new KernelError(502, "INGRESS_TOKENIZATION_INCOMPLETE", "Exact tokenization proofs are required.");
    }
    const receivedAt = new Date(now).toISOString();
    const encrypted = createEncryptedIngressPayload({
      business_payload: input.payload,
      forwarding_context: { source_delivery_id: input.source_delivery_id }
    }, payloadSecret);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${sourceBindingId}:${sourceToken.equality_token}`
      ]);
      const existing = (await client.query(
        `SELECT * FROM ingress_delivery_attempts
         WHERE source_binding_id=$1 AND delivery_identity_equality_token=$2 FOR UPDATE`,
        [sourceBindingId, deliveryToken.equality_token]
      )).rows[0];
      if (existing) {
        if (existing.payload_digest !== encrypted.payload_digest
            || existing.source_identity_token !== sourceToken.equality_token) {
          throw new KernelError(409, "INGRESS_DELIVERY_IDENTITY_CONFLICT",
            "Delivery identity is already bound to different operation material.");
        }
        await client.query("COMMIT");
        return { replayed: true, delivery: deliveryView(existing) };
      }
      const state = (await client.query(
        "SELECT next_journal_sequence FROM ingress_state WHERE singleton=true FOR UPDATE"
      )).rows[0];
      if (!state) throw new KernelError(503, "INGRESS_JOURNAL_UNINITIALIZED", "Ingress journal is unavailable.");
      const sequence = String(state.next_journal_sequence);
      let mapping = (await client.query(
        `SELECT * FROM ingress_source_mappings
         WHERE source_binding_id=$1 AND source_identity_token=$2`,
        [sourceBindingId, sourceToken.equality_token]
      )).rows[0];
      const logicalOperationId = mapping?.logical_operation_id ?? `op_${randomUUID()}`;
      const deliveryId = randomUUID();
      const journalMaterial = {
        journal_sequence: sequence,
        delivery_id: `delivery_${deliveryId}`,
        logical_operation_id: logicalOperationId,
        source_identity_token: sourceToken.equality_token,
        delivery_identity_equality_token: deliveryToken.equality_token,
        payload_digest: encrypted.payload_digest,
        occurred_at: new Date(input.occurred_at).toISOString(),
        received_at: receivedAt
      };
      const journalRecordDigest = ingressJournalRecordDigest(journalMaterial);
      if (!mapping) {
        const mappingId = randomUUID();
        const mappingReceiptId = randomUUID();
        const receipt = createMappingReceipt({
          mapping_receipt_id: mappingReceiptId,
          source_binding_id: sourceBindingId,
          source_identity_token: sourceToken.equality_token,
          logical_operation_id: logicalOperationId,
          first_journal_sequence: sequence,
          first_journal_record_digest: journalRecordDigest,
          mapping_service_id: "customer-ingress-adapter",
          created_at: receivedAt
        }, mappingSecret);
        mapping = (await client.query(
          `INSERT INTO ingress_source_mappings
            (mapping_id,source_binding_id,source_identity_token,logical_operation_id,mapping_receipt_id,
             first_journal_sequence,first_journal_record_digest,signed_mapping_receipt_bytes,
             mapping_receipt_digest,source_token_result_receipt_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [mappingId, sourceBindingId, sourceToken.equality_token, logicalOperationId, mappingReceiptId,
            sequence, journalRecordDigest, Buffer.from(receipt.signed_receipt_bytes, "utf8"),
            receipt.receipt_digest, sourceToken.result_receipt_id, receivedAt]
        )).rows[0];
      }
      const claims = {
        delivery_id: journalMaterial.delivery_id,
        logical_operation_id: logicalOperationId,
        source_identity_token: sourceToken.equality_token,
        delivery_identity_equality_token: deliveryToken.equality_token,
        correlation_basis: "stable_source_identity_mapping",
        mapping_receipt_id: mapping.mapping_receipt_id,
        mapping_journal_sequence: String(mapping.first_journal_sequence),
        mapping_journal_record_digest: mapping.first_journal_record_digest
      };
      const inserted = (await client.query(
        `INSERT INTO ingress_delivery_attempts
          (delivery_id,journal_sequence,mapping_id,logical_operation_id,source_binding_id,source_identity_token,
           delivery_identity_equality_token,source_token_result_receipt_id,delivery_token_result_receipt_id,
           observation_id,forwarding_id,occurred_at,received_at,payload_digest,payload_algorithm,payload_nonce,
           payload_ciphertext,payload_authentication_tag,payload_plaintext_size,journal_record_digest,
           redacted_claims,forwarding_state,reporting_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'pending','pending')
         RETURNING *`,
        [deliveryId, sequence, mapping.mapping_id, logicalOperationId, sourceBindingId, sourceToken.equality_token,
          deliveryToken.equality_token, sourceToken.result_receipt_id, deliveryToken.result_receipt_id,
          randomUUID(), randomUUID(), input.occurred_at, receivedAt, encrypted.payload_digest, encrypted.algorithm,
          Buffer.from(encrypted.nonce, "base64"), Buffer.from(encrypted.ciphertext, "base64"),
          Buffer.from(encrypted.authentication_tag, "base64"), encrypted.plaintext_size, journalRecordDigest, claims]
      )).rows[0];
      await client.query(
        "UPDATE ingress_state SET next_journal_sequence=next_journal_sequence+1,updated_at=$1 WHERE singleton=true",
        [receivedAt]
      );
      await client.query("COMMIT");
      return { replayed: false, delivery: deliveryView(inserted) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function claim(kind, now = new Date()) {
    const prefix = kind === "forwarding" ? "forwarding" : "reporting";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE ingress_delivery_attempts SET ${prefix}_state='retryable_failed',${prefix}_lease_expires_at=NULL,
           ${prefix}_next_attempt_at=$1 WHERE ${prefix}_state='processing' AND ${prefix}_lease_expires_at <= $1`,
        [new Date(now).toISOString()]
      );
      const row = (await client.query(
        `SELECT * FROM ingress_delivery_attempts
         WHERE ${prefix}_state IN ('pending','retryable_failed')
           AND (${prefix}_next_attempt_at IS NULL OR ${prefix}_next_attempt_at <= $1)
         ORDER BY journal_sequence FOR UPDATE SKIP LOCKED LIMIT 1`, [new Date(now).toISOString()]
      )).rows[0];
      if (!row) { await client.query("COMMIT"); return null; }
      const claimed = (await client.query(
        `UPDATE ingress_delivery_attempts SET ${prefix}_state='processing',
           ${prefix}_attempt_count=${prefix}_attempt_count+1,
           ${prefix}_lease_expires_at=$2 WHERE delivery_id=$1 RETURNING *`,
        [row.delivery_id, new Date(new Date(now).getTime() + 30_000).toISOString()]
      )).rows[0];
      await client.query("COMMIT");
      return claimed;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function recoverLeases(kind, now = new Date()) {
    const prefix = kind === "forwarding" ? "forwarding" : "reporting";
    const result = await pool.query(
      `UPDATE ingress_delivery_attempts SET ${prefix}_state='retryable_failed',
         ${prefix}_lease_expires_at=NULL,${prefix}_next_attempt_at=$1
       WHERE ${prefix}_state='processing'`, [new Date(now).toISOString()]
    );
    return result.rowCount;
  }

  async function completeForward(row, { status, responseDigest }, now = new Date()) {
    const at = new Date(now).toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ingress_forwarding_attempts
          (attempt_id,delivery_id,forwarding_id,attempt_number,outcome,response_status,response_digest,occurred_at)
         VALUES ($1,$2,$3,$4,'succeeded',$5,$6,$7)`,
        [randomUUID(), row.delivery_id, row.forwarding_id, row.forwarding_attempt_count, status, responseDigest, at]
      );
      await client.query(
        `UPDATE ingress_delivery_attempts SET forwarding_state='succeeded',forwarding_lease_expires_at=NULL,
           forwarding_response_status=$2,forwarding_response_digest=$3,forwarded_at=$4,
           payload_algorithm=NULL,payload_nonce=NULL,payload_ciphertext=NULL,payload_authentication_tag=NULL
         WHERE delivery_id=$1`, [row.delivery_id, status, responseDigest, at]
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function fail(kind, row, safeErrorCode, now = new Date()) {
    const prefix = kind === "forwarding" ? "forwarding" : "reporting";
    const table = kind === "forwarding" ? "ingress_forwarding_attempts" : "ingress_reporting_attempts";
    const identityColumns = kind === "forwarding" ? "forwarding_id" : "observation_id";
    const identityValue = kind === "forwarding" ? row.forwarding_id : row.observation_id;
    const at = new Date(now).toISOString();
    const attemptId = randomUUID();
    const sql = kind === "forwarding"
      ? `INSERT INTO ${table} (attempt_id,delivery_id,${identityColumns},attempt_number,outcome,safe_error_code,occurred_at)
         VALUES ($1,$2,$3,$4,'retryable_failed',$5,$6)`
      : `INSERT INTO ${table} (attempt_id,delivery_id,${identityColumns},attempt_number,outcome,safe_error_code,occurred_at)
         VALUES ($1,$2,$3,$4,'retryable_failed',$5,$6)`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql, [attemptId, row.delivery_id, identityValue, row[`${prefix}_attempt_count`], safeErrorCode, at]);
      await client.query(
        `UPDATE ingress_delivery_attempts SET ${prefix}_state='retryable_failed',${prefix}_lease_expires_at=NULL,
           ${prefix}_next_attempt_at=$2 WHERE delivery_id=$1`, [row.delivery_id, retryAt(now)]
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function completeReport(row, { status, receiptId, receiptDigest, replayed }, now = new Date()) {
    const at = new Date(now).toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ingress_reporting_attempts
          (attempt_id,delivery_id,observation_id,attempt_number,outcome,response_status,replayed,occurred_at)
         VALUES ($1,$2,$3,$4,'reported',$5,$6,$7)`,
        [randomUUID(), row.delivery_id, row.observation_id, row.reporting_attempt_count, status, replayed, at]
      );
      await client.query(
        `UPDATE ingress_delivery_attempts SET reporting_state='reported',reporting_lease_expires_at=NULL,
           observation_receipt_id=$2,observation_receipt_digest=$3,observation_replayed=$4,reported_at=$5
         WHERE delivery_id=$1`, [row.delivery_id, receiptId, receiptDigest, replayed, at]
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async function consumeTestFault(faultId) {
    const inserted = await pool.query(
      `INSERT INTO ingress_test_faults (fault_id,consumed_at) VALUES ($1,now())
       ON CONFLICT (fault_id) DO NOTHING RETURNING fault_id`, [faultId]
    );
    return Boolean(inserted.rows[0]);
  }

  async function getStatus() {
    const summary = (await pool.query(`SELECT
      (SELECT COUNT(*) FROM ingress_source_mappings)::bigint AS mapping_count,
      COUNT(*)::bigint AS delivery_count,
      COUNT(DISTINCT logical_operation_id)::bigint AS logical_operation_count,
      COUNT(*) FILTER (WHERE forwarding_state='succeeded')::bigint AS forwarded_count,
      COUNT(*) FILTER (WHERE reporting_state='reported')::bigint AS reported_count,
      COUNT(*) FILTER (WHERE reporting_state!='reported')::bigint AS unreported_count,
      MIN(received_at) FILTER (WHERE reporting_state!='reported') AS oldest_unreported_at,
      COALESCE(SUM(octet_length(payload_ciphertext)),0)::bigint AS encrypted_payload_bytes,
      COALESCE(SUM(forwarding_attempt_count-1) FILTER (WHERE forwarding_attempt_count > 1),0)::bigint AS forward_retry_count,
      COALESCE(SUM(reporting_attempt_count-1) FILTER (WHERE reporting_attempt_count > 1),0)::bigint AS report_retry_count,
      COALESCE(MAX(journal_sequence) FILTER (WHERE reporting_state='reported'),0)::bigint AS last_accepted_sequence,
      COUNT(*) FILTER (WHERE payload_ciphertext IS NOT NULL)::bigint AS raw_payload_retained_count,
      COUNT(*) FILTER (WHERE observation_replayed)::bigint AS observation_replay_count,
      (SELECT COUNT(*) FROM ingress_durable_loss_markers)::bigint AS durable_loss_marker_count
      FROM ingress_delivery_attempts`)).rows[0];
    const deliveries = (await pool.query(
      `SELECT delivery_id,journal_sequence,logical_operation_id,source_identity_token,
        delivery_identity_equality_token,source_token_result_receipt_id,delivery_token_result_receipt_id,
        observation_id,forwarding_id,journal_record_digest,
        redacted_claims,forwarding_state,forwarding_attempt_count,forwarding_response_status,
        reporting_state,reporting_attempt_count,observation_receipt_id,observation_receipt_digest,
        observation_replayed,payload_ciphertext IS NOT NULL AS raw_payload_retained
       FROM ingress_delivery_attempts ORDER BY journal_sequence`
    )).rows.map(deliveryView);
    return {
      mapping_count: Number(summary.mapping_count),
      delivery_count: Number(summary.delivery_count),
      logical_operation_count: Number(summary.logical_operation_count),
      forwarded_count: Number(summary.forwarded_count),
      reported_count: Number(summary.reported_count),
      raw_payload_retained_count: Number(summary.raw_payload_retained_count),
      observation_replay_count: Number(summary.observation_replay_count),
      journal_health: projectIngressJournalHealth({ ...summary, retention_capacity_bytes: retentionCapacityBytes }),
      deliveries
    };
  }

  async function recordLossMarker({ first_sequence, last_sequence, reason_code }) {
    const detailDigest = sha256Digest({ first_sequence, last_sequence, reason_code });
    const marker = (await pool.query(
      `INSERT INTO ingress_durable_loss_markers
        (loss_marker_id,first_journal_sequence,last_journal_sequence,reason_code,detail_digest,created_at)
       VALUES ($1,$2,$3,$4,$5,now()) RETURNING *`,
      [randomUUID(), first_sequence, last_sequence, reason_code, detailDigest]
    )).rows[0];
    return marker;
  }

  function deliveryView(row) {
    return {
      delivery_id: `delivery_${row.delivery_id}`,
      journal_sequence: String(row.journal_sequence),
      logical_operation_id: row.logical_operation_id,
      source_identity_token: row.source_identity_token,
      delivery_identity_equality_token: row.delivery_identity_equality_token,
      observation_id: row.observation_id,
      forwarding_id: row.forwarding_id,
      journal_record_digest: row.journal_record_digest,
      redacted_claims: row.redacted_claims,
      forwarding_state: row.forwarding_state,
      forwarding_attempt_count: row.forwarding_attempt_count,
      forwarding_response_status: row.forwarding_response_status,
      reporting_state: row.reporting_state,
      reporting_attempt_count: row.reporting_attempt_count,
      observation_receipt_id: row.observation_receipt_id,
      observation_receipt_digest: row.observation_receipt_digest,
      observation_replayed: row.observation_replayed,
      raw_payload_retained: row.raw_payload_retained ?? Boolean(row.payload_ciphertext),
      occurred_at: iso(row.occurred_at),
      received_at: iso(row.received_at),
      source_token_result_receipt_id: row.source_token_result_receipt_id,
      delivery_token_result_receipt_id: row.delivery_token_result_receipt_id,
      payload: row.payload_ciphertext ? {
        algorithm: row.payload_algorithm,
        nonce: Buffer.from(row.payload_nonce).toString("base64"),
        ciphertext: Buffer.from(row.payload_ciphertext).toString("base64"),
        authentication_tag: Buffer.from(row.payload_authentication_tag).toString("base64"),
        payload_digest: row.payload_digest,
        plaintext_size: Number(row.payload_plaintext_size)
      } : null
    };
  }

  return {
    acceptDelivery,
    claimForwarding: (now) => claim("forwarding", now),
    claimReporting: (now) => claim("reporting", now),
    recoverForwardingLeases: (now) => recoverLeases("forwarding", now),
    recoverReportingLeases: (now) => recoverLeases("reporting", now),
    completeForward,
    failForward: (row, code, now) => fail("forwarding", row, code, now),
    completeReport,
    failReport: (row, code, now) => fail("reporting", row, code, now),
    consumeTestFault,
    getStatus,
    recordLossMarker
  };
}
