import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const DELIVERY_FIELDS = new Set(["source_operation_id", "source_delivery_id", "occurred_at", "payload"]);
const MAPPING_FIELDS = new Set([
  "mapping_receipt_id", "source_binding_id", "source_identity_token", "logical_operation_id",
  "first_journal_sequence", "first_journal_record_digest", "mapping_service_id", "created_at"
]);

function fail(message, details = {}) {
  throw new KernelError(422, "INGRESS_DELIVERY_INVALID", message, details);
}

function boundedString(value, field, maximum = 200) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    fail(`${field} must be a bounded string.`);
  }
  return value;
}

export function validateIngressDelivery(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Ingress delivery must be an object.");
  const unknown = Object.keys(value).filter((field) => !DELIVERY_FIELDS.has(field));
  const missing = [...DELIVERY_FIELDS].filter((field) => !(field in value));
  if (unknown.length || missing.length) fail("Ingress delivery has unknown fields or missing fields.", { unknown, missing });
  boundedString(value.source_operation_id, "source_operation_id");
  boundedString(value.source_delivery_id, "source_delivery_id");
  boundedString(value.occurred_at, "occurred_at", 35);
  if (!Number.isFinite(Date.parse(value.occurred_at))) fail("occurred_at must be an instant.");
  if (!value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) {
    fail("payload must be an object.");
  }
  const payloadBytes = Buffer.from(canonicalize(value.payload), "utf8");
  if (payloadBytes.length > 256 * 1024) fail("payload exceeds the ingress limit.");
  return value;
}

function encryptionKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Ingress payload secret is required.");
  return createHash("sha256").update(secret).digest();
}

export function createEncryptedIngressPayload(payload, secret) {
  const plaintext = Buffer.from(canonicalize(payload), "utf8");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authentication_tag: cipher.getAuthTag().toString("base64"),
    payload_digest: sha256Digest(payload),
    plaintext_size: plaintext.length
  };
}

export function decryptIngressPayload(value, secret) {
  if (value?.algorithm !== "aes-256-gcm") throw new Error("Ingress payload encryption is unsupported.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(value.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(value.authentication_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()
  ]).toString("utf8");
  const payload = JSON.parse(plaintext);
  if (sha256Digest(payload) !== value.payload_digest) throw new Error("Ingress payload digest mismatch.");
  return payload;
}

export function ingressJournalRecordDigest(material) {
  return sha256Digest({ domain: "alphonse.customer_ingress.journal_record.v1", ...material });
}

export function createMappingReceipt(value, secret) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mapping receipt is required.");
  const unknown = Object.keys(value).filter((field) => !MAPPING_FIELDS.has(field));
  const missing = [...MAPPING_FIELDS].filter((field) => !(field in value));
  if (unknown.length || missing.length) throw new Error("Mapping receipt shape is invalid.");
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Mapping receipt secret is required.");
  const document = { schema_version: "0.1.0", ...value };
  const signature = createHmac("sha256", secret).update(canonicalize(document)).digest("hex");
  const wrapper = { document, authentication: {
    algorithm: "HMAC-SHA256", key_id: "customer-ingress-mapping-v1", signature
  } };
  return { signed_receipt_bytes: canonicalize(wrapper), receipt_digest: sha256Digest(wrapper), document };
}

export function projectIngressJournalHealth(value) {
  const capacity = Number(value.retention_capacity_bytes);
  const retained = Number(value.encrypted_payload_bytes);
  const utilization = capacity > 0 ? Math.min(retained / capacity, 1) : 1;
  return {
    unreported_count: Number(value.unreported_count),
    oldest_unreported_at: value.oldest_unreported_at ?? null,
    encrypted_payload_bytes: retained,
    retention_capacity_bytes: capacity,
    retention_utilization: Number(utilization.toFixed(4)),
    retention_pressure: utilization >= 0.9 ? "critical" : utilization >= 0.75 ? "warning" : "normal",
    durable_loss_marker_count: Number(value.durable_loss_marker_count),
    evidence_loss_declared: Number(value.durable_loss_marker_count) > 0,
    forward_retry_count: Number(value.forward_retry_count),
    report_retry_count: Number(value.report_retry_count),
    last_accepted_sequence: String(value.last_accepted_sequence ?? "0")
  };
}
