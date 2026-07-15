import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTIC_PROTOCOL_VERSION,
  getDiagnosticOperationDescriptor,
  listDiagnosticOperationDescriptors
} from "../../src/diagnostic-operations.js";

test("Diagnostic Protocol is self-describing and authority-free", () => {
  assert.equal(DIAGNOSTIC_PROTOCOL_VERSION, "0.2.0");
  const operations = listDiagnosticOperationDescriptors();
  assert.deepEqual(operations.map((item) => item.operation_id), [
    "diagnostic.workflow_runtime_adapter.contract.get",
    "diagnostic.agent_workflow.register",
    "diagnostic.agent_workflow.get",
    "diagnostic.agent_revision.register",
    "diagnostic.agent_revision.get",
    "diagnostic.artifact.get",
    "diagnostic.runtime_event.receive",
    "diagnostic.external_activity_trace.get",
    "diagnostic.runtime_event_conflict.get"
  ]);

  for (const operation of operations) {
    assert.match(operation.transport.path, /^\/diagnostic\/v0\//);
    assert.equal(operation.visibility, "public");
    assert.notEqual(operation.effect_class, "external_effect");
    assert.notEqual(operation.authority_class, "capability_authority");
    assert.ok(operation.idempotency);
    assert.ok(Array.isArray(operation.preconditions));
    assert.ok(Array.isArray(operation.outcomes));
    assert.ok(Array.isArray(operation.issues));
    assert.ok(Array.isArray(operation.emitted_events));
    assert.ok(Array.isArray(operation.next_operations));
  }
});

test("Runtime Event discovery exposes exact provider-neutral observation semantics", () => {
  const descriptor = getDiagnosticOperationDescriptor("diagnostic.runtime_event.receive");
  assert.equal(descriptor.authority_class, "exact_workflow_runtime_adapter_hmac");
  assert.equal(descriptor.effect_class, "diagnostic_observation_append");
  assert.deepEqual(descriptor.input_schema.required, [
    "schema_version", "adapter", "workflow_id", "revision_id", "external_execution_id", "event_id",
    "event_sequence", "lifecycle_claim", "correlation_id", "idempotency_key", "occurred_at", "payload"
  ]);
  assert.equal(descriptor.input_schema.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(descriptor), /n8n/i);
  assert.ok(descriptor.outcomes.includes("event_conflict_preserved"));
});

test("revision registration binds every behavior-bearing fingerprint without mutable labels", () => {
  const descriptor = getDiagnosticOperationDescriptor("diagnostic.agent_revision.register");
  const input = descriptor.input_schema.properties.input;
  assert.deepEqual(input.required, [
    "workflow_id",
    "workflow_content",
    "runtime",
    "nodes",
    "model",
    "configuration",
    "adapter"
  ]);
  assert.equal(input.additionalProperties, false);
  assert.equal(input.properties.current, undefined);
  assert.equal(input.properties.active, undefined);
  assert.deepEqual(input.properties.runtime.required, ["runtime_id", "runtime_version", "image_digest"]);
  assert.equal(input.properties.runtime.additionalProperties, false);
  assert.deepEqual(input.properties.nodes.items.required, ["node_type", "node_version"]);
  assert.deepEqual(input.properties.adapter.required,
    ["adapter_id", "adapter_version", "fingerprint_rules_digest"]);
  assert.equal(descriptor.authority_class, "authenticated_builder_attribution_only");
  assert.equal(descriptor.effect_class, "diagnostic_state_transition");
  assert.deepEqual(descriptor.next_operations, ["diagnostic.agent_revision.get"]);
});

test("returned Diagnostic descriptors cannot mutate the catalog", () => {
  const descriptor = getDiagnosticOperationDescriptor("diagnostic.agent_workflow.get");
  descriptor.summary = "changed";
  assert.notEqual(getDiagnosticOperationDescriptor("diagnostic.agent_workflow.get").summary, "changed");
});
