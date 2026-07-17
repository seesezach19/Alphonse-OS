import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.MOCK_CRM_DATABASE_URL });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS mock_crm_schema_migrations (
    migration_id text PRIMARY KEY,
    applied_at timestamptz NOT NULL
  )`);
  const directory = new URL("../crm-migrations/", import.meta.url);
  for (const migrationId of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mock-crm-migrations',0))");
      const applied = await client.query(
        "SELECT 1 FROM mock_crm_schema_migrations WHERE migration_id=$1", [migrationId]
      );
      if (!applied.rows[0]) {
        await client.query(await readFile(new URL(migrationId, directory), "utf8"));
        await client.query(
          "INSERT INTO mock_crm_schema_migrations (migration_id,applied_at) VALUES ($1,now())", [migrationId]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally { await client.end(); }
