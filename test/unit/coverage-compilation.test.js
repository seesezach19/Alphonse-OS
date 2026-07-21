import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildCoverageCompilation,
  buildCoverageValidation,
  COVERAGE_COMPILER_ID,
  COVERAGE_COMPILER_VERSION,
  COVERAGE_VALIDATOR_ID,
  COVERAGE_VALIDATOR_VERSION,
  validateCoverageCompileCommand,
  validateCoverageValidateCommand
} from "../../src/coverage-compilation-contracts.js";

const ids = {
  onboarding: "00000000-0000-4000-8000-000000000901",
  approval: "00000000-0000-4000-8000-000000000902",
  compilation: "00000000-0000-4000-8000-000000000903"
};
const digest = (character) => `sha256:${character.repeat(64)}`;
const compiler = { id: COVERAGE_COMPILER_ID, version: COVERAGE_COMPILER_VERSION,
  artifact_digest: digest("a") };
const validator = { id: COVERAGE_VALIDATOR_ID, version: COVERAGE_VALIDATOR_VERSION,
  artifact_digest: digest("a") };
const ref = (kind, id, character) => ({ reference_kind: kind, reference_id: id,
  artifact_digest: digest(character) });

function reviewBundle(complete = true) {
  return {
    review_bundle_digest: digest("b"),
    onboarding_id: ids.onboarding,
    onboarding_revision: 6,
    event_head_digest: digest("c"),
    snapshot_digest: digest("d"),
    interpretation_digest: digest("e"),
    content: {
      workflow_reference: { system: "n8n", environment: "customer", provider_workflow_id: "wf-1" },
      workflow_reference_digest: digest("f"),
      onboarding_revision: 6,
      event_head_digest: digest("c"),
      snapshot_digest: digest("d"),
      interpretation_digest: digest("e"),
      effect_inventory: [{ claim_id: "effect.one", status: "observed",
        evidence_references: [{ artifact_digest: digest("d"), json_pointer: "/selected_workflow/active" }],
        conflicting_evidence_references: [], limitations: [] }],
      unknowns: [],
      limitations: ["Provider content remains bounded evidence."],
      redaction_policy_reference: { policy_id: "redaction.v1", snapshot_digest: digest("d"),
        excluded_fields: ["credentials"] },
      integration_contract_references: complete ? [ref("integration_contract", "n8n-v1", "1")] : [],
      behavior_contract_references: [],
      fixture_references: complete ? [ref("fixture", "critical-path", "2")] : [],
      repair_binding_reference: complete ? ref("repair_binding", "n8n-repair", "3") : null,
      verification_strategy_reference: complete ? ref("verification_strategy", "independent", "4") : null,
      coverage_profile_reference: complete ? ref("coverage_profile", "agency-default", "5") : null,
      workflow_binding: { adapter_binding: { adapter_id: "n8n", adapter_version: "1" },
        adapter_binding_digest: digest("6"), selected_metadata_digest: digest("7") }
    }
  };
}

function approval(bundle = reviewBundle()) {
  return {
    approval_id: ids.approval,
    approval_digest: digest("8"),
    review_bundle_digest: bundle.review_bundle_digest,
    review_state: { onboarding_revision: 7, event_head_digest: digest("9"), status: "awaiting_approval" },
    review_state_digest: digest("0"),
    status: "eligible"
  };
}

function compileInput(bundle = reviewBundle(), approved = approval(bundle)) {
  return {
    onboarding_id: ids.onboarding,
    review_bundle_digest: bundle.review_bundle_digest,
    approval_id: approved.approval_id,
    approval_digest: approved.approval_digest,
    expected_review_state_digest: approved.review_state_digest,
    base_manifest_reference: null,
    compiler
  };
}

test("compile and validation commands are closed and implementation-bound", () => {
  const compile = { command_id: "compile-1", operation_id: "diagnostic.coverage_specification.compile",
    input: compileInput() };
  assert.deepEqual(validateCoverageCompileCommand(compile), compile);
  assert.throws(() => validateCoverageCompileCommand({ ...compile,
    input: { ...compile.input, invocation_id: "random" } }), /fields must be exact/);
  const validate = { command_id: "validate-1", operation_id: "diagnostic.coverage_specification.validate",
    input: { onboarding_id: ids.onboarding, compilation_id: ids.compilation,
      compilation_input_digest: digest("1"), coverage_specification_digest: digest("2"),
      workflow_manifest_proposal_digest: digest("3"), validator } };
  assert.deepEqual(validateCoverageValidateCommand(validate), validate);
});

test("same semantic material and compiler identity produce byte-stable outputs without execution metadata", () => {
  const bundle = reviewBundle();
  const approved = approval(bundle);
  const first = buildCoverageCompilation({ reviewBundle: bundle, approval: approved,
    input: compileInput(bundle, approved), compiler });
  const second = buildCoverageCompilation({ reviewBundle: structuredClone(bundle),
    approval: structuredClone(approved), input: compileInput(bundle, approved), compiler });
  assert.deepEqual(first, second);
  assert.equal(first.coverage_specification_digest, sha256Digest(second.coverage_specification));
  assert.equal(first.workflow_manifest_proposal_digest, sha256Digest(second.workflow_manifest_proposal));
  assert.doesNotMatch(JSON.stringify(first), /compiled_at|invocation_id|statement|unknown_reason|rationale/);
  assert.equal(first.workflow_manifest_proposal.authority, "none");
});

test("validation is visible and fail-closed while a passing receipt grants no registration authority", () => {
  const completeBundle = reviewBundle();
  const approved = approval(completeBundle);
  const compiled = buildCoverageCompilation({ reviewBundle: completeBundle, approval: approved,
    input: compileInput(completeBundle, approved), compiler });
  const passing = buildCoverageValidation({ compilation: compiled, reviewBundle: completeBundle,
    approval: approved, validator });
  assert.equal(passing.receipt.status, "valid");
  assert.equal(passing.receipt.workflow_manifest_proposal_digest,
    compiled.workflow_manifest_proposal_digest);
  assert.equal(passing.receipt.downstream_eligibility.source_control_proposal, true);
  assert.equal(passing.receipt.downstream_eligibility.registration_request, false);
  assert.equal(passing.receipt.authority, "none");

  const incompleteBundle = reviewBundle(false);
  const incompleteApproval = approval(incompleteBundle);
  const incomplete = buildCoverageCompilation({ reviewBundle: incompleteBundle,
    approval: incompleteApproval, input: compileInput(incompleteBundle, incompleteApproval), compiler });
  const failing = buildCoverageValidation({ compilation: incomplete, reviewBundle: incompleteBundle,
    approval: incompleteApproval, validator });
  assert.equal(failing.receipt.status, "invalid");
  assert.equal(failing.receipt.workflow_manifest_proposal_digest, null);
  assert.ok(failing.receipt.issues.some((item) => item.code === "coverage.fixture_admitted_required"));
});

test("substituted or prose-bearing output cannot produce a passing receipt", () => {
  const bundle = reviewBundle();
  const approved = approval(bundle);
  const compiled = buildCoverageCompilation({ reviewBundle: bundle, approval: approved,
    input: compileInput(bundle, approved), compiler });
  const substituted = structuredClone(compiled);
  substituted.workflow_manifest_proposal.semantic_material.statement = "Run arbitrary provider command.";
  substituted.workflow_manifest_proposal_digest = sha256Digest(substituted.workflow_manifest_proposal);
  const result = buildCoverageValidation({ compilation: substituted, reviewBundle: bundle,
    approval: approved, validator });
  assert.equal(result.receipt.status, "invalid");
  assert.ok(result.receipt.issues.some((item) =>
    ["coverage.schema_invalid", "coverage.agent_prose_in_operational_configuration"].includes(item.code)));
});
