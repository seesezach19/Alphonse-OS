import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "./canonical-json.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOUND_FILES = [
  "package.json",
  "package-lock.json",
  "migrations/023_diagnostic_dispatch_authority.sql",
  "diagnostic-migrations/022_diagnostic_dispatch_claims.sql",
  "src/canonical-json.js",
  "src/diagnostic-assignment-persistence.js",
  "src/diagnostic-dispatch-contracts.js",
  "src/diagnostic-dispatch-authorization-service.js",
  "src/diagnostic-dispatch-service.js",
  "src/diagnostic-material-availability-service.js",
  "src/identity-intent-service.js",
  "src/server.js"
];

function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fileEntry(relativePath, readFile) {
  const bytes = readFile(path.resolve(PROJECT_ROOT, relativePath));
  return { path: relativePath, size_bytes: bytes.length, digest: rawDigest(bytes) };
}

export function buildDiagnosticDispatchDecisionArtifactManifest({
  readFile = readFileSync,
  nodeVersion = process.version
} = {}) {
  return {
    schema_version: "alphonse.diagnostic-dispatch-decision-artifact-manifest.v0.1",
    bound_files: BOUND_FILES.map((relativePath) => fileEntry(relativePath, readFile)),
    runtime: { node_version: nodeVersion, module_format: "node-esm-source" },
    authority_boundary: {
      kernel: "immutable_authorization_issuance_only",
      diagnostic_plane: "atomic_single_use_claim_and_worker_run_binding",
      external_business_effect_authority: "none"
    }
  };
}

export const DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_MANIFEST =
  Object.freeze(buildDiagnosticDispatchDecisionArtifactManifest());
export const DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_DIGEST =
  sha256Digest(DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_MANIFEST);
