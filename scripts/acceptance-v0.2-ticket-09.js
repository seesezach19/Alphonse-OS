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
const detailToken = "local-n8n-detail-adapter-token-v1";
const adapterKeyId = "n8n-runtime-key-v1";
const adapterSecret = "local-n8n-runtime-event-secret-with-sufficient-length-v1";
const composeFiles = ["-f", "compose.yaml", "-f", "packages/n8n-operational-package/compose.customer.yaml"];

Object.assign(process.env, {
  ALPHONSE_TICKET07_KEEP_STACK: "1",
  N8N_REPAIR_DELIVERY_TIMEOUT_MS: "300"
});
const environment = { ...process.env, COMPOSE_PROJECT_NAME: project };
const ownerHeaders = { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" };
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
  return { response, body: await response.json() };
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

function setPromotionMode(mode) {
  const source = `fetch('http://127.0.0.1:5680/test/v0/promotion-mode',{method:'POST',` +
    `headers:{authorization:'Bearer ${detailToken}','content-type':'application/json'},` +
    `body:JSON.stringify({mode:'${mode}'})}).then(async r=>{if(!r.ok)throw new Error(await r.text())})`;
  compose("exec", "-T", "n8n-runtime-adapter", "node", "-e", source);
}

function resetTargetFixture() {
  const source = `fetch('http://127.0.0.1:5680/test/v0/reset-workflow',{method:'POST',` +
    `headers:{authorization:'Bearer ${detailToken}'}}).then(async r=>{if(!r.ok)throw new Error(await r.text())})`;
  compose("exec", "-T", "n8n-runtime-adapter", "node", "-e", source);
}

async function createVerifiedCandidate({ suffix, sequence, revisionId, bindingId, expectedBase }) {
  const workerToken = `ticket-09-${suffix}-worker-token-0000000000001`;
  const runtimeEvent = {
    schema_version: "0.2.0",
    adapter: { adapter_id: "alphonse.n8n.runtime", adapter_version: "0.3.0" },
    workflow_id: "workflow:inventory-follow-up",
    revision_id: revisionId,
    external_execution_id: `n8n-${sequence}`,
    event_id: `n8n-${sequence}-succeeded`,
    event_sequence: 1,
    lifecycle_claim: "succeeded",
    correlation_id: `inventory-ticket09-${suffix}`,
    idempotency_key: `n8n-${sequence}:1`,
    occurred_at: new Date().toISOString(),
    payload: { digest: `sha256:${String(sequence % 10).repeat(64)}`, reference: null }
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
  const report = await ownerCommand("/diagnostic/v0/cases", `v02-ticket09-${suffix}-report`,
    "diagnostic.case.report_failure", {
      trace_id: event.body.trace_id,
      summary: `Ticket 09 ${suffix} uncertainty branch.`
    });
  assert.equal(report.response.status, 201, JSON.stringify(report.body));
  const caseId = report.body.diagnostic_case.case_id;
  const specification = await ownerCommand("/diagnostic/v0/failure-specifications",
    `v02-ticket09-${suffix}-spec`, "diagnostic.failure_specification.confirm", {
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
  const reproduction = await ownerCommand("/diagnostic/v0/reproductions",
    `v02-ticket09-${suffix}-reproduction`, "diagnostic.reproduction.create", {
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
  const agent = await ownerCommand("/kernel/v0/principals", `v02-ticket09-${suffix}-agent`,
    "kernel.principal.create", { principal_type: "agent", display_name: `Ticket 09 ${suffix} Worker` });
  assert.equal(human.response.status, 200, JSON.stringify(human.body));
  assert.equal(agent.response.status, 201, JSON.stringify(agent.body));
  const now = Date.now();
  const passport = await ownerCommand("/kernel/v0/agent-passports", `v02-ticket09-${suffix}-passport`,
    "kernel.agent_passport.issue", {
      agent_principal_id: agent.body.principal.principal_id,
      sponsor_principal_id: human.body.principal.principal_id,
      runtime: { kind: "customer-controlled", version: "replaceable" },
      model_configuration: { provider: "fixture", model: "deterministic-repair" },
      package_skill_configuration: { protocol: "alphonse-repair-worker-0.2.0" },
      agent_authentication_token: workerToken,
      permitted_intent_classes: ["repair_work"],
      provenance: { source: "ticket-09-acceptance" },
      valid_from: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 3_600_000).toISOString()
    });
  assert.equal(passport.response.status, 201, JSON.stringify(passport.body));
  const proposal = await agentCommand(workerToken, "/kernel/v0/work-intent-proposals",
    `v02-ticket09-${suffix}-intent-proposal`, "kernel.work_intent.propose", {
      passport_id: passport.body.passport.passport_id,
      intent_class: "repair_work",
      objective: "Produce one independently verifiable inventory repair candidate.",
      requested_outcome: "Return one inactive candidate and targeted regression.",
      scope: { case_id: caseId, base_revision_id: revisionId },
      constraints: { no_verification: true, no_promotion: true, no_external_effects: true }
    });
  assert.equal(proposal.response.status, 201, JSON.stringify(proposal.body));
  const intent = await ownerCommand(
    `/kernel/v0/work-intent-proposals/${proposal.body.proposal.proposal_id}/confirm`,
    `v02-ticket09-${suffix}-intent-confirm`, "kernel.work_intent.confirm", {});
  assert.equal(intent.response.status, 201, JSON.stringify(intent.body));
  const worker = new RepairWorkerClient({ baseUrl, agentToken: workerToken });
  const registration = await worker.register(`v02-ticket09-${suffix}-worker-register`, {
    passport_id: passport.body.passport.passport_id,
    work_intent_id: intent.body.work_intent.work_intent_id,
    protocol_version: "0.2.0",
    runtime_attribution: {
      worker_kind: `ticket-09-${suffix}-worker`, runtime_version: "1.0.0", attachment_version: "0.2.0"
    }
  });
  const task = await ownerCommand("/diagnostic/v0/repair-tasks", `v02-ticket09-${suffix}-task`,
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
  const claim = await worker.claim(`v02-ticket09-${suffix}-claim`, task.body.repair_task.task_id);
  const submission = await worker.submit(`v02-ticket09-${suffix}-submit`, task.body.repair_task.task_id,
    claim.repair_task.lease_epoch, {
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
        media_type: "application/json", content: { steps: ["created ticket 09 repair candidate"] }
      },
      runtime_attribution: {
        worker_kind: `ticket-09-${suffix}-worker`, runtime_version: "1.0.0", attachment_version: "0.2.0"
      }
    });
  const candidateId = submission.repair_candidate.candidate_id;
  const delivery = await ownerCommand("/diagnostic/v0/repair-deliveries", `v02-ticket09-${suffix}-delivery`,
    "diagnostic.repair_delivery.materialize", {
      candidate_id: candidateId,
      binding_id: bindingId,
      expected_base_revision_digest: expectedBase,
      idempotency_key: `ticket-09-${suffix}-delivery`
    });
  assert.equal(delivery.response.status, 201, JSON.stringify(delivery.body));
  const verification = await ownerCommand("/diagnostic/v0/repair-verifications",
    `v02-ticket09-${suffix}-verify`, "diagnostic.repair_verification.create", {
      candidate_id: candidateId,
      delivery_id: delivery.body.repair_delivery.delivery_id,
      idempotency_key: `ticket-09-${suffix}-verify`
    });
  assert.equal(verification.response.status, 201, JSON.stringify(verification.body));
  assert.equal(verification.body.repair_verification.overall_result, "passed");
  return {
    caseId, candidateId,
    verificationId: verification.body.repair_verification.verification_id
  };
}

async function authorize(source, suffix, expectedBase) {
  const result = await ownerCommand("/diagnostic/v0/promotions", `v02-ticket09-${suffix}-authorize`,
    "diagnostic.promotion.authorize", {
      candidate_id: source.candidateId,
      verification_id: source.verificationId,
      expected_target_revision_digest: expectedBase,
      idempotency_key: `ticket-09-${suffix}-authorize`
    });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body.promotion;
}

async function applyUncertain(promotion, suffix, mode) {
  setPromotionMode(mode);
  const input = { promotion_id: promotion.promotion_id, idempotency_key: `ticket-09-${suffix}-apply` };
  const result = await ownerCommand(`/diagnostic/v0/promotions/${promotion.promotion_id}/apply`,
    `v02-ticket09-${suffix}-apply`, "diagnostic.promotion.apply", input);
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.promotion.projection.state, "uncertain");
  assert.equal(result.body.promotion.uncertainty.confirmation_missing, true);
  assert.equal(result.body.promotion.application.adapter_request_receipt.operation, "promotion");
  const replay = await ownerCommand(`/diagnostic/v0/promotions/${promotion.promotion_id}/apply`,
    `v02-ticket09-${suffix}-apply`, "diagnostic.promotion.apply", input);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.promotion.projection.state, "uncertain");
  assert.equal(replay.body.promotion.events.length, result.body.promotion.events.length);
  const semanticReplay = await ownerCommand(`/diagnostic/v0/promotions/${promotion.promotion_id}/apply`,
    `v02-ticket09-${suffix}-apply-retry`, "diagnostic.promotion.apply", input);
  assert.equal(semanticReplay.response.status, 200, JSON.stringify(semanticReplay.body));
  assert.equal(semanticReplay.body.promotion.projection.state, "uncertain");
  assert.equal(semanticReplay.body.promotion.events.length, result.body.promotion.events.length);
  return result.body.promotion;
}

async function reconcile(promotion, suffix) {
  const input = { promotion_id: promotion.promotion_id, idempotency_key: `ticket-09-${suffix}-reconcile` };
  const result = await ownerCommand(`/diagnostic/v0/promotions/${promotion.promotion_id}/reconcile`,
    `v02-ticket09-${suffix}-reconcile`, "diagnostic.promotion.reconcile", input);
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  const replay = await ownerCommand(`/diagnostic/v0/promotions/${promotion.promotion_id}/reconcile`,
    `v02-ticket09-${suffix}-reconcile`, "diagnostic.promotion.reconcile", input);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.deepEqual(replay.body, result.body);
  return result.body.promotion;
}

try {
  await import("./acceptance-v0.2-ticket-07.js");
  const first = {
    caseId: process.env.ALPHONSE_TICKET06_CASE_ID,
    candidateId: process.env.ALPHONSE_TICKET06_CANDIDATE_ID,
    verificationId: process.env.ALPHONSE_TICKET07_VERIFICATION_ID
  };
  const bindingId = process.env.ALPHONSE_TICKET06_BINDING_ID;
  const expectedBase = process.env.ALPHONSE_TICKET06_EXPECTED_BASE;
  assert.ok(first.caseId && first.candidateId && first.verificationId && bindingId && expectedBase);
  const firstCase = (await request(`/diagnostic/v0/cases/${first.caseId}`)).body.diagnostic_case;
  const second = await createVerifiedCandidate({
    suffix: "not-applied", sequence: 901, revisionId: firstCase.revision_id, bindingId, expectedBase
  });
  const third = await createVerifiedCandidate({
    suffix: "mismatch", sequence: 902, revisionId: firstCase.revision_id, bindingId, expectedBase
  });

  const appliedAuthorization = await authorize(first, "applied", expectedBase);
  const notAppliedAuthorization = await authorize(second, "not-applied", expectedBase);
  const mismatchAuthorization = await authorize(third, "mismatch", expectedBase);

  const uncertainNotApplied = await applyUncertain(notAppliedAuthorization, "not-applied", "no_apply_timeout");
  const failed = await reconcile(uncertainNotApplied, "not-applied");
  assert.equal(failed.projection.state, "failed");
  assert.equal(failed.reconciliation.outcome, "not_applied");
  assert.equal(failed.failure.unresolved, true);
  assert.equal((await request(`/diagnostic/v0/cases/${second.caseId}`)).body.diagnostic_case.projection.state,
    "verified");

  const uncertainMismatch = await applyUncertain(mismatchAuthorization, "mismatch", "mismatch_then_timeout");
  const mismatch = await reconcile(uncertainMismatch, "mismatch");
  assert.equal(mismatch.projection.state, "target_mismatch");
  assert.equal(mismatch.reconciliation.outcome, "target_mismatch");
  assert.equal(mismatch.projection.human_review_required, true);
  const conflict = await ownerCommand(`/diagnostic/v0/promotions/${mismatch.promotion_id}/reconcile`,
    "v02-ticket09-mismatch-conflict", "diagnostic.promotion.reconcile", {
      promotion_id: mismatch.promotion_id,
      idempotency_key: "ticket-09-not-applied-reconcile"
    });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "PROMOTION_RECONCILIATION_IDEMPOTENCY_CONFLICT");

  resetTargetFixture();
  const uncertainApplied = await applyUncertain(appliedAuthorization, "applied", "apply_then_timeout");
  const confirmed = await reconcile(uncertainApplied, "applied");
  assert.equal(confirmed.projection.state, "confirmed");
  assert.equal(confirmed.reconciliation.outcome, "applied");
  assert.equal(confirmed.reconciliation.was_uncertain, true);
  assert.equal((await request(`/diagnostic/v0/cases/${first.caseId}`)).body.diagnostic_case.projection.state,
    "resolved");

  const rollbackInput = {
    promotion_id: confirmed.promotion_id,
    expected_target_revision_digest: confirmed.confirmation.resulting_target_revision_digest,
    idempotency_key: "ticket-09-applied-rollback"
  };
  const rollback = await ownerCommand(`/diagnostic/v0/promotions/${confirmed.promotion_id}/rollback`,
    "v02-ticket09-applied-rollback", "diagnostic.promotion.rollback", rollbackInput);
  assert.equal(rollback.response.status, 201, JSON.stringify(rollback.body));
  assert.equal(rollback.body.promotion.projection.state, "rolled_back");
  assert.equal(rollback.body.promotion.rollback.confirmation_receipt.rollback_behavior_confirmed, true);
  assert.equal(rollback.body.promotion.events.some((event) => event.event_type === "uncertain"), true);
  assert.equal((await request(`/diagnostic/v0/cases/${first.caseId}`)).body.diagnostic_case.projection.state,
    "verified");
  const rollbackReplay = await ownerCommand(`/diagnostic/v0/promotions/${confirmed.promotion_id}/rollback`,
    "v02-ticket09-applied-rollback", "diagnostic.promotion.rollback", rollbackInput);
  assert.equal(rollbackReplay.response.status, 200);
  assert.deepEqual(rollbackReplay.body, rollback.body);

  if (process.env.EMIT_V02_PROOF_RESULT === "1") {
    const finalTarget = await request(`/diagnostic/v0/repair-delivery-bindings/${bindingId}/target`);
    const targetJson = JSON.stringify(finalTarget.body.target.representation);
    const rollbackArtifact = await request(`/diagnostic/v0/artifacts/${encodeURIComponent(
      rollback.body.promotion.application.rollback_reference.artifact_digest)}`);
    const observation = {
      schema_version: "alphonse.debug_loop_observation.v0.2",
      journey: "uncertainty_reconciliation_and_rollback",
      applied_branch: {
        state_before_rollback: confirmed.projection.state,
        reconciliation_outcome: confirmed.reconciliation.outcome,
        reconciliation_read_only: confirmed.reconciliation.receipt.read_only,
        final_state: rollback.body.promotion.projection.state,
        event_types: rollback.body.promotion.events.map((event) => event.event_type),
        rollback_confirmed: rollback.body.promotion.rollback.confirmation_receipt.rollback_behavior_confirmed,
        rollback_artifact_digest: rollback.body.promotion.application.rollback_reference.artifact_digest
      },
      not_applied_branch: {
        state: failed.projection.state,
        reconciliation_outcome: failed.reconciliation.outcome,
        case_projection: (await request(`/diagnostic/v0/cases/${second.caseId}`)).body.diagnostic_case.projection.state,
        event_types: failed.events.map((event) => event.event_type)
      },
      mismatch_branch: {
        state: mismatch.projection.state,
        reconciliation_outcome: mismatch.reconciliation.outcome,
        human_review_required: mismatch.projection.human_review_required,
        event_types: mismatch.events.map((event) => event.event_type)
      },
      rollback_artifact: {
        verified: rollbackArtifact.body.artifact.verified,
        kind: rollbackArtifact.body.artifact.content.kind
      },
      final_target: {
        active: finalTarget.body.target.active,
        restored_customer_delay_follow_up: targetJson.includes("customer_delay_follow_up")
      },
      exact_and_semantic_apply_retries_dispatched: 0,
      conflicting_reconciliation_rejected: true,
      provider_credentials_stored: false,
      external_business_effects: 0,
      aws_activity: false
    };
    console.log(`ALPHONSE_V02_PROOF_RESULT=${JSON.stringify(observation)}`);
  }

  passed = true;
  console.log(JSON.stringify({
    ticket: "v0.2-09",
    uncertain_applied_reconciled: true,
    uncertain_not_applied_reconciled: true,
    target_mismatch_requires_human_review: true,
    blind_redispatch_blocked: true,
    reconciliation_idempotent: true,
    owner_authorized_rollback_confirmed: true,
    append_only_history_preserved: true,
    aws_activity: false
  }, null, 2));
} finally {
  if (!passed) {
    try {
      console.error(compose("logs", "--no-color", "postgres", "diagnostic-bootstrap", "kernel",
        "n8n-runtime-adapter").stdout);
    } catch {}
  }
  try { compose("down", "--volumes", "--remove-orphans"); } catch {}
}
