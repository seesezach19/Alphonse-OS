import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { DIAGNOSTIC_CONSISTENCY_REQUIRED_CITATION_ROLES } from
  "./diagnostic-consistency-contracts.js";
import { KernelError } from "./errors.js";

export const DIAGNOSTIC_BROKER_GRANT_SCHEMA =
  "alphonse.diagnostic-model-broker-grant.v0.1";
export const DIAGNOSTIC_BROKER_RECEIPT_SCHEMA =
  "alphonse.diagnostic-model-broker-receipt.v0.1";
export const DIAGNOSTIC_RUNNER_ATTESTATION_SCHEMA =
  "alphonse.diagnostic-runner-attestation.v0.1";
export const DIAGNOSTIC_WORKER_INPUT_SCHEMA =
  "alphonse.diagnostic-worker-input.v0.1";
export const DIAGNOSTIC_WORKER_OUTPUT_ENVELOPE_SCHEMA =
  "alphonse.diagnostic-worker-output-envelope.v0.1";
export const SIGNED_DIAGNOSTIC_DOCUMENT_SCHEMA =
  "alphonse.signed-diagnostic-runtime-document.v0.1";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SIGNATURE = /^hmac-sha256:[0-9a-f]{64}$/;
const SUPPORT = new Set([
  "BEST_SUPPORTED_HYPOTHESIS", "PLAUSIBLE", "NOT_ESTABLISHED", "CONTRADICTED"
]);
const MECHANISMS = new Set([
  "identity_scope_mismatch", "workflow_configuration_error", "provider_behavior_change",
  "observation_gap", "competing_supported_mechanism", "unknown"
]);
const SCOPES = new Set([
  "logical_operation", "delivery", "workflow", "integration", "provider", "unknown"
]);

function fail(code, message, status = 400, details = {}) {
  throw new KernelError(status, code, message, details);
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID", `${path} must be an object.`);
  }
  return value;
}

function exact(value, path, fields) {
  object(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (!same(actual, expected)) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID", `${path} fields must be exact.`, 400,
      { path, expected, received: actual });
  }
  return value;
}

function string(value, path, maximum = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
      `${path} must contain 1 to ${maximum} characters.`);
  }
  return value.trim();
}

function stringList(value, path, { minimum = 0, maximum = 32, itemMaximum = 2000 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
      `${path} must contain ${minimum} to ${maximum} items.`);
  }
  const checked = value.map((entry, index) => string(entry, `${path}[${index}]`, itemMaximum));
  if (new Set(checked).size !== checked.length) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID", `${path} items must be unique.`);
  }
  return checked;
}

function requireSecret(secret, label) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(`${label} must contain at least 32 bytes.`);
  }
}

export function signDiagnosticRuntimeDocument(document, { keyId, secret }) {
  requireSecret(secret, "Diagnostic runtime signing secret");
  const documentDigest = sha256Digest(document);
  return {
    schema_version: SIGNED_DIAGNOSTIC_DOCUMENT_SCHEMA,
    key_id: keyId,
    document: structuredClone(document),
    document_digest: documentDigest,
    signature: `hmac-sha256:${createHmac("sha256", secret)
      .update(canonicalize(document)).digest("hex")}`
  };
}

export function verifySignedDiagnosticRuntimeDocument(value, { keyId, secret }, expectedSchema) {
  requireSecret(secret, "Diagnostic runtime verification secret");
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !same(Object.keys(value).sort(), [
        "schema_version", "key_id", "document", "document_digest", "signature"
      ].sort())
      || value.schema_version !== SIGNED_DIAGNOSTIC_DOCUMENT_SCHEMA
      || value.key_id !== keyId
      || value.document?.schema_version !== expectedSchema
      || !DIGEST.test(value.document_digest ?? "")
      || sha256Digest(value.document) !== value.document_digest
      || !SIGNATURE.test(value.signature ?? "")) {
    fail("DIAGNOSTIC_RUNTIME_SIGNATURE_INVALID",
      "Signed diagnostic runtime material is malformed or digest-invalid.", 403);
  }
  const expected = `hmac-sha256:${createHmac("sha256", secret)
    .update(canonicalize(value.document)).digest("hex")}`;
  const suppliedBytes = Buffer.from(value.signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (suppliedBytes.length !== expectedBytes.length
      || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    fail("DIAGNOSTIC_RUNTIME_SIGNATURE_INVALID",
      "Signed diagnostic runtime material failed signature verification.", 403);
  }
  return { document: structuredClone(value.document), signed_digest: sha256Digest(value) };
}

export function verifyBrokerGrant(value, signing) {
  return verifySignedDiagnosticRuntimeDocument(value, signing, DIAGNOSTIC_BROKER_GRANT_SCHEMA);
}

export function verifyBrokerReceipt(value, signing) {
  return verifySignedDiagnosticRuntimeDocument(value, signing, DIAGNOSTIC_BROKER_RECEIPT_SCHEMA);
}

export function verifyRunnerAttestation(value, signing) {
  return verifySignedDiagnosticRuntimeDocument(value, signing, DIAGNOSTIC_RUNNER_ATTESTATION_SCHEMA);
}

function citationKey(value) {
  return canonicalize(value);
}

function validateCitationReferences(value, path, allowedCitations, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 64) {
    fail("DIAGNOSTIC_WORKER_CITATION_INVALID",
      `${path} must contain ${minimum} to 64 exact package citations.`, 409);
  }
  const citations = value.map((entry, index) => {
    exact(entry, `${path}[${index}]`, [
      "role", "reference_type", "reference_id", "reference_digest"
    ]);
    const checked = {
      role: string(entry.role, `${path}[${index}].role`, 100),
      reference_type: string(entry.reference_type, `${path}[${index}].reference_type`, 100),
      reference_id: string(entry.reference_id, `${path}[${index}].reference_id`, 240),
      reference_digest: string(entry.reference_digest,
        `${path}[${index}].reference_digest`, 80)
    };
    if (!DIAGNOSTIC_CONSISTENCY_REQUIRED_CITATION_ROLES.includes(checked.role)
        || !DIGEST.test(checked.reference_digest)
        || !allowedCitations.has(citationKey(checked))) {
      fail("DIAGNOSTIC_WORKER_CITATION_INVALID",
        `${path} must cite only exact typed references present in the assigned Evidence Package.`, 409,
        { citation: checked });
    }
    return checked;
  });
  const keys = citations.map(citationKey);
  if (new Set(keys).size !== keys.length) {
    fail("DIAGNOSTIC_WORKER_CITATION_INVALID", `${path} citations must be unique.`, 409);
  }
  return citations;
}

export function validateDiagnosticWorkerOutput(value, allowedCitations) {
  exact(value, "diagnosis", [
    "causal_summary", "best_supported_hypothesis", "identity_cardinality",
    "supporting_evidence", "counterevidence", "alternatives", "not_established",
    "falsifiers", "recommended_investigations", "actions_taken"
  ]);
  exact(value.best_supported_hypothesis, "diagnosis.best_supported_hypothesis", [
    "mechanism", "observed_identity_scope", "required_identity_scope", "support", "confidence",
    "implementation_location"
  ]);
  exact(value.best_supported_hypothesis.implementation_location,
    "diagnosis.best_supported_hypothesis.implementation_location", ["status", "component_id"]);
  const implementationStatus = string(value.best_supported_hypothesis.implementation_location.status,
    "diagnosis.best_supported_hypothesis.implementation_location.status", 40);
  if (!new Set(["proven", "not_proven", "ambiguous", "unknown"]).has(implementationStatus)) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
      "diagnosis implementation location status is outside the neutral taxonomy.");
  }
  let implementationComponent = null;
  if (implementationStatus === "proven") {
    implementationComponent = string(value.best_supported_hypothesis.implementation_location.component_id,
      "diagnosis.best_supported_hypothesis.implementation_location.component_id", 200);
  } else if (value.best_supported_hypothesis.implementation_location.component_id !== null) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
      "An unproven implementation location cannot name a component.");
  }
  const hypothesis = {
    mechanism: string(value.best_supported_hypothesis.mechanism,
      "diagnosis.best_supported_hypothesis.mechanism", 100),
    observed_identity_scope: string(value.best_supported_hypothesis.observed_identity_scope,
      "diagnosis.best_supported_hypothesis.observed_identity_scope", 100),
    required_identity_scope: string(value.best_supported_hypothesis.required_identity_scope,
      "diagnosis.best_supported_hypothesis.required_identity_scope", 100),
    support: string(value.best_supported_hypothesis.support,
      "diagnosis.best_supported_hypothesis.support", 100),
    confidence: string(value.best_supported_hypothesis.confidence,
      "diagnosis.best_supported_hypothesis.confidence", 20),
    implementation_location: { status: implementationStatus, component_id: implementationComponent }
  };
  if (!MECHANISMS.has(hypothesis.mechanism)
      || !SCOPES.has(hypothesis.observed_identity_scope)
      || !SCOPES.has(hypothesis.required_identity_scope)
      || !SUPPORT.has(hypothesis.support)
      || !new Set(["high", "medium", "low"]).has(hypothesis.confidence)) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
      "diagnosis.best_supported_hypothesis uses values outside the closed neutral taxonomy.");
  }
  exact(value.identity_cardinality, "diagnosis.identity_cardinality",
    ["deliveries", "logical_operations"]);
  const cardinality = {};
  for (const field of ["deliveries", "logical_operations"]) {
    const count = value.identity_cardinality[field];
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000) {
      fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
        `diagnosis.identity_cardinality.${field} must be between 1 and 1000.`);
    }
    cardinality[field] = count;
  }
  const alternatives = value.alternatives;
  if (!Array.isArray(alternatives) || alternatives.length > 20) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID", "diagnosis.alternatives must be a bounded array.");
  }
  const checkedAlternatives = alternatives.map((entry, index) => {
    exact(entry, `diagnosis.alternatives[${index}]`, ["hypothesis", "status", "reason"]);
    const status = string(entry.status, `diagnosis.alternatives[${index}].status`, 20);
    if (!new Set(["supported", "weakened", "unresolved", "contradicted"]).has(status)) {
      fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
        `diagnosis.alternatives[${index}].status is outside the closed taxonomy.`);
    }
    return {
      hypothesis: string(entry.hypothesis, `diagnosis.alternatives[${index}].hypothesis`),
      status,
      reason: string(entry.reason, `diagnosis.alternatives[${index}].reason`)
    };
  });
  if (!Array.isArray(value.recommended_investigations)
      || value.recommended_investigations.length < 1
      || value.recommended_investigations.length > 20) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
      "diagnosis.recommended_investigations must contain 1 to 20 entries.");
  }
  const recommendations = value.recommended_investigations.map((entry, index) => {
    exact(entry, `diagnosis.recommended_investigations[${index}]`, ["type", "purpose"]);
    return { type: string(entry.type, `diagnosis.recommended_investigations[${index}].type`, 200),
      purpose: string(entry.purpose,
        `diagnosis.recommended_investigations[${index}].purpose`) };
  });
  if (new Set(recommendations.map((entry) => entry.type)).size !== recommendations.length) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
      "diagnosis.recommended_investigations types must be unique.");
  }
  if (!Array.isArray(value.actions_taken) || value.actions_taken.length !== 0) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
      "Diagnostic Workers must report an exact empty actions_taken array.");
  }
  const supportingEvidence = validateCitationReferences(value.supporting_evidence,
    "diagnosis.supporting_evidence", allowedCitations, 5);
  const citedRoles = new Set(supportingEvidence.map((citation) => citation.role));
  if (DIAGNOSTIC_CONSISTENCY_REQUIRED_CITATION_ROLES.some((role) => !citedRoles.has(role))) {
    fail("DIAGNOSTIC_WORKER_CITATION_INVALID",
      "Supporting evidence must cover every required package material role.", 409,
      { required_roles: DIAGNOSTIC_CONSISTENCY_REQUIRED_CITATION_ROLES,
        received_roles: [...citedRoles].sort() });
  }
  return {
    causal_summary: string(value.causal_summary, "diagnosis.causal_summary"),
    best_supported_hypothesis: hypothesis,
    identity_cardinality: cardinality,
    supporting_evidence: supportingEvidence,
    counterevidence: validateCitationReferences(value.counterevidence,
      "diagnosis.counterevidence", allowedCitations),
    alternatives: checkedAlternatives,
    not_established: stringList(value.not_established, "diagnosis.not_established",
      { minimum: 1, maximum: 32 }),
    falsifiers: stringList(value.falsifiers, "diagnosis.falsifiers",
      { minimum: 1, maximum: 32 }),
    recommended_investigations: recommendations,
    actions_taken: []
  };
}

export function citationIndexFromWorkerInput(input) {
  if (input?.schema_version !== DIAGNOSTIC_WORKER_INPUT_SCHEMA) {
    fail("DIAGNOSTIC_WORKER_INPUT_INVALID", "Worker input schema is unsupported.", 409);
  }
  const semantic = input.evidence_package_artifact?.semantic_package;
  const material = semantic?.material?.document;
  const citations = [];
  const observationRoles = new Map([
    ["source.delivery", "source_delivery"],
    ["destination.request", "destination_request"]
  ]);
  for (const observation of material?.authenticated_evidence?.observations ?? []) {
    const role = observationRoles.get(observation.observation_type);
    if (role) citations.push({
      role,
      reference_type: "diagnostic_observation_receipt",
      reference_id: observation.receipt_id,
      reference_digest: observation.receipt_digest
    });
  }
  if (semantic?.lineage?.correlation_projection_id && semantic.lineage.correlation_semantic_digest) {
    citations.push({
      role: "correlation_projection",
      reference_type: "correlation_projection",
      reference_id: semantic.lineage.correlation_projection_id,
      reference_digest: semantic.lineage.correlation_semantic_digest
    });
  }
  if (semantic?.lineage?.effect_projection_id && semantic.lineage.effect_semantic_digest) {
    citations.push({
      role: "interpreted_effect",
      reference_type: "diagnostic_effect_projection",
      reference_id: semantic.lineage.effect_projection_id,
      reference_digest: semantic.lineage.effect_semantic_digest
    });
  }
  for (const dependency of material?.governed_dependencies ?? []) {
    if (dependency.dependency_type === "behavior_contract") citations.push({
      role: "behavior_contract",
      reference_type: "behavior_contract",
      reference_id: dependency.dependency_id,
      reference_digest: dependency.dependency_digest
    });
  }
  if (citations.length === 0
      || citations.some((citation) => typeof citation.reference_id !== "string"
        || !DIGEST.test(citation.reference_digest ?? ""))) {
    fail("DIAGNOSTIC_WORKER_INPUT_INVALID",
      "Worker input does not contain a valid typed package citation manifest.", 409);
  }
  const keys = citations.map(citationKey);
  if (new Set(keys).size !== keys.length
      || DIAGNOSTIC_CONSISTENCY_REQUIRED_CITATION_ROLES.some((role) =>
        !citations.some((citation) => citation.role === role))) {
    fail("DIAGNOSTIC_WORKER_INPUT_INVALID",
      "Worker input citation manifest is incomplete or duplicated.", 409);
  }
  return new Map(citations.map((citation) => [citationKey(citation), citation]));
}

export function validateDiagnosticOutputFileBoundary(scan, bytes, maximumBytes) {
  exact(scan, "runner.output_scan", ["entries", "sole_expected_regular_file",
    "total_size_bytes", "maximum_size_bytes", "diagnosis_file_digest"]);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maximumBytes
      || scan.sole_expected_regular_file !== true
      || !same(scan.entries, [{ path: "diagnosis.json", type: "regular_file",
        size_bytes: bytes.length }])
      || scan.total_size_bytes !== bytes.length || scan.maximum_size_bytes !== maximumBytes
      || scan.diagnosis_file_digest !== `sha256:${createHash("sha256").update(bytes).digest("hex")}`) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_BOUNDARY_INVALID",
      "Post-exit scan did not prove one bounded regular diagnosis.json file.", 409);
  }
  return {
    output_file_digest: scan.diagnosis_file_digest,
    output_size_bytes: bytes.length
  };
}
