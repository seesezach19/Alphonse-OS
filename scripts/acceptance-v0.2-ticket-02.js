import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { signRuntimeEventEnvelope } from "../src/runtime-event-envelope.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = "http://127.0.0.1:43202";
const project = `alphonse-v02-ticket02-${process.pid}`;
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "alphonse-v02-ticket02-"));
const adapterKeyId = "fixture-runtime-key-v1";
const adapterSecret = "local-runtime-event-secret-with-sufficient-length-v1";
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  KERNEL_PORT: "43202",
  POSTGRES_PORT: "45502",
  DATA_PLANE_PORT: "43212",
  ALPHONSE_URL: baseUrl,
  ALPHONSE_TOKEN: "local-development-bootstrap-token",
  ALPHONSE_RUNTIME_ADAPTER_KEY_ID: adapterKeyId,
  ALPHONSE_RUNTIME_ADAPTER_SECRET: adapterSecret
};
const builderHeaders = {
  authorization: "Bearer local-development-bootstrap-token",
  "content-type": "application/json"
};
const imageDigest = `sha256:${"a".repeat(64)}`;
const payloadDigest = `sha256:${"c".repeat(64)}`;
let acceptancePassed = false;

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 8 * 60_000,
    windowsHide: true
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

function cli(...args) {
  const result = run(process.execPath, ["src/diagnostic-cli.js", ...args]);
  return JSON.parse(result.stdout);
}

function sql(database, user, password, query) {
  return run("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc",
    `PGPASSWORD=${password} psql -U ${user} -d ${database} -tAc '${query}'`]).stdout.trim();
}

function timestamp(offsetMilliseconds = 0) {
  return new Date(Date.now() + offsetMilliseconds).toISOString();
}

function authentication(envelope, signedAt = timestamp()) {
  return signRuntimeEventEnvelope(envelope, { keyId: adapterKeyId, secret: adapterSecret, signedAt });
}

async function postEvent(envelope, auth = authentication(envelope)) {
  return json("/diagnostic/v0/runtime-events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alphonse-runtime-key-id": auth.key_id,
      "x-alphonse-runtime-signed-at": auth.signed_at,
      "x-alphonse-runtime-signature": auth.signature
    },
    body: JSON.stringify(envelope)
  });
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait");

  const contract = cli("adapter-contract");
  assert.equal(contract.provider_neutral, true);
  assert.equal(contract.capabilities.detail_retrieval.requirement, "optional");
  assert.equal(contract.capabilities.replay.requirement, "optional");
  assert.doesNotMatch(JSON.stringify(contract), /n8n/i);

  const workflowCommand = {
    command_id: "v02-ticket02-workflow",
    operation_id: "diagnostic.agent_workflow.register",
    input: {
      workflow_id: "workflow:inventory-follow-up",
      display_name: "Inventory Exception Follow-up",
      objective: "Compare inventory and route customer follow-up drafts to local review.",
      external_ref: { system: "fixture", workflow_key: "inventory-follow-up", environment: "local" }
    }
  };
  const workflow = await json("/diagnostic/v0/agent-workflows", {
    method: "POST", headers: builderHeaders, body: JSON.stringify(workflowCommand)
  });
  assert.equal(workflow.response.status, 201);

  const revisionCommand = {
    command_id: "v02-ticket02-revision",
    operation_id: "diagnostic.agent_revision.register",
    input: {
      workflow_id: workflowCommand.input.workflow_id,
      workflow_content: { name: "Inventory Exception Follow-up", nodes: [], connections: {} },
      runtime: { runtime_id: "fixture-runtime", runtime_version: "1", image_digest: imageDigest },
      nodes: [{ node_type: "fixture.code", node_version: "1" }],
      model: { provider: "fixture", model: "deterministic-draft", version: "1" },
      configuration: { delivery: "local_review" },
      adapter: {
        adapter_id: "fixture.workflow-runtime",
        adapter_version: "0.2.0",
        fingerprint_rules_digest: `sha256:${"b".repeat(64)}`
      }
    }
  };
  const revisionResponse = await json("/diagnostic/v0/agent-revisions", {
    method: "POST", headers: builderHeaders, body: JSON.stringify(revisionCommand)
  });
  assert.equal(revisionResponse.response.status, 201, JSON.stringify(revisionResponse.body));
  const revisionId = revisionResponse.body.agent_revision.revision_id;

  const succeededEvent = {
    schema_version: "0.2.0",
    adapter: { adapter_id: "fixture.workflow-runtime", adapter_version: "0.2.0" },
    workflow_id: workflowCommand.input.workflow_id,
    revision_id: revisionId,
    external_execution_id: "fixture-execution-42",
    event_id: "fixture-event-42-3",
    event_sequence: 3,
    lifecycle_claim: "succeeded",
    correlation_id: "fixture-correlation-42",
    idempotency_key: "fixture-execution-42:3",
    occurred_at: timestamp(-60_000),
    payload: { digest: payloadDigest, reference: null }
  };
  const eventFile = path.join(temporaryRoot, "succeeded-event.json");
  await writeFile(eventFile, JSON.stringify(succeededEvent), "utf8");
  const accepted = cli("receive-event", eventFile);
  assert.equal(accepted.external_lifecycle_claim, "succeeded");
  assert.equal(accepted.http_acceptance, "event_preserved");
  assert.deepEqual(accepted.authority, {
    kernel_run: "not_created",
    execution_envelope: "not_created",
    effect_evidence: "not_trusted",
    external_completion: "not_adjudicated"
  });

  const countsBeforeReplay = sql("alphonse_diagnostic", "alphonse_diagnostic", "local-diagnostic-only",
    "select revision,(select count(*) from diagnostic_external_activity_traces),(select count(*) from diagnostic_runtime_event_receipts),(select count(*) from diagnostic_transitions) from diagnostic_nodes");
  const replay = cli("receive-event", eventFile);
  assert.deepEqual(replay, accepted);
  const countsAfterReplay = sql("alphonse_diagnostic", "alphonse_diagnostic", "local-diagnostic-only",
    "select revision,(select count(*) from diagnostic_external_activity_traces),(select count(*) from diagnostic_runtime_event_receipts),(select count(*) from diagnostic_transitions) from diagnostic_nodes");
  assert.equal(countsAfterReplay, countsBeforeReplay);

  const eventIdentityConflict = await postEvent({
    ...succeededEvent,
    event_sequence: 4,
    idempotency_key: "fixture-execution-42:4",
    lifecycle_claim: "failed"
  });
  assert.equal(eventIdentityConflict.response.status, 409);
  assert.deepEqual(eventIdentityConflict.body.error.details.conflict_types, ["event_identity"]);

  const idempotencyConflict = await postEvent({
    ...succeededEvent,
    event_id: "fixture-event-42-4",
    event_sequence: 4,
    lifecycle_claim: "failed"
  });
  assert.equal(idempotencyConflict.response.status, 409);
  assert.deepEqual(idempotencyConflict.body.error.details.conflict_types, ["idempotency_key"]);

  const sequenceConflict = await postEvent({
    ...succeededEvent,
    event_id: "fixture-event-42-sequence-conflict",
    idempotency_key: "fixture-execution-42:sequence-conflict",
    lifecycle_claim: "failed"
  });
  assert.equal(sequenceConflict.response.status, 409);
  assert.deepEqual(sequenceConflict.body.error.details.conflict_types, ["event_sequence"]);
  const preservedConflict = cli("get-event-conflict", sequenceConflict.body.error.details.conflict_id);
  assert.equal(preservedConflict.runtime_event_conflict.preserved, true);

  const acceptedClaim = {
    ...succeededEvent,
    event_id: "fixture-event-42-1",
    event_sequence: 1,
    lifecycle_claim: "accepted",
    idempotency_key: "fixture-execution-42:1",
    occurred_at: timestamp(-120_000),
    payload: { digest: null, reference: "runtime-detail://execution/fixture-execution-42" }
  };
  assert.equal((await postEvent(acceptedClaim)).response.status, 201);
  const runningClaim = {
    ...succeededEvent,
    event_id: "fixture-event-42-2",
    event_sequence: 2,
    lifecycle_claim: "running",
    idempotency_key: "fixture-execution-42:2",
    occurred_at: timestamp(-90_000)
  };
  assert.equal((await postEvent(runningClaim)).response.status, 201);

  const trace = cli("get-trace", accepted.trace_id).external_activity_trace;
  assert.equal(trace.event_count, "3");
  assert.equal(trace.projection.current_lifecycle_claim, "succeeded");
  assert.equal(trace.projection.current_event_sequence, "3");
  assert.equal(trace.projection.out_of_order_observed, true);
  assert.deepEqual(trace.projection.lifecycle_history.map((event) => event.event_sequence), ["1", "2", "3"]);
  assert.equal(trace.classification, "untrusted_external_observation");
  assert.equal(trace.authority.kernel_run, "not_created");

  const staleAuth = authentication({ ...succeededEvent, event_id: "stale-event", event_sequence: 5,
    idempotency_key: "stale-event:5" }, timestamp(-301_000));
  const stale = await postEvent({ ...succeededEvent, event_id: "stale-event", event_sequence: 5,
    idempotency_key: "stale-event:5" }, staleAuth);
  assert.equal(stale.response.status, 401);
  assert.equal(stale.body.error.code, "RUNTIME_EVENT_TIMESTAMP_OUT_OF_WINDOW");

  const tamperSource = { ...succeededEvent, event_id: "tamper-event", event_sequence: 6,
    idempotency_key: "tamper-event:6" };
  const tampered = await postEvent({ ...tamperSource, lifecycle_claim: "failed" }, authentication(tamperSource));
  assert.equal(tampered.response.status, 403);
  assert.equal(tampered.body.error.code, "RUNTIME_EVENT_SIGNATURE_INVALID");

  const unauthenticated = await json("/diagnostic/v0/runtime-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(tamperSource)
  });
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error.code, "RUNTIME_EVENT_AUTHENTICATION_REQUIRED");

  const payloadRejected = await json("/diagnostic/v0/runtime-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...succeededEvent, business_payload: { email: "prohibited" } })
  });
  assert.equal(payloadRejected.response.status, 400);
  assert.equal(payloadRejected.body.error.code, "INVALID_RUNTIME_EVENT_ENVELOPE");

  assert.equal(sql("alphonse_diagnostic", "alphonse_diagnostic", "local-diagnostic-only",
    "select count(*) from diagnostic_runtime_event_conflicts"), "3");
  assert.equal(sql("alphonse_kernel", "alphonse", "local-development-only",
    "select count(*) from kernel_runs"), "0");
  const diagnosticDump = run("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only pg_dump -U alphonse_diagnostic -d alphonse_diagnostic --data-only"]).stdout;
  assert.doesNotMatch(diagnosticDump, new RegExp(adapterSecret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  acceptancePassed = true;
  console.log(JSON.stringify({
    ticket: "v0.2-02",
    signed_succeeded_claim_preserved: true,
    identical_retry_reused_receipt: true,
    identity_sequence_idempotency_conflicts_preserved: true,
    out_of_order_projection_honest: true,
    kernel_runs_created: 0,
    provider_credentials_persisted: false,
    aws_activity: false
  }, null, 2));
} finally {
  if (!acceptancePassed) {
    try { console.error(compose("logs", "--no-color", "kernel")); } catch {}
  }
  try { compose("down", "--volumes", "--remove-orphans"); } catch {}
  await rm(temporaryRoot, { recursive: true, force: true });
}
