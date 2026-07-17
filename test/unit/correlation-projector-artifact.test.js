import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildCorrelationProjectorArtifactManifest,
  collectCorrelationProjectorModuleClosure,
  CORRELATION_PROJECTOR_ARTIFACT_MANIFEST,
  CORRELATION_PROJECTOR_TRANSITIVE_ARTIFACT_DIGEST
} from "../../src/correlation-projector-artifact.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("projector artifact manifest contains the mechanically discovered semantic module closure", () => {
  const paths = CORRELATION_PROJECTOR_ARTIFACT_MANIFEST.module_closure.map((entry) => entry.path);
  for (const required of [
    "src/diagnostic-correlation-service.js",
    "src/correlation-projector.js",
    "src/correlation-input-integrity.js",
    "src/diagnostic-intake-outcome-contracts.js",
    "src/canonical-json.js",
    "src/observation-contracts.js",
    "src/diagnostic-tokenization-proof-service.js",
    "src/tokenization-contracts.js",
    "src/grant-authority-contracts.js"
  ]) assert.ok(paths.includes(required), required);
  assert.deepEqual(paths, collectCorrelationProjectorModuleClosure());
  assert.equal(CORRELATION_PROJECTOR_TRANSITIVE_ARTIFACT_DIGEST,
    sha256Digest(CORRELATION_PROJECTOR_ARTIFACT_MANIFEST));
});

test("canonicalization, coverage, verifier, loader, lockfile, and migration drift change artifact identity", () => {
  const baseline = sha256Digest(buildCorrelationProjectorArtifactManifest());
  for (const changedPath of [
    "src/canonical-json.js",
    "src/observation-contracts.js",
    "src/correlation-input-integrity.js",
    "src/diagnostic-correlation-service.js",
    "package-lock.json",
    "diagnostic-migrations/015_correlation_integrity_hardening.sql"
  ]) {
    const manifest = buildCorrelationProjectorArtifactManifest({
      readFile(absolutePath, encoding) {
        const value = readFileSync(absolutePath, encoding);
        const relative = path.relative(root, absolutePath).replaceAll(path.sep, "/");
        if (relative !== changedPath) return value;
        return encoding ? `${value}\n// simulated semantic drift\n`
          : Buffer.concat([value, Buffer.from("\n// simulated semantic drift\n", "utf8")]);
      }
    });
    assert.notEqual(sha256Digest(manifest), baseline, changedPath);
  }
});

test("unbound documentation does not enter projector artifact identity", () => {
  const paths = new Set([
    ...CORRELATION_PROJECTOR_ARTIFACT_MANIFEST.module_closure,
    ...CORRELATION_PROJECTOR_ARTIFACT_MANIFEST.bound_files
  ].map((entry) => entry.path));
  assert.equal(paths.has("README.md"), false);
  assert.equal(paths.has("docs/adr/0106-use-verifiable-compression-for-temporal-diagnostic-claims.md"), false);
});
