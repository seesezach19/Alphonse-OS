import { sha256Digest } from "./canonical-json.js";
import { publicKeyText, signDocument, verifyDocument } from "./portable-trust.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PACKAGE_IDENTITY = /^[a-z0-9][a-z0-9._-]*@[0-9A-Za-z.+-]+#sha256:[0-9a-f]{64}\+sha256:[0-9a-f]{64}$/;
const ENVIRONMENT_CLASSES = new Set(["development", "staging", "production"]);
const RECEIPT_TYPES = new Set(["package_validation", "compatibility", "discovered", "target_validation_failed",
  "deployment_plan_resolved", "deployed", "activated", "recovery_verified", "declined"]);
const GATE_TYPES = new Set(["package_validation", "compatibility", "deterministic_evaluation",
  "staging_deployed", "staging_activated", "staging_recovery", "technical_review"]);
const DIAGNOSTIC_SCOPES = new Set(["kernel_health", "runtime_health", "host_health", "storage_health",
  "coordination_health"]);
const SENSITIVE_KEY = /(^|_)(business_payload|prompt|credential_value|secret|password|private_key|access_token|evidence_body|actor_activity|active_capability|authority)($|_)/i;

export class CoordinationContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoordinationContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CoordinationContractError(code, message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_DOCUMENT", `${label} must be an object.`);
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("UNDECLARED_FIELD", `${label} fields must exactly match the coordination contract.`);
  }
  return value;
}

function string(value, label, maximum = 500) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    fail("INVALID_DOCUMENT", `${label} must be a bounded non-empty string.`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("INVALID_DIGEST", `${label} must be a SHA-256 digest.`);
  return value;
}

function uuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) fail("INVALID_IDENTIFIER", `${label} must be a UUID.`);
  return value;
}

function time(value, label) {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(parsed)) fail("INVALID_TIME", `${label} must be an ISO timestamp.`);
  return parsed;
}

function strings(value, label, maximum = 128) {
  if (!Array.isArray(value) || value.length > maximum || value.some((entry) => typeof entry !== "string" || !entry)) {
    fail("INVALID_DOCUMENT", `${label} must be a bounded string array.`);
  }
  if (new Set(value).size !== value.length) fail("DUPLICATE_VALUE", `${label} cannot contain duplicates.`);
  return value;
}

function digests(value, label) {
  strings(value, label);
  value.forEach((entry, index) => digest(entry, `${label}[${index}]`));
  return value;
}

function rejectSensitive(value, path = "document") {
  if (typeof value === "string") {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|ed25519-pkcs8:/i.test(value)) {
      fail("SECRET_MATERIAL_PROHIBITED", `${path} contains private key material.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitive(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) fail("SECRET_MATERIAL_PROHIBITED", `${path}.${key} is prohibited.`);
    rejectSensitive(child, `${path}.${key}`);
  }
}

function environmentClass(value, label) {
  if (!ENVIRONMENT_CLASSES.has(value)) fail("INVALID_ENVIRONMENT_CLASS", `${label} is unsupported.`);
  return value;
}

function orderedWindow(document) {
  const issuedAt = time(document.issued_at, "issued_at");
  const expiresAt = time(document.expires_at, "expires_at");
  if (expiresAt <= issuedAt) fail("INVALID_TIME_WINDOW", "Document expiry must follow issue time.");
}

function assertEnvelopeShape(envelope, label) {
  exact(envelope, ["document", "key_id", "signature"], label);
  object(envelope.document, `${label}.document`);
  string(envelope.key_id, `${label}.key_id`);
  string(envelope.signature, `${label}.signature`, 1000);
}

export function publicCoordinationKey(key) {
  return publicKeyText(key);
}

export function signCoordinationDocument(document, privateKey) {
  const publicKey = publicKeyText(privateKey);
  return { document, key_id: sha256Digest(publicKey), signature: signDocument(document, privateKey) };
}

export function verifyCoordinationEnvelope(envelope, publicKey, validator) {
  assertEnvelopeShape(envelope, "coordination envelope");
  const document = validator(envelope.document);
  if (envelope.key_id !== sha256Digest(publicKey) || !verifyDocument(document, envelope.signature, publicKey)) {
    fail("INVALID_COORDINATION_SIGNATURE", "Coordination document signature is invalid.");
  }
  return document;
}

export function assertRegistrationChallenge(value) {
  const document = exact(value, ["schema_version", "challenge_id", "challenge_nonce", "coordinator_id",
    "customer_id", "environment_id", "issued_at", "expires_at"], "Registration Challenge");
  if (document.schema_version !== "alphonse.registration_challenge.v0.1") fail("UNSUPPORTED_SCHEMA", "Registration Challenge schema is unsupported.");
  string(document.challenge_id, "challenge_id");
  string(document.challenge_nonce, "challenge_nonce");
  string(document.coordinator_id, "coordinator_id");
  string(document.customer_id, "customer_id");
  uuid(document.environment_id, "environment_id");
  orderedWindow(document);
  return document;
}

export function assertRegistrationRequest(value) {
  const document = exact(value, ["schema_version", "challenge_id", "challenge_nonce", "coordinator_id",
    "customer_id", "environment_descriptor", "issued_at", "expires_at"], "Registration Request");
  rejectSensitive(document);
  if (document.schema_version !== "alphonse.registration_request.v0.1") fail("UNSUPPORTED_SCHEMA", "Registration Request schema is unsupported.");
  string(document.challenge_id, "challenge_id");
  string(document.challenge_nonce, "challenge_nonce");
  string(document.coordinator_id, "coordinator_id");
  string(document.customer_id, "customer_id");
  assertEnvelopeShape(document.environment_descriptor, "environment_descriptor");
  assertEnvironmentDescriptor(document.environment_descriptor.document);
  orderedWindow(document);
  return document;
}

export function assertCoordinationPoll(value) {
  const document = exact(value, ["schema_version", "coordinator_id", "customer_id", "environment_id",
    "request_nonce", "issued_at", "expires_at"], "Coordination Poll");
  if (document.schema_version !== "alphonse.coordination_poll.v0.1") fail("UNSUPPORTED_SCHEMA", "Coordination Poll schema is unsupported.");
  string(document.coordinator_id, "coordinator_id");
  string(document.customer_id, "customer_id");
  uuid(document.environment_id, "environment_id");
  string(document.request_nonce, "request_nonce");
  orderedWindow(document);
  return document;
}

export function assertEnvironmentDescriptor(value) {
  const document = exact(value, ["schema_version", "coordinator_id", "installation_id", "environment_id",
    "display_label", "environment_class", "kernel_build", "protocol_version", "storage_schema_version",
    "signing_key_id", "signing_public_key", "execution_epoch", "package_identities", "deployment_digests",
    "adapter_contract_versions", "health", "issued_at", "expires_at"], "Environment Descriptor");
  rejectSensitive(document);
  if (document.schema_version !== "alphonse.environment_descriptor.v0.1") fail("UNSUPPORTED_SCHEMA", "Environment Descriptor schema is unsupported.");
  string(document.coordinator_id, "coordinator_id");
  uuid(document.installation_id, "installation_id");
  uuid(document.environment_id, "environment_id");
  string(document.display_label, "display_label", 120);
  environmentClass(document.environment_class, "environment_class");
  string(document.kernel_build, "kernel_build");
  string(document.protocol_version, "protocol_version");
  string(document.storage_schema_version, "storage_schema_version");
  string(document.signing_public_key, "signing_public_key", 1000);
  if (document.signing_key_id !== sha256Digest(document.signing_public_key)) fail("SIGNING_KEY_MISMATCH", "Descriptor signing key ID is invalid.");
  if (!/^[1-9][0-9]*$/.test(document.execution_epoch)) fail("INVALID_EXECUTION_EPOCH", "execution_epoch must be positive.");
  strings(document.package_identities, "package_identities").forEach((entry) => {
    if (!PACKAGE_IDENTITY.test(entry)) fail("INVALID_PACKAGE_IDENTITY", "Descriptor Package identity is invalid.");
  });
  digests(document.deployment_digests, "deployment_digests");
  strings(document.adapter_contract_versions, "adapter_contract_versions");
  const health = exact(document.health, ["status", "outbox_lag", "unresolved_obligations"], "health");
  if (!new Set(["healthy", "degraded", "blocked", "unknown"]).has(health.status)) fail("INVALID_HEALTH", "Health status is unsupported.");
  if (!Number.isSafeInteger(health.outbox_lag) || health.outbox_lag < 0
      || !Number.isSafeInteger(health.unresolved_obligations) || health.unresolved_obligations < 0) {
    fail("INVALID_HEALTH", "Health counters must be non-negative integers.");
  }
  orderedWindow(document);
  return document;
}

export function assertEnvironmentHealth(value) {
  const document = exact(value, ["schema_version", "coordinator_id", "customer_id", "environment_id",
    "binding_id", "status", "counters", "issued_at", "expires_at"], "Environment Health");
  rejectSensitive(document);
  if (document.schema_version !== "alphonse.environment_health.v0.1") fail("UNSUPPORTED_SCHEMA", "Environment Health schema is unsupported.");
  string(document.coordinator_id, "coordinator_id");
  string(document.customer_id, "customer_id");
  uuid(document.environment_id, "environment_id");
  uuid(document.binding_id, "binding_id");
  if (!new Set(["healthy", "degraded", "blocked"]).has(document.status)) fail("INVALID_HEALTH", "Health status is unsupported.");
  const counters = exact(document.counters, ["outbox_lag", "unresolved_obligations", "quarantined_hosts",
    "restore_suspended"], "counters");
  for (const key of ["outbox_lag", "unresolved_obligations", "quarantined_hosts"]) {
    if (!Number.isSafeInteger(counters[key]) || counters[key] < 0) fail("INVALID_HEALTH", `${key} must be non-negative.`);
  }
  if (typeof counters.restore_suspended !== "boolean") fail("INVALID_HEALTH", "restore_suspended must be boolean.");
  orderedWindow(document);
  return document;
}

export function assertSupportCaseRequest(value) {
  const document = exact(value, ["schema_version", "support_case_id", "coordinator_id", "customer_id",
    "environment_id", "support_identity", "diagnostic_scopes", "requested_duration_seconds", "reason",
    "issued_at", "expires_at"], "Support Case Request");
  rejectSensitive(document);
  if (document.schema_version !== "alphonse.support_case_request.v0.1") fail("UNSUPPORTED_SCHEMA", "Support Case Request schema is unsupported.");
  uuid(document.support_case_id, "support_case_id");
  string(document.coordinator_id, "coordinator_id");
  string(document.customer_id, "customer_id");
  uuid(document.environment_id, "environment_id");
  const identity = exact(document.support_identity, ["provider", "subject", "display_name"], "support_identity");
  string(identity.provider, "support_identity.provider", 100);
  string(identity.subject, "support_identity.subject", 200);
  string(identity.display_name, "support_identity.display_name", 120);
  strings(document.diagnostic_scopes, "diagnostic_scopes", 8).forEach((scope) => {
    if (!DIAGNOSTIC_SCOPES.has(scope)) fail("INVALID_DIAGNOSTIC_SCOPE", `Diagnostic scope ${scope} is unsupported.`);
  });
  if (!Number.isSafeInteger(document.requested_duration_seconds) || document.requested_duration_seconds < 60
      || document.requested_duration_seconds > 3600) fail("INVALID_SUPPORT_DURATION", "Support duration must be 60-3600 seconds.");
  string(document.reason, "reason", 1000);
  orderedWindow(document);
  return document;
}

export function assertSupportPassportNotice(value) {
  const document = exact(value, ["schema_version", "support_passport_id", "support_case_id", "customer_id",
    "environment_id", "support_identity", "diagnostic_scopes", "access_class", "issued_at", "expires_at"],
  "Support Passport Notice");
  rejectSensitive(document);
  if (document.schema_version !== "alphonse.support_passport_notice.v0.1") fail("UNSUPPORTED_SCHEMA", "Support Passport Notice schema is unsupported.");
  uuid(document.support_passport_id, "support_passport_id");
  uuid(document.support_case_id, "support_case_id");
  string(document.customer_id, "customer_id");
  uuid(document.environment_id, "environment_id");
  exact(document.support_identity, ["provider", "subject", "display_name"], "support_identity");
  strings(document.diagnostic_scopes, "diagnostic_scopes", 8).forEach((scope) => {
    if (!DIAGNOSTIC_SCOPES.has(scope)) fail("INVALID_DIAGNOSTIC_SCOPE", `Diagnostic scope ${scope} is unsupported.`);
  });
  if (document.access_class !== "diagnostics_read_only") fail("INVALID_SUPPORT_AUTHORITY", "Support Passport must be read-only.");
  orderedWindow(document);
  return document;
}

export function assertCoordinatorBindingRevocation(value) {
  const document = exact(value, ["schema_version", "revocation_id", "coordinator_id", "customer_id",
    "environment_id", "binding_id", "reason", "issued_at", "expires_at"], "Coordinator Binding Revocation");
  rejectSensitive(document);
  if (document.schema_version !== "alphonse.coordinator_binding_revocation.v0.1") fail("UNSUPPORTED_SCHEMA", "Binding Revocation schema is unsupported.");
  uuid(document.revocation_id, "revocation_id");
  string(document.coordinator_id, "coordinator_id");
  string(document.customer_id, "customer_id");
  uuid(document.environment_id, "environment_id");
  uuid(document.binding_id, "binding_id");
  string(document.reason, "reason", 1000);
  orderedWindow(document);
  return document;
}

function assertCompatibility(value) {
  const compatibility = exact(value, ["kernel_protocol", "storage_schema", "adapter_contracts", "result"], "compatibility");
  string(compatibility.kernel_protocol, "compatibility.kernel_protocol");
  string(compatibility.storage_schema, "compatibility.storage_schema");
  strings(compatibility.adapter_contracts, "compatibility.adapter_contracts");
  if (!new Set(["compatible", "incompatible"]).has(compatibility.result)) fail("INVALID_COMPATIBILITY", "Compatibility result is unsupported.");
}

function assertConfigurationSchema(value) {
  const schema = exact(value, ["required", "properties"], "required_configuration_schema");
  strings(schema.required, "required_configuration_schema.required", 64);
  object(schema.properties, "required_configuration_schema.properties");
  for (const [key, property] of Object.entries(schema.properties)) {
    if (SENSITIVE_KEY.test(key)) fail("SECRET_MATERIAL_PROHIBITED", `Configuration key ${key} is prohibited.`);
    exact(property, ["type"], `required_configuration_schema.properties.${key}`);
    if (!new Set(["string", "number", "integer", "boolean"]).has(property.type)) {
      fail("INVALID_CONFIGURATION_SCHEMA", `Configuration property ${key} has unsupported type.`);
    }
  }
  if (schema.required.some((key) => !Object.hasOwn(schema.properties, key))) {
    fail("INVALID_CONFIGURATION_SCHEMA", "Every required configuration key must have a property definition.");
  }
}

function assertGateReceipts(value) {
  if (!Array.isArray(value) || value.length > 64) fail("INVALID_GATE_RECEIPTS", "gate_receipts must be bounded.");
  const ids = new Set();
  for (const [index, receipt] of value.entries()) {
    exact(receipt, ["type", "receipt_id", "receipt_digest", "issuer_environment_id"], `gate_receipts[${index}]`);
    if (!GATE_TYPES.has(receipt.type)) fail("INVALID_GATE_RECEIPT", `Gate receipt type ${receipt.type} is unsupported.`);
    string(receipt.receipt_id, `gate_receipts[${index}].receipt_id`);
    digest(receipt.receipt_digest, `gate_receipts[${index}].receipt_digest`);
    uuid(receipt.issuer_environment_id, `gate_receipts[${index}].issuer_environment_id`);
    if (ids.has(receipt.receipt_id)) fail("DUPLICATE_GATE_RECEIPT", "Gate receipt IDs must be unique.");
    ids.add(receipt.receipt_id);
  }
}

export function assertPromotionProposal(value) {
  const document = exact(value, ["schema_version", "proposal_id", "customer_id", "source_environment_id",
    "target_environment_id", "source_class", "target_class", "package_identity", "manifest_digest",
    "package_artifact_digest", "dependency_lock", "source_receipt_digests", "compatibility", "change_summary",
    "required_configuration_schema", "gate_receipts", "issued_at", "expires_at"], "Promotion Proposal");
  rejectSensitive(document);
  if (document.schema_version !== "alphonse.promotion_proposal.v0.1") fail("UNSUPPORTED_SCHEMA", "Promotion Proposal schema is unsupported.");
  string(document.proposal_id, "proposal_id");
  string(document.customer_id, "customer_id");
  uuid(document.source_environment_id, "source_environment_id");
  uuid(document.target_environment_id, "target_environment_id");
  environmentClass(document.source_class, "source_class");
  environmentClass(document.target_class, "target_class");
  if (!PACKAGE_IDENTITY.test(document.package_identity)) fail("INVALID_PACKAGE_IDENTITY", "Promotion Package identity is invalid.");
  digest(document.manifest_digest, "manifest_digest");
  digest(document.package_artifact_digest, "package_artifact_digest");
  if (!document.package_identity.endsWith(`#${document.manifest_digest}+${document.package_artifact_digest}`)) {
    fail("PACKAGE_IDENTITY_MISMATCH", "Promotion digests do not match Package identity.");
  }
  if (!Array.isArray(document.dependency_lock) || document.dependency_lock.length > 128) fail("INVALID_DEPENDENCY_LOCK", "dependency_lock must be bounded.");
  document.dependency_lock.forEach((entry) => {
    if (typeof entry !== "string" || !PACKAGE_IDENTITY.test(entry)) fail("INVALID_DEPENDENCY_LOCK", "Dependency identity is invalid.");
  });
  digests(document.source_receipt_digests, "source_receipt_digests");
  assertCompatibility(document.compatibility);
  string(document.change_summary, "change_summary", 2000);
  assertConfigurationSchema(document.required_configuration_schema);
  assertGateReceipts(document.gate_receipts);
  orderedWindow(document);
  return document;
}

export function assertPromotionRequest(value) {
  const document = exact(value, ["schema_version", "request_id", "customer_id", "source_environment_id",
    "target_environment_id", "source_class", "target_class", "package_identity", "manifest_digest",
    "package_artifact_digest", "dependency_lock", "source_receipt_digests", "compatibility", "change_summary",
    "required_configuration_schema", "gate_receipts", "issued_at", "expires_at"], "Promotion Request");
  rejectSensitive(document);
  if (document.schema_version !== "alphonse.promotion_request.v0.1") fail("UNSUPPORTED_SCHEMA", "Promotion Request schema is unsupported.");
  if (!Array.isArray(document.gate_receipts) || document.gate_receipts.length > 64) {
    fail("INVALID_GATE_RECEIPTS", "Promotion Request gate receipts must be bounded signed envelopes.");
  }
  document.gate_receipts.forEach((envelope, index) => {
    assertEnvelopeShape(envelope, `gate_receipts[${index}]`);
    assertPromotionReceipt(envelope.document);
  });
  assertPromotionProposal({
    schema_version: "alphonse.promotion_proposal.v0.1",
    proposal_id: document.request_id,
    customer_id: document.customer_id,
    source_environment_id: document.source_environment_id,
    target_environment_id: document.target_environment_id,
    source_class: document.source_class,
    target_class: document.target_class,
    package_identity: document.package_identity,
    manifest_digest: document.manifest_digest,
    package_artifact_digest: document.package_artifact_digest,
    dependency_lock: document.dependency_lock,
    source_receipt_digests: document.source_receipt_digests,
    compatibility: document.compatibility,
    change_summary: document.change_summary,
    required_configuration_schema: document.required_configuration_schema,
    gate_receipts: document.gate_receipts.map(({ document: receipt }) => ({
      type: receipt.receipt_type === "recovery_verified" ? "staging_recovery"
        : receipt.receipt_type === "deployed" ? "staging_deployed"
          : receipt.receipt_type === "activated" ? "staging_activated" : receipt.receipt_type,
      receipt_id: receipt.receipt_id,
      receipt_digest: sha256Digest(receipt),
      issuer_environment_id: receipt.environment_id
    })),
    issued_at: document.issued_at,
    expires_at: document.expires_at
  });
  return document;
}

export function assertPromotionReceipt(value) {
  const document = exact(value, ["schema_version", "receipt_id", "proposal_id", "environment_id",
    "environment_class", "receipt_type", "package_identity", "subject_digest", "local_reference_digest",
    "outcome", "issued_at"], "Promotion Receipt");
  rejectSensitive(document);
  if (document.schema_version !== "alphonse.promotion_receipt.v0.1") fail("UNSUPPORTED_SCHEMA", "Promotion Receipt schema is unsupported.");
  string(document.receipt_id, "receipt_id");
  string(document.proposal_id, "proposal_id");
  uuid(document.environment_id, "environment_id");
  environmentClass(document.environment_class, "environment_class");
  if (!RECEIPT_TYPES.has(document.receipt_type)) fail("INVALID_RECEIPT_TYPE", "Promotion receipt type is unsupported.");
  if (!PACKAGE_IDENTITY.test(document.package_identity)) fail("INVALID_PACKAGE_IDENTITY", "Receipt Package identity is invalid.");
  digest(document.subject_digest, "subject_digest");
  digest(document.local_reference_digest, "local_reference_digest");
  if (!new Set(["succeeded", "failed", "declined"]).has(document.outcome)) fail("INVALID_RECEIPT_OUTCOME", "Receipt outcome is unsupported.");
  time(document.issued_at, "issued_at");
  return document;
}
