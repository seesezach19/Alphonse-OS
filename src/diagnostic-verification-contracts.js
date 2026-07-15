import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  requireDigest,
  requireExact,
  requireObject,
  requireString,
  requireUuid
} from "./diagnostic-repair-worker-contracts.js";
import { KernelError } from "./errors.js";

const AUTHORITY = Object.freeze({
  verification: "granted",
  candidate_write: "not_granted",
  owner_authorization: "not_granted",
  promotion: "not_granted",
  rollback: "not_granted",
  provider_credentials: "not_granted",
  production_effects: "not_granted"
});

function fail(status, code, message, details = {}) {
  throw new KernelError(status, code, message, details);
}

function timestamp(value, field) {
  const normalized = requireString(value, field, 40);
  if (!Number.isFinite(Date.parse(normalized))) fail(400, "INVALID_INPUT", `${field} must be an ISO timestamp.`);
  return new Date(normalized).toISOString();
}

function artifact(value, field) {
  const input = requireExact(value, field, ["artifact_digest", "content"]);
  return {
    artifact_digest: requireDigest(input.artifact_digest, `${field}.artifact_digest`),
    content: structuredClone(input.content)
  };
}

function regressionArtifact(value, index) {
  const input = requireExact(value, `artifacts.regressions[${index}]`, ["role", "artifact_digest", "content"]);
  if (!["targeted", "retained"].includes(input.role)) {
    fail(400, "INVALID_VERIFICATION_REGRESSION_ROLE", "Regression role must be targeted or retained.");
  }
  return { role: input.role, ...artifact({ artifact_digest: input.artifact_digest, content: input.content },
    `artifacts.regressions[${index}]`) };
}

export function getVerificationRunnerContract() {
  return {
    contract_name: "alphonse.deterministic_verification_runner",
    contract_version: "0.2.0",
    inputs: ["original", "candidate", "bundle", "fixture", "regressions"],
    invariants: {
      artifacts_verified_by_digest: true,
      original_and_candidate_share_bundle: true,
      disposable_process: true,
      incompatible_regressions_reported: true,
      receipt_signed: true,
      passing_grants_eligibility_only: true
    },
    authority: { ...AUTHORITY }
  };
}

export function buildVerificationJob({
  verificationId, candidateId, deliveryId, runner, artifacts, verifiedAt
}) {
  const runnerInput = requireExact(runner, "runner", ["runner_id", "runner_version", "fixture_version"]);
  const artifactInput = requireExact(artifacts, "artifacts", [
    "original", "candidate", "bundle", "fixture", "regressions"
  ]);
  if (!Array.isArray(artifactInput.regressions) || artifactInput.regressions.length === 0) {
    fail(400, "VERIFICATION_REGRESSIONS_REQUIRED", "Verification requires at least one targeted regression.");
  }
  const normalizedArtifacts = {
    original: artifact(artifactInput.original, "artifacts.original"),
    candidate: artifact(artifactInput.candidate, "artifacts.candidate"),
    bundle: artifact(artifactInput.bundle, "artifacts.bundle"),
    fixture: artifact(artifactInput.fixture, "artifacts.fixture"),
    regressions: artifactInput.regressions.map(regressionArtifact)
  };
  if (normalizedArtifacts.regressions.filter((item) => item.role === "targeted").length !== 1) {
    fail(400, "VERIFICATION_TARGETED_REGRESSION_REQUIRED",
      "Verification requires exactly one targeted regression artifact.");
  }
  const artifactBindings = {
    original: normalizedArtifacts.original.artifact_digest,
    candidate: normalizedArtifacts.candidate.artifact_digest,
    bundle: normalizedArtifacts.bundle.artifact_digest,
    fixture: normalizedArtifacts.fixture.artifact_digest,
    regressions: normalizedArtifacts.regressions.map((item) => ({
      role: item.role, artifact_digest: item.artifact_digest
    }))
  };
  const normalizedRunner = {
    runner_id: requireUuid(runnerInput.runner_id, "runner.runner_id"),
    runner_version: requireString(runnerInput.runner_version, "runner.runner_version", 80),
    fixture_version: requireString(runnerInput.fixture_version, "runner.fixture_version", 80)
  };
  const identity = {
    candidate_id: requireUuid(candidateId, "candidate_id"),
    delivery_id: requireUuid(deliveryId, "delivery_id"),
    runner: normalizedRunner,
    artifact_bindings: artifactBindings
  };
  return {
    schema_version: "0.2.0",
    verification_id: requireUuid(verificationId, "verification_id"),
    ...identity,
    artifacts: normalizedArtifacts,
    verified_at: timestamp(verifiedAt, "verified_at"),
    verification_request_digest: sha256Digest(identity)
  };
}

function verifyArtifact(entry, field) {
  const actual = sha256Digest(entry.content);
  if (actual !== entry.artifact_digest) {
    fail(409, "VERIFICATION_ARTIFACT_DIGEST_MISMATCH", `${field} failed digest verification.`, {
      expected_digest: entry.artifact_digest,
      actual_digest: actual
    });
  }
}

export function validateVerificationJob(job) {
  const exactJob = requireExact(job, "verification job", [
    "schema_version", "verification_id", "candidate_id", "delivery_id", "runner", "artifact_bindings",
    "artifacts", "verified_at", "verification_request_digest"
  ]);
  if (exactJob.schema_version !== "0.2.0") fail(400, "VERIFICATION_VERSION_UNSUPPORTED", "Verification job version is unsupported.");
  const normalized = buildVerificationJob({
    verificationId: exactJob.verification_id,
    candidateId: exactJob.candidate_id,
    deliveryId: exactJob.delivery_id,
    runner: exactJob.runner,
    artifacts: exactJob.artifacts,
    verifiedAt: exactJob.verified_at
  });
  if (canonicalize(normalized) !== canonicalize(exactJob)) {
    fail(409, "VERIFICATION_JOB_NOT_CANONICAL", "Verification job does not match its exact normalized contract.");
  }
  for (const name of ["original", "candidate", "bundle", "fixture"]) {
    verifyArtifact(normalized.artifacts[name], `artifacts.${name}`);
  }
  normalized.artifacts.regressions.forEach((entry, index) => verifyArtifact(entry, `artifacts.regressions[${index}]`));
  const expectedIdentity = sha256Digest({
    candidate_id: normalized.candidate_id,
    delivery_id: normalized.delivery_id,
    runner: normalized.runner,
    artifact_bindings: normalized.artifact_bindings
  });
  if (expectedIdentity !== normalized.verification_request_digest) {
    fail(409, "VERIFICATION_REQUEST_DIGEST_MISMATCH", "Verification request identity does not match exact dependencies.");
  }
  const bundle = requireObject(normalized.artifacts.bundle.content, "bundle artifact");
  const fixtureWrapper = requireObject(normalized.artifacts.fixture.content, "fixture artifact");
  const fixture = requireObject(fixtureWrapper.content, "fixture artifact content");
  if (sha256Digest(fixture.fixtures) !== sha256Digest(bundle.fixtures)
      || sha256Digest(fixture.redacted_inputs) !== sha256Digest(bundle.redacted_inputs)) {
    fail(409, "VERIFICATION_FIXTURE_BUNDLE_MISMATCH", "Fixture artifact does not derive from the exact bundle.");
  }
  return normalized;
}

function checkOutcome(value, field) {
  const outcome = requireExact(value, field, ["status", "output_digest", "reason_code"]);
  if (!["passed", "failed"].includes(outcome.status)) {
    fail(400, "INVALID_VERIFICATION_OUTCOME", `${field}.status is invalid.`);
  }
  if (outcome.reason_code !== null && typeof outcome.reason_code !== "string") {
    fail(400, "INVALID_VERIFICATION_OUTCOME", `${field}.reason_code is invalid.`);
  }
  return {
    status: outcome.status,
    output_digest: requireDigest(outcome.output_digest, `${field}.output_digest`),
    reason_code: outcome.reason_code
  };
}

export function createVerificationResult(job, { outcomes, logs: executionLogs }) {
  const exactJob = validateVerificationJob(job);
  const outcomeInput = requireExact(outcomes, "outcomes", [
    "original_demonstrates_failure", "candidate_satisfies_target", "regressions"
  ]);
  if (!Array.isArray(outcomeInput.regressions) || outcomeInput.regressions.length !== exactJob.artifacts.regressions.length) {
    fail(400, "INVALID_VERIFICATION_OUTCOME", "Every bound regression requires one explicit outcome.");
  }
  const normalizedOutcomes = {
    original_demonstrates_failure: checkOutcome(
      outcomeInput.original_demonstrates_failure, "outcomes.original_demonstrates_failure"),
    candidate_satisfies_target: checkOutcome(
      outcomeInput.candidate_satisfies_target, "outcomes.candidate_satisfies_target"),
    regressions: structuredClone(outcomeInput.regressions)
  };
  const targetedRegression = normalizedOutcomes.regressions.find((item) => item.role === "targeted");
  const compatibleRegressionsPassed = normalizedOutcomes.regressions
    .filter((item) => item.executed === true).every((item) => item.status === "passed");
  const overallPassed = normalizedOutcomes.original_demonstrates_failure.status === "passed"
    && normalizedOutcomes.candidate_satisfies_target.status === "passed"
    && targetedRegression?.status === "passed" && targetedRegression?.executed === true
    && compatibleRegressionsPassed;
  const logsArtifact = {
    schema_version: "0.2.0",
    kind: "verification_logs",
    content: structuredClone(requireObject(executionLogs, "logs"))
  };
  const receipt = {
    schema_version: "0.2.0",
    verification_id: exactJob.verification_id,
    verification_request_digest: exactJob.verification_request_digest,
    candidate_id: exactJob.candidate_id,
    delivery_id: exactJob.delivery_id,
    runner: structuredClone(exactJob.runner),
    artifacts: structuredClone(exactJob.artifact_bindings),
    outcomes: normalizedOutcomes,
    evidence: {
      logs_artifact_digest: sha256Digest(logsArtifact),
      original_output_digest: normalizedOutcomes.original_demonstrates_failure.output_digest,
      candidate_output_digest: normalizedOutcomes.candidate_satisfies_target.output_digest
    },
    overall_result: overallPassed ? "passed" : "failed",
    verified_at: exactJob.verified_at,
    authority: { ...AUTHORITY }
  };
  return { receipt, logs: logsArtifact };
}

function signatureMaterial(receipt) {
  const { receipt_digest: ignoredDigest, signature: ignoredSignature, ...material } = receipt;
  return material;
}

export function signVerificationReceipt(receipt, { keyId, secret }) {
  const signingKeyId = requireString(keyId, "keyId", 160);
  const signingSecret = requireString(secret, "secret", 500);
  if (signingSecret.length < 32) fail(500, "VERIFICATION_SIGNING_KEY_INVALID", "Verification signing secret is too short.");
  const material = signatureMaterial(receipt);
  const receiptDigest = sha256Digest(material);
  const value = `hmac-sha256:${createHmac("sha256", signingSecret).update(canonicalize(material)).digest("hex")}`;
  return {
    ...structuredClone(material),
    receipt_digest: receiptDigest,
    signature: { algorithm: "hmac-sha256", key_id: signingKeyId, value }
  };
}

export function verifyVerificationReceiptSignature(receipt, { keyId, secret }) {
  const signature = receipt?.signature;
  const material = signatureMaterial(receipt ?? {});
  const expectedDigest = sha256Digest(material);
  const expectedValue = `hmac-sha256:${createHmac("sha256", requireString(secret, "secret", 500))
    .update(canonicalize(material)).digest("hex")}`;
  const supplied = Buffer.from(String(signature?.value ?? ""), "utf8");
  const expected = Buffer.from(expectedValue, "utf8");
  const valid = receipt?.receipt_digest === expectedDigest
    && signature?.algorithm === "hmac-sha256"
    && signature?.key_id === keyId
    && supplied.length === expected.length
    && timingSafeEqual(supplied, expected);
  if (!valid) fail(409, "VERIFICATION_SIGNATURE_INVALID", "Verification Receipt signature is invalid.");
  return true;
}

export function projectVerificationReceipt(receipt) {
  const passed = receipt?.overall_result === "passed";
  return {
    state: passed ? "verified" : "rejected",
    promotion_eligible: passed,
    promotion_authority: "not_granted",
    legal_next_operations: passed
      ? ["diagnostic.promotion.request"]
      : ["diagnostic.repair_task.create"]
  };
}
