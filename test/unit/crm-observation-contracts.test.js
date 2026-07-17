import assert from "node:assert/strict";
import test from "node:test";

import {
  createCrmCommit,
  createCrmRequestObservationClaims,
  createCrmEffectObservationClaims
} from "../../src/mock-crm-contracts.js";

test("request observation proves acknowledgement without claiming commitment", () => {
  const claims = createCrmRequestObservationClaims({ request_id: "request_1", logical_operation_id: "op_1",
    delivery_id: "delivery_1", operation: "create_lead", transport_status: 201,
    idempotency_key_equality_token: "eq:v1:token" });
  assert.equal(claims.transport_outcome, "acknowledged");
  assert.equal("commit_status" in claims, false);
  assert.equal("resource_id" in claims, false);
});

test("append-only commit identity is stable and separate from HTTP acknowledgement", () => {
  const first = createCrmCommit({ request_id: "request_1", logical_operation_id: "op_1",
    delivery_id: "delivery_1", idempotency_key: "delivery_1", lead: { company: "Acme" } },
  "2026-07-16T12:00:00.000Z");
  const replay = createCrmCommit({ request_id: "request_1", logical_operation_id: "op_1",
    delivery_id: "delivery_1", idempotency_key: "delivery_1", lead: { company: "Acme" } },
  "2026-07-16T12:00:00.000Z");
  assert.equal(first.commit_id, replay.commit_id);
  const effect = createCrmEffectObservationClaims(first);
  assert.equal(effect.effect_feed, "mock_crm_append_only_ledger");
  assert.equal(effect.external_claim, true);
  assert.equal("normalized_effect_status" in effect, false);
});
