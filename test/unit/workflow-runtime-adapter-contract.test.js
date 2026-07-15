import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWorkflowRuntimeAdapterManifest,
  getWorkflowRuntimeAdapterContract
} from "../../src/workflow-runtime-adapter-contract.js";

function manifest(overrides = {}) {
  return {
    adapter_id: "example.workflow-runtime",
    adapter_version: "1.2.3",
    contract_version: "0.2.0",
    capabilities: {
      workflow_identity: { supported: true },
      revision_identity: { supported: true },
      event_receipt: { supported: true },
      detail_retrieval: { supported: true },
      replay: { supported: false },
      health: { supported: true }
    },
    ...overrides
  };
}

test("Workflow Runtime Adapter contract is provider-neutral and describes all extension seams", () => {
  const contract = getWorkflowRuntimeAdapterContract();
  assert.equal(contract.contract_version, "0.2.0");
  assert.deepEqual(Object.keys(contract.capabilities), [
    "workflow_identity",
    "revision_identity",
    "event_receipt",
    "detail_retrieval",
    "replay",
    "health"
  ]);
  assert.equal(contract.capabilities.detail_retrieval.requirement, "optional");
  assert.equal(contract.capabilities.replay.requirement, "optional");
  for (const capability of Object.values(contract.capabilities)) {
    assert.ok(capability.operation.operation_id);
    assert.ok(capability.operation.input_schema);
    assert.ok(capability.operation.output_schema);
  }
  assert.doesNotMatch(JSON.stringify(contract), /n8n|zapier|make\.com/i);
  assert.deepEqual(assertWorkflowRuntimeAdapterManifest(manifest()), manifest());
});

test("Adapter conformance requires core capabilities and rejects provider fields", () => {
  assert.throws(() => assertWorkflowRuntimeAdapterManifest(manifest({
    capabilities: { ...manifest().capabilities, health: { supported: false } }
  })), (error) => error.code === "RUNTIME_ADAPTER_CAPABILITY_REQUIRED");
  assert.throws(() => assertWorkflowRuntimeAdapterManifest({ ...manifest(), n8n_workflow_id: "42" }),
    (error) => error.code === "INVALID_RUNTIME_ADAPTER_MANIFEST");
});

test("optional detail retrieval returns scoped transient detail through the provider-neutral contract", () => {
  const contract = getWorkflowRuntimeAdapterContract();
  const detail = contract.capabilities.detail_retrieval.operation;
  assert.deepEqual(detail.input_schema.required,
    ["external_execution_id", "payload_reference", "requested_fields"]);
  assert.deepEqual(detail.output_schema.required, ["external_execution_id", "detail", "omitted_fields"]);
  assert.equal(detail.output_schema.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(detail), /n8n/i);
});
