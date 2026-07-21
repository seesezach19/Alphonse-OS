import { canonicalize, sha256Digest } from "./canonical-json.js";
import { assertNoSensitiveMaterial } from "./coverage-onboarding-contracts.js";
import { KernelError } from "./errors.js";

export const COVERAGE_REVIEW_BUNDLE_SCHEMA_VERSION = "alphonse.coverage-review-bundle.v0.1";
export const COVERAGE_REVIEW_APPROVAL_SCHEMA_VERSION = "alphonse.coverage-review-approval.v0.1";
export const COVERAGE_REVIEW_AUTHORITY_GRANTED = Object.freeze([
  "compile_exact_bundle", "request_exact_registration"
]);
export const COVERAGE_REVIEW_AUTHORITY_DENIED = Object.freeze([
  "source_control", "manifest_import", "registration", "provider_credential", "workflow_execution",
  "repair", "verification", "promotion", "target_change", "external_effect"
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const STABLE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function fail(code, message, details = {}) {
  throw new KernelError(400, code, message, details);
}

function exact(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("COVERAGE_REVIEW_INPUT_INVALID", `${field} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalize(actual) !== canonicalize(expected)) {
    fail("COVERAGE_REVIEW_INPUT_INVALID", `${field} fields must be exact.`, { expected, actual });
  }
  return value;
}

function string(value, field, maximum = 1000, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
      || (pattern && !pattern.test(value))) {
    fail("COVERAGE_REVIEW_INPUT_INVALID", `${field} is invalid.`);
  }
  return value;
}

function uuid(value, field) {
  return string(value, field, 100, UUID);
}

function digest(value, field) {
  return string(value, field, 80, DIGEST);
}

function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail("COVERAGE_REVIEW_INPUT_INVALID", `${field} is outside its integer bounds.`);
  }
  return value;
}

function command(value, operationId) {
  const envelope = exact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) fail("UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  return { command_id: string(envelope.command_id, "command_id", 160),
    operation_id: operationId, input: envelope.input };
}

function reference(value, field) {
  const input = exact(value, field, ["reference_kind", "reference_id", "artifact_digest"]);
  return {
    reference_kind: string(input.reference_kind, `${field}.reference_kind`, 100, STABLE),
    reference_id: string(input.reference_id, `${field}.reference_id`, 200, STABLE),
    artifact_digest: digest(input.artifact_digest, `${field}.artifact_digest`)
  };
}

function references(value, field, maximum = 100) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail("COVERAGE_REVIEW_INPUT_INVALID", `${field} must be an array with at most ${maximum} items.`);
  }
  const normalized = value.map((item, index) => reference(item, `${field}[${index}]`));
  if (new Set(normalized.map((item) => canonicalize(item))).size !== normalized.length) {
    fail("COVERAGE_REVIEW_INPUT_INVALID", `${field} contains duplicate exact references.`);
  }
  return normalized.sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)));
}

export function validateCoverageReviewBundleCreateCommand(value) {
  const envelope = command(value, "diagnostic.coverage_review_bundle.create");
  const input = exact(envelope.input, "input", [
    "onboarding_id", "expected_revision", "expected_event_head_digest", "snapshot_digest",
    "interpretation_digest", "integration_contract_references", "behavior_contract_references",
    "fixture_references", "repair_binding_reference", "verification_strategy_reference",
    "coverage_profile_reference"
  ]);
  const normalized = {
    onboarding_id: uuid(input.onboarding_id, "input.onboarding_id"),
    expected_revision: integer(input.expected_revision, "input.expected_revision", 4),
    expected_event_head_digest: digest(input.expected_event_head_digest,
      "input.expected_event_head_digest"),
    snapshot_digest: digest(input.snapshot_digest, "input.snapshot_digest"),
    interpretation_digest: digest(input.interpretation_digest, "input.interpretation_digest"),
    integration_contract_references: references(input.integration_contract_references,
      "input.integration_contract_references"),
    behavior_contract_references: references(input.behavior_contract_references,
      "input.behavior_contract_references"),
    fixture_references: references(input.fixture_references, "input.fixture_references"),
    repair_binding_reference: input.repair_binding_reference === null ? null
      : reference(input.repair_binding_reference, "input.repair_binding_reference"),
    verification_strategy_reference: input.verification_strategy_reference === null ? null
      : reference(input.verification_strategy_reference, "input.verification_strategy_reference"),
    coverage_profile_reference: input.coverage_profile_reference === null ? null
      : reference(input.coverage_profile_reference, "input.coverage_profile_reference")
  };
  assertNoSensitiveMaterial(normalized, "input", 512 * 1024);
  return { ...envelope, input: normalized };
}

function allReferences(input) {
  return [
    ...input.integration_contract_references,
    ...input.behavior_contract_references,
    ...input.fixture_references,
    ...(input.repair_binding_reference ? [input.repair_binding_reference] : []),
    ...(input.verification_strategy_reference ? [input.verification_strategy_reference] : []),
    ...(input.coverage_profile_reference ? [input.coverage_profile_reference] : [])
  ].sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)));
}

export function buildCoverageReviewBundle({ onboarding, snapshot, interpretation, input }) {
  if (!["reviewable", "review_required"].includes(onboarding.status)
      || onboarding.review_eligible !== true
      || onboarding.revision !== input.expected_revision
      || onboarding.event_head_digest !== input.expected_event_head_digest
      || onboarding.active_snapshot_digest !== input.snapshot_digest
      || onboarding.active_interpretation_digest !== input.interpretation_digest) {
    throw new KernelError(409, "COVERAGE_REVIEW_STATE_CONFLICT",
      "Review bundle assembly requires the exact current reviewable onboarding state.");
  }
  if (snapshot?.schema_version !== "alphonse.workflow-discovery-snapshot.v0.1"
      || snapshot.onboarding_id !== onboarding.onboarding_id
      || interpretation?.schema_version !== "alphonse.workflow-interpretation-claim.v0.1"
      || interpretation.onboarding_id !== onboarding.onboarding_id
      || interpretation.snapshot_digest !== input.snapshot_digest) {
    throw new KernelError(409, "COVERAGE_REVIEW_MATERIAL_INVALID",
      "Review bundle source artifacts do not match the exact active onboarding material.");
  }
  const dispositions = onboarding.ambiguities.map((item) => ({
    ambiguity_id: item.ambiguity_id,
    ambiguity_digest: item.ambiguity_digest,
    resolution_digest: item.resolution?.resolution_digest ?? null,
    confirmation_digest: item.resolution?.confirmation_digest ?? null,
    status: item.status,
    blocking: item.blocking
  })).sort((left, right) => left.ambiguity_id.localeCompare(right.ambiguity_id));
  if (dispositions.some((item) => item.blocking && item.status !== "resolved")) {
    throw new KernelError(409, "COVERAGE_REVIEW_BLOCKING_AMBIGUITY",
      "Every blocking ambiguity must have one exact resolution before review assembly.");
  }
  const confirmationDigests = dispositions.map((item) => item.confirmation_digest)
    .filter(Boolean).sort();
  const admittedReferences = allReferences(input);
  const missingReferenceLimitations = [
    ["integration_contract", input.integration_contract_references.length],
    ["behavior_contract", input.behavior_contract_references.length],
    ["fixture", input.fixture_references.length],
    ["repair_binding", input.repair_binding_reference ? 1 : 0],
    ["verification_strategy", input.verification_strategy_reference ? 1 : 0],
    ["coverage_profile", input.coverage_profile_reference ? 1 : 0]
  ].filter(([, count]) => count === 0).map(([kind]) => `${kind}_not_admitted`);
  const unknownClaims = interpretation.claims.filter((item) => item.status === "unknown");
  const limitations = [...new Set([
    ...interpretation.claims.flatMap((item) => item.limitations),
    ...unknownClaims.map((item) => item.unknown_reason),
    ...onboarding.limitations.map((item) => item.reason),
    ...missingReferenceLimitations
  ].filter(Boolean))].sort();
  const document = {
    schema_version: COVERAGE_REVIEW_BUNDLE_SCHEMA_VERSION,
    onboarding_id: onboarding.onboarding_id,
    onboarding_revision: onboarding.revision,
    event_head_digest: onboarding.event_head_digest,
    status: "reviewable",
    workflow_reference: onboarding.workflow_reference,
    workflow_reference_digest: sha256Digest(onboarding.workflow_reference),
    snapshot_digest: input.snapshot_digest,
    interpretation_digest: input.interpretation_digest,
    confirmation_digests: confirmationDigests,
    ambiguity_dispositions: dispositions,
    objective_and_consequences: interpretation.claims
      .filter((item) => ["objective", "consequence"].includes(item.kind)),
    effect_inventory: interpretation.claims.filter((item) => item.kind === "effect"),
    dependencies: interpretation.claims.filter((item) => item.kind === "dependency"),
    unknowns: unknownClaims.map((item) => ({
      subject_reference: { type: "claim", id: item.claim_id, digest: sha256Digest(item) },
      reason: item.unknown_reason,
      blocking: false
    })),
    limitations,
    redaction_policy_reference: {
      policy_id: snapshot.redaction.policy_id,
      snapshot_digest: input.snapshot_digest,
      excluded_fields: snapshot.redaction.excluded_fields
    },
    integration_contract_references: input.integration_contract_references,
    behavior_contract_references: input.behavior_contract_references,
    fixture_references: input.fixture_references,
    repair_binding_reference: input.repair_binding_reference,
    verification_strategy_reference: input.verification_strategy_reference,
    coverage_profile_reference: input.coverage_profile_reference,
    workflow_binding: {
      adapter_binding: onboarding.adapter_binding,
      adapter_binding_digest: sha256Digest(onboarding.adapter_binding),
      selected_metadata_digest: snapshot.provenance.selected_metadata_digest
    },
    promotion_conditions: { status: "not_established", authority: "none" },
    rollback_assumptions: { status: "not_established", authority: "none" },
    reference_manifest_digest: sha256Digest(admittedReferences),
    authority: "none"
  };
  assertNoSensitiveMaterial(document, "coverage_review_bundle", 2 * 1024 * 1024);
  return {
    document,
    confirmation_manifest_digest: sha256Digest(confirmationDigests),
    reference_manifest_digest: document.reference_manifest_digest
  };
}

export function validateCoverageReviewApproveCommand(value) {
  const envelope = command(value, "kernel.coverage_review.approve");
  const input = exact(envelope.input, "input", [
    "onboarding_id", "review_bundle_digest", "expected_review_state", "work_intent_id",
    "scope", "rationale", "valid_until", "authority_granted", "authority_denied"
  ]);
  const state = exact(input.expected_review_state, "input.expected_review_state",
    ["onboarding_revision", "event_head_digest", "status"]);
  const scope = exact(input.scope, "input.scope", [
    "kind", "onboarding_id", "workflow_reference_digest", "review_bundle_digest"
  ]);
  if (state.status !== "awaiting_approval"
      || scope.kind !== "exact_workflow_and_review_digest"
      || canonicalize(input.authority_granted) !== canonicalize(COVERAGE_REVIEW_AUTHORITY_GRANTED)
      || canonicalize(input.authority_denied) !== canonicalize(COVERAGE_REVIEW_AUTHORITY_DENIED)) {
    fail("COVERAGE_REVIEW_AUTHORITY_INVALID",
      "Coverage Review Approval authority and state must match the exact fixed contract.");
  }
  const bundleDigest = digest(input.review_bundle_digest, "input.review_bundle_digest");
  const onboardingId = uuid(input.onboarding_id, "input.onboarding_id");
  if (scope.onboarding_id !== onboardingId || scope.review_bundle_digest !== bundleDigest) {
    fail("COVERAGE_REVIEW_INPUT_INVALID", "Approval scope must repeat the exact onboarding and bundle digest.");
  }
  if (input.valid_until !== null
      && (typeof input.valid_until !== "string" || Number.isNaN(Date.parse(input.valid_until)))) {
    fail("COVERAGE_REVIEW_INPUT_INVALID", "input.valid_until must be a date-time or null.");
  }
  const normalized = {
    onboarding_id: onboardingId,
    review_bundle_digest: bundleDigest,
    expected_review_state: {
      onboarding_revision: integer(state.onboarding_revision,
        "input.expected_review_state.onboarding_revision", 5),
      event_head_digest: digest(state.event_head_digest,
        "input.expected_review_state.event_head_digest"),
      status: state.status
    },
    work_intent_id: uuid(input.work_intent_id, "input.work_intent_id"),
    scope: {
      kind: scope.kind,
      onboarding_id: onboardingId,
      workflow_reference_digest: digest(scope.workflow_reference_digest,
        "input.scope.workflow_reference_digest"),
      review_bundle_digest: bundleDigest
    },
    rationale: string(input.rationale, "input.rationale", 2000),
    valid_until: input.valid_until === null ? null : new Date(input.valid_until).toISOString(),
    authority_granted: [...COVERAGE_REVIEW_AUTHORITY_GRANTED],
    authority_denied: [...COVERAGE_REVIEW_AUTHORITY_DENIED]
  };
  assertNoSensitiveMaterial(normalized, "input", 128 * 1024);
  return { ...envelope, input: normalized };
}

export function buildCoverageReviewApproval({ approvalId, bundleState, workIntent, input,
  principalId, executedBy, issuedAt }) {
  const reviewState = {
    onboarding_revision: bundleState.onboarding.revision,
    event_head_digest: bundleState.onboarding.event_head_digest,
    status: bundleState.onboarding.status
  };
  if (canonicalize(reviewState) !== canonicalize(input.expected_review_state)
      || bundleState.review_bundle.review_bundle_digest !== input.review_bundle_digest
      || bundleState.review_bundle.workflow_reference_digest !== input.scope.workflow_reference_digest
      || bundleState.review_bundle.onboarding_id !== input.onboarding_id
      || workIntent.work_intent_id !== input.work_intent_id
      || workIntent.work_intent_id !== bundleState.onboarding.work_intent.work_intent_id
      || workIntent.payload_digest !== bundleState.onboarding.work_intent.work_intent_digest) {
    throw new KernelError(409, "COVERAGE_REVIEW_APPROVAL_STATE_CONFLICT",
      "Approval input does not match the exact current review bundle, state, workflow, and Work Intent.");
  }
  const issued = new Date(issuedAt).toISOString();
  if (input.valid_until !== null && Date.parse(input.valid_until) <= Date.parse(issued)) {
    throw new KernelError(400, "COVERAGE_REVIEW_VALIDITY_INVALID",
      "Coverage Review Approval validity must end after its Kernel acceptance time.");
  }
  const document = {
    schema_version: COVERAGE_REVIEW_APPROVAL_SCHEMA_VERSION,
    approval_id: approvalId,
    onboarding_id: input.onboarding_id,
    review_bundle_digest: input.review_bundle_digest,
    review_state: reviewState,
    review_state_digest: sha256Digest(reviewState),
    principal_id: principalId,
    work_intent_id: input.work_intent_id,
    work_intent_digest: workIntent.payload_digest,
    scope: input.scope,
    rationale: input.rationale,
    issued_at: issued,
    valid_until: input.valid_until,
    authority_granted: input.authority_granted,
    authority_denied: input.authority_denied,
    executed_by: executedBy
  };
  assertNoSensitiveMaterial(document, "coverage_review_approval", 256 * 1024);
  return { document, approval_digest: sha256Digest(document) };
}
