import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  createSignedGrantActivationSnapshot,
  createSignedGrantApplicationReceipt
} from "../src/grant-authority-contracts.js";

const baseUrl = "http://127.0.0.1:43202";
const expectBlocked = process.argv.includes("--expect-blocked");
const project = `alphonse-canonical-ticket02-${process.pid}`;
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  KERNEL_PORT: "43202",
  POSTGRES_PORT: "45502",
  DATA_PLANE_PORT: "43212"
};
const ownerHeaders = {
  authorization: "Bearer local-development-bootstrap-token",
  "content-type": "application/json"
};
const feedHeaders = {
  authorization: "Bearer local-grant-authority-feed-token",
  "content-type": "application/json"
};
const receiptHeaders = {
  authorization: "Bearer local-grant-application-receipt-token",
  "content-type": "application/json"
};
const authorityKey = {
  keyId: "local-kernel-grant-snapshot-key-v1",
  secret: "local-kernel-grant-snapshot-secret-with-sufficient-length-v1"
};
const applicationKey = {
  keyId: "local-diagnostic-grant-application-key-v1",
  secret: "local-diagnostic-grant-application-secret-with-sufficient-length-v1"
};

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL("..", import.meta.url), env: environment, encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024, timeout: 8 * 60_000, windowsHide: true
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function compose(...args) {
  return run("docker", ["compose", ...args]).stdout;
}

async function json(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const body = await response.json();
  return { response, body };
}

async function post(route, body, headers = ownerHeaders) {
  return json(route, { method: "POST", headers, body: JSON.stringify(body) });
}

function command(operationId, input) {
  return { command_id: randomUUID(), operation_id: operationId, input };
}

function mutatedApplicationReceipt(originalBytes) {
  const original = JSON.parse(originalBytes);
  return createSignedGrantApplicationReceipt({
    ...original.document,
    service_transaction_id: randomUUID(),
    service_transaction_position: String(BigInt(original.document.service_transaction_position) + 1n)
  }, { ...applicationKey, signedAt: new Date().toISOString() });
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait");
  const health = await json("/healthz");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.grant_authority, "healthy");
  assert.equal(health.body.diagnostic_grant_receiver, "healthy");

  const grantId = randomUUID();
  const grantDocument = {
    principal_id: "observer:webhook-ingress",
    adapter_binding_id: "adapter:webhook-ingress@0.1.0",
    allowed_observation_types: ["source.delivery"],
    stream_id: "stream:webhook-ingress",
    workflow_scope: "workflow:agency-lab:lead-ingestion"
  };
  const registered = await post("/kernel/v0/grant-authority/grants", command(
    "kernel.authority_grant.register", {
      grant_id: grantId,
      grant_type: "observation_reporting",
      receiver_service_id: "diagnostic-plane",
      grant_document: grantDocument
    }
  ));
  assert.equal(registered.response.status, 201);
  assert.equal(registered.body.grant.effective_state, "inactive");
  assert.equal(registered.body.grant.authority_granted, false);

  const missingApplicationSeal = await post("/kernel/v0/grant-authority/seal-readiness", {
    grant_ids: [grantId]
  });
  assert.equal(missingApplicationSeal.response.status, 409);
  assert.equal(missingApplicationSeal.body.error.code, "GRANT_APPLICATION_REQUIRED");

  const failedReadiness = await post("/kernel/v0/grant-authority/readiness-receipts", command(
    "kernel.authority_grant.readiness.record", {
      grant_id: grantId,
      readiness_receipt_id: randomUUID(),
      readiness_status: "failed",
      readiness_receipt: { checks: ["published_workflow_binding"], status: "failed" }
    }
  ));
  assert.equal(failedReadiness.response.status, 201);
  const blockedPublication = await post("/kernel/v0/grant-authority/snapshots", command(
    "kernel.authority_grant.snapshot.publish", { grant_id: grantId, target_state: "active" }
  ));
  assert.equal(blockedPublication.response.status, 409);
  assert.equal(blockedPublication.body.error.code, "GRANT_READINESS_REQUIRED");

  const ready = await post("/kernel/v0/grant-authority/readiness-receipts", command(
    "kernel.authority_grant.readiness.record", {
      grant_id: grantId,
      readiness_receipt_id: randomUUID(),
      readiness_status: "ready",
      readiness_receipt: {
        checks: ["published_workflow_binding", "successful_execution_retention"],
        binding_digest: `sha256:${"7".repeat(64)}`,
        status: "ready"
      }
    }
  ));
  assert.equal(ready.response.status, 201);

  const publication = await post("/kernel/v0/grant-authority/snapshots", command(
    "kernel.authority_grant.snapshot.publish", { grant_id: grantId, target_state: "active" }
  ));
  assert.equal(publication.response.status, 201);
  const activation = publication.body.grant_activation_snapshot;
  let kernelState = await json(`/kernel/v0/grant-authority/grants/${grantId}`, { headers: ownerHeaders });
  assert.equal(kernelState.body.grant_state.desired_state, "activation_pending");
  assert.equal(kernelState.body.grant_state.effective_state, "inactive");
  assert.equal(kernelState.body.grant_state.authority_granted, false);

  await new Promise((resolve) => setTimeout(resolve, 50));
  kernelState = await json(`/kernel/v0/grant-authority/grants/${grantId}`, { headers: ownerHeaders });
  assert.equal(kernelState.body.grant_state.effective_state, "inactive",
    "Receiver outage or non-delivery must leave activation pending.");

  const applied = await post("/diagnostic/internal/v0/grant-activation-snapshots", {
    signed_snapshot_bytes: activation.signed_snapshot_bytes
  }, feedHeaders);
  assert.equal(applied.response.status, 201);
  const activationReceipt = applied.body.grant_application_receipt;
  const applicationReplay = await post("/diagnostic/internal/v0/grant-activation-snapshots", {
    signed_snapshot_bytes: activation.signed_snapshot_bytes
  }, feedHeaders);
  assert.equal(applicationReplay.response.status, 200);
  assert.equal(applicationReplay.body.grant_application_receipt.receipt_digest, activationReceipt.receipt_digest);

  const activationDoc = JSON.parse(activation.signed_snapshot_bytes).document;
  const outOfOrder = createSignedGrantActivationSnapshot({
    ...activationDoc,
    snapshot_id: randomUUID(),
    authority_sequence: "3",
    predecessor_snapshot_digest: activation.snapshot_digest,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString()
  }, { ...authorityKey, signedAt: new Date().toISOString() });
  const outOfOrderResult = await post("/diagnostic/internal/v0/grant-activation-snapshots", {
    signed_snapshot_bytes: outOfOrder.bytes
  }, feedHeaders);
  assert.equal(outOfOrderResult.response.status, 409);
  assert.equal(outOfOrderResult.body.error.code, "GRANT_SNAPSHOT_OUT_OF_ORDER");

  const acceptedActivation = await post("/authority/v0/grant-application-receipts", {
    signed_receipt_bytes: activationReceipt.signed_receipt_bytes
  }, receiptHeaders);
  assert.equal(acceptedActivation.response.status, 201);
  assert.equal(acceptedActivation.body.grant_application_receipt.effective_state, "active_effective");
  const receiptReplay = await post("/authority/v0/grant-application-receipts", {
    signed_receipt_bytes: activationReceipt.signed_receipt_bytes
  }, receiptHeaders);
  assert.equal(receiptReplay.response.status, 200);
  assert.equal(receiptReplay.body.grant_application_receipt.receipt_digest,
    acceptedActivation.body.grant_application_receipt.receipt_digest);

  const conflictReceipt = mutatedApplicationReceipt(activationReceipt.signed_receipt_bytes);
  const conflict = await post("/authority/v0/grant-application-receipts", {
    signed_receipt_bytes: conflictReceipt.bytes
  }, receiptHeaders);
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "IDEMPOTENCY_CONFLICT");

  const seal = await post("/kernel/v0/grant-authority/seal-readiness", { grant_ids: [grantId] });
  assert.equal(seal.response.status, 200);
  assert.equal(seal.body.grant_applications_verified, true);

  const revocationPublication = await post("/kernel/v0/grant-authority/snapshots", command(
    "kernel.authority_grant.snapshot.publish", { grant_id: grantId, target_state: "revoked" }
  ));
  assert.equal(revocationPublication.response.status, 201);
  const revocation = revocationPublication.body.grant_activation_snapshot;
  kernelState = await json(`/kernel/v0/grant-authority/grants/${grantId}`, { headers: ownerHeaders });
  assert.equal(kernelState.body.grant_state.desired_state, "revocation_pending");
  assert.equal(kernelState.body.grant_state.effective_state, "active_effective");
  assert.equal(kernelState.body.grant_state.authority_granted, true);

  const revokedAtReceiver = await post("/diagnostic/internal/v0/grant-activation-snapshots", {
    signed_snapshot_bytes: revocation.signed_snapshot_bytes
  }, feedHeaders);
  assert.equal(revokedAtReceiver.response.status, 201);
  const receiverProjection = await json(`/diagnostic/v0/grant-projections/${grantId}`, { headers: ownerHeaders });
  assert.equal(receiverProjection.body.grant_projection.effective_state, "revoked");
  assert.equal(receiverProjection.body.grant_projection.reporting_authorized, false);
  kernelState = await json(`/kernel/v0/grant-authority/grants/${grantId}`, { headers: ownerHeaders });
  assert.equal(kernelState.body.grant_state.effective_state, "active_effective",
    "Kernel records revocation only after the application receipt returns.");

  const acceptedRevocation = await post("/authority/v0/grant-application-receipts", {
    signed_receipt_bytes: revokedAtReceiver.body.grant_application_receipt.signed_receipt_bytes
  }, receiptHeaders);
  assert.equal(acceptedRevocation.response.status, 201);
  kernelState = await json(`/kernel/v0/grant-authority/grants/${grantId}`, { headers: ownerHeaders });
  assert.equal(kernelState.body.grant_state.effective_state, "revoked_effective");
  assert.equal(kernelState.body.grant_state.authority_granted, false);

  process.stdout.write(`${JSON.stringify({
    schema_version: "0.1.0",
    ticket: "canonical-diagnostic-proof-02",
    status: "blocked_expected",
    completed_capability: "durable_grant_application_protocol",
    grant_id: grantId,
    proven: [
      "inactive_registration",
      "readiness_gated_publication",
      "signed_one_way_snapshot",
      "durable_receiver_application",
      "signed_application_receipt",
      "effective_authority_after_receipt",
      "exact_replay",
      "identity_conflict",
      "out_of_order_rejection",
      "pending_state_during_receiver_non_delivery",
      "revocation_effective_at_receiver_transaction",
      "seal_gated_by_application"
    ],
    next_missing_capability: "canonical_observation_intake",
    model_requests: 0,
    worker_run_created: false,
    negative_test_snapshots_worker_visible: false
  }, null, 2)}\n`);
  if (!expectBlocked) process.exitCode = 2;
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
