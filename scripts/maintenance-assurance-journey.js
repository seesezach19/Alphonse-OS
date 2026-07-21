import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { LOGICAL_OPERATION_DEDUPLICATION_PATCH } from
  "../packages/n8n-operational-package/src/repair-delivery-adapter.js";
import { RepairWorkerClient } from "../src/repair-worker-client.js";

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
 *   assignmentId: string,
 *   workerRunId: string,
 *   diagnosisId: string,
 *   sponsorPrincipalId: string
 * }} input
 */
export async function runMaintenanceAssuranceJourney({
  baseUrl, environment, compose, post, kernel, command, caseId, revisionId,
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
  const createRepairTask = async () => {
    const result = await post("/diagnostic/v0/repair-tasks", command("diagnostic.repair_task.create", {
      case_id: caseId,
      worker_registration_id: registration.repair_worker.registration_id,
      reproduction_bundle_id: reproductionBundleId,
      allowed_operations: ["artifact.read", "candidate.submit", "task.heartbeat", "task.fail", "task.release"],
      artifact_limits: { max_artifact_bytes: 131072, max_total_bytes: 262144,
        allowed_media_types: ["application/json"] },
      lease_duration_seconds: 30,
      expected_outputs: ["repair_candidate", "targeted_regression", "worker_logs"]
    }));
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

  const authorization = await post("/diagnostic/v0/promotions", command(
    "diagnostic.promotion.authorize", {
      candidate_id: candidateId, verification_id: verificationId,
      expected_target_revision_digest: expectedBase,
      idempotency_key: `maintenance-promotion-${candidateId}`
    }
  ));
  assert.equal(authorization.response.status, 201, JSON.stringify(authorization.body));
  const promotionId = authorization.body.promotion.promotion_id;

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
    real_n8n_target: "CanonicalLeadIngress01",
    provider_credential_location: "adapter_edge_only",
    external_business_effects_by_agents: 0
  };
}
