import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import { createEncryptedBackup, openEncryptedBackup } from "../../src/backup-bundle.js";

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("encrypted local backup authenticates PostgreSQL and content-addressed artifacts", () => {
  const key = randomBytes(32);
  const artifact = Buffer.from("trusted adapter bytes");
  const bundle = createEncryptedBackup({ backupId: "backup-1",
    environmentId: "00000000-0000-4000-8000-000000000001", restorePointSequence: 42, executionEpoch: 7,
    postgresDump: Buffer.from("postgres custom dump"), artifacts: [{ digest: digest(artifact), bytes: artifact }],
    key, keyId: "backup-key-v1", createdAt: "2030-01-01T00:00:00.000Z" });
  const opened = openEncryptedBackup(bundle, key);
  assert.equal(opened.postgresDump.toString(), "postgres custom dump");
  assert.equal(opened.artifacts[0].bytes.toString(), "trusted adapter bytes");
  assert.equal(opened.manifest.encryption.algorithm, "aes-256-gcm");
});

test("backup authentication fails closed for changed ciphertext, key, manifest, or artifact digest", () => {
  const key = randomBytes(32);
  const artifact = Buffer.from("artifact");
  const args = { backupId: "backup-2", environmentId: "00000000-0000-4000-8000-000000000001",
    restorePointSequence: 1, executionEpoch: 1, postgresDump: Buffer.from("dump"),
    artifacts: [{ digest: digest(artifact), bytes: artifact }], key, keyId: "key" };
  const bundle = createEncryptedBackup(args);
  assert.throws(() => openEncryptedBackup(bundle, randomBytes(32)), (error) => error.code === "BACKUP_DECRYPTION_FAILED");
  assert.throws(() => openEncryptedBackup({ ...bundle, manifest: { ...bundle.manifest, execution_epoch: 2 } }, key),
    (error) => error.code === "BACKUP_MANIFEST_DIGEST_MISMATCH");
  assert.throws(() => createEncryptedBackup({ ...args, artifacts: [{ digest: `sha256:${"a".repeat(64)}`, bytes: artifact }] }),
    (error) => error.code === "ARTIFACT_DIGEST_MISMATCH");
});
