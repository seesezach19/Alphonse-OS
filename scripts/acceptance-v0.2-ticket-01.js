import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = "http://127.0.0.1:43201";
const project = `alphonse-v02-ticket01-${process.pid}`;
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "alphonse-v02-ticket01-"));
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  KERNEL_PORT: "43201",
  POSTGRES_PORT: "45501",
  DATA_PLANE_PORT: "43211",
  ALPHONSE_URL: baseUrl,
  ALPHONSE_TOKEN: "local-development-bootstrap-token"
};
const authHeaders = {
  authorization: "Bearer local-development-bootstrap-token",
  "content-type": "application/json"
};
let acceptancePassed = false;

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 8 * 60_000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function compose(...args) {
  return run("docker", ["compose", ...args]).stdout;
}

async function json(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

function cli(...args) {
  const result = run(process.execPath, ["src/diagnostic-cli.js", ...args]);
  return JSON.parse(result.stdout);
}

const workflowCommand = {
  command_id: "v02-ticket01-workflow",
  operation_id: "diagnostic.agent_workflow.register",
  input: {
    workflow_id: "workflow:inventory-follow-up",
    display_name: "Inventory Exception Follow-up",
    objective: "Compare inventory and route customer follow-up drafts to local review.",
    external_ref: { system: "n8n", workflow_key: "inventory-follow-up", environment: "local" }
  }
};
const revisionInput = {
  workflow_id: workflowCommand.input.workflow_id,
  workflow_content: {
    name: "Inventory Exception Follow-up",
    nodes: [{ id: "map-missing-sku", type: "code", behavior: "missing_to_zero" }],
    connections: {}
  },
  runtime: {
    runtime_id: "n8n",
    runtime_version: "1.0.0-test",
    image_digest: `sha256:${"a".repeat(64)}`
  },
  nodes: [{ node_type: "n8n-nodes-base.code", node_version: "2" }],
  model: { provider: "fixture", model: "deterministic-draft", version: "1" },
  configuration: { delivery: "local_review", missing_inventory_state: "zero" },
  adapter: {
    adapter_id: "alphonse.n8n.runtime",
    adapter_version: "0.2.0",
    fingerprint_rules_digest: `sha256:${"b".repeat(64)}`
  }
};

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait");

  const health = await json("/healthz");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.diagnostic_plane, "healthy");

  const kernelBootstrap = await json("/kernel/v0/bootstrap");
  assert.equal(kernelBootstrap.body.protocol.version, "0.1.0");
  assert.deepEqual(kernelBootstrap.body.diagnostic, {
    available: true,
    bootstrap: "/diagnostic/v0/bootstrap"
  });

  const diagnosticBootstrap = await json("/diagnostic/v0/bootstrap");
  assert.equal(diagnosticBootstrap.response.status, 200);
  assert.equal(diagnosticBootstrap.body.protocol.version, "0.2.0");
  assert.equal(diagnosticBootstrap.body.node.database_boundary, "separate_least_privilege_database");
  assert.equal(diagnosticBootstrap.body.node.authority_granted, false);
  assert.ok(diagnosticBootstrap.body.operations.some((item) =>
    item.operation_id === "diagnostic.agent_revision.register" &&
    item.effect_class === "diagnostic_state_transition"));

  const workflowFile = path.join(temporaryRoot, "workflow-command.json");
  await writeFile(workflowFile, JSON.stringify(workflowCommand), "utf8");
  const cliWorkflow = cli("register-workflow", workflowFile);
  assert.equal(cliWorkflow.created, true);
  assert.equal(cliWorkflow.agent_workflow.workflow_id, workflowCommand.input.workflow_id);
  assert.deepEqual(cliWorkflow.agent_workflow.authority, {
    capability: "not_granted",
    execution: "not_granted",
    effect: "not_granted",
    promotion: "not_granted"
  });
  assert.equal(Object.hasOwn(cliWorkflow.agent_workflow, "active"), false);
  assert.equal(Object.hasOwn(cliWorkflow.agent_workflow, "current"), false);

  const unauthenticated = await json(`/diagnostic/v0/agent-workflows/${encodeURIComponent(workflowCommand.input.workflow_id)}`);
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error.code, "AUTHENTICATION_REQUIRED");

  const cliWorkflowView = cli("get-workflow", workflowCommand.input.workflow_id);
  assert.deepEqual(cliWorkflowView.agent_workflow, cliWorkflow.agent_workflow);

  const replay = await json("/diagnostic/v0/agent-workflows", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(workflowCommand)
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.response.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(replay.body, cliWorkflow);

  const conflict = await json("/diagnostic/v0/agent-workflows", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ ...workflowCommand, input: { ...workflowCommand.input, display_name: "Changed" } })
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");

  const revisionCommand = {
    command_id: "v02-ticket01-revision-1",
    operation_id: "diagnostic.agent_revision.register",
    input: revisionInput
  };
  const registered = await json("/diagnostic/v0/agent-revisions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(revisionCommand)
  });
  assert.equal(registered.response.status, 201, JSON.stringify(registered.body));
  assert.equal(registered.body.created, true);
  const revision = registered.body.agent_revision;
  assert.match(revision.revision_id, /^[0-9a-f-]{36}$/);
  assert.equal(revision.material_digest, revision.snapshot_digest);
  assert.equal(revision.authority.effect, "not_granted");
  assert.equal(Object.hasOwn(revision, "active"), false);
  assert.equal(Object.hasOwn(revision, "current"), false);

  const equivalent = await json("/diagnostic/v0/agent-revisions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      command_id: "v02-ticket01-revision-equivalent",
      operation_id: "diagnostic.agent_revision.register",
      input: { ...revisionInput, configuration: { missing_inventory_state: "zero", delivery: "local_review" } }
    })
  });
  assert.equal(equivalent.response.status, 201);
  assert.equal(equivalent.body.created, false);
  assert.equal(equivalent.body.agent_revision.revision_id, revision.revision_id);

  const revisionConflict = await json("/diagnostic/v0/agent-revisions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ ...revisionCommand,
      input: { ...revisionInput, configuration: { delivery: "local_review", missing_inventory_state: "conflict" } } })
  });
  assert.equal(revisionConflict.response.status, 409);
  assert.equal(revisionConflict.body.error.code, "IDEMPOTENCY_CONFLICT");

  const changed = await json("/diagnostic/v0/agent-revisions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      command_id: "v02-ticket01-revision-changed",
      operation_id: "diagnostic.agent_revision.register",
      input: { ...revisionInput, configuration: { delivery: "local_review", missing_inventory_state: "unknown" } }
    })
  });
  assert.equal(changed.response.status, 201);
  assert.equal(changed.body.created, true);
  assert.notEqual(changed.body.agent_revision.revision_id, revision.revision_id);
  assert.notEqual(changed.body.agent_revision.material_digest, revision.material_digest);

  const mutableLabel = await json("/diagnostic/v0/agent-revisions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ ...revisionCommand, command_id: "v02-ticket01-active-label",
      input: { ...revisionInput, active: true } })
  });
  assert.equal(mutableLabel.response.status, 400);
  assert.equal(mutableLabel.body.error.code, "INVALID_INPUT");

  const secret = await json("/diagnostic/v0/agent-revisions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ ...revisionCommand, command_id: "v02-ticket01-secret",
      input: { ...revisionInput, configuration: { api_key: "must-not-persist" } } })
  });
  assert.equal(secret.response.status, 400);
  assert.equal(secret.body.error.code, "SENSITIVE_METADATA_REJECTED");

  const nestedSecret = await json("/diagnostic/v0/agent-revisions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ ...revisionCommand, command_id: "v02-ticket01-nested-secret",
      input: { ...revisionInput, workflow_content: { headers: { authorization: "Bearer prohibited" } } } })
  });
  assert.equal(nestedSecret.response.status, 400);
  assert.equal(nestedSecret.body.error.code, "SENSITIVE_METADATA_REJECTED");

  const revisionView = cli("get-revision", revision.revision_id);
  assert.deepEqual(revisionView.agent_revision, revision);
  const artifactView = cli("get-artifact", revision.snapshot_digest);
  assert.equal(artifactView.artifact.verified, true);
  assert.deepEqual(artifactView.artifact.content, revisionInput);

  compose("stop", "kernel");
  compose("up", "--wait", "kernel");
  const persisted = cli("get-revision", revision.revision_id);
  assert.deepEqual(persisted.agent_revision, revision);
  assert.equal(cli("get-artifact", revision.snapshot_digest).artifact.verified, true);

  const diagnosticAccess = run("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only psql -U alphonse_diagnostic -d alphonse_diagnostic -tAc 'select count(*) from diagnostic_agent_workflows'"]);
  assert.equal(diagnosticAccess.stdout.trim(), "1");
  const artifactCount = run("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only psql -U alphonse_diagnostic -d alphonse_diagnostic -tAc 'select count(*) from diagnostic_artifacts'"]);
  assert.equal(artifactCount.stdout.trim(), "2");
  const kernelAccess = run("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only psql -U alphonse_diagnostic -d alphonse_kernel -tAc 'select 1'"],
  { allowFailure: true });
  assert.notEqual(kernelAccess.status, 0);
  assert.match(`${kernelAccess.stdout}${kernelAccess.stderr}`, /permission denied for database "?alphonse_kernel"?/i);

  acceptancePassed = true;
  console.log(JSON.stringify({
    ticket: "v0.2-01",
    workflow_id: workflowCommand.input.workflow_id,
    equivalent_revision_reused: true,
    changed_revision_created: true,
    artifact_verified_after_restart: true,
    diagnostic_role_kernel_access: "denied",
    kernel_authority_changed: false,
    aws_activity: false
  }, null, 2));
} finally {
  if (!acceptancePassed) {
    try { console.error(compose("logs", "--no-color", "kernel")); } catch {}
  }
  try { compose("down", "--volumes", "--remove-orphans"); } catch {}
  await rm(temporaryRoot, { recursive: true, force: true });
}
