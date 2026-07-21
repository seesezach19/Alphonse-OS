import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import { buildAccountableCoverageProjection, capabilityEvidence,
  validateCoverageVerificationStrategy } from "../../src/coverage-capability-contracts.js";
import { COVERAGE_CAPABILITIES, validateCoverageProfile } from "../../src/coverage-profile-contracts.js";

const digest = (character) => `sha256:${character.repeat(64)}`;
const now = "2026-07-21T20:00:00.000Z";
const projector = { id: "com.alphonse.coverage.capability-projector", version: "0.1.0",
  artifact_digest: digest("a") };

function profile(requiredCapabilities = COVERAGE_CAPABILITIES) {
  return {
    schema_version: "alphonse.coverage-profile.v0.1",
    profile_id: "agency.inventory.critical",
    version: "1.0.0",
    consequence_class: "critical",
    required_capabilities: [...requiredCapabilities],
    maximum_evidence_age_seconds: 86400,
    assessment_policy: {
      all_required_established: "covered",
      partial: "partial",
      indeterminate: "indeterminate",
      unavailable: "not_covered",
      not_established: "not_covered"
    },
    authority: "none"
  };
}

const evidence = (type, character) => ({ evidence_type: type, evidence_id: `${type}-1`,
  evidence_digest: digest(character), observed_at: now });
const gap = (code, detail = "Required exact evidence is absent.") => ({ code, detail, blocking: true });
const missing = (name) => capabilityEvidence("not_established", [], [gap(`coverage.${name}.missing`)], []);
const established = (name, character) => capabilityEvidence("established", [evidence(name, character)], [], []);

function vector(overrides = {}, selectedProfile = profile()) {
  const capabilities = Object.fromEntries(COVERAGE_CAPABILITIES.map((name) => [name, missing(name)]));
  Object.assign(capabilities, overrides);
  return buildAccountableCoverageProjection({
    onboardingId: "00000000-0000-4000-8000-000000000901",
    workflowReference: { system: "n8n", environment: "customer", provider_workflow_id: "wf-1" },
    evidenceCutoff: { cutoff_type: "coverage_validation", cutoff_id: "validation-1",
      cutoff_digest: digest("b"), occurred_at: now },
    intervalStart: "2026-07-21T19:00:00.000Z",
    profile: selectedProfile,
    capabilities,
    historicalGaps: [],
    limitations: [{ code: "coverage.authority.none", detail: "Projection grants no authority.", blocking: false }],
    projector
  });
}

test("Coverage Profile is closed and cannot redefine fail-closed assessment meanings", () => {
  const accepted = validateCoverageProfile(profile(["discovered", "repair_bound"]));
  assert.deepEqual(accepted.required_capabilities, ["discovered", "repair_bound"]);
  assert.throws(() => validateCoverageProfile({ ...profile(), force_ready: true }),
    /fields must be exact/);
  assert.throws(() => validateCoverageProfile({ ...profile(), assessment_policy: {
    ...profile().assessment_policy, unavailable: "covered"
  } }), /fail-closed/);
  assert.throws(() => validateCoverageProfile({ ...profile(), required_capabilities: ["discovered", "discovered"] }),
    /unique non-empty subset/);
});

test("nine capabilities remain independent rather than becoming a lifecycle ladder", () => {
  const result = vector({
    discovered: capabilityEvidence("unavailable", [], [gap("coverage.discovered.unavailable")], []),
    repair_bound: established("repair_binding", "c"),
    verification_ready: established("verification_strategy", "d")
  });
  assert.equal(result.capability_vector.capabilities.discovered.state, "unavailable");
  assert.equal(result.capability_vector.capabilities.repair_bound.state, "established");
  assert.equal(result.capability_vector.capabilities.verification_ready.state, "established");
  assert.equal(result.capability_vector.capabilities.promotion_ready.state, "not_established");
  assert.equal(result.accountable_coverage.coverage_status, "not_covered");
  assert.equal(result.accountable_coverage.meets_policy, false);
  assert.equal("ready" in result.accountable_coverage, false);
});

test("runtime-only success remains indeterminate and never claims destination commitment", () => {
  const runtime = capabilityEvidence("indeterminate", [evidence("runtime_success_receipt", "e")],
    [gap("coverage.execution_observed.completeness_missing",
      "A complete observation basis is not established.")],
    [{ code: "coverage.destination_commitment.not_established",
      detail: "Runtime success does not establish destination commitment.", blocking: false }]);
  const result = vector({ execution_observed: runtime });
  assert.equal(result.capability_vector.capabilities.execution_observed.state, "indeterminate");
  assert.equal(result.accountable_coverage.coverage_status, "indeterminate");
  assert.equal(result.accountable_coverage.meets_policy, null);
  assert.equal(result.accountable_coverage.claims_destination_commitment, false);
});

test("unavailable policy evidence and gaps stay explicit and deterministic", () => {
  const first = vector({}, null);
  const second = vector({}, null);
  assert.deepEqual(first, second);
  assert.equal(first.accountable_coverage.policy, null);
  assert.equal(first.accountable_coverage.coverage_status, "unavailable");
  assert.equal(first.accountable_coverage.meets_policy, null);
  assert.equal(first.capability_vector_digest, sha256Digest(first.capability_vector));
  assert.equal(first.accountable_coverage_digest, sha256Digest(first.accountable_coverage));
  assert.equal(first.capability_vector.gaps.length, 9);
  assert.equal(first.capability_vector.authority, "none");
});

test("verification readiness requires exact fixtures, stubs, assertions, and prohibited effects", () => {
  const strategy = {
    schema_version: "alphonse.coverage-verification-strategy.v0.1",
    strategy_id: "inventory-critical",
    version: "1.0.0",
    runner: { runner_id: "00000000-0000-4000-8000-000000000700", version: "0.2.0",
      artifact_digest: digest("1") },
    critical_path_fixture_digests: [digest("2")],
    deterministic_stub_digests: [digest("3")],
    assertion_digests: [digest("4")],
    prohibited_effects: ["external_effect", "promotion", "provider_credential"],
    authority: "none"
  };
  assert.deepEqual(validateCoverageVerificationStrategy(strategy), strategy);
  assert.throws(() => validateCoverageVerificationStrategy({ ...strategy,
    prohibited_effects: ["promotion"] }), /must prohibit/);
});
