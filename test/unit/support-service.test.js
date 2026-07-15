import assert from "node:assert/strict";
import test from "node:test";

import { environmentHealthProjection } from "../../src/hosted-coordinator-service.js";
import { decryptDiagnosticBundle, encryptDiagnosticBundle, supportCredentialDigest } from "../../src/support-service.js";

const secret = "test-only-diagnostic-encryption-secret-32-bytes";

test("missing and stale health project unknown rather than failure", () => {
  assert.deepEqual(environmentHealthProjection(null), {
    status: "unknown", freshness: "missing", observed_at: null, expires_at: null
  });
  const stale = environmentHealthProjection({ health: { document: {
    status: "blocked", counters: { outbox_lag: 2 }, issued_at: "2030-01-01T00:00:00.000Z",
    expires_at: "2030-01-01T00:01:00.000Z"
  } } }, new Date("2030-01-01T00:02:00.000Z"));
  assert.equal(stale.status, "unknown");
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.counters, undefined);
});

test("fresh health exposes only the signed coarse projection", () => {
  const projection = environmentHealthProjection({ health: { document: {
    status: "healthy", counters: { outbox_lag: 0, unresolved_obligations: 0, quarantined_hosts: 0,
      restore_suspended: false }, issued_at: "2030-01-01T00:00:00.000Z",
    expires_at: "2030-01-01T00:02:00.000Z"
  } } }, new Date("2030-01-01T00:01:00.000Z"));
  assert.equal(projection.status, "healthy");
  assert.equal(projection.freshness, "fresh");
  assert.deepEqual(Object.keys(projection.counters).sort(),
    ["outbox_lag", "quarantined_hosts", "restore_suspended", "unresolved_obligations"]);
});

test("diagnostic bundles encrypt, authenticate, and detect tampering", () => {
  const content = { schema_version: "alphonse.redacted_diagnostics.v0.1", scopes: {
    kernel_health: { status: "healthy" }
  } };
  const bundle = encryptDiagnosticBundle(content, secret);
  assert.notEqual(bundle.ciphertext, JSON.stringify(content));
  assert.deepEqual(decryptDiagnosticBundle(bundle, secret), content);
  const tampered = { ...bundle, ciphertext: `${bundle.ciphertext[0] === "A" ? "B" : "A"}${bundle.ciphertext.slice(1)}` };
  assert.throws(() => decryptDiagnosticBundle(tampered, secret));
});

test("support credential hashing is standard SHA-256 over raw credential bytes", () => {
  assert.equal(supportCredentialDigest("support-token"),
    "sha256:ebca95604276a73fb41ea1ae6556b45bf815fa9733bc6e7a7be1316f9c3e8a89");
});
