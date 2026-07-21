import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { assertNoSensitiveMaterial } from "./coverage-onboarding-contracts.js";
import { KernelError } from "./errors.js";

export const WORKFLOW_INTERPRETATION_SCHEMA_VERSION =
  "alphonse.workflow-interpretation-claim.v0.1";
export const COVERAGE_AMBIGUITY_SCHEMA_VERSION = "alphonse.coverage-ambiguity.v0.1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const STABLE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const CLAIM_KINDS = new Set(["objective", "consequence", "integration", "effect", "dependency", "limitation"]);
const CLAIM_STATUSES = new Set(["observed", "inferred", "conflicted", "unknown"]);
const AMBIGUITY_KINDS = new Set([
  "objective", "consequence", "evidence", "effect", "privacy", "fixture", "repair", "promotion", "rollback"
]);

function fail(code, message, details = {}) {
  throw new KernelError(400, code, message, details);
}

function exact(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalize(actual) !== canonicalize(expected)) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field} fields must be exact.`, { expected, actual });
  }
  return value;
}

function string(value, field, maximum = 1000, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
      || (pattern && !pattern.test(value))) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field} is invalid.`);
  }
  return value;
}

function uuid(value, field) {
  return string(value, field, 100, UUID);
}

function digest(value, field) {
  return string(value, field, 80, DIGEST);
}

function dateTime(value, field) {
  if (typeof value !== "string" || value.length > 60 || Number.isNaN(Date.parse(value))) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field} must be an exact date-time.`);
  }
  return new Date(value).toISOString();
}

function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field} is outside its integer bounds.`);
  }
  return value;
}

function command(value, operationId) {
  const envelope = exact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) {
    fail("UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  }
  return {
    command_id: string(envelope.command_id, "command_id", 160),
    operation_id: operationId,
    input: envelope.input
  };
}

function list(value, field, validate, minimum = 0, maximum = 100) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID",
      `${field} must contain ${minimum} to ${maximum} items.`);
  }
  return value.map((item, index) => validate(item, `${field}[${index}]`));
}

function evidenceReference(value, field) {
  const reference = exact(value, field, ["artifact_digest", "json_pointer"]);
  const pointer = string(reference.json_pointer, `${field}.json_pointer`, 1000);
  if (!/^(?:\/(?:[^~]|~[01])*)+$/.test(pointer)) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field}.json_pointer must be an RFC 6901 pointer.`);
  }
  return {
    artifact_digest: digest(reference.artifact_digest, `${field}.artifact_digest`),
    json_pointer: pointer
  };
}

function evidenceReferences(value, field, minimum = 1) {
  const references = list(value, field, evidenceReference, minimum, 30);
  const identities = references.map((item) => canonicalize(item));
  if (new Set(identities).size !== identities.length) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field} contains duplicate citations.`);
  }
  return references;
}

function claim(value, field) {
  const input = exact(value, field, [
    "claim_id", "kind", "status", "statement", "evidence_references", "confidence",
    "conflicting_evidence_references", "unknown_reason", "limitations"
  ]);
  if (!CLAIM_KINDS.has(input.kind) || !CLAIM_STATUSES.has(input.status)) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field} has an unsupported kind or status.`);
  }
  const confidence = input.confidence === null ? null
    : string(input.confidence, `${field}.confidence`, 10);
  if (confidence !== null && !new Set(["low", "medium", "high"]).has(confidence)) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field}.confidence is unsupported.`);
  }
  const unknownReason = input.unknown_reason === null ? null
    : string(input.unknown_reason, `${field}.unknown_reason`, 1000);
  const normalized = {
    claim_id: string(input.claim_id, `${field}.claim_id`, 160, STABLE),
    kind: input.kind,
    status: input.status,
    statement: string(input.statement, `${field}.statement`, 3000),
    evidence_references: evidenceReferences(input.evidence_references,
      `${field}.evidence_references`, 1),
    confidence,
    conflicting_evidence_references: evidenceReferences(input.conflicting_evidence_references,
      `${field}.conflicting_evidence_references`, input.status === "conflicted" ? 1 : 0),
    unknown_reason: unknownReason,
    limitations: list(input.limitations, `${field}.limitations`,
      (item, itemField) => string(item, itemField, 1000), 0, 20)
  };
  if ((input.status === "inferred") !== (confidence !== null)
      || (input.status === "unknown") !== (unknownReason !== null)
      || (input.status !== "conflicted" && normalized.conflicting_evidence_references.length > 0)) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID",
      `${field} does not satisfy its typed evidence, confidence, conflict, and unknown contract.`);
  }
  return normalized;
}

function ambiguity(value, field, claimIds) {
  const input = exact(value, field, [
    "ambiguity_id", "kind", "claim_references", "question", "blocking", "choices",
    "evidence_references"
  ]);
  if (!AMBIGUITY_KINDS.has(input.kind) || typeof input.blocking !== "boolean") {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field} has an unsupported kind or blocking value.`);
  }
  const claimReferences = list(input.claim_references, `${field}.claim_references`,
    (item, itemField) => string(item, itemField, 160, STABLE), 1, 30);
  if (new Set(claimReferences).size !== claimReferences.length
      || claimReferences.some((item) => !claimIds.has(item))) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID",
      `${field}.claim_references must identify exact claims in this submission.`);
  }
  const choices = list(input.choices, `${field}.choices`, (item, itemField) => {
    const choice = exact(item, itemField, ["choice_id", "meaning"]);
    return {
      choice_id: string(choice.choice_id, `${itemField}.choice_id`, 160, STABLE),
      meaning: string(choice.meaning, `${itemField}.meaning`, 1000)
    };
  }, 2, 20);
  if (new Set(choices.map((item) => item.choice_id)).size !== choices.length) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", `${field}.choices contains duplicate IDs.`);
  }
  return {
    ambiguity_id: string(input.ambiguity_id, `${field}.ambiguity_id`, 160, STABLE),
    kind: input.kind,
    claim_references: claimReferences,
    question: string(input.question, `${field}.question`, 2000),
    blocking: input.blocking,
    choices,
    evidence_references: evidenceReferences(input.evidence_references,
      `${field}.evidence_references`, 1)
  };
}

function provenance(value, snapshotDigest) {
  const input = exact(value, "input.provenance", [
    "passport_id", "work_intent_id", "instruction_digest", "model", "runtime",
    "input_artifact_digests"
  ]);
  const model = exact(input.model, "input.provenance.model", ["provider", "model", "version"]);
  const runtime = exact(input.runtime, "input.provenance.runtime", ["name", "version"]);
  const inputDigests = list(input.input_artifact_digests, "input.provenance.input_artifact_digests",
    (item, field) => digest(item, field), 1, 30);
  if (canonicalize(inputDigests) !== canonicalize([snapshotDigest])) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID",
      "input.provenance.input_artifact_digests must bind only the exact assigned snapshot.");
  }
  return {
    passport_id: uuid(input.passport_id, "input.provenance.passport_id"),
    work_intent_id: uuid(input.work_intent_id, "input.provenance.work_intent_id"),
    instruction_digest: digest(input.instruction_digest, "input.provenance.instruction_digest"),
    model: {
      provider: string(model.provider, "input.provenance.model.provider", 100),
      model: string(model.model, "input.provenance.model.model", 200),
      version: string(model.version, "input.provenance.model.version", 200)
    },
    runtime: {
      name: string(runtime.name, "input.provenance.runtime.name", 100),
      version: string(runtime.version, "input.provenance.runtime.version", 100)
    },
    input_artifact_digests: inputDigests
  };
}

export function validateCoverageInterpretationAssignCommand(value) {
  const envelope = command(value, "diagnostic.coverage_interpretation.assign");
  const input = exact(envelope.input, "input", [
    "onboarding_id", "snapshot_digest", "expected_revision", "passport_id", "agent_principal_id",
    "work_intent_id", "expires_at"
  ]);
  const normalized = {
    onboarding_id: uuid(input.onboarding_id, "input.onboarding_id"),
    snapshot_digest: digest(input.snapshot_digest, "input.snapshot_digest"),
    expected_revision: integer(input.expected_revision, "input.expected_revision", 2),
    passport_id: uuid(input.passport_id, "input.passport_id"),
    agent_principal_id: uuid(input.agent_principal_id, "input.agent_principal_id"),
    work_intent_id: uuid(input.work_intent_id, "input.work_intent_id"),
    expires_at: dateTime(input.expires_at, "input.expires_at")
  };
  assertNoSensitiveMaterial(normalized, "input", 32 * 1024);
  return { ...envelope, input: normalized };
}

export function validateCoverageInterpretationSubmitCommand(value) {
  const envelope = command(value, "diagnostic.coverage_interpretation.submit");
  const input = exact(envelope.input, "input", [
    "assignment_id", "onboarding_id", "snapshot_digest", "expected_revision", "proposed_at",
    "claims", "ambiguities", "provenance", "supersedes_interpretation_digest"
  ]);
  const snapshotDigest = digest(input.snapshot_digest, "input.snapshot_digest");
  const claims = list(input.claims, "input.claims", claim, 1, 100);
  const claimIds = new Set(claims.map((item) => item.claim_id));
  if (claimIds.size !== claims.length) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", "input.claims contains duplicate claim IDs.");
  }
  const ambiguities = list(input.ambiguities, "input.ambiguities",
    (item, field) => ambiguity(item, field, claimIds), 0, 100);
  if (new Set(ambiguities.map((item) => item.ambiguity_id)).size !== ambiguities.length) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", "input.ambiguities contains duplicate ambiguity IDs.");
  }
  const normalized = {
    assignment_id: uuid(input.assignment_id, "input.assignment_id"),
    onboarding_id: uuid(input.onboarding_id, "input.onboarding_id"),
    snapshot_digest: snapshotDigest,
    expected_revision: integer(input.expected_revision, "input.expected_revision", 2),
    proposed_at: dateTime(input.proposed_at, "input.proposed_at"),
    claims,
    ambiguities,
    provenance: provenance(input.provenance, snapshotDigest),
    supersedes_interpretation_digest: input.supersedes_interpretation_digest === null ? null
      : digest(input.supersedes_interpretation_digest, "input.supersedes_interpretation_digest")
  };
  assertNoSensitiveMaterial(normalized, "input", 1024 * 1024);
  return { ...envelope, input: normalized };
}

function boundedSuppliedValue(value) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0 && value.length <= 2000) return value;
  fail("COVERAGE_INTERPRETATION_INPUT_INVALID",
    "input.supplied_value must be null or one bounded scalar value.");
}

export function validateCoverageAmbiguityResolveCommand(value) {
  const envelope = command(value, "diagnostic.coverage_ambiguity.resolve");
  const input = exact(envelope.input, "input", [
    "onboarding_id", "ambiguity_id", "ambiguity_digest", "expected_revision", "disposition",
    "choice_id", "supplied_value", "work_intent_id", "scope", "rationale"
  ]);
  if (!new Set(["selected_choice", "supplied_value", "accepted_unknown"]).has(input.disposition)
      || !new Set(["exact_workflow", "exact_revision", "exact_profile_version"]).has(input.scope)) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID", "input disposition or scope is unsupported.");
  }
  const normalized = {
    onboarding_id: uuid(input.onboarding_id, "input.onboarding_id"),
    ambiguity_id: string(input.ambiguity_id, "input.ambiguity_id", 160, STABLE),
    ambiguity_digest: digest(input.ambiguity_digest, "input.ambiguity_digest"),
    expected_revision: integer(input.expected_revision, "input.expected_revision", 4),
    disposition: input.disposition,
    choice_id: input.choice_id === null ? null : string(input.choice_id, "input.choice_id", 160, STABLE),
    supplied_value: boundedSuppliedValue(input.supplied_value),
    work_intent_id: uuid(input.work_intent_id, "input.work_intent_id"),
    scope: input.scope,
    rationale: string(input.rationale, "input.rationale", 2000)
  };
  if ((normalized.disposition === "selected_choice") !== (normalized.choice_id !== null)
      || (normalized.disposition === "supplied_value") !== (normalized.supplied_value !== null)
      || (normalized.disposition === "accepted_unknown"
        && (normalized.choice_id !== null || normalized.supplied_value !== null))) {
    fail("COVERAGE_INTERPRETATION_INPUT_INVALID",
      "input disposition does not match its exact choice or supplied value fields.");
  }
  assertNoSensitiveMaterial(normalized, "input", 64 * 1024);
  return { ...envelope, input: normalized };
}

export function resolveJsonPointer(document, pointer) {
  if (pointer === "") return document;
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
  let current = document;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (["__proto__", "prototype", "constructor"].includes(segment)
        || current === null || typeof current !== "object"
        || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

export function assertInterpretationCitations(input, snapshotDocument) {
  const references = [
    ...input.claims.flatMap((item) => [
      ...item.evidence_references, ...item.conflicting_evidence_references
    ]),
    ...input.ambiguities.flatMap((item) => item.evidence_references)
  ];
  for (const reference of references) {
    if (reference.artifact_digest !== input.snapshot_digest
        || resolveJsonPointer(snapshotDocument, reference.json_pointer) === undefined) {
      throw new KernelError(409, "COVERAGE_INTERPRETATION_CITATION_INVALID",
        "Every citation must identify existing material in the exact active discovery snapshot.", { reference });
    }
  }
  return true;
}

export function buildCoverageInterpretationAssignment({ assignmentId, onboarding, input,
  assignedByPrincipalId, executedBy, assignedAt, workIntentDigest }) {
  const document = {
    schema_version: "alphonse.coverage-interpretation-assignment.v0.1",
    assignment_id: assignmentId,
    onboarding_id: onboarding.onboarding_id,
    snapshot_digest: input.snapshot_digest,
    onboarding_revision: onboarding.revision,
    event_head_digest: onboarding.event_head_digest,
    assignee: {
      passport_id: input.passport_id,
      agent_principal_id: input.agent_principal_id,
      work_intent_id: input.work_intent_id,
      work_intent_digest: workIntentDigest
    },
    assigned_by_principal_id: assignedByPrincipalId,
    executed_by: executedBy,
    assigned_at: new Date(assignedAt).toISOString(),
    expires_at: input.expires_at,
    constraints: {
      evidence_scope: "exact_snapshot_only",
      output: "closed_schema_only",
      operator_confirmation: "prohibited",
      authority: "none",
      external_effects: "prohibited"
    }
  };
  return { document, assignment_digest: sha256Digest(document) };
}

export function buildWorkflowInterpretation({ interpretationId, assignment, input }) {
  const claimsDigest = sha256Digest(input.claims);
  const ambiguityProposalsDigest = sha256Digest(input.ambiguities);
  const evidenceReferences = [...new Map([
    ...input.claims.flatMap((item) => [...item.evidence_references, ...item.conflicting_evidence_references]),
    ...input.ambiguities.flatMap((item) => item.evidence_references)
  ].map((item) => [canonicalize(item), item])).values()]
    .sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)));
  const document = {
    schema_version: WORKFLOW_INTERPRETATION_SCHEMA_VERSION,
    interpretation_id: interpretationId,
    onboarding_id: input.onboarding_id,
    snapshot_digest: input.snapshot_digest,
    proposal_metadata: {
      proposal_kind: "workflow_interpretation_claim",
      principal_id: assignment.agent_principal_id,
      work_intent_id: assignment.work_intent_id,
      work_intent_digest: assignment.work_intent_digest,
      exact_base_references: {
        onboarding_revision: assignment.onboarding_revision,
        event_head_digest: assignment.event_head_digest,
        snapshot_digest: assignment.snapshot_digest
      },
      payload_digest: claimsDigest,
      ambiguity_proposals_digest: ambiguityProposalsDigest,
      evidence_references: evidenceReferences,
      proposed_at: input.proposed_at
    },
    claims: structuredClone(input.claims),
    ambiguity_proposals: structuredClone(input.ambiguities),
    provenance: structuredClone(input.provenance),
    supersedes_interpretation_digest: input.supersedes_interpretation_digest,
    content_class: "untrusted_agent_proposal",
    instruction_authority: "none",
    authority: "none"
  };
  assertNoSensitiveMaterial(document, "workflow_interpretation", 1024 * 1024);
  return {
    document,
    claims_digest: claimsDigest,
    claim_index: input.claims.map((item) => ({
      claim_id: item.claim_id,
      claim_digest: sha256Digest(item),
      kind: item.kind,
      status: item.status,
      unknown_reason: item.unknown_reason,
      limitations: item.limitations,
      evidence_references: item.evidence_references,
      conflicting_evidence_references: item.conflicting_evidence_references
    })),
    ambiguity_proposals_digest: ambiguityProposalsDigest
  };
}

export function buildCoverageAmbiguities({ onboardingId, interpretationDigest, proposals }) {
  const ambiguities = proposals.map((proposal) => {
    const document = {
      schema_version: COVERAGE_AMBIGUITY_SCHEMA_VERSION,
      ambiguity_id: proposal.ambiguity_id,
      onboarding_id: onboardingId,
      source_interpretation_digest: interpretationDigest,
      kind: proposal.kind,
      claim_references: proposal.claim_references,
      question: proposal.question,
      blocking: proposal.blocking,
      choices: proposal.choices,
      evidence_references: proposal.evidence_references,
      initial_status: "open",
      content_class: "untrusted_agent_proposal",
      instruction_authority: "none",
      authority: "none"
    };
    return { document, ambiguity_digest: sha256Digest(document) };
  });
  const manifest = ambiguities.map((item) => ({
    ambiguity_id: item.document.ambiguity_id,
    ambiguity_digest: item.ambiguity_digest,
    blocking: item.document.blocking
  })).sort((left, right) => left.ambiguity_id.localeCompare(right.ambiguity_id));
  return { ambiguities, manifest_digest: sha256Digest(manifest) };
}

export function buildCoverageAmbiguityResolution({ resolutionId, onboarding, ambiguity,
  input, principalId, executedBy, confirmedAt, workIntentDigest }) {
  const choiceIds = new Set(ambiguity.ambiguity_document.choices.map((item) => item.choice_id));
  if (input.disposition === "selected_choice" && !choiceIds.has(input.choice_id)) {
    throw new KernelError(409, "COVERAGE_AMBIGUITY_CHOICE_INVALID",
      "The selected choice does not exist in the exact ambiguity material.");
  }
  if (input.disposition === "accepted_unknown" && ambiguity.blocking) {
    throw new KernelError(409, "COVERAGE_AMBIGUITY_BLOCKING_UNKNOWN",
      "A blocking ambiguity cannot be accepted as an unknown limitation.");
  }
  const confirmationId = randomUUID();
  const confirmation = {
    schema_version: "alphonse.coverage-confirmation.v0.1",
    confirmation_id: confirmationId,
    onboarding_id: onboarding.onboarding_id,
    subject: {
      type: "ambiguity",
      id: ambiguity.ambiguity_id,
      digest: ambiguity.ambiguity_digest
    },
    disposition: input.disposition,
    choice_id: input.choice_id,
    supplied_value: input.supplied_value,
    principal_id: principalId,
    work_intent_id: input.work_intent_id,
    work_intent_digest: workIntentDigest,
    scope: input.scope,
    rationale: input.rationale,
    confirmed_at: new Date(confirmedAt).toISOString(),
    executed_by: executedBy,
    authority: "human_confirmation_only"
  };
  const confirmationDigest = sha256Digest(confirmation);
  const status = input.disposition === "accepted_unknown"
    ? "accepted_nonblocking_unknown" : "resolved";
  const resolution = {
    schema_version: "alphonse.coverage-ambiguity-resolution.v0.1",
    resolution_id: resolutionId,
    onboarding_id: onboarding.onboarding_id,
    ambiguity_id: ambiguity.ambiguity_id,
    ambiguity_digest: ambiguity.ambiguity_digest,
    confirmation_id: confirmationId,
    confirmation_digest: confirmationDigest,
    status,
    authority: "none"
  };
  return {
    confirmation,
    confirmation_digest: confirmationDigest,
    resolution,
    resolution_digest: sha256Digest(resolution),
    status
  };
}
