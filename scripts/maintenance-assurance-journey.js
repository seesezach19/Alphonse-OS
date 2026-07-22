import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "../src/canonical-json.js";
import { LOGICAL_OPERATION_DEDUPLICATION_PATCH } from
  "../packages/n8n-operational-package/src/repair-delivery-adapter.js";
import { RepairWorkerClient } from "../src/repair-worker-client.js";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/console");

async function runLiveConsoleBrowserProof({ environment, baseUrl, viewerToken, operatorToken,
  ownerToken, workflowId, workerId }) {
  const proofEnvironment = {
    ...environment,
    ALPHONSE_CONSOLE_MODE: "live",
    ALPHONSE_CONSOLE_KERNEL_URL: baseUrl,
    ALPHONSE_CONSOLE_SESSION_SECRET: "canonical-console-session-secret-with-at-least-32-bytes-v1",
    ALPHONSE_CONSOLE_VIEWER_LOGIN_SECRET: "canonical-viewer-login-v1",
    ALPHONSE_CONSOLE_OPERATOR_LOGIN_SECRET: "canonical-operator-login-v1",
    ALPHONSE_CONSOLE_OWNER_LOGIN_SECRET: "canonical-owner-login-v1",
    ALPHONSE_CONSOLE_VIEWER_KERNEL_TOKEN: viewerToken,
    ALPHONSE_CONSOLE_OPERATOR_KERNEL_TOKEN: operatorToken,
    ALPHONSE_CONSOLE_OWNER_KERNEL_TOKEN: ownerToken,
    CONSOLE_PROOF_URL: "http://127.0.0.1:43220",
    CONSOLE_PROOF_WORKFLOW_ID: workflowId,
    CONSOLE_PROOF_WORKER_ID: workerId
  };
  const server = spawn(process.execPath,
    [path.join(consoleRoot, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", "43220"],
    { cwd: consoleRoot, env: proofEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const response = await fetch("http://127.0.0.1:43220");
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(ready, true, `Live Console did not start.\n${output}`);
    const result = spawnSync(process.execPath, ["scripts/live-browser-proof.mjs"], {
      cwd: consoleRoot, env: proofEnvironment, encoding: "utf8", timeout: 2 * 60_000,
      maxBuffer: 8 * 1024 * 1024
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${output}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "passed");
    assert.equal(report.fixture_records_visible, false);
    return report;
  } finally {
    server.kill("SIGTERM");
  }
}

/**
 * Run the repair half of the production-shaped Maintenance Agent proof against
 * a diagnostic case already completed by the canonical bounded worker.
 *
 * @param {{
 *   baseUrl: string,
 *   environment: Record<string,string>,
 *   compose: (...args: string[]) => string,
 *   post: (route: string, body: any, headers?: Record<string,string>) => Promise<any>,
 *   kernel: (route: string, options?: any) => Promise<any>,
 *   command: (operationId: string, input: any) => any,
 *   caseId: string,
 *   revisionId: string,
 *   workflowId: string,
 *   assignmentId: string,
 *   workerRunId: string,
 *   diagnosisId: string,
 *   sponsorPrincipalId: string
 * }} input
 */
export async function runMaintenanceAssuranceJourney({
  baseUrl, environment, compose, post, kernel, command, caseId, revisionId, workflowId,
  assignmentId, workerRunId, diagnosisId, sponsorPrincipalId
}) {
  Object.assign(environment, {
    DIAGNOSTIC_RUNTIME_DETAIL_URL: "http://n8n-maintenance-adapter:5680",
    DIAGNOSTIC_RUNTIME_DETAIL_TOKEN: "local-maintenance-detail-adapter-token-v1",
    DIAGNOSTIC_RUNTIME_DETAIL_POLICY: JSON.stringify({
      policy_id: "alphonse.runtime.n8n.maintenance-detail.v1",
      extract_paths: ["input.order", "fixtures", "output"],
      redact_paths: [],
      omit_paths: ["credentials", "runtime.logs", "input.internal_notes"],
      replacement: "[REDACTED]"
    }),
    N8N_REPAIR_DELIVERY_URL: "http://n8n-maintenance-adapter:5680/api/v1",
    N8N_REPAIR_DELIVERY_API_KEY: "local-maintenance-edge-key-v1",
    N8N_REPAIR_DELIVERY_CREDENTIAL_BINDING_REF: "customer-secret-store:n8n-maintenance-v1",
    N8N_REPAIR_DELIVERY_TIMEOUT_MS: "2000",
    DIAGNOSTIC_CONSOLE_VIEWER_TOKEN: "local-console-viewer-token-v1",
    DIAGNOSTIC_CONSOLE_VIEWER_PRINCIPAL_ID: "canonical-proof-viewer",
    VERIFICATION_FIXTURE_VERSION: "logical-operation-v1"
  });
  compose("up", "--wait", "n8n-maintenance-adapter");
  compose("up", "--wait", "--force-recreate", "kernel");

  const profile = await kernel("/diagnostic/v0/maintenance-agent-profile");
  assert.equal(profile.response.status, 200, JSON.stringify(profile.body));
  assert.equal(profile.body.maintenance_agent_profile.runtime.replaceable_at_assignment_boundary, true);
  assert.equal(profile.body.maintenance_agent_profile.runtime.agent_held_production_authority, "none");

  const caseAfterRestart = await kernel(`/diagnostic/v0/cases/${caseId}`);
  assert.equal(caseAfterRestart.response.status, 200, JSON.stringify(caseAfterRestart.body));
  const assignmentAfterRestart = await kernel(`/diagnostic/v0/assignments/${assignmentId}`);
  assert.equal(assignmentAfterRestart.response.status, 200, JSON.stringify(assignmentAfterRestart.body));
  const workerAfterRestart = await kernel(`/diagnostic/v0/worker-runs/${workerRunId}`);
  assert.equal(workerAfterRestart.response.status, 200, JSON.stringify(workerAfterRestart.body));
  assert.equal(workerAfterRestart.body.diagnostic_worker_run.execution.diagnosis.diagnosis_id, diagnosisId);

  const specification = await post("/diagnostic/v0/failure-specifications", command(
    "diagnostic.failure_specification.confirm", {
      case_id: caseId,
      expected_behavior: "one_effect_per_logical_operation",
      actual_behavior: "two_deliveries -> two_committed_effects",
      reproduction_conditions: [
        "two retained successful n8n executions carry distinct delivery identities",
        "both executions carry one identical logical-operation identity",
        "the destination-effect node succeeded in both executions"
      ],
      targeted_verification: {
        expected_behavior: "one_effect_per_logical_operation",
        prohibited_behavior: "duplicate_committed_effect"
      }
    }
  ));
  assert.equal(specification.response.status, 201, JSON.stringify(specification.body));

  const reproduction = await post("/diagnostic/v0/reproductions", command(
    "diagnostic.reproduction.create", {
      case_id: caseId,
      fixture_bindings: {
        erp: "canonical:delivery-evidence-v1",
        storefront: "canonical:logical-operation-v1",
        model: "model:deterministic-identity-analysis-v1",
        review: "review:local-only-v1"
      },
      assumptions: [
        "provider execution detail is retained and read through the adapter edge",
        "destination node completion is evidence of the already-observed local mock effect"
      ]
    }
  ));
  assert.equal(reproduction.response.status, 201, JSON.stringify(reproduction.body));
  assert.equal(reproduction.body.reproduction_attempt.outcome, "demonstrated",
    JSON.stringify(reproduction.body));
  const reproductionBundleId = reproduction.body.reproduction_bundle.bundle_id;

  const repairAgent = await post("/kernel/v0/principals", command("kernel.principal.create", {
    principal_type: "agent", display_name: "Bounded Canonical Repair Worker"
  }));
  assert.equal(repairAgent.response.status, 201, JSON.stringify(repairAgent.body));
  const repairToken = `canonical-maintenance-repair-${randomUUID()}`;
  const now = Date.now();
  const passport = await post("/kernel/v0/agent-passports", command("kernel.agent_passport.issue", {
    agent_principal_id: repairAgent.body.principal.principal_id,
    sponsor_principal_id: sponsorPrincipalId,
    runtime: { kind: "openclaw-codex", version: "replaceable-at-assignment" },
    model_configuration: { provider: "replaceable", model: "bounded-repair-proposer" },
    package_skill_configuration: { protocol: "alphonse-repair-worker-0.2.0" },
    agent_authentication_token: repairToken,
    permitted_intent_classes: ["repair_work"],
    provenance: { source: "maintenance-assurance-live-proof" },
    valid_from: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 3_600_000).toISOString()
  }));
  assert.equal(passport.response.status, 201, JSON.stringify(passport.body));

  const agentHeaders = { authorization: `Agent ${repairToken}`, "content-type": "application/json" };
  const proposal = await post("/kernel/v0/work-intent-proposals", command("kernel.work_intent.propose", {
    passport_id: passport.body.passport.passport_id,
    intent_class: "repair_work",
    objective: "Propose one bounded logical-operation deduplication candidate for the exact diagnosed case.",
    requested_outcome: "Return one inactive candidate and one targeted regression without target authority.",
    scope: { case_id: caseId, base_revision_id: revisionId },
    constraints: { no_verification: true, no_promotion: true, no_external_effects: true }
  }), agentHeaders);
  assert.equal(proposal.response.status, 201, JSON.stringify(proposal.body));
  const intent = await post(`/kernel/v0/work-intent-proposals/${proposal.body.proposal.proposal_id}/confirm`,
    command("kernel.work_intent.confirm", {}));
  assert.equal(intent.response.status, 201, JSON.stringify(intent.body));

  const repairWorker = new RepairWorkerClient({ baseUrl, agentToken: repairToken });
  const registration = await repairWorker.register(randomUUID(), {
    passport_id: passport.body.passport.passport_id,
    work_intent_id: intent.body.work_intent.work_intent_id,
    protocol_version: "0.2.0",
    runtime_attribution: {
      worker_kind: "openclaw-codex-maintenance",
      runtime_version: "replaceable-at-assignment",
      attachment_version: "0.2.0"
    }
  });
  const operatorAgent = await post("/kernel/v0/principals", command("kernel.principal.create", {
    principal_type: "agent", display_name: "Canonical Console Operator"
  }));
  assert.equal(operatorAgent.response.status, 201, JSON.stringify(operatorAgent.body));
  const operatorToken = `canonical-console-operator-${randomUUID()}`;
  const operatorPassport = await post("/kernel/v0/agent-passports", command("kernel.agent_passport.issue", {
    agent_principal_id: operatorAgent.body.principal.principal_id,
    sponsor_principal_id: sponsorPrincipalId,
    runtime: { kind: "operations-console", version: "0.1.0" },
    model_configuration: { provider: "none", model: "typed-controls-only" },
    package_skill_configuration: {
      protocol: "alphonse-trusted-operator-0.2.0",
      operator_operations: ["diagnostic.console_snapshot.get", "diagnostic.console_worker.suspend",
        "diagnostic.console_workflow.quarantine", "diagnostic.console_worker.resume",
        "diagnostic.console_workflow.release"]
    },
    agent_authentication_token: operatorToken,
    permitted_intent_classes: ["trusted_operator"],
    provenance: { source: "maintenance-console-live-proof" },
    valid_from: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 3_600_000).toISOString()
  }));
  assert.equal(operatorPassport.response.status, 201, JSON.stringify(operatorPassport.body));
  const operatorHeaders = (instruction) => ({
    authorization: `Operator ${operatorToken}`, "content-type": "application/json",
    "x-alphonse-authorization-channel": "console",
    "x-alphonse-instruction-digest": sha256Digest(instruction),
    "x-alphonse-authorized-at": new Date().toISOString()
  });
  const operatorPost = (route, body) => post(route, body, operatorHeaders(body));

  const viewerSnapshot = await kernel("/diagnostic/v0/console-snapshot", {
    headers: { authorization: "Viewer local-console-viewer-token-v1" }
  });
  assert.equal(viewerSnapshot.response.status, 200, JSON.stringify(viewerSnapshot.body));
  assert.equal(viewerSnapshot.body.console_snapshot.data_mode, "live");
  assert.equal(viewerSnapshot.body.console_snapshot.session.role, "viewer");
  assert.equal(viewerSnapshot.body.console_snapshot.source.authoritative, true);
  assert.equal(JSON.stringify(viewerSnapshot.body).includes(operatorToken), false);
  const operatorSnapshot = await kernel("/diagnostic/v0/console-snapshot", {
    headers: operatorHeaders({ operation_id: "diagnostic.console_snapshot.get" })
  });
  assert.equal(operatorSnapshot.response.status, 200, JSON.stringify(operatorSnapshot.body));
  assert.equal(operatorSnapshot.body.console_snapshot.session.role, "operator");

  const suspend = command("diagnostic.console_worker.suspend", {
    agent_principal_id: repairAgent.body.principal.principal_id,
    reason_code: "emergency_operator_action", rationale: "Prove immediate worker fencing."
  });
  const suspended = await operatorPost(`/diagnostic/v0/console-controls/workers/${
    repairAgent.body.principal.principal_id}/suspend`, suspend);
  assert.equal(suspended.response.status, 201, JSON.stringify(suspended.body));
  assert.equal(suspended.body.worker_control.state, "suspended");
  await assert.rejects(repairWorker.discover(), (error) => error.code === "MAINTENANCE_WORKER_SUSPENDED");
  const operatorResume = command("diagnostic.console_worker.resume", {
    agent_principal_id: repairAgent.body.principal.principal_id,
    reason_code: "manual_recovery", rationale: "Operator recovery must fail closed."
  });
  const deniedResume = await operatorPost(`/diagnostic/v0/console-controls/workers/${
    repairAgent.body.principal.principal_id}/resume`, operatorResume);
  assert.equal(deniedResume.response.status, 403, JSON.stringify(deniedResume.body));
  const resumed = await post(`/diagnostic/v0/console-controls/workers/${
    repairAgent.body.principal.principal_id}/resume`, operatorResume);
  assert.equal(resumed.response.status, 201, JSON.stringify(resumed.body));
  assert.equal(resumed.body.worker_control.state, "active");

  const quarantine = command("diagnostic.console_workflow.quarantine", {
    workflow_id: workflowId, reason_code: "unexpected_behavior",
    rationale: "Prove maintenance quarantine before repair work."
  });
  const quarantined = await operatorPost(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/quarantine`, quarantine);
  assert.equal(quarantined.response.status, 201, JSON.stringify(quarantined.body));
  assert.equal(quarantined.body.workflow_control.state, "quarantined");
  const taskInput = {
    case_id: caseId,
    worker_registration_id: registration.repair_worker.registration_id,
    reproduction_bundle_id: reproductionBundleId,
    allowed_operations: ["artifact.read", "candidate.submit", "task.heartbeat", "task.fail", "task.release"],
    artifact_limits: { max_artifact_bytes: 131072, max_total_bytes: 262144,
      allowed_media_types: ["application/json"] },
    lease_duration_seconds: 30,
    expected_outputs: ["repair_candidate", "targeted_regression", "worker_logs"]
  };
  const blockedTask = await post("/diagnostic/v0/repair-tasks", command(
    "diagnostic.repair_task.create", taskInput));
  assert.equal(blockedTask.response.status, 409, JSON.stringify(blockedTask.body));
  assert.equal(blockedTask.body.error.code, "WORKFLOW_MAINTENANCE_QUARANTINED");
  const release = command("diagnostic.console_workflow.release", {
    workflow_id: workflowId, reason_code: "manual_recovery", rationale: "Owner-reviewed proof release."
  });
  const released = await post(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/release`, release);
  assert.equal(released.response.status, 201, JSON.stringify(released.body));
  assert.equal(released.body.workflow_control.state, "available");
  const createRepairTask = async () => {
    const result = await post("/diagnostic/v0/repair-tasks", command(
      "diagnostic.repair_task.create", taskInput));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body.repair_task.task_id;
  };

  const invalidTaskId = await createRepairTask();
  const invalidClaim = await repairWorker.claim(randomUUID(), invalidTaskId);
  const rejected = await repairWorker.submit(randomUUID(), invalidTaskId,
    invalidClaim.repair_task.lease_epoch, {
    intended_behavior_change: "invalid output must not be admitted"
  });
  assert.equal(rejected.submission_attempt.status, "rejected");
  assert.equal(rejected.submission_attempt.reason_code, "INVALID_INPUT");
  assert.equal(rejected.repair_candidate, null);
  assert.equal(rejected.repair_task.projection.state, "failed");

  const taskId = await createRepairTask();
  const claim = await repairWorker.claim(randomUUID(), taskId);
  const leaseEpoch = claim.repair_task.lease_epoch;

  const submitted = await repairWorker.submit(randomUUID(), taskId, leaseEpoch, {
    intended_behavior_change: "Deduplicate destination effects by logical-operation identity while preserving delivery identity as evidence.",
    candidate_artifact: { media_type: "application/json", content: LOGICAL_OPERATION_DEDUPLICATION_PATCH },
    targeted_regression_artifact: { media_type: "application/json", content: {
      fixture: "canonical:duplicate-logical-operation-v1",
      expected_behavior: "one_effect_per_logical_operation",
      prohibited_behavior: "duplicate_committed_effect"
    } },
    logs_artifact: { media_type: "application/json", content: {
      steps: ["read exact reproduction", "emit closed provider-neutral patch"],
      external_effects: [], verification_performed: false, promotion_attempted: false
    } },
    runtime_attribution: { worker_kind: "openclaw-codex-maintenance",
      runtime_version: "replaceable-at-assignment", attachment_version: "0.2.0" }
  });
  const candidateId = submitted.repair_candidate.candidate_id;

  const bindingId = randomUUID();
  const binding = await post("/diagnostic/v0/repair-delivery-bindings", command(
    "diagnostic.repair_delivery_binding.register", {
      binding_id: bindingId,
      adapter: { adapter_id: "alphonse.n8n.repair-delivery", adapter_version: "0.3.0" },
      target: { system: "n8n", target_type: "workflow", target_id: "CanonicalLeadIngress01",
        environment: "customer-local" },
      external_credential_binding_ref: "customer-secret-store:n8n-maintenance-v1",
      permitted_operations: ["inspect", "snapshot", "candidate", "promotion", "confirmation", "rollback"],
      transition_policy: { candidate_initial_state: "inactive", require_expected_base_revision: true,
        preserve_prechange_snapshot: true, promotion_authority: "owner_only" }
    }
  ));
  assert.equal(binding.response.status, 201, JSON.stringify(binding.body));
  const target = await kernel(`/diagnostic/v0/repair-delivery-bindings/${bindingId}/target`);
  assert.equal(target.response.status, 200, JSON.stringify(target.body));
  assert.equal(target.body.target.active, true);
  const expectedBase = target.body.target.target_revision_digest;

  const deliveryQuarantine = command("diagnostic.console_workflow.quarantine", {
    workflow_id: workflowId, reason_code: "unexpected_behavior",
    rationale: "Prove quarantine blocks inactive repair delivery."
  });
  const deliveryQuarantined = await operatorPost(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/quarantine`, deliveryQuarantine);
  assert.equal(deliveryQuarantined.response.status, 201, JSON.stringify(deliveryQuarantined.body));
  const blockedDelivery = await post("/diagnostic/v0/repair-deliveries", command(
    "diagnostic.repair_delivery.materialize", {
      candidate_id: candidateId, binding_id: bindingId,
      expected_base_revision_digest: expectedBase,
      idempotency_key: `maintenance-blocked-delivery-${candidateId}`
    }
  ));
  assert.equal(blockedDelivery.response.status, 409, JSON.stringify(blockedDelivery.body));
  assert.equal(blockedDelivery.body.error.code, "WORKFLOW_MAINTENANCE_QUARANTINED");
  const deliveryRelease = await post(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/release`, command("diagnostic.console_workflow.release", {
      workflow_id: workflowId, reason_code: "manual_recovery",
      rationale: "Owner reviewed the delivery boundary proof."
    }));
  assert.equal(deliveryRelease.response.status, 201, JSON.stringify(deliveryRelease.body));

  const delivery = await post("/diagnostic/v0/repair-deliveries", command(
    "diagnostic.repair_delivery.materialize", {
      candidate_id: candidateId, binding_id: bindingId,
      expected_base_revision_digest: expectedBase,
      idempotency_key: `maintenance-delivery-${candidateId}`
    }
  ));
  assert.equal(delivery.response.status, 201, JSON.stringify(delivery.body));
  assert.equal(delivery.body.repair_delivery.inactive_candidate.state, "inactive");
  const deliveryId = delivery.body.repair_delivery.delivery_id;

  compose("up", "--wait", "--force-recreate", "kernel");
  const queue = await kernel("/diagnostic/v0/maintenance-work-queue");
  assert.equal(queue.response.status, 200, JSON.stringify(queue.body));
  assert.ok(queue.body.maintenance_work_queue.diagnostic_assignments.some((entry) =>
    entry.assignment_id === assignmentId && entry.diagnosis_id === diagnosisId));
  assert.ok(queue.body.maintenance_work_queue.repair_tasks.some((entry) =>
    entry.task_id === taskId && entry.event_type === "submitted"));

  const verification = await post("/diagnostic/v0/repair-verifications", command(
    "diagnostic.repair_verification.create", {
      candidate_id: candidateId, delivery_id: deliveryId,
      idempotency_key: `maintenance-verification-${candidateId}`
    }
  ));
  assert.equal(verification.response.status, 201, JSON.stringify(verification.body));
  assert.equal(verification.body.repair_verification.overall_result, "passed");
  const verificationId = verification.body.repair_verification.verification_id;

  const authorizationQuarantine = await operatorPost(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/quarantine`, command("diagnostic.console_workflow.quarantine", {
      workflow_id: workflowId, reason_code: "security_concern",
      rationale: "Prove quarantine blocks Promotion authorization."
    }));
  assert.equal(authorizationQuarantine.response.status, 201, JSON.stringify(authorizationQuarantine.body));
  const blockedAuthorization = await post("/diagnostic/v0/promotions", command(
    "diagnostic.promotion.authorize", {
      candidate_id: candidateId, verification_id: verificationId,
      expected_target_revision_digest: expectedBase,
      idempotency_key: `maintenance-blocked-promotion-${candidateId}`
    }
  ));
  assert.equal(blockedAuthorization.response.status, 409, JSON.stringify(blockedAuthorization.body));
  assert.equal(blockedAuthorization.body.error.code, "WORKFLOW_MAINTENANCE_QUARANTINED");
  const authorizationRelease = await post(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/release`, command("diagnostic.console_workflow.release", {
      workflow_id: workflowId, reason_code: "manual_recovery",
      rationale: "Owner reviewed the authorization boundary proof."
    }));
  assert.equal(authorizationRelease.response.status, 201, JSON.stringify(authorizationRelease.body));

  const authorization = await post("/diagnostic/v0/promotions", command(
    "diagnostic.promotion.authorize", {
      candidate_id: candidateId, verification_id: verificationId,
      expected_target_revision_digest: expectedBase,
      idempotency_key: `maintenance-promotion-${candidateId}`
    }
  ));
  assert.equal(authorization.response.status, 201, JSON.stringify(authorization.body));
  const promotionId = authorization.body.promotion.promotion_id;

  const applicationQuarantine = await operatorPost(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/quarantine`, command("diagnostic.console_workflow.quarantine", {
      workflow_id: workflowId, reason_code: "unexpected_behavior",
      rationale: "Prove quarantine blocks target application."
    }));
  assert.equal(applicationQuarantine.response.status, 201, JSON.stringify(applicationQuarantine.body));
  const blockedApplication = await post(`/diagnostic/v0/promotions/${promotionId}/apply`, command(
    "diagnostic.promotion.apply", {
      promotion_id: promotionId, idempotency_key: `maintenance-blocked-apply-${candidateId}`
    }
  ));
  assert.equal(blockedApplication.response.status, 409, JSON.stringify(blockedApplication.body));
  assert.equal(blockedApplication.body.error.code, "WORKFLOW_MAINTENANCE_QUARANTINED");
  const applicationRelease = await post(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/release`, command("diagnostic.console_workflow.release", {
      workflow_id: workflowId, reason_code: "manual_recovery",
      rationale: "Owner reviewed the application boundary proof."
    }));
  assert.equal(applicationRelease.response.status, 201, JSON.stringify(applicationRelease.body));

  const control = "fetch('http://127.0.0.1:5680/test/v0/promotion-mode',{method:'POST'," +
    "headers:{authorization:'Bearer local-maintenance-detail-adapter-token-v1','content-type':'application/json'}," +
    "body:JSON.stringify({mode:'apply_then_timeout'})}).then(async r=>{if(!r.ok)throw new Error(await r.text())})";
  compose("exec", "-T", "n8n-maintenance-adapter", "node", "-e", control);
  const applied = await post(`/diagnostic/v0/promotions/${promotionId}/apply`, command(
    "diagnostic.promotion.apply", {
      promotion_id: promotionId, idempotency_key: `maintenance-apply-${candidateId}`
    }
  ));
  assert.equal(applied.response.status, 201, JSON.stringify(applied.body));
  assert.equal(applied.body.promotion.projection.state, "uncertain");
  const recoveryQuarantine = await operatorPost(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/quarantine`, command("diagnostic.console_workflow.quarantine", {
      workflow_id: workflowId, reason_code: "unexpected_behavior",
      rationale: "Freeze new work while preserving uncertain-state recovery."
    }));
  assert.equal(recoveryQuarantine.response.status, 201, JSON.stringify(recoveryQuarantine.body));
  const reconciled = await post(`/diagnostic/v0/promotions/${promotionId}/reconcile`, command(
    "diagnostic.promotion.reconcile", {
      promotion_id: promotionId, idempotency_key: `maintenance-reconcile-${candidateId}`
    }
  ));
  assert.equal(reconciled.response.status, 201, JSON.stringify(reconciled.body));
  assert.equal(reconciled.body.promotion.projection.state, "confirmed");
  assert.equal(reconciled.body.promotion.reconciliation.outcome, "applied");

  const promotedDigest = reconciled.body.promotion.confirmation.resulting_target_revision_digest;
  const rollback = await post(`/diagnostic/v0/promotions/${promotionId}/rollback`, command(
    "diagnostic.promotion.rollback", {
      promotion_id: promotionId,
      expected_target_revision_digest: promotedDigest,
      idempotency_key: `maintenance-rollback-${candidateId}`
    }
  ));
  assert.equal(rollback.response.status, 201, JSON.stringify(rollback.body));
  assert.equal(rollback.body.promotion.projection.state, "rolled_back");
  assert.equal(rollback.body.promotion.rollback.confirmation_receipt.rollback_behavior_confirmed, true);
  const recoveryRelease = await post(`/diagnostic/v0/console-controls/workflows/${
    encodeURIComponent(workflowId)}/release`, command("diagnostic.console_workflow.release", {
      workflow_id: workflowId, reason_code: "manual_recovery",
      rationale: "Owner confirmed rollback and released maintenance quarantine."
    }));
  assert.equal(recoveryRelease.response.status, 201, JSON.stringify(recoveryRelease.body));

  const assurance = await post("/diagnostic/v0/maintenance-assurances", command(
    "diagnostic.maintenance_assurance.export", {
      assignment_id: assignmentId, worker_run_id: workerRunId, diagnosis_id: diagnosisId,
      repair_candidate_id: candidateId, repair_delivery_id: deliveryId,
      verification_id: verificationId, promotion_id: promotionId
    }
  ));
  assert.equal(assurance.response.status, 201, JSON.stringify(assurance.body));
  const exported = assurance.body.maintenance_assurance;
  assert.equal(exported.document.effects.agent_external_business_effects, 0);
  assert.equal(exported.document.recovery.outcome, "owner_authorized_rollback_confirmed");
  assert.equal(exported.document.authorization.repair_worker_authority, "candidate_proposal_only");
  assert.equal(exported.document.authorization.verification_authority, "eligibility_only");
  assert.equal(exported.document.supported_facts.length, 5);
  assert.equal(exported.human_readable_markdown.includes("## Limitations"), true);
  const reread = await kernel(`/diagnostic/v0/maintenance-assurances/${exported.export_id}`);
  assert.equal(reread.response.status, 200, JSON.stringify(reread.body));
  assert.equal(reread.body.maintenance_assurance.assurance_digest, exported.assurance_digest);
  const browserProof = await runLiveConsoleBrowserProof({
    environment, baseUrl, viewerToken: "local-console-viewer-token-v1", operatorToken,
    ownerToken: "local-development-bootstrap-token", workflowId,
    workerId: repairAgent.body.principal.principal_id
  });
  const finalConsole = await kernel("/diagnostic/v0/console-snapshot", {
    headers: { authorization: "Viewer local-console-viewer-token-v1" }
  });
  assert.equal(finalConsole.response.status, 200, JSON.stringify(finalConsole.body));
  const finalSnapshot = finalConsole.body.console_snapshot;
  assert.equal(finalSnapshot.data_mode, "live");
  assert.ok(finalSnapshot.cases.some((entry) => entry.case_id === caseId &&
    entry.promotion?.state === "rolled_back"));
  assert.ok(finalSnapshot.assurances.some((entry) => entry.export_id === exported.export_id));
  assert.equal(finalSnapshot.workflows.find((entry) => entry.workflow_id === workflowId)
    .quarantine.state, "available");
  assert.equal(finalSnapshot.workers.find((entry) =>
    entry.worker_id === repairAgent.body.principal.principal_id).control.state, "active");

  return {
    profile_digest: profile.body.maintenance_agent_profile.profile_digest,
    task_id: taskId,
    candidate_id: candidateId,
    delivery_id: deliveryId,
    verification_id: verificationId,
    promotion_id: promotionId,
    assurance_export_id: exported.export_id,
    assurance_digest: exported.assurance_digest,
    invalid_output_rejected: true,
    restart_recovered: true,
    timeout_reconciled: true,
    rollback_confirmed: true,
    console_live_authoritative: true,
    viewer_read_only: true,
    operator_worker_fence: true,
    operator_workflow_fence: true,
    owner_recovery_only: true,
    quarantine_blocks_new_work_and_preserves_recovery: true,
    browser_roles_verified: browserProof.roles,
    browser_accessibility_scans: browserProof.accessibility_scans,
    real_n8n_target: "CanonicalLeadIngress01",
    provider_credential_location: "adapter_edge_only",
    external_business_effects_by_agents: 0
  };
}
