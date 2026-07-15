import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildRepairCandidateMaterial,
  buildRepairWorkspaceManifest,
  projectDiagnosticCaseWithRepair,
  projectRepairTask,
  validateRepairCandidateOutput,
  validateRepairIntentBoundary,
  validateRepairTaskBounds
} from "../../src/diagnostic-repair-worker-contracts.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

test("Repair Task bounds grant only the narrow worker protocol", () => {
  const bounds = validateRepairTaskBounds({
    allowed_operations: ["artifact.read", "candidate.submit", "task.heartbeat", "task.fail", "task.release"],
    artifact_limits: {
      max_artifact_bytes: 131072,
      max_total_bytes: 262144,
      allowed_media_types: ["application/json", "text/plain"]
    },
    lease_duration_seconds: 300,
    expected_outputs: ["repair_candidate", "targeted_regression", "worker_logs"]
  });
  assert.equal(bounds.lease_duration_seconds, 300);
  assert.throws(() => validateRepairTaskBounds({
    ...bounds,
    allowed_operations: [...bounds.allowed_operations, "promotion.authorize"]
  }), (error) => error.code === "REPAIR_OPERATION_NOT_ALLOWED");
});

test("Repair Work Intent binds the exact case and denies adjacent authority", () => {
  const caseId = "00000000-0000-4000-8000-000000000501";
  const revisionId = "00000000-0000-4000-8000-000000000502";
  const constraints = { no_verification: true, no_promotion: true, no_external_effects: true };
  assert.deepEqual(validateRepairIntentBoundary({ case_id: caseId, base_revision_id: revisionId },
    constraints, caseId, revisionId), {
    scope: { case_id: caseId, base_revision_id: revisionId }, constraints
  });
  assert.throws(() => validateRepairIntentBoundary({ case_id: caseId, base_revision_id: revisionId },
    constraints, caseId, "00000000-0000-4000-8000-000000000503"),
  (error) => error.code === "REPAIR_INTENT_SCOPE_MISMATCH");
  assert.throws(() => validateRepairIntentBoundary({ case_id: caseId, base_revision_id: revisionId },
    { ...constraints, no_promotion: false }, caseId, revisionId),
  (error) => error.code === "REPAIR_INTENT_CONSTRAINTS_REQUIRED");
});

test("Repair Candidate output rejects credential material and binds all artifacts", () => {
  const output = {
    intended_behavior_change: "Preserve inventory_unknown and route human review.",
    candidate_artifact: {
      media_type: "application/json",
      content: { workflow: { missing_sku: "inventory_unknown", next: "human_review" } }
    },
    targeted_regression_artifact: {
      media_type: "application/json",
      content: { fixture: "missing-sku", expected: "inventory_unknown -> human_review" }
    },
    logs_artifact: { media_type: "text/plain", content: { lines: ["targeted regression added"] } },
    runtime_attribution: {
      worker_kind: "test-worker",
      runtime_version: "1.0.0",
      attachment_version: "0.2.0"
    }
  };
  const validated = validateRepairCandidateOutput(output, {
    max_artifact_bytes: 131072,
    max_total_bytes: 262144,
    allowed_media_types: ["application/json", "text/plain"]
  });
  const material = buildRepairCandidateMaterial({
    taskId: "00000000-0000-4000-8000-000000000501",
    caseId: "00000000-0000-4000-8000-000000000502",
    baseRevisionId: "00000000-0000-4000-8000-000000000503",
    reproductionBundleId: "00000000-0000-4000-8000-000000000504",
    output: validated,
    artifactDigests: {
      candidate: digest("a"),
      targeted_regression: digest("b"),
      logs: digest("c")
    }
  });
  assert.equal(material.material_digest, sha256Digest(material.content));
  assert.equal(material.content.authority.verification, "not_granted");
  assert.equal(material.content.authority.promotion, "not_granted");
  assert.throws(() => validateRepairCandidateOutput({
    ...output,
    runtime_attribution: { ...output.runtime_attribution, provider_token: "secret" }
  }, validated.artifact_limits), (error) => error.code === "SENSITIVE_WORKER_OUTPUT_REJECTED");
});

test("lease projection fences expiry and terminal attempts", () => {
  const task = { lease_epoch: 1 };
  const leased = [{ event_type: "leased", lease_epoch: 1, lease_expires_at: "2030-01-01T00:05:00.000Z" }];
  assert.equal(projectRepairTask(task, leased, Date.parse("2030-01-01T00:04:00.000Z")).state, "leased");
  assert.equal(projectRepairTask(task, leased, Date.parse("2030-01-01T00:06:00.000Z")).state, "expired");
  assert.equal(projectRepairTask(task, [...leased, { event_type: "failed", lease_epoch: 1 }]).state, "failed");
});

test("workspace manifest exposes only exact task-bound inputs", () => {
  const manifest = buildRepairWorkspaceManifest({
    taskId: "00000000-0000-4000-8000-000000000501",
    leaseEpoch: 1,
    baseRevisionArtifactDigest: digest("d"),
    reproductionBundleArtifactDigest: digest("e"),
    bounds: validateRepairTaskBounds({
      allowed_operations: ["artifact.read", "candidate.submit"],
      artifact_limits: { max_artifact_bytes: 1024, max_total_bytes: 2048,
        allowed_media_types: ["application/json"] },
      lease_duration_seconds: 60,
      expected_outputs: ["repair_candidate", "targeted_regression", "worker_logs"]
    })
  });
  assert.deepEqual(manifest.files.map((file) => file.path), [
    "inputs/base-revision.json", "inputs/reproduction-bundle.json"
  ]);
  assert.equal(manifest.ephemeral, true);
  assert.equal(manifest.ambient_filesystem_access, false);
});

test("case projection advances only for live repair work or eligible candidates", () => {
  const base = { failureSpecification: {}, bundles: [{ reproduction_status: "demonstrated" }], attempts: [] };
  assert.equal(projectDiagnosticCaseWithRepair({ ...base, tasks: [{ projection: { state: "leased" } }], candidates: [] }).state,
    "repair_in_progress");
  assert.equal(projectDiagnosticCaseWithRepair({ ...base, tasks: [], candidates: [{ status: "proposed" }] }).state,
    "candidate_available");
  assert.deepEqual(projectDiagnosticCaseWithRepair({ ...base, tasks: [], candidates: [{ status: "verified" }] }), {
    state: "verified",
    legal_next_operations: ["diagnostic.repair_verification.get", "diagnostic.promotion.request"]
  });
  assert.equal(projectDiagnosticCaseWithRepair({ ...base, tasks: [], candidates: [{ status: "rejected" }] }).state,
    "reproducible");
});
