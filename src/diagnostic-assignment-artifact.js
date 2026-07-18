import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "./canonical-json.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINTS = [
  "src/diagnostic-assignment-service.js",
  "src/diagnostic-assignment-contracts.js",
  "src/diagnostic-assignment-persistence.js",
  "src/diagnostic-evidence-package-service.js"
];
const BOUND_FILES = [
  "package.json",
  "package-lock.json",
  "diagnostic-migrations/017_evidence_collection_and_packages.sql",
  "diagnostic-migrations/018_independent_diagnostic_verification.sql",
  "diagnostic-migrations/019_model_free_diagnostic_assignments.sql"
];

function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function relativeModuleSpecifiers(source) {
  const specifiers = new Set();
  const staticImport = /(?:^|\n)\s*(?:import|export)\s+(?:[^"']*?\sfrom\s*)?["'](\.[^"']+)["']/g;
  const dynamicImport = /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g;
  for (const pattern of [staticImport, dynamicImport]) {
    let match;
    while ((match = pattern.exec(source)) !== null) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function projectPath(absolutePath) {
  const relative = path.relative(PROJECT_ROOT, absolutePath).replaceAll(path.sep, "/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`Diagnostic assignment artifact dependency escapes the project root: ${absolutePath}`);
  }
  return relative;
}

export function collectDiagnosticAssignmentModuleClosure(entrypoints = ENTRYPOINTS, readFile = readFileSync) {
  const pending = entrypoints.map((entry) => path.resolve(PROJECT_ROOT, entry));
  const visited = new Set();
  while (pending.length) {
    const absolute = pending.pop();
    const relative = projectPath(absolute);
    if (visited.has(relative)) continue;
    const source = readFile(absolute, "utf8");
    visited.add(relative);
    for (const specifier of relativeModuleSpecifiers(source)) {
      pending.push(path.resolve(path.dirname(absolute), specifier));
    }
  }
  return [...visited].sort();
}

function fileEntry(relativePath, readFile) {
  const bytes = readFile(path.resolve(PROJECT_ROOT, relativePath));
  return { path: relativePath, size_bytes: bytes.length, digest: rawDigest(bytes) };
}

export function buildDiagnosticAssignmentArtifactManifest({
  readFile = readFileSync,
  nodeVersion = process.version
} = {}) {
  return {
    schema_version: "alphonse.diagnostic-assignment-stage-artifact-manifest.v0.1",
    entrypoints: [...ENTRYPOINTS],
    module_closure: collectDiagnosticAssignmentModuleClosure(ENTRYPOINTS, readFile)
      .map((relativePath) => fileEntry(relativePath, readFile)),
    bound_files: BOUND_FILES.map((relativePath) => fileEntry(relativePath, readFile)),
    runtime: { node_version: nodeVersion, module_format: "node-esm-source" }
  };
}

export const DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_MANIFEST =
  Object.freeze(buildDiagnosticAssignmentArtifactManifest());
export const DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_DIGEST =
  sha256Digest(DIAGNOSTIC_ASSIGNMENT_STAGE_ARTIFACT_MANIFEST);
