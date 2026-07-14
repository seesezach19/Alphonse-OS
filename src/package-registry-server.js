import http from "node:http";
import pg from "pg";

import { createPackageRegistryService, RegistryError } from "./package-registry-service.js";
import { PortableTrustError } from "./portable-trust.js";
import { RegistryAccessError, verifyRegistryAccessGrant } from "./registry-access-grant.js";

const port = Number(process.env.REGISTRY_PORT ?? 3500);
const databaseUrl = process.env.DATABASE_URL;
const registryId = process.env.REGISTRY_ID;
const registryPrivateKey = process.env.REGISTRY_PRIVATE_KEY;
const accessGrantSecret = process.env.REGISTRY_ACCESS_GRANT_SECRET;
const trustedSourceRegistries = JSON.parse(process.env.REGISTRY_TRUSTED_SOURCE_REGISTRIES ?? "{}");
const advisorySnapshotTtlSeconds = Number(process.env.ADVISORY_SNAPSHOT_TTL_SECONDS ?? 3600);

if (!databaseUrl || !registryId || !registryPrivateKey || !accessGrantSecret) {
  throw new Error("DATABASE_URL, REGISTRY_ID, REGISTRY_PRIVATE_KEY, and REGISTRY_ACCESS_GRANT_SECRET are required.");
}

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const registry = createPackageRegistryService(pool, registryId, registryPrivateKey, {
  trustedSourceRegistries,
  advisorySnapshotTtlSeconds
});

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

async function readJson(request, limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new RegistryError(413, "REQUEST_TOO_LARGE", "Registry request exceeds 4 MiB.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RegistryError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/healthz") {
    await pool.query("SELECT 1 FROM registry_publications WHERE registry_id=$1 LIMIT 1", [registryId]);
    return sendJson(response, 200, {
      status: "healthy",
      registry_id: registry.registryId,
      registry_key_id: registry.registryKeyId,
      registry_public_key: registry.registryPublicKey,
      deployment_authority: false
    });
  }
  function authorize(action, packageId) {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Registry ") ? authorization.slice("Registry ".length) : null;
    return verifyRegistryAccessGrant(token, accessGrantSecret, { registryId, action, packageId });
  }
  if (request.method === "POST" && url.pathname === "/registry/v0/publications") {
    const release = await readJson(request);
    authorize("publish", release?.manifest?.package_id ?? "");
    const result = await registry.publish(release);
    return sendJson(response, result.replayed ? 200 : 201, result.publication,
      { "idempotent-replayed": result.replayed ? "true" : "false" });
  }
  if (request.method === "GET" && url.pathname === "/registry/v0/packages") {
    const packageId = url.searchParams.get("package_id");
    if (!packageId) throw new RegistryError(400, "PACKAGE_ID_REQUIRED", "Scoped discovery requires package_id.");
    authorize("discover", packageId);
    return sendJson(response, 200, { packages: await registry.discover(packageId) });
  }
  if (request.method === "GET" && url.pathname === "/registry/v0/bundles") {
    const packageId = url.searchParams.get("package_id");
    const semanticVersion = url.searchParams.get("semantic_version");
    if (!packageId || !semanticVersion) {
      throw new RegistryError(400, "PACKAGE_COORDINATES_REQUIRED", "package_id and semantic_version are required.");
    }
    authorize("download", packageId);
    const bundle = await registry.exportBundle(packageId, semanticVersion);
    for (const node of [bundle.root, ...bundle.dependencies]) {
      authorize("download", node.release.manifest.package_id);
    }
    return sendJson(response, 200, bundle);
  }
  if (request.method === "POST" && url.pathname === "/registry/v0/mirrors") {
    const bundle = await readJson(request);
    for (const node of [bundle?.root, ...(bundle?.dependencies ?? [])]) {
      authorize("mirror", node?.release?.manifest?.package_id ?? "");
    }
    return sendJson(response, 201, await registry.mirrorBundle(bundle));
  }
  if (request.method === "POST" && url.pathname === "/registry/v0/advisories") {
    const advisory = await readJson(request);
    authorize("advise", advisory?.document?.package_id ?? "");
    const result = await registry.recordAdvisory(advisory);
    return sendJson(response, result.replayed ? 200 : 201, result,
      { "idempotent-replayed": result.replayed ? "true" : "false" });
  }
  throw new RegistryError(404, "ROUTE_NOT_FOUND", "Registry route does not exist.");
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    if (error instanceof RegistryError) {
      return sendJson(response, error.status, { error: { code: error.code, message: error.message,
        details: error.details } });
    }
    if (error instanceof PortableTrustError) {
      return sendJson(response, 422, { error: { code: error.code, message: error.message,
        details: error.details } });
    }
    if (error instanceof RegistryAccessError) {
      return sendJson(response, error.status, { error: { code: error.code, message: error.message } });
    }
    console.error(error);
    return sendJson(response, 500, { error: { code: "INTERNAL_ERROR", message: "Unexpected registry failure." } });
  });
});

server.listen(port, "0.0.0.0", () => console.log(`${registryId} listening on ${port}`));

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
