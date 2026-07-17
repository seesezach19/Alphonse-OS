import { readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";

import { deterministicUuid } from "./canonical-json.js";
import { createCrmEffectObservationClaims } from "./mock-crm-contracts.js";
import { createSignedObservation } from "./observation-contracts.js";

const config = { port: Number(process.env.CRM_LEDGER_OBSERVER_PORT ?? 3702), crmUrl: process.env.MOCK_CRM_URL,
  ledgerToken: process.env.MOCK_CRM_LEDGER_TOKEN, statePath: process.env.CRM_LEDGER_OBSERVER_STATE_PATH,
  diagnosticUrl: process.env.CRM_LEDGER_DIAGNOSTIC_URL, schema: process.env.CRM_EFFECT_OBSERVATION_SCHEMA,
  adapter: process.env.CRM_LEDGER_ADAPTER_BINDING, principalId: process.env.CRM_LEDGER_PRINCIPAL_ID,
  grantId: process.env.CRM_LEDGER_OBSERVATION_GRANT_ID, keyId: process.env.CRM_LEDGER_OBSERVATION_KEY_ID,
  secret: process.env.CRM_LEDGER_OBSERVATION_SECRET, installationId: process.env.KERNEL_INSTALLATION_ID,
  environmentId: process.env.KERNEL_ENVIRONMENT_ID, streamId: process.env.CRM_LEDGER_STREAM_ID };
if (Object.entries(config).some(([key, value]) => key !== "port" && !value)) throw new Error("CRM ledger observer configuration is incomplete.");
let state;
try { state = JSON.parse(await readFile(config.statePath, "utf8")); } catch (error) {
  if (error.code !== "ENOENT") throw error; state = { last_ledger_sequence: 0, reported_commits: [] };
}
async function persist() { const temporary = `${config.statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`); await rename(temporary, config.statePath); }
async function poll() {
  const response = await fetch(`${config.crmUrl}/internal/v0/commit-ledger?after=${state.last_ledger_sequence}`,
    { headers: { authorization: `Bearer ${config.ledgerToken}` } });
  if (!response.ok) throw new Error(`LEDGER_HTTP_${response.status}`);
  const { commits } = await response.json();
  for (const commit of commits) {
    const capturedAt = new Date().toISOString();
    const claims = createCrmEffectObservationClaims(commit);
    const envelope = { schema_version: "0.1.0", observation_id: deterministicUuid({
      namespace: "observation:crm-ledger", stream_id: config.streamId, commit_id: commit.commit_id
    }),
      observation_type: "destination.effect", schema: JSON.parse(config.schema), principal_id: config.principalId,
      grant_id: config.grantId, key_id: config.keyId, installation_id: config.installationId,
      environment_id: config.environmentId, adapter_binding: JSON.parse(config.adapter), stream_id: config.streamId,
      sequence: String(commit.ledger_sequence), workflow_id: "workflow:agency-lab:lead-ingestion",
      integration_id: "integration:mock-crm", occurred_at: new Date(commit.committed_at).toISOString(),
      observed_at: capturedAt, claims, limitations: ["authenticated_external_commit_feed_claim"],
      redaction: { policy_id: "redaction:crm-ledger-claims", policy_digest: `sha256:${"9".repeat(64)}` },
      detail: null, provenance_dependencies: [] };
    const signed = createSignedObservation(envelope, { keyId: config.keyId, secret: config.secret });
    const accepted = await fetch(config.diagnosticUrl, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope_bytes: signed.bytes, authentication: signed.authentication }) });
    const body = await accepted.json();
    if (![200, 201].includes(accepted.status)) throw new Error(body.error?.code ?? `REPORT_HTTP_${accepted.status}`);
    state.last_ledger_sequence = Number(commit.ledger_sequence);
    state.reported_commits.push({ commit_id: commit.commit_id,
      receipt_id: body.observation_receipt.receipt_id });
    await persist();
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
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: lastError ? "degraded" : "healthy",
    reported_count: state.reported_commits.length, reported_commits: state.reported_commits,
    last_ledger_sequence: state.last_ledger_sequence,
    last_error: lastError }));
});
server.listen(config.port, "0.0.0.0");
