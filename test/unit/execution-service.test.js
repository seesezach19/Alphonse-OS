import assert from "node:assert/strict";
import test from "node:test";

import { compareInventory, toEpochMilliseconds, validateExecutionAdmissionInput,
  validateExecutionCompletionInput } from "../../src/execution-service.js";

const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function admission() {
  return { idempotency_key: "inventory-comparison:SKU-100:v1", passport_id: id("1"), work_intent_id: id("2"),
    delegation_id: id("3"), capability_activation_id: id("4"), package_version_id: id("5"),
    skill: { export_id: "compare_inventory", contract_version: "1.0.0", export_digest: `sha256:${"a".repeat(64)}` },
    context_receipt_ids: [id("6")], limits: { subjects: ["SKU-100"], sources: ["erp", "storefront"],
      max_items: 2, max_context_age_seconds: 300 },
    evidence_requirements: ["signed source links", "typed discrepancy result"],
    expires_at: "2030-01-01T00:00:00.000Z" };
}

test("execution admission requires exact identity, authority, context, limits, evidence, and expiry shape", () => {
  const result = validateExecutionAdmissionInput(admission());
  assert.equal(result.limits.max_items, 2);
  assert.equal(result.skill.export_id, "compare_inventory");
});

test("execution admission rejects unknown fields, duplicate receipts, and unbounded limits", () => {
  const unknown = admission();
  unknown.ambient_context = "forbidden";
  assert.throws(() => validateExecutionAdmissionInput(unknown));
  const duplicate = admission();
  duplicate.context_receipt_ids.push(duplicate.context_receipt_ids[0]);
  assert.throws(() => validateExecutionAdmissionInput(duplicate));
  const unbounded = admission();
  unbounded.limits.max_items = 1001;
  assert.throws(() => validateExecutionAdmissionInput(unbounded));
});

test("comparison executes the exact package JSON-Logic program", () => {
  const program = { discrepancy: { "-": [{ var: "erp_quantity" }, { var: "storefront_quantity" }] },
    correction_required: { "!==": [{ var: "erp_quantity" }, { var: "storefront_quantity" }] } };
  const output = compareInventory(program, [
    { source: "erp", quantity: 24 }, { source: "storefront", quantity: 18 }
  ]);
  assert.deepEqual(output, { discrepancy: 6, correction_required: true });
});

test("stored database timestamps retain millisecond precision", () => {
  const instant = new Date("2030-01-01T00:00:00.987Z");
  assert.equal(toEpochMilliseconds(instant), 1_893_456_000_987);
  assert.equal(toEpochMilliseconds(instant), toEpochMilliseconds(instant.toISOString()));
});

test("comparison completion rejects duplicate source subjects", () => {
  const observation = { source: "erp", subject: "SKU-100", quantity: 24,
    observed_at: "2030-01-01T00:00:00.000Z", item_hash: `sha256:${"b".repeat(64)}` };
  assert.throws(() => validateExecutionCompletionInput({ run_id: id("7"), envelope_id: id("8"),
    observations: [observation, { ...observation }], output: { discrepancy: 0, correction_required: false } }),
  (error) => error.code === "INVALID_COMPARISON_INPUT");
});
