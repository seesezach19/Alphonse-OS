import assert from "node:assert/strict";
import test from "node:test";

import { signRegistryAccessGrant, verifyRegistryAccessGrant } from "../../src/registry-access-grant.js";

function grant(overrides = {}) {
  return { schema_version: "alphonse.registry_access_grant.v0.1", grant_id: "grant-1",
    registry_id: "registry:primary", subject_id: "builder:one", actions: ["publish", "download"],
    package_scopes: ["com.alphonse.*"], issued_at: "2030-01-01T00:00:00.000Z",
    expires_at: "2030-01-01T01:00:00.000Z", ...overrides };
}

test("registry access grant binds registry, action, package scope, and expiry", () => {
  const document = grant();
  const token = signRegistryAccessGrant(document, "secret");
  assert.equal(verifyRegistryAccessGrant(token, "secret", { registryId: "registry:primary",
    action: "publish", packageId: "com.alphonse.inventory", now: "2030-01-01T00:30:00.000Z" }).grant_id,
  "grant-1");
  for (const input of [
    { registryId: "registry:mirror", action: "publish", packageId: "com.alphonse.inventory" },
    { registryId: "registry:primary", action: "advise", packageId: "com.alphonse.inventory" },
    { registryId: "registry:primary", action: "publish", packageId: "com.other.inventory" }
  ]) {
    assert.throws(() => verifyRegistryAccessGrant(token, "secret", {
      ...input, now: "2030-01-01T00:30:00.000Z"
    }), /does not admit/i);
  }
  assert.throws(() => verifyRegistryAccessGrant(token, "secret", { registryId: "registry:primary",
    action: "publish", packageId: "com.alphonse.inventory", now: "2030-01-01T02:00:00.000Z" }),
  /does not admit/i);
  const malformed = signRegistryAccessGrant(grant({ issued_at: "not-a-time", expires_at: "also-not-a-time" }),
    "secret");
  assert.throws(() => verifyRegistryAccessGrant(malformed, "secret", { registryId: "registry:primary",
    action: "publish", packageId: "com.alphonse.inventory", now: "2030-01-01T00:30:00.000Z" }),
  /does not admit/i);
});
