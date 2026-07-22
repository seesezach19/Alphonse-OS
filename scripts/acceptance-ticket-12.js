import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";

import { sha256Digest } from "../src/canonical-json.js";
import { publicKeyText, signDocument } from "../src/portable-trust.js";
import { signRegistryAccessGrant } from "../src/registry-access-grant.js";

const kernelUrl = "http://127.0.0.1:43112";
const productionKernelUrl = "http://127.0.0.1:43113";
const primaryUrl = "http://127.0.0.1:43150";
const mirrorUrl = "http://127.0.0.1:43151";
const authHeaders = {
  "content-type": "application/json",
  authorization: "Bearer local-development-bootstrap-token"
};
const productionAuthHeaders = {
  "content-type": "application/json",
  authorization: "Bearer local-development-owner-token"
};
const composeEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "alphonse-kernel-ticket-12-acceptance",
  KERNEL_PORT: "43112",
  KERNEL_PRODUCTION_PORT: "43113",
  POSTGRES_PORT: "45442",
  DATA_PLANE_PORT: "43122",
  REGISTRY_PRIMARY_PORT: "43150",
  REGISTRY_MIRROR_PORT: "43151",
  COMPOSE_PROFILES: "portable-trust"
};

function compose(...args) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: new URL("..", import.meta.url),
    env: composeEnvironment,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10 * 60_000
  });
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function composeExpectFailure(...args) {
  return spawnSync("docker", ["compose", ...args], {
    cwd: new URL("..", import.meta.url),
    env: composeEnvironment,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function post(baseUrl, path, body, headers = { "content-type": "application/json" }) {
  return request(baseUrl, path, { method: "POST", headers, body: JSON.stringify(body) });
}

async function kernelPost(path, body) {
  return post(kernelUrl, path, body, authHeaders);
}

async function kernelPostTo(baseUrl, path, body, headers = authHeaders) {
  return post(baseUrl, path, body, headers);
}

async function kernelGet(path) {
  return request(kernelUrl, path, { headers: authHeaders });
}

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

function registryHeaders(registryId, secret, packageScopes = ["com.alphonse.*"]) {
  const now = Date.now();
  const document = { schema_version: "alphonse.registry_access_grant.v0.1",
    grant_id: `ticket-12-${registryId}`, registry_id: registryId, subject_id: "builder:ticket-12",
    actions: ["publish", "discover", "download", "mirror", "advise"], package_scopes: packageScopes,
    issued_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 60 * 60_000).toISOString() };
  return { "content-type": "application/json",
    authorization: `Registry ${signRegistryAccessGrant(document, secret)}` };
}

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return { privateKey: pair.privateKey, publicKey: publicKeyText(pair.publicKey) };
}

function publisherFixture() {
  const root = keyPair();
  const release = keyPair();
  const attester = keyPair();
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const publisher = {
    publisher_id: "publisher:alphonse",
    root_key_id: sha256Digest(root.publicKey),
    root_public_key: root.publicKey
  };
  const delegationDocument = {
    schema_version: "alphonse.release_delegation.v0.1",
    delegation_id: "acceptance-release-key",
    publisher_id: publisher.publisher_id,
    namespace_scope: "com.alphonse",
    package_scope: "*",
    release_key_id: sha256Digest(release.publicKey),
    release_public_key: release.publicKey,
    actions: ["publish", "advise"],
    issued_at: issuedAt,
    expires_at: expiresAt
  };
  return {
    root,
    release,
    attester,
    publisher,
    delegation: {
      document: delegationDocument,
      root_signature: signDocument(delegationDocument, root.privateKey)
    }
  };
}

function portableRelease(publisher, packageId, version, riskClass, dependencies = []) {
  const issuedAt = new Date(Date.now() - 30_000).toISOString();
  const bytes = Buffer.from(JSON.stringify({ package_id: packageId, version, purpose: "ticket-12-acceptance" }));
  const artifact = {
    name: "package.json",
    digest: sha256Digest(bytes),
    size: bytes.length,
    media_type: "application/json",
    risk_class: riskClass
  };
  const riskProfile = { effect_class: "read_only", context_class: "public",
    credential_class: "none", network_class: "none" };
  const manifest = {
    schema_version: "alphonse.portable_package.v0.1",
    package_id: packageId,
    semantic_version: version,
    publisher_id: publisher.publisher.publisher_id,
    release_key_id: publisher.delegation.document.release_key_id,
    package_artifact_digest: artifact.digest,
    artifacts: [artifact],
    dependencies,
    exports: [{ kind: "skill", export_id: packageId.split(".").at(-1), contract_version: "1.0.0" }],
    compatibility: { kernel_api: ">=0.1 <0.2" },
    license: "Apache-2.0",
    risk_profile: riskProfile,
    issued_at: issuedAt
  };
  const attestationDocument = {
    schema_version: "alphonse.package_attestation.v0.1",
    attestation_id: `risk:${packageId}:${version}`,
    issuer_id: "attester:alphonse-security",
    type: "artifact_risk_classification",
    subject_digest: artifact.digest,
    predicate_schema: "alphonse.artifact_risk.v0.1",
    result: { risk_class: riskClass, package_risk_profile: riskProfile },
    evidence_digest: sha256Digest({ inspected: artifact.digest, risk_class: riskClass }),
    issued_at: issuedAt,
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
  };
  return {
    publisher: publisher.publisher,
    delegation: publisher.delegation,
    manifest,
    artifacts: [{ name: "package.json", content_base64: bytes.toString("base64") }],
    attestations: [{ document: attestationDocument, issuer_key_id: sha256Digest(publisher.attester.publicKey),
      signature: signDocument(attestationDocument, publisher.attester.privateKey) }],
    release_signature: signDocument(manifest, publisher.release.privateKey)
  };
}

function policy(policyId, environmentClass, registries, publisher, allowedRiskClasses) {
  return {
    schema_version: "alphonse.trust_policy.v0.1",
    policy_id: policyId,
    version: 1,
    environment_class: environmentClass,
    allowed_registries: registries,
    pinned_publishers: [{
      publisher_id: publisher.publisher.publisher_id,
      root_public_key: publisher.root.publicKey,
      namespaces: ["com.alphonse"]
    }],
    allowed_risk_classes: allowedRiskClasses,
    required_attestation_types: [],
    trusted_attesters: [{ issuer_id: "attester:alphonse-security", public_key: publisher.attester.publicKey,
      allowed_types: ["artifact_risk_classification"] }],
    risk_classification_attestation_type: "artifact_risk_classification",
    max_advisory_snapshot_age_seconds: 3600,
    maximum_dependency_count: 8,
    allowed_export_kinds: ["schema", "skill", "capability", "adapter", "view", "evaluation"],
    allowed_licenses: ["Apache-2.0"],
    allowed_kernel_api_compatibility: [">=0.1 <0.2"],
    allowed_effect_classes: ["read_only", "external_write"],
    allowed_context_classes: ["public", "customer"],
    allowed_credential_classes: ["none", "scoped"],
    allowed_network_classes: ["none", "restricted"],
    advisory_responses: {
      low: "notify_only",
      high: "block_new_import",
      critical: "block_new_import"
    }
  };
}

async function createImportWorkIntent(baseUrl, prefix, headers = authHeaders) {
  const human = await kernelPostTo(baseUrl, "/kernel/v0/principals", command(`${prefix}-human`,
    "kernel.principal.create", { principal_type: "human", display_name: `${prefix} Import Sponsor` }), headers);
  assert.equal(human.response.status, 201, JSON.stringify(human.body));
  const agent = await kernelPostTo(baseUrl, "/kernel/v0/principals", command(`${prefix}-agent`,
    "kernel.principal.create", { principal_type: "agent", display_name: `${prefix} Import Agent` }), headers);
  assert.equal(agent.response.status, 201, JSON.stringify(agent.body));
  const token = `${prefix}-agent-token-00000000000000000001`;
  const passport = await kernelPostTo(baseUrl, "/kernel/v0/agent-passports", command(`${prefix}-passport`,
    "kernel.agent_passport.issue", {
      agent_principal_id: agent.body.principal.principal_id,
      sponsor_principal_id: human.body.principal.principal_id,
      runtime: { kind: "codex", version: "workspace" },
      model_configuration: { provider: "openai", model: "frontier" },
      package_skill_configuration: { packages: [], skills: ["implement"] },
      agent_authentication_token: token,
      permitted_intent_classes: ["package_build"],
      provenance: { source: "ticket-12-acceptance" },
      valid_from: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
    }), headers);
  assert.equal(passport.response.status, 201, JSON.stringify(passport.body));
  const proposal = await kernelPostTo(baseUrl, "/kernel/v0/work-intent-proposals", command(`${prefix}-proposal`,
    "kernel.work_intent.propose", {
      passport_id: passport.body.passport.passport_id,
      intent_class: "package_build",
      objective: "Evaluate and quarantine one exact portable Package bundle.",
      requested_outcome: "Record destination-local trust decision without Deployment authority.",
      scope: { package_namespaces: ["com.alphonse"] },
      constraints: { no_deployment: true, no_external_effects: true }
    }), { "content-type": "application/json", authorization: `Agent ${token}` });
  assert.equal(proposal.response.status, 201, JSON.stringify(proposal.body));
  const confirmed = await kernelPostTo(baseUrl,
    `/kernel/v0/work-intent-proposals/${proposal.body.proposal.proposal_id}/confirm`,
    command(`${prefix}-confirm`, "kernel.work_intent.confirm", {}), headers);
  assert.equal(confirmed.response.status, 201, JSON.stringify(confirmed.body));
  return confirmed.body.work_intent.work_intent_id;
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait");

  const primaryHealth = await request(primaryUrl, "/healthz");
  const mirrorHealth = await request(mirrorUrl, "/healthz");
  assert.equal(primaryHealth.response.status, 200);
  assert.equal(mirrorHealth.response.status, 200);
  assert.equal(primaryHealth.body.deployment_authority, false);
  const primaryRegistryHeaders = registryHeaders("registry:primary", "local-primary-registry-access-grant-secret");
  const mirrorRegistryHeaders = registryHeaders("registry:mirror", "local-mirror-registry-access-grant-secret");
  const anonymousDiscovery = await request(primaryUrl, "/registry/v0/packages?package_id=com.alphonse.inventory");
  assert.equal(anonymousDiscovery.response.status, 401);
  const registryKernelRead = composeExpectFailure("exec", "-T", "registry-primary", "node", "--input-type=module",
    "-e", "import pg from 'pg';const p=new pg.Pool({connectionString:process.env.DATABASE_URL});try{await p.query('SELECT 1 FROM kernel_deployments');process.exitCode=0}catch(error){console.error(error.code);process.exitCode=1}finally{await p.end()}");
  assert.notEqual(registryKernelRead.status, 0, "Registry database role unexpectedly read Kernel authority tables.");
  const registryCrossWrite = composeExpectFailure("exec", "-T", "registry-primary", "node", "--input-type=module",
    "-e", `import pg from 'pg';const p=new pg.Pool({connectionString:process.env.DATABASE_URL});try{await p.query("INSERT INTO registry_transparency_entries(registry_id,sequence,entry_type,entry_digest,root_hash,entry,recorded_at) VALUES ('registry:mirror',999,'advisory','sha256:${"a".repeat(64)}','sha256:${"b".repeat(64)}','{}',now())");process.exitCode=0}catch(error){console.error(error.code);process.exitCode=1}finally{await p.end()}`);
  assert.notEqual(registryCrossWrite.status, 0, "Primary Registry role unexpectedly wrote mirror rows.");

  const publisher = publisherFixture();
  const developmentWorkIntentId = await createImportWorkIntent(kernelUrl, "t12-dev");
  const productionWorkIntentId = await createImportWorkIntent(
    productionKernelUrl, "t12-prod", productionAuthHeaders
  );
  const dependency = portableRelease(publisher, "com.alphonse.inventory.shared", "1.0.0", "executable");
  const dependencyReference = {
    package_id: dependency.manifest.package_id,
    semantic_version: dependency.manifest.semantic_version,
    manifest_digest: sha256Digest(dependency.manifest),
    package_artifact_digest: dependency.manifest.package_artifact_digest
  };
  const root = portableRelease(publisher, "com.alphonse.inventory", "1.0.0", "interpreted",
    [dependencyReference]);

  const incomplete = structuredClone(dependency);
  incomplete.artifacts = [];
  const incompleteResult = await post(primaryUrl, "/registry/v0/publications", incomplete, primaryRegistryHeaders);
  assert.equal(incompleteResult.response.status, 422);
  assert.equal(incompleteResult.body.error.code, "INCOMPLETE_ARTIFACT_SET", JSON.stringify(incompleteResult.body));

  const dependencyPublished = await post(primaryUrl, "/registry/v0/publications", dependency, primaryRegistryHeaders);
  assert.equal(dependencyPublished.response.status, 201, JSON.stringify(dependencyPublished.body));
  const rootPublished = await post(primaryUrl, "/registry/v0/publications", root, primaryRegistryHeaders);
  assert.equal(rootPublished.response.status, 201, JSON.stringify(rootPublished.body));
  const receipt = rootPublished.body.publication_receipt;
  assert.equal(receipt.document.publisher_proof_digest,
    sha256Digest({ publisher: root.publisher, delegation: root.delegation }));
  assert.deepEqual(receipt.document.artifact_descriptors, root.manifest.artifacts);
  assert.deepEqual(receipt.document.attestation_digests, root.attestations.map((entry) => sha256Digest(entry)));
  assert.equal(receipt.document.manifest_digest, sha256Digest(root.manifest));
  assert.equal(receipt.document.release_digest, sha256Digest(root));
  assert.equal(receipt.document.transparency_checkpoint.registry_id, "registry:primary");
  assert.ok(receipt.document.transparency_checkpoint.sequence > 0);
  assert.doesNotMatch(JSON.stringify(rootPublished.body), /PRIVATE KEY|ed25519-pkcs8:/i);
  const narrowHeaders = registryHeaders("registry:primary", "local-primary-registry-access-grant-secret",
    ["com.alphonse.inventory"]);
  const narrowBundle = await request(primaryUrl,
    "/registry/v0/bundles?package_id=com.alphonse.inventory&semantic_version=1.0.0",
    { headers: narrowHeaders });
  assert.equal(narrowBundle.response.status, 403);

  const discovery = await request(primaryUrl, "/registry/v0/packages?package_id=com.alphonse.inventory",
    { headers: primaryRegistryHeaders });
  assert.equal(discovery.body.packages.length, 1);
  const primaryBundleResult = await request(primaryUrl,
    "/registry/v0/bundles?package_id=com.alphonse.inventory&semantic_version=1.0.0",
    { headers: primaryRegistryHeaders });
  assert.equal(primaryBundleResult.response.status, 200);
  const primaryBundle = primaryBundleResult.body;
  assert.equal(primaryBundle.dependencies.length, 1);

  const mirrored = await post(mirrorUrl, "/registry/v0/mirrors", primaryBundle, mirrorRegistryHeaders);
  assert.equal(mirrored.response.status, 201, JSON.stringify(mirrored.body));
  const mirrorBundle = mirrored.body;
  assert.equal(mirrorBundle.root.release.manifest.package_artifact_digest,
    primaryBundle.root.release.manifest.package_artifact_digest);
  assert.equal(mirrorBundle.root.release.release_signature, primaryBundle.root.release.release_signature);

  const registries = [
    { registry_id: primaryHealth.body.registry_id, public_key: primaryHealth.body.registry_public_key },
    { registry_id: mirrorHealth.body.registry_id, public_key: mirrorHealth.body.registry_public_key }
  ];
  const developmentPolicy = policy("portable-development", "development", registries, publisher,
    ["declarative", "interpreted", "sandboxed", "executable"]);
  const mirrorPolicy = policy("portable-mirror-development", "development", [registries[1]], publisher,
    ["declarative", "interpreted", "sandboxed", "executable"]);
  const productionPolicy = policy("portable-production", "production", registries, publisher,
    ["declarative", "interpreted"]);
  const developmentCreated = await kernelPost("/kernel/v0/trust-policies",
    command("t12-policy-development", "kernel.trust_policy.create", { policy: developmentPolicy }));
  assert.equal(developmentCreated.response.status, 201, JSON.stringify(developmentCreated.body));
  const mirrorPolicyCreated = await kernelPost("/kernel/v0/trust-policies",
    command("t12-policy-mirror", "kernel.trust_policy.create", { policy: mirrorPolicy }));
  assert.equal(mirrorPolicyCreated.response.status, 201, JSON.stringify(mirrorPolicyCreated.body));
  const productionCreated = await kernelPostTo(productionKernelUrl, "/kernel/v0/trust-policies",
    command("t12-policy-production", "kernel.trust_policy.create", { policy: productionPolicy }),
    productionAuthHeaders);
  assert.equal(productionCreated.response.status, 201, JSON.stringify(productionCreated.body));
  const crossEnvironmentPolicy = await kernelPost("/kernel/v0/trust-policies",
    command("t12-policy-cross-environment", "kernel.trust_policy.create", { policy: productionPolicy }));
  assert.equal(crossEnvironmentPolicy.response.status, 409);
  assert.equal(crossEnvironmentPolicy.body.error.code, "TRUST_POLICY_ENVIRONMENT_MISMATCH");

  const developmentImport = await kernelPost("/kernel/v0/package-imports",
    command("t12-import-development", "kernel.package.import", {
      policy_id: developmentPolicy.policy_id,
      policy_version: developmentPolicy.version,
      work_intent_id: developmentWorkIntentId,
      transport: "registry",
      bundle: primaryBundle
    }));
  assert.equal(developmentImport.response.status, 201, JSON.stringify(developmentImport.body));
  assert.equal(developmentImport.body.import_receipt.admissible, true);
  assert.equal(developmentImport.body.quarantined_package.state, "quarantined");
  assert.equal(developmentImport.body.quarantined_package.deployment_id, null);
  assert.equal(developmentImport.body.import_receipt.deployment_created, false);
  assert.equal(developmentImport.body.import_receipt.capability_authority_granted, false);
  assert.equal(developmentImport.body.import_receipt.work_intent_id, developmentWorkIntentId);
  assert.equal(developmentImport.body.import_receipt.bundle_digest, sha256Digest(primaryBundle));
  assert.equal(developmentImport.body.import_receipt.evidence_digest,
    sha256Digest(developmentImport.body.import_receipt.verification_result.evidence));
  assert.equal(developmentImport.body.import_receipt.advisory_snapshot_digest,
    developmentImport.body.import_receipt.verification_result.evidence.advisory_snapshot.snapshot_digest);
  const quarantineId = developmentImport.body.quarantined_package.quarantine_id;
  const importReceiptId = developmentImport.body.import_receipt.import_receipt_id;

  const productionImport = await kernelPostTo(productionKernelUrl, "/kernel/v0/package-imports",
    command("t12-import-production", "kernel.package.import", {
      policy_id: productionPolicy.policy_id,
      policy_version: productionPolicy.version,
      work_intent_id: productionWorkIntentId,
      transport: "registry",
      bundle: primaryBundle
    }), productionAuthHeaders);
  assert.equal(productionImport.response.status, 201, JSON.stringify(productionImport.body));
  assert.equal(productionImport.body.import_receipt.admissible, false);
  assert.equal(productionImport.body.quarantined_package, null);
  assert.ok(productionImport.body.import_receipt.verification_result.decisions
    .some((entry) => entry.code === "RISK_CLASS_DENIED"));

  const mirrorImport = await kernelPost("/kernel/v0/package-imports",
    command("t12-import-mirror", "kernel.package.import", {
      policy_id: mirrorPolicy.policy_id,
      policy_version: mirrorPolicy.version,
      work_intent_id: developmentWorkIntentId,
      transport: "mirror",
      bundle: mirrorBundle
    }));
  assert.equal(mirrorImport.response.status, 201, JSON.stringify(mirrorImport.body));
  assert.equal(mirrorImport.body.import_receipt.package_identity,
    developmentImport.body.import_receipt.package_identity);

  const advisoryDocument = {
    schema_version: "alphonse.package_advisory.v0.1",
    advisory_id: "ADV-T12-LOW",
    publisher_id: publisher.publisher.publisher_id,
    package_id: root.manifest.package_id,
    manifest_digest: sha256Digest(root.manifest),
    package_artifact_digest: root.manifest.package_artifact_digest,
    severity: "low",
    evidence: "Controlled evaluation regression.",
    remediation: "Notify operator before next Deployment review.",
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
  };
  const advisory = { document: advisoryDocument,
    signature: signDocument(advisoryDocument, publisher.root.privateKey) };
  const advisoryPublished = await post(primaryUrl, "/registry/v0/advisories", advisory, primaryRegistryHeaders);
  assert.equal(advisoryPublished.response.status, 201, JSON.stringify(advisoryPublished.body));
  const advisedBundleResult = await request(primaryUrl,
    "/registry/v0/bundles?package_id=com.alphonse.inventory&semantic_version=1.0.0",
    { headers: primaryRegistryHeaders });
  const advisedBundle = advisedBundleResult.body;
  assert.equal(advisedBundle.advisories.length, 1);
  const strippedAdvisoryBundle = structuredClone(advisedBundle);
  strippedAdvisoryBundle.advisories = [];
  const strippedMirror = await post(mirrorUrl, "/registry/v0/mirrors", strippedAdvisoryBundle,
    mirrorRegistryHeaders);
  assert.equal(strippedMirror.response.status, 409, JSON.stringify(strippedMirror.body));
  assert.equal(strippedMirror.body.error.code, "SOURCE_ADVISORY_SNAPSHOT_MISMATCH");
  const advisedOnlineCommand = command("t12-import-advised-online", "kernel.package.import", {
      policy_id: developmentPolicy.policy_id,
      policy_version: developmentPolicy.version,
      work_intent_id: developmentWorkIntentId,
      transport: "registry",
      bundle: advisedBundle
    });
  const advisedOnline = await kernelPost("/kernel/v0/package-imports", advisedOnlineCommand);
  assert.equal(advisedOnline.response.status, 201, JSON.stringify(advisedOnline.body));
  assert.equal(advisedOnline.body.import_receipt.admissible, true);
  assert.deepEqual(advisedOnline.body.import_receipt.verification_result.advisory_responses,
    [{ advisory_id: "ADV-T12-LOW", kind: "package_advisory", severity: "low", response: "notify_only" }]);

  const revocationDocument = {
    schema_version: "alphonse.package_advisory.v0.1",
    advisory_id: "REV-T12-KEY-WIDE",
    publisher_id: publisher.publisher.publisher_id,
    package_id: root.manifest.package_id,
    manifest_digest: sha256Digest(root.manifest),
    package_artifact_digest: root.manifest.package_artifact_digest,
    severity: "critical",
    evidence: "Controlled delegated-key revocation rehearsal.",
    remediation: "Rotate the delegated key and republish every affected Package.",
    release_key_id: root.manifest.release_key_id,
    compromise_effective_at: new Date(Date.now() - 1_000).toISOString(),
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
  };
  const revocation = { document: revocationDocument,
    signature: signDocument(revocationDocument, publisher.root.privateKey) };
  const revocationPublished = await post(primaryUrl, "/registry/v0/advisories", revocation,
    primaryRegistryHeaders);
  assert.equal(revocationPublished.response.status, 201, JSON.stringify(revocationPublished.body));
  const siblingBundle = await request(primaryUrl,
    "/registry/v0/bundles?package_id=com.alphonse.inventory.shared&semantic_version=1.0.0",
    { headers: primaryRegistryHeaders });
  assert.equal(siblingBundle.response.status, 200, JSON.stringify(siblingBundle.body));
  assert.ok(siblingBundle.body.advisories
    .some((entry) => entry.document.advisory_id === revocationDocument.advisory_id));
  const mirroredRevocation = await post(mirrorUrl, "/registry/v0/mirrors", siblingBundle.body,
    mirrorRegistryHeaders);
  assert.equal(mirroredRevocation.response.status, 201, JSON.stringify(mirroredRevocation.body));
  assert.ok(mirroredRevocation.body.advisories
    .some((entry) => entry.document.advisory_id === revocationDocument.advisory_id));
  const revokedMirrorImport = await kernelPost("/kernel/v0/package-imports",
    command("t12-import-revoked-mirror", "kernel.package.import", {
      policy_id: mirrorPolicy.policy_id,
      policy_version: mirrorPolicy.version,
      work_intent_id: developmentWorkIntentId,
      transport: "mirror",
      bundle: mirroredRevocation.body
    }));
  assert.equal(revokedMirrorImport.response.status, 201, JSON.stringify(revokedMirrorImport.body));
  assert.equal(revokedMirrorImport.body.import_receipt.admissible, false);
  assert.deepEqual(revokedMirrorImport.body.import_receipt.verification_result.advisory_responses,
    [{ advisory_id: "REV-T12-KEY-WIDE", kind: "release_key_revocation",
      severity: "critical", response: "block_new_import" }]);

  compose("stop", "registry-primary", "registry-mirror");
  const offlineImport = await kernelPost("/kernel/v0/package-imports",
    command("t12-import-offline", "kernel.package.import", {
      policy_id: developmentPolicy.policy_id,
      policy_version: developmentPolicy.version,
      work_intent_id: developmentWorkIntentId,
      transport: "offline_bundle",
      bundle: advisedBundle
    }));
  assert.equal(offlineImport.response.status, 201, JSON.stringify(offlineImport.body));
  assert.equal(offlineImport.body.import_receipt.verification_digest,
    advisedOnline.body.import_receipt.verification_digest);
  assert.equal(offlineImport.body.quarantined_package.quarantine_id, quarantineId);

  await new Promise((resolve) => setTimeout(resolve, 20_500));
  const replayAfterSnapshotExpiry = await kernelPost("/kernel/v0/package-imports", advisedOnlineCommand);
  assert.equal(replayAfterSnapshotExpiry.response.status, 200);
  assert.equal(replayAfterSnapshotExpiry.body.import_receipt.import_receipt_id,
    advisedOnline.body.import_receipt.import_receipt_id);
  const staleOffline = await kernelPost("/kernel/v0/package-imports",
    command("t12-import-stale-offline", "kernel.package.import", {
      policy_id: developmentPolicy.policy_id,
      policy_version: developmentPolicy.version,
      work_intent_id: developmentWorkIntentId,
      transport: "offline_bundle",
      bundle: advisedBundle
    }));
  assert.equal(staleOffline.response.status, 201);
  assert.equal(staleOffline.body.import_receipt.admissible, false);
  assert.ok(staleOffline.body.import_receipt.verification_result.decisions
    .some((entry) => entry.code === "ADVISORY_SNAPSHOT_STALE"));

  const persistedReceipt = await kernelGet(`/kernel/v0/package-import-receipts/${importReceiptId}`);
  assert.equal(persistedReceipt.response.status, 200);
  assert.equal(persistedReceipt.body.import_receipt.immutable, true);
  const persistedQuarantine = await kernelGet(`/kernel/v0/quarantined-packages/${quarantineId}`);
  assert.equal(persistedQuarantine.body.quarantined_package.state, "quarantined");
  assert.equal(persistedQuarantine.body.quarantined_package.deployment_id, null);
  const overview = await kernelGet("/kernel/v0/accountable-work/overview");
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.deployments.count, 0);
  assert.equal((await request(kernelUrl, "/healthz")).response.status, 200);

  const immutableMutation = composeExpectFailure("exec", "-T", "postgres", "psql", "-U", "alphonse", "-d",
    "alphonse_kernel", "-c", `UPDATE kernel_package_import_receipts SET admissible=false WHERE import_receipt_id='${importReceiptId}'`);
  assert.notEqual(immutableMutation.status, 0, "Import Receipt unexpectedly allowed mutation.");

  console.log("Ticket 12 portable trust acceptance passed.");
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
