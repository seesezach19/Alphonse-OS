import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildV02Release, releaseDigest } from "./release-bundle-v0.2.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extraction = await mkdtemp(path.join(os.tmpdir(), "alphonse-v0.2-release-"));
const project = `alphonse-v02-ticket11-${process.pid}`;
const environment = {
  ...process.env,
  ALPHONSE_COMPOSE_PROJECT: project,
  KERNEL_PORT: "43211",
  N8N_PORT: "43221"
};
let releaseRoot;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? environment,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 12 * 60_000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function compose(...args) {
  return run("docker", ["compose", "--project-name", project, "--env-file",
    path.join(releaseRoot, ".env.release"), "-f", path.join(releaseRoot, "compose.yaml"), ...args],
  { cwd: releaseRoot });
}

function parseEnvironment(text) {
  return Object.fromEntries(text.trim().split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

try {
  const release = await buildV02Release(root, { write: true });
  const archivePath = path.join(root, "dist", release.archiveName);
  assert.equal(releaseDigest(await readFile(archivePath)), release.archiveDigest);
  run("tar", ["-xf", archivePath, "-C", extraction]);
  releaseRoot = extraction;

  const installer = process.platform === "win32"
    ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(releaseRoot, "install-local.ps1")]]
    : ["sh", [path.join(releaseRoot, "install-local.sh")]];
  run(installer[0], installer[1], { cwd: releaseRoot });
  const firstEnvironmentText = await readFile(path.join(releaseRoot, ".env.release"), "utf8");
  run(installer[0], installer[1], { cwd: releaseRoot });
  const secondEnvironmentText = await readFile(path.join(releaseRoot, ".env.release"), "utf8");
  assert.equal(secondEnvironmentText, firstEnvironmentText, "Installer must not rotate existing credentials.");

  const credentials = parseEnvironment(firstEnvironmentText);
  for (const name of [
    "POSTGRES_PASSWORD", "DIAGNOSTIC_DATABASE_PASSWORD", "KERNEL_BOOTSTRAP_TOKEN",
    "DIAGNOSTIC_RUNTIME_ADAPTER_SECRET", "N8N_DETAIL_ADAPTER_TOKEN",
    "N8N_REPAIR_DELIVERY_API_KEY", "VERIFICATION_RUNNER_SIGNING_SECRET", "N8N_ENCRYPTION_KEY"
  ]) assert.ok(credentials[name]?.length >= 32, `${name} was not generated safely.`);
  assert.equal(release.manifest.payload_files.some((item) => item.path === ".env.release"), false);

  assert.equal((await fetch("http://127.0.0.1:43211/healthz")).status, 200);
  const kernelBootstrap = await (await fetch("http://127.0.0.1:43211/kernel/v0/bootstrap")).json();
  const diagnosticBootstrap = await (await fetch("http://127.0.0.1:43211/diagnostic/v0/bootstrap")).json();
  assert.equal(kernelBootstrap.protocol.version, "0.1.0");
  assert.equal(diagnosticBootstrap.protocol.version, "0.2.0");
  assert.ok(diagnosticBootstrap.operations.some((item) => item.operation_id === "diagnostic.promotion.reconcile"));
  assert.equal((await fetch("http://127.0.0.1:43221/healthz")).status, 200);

  const configured = JSON.parse(compose("config", "--format", "json"));
  assert.equal(configured.services.postgres.ports, undefined);
  assert.equal(configured.services["n8n-runtime-adapter"].ports, undefined);
  assert.equal(configured.services.kernel.ports[0].host_ip, "127.0.0.1");
  assert.equal(configured.services.n8n.ports[0].host_ip, "127.0.0.1");
  assert.equal(configured.services.postgres.image, release.manifest.base_images.postgres);
  assert.equal(configured.services.n8n.image, release.manifest.base_images.n8n);
  assert.equal(configured.services["n8n-runtime-adapter"].environment.N8N_ADAPTER_TEST_CONTROLS_ENABLED,
    undefined);

  for (const workflow of ["alphonse-event-reporter.json", "inventory-follow-up-defective.json"]) {
    const imported = compose("exec", "-T", "n8n", "n8n", "import:workflow",
      `--input=/package/workflows/${workflow}`);
    assert.match(imported, /Successfully imported/i);
  }

  const faultProbeSource = `fetch('http://127.0.0.1:5680/test/v0/promotion-mode',{method:'POST',` +
    `headers:{authorization:'Bearer ${credentials.N8N_DETAIL_ADAPTER_TOKEN}',` +
    `'content-type':'application/json'},body:JSON.stringify({mode:'normal'})})` +
    `.then(r=>console.log(r.status))`;
  assert.equal(compose("exec", "-T", "n8n-runtime-adapter", "node", "-e", faultProbeSource), "404");

  const cli = run(process.execPath, ["src/diagnostic-cli.js", "bootstrap"], {
    cwd: releaseRoot,
    env: { ...environment, ALPHONSE_URL: "http://127.0.0.1:43211" }
  });
  const cliBootstrap = JSON.parse(cli);
  assert.equal(cliBootstrap.protocol.name, "alphonse-diagnostic-protocol");
  assert.equal(cliBootstrap.protocol.version, "0.2.0");

  console.log(JSON.stringify({
    ticket: "v0.2-11",
    fresh_extraction: "passed",
    archive_digest: release.archiveDigest,
    manifest_digest: release.manifestDigest,
    generated_credentials: true,
    credentials_preserved_on_reinstall: true,
    postgres_host_port: false,
    public_ports_loopback_only: true,
    n8n_redistributed: false,
    adapter_test_authority: false,
    workflows_importable: true,
    public_protocol_inspection: true,
    aws_activity: false
  }, null, 2));
} finally {
  if (releaseRoot) {
    try { compose("down", "--volumes", "--remove-orphans"); } catch {}
  }
  if (extraction.startsWith(`${os.tmpdir()}${path.sep}`)) {
    await rm(extraction, { recursive: true, force: true });
  }
}
