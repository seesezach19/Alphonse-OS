import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildN8nRevisionMaterial } from "../packages/n8n-operational-package/src/index.js";
import { signRuntimeEventEnvelope } from "../src/runtime-event-envelope.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages", "n8n-operational-package");
const baseUrl = "http://127.0.0.1:43204";
const project = `alphonse-v02-ticket04-${process.pid}`;
const adapterKeyId = "n8n-runtime-key-v1";
const adapterSecret = "local-n8n-runtime-event-secret-with-sufficient-length-v1";
const composeFiles = ["-f", "compose.yaml", "-f", "packages/n8n-operational-package/compose.customer.yaml"];
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  KERNEL_PORT: "43204",
  POSTGRES_PORT: "45504",
  N8N_PORT: "45674",
  ALPHONSE_URL: baseUrl,
  ALPHONSE_TOKEN: "local-development-bootstrap-token",
  DIAGNOSTIC_RUNTIME_ADAPTER_ID: "alphonse.n8n.runtime",
  DIAGNOSTIC_RUNTIME_ADAPTER_VERSION: "0.2.0",
  DIAGNOSTIC_RUNTIME_ADAPTER_KEY_ID: adapterKeyId,
  DIAGNOSTIC_RUNTIME_ADAPTER_SECRET: adapterSecret,
  ALPHONSE_RUNTIME_ADAPTER_KEY_ID: adapterKeyId,
  ALPHONSE_RUNTIME_ADAPTER_SECRET: adapterSecret
};
const headers = {
  authorization: "Bearer local-development-bootstrap-token",
  "content-type": "application/json"
};
let passed = false;

function run(command, args, { allowFailure = false, timeout = 8 * 60_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd: root, env: environment, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    timeout, windowsHide: true
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

async function command(route, body) {
  return request(route, { method: "POST", headers, body: JSON.stringify(body) });
}

function cli(...args) {
  const result = run(process.execPath, ["src/diagnostic-cli.js", ...args]);
  return JSON.parse(result.stdout);
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait", "postgres", "diagnostic-bootstrap", "kernel", "n8n-runtime-adapter");

  const packageManifest = await jsonFile("operational-package.json");
  const workflowJson = await jsonFile("workflows/inventory-follow-up-defective.json");
  const reporterJson = await jsonFile("workflows/alphonse-event-reporter.json");
  const material = buildN8nRevisionMaterial({ packageManifest, workflow: workflowJson, reporter: reporterJson });

  const workflow = await command("/diagnostic/v0/agent-workflows", {
    command_id: "v02-ticket04-workflow",
    operation_id: "diagnostic.agent_workflow.register",
    input: {
      workflow_id: "workflow:inventory-follow-up",
      display_name: "Inventory Follow-up - Defective Missing SKU Mapping",
      objective: "Compare deterministic inventory fixtures and route a follow-up draft only to local review.",
      external_ref: { system: "n8n", workflow_key: workflowJson.id, environment: "customer-local" }
    }
  });
  assert.equal(workflow.response.status, 201, JSON.stringify(workflow.body));
  const revision = await command("/diagnostic/v0/agent-revisions", {
    command_id: "v02-ticket04-revision",
    operation_id: "diagnostic.agent_revision.register",
    input: { workflow_id: "workflow:inventory-follow-up", ...material }
  });
  assert.equal(revision.response.status, 201, JSON.stringify(revision.body));
  const revisionId = revision.body.agent_revision.revision_id;

  const event = {
    schema_version: "0.2.0",
    adapter: { adapter_id: "alphonse.n8n.runtime", adapter_version: "0.2.0" },
    workflow_id: "workflow:inventory-follow-up",
    revision_id: revisionId,
    external_execution_id: "n8n-404",
    event_id: "n8n-404-succeeded",
    event_sequence: 1,
    lifecycle_claim: "succeeded",
    correlation_id: "inventory-ORDER-FIXTURE-42",
    idempotency_key: "n8n-404:1",
    occurred_at: new Date().toISOString(),
    payload: { digest: `sha256:${"4".repeat(64)}`, reference: null }
  };
  const signedAt = new Date().toISOString();
  const auth = signRuntimeEventEnvelope(event, { keyId: adapterKeyId, secret: adapterSecret, signedAt });
  const eventResponse = await request("/diagnostic/v0/runtime-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alphonse-runtime-key-id": auth.key_id,
      "x-alphonse-runtime-signed-at": auth.signed_at,
      "x-alphonse-runtime-signature": auth.signature
    },
    body: JSON.stringify(event)
  });
  assert.equal(eventResponse.response.status, 201, JSON.stringify(eventResponse.body));
  const traceId = eventResponse.body.trace_id;

  const report = await command("/diagnostic/v0/cases", {
    command_id: "v02-ticket04-report",
    operation_id: "diagnostic.case.report_failure",
    input: { trace_id: traceId, summary: "n8n succeeded but drafted a false customer delay for an unknown ERP SKU." }
  });
  assert.equal(report.response.status, 201, JSON.stringify(report.body));
  const caseId = report.body.diagnostic_case.case_id;
  assert.equal(report.body.diagnostic_case.revision_id, revisionId);
  assert.equal(report.body.diagnostic_case.projection.state, "open");

  const specificationInput = {
    case_id: caseId,
    expected_behavior: "inventory_unknown -> human_review",
    actual_behavior: "missing_sku -> zero_inventory -> delay_draft",
    reproduction_conditions: ["ERP fixture has no matching SKU", "storefront fixture reports stock"],
    targeted_verification: {
      expected_behavior: "inventory_unknown -> human_review",
      prohibited_behavior: "customer_delay_follow_up"
    }
  };
  const specification = await command("/diagnostic/v0/failure-specifications", {
    command_id: "v02-ticket04-spec",
    operation_id: "diagnostic.failure_specification.confirm",
    input: specificationInput
  });
  assert.equal(specification.response.status, 201, JSON.stringify(specification.body));
  assert.equal(specification.body.failure_specification.confirmed_by.type, "human");
  const alteredSpec = await command("/diagnostic/v0/failure-specifications", {
    command_id: "v02-ticket04-altered-spec",
    operation_id: "diagnostic.failure_specification.confirm",
    input: {
      ...specificationInput,
      expected_behavior: "model-decides",
      targeted_verification: { ...specificationInput.targeted_verification, expected_behavior: "model-decides" }
    }
  });
  assert.equal(alteredSpec.response.status, 409);
  assert.equal(alteredSpec.body.error.code, "FAILURE_SPECIFICATION_IMMUTABLE");

  const incomplete = await command("/diagnostic/v0/reproductions", {
    command_id: "v02-ticket04-incomplete",
    operation_id: "diagnostic.reproduction.create",
    input: {
      case_id: caseId,
      fixture_bindings: {
        erp: "erp:unsupported", storefront: "storefront:in-stock-v1",
        model: "model:deterministic-follow-up-v1", review: "review:local-only-v1"
      },
      assumptions: ["unsupported ERP fixture demonstrates an incomplete attempt"]
    }
  });
  assert.equal(incomplete.response.status, 201, JSON.stringify(incomplete.body));
  assert.equal(incomplete.body.reproduction_attempt.outcome, "incomplete");
  assert.equal(incomplete.body.reproduction_bundle, null);
  let caseView = (await request(`/diagnostic/v0/cases/${caseId}`, { headers })).body.diagnostic_case;
  assert.equal(caseView.projection.state, "specified");

  const rejected = await command("/diagnostic/v0/reproductions", {
    command_id: "v02-ticket04-rejected",
    operation_id: "diagnostic.reproduction.create",
    input: {
      case_id: caseId,
      fixture_bindings: {
        erp: "erp:matching-sku-v1", storefront: "storefront:in-stock-v1",
        model: "model:deterministic-follow-up-v1", review: "review:local-only-v1"
      },
      assumptions: ["matching SKU must not demonstrate the reported missing-SKU defect"]
    }
  });
  assert.equal(rejected.response.status, 201, JSON.stringify(rejected.body));
  assert.equal(rejected.body.reproduction_attempt.outcome, "rejected");
  assert.equal(rejected.body.reproduction_attempt.reason_code, "ORIGINAL_DEFECT_NOT_DEMONSTRATED");
  caseView = (await request(`/diagnostic/v0/cases/${caseId}`, { headers })).body.diagnostic_case;
  assert.equal(caseView.projection.state, "specified");

  const validInput = {
    case_id: caseId,
    fixture_bindings: {
      erp: "erp:missing-sku-v1", storefront: "storefront:in-stock-v1",
      model: "model:deterministic-follow-up-v1", review: "review:local-only-v1"
    },
    assumptions: ["fixtures are deterministic", "delivery remains local review only"]
  };
  const demonstrated = await command("/diagnostic/v0/reproductions", {
    command_id: "v02-ticket04-demonstrated",
    operation_id: "diagnostic.reproduction.create",
    input: validInput
  });
  assert.equal(demonstrated.response.status, 201, JSON.stringify(demonstrated.body));
  assert.equal(demonstrated.body.reproduction_attempt.outcome, "demonstrated");
  assert.equal(demonstrated.body.reproduction_bundle.reproduction_status, "demonstrated");
  const firstBundle = demonstrated.body.reproduction_bundle;

  const reused = await command("/diagnostic/v0/reproductions", {
    command_id: "v02-ticket04-reuse",
    operation_id: "diagnostic.reproduction.create",
    input: validInput
  });
  assert.equal(reused.response.status, 201);
  assert.equal(reused.body.reproduction_bundle.bundle_id, firstBundle.bundle_id);
  assert.equal(reused.body.created, false);

  const changed = await command("/diagnostic/v0/reproductions", {
    command_id: "v02-ticket04-changed",
    operation_id: "diagnostic.reproduction.create",
    input: { ...validInput, assumptions: [...validInput.assumptions, "second immutable bundle"] }
  });
  assert.equal(changed.response.status, 201, JSON.stringify(changed.body));
  assert.notEqual(changed.body.reproduction_bundle.bundle_id, firstBundle.bundle_id);
  assert.notEqual(changed.body.reproduction_bundle.artifact_digest, firstBundle.artifact_digest);
  const secondBundle = changed.body.reproduction_bundle;

  const artifact = await request(`/diagnostic/v0/artifacts/${firstBundle.artifact_digest}`, { headers });
  assert.equal(artifact.response.status, 200);
  assert.equal(artifact.body.artifact.verified, true);
  assert.equal(artifact.body.artifact.content.redacted_inputs.customer_email, "[REDACTED]");
  assert.equal(artifact.body.artifact.content.reproduction.actual_behavior,
    "missing_sku -> zero_inventory -> delay_draft");
  assert.deepEqual(artifact.body.artifact.content.redaction.redacted_paths, ["input.customer_email"]);
  assert.ok(artifact.body.artifact.content.redaction.omitted_paths.includes("credentials"));
  assert.equal(artifact.body.artifact.content.revision.revision_id, revisionId);

  const traversal = await request("/diagnostic/v0/artifacts/not-a-digest", { headers });
  assert.equal(traversal.response.status, 400);
  assert.equal(traversal.body.error.code, "INVALID_ARTIFACT_DIGEST");

  const retired = await command("/diagnostic/v0/artifact-retirements", {
    command_id: "v02-ticket04-retire",
    operation_id: "diagnostic.artifact.retire",
    input: { artifact_digest: secondBundle.artifact_digest, reason: "customer retention selection" }
  });
  assert.equal(retired.response.status, 201, JSON.stringify(retired.body));
  assert.equal(retired.body.artifact_tombstone.bytes_deleted, true);
  const tombstone = await request(`/diagnostic/v0/artifacts/${secondBundle.artifact_digest}`, { headers });
  assert.equal(tombstone.body.artifact.retention_state, "deleted");
  assert.equal(tombstone.body.artifact.content, null);
  assert.equal(tombstone.body.artifact.tombstone.retained_identity, true);

  caseView = cli("get-case", caseId).diagnostic_case;
  assert.equal(caseView.projection.state, "reproducible");
  assert.deepEqual(caseView.projection.legal_next_operations, ["diagnostic.repair_task.create"]);
  assert.equal(caseView.reproduction_attempts.length, 4);
  assert.equal(caseView.reproduction_bundles.length, 2);
  assert.equal(caseView.reproduction_bundles.find((bundle) => bundle.bundle_id === secondBundle.bundle_id).retention_state,
    "deleted");

  const diagnosticDump = compose("exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only pg_dump -U alphonse_diagnostic -d alphonse_diagnostic --data-only").stdout;
  assert.doesNotMatch(diagnosticDump, /private-customer@example\.test|not required for reproduction|not-exposed/);
  assert.equal(sql("alphonse_kernel", "alphonse", "local-development-only", "select count(*) from kernel_runs"), "0");

  passed = true;
  console.log(JSON.stringify({
    ticket: "v0.2-04",
    case_state: caseView.projection.state,
    human_confirmed_specification: true,
    incomplete_attempts_preserved: 1,
    rejected_attempts_preserved: 1,
    demonstrated_attempts: 2,
    immutable_bundles: 2,
    identical_bundle_reused: true,
    sensitive_detail_persisted: false,
    tombstones_preserved: 1,
    kernel_runs_created: 0,
    aws_activity: false
  }, null, 2));
} finally {
  if (!passed) {
    try { console.error(compose("logs", "--no-color", "postgres", "diagnostic-bootstrap", "kernel", "n8n-runtime-adapter").stdout); } catch {}
  }
  try { compose("down", "--volumes", "--remove-orphans"); } catch {}
}
