import pg from "pg";

const { Client } = pg;
const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL;
const databaseName = process.env.INGRESS_DATABASE_NAME ?? "alphonse_ingress";
const roleName = process.env.INGRESS_DATABASE_ROLE ?? "alphonse_ingress";
const password = process.env.INGRESS_DATABASE_PASSWORD;

if (!adminDatabaseUrl || !password) throw new Error("Ingress database bootstrap configuration is incomplete.");

function identifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error("Unsafe PostgreSQL identifier.");
  return `"${value}"`;
}
function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }

const client = new Client({ connectionString: adminDatabaseUrl });
await client.connect();
try {
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [roleName]);
  if (role.rows[0]) {
    await client.query(`ALTER ROLE ${identifier(roleName)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(password)}`);
  } else {
    await client.query(`CREATE ROLE ${identifier(roleName)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(password)}`);
  }
  const database = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [databaseName]);
  if (!database.rows[0]) await client.query(`CREATE DATABASE ${identifier(databaseName)} OWNER ${identifier(roleName)}`);
  else await client.query(`ALTER DATABASE ${identifier(databaseName)} OWNER TO ${identifier(roleName)}`);
  await client.query(`REVOKE CONNECT ON DATABASE ${identifier(databaseName)} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${identifier(databaseName)} TO ${identifier(roleName)}`);
} finally {
  await client.end();
}
