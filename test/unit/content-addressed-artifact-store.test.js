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

test("bounded opaque detail commits by exact digest before metadata can reference it", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alphonse-diagnostic-artifacts-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = createContentAddressedArtifactStore(root);
  const bytes = Buffer.from("redacted diagnostic detail", "utf8");
  const expectedDigest = "sha256:6677837892565a0ec8ded0ecd2f2cab8f528a5e620f40910dac972a81ebc79c8";

  const stored = await store.putBytes(bytes, {
    mediaType: "text/plain",
    expectedDigest,
    maxBytes: 64
  });
  const replay = await store.putBytes(bytes, {
    mediaType: "text/plain",
    expectedDigest,
    maxBytes: 64
  });
  assert.deepEqual(replay, stored);
  const retrieved = await store.getBytes(expectedDigest);
  assert.deepEqual(retrieved.bytes, bytes);
  assert.equal(retrieved.artifact.verified, true);

  await assert.rejects(store.putBytes(Buffer.from("changed"), {
    mediaType: "text/plain", expectedDigest, maxBytes: 64
  }), (error) => error.code === "ARTIFACT_DIGEST_MISMATCH");
  await assert.rejects(store.putBytes(Buffer.alloc(65), {
    mediaType: "application/octet-stream", maxBytes: 64
  }), (error) => error.code === "ARTIFACT_TOO_LARGE");
});
