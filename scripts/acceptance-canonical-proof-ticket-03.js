import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { sha256Digest } from "../src/canonical-json.js";
import { createSignedObservation } from "../src/observation-contracts.js";
import { createCanonicalProofDeployment } from "./canonical-proof-deployment-fixture.js";

const baseUrl = "http://127.0.0.1:43203";
const dataPlaneUrl = "http://127.0.0.1:43213";
const project = `alphonse-canonical-ticket03-${process.pid}`;
const environment = { ...process.env, COMPOSE_PROJECT_NAME: project,
  KERNEL_PORT: "43203", POSTGRES_PORT: "45503", DATA_PLANE_PORT: "43213", TOKENIZATION_PORT: "43503" };
const ownerHeaders = { authorization: "Bearer local-development-bootstrap-token", "content-type": "application/json" };
const feedHeaders = { authorization: "Bearer local-grant-authority-feed-token", "content-type": "application/json" };
const receiptHeaders = { authorization: "Bearer local-grant-application-receipt-token", "content-type": "application/json" };
const agentToken = "canonical-proof-builder-agent-token-00000001";
const observerSecret = "observer-webhook-secret-with-sufficient-length-v1";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: new URL("..", import.meta.url), env: environment,
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 8 * 60_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const compose = (...args) => run("docker", ["compose", ...args]);

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}
const kernel = (path, options = {}) => request(baseUrl, path, {
  ...options, headers: { ...ownerHeaders, ...(options.headers ?? {}) }
});
const dataPlane = (path, options = {}) => request(dataPlaneUrl, path, options);
const post = (path, body, headers = ownerHeaders) => request(baseUrl, path,
  { method: "POST", headers, body: JSON.stringify(body) });
const command = (operationId, input) => ({ command_id: randomUUID(), operation_id: operationId, input });
const bytesDigest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

compose("down", "--volumes", "--remove-orphans");
try {
  compose("up", "--build", "--wait");
  const runningServices = new Set(compose("ps", "--services", "--status", "running")
    .split(/\r?\n/u).filter(Boolean));
  assert.equal(runningServices.has("tokenization-service"), false,
    "Generic observation intake must run without the Tokenization Service deployment.");
  const deployment = await createCanonicalProofDeployment({ kernel, dataPlane, agentToken });
  const schemaDigest = sha256Digest(deployment.schema_export.content);
  const activated = await post("/diagnostic/v0/observation-schema-activations", {
    deployment_id: deployment.deployment_id,
    schema_export_id: deployment.schema_export.export_id
  });
  assert.equal(activated.response.status, 201, JSON.stringify(activated.body));
  assert.equal(activated.body.schema_activation.schema.schema_digest, schemaDigest);
  assert.equal(activated.body.schema_activation.deployment_id, deployment.deployment_id);

  const grantId = randomUUID();
  const grantDocument = {
    principal_id: "observer:webhook-ingress",
    installation_id: "00000000-0000-4000-8000-00000000a001",
    environment_id: "00000000-0000-4000-8000-000000000001",
    adapter_binding: { adapter_binding_id: "adapter:webhook-ingress", version: "0.1.0",
      digest: `sha256:${"4".repeat(64)}` },
    allowed_schema_tuples: [{ schema_id: deployment.schema_export.export_id,
      schema_version: deployment.schema_export.contract_version, schema_digest: schemaDigest }],
    workflow_ids: ["workflow:agency-lab:lead-ingestion"], integration_ids: [],
    stream_id: "stream:webhook-ingress", valid_from: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString(), key_id: "observer-webhook-key-v1",
    limits: { max_envelope_bytes: 16384, max_detail_bytes: 4096, max_sequence_advance: 1000 }
  };
  const registered = await post("/kernel/v0/grant-authority/grants", command(
    "kernel.authority_grant.register", { grant_id: grantId, grant_type: "observation_reporting",
      receiver_service_id: "diagnostic-plane", grant_document: grantDocument }
  ));
  assert.equal(registered.response.status, 201);
  await post("/kernel/v0/grant-authority/readiness-receipts", command(
    "kernel.authority_grant.readiness.record", { grant_id: grantId, readiness_receipt_id: randomUUID(),
      readiness_status: "ready", readiness_receipt: { status: "ready", deployment_id: deployment.deployment_id,
        schema_digest: schemaDigest } }
  ));
  const published = await post("/kernel/v0/grant-authority/snapshots", command(
    "kernel.authority_grant.snapshot.publish", { grant_id: grantId, target_state: "active" }
  ));
  const applied = await post("/diagnostic/internal/v0/grant-activation-snapshots", {
    signed_snapshot_bytes: published.body.grant_activation_snapshot.signed_snapshot_bytes
  }, feedHeaders);
  assert.equal(applied.response.status, 201);
  const effective = await post("/authority/v0/grant-application-receipts", {
    signed_receipt_bytes: applied.body.grant_application_receipt.signed_receipt_bytes
  }, receiptHeaders);
  assert.equal(effective.response.status, 201);

  function envelope(sequence, overrides = {}) {
    return {
      schema_version: "0.1.0", observation_id: randomUUID(), observation_type: "source.delivery",
      schema: { schema_id: deployment.schema_export.export_id,
        schema_version: deployment.schema_export.contract_version, schema_digest: schemaDigest },
      principal_id: "observer:webhook-ingress", grant_id: grantId, key_id: "observer-webhook-key-v1",
      installation_id: grantDocument.installation_id, environment_id: grantDocument.environment_id,
      adapter_binding: grantDocument.adapter_binding, stream_id: grantDocument.stream_id, sequence: String(sequence),
      workflow_id: "workflow:agency-lab:lead-ingestion", integration_id: null,
      occurred_at: new Date().toISOString(), observed_at: new Date().toISOString(),
      claims: { delivery_id: `delivery-${sequence}`, logical_operation_id: "operation-1" }, limitations: [],
      redaction: { policy_id: "redaction:claims-only", policy_digest: `sha256:${"5".repeat(64)}` },
      detail: null, provenance_dependencies: [], ...overrides
    };
  }
  async function submit(value, detail = null, secret = observerSecret) {
    const signed = createSignedObservation(value, { keyId: "observer-webhook-key-v1", secret });
    return post("/diagnostic/v0/observations", { envelope_bytes: signed.bytes,
      authentication: signed.authentication, detail_base64: detail?.toString("base64") ?? null }, {});
  }

  const detail = Buffer.from(JSON.stringify({ provider_delivery: "redacted", attempt: 1 }));
  const firstEnvelope = envelope(1, { detail: { digest: bytesDigest(detail), media_type: "application/json",
    size_bytes: detail.length } });
  const first = await submit(firstEnvelope, detail);
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.observation_receipt.intake_position, "1");
  assert.equal(first.body.observation_receipt.attribution, "authenticated_under_observer_specific_grant");
  assert.equal(first.body.observation_receipt.exclusive_authorship_established, false);
  assert.equal(first.body.observation_receipt.external_truth_established, false);
  const replay = await submit(firstEnvelope, detail);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.observation_receipt.receipt_id, first.body.observation_receipt.receipt_id);

  const fourth = await submit(envelope(4));
  assert.equal(fourth.response.status, 201);
  assert.deepEqual(fourth.body.observation_receipt.coverage.missing_ranges, [["2", "3"]]);
  const conflicting = await submit(envelope(4));
  assert.equal(conflicting.response.status, 409);
  assert.ok(conflicting.body.error.details.conflict_types.includes("stream_sequence"));
  const invalidClaims = await submit(envelope(5, { claims: {
    delivery_id: "delivery-5", logical_operation_id: "operation-1", undeclared: "rejected"
  } }));
  assert.equal(invalidClaims.response.status, 422);
  assert.match(invalidClaims.body.error.details.rejection_id, /^[0-9a-f-]{36}$/);
  const badSignature = await submit(envelope(6), null, "wrong-observer-secret-with-sufficient-length-v1");
  assert.equal(badSignature.response.status, 401);
  assert.match(badSignature.body.error.details.rejection_id, /^[0-9a-f-]{36}$/);
  const oversized = await submit(envelope(7, { detail: { digest: bytesDigest(Buffer.alloc(4097)),
    media_type: "application/json", size_bytes: 4097 } }), Buffer.alloc(4097));
  assert.equal(oversized.response.status, 413);

  const second = await submit(envelope(2));
  const third = await submit(envelope(3));
  assert.equal(second.response.status, 201);
  assert.equal(third.response.status, 201);
  assert.deepEqual(third.body.observation_receipt.coverage.missing_ranges, []);
  assert.equal(third.body.observation_receipt.coverage.contiguous_through, "4");
  const prefix = await kernel("/diagnostic/v0/intake-prefix");
  assert.equal(prefix.body.intake_prefix.committed_through, "8");

  process.stdout.write(`${JSON.stringify({
    schema_version: "0.1.0", ticket: "canonical-diagnostic-proof-03", status: "passed",
    completed_capability: "generic_canonical_observation_intake",
    proven: ["exact_deployed_schema", "effective_observer_grant", "hmac_authenticated_attribution",
      "cas_first_detail", "atomic_receipt_transition_coverage_outbox", "contiguous_committed_prefix",
      "gap_tolerant_stream", "late_gap_fill", "exact_replay", "identity_conflict", "bounded_rejection",
      "size_failure", "tokenization_service_not_deployed", "no_tokenization_dependency"],
    committed_intake_outcomes: "8",
    model_requests: 0, worker_run_created: false
  }, null, 2)}\n`);
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
