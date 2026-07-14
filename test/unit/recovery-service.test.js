import assert from "node:assert/strict";
import test from "node:test";

import { signReconciliationPermit, validateReconciliationInput,
  verifyReconciliationPermit } from "../../src/recovery-service.js";

const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

test("reconciliation input binds one exact Recovery Case and Permit", () => {
  const input = validateReconciliationInput({ recovery_case_id: id("1"),
    reconciliation_permit_id: id("2"), permit_digest: `sha256:${"a".repeat(64)}` });
  assert.equal(input.recovery_case_id, id("1"));
  assert.throws(() => validateReconciliationInput({ ...input, retry: true }));
});

test("reconciliation permit signature binds canonical read-only authority", () => {
  const document = { permit_type: "effect_reconciliation", reconciliation_permit_id: id("2"),
    recovery_case_id: id("1"), effect_id: id("3"), action: "observe_quantity",
    request_digest: `sha256:${"b".repeat(64)}`,
    target: { system: "storefront-staging", resource: "storefront.inventory", subject: "SKU-100" },
    one_use: true, expires_at: "2030-01-01T00:00:00.000Z" };
  const signature = signReconciliationPermit(document, "test-secret");
  assert.equal(verifyReconciliationPermit(document, signature, "test-secret"), true);
  assert.equal(verifyReconciliationPermit({ ...document, action: "set_quantity" }, signature, "test-secret"), false);
});
