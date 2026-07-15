import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { sha256Digest } from "../src/canonical-json.js";
import { supportCredentialDigest } from "../src/support-service.js";

const kernelUrl = "http://127.0.0.1:43171";
const coordinatorUrl = "http://127.0.0.1:43170";
const coordinatorInternalUrl = "http://hosted-coordinator:3600";
const environmentId = "00000000-0000-4000-8000-000000000131";
const bootstrapHeaders = { "content-type": "application/json", authorization: "Bearer local-development-bootstrap-token" };
const accountHeaders = { "content-type": "application/json", authorization: "Bearer local-coordinator-account-only" };
const composeEnvironment = { ...process.env, COMPOSE_PROJECT_NAME: "alphonse-kernel-ticket-16-acceptance",
  COMPOSE_PROFILES: "promotion", COORDINATOR_PORT: "43170", PROMOTION_DEVELOPMENT_PORT: "43171" };

function compose(...args) {
  const result = spawnSync("docker", ["compose", "--profile", "promotion", ...args], {
    cwd: new URL("..", import.meta.url), env: composeEnvironment, encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 10 * 60_000
  });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  return { response, body: await response.json() };
}

async function kernel(path, options = {}) {
  return request(kernelUrl, path, { ...options, headers: { ...bootstrapHeaders, ...(options.headers ?? {}) } });
}

async function post(path, value) {
  return kernel(path, { method: "POST", body: JSON.stringify(value) });
}

function command(commandId, operationId, input = {}) {
  return { command_id: commandId, operation_id: operationId, input };
}

compose("down", "--volumes", "--remove-orphans");
try {
  compose("up", "--build", "--wait", "hosted-coordinator", "promotion-kernel-development");
  const coordinatorHealth = await request(coordinatorUrl, "/healthz");
  assert.equal(coordinatorHealth.response.status, 200);

  const bindingResult = await post("/kernel/v0/coordinator-bindings", command("t16-binding",
    "kernel.coordinator_binding.create", { coordinator_id: "coordinator:local",
      coordinator_endpoint: coordinatorInternalUrl,
      coordinator_public_key: coordinatorHealth.body.coordinator_public_key, customer_id: "customer:demo",
      promotion_scope: { allowed_targets: ["development", "staging", "production"] },
      expires_at: new Date(Date.now() + 3_600_000).toISOString() }));
  assert.equal(bindingResult.response.status, 201, JSON.stringify(bindingResult.body));
  const bindingId = bindingResult.body.coordinator_binding.binding_id;

  const registration = await post("/kernel/v0/coordinator-registration-sync",
    command("t16-register", "kernel.coordinator.register_outbound"));
  assert.equal(registration.response.status, 201, JSON.stringify(registration.body));

  const beforeHeartbeat = await request(coordinatorUrl, `/coordinator/v0/environments/${environmentId}`,
    { headers: accountHeaders });
  assert.equal(beforeHeartbeat.body.environment.health.status, "unknown");
  assert.equal(beforeHeartbeat.body.environment.health.freshness, "missing");

  const heartbeat = await post("/kernel/v0/environment-health-publications",
    command("t16-health", "kernel.environment_health.publish_outbound"));
  assert.equal(heartbeat.response.status, 201, JSON.stringify(heartbeat.body));
  assert.equal(heartbeat.body.environment_health.coarse, true);
  assert.doesNotMatch(JSON.stringify(heartbeat.body.environment_health), /prompt|credential_value|business_payload/i);
  const heartbeatReplay = await post("/kernel/v0/environment-health-publications",
    command("t16-health", "kernel.environment_health.publish_outbound"));
  assert.equal(heartbeatReplay.response.status, 200, JSON.stringify(heartbeatReplay.body));
  const afterHeartbeat = await request(coordinatorUrl, `/coordinator/v0/environments/${environmentId}`,
    { headers: accountHeaders });
  assert.equal(afterHeartbeat.body.environment.health.freshness, "fresh");

  const supportRequest = await request(coordinatorUrl, "/coordinator/v0/support-cases", {
    method: "POST", headers: accountHeaders, body: JSON.stringify({ environment_id: environmentId,
      support_identity: { provider: "alphonse", subject: "support-operator-7", display_name: "Support Operator" },
      diagnostic_scopes: ["kernel_health", "host_health", "runtime_health"],
      requested_duration_seconds: 600, reason: "Customer requested diagnosis of runtime host health." })
  });
  assert.equal(supportRequest.response.status, 201, JSON.stringify(supportRequest.body));
  assert.equal(supportRequest.body.support_case.access_granted, false);
  const supportCaseId = supportRequest.body.support_case.support_case_id;

  const poll = await post("/kernel/v0/support-polls", command("t16-support-poll", "kernel.support.poll_outbound"));
  assert.equal(poll.response.status, 201, JSON.stringify(poll.body));
  assert.equal(poll.body.support_cases[0].support_case_id, supportCaseId);

  const supportToken = "ticket-16-customer-generated-support-credential";
  const approval = await post(`/kernel/v0/support-cases/${supportCaseId}/approve`, command("t16-approve",
    "kernel.support_case.approve", { authentication_digest: supportCredentialDigest(supportToken),
      duration_seconds: 300, expected_revision: 0 }));
  assert.equal(approval.response.status, 201, JSON.stringify(approval.body));
  assert.equal(approval.body.support_passport.access_class, "diagnostics_read_only");
  assert.equal(approval.body.support_passport.credential_stored, false);
  const passportId = approval.body.support_passport.support_passport_id;

  const notice = await post(`/kernel/v0/support-passports/${passportId}/deliver`,
    command("t16-notice", "kernel.support_passport.deliver_outbound"));
  assert.equal(notice.response.status, 201, JSON.stringify(notice.body));
  assert.equal(notice.body.support_passport_notice.credential_disclosed, false);
  const noticeReplay = await post(`/kernel/v0/support-passports/${passportId}/deliver`,
    command("t16-notice", "kernel.support_passport.deliver_outbound"));
  assert.equal(noticeReplay.response.status, 200, JSON.stringify(noticeReplay.body));
  const routeReplayConflict = await post("/kernel/v0/support-passports/00000000-0000-4000-8000-000000001699/deliver",
    command("t16-notice", "kernel.support_passport.deliver_outbound"));
  assert.equal(routeReplayConflict.response.status, 409);
  assert.equal(routeReplayConflict.body.error.code, "IDEMPOTENCY_CONFLICT");

  const diagnostic = await post("/kernel/v0/diagnostic-bundles", command("t16-diagnostic",
    "kernel.diagnostic_bundle.create", { support_passport_id: passportId,
      diagnostic_scopes: ["kernel_health", "host_health", "runtime_health"], expires_in_seconds: 180 }));
  assert.equal(diagnostic.response.status, 201, JSON.stringify(diagnostic.body));
  assert.equal(diagnostic.body.diagnostic_bundle.encrypted, true);
  assert.equal(diagnostic.body.diagnostic_bundle.immutable, true);
  const bundleId = diagnostic.body.diagnostic_bundle.diagnostic_bundle_id;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const read = await request(kernelUrl, `/support/v0/diagnostic-bundles/${bundleId}`,
      { headers: { authorization: `Support ${supportToken}` } });
    assert.equal(read.response.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.diagnostics.schema_version, "alphonse.redacted_diagnostics.v0.1");
    assert.doesNotMatch(JSON.stringify(read.body.diagnostics), /credential_value|business_payload|prompt/i);
  }
  const metadata = await kernel(`/kernel/v0/diagnostic-bundles/${bundleId}`);
  assert.equal(metadata.response.status, 200, JSON.stringify(metadata.body));
  assert.equal(metadata.body.diagnostic_bundle.access_log.length, 2);

  const deniedRemediation = await post("/kernel/v0/support-remediation-authorizations", command("t16-remediation",
    "kernel.support_remediation.authorize", { support_passport_id: passportId, requested_action: { action: "restart_worker" },
      capability_admission: { deployment_id: "00000000-0000-4000-8000-000000001601",
        business_approval_id: "00000000-0000-4000-8000-000000001602",
        capability_activation_id: "00000000-0000-4000-8000-000000001603", capability_export_id: "support.restart",
        capability_export_digest: `sha256:${"a".repeat(64)}`, authority_digest: `sha256:${"b".repeat(64)}`,
        expected_revision: 0 } }));
  assert.equal(deniedRemediation.response.status, 409);
  assert.equal(deniedRemediation.body.error.code, "CAPABILITY_UNAPPROVED");

  const placementBefore = await request(kernelUrl, "/internal/v0/runtime-hosts/placement-admission", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer local-substrate-service-token" },
    body: JSON.stringify({ host_id: "host-development-1", host_key_id: "host-key-v1" })
  });
  assert.equal(placementBefore.body.admissible, true);
  const quarantine = await post("/kernel/v0/runtime-hosts/host-development-1/quarantine", command("t16-quarantine",
    "kernel.runtime_host.quarantine", { current_key_id: "host-key-v1", reason: "Repeated invalid observations.",
      expected_revision: 0 }));
  assert.equal(quarantine.response.status, 201, JSON.stringify(quarantine.body));
  assert.equal(quarantine.body.host.workloads_fenced, true);
  const placementAfter = await request(kernelUrl, "/internal/v0/runtime-hosts/placement-admission", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer local-substrate-service-token" },
    body: JSON.stringify({ host_id: "host-development-1", host_key_id: "host-key-v1" })
  });
  assert.equal(placementAfter.body.admissible, false);
  const butler = await kernel("/kernel/v0/accountable-work/overview");
  assert.equal(butler.body.support.support_cases.length, 1);
  assert.equal(butler.body.support.diagnostic_bundles[0].access_count, 2);
  assert.equal(butler.body.support.runtime_hosts[0].state, "quarantined");

  const localRevocation = await post(`/kernel/v0/coordinator-bindings/${bindingId}/revoke`, command("t16-revoke",
    "kernel.coordinator_binding.revoke", { reason: "Customer ended hosted support.", expected_revision: 0 }));
  assert.equal(localRevocation.response.status, 201, JSON.stringify(localRevocation.body));
  const deniedAfterRevocation = await request(kernelUrl, `/support/v0/diagnostic-bundles/${bundleId}`,
    { headers: { authorization: `Support ${supportToken}` } });
  assert.equal(deniedAfterRevocation.response.status, 403);

  const sync = await post(`/kernel/v0/coordinator-bindings/${bindingId}/revocation-sync`, command("t16-revoke-sync",
    "kernel.coordinator_binding.revocation_sync", { reason: "Customer ended hosted support." }));
  assert.equal(sync.response.status, 201, JSON.stringify(sync.body));
  assert.equal(sync.body.binding_revocation.local_history_preserved, true);
  const hostedRevoked = await request(coordinatorUrl, `/coordinator/v0/environments/${environmentId}`,
    { headers: accountHeaders });
  assert.equal(hostedRevoked.body.environment.registration_state, "revoked");
  assert.equal(hostedRevoked.body.environment.hosted_visibility, false);
  assert.equal(hostedRevoked.body.environment.descriptor, undefined);

  const localHistory = await kernel("/kernel/v0/commands/t16-approve");
  assert.equal(localHistory.response.status, 200);
  assert.equal(localHistory.body.result.support_passport.support_passport_id, passportId);
  console.log("Ticket 16 acceptance passed: support remains temporary, read-only, explicit, and locally governed.");
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
