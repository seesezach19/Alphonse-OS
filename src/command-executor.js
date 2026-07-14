import { randomUUID } from "node:crypto";

import { KernelError } from "./errors.js";

export function createCommandExecutor(pool) {
  return async function executeCommand({ installationId, environmentId, command, requestDigest, apply }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${installationId}:${environmentId}:${command.command_id}`
      ]);

      const replay = await client.query(
        `SELECT request_digest, result FROM kernel_commands
         WHERE installation_id = $1 AND environment_id = $2 AND command_id = $3`,
        [installationId, environmentId, command.command_id]
      );
      if (replay.rowCount > 0) {
        const accepted = replay.rows[0];
        if (accepted.request_digest !== requestDigest) {
          throw new KernelError(409, "IDEMPOTENCY_CONFLICT", "Command ID was already used with different input.", {
            command_id: command.command_id,
            accepted_request_digest: accepted.request_digest,
            received_request_digest: requestDigest
          });
        }
        await client.query("COMMIT");
        return { replayed: true, result: accepted.result };
      }

      const environmentResult = await client.query(
        `SELECT installation_id, environment_id, display_name, revision, next_sequence
         FROM kernel_environments
         WHERE installation_id = $1 AND environment_id = $2
         FOR UPDATE`,
        [installationId, environmentId]
      );
      if (environmentResult.rowCount === 0) {
        throw new KernelError(404, "ENVIRONMENT_NOT_FOUND", "Kernel Environment does not exist.");
      }

      const environment = environmentResult.rows[0];
      const sequence = BigInt(environment.next_sequence).toString();
      const transitionId = randomUUID();
      const outboxId = randomUUID();
      const acceptedAt = new Date().toISOString();
      const applied = await apply(client, { acceptedAt, environment, sequence, transitionId });
      const transition = {
        transition_id: transitionId,
        type: applied.transitionType,
        environment_sequence: sequence,
        from_revision: String(applied.fromRevision ?? 0),
        to_revision: String(applied.toRevision ?? 1)
      };
      const result = {
        command_id: command.command_id,
        request_digest: requestDigest,
        accepted_at: acceptedAt,
        operation_id: command.operation_id,
        ...applied.result,
        transition
      };

      await client.query(
        `UPDATE kernel_environments SET next_sequence = next_sequence + 1
         WHERE installation_id = $1 AND environment_id = $2`,
        [installationId, environmentId]
      );
      await client.query(
        `INSERT INTO kernel_commands
          (installation_id, environment_id, command_id, request_digest, operation_id, actor_type, actor_id, result, accepted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [installationId, environmentId, command.command_id, requestDigest, command.operation_id,
          command.actor.type, command.actor.id, result, acceptedAt]
      );
      await client.query(
        `INSERT INTO kernel_transitions
          (transition_id, installation_id, environment_id, environment_sequence, aggregate_type, aggregate_id,
           transition_type, from_revision, to_revision, command_id, actor_type, actor_id, payload, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [transitionId, installationId, environmentId, sequence, applied.aggregateType, applied.aggregateId,
          applied.transitionType, transition.from_revision, transition.to_revision, command.command_id,
          command.actor.type, command.actor.id, applied.transitionPayload ?? {}, acceptedAt]
      );
      await client.query(
        `INSERT INTO kernel_outbox
          (outbox_id, installation_id, environment_id, transition_id, event_type, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [outboxId, installationId, environmentId, transitionId, applied.transitionType,
          { transition_id: transitionId, environment_sequence: sequence }, acceptedAt]
      );

      await client.query("COMMIT");
      return { replayed: false, result };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}
