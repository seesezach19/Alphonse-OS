import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  adapterHealthProjection,
  buildN8nRevisionMaterial
} from "../packages/n8n-operational-package/src/index.js";
import { buildN8nExecutionWorkflowFingerprint } from
  "../packages/n8n-operational-package/src/runtime-attestation.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages", "n8n-operational-package");
const baseUrl = "http://127.0.0.1:43203";
const n8nUrl = "http://127.0.0.1:45673";
const project = `alphonse-v02-ticket03-${process.pid}`;
const adapterSecret = "local-n8n-runtime-event-secret-with-sufficient-length-v1";
const composeFiles = ["-f", "compose.yaml", "-f", "packages/n8n-operational-package/compose.customer.yaml"];
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  KERNEL_PORT: "43203",
  POSTGRES_PORT: "45503",
  N8N_PORT: "45673",
  ALPHONSE_URL: baseUrl,
  ALPHONSE_TOKEN: "local-development-bootstrap-token",
  DIAGNOSTIC_RUNTIME_ADAPTER_ID: "alphonse.n8n.runtime",
  DIAGNOSTIC_RUNTIME_ADAPTER_VERSION: "0.2.0",
  DIAGNOSTIC_RUNTIME_ADAPTER_KEY_ID: "n8n-runtime-key-v1",
  DIAGNOSTIC_RUNTIME_ADAPTER_SECRET: adapterSecret,
  ALPHONSE_RUNTIME_ADAPTER_KEY_ID: "n8n-runtime-key-v1",
  ALPHONSE_RUNTIME_ADAPTER_SECRET: adapterSecret
};
const headers = {
  authorization: "Bearer local-development-bootstrap-token",
  "content-type": "application/json"
};
let passed = false;

function run(command, args, { allowFailure = false, timeout = 8 * 60_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function compose(...args) {
  return run("docker", ["compose", ...composeFiles, ...args]);
}

function sql(database, user, password, query) {
  return compose("exec", "-T", "postgres", "sh", "-lc",
    `PGPASSWORD=${password} psql -U ${user} -d ${database} -tAc '${query}'`).stdout.trim();
}

async function jsonFile(relativePath) {
  return JSON.parse(await readFile(path.join(packageRoot, relativePath), "utf8"));
}

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

async function post(route, body) {
  return request(route, { method: "POST", headers, body: JSON.stringify(body) });
}

async function n8nRequest(route, options = {}) {
  const response = await fetch(`${n8nUrl}${route}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function waitForN8nRest() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { response } = await n8nRequest("/rest/settings");
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("n8n REST controllers did not become ready");
}

function responseData(body) {
  return body?.data ?? body;
}

async function waitForTrace() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const traceId = sql("alphonse_diagnostic", "alphonse_diagnostic", "local-diagnostic-only",
      "select trace_id from diagnostic_external_activity_traces order by created_at desc limit 1");
    if (/^[0-9a-f-]{36}$/i.test(traceId)) return traceId;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for independently attested runtime evidence");
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait", "postgres", "diagnostic-bootstrap", "kernel");

  const packageManifest = await jsonFile("operational-package.json");
  const workflowJson = await jsonFile("workflows/inventory-follow-up-defective.json");
  const reporterJson = await jsonFile("workflows/alphonse-event-reporter.json");
  const material = buildN8nRevisionMaterial({ packageManifest, workflow: workflowJson, reporter: reporterJson });

  const workflow = await post("/diagnostic/v0/agent-workflows", {
    command_id: "v02-ticket03-workflow",
    operation_id: "diagnostic.agent_workflow.register",
    input: {
      workflow_id: "workflow:inventory-follow-up",
      display_name: "Inventory Follow-up - Defective Missing SKU Mapping",
      objective: "Compare deterministic inventory fixtures and route a follow-up draft only to local review.",
      external_ref: { system: "n8n", workflow_key: workflowJson.id, environment: "customer-local" }
    }
  });
  assert.equal(workflow.response.status, 201, JSON.stringify(workflow.body));

  const revision = await post("/diagnostic/v0/agent-revisions", {
    command_id: "v02-ticket03-revision",
    operation_id: "diagnostic.agent_revision.register",
    input: { workflow_id: "workflow:inventory-follow-up", ...material }
  });
  assert.equal(revision.response.status, 201, JSON.stringify(revision.body));
  const registered = revision.body.agent_revision;
  environment.ALPHONSE_REVISION_ID = registered.revision_id;

  compose("run", "--rm", "--no-deps", "n8n", "import:workflow",
    "--input=/package/workflows/alphonse-event-reporter.json");
  compose("run", "--rm", "--no-deps", "n8n", "import:workflow",
    "--input=/package/workflows/inventory-follow-up-defective.json");
  compose("run", "--rm", "--no-deps", "n8n", "publish:workflow", "--id=AlphonseReport01");

  compose("up", "-d", "--wait", "n8n");
  const runtimeHealth = await fetch(`${n8nUrl}/healthz`);
  assert.equal(runtimeHealth.ok, true);
  await waitForN8nRest();
  assert.deepEqual(adapterHealthProjection({
    runtimeReachable: true, reportingReachable: true, lastEventAt: null
  }), {
    status: "healthy", runtime: "reachable", reporting: "reachable", workflow_activity: "none_observed"
  });

  const ownerSetup = await n8nRequest("/rest/owner/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "agency-lab@example.test",
      firstName: "Agency",
      lastName: "Lab",
      password: "LocalAgencyLabPassword123!"
    })
  });
  assert.equal(ownerSetup.response.status, 200, JSON.stringify(ownerSetup.body));
  const sessionCookie = ownerSetup.response.headers.getSetCookie()
    .map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(sessionCookie, "n8n owner setup must issue an authenticated session");

  const scopesResponse = await n8nRequest("/rest/api-keys/scopes", {
    headers: { cookie: sessionCookie }
  });
  assert.equal(scopesResponse.response.status, 200, JSON.stringify(scopesResponse.body));
  const availableScopes = responseData(scopesResponse.body);
  assert.ok(availableScopes.includes("execution:read"));
  assert.ok(availableScopes.includes("workflow:read"));

  const apiKeyResponse = await n8nRequest("/rest/api-keys", {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: JSON.stringify({
      label: "Alphonse runtime attestation",
      expiresAt: null,
      scopes: ["execution:read", "workflow:read"]
    })
  });
  assert.equal(apiKeyResponse.response.status, 200, JSON.stringify(apiKeyResponse.body));
  const n8nApiKey = responseData(apiKeyResponse.body).rawApiKey;
  assert.ok(n8nApiKey);

  const deployedWorkflow = await n8nRequest(`/api/v1/workflows/${workflowJson.id}`, {
    headers: { "x-n8n-api-key": n8nApiKey }
  });
  assert.equal(deployedWorkflow.response.status, 200, JSON.stringify(deployedWorkflow.body));
  const executionFingerprint = buildN8nExecutionWorkflowFingerprint({
    workflowId: workflowJson.id,
    workflowData: responseData(deployedWorkflow.body)
  });
  environment.N8N_API_KEY = n8nApiKey;
  environment.N8N_EXECUTION_WORKFLOW_MATERIAL_DIGEST =
    executionFingerprint.execution_workflow_material_digest;
  compose("up", "-d", "--force-recreate", "--no-deps", "--wait", "n8n-runtime-adapter");
  compose("stop", "n8n");

  const execution = compose("run", "--rm", "--no-deps", "n8n", "execute",
    "--id=InventoryDefect1", "--rawOutput");
  const executionOutput = `${execution.stdout}\n${execution.stderr}`;
  assert.match(executionOutput, /missing_sku -> zero_inventory -> delay_draft/);
  assert.match(executionOutput, /delay_likely/);
  assert.match(executionOutput, /local_review/);
  assert.match(executionOutput, /"sent":\s*false/);
  assert.match(executionOutput, /"n8n_status":\s*"succeeded"/);
  const attestedExecutionId = executionOutput.match(/"external_execution_id":\s*"([0-9]+)"/)?.[1];
  assert.match(attestedExecutionId ?? "", /^[0-9]+$/);

  compose("up", "-d", "--wait", "n8n");
  await waitForN8nRest();
  const executionObservation = await n8nRequest(
    `/api/v1/executions/${attestedExecutionId}?includeData=true`, {
    headers: { "x-n8n-api-key": n8nApiKey }
  });
  assert.equal(executionObservation.response.status, 200, JSON.stringify(executionObservation.body));
  const observedExecution = executionObservation.body.id === undefined
    ? responseData(executionObservation.body)
    : executionObservation.body;
  const observedFingerprint = buildN8nExecutionWorkflowFingerprint(observedExecution);
  assert.equal(observedFingerprint.execution_workflow_material_digest,
    executionFingerprint.execution_workflow_material_digest,
    `deployed=${executionFingerprint.execution_workflow_material_digest} executed=${observedFingerprint.execution_workflow_material_digest}`);

  const traceId = await waitForTrace();
  const traceResponse = await request(`/diagnostic/v0/external-activity-traces/${traceId}`, {
    headers: { authorization: "Bearer local-development-bootstrap-token" }
  });
  assert.equal(traceResponse.response.status, 200);
  const trace = traceResponse.body.external_activity_trace;
  assert.equal(trace.workflow_id, "workflow:inventory-follow-up");
  assert.equal(trace.revision_id, registered.revision_id);
  assert.equal(trace.adapter.adapter_id, "alphonse.n8n.runtime");
  assert.equal(trace.projection.current_lifecycle_claim, "succeeded");
  assert.equal(trace.authority.kernel_run, "not_created");

  const exactRevision = await request(`/diagnostic/v0/agent-revisions/${registered.revision_id}`, {
    headers: { authorization: "Bearer local-development-bootstrap-token" }
  });
  assert.deepEqual(exactRevision.body.agent_revision.runtime, material.runtime);
  assert.deepEqual(exactRevision.body.agent_revision.nodes, material.nodes);
  assert.deepEqual(exactRevision.body.agent_revision.model, material.model);
  assert.deepEqual(exactRevision.body.agent_revision.configuration, material.configuration);
  assert.deepEqual(exactRevision.body.agent_revision.adapter, material.adapter);

  const artifact = await request(`/diagnostic/v0/artifacts/${registered.snapshot_digest}`, {
    headers: { authorization: "Bearer local-development-bootstrap-token" }
  });
  assert.equal(artifact.body.artifact.verified, true);
  assert.deepEqual(artifact.body.artifact.content, {
    workflow_id: "workflow:inventory-follow-up",
    ...material
  });

  const kernelRuns = sql("alphonse_kernel", "alphonse", "local-development-only",
    "select count(*) from kernel_runs");
  assert.equal(kernelRuns, "0");
  const diagnosticDump = compose("exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only pg_dump -U alphonse_diagnostic -d alphonse_diagnostic --data-only").stdout;
  assert.doesNotMatch(diagnosticDump, new RegExp(adapterSecret));
  assert.equal(diagnosticDump.includes(n8nApiKey), false);
  assert.doesNotMatch(executionOutput, /send email|inventory write|aws/i);

  passed = true;
  console.log(JSON.stringify({
    ticket: "v0.2-03",
    n8n_version: "2.25.7",
    imported_workflows: 2,
    n8n_execution_status: "succeeded",
    wrong_result: "missing_sku -> zero_inventory -> delay_draft",
    delivery: "local_review",
    trace_id: traceId,
    exact_revision_resolved: true,
    kernel_runs_created: 0,
    provider_credentials_persisted_by_alphonse: false,
    external_effects: 0,
    aws_activity: false
  }, null, 2));
} finally {
  if (!passed) {
    try {
      console.error(compose("logs", "--no-color", "postgres", "diagnostic-bootstrap", "kernel",
        "n8n-runtime-adapter", "n8n").stdout);
    } catch {}
  }
  try { compose("down", "--volumes", "--remove-orphans"); } catch {}
}
