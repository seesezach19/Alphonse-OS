import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateAgencyLabCase } from "../../packages/agency-lab/src/case-contract.js";
import { runAgencyLabCase } from "../../packages/agency-lab/src/controller.js";
import {
  scoreDiagnosisResponse,
  validateDiagnosisResponse
} from "../../packages/agency-lab/src/diagnosis-scoring.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

async function caseAndFixture(caseName) {
  const definition = validateAgencyLabCase(await readJson(
    `agency-lab/cases/lead-ingestion/${caseName}/case.json`
  ));
  const fixture = await readJson(definition.scenario.input_fixture);
  return { definition, fixture };
}

test("Agency Lab cases use exact bounded contracts", async () => {
  const { definition } = await caseAndFixture("case-002");
  assert.equal(definition.failure_id, "LEAD-002");
  assert.equal(definition.expected_response_class, "reconcile");
  assert.equal(definition.worker_policy.prohibited_inputs.includes("answer_key"), true);
  assert.throws(() => validateAgencyLabCase({ ...definition, hidden_answer: true }),
    /fields must be exact/);
  assert.throws(() => validateAgencyLabCase({ ...definition, expected_response_class: "guess" }),
    /expected_response_class is unsupported/);
});

test("one invariant engine demonstrates and repairs all lead cases", async () => {
  for (const caseName of ["case-001", "case-002", "case-003", "case-004"]) {
    const { definition, fixture } = await caseAndFixture(caseName);
    const result = runAgencyLabCase(definition, fixture);
    assert.equal(result.failure_demonstrated, true);
    assert.equal(result.invariants.baseline.passed, false);
    assert.equal(result.repaired_passed, true);
    assert.equal(result.invariants.repaired.passed, true);
  }
});

test("structured blind diagnoses receive deterministic case-owned scores", async () => {
  for (const [caseName, expectedScore] of [
    ["case-001", 15], ["case-002", 13], ["case-003", 15], ["case-004", 15]
  ]) {
    const { definition } = await caseAndFixture(caseName);
    const answerKey = await readJson(definition.controller.answer_key_file);
    const response = await readJson(
      `agency-lab/cases/lead-ingestion/${caseName}/worker-runs/openclaw-001.json`
    );
    const score = scoreDiagnosisResponse({ caseDefinition: definition, answerKey, response });
    assert.equal(score.passed, true);
    assert.equal(score.score, expectedScore);
    assert.equal(score.maximum_score, 15);
  }
});

test("diagnosis scoring fails closed on unstructured or cross-case output", async () => {
  const { definition } = await caseAndFixture("case-002");
  const answerKey = await readJson(definition.controller.answer_key_file);
  const response = await readJson(
    "agency-lab/cases/lead-ingestion/case-002/worker-runs/openclaw-001.json"
  );
  assert.throws(() => validateDiagnosisResponse({ ...response, extra: true }), /fields must be exact/);
  assert.throws(() => scoreDiagnosisResponse({
    caseDefinition: definition,
    answerKey,
    response: { ...response, failure_id: "LEAD-999" }
  }), /failure_id does not match/);
});
