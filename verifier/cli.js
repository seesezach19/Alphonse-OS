import { readFile, writeFile } from "node:fs/promises";

import { VERIFIER_ARTIFACT_DIGEST, VERIFIER_ARTIFACT_MANIFEST } from "./artifact.js";
import { canonicalize, sha256Digest } from "./canonical.js";
import { verifyIndependentDiagnosticBundle } from "./verify.js";
import { verifyDiagnosticAssignmentMaterial } from "./assignment.js";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  process.stderr.write("usage: node verifier/cli.js <sealed-bundle.json> <report.json>\n");
  process.exit(64);
}

let parsed;
try {
  parsed = JSON.parse(await readFile(inputPath, "utf8"));
} catch {
  process.stderr.write("verification bundle is not readable JSON\n");
  process.exit(65);
}

const input = parsed.independent_verification_bundle ?? parsed;
let report;
let exitCode = 0;
try {
  report = verifyIndependentDiagnosticBundle(input, {
    verifier_id: "alphonse.offline-independent-diagnostic-verifier",
    verifier_version: "0.1.0",
    artifact_digest: VERIFIER_ARTIFACT_DIGEST,
    artifact_manifest: VERIFIER_ARTIFACT_MANIFEST,
    image_digest: process.env.VERIFIER_IMAGE_DIGEST ?? "unreported"
  });
  if (parsed.assignment_verification_material) {
    const assignment = verifyDiagnosticAssignmentMaterial(
      parsed.assignment_verification_material, input);
    delete report.report_digest;
    report.stages.push({ stage: "diagnostic_assignment", recomputed_digest: assignment.assignment_digest,
      published_digest: assignment.assignment_digest, matches: true,
      recomputed_id: assignment.assignment_id, published_id: assignment.assignment_id });
    report.assignment_verification = assignment;
    report.report_digest = sha256Digest(report);
  }
} catch (error) {
  exitCode = 1;
  report = {
    schema_version: "alphonse.independent-diagnostic-verification-report.v0.1",
    processing_profile: "D0",
    support: "NOT_ESTABLISHED",
    freshness: "frozen_historical",
    evidence_status: error.code === "VERIFIER_UNVERIFIABLE_MATERIAL" ? "unavailable" : "conflicted",
    authority: "none",
    result: "failed",
    bundle_digest: input?.bundle_digest ?? (input?.bundle ? sha256Digest(input.bundle) : null),
    evidence_package_id: input?.bundle?.target?.evidence_package_id ?? null,
    verifier: { verifier_id: "alphonse.offline-independent-diagnostic-verifier",
      verifier_version: "0.1.0", artifact_digest: VERIFIER_ARTIFACT_DIGEST,
      image_digest: process.env.VERIFIER_IMAGE_DIGEST ?? "unreported" },
    failure: { code: error.code ?? "VERIFIER_INTERNAL_FAILURE", message: error.message,
      details: error.details ?? {} },
    authority_effects_created: 0,
    production_events_emitted: 0
  };
  report.report_digest = sha256Digest(report);
}
await writeFile(outputPath, `${canonicalize(report)}\n`, { encoding: "utf8", flag: "wx" });
process.exit(exitCode);
