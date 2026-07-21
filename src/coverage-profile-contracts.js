import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const COVERAGE_PROFILE_SCHEMA_VERSION = "alphonse.coverage-profile.v0.1";
export const COVERAGE_PROFILE_EXPORT_KIND = "coverage_profile";
export const COVERAGE_CAPABILITIES = Object.freeze([
  "discovered", "connected", "revision_bound", "execution_observed", "diagnosable",
  "behavior_monitored", "repair_bound", "verification_ready", "promotion_ready"
]);

const STABLE = /^[a-z][a-z0-9._:-]{2,159}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function fail(message) {
  throw new KernelError(400, "COVERAGE_PROFILE_INVALID", message);
}

function exact(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object.`);
  if (canonicalize(Object.keys(value).sort()) !== canonicalize([...keys].sort())) {
    fail(`${field} fields must be exact.`);
  }
  return value;
}

export function validateCoverageProfile(value) {
  const profile = exact(value, "coverage_profile", ["schema_version", "profile_id", "version",
    "consequence_class", "required_capabilities", "maximum_evidence_age_seconds",
    "assessment_policy", "authority"]);
  if (profile.schema_version !== COVERAGE_PROFILE_SCHEMA_VERSION
      || typeof profile.profile_id !== "string" || !STABLE.test(profile.profile_id)
      || typeof profile.version !== "string" || !SEMVER.test(profile.version)
      || !["low", "moderate", "high", "critical"].includes(profile.consequence_class)
      || !Number.isSafeInteger(profile.maximum_evidence_age_seconds)
      || profile.maximum_evidence_age_seconds < 60
      || profile.maximum_evidence_age_seconds > 31_536_000
      || profile.authority !== "none") {
    fail("Coverage Profile identity, consequence, freshness, or authority is invalid.");
  }
  if (!Array.isArray(profile.required_capabilities) || profile.required_capabilities.length === 0
      || profile.required_capabilities.some((item) => !COVERAGE_CAPABILITIES.includes(item))
      || new Set(profile.required_capabilities).size !== profile.required_capabilities.length) {
    fail("required_capabilities must be a unique non-empty subset of the nine defined capabilities.");
  }
  const policy = exact(profile.assessment_policy, "coverage_profile.assessment_policy",
    ["all_required_established", "partial", "indeterminate", "unavailable", "not_established"]);
  if (canonicalize(policy) !== canonicalize({
    all_required_established: "covered",
    partial: "partial",
    indeterminate: "indeterminate",
    unavailable: "not_covered",
    not_established: "not_covered"
  })) {
    fail("assessment_policy must preserve the fail-closed Accountable Coverage meanings.");
  }
  return {
    schema_version: COVERAGE_PROFILE_SCHEMA_VERSION,
    profile_id: profile.profile_id,
    version: profile.version,
    consequence_class: profile.consequence_class,
    required_capabilities: [...profile.required_capabilities].sort(),
    maximum_evidence_age_seconds: profile.maximum_evidence_age_seconds,
    assessment_policy: { ...policy },
    authority: "none"
  };
}

export function coverageProfileIdentity(value) {
  const profile = validateCoverageProfile(value);
  return { profile_id: profile.profile_id, version: profile.version,
    profile_digest: sha256Digest(profile), consequence_class: profile.consequence_class,
    required_capabilities: profile.required_capabilities,
    maximum_evidence_age_seconds: profile.maximum_evidence_age_seconds };
}
