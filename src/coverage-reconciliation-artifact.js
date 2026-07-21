import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "./canonical-json.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINTS = [
  "src/coverage-reconciliation-contracts.js",
  "src/coverage-reconciliation-service.js"
];
const BOUND_FILES = [
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "diagnostic-migrations/029_coverage_reconciliation_intervals.sql",
  "src/canonical-n8n-observer.js",
  "src/workflow-runtime-adapter-contract.js",
  "packages/n8n-operational-package/package.json",
  "packages/n8n-operational-package/operational-package.json",
  "packages/n8n-operational-package/runtime-adapter-manifest.json",
  "packages/n8n-operational-package/src/execution-history.js",
  "packages/n8n-operational-package/src/runtime-attestation.js"
];

function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function moduleSpecifiers(source) {
  const found = new Set();
  const patterns = [/(?:^|\n)\s*(?:import|export)\s+(?:[^"']*?\sfrom\s*)?["'](\.[^"']+)["']/g,
    /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) found.add(match[1]);
  }
  return [...found];
}

function projectPath(absolute) {
  const relative = path.relative(PROJECT_ROOT, absolute).replaceAll(path.sep, "/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`Coverage reconciliation dependency escapes the project root: ${absolute}`);
  }
  return relative;
}

export function collectCoverageReconciliationModuleClosure(entrypoints = ENTRYPOINTS,
  readFile = readFileSync) {
  const pending = entrypoints.map((entry) => path.resolve(PROJECT_ROOT, entry));
  const visited = new Set();
  while (pending.length) {
    const absolute = pending.pop();
    const relative = projectPath(absolute);
    if (visited.has(relative)) continue;
    const source = readFile(absolute, "utf8");
    visited.add(relative);
    for (const specifier of moduleSpecifiers(source)) {
      pending.push(path.resolve(path.dirname(absolute), specifier));
    }
  }
  return [...visited].sort();
}

function entry(relativePath, readFile) {
  const bytes = readFile(path.resolve(PROJECT_ROOT, relativePath));
  return { path: relativePath, size_bytes: bytes.length, digest: rawDigest(bytes) };
}

export function buildCoverageReconciliationArtifactManifest({ readFile = readFileSync,
  nodeVersion = process.version } = {}) {
  return { schema_version: "alphonse.coverage-reconciliation-stage-artifact-manifest.v0.1",
    entrypoints: [...ENTRYPOINTS],
    module_closure: collectCoverageReconciliationModuleClosure(ENTRYPOINTS, readFile)
      .map((relative) => entry(relative, readFile)),
    bound_files: BOUND_FILES.map((relative) => entry(relative, readFile)),
    runtime: { node_version: nodeVersion, module_format: "node-esm-source" } };
}

export const COVERAGE_RECONCILIATION_STAGE_ARTIFACT_MANIFEST =
  Object.freeze(buildCoverageReconciliationArtifactManifest());
export const COVERAGE_RECONCILIATION_STAGE_ARTIFACT_DIGEST =
  sha256Digest(COVERAGE_RECONCILIATION_STAGE_ARTIFACT_MANIFEST);
