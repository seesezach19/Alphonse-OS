import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

export function createCustomerIngressDatabase(connectionString) {
  const pool = new Pool({ connectionString, max: 8 });
  return {
    pool,
    async ping() { await pool.query("SELECT 1"); },
    async close() { await pool.end(); },
    async migrate(root = process.cwd()) {
      await pool.query(`CREATE TABLE IF NOT EXISTS ingress_migrations (
        migration_id text PRIMARY KEY, applied_at timestamptz NOT NULL
      )`);
      const migrationId = "001_customer_ingress_journal.sql";
      const existing = await pool.query("SELECT 1 FROM ingress_migrations WHERE migration_id=$1", [migrationId]);
      if (existing.rows[0]) return;
      const sql = await readFile(path.join(root, "ingress-migrations", migrationId), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO ingress_migrations (migration_id,applied_at) VALUES ($1,now())", [migrationId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }
  };
}
