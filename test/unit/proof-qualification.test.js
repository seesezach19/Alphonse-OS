import assert from "node:assert/strict";
import test from "node:test";

import { validateQualificationPacket, verifyQualificationAgainstPublicState } from "../../src/proof-qualification.js";

const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const digest = (value) => `sha256:${value.repeat(64)}`;

function packet() {
  return {
    schema_version: "alphonse.unfamiliar_builder_proof.v0.1",
    proof_session_id: id("1"),
    started_at: "2030-01-01T09:00:00.000Z",
    finished_at: "2030-01-01T12:00:00.000Z",
    builder: {
      builder_id: "builder-01",
      unfamiliar_with_kernel_internals: true,
      has_not_built_operational_package: true,
      kernel_source_accessed: false,
      internal_schema_accessed: false,
      allowed_materials: ["kernel_protocol", "public_documentation", "builder_toolkit",
        "running_local_environment", "source_system_access"]
    },
    timing: { workflow_active_ms: 7_000_000, human_attention_ms: 1_000_000,
      agent_runtime_ms: 4_000_000, external_wait_ms: 500_000, environment_setup_ms: 600_000 },
    integrity: {
      kernel_source_before: digest("a"), kernel_source_after: digest("a"),
      schema_before: digest("b"), schema_after: digest("b"), direct_sql_used: false,
      authority_bypass_used: false, hidden_scaffold_used: false, secret_copied: false,
      duplicate_uncertain_effect: false, failure_history_erased: false
    },
    runtime_handoff: {
      handoff_id: id("2"), source_passport_id: id("3"), target_passport_id: id("4"),
      source_runtime: "codex", target_runtime: "openclaw", conversation_history_received: false,
      hidden_memory_received: false
    },
    staging_recovery: { recovery_case_id: id("5"), was_uncertain: true,
      final_status: "resolved_applied", completed_at: "2030-01-01T11:00:00.000Z" },
    production_effect: {
      effect_id: id("6"), run_id: id("7"), evidence_record_id: id("8"),
      capability_activation_id: id("9"), target_system: "storefront-production",
      target_subject: "SKU-100", provider: "customer_owned_non_aws", aws: false, selected_by_user: true,
      approved_by_user: true, reversible: true, completed_at: "2030-01-01T11:30:00.000Z"
    },
    operator_explanation: {
      source: "butler", identity: "Runtime B under sponsored passport.", intent: "Correct SKU-100.",
      versions: "Package 0.1.0 and exact activation.", context: "Fresh ERP and storefront receipts.",
      authority: "Approved bounded capability and one-use permit.", effect: "Quantity set once.",
      evidence: "Target receipt and post-write observation.", uncertainty: "Staging response was lost.",
      recovery: "Reconciliation proved the staging write.", final_accountability: "Succeeded and satisfied."
    },
    builder_reviews: Array.from({ length: 5 }, (_, index) => ({
      reviewer_id: `reviewer-${index + 1}`, understanding: "Understood exact authority and evidence model.",
      test_requests: ["Try a different workflow."], supplied_workflow_interest: index === 0,
      paid_workflow_interest: false
    }))
  };
}

test("complete unfamiliar-Builder proof packet qualifies structurally", () => {
  const result = validateQualificationPacket(packet());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("qualification fails closed on shortcuts, timing, staging order, and missing market reviews", () => {
  const invalid = packet();
  invalid.builder.kernel_source_accessed = true;
  invalid.timing.workflow_active_ms = 8 * 60 * 60 * 1000;
  invalid.integrity.direct_sql_used = true;
  invalid.staging_recovery.completed_at = "2030-01-01T11:45:00.000Z";
  invalid.builder_reviews.length = 4;
  const result = validateQualificationPacket(invalid);
  assert.equal(result.valid, false);
  const codes = new Set(result.issues.map((entry) => entry.code));
  for (const code of ["BUILDER_NOT_UNFAMILIAR", "ACTIVE_TIME_LIMIT_EXCEEDED", "DISQUALIFYING_SHORTCUT",
    "STAGING_RECOVERY_NOT_BEFORE_PRODUCTION", "BUILDER_REVIEWS_INCOMPLETE"]) assert.ok(codes.has(code), `missing ${code}`);
});

test("qualification requires distinct runtimes and an approved reversible non-AWS production effect", () => {
  const invalid = packet();
  invalid.runtime_handoff.target_passport_id = invalid.runtime_handoff.source_passport_id;
  invalid.runtime_handoff.target_runtime = invalid.runtime_handoff.source_runtime;
  invalid.production_effect.provider = "aws";
  invalid.production_effect.aws = true;
  invalid.production_effect.approved_by_user = false;
  invalid.production_effect.reversible = false;
  const result = validateQualificationPacket(invalid);
  assert.equal(result.valid, false);
  const codes = new Set(result.issues.map((entry) => entry.code));
  assert.ok(codes.has("RUNTIME_HANDOFF_NOT_DISTINCT"));
  assert.ok(codes.has("PRODUCTION_EFFECT_NOT_QUALIFIED"));
});

test("qualification cross-checks exact public Kernel and Butler records", async () => {
  const proof = packet();
  const bodies = new Map([
    [`/kernel/v0/handoffs/${proof.runtime_handoff.handoff_id}`, { handoff: {
      handoff_id: proof.runtime_handoff.handoff_id, state: "accepted",
      source_passport_id: proof.runtime_handoff.source_passport_id,
      target_passport_id: proof.runtime_handoff.target_passport_id,
      conversation_history_received: false, hidden_memory_received: false
    } }],
    [`/kernel/v0/recovery-cases/${proof.staging_recovery.recovery_case_id}`, { recovery_case: {
      recovery_case_id: proof.staging_recovery.recovery_case_id, status: "resolved_applied", was_uncertain: true,
      updated_at: proof.staging_recovery.completed_at
    } }],
    [`/kernel/v0/effects/${proof.production_effect.effect_id}`, { effect_record: {
      effect_id: proof.production_effect.effect_id, status: "succeeded", run_id: proof.production_effect.run_id,
      evidence_record_id: proof.production_effect.evidence_record_id,
      capability_activation_id: proof.production_effect.capability_activation_id,
      completed_at: proof.production_effect.completed_at,
      target: { system: proof.production_effect.target_system, subject: proof.production_effect.target_subject }
    } }],
    [`/kernel/v0/runs/${proof.production_effect.run_id}`, { run: {
      run_id: proof.production_effect.run_id, execution_status: "succeeded", accountability_status: "satisfied",
      evidence_record_id: proof.production_effect.evidence_record_id
    } }],
    [`/kernel/v0/evidence-records/${proof.production_effect.evidence_record_id}`, { evidence_record: {
      evidence_record_id: proof.production_effect.evidence_record_id, run_id: proof.production_effect.run_id
    } }],
    ["/kernel/v0/accountable-work/overview", { authority: "read_only_projection",
      handoffs: { items: [{ handoff_id: proof.runtime_handoff.handoff_id }] },
      effects: { items: [{ effect_id: proof.production_effect.effect_id }] },
      recovery_cases: { items: [{ recovery_case_id: proof.staging_recovery.recovery_case_id }] }
    }]
  ]);
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => bodies.get(new URL(url).pathname) });
  const result = await verifyQualificationAgainstPublicState(proof,
    { kernelUrl: "http://kernel.test", operatorToken: "not-a-real-secret", fetchImpl });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});
