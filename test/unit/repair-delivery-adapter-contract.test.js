import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRepairDeliveryAdapterManifest,
  projectRepairDelivery,
  validateRepairDeliveryBinding
} from "../../src/repair-delivery-adapter-contract.js";

const manifest = {
  adapter_id: "alphonse.n8n.repair-delivery",
  adapter_version: "0.2.0",
  target_system: "n8n",
  operations: {
    inspect: { supported: true, effect: "read_only" },
    snapshot: { supported: true, effect: "read_only" },
    candidate: { supported: true, effect: "create_inactive_candidate" },
    candidate_execution: { supported: false, effect: "unavailable" },
    review: { supported: false, effect: "unavailable" },
    promotion: { supported: false, effect: "unavailable" },
    confirmation: { supported: false, effect: "unavailable" },
    rollback: { supported: false, effect: "unavailable" }
  }
};

test("Repair Delivery Adapter declares every operation independently", () => {
  assert.deepEqual(assertRepairDeliveryAdapterManifest(manifest), manifest);
  const impliedPromotion = structuredClone(manifest);
  delete impliedPromotion.operations.promotion;
  assert.throws(() => assertRepairDeliveryAdapterManifest(impliedPromotion),
    (error) => error.code === "INVALID_REPAIR_DELIVERY_ADAPTER");
});

test("Repair Delivery Binding is secret-free and grants only supported operations", () => {
  const input = {
    binding_id: "00000000-0000-4000-8000-000000000601",
    adapter: { adapter_id: manifest.adapter_id, adapter_version: manifest.adapter_version },
    target: {
      system: "n8n", target_type: "workflow", target_id: "InventoryDefect1",
      environment: "customer-local"
    },
    external_credential_binding_ref: "customer-secret-store:n8n-repair-v1",
    permitted_operations: ["inspect", "snapshot", "candidate"],
    transition_policy: {
      candidate_initial_state: "inactive",
      require_expected_base_revision: true,
      preserve_prechange_snapshot: true,
      promotion_authority: "owner_only"
    }
  };
  const binding = validateRepairDeliveryBinding(input, manifest);
  assert.equal(binding.transition_policy.candidate_initial_state, "inactive");
  assert.deepEqual(binding.permitted_operations, ["inspect", "snapshot", "candidate"]);
  assert.doesNotMatch(JSON.stringify(binding), /api[_-]?key|password|bearer/i);

  assert.throws(() => validateRepairDeliveryBinding({ ...input,
    permitted_operations: [...input.permitted_operations, "promotion"] }, manifest),
  (error) => error.code === "REPAIR_DELIVERY_OPERATION_UNAVAILABLE");
  assert.throws(() => validateRepairDeliveryBinding({ ...input,
    api_key: "must-not-enter-the-binding" }, manifest),
  (error) => error.code === "INVALID_INPUT");
  assert.throws(() => validateRepairDeliveryBinding({ ...input,
    external_credential_binding_ref: "pasted-api-key-without-a-reference-scheme" }, manifest),
  (error) => error.code === "INVALID_EXTERNAL_CREDENTIAL_BINDING_REF");
});

test("inactive materialization exposes only verification as the legal next operation", () => {
  assert.deepEqual(projectRepairDelivery({ target_candidate_state: "inactive" }), {
    state: "inactive_candidate",
    legal_next_operations: ["diagnostic.repair_verification.create"],
    authority: {
      verification: "not_granted",
      owner_authorization: "not_granted",
      promotion: "not_granted",
      rollback: "not_granted"
    }
  });
});
