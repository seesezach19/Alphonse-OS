import assert from "node:assert/strict";
import test from "node:test";

import { classifyCorrelationProjectionReplay } from "../../src/diagnostic-correlation-service.js";

const existing = {
  projector_input_digest: `sha256:${"1".repeat(64)}`,
  semantic_digest: `sha256:${"2".repeat(64)}`,
  semantic_projection: { stable: true }
};

test("replay classification distinguishes exact input history from projector nondeterminism", () => {
  assert.equal(classifyCorrelationProjectionReplay(existing, { ...existing }), "exact_replay");
  assert.equal(classifyCorrelationProjectionReplay(existing, {
    ...existing, projector_input_digest: `sha256:${"3".repeat(64)}`
  }), "input_history_divergence");
  assert.equal(classifyCorrelationProjectionReplay(existing, {
    ...existing, semantic_digest: `sha256:${"4".repeat(64)}`, semantic_projection: { stable: false }
  }), "nondeterminism");
});
