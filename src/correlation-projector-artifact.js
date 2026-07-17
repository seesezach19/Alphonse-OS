import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "./canonical-json.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINTS = [
  "src/diagnostic-correlation-service.js",
  "src/correlation-projector.js",
  "src/diagnostic-tokenization-proof-service.js"
];
const BOUND_FILES = [
  "package.json",
  "package-lock.json",
  "diagnostic-migrations/011_canonical_observation_intake.sql",
  "diagnostic-migrations/012_tokenization_result_provenance.sql",
  "diagnostic-migrations/014_correlation_projections.sql",
  "diagnostic-migrations/015_correlation_integrity_hardening.sql"
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
    throw new Error(`Correlation artifact dependency escapes the project root: ${absolutePath}`);
  }
  return relative;
}

export function collectCorrelationProjectorModuleClosure(entrypoints = ENTRYPOINTS, readFile = readFileSync) {
  const pending = entrypoints.map((entry) => path.resolve(PROJECT_ROOT, entry));
  const visited = new Set();
  while (pending.length) {
    const absolute = pending.pop();
    const relative = projectPath(absolute);
    if (visited.has(relative)) continue;
    const source = readFile(absolute, "utf8");
    visited.add(relative);
    for (const specifier of relativeModuleSpecifiers(source)) {
      const resolved = path.resolve(path.dirname(absolute), specifier);
      pending.push(resolved);
    }
  }
  return [...visited].sort();
}

function fileEntry(relativePath, readFile) {
  const bytes = readFile(path.resolve(PROJECT_ROOT, relativePath));
  return { path: relativePath, size_bytes: bytes.length, digest: rawDigest(bytes) };
}

export function buildCorrelationProjectorArtifactManifest({
  readFile = readFileSync,
  nodeVersion = process.version
} = {}) {
  return {
    schema_version: "alphonse.correlation-projector-artifact-manifest.v0.2",
    entrypoints: [...ENTRYPOINTS],
    module_closure: collectCorrelationProjectorModuleClosure(ENTRYPOINTS, readFile)
      .map((relativePath) => fileEntry(relativePath, readFile)),
    bound_files: BOUND_FILES.map((relativePath) => fileEntry(relativePath, readFile)),
    runtime: {
      node_version: nodeVersion,
      module_format: "node-esm-source"
    }
  };
}

export const CORRELATION_PROJECTOR_ARTIFACT_MANIFEST =
  Object.freeze(buildCorrelationProjectorArtifactManifest());

export const CORRELATION_PROJECTOR_TRANSITIVE_ARTIFACT_DIGEST =
  sha256Digest(CORRELATION_PROJECTOR_ARTIFACT_MANIFEST);
