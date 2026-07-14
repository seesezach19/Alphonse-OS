import {
  createPrivateKey,
  createPublicKey,
  sign as createSignature,
  verify as verifySignature
} from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";

const RELEASE_SCHEMA = "alphonse.portable_package.v0.1";
const DELEGATION_SCHEMA = "alphonse.release_delegation.v0.1";
const RECEIPT_SCHEMA = "alphonse.publication_receipt.v0.1";
const POLICY_SCHEMA = "alphonse.trust_policy.v0.1";
const BUNDLE_SCHEMA = "alphonse.offline_bundle.v0.1";
const ADVISORY_SCHEMA = "alphonse.package_advisory.v0.1";
const ATTESTATION_SCHEMA = "alphonse.package_attestation.v0.1";
const ADVISORY_SNAPSHOT_SCHEMA = "alphonse.advisory_snapshot.v0.1";

export class PortableTrustError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PortableTrustError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new PortableTrustError(code, message, details);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_DOCUMENT", `${label} must be an object.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    fail("INVALID_DOCUMENT", `${label} must be an array.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail("INVALID_DOCUMENT", `${label} must be a non-empty string.`);
  }
  return value;
}

function requireExactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    fail("UNKNOWN_FIELD", `${label} contains unsupported fields.`, { fields: unexpected.sort() });
  }
}

function rejectPrivateMaterial(value, path = "release") {
  if (typeof value === "string") {
    if (/PRIVATE KEY|ed25519-pkcs8:|MC4CAQAwBQYDK2VwBCIEI/i.test(value)) {
      fail("PRIVATE_KEY_PROHIBITED", `${path} contains private key material.`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (/private[_-]?key|secret(?:$|[_-])|credential[_-]?value|access[_-]?token/i.test(key)) {
      fail("PRIVATE_KEY_PROHIBITED", `${path}.${key} is prohibited secret material.`);
    }
    rejectPrivateMaterial(nested, `${path}.${key}`);
  }
}

export function validateAdvisoryShape(advisory) {
  requireObject(advisory, "advisory");
  rejectPrivateMaterial(advisory, "advisory");
  requireExactKeys(advisory, ["document", "signature"], "advisory");
  const document = requireObject(advisory.document, "advisory.document");
  requireExactKeys(document, ["schema_version", "advisory_id", "publisher_id", "package_id",
    "manifest_digest", "package_artifact_digest", "severity", "evidence", "remediation",
    "release_key_id", "compromise_effective_at", "superseding_safe_version", "issued_at", "expires_at"],
  "advisory.document");
  if (document.schema_version !== ADVISORY_SCHEMA) {
    fail("UNSUPPORTED_ADVISORY", "Unsupported Package advisory schema.");
  }
  for (const field of ["advisory_id", "publisher_id", "package_id", "manifest_digest",
    "package_artifact_digest", "severity", "evidence", "remediation", "issued_at", "expires_at"]) {
    requireString(document[field], `advisory.${field}`);
  }
  if (document.release_key_id !== undefined) {
    requireString(document.release_key_id, "advisory.release_key_id");
    parseTime(document.compromise_effective_at, "advisory.compromise_effective_at");
    if (document.severity !== "critical") {
      fail("INVALID_KEY_REVOCATION", "Release-key revocation advisory must be critical.");
    }
  }
  return document;
}

function parseTime(value, label) {
  const milliseconds = Date.parse(requireString(value, label));
  if (!Number.isFinite(milliseconds)) {
    fail("INVALID_DOCUMENT", `${label} must be a valid timestamp.`);
  }
  return milliseconds;
}

function publicKeyObject(value) {
  if (typeof value !== "string" || !value.startsWith("ed25519-spki:")) {
    fail("INVALID_PUBLIC_KEY", "Ed25519 public key must use ed25519-spki encoding.");
  }
  try {
    return createPublicKey({
      key: Buffer.from(value.slice("ed25519-spki:".length), "base64"),
      format: "der",
      type: "spki"
    });
  } catch {
    fail("INVALID_PUBLIC_KEY", "Ed25519 public key could not be decoded.");
  }
}

function privateKeyObject(value) {
  if (typeof value !== "string") {
    return value;
  }
  if (!value.startsWith("ed25519-pkcs8:")) {
    fail("INVALID_PRIVATE_KEY", "Ed25519 private key must use ed25519-pkcs8 encoding.");
  }
  try {
    return createPrivateKey({
      key: Buffer.from(value.slice("ed25519-pkcs8:".length), "base64"),
      format: "der",
      type: "pkcs8"
    });
  } catch {
    fail("INVALID_PRIVATE_KEY", "Ed25519 private key could not be decoded.");
  }
}

export function publicKeyText(key) {
  const publicKey = typeof key === "string"
    ? key.startsWith("ed25519-pkcs8:") ? createPublicKey(privateKeyObject(key)) : publicKeyObject(key)
    : key.type === "public" ? key : createPublicKey(key);
  return `ed25519-spki:${publicKey.export({ format: "der", type: "spki" }).toString("base64")}`;
}

export function privateKeyText(key) {
  const privateKey = privateKeyObject(key);
  return `ed25519-pkcs8:${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")}`;
}

export function signDocument(document, privateKey) {
  const signature = createSignature(null, Buffer.from(canonicalize(document)), privateKeyObject(privateKey));
  return `ed25519:${signature.toString("base64")}`;
}

export function verifyDocument(document, signature, publicKey) {
  if (typeof signature !== "string" || !signature.startsWith("ed25519:")) {
    return false;
  }
  try {
    return verifySignature(
      null,
      Buffer.from(canonicalize(document)),
      publicKeyObject(publicKey),
      Buffer.from(signature.slice("ed25519:".length), "base64")
    );
  } catch {
    return false;
  }
}

function packageWithinDelegation(packageId, delegation) {
  const inNamespace = packageId === delegation.namespace_scope
    || packageId.startsWith(`${delegation.namespace_scope}.`);
  if (!inNamespace) return false;
  if (delegation.package_scope === "*") return true;
  if (Array.isArray(delegation.package_scope)) return delegation.package_scope.includes(packageId);
  return delegation.package_scope === packageId;
}

function artifactPayloads(release) {
  const payloads = new Map();
  for (const artifact of requireArray(release.artifacts, "release.artifacts")) {
    requireObject(artifact, "release artifact");
    requireExactKeys(artifact, ["name", "content_base64"], "release artifact");
    const name = requireString(artifact.name, "release artifact name");
    if (payloads.has(name)) fail("DUPLICATE_ARTIFACT", `Artifact ${name} is duplicated.`);
    if (typeof artifact.content_base64 !== "string") {
      fail("INVALID_ARTIFACT", `Artifact ${name} is missing base64 content.`);
    }
    payloads.set(name, Buffer.from(artifact.content_base64, "base64"));
  }
  return payloads;
}

export function verifyRelease(release, {
  now = new Date().toISOString(),
  requireCurrentDelegation = false
} = {}) {
  requireObject(release, "release");
  rejectPrivateMaterial(release);
  requireExactKeys(release, ["publisher", "delegation", "manifest", "artifacts", "attestations",
    "release_signature"], "release");
  const publisher = requireObject(release.publisher, "publisher");
  const delegation = requireObject(release.delegation, "delegation");
  const delegationDocument = requireObject(delegation.document, "delegation.document");
  const manifest = requireObject(release.manifest, "manifest");
  requireExactKeys(publisher, ["publisher_id", "root_key_id", "root_public_key"], "publisher");
  requireExactKeys(delegation, ["document", "root_signature"], "delegation");
  requireExactKeys(delegationDocument, ["schema_version", "delegation_id", "publisher_id", "namespace_scope",
    "package_scope", "release_key_id", "release_public_key", "actions", "issued_at", "expires_at"],
  "delegation.document");
  requireExactKeys(manifest, ["schema_version", "package_id", "semantic_version", "publisher_id",
    "release_key_id", "package_artifact_digest", "artifacts", "dependencies", "exports", "compatibility",
    "license", "risk_profile", "issued_at"], "manifest");

  if (delegationDocument.schema_version !== DELEGATION_SCHEMA) {
    fail("UNSUPPORTED_DELEGATION", "Unsupported release delegation schema.");
  }
  if (manifest.schema_version !== RELEASE_SCHEMA) {
    fail("UNSUPPORTED_PACKAGE", "Unsupported portable Package schema.");
  }
  requireString(publisher.publisher_id, "publisher.publisher_id");
  requireString(publisher.root_public_key, "publisher.root_public_key");
  if (publisher.root_key_id !== sha256Digest(publisher.root_public_key)) {
    fail("ROOT_KEY_ID_MISMATCH", "Publisher root key ID does not match its public key.");
  }
  if (!verifyDocument(delegationDocument, delegation.root_signature, publisher.root_public_key)) {
    fail("INVALID_DELEGATION_SIGNATURE", "Release delegation signature is invalid.");
  }
  if (delegationDocument.publisher_id !== publisher.publisher_id
      || manifest.publisher_id !== publisher.publisher_id) {
    fail("PUBLISHER_MISMATCH", "Publisher identity is inconsistent across the release.");
  }
  if (delegationDocument.release_key_id !== sha256Digest(delegationDocument.release_public_key)
      || manifest.release_key_id !== delegationDocument.release_key_id) {
    fail("RELEASE_KEY_MISMATCH", "Delegated release key identity is inconsistent.");
  }
  if (!requireArray(delegationDocument.actions, "delegation.actions").includes("publish")) {
    fail("DELEGATION_ACTION_DENIED", "Release key is not delegated to publish.");
  }
  const at = parseTime(now, "verification time");
  const delegatedAt = parseTime(delegationDocument.issued_at, "delegation.issued_at");
  const delegatedUntil = parseTime(delegationDocument.expires_at, "delegation.expires_at");
  const releasedAt = parseTime(manifest.issued_at, "manifest.issued_at");
  if (releasedAt < delegatedAt || releasedAt >= delegatedUntil || releasedAt > at) {
    fail("DELEGATION_EXPIRED", "Package was not issued during the delegated release-key window.");
  }
  if (requireCurrentDelegation && (at < delegatedAt || at >= delegatedUntil)) {
    fail("DELEGATION_EXPIRED", "Release delegation is not valid for new publication.");
  }
  const packageId = requireString(manifest.package_id, "manifest.package_id");
  if (!packageWithinDelegation(packageId, delegationDocument)) {
    fail("PACKAGE_SCOPE_DENIED", "Package is outside the delegated namespace or package scope.");
  }
  if (!verifyDocument(manifest, release.release_signature, delegationDocument.release_public_key)) {
    fail("INVALID_RELEASE_SIGNATURE", "Package manifest release signature is invalid.");
  }

  const descriptors = requireArray(manifest.artifacts, "manifest.artifacts");
  const payloads = artifactPayloads(release);
  if (descriptors.length === 0 || payloads.size !== descriptors.length) {
    fail("INCOMPLETE_ARTIFACT_SET", "Release artifact set is incomplete.");
  }
  const descriptorNames = new Set();
  const riskClasses = new Set();
  for (const descriptor of descriptors) {
    requireObject(descriptor, "artifact descriptor");
    requireExactKeys(descriptor, ["name", "digest", "size", "media_type", "risk_class"],
      "artifact descriptor");
    const name = requireString(descriptor.name, "artifact descriptor name");
    if (descriptorNames.has(name)) fail("DUPLICATE_ARTIFACT", `Artifact descriptor ${name} is duplicated.`);
    descriptorNames.add(name);
    if (!payloads.has(name)) fail("MISSING_ARTIFACT", `Artifact ${name} is missing.`);
    const bytes = payloads.get(name);
    if (/PRIVATE KEY|ed25519-pkcs8:/i.test(bytes.toString("utf8"))) {
      fail("PRIVATE_KEY_PROHIBITED", `Artifact ${name} contains private key material.`);
    }
    if (descriptor.digest !== sha256Digest(bytes)) {
      fail("ARTIFACT_DIGEST_MISMATCH", `Artifact ${name} digest does not match its bytes.`);
    }
    if (descriptor.size !== bytes.length) fail("ARTIFACT_SIZE_MISMATCH", `Artifact ${name} size does not match.`);
    riskClasses.add(requireString(descriptor.risk_class, `artifact ${name} risk_class`));
  }
  const packageArtifact = descriptors.find((entry) => entry.name === "package.json");
  if (!packageArtifact || packageArtifact.digest !== manifest.package_artifact_digest) {
    fail("PACKAGE_DIGEST_MISMATCH", "Package artifact digest is not bound to package.json.");
  }
  for (const dependency of requireArray(manifest.dependencies, "manifest.dependencies")) {
    requireObject(dependency, "dependency");
    requireExactKeys(dependency, ["package_id", "semantic_version", "manifest_digest",
      "package_artifact_digest"], "dependency");
    exactReference(dependency);
  }
  for (const exported of requireArray(manifest.exports, "manifest.exports")) {
    requireObject(exported, "export descriptor");
    requireExactKeys(exported, ["kind", "export_id", "contract_version"], "export descriptor");
    requireString(exported.kind, "export kind");
    requireString(exported.export_id, "export_id");
    requireString(exported.contract_version, "export contract_version");
  }
  const compatibility = requireObject(manifest.compatibility, "manifest.compatibility");
  requireExactKeys(compatibility, ["kernel_api"], "manifest.compatibility");
  requireString(compatibility.kernel_api, "manifest.compatibility.kernel_api");
  requireString(manifest.license, "manifest.license");
  const riskProfile = requireObject(manifest.risk_profile, "manifest.risk_profile");
  requireExactKeys(riskProfile, ["effect_class", "context_class", "credential_class", "network_class"],
    "manifest.risk_profile");
  for (const field of ["effect_class", "context_class", "credential_class", "network_class"]) {
    requireString(riskProfile[field], `manifest.risk_profile.${field}`);
  }
  requireArray(release.attestations, "release.attestations");

  return {
    package_id: packageId,
    semantic_version: requireString(manifest.semantic_version, "manifest.semantic_version"),
    package_artifact_digest: requireString(manifest.package_artifact_digest, "manifest.package_artifact_digest"),
    package_identity: packageIdentity(manifest),
    manifest_digest: sha256Digest(manifest),
    release_digest: sha256Digest(release),
    publisher_id: publisher.publisher_id,
    publisher_root_key_id: publisher.root_key_id,
    risk_classes: [...riskClasses].sort(),
    dependencies: manifest.dependencies,
    artifact_descriptors: descriptors,
    attestation_digests: release.attestations.map((entry) => sha256Digest(entry))
  };
}

export function packageIdentity(manifest) {
  return `${manifest.package_id}@${manifest.semantic_version}#${sha256Digest(manifest)}+${manifest.package_artifact_digest}`;
}

function verifyPublisherPin(release, policy) {
  const pin = requireArray(policy.pinned_publishers, "policy.pinned_publishers")
    .find((entry) => entry.publisher_id === release.publisher.publisher_id);
  if (!pin || pin.root_public_key !== release.publisher.root_public_key) {
    fail("PUBLISHER_NOT_PINNED", `Publisher ${release.publisher.publisher_id} is not pinned by local policy.`);
  }
  const packageId = release.manifest.package_id;
  if (!requireArray(pin.namespaces, "publisher pin namespaces")
    .some((namespace) => packageId === namespace || packageId.startsWith(`${namespace}.`))) {
    fail("PUBLISHER_NAMESPACE_DENIED", `Publisher is not pinned for ${packageId}.`);
  }
  return pin;
}

function verifyCustodyReceipt(node, verified, policy) {
  const trusted = [];
  for (const receipt of requireArray(node.custody_receipts, "custody_receipts")) {
    const document = requireObject(receipt.document, "publication receipt document");
    if (document.schema_version !== RECEIPT_SCHEMA) continue;
    const registry = requireArray(policy.allowed_registries, "policy.allowed_registries")
      .find((entry) => entry.registry_id === document.registry_id);
    if (!registry || receipt.registry_key_id !== sha256Digest(registry.public_key)) continue;
    if (!verifyDocument(document, receipt.registry_signature, registry.public_key)) continue;
    const release = node.release;
    const checkpoint = requireObject(document.transparency_checkpoint, "transparency checkpoint");
    const exact = document.package_id === verified.package_id
      && document.semantic_version === verified.semantic_version
      && document.package_artifact_digest === verified.package_artifact_digest
      && document.manifest_digest === verified.manifest_digest
      && document.release_digest === verified.release_digest
      && document.publisher_proof_digest === sha256Digest({
        publisher: release.publisher,
        delegation: release.delegation
      })
      && canonicalize(document.artifact_descriptors) === canonicalize(verified.artifact_descriptors)
      && canonicalize(document.attestation_digests) === canonicalize(verified.attestation_digests)
      && checkpoint.registry_id === document.registry_id
      && Number.isSafeInteger(checkpoint.sequence)
      && checkpoint.sequence > 0
      && typeof checkpoint.root_hash === "string";
    if (exact) trusted.push({ receipt, document, digest: sha256Digest(receipt) });
  }
  const timely = trusted.filter(({ document }) => {
    if ((document.custody_mode ?? "publication") !== "publication") return false;
    const publishedAt = parseTime(document.published_at, "receipt.published_at");
    return publishedAt >= parseTime(node.release.delegation.document.issued_at, "delegation.issued_at")
      && publishedAt < parseTime(node.release.delegation.document.expires_at, "delegation.expires_at")
      && publishedAt >= parseTime(node.release.manifest.issued_at, "manifest.issued_at");
  });
  if (timely.length > 0) return timely[0].document.registry_id;
  const mirrored = trusted.find(({ document }) => document.custody_mode === "mirror"
    && requireArray(document.source_receipt_digests, "source_receipt_digests")
      .length > 0);
  if (mirrored) return mirrored.document.registry_id;
  fail("NO_TRUSTED_CUSTODY_RECEIPT", `No trusted exact custody receipt exists for ${verified.package_identity}.`);
}

function verifyAttestations(node, verified, policy, at) {
  const trustedAttesters = requireArray(policy.trusted_attesters, "policy.trusted_attesters");
  const artifactDigests = new Set(verified.artifact_descriptors.map((entry) => entry.digest));
  const attestations = [];
  for (const attestation of node.release.attestations) {
    requireObject(attestation, "attestation");
    requireExactKeys(attestation, ["document", "issuer_key_id", "signature"], "attestation");
    const document = requireObject(attestation.document, "attestation.document");
    requireExactKeys(document, ["schema_version", "attestation_id", "issuer_id", "type", "subject_digest",
      "predicate_schema", "result", "evidence_digest", "issued_at", "expires_at"], "attestation.document");
    if (document.schema_version !== ATTESTATION_SCHEMA) {
      fail("UNSUPPORTED_ATTESTATION", "Unsupported Package attestation schema.");
    }
    const issuer = trustedAttesters.find((entry) => entry.issuer_id === document.issuer_id);
    if (!issuer || !requireArray(issuer.allowed_types, "trusted attester allowed_types").includes(document.type)) {
      fail("ATTESTER_NOT_TRUSTED", `Attester ${document.issuer_id} is not trusted for ${document.type}.`);
    }
    if (attestation.issuer_key_id !== sha256Digest(issuer.public_key)
        || !verifyDocument(document, attestation.signature, issuer.public_key)) {
      fail("INVALID_ATTESTATION_SIGNATURE", `Attestation ${document.attestation_id} signature is invalid.`);
    }
    if (!artifactDigests.has(document.subject_digest)) {
      fail("ATTESTATION_SUBJECT_MISMATCH", `Attestation ${document.attestation_id} does not bind an artifact.`);
    }
    requireString(document.predicate_schema, "attestation predicate_schema");
    requireObject(document.result, "attestation result");
    requireString(document.evidence_digest, "attestation evidence_digest");
    if (at < parseTime(document.issued_at, "attestation.issued_at")
        || at >= parseTime(document.expires_at, "attestation.expires_at")) {
      fail("ATTESTATION_EXPIRED", `Attestation ${document.attestation_id} is not current.`);
    }
    attestations.push({ ...document, attestation_digest: sha256Digest(attestation) });
  }
  return attestations;
}

function verifyAdvisorySnapshot(bundle, nodesByIdentity, policy, at) {
  const snapshot = requireObject(bundle.advisory_snapshot, "bundle.advisory_snapshot");
  const document = requireObject(snapshot.document, "advisory snapshot document");
  if (document.schema_version !== ADVISORY_SNAPSHOT_SCHEMA) {
    fail("UNSUPPORTED_ADVISORY_SNAPSHOT", "Unsupported advisory snapshot schema.");
  }
  const registry = requireArray(policy.allowed_registries, "policy.allowed_registries")
    .find((entry) => entry.registry_id === document.registry_id);
  if (!registry || snapshot.registry_key_id !== sha256Digest(registry.public_key)
      || !verifyDocument(document, snapshot.registry_signature, registry.public_key)) {
    fail("INVALID_ADVISORY_SNAPSHOT_SIGNATURE", "Advisory snapshot signature is invalid or untrusted.");
  }
  const identities = [...nodesByIdentity.keys()].sort();
  const advisoryDigests = bundle.advisories.map((entry) => sha256Digest(entry)).sort();
  if (canonicalize(document.package_identities) !== canonicalize(identities)
      || canonicalize(document.advisory_digests) !== canonicalize(advisoryDigests)) {
    fail("ADVISORY_SNAPSHOT_MISMATCH", "Advisory snapshot does not bind the exact bundle scope.");
  }
  const generatedAt = parseTime(document.generated_at, "advisory_snapshot.generated_at");
  const expiresAt = parseTime(document.expires_at, "advisory_snapshot.expires_at");
  const checkpoint = requireObject(document.transparency_checkpoint, "advisory snapshot checkpoint");
  if (checkpoint.registry_id !== document.registry_id || !Number.isSafeInteger(checkpoint.sequence)
      || checkpoint.sequence < 1 || typeof checkpoint.root_hash !== "string"
      || generatedAt < parseTime(checkpoint.issued_at, "advisory snapshot checkpoint issued_at")) {
    fail("ADVISORY_SNAPSHOT_CHECKPOINT_INVALID", "Advisory snapshot checkpoint is invalid.");
  }
  const maximumAge = policy.max_advisory_snapshot_age_seconds;
  if (!Number.isSafeInteger(maximumAge) || maximumAge < 1) {
    fail("INVALID_TRUST_POLICY", "Trust Policy must bound advisory snapshot age.");
  }
  return {
    snapshot_digest: sha256Digest(snapshot),
    stale: generatedAt > at || expiresAt <= at || at - generatedAt > maximumAge * 1000,
    generated_at: document.generated_at,
    expires_at: document.expires_at,
    transparency_checkpoint: checkpoint
  };
}

function exactReference(reference) {
  requireObject(reference, "dependency reference");
  return `${requireString(reference.package_id, "dependency package_id")}@${requireString(
    reference.semantic_version,
    "dependency semantic_version"
  )}#${requireString(reference.manifest_digest, "dependency manifest_digest")}+${requireString(
    reference.package_artifact_digest,
    "dependency package_artifact_digest"
  )}`;
}

function verifyAdvisories(advisories, nodesByIdentity, policy, at) {
  const responses = [];
  for (const advisory of requireArray(advisories, "bundle.advisories")) {
    const document = validateAdvisoryShape(advisory);
    const target = [...nodesByIdentity.values()].find(({ release }) => document.release_key_id
      ? release.publisher.publisher_id === document.publisher_id
        && release.manifest.release_key_id === document.release_key_id
      : release.manifest.package_id === document.package_id
        && sha256Digest(release.manifest) === document.manifest_digest
        && release.manifest.package_artifact_digest === document.package_artifact_digest);
    if (!target || target.release.publisher.publisher_id !== document.publisher_id) {
      fail("ADVISORY_SCOPE_MISMATCH", `Advisory ${document.advisory_id} does not bind a Package in the bundle.`);
    }
    const pin = verifyPublisherPin(target.release, policy);
    if (!verifyDocument(document, advisory.signature, pin.root_public_key)) {
      fail("INVALID_ADVISORY_SIGNATURE", `Advisory ${document.advisory_id} signature is invalid.`);
    }
    if (at < parseTime(document.issued_at, "advisory.issued_at")
        || at >= parseTime(document.expires_at, "advisory.expires_at")) {
      fail("ADVISORY_EXPIRED", `Advisory ${document.advisory_id} is not valid at verification time.`);
    }
    if (document.release_key_id !== undefined
        && at < parseTime(document.compromise_effective_at, "advisory.compromise_effective_at")) {
      continue;
    }
    const response = policy.advisory_responses?.[document.severity];
    if (!response) fail("ADVISORY_POLICY_MISSING", `No local response exists for ${document.severity} advisories.`);
    responses.push({ advisory_id: document.advisory_id,
      kind: document.release_key_id ? "release_key_revocation" : "package_advisory",
      severity: document.severity, response });
  }
  return responses.sort((left, right) => left.advisory_id.localeCompare(right.advisory_id));
}

export function verifyImportBundle(bundle, policy, {
  now = new Date().toISOString(),
  transport = "registry"
} = {}) {
  requireObject(bundle, "bundle");
  requireObject(policy, "trust policy");
  if (bundle.schema_version !== BUNDLE_SCHEMA) fail("UNSUPPORTED_BUNDLE", "Unsupported offline bundle schema.");
  if (policy.schema_version !== POLICY_SCHEMA) fail("UNSUPPORTED_TRUST_POLICY", "Unsupported Trust Policy schema.");
  requireString(policy.policy_id, "policy.policy_id");
  if (!Number.isSafeInteger(policy.version) || policy.version < 1) {
    fail("INVALID_TRUST_POLICY", "Trust Policy version must be a positive integer.");
  }
  requireObject(policy.advisory_responses, "policy.advisory_responses");
  for (const [severity, response] of Object.entries(policy.advisory_responses)) {
    if (!["low", "moderate", "high", "critical"].includes(severity)
        || !["notify_only", "block_new_import"].includes(response)) {
      fail("INVALID_TRUST_POLICY", "Trust Policy advisory response is unsupported.");
    }
  }

  const rootNode = requireObject(bundle.root, "bundle.root");
  const suppliedNodes = [rootNode, ...requireArray(bundle.dependencies, "bundle.dependencies")];
  const nodesByIdentity = new Map();
  const verifiedByIdentity = new Map();
  const attestationsByIdentity = new Map();
  const at = parseTime(now, "verification time");
  for (const node of suppliedNodes) {
    requireObject(node, "bundle node");
    const verified = verifyRelease(node.release, { now });
    if (nodesByIdentity.has(verified.package_identity)) {
      fail("DUPLICATE_PACKAGE", `Bundle repeats ${verified.package_identity}.`);
    }
    verifyPublisherPin(node.release, policy);
    verifyCustodyReceipt(node, verified, policy);
    const attestations = verifyAttestations(node, verified, policy, at);
    nodesByIdentity.set(verified.package_identity, node);
    verifiedByIdentity.set(verified.package_identity, verified);
    attestationsByIdentity.set(verified.package_identity, attestations);
  }

  const rootIdentity = packageIdentity(rootNode.release.manifest);
  const reachable = new Set();
  const visiting = new Set();
  function walk(identity) {
    if (visiting.has(identity)) fail("DEPENDENCY_CYCLE", `Dependency cycle includes ${identity}.`);
    if (reachable.has(identity)) return;
    const node = nodesByIdentity.get(identity);
    if (!node) fail("MISSING_DEPENDENCY", `Exact dependency ${identity} is missing from the bundle.`);
    visiting.add(identity);
    for (const dependency of node.release.manifest.dependencies) walk(exactReference(dependency));
    visiting.delete(identity);
    reachable.add(identity);
  }
  walk(rootIdentity);
  if (reachable.size !== nodesByIdentity.size) {
    fail("EXTRANEOUS_DEPENDENCY", "Bundle contains Package nodes outside the root dependency closure.");
  }

  const decisions = [];
  const totalDependencyCount = reachable.size - 1;
  if (!Number.isSafeInteger(policy.maximum_dependency_count) || policy.maximum_dependency_count < 0) {
    fail("INVALID_TRUST_POLICY", "Trust Policy must bound dependency count.");
  }
  if (totalDependencyCount > policy.maximum_dependency_count) {
    decisions.push({ code: "DEPENDENCY_COUNT_DENIED", dependency_count: totalDependencyCount,
      maximum_dependency_count: policy.maximum_dependency_count });
  }
  const allowedRiskClasses = new Set(requireArray(policy.allowed_risk_classes, "policy.allowed_risk_classes"));
  const riskAttestationType = requireString(policy.risk_classification_attestation_type,
    "policy.risk_classification_attestation_type");
  const requiredAttestations = new Set(requireArray(
    policy.required_attestation_types,
    "policy.required_attestation_types"
  ));
  const allowedExportKinds = new Set(requireArray(policy.allowed_export_kinds, "policy.allowed_export_kinds"));
  const allowedLicenses = new Set(requireArray(policy.allowed_licenses, "policy.allowed_licenses"));
  const allowedCompatibility = new Set(requireArray(
    policy.allowed_kernel_api_compatibility,
    "policy.allowed_kernel_api_compatibility"
  ));
  const allowedEffectClasses = new Set(requireArray(policy.allowed_effect_classes, "policy.allowed_effect_classes"));
  const allowedContextClasses = new Set(requireArray(policy.allowed_context_classes, "policy.allowed_context_classes"));
  const allowedCredentialClasses = new Set(requireArray(
    policy.allowed_credential_classes,
    "policy.allowed_credential_classes"
  ));
  const allowedNetworkClasses = new Set(requireArray(policy.allowed_network_classes, "policy.allowed_network_classes"));
  for (const identity of [...reachable].sort()) {
    const verified = verifiedByIdentity.get(identity);
    const attestations = attestationsByIdentity.get(identity);
    const manifest = nodesByIdentity.get(identity).release.manifest;
    for (const exported of manifest.exports) {
      if (!allowedExportKinds.has(exported.kind)) {
        decisions.push({ code: "EXPORT_KIND_DENIED", package_identity: identity, export_kind: exported.kind });
      }
    }
    if (!allowedLicenses.has(manifest.license)) {
      decisions.push({ code: "LICENSE_DENIED", package_identity: identity, license: manifest.license });
    }
    if (!allowedCompatibility.has(manifest.compatibility?.kernel_api)) {
      decisions.push({ code: "KERNEL_COMPATIBILITY_DENIED", package_identity: identity,
        kernel_api: manifest.compatibility?.kernel_api });
    }
    const riskProfile = requireObject(manifest.risk_profile, "manifest.risk_profile");
    const profileChecks = [
      ["effect_class", allowedEffectClasses, "EFFECT_CLASS_DENIED"],
      ["context_class", allowedContextClasses, "CONTEXT_CLASS_DENIED"],
      ["credential_class", allowedCredentialClasses, "CREDENTIAL_CLASS_DENIED"],
      ["network_class", allowedNetworkClasses, "NETWORK_CLASS_DENIED"]
    ];
    for (const [field, allowed, code] of profileChecks) {
      if (!allowed.has(riskProfile[field])) {
        decisions.push({ code, package_identity: identity, [field]: riskProfile[field] });
      }
    }
    for (const descriptor of verified.artifact_descriptors) {
      const classification = attestations.find((entry) => entry.type === riskAttestationType
        && entry.subject_digest === descriptor.digest);
      if (!classification || typeof classification.result.risk_class !== "string") {
        decisions.push({ code: "RISK_CLASSIFICATION_MISSING", package_identity: identity,
          artifact_digest: descriptor.digest });
        continue;
      }
      const riskClass = classification.result.risk_class;
      if (canonicalize(classification.result.package_risk_profile) !== canonicalize(riskProfile)) {
        decisions.push({ code: "RISK_PROFILE_ATTESTATION_MISMATCH", package_identity: identity,
          artifact_digest: descriptor.digest });
      }
      if (descriptor.risk_class !== riskClass) {
        decisions.push({ code: "DECLARED_RISK_MISMATCH", package_identity: identity,
          artifact_digest: descriptor.digest, declared_risk_class: descriptor.risk_class,
          attested_risk_class: riskClass });
      }
      if (!allowedRiskClasses.has(riskClass)) {
        decisions.push({ code: "RISK_CLASS_DENIED", package_identity: identity, risk_class: riskClass });
      }
    }
    const attestationTypes = new Set(attestations.map((entry) => entry.type));
    for (const required of requiredAttestations) {
      if (!attestationTypes.has(required)) {
        decisions.push({ code: "REQUIRED_ATTESTATION_MISSING", package_identity: identity,
          attestation_type: required });
      }
    }
  }

  const advisorySnapshot = verifyAdvisorySnapshot(bundle, nodesByIdentity, policy, at);
  if (advisorySnapshot.stale) {
    decisions.push({ code: "ADVISORY_SNAPSHOT_STALE", generated_at: advisorySnapshot.generated_at,
      expires_at: advisorySnapshot.expires_at });
  }

  const advisoryResponses = verifyAdvisories(
    bundle.advisories,
    nodesByIdentity,
    policy,
    at
  );
  for (const advisory of advisoryResponses) {
    if (advisory.response === "block_new_import") {
      decisions.push({ code: "ADVISORY_BLOCKED", advisory_id: advisory.advisory_id, severity: advisory.severity });
    }
  }

  const dependencyClosure = [...reachable]
    .filter((identity) => identity !== rootIdentity)
    .sort();
  const semanticResult = {
    package_identity: rootIdentity,
    dependency_closure: dependencyClosure,
    trust_policy: { policy_id: policy.policy_id, version: policy.version,
      environment_class: policy.environment_class },
    evidence: {
      bundle_digest: sha256Digest(bundle),
      trust_policy_digest: sha256Digest(policy),
      packages: [...reachable].sort().map((identity) => {
        const verified = verifiedByIdentity.get(identity);
        const node = nodesByIdentity.get(identity);
        return {
          package_identity: identity,
          manifest_digest: verified.manifest_digest,
          release_digest: verified.release_digest,
          artifact_digests: verified.artifact_descriptors.map((entry) => entry.digest).sort(),
          custody_receipt_digests: node.custody_receipts.map((entry) => sha256Digest(entry)).sort(),
          attestation_digests: node.release.attestations.map((entry) => sha256Digest(entry)).sort()
        };
      }),
      advisory_snapshot: advisorySnapshot,
      advisory_digests: bundle.advisories.map((entry) => sha256Digest(entry)).sort()
    },
    decisions,
    advisory_responses: advisoryResponses
  };
  return {
    admissible: decisions.length === 0,
    ...semanticResult,
    transport,
    verification_digest: sha256Digest(semanticResult)
  };
}
