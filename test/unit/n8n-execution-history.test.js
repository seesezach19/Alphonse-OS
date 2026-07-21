import assert from "node:assert/strict";
import test from "node:test";

import {
  listN8nExecutionHistory,
  N8nExecutionHistoryError
} from "../../packages/n8n-operational-package/src/execution-history.js";
import { buildN8nExecutionWorkflowFingerprint } from
  "../../packages/n8n-operational-package/src/runtime-attestation.js";

const secret = "execution-history-cursor-secret-with-sufficient-length-v1";
const cutoff = "2026-07-21T20:00:00.000Z";
const workflow = {
  id: "wf-1", versionId: "version-1", nodes: [{ id: "node-1", name: "Start",
    type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 0], parameters: {} }],
  connections: {}, settings: {}
};
const fingerprint = buildN8nExecutionWorkflowFingerprint({ workflowId: "wf-1", workflowData: workflow });
const binding = { workflow_id: "workflow:one", revision_id: "00000000-0000-4000-8000-000000000111",
  execution_workflow_material_digest: fingerprint.execution_workflow_material_digest,
  fingerprint_rules_digest: `sha256:${"a".repeat(64)}` };
const scope = { scope_id: "n8n:customer", environment: "production", project_id: null,
  active: null, allowed_workflow_ids: ["wf-1"] };

function execution(id, { status = "success", mode = "webhook", workflowData = workflow,
  startedAt = "2026-07-21T19:00:00.000Z", stoppedAt = "2026-07-21T19:00:01.000Z" } = {}) {
  return { id: String(id), workflowId: "wf-1", status, mode, retryOf: null,
    retrySuccessId: null, startedAt, stoppedAt, waitTill: null, workflowData };
}

function response(body) {
  return { ok: true, status: 200, async json() { return structuredClone(body); } };
}

test("execution history cursor binds workflow, cutoff, and page while preserving run classes", async () => {
  const calls = [];
  const pages = [
    { data: [execution(4), execution(3, { mode: "manual" })], nextCursor: "provider-page-2" },
    { data: [execution(2, { mode: "evaluation" }), execution(1, { mode: "retry" })], nextCursor: null }
  ];
  const fetchImpl = async (url) => { calls.push(url); return response(pages[calls.length - 1]); };
  const first = await listN8nExecutionHistory({ baseUrl: "https://n8n.example", apiKey: "edge-only",
    scope, cursorSecret: secret, input: { scope_id: scope.scope_id, provider_workflow_id: "wf-1",
      page_size: 2, cursor: null }, attestationBindings: { "wf-1": binding }, fetchImpl,
    now: () => cutoff });
  assert.equal(first.page.scope_complete, false);
  assert.equal(first.page.source_cutoff, cutoff);
  assert.deepEqual(first.executions.map((item) => item.execution_class), ["production", "manual"]);
  assert.ok(first.executions.every((item) => item.revision.status === "matched"));
  assert.equal(first.completeness.embedded_signals_are_completeness_proof, false);
  const second = await listN8nExecutionHistory({ baseUrl: "https://n8n.example", apiKey: "edge-only",
    scope, cursorSecret: secret, input: { scope_id: scope.scope_id, provider_workflow_id: "wf-1",
      page_size: 2, cursor: first.page.next_cursor }, attestationBindings: { "wf-1": binding }, fetchImpl,
    now: () => "2026-07-21T20:05:00.000Z" });
  assert.equal(second.page.page_index, 1);
  assert.equal(second.page.source_cutoff, cutoff);
  assert.equal(second.page.scope_complete, true);
  assert.deepEqual(second.executions.map((item) => item.execution_class), ["test", "retry"]);
  assert.equal(new URL(calls[1]).searchParams.get("cursor"), "provider-page-2");
});

test("execution history exposes revision drift and never hides provider retention limits", async () => {
  const changed = structuredClone(workflow);
  changed.nodes[0].parameters.notice = "behavior changed";
  const page = await listN8nExecutionHistory({ baseUrl: "https://n8n.example", apiKey: "edge-only",
    scope, cursorSecret: secret, input: { scope_id: scope.scope_id, provider_workflow_id: "wf-1",
      page_size: 10, cursor: null }, attestationBindings: { "wf-1": binding },
    fetchImpl: async () => response({ data: [execution(1, { workflowData: changed })], nextCursor: null }),
    now: () => cutoff });
  assert.equal(page.executions[0].revision.status, "mismatched");
  assert.equal(page.completeness.provider_retention_and_deletion_visible_as_limitations, true);
  assert.equal(page.authority, "none");
});

test("cursor replay rejects tampering and cross-workflow reuse", async () => {
  const first = await listN8nExecutionHistory({ baseUrl: "https://n8n.example", apiKey: "edge-only",
    scope, cursorSecret: secret, input: { scope_id: scope.scope_id, provider_workflow_id: "wf-1",
      page_size: 1, cursor: null }, attestationBindings: { "wf-1": binding },
    fetchImpl: async () => response({ data: [execution(2)], nextCursor: "next" }), now: () => cutoff });
  const tampered = `${first.page.next_cursor.slice(0, -1)}x`;
  await assert.rejects(() => listN8nExecutionHistory({ baseUrl: "https://n8n.example", apiKey: "edge-only",
    scope, cursorSecret: secret, input: { scope_id: scope.scope_id, provider_workflow_id: "wf-1",
      page_size: 1, cursor: tampered }, attestationBindings: { "wf-1": binding },
    fetchImpl: async () => response({ data: [], nextCursor: null }), now: () => cutoff }),
  (error) => error instanceof N8nExecutionHistoryError
      && error.code === "N8N_EXECUTION_HISTORY_CURSOR_INVALID");
});
