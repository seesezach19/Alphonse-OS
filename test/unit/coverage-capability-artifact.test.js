import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCoverageCapabilityArtifactManifest,
  COVERAGE_CAPABILITY_STAGE_ARTIFACT_DIGEST,
  COVERAGE_CAPABILITY_STAGE_ARTIFACT_MANIFEST } from "../../src/coverage-capability-artifact.js";
import { sha256Digest } from "../../src/canonical-json.js";

test("capability projector identity binds source, schemas, package validation, migrations, runtime, and lockfile", () => {
  assert.equal(COVERAGE_CAPABILITY_STAGE_ARTIFACT_DIGEST,
    sha256Digest(COVERAGE_CAPABILITY_STAGE_ARTIFACT_MANIFEST));
  const paths = [...COVERAGE_CAPABILITY_STAGE_ARTIFACT_MANIFEST.module_closure,
    ...COVERAGE_CAPABILITY_STAGE_ARTIFACT_MANIFEST.bound_files].map((item) => item.path);
  for (const expected of ["src/coverage-capability-contracts.js", "src/coverage-capability-service.js",
    "src/coverage-profile-contracts.js", "src/package-service.js", "package-lock.json",
    "schemas/coverage/coverage-profile.v0.1.json",
    "schemas/coverage/accountable-coverage-claim.v0.1.json",
    "diagnostic-migrations/028_coverage_compilation_validation.sql"]) {
    assert.ok(paths.includes(expected), `${expected} must enter projector identity`);
  }
});

test("projector, policy, schema, and dependency drift change capability identity", () => {
  const baseline = buildCoverageCapabilityArtifactManifest();
  for (const changedPath of ["src/coverage-capability-contracts.js", "src/coverage-profile-contracts.js",
    "src/package-service.js", "schemas/coverage/coverage-profile.v0.1.json", "package-lock.json"] ) {
    const changed = buildCoverageCapabilityArtifactManifest({ readFile(file, encoding) {
      const value = readFileSync(file, encoding);
      return file.replaceAll("\\", "/").endsWith(changedPath)
        ? Buffer.concat([Buffer.isBuffer(value) ? value : Buffer.from(value), Buffer.from("\n")]) : value;
    } });
    assert.notEqual(sha256Digest(changed), sha256Digest(baseline));
  }
});
