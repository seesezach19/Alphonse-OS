import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildReconciliation,
  scoreDiagnosis
} from "../../smoke-tests/codex-etl/lib.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const labRoot = path.join(root, "smoke-tests", "codex-etl");
const readJson = async (file) => JSON.parse(await readFile(path.join(labRoot, file), "utf8"));

function loadedPayload(fixture) {
  const rows = fixture.records.map((row) => ({
    transaction_id: row.transaction_id,
    account_id: row.account_id,
    settlement_date: row.settlement_date,
    currency: row.currency,
    amount_major: Number((row.amount_minor / 100).toFixed(3))
  }));
  return {
    currency_totals: ["JPY", "KWD", "USD"].map((currency) => ({
      account_id: "merchant:northwind",
      settlement_date: "2026-07-17",
      currency,
      amount_major_total: rows.filter((row) => row.currency === currency)
        .reduce((total, row) => total + row.amount_major, 0),
      transaction_count: 2
    }))
  };
}

function diagnosis(assignment, evidence) {
  return {
    schema_version: "alphonse.codex-etl-smoke.diagnosis.v0.1",
    assignment_id: assignment.assignment_id,
    evidence_digest: assignment.evidence_digest,
    diagnosis_class: "currency_scale_contract_mismatch",
    confidence: "high",
    observed_behavior: {
      workflow_status: "succeeded",
      affected_currencies: ["KWD", "JPY"],
      unaffected_currencies: ["USD"]
    },
    mechanism: {
      source_representation: "minor_units",
      suspected_component: "normalization_transform",
      applied_exponent: 2,
      expected_exponents: [
        { currency: "USD", exponent: 2 },
        { currency: "JPY", exponent: 0 },
        { currency: "KWD", exponent: 3 }
      ]
    },
    evidence_citations: [
      { claim: "The source declares minor-unit currency metadata.", artifact: "evidence.json",
        pointer: "/source_observation/received_batch/contract" },
      { claim: "The workflow reports success.", artifact: "evidence.json",
        pointer: "/workflow_observation/lifecycle_claim" },
      { claim: "The warehouse committed equal-looking currency totals.", artifact: "evidence.json",
        pointer: "/destination_observation/committed_load/payload/currency_totals" },
      { claim: "The independent comparison isolates two mismatches.", artifact: "evidence.json",
        pointer: "/reconciliation_observation/comparisons" }
    ],
    uncertainties: [
      "The exact transform source is withheld.",
      "The warehouse validation policy is not assigned."
    ],
    recommended_investigations: [
      "inspect_currency_scale_derivation",
      "replay_currency_scale_matrix"
    ],
    actions_taken: []
  };
}

test("ETL reconciliation exposes successful but currency-specific semantic corruption", async () => {
  const fixture = await readJson("fixtures/partner-settlement-batch.json");
  const reconciliation = buildReconciliation(fixture, loadedPayload(fixture));
  assert.equal(reconciliation.status, "failed");
  assert.deepEqual(reconciliation.comparisons.map((item) => [item.currency, item.expected_major_total,
    item.observed_major_total, item.status]), [
    ["JPY", 20000, 200, "mismatched"],
    ["KWD", 20, 200, "mismatched"],
    ["USD", 200, 200, "matched"]
  ]);
});

test("Codex ETL scorer uses exact structured fields and evidence pointers", async () => {
  const [fixture, answerKey] = await Promise.all([
    readJson("fixtures/partner-settlement-batch.json"),
    readJson("controller/answer-key.json")
  ]);
  const evidence = {
    source_observation: { received_batch: fixture },
    workflow_observation: { lifecycle_claim: "succeeded" },
    destination_observation: { committed_load: { payload: loadedPayload(fixture) } },
    reconciliation_observation: buildReconciliation(fixture, loadedPayload(fixture))
  };
  const assignment = {
    assignment_id: "00000000-0000-4000-8000-000000000901",
    evidence_digest: sha256Digest(evidence)
  };
  const validDiagnosis = diagnosis(assignment, evidence);
  validDiagnosis.mechanism.expected_exponents.reverse();
  const valid = scoreDiagnosis({ diagnosis: validDiagnosis, assignment, evidence, answerKey });
  assert.equal(valid.passed, true);
  assert.equal(valid.score, valid.maximum_score);

  const wrong = diagnosis(assignment, evidence);
  wrong.mechanism.suspected_component = "warehouse_loader";
  const rejected = scoreDiagnosis({ diagnosis: wrong, assignment, evidence, answerKey });
  assert.equal(rejected.passed, false);
  assert.equal(rejected.criteria.find((item) => item.criterion_id === "component-localization").passed, false);

  const duplicateExponent = diagnosis(assignment, evidence);
  duplicateExponent.mechanism.expected_exponents.push({ currency: "USD", exponent: 2 });
  const duplicateRejected = scoreDiagnosis({
    diagnosis: duplicateExponent, assignment, evidence, answerKey
  });
  assert.equal(duplicateRejected.passed, false);
  assert.equal(duplicateRejected.criteria.find((item) =>
    item.criterion_id === "currency-exponents").passed, false);

  const duplicateInvestigation = diagnosis(assignment, evidence);
  duplicateInvestigation.recommended_investigations.push("inspect_currency_scale_derivation");
  assert.throws(() => scoreDiagnosis({
    diagnosis: duplicateInvestigation, assignment, evidence, answerKey
  }), /recommended_investigations must contain unique values/);
});
