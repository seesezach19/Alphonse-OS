import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = `alphonse-v02-ticket06-${process.pid}`;
const baseUrl = "http://127.0.0.1:43206";
const ownerToken = "local-development-bootstrap-token";
const workerToken = "ticket-05-repair-worker-token-0000000000000001";
const repairApiKey = "ticket-06-customer-owned-n8n-api-key-v1";
const credentialBindingRef = "customer-secret-store:n8n-repair-v1";
const composeFiles = ["-f", "compose.yaml", "-f", "packages/n8n-operational-package/compose.customer.yaml"];

Object.assign(process.env, {
  ALPHONSE_ACCEPTANCE_PROJECT: project,
  ALPHONSE_ACCEPTANCE_URL: baseUrl,
  ALPHONSE_ACCEPTANCE_KERNEL_PORT: "43206",
  ALPHONSE_ACCEPTANCE_POSTGRES_PORT: "45506",
  ALPHONSE_ACCEPTANCE_N8N_PORT: "45676",
  ALPHONSE_TICKET05_KEEP_STACK: "1",
  N8N_REPAIR_DELIVERY_URL: "http://n8n-runtime-adapter:5680/api/v1",
  N8N_REPAIR_DELIVERY_API_KEY: repairApiKey,
  N8N_REPAIR_DELIVERY_CREDENTIAL_BINDING_REF: credentialBindingRef
});

const environment = { ...process.env, COMPOSE_PROJECT_NAME: project };
const ownerHeaders = { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" };
const keepStack = process.env.ALPHONSE_TICKET06_KEEP_STACK === "1";
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

async function request(pathname, { method = "GET", body, headers = ownerHeaders } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  return { response, body: result };
}

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

try {
  await import("./acceptance-v0.2-ticket-05.js");

  const caseId = process.env.ALPHONSE_TICKET05_CASE_ID;
  const submittedCandidateId = process.env.ALPHONSE_TICKET05_CANDIDATE_ID;
  assert.ok(caseId);
  assert.ok(submittedCandidateId);
  const caseResult = await request(`/diagnostic/v0/cases/${caseId}`);
  assert.equal(caseResult.response.status, 200);
  const candidateId = caseResult.body.diagnostic_case.repair_candidates[0].candidate_id;
  assert.equal(candidateId, submittedCandidateId);
  assert.equal(caseResult.body.diagnostic_case.repair_candidates[0].status, "proposed");

  const contract = await request("/diagnostic/v0/repair-delivery-adapter-contract", { headers: {} });
  assert.equal(contract.response.status, 200);
  assert.equal(contract.body.operations.candidate.effect, "create_inactive_candidate");
  assert.equal(contract.body.operations.promotion.independently_declared, true);
  assert.doesNotMatch(JSON.stringify(contract.body), /n8n/i);

  const bindingId = "00000000-0000-4000-8000-000000000601";
  const bindingInput = {
    binding_id: bindingId,
    adapter: { adapter_id: "alphonse.n8n.repair-delivery", adapter_version: "0.2.0" },
    target: {
      system: "n8n", target_type: "workflow", target_id: "InventoryDefect1",
      environment: "customer-local"
    },
    external_credential_binding_ref: credentialBindingRef,
    permitted_operations: ["inspect", "snapshot", "candidate"],
    transition_policy: {
      candidate_initial_state: "inactive",
      require_expected_base_revision: true,
      preserve_prechange_snapshot: true,
      promotion_authority: "owner_only"
    }
  };
  const registered = await request("/diagnostic/v0/repair-delivery-bindings", {
    method: "POST",
    body: command("v02-ticket06-binding", "diagnostic.repair_delivery_binding.register", bindingInput)
  });
  assert.equal(registered.response.status, 201, JSON.stringify(registered.body));
  assert.equal(registered.body.repair_delivery_binding.secrets_stored, false);

  const inspected = await request(`/diagnostic/v0/repair-delivery-bindings/${bindingId}/target`);
  assert.equal(inspected.response.status, 200, JSON.stringify(inspected.body));
  assert.equal(inspected.body.target.active, true);
  assert.equal(inspected.body.target.target.target_id, "InventoryDefect1");
  const expectedBase = inspected.body.target.target_revision_digest;

  const input = {
    candidate_id: candidateId,
    binding_id: bindingId,
    expected_base_revision_digest: expectedBase,
    idempotency_key: "ticket-06-delivery-1"
  };
  const unauthorized = await request("/diagnostic/v0/repair-deliveries", {
    method: "POST",
    body: command("v02-ticket06-agent-denied", "diagnostic.repair_delivery.materialize", input),
    headers: { authorization: `Agent ${workerToken}`, "content-type": "application/json" }
  });
  assert.equal(unauthorized.response.status, 403);
  assert.equal(unauthorized.body.error.code, "OWNER_AUTHORITY_REQUIRED");

  const materialized = await request("/diagnostic/v0/repair-deliveries", {
    method: "POST",
    body: command("v02-ticket06-delivery", "diagnostic.repair_delivery.materialize", input)
  });
  assert.equal(materialized.response.status, 201, JSON.stringify(materialized.body));
  const delivery = materialized.body.repair_delivery;
  Object.assign(process.env, {
    ALPHONSE_TICKET06_CASE_ID: caseId,
    ALPHONSE_TICKET06_CANDIDATE_ID: candidateId,
    ALPHONSE_TICKET06_DELIVERY_ID: delivery.delivery_id,
    ALPHONSE_TICKET06_BINDING_ID: bindingId,
    ALPHONSE_TICKET06_EXPECTED_BASE: expectedBase
  });
  assert.equal(delivery.base.expected_target_revision_digest, expectedBase);
  assert.equal(delivery.base.actual_target_revision_digest, expectedBase);
  assert.equal(delivery.base.active_target_confirmed_unchanged, true);
  assert.equal(delivery.inactive_candidate.state, "inactive");
  assert.match(delivery.inactive_candidate.target_id, /^AlphonseCandidate/);
  assert.equal(delivery.projection.state, "inactive_candidate");
  assert.deepEqual(delivery.projection.legal_next_operations, ["diagnostic.repair_verification.create"]);
  assert.equal(delivery.projection.authority.promotion, "not_granted");

  const exactReplay = await request("/diagnostic/v0/repair-deliveries", {
    method: "POST",
    body: command("v02-ticket06-delivery", "diagnostic.repair_delivery.materialize", input)
  });
  assert.equal(exactReplay.response.status, 200);
  assert.equal(exactReplay.response.headers.get("idempotent-replayed"), "true");
  assert.equal(exactReplay.body.repair_delivery.delivery_id, delivery.delivery_id);

  const semanticRetry = await request("/diagnostic/v0/repair-deliveries", {
    method: "POST",
    body: command("v02-ticket06-delivery-retry", "diagnostic.repair_delivery.materialize", input)
  });
  assert.equal(semanticRetry.response.status, 201);
  assert.equal(semanticRetry.body.created, false);
  assert.equal(semanticRetry.body.repair_delivery.delivery_id, delivery.delivery_id);
  assert.equal(semanticRetry.body.repair_delivery.adapter_receipt_digest, delivery.adapter_receipt_digest);

  const conflict = await request("/diagnostic/v0/repair-deliveries", {
    method: "POST",
    body: command("v02-ticket06-delivery-conflict", "diagnostic.repair_delivery.materialize", {
      ...input, idempotency_key: "ticket-06-conflicting-delivery"
    })
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "REPAIR_DELIVERY_CONFLICT");

  const after = await request(`/diagnostic/v0/repair-delivery-bindings/${bindingId}/target`);
  assert.equal(after.body.target.target_revision_digest, expectedBase);
  assert.equal(after.body.target.active, true);

  const candidate = await request(`/diagnostic/v0/repair-candidates/${candidateId}`);
  assert.equal(candidate.body.repair_candidate.status, "verification_pending");
  const candidateArtifact = await request(
    `/diagnostic/v0/artifacts/${encodeURIComponent(delivery.inactive_candidate.artifact_digest)}`);
  assert.match(JSON.stringify(candidateArtifact.body), /inventory_unknown/);
  assert.match(JSON.stringify(candidateArtifact.body), /human_review/);
  assert.doesNotMatch(JSON.stringify(candidateArtifact.body), /customer_delay_follow_up/);
  const baseArtifact = await request(
    `/diagnostic/v0/artifacts/${encodeURIComponent(delivery.base.snapshot_artifact_digest)}`);
  assert.match(JSON.stringify(baseArtifact.body), /customer_delay_follow_up/);

  const dump = compose("exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only pg_dump -U alphonse_diagnostic -d alphonse_diagnostic --data-only").stdout;
  assert.doesNotMatch(dump, new RegExp(repairApiKey));
  assert.equal((dump.match(/AlphonseCandidate/g) ?? []).length > 0, true);

  passed = true;
  console.log(JSON.stringify({
    ticket: "v0.2-06",
    exact_base_revision_resolved: true,
    active_workflow_preserved: true,
    inactive_target_native_candidates: 1,
    base_snapshot_retained: true,
    candidate_representation_retained: true,
    duplicate_delivery_replayed: true,
    conflicting_retry_rejected: true,
    provider_credentials_stored: false,
    promotion_authority_granted: false,
    aws_activity: false
  }, null, 2));
} finally {
  if (!passed) {
    try {
      console.error(compose("logs", "--no-color", "postgres", "diagnostic-bootstrap", "kernel",
        "n8n-runtime-adapter").stdout);
    } catch {}
  }
  if (!keepStack) {
    try { compose("down", "--volumes", "--remove-orphans"); } catch {}
  }
}
