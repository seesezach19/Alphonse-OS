import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import { validateLifecycleInput, validateRestoreBeginInput } from "../../src/restore-service.js";

function manifest() {
  return { schema_version: "alphonse.local_backup.v0.1", backup_id: "backup-1",
    environment_id: "00000000-0000-4000-8000-000000000001", restore_point_sequence: 12, execution_epoch: 3,
    postgres_dump_digest: `sha256:${"a".repeat(64)}`, artifacts: [{ digest: `sha256:${"b".repeat(64)}`, size_bytes: 12 }],
    created_at: "2030-01-01T00:00:00.000Z", encryption: { algorithm: "aes-256-gcm", key_id: "local-v1" } };
}

test("restore admission binds exact authenticated backup manifest", () => {
  const backupManifest = manifest();
  const input = validateRestoreBeginInput({ backup_manifest: backupManifest,
    backup_manifest_digest: sha256Digest(backupManifest) });
  assert.equal(input.backup_manifest.restore_point_sequence, 12);
  assert.throws(() => validateRestoreBeginInput({ backup_manifest: backupManifest,
    backup_manifest_digest: `sha256:${"c".repeat(64)}` }), (error) => error.code === "BACKUP_MANIFEST_DIGEST_MISMATCH");
});

test("restore admission accepts the complete authenticated single-tenant backup scope", () => {
  const backupManifest = {
    schema_version: "alphonse.single_tenant_backup.v0.2", backup_id: "backup-release-1",
    environment_id: "00000000-0000-4000-8000-000000000001", restore_point_sequence: 14,
    execution_epoch: 2,
    database_dumps: [
      { name: "kernel", digest: `sha256:${"a".repeat(64)}`, size_bytes: 100 },
      { name: "diagnostic", digest: `sha256:${"b".repeat(64)}`, size_bytes: 200 }
    ],
    store_archives: [
      { name: "diagnostic_artifacts", digest: `sha256:${"c".repeat(64)}`, size_bytes: 300 },
      { name: "n8n_adapter_state", digest: `sha256:${"d".repeat(64)}`, size_bytes: 400 },
      { name: "n8n_customer_state", digest: `sha256:${"e".repeat(64)}`, size_bytes: 500 }
    ],
    artifacts: [{ digest: `sha256:${"f".repeat(64)}`, size_bytes: 12 }],
    created_at: "2030-01-01T00:00:00.000Z",
    encryption: { algorithm: "aes-256-gcm", key_id: "release-backup-key-v1" }
  };
  const input = validateRestoreBeginInput({ backup_manifest: backupManifest,
    backup_manifest_digest: sha256Digest(backupManifest) });
  assert.equal(input.backup_manifest.database_dumps.length, 2);
  assert.throws(() => validateRestoreBeginInput({ backup_manifest: { ...backupManifest,
    database_dumps: backupManifest.database_dumps.filter((item) => item.name !== "diagnostic") },
  backup_manifest_digest: sha256Digest({ ...backupManifest,
    database_dumps: backupManifest.database_dumps.filter((item) => item.name !== "diagnostic") }) }),
  (error) => error.code === "INCOMPLETE_BACKUP_SCOPE");
});

test("retention semantics remain four explicit non-interchangeable actions", () => {
  const kinds = ["typed_tombstone", "authority_expiration", "identity_pseudonymization", "environment_destruction"];
  const validated = kinds.map((lifecycle_kind) => validateLifecycleInput({ lifecycle_kind,
    subject_type: "record", subject_id: "subject-1", detail: { reason: lifecycle_kind } }).lifecycle_kind);
  assert.deepEqual(validated, kinds);
  assert.throws(() => validateLifecycleInput({ lifecycle_kind: "delete", subject_type: "record",
    subject_id: "subject-1", detail: {} }), (error) => error.code === "INVALID_LIFECYCLE_KIND");
});
