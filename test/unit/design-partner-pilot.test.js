import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPilotPacket, validatePilotPacketEntries } from "../../scripts/build-pilot-packet.js";
import { qualifyDesignPartnerPilot } from "../../scripts/qualify-design-partner-pilot.js";
import { pilotDigest, validatePilotEvidence, validatePilotPlan } from "../../pilot/v0.2.0/pilot-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = async (name) => JSON.parse(await readFile(path.join(root, "pilot/v0.2.0", name), "utf8"));

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

async function partnerPlan() {
  const plan = await fixture("pilot-plan.json");
  plan.status = "partner_precommitted";
  plan.commercial.pricing_status = "partner_precommitted_hypothesis";
  return plan;
}

async function completeEvidence(plan) {
  const steps = ["install", "onboard", "observe", "diagnose", "repair", "verify", "authorize",
    "target_confirm", "assurance_export"];
  return {
    schema_version: "alphonse.design_partner_pilot_evidence.v0.2",
    plan_digest: pilotDigest(plan),
    pilot_id: "00000000-0000-4000-8000-000000000001",
    started_at: "2026-07-21T14:00:00.000Z",
    finished_at: "2026-07-21T16:00:00.000Z",
    operator: {
      operator_id: "operator:external-human-01",
      unfamiliar_with_alphonse: true,
      repository_accessed: false,
      allowed_materials: ["pilot_packet", "release_archive", "public_protocol", "operations_console",
        "authorized_n8n_access"],
      human_attention_ms: 3600000,
      undocumented_steps: []
    },
    agency: {
      agency_id: "agency:design-partner-01",
      agreement_digest: digest("1"),
      agreement_signed_at: "2026-07-20T14:00:00.000Z",
      decision_terms_precommitted: true
    },
    client: { client_id: "client:real-01", real_client: true, consent_digest: digest("2") },
    workflow: {
      workflow_id: "n8n:existing-customer-workflow-01",
      existing_workflow: true,
      customer_owned: true,
      low_risk: true,
      reversible: true,
      pre_pilot_backup_digest: digest("3"),
      managed_tls: true,
      provider_credentials_at_adapter_edge: true,
      rollback_reference_digest: digest("4"),
      selection_record_digest: digest("a"),
      hard_gates_passed: true,
      preference_score: 14
    },
    journey: steps.map((step, index) => ({
      step,
      completed_at: new Date(Date.parse("2026-07-21T14:05:00.000Z") + index * 600000).toISOString(),
      public_evidence_ref: `assurance:event:${index + 1}`
    })),
    friction: [],
    incident: {
      case_id: "00000000-0000-4000-8000-000000000002",
      real_incident: true,
      observed_behavior_digest: digest("5"),
      expected_behavior_digest: digest("6")
    },
    repair: {
      candidate_id: "00000000-0000-4000-8000-000000000003",
      verification_id: "00000000-0000-4000-8000-000000000004",
      promotion_id: "00000000-0000-4000-8000-000000000005",
      owner_authorization_id: "00000000-0000-4000-8000-000000000006",
      repair_worker_id: "worker:bounded-01",
      verifier_id: "verifier:independent-01",
      owner_id: "owner:named-customer-01",
      independently_verified: true,
      owner_authorized: true,
      target_confirmation_digest: digest("7"),
      rollback_reference_digest: digest("4"),
      duplicate_consequential_effects: 0
    },
    assurance: {
      bundle_digest: digest("8"),
      client_reviewed: true,
      useful_to_client: true,
      limitations_acknowledged: true
    },
    commercial: {
      decision: "retain_paid",
      decided_at: "2026-07-22T14:00:00.000Z",
      agreement_digest: digest("9"),
      monthly_amount: 1500,
      currency: "USD"
    },
    limitations: ["Single-host deployment without high availability."]
  };
}

test("pilot plan is closed, release-pinned, and content-addressed", async () => {
  const plan = await fixture("pilot-plan.json");
  assert.equal(validatePilotPlan(plan).valid, true);
  assert.equal(pilotDigest(plan), pilotDigest(JSON.parse(JSON.stringify(plan))));
  assert.equal(qualifyDesignPartnerPilot(plan).packet_prepared, true);
  assert.equal(qualifyDesignPartnerPilot(plan).qualified, false);
});

test("deterministic packet contains exactly the public plan allowlist", async () => {
  const first = await buildPilotPacket(root);
  const second = await buildPilotPacket(root);
  assert.deepEqual(first.archive, second.archive);
  assert.equal(first.archiveDigest, second.archiveDigest);
  assert.match(first.archiveName, /^alphonse-v0\.2\.0-pilot-packet-[0-9a-f]{16}\.tar$/);
  assert.deepEqual(first.entries.map((entry) => entry.path).sort(), [...first.plan.release.public_materials].sort());
  assert.equal(first.policy.valid, true);
  assert.equal(first.manifest.archive.normalized_mtime, 0);

  const leaked = [...first.entries, { path: "extra.txt", mode: 0o644,
    bytes: Buffer.from("Bearer abcdefghijklmnopqrstuvwxyz") }];
  const policy = validatePilotPacketEntries(leaked, first.plan);
  assert.equal(policy.valid, false);
  assert.ok(policy.issues.some((entry) => entry.code === "PILOT_SECRET_MATERIAL_INCLUDED"));
});

test("template cannot qualify and complete precommitted real evidence can", async () => {
  const draft = await fixture("pilot-plan.json");
  const template = await fixture("pilot-evidence.template.json");
  assert.equal(validatePilotEvidence(draft, template).valid, false);

  const plan = await partnerPlan();
  const evidence = await completeEvidence(plan);
  const result = validatePilotEvidence(plan, evidence);
  assert.deepEqual(result, { valid: true, technical_qualified: true, commercial_qualified: true, issues: [] });
  assert.equal(qualifyDesignPartnerPilot(plan, evidence).qualified, true);
});

test("operator, independence, duplicate-effect, and commercial boundaries fail closed", async () => {
  const plan = await partnerPlan();
  const baseline = await completeEvidence(plan);
  const mutate = (callback) => {
    const value = JSON.parse(JSON.stringify(baseline));
    callback(value);
    return validatePilotEvidence(plan, value);
  };
  assert.equal(mutate((value) => { value.operator.repository_accessed = true; }).technical_qualified, false);
  assert.equal(mutate((value) => { value.repair.verifier_id = value.repair.repair_worker_id; }).technical_qualified, false);
  assert.equal(mutate((value) => { value.repair.duplicate_consequential_effects = 1; }).technical_qualified, false);
  assert.equal(mutate((value) => { value.client.real_client = false; }).technical_qualified, false);
  assert.equal(mutate((value) => { value.workflow.preference_score = 11; }).technical_qualified, false);
  assert.equal(mutate((value) => { value.journey[2].completed_at = value.journey[1].completed_at; })
    .technical_qualified, false);
  const declined = mutate((value) => { value.commercial.decision = "decline"; });
  assert.equal(declined.technical_qualified, true);
  assert.equal(declined.commercial_qualified, false);
  assert.equal(mutate((value) => { value.commercial.monthly_amount = 1499; }).commercial_qualified, false);
  assert.equal(mutate((value) => { value.commercial.decided_at = "2026-08-02T14:00:00.000Z"; })
    .commercial_qualified, false);
});
