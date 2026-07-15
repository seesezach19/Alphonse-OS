import assert from "node:assert/strict";
import test from "node:test";

import { projectExternalActivityTrace } from "../../src/diagnostic-runtime-service.js";

function event(sequence, lifecycleClaim, receivedAt, outOfOrder = false) {
  return {
    receipt_id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    event_id: `event-${sequence}`,
    event_sequence: String(sequence),
    lifecycle_claim: lifecycleClaim,
    occurred_at: `2026-07-15T15:59:${String(sequence).padStart(2, "0")}.000Z`,
    received_at: receivedAt,
    out_of_order: outOfOrder
  };
}

test("External Activity projection follows sequence while preserving delayed and contradictory truth", () => {
  const events = [
    event(3, "running", "2026-07-15T16:00:01.000Z"),
    event(1, "accepted", "2026-07-15T16:00:02.000Z", true),
    event(2, "succeeded", "2026-07-15T16:00:03.000Z", true)
  ];
  const projection = projectExternalActivityTrace(events);

  assert.equal(projection.current_lifecycle_claim, "running");
  assert.equal(projection.current_event_sequence, "3");
  assert.equal(projection.projection_basis, "highest_event_sequence");
  assert.equal(projection.out_of_order_observed, true);
  assert.deepEqual(projection.terminal_claims_observed, ["succeeded"]);
  assert.equal(projection.terminal_regression_observed, true);
  assert.deepEqual(projection.lifecycle_history.map((item) => item.event_sequence), ["1", "2", "3"]);
});

test("External Activity projection exposes conflicting terminal claims without adjudication", () => {
  const projection = projectExternalActivityTrace([
    event(1, "succeeded", "2026-07-15T16:00:01.000Z"),
    event(2, "failed", "2026-07-15T16:00:02.000Z")
  ]);
  assert.deepEqual(projection.terminal_claims_observed, ["failed", "succeeded"]);
  assert.equal(projection.conflicting_terminal_claims, true);
  assert.equal(projection.claim_trusted_as_kernel_truth, false);
});
