import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "./canonical.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FILES = ["artifact.js", "assignment.js", "canonical.js", "cli.js", "correlation.js", "effect.js",
  "selection.js", "verify.js"];

function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function buildVerifierArtifactManifest(readFile = readFileSync) {
  return {
    schema_version: "alphonse.independent-diagnostic-verifier-artifact-manifest.v0.1",
    implementation_boundary: "offline-no-production-business-logic-imports",
    files: FILES.map((file) => {
      const bytes = readFile(path.join(ROOT, file));
      return { path: `verifier/${file}`, size_bytes: bytes.length, digest: rawDigest(bytes) };
    }),
    runtime: { module_format: "node-esm", required_node_major: 24 }
  };
}

export const VERIFIER_ARTIFACT_MANIFEST = Object.freeze(buildVerifierArtifactManifest());
export const VERIFIER_ARTIFACT_DIGEST = sha256Digest(VERIFIER_ARTIFACT_MANIFEST);
