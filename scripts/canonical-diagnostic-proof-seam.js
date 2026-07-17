import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const requiredRoles = [
  "trusted_bootstrap",
  "test_orchestrator",
  "runtime_supervisor",
  "scenario_stimulus",
  "acceptance_verifier"
];

const forbiddenAuthorship = [
  "observation.report",
  "projection.create",
  "package.create",
  "assignment.create",
  "worker-output.write",
  "model.request"
];

export function loadAcceptanceManifest(root) {
  const file = path.join(root, "proof", "canonical-diagnostic-acceptance-roles.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

export function loadRoleManifests(root) {
  return loadAcceptanceManifest(root).roles;
}

export function assertRoleManifests(roles) {
  assert.deepEqual(Object.keys(roles).sort(), [...requiredRoles].sort(), "exact acceptance roles are required");
  for (const roleName of requiredRoles) {
    const role = roles[roleName];
    assert.equal(role.enforcement_claim, "configured_exclusion_under_trusted_host");
    assert.ok(Array.isArray(role.credentials));
    assert.ok(Array.isArray(role.mounts));
    assert.ok(Array.isArray(role.network));
    assert.ok(Array.isArray(role.permissions));
  }

  const signatures = requiredRoles.map((roleName) => {
    const role = roles[roleName];
    return JSON.stringify({ credentials: role.credentials, mounts: role.mounts, network: role.network });
  });
  assert.equal(new Set(signatures).size, requiredRoles.length, "every role needs a distinct environment boundary");

  for (const roleName of requiredRoles.filter((name) => name !== "trusted_bootstrap")) {
    const role = roles[roleName];
    assert.equal(role.docker_socket, false, `${roleName} cannot receive Docker authority`);
    assert.equal(role.secret_store, false, `${roleName} cannot receive secret-store authority`);
    assert.equal(role.credentials.includes("observer-hmac"), false);
    assert.equal(role.credentials.includes("tokenization-secret"), false);
  }

  const orchestrator = roles.test_orchestrator;
  for (const permission of forbiddenAuthorship) assert.equal(orchestrator.permissions.includes(permission), false);

  const stimulus = roles.scenario_stimulus;
  assert.equal(stimulus.request_limit, 2);
  assert.deepEqual(stimulus.network, ["customer-ingress"]);
  assert.deepEqual(stimulus.permissions, ["ingress.request"]);

  const verifier = roles.acceptance_verifier;
  assert.equal(verifier.read_only, true);
  assert.ok(verifier.permissions.every((permission) => permission.endsWith(".read")));

  const supervisor = roles.runtime_supervisor;
  assert.deepEqual(supervisor.credentials, []);
  assert.deepEqual(supervisor.network, []);
  assert.equal(supervisor.docker_socket, false);
  assert.equal(supervisor.secret_store, false);
}

export function createAcceptanceState() {
  return {
    stage: "initial",
    bootstrap_completed: false,
    inactive_material_registered: false,
    readiness_confirmed: false,
    grant_applications_verified: false,
    manifest_sealed: false,
    orchestrator_exited: false,
    stimulus_completed: false,
    verification_completed: false,
    model_requests: 0,
    timeline: []
  };
}

function requireState(condition, message) {
  if (!condition) throw new Error(message);
}

export function advanceAcceptanceState(current, event) {
  const state = structuredClone(current);
  switch (event.type) {
    case "bootstrap.completed":
      requireState(state.stage === "initial", "Bootstrap must be the first transition.");
      state.bootstrap_completed = true;
      state.stage = "bootstrap_completed";
      break;
    case "orchestrator.inactive_material_registered":
      requireState(state.bootstrap_completed, "Bootstrap must complete before orchestration.");
      state.inactive_material_registered = true;
      state.stage = "inactive_material_registered";
      break;
    case "orchestrator.readiness_confirmed":
      requireState(state.inactive_material_registered, "Inactive material must be registered before readiness.");
      state.readiness_confirmed = true;
      state.stage = "readiness_confirmed";
      break;
    case "orchestrator.grant_applications_verified":
      requireState(state.readiness_confirmed, "Readiness must complete before grant application.");
      state.grant_applications_verified = true;
      state.stage = "grant_applications_verified";
      break;
    case "orchestrator.manifest_sealed":
      requireState(state.grant_applications_verified, "Verified grant application receipts are required before seal.");
      state.manifest_sealed = true;
      state.stage = "manifest_sealed";
      break;
    case "orchestrator.exited":
      requireState(state.manifest_sealed, "The deployment manifest must be sealed before orchestrator exit.");
      state.orchestrator_exited = true;
      state.stage = "orchestrator_exited";
      break;
    case "stimulus.completed":
      requireState(state.orchestrator_exited, "The orchestrator must exit before stimulus begins.");
      assertStimulusResult({
        request_count: event.request_count,
        route: event.route ?? "/agency-lab/lead-ingress",
        transport_responses: event.transport_responses ?? [{ status: 202 }, { status: 202 }],
        authored: event.authored ?? emptyAuthorship()
      });
      state.stimulus_completed = true;
      state.stage = "stimulus_completed";
      break;
    case "verifier.completed":
      requireState(state.stimulus_completed, "Stimulus must finish before verification.");
      assertVerifierResult(event.result);
      state.verification_completed = true;
      state.stage = "verification_completed";
      break;
    default:
      throw new Error(`Unknown acceptance transition: ${event.type}`);
  }
  state.timeline.push(event.type);
  return state;
}

export function emptyAuthorship() {
  return {
    observations: 0,
    projections: 0,
    packages: 0,
    assignments: 0,
    worker_outputs: 0,
    hidden_assertions: 0
  };
}

export function assertStimulusResult(result) {
  assert.equal(result.request_count, 2, "Scenario Stimulus must send exactly two ingress requests.");
  assert.equal(result.route, "/agency-lab/lead-ingress", "Scenario Stimulus may reach only customer ingress.");
  assert.equal(result.transport_responses?.length, 2, "Scenario Stimulus records exactly two transport responses.");
  assert.deepEqual(result.authored, emptyAuthorship(), "Scenario Stimulus cannot author diagnostic material.");
}

export function assertVerifierResult(result) {
  assert.equal(result.read_only, true, "Acceptance Verifier must be read-only.");
  assert.deepEqual(result.writes, [], "Acceptance Verifier writes are prohibited.");
  assert.equal(result.model_requests, 0, "Acceptance Verifier cannot contact a model.");
  const allowedReads = new Set(["diagnostic-status", "kernel-audit"]);
  assert.ok(result.reads.every((read) => allowedReads.has(read)), "Acceptance Verifier used an unauthorized read.");
}

export function missingCapability(state) {
  if (state.readiness_confirmed && !state.grant_applications_verified) {
    return "durable_grant_application_protocol";
  }
  return null;
}
