import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  assessReconciliationCycle,
  buildCoverageReconciliationEvent,
  projectCoverageReconciliation,
  validateCoverageReconciliationAdvanceCommand
} from "../../src/coverage-reconciliation-contracts.js";

const digest = (character) => `sha256:${character.repeat(64)}`;
const onboardingId = "00000000-0000-4000-8000-000000000901";
const cycleId = "00000000-0000-4000-8000-000000000902";
const start = "2026-07-21T18:00:00.000Z";
const cutoff = "2026-07-21T19:00:00.000Z";

function observed(id, overrides = {}) {
  const material = { provider_execution_id: String(id), provider_workflow_id: "wf-1",
    provider_status: "success", execution_class: "production", provider_mode: "webhook",
    retry_of: null, retry_success_id: null, started_at: "2026-07-21T18:30:00.000Z",
    stopped_at: "2026-07-21T18:31:00.000Z", wait_until: null,
    revision: { status: "matched", provider_workflow_version_id: "v1",
      execution_workflow_material_digest: digest("a"), binding_digest: digest("b") }, ...overrides };
  return { ...material, observation_digest: sha256Digest(material), authority: "none" };
}

function eventRow(index, type, payload, prior = null, cycle = cycleId) {
  const built = buildCoverageReconciliationEvent({
    eventId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    onboardingId, eventIndex: index, cycleId: cycle, cycleIndex: cycle ? 1 : null,
    eventType: type, priorEventDigest: prior, payload,
    actor: { type: "agent", id: "agent:coverage" },
    occurredAt: payload.effective_at ?? cutoff
  });
  return { event_id: built.event_id, onboarding_id: onboardingId, event_index: index,
    cycle_id: cycle, cycle_index: cycle ? 1 : null, event_type: type,
    prior_event_digest: prior, event_digest: built.event_digest, payload,
    actor_type: "agent", actor_id: "agent:coverage", occurred_at: built.occurred_at };
}

test("reconciliation commands are closed and cannot accept caller-supplied pages or states", () => {
  const command = { schema_version: "alphonse.coverage-reconciliation-command.v0.1",
    command_id: "reconcile-1", operation_id: "diagnostic.coverage_reconciliation.advance",
    input: { onboarding_id: onboardingId,
      passport_id: "00000000-0000-4000-8000-000000000903",
      expected_reconciliation_revision: 0, expected_cycle_id: null, page_size: 50 } };
  assert.deepEqual(validateCoverageReconciliationAdvanceCommand(command), command);
  assert.throws(() => validateCoverageReconciliationAdvanceCommand({ ...command,
    input: { ...command.input, force_active: true } }), /fields must be exact/);
});

test("complete cursor evidence assesses active while manual and test runs remain visible limitations", () => {
  const result = assessReconciliationCycle({
    currentExecutions: [observed(1), observed(2, { execution_class: "manual", provider_mode: "manual" })],
    previousExecutions: [], pageDigests: [digest("c")], sourceCutoff: cutoff
  });
  assert.equal(result.assessment, "active");
  assert.equal(result.production_execution_count, 1);
  assert.equal(result.excluded_non_production_count, 1);
  assert.ok(result.limitations.some((item) => item.code ===
    "coverage.reconciliation.non_production_excluded"));
});

test("revision drift suspends and provider absence never erases historical loss", () => {
  const drift = observed(2, { revision: { status: "mismatched", provider_workflow_version_id: "v2",
    execution_workflow_material_digest: digest("d"), binding_digest: digest("b") } });
  const result = assessReconciliationCycle({ currentExecutions: [drift],
    previousExecutions: [observed(1)], pageDigests: [digest("c")], sourceCutoff: cutoff });
  assert.equal(result.assessment, "suspended");
  assert.ok(result.gaps.some((item) => item.code === "coverage.reconciliation.revision_drift"));
  assert.ok(result.gaps.some((item) => item.code ===
    "coverage.reconciliation.provider_history_absence"));
});

test("provider deletion remains a current gap across later complete walks until late fill", () => {
  const known = [observed(1), observed(2)];
  const stillMissing = assessReconciliationCycle({ currentExecutions: [observed(1)],
    previousExecutions: [observed(1)], historicalExecutions: known,
    pageDigests: [digest("c")], sourceCutoff: cutoff });
  assert.equal(stillMissing.assessment, "degraded");
  assert.ok(stillMissing.gaps.some((item) => item.code ===
    "coverage.reconciliation.provider_history_absence"));
  const filled = assessReconciliationCycle({ currentExecutions: known,
    previousExecutions: [observed(1)], historicalExecutions: known,
    pageDigests: [digest("d")], sourceCutoff: cutoff });
  assert.equal(filled.assessment, "active");
  assert.ok(filled.limitations.some((item) => item.code === "coverage.reconciliation.late_fill"));
});

test("interval projection closes immutable history and requires a completed recovery transition", () => {
  const started = eventRow(1, "cycle_started", { source_cutoff: cutoff });
  const completedPayload = { effective_at: cutoff, source_cutoff: cutoff, cycle_digest: digest("e"),
    assessment: "active", production_execution_count: 1, gaps: [], limitations: [] };
  const completed = eventRow(2, "cycle_completed", completedPayload, started.event_digest);
  const degradedAt = "2026-07-21T19:30:00.000Z";
  const degradedPayload = { effective_at: degradedAt, error_code: "PROVIDER_UNAVAILABLE",
    gaps: [{ gap_id: digest("f"), code: "coverage.reconciliation.provider_unavailable",
      detail: "Provider unavailable.", blocking: true }], limitations: [] };
  const degraded = eventRow(3, "reconciliation_degraded", degradedPayload,
    completed.event_digest, null);
  const projection = projectCoverageReconciliation({
    onboarding: { onboarding_id: onboardingId, opened_at: start, event_head_digest: digest("0"),
      workflow_reference: { system: "n8n", environment: "production", provider_workflow_id: "wf-1" } },
    eventRows: [started, completed, degraded], pageRows: [], observationRows: []
  });
  assert.deepEqual(projection.coverage_intervals.map((item) => item.state),
    ["unavailable", "active"]);
  assert.ok(projection.coverage_intervals.every((item) => item.immutable
    && item.end_exclusive && item.interval_digest));
  assert.equal(projection.current_coverage.state, "suspended");
  assert.equal(projection.current_coverage.open, true);
});
