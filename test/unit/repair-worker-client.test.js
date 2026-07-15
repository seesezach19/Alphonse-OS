import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { withEphemeralRepairWorkspace } from "../../src/repair-worker-client.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

test("customer worker materializes exact inputs and destroys the workspace", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "alphonse-worker-test-"));
  let workspaceRoot;
  try {
    const result = await withEphemeralRepairWorkspace({
      schema_version: "0.2.0",
      task_id: "00000000-0000-4000-8000-000000000501",
      lease_epoch: 1,
      ephemeral: true,
      ambient_filesystem_access: false,
      files: [
        { path: "inputs/base-revision.json", artifact_digest: digest("a") },
        { path: "inputs/reproduction-bundle.json", artifact_digest: digest("b") }
      ]
    }, async (artifactDigest) => ({
      artifact_digest: artifactDigest,
      verified: true,
      content: { bound_digest: artifactDigest }
    }), async ({ root }) => {
      workspaceRoot = root;
      const base = JSON.parse(await readFile(path.join(root, "inputs", "base-revision.json"), "utf8"));
      const bundle = JSON.parse(await readFile(path.join(root, "inputs", "reproduction-bundle.json"), "utf8"));
      assert.equal(base.bound_digest, digest("a"));
      assert.equal(bundle.bound_digest, digest("b"));
      return "worker-finished";
    }, temporaryRoot);
    assert.equal(result, "worker-finished");
    await assert.rejects(access(workspaceRoot));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("workspace traversal is rejected and cleaned", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "alphonse-worker-test-"));
  try {
    await assert.rejects(withEphemeralRepairWorkspace({
      ephemeral: true,
      ambient_filesystem_access: false,
      files: [{ path: "../outside.json", artifact_digest: digest("c") }]
    }, async () => ({ artifact_digest: digest("c"), verified: true, content: {} }), async () => {}, temporaryRoot),
    (error) => error.code === "INVALID_WORKSPACE_PATH");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
