import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import {
  createSignedGrantActivationSnapshot,
  validateGrantApplicationReceipt,
  verifySignedGrantActivationSnapshot,
  verifySignedGrantApplicationReceipt
} from "./grant-authority-contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function required(value, label, pattern = null) {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    throw new KernelError(400, "INVALID_INPUT", `${label} is invalid.`);
  }
  return value;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_INPUT", `${label} must be an object.`);
  }
  return value;
}

function commandDigest(command) {
  return sha256Digest(command);
}

export function createGrantAuthorityService(database, installationId, environmentId, options) {
  const { pool, executeCommand } = database;
  const snapshotKeyId = required(options?.snapshotKeyId, "snapshotKeyId", IDENTIFIER);
  const snapshotSecret = required(options?.snapshotSecret, "snapshotSecret");
  const applicationKeys = object(options?.applicationKeys, "applicationKeys");
  const snapshotTtlSeconds = options?.snapshotTtlSeconds ?? 600;
  if (!Number.isInteger(snapshotTtlSeconds) || snapshotTtlSeconds < 30 || snapshotTtlSeconds > 86_400) {
    throw new KernelError(500, "GRANT_AUTHORITY_CONFIG_INVALID", "Snapshot TTL is invalid.");
  }

  async function registerGrant(envelope, actor) {
    const command = { ...envelope, actor };
    const input = object(envelope.input, "input");
    const grantId = required(input.grant_id, "input.grant_id", UUID);
    const grantType = required(input.grant_type, "input.grant_type", /^(observation_reporting|tokenization_use)$/);
    const receiverServiceId = required(input.receiver_service_id, "input.receiver_service_id", IDENTIFIER);
    const grantDocument = object(input.grant_document, "input.grant_document");
    const grantDigest = sha256Digest(grantDocument);

    return executeCommand({
      installationId, environmentId, command, requestDigest: commandDigest(command),
      apply: async (client, { acceptedAt }) => {
        await client.query(
          `INSERT INTO kernel_authority_grants
           (grant_id,installation_id,environment_id,grant_type,receiver_service_id,grant_document,grant_digest,
            registered_by_actor_id,registered_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [grantId, installationId, environmentId, grantType, receiverServiceId, grantDocument, grantDigest,
            actor.id, acceptedAt]
        );
        await client.query(
          `INSERT INTO kernel_authority_grant_states
           (installation_id,environment_id,grant_id,desired_state,effective_state,updated_at)
           VALUES ($1,$2,$3,'inactive','inactive',$4)`,
          [installationId, environmentId, grantId, acceptedAt]
        );
        return {
          aggregateType: "authority_grant", aggregateId: grantId,
          transitionType: "kernel.authority_grant.registered_inactive",
          transitionPayload: { grant_id: grantId, grant_type: grantType, receiver_service_id: receiverServiceId,
            grant_digest: grantDigest },
          result: { grant: { grant_id: grantId, grant_type: grantType, receiver_service_id: receiverServiceId,
            grant_digest: grantDigest, desired_state: "inactive", effective_state: "inactive",
            authority_granted: false, registered_at: acceptedAt, immutable: true } }
        };
      }
    });
  }

  async function recordReadiness(envelope, actor) {
    const command = { ...envelope, actor };
    const input = object(envelope.input, "input");
    const grantId = required(input.grant_id, "input.grant_id", UUID);
    const receiptId = required(input.readiness_receipt_id, "input.readiness_receipt_id", UUID);
    const readinessReceipt = object(input.readiness_receipt, "input.readiness_receipt");
    const readinessStatus = required(input.readiness_status, "input.readiness_status", /^(ready|failed)$/);
    const readinessDigest = sha256Digest(readinessReceipt);

    return executeCommand({
      installationId, environmentId, command, requestDigest: commandDigest(command),
      apply: async (client, { acceptedAt }) => {
        const state = await client.query(
          `SELECT desired_state FROM kernel_authority_grant_states
           WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3 FOR UPDATE`,
          [installationId, environmentId, grantId]
        );
        if (!state.rows[0]) throw new KernelError(404, "AUTHORITY_GRANT_NOT_FOUND", "Authority Grant does not exist.");
        if (state.rows[0].desired_state !== "inactive") {
          throw new KernelError(409, "GRANT_READINESS_STATE_INVALID", "Readiness can be recorded only before desired state publication.");
        }
        await client.query(
          `INSERT INTO kernel_authority_grant_readiness_receipts
           (readiness_receipt_id,installation_id,environment_id,grant_id,readiness_receipt,
            readiness_receipt_digest,readiness_status,recorded_by_actor_id,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [receiptId, installationId, environmentId, grantId, readinessReceipt, readinessDigest,
            readinessStatus, actor.id, acceptedAt]
        );
        await client.query(
          `UPDATE kernel_authority_grant_states SET latest_readiness_receipt_id=$4,revision=revision+1,updated_at=$5
           WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3`,
          [installationId, environmentId, grantId, receiptId, acceptedAt]
        );
        return {
          aggregateType: "authority_grant", aggregateId: grantId,
          transitionType: `kernel.authority_grant.readiness_${readinessStatus}`,
          transitionPayload: { grant_id: grantId, readiness_receipt_id: receiptId,
            readiness_receipt_digest: readinessDigest },
          result: { readiness_receipt: { readiness_receipt_id: receiptId, grant_id: grantId,
            readiness_receipt_digest: readinessDigest, readiness_status: readinessStatus,
            recorded_at: acceptedAt, immutable: true }, desired_state_published: false,
            authority_granted: false }
        };
      }
    });
  }

  async function publishSnapshot(envelope, actor) {
    const command = { ...envelope, actor };
    const input = object(envelope.input, "input");
    const grantId = required(input.grant_id, "input.grant_id", UUID);
    const targetState = required(input.target_state, "input.target_state", /^(active|revoked)$/);

    return executeCommand({
      installationId, environmentId, command, requestDigest: commandDigest(command),
      apply: async (client, { acceptedAt }) => {
        const query = await client.query(
          `SELECT g.grant_type,g.receiver_service_id,g.grant_document,g.grant_digest,s.*,
                  r.readiness_receipt_digest,r.readiness_status
           FROM kernel_authority_grants g
           JOIN kernel_authority_grant_states s ON s.grant_id=g.grant_id
             AND s.installation_id=g.installation_id AND s.environment_id=g.environment_id
           LEFT JOIN kernel_authority_grant_readiness_receipts r
             ON r.readiness_receipt_id=s.latest_readiness_receipt_id
           WHERE g.installation_id=$1 AND g.environment_id=$2 AND g.grant_id=$3 FOR UPDATE OF s`,
          [installationId, environmentId, grantId]
        );
        const state = query.rows[0];
        if (!state) throw new KernelError(404, "AUTHORITY_GRANT_NOT_FOUND", "Authority Grant does not exist.");
        if (["activation_pending", "revocation_pending"].includes(state.desired_state)) {
          throw new KernelError(409, "GRANT_APPLICATION_PENDING", "Prior desired grant state has not been durably applied.");
        }
        if (targetState === "active") {
          if (state.readiness_status !== "ready") {
            throw new KernelError(409, "GRANT_READINESS_REQUIRED", "A successful exact readiness receipt is required before activation publication.");
          }
          if (state.effective_state === "active_effective") {
            throw new KernelError(409, "GRANT_ALREADY_ACTIVE", "Grant is already effectively active.");
          }
        } else if (state.effective_state !== "active_effective") {
          throw new KernelError(409, "GRANT_NOT_ACTIVE", "Only an effectively active grant can enter revocation pending.");
        }

        const authoritySequence = (BigInt(state.latest_authority_sequence) + 1n).toString();
        const snapshotId = randomUUID();
        const expiresAt = new Date(Date.parse(acceptedAt) + snapshotTtlSeconds * 1000).toISOString();
        const snapshot = createSignedGrantActivationSnapshot({
          snapshot_id: snapshotId,
          grant_id: grantId,
          grant_type: state.grant_type,
          installation_id: installationId,
          environment_id: environmentId,
          receiver_service_id: state.receiver_service_id,
          grant_document: state.grant_document,
          authority_sequence: authoritySequence,
          predecessor_snapshot_digest: state.latest_snapshot_digest,
          target_state: targetState,
          grant_digest: state.grant_digest,
          readiness_receipt_digest: state.readiness_receipt_digest,
          issued_at: acceptedAt,
          expires_at: expiresAt
        }, { keyId: snapshotKeyId, secret: snapshotSecret, signedAt: acceptedAt });
        const pendingState = targetState === "active" ? "activation_pending" : "revocation_pending";
        await client.query(
          `INSERT INTO kernel_authority_grant_snapshots
           (snapshot_id,installation_id,environment_id,grant_id,grant_type,receiver_service_id,grant_document,
            grant_digest,authority_sequence,predecessor_snapshot_digest,target_state,signed_snapshot_bytes,
            snapshot_digest,signing_key_id,
            issued_at,expires_at,published_by_actor_id,published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [snapshotId, installationId, environmentId, grantId, state.grant_type, state.receiver_service_id,
            state.grant_document, state.grant_digest, authoritySequence, state.latest_snapshot_digest, targetState,
            Buffer.from(snapshot.bytes, "utf8"), snapshot.digest, snapshotKeyId,
            acceptedAt, expiresAt, actor.id, acceptedAt]
        );
        await client.query(
          `UPDATE kernel_authority_grant_states
           SET desired_state=$4,latest_snapshot_id=$5,latest_snapshot_digest=$6,latest_authority_sequence=$7,
               revision=revision+1,updated_at=$8
           WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3`,
          [installationId, environmentId, grantId, pendingState, snapshotId, snapshot.digest,
            authoritySequence, acceptedAt]
        );
        return {
          aggregateType: "authority_grant", aggregateId: grantId,
          transitionType: `kernel.authority_grant.${pendingState}`,
          transitionPayload: { grant_id: grantId, snapshot_id: snapshotId, snapshot_digest: snapshot.digest,
            authority_sequence: authoritySequence, target_state: targetState },
          result: { grant_activation_snapshot: { snapshot_id: snapshotId, grant_id: grantId,
            authority_sequence: authoritySequence, predecessor_snapshot_digest: state.latest_snapshot_digest,
            target_state: targetState, snapshot_digest: snapshot.digest, signed_snapshot_bytes: snapshot.bytes,
            expires_at: expiresAt, immutable: true }, desired_state: pendingState,
            effective_state: state.effective_state, authority_granted: state.effective_state === "active_effective" }
        };
      }
    });
  }

  async function acceptApplicationReceipt(receiptBytes, actor) {
    let parsed;
    try {
      parsed = JSON.parse(receiptBytes);
    } catch {
      throw new KernelError(400, "GRANT_PROTOCOL_INVALID", "Application receipt must be valid JSON.");
    }
    const serviceId = parsed?.document?.service_id;
    const key = Object.hasOwn(applicationKeys, serviceId) ? applicationKeys[serviceId] : null;
    if (!key) throw new KernelError(403, "GRANT_APPLICATION_SERVICE_UNTRUSTED", "Application receipt service is not registered.");
    const receipt = verifySignedGrantApplicationReceipt(receiptBytes, key);
    const command = {
      command_id: receipt.document.application_receipt_id,
      operation_id: "kernel.grant_application_receipt.accept",
      input: { receipt_digest: receipt.digest },
      actor
    };
    try {
      return await executeCommand({
        installationId, environmentId, command, requestDigest: commandDigest(command),
        apply: async (client, { acceptedAt }) => {
          const snapshotResult = await client.query(
            `SELECT s.*,g.receiver_service_id,gs.desired_state,gs.effective_state,gs.latest_snapshot_id
             FROM kernel_authority_grant_snapshots s
             JOIN kernel_authority_grants g ON g.grant_id=s.grant_id
             JOIN kernel_authority_grant_states gs ON gs.grant_id=s.grant_id
               AND gs.installation_id=s.installation_id AND gs.environment_id=s.environment_id
             WHERE s.installation_id=$1 AND s.environment_id=$2 AND s.snapshot_id=$3 FOR UPDATE OF gs`,
            [installationId, environmentId, receipt.document.snapshot_id]
          );
          const snapshotRow = snapshotResult.rows[0];
          if (!snapshotRow) throw new KernelError(404, "GRANT_SNAPSHOT_NOT_FOUND", "Grant activation snapshot does not exist.");
          const signedSnapshotBytes = snapshotRow.signed_snapshot_bytes.toString("utf8");
          const snapshot = verifySignedGrantActivationSnapshot(signedSnapshotBytes, {
            keyId: snapshotKeyId, secret: snapshotSecret
          });
          if (snapshot.digest !== snapshotRow.snapshot_digest
              || snapshotRow.snapshot_id !== receipt.document.snapshot_id
              || snapshotRow.snapshot_digest !== receipt.document.snapshot_digest) {
            throw new KernelError(409, "GRANT_APPLICATION_BINDING_MISMATCH", "Application receipt does not bind a preserved snapshot.");
          }
          const effective = validateGrantApplicationReceipt(snapshot, receipt, {
            receiverServiceId: snapshotRow.receiver_service_id
          });
          const requiredPending = receipt.document.applied_state === "active"
            ? "activation_pending" : "revocation_pending";
          if (snapshotRow.desired_state !== requiredPending
              || snapshotRow.snapshot_id !== snapshotRow.latest_snapshot_id) {
            throw new KernelError(409, "GRANT_APPLICATION_STALE", "Application receipt is not for current pending desired state.");
          }
          await client.query(
            `INSERT INTO kernel_authority_grant_application_receipts
             (application_receipt_id,installation_id,environment_id,grant_id,snapshot_id,snapshot_digest,
              receiver_service_id,authority_sequence,target_state,service_transaction_id,
              service_transaction_position,signed_receipt_bytes,receipt_digest,verification_key_id,applied_at,verified_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [receipt.document.application_receipt_id, installationId, environmentId, receipt.document.grant_id,
              receipt.document.snapshot_id, receipt.document.snapshot_digest, receipt.document.service_id,
              receipt.document.authority_sequence, receipt.document.applied_state,
              receipt.document.service_transaction_id, receipt.document.service_transaction_position,
              Buffer.from(receipt.bytes, "utf8"), receipt.digest, receipt.authentication.key_id,
              receipt.document.applied_at, acceptedAt]
          );
          const desiredState = receipt.document.applied_state === "active" ? "active" : "revoked";
          await client.query(
            `UPDATE kernel_authority_grant_states
             SET desired_state=$4,effective_state=$5,effective_snapshot_id=$6,effective_application_receipt_id=$7,
                 effective_at=$8,revision=revision+1,updated_at=$9
             WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3`,
            [installationId, environmentId, receipt.document.grant_id, desiredState, effective.effective_state,
              receipt.document.snapshot_id, receipt.document.application_receipt_id,
              effective.effective_at, acceptedAt]
          );
          return {
            aggregateType: "authority_grant", aggregateId: receipt.document.grant_id,
            transitionType: `kernel.authority_grant.${effective.effective_state}`,
            transitionPayload: { grant_id: receipt.document.grant_id,
              snapshot_id: receipt.document.snapshot_id, snapshot_digest: receipt.document.snapshot_digest,
              application_receipt_id: receipt.document.application_receipt_id,
              receipt_digest: receipt.digest, service_transaction_id: receipt.document.service_transaction_id,
              service_transaction_position: receipt.document.service_transaction_position },
            result: { grant_application_receipt: { application_receipt_id: receipt.document.application_receipt_id,
              grant_id: receipt.document.grant_id, snapshot_digest: receipt.document.snapshot_digest,
              receipt_digest: receipt.digest, effective_state: effective.effective_state,
              effective_at: effective.effective_at, exact_bytes_preserved: true, immutable: true },
              authority_granted: effective.effective_state === "active_effective" }
          };
        }
      });
    } catch (error) {
      if (error.code === "IDEMPOTENCY_CONFLICT") {
        const accepted = await pool.query(
          `SELECT receipt_digest FROM kernel_authority_grant_application_receipts
           WHERE installation_id=$1 AND environment_id=$2 AND application_receipt_id=$3`,
          [installationId, environmentId, receipt.document.application_receipt_id]
        );
        await pool.query(
          `INSERT INTO kernel_authority_grant_application_conflicts
           (conflict_id,installation_id,environment_id,application_receipt_id,claimed_receipt_digest,
            accepted_receipt_digest,reason,received_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), installationId, environmentId, receipt.document.application_receipt_id,
            receipt.digest, accepted.rows[0]?.receipt_digest ?? null, "application_receipt_identity_reuse",
            new Date().toISOString()]
        );
      }
      throw error;
    }
  }

  async function getGrantState(grantId) {
    required(grantId, "grant_id", UUID);
    const result = await pool.query(
      `SELECT g.grant_id,g.grant_type,g.receiver_service_id,g.grant_digest,s.desired_state,s.effective_state,
              s.latest_readiness_receipt_id,s.latest_snapshot_id,s.latest_snapshot_digest,
              s.latest_authority_sequence,s.effective_snapshot_id,s.effective_application_receipt_id,
              s.effective_at,s.revision,s.updated_at
       FROM kernel_authority_grants g JOIN kernel_authority_grant_states s ON s.grant_id=g.grant_id
       WHERE g.installation_id=$1 AND g.environment_id=$2 AND g.grant_id=$3`,
      [installationId, environmentId, grantId]
    );
    if (!result.rows[0]) throw new KernelError(404, "AUTHORITY_GRANT_NOT_FOUND", "Authority Grant does not exist.");
    const row = result.rows[0];
    return { ...row, latest_authority_sequence: String(row.latest_authority_sequence),
      revision: String(row.revision), authority_granted: row.effective_state === "active_effective" };
  }

  async function assertSealEligible(grantIds) {
    if (!Array.isArray(grantIds) || grantIds.length === 0) {
      throw new KernelError(400, "INVALID_INPUT", "At least one required grant is needed for sealing.");
    }
    const states = await Promise.all(grantIds.map(getGrantState));
    const blocked = states.filter((state) => state.effective_state !== "active_effective"
      || !state.effective_application_receipt_id);
    if (blocked.length > 0) {
      throw new KernelError(409, "GRANT_APPLICATION_REQUIRED", "Every required grant needs a verified durable application receipt before sealing.", {
        blocked_grant_ids: blocked.map((state) => state.grant_id)
      });
    }
    return { eligible: true, grant_applications_verified: true,
      grants: states.map((state) => ({ grant_id: state.grant_id,
        snapshot_digest: state.latest_snapshot_digest,
        application_receipt_id: state.effective_application_receipt_id })) };
  }

  return { registerGrant, recordReadiness, publishSnapshot, acceptApplicationReceipt,
    getGrantState, assertSealEligible };
}
