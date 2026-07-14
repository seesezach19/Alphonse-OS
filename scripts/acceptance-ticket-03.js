import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";

import { canonicalize } from "../src/canonical-json.js";

const kernelUrl = "http://127.0.0.1:43103";
const dataPlaneUrl = "http://127.0.0.1:43113";
const agentToken = "ticket-03-agent-token-0000000000000001";
const authHeaders = { "content-type": "application/json", authorization: "Bearer local-development-bootstrap-token" };
const composeEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "alphonse-kernel-ticket-03-acceptance",
  KERNEL_PORT: "43103",
  POSTGRES_PORT: "45434",
  DATA_PLANE_PORT: "43113"
};

function compose(...args) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: new URL("..", import.meta.url), env: composeEnvironment, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
}

async function kernel(path, options = {}) {
  const response = await fetch(`${kernelUrl}${path}`, {
    ...options, headers: { ...authHeaders, ...(options.headers ?? {}) }
  });
  return { response, body: await response.json() };
}

async function post(path, body) {
  return kernel(path, { method: "POST", body: JSON.stringify(body) });
}

async function postAgent(path, body) {
  return kernel(path, { method: "POST", headers: { authorization: `Agent ${agentToken}` }, body: JSON.stringify(body) });
}

async function queryDataPlane(body, token = agentToken) {
  const response = await fetch(`${dataPlaneUrl}/v0/inventory/query`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Agent ${token}` },
    body: JSON.stringify(body)
  });
  return { response, body: await response.json() };
}

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

async function waitUntilHealthy() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${kernelUrl}/healthz`)).ok && (await fetch(`${dataPlaneUrl}/healthz`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Kernel and Data Plane did not become healthy.");
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait");

  const human = await post("/kernel/v0/principals", command("t03-human", "kernel.principal.create",
    { principal_type: "human", display_name: "Inventory Operator" }));
  assert.equal(human.response.status, 201);
  const humanId = human.body.principal.principal_id;

  const agent = await post("/kernel/v0/principals", command("t03-agent", "kernel.principal.create",
    { principal_type: "agent", display_name: "Inventory Reconciliation Agent" }));
  assert.equal(agent.response.status, 201);
  const agentId = agent.body.principal.principal_id;

  const now = Date.now();
  const passport = await post("/kernel/v0/agent-passports", command("t03-passport", "kernel.agent_passport.issue", {
    agent_principal_id: agentId,
    sponsor_principal_id: humanId,
    runtime: { kind: "codex", version: "workspace" },
    model_configuration: { provider: "openai", model: "frontier" },
    package_skill_configuration: { packages: [], skills: ["implement"] },
    agent_authentication_token: agentToken,
    permitted_intent_classes: ["package_build"],
    provenance: { source: "ticket-03-acceptance" },
    valid_from: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 3_600_000).toISOString()
  }));
  assert.equal(passport.response.status, 201);
  const passportId = passport.body.passport.passport_id;

  const proposal = await postAgent("/kernel/v0/work-intent-proposals", command("t03-proposal",
    "kernel.work_intent.propose", {
      passport_id: passportId,
      intent_class: "package_build",
      objective: "Reconcile ERP and storefront inventory observations.",
      requested_outcome: "Produce a discrepancy package for operator review.",
      scope: { subjects: ["SKU-100"] },
      constraints: { read_only: true, no_external_effects: true }
    }));
  assert.equal(proposal.response.status, 201);
  const confirmed = await post(`/kernel/v0/work-intent-proposals/${proposal.body.proposal.proposal_id}/confirm`,
    command("t03-confirm", "kernel.work_intent.confirm", {}));
  assert.equal(confirmed.response.status, 201);
  const workIntentId = confirmed.body.work_intent.work_intent_id;

  const session = await post("/kernel/v0/build-sessions", command("t03-session", "kernel.build_session.open", {
    principal_id: agentId,
    passport_id: passportId,
    work_intent_id: workIntentId,
    base_references: { kernel_protocol: "0.1.0", toolkit_digest: `sha256:${"0".repeat(64)}` },
    expires_at: new Date(now + 1_800_000).toISOString()
  }));
  assert.equal(session.response.status, 201);

  const grantExpiry = new Date(now + 1_200_000).toISOString();
  async function issueGrant(commandId, subjects, sources, maxAgeSeconds = 300) {
    return post("/kernel/v0/context-access-grants", command(commandId, "kernel.context_access_grant.issue", {
      passport_id: passportId,
      work_intent_id: workIntentId,
      purpose: "Read bounded inventory observations for discrepancy package construction.",
      subjects,
      sources,
      sensitivity_classes: ["internal"],
      max_items: subjects.length * sources.length,
      max_age_seconds: maxAgeSeconds,
      expires_at: grantExpiry
    }));
  }

  const malformedExpiry = await post("/kernel/v0/context-access-grants", command("t03-invalid-expiry",
    "kernel.context_access_grant.issue", {
      passport_id: passportId, work_intent_id: workIntentId, purpose: "Invalid test",
      subjects: ["SKU-100"], sources: ["erp"], sensitivity_classes: ["internal"],
      max_items: 1, max_age_seconds: 300, expires_at: "not-a-date"
    }));
  assert.equal(malformedExpiry.response.status, 400);
  assert.equal(malformedExpiry.body.error.code, "INVALID_INPUT");

  const granted = await issueGrant("t03-grant-main", ["SKU-100"], ["erp", "storefront"]);
  assert.equal(granted.response.status, 201);
  assert.equal(granted.body.context_access_grant.access, "read_only");
  const grantId = granted.body.context_access_grant.grant_id;
  const replayedGrant = await issueGrant("t03-grant-main", ["SKU-100"], ["erp", "storefront"]);
  assert.equal(replayedGrant.response.status, 200);
  assert.equal(replayedGrant.response.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(replayedGrant.body, granted.body);

  const delivered = await queryDataPlane({ grant_id: grantId, subjects: ["SKU-100"], sources: ["erp", "storefront"] });
  assert.equal(delivered.response.status, 200);
  assert.deepEqual(delivered.body.data.map((item) => [item.source, item.quantity]), [["erp", 24], ["storefront", 18]]);
  assert.equal(delivered.body.delivery.observed_at_preserved, true);

  const receipt = await kernel(`/kernel/v0/context-receipts/${delivered.body.delivery.receipt_id}`);
  assert.equal(receipt.response.status, 200);
  assert.match(receipt.body.context_receipt.signature, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.body.context_receipt.packet_hash, delivered.body.delivery.packet_hash);
  assert.equal(receipt.body.context_receipt.item_references.length, 2);
  assert.equal(receipt.body.context_receipt.freshness_claims[0].cache_reset_observation_time, false);
  assert.ok(receipt.body.context_receipt.freshness_claims[0].cache_age_seconds >= 60);
  const disclosedAgeMs = receipt.body.context_receipt.freshness_claims[0].cache_age_seconds * 1000;
  const actualAgeMs = Date.parse(receipt.body.context_receipt.freshness_claims[0].delivered_at)
    - Date.parse(receipt.body.context_receipt.freshness_claims[0].observed_at);
  assert.ok(actualAgeMs >= disclosedAgeMs && actualAgeMs < disclosedAgeMs + 1000);
  assert.doesNotMatch(JSON.stringify(receipt.body), /"quantity"|"payload"|"data"/);

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const deliveredAgain = await queryDataPlane({ grant_id: grantId, subjects: ["SKU-100"], sources: ["erp", "storefront"] });
  assert.equal(deliveredAgain.response.status, 200);
  assert.equal(deliveredAgain.body.data[0].observed_at, delivered.body.data[0].observed_at);
  const repeatedReceipt = await kernel(`/kernel/v0/context-receipts/${deliveredAgain.body.delivery.receipt_id}`);
  assert.ok(repeatedReceipt.body.context_receipt.freshness_claims[0].cache_age_seconds
    > receipt.body.context_receipt.freshness_claims[0].cache_age_seconds);

  const overBroad = await queryDataPlane({ grant_id: grantId, subjects: ["SKU-100", "SKU-STALE"], sources: ["erp"] });
  assert.equal(overBroad.response.status, 403);
  assert.equal(overBroad.body.error.code, "OVER_BROAD_CONTEXT_REQUEST");

  const staleGrant = await issueGrant("t03-grant-stale", ["SKU-STALE"], ["erp"]);
  const stale = await queryDataPlane({ grant_id: staleGrant.body.context_access_grant.grant_id,
    subjects: ["SKU-STALE"], sources: ["erp"] });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "STALE_CONTEXT");

  const withdrawnGrant = await issueGrant("t03-grant-withdrawn", ["SKU-WITHDRAWN"], ["erp"]);
  const withdrawn = await queryDataPlane({ grant_id: withdrawnGrant.body.context_access_grant.grant_id,
    subjects: ["SKU-WITHDRAWN"], sources: ["erp"] });
  assert.equal(withdrawn.response.status, 409);
  assert.equal(withdrawn.body.error.code, "CONTEXT_WITHDRAWN");

  const policyGrant = await issueGrant("t03-grant-policy", ["SKU-100"], ["warehouse"]);
  const policyDenied = await queryDataPlane({ grant_id: policyGrant.body.context_access_grant.grant_id,
    subjects: ["SKU-100"], sources: ["warehouse"] });
  assert.equal(policyDenied.response.status, 403);
  assert.equal(policyDenied.body.error.code, "DATA_PLANE_POLICY_DENIED");

  const forgedReceipt = {
    ...receipt.body.context_receipt,
    receipt_id: "00000000-0000-4000-8000-000000000004",
    provenance: { ...receipt.body.context_receipt.provenance, payload: { quantity: 999 } }
  };
  delete forgedReceipt.signature;
  const forgedSignature = `hmac-sha256:${createHmac("sha256", "local-data-plane-receipt-secret")
    .update(canonicalize(forgedReceipt)).digest("hex")}`;
  const rejectedPayload = await fetch(`${kernelUrl}/internal/v0/context/receipts`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer local-data-plane-service-token",
      "x-receipt-signature": forgedSignature },
    body: JSON.stringify(forgedReceipt)
  });
  assert.equal(rejectedPayload.status, 400);
  assert.equal((await rejectedPayload.json()).error.code, "INVALID_CONTEXT_RECEIPT");

  const invalidSignature = await fetch(`${kernelUrl}/internal/v0/context/receipts`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer local-data-plane-service-token",
      "x-receipt-signature": `hmac-sha256:${"0".repeat(64)}` },
    body: JSON.stringify({ receipt_id: "00000000-0000-4000-8000-000000000003" })
  });
  assert.equal(invalidSignature.status, 403);
  assert.equal((await invalidSignature.json()).error.code, "INVALID_RECEIPT_SIGNATURE");

  const butler = await kernel("/kernel/v0/accountable-work/overview");
  assert.equal(butler.response.status, 200);
  const context = butler.body.accountable_work.items[0].context.find((item) => item.grant_id === grantId);
  assert.equal(context.authority, "granted_read_only");
  assert.equal(context.latest_receipt.freshness_claims.length, 2);
  assert.equal(context.latest_receipt.freshness_claims[0].status, "fresh");
  assert.ok(context.latest_receipt.freshness_claims[0].current_age_seconds >= 61);
  assert.deepEqual(context.latest_receipt.limitations.fields_redacted, ["internal_note"]);
  assert.doesNotMatch(JSON.stringify(butler.body), /"quantity"|cycle count verified/);

  compose("stop");
  compose("up", "--wait");
  await waitUntilHealthy();
  const persistedReceipt = await kernel(`/kernel/v0/context-receipts/${delivered.body.delivery.receipt_id}`);
  assert.equal(persistedReceipt.body.context_receipt.packet_hash, delivered.body.delivery.packet_hash);

  console.log("Ticket 03 black-box acceptance passed.");
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
