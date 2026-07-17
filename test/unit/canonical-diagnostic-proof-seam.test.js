import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  advanceAcceptanceState,
  assertRoleManifests,
  assertStimulusResult,
  assertVerifierResult,
  createAcceptanceState,
  loadRoleManifests
} from "../../scripts/canonical-diagnostic-proof-seam.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("acceptance roles declare distinct configured authority boundaries", () => {
  const manifests = loadRoleManifests(root);
  assert.doesNotThrow(() => assertRoleManifests(manifests));
  assert.deepEqual(Object.keys(manifests).sort(), [
    "acceptance_verifier",
    "runtime_supervisor",
    "scenario_stimulus",
    "test_orchestrator",
    "trusted_bootstrap"
  ]);
  assert.equal(manifests.scenario_stimulus.request_limit, 2);
  assert.deepEqual(manifests.scenario_stimulus.network, ["customer-ingress"]);
  assert.equal(manifests.acceptance_verifier.read_only, true);
  assert.equal(manifests.runtime_supervisor.docker_socket, false);
  assert.equal(manifests.runtime_supervisor.secret_store, false);
  for (const role of ["test_orchestrator", "runtime_supervisor", "scenario_stimulus", "acceptance_verifier"]) {
    assert.equal(manifests[role].credentials.includes("observer-hmac"), false);
    assert.equal(manifests[role].credentials.includes("tokenization-secret"), false);
  }
});

test("state seam refuses seal and stimulus before their authority boundaries", () => {
  let state = createAcceptanceState();
  state = advanceAcceptanceState(state, { type: "bootstrap.completed" });
  state = advanceAcceptanceState(state, { type: "orchestrator.inactive_material_registered" });
  state = advanceAcceptanceState(state, { type: "orchestrator.readiness_confirmed" });

  assert.throws(
    () => advanceAcceptanceState(state, { type: "orchestrator.manifest_sealed" }),
    /grant application receipts/i
  );
  assert.throws(
    () => advanceAcceptanceState(state, { type: "stimulus.completed", request_count: 2 }),
    /orchestrator must exit/i
  );

  state = advanceAcceptanceState(state, { type: "orchestrator.grant_applications_verified" });
  state = advanceAcceptanceState(state, { type: "orchestrator.manifest_sealed" });
  assert.throws(
    () => advanceAcceptanceState(state, { type: "stimulus.completed", request_count: 2 }),
    /orchestrator must exit/i
  );
  state = advanceAcceptanceState(state, { type: "orchestrator.exited" });
  state = advanceAcceptanceState(state, { type: "stimulus.completed", request_count: 2 });
  assert.equal(state.stage, "stimulus_completed");
});

test("stimulus and verifier results cannot contain diagnostic authorship", () => {
  assert.doesNotThrow(() => assertStimulusResult({
    request_count: 2,
    route: "/agency-lab/lead-ingress",
    transport_responses: [{ status: 202 }, { status: 202 }],
    authored: {
      observations: 0,
      projections: 0,
      packages: 0,
      assignments: 0,
      worker_outputs: 0,
      hidden_assertions: 0
    }
  }));
  assert.throws(
    () => assertStimulusResult({ request_count: 3, transport_responses: [], authored: {} }),
    /exactly two/i
  );

  assert.doesNotThrow(() => assertVerifierResult({
    read_only: true,
    reads: ["diagnostic-status", "kernel-audit"],
    writes: [],
    model_requests: 0
  }));
  assert.throws(
    () => assertVerifierResult({ read_only: true, reads: [], writes: ["package.create"], model_requests: 0 }),
    /writes/i
  );
});

test("opt-in process harness stops at the named missing capability with no model request", () => {
  const result = spawnSync(process.execPath, ["scripts/acceptance-canonical-proof-ticket-01.js", "--expect-blocked"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "blocked_expected");
  assert.equal(report.missing_capability, "durable_grant_application_protocol");
  assert.equal(report.model_requests, 0);
  assert.equal(report.stimulus.status, "not_started");
  assert.equal(report.verifier.status, "not_started");
  assert.equal(
    new Set(report.role_processes.map((role) => role.process_instance_id)).size,
    report.role_processes.length
  );
});
