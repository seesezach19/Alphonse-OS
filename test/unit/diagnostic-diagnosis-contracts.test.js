import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildDiagnosisProposalMaterial,
  projectDiagnosisProposal,
  validateDiagnosisIntentBoundary,
  validateDiagnosisOutput
} from "../../src/diagnostic-diagnosis-contracts.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (character) => `sha256:${character.repeat(64)}`;
const output = (model = "model-a") => ({
  facts: [{ statement: "The confirmed run returned inventory_unknown.", artifact_references: [digest("a")] }],
  inferences: [{ statement: "The lookup path likely lacked the SKU.", basis: [digest("a")] }],
  hypotheses: [{ statement: "The inventory delta was stale.", confidence: "medium",
    supporting_artifact_references: [digest("b")], contradicting_artifact_references: [] }],
  uncertainties: ["The upstream export time is unavailable."],
  recommended_investigation: [{ step: "Inspect export freshness.", rationale: "Tests the leading hypothesis.",
    artifact_references: [digest("b")] }],
  artifact_references: [digest("a"), digest("b"), digest("c")],
  provenance: { model: { provider: "customer-provider", model, version: "2026-07-01" },
    runtime: { name: "customer-diagnostic-worker", version: "1.0.0" },
    instruction_digest: digest("d"), input_artifact_digests: [digest("a"), digest("b"), digest("c")] }
});

test("Diagnosis output separates evidence, reasoning, uncertainty, investigation, and provenance", () => {
  const validated = validateDiagnosisOutput(output());
  assert.equal(validated.facts.length, 1);
  assert.equal(validated.hypotheses[0].confidence, "medium");
  assert.throws(() => validateDiagnosisOutput({ ...output(), provider_token: "secret" }),
    (error) => error.code === "SENSITIVE_DIAGNOSIS_REJECTED");
});

test("Diagnosis Work Intent binds exact source artifacts and denies all adjacent authority", () => {
  const expected = { case_id: id(1), revision_id: id(2), reproduction_bundle_id: id(3) };
  const constraints = { no_failure_declaration: true, no_evidence_mutation: true,
    no_repair_commission: true, no_verification: true, no_promotion: true, no_external_effects: true };
  assert.deepEqual(validateDiagnosisIntentBoundary(expected, constraints, expected), { scope: expected, constraints });
  assert.throws(() => validateDiagnosisIntentBoundary({ ...expected, revision_id: id(4) }, constraints, expected),
    (error) => error.code === "DIAGNOSIS_INTENT_SCOPE_MISMATCH");
});

test("Changed model produces a distinct immutable proposal", () => {
  const base = { requestId: id(1), caseId: id(2), workerRegistrationId: id(3) };
  const first = buildDiagnosisProposalMaterial({ ...base, output: validateDiagnosisOutput(output("model-a")) });
  const second = buildDiagnosisProposalMaterial({ ...base, output: validateDiagnosisOutput(output("model-b")) });
  assert.equal(first.proposal_digest, sha256Digest(first.content));
  assert.notEqual(first.proposal_digest, second.proposal_digest);
  assert.equal(first.content.authority.verification, "not_granted");
});

test("Builder review changes usefulness only", () => {
  assert.deepEqual(projectDiagnosisProposal([]), {
    usefulness: "unreviewed", demonstrated_failure_truth: "unchanged", authority: "none",
    legal_next_operations: ["diagnostic.diagnosis_proposal.review"]
  });
  assert.equal(projectDiagnosisProposal([{ event_type: "accepted" }]).usefulness, "accepted");
  assert.equal(projectDiagnosisProposal([{ event_type: "accepted" }]).demonstrated_failure_truth, "unchanged");
});
