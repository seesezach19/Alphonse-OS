import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import { packageIdentity, publicKeyText, signDocument, verifyImportBundle,
  verifyRelease } from "../../src/portable-trust.js";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return { privateKey: pair.privateKey, publicKey: publicKeyText(pair.publicKey) };
}

function fixture({ packageId = "com.alphonse.inventory", version = "1.0.0", risk = "interpreted",
  dependencies = [] } = {}) {
  const root = keys();
  const release = keys();
  const registry = keys();
  const attester = keys();
  const now = "2030-01-01T10:00:00.000Z";
  const artifactBytes = Buffer.from(JSON.stringify({ package_id: packageId, version }), "utf8");
  const artifact = { name: "package.json", digest: `sha256:${sha256Digest(artifactBytes).slice(7)}`,
    size: artifactBytes.length, media_type: "application/json", risk_class: risk };
  const riskProfile = { effect_class: "read_only", context_class: "public",
    credential_class: "none", network_class: "none" };
  const publisher = { publisher_id: "publisher:alphonse", root_key_id: sha256Digest(root.publicKey),
    root_public_key: root.publicKey };
  const delegationDocument = { schema_version: "alphonse.release_delegation.v0.1", delegation_id: "release-2030",
    publisher_id: publisher.publisher_id, namespace_scope: "com.alphonse", package_scope: "*",
    release_key_id: sha256Digest(release.publicKey), release_public_key: release.publicKey,
    actions: ["publish", "advise"], issued_at: "2030-01-01T00:00:00.000Z", expires_at: "2030-02-01T00:00:00.000Z" };
  const delegation = { document: delegationDocument, root_signature: signDocument(delegationDocument, root.privateKey) };
  const manifest = { schema_version: "alphonse.portable_package.v0.1", package_id: packageId,
    semantic_version: version, publisher_id: publisher.publisher_id, release_key_id: delegationDocument.release_key_id,
    package_artifact_digest: artifact.digest, artifacts: [artifact], dependencies,
    exports: [{ kind: "skill", export_id: "inventory", contract_version: "1.0.0" }],
    compatibility: { kernel_api: ">=0.1 <0.2" }, license: "Apache-2.0", risk_profile: riskProfile, issued_at: now };
  const attestationDocument = { schema_version: "alphonse.package_attestation.v0.1",
    attestation_id: `risk:${packageId}:${version}`, issuer_id: "attester:alphonse-security",
    type: "artifact_risk_classification", subject_digest: artifact.digest,
    predicate_schema: "alphonse.artifact_risk.v0.1",
    result: { risk_class: risk, package_risk_profile: riskProfile },
    evidence_digest: sha256Digest({ inspected: artifact.digest, result: risk }), issued_at: now,
    expires_at: "2031-01-01T00:00:00.000Z" };
  const releaseRecord = { publisher, delegation, manifest,
    artifacts: [{ name: artifact.name, content_base64: artifactBytes.toString("base64") }],
    attestations: [{ document: attestationDocument, issuer_key_id: sha256Digest(attester.publicKey),
      signature: signDocument(attestationDocument, attester.privateKey) }],
    release_signature: signDocument(manifest, release.privateKey) };
  const checkpoint = { registry_id: "registry:primary", sequence: 1, root_hash: sha256Digest(manifest), issued_at: now };
  const receiptDocument = { schema_version: "alphonse.publication_receipt.v0.1", registry_id: checkpoint.registry_id,
    package_id: packageId, semantic_version: version, package_artifact_digest: artifact.digest,
    manifest_digest: sha256Digest(manifest), release_digest: sha256Digest(releaseRecord),
    publisher_proof_digest: sha256Digest({ publisher, delegation }), artifact_descriptors: [artifact],
    attestation_digests: releaseRecord.attestations.map((entry) => sha256Digest(entry)), custody_mode: "publication",
    source_receipt_digests: [], transparency_checkpoint: checkpoint, published_at: now };
  const receipt = { document: receiptDocument, registry_key_id: sha256Digest(registry.publicKey),
    registry_signature: signDocument(receiptDocument, registry.privateKey) };
  return { root, release, registry, attester, now, releaseRecord, receipt };
}

function policy(fixtureValue, overrides = {}) {
  return { schema_version: "alphonse.trust_policy.v0.1", policy_id: "policy-development", version: 1,
    environment_class: "development", allowed_registries: [{ registry_id: "registry:primary",
      public_key: fixtureValue.registry.publicKey }], pinned_publishers: [{ publisher_id: "publisher:alphonse",
      root_public_key: fixtureValue.root.publicKey, namespaces: ["com.alphonse"] }],
    allowed_risk_classes: ["declarative", "interpreted", "sandboxed", "executable"],
    required_attestation_types: ["artifact_risk_classification"],
    trusted_attesters: [{ issuer_id: "attester:alphonse-security", public_key: fixtureValue.attester.publicKey,
      allowed_types: ["artifact_risk_classification"] }],
    risk_classification_attestation_type: "artifact_risk_classification",
    max_advisory_snapshot_age_seconds: 7200,
    maximum_dependency_count: 8,
    allowed_export_kinds: ["schema", "skill", "capability", "adapter", "view", "evaluation"],
    allowed_licenses: ["Apache-2.0"],
    allowed_kernel_api_compatibility: [">=0.1 <0.2"],
    allowed_effect_classes: ["read_only", "external_write"],
    allowed_context_classes: ["public", "customer"],
    allowed_credential_classes: ["none", "scoped"],
    allowed_network_classes: ["none", "restricted"],
    advisory_responses: { low: "notify_only", high: "block_new_import",
      critical: "block_new_import" }, ...overrides };
}

function bundleFor(value, dependencies = [], advisories = [], snapshotAt = value.now) {
  const rootNode = { release: value.releaseRecord, custody_receipts: [value.receipt] };
  const identities = [rootNode, ...dependencies]
    .map((node) => packageIdentity(node.release.manifest))
    .sort();
  const snapshotDocument = { schema_version: "alphonse.advisory_snapshot.v0.1",
    registry_id: value.receipt.document.registry_id, package_identities: identities,
    advisory_digests: advisories.map((entry) => sha256Digest(entry)).sort(),
    transparency_checkpoint: value.receipt.document.transparency_checkpoint,
    generated_at: snapshotAt, expires_at: new Date(Date.parse(snapshotAt) + 60 * 60_000).toISOString() };
  return { schema_version: "alphonse.offline_bundle.v0.1", root: rootNode, dependencies, advisories,
    advisory_snapshot: { document: snapshotDocument, registry_key_id: sha256Digest(value.registry.publicKey),
      registry_signature: signDocument(snapshotDocument, value.registry.privateKey) } };
}

test("delegated release verifies while publisher private keys stay outside release bytes", () => {
  const value = fixture();
  const verified = verifyRelease(value.releaseRecord, { now: value.now });
  assert.equal(verified.package_id, "com.alphonse.inventory");
  assert.doesNotMatch(JSON.stringify(value.releaseRecord), /PRIVATE KEY/);
});

test("atomic release verification rejects missing or mismatched artifacts", () => {
  const missing = fixture();
  missing.releaseRecord.artifacts = [];
  assert.throws(() => verifyRelease(missing.releaseRecord, { now: missing.now }), /artifact/i);
  const mismatched = fixture();
  mismatched.releaseRecord.artifacts[0].content_base64 = Buffer.from("changed").toString("base64");
  assert.throws(() => verifyRelease(mismatched.releaseRecord, { now: mismatched.now }), /digest/i);
});

test("expired release keys block new publication without invalidating timely custody receipts", () => {
  const value = fixture();
  assert.throws(() => verifyRelease(value.releaseRecord, {
    now: "2030-03-01T00:00:00.000Z", requireCurrentDelegation: true
  }), /delegation/i);
  const bundle = bundleFor(value, [], [], "2030-03-01T00:00:00.000Z");
  assert.equal(verifyImportBundle(bundle, policy(value), {
    now: "2030-03-01T00:00:00.000Z", transport: "offline_bundle"
  }).admissible, true);
});

test("private key material cannot enter a portable artifact", () => {
  const value = fixture();
  const secret = Buffer.from("ed25519-pkcs8:not-a-real-key");
  value.releaseRecord.artifacts[0].content_base64 = secret.toString("base64");
  value.releaseRecord.manifest.artifacts[0].digest = sha256Digest(secret);
  value.releaseRecord.manifest.artifacts[0].size = secret.length;
  value.releaseRecord.manifest.package_artifact_digest = sha256Digest(secret);
  value.releaseRecord.release_signature = signDocument(value.releaseRecord.manifest, value.release.privateKey);
  assert.throws(() => verifyRelease(value.releaseRecord, { now: value.now }), /private key/i);
});

test("private key fields cannot hide outside artifact bytes", () => {
  const value = fixture();
  value.releaseRecord.attestations[0].private_key = "opaque";
  assert.throws(() => verifyRelease(value.releaseRecord, { now: value.now }), /secret material/i);
});

test("destination verifies transitive closure and policies differ by environment", () => {
  const dependency = fixture({ packageId: "com.alphonse.shared", version: "2.0.0", risk: "executable" });
  const dependencyRef = { package_id: dependency.releaseRecord.manifest.package_id,
    semantic_version: dependency.releaseRecord.manifest.semantic_version,
    manifest_digest: sha256Digest(dependency.releaseRecord.manifest),
    package_artifact_digest: dependency.releaseRecord.manifest.package_artifact_digest };
  const root = fixture({ dependencies: [dependencyRef] });
  dependency.receipt.document.registry_id = root.receipt.document.registry_id;
  dependency.receipt.document.transparency_checkpoint.registry_id = root.receipt.document.registry_id;
  dependency.receipt.registry_key_id = sha256Digest(root.registry.publicKey);
  dependency.receipt.registry_signature = signDocument(dependency.receipt.document, root.registry.privateKey);
  dependency.releaseRecord.publisher = root.releaseRecord.publisher;
  dependency.releaseRecord.delegation = root.releaseRecord.delegation;
  dependency.releaseRecord.manifest.publisher_id = root.releaseRecord.publisher.publisher_id;
  dependency.releaseRecord.manifest.release_key_id = root.releaseRecord.delegation.document.release_key_id;
  dependency.releaseRecord.release_signature = signDocument(dependency.releaseRecord.manifest, root.release.privateKey);
  dependency.receipt.document.publisher_proof_digest = sha256Digest({ publisher: dependency.releaseRecord.publisher,
    delegation: dependency.releaseRecord.delegation });
  dependency.receipt.registry_signature = signDocument(dependency.receipt.document, root.registry.privateKey);
  dependency.releaseRecord.attestations[0].document.issuer_id = "attester:alphonse-security";
  dependency.releaseRecord.attestations[0].issuer_key_id = sha256Digest(root.attester.publicKey);
  dependency.releaseRecord.attestations[0].signature = signDocument(
    dependency.releaseRecord.attestations[0].document, root.attester.privateKey);
  dependency.receipt.document.manifest_digest = sha256Digest(dependency.releaseRecord.manifest);
  dependency.receipt.document.release_digest = sha256Digest(dependency.releaseRecord);
  dependency.receipt.document.attestation_digests = dependency.releaseRecord.attestations.map((entry) => sha256Digest(entry));
  dependency.receipt.registry_signature = signDocument(dependency.receipt.document, root.registry.privateKey);
  root.releaseRecord.manifest.dependencies[0].manifest_digest = sha256Digest(dependency.releaseRecord.manifest);
  root.releaseRecord.release_signature = signDocument(root.releaseRecord.manifest, root.release.privateKey);
  root.receipt.document.manifest_digest = sha256Digest(root.releaseRecord.manifest);
  root.receipt.document.release_digest = sha256Digest(root.releaseRecord);
  root.receipt.registry_signature = signDocument(root.receipt.document, root.registry.privateKey);
  const dependencyNode = { release: dependency.releaseRecord, custody_receipts: [dependency.receipt] };
  const bundle = bundleFor(root, [dependencyNode]);
  const development = verifyImportBundle(bundle, policy(root), { now: root.now, transport: "registry" });
  assert.equal(development.admissible, true, JSON.stringify(development.decisions));
  assert.equal(development.dependency_closure.length, 1);
  const production = verifyImportBundle(bundle, policy(root, {
    policy_id: "policy-production", environment_class: "production",
    allowed_risk_classes: ["declarative", "interpreted"]
  }), { now: root.now, transport: "registry" });
  assert.equal(production.admissible, false);
  assert.ok(production.decisions.some((entry) => entry.code === "RISK_CLASS_DENIED"));
  const dependencyBound = verifyImportBundle(bundle, policy(root, { maximum_dependency_count: 0 }),
    { now: root.now });
  assert.equal(dependencyBound.admissible, false);
  assert.ok(dependencyBound.decisions.some((entry) => entry.code === "DEPENDENCY_COUNT_DENIED"
    && entry.dependency_count === 1));
});

test("mirror location does not change Package identity and offline verification is equivalent", () => {
  const value = fixture();
  const bundle = bundleFor(value);
  const online = verifyImportBundle(bundle, policy(value), { now: value.now, transport: "registry" });
  const offline = verifyImportBundle(structuredClone(bundle), policy(value), { now: value.now, transport: "offline_bundle" });
  assert.equal(online.package_identity, offline.package_identity);
  assert.equal(online.verification_digest, offline.verification_digest);
});

test("signed advisory can only select the response preapproved by destination policy", () => {
  const value = fixture();
  const advisoryDocument = { schema_version: "alphonse.package_advisory.v0.1", advisory_id: "ADV-1",
    publisher_id: value.releaseRecord.publisher.publisher_id, package_id: value.releaseRecord.manifest.package_id,
    manifest_digest: sha256Digest(value.releaseRecord.manifest),
    package_artifact_digest: value.releaseRecord.manifest.package_artifact_digest, severity: "low",
    evidence: "Evaluation regression.", remediation: "Review before next import.", issued_at: value.now,
    expires_at: "2030-02-01T00:00:00.000Z" };
  const advisory = { document: advisoryDocument,
    signature: signDocument(advisoryDocument, value.root.privateKey) };
  const bundle = bundleFor(value, [], [advisory]);
  const result = verifyImportBundle(bundle, policy(value), { now: value.now, transport: "offline_bundle" });
  assert.equal(result.admissible, true);
  assert.deepEqual(result.advisory_responses, [{ advisory_id: "ADV-1", kind: "package_advisory",
    severity: "low", response: "notify_only" }]);
});

test("root-signed release-key revocation blocks new import only after its effective time", () => {
  const value = fixture();
  const document = { schema_version: "alphonse.package_advisory.v0.1", advisory_id: "REV-1",
    publisher_id: value.releaseRecord.publisher.publisher_id, package_id: value.releaseRecord.manifest.package_id,
    manifest_digest: sha256Digest(value.releaseRecord.manifest),
    package_artifact_digest: value.releaseRecord.manifest.package_artifact_digest, severity: "critical",
    evidence: "Delegated release key compromise.", remediation: "Rotate release key and republish.",
    release_key_id: value.releaseRecord.manifest.release_key_id,
    compromise_effective_at: "2030-01-01T09:00:00.000Z", issued_at: value.now,
    expires_at: "2031-01-01T00:00:00.000Z" };
  const advisory = { document, signature: signDocument(document, value.root.privateKey) };
  const result = verifyImportBundle(bundleFor(value, [], [advisory]), policy(value), { now: value.now });
  assert.equal(result.admissible, false);
  assert.deepEqual(result.advisory_responses, [{ advisory_id: "REV-1", kind: "release_key_revocation",
    severity: "critical", response: "block_new_import" }]);
});

test("release-key revocation follows the delegated key across packages", () => {
  const value = fixture();
  const document = { schema_version: "alphonse.package_advisory.v0.1", advisory_id: "REV-KEY-WIDE",
    publisher_id: value.releaseRecord.publisher.publisher_id, package_id: "com.alphonse.other",
    manifest_digest: sha256Digest({ package_id: "com.alphonse.other" }),
    package_artifact_digest: sha256Digest({ artifact: "other" }), severity: "critical",
    evidence: "Delegated release key compromise.", remediation: "Rotate release key and republish.",
    release_key_id: value.releaseRecord.manifest.release_key_id,
    compromise_effective_at: "2030-01-01T09:00:00.000Z", issued_at: value.now,
    expires_at: "2031-01-01T00:00:00.000Z" };
  const advisory = { document, signature: signDocument(document, value.root.privateKey) };
  const result = verifyImportBundle(bundleFor(value, [], [advisory]), policy(value), { now: value.now });
  assert.equal(result.admissible, false);
  assert.deepEqual(result.advisory_responses, [{ advisory_id: "REV-KEY-WIDE", kind: "release_key_revocation",
    severity: "critical", response: "block_new_import" }]);
});

test("future-effective release-key revocation is authenticated before it is ignored", () => {
  const value = fixture();
  const document = { schema_version: "alphonse.package_advisory.v0.1", advisory_id: "REV-FUTURE-BAD",
    publisher_id: value.releaseRecord.publisher.publisher_id, package_id: value.releaseRecord.manifest.package_id,
    manifest_digest: sha256Digest(value.releaseRecord.manifest),
    package_artifact_digest: value.releaseRecord.manifest.package_artifact_digest, severity: "critical",
    evidence: "Delegated release key compromise.", remediation: "Rotate release key and republish.",
    release_key_id: value.releaseRecord.manifest.release_key_id,
    compromise_effective_at: "2030-01-01T11:00:00.000Z", issued_at: value.now,
    expires_at: "2031-01-01T00:00:00.000Z" };
  const advisory = { document, signature: signDocument(document, value.release.privateKey) };
  assert.throws(() => verifyImportBundle(bundleFor(value, [], [advisory]), policy(value), { now: value.now }),
    /signature is invalid/i);
});

test("advisory records reject hidden secret fields before registry storage", () => {
  const value = fixture();
  const document = { schema_version: "alphonse.package_advisory.v0.1", advisory_id: "ADV-SECRET",
    publisher_id: value.releaseRecord.publisher.publisher_id, package_id: value.releaseRecord.manifest.package_id,
    manifest_digest: sha256Digest(value.releaseRecord.manifest),
    package_artifact_digest: value.releaseRecord.manifest.package_artifact_digest, severity: "low",
    evidence: "None.", remediation: "None.", issued_at: value.now, expires_at: "2031-01-01T00:00:00.000Z" };
  const advisory = { document, signature: signDocument(document, value.root.privateKey), private_key: "hidden" };
  assert.throws(() => verifyImportBundle(bundleFor(value, [], [advisory]), policy(value), { now: value.now }),
    /secret material/i);
});

test("old custody receipt cannot authorize a changed signed manifest", () => {
  const value = fixture();
  const originalIdentity = packageIdentity(value.releaseRecord.manifest);
  value.releaseRecord.manifest.exports.push({ kind: "capability", export_id: "changed", contract_version: "1.0.0" });
  value.releaseRecord.release_signature = signDocument(value.releaseRecord.manifest, value.release.privateKey);
  assert.notEqual(packageIdentity(value.releaseRecord.manifest), originalIdentity);
  assert.throws(() => verifyImportBundle(bundleFor(value), policy(value), { now: value.now }),
    /custody receipt/i);
});

test("unknown advisory policy responses fail closed", () => {
  const value = fixture();
  assert.throws(() => verifyImportBundle(bundleFor(value), policy(value, {
    advisory_responses: { low: "block_import" }
  }), { now: value.now }), /unsupported/i);
});

test("required attestations must be pinned, signed, current, and artifact-bound", () => {
  const value = fixture();
  value.releaseRecord.attestations[0].signature = signDocument(
    value.releaseRecord.attestations[0].document, keys().privateKey);
  value.receipt.document.release_digest = sha256Digest(value.releaseRecord);
  value.receipt.document.attestation_digests = value.releaseRecord.attestations.map((entry) => sha256Digest(entry));
  value.receipt.registry_signature = signDocument(value.receipt.document, value.registry.privateKey);
  assert.throws(() => verifyImportBundle(bundleFor(value), policy(value), { now: value.now }),
    /signature is invalid/i);
});

test("trusted classification overrides a misleading publisher risk label", () => {
  const value = fixture({ risk: "declarative" });
  const attestation = value.releaseRecord.attestations[0];
  attestation.document.result.risk_class = "executable";
  attestation.signature = signDocument(attestation.document, value.attester.privateKey);
  value.receipt.document.release_digest = sha256Digest(value.releaseRecord);
  value.receipt.document.attestation_digests = value.releaseRecord.attestations.map((entry) => sha256Digest(entry));
  value.receipt.registry_signature = signDocument(value.receipt.document, value.registry.privateKey);
  const result = verifyImportBundle(bundleFor(value), policy(value, {
    environment_class: "production", allowed_risk_classes: ["declarative"]
  }), { now: value.now });
  assert.equal(result.admissible, false);
  assert.ok(result.decisions.some((entry) => entry.code === "DECLARED_RISK_MISMATCH"));
  assert.ok(result.decisions.some((entry) => entry.code === "RISK_CLASS_DENIED"));
});

test("stale signed advisory snapshot is visible and denies a new import", () => {
  const value = fixture();
  const bundle = bundleFor(value);
  bundle.advisory_snapshot.document.generated_at = value.now;
  bundle.advisory_snapshot.document.expires_at = value.now;
  bundle.advisory_snapshot.registry_signature = signDocument(
    bundle.advisory_snapshot.document, value.registry.privateKey);
  const result = verifyImportBundle(bundle, policy(value), { now: value.now });
  assert.equal(result.admissible, false);
  assert.ok(result.decisions.some((entry) => entry.code === "ADVISORY_SNAPSHOT_STALE"));
});

test("destination policy gates compatibility, license, exports, and operational risk profile", () => {
  const value = fixture();
  const result = verifyImportBundle(bundleFor(value), policy(value, {
    allowed_export_kinds: [], allowed_licenses: [], allowed_kernel_api_compatibility: [],
    allowed_effect_classes: [], allowed_context_classes: [], allowed_credential_classes: [],
    allowed_network_classes: []
  }), { now: value.now });
  assert.equal(result.admissible, false);
  for (const code of ["EXPORT_KIND_DENIED", "LICENSE_DENIED", "KERNEL_COMPATIBILITY_DENIED",
    "EFFECT_CLASS_DENIED", "CONTEXT_CLASS_DENIED", "CREDENTIAL_CLASS_DENIED", "NETWORK_CLASS_DENIED"]) {
    assert.ok(result.decisions.some((entry) => entry.code === code), `missing ${code}`);
  }
});
