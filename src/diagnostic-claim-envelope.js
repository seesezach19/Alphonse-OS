import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const DIAGNOSTIC_CLAIM_SCHEMA_VERSION = "alphonse.diagnostic-claim-envelope.v0.1";

const CLAIM_TYPES = [
  "authenticated_observation",
  "behavior_invariant_evaluation",
  "committed_effect_interpretation",
  "unresolved_conclusion"
];
const PRODUCTION_METHODS = ["deterministically_derived", "observed"];
const SUPPORT = ["AUTHENTICATED_OBSERVATION", "DETERMINISTICALLY_ESTABLISHED", "NOT_ESTABLISHED"];
const VERIFICATIONS = [
  "deterministically_recomputed",
  "evidence_references_verified",
  "process_compliance_verified",
  "source_bytes_verified",
  "source_identity_verified"
];

function fail(message, details = {}) {
  throw new KernelError(500, "DIAGNOSTIC_CLAIM_INTEGRITY_VIOLATION", message, details);
}

function exact(value, path, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object.`, { path });
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalize(actual) !== canonicalize(expected)) {
    fail(`${path} fields must be exact.`, { path, expected, received: actual });
  }
  return value;
}

function enumValue(value, path, allowed) {
  if (!allowed.includes(value)) fail(`${path} is unsupported.`, { path, allowed });
}

function instantOrNull(value, path) {
  if (value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value)) {
    fail(`${path} must be null or one canonical UTC instant.`, { path });
  }
}

function boundedStrings(value, path, maximum = 20) {
  if (!Array.isArray(value) || value.length > maximum
      || value.some((item) => typeof item !== "string" || !item || item.length > 200)
      || new Set(value).size !== value.length) {
    fail(`${path} must be a bounded unique string array.`, { path });
  }
}

export function validateDiagnosticClaimEnvelope(document) {
  exact(document, "claim", [
    "schema_version", "claim_id", "claim_type", "processing_profile", "production_method",
    "proposition", "evidence_references", "verification_results", "asserted_support",
    "effective_support", "evidence_status", "temporal_scope", "limitations",
    "supersedes_claim_id", "authority_decision"
  ]);
  enumValue(document.schema_version, "claim.schema_version", [DIAGNOSTIC_CLAIM_SCHEMA_VERSION]);
  if (typeof document.claim_id !== "string" || document.claim_id.length !== 36) {
    fail("claim.claim_id must be a deterministic UUID.");
  }
  enumValue(document.claim_type, "claim.claim_type", CLAIM_TYPES);
  enumValue(document.processing_profile, "claim.processing_profile", ["D0"]);
  enumValue(document.production_method, "claim.production_method", PRODUCTION_METHODS);
  exact(document.proposition, "claim.proposition", ["subject_type", "subject_id", "predicate", "value"]);
  for (const field of ["subject_type", "subject_id", "predicate"]) {
    if (typeof document.proposition[field] !== "string" || !document.proposition[field]
        || document.proposition[field].length > 240) fail(`claim.proposition.${field} must be bounded.`);
  }
  if (document.proposition.value !== null
      && (typeof document.proposition.value !== "string" || document.proposition.value.length > 240)) {
    fail("claim.proposition.value must be null or a bounded string.");
  }
  if (!Array.isArray(document.evidence_references) || document.evidence_references.length === 0
      || document.evidence_references.length > 40) {
    fail("claim.evidence_references must be a bounded non-empty array.");
  }
  const evidenceKeys = new Set();
  for (const [index, reference] of document.evidence_references.entries()) {
    exact(reference, `claim.evidence_references[${index}]`, ["record_type", "record_id", "record_digest"]);
    if (typeof reference.record_type !== "string" || !reference.record_type
        || typeof reference.record_id !== "string" || !reference.record_id
        || !/^sha256:[0-9a-f]{64}$/.test(reference.record_digest)) {
      fail("Claim evidence reference is invalid.", { index });
    }
    const key = canonicalize(reference);
    if (evidenceKeys.has(key)) fail("Claim evidence references must be unique.", { index });
    evidenceKeys.add(key);
  }
  boundedStrings(document.verification_results, "claim.verification_results");
  if (document.verification_results.some((value) => !VERIFICATIONS.includes(value))) {
    fail("claim.verification_results contains an unsupported value.");
  }
  enumValue(document.asserted_support, "claim.asserted_support", SUPPORT);
  enumValue(document.effective_support, "claim.effective_support", SUPPORT);
  enumValue(document.evidence_status, "claim.evidence_status", ["complete", "partial", "unavailable"]);
  exact(document.temporal_scope, "claim.temporal_scope", [
    "valid_at", "observed_at", "accepted_at", "assessed_at", "freshness", "expires_at"
  ]);
  for (const field of ["valid_at", "observed_at", "accepted_at", "assessed_at", "expires_at"]) {
    instantOrNull(document.temporal_scope[field], `claim.temporal_scope.${field}`);
  }
  enumValue(document.temporal_scope.freshness, "claim.temporal_scope.freshness", ["frozen_historical"]);
  boundedStrings(document.limitations, "claim.limitations");
  if (document.supersedes_claim_id !== null) fail("Claim v0.1 does not supersede another claim in place.");
  exact(document.authority_decision, "claim.authority_decision", [
    "authority", "permitted_consequence", "decision_basis"
  ]);
  enumValue(document.authority_decision.authority, "claim.authority_decision.authority", ["diagnostic", "none"]);
  enumValue(document.authority_decision.permitted_consequence,
    "claim.authority_decision.permitted_consequence", ["case_creation", "none"]);
  enumValue(document.authority_decision.decision_basis, "claim.authority_decision.decision_basis",
    ["closed_deterministic_policy", "no_authority"]);
  if ((document.authority_decision.permitted_consequence === "case_creation")
      !== (document.authority_decision.authority === "diagnostic")) {
    fail("Claim authority and permitted consequence disagree.");
  }
  return document;
}

export function buildDiagnosticClaimEnvelope({
  claimType,
  productionMethod,
  proposition,
  evidenceReferences,
  verificationResults,
  assertedSupport,
  effectiveSupport,
  evidenceStatus,
  temporalScope,
  limitations = [],
  authorityDecision
}) {
  const semanticIdentity = {
    claim_type: claimType,
    proposition,
    evidence_references: [...evidenceReferences].sort((left, right) => {
      const leftBytes = canonicalize(left);
      const rightBytes = canonicalize(right);
      return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
    })
  };
  const document = {
    schema_version: DIAGNOSTIC_CLAIM_SCHEMA_VERSION,
    claim_id: deterministicUuid({ namespace: "diagnostic-claim", ...semanticIdentity }),
    claim_type: claimType,
    processing_profile: "D0",
    production_method: productionMethod,
    proposition,
    evidence_references: semanticIdentity.evidence_references,
    verification_results: [...verificationResults].sort(),
    asserted_support: assertedSupport,
    effective_support: effectiveSupport,
    evidence_status: evidenceStatus,
    temporal_scope: temporalScope,
    limitations: [...limitations].sort(),
    supersedes_claim_id: null,
    authority_decision: authorityDecision
  };
  validateDiagnosticClaimEnvelope(document);
  return { document, claim_digest: sha256Digest(document) };
}
