import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildDiagnosticEffectArtifactManifest,
  collectDiagnosticEffectModuleClosure,
  DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST
} from "../../src/diagnostic-effect-artifact.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("diagnostic effect artifact binds the executed interpretation and evaluation closure", () => {
  const closure = collectDiagnosticEffectModuleClosure();
  for (const required of [
    "src/canonical-json.js",
    "src/correlation-input-integrity.js",
    "src/diagnostic-claim-envelope.js",
    "src/diagnostic-effect-contracts.js",
    "src/diagnostic-effect-evaluation-service.js",
    "src/diagnostic-effect-evaluator.js",
    "src/diagnostic-effect-projector.js"
  ]) assert.ok(closure.includes(required), required);
  assert.match(DIAGNOSTIC_EFFECT_STAGE_ARTIFACT_DIGEST, /^sha256:[0-9a-f]{64}$/u);
  const manifest = buildDiagnosticEffectArtifactManifest();
  assert.ok(manifest.bound_files.some((item) =>
    item.path === "diagnostic-migrations/016_effect_interpretation_and_behavior_cases.sql"));
});

test("interpretation, evaluation, verifier, canonicalizer, lockfile, and migration drift change stage identity", () => {
  const baseline = sha256Digest(buildDiagnosticEffectArtifactManifest());
  for (const changedPath of [
    "src/diagnostic-effect-evaluation-service.js",
    "src/diagnostic-effect-projector.js",
    "src/diagnostic-effect-evaluator.js",
    "src/diagnostic-effect-contracts.js",
    "src/correlation-input-integrity.js",
    "src/canonical-json.js",
    "package-lock.json",
    "diagnostic-migrations/016_effect_interpretation_and_behavior_cases.sql"
  ]) {
    const manifest = buildDiagnosticEffectArtifactManifest({
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
