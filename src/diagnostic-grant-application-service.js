import { randomUUID } from "node:crypto";

import { KernelError } from "./errors.js";
import {
  createSignedGrantApplicationReceipt,
  validateGrantSnapshotTransition,
  verifySignedGrantActivationSnapshot
} from "./grant-authority-contracts.js";

export function createDiagnosticGrantApplicationService(database, installationId, options) {
  const serviceId = options?.serviceId ?? "diagnostic-plane";
  const authorityKey = options?.authorityKey;
  const applicationKey = options?.applicationKey;
  if (!authorityKey?.keyId || !authorityKey?.secret || !applicationKey?.keyId || !applicationKey?.secret) {
    throw new KernelError(500, "GRANT_APPLICATION_CONFIG_INVALID", "Grant authority verification and application signing keys are required.");
  }

  async function preserveConflict(snapshot, reason, acceptedDigest = null) {
    await database.pool.query(
      `INSERT INTO diagnostic_grant_application_conflicts
       (conflict_id,installation_id,snapshot_id,claimed_snapshot_digest,accepted_snapshot_digest,reason,received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), installationId, snapshot.document.snapshot_id, snapshot.digest, acceptedDigest,
        reason, new Date().toISOString()]
    );
  }

  async function applySnapshot(snapshotBytes) {
    const snapshot = verifySignedGrantActivationSnapshot(snapshotBytes, {
      ...authorityKey, now: new Date().toISOString()
    });
    if (snapshot.document.installation_id !== installationId
        || snapshot.document.receiver_service_id !== serviceId) {
      throw new KernelError(403, "GRANT_SNAPSHOT_SCOPE_MISMATCH", "Grant snapshot is outside this receiver scope.");
    }
    const command = {
      command_id: snapshot.document.snapshot_id,
      operation_id: "diagnostic.grant_activation_snapshot.apply",
      actor: { type: "service", id: serviceId,
        authorization: { mode: "signed_one_way_authority_feed", snapshot_digest: snapshot.digest } }
    };
    try {
      return await database.executeCommand({
        installationId, command, requestDigest: snapshot.digest,
        apply: async (client, { acceptedAt, sequence }) => {
          const stateResult = await client.query(
            `SELECT authority_sequence,snapshot_digest,effective_state
             FROM diagnostic_grant_effective_states
             WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3 FOR UPDATE`,
            [installationId, snapshot.document.environment_id, snapshot.document.grant_id]
          );
          const current = stateResult.rows[0] ? {
            authority_sequence: String(stateResult.rows[0].authority_sequence),
            snapshot_digest: stateResult.rows[0].snapshot_digest,
            effective_state: stateResult.rows[0].effective_state
          } : null;
          validateGrantSnapshotTransition(current, snapshot.document);

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
            service_transaction_position: sequence,
            applied_at: acceptedAt
          }, { keyId: applicationKey.keyId, secret: applicationKey.secret, signedAt: acceptedAt });

          await client.query(
            `INSERT INTO diagnostic_grant_activation_snapshots
             (snapshot_id,installation_id,environment_id,grant_id,grant_type,receiver_service_id,grant_document,
              grant_digest,authority_sequence,predecessor_snapshot_digest,target_state,signed_snapshot_bytes,
              snapshot_digest,authority_key_id,received_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [snapshot.document.snapshot_id, installationId, snapshot.document.environment_id,
              snapshot.document.grant_id, snapshot.document.grant_type, serviceId,
              snapshot.document.grant_document, snapshot.document.grant_digest,
              snapshot.document.authority_sequence, snapshot.document.predecessor_snapshot_digest,
              snapshot.document.target_state, Buffer.from(snapshot.bytes, "utf8"), snapshot.digest,
              snapshot.authentication.key_id, acceptedAt]
          );
          await client.query(
            `INSERT INTO diagnostic_grant_application_receipts
             (application_receipt_id,installation_id,environment_id,grant_id,snapshot_id,snapshot_digest,
              authority_sequence,applied_state,service_transaction_id,service_transaction_position,
              signed_receipt_bytes,receipt_digest,service_key_id,applied_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [applicationReceiptId, installationId, snapshot.document.environment_id,
              snapshot.document.grant_id, snapshot.document.snapshot_id, snapshot.digest,
              snapshot.document.authority_sequence, snapshot.document.target_state, serviceTransactionId,
              sequence, Buffer.from(receipt.bytes, "utf8"), receipt.digest,
              applicationKey.keyId, acceptedAt]
          );
          await client.query(
            `INSERT INTO diagnostic_grant_effective_states
             (installation_id,environment_id,grant_id,grant_type,receiver_service_id,grant_document,grant_digest,
              effective_state,authority_sequence,snapshot_id,snapshot_digest,application_receipt_id,applied_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (installation_id,environment_id,grant_id) DO UPDATE
             SET grant_type=EXCLUDED.grant_type,receiver_service_id=EXCLUDED.receiver_service_id,
                 grant_document=EXCLUDED.grant_document,grant_digest=EXCLUDED.grant_digest,
                 effective_state=EXCLUDED.effective_state,authority_sequence=EXCLUDED.authority_sequence,
                 snapshot_id=EXCLUDED.snapshot_id,snapshot_digest=EXCLUDED.snapshot_digest,
                 application_receipt_id=EXCLUDED.application_receipt_id,applied_at=EXCLUDED.applied_at`,
            [installationId, snapshot.document.environment_id, snapshot.document.grant_id,
              snapshot.document.grant_type, serviceId, snapshot.document.grant_document,
              snapshot.document.grant_digest, snapshot.document.target_state,
              snapshot.document.authority_sequence, snapshot.document.snapshot_id, snapshot.digest,
              applicationReceiptId, acceptedAt]
          );
          return {
            aggregateType: "grant_authority_projection", aggregateId: snapshot.document.grant_id,
            transitionType: `diagnostic.grant_authority.${snapshot.document.target_state}_applied`,
            transitionPayload: { grant_id: snapshot.document.grant_id,
              snapshot_digest: snapshot.digest, authority_sequence: snapshot.document.authority_sequence,
              service_transaction_id: serviceTransactionId },
            result: { grant_application_receipt: { application_receipt_id: applicationReceiptId,
              grant_id: snapshot.document.grant_id, snapshot_id: snapshot.document.snapshot_id,
              snapshot_digest: snapshot.digest, receipt_digest: receipt.digest,
              signed_receipt_bytes: receipt.bytes, applied_state: snapshot.document.target_state,
              service_transaction_id: serviceTransactionId, service_transaction_position: sequence,
              applied_at: acceptedAt, exact_bytes_preserved: true, immutable: true },
              effective_state: snapshot.document.target_state }
          };
        }
      });
    } catch (error) {
      if (error.code === "IDEMPOTENCY_CONFLICT") {
        const accepted = await database.pool.query(
          `SELECT snapshot_digest FROM diagnostic_grant_activation_snapshots
           WHERE installation_id=$1 AND snapshot_id=$2`,
          [installationId, snapshot.document.snapshot_id]
        );
        await preserveConflict(snapshot, "snapshot_identity_reuse", accepted.rows[0]?.snapshot_digest ?? null);
      }
      throw error;
    }
  }

  async function getEffectiveState(environmentId, grantId) {
    const result = await database.pool.query(
      `SELECT * FROM diagnostic_grant_effective_states
       WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3`,
      [installationId, environmentId, grantId]
    );
    if (!result.rows[0]) throw new KernelError(404, "DIAGNOSTIC_GRANT_STATE_NOT_FOUND", "Applied grant state does not exist.");
    const row = result.rows[0];
    return { ...row, authority_sequence: String(row.authority_sequence),
      reporting_authorized: row.effective_state === "active" };
  }

  return { applySnapshot, getEffectiveState };
}
