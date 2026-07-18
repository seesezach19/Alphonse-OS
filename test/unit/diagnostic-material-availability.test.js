import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import { createContentAddressedArtifactStore } from "../../src/content-addressed-artifact-store.js";
import {
  buildDeletionAttemptDocument,
  buildErasureDecisionDocument,
  buildMaterialTombstoneDocument,
  canonicalImpactManifest,
  DIAGNOSTIC_MATERIAL_ERASURE_POLICY,
  DIAGNOSTIC_MATERIAL_ERASURE_POLICY_DIGEST,
  projectPackageMaterialAvailability,
  validateMaterialErasureCommand
} from "../../src/diagnostic-material-availability-contracts.js";
import { createDiagnosticMaterialAvailabilityService }
  from "../../src/diagnostic-material-availability-service.js";

const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const digest = (value) => sha256Digest({ value });

test("material erasure policy makes local revocation authoritative without claiming universal deletion", () => {
  assert.equal(sha256Digest(DIAGNOSTIC_MATERIAL_ERASURE_POLICY),
    DIAGNOSTIC_MATERIAL_ERASURE_POLICY_DIGEST);
  assert.equal(DIAGNOSTIC_MATERIAL_ERASURE_POLICY.decision_effect,
    "availability_revoked_on_commit");
  assert.equal(DIAGNOSTIC_MATERIAL_ERASURE_POLICY.legal_hold_override, "prohibited");
  assert.equal(DIAGNOSTIC_MATERIAL_ERASURE_POLICY.external_deletion_claim,
    "prohibited_without_location_specific_verification");
});

test("erasure command accepts only exact bounded authority inputs and never a legal-hold override", () => {
  const command = {
    command_id: "erase:one",
    operation_id: "diagnostic.material_erasure.request",
    input: {
      erasure_decision_id: id("1"),
      artifact_digest: digest("artifact"),
      reason_code: "privacy_request",
      reason: "customer requested removal of retained detail",
      override_retention_classes: ["package_pin"]
    }
  };
  assert.deepEqual(validateMaterialErasureCommand(command).input, command.input);
  assert.throws(() => validateMaterialErasureCommand({ ...command, input: {
    ...command.input, override_retention_classes: ["legal_hold"]
  } }), /closed vocabulary/);
  assert.throws(() => validateMaterialErasureCommand({ ...command, input: {
    ...command.input, confidence: "high"
  } }), /fields must be exact/);
});

test("package availability is temporal, monotonic, and execution-ineligible after any revocation", () => {
  const first = projectPackageMaterialAvailability({
    evidencePackageId: id("2"),
    erasureDecisionId: id("3"),
    artifactDigest: digest("detail"),
    rootMaterial: false,
    cause: "privacy_request",
    currentAsOf: "2026-07-18T18:00:00.000Z"
  });
  assert.equal(first.document.material_status, "partially_unavailable");
  assert.equal(first.document.execution_eligible, false);
  assert.equal(first.document.temporal_claim,
    "current_material_availability_not_historical_package_identity");

  const second = projectPackageMaterialAvailability({
    evidencePackageId: id("2"),
    prior: first.document,
    erasureDecisionId: id("4"),
    artifactDigest: digest("package"),
    rootMaterial: true,
    cause: "security_response",
    currentAsOf: "2026-07-18T18:01:00.000Z"
  });
  assert.equal(second.document.material_status, "material_unavailable");
  assert.deepEqual(second.document.erasure_decision_ids, [id("3"), id("4")]);
});

test("tombstone binds exact impact and local deletion while retaining external limitations", () => {
  const impact = canonicalImpactManifest({
    artifactDigest: digest("artifact"),
    materialClass: "package_selected_artifact",
    affectedPackages: [{ evidence_package_id: id("5"), case_id: id("6"),
      relationships: ["selected_artifact"], root_material: false }],
    affectedAssignments: [{ assignment_id: id("7"), evidence_package_id: id("5"),
      prior_state: "unclaimed", action: "expired_unclaimed" }],
    retainedRepresentations: ["diagnostic_artifacts.metadata_and_digest"]
  });
  const decision = buildErasureDecisionDocument({
    decisionId: id("8"),
    installationId: id("9"),
    environmentId: id("10"),
    artifactDigest: digest("artifact"),
    materialClass: "package_selected_artifact",
    reasonCode: "privacy_request",
    reason: "remove exact detail bytes",
    overrideRetentionClasses: ["package_pin"],
    impactManifest: impact.document,
    impactManifestDigest: impact.digest,
    actor: { type: "human", id: "owner", authorization: { mode: "direct_owner" } },
    requestedAt: "2026-07-18T18:00:00.000Z"
  });
  const decisionRow = {
    erasure_decision_id: id("8"), artifact_digest: digest("artifact"),
    material_class: "package_selected_artifact", decision_digest: decision.digest,
    governing_policy_digest: DIAGNOSTIC_MATERIAL_ERASURE_POLICY_DIGEST,
    impact_manifest_digest: impact.digest, impact_manifest: impact.document
  };
  const attemptMaterial = buildDeletionAttemptDocument({
    attemptId: id("11"), decision: decisionRow, outcome: "deleted",
    verificationStatus: "verified_absent", errorCode: null,
    attemptedBy: "owner", attemptedAt: "2026-07-18T18:01:00.000Z"
  });
  const attempt = { deletion_attempt_id: id("11"), attempt_digest: attemptMaterial.digest };
  const tombstone = buildMaterialTombstoneDocument({
    decision: decisionRow, deletionAttempt: attempt, completedAt: "2026-07-18T18:01:00.000Z"
  });
  assert.equal(tombstone.document.local_primary_cas.status, "verified_absent");
  assert.equal(tombstone.document.universal_deletion_established, false);
  assert.equal(tombstone.document.replica_and_provider_limitations.length, 2);
});

test("one material fence is re-entrant across artifact reads and writes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alphonse-material-fence-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const queries = [];
  const client = {
    async query(statement) { queries.push(statement); return { rows: [], rowCount: 0 }; },
    release() {}
  };
  const store = createContentAddressedArtifactStore(root);
  const service = createDiagnosticMaterialAvailabilityService({
    database: { pool: { async connect() { return client; } } },
    artifactStore: store,
    installationId: id("20"),
    environmentId: id("21")
  });
  store.setMaterialGuard(service.createArtifactAccessGuard());

  await service.runMaterialMutationExclusive(async () => {
    const stored = await store.putJson({ bounded: "derived material" });
    const read = await store.getJson(stored.artifact_digest);
    assert.deepEqual(read.content, { bounded: "derived material" });
  });

  assert.equal(queries.filter((statement) => statement.includes("pg_advisory_xact_lock")).length, 1);
  assert.equal(queries.some((statement) => statement.includes("diagnostic_material_states")), false);
  assert.deepEqual([queries[0], queries.at(-1)], ["BEGIN", "COMMIT"]);
});
