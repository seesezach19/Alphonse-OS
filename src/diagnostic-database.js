import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { KernelError } from "./errors.js";

const { Pool } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createDiagnosticDatabase(connectionString) {
  const pool = new Pool({ connectionString, max: 6 });

  async function executeCommand({ installationId, command, requestDigest, apply }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${installationId}:${command.command_id}`
      ]);
      const replay = await client.query(
        `SELECT request_digest,result FROM diagnostic_commands
         WHERE installation_id=$1 AND command_id=$2`,
        [installationId, command.command_id]
      );
      if (replay.rows[0]) {
        if (replay.rows[0].request_digest !== requestDigest) {
          throw new KernelError(409, "IDEMPOTENCY_CONFLICT", "Diagnostic command ID was reused with different input.", {
            command_id: command.command_id,
            accepted_request_digest: replay.rows[0].request_digest,
            received_request_digest: requestDigest
          });
        }
        await client.query("COMMIT");
        return { replayed: true, result: replay.rows[0].result };
      }

      const nodeResult = await client.query(
        `SELECT revision,next_sequence FROM diagnostic_nodes
         WHERE installation_id=$1 FOR UPDATE`, [installationId]
      );
      if (!nodeResult.rows[0]) {
        throw new KernelError(404, "DIAGNOSTIC_NODE_NOT_FOUND", "Diagnostic Node does not exist.");
      }
      const node = nodeResult.rows[0];
      const acceptedAt = new Date().toISOString();
      const transitionId = randomUUID();
      const outboxId = randomUUID();
      const sequence = String(node.next_sequence);
      const applied = await apply(client, { acceptedAt, sequence });
      const transition = {
        transition_id: transitionId,
        type: applied.transitionType,
        diagnostic_sequence: sequence,
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
        `INSERT INTO diagnostic_commands
          (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [installationId, command.command_id, requestDigest, command.operation_id,
          command.actor.type, command.actor.id, result, acceptedAt]
      );
      await client.query(
        `INSERT INTO diagnostic_transitions
          (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
           from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [transitionId, installationId, sequence, applied.aggregateType, applied.aggregateId,
          applied.transitionType, transition.from_revision, transition.to_revision, command.command_id,
          command.actor.type, command.actor.id, applied.transitionPayload ?? {}, acceptedAt]
      );
      await client.query(
        `INSERT INTO diagnostic_outbox
          (outbox_id,installation_id,transition_id,event_type,payload,created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [outboxId, installationId, transitionId, applied.transitionType,
          { transition_id: transitionId, diagnostic_sequence: sequence }, acceptedAt]
      );
      await client.query(
        `UPDATE diagnostic_nodes SET revision=revision+1,next_sequence=next_sequence+1,updated_at=$2
         WHERE installation_id=$1`, [installationId, acceptedAt]
      );
      await client.query("COMMIT");
      return { replayed: false, result };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    pool,
    executeCommand,
    async close() {
      await pool.end();
    },
    async ping() {
      await pool.query("SELECT 1");
    },
    async migrate() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS diagnostic_schema_migrations (
          version text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const directory = path.join(projectRoot, "diagnostic-migrations");
      const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
      for (const file of files) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended('alphonse-diagnostic-migrations', 0))");
          const existing = await client.query(
            "SELECT version FROM diagnostic_schema_migrations WHERE version=$1", [file]
          );
          if (!existing.rows[0]) {
            await client.query(await readFile(path.join(directory, file), "utf8"));
            await client.query("INSERT INTO diagnostic_schema_migrations (version) VALUES ($1)", [file]);
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    },
    async bootstrapNode(installationId) {
      await pool.query(
        `INSERT INTO diagnostic_nodes (installation_id) VALUES ($1)
         ON CONFLICT (installation_id) DO NOTHING`, [installationId]
      );
    },
    async getNode(installationId) {
      const result = await pool.query(
        `SELECT installation_id,revision,next_sequence,created_at,updated_at
         FROM diagnostic_nodes WHERE installation_id=$1`, [installationId]
      );
      return result.rows[0] ?? null;
    }
  };
}
