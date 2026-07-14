import { spawnSync } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export function verifyWorkloadGrant(grant, verificationSecret) {
  if (typeof verificationSecret !== "string" || !verificationSecret) return false;
  const { grant_digest: grantDigest, signature, ...document } = grant;
  if (sha256Digest(document) !== grantDigest) return false;
  const expected = `hmac-sha256:${createHmac("sha256", verificationSecret).update(canonicalize(document)).digest("hex")}`;
  const suppliedBytes = Buffer.from(signature ?? "", "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function dockerRunArguments(grant, imageReference, containerName) {
  if (grant.network?.mode !== "none" || grant.filesystem?.root !== "read_only"
    || !Array.isArray(grant.filesystem?.mounts) || grant.filesystem.mounts.length !== 0) {
    throw new KernelError(409, "UNSUPPORTED_WORKLOAD_BOUNDARY", "Reference adapter only launches default-deny, mount-free workloads.");
  }
  return ["run", "--rm", "--interactive", "--name", containerName,
    "--user", "1000:1000", "--read-only",
    "--tmpfs", `/scratch:rw,noexec,nosuid,nodev,size=${grant.filesystem.scratch_mb}m`,
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--network", "none",
    "--memory", `${grant.resources.memory_mb}m`, "--cpus", String(grant.resources.cpu_millis / 1000),
    "--pids-limit", String(grant.resources.pids),
    "--env", `WORKLOAD_NONCE=${grant.nonce}`, "--env", `WORKLOAD_GRANT_ID=${grant.workload_grant_id}`,
    imageReference];
}

export function launchReferenceWorkload(grant, imageReference, verificationSecret,
  containerName = `alphonse-workload-${grant.workload_grant_id.slice(0, 8)}`) {
  if (!verifyWorkloadGrant(grant, verificationSecret)) {
    throw new KernelError(403, "INVALID_WORKLOAD_GRANT_SIGNATURE", "Reference adapter rejected unsigned or altered Workload Grant.");
  }
  if (grant.external_effect_authority !== false || grant.dispatch_permit_required !== true) {
    throw new KernelError(409, "WORKLOAD_GRANT_BOUNDARY_INVALID", "Workload Grant must deny effects and require separate dispatch permission.");
  }
  const leaseRemaining = Date.parse(grant.expires_at) - Date.now();
  if (!Number.isFinite(leaseRemaining) || leaseRemaining <= 0) {
    throw new KernelError(409, "WORKLOAD_LEASE_EXPIRED", "Reference adapter will not launch an expired Workload Grant.");
  }
  const inspected = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", imageReference], {
    encoding: "utf8", windowsHide: true, timeout: 30_000
  });
  if (inspected.status !== 0 || inspected.stdout.trim() !== grant.workload_digest) {
    throw new KernelError(409, "WORKLOAD_DIGEST_MISMATCH", "Local image bytes do not match Workload Grant.");
  }
  const result = spawnSync("docker", dockerRunArguments(grant, grant.workload_digest, containerName), {
    encoding: "utf8", windowsHide: true, timeout: leaseRemaining
  });
  if (result.status !== 0) throw new Error(`Reference workload failed: ${result.stderr || result.stdout}`);
  const output = JSON.parse(result.stdout.trim());
  return { container_name: containerName, output };
}

export function launchInventoryComparison(grant, imageReference, verificationSecret, comparisonInput,
  containerName = `alphonse-comparison-${grant.workload_grant_id.slice(0, 8)}`) {
  if (!verifyWorkloadGrant(grant, verificationSecret)) {
    throw new KernelError(403, "INVALID_WORKLOAD_GRANT_SIGNATURE", "Reference adapter rejected unsigned or altered Workload Grant.");
  }
  const leaseRemaining = Date.parse(grant.expires_at) - Date.now();
  if (grant.external_effect_authority !== false || leaseRemaining <= 0) {
    throw new KernelError(409, "WORKLOAD_LEASE_EXPIRED", "Comparison workload lacks a current effect-free lease.");
  }
  const inspected = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", imageReference], {
    encoding: "utf8", windowsHide: true, timeout: 30_000
  });
  if (inspected.status !== 0 || inspected.stdout.trim() !== grant.workload_digest) {
    throw new KernelError(409, "WORKLOAD_DIGEST_MISMATCH", "Local comparison image bytes do not match Workload Grant.");
  }
  const result = spawnSync("docker", dockerRunArguments(grant, grant.workload_digest, containerName), {
    input: JSON.stringify(comparisonInput), encoding: "utf8", windowsHide: true, timeout: leaseRemaining
  });
  if (result.status !== 0) throw new Error(`Reference comparison workload failed: ${result.stderr || result.stdout}`);
  const output = JSON.parse(result.stdout.trim());
  return { container_name: containerName, output, comparison: output.comparison };
}
