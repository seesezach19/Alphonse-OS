import assert from "node:assert/strict";
import { createPublicKey, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

import { sha256Digest } from "../src/canonical-json.js";
import { createSignedObservation } from "../src/observation-contracts.js";
import { verifySignedTokenizationResultReceipt } from "../src/tokenization-contracts.js";
import { createCanonicalProofDeployment } from "./canonical-proof-deployment-fixture.js";

const { Client } = pg;

const baseUrl = "http://127.0.0.1:43204";
const dataPlaneUrl = "http://127.0.0.1:43214";
const tokenizationUrl = "http://127.0.0.1:43504";
const project = `alphonse-canonical-ticket04-${process.pid}`;
const environment = { ...process.env, COMPOSE_PROJECT_NAME: project,
  KERNEL_PORT: "43204", POSTGRES_PORT: "45504", DATA_PLANE_PORT: "43214", TOKENIZATION_PORT: "43504" };
const ownerHeaders = { authorization: "Bearer local-development-bootstrap-token", "content-type": "application/json" };
const feedHeaders = { authorization: "Bearer local-grant-authority-feed-token", "content-type": "application/json" };
const receiptHeaders = { authorization: "Bearer local-grant-application-receipt-token", "content-type": "application/json" };
const agentToken = "canonical-proof-builder-agent-token-00000002";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: new URL("..", import.meta.url), env: environment,
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 8 * 60_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const compose = (...args) => run("docker", ["compose", "--profile", "canonical-tokenization", ...args]);
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

async function activateGrant({ grantType, receiverServiceId, grantDocument, receiverUrl }) {
  const grantId = randomUUID();
  const registered = await post("/kernel/v0/grant-authority/grants", command("kernel.authority_grant.register", {
    grant_id: grantId, grant_type: grantType, receiver_service_id: receiverServiceId, grant_document: grantDocument
  }));
  assert.equal(registered.response.status, 201, JSON.stringify(registered.body));
  await post("/kernel/v0/grant-authority/readiness-receipts", command("kernel.authority_grant.readiness.record", {
    grant_id: grantId, readiness_receipt_id: randomUUID(), readiness_status: "ready",
    readiness_receipt: { status: "ready", receiver_service_id: receiverServiceId }
  }));
  const publication = await post("/kernel/v0/grant-authority/snapshots", command(
    "kernel.authority_grant.snapshot.publish", { grant_id: grantId, target_state: "active" }
  ));
  const receiverPath = receiverServiceId === "diagnostic-plane"
    ? "/diagnostic/internal/v0/grant-activation-snapshots"
    : "/internal/v0/grant-activation-snapshots";
  const applied = await request(receiverUrl, receiverPath, {
    method: "POST", headers: feedHeaders,
    body: JSON.stringify({ signed_snapshot_bytes: publication.body.grant_activation_snapshot.signed_snapshot_bytes })
  });
  assert.equal(applied.response.status, 201, JSON.stringify(applied.body));
  const effective = await post("/authority/v0/grant-application-receipts", {
    signed_receipt_bytes: applied.body.grant_application_receipt.signed_receipt_bytes
  }, receiptHeaders);
  assert.equal(effective.response.status, 201, JSON.stringify(effective.body));
  return { grantId, publication, applied };
}

compose("down", "--volumes", "--remove-orphans");
try {
  compose("up", "--build", "--wait");
  const tokenizationDatabase = new Client({
    connectionString: "postgresql://alphonse_tokenization:local-tokenization-only@127.0.0.1:45504/alphonse_diagnostic"
  });
  await tokenizationDatabase.connect();
  await tokenizationDatabase.query("SELECT 1 FROM tokenization_service_sequences LIMIT 1");
  let diagnosticReadDenied = false;
  try {
    await tokenizationDatabase.query("SELECT 1 FROM diagnostic_observation_receipts LIMIT 1");
  } catch (error) {
    diagnosticReadDenied = error.code === "42501";
  } finally {
    await tokenizationDatabase.end();
  }
  assert.equal(diagnosticReadDenied, true, "Tokenization database role must not read Diagnostic Plane receipts.");
  const deployment = await createCanonicalProofDeployment({ kernel, dataPlane, agentToken });
  const tokenSchema = deployment.tokenized_schema_export;
  const schemaDigest = sha256Digest(tokenSchema.content);
  const activation = await post("/diagnostic/v0/observation-schema-activations", {
    deployment_id: deployment.deployment_id, schema_export_id: tokenSchema.export_id
  });
  assert.equal(activation.response.status, 201, JSON.stringify(activation.body));

  const validity = {
    valid_from: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString()
  };
  const tokenGrantDocument = {
    requester_principal_id: "observer:webhook-ingress",
    installation_id: "00000000-0000-4000-8000-00000000a001",
    environment_id: "00000000-0000-4000-8000-000000000001",
    integration_id: "integration:mock-crm",
    field_role: "source.delivery_identity",
    claim_field: "delivery_identity_equality_token",
    namespace: "lead-idempotency",
    algorithm_version: "hmac-sha256-length-prefixed.v1",
    collection_window_id: "collection:duplicate-delivery-proof",
    service_binding: { service_id: "tokenization-service", version: "0.1.0" },
    ...validity,
    max_input_bytes: 64,
    requests_per_minute: 20
  };
  const tokenGrant = await activateGrant({ grantType: "tokenization_use",
    receiverServiceId: "tokenization-service", grantDocument: tokenGrantDocument,
    receiverUrl: tokenizationUrl });

  function tokenRequest(bytes, overrides = {}) {
    return {
      request_id: randomUUID(), grant_id: tokenGrant.grantId,
      requester_principal_id: tokenGrantDocument.requester_principal_id,
      installation_id: tokenGrantDocument.installation_id,
      environment_id: tokenGrantDocument.environment_id,
      integration_id: tokenGrantDocument.integration_id,
      field_role: tokenGrantDocument.field_role,
      claim_field: tokenGrantDocument.claim_field,
      namespace: tokenGrantDocument.namespace,
      algorithm_version: tokenGrantDocument.algorithm_version,
      input_base64: Buffer.from(bytes).toString("base64"), requested_at: new Date().toISOString(),
      ...overrides
    };
  }
  const requesterHeaders = { authorization: "Bearer local-webhook-tokenization-requester-token" };
  const firstRequest = tokenRequest("delivery-001");
  const tokenized = await request(tokenizationUrl, "/v0/tokenize", {
    method: "POST", headers: requesterHeaders, body: JSON.stringify(firstRequest)
  });
  assert.equal(tokenized.response.status, 201, JSON.stringify(tokenized.body));
  assert.equal(tokenized.body.tokenization_result.diagnostic_preserved, true);
  assert.equal(tokenized.body.tokenization_result.raw_input_retained, false);
  assert.equal(tokenized.body.tokenization_result.unsalted_input_digest_retained, false);
  const resultId = tokenized.body.tokenization_result.result_receipt_id;
  const proof = await kernel(`/diagnostic/v0/tokenization-result-receipts/${resultId}`);
  assert.equal(proof.response.status, 200);
  assert.equal(proof.body.tokenization_result_receipt.exact_signed_bytes_preserved, true);
  assert.equal(proof.body.tokenization_result_receipt.raw_input_preserved, false);
  assert.doesNotMatch(JSON.stringify(proof.body), /delivery-001/);
  const publicKey = createPublicKey({
    key: Buffer.from("MCowBQYDK2VwAyEAd3J+TM4tUSgFYA35F1emcJ2zGrmunrS8ynmYe6aCCYE=", "base64"),
    format: "der", type: "spki"
  });
  const verifiedProof = verifySignedTokenizationResultReceipt(
    proof.body.tokenization_result_receipt.signed_result_receipt_bytes,
    { keyId: "local-tokenization-service-ed25519-v1", publicKey }
  );
  assert.equal(verifiedProof.digest, tokenized.body.tokenization_result.receipt_digest);
  assert.ok(proof.body.tokenization_result_receipt.signed_grant_snapshot_bytes);
  assert.ok(proof.body.tokenization_result_receipt.signed_grant_application_receipt_bytes);

  const replay = await request(tokenizationUrl, "/v0/tokenize", {
    method: "POST", headers: requesterHeaders, body: JSON.stringify(firstRequest)
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.tokenization_result.result_receipt_id, resultId);
  const changedIdentity = await request(tokenizationUrl, "/v0/tokenize", {
    method: "POST", headers: requesterHeaders,
    body: JSON.stringify({ ...firstRequest, input_base64: Buffer.from("delivery-002").toString("base64") })
  });
  assert.equal(changedIdentity.response.status, 409);

  const caseVariant = await request(tokenizationUrl, "/v0/tokenize", {
    method: "POST", headers: requesterHeaders, body: JSON.stringify(tokenRequest("Delivery-001"))
  });
  const whitespaceVariant = await request(tokenizationUrl, "/v0/tokenize", {
    method: "POST", headers: requesterHeaders, body: JSON.stringify(tokenRequest("delivery-001 "))
  });
  assert.notEqual(tokenized.body.tokenization_result.equality_token,
    caseVariant.body.tokenization_result.equality_token);
  assert.notEqual(tokenized.body.tokenization_result.equality_token,
    whitespaceVariant.body.tokenization_result.equality_token);

  const adapterBinding = { adapter_binding_id: "adapter:webhook-ingress", version: "0.1.0",
    digest: `sha256:${"4".repeat(64)}` };
  const observationGrantDocument = {
    principal_id: "observer:webhook-ingress",
    installation_id: tokenGrantDocument.installation_id,
    environment_id: tokenGrantDocument.environment_id,
    adapter_binding: adapterBinding,
    allowed_schema_tuples: [{ schema_id: tokenSchema.export_id,
      schema_version: tokenSchema.contract_version, schema_digest: schemaDigest }],
    workflow_ids: ["workflow:agency-lab:lead-ingestion"],
    integration_ids: ["integration:mock-crm"], stream_id: "stream:webhook-ingress-tokenized",
    ...validity, key_id: "observer-webhook-key-v1",
    limits: { max_envelope_bytes: 16384, max_detail_bytes: 0, max_sequence_advance: 1000 }
  };
  const observationGrant = await activateGrant({ grantType: "observation_reporting",
    receiverServiceId: "diagnostic-plane", grantDocument: observationGrantDocument, receiverUrl: baseUrl });
  function envelope(token, dependencies, sequence = "1") {
    return {
      schema_version: "0.1.0", observation_id: randomUUID(), observation_type: "source.delivery",
      schema: { schema_id: tokenSchema.export_id, schema_version: tokenSchema.contract_version,
        schema_digest: schemaDigest }, principal_id: observationGrantDocument.principal_id,
      grant_id: observationGrant.grantId, key_id: observationGrantDocument.key_id,
      installation_id: observationGrantDocument.installation_id,
      environment_id: observationGrantDocument.environment_id, adapter_binding: adapterBinding,
      stream_id: observationGrantDocument.stream_id, sequence,
      workflow_id: "workflow:agency-lab:lead-ingestion", integration_id: "integration:mock-crm",
      occurred_at: new Date().toISOString(), observed_at: new Date().toISOString(),
      claims: { delivery_id: "delivery-opaque-1", logical_operation_id: "operation-opaque-1",
        delivery_identity_equality_token: token }, limitations: [],
      redaction: { policy_id: "redaction:equality-only", policy_digest: `sha256:${"5".repeat(64)}` },
      detail: null, provenance_dependencies: dependencies
    };
  }
  async function submitObservation(value) {
    const signed = createSignedObservation(value, { keyId: "observer-webhook-key-v1",
      secret: "observer-webhook-secret-with-sufficient-length-v1" });
    return post("/diagnostic/v0/observations", {
      envelope_bytes: signed.bytes, authentication: signed.authentication
    }, {});
  }
  const observed = await submitObservation(envelope(tokenized.body.tokenization_result.equality_token, [resultId]));
  assert.equal(observed.response.status, 201, JSON.stringify(observed.body));
  const missingProof = await submitObservation(envelope(
    tokenized.body.tokenization_result.equality_token, [randomUUID()], "2"));
  assert.equal(missingProof.response.status, 422);
  assert.equal(missingProof.body.error.code, "OBSERVATION_PROVENANCE_MISSING");
  const mismatchedToken = await submitObservation(envelope("eq:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    [resultId], "3"));
  assert.equal(mismatchedToken.response.status, 422);
  assert.equal(mismatchedToken.body.error.code, "OBSERVATION_TOKEN_BINDING_MISMATCH");

  const revocation = await post("/kernel/v0/grant-authority/snapshots", command(
    "kernel.authority_grant.snapshot.publish", { grant_id: tokenGrant.grantId, target_state: "revoked" }
  ));
  const revokedAtService = await request(tokenizationUrl, "/internal/v0/grant-activation-snapshots", {
    method: "POST", headers: feedHeaders,
    body: JSON.stringify({ signed_snapshot_bytes: revocation.body.grant_activation_snapshot.signed_snapshot_bytes })
  });
  assert.equal(revokedAtService.response.status, 201);
  const blockedAfterReceiverRevocation = await request(tokenizationUrl, "/v0/tokenize", {
    method: "POST", headers: requesterHeaders, body: JSON.stringify(tokenRequest("delivery-003"))
  });
  assert.equal(blockedAfterReceiverRevocation.response.status, 403);
  await post("/authority/v0/grant-application-receipts", {
    signed_receipt_bytes: revokedAtService.body.grant_application_receipt.signed_receipt_bytes
  }, receiptHeaders);

  process.stdout.write(`${JSON.stringify({
    schema_version: "0.1.0", ticket: "canonical-diagnostic-proof-04", status: "passed",
    completed_capability: "verifiable_scoped_equality_tokenization",
    proven: ["separate_service_principal", "tokenization_database_role_isolated",
      "durably_applied_tokenization_grant", "exact_byte_tokenization",
      "domain_separation", "no_raw_or_unsalted_input_retention", "ed25519_result_receipt",
      "diagnostic_proof_preserved_before_reference", "exact_replay", "request_identity_conflict",
      "missing_proof_rejected", "token_binding_mismatch_rejected", "receiver_effective_revocation"],
    model_requests: 0, worker_run_created: false
  }, null, 2)}\n`);
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
