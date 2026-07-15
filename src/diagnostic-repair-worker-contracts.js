import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SUPPORTED_OPERATIONS = new Set([
  "artifact.read", "candidate.submit", "task.heartbeat", "task.fail", "task.release"
]);
const REQUIRED_OUTPUTS = ["repair_candidate", "targeted_regression", "worker_logs"];

function fail(code, message, details = {}) {
  throw new KernelError(400, code, message, details);
}

export function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_INPUT", `${field} must be an object.`);
  return value;
}

export function requireExact(value, field, fields) {
  requireObject(value, field);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("INVALID_INPUT", `${field} fields must be exact.`, { expected, received: actual });
  }
  return value;
}

export function requireString(value, field, maximum = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    fail("INVALID_INPUT", `${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

export function requireUuid(value, field) {
  const result = requireString(value, field, 36);
  if (!UUID.test(result)) fail("INVALID_IDENTIFIER", `${field} must be a UUID.`);
  return result;
}

export function requireDigest(value, field) {
  const result = requireString(value, field, 80);
  if (!DIGEST.test(result)) fail("INVALID_ARTIFACT_DIGEST", `${field} must be a SHA-256 digest.`);
  return result;
}

function requireInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("INVALID_INPUT", `${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function requireStrings(value, field, { minimum = 1, maximum = 20, itemMaximum = 200 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail("INVALID_INPUT", `${field} must contain ${minimum} to ${maximum} strings.`);
  }
  const normalized = value.map((item, index) => requireString(item, `${field}[${index}]`, itemMaximum));
  if (new Set(normalized).size !== normalized.length) fail("INVALID_INPUT", `${field} cannot contain duplicates.`);
  return normalized;
}

function rejectSensitive(value, field) {
  const visit = (item, path, depth) => {
    if (depth > 24) fail("INVALID_INPUT", `${field} exceeds maximum nesting depth.`);
    if (!item || typeof item !== "object") return;
    for (const [key, nested] of Object.entries(item)) {
      if (/(secret|password|token|credential|private[_-]?key|authorization|cookie)/i.test(key)) {
        fail("SENSITIVE_WORKER_OUTPUT_REJECTED", `${path}.${key} contains credential-like material.`);
      }
      visit(nested, `${path}.${key}`, depth + 1);
    }
  };
  visit(value, field, 0);
}

function requireSafeJson(value, field) {
  requireObject(value, field);
  rejectSensitive(value, field);
  return structuredClone(value);
}

export function validateRuntimeAttribution(value) {
  rejectSensitive(requireObject(value, "runtime_attribution"), "runtime_attribution");
  const input = requireExact(value, "runtime_attribution", [
    "worker_kind", "runtime_version", "attachment_version"
  ]);
  return {
    worker_kind: requireString(input.worker_kind, "runtime_attribution.worker_kind", 100),
    runtime_version: requireString(input.runtime_version, "runtime_attribution.runtime_version", 100),
    attachment_version: requireString(input.attachment_version, "runtime_attribution.attachment_version", 100)
  };
}

export function validateRepairTaskBounds(value) {
  const input = requireExact(value, "repair task bounds", [
    "allowed_operations", "artifact_limits", "lease_duration_seconds", "expected_outputs"
  ]);
  const allowedOperations = requireStrings(input.allowed_operations, "allowed_operations", { maximum: 10 });
  for (const operation of allowedOperations) {
    if (!SUPPORTED_OPERATIONS.has(operation)) {
      fail("REPAIR_OPERATION_NOT_ALLOWED", `Repair Task operation ${operation} is not available.`);
    }
  }
  for (const required of ["artifact.read", "candidate.submit"]) {
    if (!allowedOperations.includes(required)) fail("INVALID_REPAIR_TASK", `Repair Task requires ${required}.`);
  }
  const limits = requireExact(input.artifact_limits, "artifact_limits", [
    "max_artifact_bytes", "max_total_bytes", "allowed_media_types"
  ]);
  const maxArtifactBytes = requireInteger(limits.max_artifact_bytes, "max_artifact_bytes", 256, 2 * 1024 * 1024);
  const maxTotalBytes = requireInteger(limits.max_total_bytes, "max_total_bytes", maxArtifactBytes, 6 * 1024 * 1024);
  const allowedMediaTypes = requireStrings(limits.allowed_media_types, "allowed_media_types", { maximum: 10, itemMaximum: 100 });
  const expectedOutputs = requireStrings(input.expected_outputs, "expected_outputs", { maximum: 10 });
  if (JSON.stringify([...expectedOutputs].sort()) !== JSON.stringify([...REQUIRED_OUTPUTS].sort())) {
    fail("INVALID_REPAIR_TASK", "Repair Task expected outputs must bind candidate, regression, and worker logs exactly.");
  }
  return {
    allowed_operations: allowedOperations,
    artifact_limits: {
      max_artifact_bytes: maxArtifactBytes,
      max_total_bytes: maxTotalBytes,
      allowed_media_types: allowedMediaTypes
    },
    lease_duration_seconds: requireInteger(input.lease_duration_seconds, "lease_duration_seconds", 5, 3600),
    expected_outputs: expectedOutputs
  };
}

export function validateWorkerRegistration(value) {
  const input = requireExact(value, "worker registration", [
    "passport_id", "work_intent_id", "protocol_version", "runtime_attribution"
  ]);
  if (input.protocol_version !== "0.2.0") fail("WORKER_PROTOCOL_UNSUPPORTED", "Worker protocol version must be 0.2.0.");
  return {
    passport_id: requireUuid(input.passport_id, "passport_id"),
    work_intent_id: requireUuid(input.work_intent_id, "work_intent_id"),
    protocol_version: "0.2.0",
    runtime_attribution: validateRuntimeAttribution(input.runtime_attribution)
  };
}

export function validateRepairIntentBoundary(scope, constraints, caseId, baseRevisionId) {
  const exactScope = requireExact(scope, "repair Work Intent scope", ["case_id", "base_revision_id"]);
  const exactConstraints = requireExact(constraints, "repair Work Intent constraints", [
    "no_verification", "no_promotion", "no_external_effects"
  ]);
  if (exactScope.case_id !== caseId || exactScope.base_revision_id !== baseRevisionId) {
    throw new KernelError(409, "REPAIR_INTENT_SCOPE_MISMATCH",
      "Repair Work Intent must bind the exact case and base revision.");
  }
  if (exactConstraints.no_verification !== true || exactConstraints.no_promotion !== true ||
      exactConstraints.no_external_effects !== true) {
    throw new KernelError(409, "REPAIR_INTENT_CONSTRAINTS_REQUIRED",
      "Repair Work Intent must deny verification, promotion, and external effects.");
  }
  return {
    scope: { case_id: requireUuid(exactScope.case_id, "scope.case_id"),
      base_revision_id: requireUuid(exactScope.base_revision_id, "scope.base_revision_id") },
    constraints: { no_verification: true, no_promotion: true, no_external_effects: true }
  };
}

export function validateRepairCandidateOutput(value, artifactLimits) {
  const input = requireExact(value, "candidate output", [
    "intended_behavior_change", "candidate_artifact", "targeted_regression_artifact",
    "logs_artifact", "runtime_attribution"
  ]);
  const limits = requireExact(artifactLimits, "artifact_limits", [
    "max_artifact_bytes", "max_total_bytes", "allowed_media_types"
  ]);
  const artifacts = {};
  let totalBytes = 0;
  for (const [key, source] of Object.entries({
    candidate: input.candidate_artifact,
    targeted_regression: input.targeted_regression_artifact,
    logs: input.logs_artifact
  })) {
    const artifact = requireExact(source, `${key}_artifact`, ["media_type", "content"]);
    const mediaType = requireString(artifact.media_type, `${key}_artifact.media_type`, 100);
    if (!limits.allowed_media_types.includes(mediaType)) {
      fail("REPAIR_ARTIFACT_MEDIA_TYPE_REJECTED", `${key} artifact media type is not allowed.`);
    }
    const content = requireSafeJson(artifact.content, `${key}_artifact.content`);
    const sizeBytes = Buffer.byteLength(canonicalize(content), "utf8");
    if (sizeBytes > limits.max_artifact_bytes) {
      fail("REPAIR_ARTIFACT_LIMIT_EXCEEDED", `${key} artifact exceeds its byte limit.`);
    }
    totalBytes += sizeBytes;
    artifacts[key] = { media_type: mediaType, content, size_bytes: sizeBytes };
  }
  if (totalBytes > limits.max_total_bytes) fail("REPAIR_ARTIFACT_LIMIT_EXCEEDED", "Worker output exceeds total byte limit.");
  return {
    intended_behavior_change: requireString(input.intended_behavior_change, "intended_behavior_change", 2000),
    candidate_artifact: artifacts.candidate,
    targeted_regression_artifact: artifacts.targeted_regression,
    logs_artifact: artifacts.logs,
    runtime_attribution: validateRuntimeAttribution(input.runtime_attribution),
    artifact_limits: structuredClone(limits),
    total_size_bytes: totalBytes
  };
}

export function buildRepairCandidateMaterial({
  taskId, caseId, baseRevisionId, reproductionBundleId, output, artifactDigests
}) {
  const content = {
    schema_version: "0.2.0",
    task_id: requireUuid(taskId, "task_id"),
    case_id: requireUuid(caseId, "case_id"),
    base_revision_id: requireUuid(baseRevisionId, "base_revision_id"),
    reproduction_bundle_id: requireUuid(reproductionBundleId, "reproduction_bundle_id"),
    intended_behavior_change: output.intended_behavior_change,
    artifacts: {
      candidate: requireDigest(artifactDigests.candidate, "candidate artifact digest"),
      targeted_regression: requireDigest(artifactDigests.targeted_regression, "regression artifact digest"),
      logs: requireDigest(artifactDigests.logs, "logs artifact digest")
    },
    runtime_attribution: structuredClone(output.runtime_attribution),
    authority: {
      verification: "not_granted",
      owner_authorization: "not_granted",
      promotion: "not_granted",
      rollback: "not_granted"
    }
  };
  return { content, material_digest: sha256Digest(content) };
}

export function buildRepairWorkspaceManifest({
  taskId, leaseEpoch, baseRevisionArtifactDigest, reproductionBundleArtifactDigest, bounds
}) {
  return {
    schema_version: "0.2.0",
    task_id: requireUuid(taskId, "task_id"),
    lease_epoch: requireInteger(leaseEpoch, "lease_epoch", 1, Number.MAX_SAFE_INTEGER),
    ephemeral: true,
    ambient_filesystem_access: false,
    files: [
      { path: "inputs/base-revision.json", artifact_digest: requireDigest(baseRevisionArtifactDigest, "base revision digest") },
      { path: "inputs/reproduction-bundle.json", artifact_digest: requireDigest(reproductionBundleArtifactDigest, "bundle digest") }
    ],
    allowed_operations: [...bounds.allowed_operations],
    artifact_limits: structuredClone(bounds.artifact_limits),
    expected_outputs: [...bounds.expected_outputs],
    authority: {
      verification: "not_granted",
      owner_authorization: "not_granted",
      promotion: "not_granted",
      rollback: "not_granted"
    }
  };
}

export function projectRepairTask(task, events, now = Date.now()) {
  const ordered = [...events];
  const terminal = [...ordered].reverse().find((event) =>
    ["submitted", "failed", "released", "cancelled", "expired"].includes(event.event_type));
  if (terminal) return { state: terminal.event_type, lease_epoch: task.lease_epoch, legal_next_operations: [] };
  const leaseEvent = [...ordered].reverse().find((event) =>
    ["leased", "heartbeat"].includes(event.event_type) && event.lease_epoch === task.lease_epoch);
  if (!leaseEvent) {
    return { state: "available", lease_epoch: task.lease_epoch,
      legal_next_operations: ["diagnostic.repair_task.claim"] };
  }
  if (now >= Date.parse(leaseEvent.lease_expires_at)) {
    return { state: "expired", lease_epoch: task.lease_epoch, lease_expires_at: leaseEvent.lease_expires_at,
      legal_next_operations: ["diagnostic.repair_task.create"] };
  }
  return {
    state: "leased",
    lease_epoch: task.lease_epoch,
    lease_expires_at: leaseEvent.lease_expires_at,
    legal_next_operations: [
      "diagnostic.repair_task.heartbeat", "diagnostic.repair_candidate.submit",
      "diagnostic.repair_task.fail", "diagnostic.repair_task.release"
    ]
  };
}

export function projectDiagnosticCaseWithRepair({ failureSpecification, bundles, attempts, tasks = [], candidates = [] }) {
  if (candidates.some((candidate) => candidate.status === "verified")) {
    return {
      state: "verified",
      legal_next_operations: ["diagnostic.repair_verification.get", "diagnostic.promotion.request"]
    };
  }
  if (candidates.some((candidate) => ["proposed", "verification_pending"].includes(candidate.status))) {
    return { state: "candidate_available", legal_next_operations: ["diagnostic.repair_candidate.get"] };
  }
  if (tasks.some((task) => ["available", "leased"].includes(task.projection?.state))) {
    return { state: "repair_in_progress", legal_next_operations: ["diagnostic.repair_task.get"] };
  }
  if (bundles.some((bundle) => bundle.reproduction_status === "demonstrated")) {
    return { state: "reproducible", legal_next_operations: ["diagnostic.repair_task.create"] };
  }
  if (failureSpecification) {
    return { state: "specified", legal_next_operations: ["diagnostic.reproduction.create"] };
  }
  return { state: "open", legal_next_operations: ["diagnostic.failure_specification.confirm"] };
}
