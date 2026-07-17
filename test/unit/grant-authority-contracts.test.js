import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignedGrantActivationSnapshot,
  createSignedGrantApplicationReceipt,
  validateGrantApplicationReceipt,
  validateGrantSnapshotTransition,
  verifySignedGrantActivationSnapshot,
  verifySignedGrantApplicationReceipt
} from "../../src/grant-authority-contracts.js";

const AUTHORITY_SECRET = "authority-snapshot-secret-with-sufficient-length-v1";
const RECEIVER_SECRET = "diagnostic-application-secret-with-sufficient-length-v1";
const installationId = "00000000-0000-4000-8000-00000000a001";
const environmentId = "00000000-0000-4000-8000-000000000001";
const grantId = "00000000-0000-4000-8000-000000000201";
const snapshotId = "00000000-0000-4000-8000-000000000202";
const receiptId = "00000000-0000-4000-8000-000000000203";

function activationSnapshot(overrides = {}) {
  return createSignedGrantActivationSnapshot({
    snapshot_id: snapshotId,
    grant_id: grantId,
    grant_type: "observation_reporting",
    installation_id: installationId,
    environment_id: environmentId,
    receiver_service_id: "diagnostic-plane",
    grant_document: {
      principal_id: "observer:test",
      stream_id: "stream:test",
      allowed_schema_tuples: [{
        schema_id: "schema:test",
        schema_version: "0.1.0",
        schema_digest: `sha256:${"3".repeat(64)}`
      }]
    },
    authority_sequence: "1",
    predecessor_snapshot_digest: null,
    target_state: "active",
    grant_digest: "sha256:b2a503125efb4fea4d2522e06a1ac956aa02d13f2025a1c9570f625fbbe11344",
    readiness_receipt_digest: `sha256:${"2".repeat(64)}`,
    issued_at: "2026-07-16T18:00:00.000Z",
    expires_at: "2026-07-16T18:10:00.000Z",
    ...overrides
  }, {
    keyId: "kernel-grant-authority-key-v1",
    secret: AUTHORITY_SECRET,
    signedAt: "2026-07-16T18:00:00.000Z"
  });
}

function applicationReceipt(snapshot, overrides = {}) {
  return createSignedGrantApplicationReceipt({
    application_receipt_id: receiptId,
    service_id: "diagnostic-plane",
    installation_id: installationId,
    environment_id: environmentId,
    grant_id: grantId,
    snapshot_id: snapshot.document.snapshot_id,
    snapshot_digest: snapshot.digest,
    authority_sequence: snapshot.document.authority_sequence,
    predecessor_snapshot_digest: snapshot.document.predecessor_snapshot_digest,
    applied_state: snapshot.document.target_state,
    service_transaction_id: "00000000-0000-4000-8000-000000000204",
    service_transaction_position: "1",
    applied_at: "2026-07-16T18:00:01.000Z",
    ...overrides
  }, {
    keyId: "diagnostic-plane-application-key-v1",
    secret: RECEIVER_SECRET,
    signedAt: "2026-07-16T18:00:01.000Z"
  });
}

test("grant snapshots are canonical, signed, and tamper evident", () => {
  const snapshot = activationSnapshot();
  const verified = verifySignedGrantActivationSnapshot(snapshot.bytes, {
    keyId: "kernel-grant-authority-key-v1",
    secret: AUTHORITY_SECRET,
    now: "2026-07-16T18:00:02.000Z"
  });

  assert.equal(verified.digest, snapshot.digest);
  assert.deepEqual(verified.document, snapshot.document);

  const tampered = JSON.parse(snapshot.bytes);
  tampered.document.target_state = "revoked";
  assert.throws(
    () => verifySignedGrantActivationSnapshot(JSON.stringify(tampered), {
      keyId: "kernel-grant-authority-key-v1",
      secret: AUTHORITY_SECRET,
      now: "2026-07-16T18:00:02.000Z"
    }),
    (error) => error.code === "GRANT_SNAPSHOT_SIGNATURE_INVALID"
  );
});

test("grant transition rejects stale, skipped, and wrong-predecessor snapshots", () => {
  const first = activationSnapshot();
  assert.deepEqual(validateGrantSnapshotTransition(null, first.document), {
    authority_sequence: "1",
    snapshot_digest_required: null,
    effective_state: "active"
  });

  const current = {
    authority_sequence: "1",
    snapshot_digest: first.digest,
    effective_state: "active"
  };
  const validRevocation = activationSnapshot({
    snapshot_id: "00000000-0000-4000-8000-000000000205",
    authority_sequence: "2",
    predecessor_snapshot_digest: first.digest,
    target_state: "revoked"
  });
  assert.equal(validateGrantSnapshotTransition(current, validRevocation.document).effective_state, "revoked");

  for (const snapshot of [
    activationSnapshot({ authority_sequence: "1", predecessor_snapshot_digest: first.digest }),
    activationSnapshot({ authority_sequence: "3", predecessor_snapshot_digest: first.digest }),
    activationSnapshot({ authority_sequence: "2", predecessor_snapshot_digest: `sha256:${"f".repeat(64)}` })
  ]) {
    assert.throws(
      () => validateGrantSnapshotTransition(current, snapshot.document),
      (error) => ["GRANT_SNAPSHOT_STALE", "GRANT_SNAPSHOT_OUT_OF_ORDER", "GRANT_SNAPSHOT_PREDECESSOR_MISMATCH"].includes(error.code)
    );
  }
});

test("application receipts bind the exact receiver transaction and desired snapshot", () => {
  const snapshot = activationSnapshot();
  const receipt = applicationReceipt(snapshot);
  const verified = verifySignedGrantApplicationReceipt(receipt.bytes, {
    keyId: "diagnostic-plane-application-key-v1",
    secret: RECEIVER_SECRET
  });
  assert.equal(verified.digest, receipt.digest);
  assert.equal(validateGrantApplicationReceipt(snapshot, verified, {
    receiverServiceId: "diagnostic-plane"
  }).effective_state, "active_effective");

  const mismatches = [
    ["service_id", "other-service"],
    ["snapshot_digest", `sha256:${"a".repeat(64)}`],
    ["authority_sequence", "2"],
    ["applied_state", "revoked"]
  ];
  for (const [field, value] of mismatches) {
    const changed = applicationReceipt(snapshot, { [field]: value });
    const changedVerified = verifySignedGrantApplicationReceipt(changed.bytes, {
      keyId: "diagnostic-plane-application-key-v1",
      secret: RECEIVER_SECRET
    });
    assert.throws(
      () => validateGrantApplicationReceipt(snapshot, changedVerified, { receiverServiceId: "diagnostic-plane" }),
      (error) => error.code === "GRANT_APPLICATION_BINDING_MISMATCH"
    );
  }
});

test("receipt signature cannot be reused after application material changes", () => {
  const receipt = applicationReceipt(activationSnapshot());
  const changed = JSON.parse(receipt.bytes);
  changed.document.service_transaction_position = "2";
  assert.throws(
    () => verifySignedGrantApplicationReceipt(JSON.stringify(changed), {
      keyId: "diagnostic-plane-application-key-v1",
      secret: RECEIVER_SECRET
    }),
    (error) => error.code === "GRANT_APPLICATION_SIGNATURE_INVALID"
  );
});
