import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const baseUrl = "http://127.0.0.1:43101";
const authHeaders = { authorization: "Bearer local-development-bootstrap-token" };
const composeEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "alphonse-kernel-ticket-01-acceptance",
  KERNEL_PORT: "43101",
  POSTGRES_PORT: "45432",
  DATA_PLANE_PORT: "43111"
};

function compose(...args) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: new URL("..", import.meta.url),
    env: composeEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

async function json(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function waitUntilHealthy() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Kernel did not become healthy.");
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait");

  const bootstrap = await json("/kernel/v0/bootstrap");
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.body.status, "healthy");
  assert.equal(bootstrap.body.protocol.version, "0.1.0");
  assert.equal(bootstrap.body.environment.installation_id, "00000000-0000-4000-8000-00000000a001");
  assert.equal(bootstrap.body.environment.environment_id, "00000000-0000-4000-8000-000000000001");
  assert.ok(bootstrap.body.operations.some((item) => item.operation_id === "kernel.environment.profile.update"));

  const butler = await json("/kernel/v0/accountable-work/overview", { headers: authHeaders });
  assert.equal(butler.response.status, 200);
  assert.equal(butler.body.health, "healthy");
  assert.deepEqual(butler.body.accountable_work, { count: 0, items: [] });
  assert.equal(butler.body.authority, "read_only_projection");

  const command = {
    command_id: "ticket-01-profile-update",
    operation_id: "kernel.environment.profile.update",
    input: { display_name: "Ticket 01 Acceptance", expected_revision: 0 }
  };
  const commandOptions = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer local-development-bootstrap-token"
    },
    body: JSON.stringify(command)
  };

  const unauthenticated = await json("/kernel/v0/commands", {
    ...commandOptions,
    headers: { "content-type": "application/json" }
  });
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.error.code, "AUTHENTICATION_REQUIRED");

  const accepted = await json("/kernel/v0/commands", commandOptions);
  assert.equal(accepted.response.status, 201);
  assert.equal(accepted.response.headers.get("idempotent-replayed"), "false");
  assert.equal(accepted.body.environment.revision, "1");

  const replayed = await json("/kernel/v0/commands", commandOptions);
  assert.equal(replayed.response.status, 200);
  assert.equal(replayed.response.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(replayed.body, accepted.body);

  const changed = await json("/kernel/v0/commands", {
    ...commandOptions,
    body: JSON.stringify({ ...command, input: { display_name: "Different Input", expected_revision: 1 } })
  });
  assert.equal(changed.response.status, 409);
  assert.equal(changed.body.error.code, "IDEMPOTENCY_CONFLICT");

  const receipt = await json(`/kernel/v0/commands/${command.command_id}`, { headers: authHeaders });
  assert.equal(receipt.response.status, 200);
  assert.equal(receipt.body.transition.type, "kernel.environment.profile.updated");
  assert.equal(receipt.body.transition.from_revision, "0");
  assert.equal(receipt.body.transition.to_revision, "1");
  assert.deepEqual(receipt.body.actor, { type: "human", id: "local-bootstrap-operator" });
  assert.equal(receipt.body.outbox.event_type, "kernel.environment.profile.updated");
  assert.equal(receipt.body.outbox.delivery_status, "pending");

  const beforeRestart = await json("/kernel/v0/environments/current");
  compose("stop");
  compose("up", "--wait");
  await waitUntilHealthy();
  const afterRestart = await json("/kernel/v0/environments/current");
  assert.deepEqual(afterRestart.body, beforeRestart.body);

  const persistedReceipt = await json(`/kernel/v0/commands/${command.command_id}`, { headers: authHeaders });
  assert.deepEqual(persistedReceipt.body, receipt.body);

  console.log("Ticket 01 black-box acceptance passed.");
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
