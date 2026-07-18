import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function validateClaimReferences(value, path, allowedClaimIds, minimum = 0) {
  const claims = stringList(value, path, { minimum, maximum: 64, itemMaximum: 100 });
  for (const claimId of claims) {
    if (!UUID.test(claimId) || !allowedClaimIds.has(claimId)) {
      fail("DIAGNOSTIC_WORKER_CITATION_INVALID",
        `${path} must cite only claim IDs present in the exact assigned Evidence Package.`, 409,
        { claim_id: claimId });
    }
  }
  return claims;
}

export function validateDiagnosticWorkerOutput(value, allowedClaimIds) {
  exact(value, "diagnosis", [
    "best_supported_hypothesis", "supporting_claims", "counterevidence", "alternatives",
    "not_established", "falsifiers", "next_best_observation"
  ]);
  exact(value.best_supported_hypothesis, "diagnosis.best_supported_hypothesis", [
    "mechanism", "scope", "support", "confidence"
  ]);
  const hypothesis = {
    mechanism: string(value.best_supported_hypothesis.mechanism,
      "diagnosis.best_supported_hypothesis.mechanism", 100),
    scope: string(value.best_supported_hypothesis.scope,
      "diagnosis.best_supported_hypothesis.scope", 100),
    support: string(value.best_supported_hypothesis.support,
      "diagnosis.best_supported_hypothesis.support", 100),
    confidence: string(value.best_supported_hypothesis.confidence,
      "diagnosis.best_supported_hypothesis.confidence", 20)
  };
  if (!MECHANISMS.has(hypothesis.mechanism) || !SCOPES.has(hypothesis.scope)
      || !SUPPORT.has(hypothesis.support)
      || !new Set(["high", "medium", "low"]).has(hypothesis.confidence)) {
    fail("DIAGNOSTIC_WORKER_OUTPUT_INVALID",
      "diagnosis.best_supported_hypothesis uses values outside the closed neutral taxonomy.");
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
  let nextBestObservation = null;
  if (value.next_best_observation !== null) {
    exact(value.next_best_observation, "diagnosis.next_best_observation", ["type", "purpose"]);
    nextBestObservation = {
      type: string(value.next_best_observation.type, "diagnosis.next_best_observation.type", 500),
      purpose: string(value.next_best_observation.purpose,
        "diagnosis.next_best_observation.purpose")
    };
  }
  return {
    best_supported_hypothesis: hypothesis,
    supporting_claims: validateClaimReferences(value.supporting_claims,
      "diagnosis.supporting_claims", allowedClaimIds, 1),
    counterevidence: validateClaimReferences(value.counterevidence,
      "diagnosis.counterevidence", allowedClaimIds),
    alternatives: checkedAlternatives,
    not_established: stringList(value.not_established, "diagnosis.not_established",
      { minimum: 1, maximum: 32 }),
    falsifiers: stringList(value.falsifiers, "diagnosis.falsifiers",
      { minimum: 1, maximum: 32 }),
    next_best_observation: nextBestObservation
  };
}

export function claimIdsFromWorkerInput(input) {
  if (input?.schema_version !== DIAGNOSTIC_WORKER_INPUT_SCHEMA) {
    fail("DIAGNOSTIC_WORKER_INPUT_INVALID", "Worker input schema is unsupported.", 409);
  }
  const claims = input.evidence_package_artifact?.semantic_package?.material?.document
    ?.deterministic_interpretation?.case_claims;
  if (!Array.isArray(claims) || claims.length === 0) {
    fail("DIAGNOSTIC_WORKER_INPUT_INVALID",
      "Worker input does not contain the frozen package claim manifest.", 409);
  }
  const ids = claims.map((claim) => claim?.claim_id);
  if (ids.some((claimId) => typeof claimId !== "string" || !UUID.test(claimId))
      || new Set(ids).size !== ids.length) {
    fail("DIAGNOSTIC_WORKER_INPUT_INVALID",
      "Worker input claim manifest contains invalid or duplicate claim IDs.", 409);
  }
  return new Set(ids);
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
