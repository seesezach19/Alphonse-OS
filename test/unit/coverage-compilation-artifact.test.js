import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildCoverageCompilationArtifactManifest,
  collectCoverageCompilationModuleClosure,
  COVERAGE_COMPILATION_STAGE_ARTIFACT_DIGEST
} from "../../src/coverage-compilation-artifact.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("coverage compiler identity binds implementation, schemas, migrations, runtime, and lockfile", () => {
  const closure = collectCoverageCompilationModuleClosure();
  for (const required of ["src/canonical-json.js", "src/coverage-compilation-contracts.js",
    "src/coverage-compilation-service.js", "src/coverage-compilation-artifact.js"]) {
    assert.ok(closure.includes(required), required);
  }
  assert.match(COVERAGE_COMPILATION_STAGE_ARTIFACT_DIGEST, /^sha256:[0-9a-f]{64}$/u);
  const manifest = buildCoverageCompilationArtifactManifest();
  assert.ok(manifest.bound_files.some((item) =>
    item.path === "schemas/coverage/coverage-validation-receipt.v0.1.json"));
});

test("compiler, schema, migration, and dependency drift change implementation identity", () => {
  const baseline = sha256Digest(buildCoverageCompilationArtifactManifest());
  for (const changedPath of ["src/coverage-compilation-contracts.js",
    "schemas/coverage/workflow-manifest.v0.1.json",
    "diagnostic-migrations/028_coverage_compilation_validation.sql", "package-lock.json"]) {
    const manifest = buildCoverageCompilationArtifactManifest({
      readFile(absolutePath, encoding) {
        const value = readFileSync(absolutePath, encoding);
        const relative = path.relative(root, absolutePath).replaceAll(path.sep, "/");
        if (relative !== changedPath) return value;
        return encoding ? `${value}\n ` : Buffer.concat([value, Buffer.from("\n ", "utf8")]);
      }
    });
    assert.notEqual(sha256Digest(manifest), baseline, changedPath);
  }
});
