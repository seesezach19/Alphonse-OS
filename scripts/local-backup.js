import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createEncryptedBackup, openEncryptedBackup } from "../src/backup-bundle.js";

const [mode, bundlePath] = process.argv.slice(2);
const key = process.env.KERNEL_BACKUP_KEY;
const artifactDir = process.env.KERNEL_ARTIFACT_DIR ?? path.resolve(".local/artifacts");
const environmentId = process.env.KERNEL_ENVIRONMENT_ID ?? "00000000-0000-4000-8000-000000000001";
if (!key || !["create", "restore"].includes(mode) || !bundlePath) {
  throw new Error("Usage: KERNEL_BACKUP_KEY=<32-byte-base64> node scripts/local-backup.js create|restore <bundle-path>");
}

function composeBuffer(...args) {
  const result = spawnSync("docker", ["compose", ...args], { cwd: new URL("..", import.meta.url), encoding: null,
    input: undefined, maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error(Buffer.from(result.stderr ?? "").toString("utf8"));
  return Buffer.from(result.stdout);
}

async function artifacts() {
  await mkdir(artifactDir, { recursive: true });
  const entries = await readdir(artifactDir, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => ({
    digest: entry.name.startsWith("sha256-") ? entry.name.replace("sha256-", "sha256:")
      : (/^[0-9a-f]{64}$/.test(entry.name) ? `sha256:${entry.name}` : entry.name),
    bytes: await readFile(path.join(artifactDir, entry.name))
  })));
}

if (mode === "create") {
  const dump = composeBuffer("exec", "-T", "postgres", "pg_dump", "-U", "alphonse", "-d", "alphonse_kernel", "-Fc");
  const state = JSON.parse(composeBuffer("exec", "-T", "postgres", "psql", "-U", "alphonse", "-d", "alphonse_kernel",
    "-Atc", `select json_build_object('sequence',next_sequence-1,'epoch',execution_epoch) from kernel_environments where environment_id='${environmentId}'`).toString("utf8"));
  const bundle = createEncryptedBackup({ backupId: randomUUID(), environmentId,
    restorePointSequence: state.sequence, executionEpoch: state.epoch, postgresDump: dump,
    artifacts: await artifacts(), key, keyId: process.env.KERNEL_BACKUP_KEY_ID ?? "local-backup-key-v1" });
  await mkdir(path.dirname(path.resolve(bundlePath)), { recursive: true });
  await writeFile(bundlePath, JSON.stringify(bundle));
  console.log(JSON.stringify({ backup: bundlePath, manifest: bundle.manifest, manifest_digest: bundle.manifest_digest }));
} else {
  const opened = openEncryptedBackup(JSON.parse(await readFile(bundlePath, "utf8")), key);
  if (opened.manifest.environment_id !== environmentId) {
    throw new Error(`Backup belongs to Environment ${opened.manifest.environment_id}, not ${environmentId}.`);
  }
  const running = spawnSync("docker", ["compose", "ps", "--status", "running", "--services"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", windowsHide: true });
  if (running.status !== 0) throw new Error(running.stderr);
  const runningServices = new Set(running.stdout.split(/\r?\n/).filter(Boolean));
  if (runningServices.has("kernel") || runningServices.has("data-plane")) {
    throw new Error("Stop kernel and data-plane before restoring authoritative bytes.");
  }
  const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", "pg_restore", "-U", "alphonse", "-d",
    "alphonse_kernel", "--clean", "--if-exists"], { cwd: new URL("..", import.meta.url), input: opened.postgresDump,
    encoding: null, maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error(Buffer.from(result.stderr ?? "").toString("utf8"));
  const fence = spawnSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1",
    "-U", "alphonse", "-d", "alphonse_kernel", "-c",
    `update kernel_environments set operational_state='restore_suspended', execution_epoch=execution_epoch+1, restore_generation=restore_generation+1, updated_at=now() where environment_id='${environmentId}' and operational_state='active'`],
  { cwd: new URL("..", import.meta.url), encoding: "utf8", windowsHide: true });
  if (fence.status !== 0 || !/UPDATE 1/.test(fence.stdout)) {
    throw new Error(`Restored Environment could not be pre-fenced. ${fence.stderr}`);
  }
  await mkdir(artifactDir, { recursive: true });
  for (const artifact of opened.artifacts) {
    await writeFile(path.join(artifactDir, artifact.digest.replace("sha256:", "sha256-")), artifact.bytes);
  }
  console.log(JSON.stringify({ restored: bundlePath, authority: "restore_suspended",
    next_action: "start Kernel and submit kernel.environment.restore.begin", manifest: opened.manifest }));
}
