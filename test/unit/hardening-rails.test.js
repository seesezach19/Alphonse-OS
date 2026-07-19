import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createRouteContext, ROUTE_CONTEXT_KEYS } from "../../src/route-context.js";
import { diagnosticBrokerContainerUser } from "../../src/diagnostic-runner.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") return [];
      return javascriptFiles(absolute);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [absolute] : [];
  }));
  return files.flat();
}

test("opt-in static checking has an explicit append-only manifest", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "config/typechecked-js.json"), "utf8"));
  assert.equal(manifest.policy, "append-only");
  assert.deepEqual(manifest.files, [...manifest.files].sort());

  const roots = ["src", "verifier", "packages"].map((name) => path.join(root, name));
  const allFiles = (await Promise.all(roots.map(javascriptFiles))).flat();
  const checked = [];
  for (const absolute of allFiles) {
    const source = await readFile(absolute, "utf8");
    if (source.startsWith("// @ts-check")) checked.push(path.relative(root, absolute).replaceAll("\\", "/"));
  }

  assert.deepEqual(checked.sort(), manifest.files);
  for (const relative of manifest.files) {
    const source = await readFile(path.join(root, relative), "utf8");
    assert.ok(source.startsWith("// @ts-check\n"), `${relative} must retain its leading // @ts-check pragma`);
    assert.doesNotMatch(source, /^\s*\/\/\s*@ts-nocheck/m, `${relative} must not opt out of checking`);
  }
});

test("Compose database clients use the same override as their database role", async () => {
  const compose = await readFile(path.join(root, "compose.yaml"), "utf8");
  const required = [
    "POSTGRES_PASSWORD: ${COORDINATOR_DATABASE_PASSWORD:-local-coordinator-only}",
    "COORDINATOR_DATABASE_URL: postgresql://coordinator:${COORDINATOR_DATABASE_PASSWORD:-local-coordinator-only}@coordinator-postgres:5432/alphonse_coordinator",
    "MOCK_CRM_DATABASE_URL: postgresql://alphonse_mock_crm_migrator:${MOCK_CRM_MIGRATION_DATABASE_PASSWORD:-local-mock-crm-migration-only}@postgres:5432/alphonse_mock_crm",
    "MOCK_CRM_DATABASE_URL: postgresql://alphonse_mock_crm:${MOCK_CRM_DATABASE_PASSWORD:-local-mock-crm-only}@postgres:5432/alphonse_mock_crm",
    "CRM_GATEWAY_DATABASE_URL: postgresql://alphonse_crm_gateway:${CRM_GATEWAY_DATABASE_PASSWORD:-local-crm-gateway-only}@postgres:5432/alphonse_mock_crm"
  ];
  for (const fragment of required) assert.ok(compose.includes(fragment), `Missing Compose contract: ${fragment}`);

  assert.doesNotMatch(compose, /COORDINATOR_POSTGRES_POSTGRES_PASSWORD/);
  assert.doesNotMatch(compose, /postgresql:\/\/(?:coordinator|alphonse_mock_crm(?:_migrator)?|alphonse_crm_gateway):local-/);
});

test("route context fails closed when composition wiring omits a dependency", () => {
  const complete = Object.fromEntries(ROUTE_CONTEXT_KEYS.map((key) => [key, null]));
  assert.equal(createRouteContext(complete), complete);

  const incomplete = { ...complete };
  delete incomplete.diagnosticAssignmentService;
  assert.throws(
    () => createRouteContext(incomplete),
    /Route context is missing required values: diagnosticAssignmentService/
  );
});

test("diagnostic broker state follows a non-root runner identity with a safe fallback", () => {
  assert.equal(diagnosticBrokerContainerUser(1001, 121), "1001:121");
  assert.equal(diagnosticBrokerContainerUser(0, 0), "1000:1000");
  assert.equal(diagnosticBrokerContainerUser(Number.NaN, Number.NaN), "1000:1000");
});
