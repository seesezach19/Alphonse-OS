import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { KernelError } from "./errors.js";

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

function workspacePath(root, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    throw new KernelError(400, "INVALID_WORKSPACE_PATH", "Workspace path must be relative.");
  }
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new KernelError(400, "INVALID_WORKSPACE_PATH", "Workspace path escapes the ephemeral root.");
  }
  return resolved;
}

export async function withEphemeralRepairWorkspace(
  workspaceManifest, retrieveArtifact, callback, temporaryRoot = os.tmpdir()
) {
  if (!workspaceManifest?.ephemeral || workspaceManifest.ambient_filesystem_access !== false ||
      !Array.isArray(workspaceManifest.files)) {
    throw new KernelError(400, "INVALID_WORKSPACE_MANIFEST", "Repair workspace manifest is not bounded.");
  }
  const root = await mkdtemp(path.join(temporaryRoot, "alphonse-repair-"));
  try {
    await writeFile(path.join(root, "task.json"), `${JSON.stringify(workspaceManifest, null, 2)}\n`, {
      encoding: "utf8", mode: 0o600
    });
    for (const file of workspaceManifest.files) {
      const target = workspacePath(root, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      const artifact = await retrieveArtifact(file.artifact_digest);
      if (artifact.artifact_digest !== file.artifact_digest || artifact.verified !== true) {
        throw new KernelError(409, "WORKSPACE_ARTIFACT_IDENTITY_MISMATCH",
          "Retrieved workspace artifact does not match its manifest digest.");
      }
      await writeFile(target, `${JSON.stringify(artifact.content, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
    return await callback({ root, manifest: structuredClone(workspaceManifest) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export class RepairWorkerClient {
  #baseUrl;
  #agentToken;
  #fetch;

  constructor({ baseUrl, agentToken, fetchImpl = fetch }) {
    if (!baseUrl || !agentToken) throw new TypeError("baseUrl and agentToken are required.");
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#agentToken = agentToken;
    this.#fetch = fetchImpl;
  }

  async #request(pathname, { method = "GET", body } = {}) {
    const response = await this.#fetch(`${this.#baseUrl}${pathname}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Agent ${this.#agentToken}`,
        ...(body ? { "content-type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) {
      throw new KernelError(response.status, result.error?.code ?? "REPAIR_WORKER_REQUEST_FAILED",
        result.error?.message ?? "Repair Worker request failed.", result.error?.details ?? {});
    }
    return result;
  }

  register(commandId, input) {
    return this.#request("/diagnostic/v0/repair-workers", {
      method: "POST", body: command(commandId, "diagnostic.repair_worker.register", input)
    });
  }

  discover() {
    return this.#request("/diagnostic/v0/repair-tasks");
  }

  claim(commandId, taskId) {
    return this.#request(`/diagnostic/v0/repair-tasks/${encodeURIComponent(taskId)}/claim`, {
      method: "POST", body: command(commandId, "diagnostic.repair_task.claim", { task_id: taskId })
    });
  }

  heartbeat(commandId, taskId, leaseEpoch, statusNote) {
    return this.#request(`/diagnostic/v0/repair-tasks/${encodeURIComponent(taskId)}/heartbeat`, {
      method: "POST",
      body: command(commandId, "diagnostic.repair_task.heartbeat", {
        task_id: taskId, lease_epoch: leaseEpoch, status_note: statusNote
      })
    });
  }

  async retrieveArtifact(taskId, artifactDigest) {
    const result = await this.#request(`/diagnostic/v0/repair-tasks/${encodeURIComponent(taskId)}` +
      `/artifacts/${encodeURIComponent(artifactDigest)}`);
    return result.artifact;
  }

  submit(commandId, taskId, leaseEpoch, output) {
    return this.#request("/diagnostic/v0/repair-candidates", {
      method: "POST",
      body: command(commandId, "diagnostic.repair_candidate.submit", {
        task_id: taskId, lease_epoch: leaseEpoch, output
      })
    });
  }

  fail(commandId, taskId, leaseEpoch, failureType, summary) {
    return this.#request(`/diagnostic/v0/repair-tasks/${encodeURIComponent(taskId)}/fail`, {
      method: "POST",
      body: command(commandId, "diagnostic.repair_task.fail", {
        task_id: taskId, lease_epoch: leaseEpoch, failure_type: failureType, summary
      })
    });
  }

  release(commandId, taskId, leaseEpoch, reason) {
    return this.#request(`/diagnostic/v0/repair-tasks/${encodeURIComponent(taskId)}/release`, {
      method: "POST",
      body: command(commandId, "diagnostic.repair_task.release", {
        task_id: taskId, lease_epoch: leaseEpoch, reason
      })
    });
  }

  withWorkspace(claimResult, callback, temporaryRoot) {
    const taskId = claimResult.repair_task.task_id;
    return withEphemeralRepairWorkspace(
      claimResult.workspace_manifest,
      (digest) => this.retrieveArtifact(taskId, digest),
      callback,
      temporaryRoot
    );
  }
}
