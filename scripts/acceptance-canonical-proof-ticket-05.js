import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
const through15 = process.argv.includes("--through-15");
const through14 = process.argv.includes("--through-14");
const through13 = through14 || process.argv.includes("--through-13");
const through12 = through15 || through13 || process.argv.includes("--through-12");
const through11 = through12 || process.argv.includes("--through-11");
const through10 = through11 || process.argv.includes("--through-10");
const through09 = through10 || process.argv.includes("--through-09");
const through08 = through09 || process.argv.includes("--through-08");
const through07 = through08 || process.argv.includes("--through-07");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: options.env ?? environment,
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: options.timeout ?? 8 * 60_000,
    windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function runOfflineVerifier({ imageTag, imageDigest, verificationBundle,
  assignmentVerificationMaterial = null, label }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `alphonse-ticket11-${label}-`));
  const inputDirectory = path.join(directory, "input");
  const outputDirectory = path.join(directory, "output");
  await mkdir(inputDirectory);
  await mkdir(outputDirectory);
  await chmod(directory, 0o755);
  await chmod(inputDirectory, 0o755);
  await chmod(outputDirectory, 0o777);
  const inputPath = path.join(inputDirectory, "bundle.json");
  const outputPath = path.join(outputDirectory, "report.json");
  await writeFile(inputPath, `${JSON.stringify({ independent_verification_bundle: verificationBundle,
    ...(assignmentVerificationMaterial ? {
      assignment_verification_material: assignmentVerificationMaterial
    } : {}) })}\n`);
  const result = spawnSync("docker", ["run", "--rm", "--network", "none", "--read-only",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64",
    "--memory", "256m", "--cpus", "1", "-e", `VERIFIER_IMAGE_DIGEST=${imageDigest}`,
    "-v", `${inputDirectory}:/input:ro`, "-v", `${outputDirectory}:/output:rw`, imageTag,
    "/input/bundle.json", "/output/report.json"], {
    cwd: root, env: environment, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    timeout: 2 * 60_000, windowsHide: true
  });
  if (result.error) throw result.error;
  const report = JSON.parse(await readFile(outputPath, "utf8"));
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, report };
}

function resealVerificationBundle(verificationBundle) {
  verificationBundle.bundle_digest = sha256Digest(verificationBundle.bundle);
  return verificationBundle;
}

function assertVerificationReportDigest(report) {
  const material = structuredClone(report);
  delete material.report_digest;
  assert.equal(report.report_digest, sha256Digest(material), "verification report digest must be self-consistent");
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
    const requestReceiptCoverage = [];
    for (const crmRequest of requests.requests) {
      const source = recovered.deliveries.find((item) => item.delivery_id === crmRequest.delivery_id);
      assert.ok(source, "CRM request must cite one observed delivery.");
      assert.equal(crmRequest.idempotency_key_equality_token, source.delivery_identity_equality_token);
      assert.equal(crmRequest.transport_status, 201);
      const receipt = await kernel(`/diagnostic/v0/observation-receipts/${crmRequest.observation_receipt_id}`);
      assert.equal(receipt.body.observation_receipt.principal_id, "observer:crm-request");
      assert.equal(receipt.body.observation_receipt.observation_type, "destination.request");
      const coverage = receipt.body.observation_receipt.coverage;
      requestReceiptCoverage.push(coverage);
      assert.ok(["complete_through_high_water", "incomplete"].includes(coverage.coverage_status));
      if (coverage.coverage_status === "complete_through_high_water") {
        assert.deepEqual(coverage.missing_ranges, []);
      } else {
        assert.ok(coverage.missing_ranges.length > 0,
          "historically incomplete coverage must preserve its exact missing range");
      }
    }
    assert.ok(requestReceiptCoverage.some((coverage) =>
      coverage.coverage_status === "complete_through_high_water" && coverage.missing_ranges.length === 0),
    "one accepted request receipt must establish that the out-of-order gap was eventually filled");
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
    let correlation = null;
    let interpretation = null;
    if (through08) {
      const registrationId = randomUUID();
      const registered = await post("/diagnostic/v0/correlation-registrations", {
        registration_id: registrationId,
        deployment_id: deployment.deployment_id,
        workflow_id: "workflow:agency-lab:lead-ingestion",
        revision_id: extended.revisionId,
        integration_id: "integration:mock-crm"
      });
      assert.equal(registered.response.status, 201, JSON.stringify(registered.body));
      const registration = registered.body.correlation_registration;
      assert.equal(registration.registration_id, registrationId);
      assert.equal(registration.revision_id, extended.revisionId);
      assert.equal(registration.projector.projector_id, "alphonse.canonical-correlation-projector");
      assert.equal(registration.projector.projector_version, "0.2.0");
      assert.match(registration.projector.artifact_digest, /^sha256:[0-9a-f]{64}$/u);
      assert.match(registration.projector.rules_digest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(registration.projector.input_schema_version,
        "alphonse.correlation-projector-input.v0.2");
      assert.equal(registration.projector.projection_schema_version,
        "alphonse.correlation-projection.v0.2");
      assert.equal(registration.projector.artifact_manifest.schema_version,
        "alphonse.correlation-projector-artifact-manifest.v0.2");
      const projectorFiles = registration.projector.artifact_manifest.module_closure
        .map((entry) => entry.path);
      for (const required of ["src/diagnostic-correlation-service.js", "src/correlation-projector.js",
        "src/correlation-input-integrity.js", "src/diagnostic-intake-outcome-contracts.js",
        "src/canonical-json.js", "src/observation-contracts.js"]) {
        assert.ok(projectorFiles.includes(required), required);
      }
      assert.ok(registration.contract_dependency_digests.includes(deployment.package_artifact_digest));

      const diagnostic = new pg.Client({ connectionString:
        "postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:45505/alphonse_diagnostic" });
      await diagnostic.connect();
      let projectionSettled = false;
      let projected;
      try {
        await diagnostic.query("BEGIN");
        await diagnostic.query(
          "SELECT next_position FROM diagnostic_intake_prefixes WHERE installation_id=$1 FOR UPDATE",
          [tokenBase.installation_id]
        );
        const pendingProjection = post("/diagnostic/v0/correlation-projections", {
          registration_id: registrationId,
          logical_operation_id: recovered.deliveries[0].logical_operation_id
        }).then((value) => { projectionSettled = true; return value; });
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(projectionSettled, false,
          "projection cutoff capture must wait on the intake finalization lock");
        await diagnostic.query("ROLLBACK");
        projected = await pendingProjection;
      } finally {
        await diagnostic.query("ROLLBACK").catch(() => {});
        await diagnostic.end();
      }
      assert.equal(projected.response.status, 201, JSON.stringify(projected.body));
      const projection = projected.body.correlation_projection;
      assert.equal(projection.committed_intake_cutoff,
        prefixAfterRestart.body.intake_prefix.committed_through);
      assert.equal(projection.revision_number, "1");
      assert.equal(projection.projector_input_schema_version,
        "alphonse.correlation-projector-input.v0.2");
      assert.match(projection.projector_input_digest, /^sha256:[0-9a-f]{64}$/u);
      assert.match(projection.semantic_digest, /^sha256:[0-9a-f]{64}$/u);
      assert.match(projection.record_digest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(projection.semantic_projection.schema_version,
        "alphonse.correlation-projection.v0.2");
      assert.equal(projection.semantic_projection.dependencies.projector_input_digest,
        projection.projector_input_digest);
      assert.equal(projection.semantic_projection.manifests.intake_outcomes.length,
        Number(projection.committed_intake_cutoff));
      assert.equal(projection.semantic_projection.manifests.receipts.length, 8);
      assert.equal(projection.semantic_projection.manifests.schemas.length, 4);
      assert.equal(projection.semantic_projection.manifests.tokenization_provenance.length, 6);
      assert.deepEqual(projection.semantic_projection.graph.counts_by_type, {
        "destination.effect": 2,
        "destination.request": 2,
        "runtime.execution": 2,
        "source.delivery": 2
      });
      assert.equal(projection.semantic_projection.graph.nodes.length, 9);
      assert.equal(projection.semantic_projection.graph.unresolved_relationships.length, 0,
        JSON.stringify(projection.semantic_projection.graph.unresolved_relationships));
      const relationships = projection.semantic_projection.graph.edges.map((edge) => edge.relationship);
      assert.equal(relationships.filter((value) => value === "logical_operation_contains_delivery").length, 2);
      assert.equal(relationships.filter((value) => value === "delivery_reported_execution").length, 2);
      assert.equal(relationships.filter((value) => value === "delivery_reported_request").length, 2);
      assert.equal(relationships.filter((value) => value === "delivery_identity_equals_request_key").length, 2);
      assert.equal(relationships.filter((value) => value === "request_keys_are_distinct").length, 1);
      assert.equal(relationships.filter((value) => value === "request_reported_ledger_claim").length, 2);
      assert.ok(projection.semantic_projection.graph.edges.every((edge) =>
        edge.supporting_claim_locations.length > 0));
      assert.ok(projection.semantic_projection.coverage.streams.every((stream) =>
        stream.coverage_status === "complete_through_high_water" && stream.missing_ranges.length === 0));
      assert.equal(projection.semantic_projection.coverage.conflicts.length, 0);
      assert.equal(projection.semantic_projection.coverage.rejections.length, 0);
      assert.equal(projection.semantic_projection.authority.defect_established, false);
      assert.equal("projection_id" in projection.semantic_projection, false);
      assert.equal("created_at" in projection.semantic_projection, false);

      const replay = await post("/diagnostic/v0/correlation-projections", {
        registration_id: registrationId,
        logical_operation_id: recovered.deliveries[0].logical_operation_id
      });
      assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
      assert.equal(replay.body.correlation_projection.projection_id, projection.projection_id);
      assert.equal(replay.body.correlation_projection.semantic_digest, projection.semantic_digest);
      const read = await kernel(`/diagnostic/v0/correlation-projections/${projection.projection_id}`);
      assert.equal(read.response.status, 200, JSON.stringify(read.body));
      assert.equal(read.body.correlation_projection.record_digest, projection.record_digest);

      const privileged = new pg.Client({ connectionString:
        "postgresql://alphonse:local-development-only@127.0.0.1:45505/alphonse_diagnostic" });
      await privileged.connect();
      try {
        await privileged.query(
          "ALTER TABLE diagnostic_correlation_projections DISABLE TRIGGER diagnostic_correlation_projections_immutable"
        );
        await privileged.query(
          "UPDATE diagnostic_correlation_projections SET semantic_projection=$2::jsonb WHERE projection_id=$1",
          [projection.projection_id, JSON.stringify({ ...projection.semantic_projection, privileged_tamper: true })]
        );
        await privileged.query(
          "ALTER TABLE diagnostic_correlation_projections ENABLE TRIGGER diagnostic_correlation_projections_immutable"
        );
        const corruptReplay = await post("/diagnostic/v0/correlation-projections", {
          registration_id: registrationId,
          logical_operation_id: recovered.deliveries[0].logical_operation_id
        });
        assert.equal(corruptReplay.response.status, 500, JSON.stringify(corruptReplay.body));
        assert.equal(corruptReplay.body.error.code, "CORRELATION_PROJECTION_INTEGRITY_VIOLATION");
        const nondeterminismCount = await privileged.query(
          "SELECT COUNT(*)::text AS count FROM diagnostic_correlation_projection_conflicts WHERE accepted_projection_id=$1",
          [projection.projection_id]
        );
        assert.equal(nondeterminismCount.rows[0].count, "0",
          "stored corruption must not create a nondeterminism record");
      } finally {
        await privileged.query(
          "ALTER TABLE diagnostic_correlation_projections DISABLE TRIGGER diagnostic_correlation_projections_immutable"
        ).catch(() => {});
        await privileged.query(
          "UPDATE diagnostic_correlation_projections SET semantic_projection=$2::jsonb WHERE projection_id=$1",
          [projection.projection_id, JSON.stringify(projection.semantic_projection)]
        ).catch(() => {});
        await privileged.query(
          "ALTER TABLE diagnostic_correlation_projections ENABLE TRIGGER diagnostic_correlation_projections_immutable"
        ).catch(() => {});
        await privileged.end();
      }

      const immutable = new pg.Client({ connectionString:
        "postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:45505/alphonse_diagnostic" });
      await immutable.connect();
      try {
        await assert.rejects(immutable.query(
          "UPDATE diagnostic_correlation_projections SET requested_by='tampered' WHERE projection_id=$1",
          [projection.projection_id]), /immutable records cannot be updated/u);
      } finally { await immutable.end(); }
      correlation = { registration, projection };

      if (through09) {
        const activationId = randomUUID();
        const activated = await post("/diagnostic/v0/interpretation-activations", {
          activation_id: activationId,
          deployment_id: deployment.deployment_id,
          integration_contract_export_id: deployment.integration_behavior_contract_export.export_id,
          behavior_contract_export_id: deployment.behavior_contract_export.export_id,
          evaluator_export_id: deployment.diagnostic_evaluator_export.export_id
        });
        assert.equal(activated.response.status, 201, JSON.stringify(activated.body));
        const activation = activated.body.interpretation_activation;
        assert.equal(activation.activation_id, activationId);
        assert.equal(activation.exports.integration_behavior_contract.kind,
          "integration_behavior_contract");
        assert.equal(activation.exports.behavior_contract.kind, "behavior_contract");
        assert.equal(activation.exports.diagnostic_evaluator.kind, "diagnostic_evaluator");
        assert.equal(activation.stage.artifact_manifest.schema_version,
          "alphonse.diagnostic-effect-stage-artifact-manifest.v0.1");
        const stageFiles = activation.stage.artifact_manifest.module_closure.map((entry) => entry.path);
        for (const required of ["src/diagnostic-effect-evaluation-service.js",
          "src/diagnostic-effect-projector.js", "src/diagnostic-effect-evaluator.js",
          "src/diagnostic-claim-envelope.js", "src/diagnostic-effect-contracts.js"]) {
          assert.ok(stageFiles.includes(required), required);
        }

        let evidencePolicyActivation = null;
        let assignmentPolicyActivation = null;
        if (through10) {
          const evidencePolicyActivationId = randomUUID();
          const policyActivated = await post("/diagnostic/v0/evidence-policy-activations", {
            evidence_policy_activation_id: evidencePolicyActivationId,
            interpretation_activation_id: activationId,
            deployment_id: deployment.deployment_id,
            selection_policy_export_id: deployment.evidence_selection_policy_export.export_id,
            retention_policy_export_id: deployment.diagnostic_retention_policy_export.export_id
          });
          assert.equal(policyActivated.response.status, 201, JSON.stringify(policyActivated.body));
          evidencePolicyActivation = policyActivated.body.evidence_policy_activation;
          assert.equal(evidencePolicyActivation.evidence_policy_activation_id, evidencePolicyActivationId);
          assert.deepEqual(evidencePolicyActivation.retention_requirements, {
            pretrigger_observation_horizon_seconds: 120,
            pretrigger_pipeline_retry_horizon_seconds: 120,
            ordinary_retention_min_seconds: 270,
            collection_window_seconds: 60,
            post_trigger_retry_horizon_seconds: 90,
            collection_lease_min_seconds: 180
          });
          assert.equal(evidencePolicyActivation.stage.artifact_manifest.schema_version,
            "alphonse.diagnostic-evidence-stage-artifact-manifest.v0.1");
          const evidenceStageFiles = evidencePolicyActivation.stage.artifact_manifest.module_closure
            .map((entry) => entry.path);
          for (const required of ["src/diagnostic-evidence-package-service.js",
            "src/diagnostic-evidence-selector.js", "src/diagnostic-evidence-contracts.js",
            "src/diagnostic-evidence-collection-persistence.js"]) {
            assert.ok(evidenceStageFiles.includes(required), required);
          }
          if (through12) {
            const assignmentPolicyActivationId = randomUUID();
            const assignmentPolicyActivated = await post("/diagnostic/v0/assignment-policy-activations", {
              assignment_policy_activation_id: assignmentPolicyActivationId,
              deployment_id: deployment.deployment_id,
              assignment_policy_export_id: deployment.diagnostic_assignment_policy_export.export_id
            });
            assert.equal(assignmentPolicyActivated.response.status, 201,
              JSON.stringify(assignmentPolicyActivated.body));
            assignmentPolicyActivation = assignmentPolicyActivated.body.assignment_policy_activation;
            assert.equal(assignmentPolicyActivation.assignment_policy_activation_id,
              assignmentPolicyActivationId);
            assert.equal(assignmentPolicyActivation.authority_granted, "none");
            assert.equal(assignmentPolicyActivation.assignment_policy.document.disclosure.before_claim, "none");
            assert.equal(assignmentPolicyActivation.stage.artifact_manifest.schema_version,
              "alphonse.diagnostic-assignment-stage-artifact-manifest.v0.1");
            const assignmentStageFiles = assignmentPolicyActivation.stage.artifact_manifest.module_closure
              .map((entry) => entry.path);
            for (const required of ["src/diagnostic-assignment-service.js",
              "src/diagnostic-assignment-projector.js", "src/diagnostic-assignment-contracts.js",
              "src/diagnostic-assignment-persistence.js"]) {
              assert.ok(assignmentStageFiles.includes(required), required);
            }
          }
        }

        const effectEvaluationInput = {
          correlation_projection_id: projection.projection_id,
          activation_id: activationId,
          ...(evidencePolicyActivation ? {
            evidence_policy_activation_id: evidencePolicyActivation.evidence_policy_activation_id
          } : {})
        };
        const processed = await post("/diagnostic/v0/effect-evaluations", effectEvaluationInput);
        assert.equal(processed.response.status, 201, JSON.stringify(processed.body));
        const effectProjection = processed.body.diagnostic_effect_projection;
        const evaluation = processed.body.behavior_evaluation;
        const trigger = processed.body.diagnostic_trigger;
        const diagnosticCase = processed.body.diagnostic_case;
        const initialCollection = processed.body.evidence_collection;
        assert.equal(effectProjection.semantic_projection.schema_version,
          "alphonse.diagnostic-effect-projection.v0.1");
        assert.equal(effectProjection.semantic_projection.effects.length, 2);
        assert.ok(effectProjection.semantic_projection.effects.every((effect) =>
          effect.status === "committed"
          && effect.commitment_basis === "designated_append_only_commit_record"
          && effect.effect_class === "diagnostic_derived_external_effect"
          && effect.authority === "none"));
        assert.equal(effectProjection.semantic_projection.authority.kernel_effect, false);
        assert.equal(effectProjection.semantic_projection.authority.external_truth_established, false);
        assert.equal(evaluation.semantic_evaluation.result, "violated");
        assert.equal(evaluation.semantic_evaluation.measurement.matched_effect_count, 2);
        assert.equal(evaluation.semantic_evaluation.assertion.threshold, 1);
        assert.deepEqual(evaluation.semantic_evaluation.evaluator.input_boundary,
          ["behavior_contract", "diagnostic_effect_projection", "diagnostic_evaluator"]);
        const evaluationBytes = JSON.stringify(evaluation.semantic_evaluation);
        for (const prohibited of ["transport_status", "effect_feed", "external_claim", "receipt_id"]) {
          assert.equal(evaluationBytes.includes(prohibited), false, prohibited);
        }
        assert.equal(trigger.root_cause_established, false);
        assert.equal(trigger.repair_authority_granted, false);
        assert.equal(trigger.kernel_effect_authority_granted, false);
        if (through10) {
          assert.equal(trigger.evidence_policy_activation_id,
            evidencePolicyActivation.evidence_policy_activation_id);
          assert.equal(trigger.evidence_collection_required, true);
          assert.equal(initialCollection.state, "active");
          assert.equal(initialCollection.scheduler.status, "pending");
          assert.equal(initialCollection.scheduler.attempt_count, 0);
          assert.ok(Date.parse(initialCollection.lease_expires_at)
            > Date.parse(initialCollection.collection_deadline));
          assert.ok(initialCollection.references.length >= 19,
            JSON.stringify(initialCollection.references));
          assert.ok(initialCollection.references.every((reference) =>
            reference.reference_stage === "trigger_input"));
        } else {
          assert.equal(initialCollection, null);
        }
        assert.equal(diagnosticCase.state, "open");
        assert.equal(diagnosticCase.root_cause_status, "NOT_ESTABLISHED");
        assert.deepEqual(diagnosticCase.authority, {
          diagnosis: "not_granted", repair: "not_granted", kernel_effect: "not_granted"
        });
        assert.equal(diagnosticCase.claims.length, 12);
        assert.equal(diagnosticCase.claims.filter((claim) =>
          claim.claim_type === "authenticated_observation").length, 8);
        assert.equal(diagnosticCase.claims.filter((claim) =>
          claim.claim_type === "committed_effect_interpretation").length, 2);
        assert.equal(diagnosticCase.claims.filter((claim) =>
          claim.claim_type === "behavior_invariant_evaluation").length, 1);
        const unresolvedClaim = diagnosticCase.claims.find((claim) =>
          claim.claim_type === "unresolved_conclusion");
        assert.equal(unresolvedClaim.effective_support, "NOT_ESTABLISHED");
        assert.equal(unresolvedClaim.authority_decision.authority, "none");
        assert.equal(unresolvedClaim.temporal_scope.freshness, "frozen_historical");
        assert.ok(diagnosticCase.claims.every((claim) => claim.processing_profile === "D0"
          && claim.evidence_references.length > 0));

        const replayed = await post("/diagnostic/v0/effect-evaluations", effectEvaluationInput);
        assert.equal(replayed.response.status, 200, JSON.stringify(replayed.body));
        assert.equal(replayed.body.diagnostic_effect_projection.effect_projection_id,
          effectProjection.effect_projection_id);
        assert.equal(replayed.body.behavior_evaluation.evaluation_id, evaluation.evaluation_id);
        assert.equal(replayed.body.diagnostic_trigger.trigger_id, trigger.trigger_id);
        assert.equal(replayed.body.diagnostic_case.case_id, diagnosticCase.case_id);

        const effectPrivileged = new pg.Client({ connectionString:
          "postgresql://alphonse:local-development-only@127.0.0.1:45505/alphonse_diagnostic" });
        await effectPrivileged.connect();
        try {
          await effectPrivileged.query(
            "ALTER TABLE diagnostic_effect_projections DISABLE TRIGGER diagnostic_effect_projections_immutable"
          );
          await effectPrivileged.query(
            "UPDATE diagnostic_effect_projections SET semantic_projection=$2::jsonb WHERE effect_projection_id=$1",
            [effectProjection.effect_projection_id,
              JSON.stringify({ ...effectProjection.semantic_projection, privileged_tamper: true })]
          );
          await effectPrivileged.query(
            "ALTER TABLE diagnostic_effect_projections ENABLE TRIGGER diagnostic_effect_projections_immutable"
          );
          const corruptEffectReplay = await post("/diagnostic/v0/effect-evaluations", effectEvaluationInput);
          assert.equal(corruptEffectReplay.response.status, 500, JSON.stringify(corruptEffectReplay.body));
          assert.equal(corruptEffectReplay.body.error.code,
            "DIAGNOSTIC_EFFECT_PROJECTION_INTEGRITY_VIOLATION");
          const downstreamCounts = await effectPrivileged.query(
            `SELECT
              (SELECT COUNT(*)::int FROM diagnostic_behavior_evaluations) AS evaluations,
              (SELECT COUNT(*)::int FROM diagnostic_behavior_triggers) AS triggers,
              (SELECT COUNT(*)::int FROM diagnostic_cases WHERE case_origin='deterministic_behavior_trigger') AS cases`
          );
          assert.deepEqual(downstreamCounts.rows[0], { evaluations: 1, triggers: 1, cases: 1 },
            "stored effect corruption must not be accepted as replay or create downstream material");
        } finally {
          await effectPrivileged.query(
            "ALTER TABLE diagnostic_effect_projections DISABLE TRIGGER diagnostic_effect_projections_immutable"
          ).catch(() => {});
          await effectPrivileged.query(
            "UPDATE diagnostic_effect_projections SET semantic_projection=$2::jsonb WHERE effect_projection_id=$1",
            [effectProjection.effect_projection_id, JSON.stringify(effectProjection.semantic_projection)]
          ).catch(() => {});
          await effectPrivileged.query(
            "ALTER TABLE diagnostic_effect_projections ENABLE TRIGGER diagnostic_effect_projections_immutable"
          ).catch(() => {});
          await effectPrivileged.end();
        }

        for (const [route, key, id] of [
          ["effect-projections", "diagnostic_effect_projection", effectProjection.effect_projection_id],
          ["behavior-evaluations", "behavior_evaluation", evaluation.evaluation_id],
          ["diagnostic-triggers", "diagnostic_trigger", trigger.trigger_id],
          ["deterministic-cases", "diagnostic_case", diagnosticCase.case_id],
          ["claim-envelopes", "claim_envelope", unresolvedClaim.claim_id]
        ]) {
          const readResult = await kernel(`/diagnostic/v0/${route}/${id}`);
          assert.equal(readResult.response.status, 200, JSON.stringify(readResult.body));
          assert.ok(readResult.body[key]);
        }

        const immutableDerived = new pg.Client({ connectionString:
          "postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:45505/alphonse_diagnostic" });
        await immutableDerived.connect();
        try {
          await assert.rejects(immutableDerived.query(
            "UPDATE diagnostic_behavior_evaluations SET logical_operation_id='tampered' WHERE evaluation_id=$1",
            [evaluation.evaluation_id]), /immutable records cannot be updated/u);
          const counts = await immutableDerived.query(
            `SELECT
              (SELECT COUNT(*)::int FROM diagnostic_effect_projections) AS effects,
              (SELECT COUNT(*)::int FROM diagnostic_behavior_evaluations) AS evaluations,
              (SELECT COUNT(*)::int FROM diagnostic_behavior_triggers) AS triggers,
              (SELECT COUNT(*)::int FROM diagnostic_cases WHERE case_origin='deterministic_behavior_trigger') AS cases`
          );
          assert.deepEqual(counts.rows[0], { effects: 1, evaluations: 1, triggers: 1, cases: 1 });
        } finally { await immutableDerived.end(); }
        let evidencePackage = null;
        let independentVerification = null;
        let diagnosticAssignment = null;
        let assignmentVerificationMaterial = null;
        let evidenceRevision = null;
        let replacementAssignment = null;
        let replacementVerificationMaterial = null;
        let lateObservationCounts = null;
        let materialErasure = null;
        let dispatchClaim = null;
        let finalCollection = initialCollection;
        if (through10) {
          const frozen = await post("/diagnostic/v0/evidence-collections/process", {
            case_id: diagnosticCase.case_id,
            ...(assignmentPolicyActivation ? {
              assignment_policy_activation_id: assignmentPolicyActivation.assignment_policy_activation_id
            } : {})
          });
          assert.equal(frozen.response.status, 201, JSON.stringify(frozen.body));
          evidencePackage = frozen.body.evidence_package;
          finalCollection = frozen.body.collection;
          assert.equal(frozen.body.readiness.reason, "required_sources_complete");
          assert.equal(finalCollection.state, "released_to_package_pins");
          assert.equal(finalCollection.scheduler.status, "frozen");
          assert.equal(finalCollection.scheduler.attempt_count, 1);
          assert.ok(finalCollection.references.length > initialCollection.references.length);
          assert.ok(finalCollection.references.some((reference) =>
            reference.reference_stage === "collection_extension"
            && reference.reference_type === "diagnostic_observation_receipt"));
          assert.equal(evidencePackage.freeze_reason, "required_sources_complete");
          assert.equal(evidencePackage.semantic_package.schema_version,
            "alphonse.diagnostic-evidence-package.v0.2");
          assert.equal(evidencePackage.semantic_package.freeze.required_sources_complete, true);
          assert.equal(evidencePackage.semantic_package.freeze.committed_intake_cutoff,
            projection.committed_intake_cutoff);
          assert.equal(evidencePackage.semantic_package.manifest.authenticated_observations.observations.length, 8);
          assert.ok(evidencePackage.semantic_package.manifest.authenticated_observations
            .authenticated_provenance_dependencies.length > 0);
          assert.deepEqual(evidencePackage.semantic_package.manifest.role_completion.selected_counts_by_type, {
            "destination.effect": 2,
            "destination.request": 2,
            "runtime.execution": 2,
            "source.delivery": 2
          });
          assert.equal(evidencePackage.semantic_package.manifest.role_completion.missing_roles.length, 0);
          assert.equal(evidencePackage.semantic_package.manifest.coverage_and_limitations.gaps.length, 0);
          assert.equal(evidencePackage.semantic_package.manifest.coverage_and_limitations.conflicts.length, 0);
          assert.equal(evidencePackage.semantic_package.manifest.coverage_and_limitations.rejections.length, 0);
          assert.equal(evidencePackage.semantic_package.manifest.coverage_and_limitations
            .unresolved_relationships.length, 0);
          assert.equal(evidencePackage.semantic_package.manifest.disclosure_accounting
            .broad_logical_operation_search_used, false);
          assert.equal(evidencePackage.semantic_package.manifest.disclosure_accounting
            .model_selected_evidence, false);
          assert.deepEqual(evidencePackage.semantic_package.authority, {
            assignment_created: false,
            dispatch_authorized: false,
            worker_run_created: false,
            model_request_created: false,
            diagnosis_established: false,
            repair_authorized: false,
            kernel_effect_authorized: false
          });
          assert.match(evidencePackage.semantic_digest, /^sha256:[0-9a-f]{64}$/u);
          assert.match(evidencePackage.package_artifact_digest, /^sha256:[0-9a-f]{64}$/u);

          const packageReplay = await post("/diagnostic/v0/evidence-collections/process", {
            case_id: diagnosticCase.case_id,
            ...(assignmentPolicyActivation ? {
              assignment_policy_activation_id: assignmentPolicyActivation.assignment_policy_activation_id
            } : {})
          });
          assert.equal(packageReplay.response.status, 200, JSON.stringify(packageReplay.body));
          assert.equal(packageReplay.body.evidence_package.evidence_package_id,
            evidencePackage.evidence_package_id);
          assert.equal(packageReplay.body.evidence_package.semantic_digest, evidencePackage.semantic_digest);
          const policyRead = await kernel(`/diagnostic/v0/evidence-policy-activations/${
            evidencePolicyActivation.evidence_policy_activation_id}`);
          assert.equal(policyRead.response.status, 200, JSON.stringify(policyRead.body));
          const collectionRead = await kernel(`/diagnostic/v0/evidence-collections/${diagnosticCase.case_id}`);
          assert.equal(collectionRead.response.status, 200, JSON.stringify(collectionRead.body));
          assert.equal(collectionRead.body.evidence_collection.lease_id, finalCollection.lease_id);
          const packageRead = await kernel(`/diagnostic/v0/evidence-packages/${evidencePackage.evidence_package_id}`);
          assert.equal(packageRead.response.status, 200, JSON.stringify(packageRead.body));
          assert.equal(packageRead.body.evidence_package.package_artifact_digest,
            evidencePackage.package_artifact_digest);

          const packageDb = new pg.Client({ connectionString:
            "postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:45505/alphonse_diagnostic" });
          await packageDb.connect();
          try {
            await assert.rejects(packageDb.query(
              "UPDATE diagnostic_evidence_packages SET freeze_reason='collection_deadline' WHERE evidence_package_id=$1",
              [evidencePackage.evidence_package_id]), /immutable records cannot be updated/u);
            const packageCounts = await packageDb.query(
              `SELECT
                (SELECT COUNT(*)::int FROM diagnostic_evidence_packages) AS packages,
                (SELECT COUNT(*)::int FROM diagnostic_evidence_collection_leases) AS leases,
                (SELECT COUNT(*)::int FROM diagnostic_evidence_collection_lease_releases) AS releases,
                (SELECT COUNT(*)::int FROM diagnostic_artifact_retention_pins) AS pins,
                (SELECT COUNT(*)::int FROM diagnostic_diagnosis_requests) AS diagnosis_requests,
                (SELECT COUNT(*)::int FROM diagnostic_independent_verification_bundles) AS verification_bundles`
            );
            assert.equal(packageCounts.rows[0].packages, 1);
            assert.equal(packageCounts.rows[0].leases, 1);
            assert.equal(packageCounts.rows[0].releases, 1);
            assert.ok(packageCounts.rows[0].pins >= finalCollection.references.length + 1);
            assert.equal(packageCounts.rows[0].diagnosis_requests, 0);
            assert.equal(packageCounts.rows[0].verification_bundles, 1);
          } finally { await packageDb.end(); }

          const packagePrivileged = new pg.Client({ connectionString:
            "postgresql://alphonse:local-development-only@127.0.0.1:45505/alphonse_diagnostic" });
          await packagePrivileged.connect();
          try {
            await packagePrivileged.query(
              "ALTER TABLE diagnostic_evidence_packages DISABLE TRIGGER diagnostic_evidence_packages_immutable"
            );
            await packagePrivileged.query(
              "UPDATE diagnostic_evidence_packages SET semantic_package=$2::jsonb WHERE evidence_package_id=$1",
              [evidencePackage.evidence_package_id,
                JSON.stringify({ ...evidencePackage.semantic_package, privileged_tamper: true })]
            );
            await packagePrivileged.query(
              "ALTER TABLE diagnostic_evidence_packages ENABLE TRIGGER diagnostic_evidence_packages_immutable"
            );
            const corruptPackageReplay = await post("/diagnostic/v0/evidence-collections/process", {
              case_id: diagnosticCase.case_id
            });
            assert.equal(corruptPackageReplay.response.status, 500,
              JSON.stringify(corruptPackageReplay.body));
            assert.equal(corruptPackageReplay.body.error.code,
              "DIAGNOSTIC_EVIDENCE_PACKAGE_INTEGRITY_VIOLATION");
            const corruptPackageCounts = await packagePrivileged.query(
              `SELECT
                (SELECT COUNT(*)::int FROM diagnostic_evidence_packages) AS packages,
                (SELECT COUNT(*)::int FROM diagnostic_evidence_collection_lease_releases) AS releases`
            );
            assert.deepEqual(corruptPackageCounts.rows[0], { packages: 1, releases: 1 },
              "stored package corruption must not be accepted as replay or create replacement evidence");
          } finally {
            await packagePrivileged.query(
              "ALTER TABLE diagnostic_evidence_packages DISABLE TRIGGER diagnostic_evidence_packages_immutable"
            ).catch(() => {});
            await packagePrivileged.query(
              "UPDATE diagnostic_evidence_packages SET semantic_package=$2::jsonb WHERE evidence_package_id=$1",
              [evidencePackage.evidence_package_id, JSON.stringify(evidencePackage.semantic_package)]
            ).catch(() => {});
            await packagePrivileged.query(
              "ALTER TABLE diagnostic_evidence_packages ENABLE TRIGGER diagnostic_evidence_packages_immutable"
            ).catch(() => {});
            await packagePrivileged.end();
          }

          if (through12) {
            const rotatedPolicy = await post("/diagnostic/v0/assignment-policy-activations", {
              assignment_policy_activation_id: randomUUID(),
              deployment_id: deployment.deployment_id,
              assignment_policy_export_id: deployment.diagnostic_assignment_policy_export.export_id
            });
            assert.equal(rotatedPolicy.response.status, 201, JSON.stringify(rotatedPolicy.body));
            assert.notEqual(rotatedPolicy.body.assignment_policy_activation.assignment_policy_activation_id,
              assignmentPolicyActivation.assignment_policy_activation_id);

            const assignmentRead = await eventually(async () => {
              const value = await kernel(`/diagnostic/v0/evidence-packages/${
                evidencePackage.evidence_package_id}/assignment`);
              if (value.response.status === 200) return value;
              const status = await kernel(`/diagnostic/v0/evidence-packages/${
                evidencePackage.evidence_package_id}/assignment-status`);
              if (status.body.assignment_processing?.status === "terminal_failed") {
                throw new Error(JSON.stringify(status.body));
              }
              if (status.body.assignment_processing?.failure) {
                throw new Error(JSON.stringify(status.body));
              }
              return null;
            }, "model-free assignment creation");
            diagnosticAssignment = assignmentRead.body.diagnostic_assignment;
            assert.equal(diagnosticAssignment.evidence_package_id, evidencePackage.evidence_package_id);
            assert.equal(diagnosticAssignment.assignment_policy_activation_id,
              assignmentPolicyActivation.assignment_policy_activation_id,
              "delayed assignment consumption must use the policy pinned at package freeze");
            assert.equal(diagnosticAssignment.state.current, "unclaimed");
            assert.equal(diagnosticAssignment.state.revision, "0");
            assert.equal(diagnosticAssignment.authority_granted, "none");
            assert.equal(diagnosticAssignment.worker_bound, false);
            assert.equal(diagnosticAssignment.execution_capability_created, false);
            assert.equal(diagnosticAssignment.model_request_created, false);
            assert.equal(diagnosticAssignment.assignment.initial_state, "unclaimed");
            assert.equal(diagnosticAssignment.assignment.authority.authority_granted, "none");
            assert.deepEqual(diagnosticAssignment.assignment.authority.granted_capabilities, []);
            assert.equal(diagnosticAssignment.assignment.authority.evidence_disclosed, false);
            assert.equal(diagnosticAssignment.assignment.authority.model_contacted, false);
            assert.equal(diagnosticAssignment.assignment.temporal.available_at, evidencePackage.frozen_at);
            assert.equal(diagnosticAssignment.assignment.temporal.expires_at,
              new Date(Date.parse(evidencePackage.frozen_at) + 3_600_000).toISOString());
            const mechanismValues = diagnosticAssignment.assignment.assignment_policy.output_schema
              .properties.best_supported_hypothesis.properties.mechanism.enum;
            assert.ok(mechanismValues.length > 4);
            assert.ok(mechanismValues.includes("identity_scope_mismatch"));
            assert.ok(mechanismValues.includes("unknown"));
            assert.equal(Object.hasOwn(diagnosticAssignment.assignment.assignment_policy.instruction,
              "expected_answer"), false);

            const assignmentStatusRead = await kernel(`/diagnostic/v0/evidence-packages/${
              evidencePackage.evidence_package_id}/assignment-status`);
            assert.equal(assignmentStatusRead.response.status, 200,
              JSON.stringify(assignmentStatusRead.body));
            assert.equal(assignmentStatusRead.body.assignment_processing.status, "assignment_created");
            assert.equal(assignmentStatusRead.body.assignment_processing.assignment_id,
              diagnosticAssignment.assignment_id);
            assert.equal(assignmentStatusRead.body.assignment_processing.assignment_state, "unclaimed");
            assert.equal(assignmentStatusRead.body.assignment_processing.authority_granted, "none");

            const assignmentById = await kernel(`/diagnostic/v0/assignments/${diagnosticAssignment.assignment_id}`);
            assert.equal(assignmentById.response.status, 200, JSON.stringify(assignmentById.body));
            assert.equal(assignmentById.body.diagnostic_assignment.assignment_digest,
              diagnosticAssignment.assignment_digest);
            const verificationMaterialRead = await kernel(`/diagnostic/v0/assignment-verification-material/${
              diagnosticAssignment.assignment_id}`);
            assert.equal(verificationMaterialRead.response.status, 200,
              JSON.stringify(verificationMaterialRead.body));
            assignmentVerificationMaterial = verificationMaterialRead.body.assignment_verification_material;
            assert.equal(assignmentVerificationMaterial.assurance_boundary.verifier_required_for_creation, false);
            assert.equal(assignmentVerificationMaterial.assurance_boundary.model_request_created, false);
            assert.equal(assignmentVerificationMaterial.assignment.assignment_id,
              diagnosticAssignment.assignment_id);

            const assignmentDb = new pg.Client({ connectionString:
              "postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:45505/alphonse_diagnostic" });
            await assignmentDb.connect();
            try {
              await assert.rejects(assignmentDb.query(
                "UPDATE diagnostic_assignments SET created_by='tampered' WHERE assignment_id=$1",
                [diagnosticAssignment.assignment_id]), /immutable records cannot be updated/u);
              await assert.rejects(assignmentDb.query(
                `UPDATE diagnostic_assignment_states
                 SET state='unclaimed',state_revision=1,updated_at=now() WHERE assignment_id=$1`,
                [diagnosticAssignment.assignment_id]), /assignment state transition is invalid/u);
              const counts = await assignmentDb.query(
                `SELECT
                  (SELECT COUNT(*)::int FROM diagnostic_assignments) AS assignments,
                  (SELECT COUNT(*)::int FROM diagnostic_assignment_stage_records) AS stage_records,
                  (SELECT COUNT(*)::int FROM diagnostic_assignment_nondeterminism_conflicts) AS conflicts,
                  (SELECT COUNT(*)::int FROM diagnostic_diagnosis_requests) AS diagnosis_requests`
              );
              assert.deepEqual(counts.rows[0], {
                assignments: 1, stage_records: 1, conflicts: 0, diagnosis_requests: 0
              });
            } finally { await assignmentDb.end(); }
          }

          if (through11) {
            const bundleRead = await kernel(`/diagnostic/v0/independent-verification-bundles/${
              evidencePackage.evidence_package_id}`);
            assert.equal(bundleRead.response.status, 200, JSON.stringify(bundleRead.body));
            const verificationBundle = bundleRead.body.independent_verification_bundle;
            assert.equal(verificationBundle.evidence_package_id, evidencePackage.evidence_package_id);
            assert.equal(verificationBundle.bundle.target.committed_intake_cutoff,
              projection.committed_intake_cutoff);
            assert.equal(verificationBundle.bundle.target.expected_bundle_scope,
              "complete_installation_prefix_through_cutoff");
            assert.equal(verificationBundle.bundle.assurance_boundary.authority, "none");
            assert.equal(verificationBundle.bundle.assurance_boundary.hostile_host_resistance_claimed, false);
            assert.equal(verificationBundle.bundle.independent_inputs.positions.length,
              Number(projection.committed_intake_cutoff));

            const verifierImage = `alphonse-independent-diagnostic-verifier:ticket-11-${process.pid}`;
            run("docker", ["build", "--file", "Dockerfile.verifier", "--tag", verifierImage, "."], {
              timeout: 8 * 60_000
            });
            const verifierImageDigest = run("docker", ["image", "inspect", "--format={{.Id}}", verifierImage])
              .trim();
            assert.match(verifierImageDigest, /^sha256:[0-9a-f]{64}$/u);

            const valid = await runOfflineVerifier({ imageTag: verifierImage,
              imageDigest: verifierImageDigest, verificationBundle,
              assignmentVerificationMaterial: through12 ? assignmentVerificationMaterial : null,
              label: "valid" });
            assert.equal(valid.status, 0, valid.stderr);
            assert.equal(valid.report.result, "verified", JSON.stringify(valid.report));
            assert.equal(valid.report.support, "DETERMINISTICALLY_RECOMPUTED");
            assert.equal(valid.report.authority, "none");
            assert.equal(valid.report.authority_effects_created, 0);
            assert.equal(valid.report.production_events_emitted, 0);
            assert.equal(valid.report.verifier.image_digest, verifierImageDigest);
            assert.equal(valid.report.cryptographic_assurance.observer_hmac_signature,
              "accepted_by_diagnostic_plane_not_independently_reverified");
            assert.equal(valid.report.cryptographic_assurance.tokenization_result_signature,
              "independently_verified");
            assert.ok(valid.report.stages.length >= 10);
            assert.ok(valid.report.stages.every((stage) => stage.matches));
            if (through12) {
              assert.equal(valid.report.assignment_verification.assignment_id,
                diagnosticAssignment.assignment_id);
              assert.equal(valid.report.assignment_verification.assignment_digest,
                diagnosticAssignment.assignment_digest);
              assert.equal(valid.report.assignment_verification.state, "unclaimed");
            }
            assert.equal(valid.report.material_availability.length,
              Number(projection.committed_intake_cutoff));
            assert.ok(valid.report.material_availability.every((material) =>
              material.material_state === "exact_material"));
            assertVerificationReportDigest(valid.report);

            const reordered = structuredClone(verificationBundle);
            for (const field of ["positions", "accepted_receipts", "schema_activations", "schema_exports",
              "tokenization_result_receipts", "observation_grant_snapshots",
              "observation_grant_application_receipts"]) {
              reordered.bundle.independent_inputs[field].reverse();
            }
            resealVerificationBundle(reordered);
            const reorderedResult = await runOfflineVerifier({ imageTag: verifierImage,
              imageDigest: verifierImageDigest, verificationBundle: reordered,
              assignmentVerificationMaterial: through12 ? assignmentVerificationMaterial : null,
              label: "physical-reorder" });
            assert.equal(reorderedResult.status, 0, reorderedResult.stderr);
            assert.equal(reorderedResult.report.result, "verified", JSON.stringify(reorderedResult.report));
            assertVerificationReportDigest(reorderedResult.report);

            const assertRejectedMutation = async (label, mutate, expectedCode) => {
              const changed = structuredClone(verificationBundle);
              mutate(changed.bundle);
              resealVerificationBundle(changed);
              const checked = await runOfflineVerifier({ imageTag: verifierImage,
                imageDigest: verifierImageDigest, verificationBundle: changed,
                assignmentVerificationMaterial: through12 ? assignmentVerificationMaterial : null, label });
              assert.equal(checked.status, 1, `${label} unexpectedly verified\n${checked.stderr}`);
              assert.equal(checked.report.result, "failed");
              assert.equal(checked.report.failure.code, expectedCode, JSON.stringify(checked.report));
              assert.equal(checked.report.authority, "none");
              assert.equal(checked.report.authority_effects_created, 0);
              assert.equal(checked.report.production_events_emitted, 0);
              assertVerificationReportDigest(checked.report);
            };
            await assertRejectedMutation("missing-prefix-position", (bundle) => {
              bundle.independent_inputs.positions.pop();
            }, "VERIFIER_PREFIX_NOT_CONTIGUOUS");
            await assertRejectedMutation("cutoff-substitution", (bundle) => {
              bundle.target.committed_intake_cutoff = String(BigInt(bundle.target.committed_intake_cutoff) + 1n);
            }, "VERIFIER_PREFIX_NOT_CONTIGUOUS");
            await assertRejectedMutation("accepted-envelope-bytes", (bundle) => {
              bundle.independent_inputs.accepted_receipts[0].envelope_bytes = {
                encoding: "base64", bytes: Buffer.from("{}", "utf8").toString("base64")
              };
            }, "VERIFIER_ACCEPTED_RECEIPT_INTEGRITY_VIOLATION");
            await assertRejectedMutation("omitted-eligible-receipt", (bundle) => {
              bundle.independent_inputs.accepted_receipts.shift();
            }, "VERIFIER_ACCEPTED_RECEIPT_MISSING");
            await assertRejectedMutation("unexplained-erasure-tombstone", (bundle) => {
              bundle.independent_inputs.positions[0].material.state = "governed_erasure_tombstone";
            }, "VERIFIER_UNVERIFIABLE_MATERIAL");
            await assertRejectedMutation("stage-source-bytes", (bundle) => {
              bundle.independent_inputs.stage_artifact_archives[0].archive.files[0].bytes_base64 =
                Buffer.from("tampered", "utf8").toString("base64");
            }, "VERIFIER_STAGE_ARCHIVE_INTEGRITY_VIOLATION");
            await assertRejectedMutation("published-semantic-digest", (bundle) => {
              bundle.published_outputs_to_compare.correlation_projection.semantic_digest =
                `sha256:${"0".repeat(64)}`;
            }, "VERIFIER_PUBLISHED_OUTPUT_MISMATCH");
            await assertRejectedMutation("changed-projector-rules", (bundle) => {
              bundle.published_outputs_to_compare.correlation_registration.projector_rules_digest =
                `sha256:${"1".repeat(64)}`;
            }, "VERIFIER_CORRELATION_REGISTRATION_INTEGRITY_VIOLATION");
            await assertRejectedMutation("published-graph-order", (bundle) => {
              const nodes = bundle.published_outputs_to_compare.correlation_projection.semantic_projection.graph.nodes;
              [nodes[0], nodes[1]] = [nodes[1], nodes[0]];
            }, "VERIFIER_PUBLISHED_OUTPUT_MISMATCH");
            if (through12) {
              const assertRejectedAssignmentMutation = async (label, mutate, expectedCode) => {
                const changed = structuredClone(assignmentVerificationMaterial);
                mutate(changed);
                const checked = await runOfflineVerifier({ imageTag: verifierImage,
                  imageDigest: verifierImageDigest, verificationBundle,
                  assignmentVerificationMaterial: changed, label });
                assert.equal(checked.status, 1, `${label} unexpectedly verified\n${checked.stderr}`);
                assert.equal(checked.report.failure.code, expectedCode, JSON.stringify(checked.report));
                assert.equal(checked.report.authority_effects_created, 0);
                assert.equal(checked.report.production_events_emitted, 0);
                assertVerificationReportDigest(checked.report);
              };
              await assertRejectedAssignmentMutation("assignment-output", (material) => {
                material.assignment.assignment_document.temporal.expires_at =
                  "2099-01-01T00:00:00.000Z";
              }, "VERIFIER_ASSIGNMENT_OUTPUT_MISMATCH");
              await assertRejectedAssignmentMutation("assignment-policy-substitution", (material) => {
                material.assignment_policy_activation.policy_document.assignment_ttl_seconds += 1;
              }, "VERIFIER_ASSIGNMENT_POLICY_INTEGRITY_VIOLATION");
              await assertRejectedAssignmentMutation("assignment-authority-state", (material) => {
                material.assignment_state.state = "claimed";
              }, "VERIFIER_ASSIGNMENT_STATE_HISTORY_MISMATCH");
              await assertRejectedAssignmentMutation("assignment-creation-transition", (material) => {
                material.assignment_creation.transition.payload.authority_granted = "diagnostic";
              }, "VERIFIER_ASSIGNMENT_CREATION_HISTORY_MISMATCH");
            }
            if (through13) {
              compose("pause", "crm-ledger-observer");
              const lateForwardingId = randomUUID();
              const lateDeliveryId = `late-delivery-${randomUUID()}`;
              const lateWrite = await request("http://127.0.0.1:43700", "/v0/crm/leads", {
                method: "POST",
                headers: {
                  authorization: "Bearer local-n8n-crm-route-token",
                  "x-alphonse-logical-operation-id": firstRequest.logical_operation_id,
                  "x-alphonse-delivery-id": lateDeliveryId,
                  "x-alphonse-forwarding-id": lateForwardingId,
                  "x-alphonse-source-delivery-key": `late-key-${randomUUID()}`
                },
                body: JSON.stringify({ company: "late-evidence-proof" })
              });
              assert.equal(lateWrite.response.status, 202, JSON.stringify(lateWrite.body));
              await eventually(async () => {
                const requestStatus = await request("http://127.0.0.1:43700", "/internal/v0/status");
                return requestStatus.body.reported_count === 3 ? requestStatus : null;
              }, "late request observation before committed-effect observation", 60_000);
              const requestOnlyWake = await post("/diagnostic/v0/evidence-revisions/process", {
                case_id: diagnosticCase.case_id
              });
              assert.ok([200, 201].includes(requestOnlyWake.response.status),
                JSON.stringify(requestOnlyWake.body));
              const requestOnlyRevision = await eventually(async () => {
                const value = await kernel(`/diagnostic/v0/evidence-revisions/${diagnosticCase.case_id}`);
                const latest = value.body.evidence_revision?.revision_history?.at(-1);
                return value.response.status === 200 && latest
                  && !latest.assessment.material_change_classes.includes("behavior_evaluation_changed")
                  ? { value, latest } : null;
              }, "request-only temporal evidence assessment", 60_000);
              assert.equal(requestOnlyRevision.latest.assessment.recommended_action, "notify_only");
              compose("unpause", "crm-ledger-observer");
              const lateObserved = await eventually(async () => {
                const [requestStatus, ledgerStatus] = await Promise.all([
                  request("http://127.0.0.1:43700", "/internal/v0/status"),
                  request("http://127.0.0.1:43702", "/healthz")
                ]);
                return requestStatus.body.reported_count === 3
                  && ledgerStatus.body.reported_count === 3 ? { requestStatus, ledgerStatus } : null;
              }, "late request and committed-effect observations", 60_000);
              lateObservationCounts = { requests: lateObserved.requestStatus.body.reported_count,
                effects: lateObserved.ledgerStatus.body.reported_count };

              const revisionWake = await post("/diagnostic/v0/evidence-revisions/process", {
                case_id: diagnosticCase.case_id
              });
              assert.ok([200, 201].includes(revisionWake.response.status), JSON.stringify(revisionWake.body));
              const revisionRead = await eventually(async () => {
                const value = await kernel(`/diagnostic/v0/evidence-revisions/${diagnosticCase.case_id}`);
                const revision = value.body.evidence_revision;
                const behaviorChange = revision?.revision_history?.findLast((entry) =>
                  entry.reevaluation_available?.notice.material_change_classes
                    .includes("behavior_evaluation_changed")
                  && entry.reevaluation_available.recommended_action === "replace_unclaimed");
                return value.response.status === 200
                  && behaviorChange ? { value, behaviorChange } : null;
              }, "material evidence revision and reevaluation notice", 60_000);
              evidenceRevision = revisionRead.value.body.evidence_revision;
              const replacementRevision = revisionRead.behaviorChange;
              const replacementNotice = replacementRevision.reevaluation_available;
              assert.notEqual(evidenceRevision.current_evidence_package_id,
                evidencePackage.evidence_package_id);
              assert.equal(replacementRevision.assessment.outcome, "revision_created");
              assert.equal(replacementRevision.assessment.recommended_action, "replace_unclaimed");
              assert.equal(replacementNotice.recommended_action, "replace_unclaimed");
              assert.ok(replacementNotice.known_affected_assignments.some((entry) =>
                entry.assignment_id === diagnosticAssignment.assignment_id && entry.state === "unclaimed"));

              const successorPackageId = replacementNotice.successor_evidence_package_id;
              const successorPackageRead = await kernel(`/diagnostic/v0/evidence-packages/${successorPackageId}`);
              assert.equal(successorPackageRead.response.status, 200, JSON.stringify(successorPackageRead.body));
              const successorPackage = successorPackageRead.body.evidence_package;
              const currentPackageRead = await kernel(
                `/diagnostic/v0/evidence-packages/${evidenceRevision.current_evidence_package_id}`);
              assert.equal(currentPackageRead.response.status, 200, JSON.stringify(currentPackageRead.body));
              evidenceRevision.current_package_revision_number =
                currentPackageRead.body.evidence_package.revision_number;
              assert.ok(BigInt(successorPackage.revision_number) > 1n);
              assert.equal(successorPackage.predecessor_evidence_package_id,
                replacementNotice.predecessor_evidence_package_id);
              assert.equal(successorPackage.assessment_kind, "late_evidence");
              assert.equal(successorPackage.semantic_package.authority.model_request_created, false);
              assert.ok(BigInt(evidenceRevision.current_package_revision_number)
                >= BigInt(successorPackage.revision_number));
              assert.ok(evidenceRevision.revision_history.length >= 2);

              const replacementRead = await eventually(async () => {
                const value = await kernel(`/diagnostic/v0/evidence-packages/${successorPackageId}/assignment`);
                return value.response.status === 200 ? value : null;
              }, "policy-governed unclaimed assignment replacement", 60_000);
              replacementAssignment = replacementRead.body.diagnostic_assignment;
              assert.notEqual(replacementAssignment.assignment_id, diagnosticAssignment.assignment_id);
              assert.equal(replacementAssignment.evidence_package_id, successorPackageId);
              assert.equal(replacementAssignment.assignment_policy_activation_id,
                assignmentPolicyActivation.assignment_policy_activation_id);
              assert.equal(replacementAssignment.state.current, "unclaimed");
              assert.equal(replacementAssignment.authority_granted, "none");
              assert.equal(replacementAssignment.model_request_created, false);
              const replacedRead = await kernel(`/diagnostic/v0/assignments/${diagnosticAssignment.assignment_id}`);
              assert.equal(replacedRead.response.status, 200, JSON.stringify(replacedRead.body));
              assert.equal(replacedRead.body.diagnostic_assignment.state.current, "expired");
              assert.equal(replacedRead.body.diagnostic_assignment.state.revision, "1");

              const replacementMaterialRead = await kernel(
                `/diagnostic/v0/assignment-verification-material/${replacementAssignment.assignment_id}`);
              assert.equal(replacementMaterialRead.response.status, 200,
                JSON.stringify(replacementMaterialRead.body));
              replacementVerificationMaterial =
                replacementMaterialRead.body.assignment_verification_material;
              assert.equal(replacementVerificationMaterial.replacement_history.replacement
                .replaced_assignment_id, diagnosticAssignment.assignment_id);
              assert.equal(replacementVerificationMaterial.replacement_history.replaced_assignment_state.state,
                "expired");

              const revisionBundleRead = await kernel(
                `/diagnostic/v0/independent-verification-bundles/${successorPackageId}`);
              assert.equal(revisionBundleRead.response.status, 200, JSON.stringify(revisionBundleRead.body));
              const revisionBundle = revisionBundleRead.body.independent_verification_bundle;
              const revisionVerified = await runOfflineVerifier({ imageTag: verifierImage,
                imageDigest: verifierImageDigest, verificationBundle: revisionBundle,
                assignmentVerificationMaterial: replacementVerificationMaterial,
                label: "material-revision-replacement" });
              assert.equal(revisionVerified.status, 0, revisionVerified.stderr);
              assert.equal(revisionVerified.report.result, "verified",
                JSON.stringify(revisionVerified.report));
              assert.equal(revisionVerified.report.assignment_verification.assignment_id,
                replacementAssignment.assignment_id);
              assert.equal(revisionVerified.report.assignment_verification.state, "unclaimed");
              assertVerificationReportDigest(revisionVerified.report);

              const changedNotice = structuredClone(revisionBundle);
              changedNotice.bundle.published_outputs_to_compare.reevaluation_notice
                .notice_document.recommended_action = "notify_only";
              resealVerificationBundle(changedNotice);
              const rejectedNotice = await runOfflineVerifier({ imageTag: verifierImage,
                imageDigest: verifierImageDigest, verificationBundle: changedNotice,
                label: "revision-policy-decision" });
              assert.equal(rejectedNotice.status, 1, rejectedNotice.stderr);
              assert.equal(rejectedNotice.report.failure.code,
                "VERIFIER_EVIDENCE_REVISION_POLICY_MISMATCH");
              const substitutedAssignmentPolicy = structuredClone(revisionBundle);
              const substitutedPublished = substitutedAssignmentPolicy.bundle
                .published_outputs_to_compare;
              const substitutedActivation = substitutedPublished.assignment_policy_activation;
              const substitutedExport = substitutedPublished.assignment_policy_export;
              const substitutedDeploymentId = randomUUID();
              substitutedActivation.deployment_id = substitutedDeploymentId;
              substitutedActivation.activation_document.deployment_id = substitutedDeploymentId;
              substitutedActivation.activation_digest = sha256Digest(
                substitutedActivation.activation_document);
              substitutedExport.deployment_id = substitutedDeploymentId;
              substitutedPublished.reevaluation_notice.notice_document.policy.activation_digest =
                substitutedActivation.activation_digest;
              substitutedPublished.reevaluation_notice.notice_digest = sha256Digest(
                substitutedPublished.reevaluation_notice.notice_document);
              resealVerificationBundle(substitutedAssignmentPolicy);
              const rejectedAssignmentPolicy = await runOfflineVerifier({ imageTag: verifierImage,
                imageDigest: verifierImageDigest, verificationBundle: substitutedAssignmentPolicy,
                label: "revision-assignment-policy-scope" });
              assert.equal(rejectedAssignmentPolicy.status, 1, rejectedAssignmentPolicy.stderr);
              assert.equal(rejectedAssignmentPolicy.report.failure.code,
                "VERIFIER_ASSIGNMENT_POLICY_SCOPE_MISMATCH");
              const changedPredecessor = structuredClone(revisionBundle);
              changedPredecessor.bundle.independent_inputs.predecessor_verification.artifact
                .bundle.target.committed_intake_cutoff = "999999";
              resealVerificationBundle(changedPredecessor);
              const rejectedPredecessor = await runOfflineVerifier({ imageTag: verifierImage,
                imageDigest: verifierImageDigest, verificationBundle: changedPredecessor,
                label: "revision-predecessor-substitution" });
              assert.equal(rejectedPredecessor.status, 1, rejectedPredecessor.stderr);
              assert.equal(rejectedPredecessor.report.failure.code,
                "VERIFIER_REVISION_PREDECESSOR_BUNDLE_INVALID");

              const revisionDb = new pg.Client({ connectionString:
                "postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:45505/alphonse_diagnostic" });
              await revisionDb.connect();
              try {
                const counts = await revisionDb.query(
                  `SELECT
                    (SELECT COUNT(*)::int FROM diagnostic_cases
                      WHERE case_origin='deterministic_behavior_trigger') AS cases,
                    (SELECT COUNT(*)::int FROM diagnostic_behavior_triggers) AS triggers,
                    (SELECT COUNT(*)::int FROM diagnostic_evidence_packages) AS packages,
                    (SELECT COUNT(*)::int FROM diagnostic_reevaluation_notices) AS notices,
                    (SELECT COUNT(*)::int FROM diagnostic_assignment_replacements) AS replacements,
                    (SELECT COUNT(*)::int FROM diagnostic_assignments) AS assignments,
                    (SELECT COUNT(*)::int FROM diagnostic_diagnosis_requests) AS diagnosis_requests`
                );
                assert.equal(counts.rows[0].cases, 1);
                assert.equal(counts.rows[0].triggers, 1);
                assert.ok(counts.rows[0].packages >= 2);
                assert.ok(counts.rows[0].notices >= 1);
                assert.equal(counts.rows[0].replacements, 1);
                assert.equal(counts.rows[0].assignments, 2);
                assert.equal(counts.rows[0].diagnosis_requests, 0);
              } finally { await revisionDb.end(); }

              if (through14) {
                const materialDb = new pg.Client({ connectionString:
                  "postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:45505/alphonse_diagnostic" });
                await materialDb.connect();
                try {
                  const originalBundleRow = (await materialDb.query(
                    `SELECT b.bundle_artifact_digest,a.storage_key
                     FROM diagnostic_independent_verification_bundles b
                     JOIN diagnostic_artifacts a
                       ON a.installation_id=b.installation_id
                      AND a.artifact_digest=b.bundle_artifact_digest
                     WHERE b.installation_id=(SELECT installation_id FROM diagnostic_nodes LIMIT 1)
                       AND b.evidence_package_id=$1`,
                    [evidencePackage.evidence_package_id]
                  )).rows[0];
                  assert.ok(originalBundleRow, "original verification bundle material must exist");
                  const currentRootRow = (await materialDb.query(
                    `SELECT storage_key FROM diagnostic_artifacts
                     WHERE installation_id=(SELECT installation_id FROM diagnostic_nodes LIMIT 1)
                       AND artifact_digest=$1`, [successorPackage.package_artifact_digest]
                  )).rows[0];
                  assert.ok(currentRootRow, "current package root material must exist");
                  const originalRootRow = (await materialDb.query(
                    `SELECT storage_key FROM diagnostic_artifacts
                     WHERE installation_id=(SELECT installation_id FROM diagnostic_nodes LIMIT 1)
                       AND artifact_digest=$1`, [evidencePackage.package_artifact_digest]
                  )).rows[0];
                  assert.ok(originalRootRow, "original package root material must exist");
                  const localArtifactPath = (storageKey) => {
                    assert.match(storageKey, /^objects\/[0-9a-f]{2}\/[0-9a-f]{64}\.json$/u);
                    return `/var/lib/alphonse-diagnostics/${storageKey}`;
                  };

                  const holdId = randomUUID();
                  const holdCreatedAt = new Date().toISOString();
                  const holdDocument = {
                    schema_version: "alphonse.diagnostic-material-retention-hold.v0.1",
                    hold_id: holdId,
                    artifact_digest: evidencePackage.package_artifact_digest,
                    hold_class: "legal_hold",
                    source: { type: "ticket14_adversarial_proof", id: diagnosticCase.case_id },
                    expires_at: null,
                    created_by: "canonical-proof",
                    created_at: holdCreatedAt
                  };
                  await materialDb.query(
                    `INSERT INTO diagnostic_material_retention_holds
                      (hold_id,installation_id,environment_id,artifact_digest,hold_class,
                       source_type,source_id,expires_at,hold_document,hold_digest,created_by,created_at)
                     SELECT $1,n.installation_id,$2,$3,'legal_hold',$4,$5,NULL,$6,$7,$8,$9
                     FROM diagnostic_nodes n
                     LIMIT 1`,
                    [holdId, tokenBase.environment_id, evidencePackage.package_artifact_digest,
                      "ticket14_adversarial_proof", diagnosticCase.case_id, holdDocument,
                      sha256Digest(holdDocument), "canonical-proof", holdCreatedAt]
                  );
                  const heldDecisionId = randomUUID();
                  const held = await post("/diagnostic/v0/material-erasures", command(
                    "diagnostic.material_erasure.request", {
                      erasure_decision_id: heldDecisionId,
                      artifact_digest: evidencePackage.package_artifact_digest,
                      reason_code: "legal_requirement",
                      reason: "prove legal holds fail closed",
                      override_retention_classes: ["package_pin"]
                    }));
                  assert.equal(held.response.status, 409, JSON.stringify(held.body));
                  assert.equal(held.body.error.code, "DIAGNOSTIC_MATERIAL_LEGAL_HOLD_ACTIVE");
                  const heldDecisionCount = await materialDb.query(
                    "SELECT COUNT(*)::int AS count FROM diagnostic_material_erasure_decisions WHERE erasure_decision_id=$1",
                    [heldDecisionId]
                  );
                  assert.equal(heldDecisionCount.rows[0].count, 0);

                  const unexplainedPath = localArtifactPath(originalBundleRow.storage_key);
                  const unexplainedTemporaryPath = `/tmp/ticket14-unexplained-${process.pid}.json`;
                  compose("exec", "-T", "kernel", "mv", "--", unexplainedPath,
                    unexplainedTemporaryPath);
                  try {
                    const unexplained = await kernel(`/diagnostic/v0/evidence-packages/${
                      evidencePackage.evidence_package_id}/material-availability`);
                    assert.equal(unexplained.response.status, 200, JSON.stringify(unexplained.body));
                    assert.equal(unexplained.body.material_availability.integrity_status,
                      "integrity_violation");
                    assert.equal(unexplained.body.material_availability.execution_eligible, false);
                    assert.ok(unexplained.body.material_availability.failures.some((entry) =>
                      entry.artifact_digest === originalBundleRow.bundle_artifact_digest));
                  } finally {
                    compose("exec", "-T", "kernel", "mv", "--", unexplainedTemporaryPath,
                      unexplainedPath);
                  }
                  const restored = await kernel(`/diagnostic/v0/evidence-packages/${
                    evidencePackage.evidence_package_id}/material-availability`);
                  assert.equal(restored.response.status, 200, JSON.stringify(restored.body));
                  assert.equal(restored.body.material_availability.integrity_status, "verified_present");
                  assert.equal(restored.body.material_availability.material_status, "complete");

                  const recoveryDecisionId = randomUUID();
                  const recoveryRequest = await post("/diagnostic/v0/material-erasures", command(
                    "diagnostic.material_erasure.request", {
                      erasure_decision_id: recoveryDecisionId,
                      artifact_digest: originalBundleRow.bundle_artifact_digest,
                      reason_code: "security_response",
                      reason: "prove deletion recovery after bytes disappear before commit",
                      override_retention_classes: []
                    }));
                  assert.equal(recoveryRequest.response.status, 201,
                    JSON.stringify(recoveryRequest.body));
                  assert.equal(recoveryRequest.body.material_erasure.material_state,
                    "revoked_pending_deletion");
                  const recoveryTemporaryPath = `/tmp/ticket14-recovery-${process.pid}.json`;
                  compose("exec", "-T", "kernel", "mv", "--", unexplainedPath,
                    recoveryTemporaryPath);
                  const recovered = await post(`/diagnostic/v0/material-erasures/${
                    recoveryDecisionId}/complete`, command("diagnostic.material_erasure.complete", {
                    erasure_decision_id: recoveryDecisionId
                  }));
                  assert.equal(recovered.response.status, 201, JSON.stringify(recovered.body));
                  assert.equal(recovered.body.material_erasure.material_state, "deleted_verified");
                  assert.equal(recovered.body.material_erasure.deletion_attempt.outcome,
                    "already_absent");
                  assert.equal(recovered.body.material_erasure.universal_deletion_established, false);

                  const installationRow = (await materialDb.query(
                    "SELECT installation_id FROM diagnostic_nodes LIMIT 1"
                  )).rows[0];
                  const materialLockKey = `diagnostic-material-mutation:${installationRow.installation_id}`;
                  await materialDb.query("BEGIN");
                  await materialDb.query(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [materialLockKey]
                  );
                  let revisionSettled = false;
                  const fencedRevisionPromise = post("/diagnostic/v0/evidence-revisions/process", {
                    case_id: diagnosticCase.case_id
                  }).then((value) => { revisionSettled = true; return value; });
                  await new Promise((resolve) => setTimeout(resolve, 250));
                  assert.equal(revisionSettled, false,
                    "evidence revision must wait on the material mutation fence");
                  await materialDb.query("ROLLBACK");
                  const fencedRevision = await fencedRevisionPromise;
                  assert.ok([200, 201].includes(fencedRevision.response.status),
                    JSON.stringify(fencedRevision.body));

                  const currentDecisionId = randomUUID();
                  const retentionBlocked = await post("/diagnostic/v0/material-erasures", command(
                    "diagnostic.material_erasure.request", {
                      erasure_decision_id: randomUUID(),
                      artifact_digest: successorPackage.package_artifact_digest,
                      reason_code: "privacy_request",
                      reason: "prove active package pins require explicit authority",
                      override_retention_classes: []
                    }));
                  assert.equal(retentionBlocked.response.status, 409,
                    JSON.stringify(retentionBlocked.body));
                  assert.equal(retentionBlocked.body.error.code,
                    "DIAGNOSTIC_MATERIAL_RETENTION_OVERRIDE_REQUIRED");
                  const erasureRequestCommand = command("diagnostic.material_erasure.request", {
                    erasure_decision_id: currentDecisionId,
                    artifact_digest: successorPackage.package_artifact_digest,
                    reason_code: "privacy_request",
                    reason: "remove current customer evidence under explicit retention override",
                    override_retention_classes: ["package_pin"]
                  });
                  await materialDb.query("BEGIN");
                  await materialDb.query(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [materialLockKey]
                  );
                  let erasureSettled = false;
                  const markedPromise = post("/diagnostic/v0/material-erasures", erasureRequestCommand)
                    .then((value) => { erasureSettled = true; return value; });
                  await new Promise((resolve) => setTimeout(resolve, 250));
                  assert.equal(erasureSettled, false,
                    "erasure must wait on the same material mutation fence");
                  await materialDb.query("ROLLBACK");
                  const marked = await markedPromise;
                  assert.equal(marked.response.status, 201, JSON.stringify(marked.body));
                  assert.equal(marked.body.material_erasure.material_state,
                    "revoked_pending_deletion");
                  assert.equal(marked.body.material_erasure.physical_deletion, "pending");
                  assert.equal(marked.body.material_erasure.universal_deletion_established, false);
                  assert.ok(marked.body.material_erasure.assignment_invalidations.some((entry) =>
                    entry.assignment_id === replacementAssignment.assignment_id
                    && entry.action === "expired_unclaimed"));
                  const currentRootPath = localArtifactPath(currentRootRow.storage_key);
                  compose("exec", "-T", "kernel", "test", "-f", currentRootPath);

                  const pendingArtifact = await kernel(`/diagnostic/v0/artifacts/${
                    encodeURIComponent(successorPackage.package_artifact_digest)}`);
                  assert.equal(pendingArtifact.response.status, 200,
                    JSON.stringify(pendingArtifact.body));
                  assert.equal(pendingArtifact.body.artifact.content, null);
                  assert.equal(pendingArtifact.body.artifact.retention_state,
                    "revoked_pending_deletion");
                  assert.equal(pendingArtifact.body.artifact.verified, false);
                  const unavailable = await kernel(`/diagnostic/v0/evidence-packages/${
                    successorPackage.evidence_package_id}/material-availability`);
                  assert.equal(unavailable.response.status, 200, JSON.stringify(unavailable.body));
                  assert.equal(unavailable.body.material_availability.material_status,
                    "material_unavailable");
                  assert.equal(unavailable.body.material_availability.execution_eligible, false);
                  assert.equal(unavailable.body.material_availability.integrity_status,
                    "verified_governed_erasure");
                  assert.equal(unavailable.body.material_availability.temporal_claim,
                    "current_material_availability_not_historical_package_identity");
                  const expiredForErasure = await kernel(
                    `/diagnostic/v0/assignments/${replacementAssignment.assignment_id}`);
                  assert.equal(expiredForErasure.response.status, 200,
                    JSON.stringify(expiredForErasure.body));
                  assert.equal(expiredForErasure.body.diagnostic_assignment.state.current, "expired");
                  const blockedVerifier = await kernel(
                    `/diagnostic/v0/independent-verification-bundles/${successorPackage.evidence_package_id}`);
                  assert.equal(blockedVerifier.response.status, 409,
                    JSON.stringify(blockedVerifier.body));
                  assert.equal(blockedVerifier.body.error.code,
                    "DIAGNOSTIC_EVIDENCE_PACKAGE_MATERIAL_UNAVAILABLE");
                  const blockedRevision = await post("/diagnostic/v0/evidence-revisions/process", {
                    case_id: diagnosticCase.case_id
                  });
                  assert.equal(blockedRevision.response.status, 409,
                    JSON.stringify(blockedRevision.body));
                  assert.equal(blockedRevision.body.error.code,
                    "DIAGNOSTIC_EVIDENCE_PACKAGE_MATERIAL_UNAVAILABLE");

                  const completionCommand = command("diagnostic.material_erasure.complete", {
                    erasure_decision_id: currentDecisionId
                  });
                  const completed = await post(`/diagnostic/v0/material-erasures/${
                    currentDecisionId}/complete`, completionCommand);
                  assert.equal(completed.response.status, 201, JSON.stringify(completed.body));
                  assert.equal(completed.body.material_erasure.material_state, "deleted_verified");
                  assert.equal(completed.body.material_erasure.deletion_attempt.outcome, "deleted");
                  assert.equal(completed.body.material_erasure.tombstone.document
                    .universal_deletion_established, false);
                  compose("exec", "-T", "kernel", "test", "!", "-e", currentRootPath);
                  const replayedCompletion = await post(`/diagnostic/v0/material-erasures/${
                    currentDecisionId}/complete`, completionCommand);
                  assert.equal(replayedCompletion.response.status, 200,
                    JSON.stringify(replayedCompletion.body));
                  assert.equal(replayedCompletion.response.headers.get("idempotent-replayed"), "true");
                  assert.equal(replayedCompletion.body.material_erasure.deletion_attempt
                    .deletion_attempt_id, completed.body.material_erasure.deletion_attempt
                    .deletion_attempt_id);
                  const finalErasure = await kernel(
                    `/diagnostic/v0/material-erasures/${currentDecisionId}`);
                  assert.equal(finalErasure.response.status, 200, JSON.stringify(finalErasure.body));
                  assert.equal(finalErasure.body.material_erasure.material_state, "deleted_verified");
                  assert.equal(finalErasure.body.material_erasure.deletion_attempts.length, 1);
                  assert.ok(finalErasure.body.material_erasure.tombstone);
                  const historicalPackage = await kernel(
                    `/diagnostic/v0/evidence-packages/${successorPackage.evidence_package_id}`);
                  assert.equal(historicalPackage.response.status, 200,
                    JSON.stringify(historicalPackage.body));
                  assert.equal(historicalPackage.body.evidence_package.evidence_package_id,
                    successorPackage.evidence_package_id);
                  assert.equal(historicalPackage.body.evidence_package.material_availability
                    .material_status, "material_unavailable");

                  const counts = await materialDb.query(
                    `SELECT
                      (SELECT COUNT(*)::int FROM diagnostic_material_erasure_decisions) AS decisions,
                      (SELECT COUNT(*)::int FROM diagnostic_artifact_erasure_tombstones) AS tombstones,
                      (SELECT COUNT(*)::int FROM diagnostic_material_deletion_attempts) AS attempts,
                      (SELECT COUNT(*)::int FROM diagnostic_assignment_material_invalidations) AS invalidations,
                      (SELECT COUNT(*)::int FROM diagnostic_diagnosis_requests) AS diagnosis_requests`
                  );
                  assert.deepEqual(counts.rows[0], {
                    decisions: 2, tombstones: 2, attempts: 2,
                    invalidations: 2, diagnosis_requests: 0
                  });
                  materialErasure = {
                    erasure_decision_id: currentDecisionId,
                    material_state: finalErasure.body.material_erasure.material_state,
                    package_material_status:
                      unavailable.body.material_availability.material_status,
                    assignment_state: expiredForErasure.body.diagnostic_assignment.state.current,
                    recovery_outcome: recovered.body.material_erasure.deletion_attempt.outcome,
                    universal_deletion_established: false,
                    legal_hold_failed_closed: true,
                    unexplained_missing_material_detected: true,
                    adversarial_cases: 12
                  };
                } finally { await materialDb.end(); }
              }
            }
            independentVerification = { verifierImageDigest, report: valid.report,
              adversarial_cases: through13 ? 16 : through12 ? 13 : 9,
              physical_reorder_verified: true };
          }
        }
        if (through15) {
          assert.ok(diagnosticAssignment, "Ticket 15 requires the exact Test 1 Assignment");
          assert.equal(diagnosticAssignment.state.current, "unclaimed");
          const requirements = diagnosticAssignment.assignment.work_requirements;
          const model = {
            provider: "openai",
            model: "frontier-diagnostic",
            version: "pinned-v1",
            capability_class: requirements.model.capability_class
          };
          const broker = {
            broker_id: "model-broker:customer-local",
            policy_id: "broker-policy:canonical-diagnostic",
            policy_version: "0.1.0",
            audience: "diagnostic-model-broker:v0.1",
            max_requests: 1,
            max_input_units: 20000,
            max_output_units: 4000,
            access_delivery: "after_claim_only"
          };
          const dataPolicy = {
            classification: requirements.data_classification,
            residency: "customer_controlled_installation",
            evidence_scope: requirements.disclosure.evidence_scope,
            provider_training: requirements.disclosure.provider_training
          };
          const egressPolicy = {
            mode: requirements.network.mode,
            general_egress: false,
            allowed_destination_audience: broker.audience
          };
          const runtime = {
            kind: requirements.runtime.kind,
            image: {
              reference: `local/alphonse-diagnostic-worker@sha256:${"a".repeat(64)}`,
              digest: `sha256:${"a".repeat(64)}`
            },
            runner: {
              runner_id: "diagnostic-runner:canonical",
              runner_version: "0.1.0",
              audience: "diagnostic-runner:v0.1"
            },
            isolation: structuredClone(requirements.isolation),
            mounts: structuredClone(requirements.mounts),
            network: structuredClone(requirements.network)
          };
          const passportRuntime = { ...structuredClone(runtime),
            resources: structuredClone(requirements.resources) };
          const passportModel = { ...structuredClone(model), broker: structuredClone(broker) };
          const passportProfile = {
            diagnostic_worker_profile: {
              schema_version: "alphonse.diagnostic-worker-passport-profile.v0.1",
              passport_class: requirements.required_passport_class,
              capabilities: structuredClone(requirements.required_worker_capabilities),
              prohibitions: structuredClone(requirements.prohibitions),
              data_policy: structuredClone(dataPolicy),
              egress_policy: structuredClone(egressPolicy)
            }
          };

          const kernelDb = new pg.Client({ connectionString:
            "postgresql://alphonse:local-development-only@127.0.0.1:45505/alphonse_kernel" });
          await kernelDb.connect();
          let sponsorPrincipalId;
          try {
            sponsorPrincipalId = (await kernelDb.query(
              "SELECT principal_id FROM kernel_principals WHERE principal_type='human' LIMIT 1"
            )).rows[0].principal_id;
          } finally { await kernelDb.end(); }
          const workerPrincipal = await post("/kernel/v0/principals", command(
            "kernel.principal.create", {
              principal_type: "agent",
              display_name: "Canonical Diagnostic Interpreter"
            }));
          assert.equal(workerPrincipal.response.status, 201, JSON.stringify(workerPrincipal.body));
          const now = Date.now();
          const assignmentExpiry = Date.parse(diagnosticAssignment.assignment.temporal.expires_at);
          const passportExpiry = Math.min(assignmentExpiry, now + 30 * 60_000);
          const runExpiry = Math.min(passportExpiry, now + 15 * 60_000);
          assert.ok(runExpiry > now + 5 * 60_000,
            "Assignment must leave enough time for short-lived dispatch proof");
          const workerPassport = await post("/kernel/v0/agent-passports", command(
            "kernel.agent_passport.issue", {
              agent_principal_id: workerPrincipal.body.principal.principal_id,
              sponsor_principal_id: sponsorPrincipalId,
              runtime: passportRuntime,
              model_configuration: passportModel,
              package_skill_configuration: passportProfile,
              agent_authentication_token:
                "canonical-diagnostic-worker-passport-token-ticket-15-0001",
              permitted_intent_classes: ["diagnostic_analysis"],
              provenance: { source: "canonical-diagnostic-proof-ticket-15" },
              valid_from: new Date(now - 60_000).toISOString(),
              expires_at: new Date(passportExpiry).toISOString()
            }));
          assert.equal(workerPassport.response.status, 201, JSON.stringify(workerPassport.body));
          const passport = workerPassport.body.passport;
          const assignmentBinding = {
            assignment_id: diagnosticAssignment.assignment_id,
            assignment_digest: diagnosticAssignment.assignment_digest,
            evidence_package_id: diagnosticAssignment.evidence_package_id,
            evidence_package_semantic_digest:
              diagnosticAssignment.assignment.evidence_package.semantic_digest,
            evidence_package_artifact_digest:
              diagnosticAssignment.assignment.evidence_package.package_artifact_digest,
            assignment_policy_activation_id:
              diagnosticAssignment.assignment_policy_activation_id,
            assignment_policy_activation_digest:
              diagnosticAssignment.assignment.assignment_policy.activation_digest
          };
          const candidateBase = {
            schema_version: "alphonse.diagnostic-dispatch-candidate.v0.1",
            assignment: assignmentBinding,
            worker: {
              principal_id: passport.agent_principal_id,
              passport_id: passport.passport_id,
              passport_configuration_digest: passport.configuration_digest,
              passport_class: requirements.required_passport_class
            },
            runtime,
            model,
            broker,
            resources: structuredClone(requirements.resources),
            data_policy: dataPolicy,
            egress_policy: egressPolicy,
            dispatcher_audience: "diagnostic-dispatcher:v0.1",
            authorization_expires_at: new Date(now + 3 * 60_000).toISOString()
          };
          const invalidAudience = await post("/kernel/v0/diagnostic-dispatch-authorizations",
            command("kernel.diagnostic_dispatch.authorize", {
              candidate: { ...structuredClone(candidateBase),
                worker_run: { worker_run_id: randomUUID(),
                  expires_at: new Date(runExpiry).toISOString() },
                dispatcher_audience: "diagnostic-dispatcher:untrusted" }
            }));
          assert.equal(invalidAudience.response.status, 409, JSON.stringify(invalidAudience.body));
          assert.equal(invalidAudience.body.error.code, "DIAGNOSTIC_DISPATCH_AUDIENCE_MISMATCH");

          const authorize = async () => post("/kernel/v0/diagnostic-dispatch-authorizations",
            command("kernel.diagnostic_dispatch.authorize", {
              candidate: { ...structuredClone(candidateBase),
                worker_run: { worker_run_id: randomUUID(),
                  expires_at: new Date(runExpiry).toISOString() } }
            }));
          const authorizationResults = [await authorize(), await authorize()];
          for (const authorized of authorizationResults) {
            assert.equal(authorized.response.status, 201, JSON.stringify(authorized.body));
            const value = authorized.body.diagnostic_dispatch_authorization;
            assert.equal(value.issuance_state, "issued");
            assert.equal(value.consumption_state, "diagnostic_plane_owned_not_mirrored");
            assert.equal(value.authority.external_business_effects, "none");
            assert.equal(value.authority.broker_token, "not_created");
            assert.equal(value.authority.container_launch, "not_performed");
            const read = await kernel(`/kernel/v0/diagnostic-dispatch-authorizations/${
              value.dispatch_authorization_id}`);
            assert.equal(read.response.status, 200, JSON.stringify(read.body));
            assert.equal(read.body.diagnostic_dispatch_authorization.authorization_digest,
              value.authorization_digest);
          }

          const firstSigned = authorizationResults[0].body
            .diagnostic_dispatch_authorization.signed_authorization;
          const tamperedSigned = structuredClone(firstSigned);
          const finalCharacter = tamperedSigned.signature.at(-1);
          tamperedSigned.signature = `${tamperedSigned.signature.slice(0, -1)}${
            finalCharacter === "0" ? "1" : "0"}`;
          const tamperedClaim = await post(`/diagnostic/v0/assignments/${
            diagnosticAssignment.assignment_id}/claim`, command("diagnostic.assignment.claim", {
            assignment_id: diagnosticAssignment.assignment_id,
            signed_authorization: tamperedSigned
          }));
          assert.equal(tamperedClaim.response.status, 403, JSON.stringify(tamperedClaim.body));
          assert.equal(tamperedClaim.body.error.code,
            "DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID");

          const claimCommands = authorizationResults.map((authorized) => command(
            "diagnostic.assignment.claim", {
              assignment_id: diagnosticAssignment.assignment_id,
              signed_authorization:
                authorized.body.diagnostic_dispatch_authorization.signed_authorization
            }));
          const materialDb = new pg.Client({ connectionString:
            "postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:45505/alphonse_diagnostic" });
          await materialDb.connect();
          let claimResults;
          try {
            const installation = (await materialDb.query(
              "SELECT installation_id FROM diagnostic_nodes LIMIT 1"
            )).rows[0].installation_id;
            await materialDb.query("BEGIN");
            await materialDb.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [`diagnostic-material-mutation:${installation}`]
            );
            let settledClaims = 0;
            const pendingClaims = claimCommands.map((claimCommand) => post(
              `/diagnostic/v0/assignments/${diagnosticAssignment.assignment_id}/claim`,
              claimCommand).then((value) => { settledClaims += 1; return value; }));
            await new Promise((resolve) => setTimeout(resolve, 250));
            assert.equal(settledClaims, 0,
              "assignment claim must wait on the material mutation fence");
            await materialDb.query("ROLLBACK");
            claimResults = await Promise.all(pendingClaims);
          } finally {
            await materialDb.query("ROLLBACK").catch(() => {});
            await materialDb.end();
          }
          const winningIndex = claimResults.findIndex((result) => result.response.status === 201);
          const losingIndex = winningIndex === 0 ? 1 : 0;
          assert.notEqual(winningIndex, -1, JSON.stringify(claimResults.map((item) => item.body)));
          assert.equal(claimResults.filter((result) => result.response.status === 201).length, 1);
          assert.equal(claimResults[losingIndex].response.status, 409,
            JSON.stringify(claimResults[losingIndex].body));
          assert.equal(claimResults[losingIndex].body.error.code,
            "DIAGNOSTIC_ASSIGNMENT_CLAIM_CONFLICT");
          const winningClaim = claimResults[winningIndex].body.diagnostic_assignment_claim;
          assert.equal(winningClaim.assignment.state, "claimed");
          assert.equal(winningClaim.worker_run.state.current, "claimed_not_launched");
          assert.equal(winningClaim.container_created, false);
          assert.equal(winningClaim.broker_token_created, false);
          assert.equal(winningClaim.provider_request_created, false);
          assert.equal(winningClaim.model_request_created, false);
          assert.equal(winningClaim.diagnosis_created, false);

          const replayedClaim = await post(`/diagnostic/v0/assignments/${
            diagnosticAssignment.assignment_id}/claim`, claimCommands[winningIndex]);
          assert.equal(replayedClaim.response.status, 200, JSON.stringify(replayedClaim.body));
          assert.equal(replayedClaim.response.headers.get("idempotent-replayed"), "true");
          assert.equal(replayedClaim.body.diagnostic_assignment_claim.worker_run.worker_run_id,
            winningClaim.worker_run.worker_run_id);
          const staleClaim = await post(`/diagnostic/v0/assignments/${
            diagnosticAssignment.assignment_id}/claim`, command("diagnostic.assignment.claim", {
            assignment_id: diagnosticAssignment.assignment_id,
            signed_authorization: authorizationResults[losingIndex].body
              .diagnostic_dispatch_authorization.signed_authorization
          }));
          assert.equal(staleClaim.response.status, 409, JSON.stringify(staleClaim.body));
          assert.equal(staleClaim.body.error.code, "DIAGNOSTIC_ASSIGNMENT_CLAIM_CONFLICT");

          const [claimedAssignment, workerRun] = await Promise.all([
            kernel(`/diagnostic/v0/assignments/${diagnosticAssignment.assignment_id}`),
            kernel(`/diagnostic/v0/worker-runs/${winningClaim.worker_run.worker_run_id}`)
          ]);
          assert.equal(claimedAssignment.response.status, 200, JSON.stringify(claimedAssignment.body));
          assert.equal(claimedAssignment.body.diagnostic_assignment.state.current, "claimed");
          assert.equal(claimedAssignment.body.diagnostic_assignment.state.revision, "1");
          assert.equal(workerRun.response.status, 200, JSON.stringify(workerRun.body));
          assert.equal(workerRun.body.diagnostic_worker_run.state.current, "claimed_not_launched");
          assert.equal(workerRun.body.diagnostic_worker_run.launch_state, "not_launched");
          assert.equal(workerRun.body.diagnostic_worker_run.broker_token_created, false);

          const diagnosticDb = new pg.Client({ connectionString:
            "postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:45505/alphonse_diagnostic" });
          await diagnosticDb.connect();
          try {
            const counts = (await diagnosticDb.query(
              `SELECT
                (SELECT COUNT(*)::int FROM diagnostic_dispatch_authorization_consumptions) AS consumptions,
                (SELECT COUNT(*)::int FROM diagnostic_worker_runs) AS worker_runs,
                (SELECT COUNT(*)::int FROM diagnostic_diagnosis_requests) AS diagnosis_requests`
            )).rows[0];
            assert.deepEqual(counts, { consumptions: 1, worker_runs: 1, diagnosis_requests: 0 });
            await assert.rejects(diagnosticDb.query(
              "UPDATE diagnostic_dispatch_authorization_consumptions SET consumed_by_id='tampered' WHERE dispatch_authorization_id=$1",
              [winningClaim.dispatch_authorization_id]), /immutable records cannot be updated/u);
            await assert.rejects(diagnosticDb.query(
              "UPDATE diagnostic_assignment_states SET state='unclaimed',state_revision=2 WHERE assignment_id=$1",
              [diagnosticAssignment.assignment_id]), /assignment state transition is invalid/u);
          } finally { await diagnosticDb.end(); }
          const authorityDb = new pg.Client({ connectionString:
            "postgresql://alphonse:local-development-only@127.0.0.1:45505/alphonse_kernel" });
          await authorityDb.connect();
          try {
            const count = (await authorityDb.query(
              "SELECT COUNT(*)::int AS authorizations FROM kernel_diagnostic_dispatch_authorizations"
            )).rows[0];
            assert.deepEqual(count, { authorizations: 2 });
            await assert.rejects(authorityDb.query(
              "UPDATE kernel_diagnostic_dispatch_authorizations SET dispatcher_audience='tampered' WHERE dispatch_authorization_id=$1",
              [winningClaim.dispatch_authorization_id]),
            /immutable Kernel record cannot be updated/u);
          } finally { await authorityDb.end(); }

          diagnosticAssignment = claimedAssignment.body.diagnostic_assignment;
          dispatchClaim = {
            dispatch_authorization_id: winningClaim.dispatch_authorization_id,
            authorization_digest: winningClaim.authorization_digest,
            worker_run_id: winningClaim.worker_run.worker_run_id,
            assignment_state: diagnosticAssignment.state.current,
            worker_run_state: workerRun.body.diagnostic_worker_run.state.current,
            material_fence_observed: true,
            competing_claim_rejected: true,
            replay_idempotent: true,
            authority_rows: 2,
            consumption_rows: 1,
            model_requests: 0,
            adversarial_cases: 8
          };
        }
        interpretation = { activation, evidencePolicyActivation, assignmentPolicyActivation,
          effectProjection, evaluation, trigger, diagnosticCase, finalCollection, evidencePackage,
          diagnosticAssignment, assignmentVerificationMaterial, evidenceRevision,
          replacementAssignment, replacementVerificationMaterial, lateObservationCounts,
          independentVerification, materialErasure, dispatchClaim };
      }
    }
    extendedResult = { runtime, requests, ledger, correlation, interpretation };
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
    schema_version: "0.1.0", ticket: through15 ? "canonical-diagnostic-proof-15"
      : through14 ? "canonical-diagnostic-proof-14"
      : through13 ? "canonical-diagnostic-proof-13"
      : through12 ? "canonical-diagnostic-proof-12"
      : through11 ? "canonical-diagnostic-proof-11"
      : through10 ? "canonical-diagnostic-proof-10"
      : through09 ? "canonical-diagnostic-proof-09"
      : through08 ? "canonical-diagnostic-proof-08"
      : through07 ? "canonical-diagnostic-proof-06-07" : "canonical-diagnostic-proof-05",
    status: "passed", completed_capability: through15
      ? "signed_single_use_diagnostic_dispatch_and_atomic_claim"
      : through14 ? "revoked_visible_and_verifiably_erased_material"
      : through13 ? "material_evidence_revision_and_bounded_reassignment"
      : through12 ? "model_free_unclaimed_diagnostic_assignment"
      : through11 ? "independently_recomputed_diagnostic_lineage"
      : through10 ? "frozen_content_addressed_evidence_package"
      : through09 ? "deterministic_committed_effect_violation_case"
      : through08 ? "immutable_cross_stream_correlation_projection"
      : through07 ? "bound_runtime_and_separate_crm_observation" : "journaled_duplicate_ingress_observation",
    proven: ["journal_before_forward", "stable_opaque_logical_operation", "distinct_delivery_attempts",
      "independent_forward_and_report_loops", "n8n_context_propagation", "diagnostic_outage_decoupled",
      "tokenization_receipts_cited", "stimulus_has_no_reporting_authority", "accepted_report_replay_recovery",
      "restart_idempotency", "raw_payload_scrubbed", "visible_backlog_and_loss_state",
      ...(through07 ? ["live_runtime_identity_verified", "retained_execution_detail_verified",
        "registered_revision_material_verified", "runtime_binding_grant_readiness_bound",
        "changed_key_replay_failed_closed", "destination_cannot_write_request_journal"] : []),
      ...(through08 ? ["stable_committed_cutoff_lock", "complete_intake_manifest_frozen",
        "exact_projection_dependencies_frozen", "canonical_graph_replay_digest",
        "typed_claim_locations_preserved", "scoped_token_equality_and_inequality",
        "canonical_envelope_authority_verified", "signed_token_provenance_reverified",
        "transitive_projector_artifact_frozen", "normalized_projector_input_frozen",
        "stored_corruption_not_nondeterminism", "immutable_projection_record"] : []),
      ...(through09 ? ["closed_interpretation_contracts_activated",
        "designated_commit_feed_interpreted", "raw_observations_excluded_from_evaluator",
        "two_committed_effects_counted", "behavior_invariant_violated",
        "deterministic_trigger_and_case", "temporal_claim_envelopes",
        "root_cause_not_established", "no_repair_or_effect_authority",
        "stored_effect_corruption_not_replay"] : []),
      ...(through10 ? ["cumulative_retention_formulas_validated",
        "trigger_transactional_collection_lease", "durable_collection_scheduler_state",
        "matched_effect_typed_ancestor_selection", "complete_disclosure_accounting",
        "authenticated_provenance_dependencies_selected", "content_addressed_worker_package",
        "collection_lease_replaced_by_retention_pins", "immutable_package_exact_replay",
        "stored_package_corruption_not_replay", "no_assignment_dispatch_worker_or_model"] : []),
      ...(through11 ? ["complete_prefix_independently_recomputed",
        "exact_stage_source_archives_verified_without_execution",
        "offline_verifier_image_identity_reported", "networkless_read_only_verifier",
        "tokenization_ed25519_independently_verified", "hmac_assurance_ceiling_explicit",
        "full_lineage_through_package_pins_and_release_recomputed",
        "physical_row_order_independent", "resealed_tampering_failed_closed",
        "verification_created_no_authority_effects"] : []),
      ...(through12 ? ["assignment_policy_pinned_before_delivery",
        "mutable_outbox_not_semantic_authority", "durable_assignment_inbox_and_stage_record",
        "deterministic_assignment_identity", "immutable_assignment_facts",
        "separate_fenced_unclaimed_state", "frozen_event_time_controls_expiry",
        "answer_free_neutral_worker_contract", "assignment_created_before_verifier_run",
        "assignment_independently_recomputed", "no_dispatch_worker_model_or_execution_authority"] : []),
      ...(through13 ? ["committed_prefix_drives_revision_monitor",
        "case_relevant_material_digest", "nonmaterial_and_material_changes_separated",
        "same_pinned_activations_reused", "immutable_evidence_package_revision",
        "reevaluation_notice_preserves_temporal_cutoffs", "one_trigger_and_case_preserved",
        "unclaimed_assignment_replaced_by_exact_policy", "claimed_or_terminal_replacement_forbidden",
        "complete_assignment_state_history_verified", "revision_chain_independently_recomputed",
        "no_worker_model_diagnosis_repair_or_execution_authority"] : []),
      ...(through14 ? ["material_access_revoked_before_physical_deletion",
        "retention_pin_requires_explicit_override", "legal_hold_failed_closed",
        "unexplained_missing_material_is_integrity_violation",
        "package_history_retained_separate_from_current_availability",
        "package_revision_and_erasure_share_material_fence",
        "unclaimed_assignment_expired_on_material_revocation",
        "new_verification_and_revision_authority_blocked",
        "crash_after_byte_loss_recovers_as_already_absent",
        "local_cas_deletion_verified_by_tombstone", "deletion_completion_is_idempotent",
        "universal_deletion_not_established"] : []),
      ...(through15 ? ["exact_dispatch_candidate_kernel_validated",
        "active_closed_worker_passport_bound", "signed_short_lived_audience_bound_authorization",
        "kernel_issuance_does_not_claim_cross_plane_consumption",
        "diagnostic_plane_atomic_single_use_consumption", "material_fence_blocks_claim",
        "one_competing_claimant_wins", "claimed_worker_run_not_launched",
        "no_container_broker_token_provider_request_model_request_or_diagnosis",
        "claim_replay_is_idempotent", "immutable_authority_and_consumption_records"] : [])],
    mapping_count: final.mapping_count, delivery_count: final.delivery_count,
    observation_replay_count: final.observation_replay_count,
    runtime_observation_count: extendedResult?.runtime.reported_count ?? 0,
    crm_request_observation_count:
      extendedResult?.interpretation?.lateObservationCounts?.requests
        ?? extendedResult?.requests.reported_count ?? 0,
    crm_effect_observation_count:
      extendedResult?.interpretation?.lateObservationCounts?.effects
        ?? extendedResult?.ledger.reported_count ?? 0,
    correlation_projection_count: extendedResult?.correlation ? 1 : 0,
    correlation_semantic_digest: extendedResult?.correlation?.projection.semantic_digest ?? null,
    diagnostic_effect_projection_count: extendedResult?.interpretation ? 1 : 0,
    committed_effect_count: extendedResult?.interpretation?.effectProjection.semantic_projection.effects
      .filter((effect) => effect.status === "committed").length ?? 0,
    behavior_evaluation_result: extendedResult?.interpretation?.evaluation.semantic_evaluation.result ?? null,
    deterministic_case_count: extendedResult?.interpretation ? 1 : 0,
    evidence_collection_lease_count: extendedResult?.interpretation?.finalCollection ? 1 : 0,
    evidence_package_count: extendedResult?.interpretation?.evidenceRevision
      ? Number(extendedResult.interpretation.evidenceRevision.current_package_revision_number)
      : extendedResult?.interpretation?.evidencePackage ? 1 : 0,
    evidence_package_semantic_digest:
      extendedResult?.interpretation?.evidencePackage?.semantic_digest ?? null,
    evidence_package_artifact_digest:
      extendedResult?.interpretation?.evidencePackage?.package_artifact_digest ?? null,
    independent_verification_result:
      extendedResult?.interpretation?.independentVerification?.report.result ?? null,
    independent_verification_report_digest:
      extendedResult?.interpretation?.independentVerification?.report.report_digest ?? null,
    independent_verifier_image_digest:
      extendedResult?.interpretation?.independentVerification?.verifierImageDigest ?? null,
    independent_verification_adversarial_cases:
      extendedResult?.interpretation?.independentVerification?.adversarial_cases ?? 0,
    diagnostic_assignment_count:
      extendedResult?.interpretation?.diagnosticAssignment ? 1 : 0,
    diagnostic_assignment_id:
      extendedResult?.interpretation?.diagnosticAssignment?.assignment_id ?? null,
    diagnostic_assignment_digest:
      extendedResult?.interpretation?.diagnosticAssignment?.assignment_digest ?? null,
    diagnostic_assignment_state:
      extendedResult?.interpretation?.diagnosticAssignment?.state.current ?? null,
    evidence_revision_status:
      extendedResult?.interpretation?.evidenceRevision?.latest_assessment.outcome ?? null,
    evidence_revision_material_change_classes:
      extendedResult?.interpretation?.evidenceRevision?.latest_assessment.material_change_classes ?? [],
    replacement_assignment_id:
      extendedResult?.interpretation?.replacementAssignment?.assignment_id ?? null,
    replacement_assignment_state:
      extendedResult?.interpretation?.replacementAssignment?.state.current ?? null,
    material_erasure_state:
      extendedResult?.interpretation?.materialErasure?.material_state ?? null,
    evidence_package_material_status:
      extendedResult?.interpretation?.materialErasure?.package_material_status ?? null,
    material_erasure_assignment_state:
      extendedResult?.interpretation?.materialErasure?.assignment_state ?? null,
    material_erasure_recovery_outcome:
      extendedResult?.interpretation?.materialErasure?.recovery_outcome ?? null,
    material_erasure_adversarial_cases:
      extendedResult?.interpretation?.materialErasure?.adversarial_cases ?? 0,
    universal_deletion_established:
      extendedResult?.interpretation?.materialErasure?.universal_deletion_established ?? null,
    dispatch_authorization_id:
      extendedResult?.interpretation?.dispatchClaim?.dispatch_authorization_id ?? null,
    dispatch_authorization_digest:
      extendedResult?.interpretation?.dispatchClaim?.authorization_digest ?? null,
    diagnostic_worker_run_id:
      extendedResult?.interpretation?.dispatchClaim?.worker_run_id ?? null,
    diagnostic_worker_run_state:
      extendedResult?.interpretation?.dispatchClaim?.worker_run_state ?? null,
    diagnostic_dispatch_authority_rows:
      extendedResult?.interpretation?.dispatchClaim?.authority_rows ?? 0,
    diagnostic_dispatch_consumption_rows:
      extendedResult?.interpretation?.dispatchClaim?.consumption_rows ?? 0,
    diagnostic_dispatch_adversarial_cases:
      extendedResult?.interpretation?.dispatchClaim?.adversarial_cases ?? 0,
    model_requests: 0, worker_run_created: Boolean(extendedResult?.interpretation?.dispatchClaim)
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`\n--- Ticket 05 service logs ---\n${compose("logs", "--no-color",
    "customer-ingress-api", "customer-ingress-forwarder", "customer-ingress-reporter", "canonical-n8n",
    "n8n-runtime-observer", "crm-request-observer", "crm-ledger-observer", "mock-crm", "kernel", "data-plane")}\n`);
  throw error;
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
