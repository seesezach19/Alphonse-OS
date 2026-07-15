import { sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import {
  requireDigest,
  requireExact,
  requireObject,
  requireString,
  requireUuid,
  validateRuntimeAttribution
} from "./diagnostic-repair-worker-contracts.js";

const CONFIDENCE = new Set(["low", "medium", "high"]);
const DIAGNOSIS_CONSTRAINTS = [
  "no_failure_declaration", "no_evidence_mutation", "no_repair_commission",
  "no_verification", "no_promotion", "no_external_effects"
];

function fail(code, message) {
  throw new KernelError(400, code, message);
}

function rejectSensitive(value, field, depth = 0) {
  if (depth > 24) fail("INVALID_DIAGNOSIS", `${field} exceeds maximum nesting depth.`);
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (/(secret|password|token|credential|private[_-]?key|authorization|cookie)/i.test(key)) {
      fail("SENSITIVE_DIAGNOSIS_REJECTED", `${field}.${key} contains credential-like material.`);
    }
    rejectSensitive(nested, `${field}.${key}`, depth + 1);
  }
}

function list(value, field, validate, { minimum = 0, maximum = 20 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail("INVALID_DIAGNOSIS", `${field} must contain ${minimum} to ${maximum} items.`);
  }
  return value.map((item, index) => validate(item, `${field}[${index}]`));
}

function references(value, field, minimum = 0) {
  return list(value, field, (item, itemField) => requireDigest(item, itemField), { minimum, maximum: 30 });
}

export function validateDiagnosisWorkerRegistration(value) {
  const input = requireExact(value, "diagnosis worker registration", [
    "passport_id", "work_intent_id", "protocol_version", "runtime_attribution"
  ]);
  if (input.protocol_version !== "0.2.0") fail("WORKER_PROTOCOL_UNSUPPORTED", "Worker protocol must be 0.2.0.");
  return {
    passport_id: requireUuid(input.passport_id, "passport_id"),
    work_intent_id: requireUuid(input.work_intent_id, "work_intent_id"),
    protocol_version: "0.2.0",
    runtime_attribution: validateRuntimeAttribution(input.runtime_attribution)
  };
}

export function validateDiagnosisIntentBoundary(scope, constraints, expected) {
  const boundedScope = requireExact(scope, "diagnosis Work Intent scope", [
    "case_id", "revision_id", "reproduction_bundle_id"
  ]);
  const boundedConstraints = requireExact(constraints, "diagnosis Work Intent constraints", DIAGNOSIS_CONSTRAINTS);
  for (const field of ["case_id", "revision_id", "reproduction_bundle_id"]) {
    if (boundedScope[field] !== expected[field]) {
      throw new KernelError(409, "DIAGNOSIS_INTENT_SCOPE_MISMATCH", "Diagnosis Work Intent must bind exact source artifacts.");
    }
  }
  if (DIAGNOSIS_CONSTRAINTS.some((field) => boundedConstraints[field] !== true)) {
    throw new KernelError(409, "DIAGNOSIS_INTENT_CONSTRAINTS_REQUIRED", "Diagnosis Work Intent must deny operational authority.");
  }
  return {
    scope: Object.fromEntries(Object.entries(boundedScope).map(([key, item]) => [key, requireUuid(item, `scope.${key}`)])),
    constraints: Object.fromEntries(DIAGNOSIS_CONSTRAINTS.map((field) => [field, true]))
  };
}

export function validateDiagnosisRequest(value) {
  const input = requireExact(value, "diagnosis request", [
    "case_id", "worker_registration_id", "reproduction_bundle_id", "instruction", "expires_at"
  ]);
  const expiresAt = new Date(requireString(input.expires_at, "expires_at", 40));
  if (!Number.isFinite(expiresAt.getTime())) fail("INVALID_DIAGNOSIS_EXPIRY", "expires_at must be an ISO timestamp.");
  return {
    case_id: requireUuid(input.case_id, "case_id"),
    worker_registration_id: requireUuid(input.worker_registration_id, "worker_registration_id"),
    reproduction_bundle_id: requireUuid(input.reproduction_bundle_id, "reproduction_bundle_id"),
    instruction: requireString(input.instruction, "instruction", 8000),
    expires_at: expiresAt.toISOString()
  };
}

export function validateDiagnosisOutput(value) {
  rejectSensitive(value, "diagnosis");
  const input = requireExact(value, "diagnosis", [
    "facts", "inferences", "hypotheses", "uncertainties", "recommended_investigation",
    "artifact_references", "provenance"
  ]);
  const facts = list(input.facts, "facts", (item, field) => {
    const fact = requireExact(item, field, ["statement", "artifact_references"]);
    return { statement: requireString(fact.statement, `${field}.statement`, 2000),
      artifact_references: references(fact.artifact_references, `${field}.artifact_references`, 1) };
  }, { minimum: 1 });
  const inferences = list(input.inferences, "inferences", (item, field) => {
    const inference = requireExact(item, field, ["statement", "basis"]);
    return { statement: requireString(inference.statement, `${field}.statement`, 2000),
      basis: references(inference.basis, `${field}.basis`, 1) };
  });
  const hypotheses = list(input.hypotheses, "hypotheses", (item, field) => {
    const hypothesis = requireExact(item, field, [
      "statement", "confidence", "supporting_artifact_references", "contradicting_artifact_references"
    ]);
    const confidence = requireString(hypothesis.confidence, `${field}.confidence`, 10);
    if (!CONFIDENCE.has(confidence)) fail("INVALID_DIAGNOSIS", `${field}.confidence is invalid.`);
    return {
      statement: requireString(hypothesis.statement, `${field}.statement`, 2000), confidence,
      supporting_artifact_references: references(hypothesis.supporting_artifact_references,
        `${field}.supporting_artifact_references`),
      contradicting_artifact_references: references(hypothesis.contradicting_artifact_references,
        `${field}.contradicting_artifact_references`)
    };
  });
  const uncertainties = list(input.uncertainties, "uncertainties",
    (item, field) => requireString(item, field, 1000));
  const recommendedInvestigation = list(input.recommended_investigation, "recommended_investigation",
    (item, field) => {
      const step = requireExact(item, field, ["step", "rationale", "artifact_references"]);
      return {
        step: requireString(step.step, `${field}.step`, 1000),
        rationale: requireString(step.rationale, `${field}.rationale`, 2000),
        artifact_references: references(step.artifact_references, `${field}.artifact_references`)
      };
    });
  const provenance = requireExact(input.provenance, "provenance", [
    "model", "runtime", "instruction_digest", "input_artifact_digests"
  ]);
  const model = requireExact(provenance.model, "provenance.model", ["provider", "model", "version"]);
  const runtime = requireExact(provenance.runtime, "provenance.runtime", ["name", "version"]);
  return {
    facts, inferences, hypotheses, uncertainties,
    recommended_investigation: recommendedInvestigation,
    artifact_references: references(input.artifact_references, "artifact_references", 1),
    provenance: {
      model: {
        provider: requireString(model.provider, "provenance.model.provider", 100),
        model: requireString(model.model, "provenance.model.model", 200),
        version: requireString(model.version, "provenance.model.version", 200)
      },
      runtime: {
        name: requireString(runtime.name, "provenance.runtime.name", 100),
        version: requireString(runtime.version, "provenance.runtime.version", 100)
      },
      instruction_digest: requireDigest(provenance.instruction_digest, "provenance.instruction_digest"),
      input_artifact_digests: references(provenance.input_artifact_digests, "provenance.input_artifact_digests", 1)
    }
  };
}

export function buildDiagnosisProposalMaterial({ requestId, caseId, workerRegistrationId, output }) {
  const content = {
    schema_version: "0.2.0",
    request_id: requireUuid(requestId, "request_id"),
    case_id: requireUuid(caseId, "case_id"),
    worker_registration_id: requireUuid(workerRegistrationId, "worker_registration_id"),
    diagnosis: structuredClone(output),
    authority: {
      failure_truth: "not_granted", evidence_mutation: "not_granted", repair: "not_granted",
      verification: "not_granted", promotion: "not_granted", target_change: "not_granted"
    }
  };
  return { content, proposal_digest: sha256Digest(content) };
}

export function projectDiagnosisProposal(events) {
  const review = [...events].reverse().find((event) => ["accepted", "rejected"].includes(event.event_type));
  return {
    usefulness: review?.event_type ?? "unreviewed",
    demonstrated_failure_truth: "unchanged",
    authority: "none",
    legal_next_operations: review ? [] : ["diagnostic.diagnosis_proposal.review"]
  };
}
