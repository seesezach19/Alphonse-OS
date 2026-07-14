import assert from "node:assert/strict";
import test from "node:test";

import { getOperationDescriptor, listOperationDescriptors } from "../../src/operations.js";

test("every public operation describes transport, authority, effect, and idempotency", () => {
  const operations = listOperationDescriptors();
  assert.ok(operations.length >= 7);
  for (const operation of operations) {
    assert.equal(operation.visibility, "public");
    assert.ok(operation.transport.method);
    assert.ok(operation.transport.path);
    assert.ok(operation.authority_class);
    assert.ok(operation.effect_class);
    assert.ok(operation.idempotency);
    assert.ok(operation.input_schema);
    assert.ok(operation.output_schema);
    assert.equal(operation.output_schema.type, "object");
    assert.ok(Array.isArray(operation.output_schema.required));
    assert.ok(operation.output_schema.required.length > 0);
    assert.ok(Array.isArray(operation.supported_modes));
    assert.ok(Array.isArray(operation.issues));
    assert.ok(Array.isArray(operation.emitted_events));
    assert.ok(Array.isArray(operation.next_operations));
    assert.ok(Array.isArray(operation.outcomes));
  }
});

test("returned descriptors cannot mutate the catalog", () => {
  const descriptor = getOperationDescriptor("kernel.environment.profile.update");
  descriptor.summary = "mutated";
  assert.notEqual(getOperationDescriptor("kernel.environment.profile.update").summary, "mutated");
});

test("governed context descriptors expose exact identifiers and grant fields", () => {
  const issue = getOperationDescriptor("kernel.context_access_grant.issue");
  assert.ok(issue.input_schema.properties.input.required.includes("passport_id"));
  assert.deepEqual(issue.emitted_events, ["kernel.context_access_grant.issued"]);
  const receipt = getOperationDescriptor("kernel.context_receipt.get");
  assert.deepEqual(receipt.input_schema.required, ["receipt_id"]);
});
