import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  createN8nRepairDeliveryAdapter,
  LOGICAL_OPERATION_DEDUPLICATION_PATCH,
  materializeInventoryCandidate,
  materializeInventoryRepair,
  materializeLogicalOperationRepair,
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

const leadWorkflow = {
  id: "CanonicalLeadIngress01", name: "Canonical Proof - Lead Ingress", active: true,
  settings: { executionOrder: "v1" },
  nodes: [
    { id: "in", name: "Receive Lead Delivery", type: "n8n-nodes-base.webhook",
      typeVersion: 2, position: [0, 0], parameters: {} },
    { id: "out", name: "Create CRM Lead", type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2, position: [280, 0], parameters: {} }
  ],
  connections: { "Receive Lead Delivery": { main: [[{
    node: "Create CRM Lead", type: "main", index: 0
  }]] } }
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("n8n repair endpoint must pass a startup health check", async () => {
  const calls = [];
  const adapter = createN8nRepairDeliveryAdapter({
    baseUrl: "http://n8n.test/api/v1",
    apiKey: "customer-owned-key",
    fetchImpl: async (url) => {
      calls.push(url);
      return jsonResponse({ status: "healthy" });
    }
  });
  assert.deepEqual(await adapter.checkHealth(), { status: "healthy", endpoint: "http://n8n.test" });
  assert.deepEqual(calls, ["http://n8n.test/healthz"]);
});

test("n8n repair endpoint health failure is explicit", async () => {
  const adapter = createN8nRepairDeliveryAdapter({
    baseUrl: "http://n8n.test/api/v1",
    apiKey: "customer-owned-key",
    fetchImpl: async () => { throw new TypeError("unreachable"); }
  });
  await assert.rejects(adapter.checkHealth(),
    (error) => error.code === "N8N_REPAIR_DELIVERY_UNAVAILABLE");
});

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

test("n8n adapter materializes only the exact logical-operation repair as an inactive candidate", () => {
  const candidate = materializeLogicalOperationRepair(
    leadWorkflow, LOGICAL_OPERATION_DEDUPLICATION_PATCH, "candidate-lead-1"
  );
  assert.equal(candidate.active, false);
  assert.equal(candidate.nodes.some((node) => node.name === "Deduplicate Logical Operation"), true);
  assert.deepEqual(candidate.connections["Receive Lead Delivery"].main[0], [{
    node: "Deduplicate Logical Operation", type: "main", index: 0
  }]);
  assert.deepEqual(candidate.connections["Deduplicate Logical Operation"].main[0], [{
    node: "Create CRM Lead", type: "main", index: 0
  }]);
  assert.equal(leadWorkflow.nodes.length, 2);
  assert.throws(() => materializeLogicalOperationRepair(leadWorkflow, {
    ...LOGICAL_OPERATION_DEDUPLICATION_PATCH,
    changes: [{ operation: "insert", path: "before.destination_effect", value: "arbitrary" }]
  }, "candidate-lead-2"), (error) => error.code === "N8N_REPAIR_PATCH_UNSUPPORTED");
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

test("n8n candidate creation rejects target drift before POST", async () => {
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
});

test("n8n promotion applies exact candidate behavior to the bound target and confirms it", async () => {
  const original = structuredClone(baseWorkflow);
  original.active = true;
  const candidate = materializeInventoryRepair(original, patch, "candidate-801");
  candidate.id = "CandidateNative801";
  let active = structuredClone(original);
  const calls = [];
  const adapter = createN8nRepairDeliveryAdapter({
    baseUrl: "http://n8n.test/api/v1",
    apiKey: "test-only-key",
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method ?? "GET" });
      if (path.endsWith("/workflows/CandidateNative801")) return jsonResponse(candidate);
      if (path.endsWith("/workflows/InventoryDefect1") && init.method === "PUT") {
        const body = JSON.parse(init.body);
        active = { ...active, ...body, id: original.id, active: true, versionId: "promoted-version-801" };
        return jsonResponse(active);
      }
      if (path.endsWith("/workflows/InventoryDefect1")) return jsonResponse(active);
      return jsonResponse({ message: "missing" }, 404);
    }
  });
  const expectedBase = sha256Digest(n8nTargetRevisionMaterial(original));
  const candidateDigest = sha256Digest(n8nTargetRevisionMaterial(candidate));
  const result = await adapter.promote({
    target: { target_id: "InventoryDefect1" },
    expected_base_revision_digest: expectedBase,
    candidate_target_id: candidate.id,
    candidate_target_revision_digest: candidateDigest,
    idempotency_key: "promotion-801"
  });
  assert.equal(result.previous.target_revision_digest, expectedBase);
  assert.equal(result.confirmation.target_revision_digest,
    sha256Digest(n8nTargetRevisionMaterial(active)));
  assert.equal(result.confirmation.candidate_behavior_confirmed, true);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "PUT", "GET"]);
  assert.equal(calls.some((call) => call.path.includes("executions")), false);
});

test("n8n promotion rejects stale base before PUT", async () => {
  const drifted = { ...baseWorkflow, active: true, versionId: "newer-work" };
  let writes = 0;
  const adapter = createN8nRepairDeliveryAdapter({
    baseUrl: "http://n8n.test/api/v1",
    apiKey: "test-only-key",
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "PUT") writes += 1;
      return jsonResponse(drifted);
    }
  });
  await assert.rejects(() => adapter.promote({
    target: { target_id: "InventoryDefect1" },
    expected_base_revision_digest: `sha256:${"a".repeat(64)}`,
    candidate_target_id: "CandidateNative801",
    candidate_target_revision_digest: `sha256:${"b".repeat(64)}`,
    idempotency_key: "promotion-drift"
  }), (error) => error.code === "REPAIR_TARGET_DRIFT");
  assert.equal(writes, 0);
});

test("n8n reconciliation distinguishes applied, not applied, and mismatch without writes", async () => {
  const original = structuredClone(baseWorkflow);
  original.active = true;
  const candidate = materializeInventoryRepair(original, patch, "candidate-901");
  candidate.id = "CandidateNative901";
  const originalDigest = sha256Digest(n8nTargetRevisionMaterial(original));
  const candidateDigest = sha256Digest(n8nTargetRevisionMaterial(candidate));
  let current = structuredClone(candidate);
  current.id = original.id;
  current.name = original.name;
  current.active = true;
  current.versionId = "applied-901";
  let writes = 0;
  const adapter = createN8nRepairDeliveryAdapter({
    baseUrl: "http://n8n.test/api/v1", apiKey: "test-only-key",
    fetchImpl: async (url, init = {}) => {
      if (init.method === "PUT") writes += 1;
      return jsonResponse(new URL(url).pathname.endsWith("/CandidateNative901") ? candidate : current);
    }
  });
  const input = {
    target: { target_id: original.id },
    previous_target_revision_digest: originalDigest,
    candidate_target_id: candidate.id,
    candidate_target_revision_digest: candidateDigest
  };
  assert.equal((await adapter.reconcilePromotion(input)).outcome, "applied");
  current = original;
  assert.equal((await adapter.reconcilePromotion(input)).outcome, "not_applied");
  current = { ...original, settings: { executionOrder: "v1", unrelatedChange: true },
    versionId: "mismatch-901" };
  assert.equal((await adapter.reconcilePromotion(input)).outcome, "target_mismatch");
  assert.equal(writes, 0);
});

test("n8n rollback is separately fenced and confirms restored behavior", async () => {
  const original = structuredClone(baseWorkflow);
  original.active = true;
  const candidate = materializeInventoryRepair(original, patch, "candidate-rollback-901");
  let current = { ...candidate, id: original.id, name: original.name, active: true,
    versionId: "promoted-901" };
  const promotedDigest = sha256Digest(n8nTargetRevisionMaterial(current));
  let writes = 0;
  const adapter = createN8nRepairDeliveryAdapter({
    baseUrl: "http://n8n.test/api/v1", apiKey: "test-only-key",
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "PUT") {
        writes += 1;
        current = { ...current, ...JSON.parse(init.body), id: original.id, active: true,
          versionId: "rollback-901" };
      }
      return jsonResponse(current);
    }
  });
  const result = await adapter.rollback({
    target: { target_id: original.id },
    expected_current_revision_digest: promotedDigest,
    rollback_representation: n8nTargetRevisionMaterial(original),
    idempotency_key: "rollback-901"
  });
  assert.equal(result.confirmation.rollback_behavior_confirmed, true);
  assert.equal(writes, 1);
  assert.match(JSON.stringify(current), /customer_delay_follow_up/);

  await assert.rejects(() => adapter.rollback({
    target: { target_id: original.id },
    expected_current_revision_digest: promotedDigest,
    rollback_representation: n8nTargetRevisionMaterial(original),
    idempotency_key: "rollback-stale-901"
  }), (error) => error.code === "REPAIR_TARGET_DRIFT");
  assert.equal(writes, 1);
});
