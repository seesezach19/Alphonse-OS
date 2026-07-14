import assert from "node:assert/strict";
import test from "node:test";

import { createHmac } from "node:crypto";

import { canonicalize, sha256Digest } from "../../src/canonical-json.js";
import { dockerRunArguments, verifyWorkloadGrant } from "../../src/reference-linux-substrate.js";

function grant() {
  return { workload_grant_id: "00000000-0000-4000-8000-000000000001",
    nonce: "00000000-0000-4000-8000-000000000002", workload_digest: `sha256:${"a".repeat(64)}`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    resources: { memory_mb: 128, cpu_millis: 500, pids: 32 }, network: { mode: "none" },
    filesystem: { root: "read_only", scratch_mb: 16, mounts: [] } };
}

test("Docker arguments enforce the V0 Linux workload boundary", () => {
  const args = dockerRunArguments(grant(), "alphonse-reference:ticket-06", "bounded-workload");
  const joined = args.join(" ");
  for (const expected of ["--user 1000:1000", "--read-only", "--cap-drop ALL",
    "--interactive", "--security-opt no-new-privileges:true", "--network none", "--memory 128m", "--cpus 0.5", "--pids-limit 32",
    "/scratch:rw,noexec,nosuid,nodev,size=16m"]) assert.ok(joined.includes(expected), `missing ${expected}`);
  assert.doesNotMatch(joined, /docker\.sock|--volume|-v /);
});

test("reference adapter rejects ambient networking and mounts", () => {
  const networked = grant();
  networked.network.mode = "bridge";
  assert.throws(() => dockerRunArguments(networked, "image", "name"), (error) => error.code === "UNSUPPORTED_WORKLOAD_BOUNDARY");
  const mounted = grant();
  mounted.filesystem.mounts = ["/var/run/docker.sock"];
  assert.throws(() => dockerRunArguments(mounted, "image", "name"), (error) => error.code === "UNSUPPORTED_WORKLOAD_BOUNDARY");
});

test("reference adapter verifies exact signed Workload Grant document", () => {
  const document = { ...grant(), key_id: "test-key", external_effect_authority: false };
  const signed = { ...document, grant_digest: sha256Digest(document),
    signature: `hmac-sha256:${createHmac("sha256", "test-secret").update(canonicalize(document)).digest("hex")}` };
  assert.equal(verifyWorkloadGrant(signed, "test-secret"), true);
  assert.equal(verifyWorkloadGrant({ ...signed, external_effect_authority: true }, "test-secret"), false);
  assert.equal(verifyWorkloadGrant(signed, "wrong-secret"), false);
});
