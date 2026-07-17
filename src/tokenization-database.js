import pg from "pg";

const { Pool } = pg;

export function createTokenizationDatabase(connectionString) {
  const pool = new Pool({ connectionString, max: 4 });
  return {
    pool,
    async close() { await pool.end(); },
    async ping() { await pool.query("SELECT 1"); },
    async bootstrap(installationId) {
      await pool.query(
        `INSERT INTO tokenization_service_sequences (installation_id,next_position,updated_at)
         VALUES ($1,1,now()) ON CONFLICT (installation_id) DO NOTHING`, [installationId]
      );
    }
  };
}
