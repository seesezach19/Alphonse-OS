import { createHmac, sign, verify } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const REQUEST_FIELDS = new Set([
  "request_id", "grant_id", "requester_principal_id", "installation_id", "environment_id",
  "integration_id", "field_role", "claim_field", "namespace", "algorithm_version", "input_base64",
  "requested_at"
]);
const RECEIPT_FIELDS = new Set([
  "result_receipt_id", "request_id", "grant_id", "requester_principal_id", "installation_id",
  "environment_id", "integration_id", "field_role", "claim_field", "namespace", "algorithm_version",
  "equality_token", "input_length", "collection_window_id", "service_id", "service_version", "issued_at"
]);

function fail(status, code, message, details = {}) {
  throw new KernelError(status, code, message, details);
}

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(422, "TOKENIZATION_INPUT_INVALID", `${label} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !fields.has(key));
  const missing = [...fields].filter((key) => !(key in value));
  if (unknown.length || missing.length) fail(422, "TOKENIZATION_INPUT_INVALID", `${label} has an invalid shape.`, { unknown, missing });
  return value;
}

function boundedString(value, label, maximum = 160) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    fail(422, "TOKENIZATION_INPUT_INVALID", `${label} must be a bounded string.`);
  }
  return value;
}

function validateBase64(value) {
  boundedString(value, "input_base64", 1024 * 1024);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail(422, "TOKENIZATION_INPUT_INVALID", "input_base64 must be canonical base64.");
  return bytes;
}

export function validateTokenizationRequest(value) {
  exactObject(value, REQUEST_FIELDS, "tokenization request");
  for (const field of REQUEST_FIELDS) boundedString(value[field], field, field === "input_base64" ? 1024 * 1024 : 200);
  if (value.algorithm_version !== "hmac-sha256-length-prefixed.v1") {
    fail(422, "TOKENIZATION_ALGORITHM_UNSUPPORTED", "Tokenization algorithm version is unsupported.");
  }
  if (!Number.isFinite(Date.parse(value.requested_at))) fail(422, "TOKENIZATION_INPUT_INVALID", "requested_at must be an instant.");
  validateBase64(value.input_base64);
  return value;
}

export function authorizeTokenizationRequest(value, grant, { grantId, effectiveState, now = new Date() }) {
  validateTokenizationRequest(value);
  const inputBytes = validateBase64(value.input_base64);
  const current = new Date(now).getTime();
  const exact = [
    [value.grant_id === grantId, "grant_id"],
    [effectiveState === "active", "effective_state"],
    [value.requester_principal_id === grant.requester_principal_id, "requester_principal_id"],
    [value.installation_id === grant.installation_id, "installation_id"],
    [value.environment_id === grant.environment_id, "environment_id"],
    [value.integration_id === grant.integration_id, "integration_id"],
    [value.field_role === grant.field_role, "field_role"],
    [value.claim_field === grant.claim_field, "claim_field"],
    [value.namespace === grant.namespace, "namespace"],
    [value.algorithm_version === grant.algorithm_version, "algorithm_version"],
    [grant.service_binding?.service_id === "tokenization-service", "service_binding"],
    [current >= Date.parse(grant.valid_from) && current < Date.parse(grant.expires_at), "validity_window"],
    [inputBytes.length <= grant.max_input_bytes, "max_input_bytes"]
  ];
  const failed = exact.find(([passed]) => !passed);
  if (failed) fail(403, "TOKENIZATION_GRANT_SCOPE_VIOLATION", "Tokenization request exceeds Tokenization Use Grant scope.", {
    failed_binding: failed[1]
  });
  return { authorized: true, input_bytes: inputBytes };
}

function lengthPrefix(value) {
  const size = Buffer.alloc(8);
  size.writeBigUInt64BE(BigInt(value.length));
  return Buffer.concat([size, value]);
}

export function createEqualityToken(inputBytes, context, rootSecret) {
  const bytes = Buffer.isBuffer(inputBytes) ? inputBytes : Buffer.from(inputBytes);
  if (typeof rootSecret !== "string" || rootSecret.length < 32) throw new Error("Tokenization root secret is required.");
  const domainFields = [context.installation_id, context.environment_id, context.integration_id,
    context.field_role, context.namespace, context.algorithm_version];
  domainFields.forEach((value, index) => boundedString(value, `tokenization domain field ${index}`));
  const preimage = Buffer.concat([
    lengthPrefix(Buffer.from("ALPHONSE_EXACT_EQUALITY_TOKEN_V1", "utf8")),
    ...domainFields.map((value) => lengthPrefix(Buffer.from(value, "utf8"))),
    lengthPrefix(bytes)
  ]);
  return `eq:v1:${createHmac("sha256", rootSecret).update(preimage).digest("base64url")}`;
}

function validateReceiptDocument(value) {
  exactObject(value, RECEIPT_FIELDS, "tokenization result receipt");
  for (const field of RECEIPT_FIELDS) {
    if (field !== "input_length") boundedString(value[field], field, 240);
  }
  if (!Number.isSafeInteger(value.input_length) || value.input_length < 0) {
    fail(422, "TOKENIZATION_RECEIPT_INVALID", "input_length must be a non-negative safe integer.");
  }
  if (!/^eq:v1:[A-Za-z0-9_-]{43}$/.test(value.equality_token)) {
    fail(422, "TOKENIZATION_RECEIPT_INVALID", "equality_token is invalid.");
  }
  if (!Number.isFinite(Date.parse(value.issued_at))) fail(422, "TOKENIZATION_RECEIPT_INVALID", "issued_at must be an instant.");
  return value;
}

export function createSignedTokenizationResultReceipt(value, { keyId, privateKey }) {
  const document = validateReceiptDocument(value);
  boundedString(keyId, "keyId");
  const documentBytes = Buffer.from(canonicalize(document), "utf8");
  const signature = sign(null, documentBytes, privateKey).toString("base64url");
  const wrapper = {
    document,
    authentication: { algorithm: "Ed25519", key_id: keyId, signature }
  };
  return { bytes: canonicalize(wrapper), document, digest: sha256Digest(wrapper), authentication: wrapper.authentication };
}

export function verifySignedTokenizationResultReceipt(bytes, { keyId, publicKey }) {
  let wrapper;
  try { wrapper = JSON.parse(bytes); } catch {
    fail(400, "TOKENIZATION_RECEIPT_JSON_INVALID", "Tokenization Result Receipt is not valid JSON.");
  }
  exactObject(wrapper, new Set(["document", "authentication"]), "signed tokenization result receipt");
  const document = validateReceiptDocument(wrapper.document);
  if (wrapper.authentication?.algorithm !== "Ed25519" || wrapper.authentication?.key_id !== keyId
      || typeof wrapper.authentication.signature !== "string") {
    fail(401, "TOKENIZATION_RECEIPT_AUTHENTICATION_INVALID", "Tokenization Result Receipt authentication is invalid.");
  }
  let valid = false;
  try {
    valid = verify(null, Buffer.from(canonicalize(document), "utf8"), publicKey,
      Buffer.from(wrapper.authentication.signature, "base64url"));
  } catch {}
  if (!valid) fail(401, "TOKENIZATION_RECEIPT_SIGNATURE_INVALID", "Tokenization Result Receipt signature is invalid.");
  return { bytes: canonicalize(wrapper), document, authentication: wrapper.authentication, digest: sha256Digest(wrapper) };
}
