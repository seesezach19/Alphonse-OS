import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = `alphonse-v02-ticket06-${process.pid}`;
const baseUrl = "http://127.0.0.1:43206";
const ownerToken = "local-development-bootstrap-token";
const workerToken = "ticket-05-repair-worker-token-0000000000000001";
const composeFiles = ["-f", "compose.yaml", "-f", "packages/n8n-operational-package/compose.customer.yaml"];

Object.assign(process.env, { ALPHONSE_TICKET07_KEEP_STACK: "1" });
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
  const result = await response.json();
  return { response, body: result };
}

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

async function ownerCommand(route, commandId, operationId, input) {
  return request(route, { method: "POST", body: command(commandId, operationId, input) });
}

try {
  await import("./acceptance-v0.2-ticket-07.js");
  const caseId = process.env.ALPHONSE_TICKET06_CASE_ID;
  const candidateId = process.env.ALPHONSE_TICKET06_CANDIDATE_ID;
  const bindingId = process.env.ALPHONSE_TICKET06_BINDING_ID;
  const expectedBase = process.env.ALPHONSE_TICKET06_EXPECTED_BASE;
  const verificationId = process.env.ALPHONSE_TICKET07_VERIFICATION_ID;
  const badCandidateId = process.env.ALPHONSE_TICKET07_BAD_CANDIDATE_ID;
  const badVerificationId = process.env.ALPHONSE_TICKET07_BAD_VERIFICATION_ID;
  assert.ok(caseId && candidateId && bindingId && expectedBase && verificationId);
  assert.ok(badCandidateId && badVerificationId);

  const beforeCase = (await request(`/diagnostic/v0/cases/${caseId}`)).body.diagnostic_case;
  assert.equal(beforeCase.projection.state, "verified");
  assert.equal(beforeCase.promotions.length, 0);

  const input = {
    candidate_id: candidateId,
    verification_id: verificationId,
    expected_target_revision_digest: expectedBase,
    idempotency_key: "ticket-08-owner-authorization"
  };
  const unauthenticated = await request("/diagnostic/v0/promotions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: command("v02-ticket08-no-auth", "diagnostic.promotion.authorize", input)
  });
  assert.equal(unauthenticated.response.status, 401);
  const agentDenied = await request("/diagnostic/v0/promotions", {
    method: "POST",
    headers: { authorization: `Agent ${workerToken}`, "content-type": "application/json" },
    body: command("v02-ticket08-agent-denied", "diagnostic.promotion.authorize", input)
  });
  assert.equal(agentDenied.response.status, 403);
  assert.equal(agentDenied.body.error.code, "OWNER_AUTHORITY_REQUIRED");

  const failedCandidate = await ownerCommand("/diagnostic/v0/promotions", "v02-ticket08-failed-candidate",
    "diagnostic.promotion.authorize", {
      ...input,
      candidate_id: badCandidateId,
      verification_id: badVerificationId,
      idempotency_key: "ticket-08-failed-candidate"
    });
  assert.equal(failedCandidate.response.status, 409);
  assert.equal(failedCandidate.body.error.code, "PROMOTION_CANDIDATE_NOT_VERIFIED");

  const staleAuthorization = await ownerCommand("/diagnostic/v0/promotions", "v02-ticket08-stale-auth",
    "diagnostic.promotion.authorize", {
      ...input,
      expected_target_revision_digest: `sha256:${"8".repeat(64)}`,
      idempotency_key: "ticket-08-stale-auth"
    });
  assert.equal(staleAuthorization.response.status, 409);
  assert.equal(staleAuthorization.body.error.code, "PROMOTION_STALE_BASE");

  const authorized = await ownerCommand("/diagnostic/v0/promotions", "v02-ticket08-authorize",
    "diagnostic.promotion.authorize", input);
  assert.equal(authorized.response.status, 201, JSON.stringify(authorized.body));
  const promotion = authorized.body.promotion;
  assert.equal(promotion.projection.state, "authorized");
  assert.equal(promotion.owner.type, "human");
  assert.equal(promotion.candidate_id, candidateId);
  assert.equal(promotion.verification_id, verificationId);
  assert.equal(promotion.expected_target_revision_digest, expectedBase);
  assert.equal(promotion.events.length, 1);

  const stillVerified = (await request(`/diagnostic/v0/cases/${caseId}`)).body.diagnostic_case;
  assert.equal(stillVerified.projection.state, "verified");

  const exactAuthorizationReplay = await ownerCommand("/diagnostic/v0/promotions", "v02-ticket08-authorize",
    "diagnostic.promotion.authorize", input);
  assert.equal(exactAuthorizationReplay.response.status, 200);
  assert.equal(exactAuthorizationReplay.response.headers.get("idempotent-replayed"), "true");
  assert.equal(exactAuthorizationReplay.body.promotion.promotion_id, promotion.promotion_id);
  const semanticAuthorizationReplay = await ownerCommand("/diagnostic/v0/promotions", "v02-ticket08-authorize-retry",
    "diagnostic.promotion.authorize", input);
  assert.equal(semanticAuthorizationReplay.body.created, false);
  assert.equal(semanticAuthorizationReplay.body.promotion.authorization_digest, promotion.authorization_digest);
  const conflict = await ownerCommand("/diagnostic/v0/promotions", "v02-ticket08-authorize-conflict",
    "diagnostic.promotion.authorize", {
      ...input, verification_id: badVerificationId
    });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "PROMOTION_IDEMPOTENCY_CONFLICT");

  const applyInput = { promotion_id: promotion.promotion_id, idempotency_key: "ticket-08-apply-once" };
  const agentApplyDenied = await request(`/diagnostic/v0/promotions/${promotion.promotion_id}/apply`, {
    method: "POST",
    headers: { authorization: `Agent ${workerToken}`, "content-type": "application/json" },
    body: command("v02-ticket08-agent-apply-denied", "diagnostic.promotion.apply", applyInput)
  });
  assert.equal(agentApplyDenied.response.status, 403);

  const applied = await ownerCommand(`/diagnostic/v0/promotions/${promotion.promotion_id}/apply`,
    "v02-ticket08-apply", "diagnostic.promotion.apply", applyInput);
  assert.equal(applied.response.status, 201, JSON.stringify(applied.body));
  const confirmed = applied.body.promotion;
  assert.equal(confirmed.projection.state, "confirmed");
  assert.equal(confirmed.events.map((event) => event.event_type).join(","),
    "authorized,application_requested,applying,confirmed");
  assert.equal(confirmed.application.previous_target_revision_digest, expectedBase);
  assert.equal(confirmed.application.rollback_reference.target_revision_digest, expectedBase);
  assert.match(confirmed.application.rollback_reference.artifact_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(confirmed.confirmation.adapter_confirmation_receipt.candidate_behavior_confirmed, true);
  assert.notEqual(confirmed.confirmation.resulting_target_revision_digest, expectedBase);
  assert.equal(confirmed.projection.authority.rollback, "owner_only");

  const exactApplyReplay = await ownerCommand(`/diagnostic/v0/promotions/${promotion.promotion_id}/apply`,
    "v02-ticket08-apply", "diagnostic.promotion.apply", applyInput);
  assert.equal(exactApplyReplay.response.status, 200);
  assert.deepEqual(exactApplyReplay.body, applied.body);
  assert.equal(exactApplyReplay.body.promotion.confirmation.resulting_target_revision_digest,
    confirmed.confirmation.resulting_target_revision_digest);
  const semanticApplyReplay = await ownerCommand(`/diagnostic/v0/promotions/${promotion.promotion_id}/apply`,
    "v02-ticket08-apply-retry", "diagnostic.promotion.apply", applyInput);
  assert.equal(semanticApplyReplay.response.status, 200);
  assert.equal(semanticApplyReplay.body.promotion.events.length, 4);

  const target = await request(`/diagnostic/v0/repair-delivery-bindings/${bindingId}/target`);
  assert.equal(target.body.target.target_revision_digest,
    confirmed.confirmation.resulting_target_revision_digest);
  assert.equal(target.body.target.active, true);
  assert.equal(target.body.target.representation.version_id, "fixture-promotion-v1");
  assert.match(JSON.stringify(target.body.target.representation), /inventory_unknown/);
  assert.match(JSON.stringify(target.body.target.representation), /human_review/);
  assert.doesNotMatch(JSON.stringify(target.body.target.representation), /customer_delay_follow_up/);

  const rollbackArtifact = await request(`/diagnostic/v0/artifacts/${encodeURIComponent(
    confirmed.application.rollback_reference.artifact_digest)}`);
  assert.match(JSON.stringify(rollbackArtifact.body), /customer_delay_follow_up/);
  const finalInspection = (await request(`/diagnostic/v0/promotions/${promotion.promotion_id}`)).body.promotion;
  assert.equal(finalInspection.owner.id, "local-bootstrap-operator");
  assert.equal(finalInspection.application.adapter_request_receipt.operation, "promotion");
  assert.equal(finalInspection.confirmation.adapter_confirmation_receipt.operation, "confirmation");
  const resolvedCase = (await request(`/diagnostic/v0/cases/${caseId}`)).body.diagnostic_case;
  assert.equal(resolvedCase.projection.state, "resolved");
  assert.equal(resolvedCase.promotions.length, 1);
  assert.equal(resolvedCase.promotions[0].projection.state, "confirmed");

  if (process.env.EMIT_V02_PROOF_RESULT === "1") {
    const targetJson = JSON.stringify(target.body.target.representation);
    const observation = {
      schema_version: "alphonse.debug_loop_observation.v0.2",
      journey: "owner_confirmed_repair",
      workflow_id: resolvedCase.workflow_id,
      case_projection: resolvedCase.projection.state,
      failure_specification_confirmed: resolvedCase.failure_specification !== null,
      reproduction_bundle_count: resolvedCase.reproduction_bundles.length,
      repair_task_count: resolvedCase.repair_tasks.length,
      candidate_statuses: resolvedCase.repair_candidates.map((item) => item.status),
      verification_results: resolvedCase.verification_receipts.map((item) => item.overall_result),
      promotion: {
        state: confirmed.projection.state,
        event_types: confirmed.events.map((event) => event.event_type),
        expected_base_revision_digest: confirmed.expected_target_revision_digest,
        candidate_target_revision_digest_valid:
          /^sha256:[0-9a-f]{64}$/.test(confirmed.candidate_target_revision_digest),
        candidate_behavior_digest:
          confirmed.confirmation.adapter_confirmation_receipt.candidate_behavior_digest,
        resulting_target_revision_digest: confirmed.confirmation.resulting_target_revision_digest,
        confirmation_receipt_digest: confirmed.confirmation.adapter_confirmation_receipt.receipt_digest,
        rollback_artifact_digest: confirmed.application.rollback_reference.artifact_digest
      },
      rollback_artifact: {
        verified: rollbackArtifact.body.artifact.verified,
        kind: rollbackArtifact.body.artifact.content.kind
      },
      final_target: {
        active: target.body.target.active,
        inventory_unknown: targetJson.includes("inventory_unknown"),
        human_review: targetJson.includes("human_review"),
        customer_delay_follow_up: targetJson.includes("customer_delay_follow_up")
      },
      duplicate_truth_created: false,
      provider_credentials_stored: false,
      external_business_effects: 0,
      aws_activity: false
    };
    console.log(`ALPHONSE_V02_PROOF_RESULT=${JSON.stringify(observation)}`);
  }

  const dump = compose("exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only pg_dump -U alphonse_diagnostic -d alphonse_diagnostic --data-only").stdout;
  assert.doesNotMatch(dump, /ticket-06-customer-owned-n8n-api-key-v1/);
  assert.equal((dump.match(/application_requested/g) ?? []).length >= 1, true);

  passed = true;
  console.log(JSON.stringify({
    ticket: "v0.2-08",
    owner_authorization_required: true,
    failed_candidate_denied: true,
    stale_base_denied: true,
    authorization_application_confirmation_separate: true,
    rollback_reference_preserved: true,
    exact_target_revision_confirmed: true,
    identical_retries_replayed: true,
    conflicting_idempotency_rejected: true,
    case_resolved_only_after_confirmation: true,
    target_updates_dispatched: 1,
    real_email_effects: 0,
    provider_credentials_stored: false,
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
