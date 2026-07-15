import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromotionAuthorization,
  projectPromotion,
  promotionAuthority
} from "../../src/diagnostic-promotion-contracts.js";

const input = {
  promotionId: "00000000-0000-4000-8000-000000000801",
  caseId: "00000000-0000-4000-8000-000000000401",
  candidateId: "00000000-0000-4000-8000-000000000501",
  deliveryId: "00000000-0000-4000-8000-000000000601",
  verificationId: "00000000-0000-4000-8000-000000000701",
  binding: {
    binding_id: "00000000-0000-4000-8000-000000000602",
    adapter: { adapter_id: "alphonse.n8n.repair-delivery", adapter_version: "0.2.0" },
    target: { system: "n8n", target_type: "workflow", target_id: "InventoryDefect1", environment: "customer-local" }
  },
  owner: { type: "human", id: "local-bootstrap-owner" },
  expectedTargetRevisionDigest: `sha256:${"a".repeat(64)}`,
  candidateTargetRevisionDigest: `sha256:${"b".repeat(64)}`,
  verificationReceiptDigest: `sha256:${"c".repeat(64)}`,
  idempotencyKey: "promote-ticket-08"
};

test("Promotion authorization binds exact owner, evidence, target, adapter, and revisions", () => {
  const authorization = buildPromotionAuthorization(input);
  assert.equal(authorization.owner.type, "human");
  assert.equal(authorization.target.target_id, "InventoryDefect1");
  assert.equal(authorization.adapter.adapter_id, "alphonse.n8n.repair-delivery");
  assert.match(authorization.authorization_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(authorization.authority.promotion, "owner_authorized_adapter_only");
  assert.equal(authorization.authority.rollback, "not_granted");
});

test("machine identities cannot create Promotion authorization", () => {
  for (const type of ["repair_worker", "diagnostic_worker", "verification_runner", "runtime_adapter"]) {
    assert.throws(() => buildPromotionAuthorization({ ...input, owner: { type, id: "machine-1" } }),
      (error) => error.code === "OWNER_AUTHORITY_REQUIRED");
  }
});

test("Promotion projection keeps authorization, application, and confirmation distinct", () => {
  assert.deepEqual(projectPromotion([{ event_type: "authorized" }]), {
    state: "authorized",
    legal_next_operations: ["diagnostic.promotion.apply"],
    authority: promotionAuthority("authorized")
  });
  assert.equal(projectPromotion([
    { event_index: 1, event_type: "authorized" },
    { event_index: 2, event_type: "application_requested" },
    { event_index: 3, event_type: "applying" }
  ]).state, "applying");
  const confirmed = projectPromotion([
    { event_index: 1, event_type: "authorized" },
    { event_index: 2, event_type: "application_requested" },
    { event_index: 3, event_type: "applying" },
    { event_index: 4, event_type: "confirmed" }
  ]);
  assert.equal(confirmed.state, "confirmed");
  assert.deepEqual(confirmed.legal_next_operations, [
    "diagnostic.promotion.rollback", "diagnostic.promotion.get"
  ]);
  assert.equal(confirmed.authority.rollback, "owner_only");
});

test("uncertain Promotion permits reconciliation but never blind application", () => {
  const events = [
    { event_index: 1, event_type: "authorized" },
    { event_index: 2, event_type: "application_requested" },
    { event_index: 3, event_type: "applying" },
    { event_index: 4, event_type: "uncertain" }
  ];
  assert.equal(projectPromotion(events.slice(0, 2)).state, "requested");
  assert.equal(projectPromotion(events.slice(0, 3)).state, "applying");
  const uncertain = projectPromotion(events);
  assert.equal(uncertain.state, "uncertain");
  assert.deepEqual(uncertain.legal_next_operations,
    ["diagnostic.promotion.reconcile", "diagnostic.promotion.get"]);
  assert.equal(uncertain.legal_next_operations.includes("diagnostic.promotion.apply"), false);
});

test("reconciliation and rollback outcomes remain distinct projections", () => {
  const base = [
    { event_index: 1, event_type: "authorized" },
    { event_index: 2, event_type: "application_requested" },
    { event_index: 3, event_type: "applying" },
    { event_index: 4, event_type: "uncertain" }
  ];
  assert.equal(projectPromotion([...base, { event_index: 5, event_type: "confirmed" }]).state, "confirmed");
  assert.equal(projectPromotion([...base, { event_index: 5, event_type: "failed" }]).state, "failed");
  assert.equal(projectPromotion([...base, { event_index: 5, event_type: "target_mismatch" }]).state,
    "target_mismatch");
  assert.equal(projectPromotion([...base, { event_index: 5, event_type: "confirmed" },
    { event_index: 6, event_type: "rollback_authorized" }]).state, "rolling_back");
  const rolledBack = projectPromotion([...base, { event_index: 5, event_type: "confirmed" },
    { event_index: 6, event_type: "rollback_authorized" },
    { event_index: 7, event_type: "rolled_back" }]);
  assert.equal(rolledBack.state, "rolled_back");
  assert.equal(rolledBack.authority.rollback, "not_granted");
});
