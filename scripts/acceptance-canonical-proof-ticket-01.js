import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRoleManifests,
  loadAcceptanceManifest,
  missingCapability
} from "./canonical-diagnostic-proof-seam.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roleProgram = path.join(root, "scripts", "canonical-diagnostic-proof-role.js");
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "alphonse-canonical-proof-ticket01-"));
const expectBlocked = process.argv.includes("--expect-blocked");
const manifestDocument = loadAcceptanceManifest(root);
const roles = manifestDocument.roles;
assertRoleManifests(roles);

function roleEnvironment(roleName, roleRoot) {
  return Object.fromEntries(Object.entries({
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    TEMP: roleRoot,
    TMP: roleRoot,
    CANONICAL_PROOF_ROLE: roleName,
    CANONICAL_PROOF_CREDENTIAL_IDS: roles[roleName].credentials.join(",")
  }).filter(([, value]) => value !== undefined));
}

function runRole(roleName, payload) {
  const roleRoot = path.join(temporaryRoot, roleName);
  mkdirSync(roleRoot, { recursive: true });
  const inputPath = path.join(roleRoot, "input.json");
  const outputPath = path.join(roleRoot, "output.json");
  writeFileSync(inputPath, JSON.stringify({ role: roleName, manifest: roles[roleName], payload }), "utf8");
  const child = spawnSync(process.execPath, [roleProgram, inputPath, outputPath], {
    cwd: roleRoot,
    env: roleEnvironment(roleName, roleRoot),
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`${roleName} failed: ${child.stderr}`);
  return JSON.parse(readFileSync(outputPath, "utf8"));
}

try {
  const supervisor = runRole("runtime_supervisor", {});
  const bootstrap = runRole("trusted_bootstrap", {});
  const orchestrator = runRole("test_orchestrator", {
    bootstrap_receipt: bootstrap.bootstrap_receipt
  });

  assert.equal(orchestrator.status, "blocked");
  assert.equal(orchestrator.manifest_sealed, false);
  assert.equal(orchestrator.credentials_relinquished, false);
  assert.equal(orchestrator.missing_capability, missingCapability(orchestrator.acceptance_state));

  const roleProcesses = [
    supervisor.process,
    bootstrap.process,
    orchestrator.process
  ];
  assert.equal(new Set(roleProcesses.map((record) => record.process_instance_id)).size, roleProcesses.length);

  const report = {
    schema_version: "0.1.0",
    ticket: "canonical-diagnostic-proof-01",
    status: "blocked_expected",
    missing_capability: orchestrator.missing_capability,
    stopped_after: orchestrator.acceptance_state.stage,
    role_processes: roleProcesses,
    stimulus: {
      status: "not_started",
      reason: "deployment_manifest_not_sealed"
    },
    verifier: {
      status: "not_started",
      reason: "stimulus_not_completed"
    },
    model_requests: 0,
    controller_authored_evidence: false,
    threat_model: manifestDocument.threat_model
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!expectBlocked) process.exitCode = 2;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
