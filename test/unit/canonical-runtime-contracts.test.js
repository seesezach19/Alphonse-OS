import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createN8nReadinessBinding,
  normalizeN8nPublishedWorkflow,
  observeBoundN8nExecution
} from "../../src/canonical-n8n-runtime.js";

const metadata = JSON.parse(await readFile(new URL(
  "../../packages/n8n-operational-package/node-metadata/n8n-2.25.7.json", import.meta.url), "utf8"));

function workflow() {
  return {
    id: "CanonicalLeadIngress01", versionId: "provider-version-1", active: true,
    nodes: [{ id: "webhook", name: "Receive", type: "n8n-nodes-base.webhook", typeVersion: 2,
      position: [0, 0], parameters: { httpMethod: "POST", path: "lead", responseMode: "onReceived" } }],
    connections: {}, settings: { executionOrder: "v1" }
  };
}

function revisionMaterial(value = workflow()) {
  return {
    workflow_id: "workflow:lead",
    workflow_content: { primary_workflow: value, dependencies: [] },
    runtime: { runtime_id: "n8n", runtime_version: metadata.runtime_version,
      image_digest: metadata.provenance.runtime_image_digest },
    nodes: [], model: {}, configuration: {}, adapter: {}
  };
}

function executionProbe() {
  return { id: "3", workflowId: "ReadinessProbe01", status: "success",
    stoppedAt: "2026-07-16T11:59:59.000Z",
    data: { workflowData: { id: "ReadinessProbe01", nodes: [{}] }, resultData: { runData: { Probe: [{}] } } } };
}

function runtimeIdentity() {
  return { source: "docker_inspect_config_image",
    image_reference: metadata.provenance.runtime_image_reference,
    image_digest: metadata.provenance.runtime_image_digest, runtime_version: metadata.runtime_version };
}

function readinessInput(value = workflow()) {
  return { workflow: value, metadata, revision_id: crypto.randomUUID(), workflow_id: "workflow:lead",
    revision_material: revisionMaterial(value), execution_probe: executionProbe(), runtime_identity: runtimeIdentity() };
}

test("published workflow normalization is metadata-driven and ignores UI placement", () => {
  const first = normalizeN8nPublishedWorkflow(workflow(), metadata);
  const moved = workflow();
  moved.nodes[0].position = [900, 400];
  assert.equal(normalizeN8nPublishedWorkflow(moved, metadata).normalized_workflow_digest,
    first.normalized_workflow_digest);
  assert.equal(first.provider_workflow_version_id, "provider-version-1");
});

test("readiness fails closed for drafts, unproved retention, runtime drift, or revision drift", () => {
  assert.throws(() => createN8nReadinessBinding(readinessInput({ ...workflow(), active: false })), /published/);
  const unknown = workflow();
  unknown.nodes[0].type = "community.unknown";
  assert.throws(() => normalizeN8nPublishedWorkflow(unknown, metadata), /unsupported node semantics/);
  assert.throws(() => createN8nReadinessBinding({ ...readinessInput(), execution_probe: { status: "success" } }),
    /retained execution detail probe/);
  assert.throws(() => createN8nReadinessBinding({ ...readinessInput(), runtime_identity: {
    ...runtimeIdentity(), image_reference: `n8nio/n8n@sha256:${"1".repeat(64)}`,
    image_digest: `sha256:${"1".repeat(64)}` } }), /do not match/);
  const changedRevision = revisionMaterial();
  changedRevision.workflow_content.primary_workflow.nodes[0].parameters.path = "other";
  assert.throws(() => createN8nReadinessBinding({ ...readinessInput(), revision_material: changedRevision }),
    /does not match registered Agent Revision/);
});

test("execution observation may confirm or contradict but never replace expected identity", () => {
  const binding = createN8nReadinessBinding(readinessInput());
  const execution = { id: "7", workflowId: workflow().id, workflowVersionId: "provider-version-1", status: "success",
    startedAt: "2026-07-16T12:00:00.000Z", stoppedAt: "2026-07-16T12:00:01.000Z",
    data: { workflowData: workflow(), resultData: { runData: { Receive: [{ data: { main: [[{ json: {
      headers: { "x-alphonse-logical-operation-id": "op_1", "x-alphonse-delivery-id": "delivery_1" }
    } }]] } }] } } } };
  const observed = observeBoundN8nExecution(execution, binding, metadata);
  assert.equal(observed.status, "matched");
  assert.equal(observed.claims.logical_operation_id, "op_1");
  const changed = structuredClone(execution);
  changed.data.workflowData.nodes[0].parameters.path = "changed";
  const mismatch = observeBoundN8nExecution(changed, binding, metadata);
  assert.equal(mismatch.status, "revision_mismatch");
  assert.equal(mismatch.expected_normalized_workflow_digest, binding.normalized_workflow_digest);
  assert.equal(binding.normalized_workflow_digest, observed.claims.normalized_workflow_digest);
});
