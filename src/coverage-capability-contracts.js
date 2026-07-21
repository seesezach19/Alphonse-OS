import { canonicalize, sha256Digest } from "./canonical-json.js";
import { assertNoSensitiveMaterial } from "./coverage-onboarding-contracts.js";
import { COVERAGE_CAPABILITIES, coverageProfileIdentity,
  validateCoverageProfile } from "./coverage-profile-contracts.js";
import { KernelError } from "./errors.js";

export const COVERAGE_CAPABILITY_VECTOR_SCHEMA_VERSION =
  "alphonse.workflow-coverage-capability-vector.v0.1";
export const ACCOUNTABLE_COVERAGE_SCHEMA_VERSION = "alphonse.accountable-coverage-claim.v0.1";
export const COVERAGE_CAPABILITY_STATES = Object.freeze([
  "established", "not_established", "indeterminate", "unavailable"
]);
export const COVERAGE_VERIFICATION_STRATEGY_SCHEMA_VERSION =
  "alphonse.coverage-verification-strategy.v0.1";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STABLE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function fail(message) {
  throw new KernelError(400, "COVERAGE_CAPABILITY_INPUT_INVALID", message);
}

function exact(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object.`);
  if (canonicalize(Object.keys(value).sort()) !== canonicalize([...keys].sort())) {
    fail(`${field} fields must be exact.`);
  }
  return value;
}

function string(value, field, maximum = 500, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
      || (pattern && !pattern.test(value))) fail(`${field} is invalid.`);
  return value;
}

function dateTime(value, field) {
  string(value, field, 100);
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) fail(`${field} must be canonical UTC.`);
  return value;
}

function digest(value, field) { return string(value, field, 80, DIGEST); }

function evidenceReference(value, field) {
  const input = exact(value, field,
    ["evidence_type", "evidence_id", "evidence_digest", "observed_at"]);
  return { evidence_type: string(input.evidence_type, `${field}.evidence_type`, 100, STABLE),
    evidence_id: string(input.evidence_id, `${field}.evidence_id`, 200, STABLE),
    evidence_digest: digest(input.evidence_digest, `${field}.evidence_digest`),
    observed_at: dateTime(input.observed_at, `${field}.observed_at`) };
}

function disclosure(value, field, kind) {
  const input = exact(value, field, ["code", "detail", "blocking"]);
  if (typeof input.blocking !== "boolean") fail(`${field}.blocking must be boolean.`);
  const document = { code: string(input.code, `${field}.code`, 160, STABLE),
    detail: string(input.detail, `${field}.detail`, 1000), blocking: input.blocking };
  return { [`${kind}_id`]: sha256Digest(document), ...document };
}

function capabilityInput(name, value) {
  const input = exact(value, `capabilities.${name}`, ["state", "evidence", "gaps", "limitations"]);
  if (!COVERAGE_CAPABILITY_STATES.includes(input.state)) fail(`capabilities.${name}.state is invalid.`);
  if (!Array.isArray(input.evidence) || !Array.isArray(input.gaps) || !Array.isArray(input.limitations)) {
    fail(`capabilities.${name} evidence, gaps, and limitations must be arrays.`);
  }
  const evidence = input.evidence.map((item, index) =>
    evidenceReference(item, `capabilities.${name}.evidence[${index}]`));
  const gaps = input.gaps.map((item, index) =>
    disclosure(item, `capabilities.${name}.gaps[${index}]`, "gap"));
  const limitations = input.limitations.map((item, index) =>
    disclosure(item, `capabilities.${name}.limitations[${index}]`, "limitation"));
  if (input.state === "established" && evidence.length === 0) {
    fail(`capabilities.${name} cannot be established without exact evidence.`);
  }
  if (input.state !== "established" && gaps.length === 0) {
    fail(`capabilities.${name} must disclose why it is not established.`);
  }
  return { state: input.state, evidence, gaps, limitations };
}

export function validateCoverageVerificationStrategy(value) {
  const strategy = exact(value, "verification_strategy", ["schema_version", "strategy_id", "version",
    "runner", "critical_path_fixture_digests", "deterministic_stub_digests", "assertion_digests",
    "prohibited_effects", "authority"]);
  const runner = exact(strategy.runner, "verification_strategy.runner",
    ["runner_id", "version", "artifact_digest"]);
  const lists = ["critical_path_fixture_digests", "deterministic_stub_digests", "assertion_digests"];
  if (strategy.schema_version !== COVERAGE_VERIFICATION_STRATEGY_SCHEMA_VERSION
      || !STABLE.test(strategy.strategy_id ?? "") || !/^\d+\.\d+\.\d+$/.test(strategy.version ?? "")
      || !UUID.test(runner.runner_id ?? "") || !/^\d+\.\d+\.\d+$/.test(runner.version ?? "")
      || !DIGEST.test(runner.artifact_digest ?? "") || strategy.authority !== "none") {
    fail("Verification strategy identity, runner, or authority is invalid.");
  }
  for (const field of lists) {
    if (!Array.isArray(strategy[field]) || strategy[field].length === 0
        || strategy[field].some((item) => !DIGEST.test(item))
        || new Set(strategy[field]).size !== strategy[field].length) {
      fail(`verification_strategy.${field} must contain unique exact digests.`);
    }
  }
  const prohibited = ["external_effect", "promotion", "provider_credential"];
  if (!Array.isArray(strategy.prohibited_effects)
      || canonicalize([...strategy.prohibited_effects].sort()) !== canonicalize(prohibited)) {
    fail("Verification strategy must prohibit external effects, provider credentials, and promotion.");
  }
  return { schema_version: COVERAGE_VERIFICATION_STRATEGY_SCHEMA_VERSION,
    strategy_id: strategy.strategy_id, version: strategy.version, runner: { ...runner },
    critical_path_fixture_digests: [...strategy.critical_path_fixture_digests].sort(),
    deterministic_stub_digests: [...strategy.deterministic_stub_digests].sort(),
    assertion_digests: [...strategy.assertion_digests].sort(), prohibited_effects: prohibited,
    authority: "none" };
}

function coverageStatus(profile, capabilities) {
  if (!profile) return { status: "unavailable", meets: null };
  const states = profile.required_capabilities.map((name) => capabilities[name].state);
  if (states.every((state) => state === "established")) return { status: "covered", meets: true };
  if (states.includes("indeterminate")) return { status: "indeterminate", meets: null };
  if (states.includes("unavailable")) return { status: "not_covered", meets: false };
  if (states.includes("established")) return { status: "partial", meets: false };
  return { status: "not_covered", meets: false };
}

export function buildAccountableCoverageProjection({ onboardingId, workflowReference, evidenceCutoff,
  intervalStart, profile = null, capabilities, historicalGaps = [], limitations = [], projector }) {
  string(onboardingId, "onboarding_id", 100, UUID);
  const workflow = exact(workflowReference, "workflow_reference",
    ["system", "environment", "provider_workflow_id"]);
  const cutoff = exact(evidenceCutoff, "evidence_cutoff",
    ["cutoff_type", "cutoff_id", "cutoff_digest", "occurred_at"]);
  const projectorIdentity = exact(projector, "projector", ["id", "version", "artifact_digest"]);
  string(projectorIdentity.id, "projector.id", 160, STABLE);
  string(projectorIdentity.version, "projector.version", 80, /^\d+\.\d+\.\d+$/);
  digest(projectorIdentity.artifact_digest, "projector.artifact_digest");
  dateTime(intervalStart, "assessment_interval.starts_at");
  dateTime(cutoff.occurred_at, "evidence_cutoff.occurred_at");
  if (Date.parse(intervalStart) > Date.parse(cutoff.occurred_at)) {
    fail("Assessment interval cannot begin after its evidence cutoff.");
  }
  const normalizedProfile = profile === null ? null : validateCoverageProfile(profile);
  const exactCapabilities = exact(capabilities, "capabilities", COVERAGE_CAPABILITIES);
  const normalizedCapabilities = Object.fromEntries(COVERAGE_CAPABILITIES.map((name) =>
    [name, capabilityInput(name, exactCapabilities[name])]));
  const normalizedHistoricalGaps = historicalGaps.map((item, index) =>
    disclosure(item, `historical_gaps[${index}]`, "gap"));
  const normalizedLimitations = limitations.map((item, index) =>
    disclosure(item, `limitations[${index}]`, "limitation"));
  const allGaps = [...normalizedHistoricalGaps,
    ...COVERAGE_CAPABILITIES.flatMap((name) => normalizedCapabilities[name].gaps)]
    .sort((left, right) => left.gap_id.localeCompare(right.gap_id));
  const allLimitations = [...normalizedLimitations,
    ...COVERAGE_CAPABILITIES.flatMap((name) => normalizedCapabilities[name].limitations)]
    .sort((left, right) => left.limitation_id.localeCompare(right.limitation_id));
  const vector = {
    schema_version: COVERAGE_CAPABILITY_VECTOR_SCHEMA_VERSION,
    onboarding_id: onboardingId,
    workflow_reference: { ...workflow },
    evidence_cutoff: { cutoff_type: string(cutoff.cutoff_type, "evidence_cutoff.cutoff_type", 100, STABLE),
      cutoff_id: string(cutoff.cutoff_id, "evidence_cutoff.cutoff_id", 200, STABLE),
      cutoff_digest: digest(cutoff.cutoff_digest, "evidence_cutoff.cutoff_digest"),
      occurred_at: cutoff.occurred_at },
    capabilities: Object.fromEntries(COVERAGE_CAPABILITIES.map((name) => [name, {
      state: normalizedCapabilities[name].state,
      evidence_references: normalizedCapabilities[name].evidence,
      gap_ids: normalizedCapabilities[name].gaps.map((item) => item.gap_id).sort(),
      limitation_ids: normalizedCapabilities[name].limitations.map((item) => item.limitation_id).sort()
    }])),
    state_counts: Object.fromEntries(COVERAGE_CAPABILITY_STATES.map((state) => [state,
      COVERAGE_CAPABILITIES.filter((name) => normalizedCapabilities[name].state === state).length])),
    gaps: allGaps,
    limitations: allLimitations,
    projector: { ...projectorIdentity },
    authority: "none"
  };
  const assessed = coverageStatus(normalizedProfile, normalizedCapabilities);
  const policyIdentity = normalizedProfile ? coverageProfileIdentity(normalizedProfile) : null;
  const claim = {
    schema_version: ACCOUNTABLE_COVERAGE_SCHEMA_VERSION,
    onboarding_id: onboardingId,
    workflow_reference: { ...workflow },
    capability_vector_digest: sha256Digest(vector),
    policy: policyIdentity,
    assessment_interval: { starts_at: intervalStart, ends_at: cutoff.occurred_at,
      end_exclusive: false },
    evidence_cutoff: vector.evidence_cutoff,
    required_capability_states: normalizedProfile ? Object.fromEntries(
      normalizedProfile.required_capabilities.map((name) => [name, normalizedCapabilities[name].state])) : {},
    coverage_status: assessed.status,
    meets_policy: assessed.meets,
    gap_ids: allGaps.map((item) => item.gap_id),
    limitation_ids: allLimitations.map((item) => item.limitation_id),
    claims_destination_commitment: false,
    authority: "none"
  };
  assertNoSensitiveMaterial({ vector, claim }, "accountable_coverage", 4 * 1024 * 1024);
  return { capability_vector: vector, capability_vector_digest: sha256Digest(vector),
    accountable_coverage: claim, accountable_coverage_digest: sha256Digest(claim) };
}

export function capabilityEvidence(state, evidence = [], gaps = [], limitations = []) {
  return { state, evidence, gaps, limitations };
}
