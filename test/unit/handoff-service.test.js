import assert from "node:assert/strict";
import test from "node:test";

import { validateHandoffInput } from "../../src/handoff-service.js";

const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const hash = (character) => `sha256:${character.repeat(64)}`;

function validInput() {
  return {
    source_passport_id: id("1"), target_passport_id: id("2"), work_intent_id: id("3"),
    target_runtime: { kind: "docker", version: "26" },
    exact_bindings: {
      package_version_id: id("4"), package_artifact_digest: hash("a"),
      skill: { package_id: "dev.example.runtime", semantic_version: "1.0.0", export_id: "inventory-worker",
        contract_version: "1.0.0", export_digest: hash("b") },
      deployment_id: id("5"), capability_activation_id: id("6"), capability_export_id: "inventory_correction",
      capability_contract_version: "1.0.0", capability_export_digest: hash("c"), authority_digest: hash("d")
    },
    context_receipt_ids: [id("7")], delegation_proposal: { scope: { capability: "inventory_correction" },
      expires_at: "2030-01-01T00:05:00.000Z" }, open_obligations: [],
    workload: { run_intent: "Observe one inventory correction task.", workload_digest: hash("e"),
      adapter: "docker-local-v1", resources: { memory_mb: 128, cpu_millis: 500, pids: 32 },
      network: { mode: "none" }, filesystem: { root: "read_only", scratch_mb: 16, mounts: [] }, lease_seconds: 60 },
    expires_at: "2030-01-01T00:10:00.000Z"
  };
}

test("exact handoff accepts structured state and bounded workload", () => {
  const result = validateHandoffInput(validInput());
  assert.equal(result.workload.network.mode, "none");
  assert.equal(result.workload.filesystem.root, "read_only");
  assert.deepEqual(result.open_obligations, []);
});

test("conversation history and hidden memory reject at any depth", () => {
  for (const forbidden of ["conversation_history", "messages", "hidden_memory", "transcript", "chat_history"]) {
    const input = validInput();
    input.open_obligations.push({ [forbidden]: ["ambient state"] });
    assert.throws(() => validateHandoffInput(input), (error) => error.code === "AMBIENT_MEMORY_PROHIBITED");
  }
});

test("network, root filesystem, mounts, resources, and lease remain bounded", () => {
  const cases = [
    (input) => { input.workload.network.mode = "bridge"; },
    (input) => { input.workload.filesystem.root = "read_write"; },
    (input) => { input.workload.filesystem.mounts = ["/var/run/docker.sock"]; },
    (input) => { input.workload.resources.memory_mb = 8192; },
    (input) => { input.workload.lease_seconds = 901; }
  ];
  for (const mutate of cases) {
    const input = validInput();
    mutate(input);
    assert.throws(() => validateHandoffInput(input));
  }
});
