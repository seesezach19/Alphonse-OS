import pg from "pg";

const { Client } = pg;
const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error("ADMIN_DATABASE_URL is required.");
const roles = [
  ["alphonse_mock_crm", process.env.MOCK_CRM_DATABASE_PASSWORD],
  ["alphonse_crm_gateway", process.env.CRM_GATEWAY_DATABASE_PASSWORD]
];
if (roles.some(([, password]) => !password)) throw new Error("Mock CRM database passwords are required.");
const databaseName = "alphonse_mock_crm";
const identifier = (value) => `"${value}"`;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const client = new Client({ connectionString: adminUrl });
await client.connect();
try {
  for (const [role, password] of roles) {
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
    if (exists.rows[0]) await client.query(`ALTER ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(password)}`);
    else await client.query(`CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(password)}`);
  }
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [databaseName]);
  if (!exists.rows[0]) await client.query(`CREATE DATABASE ${identifier(databaseName)} OWNER ${identifier("alphonse_mock_crm")}`);
  await client.query(`REVOKE CONNECT ON DATABASE ${identifier(databaseName)} FROM PUBLIC`);
  for (const [role] of roles) await client.query(`GRANT CONNECT ON DATABASE ${identifier(databaseName)} TO ${identifier(role)}`);
} finally { await client.end(); }
