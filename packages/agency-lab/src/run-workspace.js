import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function resolveContainedPath(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Agency Lab path escaped its fixed root");
  }
  return resolved;
}

export function validateRunId(value) {
  if (typeof value !== "string" || !RUN_ID.test(value)) {
    throw new Error("Agency Lab run_id must be a lowercase UUID v4");
  }
  return value;
}

export async function createRunWorkspace({ baseDirectory = os.tmpdir(), runId = randomUUID() } = {}) {
  const checkedRunId = validateRunId(runId);
  const runsRoot = path.resolve(baseDirectory, "alphonse-agency-lab", "runs");
  await mkdir(runsRoot, { recursive: true });
  const runRoot = resolveContainedPath(runsRoot, checkedRunId);
  await mkdir(runRoot);
  const workerRoot = resolveContainedPath(runRoot, "worker");
  const controllerRoot = resolveContainedPath(runRoot, "controller");
  await mkdir(workerRoot);
  await mkdir(controllerRoot);
  return { runId: checkedRunId, runRoot, workerRoot, controllerRoot };
}
