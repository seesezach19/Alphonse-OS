import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildN8nRevisionMaterial } from "../packages/n8n-operational-package/src/index.js";
import { RepairWorkerClient } from "../src/repair-worker-client.js";
import { signRuntimeEventEnvelope } from "../src/runtime-event-envelope.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages", "n8n-operational-package");
const baseUrl = process.env.ALPHONSE_ACCEPTANCE_URL ?? "http://127.0.0.1:43205";
const project = process.env.ALPHONSE_ACCEPTANCE_PROJECT ?? `alphonse-v02-ticket05-${process.pid}`;
const ownerToken = "local-development-bootstrap-token";
const workerToken = "ticket-05-repair-worker-token-0000000000000001";
const adapterKeyId = "n8n-runtime-key-v1";
const adapterSecret = "local-n8n-runtime-event-secret-with-sufficient-length-v1";
const composeFiles = ["-f", "compose.yaml", "-f", "packages/n8n-operational-package/compose.customer.yaml"];
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  KERNEL_PORT: process.env.ALPHONSE_ACCEPTANCE_KERNEL_PORT ?? "43205",
  POSTGRES_PORT: process.env.ALPHONSE_ACCEPTANCE_POSTGRES_PORT ?? "45505",
  N8N_PORT: process.env.ALPHONSE_ACCEPTANCE_N8N_PORT ?? "45675",
  ALPHONSE_URL: baseUrl,
  ALPHONSE_TOKEN: ownerToken,
  ALPHONSE_AGENT_TOKEN: workerToken,
  DIAGNOSTIC_RUNTIME_ADAPTER_ID: "alphonse.n8n.runtime",
  DIAGNOSTIC_RUNTIME_ADAPTER_VERSION: "0.2.0",
  DIAGNOSTIC_RUNTIME_ADAPTER_KEY_ID: adapterKeyId,
  DIAGNOSTIC_RUNTIME_ADAPTER_SECRET: adapterSecret
};
const ownerHeaders = { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" };
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

async function request(route, { method = "GET", headers = ownerHeaders, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  return { response, body: result };
}

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

async function ownerCommand(route, commandId, operationId, input) {
  return request(route, { method: "POST", body: command(commandId, operationId, input) });
}

async function agentCommand(route, commandId, operationId, input) {
  return request(route, {
    method: "POST",
    headers: { authorization: `Agent ${workerToken}`, "content-type": "application/json" },
    body: command(commandId, operationId, input)
  });
}

async function createTask(index, caseId, registrationId, bundleId, leaseDurationSeconds = 30) {
  const created = await ownerCommand("/diagnostic/v0/repair-tasks", `v02-ticket05-task-${index}`,
    "diagnostic.repair_task.create", {
      case_id: caseId,
      worker_registration_id: registrationId,
      reproduction_bundle_id: bundleId,
      allowed_operations: ["artifact.read", "candidate.submit", "task.heartbeat", "task.fail", "task.release"],
      artifact_limits: {
        max_artifact_bytes: 131072,
        max_total_bytes: 262144,
        allowed_media_types: ["application/json"]
      },
      lease_duration_seconds: leaseDurationSeconds,
      expected_outputs: ["repair_candidate", "targeted_regression", "worker_logs"]
    });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  return created.body.repair_task;
}

function validOutput(workerKind = "test-worker") {
  return {
    intended_behavior_change: "Preserve inventory_unknown and route human review without drafting a delay.",
    candidate_artifact: {
      media_type: "application/json",
      content: {
        format: "provider-neutral-repair-patch",
        changes: [
          { operation: "replace", path: "missing_sku", value: "inventory_unknown" },
          { operation: "replace", path: "inventory_unknown.next", value: "human_review" }
        ]
      }
    },
    targeted_regression_artifact: {
      media_type: "application/json",
      content: {
        fixture: "erp:missing-sku-v1",
        expected_behavior: "inventory_unknown -> human_review",
        prohibited_behavior: "customer_delay_follow_up"
      }
    },
    logs_artifact: {
      media_type: "application/json",
      content: { steps: ["loaded exact task artifacts", "created repair", "added targeted regression"] }
    },
    runtime_attribution: {
      worker_kind: workerKind,
      runtime_version: "1.0.0",
      attachment_version: "0.2.0"
    }
  };
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait", "postgres", "diagnostic-bootstrap", "kernel", "n8n-runtime-adapter");

  const packageManifest = await jsonFile("operational-package.json");
  const workflowJson = await jsonFile("workflows/inventory-follow-up-defective.json");
  const reporterJson = await jsonFile("workflows/alphonse-event-reporter.json");
  const material = buildN8nRevisionMaterial({ packageManifest, workflow: workflowJson, reporter: reporterJson });

  const workflow = await ownerCommand("/diagnostic/v0/agent-workflows", "v02-ticket05-workflow",
    "diagnostic.agent_workflow.register", {
      workflow_id: "workflow:inventory-follow-up",
      display_name: "Inventory Follow-up - Defective Missing SKU Mapping",
      objective: "Compare inventory fixtures and route a follow-up draft only to local review.",
      external_ref: { system: "n8n", workflow_key: workflowJson.id, environment: "customer-local" }
    });
  assert.equal(workflow.response.status, 201, JSON.stringify(workflow.body));
  const revision = await ownerCommand("/diagnostic/v0/agent-revisions", "v02-ticket05-revision",
    "diagnostic.agent_revision.register", { workflow_id: "workflow:inventory-follow-up", ...material });
  assert.equal(revision.response.status, 201, JSON.stringify(revision.body));
  const revisionId = revision.body.agent_revision.revision_id;

  const runtimeEvent = {
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
  const signature = signRuntimeEventEnvelope(runtimeEvent, {
    keyId: adapterKeyId, secret: adapterSecret, signedAt
  });
  const event = await request("/diagnostic/v0/runtime-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alphonse-runtime-key-id": signature.key_id,
      "x-alphonse-runtime-signed-at": signature.signed_at,
      "x-alphonse-runtime-signature": signature.signature
    },
    body: runtimeEvent
  });
  assert.equal(event.response.status, 201, JSON.stringify(event.body));

  const report = await ownerCommand("/diagnostic/v0/cases", "v02-ticket05-report",
    "diagnostic.case.report_failure", {
      trace_id: event.body.trace_id,
      summary: "n8n succeeded but drafted a false customer delay for an unknown ERP SKU."
    });
  assert.equal(report.response.status, 201, JSON.stringify(report.body));
  const caseId = report.body.diagnostic_case.case_id;
  const specification = await ownerCommand("/diagnostic/v0/failure-specifications", "v02-ticket05-spec",
    "diagnostic.failure_specification.confirm", {
      case_id: caseId,
      expected_behavior: "inventory_unknown -> human_review",
      actual_behavior: "missing_sku -> zero_inventory -> delay_draft",
      reproduction_conditions: ["ERP fixture has no matching SKU", "storefront fixture reports stock"],
      targeted_verification: {
        expected_behavior: "inventory_unknown -> human_review",
        prohibited_behavior: "customer_delay_follow_up"
      }
    });
  assert.equal(specification.response.status, 201, JSON.stringify(specification.body));
  const reproduction = await ownerCommand("/diagnostic/v0/reproductions", "v02-ticket05-reproduction",
    "diagnostic.reproduction.create", {
      case_id: caseId,
      fixture_bindings: {
        erp: "erp:missing-sku-v1",
        storefront: "storefront:in-stock-v1",
        model: "model:deterministic-follow-up-v1",
        review: "review:local-only-v1"
      },
      assumptions: ["fixtures are deterministic", "delivery remains local review only"]
    });
  assert.equal(reproduction.response.status, 201, JSON.stringify(reproduction.body));
  const bundleId = reproduction.body.reproduction_bundle.bundle_id;

  const human = await ownerCommand("/kernel/v0/principals", "v02-ticket05-human",
    "kernel.principal.create", { principal_type: "human", display_name: "Repair Sponsor" });
  assert.equal(human.response.status, 201, JSON.stringify(human.body));
  const agent = await ownerCommand("/kernel/v0/principals", "v02-ticket05-agent",
    "kernel.principal.create", { principal_type: "agent", display_name: "Customer Repair Worker" });
  assert.equal(agent.response.status, 201, JSON.stringify(agent.body));
  const now = Date.now();
  const passport = await ownerCommand("/kernel/v0/agent-passports", "v02-ticket05-passport",
    "kernel.agent_passport.issue", {
      agent_principal_id: agent.body.principal.principal_id,
      sponsor_principal_id: human.body.principal.principal_id,
      runtime: { kind: "customer-controlled", version: "replaceable" },
      model_configuration: { provider: "customer-selected", model: "not-persisted-by-diagnostic-plane" },
      package_skill_configuration: { protocol: "alphonse-repair-worker-0.2.0" },
      agent_authentication_token: workerToken,
      permitted_intent_classes: ["repair_work"],
      provenance: { source: "ticket-05-acceptance" },
      valid_from: new Date(now - 60000).toISOString(),
      expires_at: new Date(now + 3600000).toISOString()
    });
  assert.equal(passport.response.status, 201, JSON.stringify(passport.body));
  const passportId = passport.body.passport.passport_id;
  const proposal = await agentCommand("/kernel/v0/work-intent-proposals", "v02-ticket05-intent-proposal",
    "kernel.work_intent.propose", {
      passport_id: passportId,
      intent_class: "repair_work",
      objective: "Repair the demonstrated missing-SKU inventory behavior.",
      requested_outcome: "Return one inactive candidate and targeted regression.",
      scope: { case_id: caseId, base_revision_id: revisionId },
      constraints: { no_verification: true, no_promotion: true, no_external_effects: true }
    });
  assert.equal(proposal.response.status, 201, JSON.stringify(proposal.body));
  const intent = await ownerCommand(
    `/kernel/v0/work-intent-proposals/${proposal.body.proposal.proposal_id}/confirm`,
    "v02-ticket05-intent-confirm", "kernel.work_intent.confirm", {}
  );
  assert.equal(intent.response.status, 201, JSON.stringify(intent.body));
  const workIntentId = intent.body.work_intent.work_intent_id;

  const worker = new RepairWorkerClient({ baseUrl, agentToken: workerToken });
  const registration = await worker.register("v02-ticket05-worker-register", {
    passport_id: passportId,
    work_intent_id: workIntentId,
    protocol_version: "0.2.0",
    runtime_attribution: {
      worker_kind: "test-worker",
      runtime_version: "1.0.0",
      attachment_version: "0.2.0"
    }
  });
  assert.equal(registration.repair_worker.provider_credentials_stored, false);
  assert.equal(registration.repair_worker.repository_credentials_stored, false);
  const registrationId = registration.repair_worker.registration_id;

  const expiredTask = await createTask(1, caseId, registrationId, bundleId, 5);
  const expiredClaim = await worker.claim("v02-ticket05-claim-1", expiredTask.task_id);
  assert.equal(expiredClaim.repair_task.projection.state, "leased");
  await new Promise((resolve) => setTimeout(resolve, 6200));
  await assert.rejects(worker.submit("v02-ticket05-expired-submit", expiredTask.task_id,
    expiredTask.lease_epoch, validOutput()), (error) => error.code === "LEASE_EXPIRED");
  const expiredView = await request(`/diagnostic/v0/repair-tasks/${expiredTask.task_id}`);
  assert.equal(expiredView.body.repair_task.projection.state, "expired");

  const invalidTask = await createTask(2, caseId, registrationId, bundleId);
  const invalidClaim = await worker.claim("v02-ticket05-claim-2", invalidTask.task_id);
  const invalidOutput = validOutput();
  invalidOutput.runtime_attribution.provider_token = "must-never-be-persisted";
  const invalidSubmission = await worker.submit("v02-ticket05-invalid-submit", invalidTask.task_id,
    invalidClaim.repair_task.lease_epoch, invalidOutput);
  assert.equal(invalidSubmission.submission_attempt.status, "rejected");
  assert.equal(invalidSubmission.submission_attempt.reason_code, "SENSITIVE_WORKER_OUTPUT_REJECTED");
  assert.equal(invalidSubmission.repair_candidate, null);
  assert.equal(invalidSubmission.repair_task.projection.state, "failed");

  const timeoutTask = await createTask(3, caseId, registrationId, bundleId);
  const timeoutClaim = await worker.claim("v02-ticket05-claim-3", timeoutTask.task_id);
  const timeout = await worker.fail("v02-ticket05-timeout", timeoutTask.task_id,
    timeoutClaim.repair_task.lease_epoch, "timeout", "customer worker exceeded its local deadline");
  assert.equal(timeout.repair_task.projection.state, "failed");
  assert.equal(timeout.repair_task.events.at(-1).reason_code, "TIMEOUT");

  const lostTask = await createTask(4, caseId, registrationId, bundleId);
  const lostClaim = await worker.claim("v02-ticket05-claim-4", lostTask.task_id);
  const lost = await worker.fail("v02-ticket05-process-loss", lostTask.task_id,
    lostClaim.repair_task.lease_epoch, "process_loss", "customer worker process exited before submission");
  assert.equal(lost.repair_task.events.at(-1).reason_code, "PROCESS_LOSS");

  const releasedTask = await createTask(5, caseId, registrationId, bundleId);
  const releasedClaim = await worker.claim("v02-ticket05-claim-5", releasedTask.task_id);
  const released = await worker.release("v02-ticket05-release", releasedTask.task_id,
    releasedClaim.repair_task.lease_epoch, "worker stopping cleanly");
  assert.equal(released.repair_task.projection.state, "released");

  const cancelledTask = await createTask(6, caseId, registrationId, bundleId);
  const cancelledClaim = await worker.claim("v02-ticket05-claim-6", cancelledTask.task_id);
  const cancelled = await ownerCommand(`/diagnostic/v0/repair-tasks/${cancelledTask.task_id}/cancel`,
    "v02-ticket05-cancel", "diagnostic.repair_task.cancel", {
      task_id: cancelledTask.task_id, reason: "customer cancelled this attempt"
    });
  assert.equal(cancelled.response.status, 201, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.repair_task.projection.state, "cancelled");
  await assert.rejects(worker.submit("v02-ticket05-cancelled-submit", cancelledTask.task_id,
    cancelledClaim.repair_task.lease_epoch, validOutput()), (error) => error.code === "LEASE_NOT_ACTIVE");

  const task = await createTask(7, caseId, registrationId, bundleId);
  assert.equal(task.previous_task_id, cancelledTask.task_id);
  assert.equal(task.lease_epoch, 7);
  const discovered = await worker.discover();
  assert.deepEqual(discovered.repair_tasks.map((item) => item.task_id), [task.task_id]);
  const claim = await worker.claim("v02-ticket05-claim-7", task.task_id);
  assert.equal(claim.workspace_manifest.files.length, 2);
  assert.equal(claim.workspace_manifest.ambient_filesystem_access, false);
  assert.equal(claim.workspace_manifest.authority.promotion, "not_granted");
  const heartbeat = await worker.heartbeat("v02-ticket05-heartbeat", task.task_id,
    claim.repair_task.lease_epoch, "candidate and regression prepared");
  assert.equal(heartbeat.repair_task.projection.state, "leased");

  await assert.rejects(worker.retrieveArtifact(task.task_id, `sha256:${"f".repeat(64)}`),
    (error) => error.code === "REPAIR_ARTIFACT_SCOPE_DENIED");
  let materializedRoot;
  const output = await worker.withWorkspace(claim, async ({ root: workspaceRoot }) => {
    materializedRoot = workspaceRoot;
    const baseRevision = JSON.parse(await readFile(path.join(workspaceRoot, "inputs", "base-revision.json"), "utf8"));
    const bundle = JSON.parse(await readFile(path.join(workspaceRoot, "inputs", "reproduction-bundle.json"), "utf8"));
    assert.equal(bundle.case_id, caseId);
    assert.equal(bundle.revision.revision_id, revisionId);
    assert.equal(baseRevision.workflow_content.primary_workflow.id, workflowJson.id);
    return validOutput();
  });
  await assert.rejects(readFile(path.join(materializedRoot, "task.json"), "utf8"));

  const submission = await worker.submit("v02-ticket05-submit", task.task_id,
    claim.repair_task.lease_epoch, output);
  assert.equal(submission.repair_candidate.status, "proposed");
  assert.equal(submission.repair_candidate.base_revision_id, revisionId);
  assert.equal(submission.repair_candidate.authority.verification, "not_granted");
  assert.equal(submission.repair_candidate.authority.promotion, "not_granted");
  const candidateId = submission.repair_candidate.candidate_id;
  const replay = await worker.submit("v02-ticket05-submit", task.task_id,
    claim.repair_task.lease_epoch, output);
  assert.deepEqual(replay, submission);
  const conflictOutput = validOutput("conflicting-worker");
  await assert.rejects(worker.submit("v02-ticket05-submit", task.task_id,
    claim.repair_task.lease_epoch, conflictOutput), (error) => error.code === "IDEMPOTENCY_CONFLICT");

  const selfCancel = await agentCommand(`/diagnostic/v0/repair-tasks/${task.task_id}/cancel`,
    "v02-ticket05-worker-self-cancel", "diagnostic.repair_task.cancel", {
      task_id: task.task_id, reason: "attempt owner authority"
    });
  assert.equal(selfCancel.response.status, 403);

  const caseView = (await request(`/diagnostic/v0/cases/${caseId}`)).body.diagnostic_case;
  assert.equal(caseView.projection.state, "candidate_available");
  assert.equal(caseView.repair_tasks.length, 7);
  assert.equal(caseView.repair_candidates.length, 1);
  assert.equal(caseView.repair_candidates[0].candidate_id, candidateId);
  assert.equal(caseView.repair_candidates[0].status, "proposed");

  const cliCandidate = JSON.parse(run(process.execPath,
    ["src/diagnostic-cli.js", "get-repair-candidate", candidateId]).stdout).repair_candidate;
  assert.equal(cliCandidate.material_digest, submission.repair_candidate.material_digest);

  const dump = compose("exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only pg_dump -U alphonse_diagnostic -d alphonse_diagnostic --data-only").stdout;
  assert.doesNotMatch(dump, new RegExp(workerToken));
  assert.doesNotMatch(dump, /must-never-be-persisted/);
  assert.equal(sql("alphonse_kernel", "alphonse", "local-development-only", "select count(*) from kernel_runs"), "0");

  process.env.ALPHONSE_TICKET05_CASE_ID = caseId;
  process.env.ALPHONSE_TICKET05_CANDIDATE_ID = candidateId;
  passed = true;
  console.log(JSON.stringify({
    ticket: "v0.2-05",
    repair_tasks_preserved: caseView.repair_tasks.length,
    expired_attempts: 1,
    invalid_attempts: 1,
    timeout_attempts: 1,
    process_loss_attempts: 1,
    released_attempts: 1,
    cancelled_attempts: 1,
    immutable_candidates: 1,
    duplicate_submission_replayed: true,
    stale_submission_fenced: true,
    ephemeral_workspace_destroyed: true,
    provider_credentials_stored: false,
    promotion_authority_granted: false,
    kernel_runs_created: 0,
    aws_activity: false
  }, null, 2));
} finally {
  if (!passed) {
    try {
      console.error(compose("logs", "--no-color", "postgres", "diagnostic-bootstrap", "kernel", "n8n-runtime-adapter").stdout);
    } catch {}
  }
  if (process.env.ALPHONSE_TICKET05_KEEP_STACK !== "1") {
    try { compose("down", "--volumes", "--remove-orphans"); } catch {}
  }
}
