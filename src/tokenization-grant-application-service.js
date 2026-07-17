import { randomUUID } from "node:crypto";

import { KernelError } from "./errors.js";
import {
  createSignedGrantApplicationReceipt,
  validateGrantSnapshotTransition,
  verifySignedGrantActivationSnapshot
} from "./grant-authority-contracts.js";

export function createTokenizationGrantApplicationService(database, installationId, {
  authorityKey, applicationKey, serviceId = "tokenization-service"
}) {
  if (!authorityKey?.keyId || !authorityKey?.secret || !applicationKey?.keyId || !applicationKey?.secret) {
    throw new KernelError(500, "GRANT_APPLICATION_CONFIG_INVALID",
      "Tokenization grant verification and application signing keys are required.");
  }
  const { pool } = database;

  async function applySnapshot(snapshotBytes) {
    const snapshot = verifySignedGrantActivationSnapshot(snapshotBytes, {
      ...authorityKey, now: new Date().toISOString()
    });
    if (snapshot.document.installation_id !== installationId
        || snapshot.document.receiver_service_id !== serviceId
        || snapshot.document.grant_type !== "tokenization_use") {
      throw new KernelError(403, "GRANT_SNAPSHOT_SCOPE_MISMATCH",
        "Grant snapshot is outside this Tokenization Service scope.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `tokenization-grant:${installationId}:${snapshot.document.grant_id}`
      ]);
      const existingSnapshot = (await client.query(
        `SELECT * FROM tokenization_grant_activation_snapshots
         WHERE installation_id=$1 AND snapshot_id=$2`, [installationId, snapshot.document.snapshot_id]
      )).rows[0];
      if (existingSnapshot) {
        if (existingSnapshot.snapshot_digest !== snapshot.digest) {
          const conflictId = randomUUID();
          await client.query(
            `INSERT INTO tokenization_grant_application_conflicts
              (conflict_id,installation_id,snapshot_id,claimed_snapshot_digest,accepted_snapshot_digest,
               reason,received_at)
             VALUES ($1,$2,$3,$4,$5,'snapshot_identity_reuse',$6)`,
            [conflictId, installationId, snapshot.document.snapshot_id, snapshot.digest,
              existingSnapshot.snapshot_digest, new Date().toISOString()]
          );
          await client.query("COMMIT");
          throw new KernelError(409, "GRANT_SNAPSHOT_IDENTITY_CONFLICT",
            "Grant snapshot identity is already bound to different material.", { conflict_id: conflictId });
        }
        const receipt = (await client.query(
          `SELECT * FROM tokenization_grant_application_receipts
           WHERE installation_id=$1 AND snapshot_id=$2`, [installationId, snapshot.document.snapshot_id]
        )).rows[0];
        await client.query("COMMIT");
        return { replayed: true, result: { grant_application_receipt: view(receipt),
          effective_state: receipt.applied_state } };
      }
      const currentRow = (await client.query(
        `SELECT authority_sequence,snapshot_digest,effective_state
         FROM tokenization_grant_effective_states
         WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3 FOR UPDATE`,
        [installationId, snapshot.document.environment_id, snapshot.document.grant_id]
      )).rows[0];
      const current = currentRow ? { authority_sequence: String(currentRow.authority_sequence),
        snapshot_digest: currentRow.snapshot_digest, effective_state: currentRow.effective_state } : null;
      validateGrantSnapshotTransition(current, snapshot.document);
      const sequenceRow = (await client.query(
        `SELECT next_position FROM tokenization_service_sequences WHERE installation_id=$1 FOR UPDATE`,
        [installationId]
      )).rows[0];
      if (!sequenceRow) throw new KernelError(503, "TOKENIZATION_SEQUENCE_UNAVAILABLE",
        "Tokenization Service is not initialized.");
      const servicePosition = String(sequenceRow.next_position);
      const appliedAt = new Date().toISOString();
      const applicationReceiptId = randomUUID();
      const serviceTransactionId = randomUUID();
      const receipt = createSignedGrantApplicationReceipt({
        application_receipt_id: applicationReceiptId,
        service_id: serviceId,
        installation_id: installationId,
        environment_id: snapshot.document.environment_id,
        grant_id: snapshot.document.grant_id,
        snapshot_id: snapshot.document.snapshot_id,
        snapshot_digest: snapshot.digest,
        authority_sequence: snapshot.document.authority_sequence,
        predecessor_snapshot_digest: snapshot.document.predecessor_snapshot_digest,
        applied_state: snapshot.document.target_state,
        service_transaction_id: serviceTransactionId,
        service_transaction_position: servicePosition,
        applied_at: appliedAt
      }, { keyId: applicationKey.keyId, secret: applicationKey.secret, signedAt: appliedAt });
      await client.query(
        `INSERT INTO tokenization_grant_activation_snapshots
          (snapshot_id,installation_id,environment_id,grant_id,grant_type,receiver_service_id,grant_document,
           grant_digest,authority_sequence,predecessor_snapshot_digest,target_state,signed_snapshot_bytes,
           snapshot_digest,authority_key_id,received_at)
         VALUES ($1,$2,$3,$4,'tokenization_use',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [snapshot.document.snapshot_id, installationId, snapshot.document.environment_id,
          snapshot.document.grant_id, serviceId, snapshot.document.grant_document,
          snapshot.document.grant_digest, snapshot.document.authority_sequence,
          snapshot.document.predecessor_snapshot_digest, snapshot.document.target_state,
          Buffer.from(snapshot.bytes, "utf8"), snapshot.digest, snapshot.authentication.key_id, appliedAt]
      );
      await client.query(
        `INSERT INTO tokenization_grant_application_receipts
          (application_receipt_id,installation_id,environment_id,grant_id,snapshot_id,snapshot_digest,
           authority_sequence,applied_state,service_transaction_id,service_transaction_position,
           signed_receipt_bytes,receipt_digest,service_key_id,applied_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [applicationReceiptId, installationId, snapshot.document.environment_id, snapshot.document.grant_id,
          snapshot.document.snapshot_id, snapshot.digest, snapshot.document.authority_sequence,
          snapshot.document.target_state, serviceTransactionId, servicePosition,
          Buffer.from(receipt.bytes, "utf8"), receipt.digest, applicationKey.keyId, appliedAt]
      );
      await client.query(
        `INSERT INTO tokenization_grant_effective_states
          (installation_id,environment_id,grant_id,grant_type,receiver_service_id,grant_document,grant_digest,effective_state,
           authority_sequence,snapshot_id,snapshot_digest,application_receipt_id,applied_at)
         VALUES ($1,$2,$3,'tokenization_use',$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (installation_id,environment_id,grant_id) DO UPDATE SET
           grant_type=EXCLUDED.grant_type,receiver_service_id=EXCLUDED.receiver_service_id,
           grant_document=EXCLUDED.grant_document,grant_digest=EXCLUDED.grant_digest,
           effective_state=EXCLUDED.effective_state,authority_sequence=EXCLUDED.authority_sequence,
           snapshot_id=EXCLUDED.snapshot_id,snapshot_digest=EXCLUDED.snapshot_digest,
           application_receipt_id=EXCLUDED.application_receipt_id,applied_at=EXCLUDED.applied_at`,
        [installationId, snapshot.document.environment_id, snapshot.document.grant_id, serviceId,
          snapshot.document.grant_document, snapshot.document.grant_digest, snapshot.document.target_state,
          snapshot.document.authority_sequence, snapshot.document.snapshot_id, snapshot.digest,
          applicationReceiptId, appliedAt]
      );
      await client.query(
        `UPDATE tokenization_service_sequences SET next_position=next_position+1,updated_at=$2
         WHERE installation_id=$1`, [installationId, appliedAt]
      );
      await client.query("COMMIT");
      return { replayed: false, result: { grant_application_receipt: {
        application_receipt_id: applicationReceiptId,
        grant_id: snapshot.document.grant_id,
        snapshot_id: snapshot.document.snapshot_id,
        snapshot_digest: snapshot.digest,
        receipt_digest: receipt.digest,
        signed_receipt_bytes: receipt.bytes,
        applied_state: snapshot.document.target_state,
        service_transaction_id: serviceTransactionId,
        service_transaction_position: servicePosition,
        applied_at: appliedAt,
        exact_bytes_preserved: true,
        immutable: true
      }, effective_state: snapshot.document.target_state } };
    } catch (error) {
      if (error.code !== "GRANT_SNAPSHOT_IDENTITY_CONFLICT") await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  function view(row) {
    return {
      application_receipt_id: row.application_receipt_id,
      grant_id: row.grant_id,
      snapshot_id: row.snapshot_id,
      snapshot_digest: row.snapshot_digest,
      receipt_digest: row.receipt_digest,
      signed_receipt_bytes: Buffer.from(row.signed_receipt_bytes).toString("utf8"),
      applied_state: row.applied_state,
      service_transaction_id: row.service_transaction_id,
      service_transaction_position: String(row.service_transaction_position),
      applied_at: row.applied_at,
      exact_bytes_preserved: true,
      immutable: true
    };
  }

  return { applySnapshot };
}
