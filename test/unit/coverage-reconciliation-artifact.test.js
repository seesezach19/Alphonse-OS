import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildCoverageReconciliationArtifactManifest,
  COVERAGE_RECONCILIATION_STAGE_ARTIFACT_DIGEST,
  COVERAGE_RECONCILIATION_STAGE_ARTIFACT_MANIFEST
} from "../../src/coverage-reconciliation-artifact.js";

test("reconciliation identity binds Kernel policy, immutable storage, observer, and provider adapter", () => {
  assert.equal(COVERAGE_RECONCILIATION_STAGE_ARTIFACT_DIGEST,
    sha256Digest(COVERAGE_RECONCILIATION_STAGE_ARTIFACT_MANIFEST));
  const paths = [...COVERAGE_RECONCILIATION_STAGE_ARTIFACT_MANIFEST.module_closure,
    ...COVERAGE_RECONCILIATION_STAGE_ARTIFACT_MANIFEST.bound_files].map((item) => item.path);
  for (const expected of ["src/coverage-reconciliation-contracts.js",
    "src/coverage-reconciliation-service.js", "src/canonical-n8n-observer.js",
    "src/workflow-runtime-adapter-contract.js",
    "diagnostic-migrations/029_coverage_reconciliation_intervals.sql",
    "Dockerfile",
    "packages/n8n-operational-package/src/execution-history.js",
    "packages/n8n-operational-package/src/runtime-attestation.js", "package-lock.json"]) {
    assert.ok(paths.includes(expected), `${expected} must enter reconciliation identity`);
  }
});

test("reconciliation implementation, migration, adapter, observer, and dependency drift change identity", () => {
  const baseline = buildCoverageReconciliationArtifactManifest();
  for (const changedPath of ["src/coverage-reconciliation-contracts.js",
    "diagnostic-migrations/029_coverage_reconciliation_intervals.sql",
    "packages/n8n-operational-package/src/execution-history.js",
    "src/canonical-n8n-observer.js", "package-lock.json"]) {
    const changed = buildCoverageReconciliationArtifactManifest({ readFile(file, encoding) {
      const value = readFileSync(file, encoding);
      return file.replaceAll("\\", "/").endsWith(changedPath)
        ? Buffer.concat([Buffer.isBuffer(value) ? value : Buffer.from(value), Buffer.from("\n")]) : value;
    } });
    assert.notEqual(sha256Digest(changed), sha256Digest(baseline), changedPath);
  }
});
