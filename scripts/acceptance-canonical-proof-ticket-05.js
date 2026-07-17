import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sha256Digest } from "../src/canonical-json.js";
import { createCanonicalProofDeployment } from "./canonical-proof-deployment-fixture.js";

const root = new URL("..", import.meta.url);
const baseUrl = "http://127.0.0.1:43205";
const dataPlaneUrl = "http://127.0.0.1:43215";
const tokenizationUrl = "http://127.0.0.1:43505";
const ingressUrl = "http://127.0.0.1:43605";
const project = `alphonse-canonical-ticket05-${process.pid}`;
const environment = { ...process.env, COMPOSE_PROJECT_NAME: project,
  KERNEL_PORT: "43205", POSTGRES_PORT: "45505", DATA_PLANE_PORT: "43215",
  TOKENIZATION_PORT: "43505", INGRESS_PORT: "43605", CANONICAL_N8N_PORT: "45685" };
const ownerHeaders = { authorization: "Bearer local-development-bootstrap-token", "content-type": "application/json" };
const feedHeaders = { authorization: "Bearer local-grant-authority-feed-token", "content-type": "application/json" };
const receiptHeaders = { authorization: "Bearer local-grant-application-receipt-token", "content-type": "application/json" };
const operatorHeaders = { authorization: "Bearer local-read-only-ingress-operator-token" };
const stimulusToken = "local-route-scoped-stimulus-token";
const agentToken = "canonical-proof-builder-agent-token-00000005";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: options.env ?? environment,
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: options.timeout ?? 8 * 60_000,
    windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const compose = (...args) => run("docker", ["compose", "--profile", "canonical-tokenization",
  "--profile", "canonical-ingress", ...args]);
async function request(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, { ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}
const kernel = (route, options = {}) => request(baseUrl, route, {
  ...options, headers: { ...ownerHeaders, ...(options.headers ?? {}) }
});
const dataPlane = (route, options = {}) => request(dataPlaneUrl, route, options);
const post = (route, body, headers = ownerHeaders) => request(baseUrl, route,
  { method: "POST", headers, body: JSON.stringify(body) });
const command = (operationId, input) => ({ command_id: randomUUID(), operation_id: operationId, input });

async function activateGrant({ grantType, receiverServiceId, grantDocument, receiverUrl }) {
  const grantId = randomUUID();
  const registered = await post("/kernel/v0/grant-authority/grants", command("kernel.authority_grant.register", {
    grant_id: grantId, grant_type: grantType, receiver_service_id: receiverServiceId, grant_document: grantDocument
  }));
  assert.equal(registered.response.status, 201, JSON.stringify(registered.body));
  const ready = await post("/kernel/v0/grant-authority/readiness-receipts", command(
    "kernel.authority_grant.readiness.record", { grant_id: grantId, readiness_receipt_id: randomUUID(),
      readiness_status: "ready", readiness_receipt: { status: "ready", receiver_service_id: receiverServiceId } }
  ));
  assert.equal(ready.response.status, 201, JSON.stringify(ready.body));
  const publication = await post("/kernel/v0/grant-authority/snapshots", command(
    "kernel.authority_grant.snapshot.publish", { grant_id: grantId, target_state: "active" }
  ));
  const receiverPath = receiverServiceId === "diagnostic-plane"
    ? "/diagnostic/internal/v0/grant-activation-snapshots" : "/internal/v0/grant-activation-snapshots";
  const applied = await request(receiverUrl, receiverPath, { method: "POST", headers: feedHeaders,
    body: JSON.stringify({ signed_snapshot_bytes: publication.body.grant_activation_snapshot.signed_snapshot_bytes }) });
  assert.equal(applied.response.status, 201, JSON.stringify(applied.body));
  const effective = await post("/authority/v0/grant-application-receipts", {
    signed_receipt_bytes: applied.body.grant_application_receipt.signed_receipt_bytes
  }, receiptHeaders);
  assert.equal(effective.response.status, 201, JSON.stringify(effective.body));
  return grantId;
}

async function eventually(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await check(); if (last) return last; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}: ${last?.stack ?? JSON.stringify(last)}`);
}

async function ingressStatus() {
  const result = await request(ingressUrl, "/internal/v0/status", { headers: operatorHeaders });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body;
}

compose("down", "--volumes", "--remove-orphans");
try {
  compose("up", "--build", "--wait", "postgres", "diagnostic-bootstrap", "kernel", "data-plane",
    "tokenization-service");
  const deployment = await createCanonicalProofDeployment({ kernel, dataPlane, agentToken });
  const schemaExport = deployment.ingress_schema_export;
  const schema = { schema_id: schemaExport.export_id, schema_version: schemaExport.contract_version,
    schema_digest: sha256Digest(schemaExport.content) };
  const activation = await post("/diagnostic/v0/observation-schema-activations", {
    deployment_id: deployment.deployment_id, schema_export_id: schemaExport.export_id
  });
  assert.equal(activation.response.status, 201, JSON.stringify(activation.body));

  const validity = { valid_from: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString() };
  const tokenBase = {
    requester_principal_id: "observer:webhook-ingress",
    installation_id: "00000000-0000-4000-8000-00000000a001",
    environment_id: "00000000-0000-4000-8000-000000000001",
    integration_id: "integration:mock-crm", algorithm_version: "hmac-sha256-length-prefixed.v1",
    collection_window_id: "collection:duplicate-ingress-ticket-05",
    service_binding: { service_id: "tokenization-service", version: "0.1.0" },
    ...validity, max_input_bytes: 128, requests_per_minute: 100
  };
  const sourceGrantId = await activateGrant({ grantType: "tokenization_use",
    receiverServiceId: "tokenization-service", receiverUrl: tokenizationUrl,
    grantDocument: { ...tokenBase, field_role: "source.stable_operation_identity",
      claim_field: "source_identity_token", namespace: "lead-source-identity" } });
  const deliveryGrantId = await activateGrant({ grantType: "tokenization_use",
    receiverServiceId: "tokenization-service", receiverUrl: tokenizationUrl,
    grantDocument: { ...tokenBase, field_role: "source.delivery_identity",
      claim_field: "delivery_identity_equality_token", namespace: "lead-idempotency" } });
  const adapterBinding = { adapter_binding_id: "adapter:webhook-ingress", version: "0.1.0",
    digest: `sha256:${"4".repeat(64)}` };
  const observationGrantId = await activateGrant({ grantType: "observation_reporting",
    receiverServiceId: "diagnostic-plane", receiverUrl: baseUrl, grantDocument: {
      principal_id: "observer:webhook-ingress", installation_id: tokenBase.installation_id,
      environment_id: tokenBase.environment_id, adapter_binding: adapterBinding,
      allowed_schema_tuples: [schema], workflow_ids: ["workflow:agency-lab:lead-ingestion"],
      integration_ids: ["integration:mock-crm"], stream_id: "stream:webhook-ingress-journal",
      ...validity, key_id: "observer-webhook-key-v1",
      limits: { max_envelope_bytes: 16384, max_detail_bytes: 0, max_sequence_advance: 1000 }
    } });

  Object.assign(environment, {
    INGRESS_SOURCE_TOKENIZATION_GRANT_ID: sourceGrantId,
    INGRESS_DELIVERY_TOKENIZATION_GRANT_ID: deliveryGrantId,
    INGRESS_OBSERVATION_GRANT_ID: observationGrantId,
    INGRESS_OBSERVATION_SCHEMA: JSON.stringify(schema),
    INGRESS_OBSERVATION_ADAPTER_BINDING: JSON.stringify(adapterBinding),
    INGRESS_DIAGNOSTIC_URL: "http://127.0.0.1:9/diagnostic/v0/observations"
  });

  compose("run", "--rm", "--no-deps", "canonical-n8n", "import:workflow",
    "--input=/proof-workflows/canonical-lead-ingress.json");
  compose("run", "--rm", "--no-deps", "canonical-n8n", "publish:workflow", "--id=CanonicalLeadIngress01");
  compose("up", "--build", "--wait", "canonical-n8n", "customer-ingress-bootstrap",
    "customer-ingress-migrate", "customer-ingress-api", "customer-ingress-forwarder", "customer-ingress-reporter");

  const fixture = JSON.parse(await readFile(new URL(
    "../packages/n8n-operational-package/fixtures/lead-duplicate-webhook.json", import.meta.url), "utf8"));
  const deliveries = fixture.lead_form_events.map((event) => ({
    source_operation_id: event.submission_id, source_delivery_id: event.event_id,
    occurred_at: event.received_at, payload: event.lead
  }));
  const stimulusInput = path.join(os.tmpdir(), `alphonse-ticket05-stimulus-${process.pid}.json`);
  const stimulusOutput = path.join(os.tmpdir(), `alphonse-ticket05-result-${process.pid}.json`);
  await writeFile(stimulusInput, JSON.stringify(deliveries));
  const minimalStimulusEnvironment = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    CANONICAL_PROOF_INGRESS_URL: `${ingressUrl}/agency-lab/lead-ingress`,
    CANONICAL_PROOF_STIMULUS_TOKEN: stimulusToken
  };
  run(process.execPath, ["scripts/canonical-proof-http-stimulus.js", stimulusInput, stimulusOutput],
    { env: minimalStimulusEnvironment });
  const stimulus = JSON.parse(await readFile(stimulusOutput, "utf8"));
  assert.deepEqual(stimulus.results.map((item) => item.status), [202, 202]);
  assert.equal(stimulus.authored_observations, 0);
  assert.equal(stimulus.reporting_credentials_received, false);

  const outage = await eventually(async () => {
    const value = await ingressStatus();
    return value.forwarded_count === 2 && value.journal_health.unreported_count === 2 ? value : null;
  }, "forwarding during Diagnostic Plane outage");
  assert.equal(outage.mapping_count, 1);
  assert.equal(outage.logical_operation_count, 1);
  assert.equal(outage.delivery_count, 2);
  assert.equal(new Set(outage.deliveries.map((item) => item.delivery_id)).size, 2);
  assert.equal(new Set(outage.deliveries.map((item) => item.logical_operation_id)).size, 1);
  assert.equal(outage.raw_payload_retained_count, 0);
  assert.equal(outage.journal_health.retention_pressure, "normal");
  assert.equal(outage.journal_health.evidence_loss_declared, false);
  assert.doesNotMatch(JSON.stringify(outage), /FORM-LEAD-1001|lead-event-1001|maya\.patel/i);

  const serviceConfig = JSON.parse(compose("config", "--format", "json")).services;
  assert.equal(serviceConfig["customer-ingress-api"].environment.INGRESS_OBSERVATION_SECRET, undefined);
  assert.equal(serviceConfig["customer-ingress-reporter"].environment.INGRESS_STIMULUS_TOKEN, undefined);
  assert.equal(serviceConfig["customer-ingress-forwarder"].environment.INGRESS_OBSERVATION_SECRET, undefined);

  Object.assign(environment, { INGRESS_DIAGNOSTIC_URL: "http://kernel:3000/diagnostic/v0/observations",
    INGRESS_TEST_CONTROLS_ENABLED: "true", INGRESS_REPORTER_CRASH_AFTER_ACCEPT_ONCE: "true" });
  compose("up", "-d", "--build", "--force-recreate", "customer-ingress-reporter");
  await eventually(() => {
    const rows = compose("ps", "-a", "--format", "json", "customer-ingress-reporter")
      .trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
    return rows.some((row) => row.State === "exited" && String(row.ExitCode) === "86") || null;
  }, "reporter crash after accepted observation");
  compose("up", "-d", "--build", "--force-recreate", "customer-ingress-reporter");

  const recovered = await eventually(async () => {
    const value = await ingressStatus();
    return value.reported_count === 2 ? value : null;
  }, "journal reporting recovery");
  assert.equal(recovered.observation_replay_count, 1);
  assert.equal(recovered.journal_health.unreported_count, 0);
  for (const delivery of recovered.deliveries) {
    assert.equal(delivery.reporting_state, "reported");
    assert.ok(delivery.observation_receipt_id);
    assert.ok(delivery.source_token_result_receipt_id);
    assert.ok(delivery.delivery_token_result_receipt_id);
    const receipt = await kernel(`/diagnostic/v0/observation-receipts/${delivery.observation_receipt_id}`);
    assert.equal(receipt.response.status, 200, JSON.stringify(receipt.body));
    assert.equal(receipt.body.observation_receipt.principal_id, "observer:webhook-ingress");
    assert.equal(receipt.body.observation_receipt.observation_type, "source.delivery");
    assert.equal(receipt.body.observation_receipt.attribution,
      "authenticated_under_observer_specific_grant");
  }

  compose("restart", "customer-ingress-api", "customer-ingress-forwarder", "customer-ingress-reporter");
  const replayResponse = await eventually(async () => {
    const value = await request(ingressUrl, "/agency-lab/lead-ingress", {
      method: "POST", headers: { authorization: `Bearer ${stimulusToken}` }, body: JSON.stringify(deliveries[0])
    });
    return value.response.status === 200 ? value : null;
  }, "ingress replay after process restart");
  assert.equal(replayResponse.response.status, 200, JSON.stringify(replayResponse.body));
  assert.equal(replayResponse.body.replayed, true);
  const final = await ingressStatus();
  assert.equal(final.mapping_count, 1);
  assert.equal(final.delivery_count, 2);
  assert.equal(final.reported_count, 2);

  process.stdout.write(`${JSON.stringify({
    schema_version: "0.1.0", ticket: "canonical-diagnostic-proof-05", status: "passed",
    completed_capability: "journaled_duplicate_ingress_observation",
    proven: ["journal_before_forward", "stable_opaque_logical_operation", "distinct_delivery_attempts",
      "independent_forward_and_report_loops", "n8n_context_propagation", "diagnostic_outage_decoupled",
      "tokenization_receipts_cited", "stimulus_has_no_reporting_authority", "accepted_report_replay_recovery",
      "restart_idempotency", "raw_payload_scrubbed", "visible_backlog_and_loss_state"],
    mapping_count: final.mapping_count, delivery_count: final.delivery_count,
    observation_replay_count: final.observation_replay_count,
    model_requests: 0, worker_run_created: false
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`\n--- Ticket 05 service logs ---\n${compose("logs", "--no-color",
    "customer-ingress-api", "customer-ingress-forwarder", "customer-ingress-reporter", "canonical-n8n")}\n`);
  throw error;
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
