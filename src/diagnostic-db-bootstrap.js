import pg from "pg";

const { Client } = pg;
const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL;
const diagnosticDatabase = process.env.DIAGNOSTIC_DATABASE_NAME ?? "alphonse_diagnostic";
const diagnosticRole = process.env.DIAGNOSTIC_DATABASE_ROLE ?? "alphonse_diagnostic";
const diagnosticPassword = process.env.DIAGNOSTIC_DATABASE_PASSWORD;
const kernelDatabase = process.env.KERNEL_DATABASE_NAME ?? "alphonse_kernel";
const tokenizationRole = process.env.TOKENIZATION_DATABASE_ROLE ?? "alphonse_tokenization";
const tokenizationPassword = process.env.TOKENIZATION_DATABASE_PASSWORD;

if (!adminDatabaseUrl || !diagnosticPassword || !tokenizationPassword) {
  throw new Error("ADMIN_DATABASE_URL, DIAGNOSTIC_DATABASE_PASSWORD, and TOKENIZATION_DATABASE_PASSWORD are required.");
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
const tokenizationRoleIdentifier = identifier(tokenizationRole, "TOKENIZATION_DATABASE_ROLE");
let client;

async function connectWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const candidate = new Client({ connectionString: adminDatabaseUrl });
    try {
      await candidate.connect();
      return candidate;
    } catch (error) {
      lastError = error;
      await candidate.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

try {
  client = await connectWithRetry();
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [diagnosticRole]);
  if (!role.rows[0]) {
    await client.query(`CREATE ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(diagnosticPassword)}`);
  } else {
    await client.query(`ALTER ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(diagnosticPassword)}`);
  }
  const tokenRole = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [tokenizationRole]);
  if (!tokenRole.rows[0]) {
    await client.query(`CREATE ROLE ${tokenizationRoleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(tokenizationPassword)}`);
  } else {
    await client.query(`ALTER ROLE ${tokenizationRoleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(tokenizationPassword)}`);
  }

  const database = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [diagnosticDatabase]);
  if (!database.rows[0]) {
    await client.query(`CREATE DATABASE ${diagnosticDatabaseIdentifier} OWNER ${roleIdentifier}`);
  } else {
    await client.query(`ALTER DATABASE ${diagnosticDatabaseIdentifier} OWNER TO ${roleIdentifier}`);
  }

  await client.query(`REVOKE CONNECT ON DATABASE ${diagnosticDatabaseIdentifier} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${diagnosticDatabaseIdentifier} TO ${roleIdentifier}, ${tokenizationRoleIdentifier}, ${adminIdentifier}`);
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
  if (client) await client.end();
}
