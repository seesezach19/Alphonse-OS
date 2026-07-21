import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  assertInterpretationCitations,
  buildCoverageAmbiguities,
  buildCoverageAmbiguityResolution,
  buildWorkflowInterpretation,
  validateCoverageAmbiguityResolveCommand,
  validateCoverageInterpretationAssignCommand,
  validateCoverageInterpretationSubmitCommand
} from "../../src/workflow-interpretation-contracts.js";

const ids = {
  onboarding: "00000000-0000-4000-8000-000000000701",
  assignment: "00000000-0000-4000-8000-000000000702",
  passport: "00000000-0000-4000-8000-000000000703",
  agent: "00000000-0000-4000-8000-000000000704",
  intent: "00000000-0000-4000-8000-000000000705",
  resolution: "00000000-0000-4000-8000-000000000706",
  interpretation: "00000000-0000-4000-8000-000000000707"
};
const snapshotDigest = `sha256:${"a".repeat(64)}`;

function reference(pointer = "/selected_workflow/display_name") {
  return { artifact_digest: snapshotDigest, json_pointer: pointer };
}

function claim(overrides = {}) {
  return {
    claim_id: "objective.primary",
    kind: "objective",
    status: "observed",
    statement: "The selected workflow is the inventory workflow.",
    evidence_references: [reference()],
    confidence: null,
    conflicting_evidence_references: [],
    unknown_reason: null,
    limitations: [],
    ...overrides
  };
}

function ambiguity(overrides = {}) {
  return {
    ambiguity_id: "consequence.on_error",
    kind: "consequence",
    claim_references: ["objective.primary"],
    question: "Should an inventory API failure stop or continue the workflow?",
    blocking: true,
    choices: [
      { choice_id: "stop", meaning: "Stop and alert." },
      { choice_id: "continue", meaning: "Continue with a limitation." }
    ],
    evidence_references: [reference("/omissions/0")],
    ...overrides
  };
}

function submitInput(overrides = {}) {
  return {
    assignment_id: ids.assignment,
    onboarding_id: ids.onboarding,
    snapshot_digest: snapshotDigest,
    expected_revision: 2,
    proposed_at: "2026-07-21T18:00:00.000Z",
    claims: [claim()],
    ambiguities: [ambiguity()],
    provenance: {
      passport_id: ids.passport,
      work_intent_id: ids.intent,
      instruction_digest: `sha256:${"b".repeat(64)}`,
      model: { provider: "fixture", model: "bounded-interpreter", version: "1" },
      runtime: { name: "component", version: "1" },
      input_artifact_digests: [snapshotDigest]
    },
    supersedes_interpretation_digest: null,
    ...overrides
  };
}

test("interpretation commands are closed and prohibit fake confirmation or authority", () => {
  const assign = {
    command_id: "assign-1",
    operation_id: "diagnostic.coverage_interpretation.assign",
    input: {
      onboarding_id: ids.onboarding,
      snapshot_digest: snapshotDigest,
      expected_revision: 2,
      passport_id: ids.passport,
      agent_principal_id: ids.agent,
      work_intent_id: ids.intent,
      expires_at: "2026-07-22T18:00:00.000Z"
    }
  };
  assert.deepEqual(validateCoverageInterpretationAssignCommand(assign), assign);
  const submit = { command_id: "submit-1",
    operation_id: "diagnostic.coverage_interpretation.submit", input: submitInput() };
  assert.deepEqual(validateCoverageInterpretationSubmitCommand(submit), submit);
  assert.throws(() => validateCoverageInterpretationSubmitCommand({
    ...submit,
    input: { ...submit.input, operator_confirmed: true }
  }), /fields must be exact/);
  assert.throws(() => validateCoverageInterpretationSubmitCommand({
    ...submit,
    input: { ...submit.input, claims: [{ ...claim(), authority: "registration" }] }
  }), /fields must be exact/);
});

test("observed, inferred, conflicted, and unknown claims remain structurally distinct", () => {
  const cases = [
    claim(),
    claim({ claim_id: "effect.inferred", kind: "effect", status: "inferred", confidence: "medium" }),
    claim({ claim_id: "dependency.conflict", kind: "dependency", status: "conflicted",
      conflicting_evidence_references: [reference("/selected_workflow/active")] }),
    claim({ claim_id: "limitation.unknown", kind: "limitation", status: "unknown",
      unknown_reason: "Workflow content is explicitly omitted from inventory discovery." })
  ];
  const command = { command_id: "typed-claims",
    operation_id: "diagnostic.coverage_interpretation.submit",
    input: submitInput({ claims: cases, ambiguities: [] }) };
  assert.equal(validateCoverageInterpretationSubmitCommand(command).input.claims.length, 4);
  assert.throws(() => validateCoverageInterpretationSubmitCommand({
    ...command,
    input: { ...command.input, claims: [claim({ status: "observed", confidence: "high" })] }
  }), /typed evidence/);
  assert.throws(() => validateCoverageInterpretationSubmitCommand({
    ...command,
    input: { ...command.input, claims: [claim({ status: "conflicted" })] }
  }), /must contain 1 to 30/);
  assert.throws(() => validateCoverageInterpretationSubmitCommand({
    ...command,
    input: { ...command.input, claims: [claim({ status: "unknown" })] }
  }), /typed evidence/);
});

test("every submitted citation resolves inside the exact admitted snapshot", () => {
  const input = validateCoverageInterpretationSubmitCommand({
    command_id: "citations", operation_id: "diagnostic.coverage_interpretation.submit",
    input: submitInput()
  }).input;
  const snapshot = {
    selected_workflow: { display_name: "Inventory", active: true },
    omissions: [{ code: "WORKFLOW_CONTENT_EXCLUDED" }]
  };
  assert.equal(assertInterpretationCitations(input, snapshot), true);
  assert.throws(() => assertInterpretationCitations({
    ...input,
    claims: [{ ...input.claims[0], evidence_references: [{
      artifact_digest: `sha256:${"c".repeat(64)}`, json_pointer: "/selected_workflow/display_name"
    }] }]
  }, snapshot), (error) => error.code === "COVERAGE_INTERPRETATION_CITATION_INVALID");
  assert.throws(() => assertInterpretationCitations({
    ...input,
    claims: [{ ...input.claims[0], evidence_references: [reference("/nodes/0/name")] }]
  }, snapshot), (error) => error.code === "COVERAGE_INTERPRETATION_CITATION_INVALID");
});

test("interpretation and ambiguity material are immutable, typed, and authority-free", () => {
  const input = submitInput();
  const assignment = {
    assignment_id: ids.assignment,
    agent_principal_id: ids.agent,
    work_intent_id: ids.intent,
    work_intent_digest: `sha256:${"d".repeat(64)}`,
    onboarding_revision: 2,
    event_head_digest: `sha256:${"e".repeat(64)}`,
    snapshot_digest: snapshotDigest
  };
  const built = buildWorkflowInterpretation({ interpretationId: ids.interpretation, assignment, input });
  assert.equal(built.document.authority, "none");
  assert.equal(built.document.instruction_authority, "none");
  assert.equal(built.document.proposal_metadata.payload_digest, sha256Digest(input.claims));
  const interpretationDigest = sha256Digest(built.document);
  const projected = buildCoverageAmbiguities({
    onboardingId: ids.onboarding, interpretationDigest, proposals: input.ambiguities
  });
  assert.equal(projected.ambiguities[0].document.source_interpretation_digest, interpretationDigest);
  assert.equal(projected.ambiguities[0].document.authority, "none");
});

test("human resolution binds exact material and cannot accept a blocking unknown", () => {
  const resolve = {
    command_id: "resolve-1",
    operation_id: "diagnostic.coverage_ambiguity.resolve",
    input: {
      onboarding_id: ids.onboarding,
      ambiguity_id: "consequence.on_error",
      ambiguity_digest: `sha256:${"f".repeat(64)}`,
      expected_revision: 4,
      disposition: "selected_choice",
      choice_id: "stop",
      supplied_value: null,
      work_intent_id: ids.intent,
      scope: "exact_workflow",
      rationale: "The owner requires fail-closed behavior."
    }
  };
  const input = validateCoverageAmbiguityResolveCommand(resolve).input;
  const ambiguityRow = {
    ambiguity_id: "consequence.on_error",
    ambiguity_digest: input.ambiguity_digest,
    blocking: true,
    ambiguity_document: { choices: ambiguity().choices }
  };
  const built = buildCoverageAmbiguityResolution({
    resolutionId: ids.resolution,
    onboarding: { onboarding_id: ids.onboarding },
    ambiguity: ambiguityRow,
    input,
    principalId: "named-owner",
    executedBy: { type: "human", id: "named-owner" },
    confirmedAt: "2026-07-21T18:01:00.000Z",
    workIntentDigest: `sha256:${"d".repeat(64)}`
  });
  assert.equal(built.status, "resolved");
  assert.equal(built.confirmation.principal_id, "named-owner");
  assert.equal(built.confirmation.authority, "human_confirmation_only");
  assert.equal(built.resolution.authority, "none");
  assert.throws(() => buildCoverageAmbiguityResolution({
    resolutionId: ids.resolution,
    onboarding: { onboarding_id: ids.onboarding },
    ambiguity: ambiguityRow,
    input: { ...input, disposition: "accepted_unknown", choice_id: null },
    principalId: "named-owner",
    executedBy: { type: "human", id: "named-owner" },
    confirmedAt: "2026-07-21T18:01:00.000Z",
    workIntentDigest: `sha256:${"d".repeat(64)}`
  }), (error) => error.code === "COVERAGE_AMBIGUITY_BLOCKING_UNKNOWN");
});
