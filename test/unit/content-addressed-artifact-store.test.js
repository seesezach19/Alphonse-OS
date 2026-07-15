import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createContentAddressedArtifactStore } from "../../src/content-addressed-artifact-store.js";

test("content-addressed JSON ignores key order and verifies bytes on retrieval", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alphonse-diagnostic-artifacts-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = createContentAddressedArtifactStore(root);

  const first = await store.putJson({ workflow: { b: 2, a: 1 } });
  const equivalent = await store.putJson({ workflow: { a: 1, b: 2 } });
  assert.deepEqual(equivalent, first);

  const retrieved = await store.getJson(first.artifact_digest);
  assert.deepEqual(retrieved.content, { workflow: { a: 1, b: 2 } });
  assert.equal(retrieved.artifact.verified, true);

  await writeFile(path.join(root, first.storage_key), "corrupted", "utf8");
  await assert.rejects(store.putJson({ workflow: { a: 1, b: 2 } }), (error) => {
    assert.equal(error.code, "ARTIFACT_DIGEST_MISMATCH");
    return true;
  });
  await assert.rejects(store.getJson(first.artifact_digest), (error) => {
    assert.equal(error.code, "ARTIFACT_DIGEST_MISMATCH");
    return true;
  });
});

test("artifact retrieval rejects malformed digests before filesystem access", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alphonse-diagnostic-artifacts-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = createContentAddressedArtifactStore(root);

  await assert.rejects(store.getJson("../../kernel-secret"), (error) => {
    assert.equal(error.code, "INVALID_ARTIFACT_DIGEST");
    return true;
  });
});

test("artifact byte deletion is exact and leaves metadata decisions to the caller", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alphonse-diagnostic-artifacts-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = createContentAddressedArtifactStore(root);
  const stored = await store.putJson({ selected_payload: true });

  assert.deepEqual(await store.deleteJson(stored.artifact_digest), {
    artifact_digest: stored.artifact_digest,
    bytes_deleted: true
  });
  await assert.rejects(store.getJson(stored.artifact_digest), (error) => error.code === "ARTIFACT_NOT_FOUND");
  assert.deepEqual(await store.deleteJson(stored.artifact_digest), {
    artifact_digest: stored.artifact_digest,
    bytes_deleted: false
  });
  await assert.rejects(store.deleteJson("../../outside"), (error) => error.code === "INVALID_ARTIFACT_DIGEST");
});
