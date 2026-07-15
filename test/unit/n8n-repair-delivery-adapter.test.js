import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  createN8nRepairDeliveryAdapter,
  materializeInventoryCandidate,
  materializeInventoryRepair,
  n8nTargetRevisionMaterial
} from "../../packages/n8n-operational-package/src/repair-delivery-adapter.js";

const baseWorkflow = {
  id: "InventoryDefect1",
  name: "Inventory Follow-up - Defective Missing SKU Mapping",
  active: true,
  settings: { executionOrder: "v1" },
  nodes: [
    { id: "map", name: "Defective Missing SKU Mapping", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [0, 0], parameters: { jsCode: "erpRecord?.quantity ?? 0" } },
    { id: "draft", name: "Draft for Local Review", type: "n8n-nodes-base.code",
      typeVersion: 2, position: [200, 0], parameters: { jsCode: "customer_delay_follow_up" } }
  ],
  connections: { "Defective Missing SKU Mapping": { main: [[{
    node: "Draft for Local Review", type: "main", index: 0
  }]] } },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z"
};

const patch = {
  format: "provider-neutral-repair-patch",
  changes: [
    { operation: "replace", path: "missing_sku", value: "inventory_unknown" },
    { operation: "replace", path: "inventory_unknown.next", value: "human_review" }
  ]
};

test("n8n repair preserves inventory_unknown and removes the false delay draft", () => {
  const candidate = materializeInventoryRepair(baseWorkflow, patch, "candidate-601");
  assert.equal(candidate.active, false);
  assert.notEqual(candidate.id, baseWorkflow.id);
  assert.match(JSON.stringify(candidate), /inventory_unknown/);
  assert.match(JSON.stringify(candidate), /human_review/);
  assert.doesNotMatch(JSON.stringify(candidate), /customer_delay_follow_up/);
  assert.match(JSON.stringify(baseWorkflow), /customer_delay_follow_up/);
});

test("n8n adapter may materialize an exact ineffective candidate for independent rejection", () => {
  const candidate = materializeInventoryCandidate(baseWorkflow, {
    format: "provider-neutral-repair-patch",
    changes: [
      { operation: "replace", path: "missing_sku", value: "zero_inventory" },
      { operation: "replace", path: "zero_inventory.next", value: "delay_draft" }
    ]
  }, "candidate-bad-701");
  assert.equal(candidate.active, false);
  assert.match(JSON.stringify(candidate), /customer_delay_follow_up/);
  assert.doesNotMatch(JSON.stringify(candidate), /inventory_unknown/);
});

test("n8n adapter inspects exact base then creates one inactive target-native candidate", async () => {
  const created = [];
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (init.method === "POST") {
      const input = JSON.parse(init.body);
      const output = { ...input, id: "CandidateNative601", active: false,
        createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" };
      created.push(output);
      return new Response(JSON.stringify(output), { status: 200,
        headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(baseWorkflow), { status: 200,
      headers: { "content-type": "application/json" } });
  };
  const adapter = createN8nRepairDeliveryAdapter({
    baseUrl: "http://n8n.test/api/v1", apiKey: "customer-owned-key", fetchImpl
  });
  const inspected = await adapter.inspect({ target_id: baseWorkflow.id });
  const expected = sha256Digest(n8nTargetRevisionMaterial(baseWorkflow));
  assert.equal(inspected.target_revision_digest, expected);
  const delivered = await adapter.createCandidate({
    target: { target_id: baseWorkflow.id }, expected_base_revision_digest: expected,
    repair_candidate_id: "00000000-0000-4000-8000-000000000602",
    repair_artifact: patch, idempotency_key: "delivery-601"
  });
  assert.equal(delivered.base.target_revision_digest, expected);
  assert.equal(delivered.candidate.active, false);
  assert.equal(delivered.candidate.target_id, "CandidateNative601");
  assert.equal(created.length, 1);
  assert.equal(calls.at(-1).init.headers["X-N8N-API-KEY"], "customer-owned-key");
  assert.equal("active" in JSON.parse(calls.at(-1).init.body), false);
});

test("n8n adapter rejects target drift before POST and has no promotion method", async () => {
  let posts = 0;
  const adapter = createN8nRepairDeliveryAdapter({
    baseUrl: "http://n8n.test/api/v1", apiKey: "customer-owned-key",
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "POST") posts += 1;
      return new Response(JSON.stringify(baseWorkflow), { status: 200,
        headers: { "content-type": "application/json" } });
    }
  });
  await assert.rejects(adapter.createCandidate({
    target: { target_id: baseWorkflow.id },
    expected_base_revision_digest: `sha256:${"0".repeat(64)}`,
    repair_candidate_id: "00000000-0000-4000-8000-000000000602",
    repair_artifact: patch, idempotency_key: "delivery-drift"
  }), (error) => error.code === "REPAIR_TARGET_DRIFT");
  assert.equal(posts, 0);
  assert.equal(adapter.promote, undefined);
});
