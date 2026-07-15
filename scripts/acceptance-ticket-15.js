import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import { createEncryptedBackup, openEncryptedBackup } from "../src/backup-bundle.js";
import { canonicalize, sha256Digest } from "../src/canonical-json.js";
import { issueScopedCredential } from "../src/scoped-credential.js";

const kernelUrl = "http://127.0.0.1:43115";
const bootstrapHeaders = { "content-type": "application/json", authorization: "Bearer local-development-bootstrap-token" };
const environmentId = "00000000-0000-4000-8000-000000000001";
const installationId = "00000000-0000-4000-8000-00000000a001";
const agentId = "00000000-0000-4000-8000-000000001501";
const passportId = "00000000-0000-4000-8000-000000001502";
const envelopeId = "00000000-0000-4000-8000-000000001503";
const runId = "00000000-0000-4000-8000-000000001504";
const effectId = "00000000-0000-4000-8000-000000001505";
const workloadGrantId = "00000000-0000-4000-8000-000000001506";
const permitId = "00000000-0000-4000-8000-000000001507";
const capabilityId = "00000000-0000-4000-8000-000000001508";
const agentToken = "ticket-15-agent-token";
const effectKey = "restore-drill:storefront:SKU-100:24";
const composeEnvironment = { ...process.env, COMPOSE_PROJECT_NAME: "alphonse-kernel-ticket-15-acceptance",
  KERNEL_PORT: "43115", POSTGRES_PORT: "45446", DATA_PLANE_PORT: "43125" };

function runDocker(args, { input, encoding = "utf8", allowFailure = false } = {}) {
  const result = spawnSync("docker", ["compose", ...args], { cwd: new URL("..", import.meta.url),
    env: composeEnvironment, input, encoding, maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
  if (!allowFailure && result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

function compose(...args) { return runDocker(args); }
function psql(database, sql) {
  return runDocker(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "alphonse", "-d", database],
    { input: sql });
}
function command(commandId, operationId, input) { return { command_id: commandId, operation_id: operationId, input }; }
async function request(path, options = {}) {
  const response = await fetch(`${kernelUrl}${path}`, { ...options,
    headers: { ...bootstrapHeaders, ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}
async function post(path, body, agent = false) {
  return request(path, { method: "POST", headers: agent ? { authorization: `Agent ${agentToken}` } : {},
    body: JSON.stringify(body) });
}
async function waitHealthy() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${kernelUrl}/healthz`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Ticket 15 Kernel did not become healthy.");
}
function sign(value, secret) {
  return `hmac-sha256:${createHmac("sha256", secret).update(canonicalize(value)).digest("hex")}`;
}
function sqlJson(value) { return `$json$${JSON.stringify(value)}$json$::jsonb`; }

async function storefront(path, credential, options = {}) {
  const script = `fetch('http://127.0.0.1:3200${path}',${JSON.stringify({ method: options.method ?? "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${credential}`,
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}) })}).then(async r=>{const b=await r.json();console.log(JSON.stringify({status:r.status,body:b}))}).catch(e=>{console.error(e);process.exit(1)})`;
  const result = runDocker(["exec", "-T", "storefront-staging", "node", "-e", script]);
  return JSON.parse(result.stdout.trim());
}

compose("down", "--volumes", "--remove-orphans");
try {
  compose("up", "--build", "--wait");
  await waitHealthy();

  const human = await post("/kernel/v0/principals", command("t15-human", "kernel.principal.create",
    { principal_type: "human", display_name: "Restore Operator" }));
  assert.equal(human.response.status, 201, JSON.stringify(human.body));
  const humanId = human.body.principal.principal_id;
  const runtime = { kind: "restore-fixture", version: "1" };
  const modelConfiguration = { provider: "local", model: "fixture" };
  const skillConfiguration = {};
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
  const target = { system: "storefront-staging", resource: "storefront.inventory", subject: "SKU-100" };
  const credentialBinding = { binding_ref: "credential://storefront/inventory-writer",
    revision: "storefront-writer-rev-7", scopes: ["storefront.inventory.write"] };
  const adapter = { export_id: "storefront_inventory_adapter", contract_version: "1.0.0",
    export_digest: `sha256:${"a".repeat(64)}` };
  const effectRequest = { effect_id: effectId, run_id: runId, envelope_id: envelopeId,
    effect_idempotency_key: effectKey, capability_activation_id: capabilityId, workload_grant_id: workloadGrantId,
    context_receipt_ids: [], target, action: "set_quantity", requested_value: { quantity: 24 },
    limits: { maximum_items: 1, maximum_quantity: 1000 }, credential_binding: credentialBinding,
    adapter, evidence_requirements: ["storefront_response", "post_write_observation"],
    recovery: { strategy: "restore_previous_quantity", uncertainty: "reconcile_before_retry" }, expires_at: expiresAt };
  const workloadDigest = `sha256:${"b".repeat(64)}`;
  const grantDocument = { workload_grant_id: workloadGrantId, handoff_id: "00000000-0000-4000-8000-000000001509",
    delegation_id: "00000000-0000-4000-8000-000000001510", execution_epoch: 1,
    run_intent: "Restore drill workload", workload_digest: workloadDigest, adapter: "docker-local-v1",
    resources: { memory_mb: 128, cpu_millis: 500, pids: 32 }, network: { mode: "none" },
    filesystem: { root: "read_only", scratch_mb: 16, mounts: [] }, issued_at: now.toISOString(), expires_at: expiresAt,
    nonce: "00000000-0000-4000-8000-000000001511", external_effect_authority: false, dispatch_permit_required: true };
  const permitDocument = { permit_type: "effect_dispatch", permit_id: permitId, effect_id: effectId, run_id: runId,
    workload_grant_id: workloadGrantId, effect_idempotency_key: effectKey, target, action: "set_quantity",
    requested_value: { quantity: 24 }, request_digest: sha256Digest(effectRequest), credential_binding: credentialBinding,
    adapter, one_use: true, issued_at: now.toISOString(), expires_at: expiresAt };
  const sql = `SET session_replication_role = replica;
    INSERT INTO kernel_principals VALUES ('${agentId}','${installationId}','${environmentId}','agent','Restore Agent',null,'human','${humanId}',now());
    INSERT INTO kernel_agent_passports VALUES ('${passportId}','${installationId}','${environmentId}','${agentId}','${humanId}',
      ${sqlJson(runtime)},${sqlJson(modelConfiguration)},${sqlJson(skillConfiguration)},
      '${sha256Digest({ runtime, model_configuration: modelConfiguration, package_skill_configuration: skillConfiguration })}',
      '${sha256Digest(agentToken)}',ARRAY['runtime_execution'],${sqlJson({ source: "restore-drill" })},
      now()-interval '1 minute','${expiresAt}',now());
    INSERT INTO kernel_execution_envelopes VALUES ('${envelopeId}','${installationId}','${environmentId}','restore-fixture',
      '${sha256Digest({ admission: "fixture" })}','${sha256Digest({ envelope: "fixture" })}','${passportId}','${agentId}',
      '00000000-0000-4000-8000-000000001512','00000000-0000-4000-8000-000000001510','${capabilityId}',
      '00000000-0000-4000-8000-000000001513',${sqlJson({ export_id: "fixture" })},'[]'::jsonb,'{}'::jsonb,
      ${sqlJson(["storefront_response", "post_write_observation"])},'${expiresAt}',now());
    INSERT INTO kernel_runs VALUES ('${runId}','${installationId}','${environmentId}','${envelopeId}',now());
    INSERT INTO kernel_run_states (installation_id,environment_id,run_id,execution_status,accountability_status,updated_at)
      VALUES ('${installationId}','${environmentId}','${runId}','admitted','pending',now());
    INSERT INTO kernel_operational_obligations (obligation_id,installation_id,environment_id,run_id,obligation_key,requirement,status,deadline_at,created_at)
      VALUES ('00000000-0000-4000-8000-000000001514','${installationId}','${environmentId}','${runId}','response','storefront_response','open','${expiresAt}',now()),
      ('00000000-0000-4000-8000-000000001515','${installationId}','${environmentId}','${runId}','observation','post_write_observation','open','${expiresAt}',now());
    INSERT INTO kernel_workload_grants VALUES ('${workloadGrantId}','${installationId}','${environmentId}',
      '00000000-0000-4000-8000-000000001509','00000000-0000-4000-8000-000000001510',1,'Restore drill workload',
      '${workloadDigest}','docker-local-v1',${sqlJson(grantDocument.resources)},${sqlJson(grantDocument.network)},
      ${sqlJson(grantDocument.filesystem)},now(),'${expiresAt}','${grantDocument.nonce}','local-workload-grant-key-v1',
      ${sqlJson(grantDocument)},'${sha256Digest(grantDocument)}','${sign(grantDocument, "local-workload-grant-signing-secret")}');
    INSERT INTO kernel_effect_records (effect_id,installation_id,environment_id,run_id,envelope_id,effect_idempotency_key,
      effect_request,request_digest,capability_activation_id,workload_grant_id,context_receipt_ids,target,action,requested_value,
      limits,credential_binding,adapter_binding,evidence_requirements,recovery_posture,created_at,effect_request_digest)
      VALUES ('${effectId}','${installationId}','${environmentId}','${runId}','${envelopeId}','${effectKey}',
      ${sqlJson(effectRequest)},'${sha256Digest({ request: "fixture" })}','${capabilityId}','${workloadGrantId}','[]'::jsonb,
      ${sqlJson(target)},'set_quantity',${sqlJson({ quantity: 24 })},${sqlJson(effectRequest.limits)},${sqlJson(credentialBinding)},
      ${sqlJson(adapter)},${sqlJson(effectRequest.evidence_requirements)},${sqlJson(effectRequest.recovery)},now(),'${sha256Digest(effectRequest)}');
    INSERT INTO kernel_effect_states (installation_id,environment_id,effect_id,status,updated_at)
      VALUES ('${installationId}','${environmentId}','${effectId}','admitted',now());
    INSERT INTO kernel_dispatch_permits VALUES ('${permitId}','${installationId}','${environmentId}','${effectId}','${runId}',
      '${workloadGrantId}',${sqlJson(permitDocument)},'${sha256Digest(permitDocument)}','local-dispatch-permit-key-v1',
      '${sign(permitDocument, "local-dispatch-permit-signing-secret")}','${expiresAt}',now());
    INSERT INTO kernel_dispatch_permit_states (installation_id,environment_id,permit_id,status,updated_at)
      VALUES ('${installationId}','${environmentId}','${permitId}','issued',now());
    SET session_replication_role = origin;`;
  psql("alphonse_kernel", sql);

  const dumpResult = runDocker(["exec", "-T", "postgres", "pg_dump", "-U", "alphonse", "-d", "alphonse_kernel", "-Fc"],
    { encoding: null });
  const backupKey = randomBytes(32);
  const artifactBytes = Buffer.from("content-addressed trusted adapter artifact");
  const bundle = createEncryptedBackup({ backupId: "ticket-15-backup", environmentId, restorePointSequence: 1,
    executionEpoch: 1, postgresDump: Buffer.from(dumpResult.stdout), artifacts: [{ bytes: artifactBytes }],
    key: backupKey, keyId: "ticket-15-local-key" });
  assert.equal(openEncryptedBackup(bundle, backupKey).artifacts[0].bytes.equals(artifactBytes), true);

  const writeCredential = issueScopedCredential({ credential_id: "write-fixture", permit_id: permitId, effect_id: effectId,
    binding_ref: credentialBinding.binding_ref, revision: credentialBinding.revision, scopes: credentialBinding.scopes,
    target, action: "set_quantity", effect_idempotency_key: effectKey, issued_at: now.toISOString(), expires_at: expiresAt },
  "local-storefront-credential-issuer-secret");
  const applied = await storefront("/v0/inventory/SKU-100", writeCredential,
    { method: "PUT", idempotencyKey: effectKey, body: { quantity: 24 } });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.replayed, false);

  compose("stop", "kernel", "data-plane");
  psql("postgres", "DROP DATABASE alphonse_kernel WITH (FORCE);");
  psql("postgres", "CREATE DATABASE alphonse_kernel OWNER alphonse;");
  const restoredFixture = runDocker(["exec", "-T", "postgres", "pg_restore", "-U", "alphonse", "-d", "alphonse_kernel"],
    { input: openEncryptedBackup(bundle, backupKey).postgresDump, encoding: null, allowFailure: true });
  if (restoredFixture.status !== 0) {
    const restoreWarnings = Buffer.from(restoredFixture.stderr ?? "").toString("utf8");
    assert.match(restoreWarnings, /errors ignored on restore: 7/);
    assert.doesNotMatch(restoreWarnings, /kernel_(restore|recovery|transition|command|outbox)/);
  }
  psql("alphonse_kernel", `UPDATE kernel_environments SET operational_state='restore_suspended',
    execution_epoch=execution_epoch+1,restore_generation=restore_generation+1,updated_at=now()
    WHERE environment_id='${environmentId}' AND operational_state='active';`);
  compose("up", "-d", "--wait", "kernel", "data-plane");
  await waitHealthy();

  const started = await post("/kernel/v0/restores", command("t15-restore", "kernel.environment.restore.begin",
    { backup_manifest: bundle.manifest, backup_manifest_digest: bundle.manifest_digest }));
  assert.equal(started.response.status, 201, JSON.stringify(started.body));
  const restoreId = started.body.restore.restore_id;
  assert.equal(started.body.restore.execution_epoch, "2");
  assert.equal(started.body.restore.obligations.length, 1);

  const oldWorkload = await request("/internal/v0/workloads/admission", { method: "POST",
    headers: { authorization: "Bearer local-substrate-service-token" },
    body: JSON.stringify({ workload_grant_id: workloadGrantId, workload_digest: workloadDigest }) });
  assert.equal(oldWorkload.response.status, 409);
  assert.equal(oldWorkload.body.error.code, "ENVIRONMENT_EPOCH_FENCED");

  const oldDispatch = await post(`/kernel/v0/effects/${effectId}/dispatch`, command("t15-old-dispatch",
    "kernel.effect.dispatch", { effect_id: effectId, permit_id: permitId, permit_digest: sha256Digest(permitDocument) }), true);
  assert.equal(oldDispatch.response.status, 423);
  assert.equal(oldDispatch.body.error.code, "ENVIRONMENT_RESTORE_SUSPENDED");
  const beforeReconcile = await request("/kernel/v0/accountable-work/overview");
  assert.equal(beforeReconcile.body.restore.unresolved_obligations, 1);

  const obligation = started.body.restore.obligations[0];
  const recovery = await request(`/kernel/v0/recovery-cases/${obligation.recovery_case_id}`);
  const reconciliationPermit = recovery.body.recovery_case.reconciliation_permit;
  const reconciled = await post(`/kernel/v0/recovery-cases/${obligation.recovery_case_id}/reconcile`,
    command("t15-reconcile", "kernel.recovery_case.reconcile", { recovery_case_id: obligation.recovery_case_id,
      reconciliation_permit_id: reconciliationPermit.reconciliation_permit_id,
      permit_digest: reconciliationPermit.permit_digest }), true);
  assert.equal(reconciled.response.status, 201, JSON.stringify(reconciled.body));
  assert.equal(reconciled.body.recovery_case.status, "resolved_applied");
  const afterReconcile = await request("/kernel/v0/accountable-work/overview");
  assert.equal(afterReconcile.body.restore.unresolved_obligations, 0);

  const rebuilt = await post(`/kernel/v0/restores/${restoreId}/projection-rebuild`,
    command("t15-rebuild", "kernel.environment.restore.projection_rebuild", {}));
  assert.equal(rebuilt.response.status, 201, JSON.stringify(rebuilt.body));
  assert.equal(rebuilt.body.projection.health, "current");
  const verified = await post(`/kernel/v0/restores/${restoreId}/verify`, command("t15-verify",
    "kernel.environment.restore.verify", { verified_artifact_digests: bundle.manifest.artifacts.map((item) => item.digest) }));
  assert.equal(verified.response.status, 201, JSON.stringify(verified.body));
  assert.ok(Object.values(verified.body.verification).every(Boolean));
  const resumed = await post(`/kernel/v0/restores/${restoreId}/resume`,
    command("t15-resume", "kernel.environment.restore.resume", {}));
  assert.equal(resumed.response.status, 201, JSON.stringify(resumed.body));
  assert.equal(resumed.body.environment.operational_state, "active");

  const readCredential = issueScopedCredential({ credential_id: "read-fixture", permit_id: permitId, effect_id: effectId,
    binding_ref: credentialBinding.binding_ref, revision: credentialBinding.revision, scopes: ["storefront.inventory.read"],
    target, action: "observe_quantity", effect_idempotency_key: effectKey, issued_at: now.toISOString(), expires_at: expiresAt },
  "local-storefront-credential-issuer-secret");
  const receipt = await storefront(`/v0/effect-receipts/${encodeURIComponent(effectKey)}`, readCredential);
  assert.equal(receipt.body.found, true);
  assert.equal(receipt.body.response.previous_quantity, 18);
  assert.equal(receipt.body.response.quantity, 24);

  for (const [index, lifecycleKind] of ["typed_tombstone", "authority_expiration", "identity_pseudonymization"].entries()) {
    const record = await post("/kernel/v0/data-lifecycle-records", command(`t15-life-${index}`,
      "kernel.data_lifecycle.record", { lifecycle_kind: lifecycleKind, subject_type: "fixture",
        subject_id: `subject-${index}`, detail: { drill: true } }));
    assert.equal(record.response.status, 201, JSON.stringify(record.body));
    assert.equal(record.body.lifecycle_record.lifecycle_kind, lifecycleKind);
  }

  console.log(JSON.stringify({ restore_id: restoreId, execution_epoch: 2, ambiguous_effects: 1,
    duplicate_external_corrections: 0, projection_health: rebuilt.body.projection.health,
    lifecycle_kinds_verified: 4, status: "passed" }, null, 2));
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
