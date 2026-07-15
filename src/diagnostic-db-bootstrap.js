import pg from "pg";

const { Client } = pg;
const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL;
const diagnosticDatabase = process.env.DIAGNOSTIC_DATABASE_NAME ?? "alphonse_diagnostic";
const diagnosticRole = process.env.DIAGNOSTIC_DATABASE_ROLE ?? "alphonse_diagnostic";
const diagnosticPassword = process.env.DIAGNOSTIC_DATABASE_PASSWORD;
const kernelDatabase = process.env.KERNEL_DATABASE_NAME ?? "alphonse_kernel";

if (!adminDatabaseUrl || !diagnosticPassword) {
  throw new Error("ADMIN_DATABASE_URL and DIAGNOSTIC_DATABASE_PASSWORD are required.");
}

function identifier(value, name) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error(`${name} is not a safe PostgreSQL identifier.`);
  return `"${value}"`;
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const roleIdentifier = identifier(diagnosticRole, "DIAGNOSTIC_DATABASE_ROLE");
const diagnosticDatabaseIdentifier = identifier(diagnosticDatabase, "DIAGNOSTIC_DATABASE_NAME");
const kernelDatabaseIdentifier = identifier(kernelDatabase, "KERNEL_DATABASE_NAME");
const adminUser = new URL(adminDatabaseUrl).username;
const adminIdentifier = identifier(adminUser, "ADMIN_DATABASE_URL username");
const client = new Client({ connectionString: adminDatabaseUrl });

try {
  await client.connect();
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [diagnosticRole]);
  if (!role.rows[0]) {
    await client.query(`CREATE ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(diagnosticPassword)}`);
  } else {
    await client.query(`ALTER ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(diagnosticPassword)}`);
  }

  const database = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [diagnosticDatabase]);
  if (!database.rows[0]) {
    await client.query(`CREATE DATABASE ${diagnosticDatabaseIdentifier} OWNER ${roleIdentifier}`);
  } else {
    await client.query(`ALTER DATABASE ${diagnosticDatabaseIdentifier} OWNER TO ${roleIdentifier}`);
  }

  await client.query(`REVOKE CONNECT ON DATABASE ${diagnosticDatabaseIdentifier} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${diagnosticDatabaseIdentifier} TO ${roleIdentifier}, ${adminIdentifier}`);
  await client.query(`REVOKE CONNECT ON DATABASE ${kernelDatabaseIdentifier} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${kernelDatabaseIdentifier} TO ${adminIdentifier}`);
  for (const registryRole of ["alphonse_registry_primary", "alphonse_registry_mirror"]) {
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [registryRole]);
    if (exists.rows[0]) {
      await client.query(`GRANT CONNECT ON DATABASE ${kernelDatabaseIdentifier} TO ${identifier(registryRole, "registry role")}`);
    }
  }
  console.log(`Diagnostic database ${diagnosticDatabase} is ready for least-privilege role ${diagnosticRole}.`);
} finally {
  await client.end();
}
