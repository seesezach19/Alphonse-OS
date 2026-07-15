import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRelease, releaseDigest } from "./release-bundle.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extraction = await mkdtemp(path.join(os.tmpdir(), "alphonse-kernel-v0.1-"));
const project = `alphonse-kernel-ticket-17-${process.pid}`;
const environment = { ...process.env, ALPHONSE_COMPOSE_PROJECT: project,
  KERNEL_PORT: "43117", DATA_PLANE_PORT: "43127" };
let releaseRoot;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? root, env: environment, encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024, timeout: options.timeout ?? 10 * 60_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function compose(...args) {
  return run("docker", ["compose", "--project-name", project, "--env-file", path.join(releaseRoot, ".env.release"),
    "-f", path.join(releaseRoot, "compose.yaml"), ...args], { cwd: releaseRoot });
}

try {
  const release = await buildRelease(root, { write: true });
  const archivePath = path.join(root, "dist", release.archiveName);
  assert.equal(releaseDigest(await readFile(archivePath)), release.archiveDigest);
  run("tar", ["-xf", archivePath, "-C", extraction]);
  releaseRoot = extraction;

  const installer = process.platform === "win32"
    ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(releaseRoot, "install-local.ps1")]]
    : ["sh", [path.join(releaseRoot, "install-local.sh")]];
  run(installer[0], installer[1], { cwd: releaseRoot });

  const envText = await readFile(path.join(releaseRoot, ".env.release"), "utf8");
  const credentials = Object.fromEntries(envText.trim().split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.ok(credentials.KERNEL_BOOTSTRAP_TOKEN.length >= 32);
  assert.ok(credentials.POSTGRES_PASSWORD.length >= 32);
  assert.equal(release.manifest.payload_files.some((item) => item.path === ".env.release"), false);

  const health = await fetch("http://127.0.0.1:43117/healthz");
  assert.equal(health.status, 200);
  const bootstrap = await (await fetch("http://127.0.0.1:43117/kernel/v0/bootstrap")).json();
  assert.equal(bootstrap.protocol.version, "0.1.0");
  assert.ok(bootstrap.operations.some((item) => item.operation_id === "kernel.support_case.approve"));
  const butler = await fetch("http://127.0.0.1:43117/kernel/v0/accountable-work/overview",
    { headers: { authorization: `Bearer ${credentials.KERNEL_BOOTSTRAP_TOKEN}` } });
  assert.equal(butler.status, 200);
  assert.equal((await fetch("http://127.0.0.1:43127/healthz")).status, 200);

  const configured = JSON.parse(compose("config", "--format", "json"));
  assert.equal(configured.services.postgres.ports, undefined);
  assert.match(configured.services.postgres.image, /@sha256:[0-9a-f]{64}$/);
  const faultProbe = compose("exec", "-T", "trusted-adapter", "node", "-e",
    "fetch('http://127.0.0.1:3400/internal/test/faults/next-dispatch',{method:'POST'}).then(r=>console.log(r.status))");
  assert.equal(faultProbe, "404");

  console.log(JSON.stringify({ ticket: 17, fresh_install: "passed", archive_digest: release.archiveDigest,
    manifest_digest: release.manifestDigest, postgres_host_port: false, generated_credentials: true,
    test_fault_surface: "disabled", aws_activity: false }, null, 2));
} finally {
  if (releaseRoot) {
    try { compose("down", "--volumes", "--remove-orphans"); } catch {}
  }
}
