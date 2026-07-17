import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { buildN8nRevisionMaterial } from "../packages/n8n-operational-package/src/index.js";
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
const through07 = process.argv.includes("--through-07");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: options.env ?? environment,
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: options.timeout ?? 8 * 60_000,
    windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const compose = (...args) => run("docker", ["compose", "--profile", "canonical-tokenization",
  "--profile", "canonical-ingress", "--profile", "canonical-destination", "--profile", "canonical-runtime", ...args]);
async function request(base, route, options = {}) {
  let response;
  let transportError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(`${base}${route}`, { ...options,
        headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
      break;
    } catch (error) {
      transportError = error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  if (!response) throw transportError;
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  return { response, body };
}
const kernel = (route, options = {}) => request(baseUrl, route, {
  ...options, headers: { ...ownerHeaders, ...(options.headers ?? {}) }
});
const dataPlane = (route, options = {}) => request(dataPlaneUrl, route, options);
const post = (route, body, headers = ownerHeaders) => request(baseUrl, route,
  { method: "POST", headers, body: JSON.stringify(body) });
const command = (operationId, input) => ({ command_id: randomUUID(), operation_id: operationId, input });

async function registerGrant({ grantType, receiverServiceId, grantDocument, grantId = randomUUID() }) {
  const registered = await post("/kernel/v0/grant-authority/grants", command("kernel.authority_grant.register", {
    grant_id: grantId, grant_type: grantType, receiver_service_id: receiverServiceId, grant_document: grantDocument
  }));
  assert.equal(registered.response.status, 201, JSON.stringify(registered.body));
  return grantId;
}

async function activateRegisteredGrant({ grantId, receiverServiceId, receiverUrl, readinessReceipt = null }) {
  const receipt = readinessReceipt ?? { status: "ready", receiver_service_id: receiverServiceId };
  const ready = await post("/kernel/v0/grant-authority/readiness-receipts", command(
    "kernel.authority_grant.readiness.record", { grant_id: grantId, readiness_receipt_id: randomUUID(),
      readiness_status: "ready", readiness_receipt: receipt }
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

async function activateGrant(options) {
  const grantId = await registerGrant(options);
  return activateRegisteredGrant({ ...options, grantId });
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
const responseData = (body) => body?.data ?? body;
const n8nRequest = (route, options = {}) => request("http://127.0.0.1:45685", route, options);

async function activateSchema(deployment, schemaExport) {
  const result = await post("/diagnostic/v0/observation-schema-activations", {
    deployment_id: deployment.deployment_id, schema_export_id: schemaExport.export_id
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return { schema_id: schemaExport.export_id, schema_version: schemaExport.contract_version,
    schema_digest: sha256Digest(schemaExport.content) };
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

  let extended = null;
  if (through07) {
    const runtimeSchema = await activateSchema(deployment, deployment.runtime_schema_export);
    const runtimeFailureSchema = await activateSchema(deployment, deployment.runtime_attestation_failure_schema_export);
    const requestSchema = await activateSchema(deployment, deployment.destination_request_schema_export);
    const effectSchema = await activateSchema(deployment, deployment.destination_effect_schema_export);
    const workflowJson = JSON.parse(await readFile(new URL(
      "../packages/n8n-operational-package/workflows/canonical-lead-ingress.json", import.meta.url), "utf8"));
    const reporterJson = JSON.parse(await readFile(new URL(
      "../packages/n8n-operational-package/workflows/alphonse-event-reporter.json", import.meta.url), "utf8"));
    const packageManifest = JSON.parse(await readFile(new URL(
      "../packages/n8n-operational-package/operational-package.json", import.meta.url), "utf8"));
    const workflow = await post("/diagnostic/v0/agent-workflows", {
      command_id: randomUUID(), operation_id: "diagnostic.agent_workflow.register", input: {
        workflow_id: "workflow:agency-lab:lead-ingestion", display_name: "Agency Lead Ingestion",
        objective: "Create one CRM request per received lead delivery.",
        external_ref: { system: "n8n", workflow_key: workflowJson.id, environment: "customer-local" }
      }
    });
    assert.equal(workflow.response.status, 201, JSON.stringify(workflow.body));
    const material = buildN8nRevisionMaterial({ packageManifest, workflow: workflowJson, reporter: reporterJson });
    material.configuration = { external_effects: true, destination: "mock_crm",
      configuration_fingerprint: sha256Digest({ external_effects: true, destination: "mock_crm" }) };
    const revision = await post("/diagnostic/v0/agent-revisions", {
      command_id: randomUUID(), operation_id: "diagnostic.agent_revision.register",
      input: { workflow_id: "workflow:agency-lab:lead-ingestion", ...material }
    });
    assert.equal(revision.response.status, 201, JSON.stringify(revision.body));

    const crmTokenGrantId = await activateGrant({ grantType: "tokenization_use",
      receiverServiceId: "tokenization-service", receiverUrl: tokenizationUrl,
      grantDocument: { ...tokenBase, requester_principal_id: "observer:crm-request",
        field_role: "destination.idempotency_key", claim_field: "idempotency_key_equality_token",
        namespace: "lead-idempotency" } });
    const requestAdapter = { adapter_binding_id: "adapter:mock-crm-request", version: "0.1.0",
      digest: `sha256:${"a".repeat(64)}` };
    const ledgerAdapter = { adapter_binding_id: "adapter:mock-crm-ledger", version: "0.1.0",
      digest: `sha256:${"b".repeat(64)}` };
    const requestGrantId = await activateGrant({ grantType: "observation_reporting",
      receiverServiceId: "diagnostic-plane", receiverUrl: baseUrl, grantDocument: {
        principal_id: "observer:crm-request", installation_id: tokenBase.installation_id,
        environment_id: tokenBase.environment_id, adapter_binding: requestAdapter,
        allowed_schema_tuples: [requestSchema], workflow_ids: ["workflow:agency-lab:lead-ingestion"],
        integration_ids: ["integration:mock-crm"], stream_id: "stream:crm-request", ...validity,
        key_id: "observer-crm-request-key-v1",
        limits: { max_envelope_bytes: 16384, max_detail_bytes: 0, max_sequence_advance: 1000 }
      } });
    const ledgerGrantId = await activateGrant({ grantType: "observation_reporting",
      receiverServiceId: "diagnostic-plane", receiverUrl: baseUrl, grantDocument: {
        principal_id: "observer:crm-ledger", installation_id: tokenBase.installation_id,
        environment_id: tokenBase.environment_id, adapter_binding: ledgerAdapter,
        allowed_schema_tuples: [effectSchema], workflow_ids: ["workflow:agency-lab:lead-ingestion"],
        integration_ids: ["integration:mock-crm"], stream_id: "stream:crm-ledger", ...validity,
        key_id: "observer-crm-ledger-key-v1",
        limits: { max_envelope_bytes: 16384, max_detail_bytes: 0, max_sequence_advance: 1000 }
      } });
    extended = { runtimeSchema, runtimeFailureSchema, requestSchema, effectSchema,
      revisionId: revision.body.agent_revision.revision_id, crmTokenGrantId,
      requestAdapter, ledgerAdapter, requestGrantId, ledgerGrantId };
  }

  Object.assign(environment, {
    INGRESS_SOURCE_TOKENIZATION_GRANT_ID: sourceGrantId,
    INGRESS_DELIVERY_TOKENIZATION_GRANT_ID: deliveryGrantId,
    INGRESS_OBSERVATION_GRANT_ID: observationGrantId,
    INGRESS_OBSERVATION_SCHEMA: JSON.stringify(schema),
    INGRESS_OBSERVATION_ADAPTER_BINDING: JSON.stringify(adapterBinding),
    INGRESS_DIAGNOSTIC_URL: "http://127.0.0.1:9/diagnostic/v0/observations"
  });
  if (extended) Object.assign(environment, {
    CANONICAL_AGENT_REVISION_ID: extended.revisionId,
    CRM_IDEMPOTENCY_TOKENIZATION_GRANT_ID: extended.crmTokenGrantId,
    CRM_REQUEST_OBSERVATION_GRANT_ID: extended.requestGrantId,
    CRM_REQUEST_OBSERVATION_SCHEMA: JSON.stringify(extended.requestSchema),
    CRM_REQUEST_ADAPTER_BINDING: JSON.stringify(extended.requestAdapter),
    CRM_LEDGER_OBSERVATION_GRANT_ID: extended.ledgerGrantId,
    CRM_EFFECT_OBSERVATION_SCHEMA: JSON.stringify(extended.effectSchema),
    CRM_LEDGER_ADAPTER_BINDING: JSON.stringify(extended.ledgerAdapter)
  });

  compose("run", "--rm", "--no-deps", "canonical-n8n", "import:workflow",
    "--input=/proof-workflows/canonical-lead-ingress.json");
  compose("run", "--rm", "--no-deps", "canonical-n8n", "publish:workflow", "--id=CanonicalLeadIngress01");
  compose("run", "--rm", "--no-deps", "canonical-n8n", "import:workflow",
    "--input=/proof-workflows/canonical-readiness-probe.json");
  compose("run", "--rm", "--no-deps", "canonical-n8n", "publish:workflow", "--id=CanonicalReadinessProbe01");
  compose("up", "--build", "--wait", "canonical-n8n", "customer-ingress-bootstrap",
    "customer-ingress-migrate", "customer-ingress-api", "customer-ingress-forwarder", "customer-ingress-reporter");

  if (extended) {
    const owner = await eventually(async () => {
      const result = await n8nRequest("/rest/owner/setup", { method: "POST",
        body: JSON.stringify({ email: "canonical-proof@example.test", firstName: "Canonical", lastName: "Proof",
          password: "LocalCanonicalProofPassword123!" }) });
      return result.response.status === 200 ? result : null;
    }, "n8n REST readiness", 60_000);
    assert.equal(owner.response.status, 200, JSON.stringify(owner.body));
    const cookie = owner.response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    const key = await n8nRequest("/rest/api-keys", { method: "POST", headers: { cookie },
      body: JSON.stringify({ label: "Canonical runtime observer", expiresAt: null,
        scopes: ["execution:read", "workflow:read"] }) });
    assert.equal(key.response.status, 200, JSON.stringify(key.body));
    const runtimeAdapter = { adapter_binding_id: "adapter:n8n-runtime", version: "0.1.0",
      digest: `sha256:${"c".repeat(64)}` };
    const runtimeGrantId = randomUUID();
    await registerGrant({ grantId: runtimeGrantId, grantType: "observation_reporting",
      receiverServiceId: "diagnostic-plane", grantDocument: {
        principal_id: "observer:n8n-runtime", installation_id: tokenBase.installation_id,
        environment_id: tokenBase.environment_id, adapter_binding: runtimeAdapter,
        allowed_schema_tuples: [extended.runtimeSchema, extended.runtimeFailureSchema],
        workflow_ids: ["workflow:agency-lab:lead-ingestion"],
        integration_ids: [], stream_id: "stream:n8n-runtime", ...validity, key_id: "observer-n8n-key-v1",
        readiness_requirement: { type: "n8n_runtime_binding",
          workflow_id: "workflow:agency-lab:lead-ingestion", revision_id: extended.revisionId },
        limits: { max_envelope_bytes: 16384, max_detail_bytes: 0, max_sequence_advance: 1000 }
      } });
    environment.CANONICAL_N8N_API_KEY = responseData(key.body).rawApiKey;
    const probe = await eventually(async () => {
      const result = await n8nRequest("/webhook/canonical-readiness-probe", { method: "POST", body: "{}" });
      return result.response.status === 200 && responseData(result.body).execution_id ? result : null;
    }, "retained n8n readiness execution", 60_000);
    const probeExecutionId = String(responseData(probe.body).execution_id);
    await eventually(async () => {
      const result = await n8nRequest(`/api/v1/executions/${encodeURIComponent(probeExecutionId)}?includeData=true`,
        { headers: { "x-n8n-api-key": environment.CANONICAL_N8N_API_KEY } });
      const execution = result.body;
      if (result.response.status === 200 && execution.status === "success" && execution.stoppedAt
          && execution.data?.resultData?.runData) return execution;
      return null;
    }, "retained successful n8n execution detail", 60_000);
    const containerId = compose("ps", "-q", "canonical-n8n").trim();
    const imageReference = run("docker", ["inspect", "--format", "{{.Config.Image}}", containerId]).trim();
    const imageDigest = imageReference.includes("@") ? imageReference.split("@").at(-1) : "";
    assert.match(imageDigest, /^sha256:[0-9a-f]{64}$/u);
    const runtimeVersion = run("docker", ["exec", containerId, "n8n", "--version"]).trim();
    assert.equal(runtimeVersion, "2.25.7");
    Object.assign(environment, { N8N_READINESS_EXECUTION_ID: probeExecutionId,
      N8N_RUNTIME_IDENTITY: JSON.stringify({ source: "docker_inspect_config_image",
        image_reference: imageReference, image_digest: imageDigest, runtime_version: runtimeVersion }),
      N8N_REPORTING_GRANT_ID: runtimeGrantId });
    compose("run", "--rm", "--no-deps", "canonical-observer-volume-init");
    const readinessOutput = compose("run", "--rm", "--no-deps", "n8n-runtime-readiness");
    assert.match(readinessOutput, /pre_execution_published_workflow_read/);
    assert.match(readinessOutput, /"execution_derived_expected_identity":false/);
    const readiness = JSON.parse(readinessOutput.trim().split(/\r?\n/u).at(-1));
    assert.equal(readiness.reporting_grant_id, runtimeGrantId);
    await activateRegisteredGrant({ grantId: runtimeGrantId, receiverServiceId: "diagnostic-plane",
      receiverUrl: baseUrl, readinessReceipt: { type: "n8n_runtime_binding", grant_id: runtimeGrantId,
        workflow_id: readiness.workflow_id, revision_id: readiness.revision_id,
        runtime_binding_digest: readiness.binding_digest } });
    Object.assign(environment, { N8N_OBSERVATION_GRANT_ID: runtimeGrantId,
      N8N_OBSERVATION_SCHEMA: JSON.stringify(extended.runtimeSchema),
      N8N_ATTESTATION_FAILURE_SCHEMA: JSON.stringify(extended.runtimeFailureSchema),
      N8N_OBSERVATION_ADAPTER_BINDING: JSON.stringify(runtimeAdapter) });
    extended.runtimeGrantId = runtimeGrantId;
    compose("up", "--build", "--wait", "mock-crm-bootstrap", "mock-crm-migrate", "mock-crm",
      "crm-request-observer", "crm-ledger-observer", "n8n-runtime-observer");
  }

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

  let extendedResult = null;
  if (extended) {
    const runtime = await eventually(async () => {
      const value = await request("http://127.0.0.1:43650", "/healthz");
      if (value.body.reported_count !== 2) throw new Error(JSON.stringify(value.body));
      return value.body;
    }, "two bound runtime observations", 60_000);
    assert.equal(runtime.mismatch_count, 0);
    assert.equal(runtime.expected_identity_source, "pre_execution_published_workflow_read");
    const requests = await eventually(async () => {
      const value = await request("http://127.0.0.1:43700", "/internal/v0/status");
      if (value.body.reported_count !== 2) throw new Error(JSON.stringify(value.body));
      return value.body;
    }, "two CRM request observations", 60_000);
    const ledger = await eventually(async () => {
      const value = await request("http://127.0.0.1:43702", "/healthz");
      if (value.body.reported_count !== 2) throw new Error(JSON.stringify(value.body));
      return value.body;
    }, "two CRM ledger observations", 60_000);
    assert.equal(new Set(requests.requests.map((item) => item.logical_operation_id)).size, 1);
    assert.equal(new Set(requests.requests.map((item) => item.idempotency_key_equality_token)).size, 2);
    for (const crmRequest of requests.requests) {
      const source = recovered.deliveries.find((item) => item.delivery_id === crmRequest.delivery_id);
      assert.ok(source, "CRM request must cite one observed delivery.");
      assert.equal(crmRequest.idempotency_key_equality_token, source.delivery_identity_equality_token);
      assert.equal(crmRequest.transport_status, 201);
      const receipt = await kernel(`/diagnostic/v0/observation-receipts/${crmRequest.observation_receipt_id}`);
      assert.equal(receipt.body.observation_receipt.principal_id, "observer:crm-request");
      assert.equal(receipt.body.observation_receipt.observation_type, "destination.request");
      assert.equal(receipt.body.observation_receipt.coverage.coverage_status, "complete_through_high_water");
      assert.deepEqual(receipt.body.observation_receipt.coverage.missing_ranges, []);
    }
    const firstRequest = requests.requests[0];
    const firstDelivery = recovered.deliveries.find((item) => item.delivery_id === firstRequest.delivery_id);
    const changedKeyReplay = await request("http://127.0.0.1:43700", "/v0/crm/leads", {
      method: "POST", headers: { authorization: "Bearer local-n8n-crm-route-token",
        "x-alphonse-logical-operation-id": firstRequest.logical_operation_id,
        "x-alphonse-delivery-id": firstRequest.delivery_id,
        "x-alphonse-forwarding-id": firstDelivery.forwarding_id,
        "x-alphonse-source-delivery-key": "adversarial-changed-idempotency-key" },
      body: JSON.stringify({ company: "must-not-forward" })
    });
    assert.equal(changedKeyReplay.response.status, 409, JSON.stringify(changedKeyReplay.body));
    assert.equal(changedKeyReplay.body.error, "CRM_REQUEST_REPLAY_MATERIAL_CONFLICT");
    const runtimeDatabase = new pg.Client({ connectionString:
      "postgresql://alphonse_mock_crm:local-mock-crm-only@127.0.0.1:45505/alphonse_mock_crm" });
    await runtimeDatabase.connect();
    try {
      const owners = await runtimeDatabase.query(
        "SELECT tablename,tableowner FROM pg_tables WHERE schemaname='public' AND tablename IN ('crm_gateway_requests','mock_crm_commits') ORDER BY tablename");
      assert.deepEqual(owners.rows, [
        { tablename: "crm_gateway_requests", tableowner: "alphonse_crm_gateway" },
        { tablename: "mock_crm_commits", tableowner: "alphonse_mock_crm" }
      ]);
      await assert.rejects(runtimeDatabase.query(
        "UPDATE crm_gateway_requests SET forwarding_state='retryable_failed' WHERE forwarding_id=$1",
      [firstDelivery.forwarding_id]), /permission denied/u);
    } finally { await runtimeDatabase.end(); }
    for (const item of runtime.receipts) {
      const receipt = await kernel(`/diagnostic/v0/observation-receipts/${item.receipt_id}`);
      assert.equal(receipt.body.observation_receipt.principal_id, "observer:n8n-runtime");
      assert.equal(receipt.body.observation_receipt.observation_type, "runtime.execution");
      assert.equal(receipt.body.observation_receipt.coverage.coverage_status, "complete_through_high_water");
    }
    for (const item of ledger.reported_commits) {
      const receipt = await kernel(`/diagnostic/v0/observation-receipts/${item.receipt_id}`);
      assert.equal(receipt.body.observation_receipt.principal_id, "observer:crm-ledger");
      assert.equal(receipt.body.observation_receipt.observation_type, "destination.effect");
      assert.equal(receipt.body.observation_receipt.external_truth_established, false);
      assert.equal(receipt.body.observation_receipt.coverage.coverage_status, "complete_through_high_water");
    }
    const configured = JSON.parse(compose("config", "--format", "json")).services;
    assert.equal(configured["crm-request-observer"].environment.MOCK_CRM_LEDGER_TOKEN, undefined);
    assert.equal(configured["crm-ledger-observer"].environment.MOCK_CRM_WRITE_TOKEN, undefined);
    assert.equal(configured["canonical-n8n"].environment.N8N_API_KEY, undefined);
    const prefixBeforeRestart = await kernel("/diagnostic/v0/intake-prefix");
    compose("restart", "n8n-runtime-observer", "crm-request-observer", "crm-ledger-observer");
    await eventually(async () => {
      const [runtimeStatus, requestStatus, ledgerStatus] = await Promise.all([
        request("http://127.0.0.1:43650", "/healthz"),
        request("http://127.0.0.1:43700", "/internal/v0/status"),
        request("http://127.0.0.1:43702", "/healthz")
      ]);
      return runtimeStatus.body.reported_count === 2
        && requestStatus.body.reported_count === 2
        && ledgerStatus.body.reported_count === 2;
    }, "observer restart without duplicate receipts");
    const prefixAfterRestart = await kernel("/diagnostic/v0/intake-prefix");
    assert.equal(prefixAfterRestart.body.intake_prefix.committed_through,
      prefixBeforeRestart.body.intake_prefix.committed_through);
    extendedResult = { runtime, requests, ledger };
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
    schema_version: "0.1.0", ticket: through07 ? "canonical-diagnostic-proof-06-07" : "canonical-diagnostic-proof-05",
    status: "passed", completed_capability: through07
      ? "bound_runtime_and_separate_crm_observation" : "journaled_duplicate_ingress_observation",
    proven: ["journal_before_forward", "stable_opaque_logical_operation", "distinct_delivery_attempts",
      "independent_forward_and_report_loops", "n8n_context_propagation", "diagnostic_outage_decoupled",
      "tokenization_receipts_cited", "stimulus_has_no_reporting_authority", "accepted_report_replay_recovery",
      "restart_idempotency", "raw_payload_scrubbed", "visible_backlog_and_loss_state",
      ...(through07 ? ["live_runtime_identity_verified", "retained_execution_detail_verified",
        "registered_revision_material_verified", "runtime_binding_grant_readiness_bound",
        "changed_key_replay_failed_closed", "destination_cannot_write_request_journal"] : [])],
    mapping_count: final.mapping_count, delivery_count: final.delivery_count,
    observation_replay_count: final.observation_replay_count,
    runtime_observation_count: extendedResult?.runtime.reported_count ?? 0,
    crm_request_observation_count: extendedResult?.requests.reported_count ?? 0,
    crm_effect_observation_count: extendedResult?.ledger.reported_count ?? 0,
    model_requests: 0, worker_run_created: false
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`\n--- Ticket 05 service logs ---\n${compose("logs", "--no-color",
    "customer-ingress-api", "customer-ingress-forwarder", "customer-ingress-reporter", "canonical-n8n",
    "n8n-runtime-observer", "crm-request-observer", "crm-ledger-observer", "mock-crm", "kernel", "data-plane")}\n`);
  throw error;
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
