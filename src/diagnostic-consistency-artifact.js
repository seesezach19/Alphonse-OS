import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "./canonical-json.js";
import { collectDiagnosticAssignmentModuleClosure } from "./diagnostic-assignment-artifact.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINTS = ["src/diagnostic-consistency-service.js"];
const BOUND_FILES = [
  "diagnostic-migrations/019_model_free_diagnostic_assignments.sql",
  "diagnostic-migrations/022_diagnostic_dispatch_claims.sql",
  "diagnostic-migrations/023_diagnostic_worker_execution.sql",
  "diagnostic-migrations/024_diagnostic_consistency_tests.sql"
];

function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fileEntry(relativePath, readFile) {
  const bytes = readFile(path.resolve(PROJECT_ROOT, relativePath));
  return { path: relativePath, size_bytes: bytes.length, digest: rawDigest(bytes) };
}

export function buildDiagnosticConsistencyArtifactManifest({
  readFile = readFileSync,
  nodeVersion = process.version
} = {}) {
  return {
    schema_version: "alphonse.diagnostic-consistency-stage-artifact-manifest.v0.1",
    entrypoints: [...ENTRYPOINTS],
    module_closure: collectDiagnosticAssignmentModuleClosure(ENTRYPOINTS, readFile)
      .map((relativePath) => fileEntry(relativePath, readFile)),
    bound_files: BOUND_FILES.map((relativePath) => fileEntry(relativePath, readFile)),
    runtime: { node_version: nodeVersion, module_format: "node-esm-source" }
  };
}

export const DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_MANIFEST =
  Object.freeze(buildDiagnosticConsistencyArtifactManifest());
export const DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_DIGEST =
  sha256Digest(DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_MANIFEST);
