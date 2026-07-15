import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { createCommandExecutor } from "./command-executor.js";
import { KernelError } from "./errors.js";

const { Pool } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createDatabase(connectionString) {
  const pool = new Pool({ connectionString, max: 10 });
  const executeCommand = createCommandExecutor(pool);

  return {
    pool,
    async close() {
      await pool.end();
    },
    async ping() {
      await pool.query("SELECT 1");
    },
    async migrate() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS kernel_schema_migrations (
          version text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      const migrationDir = path.join(projectRoot, "migrations");
      const files = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();

      for (const file of files) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended('alphonse-kernel-migrations', 0))");
          const existing = await client.query(
            "SELECT version FROM kernel_schema_migrations WHERE version = $1",
            [file]
          );
          if (existing.rowCount === 0) {
            await client.query(await readFile(path.join(migrationDir, file), "utf8"));
            await client.query("INSERT INTO kernel_schema_migrations (version) VALUES ($1)", [file]);
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
    async bootstrapEnvironment(installationId, installationName, environmentId, displayName,
      environmentClass = "development") {
      await pool.query(
        `INSERT INTO kernel_installations (installation_id, display_name)
         VALUES ($1, $2)
         ON CONFLICT (installation_id) DO NOTHING`,
        [installationId, installationName]
      );
      await pool.query(
        `INSERT INTO kernel_environments (installation_id, environment_id, display_name, environment_class)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (installation_id, environment_id) DO NOTHING`,
        [installationId, environmentId, displayName, environmentClass]
      );
      const bound = await pool.query(
        `SELECT environment_class FROM kernel_environments
         WHERE installation_id=$1 AND environment_id=$2`, [installationId, environmentId]
      );
      if (bound.rows[0].environment_class !== environmentClass) {
        throw new Error(`Kernel Environment is already bound to ${bound.rows[0].environment_class}.`);
      }
    },
    async getEnvironment(installationId, environmentId) {
      const result = await pool.query(
        `SELECT installation_id, environment_id, display_name, environment_class, revision, execution_epoch,
                operational_state, restore_generation,
                created_at, updated_at
         FROM kernel_environments WHERE installation_id = $1 AND environment_id = $2`,
        [installationId, environmentId]
      );
      return result.rows[0] ?? null;
    },
    async executeEnvironmentProfileUpdate(installationId, environmentId, command, requestDigest) {
      return executeCommand({
        installationId,
        environmentId,
        command,
        requestDigest,
        apply: async (client, { acceptedAt, environment }) => {
          const expectedRevision = BigInt(command.input.expected_revision);
          const currentRevision = BigInt(environment.revision);
          if (expectedRevision !== currentRevision) {
            throw new KernelError(409, "REVISION_CONFLICT", "Environment revision changed before command admission.", {
              expected_revision: expectedRevision.toString(),
              current_revision: currentRevision.toString()
            });
          }
          const nextRevision = currentRevision + 1n;
          await client.query(
            `UPDATE kernel_environments SET display_name = $3, revision = $4, updated_at = $5
             WHERE installation_id = $1 AND environment_id = $2`,
            [installationId, environmentId, command.input.display_name, nextRevision.toString(), acceptedAt]
          );
          return {
            aggregateType: "kernel_environment",
            aggregateId: environmentId,
            transitionType: "kernel.environment.profile.updated",
            fromRevision: currentRevision,
            toRevision: nextRevision,
            transitionPayload: { display_name: command.input.display_name },
            result: {
              environment: {
                installation_id: installationId,
                environment_id: environmentId,
                display_name: command.input.display_name,
                revision: nextRevision.toString()
              }
            }
          };
        }
      });
    },
    executeCommand,
    async getCommandReceipt(installationId, environmentId, commandId) {
      const result = await pool.query(
        `SELECT c.command_id, c.request_digest, c.operation_id, c.actor_type, c.actor_id,
                c.result, c.accepted_at,
                t.transition_id, t.transition_type, t.environment_sequence,
                t.from_revision, t.to_revision,
                o.outbox_id, o.event_type, o.created_at AS outbox_created_at, o.published_at
         FROM kernel_commands c
         JOIN kernel_transitions t
           ON t.installation_id = c.installation_id
          AND t.environment_id = c.environment_id
          AND t.command_id = c.command_id
         JOIN kernel_outbox o
           ON o.installation_id = t.installation_id
          AND o.environment_id = t.environment_id
          AND o.transition_id = t.transition_id
         WHERE c.installation_id = $1 AND c.environment_id = $2 AND c.command_id = $3`,
        [installationId, environmentId, commandId]
      );

      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return {
        command_id: row.command_id,
        request_digest: row.request_digest,
        operation_id: row.operation_id,
        actor: { type: row.actor_type, id: row.actor_id },
        accepted_at: row.accepted_at,
        result: row.result,
        transition: {
          transition_id: row.transition_id,
          type: row.transition_type,
          environment_sequence: row.environment_sequence,
          from_revision: row.from_revision,
          to_revision: row.to_revision
        },
        outbox: {
          outbox_id: row.outbox_id,
          event_type: row.event_type,
          created_at: row.outbox_created_at,
          published_at: row.published_at,
          delivery_status: row.published_at ? "published" : "pending"
        }
      };
    }
  };
}
