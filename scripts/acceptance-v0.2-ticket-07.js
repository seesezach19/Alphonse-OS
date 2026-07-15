import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RepairWorkerClient } from "../src/repair-worker-client.js";
import { signRuntimeEventEnvelope } from "../src/runtime-event-envelope.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = `alphonse-v02-ticket06-${process.pid}`;
const baseUrl = "http://127.0.0.1:43206";
const ownerToken = "local-development-bootstrap-token";
const priorWorkerToken = "ticket-05-repair-worker-token-0000000000000001";
const badWorkerToken = "ticket-07-bad-repair-worker-token-000000000000001";
const adapterKeyId = "n8n-runtime-key-v1";
const adapterSecret = "local-n8n-runtime-event-secret-with-sufficient-length-v1";
const runnerSigningSecret = "local-verification-runner-signing-secret-v1";
const composeFiles = ["-f", "compose.yaml", "-f", "packages/n8n-operational-package/compose.customer.yaml"];

Object.assign(process.env, { ALPHONSE_TICKET06_KEEP_STACK: "1" });
const environment = { ...process.env, COMPOSE_PROJECT_NAME: project };
const ownerHeaders = { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" };
const keepStack = process.env.ALPHONSE_TICKET07_KEEP_STACK === "1";
let passed = false;

function run(command, args, { timeout = 8 * 60_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd: root, env: environment, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    timeout, windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

function compose(...args) {
  return run("docker", ["compose", ...composeFiles, ...args]);
}

async function request(route, { method = "GET", headers = ownerHeaders, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
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

async function agentCommand(token, route, commandId, operationId, input) {
  return request(route, {
    method: "POST",
    headers: { authorization: `Agent ${token}`, "content-type": "application/json" },
    body: command(commandId, operationId, input)
  });
}

async function createBadCandidate(revisionId, bindingId, expectedBase) {
  const runtimeEvent = {
    schema_version: "0.2.0",
    adapter: { adapter_id: "alphonse.n8n.runtime", adapter_version: "0.2.0" },
    workflow_id: "workflow:inventory-follow-up",
    revision_id: revisionId,
    external_execution_id: "n8n-707",
    event_id: "n8n-707-succeeded",
    event_sequence: 1,
    lifecycle_claim: "succeeded",
    correlation_id: "inventory-ORDER-FIXTURE-42-bad-candidate",
    idempotency_key: "n8n-707:1",
    occurred_at: new Date().toISOString(),
    payload: { digest: `sha256:${"7".repeat(64)}`, reference: null }
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
  const report = await ownerCommand("/diagnostic/v0/cases", "v02-ticket07-bad-report",
    "diagnostic.case.report_failure", {
      trace_id: event.body.trace_id,
      summary: "Deliberately ineffective candidate must fail independent verification."
    });
  assert.equal(report.response.status, 201, JSON.stringify(report.body));
  const caseId = report.body.diagnostic_case.case_id;
  const specification = await ownerCommand("/diagnostic/v0/failure-specifications", "v02-ticket07-bad-spec",
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
  const reproduction = await ownerCommand("/diagnostic/v0/reproductions", "v02-ticket07-bad-reproduction",
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
  const human = await ownerCommand("/kernel/v0/principals", "v02-ticket05-human",
    "kernel.principal.create", { principal_type: "human", display_name: "Repair Sponsor" });
  const agent = await ownerCommand("/kernel/v0/principals", "v02-ticket07-bad-agent",
    "kernel.principal.create", { principal_type: "agent", display_name: "Bad Candidate Worker" });
  assert.equal(human.response.status, 200, JSON.stringify(human.body));
  assert.equal(agent.response.status, 201, JSON.stringify(agent.body));
  const now = Date.now();
  const passport = await ownerCommand("/kernel/v0/agent-passports", "v02-ticket07-bad-passport",
    "kernel.agent_passport.issue", {
      agent_principal_id: agent.body.principal.principal_id,
      sponsor_principal_id: human.body.principal.principal_id,
      runtime: { kind: "customer-controlled", version: "replaceable" },
      model_configuration: { provider: "fixture", model: "deliberately-ineffective" },
      package_skill_configuration: { protocol: "alphonse-repair-worker-0.2.0" },
      agent_authentication_token: badWorkerToken,
      permitted_intent_classes: ["repair_work"],
      provenance: { source: "ticket-07-acceptance" },
      valid_from: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 3_600_000).toISOString()
    });
  assert.equal(passport.response.status, 201, JSON.stringify(passport.body));
  const proposal = await agentCommand(badWorkerToken, "/kernel/v0/work-intent-proposals",
    "v02-ticket07-bad-intent-proposal", "kernel.work_intent.propose", {
      passport_id: passport.body.passport.passport_id,
      intent_class: "repair_work",
      objective: "Submit one deliberately ineffective candidate for verifier rejection.",
      requested_outcome: "Return one inactive candidate and targeted regression.",
      scope: { case_id: caseId, base_revision_id: revisionId },
      constraints: { no_verification: true, no_promotion: true, no_external_effects: true }
    });
  assert.equal(proposal.response.status, 201, JSON.stringify(proposal.body));
  const intent = await ownerCommand(
    `/kernel/v0/work-intent-proposals/${proposal.body.proposal.proposal_id}/confirm`,
    "v02-ticket07-bad-intent-confirm", "kernel.work_intent.confirm", {}
  );
  assert.equal(intent.response.status, 201, JSON.stringify(intent.body));
  const worker = new RepairWorkerClient({ baseUrl, agentToken: badWorkerToken });
  const registration = await worker.register("v02-ticket07-bad-worker-register", {
    passport_id: passport.body.passport.passport_id,
    work_intent_id: intent.body.work_intent.work_intent_id,
    protocol_version: "0.2.0",
    runtime_attribution: {
      worker_kind: "ticket-07-bad-worker", runtime_version: "1.0.0", attachment_version: "0.2.0"
    }
  });
  const task = await ownerCommand("/diagnostic/v0/repair-tasks", "v02-ticket07-bad-task",
    "diagnostic.repair_task.create", {
      case_id: caseId,
      worker_registration_id: registration.repair_worker.registration_id,
      reproduction_bundle_id: reproduction.body.reproduction_bundle.bundle_id,
      allowed_operations: ["artifact.read", "candidate.submit", "task.heartbeat", "task.fail", "task.release"],
      artifact_limits: {
        max_artifact_bytes: 131072, max_total_bytes: 262144,
        allowed_media_types: ["application/json"]
      },
      lease_duration_seconds: 30,
      expected_outputs: ["repair_candidate", "targeted_regression", "worker_logs"]
    });
  assert.equal(task.response.status, 201, JSON.stringify(task.body));
  const claim = await worker.claim("v02-ticket07-bad-claim", task.body.repair_task.task_id);
  const submission = await worker.submit("v02-ticket07-bad-submit", task.body.repair_task.task_id,
    claim.repair_task.lease_epoch, {
      intended_behavior_change: "Deliberately retain zero inventory and delay drafting for rejection proof.",
      candidate_artifact: {
        media_type: "application/json",
        content: {
          format: "provider-neutral-repair-patch",
          changes: [
            { operation: "replace", path: "missing_sku", value: "zero_inventory" },
            { operation: "replace", path: "zero_inventory.next", value: "delay_draft" }
          ]
        }
      },
      targeted_regression_artifact: {
        media_type: "application/json",
        content: {
          fixture: "erp:missing-sku-v1",
          expected_behavior: "inventory_unknown -> human_review",
          prohibited_behavior: "customer_delay_follow_up",
          scenario: "deliberately-bad-candidate"
        }
      },
      logs_artifact: {
        media_type: "application/json", content: { steps: ["submitted deliberate negative control"] }
      },
      runtime_attribution: {
        worker_kind: "ticket-07-bad-worker", runtime_version: "1.0.0", attachment_version: "0.2.0"
      }
    });
  const candidateId = submission.repair_candidate.candidate_id;
  const materialized = await ownerCommand("/diagnostic/v0/repair-deliveries", "v02-ticket07-bad-delivery",
    "diagnostic.repair_delivery.materialize", {
      candidate_id: candidateId,
      binding_id: bindingId,
      expected_base_revision_digest: expectedBase,
      idempotency_key: "ticket-07-bad-delivery"
    });
  assert.equal(materialized.response.status, 201, JSON.stringify(materialized.body));
  return {
    caseId,
    candidateId,
    deliveryId: materialized.body.repair_delivery.delivery_id,
    workerPrincipalId: agent.body.principal.principal_id
  };
}

try {
  await import("./acceptance-v0.2-ticket-06.js");
  const caseId = process.env.ALPHONSE_TICKET06_CASE_ID;
  const candidateId = process.env.ALPHONSE_TICKET06_CANDIDATE_ID;
  const deliveryId = process.env.ALPHONSE_TICKET06_DELIVERY_ID;
  const bindingId = process.env.ALPHONSE_TICKET06_BINDING_ID;
  const expectedBase = process.env.ALPHONSE_TICKET06_EXPECTED_BASE;
  assert.ok(caseId && candidateId && deliveryId && bindingId && expectedBase);

  const contract = await request("/diagnostic/v0/verification-runner-contract", { headers: {} });
  assert.equal(contract.response.status, 200);
  assert.equal(contract.body.invariants.disposable_process, true);
  assert.equal(contract.body.invariants.passing_grants_eligibility_only, true);
  assert.doesNotMatch(JSON.stringify(contract.body), /n8n/i);

  const goodInput = { candidate_id: candidateId, delivery_id: deliveryId, idempotency_key: "ticket-07-good" };
  const unauthorized = await agentCommand(priorWorkerToken, "/diagnostic/v0/repair-verifications",
    "v02-ticket07-agent-denied", "diagnostic.repair_verification.create", goodInput);
  assert.equal(unauthorized.response.status, 403);
  assert.equal(unauthorized.body.error.code, "OWNER_AUTHORITY_REQUIRED");

  const verified = await ownerCommand("/diagnostic/v0/repair-verifications", "v02-ticket07-good",
    "diagnostic.repair_verification.create", goodInput);
  assert.equal(verified.response.status, 201, JSON.stringify(verified.body));
  const good = verified.body.repair_verification;
  assert.equal(good.overall_result, "passed");
  assert.equal(good.outcomes.original_demonstrates_failure.status, "passed");
  assert.equal(good.outcomes.candidate_satisfies_target.status, "passed");
  assert.equal(good.outcomes.regressions.every((item) => item.executed && item.status === "passed"), true);
  assert.equal(good.projection.promotion_eligible, true);
  assert.equal(good.projection.promotion_authority, "not_granted");
  assert.equal(good.signed_receipt.authority.candidate_write, "not_granted");
  assert.equal(good.signed_receipt.authority.rollback, "not_granted");
  assert.equal(good.signed_receipt.signature.algorithm, "hmac-sha256");
  assert.equal(good.environment.destroyed, true);
  assert.equal(good.environment.production_credentials_received, false);

  const exactReplay = await ownerCommand("/diagnostic/v0/repair-verifications", "v02-ticket07-good",
    "diagnostic.repair_verification.create", goodInput);
  assert.equal(exactReplay.response.status, 200);
  assert.equal(exactReplay.response.headers.get("idempotent-replayed"), "true");
  assert.equal(exactReplay.body.repair_verification.verification_id, good.verification_id);
  const semanticReplay = await ownerCommand("/diagnostic/v0/repair-verifications", "v02-ticket07-good-retry",
    "diagnostic.repair_verification.create", goodInput);
  assert.equal(semanticReplay.body.created, false);
  assert.equal(semanticReplay.body.repair_verification.receipt_digest, good.receipt_digest);

  const logs = await request(`/diagnostic/v0/artifacts/${encodeURIComponent(good.artifacts.logs)}`);
  assert.equal(logs.body.artifact.verified, true);
  assert.equal(logs.body.artifact.content.kind, "verification_logs");
  const receiptArtifact = await request(`/diagnostic/v0/artifacts/${encodeURIComponent(good.artifacts.receipt)}`);
  assert.equal(receiptArtifact.body.artifact.content.receipt_digest, good.receipt_digest);

  let goodCase = (await request(`/diagnostic/v0/cases/${caseId}`)).body.diagnostic_case;
  assert.equal(goodCase.projection.state, "verified");
  assert.equal(goodCase.verification_receipts.length, 1);
  const goodCandidate = (await request(`/diagnostic/v0/repair-candidates/${candidateId}`)).body.repair_candidate;
  assert.equal(goodCandidate.status, "verified");
  assert.notEqual(good.runner.runner_id, goodCandidate.submitted_by_agent_principal_id);

  const revisionId = goodCase.revision_id;
  const bad = await createBadCandidate(revisionId, bindingId, expectedBase);
  const failed = await ownerCommand("/diagnostic/v0/repair-verifications", "v02-ticket07-bad-verify",
    "diagnostic.repair_verification.create", {
      candidate_id: bad.candidateId,
      delivery_id: bad.deliveryId,
      idempotency_key: "ticket-07-bad"
    });
  assert.equal(failed.response.status, 201, JSON.stringify(failed.body));
  const badReceipt = failed.body.repair_verification;
  Object.assign(process.env, {
    ALPHONSE_TICKET07_VERIFICATION_ID: good.verification_id,
    ALPHONSE_TICKET07_BAD_CANDIDATE_ID: bad.candidateId,
    ALPHONSE_TICKET07_BAD_VERIFICATION_ID: badReceipt.verification_id
  });
  assert.equal(badReceipt.overall_result, "failed");
  assert.equal(badReceipt.outcomes.original_demonstrates_failure.status, "passed");
  assert.equal(badReceipt.outcomes.candidate_satisfies_target.status, "failed");
  assert.equal(badReceipt.outcomes.regressions.length, 2);
  assert.equal(badReceipt.outcomes.regressions.every((item) => item.executed), true);
  assert.equal(badReceipt.projection.promotion_eligible, false);
  assert.notEqual(badReceipt.verification_request_digest, good.verification_request_digest);
  assert.notEqual(badReceipt.runner.runner_id, bad.workerPrincipalId);

  const conflict = await ownerCommand("/diagnostic/v0/repair-verifications", "v02-ticket07-conflict",
    "diagnostic.repair_verification.create", {
      candidate_id: bad.candidateId,
      delivery_id: bad.deliveryId,
      idempotency_key: "ticket-07-good"
    });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "VERIFICATION_IDEMPOTENCY_CONFLICT");

  const badCandidate = (await request(`/diagnostic/v0/repair-candidates/${bad.candidateId}`)).body.repair_candidate;
  assert.equal(badCandidate.status, "rejected");
  const badCase = (await request(`/diagnostic/v0/cases/${bad.caseId}`)).body.diagnostic_case;
  assert.equal(badCase.projection.state, "reproducible");
  assert.equal(badCase.projection.legal_next_operations.includes("diagnostic.repair_task.create"), true);

  const active = await request(`/diagnostic/v0/repair-delivery-bindings/${bindingId}/target`);
  assert.equal(active.body.target.target_revision_digest, expectedBase);
  assert.equal(active.body.target.active, true);
  const dump = compose("exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only pg_dump -U alphonse_diagnostic -d alphonse_diagnostic --data-only").stdout;
  assert.doesNotMatch(dump, new RegExp(runnerSigningSecret));

  passed = true;
  console.log(JSON.stringify({
    ticket: "v0.2-07",
    independent_runner_process: true,
    exact_artifacts_verified: true,
    original_failure_demonstrated: true,
    repaired_candidate_passed: true,
    deliberately_bad_candidate_rejected: true,
    compatible_regressions_executed: 2,
    signed_receipts: 2,
    identical_verification_replayed: true,
    conflicting_retry_rejected: true,
    active_workflow_preserved: true,
    disposable_workspaces_destroyed: true,
    promotion_authority_granted: false,
    provider_credentials_stored: false,
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
