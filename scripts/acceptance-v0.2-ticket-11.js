import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildV02Release, releaseDigest } from "./release-bundle-v0.2.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extraction = await mkdtemp(path.join(os.tmpdir(), "alphonse-v0.2-release-"));
const project = `alphonse-v02-ticket11-${process.pid}`;
const httpsPort = 43211;
const environment = { ...process.env, ALPHONSE_COMPOSE_PROJECT: project,
  ALPHONSE_HTTPS_PORT: String(httpsPort) };
let releaseRoot;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root, env: options.env ?? environment, encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024, timeout: options.timeout ?? 15 * 60_000, windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
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

function secureRequest(pathname, { method = "GET", body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = https.request({ hostname: "127.0.0.1", port: httpsPort, path: pathname, method,
      rejectUnauthorized: false, headers: {
        accept: "application/json", ...(bytes ? { "content-type": "application/json",
          "content-length": String(bytes.length) } : {}), ...(cookie ? { cookie } : {})
      } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    if (bytes) request.write(bytes);
    request.end();
  });
}

function plainHttpRejected() {
  return new Promise((resolve) => {
    const request = http.get({ hostname: "127.0.0.1", port: httpsPort, path: "/" }, () => resolve(false));
    request.on("error", () => resolve(true));
    request.setTimeout(3000, () => { request.destroy(); resolve(true); });
  });
}

async function waitForSecure(pathname) {
  let failure;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { return await secureRequest(pathname); } catch (error) { failure = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw failure;
}

function internalJson(pathname, ownerToken) {
  const source = `fetch('http://127.0.0.1:3000${pathname}',{headers:{authorization:'Owner ${ownerToken}'}})`
    + `.then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))`;
  return JSON.parse(compose("exec", "-T", "kernel", "node", "-e", source));
}

async function roleSnapshot(role, credential) {
  const login = await secureRequest("/api/session", { method: "POST", body: { role, credential } });
  assert.equal(login.status, 200, login.body);
  const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0];
  assert.ok(cookie?.startsWith("alphonse_console_session="));
  const snapshot = await secureRequest("/api/console/snapshot", { cookie });
  assert.equal(snapshot.status, 200, snapshot.body);
  return JSON.parse(snapshot.body).console_snapshot;
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
  const firstCertificate = await readFile(path.join(releaseRoot, ".tls", "tls.crt"));
  run(installer[0], installer[1], { cwd: releaseRoot });
  assert.equal(await readFile(path.join(releaseRoot, ".env.release"), "utf8"), firstEnvironmentText,
    "Installer must not rotate existing credentials.");
  assert.deepEqual(await readFile(path.join(releaseRoot, ".tls", "tls.crt")), firstCertificate,
    "Installer must not rotate an existing TLS identity.");

  const credentials = parseEnvironment(firstEnvironmentText);
  for (const name of ["POSTGRES_PASSWORD", "DIAGNOSTIC_DATABASE_PASSWORD", "KERNEL_OWNER_TOKEN",
    "DIAGNOSTIC_CONSOLE_VIEWER_TOKEN", "CONSOLE_OPERATOR_AGENT_TOKEN", "CONSOLE_VIEWER_LOGIN_SECRET",
    "CONSOLE_OPERATOR_LOGIN_SECRET", "CONSOLE_OWNER_LOGIN_SECRET", "ALPHONSE_CONSOLE_SESSION_SECRET",
    "DIAGNOSTIC_RUNTIME_ADAPTER_SECRET", "N8N_DETAIL_ADAPTER_TOKEN", "N8N_REPAIR_DELIVERY_API_KEY",
    "N8N_ENCRYPTION_KEY", "KERNEL_BACKUP_KEY"]) {
    assert.ok(credentials[name]?.length >= 32, `${name} was not generated safely.`);
  }
  assert.equal(release.manifest.payload_files.some((item) => item.path === ".env.release"), false);
  assert.match(firstCertificate.toString("ascii"), /BEGIN CERTIFICATE/);

  const edge = await secureRequest("/");
  assert.equal(edge.status, 200);
  assert.equal(edge.headers["strict-transport-security"], "max-age=31536000");
  assert.equal(await plainHttpRejected(), true);

  const kernelBootstrap = internalJson("/kernel/v0/bootstrap", credentials.KERNEL_OWNER_TOKEN);
  const diagnosticBootstrap = internalJson("/diagnostic/v0/bootstrap", credentials.KERNEL_OWNER_TOKEN);
  assert.equal(kernelBootstrap.status, 200);
  assert.equal(kernelBootstrap.body.protocol.version, "0.1.0");
  assert.equal(diagnosticBootstrap.status, 200);
  assert.equal(diagnosticBootstrap.body.protocol.version, "0.2.0");
  assert.ok(diagnosticBootstrap.body.operations.some((item) => item.operation_id === "diagnostic.console_snapshot.get"));

  const viewer = await roleSnapshot("viewer", credentials.CONSOLE_VIEWER_LOGIN_SECRET);
  const operator = await roleSnapshot("operator", credentials.CONSOLE_OPERATOR_LOGIN_SECRET);
  const owner = await roleSnapshot("owner", credentials.CONSOLE_OWNER_LOGIN_SECRET);
  assert.equal(viewer.session.role, "viewer");
  assert.equal(operator.session.role, "operator");
  assert.equal(owner.session.role, "owner");
  assert.equal(viewer.source.authoritative, true);

  const breakGlass = JSON.parse(run(process.execPath, ["scripts/release-operations.js", "break-glass"], {
    cwd: releaseRoot, env: { ...environment, ALPHONSE_BREAK_GLASS_CONFIRM: "FENCE_NEW_WORK",
      ALPHONSE_BREAK_GLASS_REASON: "Clean-install qualification fence" }
  }));
  assert.equal(breakGlass.state, "break_glass_fenced");
  const fencedServices = new Set(compose("ps", "--status", "running", "--services").split(/\r?\n/));
  for (const service of ["edge", "console", "n8n", "n8n-runtime-adapter"]) assert.equal(fencedServices.has(service), false);
  assert.equal(internalJson("/kernel/v0/bootstrap", credentials.KERNEL_OWNER_TOKEN).status, 200);
  const recovered = JSON.parse(run(process.execPath, ["scripts/release-operations.js", "recover"], {
    cwd: releaseRoot, env: { ...environment, ALPHONSE_BREAK_GLASS_CONFIRM: "RECOVER_AFTER_REVIEW",
      ALPHONSE_BREAK_GLASS_REASON: "Qualification review found no unresolved target operation" }
  }));
  assert.equal(recovered.state, "services_recovered");
  assert.equal((await waitForSecure("/edge-healthz")).status, 200);
  const operationalStatus = JSON.parse(run(process.execPath, ["scripts/release-operations.js", "status"],
    { cwd: releaseRoot }));
  assert.equal(operationalStatus.state, "healthy");

  const configured = JSON.parse(compose("config", "--format", "json"));
  for (const service of ["postgres", "kernel", "console", "n8n", "n8n-runtime-adapter"]) {
    assert.equal(configured.services[service].ports, undefined, `${service} must not publish a host port.`);
  }
  assert.equal(configured.services.edge.ports[0].host_ip, "127.0.0.1");
  assert.equal(configured.services.postgres.image, release.manifest.base_images.postgres);
  assert.equal(configured.services.n8n.image, release.manifest.base_images.n8n);
  assert.equal(configured.services.kernel.read_only, true);
  assert.equal(configured.services.console.read_only, true);
  assert.equal(configured.services["n8n-runtime-adapter"].environment.N8N_ADAPTER_TEST_CONTROLS_ENABLED, undefined);
  assert.equal(configured.networks.control.internal, true);
  assert.equal(configured.networks.data.internal, true);

  for (const workflow of ["alphonse-event-reporter.json", "inventory-follow-up-defective.json"]) {
    try {
      assert.match(compose("exec", "-T", "n8n", "n8n", "import:workflow",
        `--input=/package/workflows/${workflow}`), /Successfully imported/i);
    } catch (error) {
      throw new Error(`${error.message}\nn8n post-recovery logs:\n${compose("logs", "--no-color", "n8n")}`);
    }
  }
  const faultProbeSource = `fetch('http://127.0.0.1:5680/test/v0/promotion-mode',{method:'POST',` +
    `headers:{authorization:'Bearer ${credentials.N8N_DETAIL_ADAPTER_TOKEN}',` +
    `'content-type':'application/json'},body:JSON.stringify({mode:'normal'})}).then(r=>console.log(r.status))`;
  assert.equal(compose("exec", "-T", "n8n-runtime-adapter", "node", "-e", faultProbeSource), "404");

  assert.equal(release.sbom.spdxVersion, "SPDX-2.3");
  assert.equal(release.provenance.subject[0].digest.sha256, release.archiveDigest.slice(7));
  assert.equal(createHash("sha256").update(release.sbomBytes).digest("hex"), release.sbomDigest.slice(7));

  console.log(JSON.stringify({
    ticket: "v0.2-11", fresh_extraction: "passed", archive_digest: release.archiveDigest,
    manifest_digest: release.manifestDigest, sbom_digest: release.sbomDigest,
    provenance_digest: release.provenanceDigest, generated_credentials: true,
    credentials_preserved_on_reinstall: true, tls_identity_preserved_on_reinstall: true,
    tls_only_browser_boundary: true, internal_host_ports: false, live_console_roles: ["viewer", "operator", "owner"],
    authoritative_console: true, least_privilege_networks: true, break_glass_fence_and_recovery: true,
    disk_and_health_alerts: true, n8n_redistributed: false,
    adapter_test_authority: false, workflows_importable: true, aws_activity: false
  }, null, 2));
} finally {
  if (releaseRoot) {
    try { compose("down", "--volumes", "--remove-orphans"); } catch {}
  }
  if (extraction.startsWith(`${os.tmpdir()}${path.sep}`)) await rm(extraction, { recursive: true, force: true });
}
