import { readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";

import { deterministicUuid } from "./canonical-json.js";
import { observeBoundN8nExecution } from "./canonical-n8n-runtime.js";
import { createSignedObservation } from "./observation-contracts.js";

const config = {
  port: Number(process.env.N8N_OBSERVER_PORT ?? 3650), apiUrl: process.env.N8N_API_URL,
  apiKey: process.env.N8N_API_KEY, bindingPath: process.env.N8N_BINDING_PATH,
  metadataPath: process.env.N8N_NODE_METADATA_PATH, statePath: process.env.N8N_OBSERVER_STATE_PATH,
  diagnosticUrl: process.env.N8N_DIAGNOSTIC_URL, schema: process.env.N8N_OBSERVATION_SCHEMA,
  adapter: process.env.N8N_OBSERVATION_ADAPTER_BINDING, principalId: process.env.N8N_OBSERVER_PRINCIPAL_ID,
  grantId: process.env.N8N_OBSERVATION_GRANT_ID, keyId: process.env.N8N_OBSERVATION_KEY_ID,
  secret: process.env.N8N_OBSERVATION_SECRET, installationId: process.env.KERNEL_INSTALLATION_ID,
  environmentId: process.env.KERNEL_ENVIRONMENT_ID, streamId: process.env.N8N_OBSERVATION_STREAM_ID
  , signalToken: process.env.N8N_OBSERVER_SIGNAL_TOKEN
};
if (Object.entries(config).some(([key, value]) => key !== "port" && !value)) throw new Error("n8n observer configuration is incomplete.");
const binding = JSON.parse(await readFile(config.bindingPath, "utf8"));
const metadata = JSON.parse(await readFile(config.metadataPath, "utf8"));
let state;
try { state = JSON.parse(await readFile(config.statePath, "utf8")); } catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = { next_sequence: 1, pending_execution_ids: [], reported_execution_ids: [], receipts: [], mismatches: [] };
}
state.pending_execution_ids ??= [];
let persistQueue = Promise.resolve();
async function persist() {
  persistQueue = persistQueue.then(async () => {
    const temporary = `${config.statePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, config.statePath);
  });
  return persistQueue;
}
async function n8n(route) {
  const response = await fetch(`${config.apiUrl}${route}`, { headers: { "x-n8n-api-key": config.apiKey } });
  if (!response.ok) throw new Error(`n8n read failed with HTTP ${response.status}`);
  const body = await response.json();
  return body.id === undefined ? body.data ?? body : body;
}
async function submit(execution, sequence) {
  const observed = observeBoundN8nExecution(execution, binding, metadata);
  if (observed.status !== "matched") {
    if (!state.mismatches.some((item) => item.execution_id === String(execution.id))) {
      state.mismatches.push({ execution_id: String(execution.id), ...observed,
        detected_at: new Date().toISOString(), expected_identity_updated: false });
      await persist();
    }
    state.pending_execution_ids = state.pending_execution_ids.filter((id) => id !== String(execution.id));
    await persist();
    return;
  }
  const envelope = {
    schema_version: "0.1.0", observation_id: deterministicUuid({
      namespace: "observation:n8n-runtime", stream_id: config.streamId, execution_id: String(execution.id)
    }),
    observation_type: "runtime.execution", schema: JSON.parse(config.schema),
    principal_id: config.principalId, grant_id: config.grantId, key_id: config.keyId,
    installation_id: config.installationId, environment_id: config.environmentId,
    adapter_binding: JSON.parse(config.adapter), stream_id: config.streamId, sequence: String(sequence),
    workflow_id: binding.workflow_id, integration_id: null,
    occurred_at: observed.claims.stopped_at, observed_at: observed.claims.stopped_at,
    claims: observed.claims, limitations: [],
    redaction: { policy_id: "redaction:n8n-runtime-claims-only", policy_digest: `sha256:${"7".repeat(64)}` },
    detail: null, provenance_dependencies: []
  };
  const signed = createSignedObservation(envelope, { keyId: config.keyId, secret: config.secret });
  const response = await fetch(config.diagnosticUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ envelope_bytes: signed.bytes, authentication: signed.authentication }) });
  const body = await response.json();
  if (![200, 201].includes(response.status)) {
    throw new Error(JSON.stringify(body.error ?? { code: `HTTP_${response.status}` }));
  }
  state.reported_execution_ids.push(String(execution.id));
  state.pending_execution_ids = state.pending_execution_ids.filter((id) => id !== String(execution.id));
  state.receipts ??= [];
  state.receipts.push({ execution_id: String(execution.id), receipt_id: body.observation_receipt.receipt_id });
  state.next_sequence = sequence + 1;
  await persist();
}
async function poll() {
  for (const executionId of [...state.pending_execution_ids].sort((a, b) => Number(a) - Number(b))) {
    if (state.reported_execution_ids.includes(executionId)) continue;
    const execution = await n8n(`/api/v1/executions/${encodeURIComponent(executionId)}?includeData=true`);
    if (!execution.stoppedAt) continue;
    await submit(execution, state.next_sequence);
  }
}
let lastError = null;
let polling = false;
async function guardedPoll() {
  if (polling) return;
  polling = true;
  try { await poll(); lastError = null; } catch (error) { lastError = error.message; } finally { polling = false; }
}
setInterval(guardedPoll, 250).unref();
await guardedPoll();
async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw new Error("execution signal exceeds 1024 bytes");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/internal/v0/executions") {
    if (request.headers.authorization !== `Bearer ${config.signalToken}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "UNAUTHORIZED" }));
      return;
    }
    try {
      const executionId = String((await readJson(request)).execution_id ?? "");
      if (!/^[0-9]{1,20}$/u.test(executionId)) throw new Error("execution_id must be numeric bounded text");
      if (!state.reported_execution_ids.includes(executionId)
          && !state.pending_execution_ids.includes(executionId)) {
        state.pending_execution_ids.push(executionId);
        await persist();
      }
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ accepted: true, execution_id: executionId }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: lastError ? "degraded" : "healthy", binding_digest: binding.binding_digest,
    expected_identity_source: binding.expected_identity_source, reported_count: state.reported_execution_ids.length,
    pending_execution_ids: state.pending_execution_ids, receipts: state.receipts ?? [], mismatch_count: state.mismatches.length,
    mismatches: state.mismatches, last_error: lastError }));
});
server.listen(config.port, "0.0.0.0");
