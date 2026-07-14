import assert from "node:assert/strict";
import test from "node:test";

import { signDispatchPermit, validateCorrectionAdmissionInput,
  verifyDispatchPermit } from "../../src/effect-service.js";

const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function admission() {
  return {
    effect_idempotency_key: "storefront.inventory:set_quantity:SKU-100:24:v1",
    passport_id: id("1"), work_intent_id: id("2"), delegation_id: id("3"), workload_grant_id: id("4"),
    capability_activation_id: id("5"), package_version_id: id("6"), context_receipt_ids: [id("7")],
    target: { system: "storefront-staging", resource: "storefront.inventory", subject: "SKU-100" },
    action: "set_quantity", requested_value: { quantity: 24 },
    limits: { maximum_items: 1, maximum_quantity: 1000 },
    credential_binding: { binding_ref: "credential://storefront/inventory-writer",
      revision: "storefront-writer-rev-7", scopes: ["storefront.inventory.write"] },
    adapter: { export_id: "storefront_inventory_adapter", contract_version: "1.0.0",
      export_digest: `sha256:${"a".repeat(64)}` },
    evidence_requirements: ["storefront_response", "post_write_observation"],
    recovery: { strategy: "restore_previous_quantity", uncertainty: "reconcile_before_retry" },
    expires_at: "2030-01-01T00:00:00.000Z"
  };
}

test("correction admission binds exact effect authority and rejects ambient fields", () => {
  const normalized = validateCorrectionAdmissionInput(admission());
  assert.equal(normalized.target.subject, "SKU-100");
  assert.equal(normalized.requested_value.quantity, 24);
  assert.equal(normalized.credential_binding.revision, "storefront-writer-rev-7");
  const ambient = admission();
  ambient.prompt = "do whatever seems right";
  assert.throws(() => validateCorrectionAdmissionInput(ambient));
});

test("correction admission rejects unbounded values and duplicate context", () => {
  const excessive = admission();
  excessive.requested_value.quantity = 1001;
  assert.throws(() => validateCorrectionAdmissionInput(excessive));
  const duplicate = admission();
  duplicate.context_receipt_ids.push(duplicate.context_receipt_ids[0]);
  assert.throws(() => validateCorrectionAdmissionInput(duplicate));
});

test("dispatch permit signature binds exact canonical document", () => {
  const document = { permit_id: id("8"), effect_id: id("9"), request_digest: `sha256:${"b".repeat(64)}`,
    expires_at: "2030-01-01T00:00:00.000Z" };
  const signature = signDispatchPermit(document, "test-secret");
  assert.equal(verifyDispatchPermit(document, signature, "test-secret"), true);
  assert.equal(verifyDispatchPermit({ ...document, effect_id: id("10") }, signature, "test-secret"), false);
});
