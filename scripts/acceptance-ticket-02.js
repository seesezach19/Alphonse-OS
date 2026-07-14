import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const baseUrl = "http://127.0.0.1:43102";
const authHeaders = {
  "content-type": "application/json",
  authorization: "Bearer local-development-bootstrap-token"
};
const composeEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "alphonse-kernel-ticket-02-acceptance",
  KERNEL_PORT: "43102",
  POSTGRES_PORT: "45433",
  DATA_PLANE_PORT: "43112"
};

function compose(...args) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: new URL("..", import.meta.url), env: composeEnvironment, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
}

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...authHeaders, ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}

async function post(path, body) {
  return json(path, { method: "POST", headers: authHeaders, body: JSON.stringify(body) });
}

async function postAgent(path, body, token) {
  return json(path, { method: "POST", headers: { authorization: `Agent ${token}` }, body: JSON.stringify(body) });
}

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

async function waitUntilHealthy() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Kernel did not become healthy.");
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait");

  const prematureAgent = await post("/kernel/v0/principals", command("principal-agent-too-early",
    "kernel.principal.create", { principal_type: "agent", display_name: "Builder Agent" }));
  assert.equal(prematureAgent.response.status, 409);
  assert.equal(prematureAgent.body.error.code, "SPONSOR_PRINCIPAL_REQUIRED");

  const human = await post("/kernel/v0/principals", command("principal-human",
    "kernel.principal.create", { principal_type: "human", display_name: "Zach Operator" }));
  assert.equal(human.response.status, 201);
  assert.equal(human.body.principal.authority_granted, false);
  const humanId = human.body.principal.principal_id;
  const inspectedHuman = await json(`/kernel/v0/principals/${humanId}`);
  assert.equal(inspectedHuman.body.principal.principal_type, "human");
  const humanReplay = await post("/kernel/v0/principals", command("principal-human",
    "kernel.principal.create", { principal_type: "human", display_name: "Zach Operator" }));
  assert.equal(humanReplay.response.status, 200);
  assert.equal(humanReplay.response.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(humanReplay.body, human.body);

  const agent = await post("/kernel/v0/principals", command("principal-agent",
    "kernel.principal.create", { principal_type: "agent", display_name: "Builder Agent" }));
  assert.equal(agent.response.status, 201);
  const agentId = agent.body.principal.principal_id;
  const inspectedAgent = await json(`/kernel/v0/principals/${agentId}`);
  assert.equal(inspectedAgent.body.principal.principal_type, "agent");
  assert.equal(inspectedAgent.body.principal.authority_granted, false);

  const now = Date.now();
  const validFrom = new Date(now - 60_000).toISOString();
  const validUntil = new Date(now + 3_600_000).toISOString();
  const passportInput = {
    agent_principal_id: agentId,
    sponsor_principal_id: humanId,
    runtime: { kind: "codex", version: "workspace" },
    model_configuration: { provider: "openai", model: "frontier" },
    package_skill_configuration: { packages: [], skills: ["wayfinder", "to-spec", "implement"] },
    agent_authentication_token: "ticket-02-agent-token-0000000000000001",
    permitted_intent_classes: ["package_build"],
    provenance: { source: "ticket-02-acceptance" },
    valid_from: validFrom,
    expires_at: validUntil
  };
  const passport = await post("/kernel/v0/agent-passports", command("passport-valid",
    "kernel.agent_passport.issue", passportInput));
  assert.equal(passport.response.status, 201);
  assert.equal(passport.body.passport.validity_status, "valid");
  assert.equal(passport.body.passport.authority_granted, false);
  const passportId = passport.body.passport.passport_id;

  const proposal = await postAgent("/kernel/v0/work-intent-proposals", command("intent-proposal",
    "kernel.work_intent.propose", {
      passport_id: passportId,
      intent_class: "package_build",
      objective: "Build an inventory discrepancy Operational Package.",
      requested_outcome: "Produce a validated inert package candidate.",
      scope: { systems: ["reference-erp", "reference-storefront"] },
      constraints: { no_customer_context: true, no_external_effects: true }
    }), passportInput.agent_authentication_token);
  assert.equal(proposal.response.status, 201);
  assert.equal(proposal.body.proposal.status, "proposed");
  assert.equal(proposal.body.proposal.authority_granted, false);
  const proposalId = proposal.body.proposal.proposal_id;

  const publicDiscovery = await post("/kernel/v0/admission/check", {
    passport_id: passportId, proposal_id: proposalId, access_class: "public_discovery"
  });
  assert.equal(publicDiscovery.response.status, 200);
  assert.deepEqual(publicDiscovery.body, { allowed: true, basis: "provisional_intent", authority_granted: false });

  const provisionalContext = await post("/kernel/v0/admission/check", {
    passport_id: passportId, proposal_id: proposalId, access_class: "customer_context"
  });
  assert.equal(provisionalContext.response.status, 403);
  assert.equal(provisionalContext.body.error.code, "PROVISIONAL_INTENT_LIMIT");
  const provisionalEffect = await post("/kernel/v0/admission/check", {
    passport_id: passportId, proposal_id: proposalId, access_class: "external_effect"
  });
  assert.equal(provisionalEffect.body.error.code, "PROVISIONAL_INTENT_LIMIT");

  const confirmationCommand = command("intent-confirm", "kernel.work_intent.confirm", {});
  const confirmed = await post(`/kernel/v0/work-intent-proposals/${proposalId}/confirm`, confirmationCommand);
  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.body.work_intent.authority_granted, false);
  const workIntentId = confirmed.body.work_intent.work_intent_id;
  const replayedConfirmation = await post(`/kernel/v0/work-intent-proposals/${proposalId}/confirm`, confirmationCommand);
  assert.equal(replayedConfirmation.response.status, 200);
  assert.equal(replayedConfirmation.response.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(replayedConfirmation.body, confirmed.body);

  const inspectedProposal = await json(`/kernel/v0/work-intent-proposals/${proposalId}`);
  assert.equal(inspectedProposal.body.proposal.status, "confirmed");
  assert.equal(inspectedProposal.body.proposal.work_intent_id, workIntentId);

  const confirmedEffect = await post("/kernel/v0/admission/check", {
    passport_id: passportId, work_intent_id: workIntentId, access_class: "external_effect"
  });
  assert.equal(confirmedEffect.response.status, 403);
  assert.equal(confirmedEffect.body.error.code, "AUTHORITY_NOT_GRANTED");

  const secondPassport = await post("/kernel/v0/agent-passports", command("passport-second",
    "kernel.agent_passport.issue", { ...passportInput, agent_authentication_token: "ticket-02-agent-token-0000000000000002" }));
  assert.equal(secondPassport.response.status, 201);
  const mismatchedSession = await post("/kernel/v0/build-sessions", command("session-mismatch",
    "kernel.build_session.open", {
      principal_id: agentId,
      passport_id: secondPassport.body.passport.passport_id,
      work_intent_id: workIntentId,
      base_references: { kernel_protocol: "0.1.0", toolkit_digest: `sha256:${"1".repeat(64)}` },
      expires_at: new Date(now + 1_800_000).toISOString()
    }));
  assert.equal(mismatchedSession.response.status, 409);
  assert.equal(mismatchedSession.body.error.code, "PASSPORT_INTENT_MISMATCH");

  const expiredPassport = await post("/kernel/v0/agent-passports", command("passport-expired",
    "kernel.agent_passport.issue", { ...passportInput, valid_from: "2020-01-01T00:00:00.000Z",
      expires_at: "2021-01-01T00:00:00.000Z", agent_authentication_token: "ticket-02-agent-token-0000000000000003" }));
  assert.equal(expiredPassport.response.status, 201);
  const expiredProposal = await postAgent("/kernel/v0/work-intent-proposals", command("proposal-expired",
    "kernel.work_intent.propose", { passport_id: expiredPassport.body.passport.passport_id,
      intent_class: "package_build", objective: "Should fail", requested_outcome: "Nothing",
      scope: {}, constraints: {} }), "ticket-02-agent-token-0000000000000003");
  assert.equal(expiredProposal.response.status, 409);
  assert.equal(expiredProposal.body.error.code, "PASSPORT_EXPIRED");

  const buildSession = await post("/kernel/v0/build-sessions", command("session-valid",
    "kernel.build_session.open", {
      principal_id: agentId,
      passport_id: passportId,
      work_intent_id: workIntentId,
      base_references: { kernel_protocol: "0.1.0", toolkit_digest: `sha256:${"0".repeat(64)}` },
      expires_at: new Date(now + 1_800_000).toISOString()
    }));
  assert.equal(buildSession.response.status, 201);
  assert.equal(buildSession.body.build_session.status, "active");
  assert.equal(Object.hasOwn(buildSession.body.build_session, "draft_contents"), false);
  const buildSessionId = buildSession.body.build_session.build_session_id;

  const inspectedSession = await json(`/kernel/v0/build-sessions/${buildSessionId}`);
  assert.equal(inspectedSession.body.build_session.work_intent_id, workIntentId);
  assert.equal(inspectedSession.body.build_session.authority_granted, false);

  const butler = await json("/kernel/v0/accountable-work/overview");
  assert.equal(butler.body.accountable_work.count, 1);
  const thread = butler.body.accountable_work.items[0];
  assert.equal(thread.identity.agent_principal_id, agentId);
  assert.equal(thread.intent.work_intent_id, workIntentId);
  assert.equal(thread.build_session.build_session_id, buildSessionId);
  assert.deepEqual(thread.authority, { context_access: "not_granted", effects: "not_granted", execution: "not_granted" });
  const malformed = await json("/kernel/v0/agent-passports/not-a-uuid");
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.body.error.code, "INVALID_IDENTIFIER");
  const butlerHtml = await fetch(`${baseUrl}/butler`, { headers: { authorization: `Basic ${Buffer.from("operator:local-development-bootstrap-token").toString("base64")}` } });
  assert.equal(butlerHtml.status, 200);
  const visibleThread = await butlerHtml.text();
  assert.match(visibleThread, /Builder Agent/);
  assert.match(visibleThread, /not_granted/);

  compose("stop");
  compose("up", "--wait");
  await waitUntilHealthy();
  const persistedButler = await json("/kernel/v0/accountable-work/overview");
  assert.equal(persistedButler.body.accountable_work.items[0].build_session.build_session_id, buildSessionId);

  console.log("Ticket 02 black-box acceptance passed.");
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
