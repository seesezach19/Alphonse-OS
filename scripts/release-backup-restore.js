import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createEncryptedNodeBackup, openEncryptedNodeBackup } from "../src/backup-bundle.js";

const root = process.cwd();
const [mode, suppliedPath] = process.argv.slice(2);
if (!new Set(["create", "restore", "verify"]).has(mode) || !suppliedPath) {
  throw new Error("Usage: node backup-restore.js create|restore|verify <bundle-path>");
}
const bundlePath = path.resolve(suppliedPath);
const envPath = path.join(root, ".env.release");
const values = Object.fromEntries((await readFile(envPath, "utf8")).trim().split(/\r?\n/).map((line) => {
  const separator = line.indexOf("=");
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
const key = values.KERNEL_BACKUP_KEY;
const keyId = values.KERNEL_BACKUP_KEY_ID;
const environmentId = values.KERNEL_ENVIRONMENT_ID;
const project = process.env.ALPHONSE_COMPOSE_PROJECT ?? "alphonse-v0-2";
if (!key || !keyId || !environmentId) throw new Error("Release backup identity is missing from .env.release.");

function run(args, options = {}) {
  const result = spawnSync("docker", ["compose", "--project-name", project, "--env-file", envPath,
    "-f", path.join(root, "compose.yaml"), ...args], {
    cwd: root, input: options.input, encoding: options.binary ? null : "utf8",
    maxBuffer: 1024 * 1024 * 1024, windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(Buffer.from(result.stderr ?? "").toString("utf8"));
  return options.binary ? Buffer.from(result.stdout) : String(result.stdout).trim();
}

function dump(database) {
  return run(["exec", "-T", "postgres", "pg_dump", "-U", "alphonse", "-d", database, "-Fc"],
    { binary: true });
}

function volumeArchive(service, directory) {
  return run(["run", "--rm", "--no-deps", "-T", "--entrypoint", "tar", service,
    "-C", directory, "-cf", "-", "."], { binary: true });
}

function restoreVolume(service, directory, bytes) {
  run(["run", "--rm", "--no-deps", "-T", "--entrypoint", "sh", service, "-c",
    `find '${directory}' -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +`]);
  run(["run", "--rm", "--no-deps", "-T", "--entrypoint", "tar", service,
    "-C", directory, "-xf", "-"], { binary: true, input: bytes });
}

function restoreDatabase(database, bytes) {
  run(["exec", "-T", "postgres", "pg_restore", "-U", "alphonse", "-d", database,
    "--clean", "--if-exists"], { binary: true, input: bytes });
}

if (mode === "verify") {
  const opened = openEncryptedNodeBackup(JSON.parse(await readFile(bundlePath, "utf8")), key);
  console.log(JSON.stringify({ verified: true, manifest: opened.manifest }));
} else if (mode === "create") {
  const started = Date.now();
  run(["stop", "edge", "console", "n8n", "kernel", "n8n-runtime-adapter"]);
  try {
    run(["up", "-d", "--wait", "postgres"]);
    const state = JSON.parse(run(["exec", "-T", "postgres", "psql", "-U", "alphonse", "-d",
      "alphonse_kernel", "-Atc", `select json_build_object('sequence',next_sequence-1,'epoch',execution_epoch) from kernel_environments where environment_id='${environmentId}'`]));
    const artifacts = JSON.parse(run(["exec", "-T", "postgres", "psql", "-U", "alphonse", "-d",
      "alphonse_diagnostic", "-Atc", "select coalesce(json_agg(json_build_object('digest',artifact_digest,'size_bytes',size_bytes) order by artifact_digest),'[]'::json) from diagnostic_artifacts"]));
    const bundle = createEncryptedNodeBackup({
      backupId: randomUUID(), environmentId, restorePointSequence: state.sequence, executionEpoch: state.epoch,
      databaseDumps: [
        { name: "kernel", bytes: dump("alphonse_kernel") },
        { name: "diagnostic", bytes: dump("alphonse_diagnostic") }
      ],
      storeArchives: [
        { name: "diagnostic_artifacts", bytes: volumeArchive("kernel", "/var/lib/alphonse-diagnostics") },
        { name: "n8n_adapter_state", bytes: volumeArchive("n8n-runtime-adapter", "/var/lib/alphonse-n8n-adapter") },
        { name: "n8n_customer_state", bytes: volumeArchive("n8n", "/home/node/.n8n") }
      ], artifacts, key, keyId
    });
    await mkdir(path.dirname(bundlePath), { recursive: true });
    await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ backup: bundlePath, manifest: bundle.manifest,
      duration_seconds: Math.ceil((Date.now() - started) / 1000), authority_fenced_during_snapshot: true }));
  } finally {
    try {
      run(["up", "-d", "--wait"]);
    } catch (error) {
      const logs = run(["logs", "--no-color", "n8n"]);
      throw new Error(`${error.message}\nn8n backup-restart logs:\n${logs}`);
    }
  }
} else {
  const started = Date.now();
  const opened = openEncryptedNodeBackup(JSON.parse(await readFile(bundlePath, "utf8")), key);
  if (opened.manifest.environment_id !== environmentId) throw new Error("Backup Environment does not match this release.");
  const databases = Object.fromEntries(opened.databaseDumps.map((item) => [item.name, item.bytes]));
  const stores = Object.fromEntries(opened.storeArchives.map((item) => [item.name, item.bytes]));
  run(["stop", "edge", "console", "n8n", "kernel", "n8n-runtime-adapter"]);
  run(["up", "-d", "--wait", "postgres"]);
  restoreDatabase("alphonse_kernel", databases.kernel);
  restoreDatabase("alphonse_diagnostic", databases.diagnostic);
  restoreVolume("kernel", "/var/lib/alphonse-diagnostics", stores.diagnostic_artifacts);
  restoreVolume("n8n-runtime-adapter", "/var/lib/alphonse-n8n-adapter", stores.n8n_adapter_state);
  restoreVolume("n8n", "/home/node/.n8n", stores.n8n_customer_state);
  const fence = run(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "alphonse", "-d",
    "alphonse_kernel", "-c", `update kernel_environments set operational_state='restore_suspended', execution_epoch=execution_epoch+1, restore_generation=restore_generation+1, updated_at=now() where environment_id='${environmentId}'`]);
  if (!fence.includes("UPDATE 1")) throw new Error("Restored Environment could not be fenced.");
  try {
    run(["up", "-d", "--wait"]);
  } catch (error) {
    const logs = run(["logs", "--no-color", "kernel"]);
    throw new Error(`${error.message}\nKernel restore-start logs:\n${logs}`);
  }
  console.log(JSON.stringify({ restored: bundlePath, manifest: opened.manifest,
    duration_seconds: Math.ceil((Date.now() - started) / 1000), authority: "restore_suspended",
    next_operation: "kernel.environment.restore.begin" }));
}
