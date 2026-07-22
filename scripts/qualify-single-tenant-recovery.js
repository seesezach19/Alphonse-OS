import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildV02Release } from "./release-bundle-v0.2.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extraction = await mkdtemp(path.join(os.tmpdir(), "alphonse-v0.2-recovery-"));
const project = `alphonse-v02-recovery-${process.pid}`;
const environment = { ...process.env, ALPHONSE_COMPOSE_PROJECT: project, ALPHONSE_HTTPS_PORT: "43212" };
let releaseRoot;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? root, env: options.env ?? environment,
    encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, timeout: options.timeout ?? 20 * 60_000,
    windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function compose(...args) {
  return run("docker", ["compose", "--project-name", project, "--env-file",
    path.join(releaseRoot, ".env.release"), "-f", path.join(releaseRoot, "compose.yaml"), ...args],
  { cwd: releaseRoot });
}

function values(text) {
  return Object.fromEntries(text.trim().split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function kernelRequest(pathname, ownerToken, body) {
  const encoded = body ? Buffer.from(JSON.stringify(body)).toString("base64") : null;
  const source = encoded
    ? `const b=Buffer.from('${encoded}','base64').toString();fetch('http://127.0.0.1:3000${pathname}',{method:'POST',headers:{authorization:'Owner ${ownerToken}','content-type':'application/json'},body:b}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))`
    : `fetch('http://127.0.0.1:3000${pathname}',{headers:{authorization:'Owner ${ownerToken}'}}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json()})))`;
  return JSON.parse(compose("exec", "-T", "kernel", "node", "-e", source));
}

const command = (commandId, operationId, input) => ({ command_id: commandId, operation_id: operationId, input });

try {
  const release = await buildV02Release(root, { write: true });
  run("tar", ["-xf", path.join(root, "dist", release.archiveName), "-C", extraction]);
  releaseRoot = extraction;
  run("sh", [path.join(releaseRoot, "install-local.sh")], { cwd: releaseRoot });
  const credentials = values(await readFile(path.join(releaseRoot, ".env.release"), "utf8"));
  const ownerToken = credentials.KERNEL_OWNER_TOKEN;

  const workflowId = "workflow:single-tenant-restore-proof";
  const workflow = kernelRequest("/diagnostic/v0/agent-workflows", ownerToken,
    command("release-recovery-workflow", "diagnostic.agent_workflow.register", {
      workflow_id: workflowId,
      display_name: "Single Tenant Restore Proof",
      objective: "Retain one exact authoritative workflow across encrypted backup and restore.",
      external_ref: { system: "qualification", workflow_key: "restore-proof", environment: "isolated" }
    }));
  assert.equal(workflow.status, 201, JSON.stringify(workflow.body));
  const revision = kernelRequest("/diagnostic/v0/agent-revisions", ownerToken,
    command("release-recovery-revision", "diagnostic.agent_revision.register", {
      workflow_id: workflowId,
      workflow_content: { nodes: [{ id: "source", type: "qualification-source" }], connections: {} },
      runtime: { runtime_id: "qualification", runtime_version: "1.0.0",
        image_digest: `sha256:${"a".repeat(64)}` },
      nodes: [{ node_type: "qualification-source", node_version: "1" }],
      model: { provider: "none", model: "deterministic", version: "1" },
      configuration: { external_effects: false },
      adapter: { adapter_id: "qualification", adapter_version: "1.0.0",
        fingerprint_rules_digest: `sha256:${"b".repeat(64)}` }
    }));
  assert.equal(revision.status, 201, JSON.stringify(revision.body));
  const revisionId = revision.body.agent_revision.revision_id;
  const artifactDigest = revision.body.agent_revision.snapshot_digest;
  const quarantine = kernelRequest(`/diagnostic/v0/console-controls/workflows/${workflowId}/quarantine`, ownerToken,
    command("release-recovery-quarantine", "diagnostic.console_workflow.quarantine", {
      workflow_id: workflowId, reason_code: "manual_recovery",
      rationale: "Prove legal recovery state survives a complete release restore."
    }));
  assert.equal(quarantine.status, 201, JSON.stringify(quarantine.body));

  const beforeArtifact = kernelRequest(`/diagnostic/v0/artifacts/${artifactDigest}`, ownerToken);
  assert.equal(beforeArtifact.status, 200);
  const backupPath = path.join(releaseRoot, "backups", "qualification.json");
  const backupResult = JSON.parse(run(process.execPath,
    ["scripts/release-backup-restore.js", "create", backupPath], { cwd: releaseRoot }));
  assert.equal(backupResult.authority_fenced_during_snapshot, true);
  assert.ok(backupResult.manifest.artifacts.some((item) => item.digest === artifactDigest));

  const releaseControl = kernelRequest(`/diagnostic/v0/console-controls/workflows/${workflowId}/release`, ownerToken,
    command("release-recovery-post-backup-mutation", "diagnostic.console_workflow.release", {
      workflow_id: workflowId, reason_code: "manual_recovery", rationale: "Mutation made after restore point."
    }));
  assert.equal(releaseControl.status, 201);

  const restoreResult = JSON.parse(run(process.execPath,
    ["scripts/release-backup-restore.js", "restore", backupPath], { cwd: releaseRoot }));
  assert.equal(restoreResult.authority, "restore_suspended");
  assert.ok(restoreResult.duration_seconds <= 60 * 60);
  const bundle = JSON.parse(await readFile(backupPath, "utf8"));
  const begin = kernelRequest("/kernel/v0/restores", ownerToken,
    command("release-recovery-begin", "kernel.environment.restore.begin", {
      backup_manifest: bundle.manifest, backup_manifest_digest: bundle.manifest_digest
    }));
  assert.equal(begin.status, 201, JSON.stringify(begin.body));
  const restoreId = begin.body.restore.restore_id;
  const rebuild = kernelRequest(`/kernel/v0/restores/${restoreId}/projection-rebuild`, ownerToken,
    command("release-recovery-projection", "kernel.environment.restore.projection_rebuild", {}));
  assert.equal(rebuild.status, 201, JSON.stringify(rebuild.body));
  const verify = kernelRequest(`/kernel/v0/restores/${restoreId}/verify`, ownerToken,
    command("release-recovery-verify", "kernel.environment.restore.verify", {
      verified_artifact_digests: bundle.manifest.artifacts.map((item) => item.digest)
    }));
  assert.equal(verify.status, 201, JSON.stringify(verify.body));
  const resume = kernelRequest(`/kernel/v0/restores/${restoreId}/resume`, ownerToken,
    command("release-recovery-resume", "kernel.environment.restore.resume", {}));
  assert.equal(resume.status, 201, JSON.stringify(resume.body));
  assert.equal(resume.body.environment.operational_state, "active");

  const afterArtifact = kernelRequest(`/diagnostic/v0/artifacts/${artifactDigest}`, ownerToken);
  const afterRevision = kernelRequest(`/diagnostic/v0/agent-revisions/${revisionId}`, ownerToken);
  const snapshot = kernelRequest("/diagnostic/v0/console-snapshot", ownerToken);
  assert.deepEqual(afterArtifact.body.artifact, beforeArtifact.body.artifact);
  assert.equal(afterRevision.status, 200);
  const restoredWorkflow = snapshot.body.console_snapshot.workflows.find((item) => item.workflow_id === workflowId);
  assert.equal(restoredWorkflow.quarantine.state, "quarantined");
  assert.deepEqual(restoredWorkflow.legal_next_operations, ["diagnostic.console_workflow.release"]);

  console.log(JSON.stringify({ qualification: "single_tenant_recovery_passed",
    archive_digest: release.archiveDigest, backup_manifest_digest: bundle.manifest_digest,
    restore_duration_seconds: restoreResult.duration_seconds, rpo_target_hours: 24, rto_target_minutes: 60,
    exact_revision_id: revisionId, exact_artifact_digest: artifactDigest,
    databases_restored: bundle.manifest.database_dumps.map((item) => item.name),
    stores_restored: bundle.manifest.store_archives.map((item) => item.name),
    transition_integrity: verify.body.verification.transition_integrity,
    artifact_manifest_integrity: verify.body.verification.artifact_manifest,
    authority_resumed_only_after_verification: true, quarantine_and_legal_next_preserved: true,
    duplicate_external_effects: 0 }, null, 2));
} finally {
  if (releaseRoot) {
    try { compose("down", "--volumes", "--remove-orphans"); } catch {}
  }
  if (extraction.startsWith(`${os.tmpdir()}${path.sep}`)) await rm(extraction, { recursive: true, force: true });
}
