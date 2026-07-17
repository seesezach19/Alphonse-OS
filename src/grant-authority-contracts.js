import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const SNAPSHOT_SCHEMA = "alphonse.grant-activation-snapshot.v0.1";
const RECEIPT_SCHEMA = "alphonse.grant-application-receipt.v0.1";
const SNAPSHOT_DOMAIN = "alphonse/grant-activation-snapshot/v0.1";
const RECEIPT_DOMAIN = "alphonse/grant-application-receipt/v0.1";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

function fail(status, code, message, details = {}) {
  throw new KernelError(status, code, message, details);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, "GRANT_PROTOCOL_INVALID", `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(400, "GRANT_PROTOCOL_INVALID", `${label} has unknown or missing fields.`, { actual, expected: wanted });
  }
}

function requiredString(value, label, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    fail(400, "GRANT_PROTOCOL_INVALID", `${label} is invalid.`);
  }
  return value;
}

function timestamp(value, label) {
  requiredString(value, label);
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(400, "GRANT_PROTOCOL_INVALID", `${label} must be an ISO-8601 UTC timestamp.`);
  }
  return value;
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

function requireSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    fail(500, "GRANT_PROTOCOL_KEY_INVALID", "Grant protocol signing secret must contain at least 32 bytes.");
  }
}

function signatureFor(domain, unsigned, secret) {
  requireSecret(secret);
  return createHmac("sha256", secret).update(`${domain}\n${canonicalize(unsigned)}`, "utf8").digest("hex");
}

function signDocument(schemaVersion, domain, document, options) {
  requiredString(options?.keyId, "key_id", IDENTIFIER);
  timestamp(options?.signedAt, "signed_at");
  const unsigned = {
    schema_version: schemaVersion,
    document,
    authentication: {
      algorithm: "hmac-sha256",
      key_id: options.keyId,
      signed_at: options.signedAt
    }
  };
  const signed = {
    ...unsigned,
    authentication: {
      ...unsigned.authentication,
      signature: signatureFor(domain, unsigned, options.secret)
    }
  };
  const bytes = canonicalize(signed);
  return { ...signed, bytes, digest: digestBytes(bytes) };
}

function parseSignedBytes(bytes, schemaVersion, domain, options, signatureCode) {
  if (typeof bytes !== "string" || Buffer.byteLength(bytes, "utf8") > 128 * 1024) {
    fail(400, "GRANT_PROTOCOL_INVALID", "Signed grant document bytes are missing or oversized.");
  }
  let signed;
  try {
    signed = JSON.parse(bytes);
  } catch {
    fail(400, "GRANT_PROTOCOL_INVALID", "Signed grant document must be valid JSON.");
  }
  exactKeys(signed, ["schema_version", "document", "authentication"], "signed document");
  if (signed.schema_version !== schemaVersion) {
    fail(422, "GRANT_PROTOCOL_SCHEMA_UNSUPPORTED", "Signed grant document schema is unsupported.");
  }
  exactKeys(signed.authentication, ["algorithm", "key_id", "signed_at", "signature"], "authentication");
  if (signed.authentication.algorithm !== "hmac-sha256" || signed.authentication.key_id !== options.keyId) {
    fail(403, signatureCode, "Signed grant document authentication binding is invalid.");
  }
  timestamp(signed.authentication.signed_at, "authentication.signed_at");
  requiredString(signed.authentication.signature, "authentication.signature", /^[0-9a-f]{64}$/);
  const unsigned = {
    schema_version: signed.schema_version,
    document: signed.document,
    authentication: {
      algorithm: signed.authentication.algorithm,
      key_id: signed.authentication.key_id,
      signed_at: signed.authentication.signed_at
    }
  };
  const expected = Buffer.from(signatureFor(domain, unsigned, options.secret), "hex");
  const supplied = Buffer.from(signed.authentication.signature, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    fail(403, signatureCode, "Signed grant document signature is invalid.");
  }
  const canonicalBytes = canonicalize(signed);
  if (canonicalBytes !== bytes) {
    fail(400, "GRANT_PROTOCOL_NONCANONICAL", "Signed grant document bytes must use canonical JSON.");
  }
  return { ...signed, bytes, digest: digestBytes(bytes) };
}

function validateSnapshotDocument(document) {
  exactKeys(document, [
    "snapshot_id", "grant_id", "grant_type", "installation_id", "environment_id",
    "receiver_service_id", "grant_document", "authority_sequence", "predecessor_snapshot_digest", "target_state",
    "grant_digest", "readiness_receipt_digest", "issued_at", "expires_at"
  ], "grant activation snapshot");
  for (const field of ["snapshot_id", "grant_id", "installation_id", "environment_id"]) {
    requiredString(document[field], field, UUID);
  }
  requiredString(document.grant_type, "grant_type", /^(observation_reporting|tokenization_use)$/);
  requiredString(document.receiver_service_id, "receiver_service_id", IDENTIFIER);
  if (!document.grant_document || typeof document.grant_document !== "object" || Array.isArray(document.grant_document)) {
    fail(400, "GRANT_PROTOCOL_INVALID", "grant_document must be an object.");
  }
  requiredString(document.authority_sequence, "authority_sequence", POSITIVE_INTEGER);
  if (document.predecessor_snapshot_digest !== null) {
    requiredString(document.predecessor_snapshot_digest, "predecessor_snapshot_digest", DIGEST);
  }
  requiredString(document.target_state, "target_state", /^(active|revoked)$/);
  requiredString(document.grant_digest, "grant_digest", DIGEST);
  if (sha256Digest(document.grant_document) !== document.grant_digest) {
    fail(409, "GRANT_DOCUMENT_DIGEST_MISMATCH", "Grant document does not match its signed digest.");
  }
  requiredString(document.readiness_receipt_digest, "readiness_receipt_digest", DIGEST);
  timestamp(document.issued_at, "issued_at");
  timestamp(document.expires_at, "expires_at");
  if (Date.parse(document.expires_at) <= Date.parse(document.issued_at)) {
    fail(400, "GRANT_PROTOCOL_INVALID", "Grant snapshot expiry must follow issuance.");
  }
  return document;
}

function validateReceiptDocument(document) {
  exactKeys(document, [
    "application_receipt_id", "service_id", "installation_id", "environment_id", "grant_id",
    "snapshot_id", "snapshot_digest", "authority_sequence", "predecessor_snapshot_digest",
    "applied_state", "service_transaction_id", "service_transaction_position", "applied_at"
  ], "grant application receipt");
  for (const field of [
    "application_receipt_id", "installation_id", "environment_id", "grant_id", "snapshot_id",
    "service_transaction_id"
  ]) {
    requiredString(document[field], field, UUID);
  }
  requiredString(document.service_id, "service_id", IDENTIFIER);
  requiredString(document.snapshot_digest, "snapshot_digest", DIGEST);
  requiredString(document.authority_sequence, "authority_sequence", POSITIVE_INTEGER);
  if (document.predecessor_snapshot_digest !== null) {
    requiredString(document.predecessor_snapshot_digest, "predecessor_snapshot_digest", DIGEST);
  }
  requiredString(document.applied_state, "applied_state", /^(active|revoked)$/);
  requiredString(document.service_transaction_position, "service_transaction_position", POSITIVE_INTEGER);
  timestamp(document.applied_at, "applied_at");
  return document;
}

export function createSignedGrantActivationSnapshot(document, options) {
  return signDocument(SNAPSHOT_SCHEMA, SNAPSHOT_DOMAIN, validateSnapshotDocument(document), options);
}

export function verifySignedGrantActivationSnapshot(bytes, options) {
  const signed = parseSignedBytes(bytes, SNAPSHOT_SCHEMA, SNAPSHOT_DOMAIN, options,
    "GRANT_SNAPSHOT_SIGNATURE_INVALID");
  validateSnapshotDocument(signed.document);
  if (options.now && Date.parse(options.now) >= Date.parse(signed.document.expires_at)) {
    fail(409, "GRANT_SNAPSHOT_EXPIRED", "Grant activation snapshot has expired.");
  }
  return signed;
}

export function createSignedGrantApplicationReceipt(document, options) {
  return signDocument(RECEIPT_SCHEMA, RECEIPT_DOMAIN, validateReceiptDocument(document), options);
}

export function verifySignedGrantApplicationReceipt(bytes, options) {
  const signed = parseSignedBytes(bytes, RECEIPT_SCHEMA, RECEIPT_DOMAIN, options,
    "GRANT_APPLICATION_SIGNATURE_INVALID");
  validateReceiptDocument(signed.document);
  return signed;
}

export function validateGrantSnapshotTransition(current, document) {
  validateSnapshotDocument(document);
  const sequence = BigInt(document.authority_sequence);
  if (!current) {
    if (sequence !== 1n) fail(409, "GRANT_SNAPSHOT_OUT_OF_ORDER", "First grant snapshot sequence must be 1.");
    if (document.predecessor_snapshot_digest !== null) {
      fail(409, "GRANT_SNAPSHOT_PREDECESSOR_MISMATCH", "First grant snapshot cannot declare a predecessor.");
    }
    if (document.target_state !== "active") {
      fail(409, "GRANT_SNAPSHOT_STATE_INVALID", "First grant snapshot must activate an inactive grant.");
    }
    return { authority_sequence: "1", snapshot_digest_required: null, effective_state: "active" };
  }

  const currentSequence = BigInt(current.authority_sequence);
  if (sequence <= currentSequence) fail(409, "GRANT_SNAPSHOT_STALE", "Grant snapshot is stale.");
  if (sequence !== currentSequence + 1n) {
    fail(409, "GRANT_SNAPSHOT_OUT_OF_ORDER", "Grant snapshot skips an authority sequence.");
  }
  if (document.predecessor_snapshot_digest !== current.snapshot_digest) {
    fail(409, "GRANT_SNAPSHOT_PREDECESSOR_MISMATCH", "Grant snapshot predecessor does not match applied state.");
  }
  if (document.target_state === current.effective_state) {
    fail(409, "GRANT_SNAPSHOT_STATE_INVALID", "Grant snapshot must change effective state.");
  }
  return {
    authority_sequence: document.authority_sequence,
    snapshot_digest_required: current.snapshot_digest,
    effective_state: document.target_state
  };
}

export function validateGrantApplicationReceipt(snapshot, receipt, { receiverServiceId }) {
  const desired = snapshot.document;
  const applied = receipt.document;
  const exactBindings = [
    applied.service_id === receiverServiceId,
    applied.service_id === desired.receiver_service_id,
    applied.installation_id === desired.installation_id,
    applied.environment_id === desired.environment_id,
    applied.grant_id === desired.grant_id,
    applied.snapshot_id === desired.snapshot_id,
    applied.snapshot_digest === snapshot.digest,
    applied.authority_sequence === desired.authority_sequence,
    applied.predecessor_snapshot_digest === desired.predecessor_snapshot_digest,
    applied.applied_state === desired.target_state
  ];
  if (exactBindings.some((binding) => !binding)) {
    fail(409, "GRANT_APPLICATION_BINDING_MISMATCH", "Application receipt does not bind the exact desired grant state.");
  }
  if (Date.parse(applied.applied_at) < Date.parse(desired.issued_at)) {
    fail(409, "GRANT_APPLICATION_BINDING_MISMATCH", "Application receipt predates the desired grant state.");
  }
  return {
    effective_state: applied.applied_state === "active" ? "active_effective" : "revoked_effective",
    effective_at: applied.applied_at,
    service_transaction_id: applied.service_transaction_id,
    service_transaction_position: applied.service_transaction_position
  };
}

export const GRANT_AUTHORITY_PROTOCOL = Object.freeze({
  snapshot_schema: SNAPSHOT_SCHEMA,
  application_receipt_schema: RECEIPT_SCHEMA,
  signing_algorithm: "hmac-sha256",
  exclusive_authorship_proven: false
});
