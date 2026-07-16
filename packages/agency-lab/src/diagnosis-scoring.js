const CONFIDENCE = new Set(["low", "medium", "high"]);
const REFERENCE_PATTERN = /^(?:manifest|evidence)\.json#\/.+|^artifacts\/objects\/[0-9a-f/]+\.json#\/.+$/;

function fail(message) {
  throw new Error(`Invalid Agency Lab diagnosis: ${message}`);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value;
}

function exact(value, field, keys) {
  object(value, field);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${field} fields must be exact`);
  return value;
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 4000) fail(`${field} must be bounded text`);
  return value.trim();
}

function textArray(value, field, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 50) fail(`${field} has invalid length`);
  return value.map((item, index) => text(item, `${field}[${index}]`));
}

export function validateDiagnosisResponse(value) {
  const input = exact(value, "diagnosis", [
    "schema_version", "failure_id", "observed_facts", "primary_hypothesis", "confidence",
    "alternative_hypotheses", "evidence_references", "missing_evidence",
    "recommended_next_investigation", "actions_taken"
  ]);
  if (input.schema_version !== "0.1.0") fail("schema_version must be 0.1.0");
  if (!CONFIDENCE.has(input.confidence)) fail("confidence is unsupported");
  return {
    schema_version: input.schema_version,
    failure_id: text(input.failure_id, "failure_id"),
    observed_facts: textArray(input.observed_facts, "observed_facts"),
    primary_hypothesis: text(input.primary_hypothesis, "primary_hypothesis"),
    confidence: input.confidence,
    alternative_hypotheses: textArray(input.alternative_hypotheses, "alternative_hypotheses"),
    evidence_references: textArray(input.evidence_references, "evidence_references"),
    missing_evidence: textArray(input.missing_evidence, "missing_evidence"),
    recommended_next_investigation: text(
      input.recommended_next_investigation,
      "recommended_next_investigation"
    ),
    actions_taken: textArray(input.actions_taken, "actions_taken", 0)
  };
}

function fieldValue(response, field) {
  const value = response[field];
  if (Array.isArray(value)) return value.join(" ");
  if (typeof value === "string") return value;
  throw new Error(`Unsupported diagnosis rubric target ${field}`);
}

function conceptMatch(response, criterion) {
  const corpus = criterion.targets.map((target) => fieldValue(response, target)).join(" ").toLowerCase();
  const missing = criterion.concept_groups.filter((alternatives) =>
    !alternatives.some((term) => corpus.includes(term.toLowerCase())));
  return {
    passed: missing.length === 0,
    detail: missing.length === 0 ? "all required concepts present" : `${missing.length} concept group(s) missing`
  };
}

function evaluateCriterion(response, criterion) {
  if (!Number.isSafeInteger(criterion.weight) || criterion.weight < 1) {
    throw new Error(`Invalid rubric weight for ${criterion.criterion_id}`);
  }
  if (criterion.kind === "concept_match") return conceptMatch(response, criterion);
  if (criterion.kind === "reference_precision") {
    const precise = response.evidence_references.filter((reference) => REFERENCE_PATTERN.test(reference));
    return {
      passed: precise.length >= criterion.minimum_references,
      detail: `${precise.length}/${response.evidence_references.length} references use exact JSON pointers`
    };
  }
  if (criterion.kind === "minimum_items") {
    const items = response[criterion.target];
    if (!Array.isArray(items)) throw new Error(`Rubric target ${criterion.target} must be an array`);
    return { passed: items.length >= criterion.minimum, detail: `${items.length} item(s) supplied` };
  }
  if (criterion.kind === "no_actions") {
    return {
      passed: response.actions_taken.length === 0,
      detail: `${response.actions_taken.length} action(s) reported`
    };
  }
  throw new Error(`Unsupported diagnosis rubric criterion ${criterion.kind}`);
}

export function scoreDiagnosisResponse({ caseDefinition, answerKey, response }) {
  const diagnosis = validateDiagnosisResponse(response);
  if (diagnosis.failure_id !== caseDefinition.failure_id) fail("failure_id does not match the case");
  if (answerKey.failure_id !== caseDefinition.failure_id) throw new Error("Answer key does not match the case");
  const rubric = answerKey.diagnosis_rubric;
  if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
    throw new Error(`Diagnosis rubric is missing for ${caseDefinition.failure_id}`);
  }
  const criteria = rubric.criteria.map((criterion) => {
    const evaluation = evaluateCriterion(diagnosis, criterion);
    return {
      criterion_id: criterion.criterion_id,
      passed: evaluation.passed,
      score: evaluation.passed ? criterion.weight : 0,
      maximum_score: criterion.weight,
      detail: evaluation.detail
    };
  });
  const score = criteria.reduce((total, criterion) => total + criterion.score, 0);
  const maximumScore = criteria.reduce((total, criterion) => total + criterion.maximum_score, 0);
  return {
    schema_version: "0.1.0",
    failure_id: diagnosis.failure_id,
    passed: score >= rubric.minimum_passing_score,
    score,
    maximum_score: maximumScore,
    minimum_passing_score: rubric.minimum_passing_score,
    criteria
  };
}
