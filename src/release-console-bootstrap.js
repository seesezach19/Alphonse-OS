// @ts-check

const baseUrl = process.env.RELEASE_BOOTSTRAP_KERNEL_URL ?? "http://kernel:3000";
const ownerToken = process.env.KERNEL_OWNER_TOKEN;
const operatorToken = process.env.CONSOLE_OPERATOR_AGENT_TOKEN;
if (!ownerToken || !operatorToken) throw new Error("Owner and Console Operator credentials are required.");

/** @param {string} path @param {Record<string, any>} command */
async function admit(path, command) {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { authorization: `Owner ${ownerToken}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json();
  if (![200, 201].includes(response.status)) throw new Error(`${path} failed: ${JSON.stringify(body)}`);
  return body;
}

const human = await admit("/kernel/v0/principals", {
  command_id: "release-v0.2-console-owner-principal",
  operation_id: "kernel.principal.create",
  input: { principal_type: "human", display_name: "Single-tenant Release Owner" }
});
const operator = await admit("/kernel/v0/principals", {
  command_id: "release-v0.2-console-operator-principal",
  operation_id: "kernel.principal.create",
  input: { principal_type: "agent", display_name: "Bounded Operations Console Operator" }
});
const passport = await admit("/kernel/v0/agent-passports", {
  command_id: "release-v0.2-console-operator-passport-2026",
  operation_id: "kernel.agent_passport.issue",
  input: {
    agent_principal_id: operator.principal.principal_id,
    sponsor_principal_id: human.principal.principal_id,
    runtime: { kind: "operations-console", version: "0.1.0" },
    model_configuration: { provider: "none", model: "typed-controls-only" },
    package_skill_configuration: {
      protocol: "alphonse-trusted-operator-0.2.0",
      operator_operations: ["diagnostic.console_snapshot.get", "diagnostic.console_worker.suspend",
        "diagnostic.console_workflow.quarantine"]
    },
    agent_authentication_token: operatorToken,
    permitted_intent_classes: ["trusted_operator"],
    provenance: { source: "single-tenant-release-installer", release: "0.2.0" },
    valid_from: "2026-01-01T00:00:00.000Z",
    expires_at: "2036-01-01T00:00:00.000Z"
  }
});

console.log(JSON.stringify({
  console_operator: "admitted",
  principal_id: operator.principal.principal_id,
  passport_id: passport.passport.passport_id,
  expires_at: passport.passport.expires_at
}));
