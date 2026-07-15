import { sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

function fail(code, message, details = {}) {
  throw new KernelError(400, code, message, details);
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_INPUT", `${field} must be an object.`);
  return value;
}

function exact(value, field, fields) {
  object(value, field);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("INVALID_INPUT", `${field} fields must be exact.`, { expected, received: actual });
  }
  return value;
}

function string(value, field, maximum = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    fail("INVALID_INPUT", `${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function strings(value, field, maximumItems = 20) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumItems) {
    fail("INVALID_INPUT", `${field} must be a bounded non-empty string array.`);
  }
  return value.map((item, index) => string(item, `${field}[${index}]`, 500));
}

export function validateFailureSpecification(value, actor) {
  if (actor?.type !== "human") {
    fail("HUMAN_CONFIRMATION_REQUIRED", "Failure Specifications require explicit human confirmation.");
  }
  string(actor.id, "confirming actor id", 200);
  const input = exact(value, "failure specification", [
    "case_id", "expected_behavior", "actual_behavior", "reproduction_conditions", "targeted_verification"
  ]);
  const verification = exact(input.targeted_verification, "targeted_verification", [
    "expected_behavior", "prohibited_behavior"
  ]);
  const expectedBehavior = string(input.expected_behavior, "expected_behavior");
  const targetedExpectedBehavior = string(verification.expected_behavior, "targeted_verification.expected_behavior");
  if (targetedExpectedBehavior !== expectedBehavior) {
    fail("FAILURE_SPECIFICATION_INCONSISTENT",
      "Targeted verification expected behavior must equal the confirmed expected behavior.");
  }
  return {
    case_id: string(input.case_id, "case_id", 36),
    expected_behavior: expectedBehavior,
    actual_behavior: string(input.actual_behavior, "actual_behavior"),
    reproduction_conditions: strings(input.reproduction_conditions, "reproduction_conditions"),
    targeted_verification: {
      expected_behavior: targetedExpectedBehavior,
      prohibited_behavior: string(verification.prohibited_behavior, "targeted_verification.prohibited_behavior")
    }
  };
}

function pathParts(value) {
  const parts = String(value).split(".");
  if (parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)
      || ["__proto__", "prototype", "constructor"].includes(part))) {
    fail("INVALID_REDACTION_POLICY", "Policy paths are invalid.");
  }
  return parts;
}

function getAtPath(source, pathValue) {
  let current = source;
  for (const part of pathParts(pathValue)) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function setAtPath(target, pathValue, value) {
  const parts = pathParts(pathValue);
  let current = target;
  for (const part of parts.slice(0, -1)) current = current[part] ??= {};
  current[parts.at(-1)] = structuredClone(value);
}

function omittedBranches(source, extracted, pathValue = "") {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  const omitted = [];
  for (const [key, value] of Object.entries(source)) {
    const child = pathValue ? `${pathValue}.${key}` : key;
    const exactSelected = extracted.includes(child);
    const descendantSelected = extracted.some((item) => item.startsWith(`${child}.`));
    if (!exactSelected && !descendantSelected) omitted.push(child);
    else if (!exactSelected) omitted.push(...omittedBranches(value, extracted, child));
  }
  return omitted;
}

export function applyExtractionAndRedaction(source, policy) {
  object(source, "execution detail");
  const exactPolicy = exact(policy, "extraction policy", [
    "policy_id", "extract_paths", "redact_paths", "omit_paths", "replacement"
  ]);
  const extractPaths = strings(exactPolicy.extract_paths, "extract_paths", 100);
  const redactPaths = Array.isArray(exactPolicy.redact_paths)
    ? exactPolicy.redact_paths.map((item, index) => string(item, `redact_paths[${index}]`, 200)) : [];
  if (redactPaths.some((redactionPath) => !extractPaths.some((selectedPath) =>
    redactionPath === selectedPath || redactionPath.startsWith(`${selectedPath}.`)))) {
    fail("INVALID_REDACTION_POLICY", "Every redaction path must be contained by an extraction path.");
  }
  const content = {};
  for (const selectedPath of extractPaths) {
    const selected = getAtPath(source, selectedPath);
    if (selected !== undefined) setAtPath(content, selectedPath, selected);
  }
  const redacted = [];
  for (const redactionPath of redactPaths) {
    if (getAtPath(content, redactionPath) !== undefined) {
      setAtPath(content, redactionPath, string(exactPolicy.replacement, "replacement", 100));
      redacted.push(redactionPath);
    }
  }
  return {
    content,
    redacted_paths: redacted.sort(),
    omitted_paths: [...new Set([
      ...omittedBranches(source, extractPaths),
      ...strings(exactPolicy.omit_paths, "omit_paths", 100)
    ])].sort(),
    source_detail_digest: sha256Digest(source),
    policy_digest: sha256Digest(exactPolicy)
  };
}

export function buildReproductionBundle({
  caseId, revisionId, revisionMaterialDigest, failureSpecification, redactedDetail,
  assumptions, policyDigest, sourceDetailDigest, reproduction, redaction = { redacted_paths: [], omitted_paths: [] }
}) {
  const fixtures = object(redactedDetail.fixtures, "redactedDetail.fixtures");
  return {
    schema_version: "0.2.0",
    case_id: caseId,
    revision: { revision_id: revisionId, material_digest: revisionMaterialDigest },
    failure_specification: {
      failure_specification_id: failureSpecification.failure_specification_id,
      specification_digest: failureSpecification.specification_digest,
      expected_behavior: failureSpecification.expected_behavior,
      actual_behavior: failureSpecification.actual_behavior,
      reproduction_conditions: structuredClone(failureSpecification.reproduction_conditions ?? []),
      targeted_verification: structuredClone(failureSpecification.targeted_verification ?? {})
    },
    redacted_inputs: redactedDetail.input ?? {},
    fixtures,
    assumptions: [...assumptions],
    redaction: structuredClone(redaction),
    reproduction: structuredClone(reproduction),
    integrity: {
      source_detail_digest: sourceDetailDigest,
      redaction_policy_digest: policyDigest,
      redacted_detail_digest: sha256Digest(redactedDetail),
      fixtures_digest: sha256Digest(fixtures),
      assumptions_digest: sha256Digest(assumptions)
    },
    authority_granted: false
  };
}

export function projectDiagnosticCase({ failureSpecification, bundles, attempts }) {
  if (bundles.some((bundle) => bundle.reproduction_status === "demonstrated")) {
    return { state: "reproducible", legal_next_operations: ["diagnostic.repair_task.create"] };
  }
  if (failureSpecification) {
    return { state: "specified", legal_next_operations: ["diagnostic.reproduction.create"] };
  }
  return { state: "open", legal_next_operations: ["diagnostic.failure_specification.confirm"] };
}
