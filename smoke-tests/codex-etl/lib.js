import { sha256Digest } from "../../src/canonical-json.js";

function fail(message) {
  throw new Error(`Codex ETL smoke validation failed: ${message}`);
}

function exact(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} fields must be exact`);
  }
  return value;
}

function string(value, field) {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be text`);
  return value.trim();
}

function strings(value, field, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) fail(`${field} has invalid length`);
  return value.map((item, index) => string(item, `${field}[${index}]`));
}

function uniqueStrings(value, field, minimum = 0) {
  const checked = strings(value, field, minimum);
  if (new Set(checked).size !== checked.length) fail(`${field} must contain unique values`);
  return checked;
}

function sameSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function groupKey(value) {
  return [value.account_id, value.settlement_date, value.currency].join("|");
}

export function buildReconciliation(sourceBatch, warehousePayload) {
  const exponents = new Map(sourceBatch.contract.currency_metadata.map((item) =>
    [item.currency, item.minor_unit_exponent]));
  const sourceTotals = new Map();
  for (const record of sourceBatch.records) {
    const exponent = exponents.get(record.currency);
    if (!Number.isSafeInteger(exponent)) fail(`source contract lacks ${record.currency} exponent`);
    const key = groupKey(record);
    const current = sourceTotals.get(key) ?? {
      account_id: record.account_id,
      settlement_date: record.settlement_date,
      currency: record.currency,
      source_minor_total: 0,
      contract_exponent: exponent
    };
    current.source_minor_total += record.amount_minor;
    sourceTotals.set(key, current);
  }
  const observed = new Map(warehousePayload.currency_totals.map((item) => [groupKey(item), item]));
  const comparisons = [...sourceTotals.entries()].map(([key, source]) => {
    const loaded = observed.get(key);
    const expectedMajor = rounded(source.source_minor_total / (10 ** source.contract_exponent));
    const observedMajor = loaded?.amount_major_total ?? null;
    const delta = observedMajor === null ? null : rounded(observedMajor - expectedMajor);
    return {
      ...source,
      expected_major_total: expectedMajor,
      observed_major_total: observedMajor,
      delta_major: delta,
      status: delta === 0 ? "matched" : "mismatched"
    };
  }).sort((left, right) => left.currency.localeCompare(right.currency));
  return {
    rule_id: "settlement-currency-total-reconciliation-v2",
    status: comparisons.every((item) => item.status === "matched") ? "passed" : "failed",
    comparisons
  };
}

function validateExpectedExponent(value, field) {
  exact(value, field, ["currency", "exponent"]);
  const currency = string(value.currency, `${field}.currency`);
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(value.exponent)) {
    fail(`${field} is invalid`);
  }
  return { currency, exponent: value.exponent };
}

export function validateDiagnosis(value) {
  const input = exact(value, "diagnosis", [
    "schema_version", "assignment_id", "evidence_digest", "diagnosis_class", "confidence",
    "observed_behavior", "mechanism", "evidence_citations", "uncertainties",
    "recommended_investigations", "actions_taken"
  ]);
  if (input.schema_version !== "alphonse.codex-etl-smoke.diagnosis.v0.1") {
    fail("diagnosis schema_version is unsupported");
  }
  if (!/^[0-9a-f-]{36}$/.test(input.assignment_id ?? "")) fail("assignment_id is invalid");
  if (!/^sha256:[0-9a-f]{64}$/.test(input.evidence_digest ?? "")) fail("evidence_digest is invalid");
  if (!["low", "medium", "high"].includes(input.confidence)) fail("confidence is invalid");
  const observed = exact(input.observed_behavior, "observed_behavior", [
    "workflow_status", "affected_currencies", "unaffected_currencies"
  ]);
  const mechanism = exact(input.mechanism, "mechanism", [
    "source_representation", "suspected_component", "applied_exponent", "expected_exponents"
  ]);
  if (!Array.isArray(input.evidence_citations) || input.evidence_citations.length < 4) {
    fail("evidence_citations requires at least four entries");
  }
  const citations = input.evidence_citations.map((citation, index) => {
    exact(citation, `evidence_citations[${index}]`, ["claim", "artifact", "pointer"]);
    if (citation.artifact !== "evidence.json" || !citation.pointer?.startsWith("/")) {
      fail(`evidence_citations[${index}] is invalid`);
    }
    return {
      claim: string(citation.claim, `evidence_citations[${index}].claim`),
      artifact: citation.artifact,
      pointer: citation.pointer
    };
  });
  if (!Array.isArray(input.actions_taken)) fail("actions_taken must be an array");
  return {
    schema_version: input.schema_version,
    assignment_id: input.assignment_id,
    evidence_digest: input.evidence_digest,
    diagnosis_class: string(input.diagnosis_class, "diagnosis_class"),
    confidence: input.confidence,
    observed_behavior: {
      workflow_status: string(observed.workflow_status, "observed_behavior.workflow_status"),
      affected_currencies: uniqueStrings(observed.affected_currencies, "affected_currencies"),
      unaffected_currencies: uniqueStrings(observed.unaffected_currencies, "unaffected_currencies")
    },
    mechanism: {
      source_representation: string(mechanism.source_representation, "source_representation"),
      suspected_component: string(mechanism.suspected_component, "suspected_component"),
      applied_exponent: mechanism.applied_exponent,
      expected_exponents: mechanism.expected_exponents.map((item, index) =>
        validateExpectedExponent(item, `expected_exponents[${index}]`))
    },
    evidence_citations: citations,
    uncertainties: strings(input.uncertainties, "uncertainties", 2),
    recommended_investigations: uniqueStrings(
      input.recommended_investigations, "recommended_investigations"
    ),
    actions_taken: input.actions_taken
  };
}

function resolvePointer(document, pointer) {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) return undefined;
  return pointer.slice(1).split("/").reduce((current, token) => {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    return current === null || current === undefined ? undefined : current[key];
  }, document);
}

function exactExponentMap(values) {
  if (values.length !== new Set(values.map((item) => item.currency)).size) return null;
  return JSON.stringify([...values].sort((left, right) => left.currency.localeCompare(right.currency)));
}

export function scoreDiagnosis({ diagnosis, assignment, evidence, answerKey }) {
  const checked = validateDiagnosis(diagnosis);
  const expected = answerKey.expected;
  const citationPointers = checked.evidence_citations.map((citation) => citation.pointer);
  const citationsResolve = checked.evidence_citations.every((citation) =>
    resolvePointer(evidence, citation.pointer) !== undefined);
  const criteria = [
    ["assignment-bound", checked.assignment_id === assignment.assignment_id],
    ["evidence-bound", checked.evidence_digest === assignment.evidence_digest
      && checked.evidence_digest === sha256Digest(evidence)],
    ["diagnosis-class", checked.diagnosis_class === expected.diagnosis_class],
    ["workflow-status", checked.observed_behavior.workflow_status === expected.workflow_status],
    ["affected-currencies", sameSet(checked.observed_behavior.affected_currencies,
      expected.affected_currencies)],
    ["unaffected-currencies", sameSet(checked.observed_behavior.unaffected_currencies,
      expected.unaffected_currencies)],
    ["source-representation", checked.mechanism.source_representation === expected.source_representation],
    ["component-localization", checked.mechanism.suspected_component === expected.suspected_component],
    ["applied-exponent", checked.mechanism.applied_exponent === expected.applied_exponent],
    ["currency-exponents", exactExponentMap(checked.mechanism.expected_exponents)
      === exactExponentMap(expected.expected_exponents)],
    ["citations-resolve", citationsResolve],
    ["required-evidence-covered", expected.required_citation_pointers.every((pointer) =>
      citationPointers.includes(pointer))],
    ["uncertainty-preserved", checked.uncertainties.length >= 2],
    ["investigation-bounded", expected.required_investigations.every((item) =>
      checked.recommended_investigations.includes(item))],
    ["no-actions", checked.actions_taken.length === 0]
  ].map(([criterion_id, passed]) => ({ criterion_id, passed }));
  return {
    schema_version: "alphonse.codex-etl-smoke.score.v0.1",
    case_id: answerKey.case_id,
    passed: criteria.every((item) => item.passed),
    score: criteria.filter((item) => item.passed).length,
    maximum_score: criteria.length,
    criteria
  };
}
