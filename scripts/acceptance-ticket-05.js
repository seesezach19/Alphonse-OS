import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { sha256Digest } from "../src/canonical-json.js";

const kernelUrl = "http://127.0.0.1:43105";
const dataPlaneUrl = "http://127.0.0.1:43115";
const agentToken = "ticket-05-agent-token-0000000000000001";
const authHeaders = { "content-type": "application/json", authorization: "Bearer local-development-bootstrap-token" };
const composeEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "alphonse-kernel-ticket-05-acceptance",
  KERNEL_PORT: "43105",
  POSTGRES_PORT: "45436",
  DATA_PLANE_PORT: "43115"
};

function compose(...args) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: new URL("..", import.meta.url), env: composeEnvironment, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() };
}

async function kernel(path, options = {}) {
  return request(kernelUrl, path, { ...options, headers: { ...authHeaders, ...(options.headers ?? {}) } });
}

async function post(path, body) {
  return kernel(path, { method: "POST", body: JSON.stringify(body) });
}

async function postAgent(path, body) {
  return kernel(path, { method: "POST", headers: { authorization: `Agent ${agentToken}` }, body: JSON.stringify(body) });
}

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

async function waitUntilHealthy() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${kernelUrl}/healthz`)).ok && (await fetch(`${dataPlaneUrl}/healthz`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Ticket 05 services did not become healthy.");
}

function inventoryCandidate(builderToolkit, contextReceiptId, artifactAttestationId) {
  return {
    schema_version: "alphonse.package_candidate.v0.1",
    identity: {
      package_id: "com.alphonse.inventory.correction",
      version: "0.1.0",
      name: "Inventory Correction",
      summary: "Compare governed inventory observations and propose bounded storefront correction."
    },
    compatibility: { kernel_api: ">=0.1 <0.2" },
    builder_provenance: { builder_toolkit: builderToolkit, context_receipt_ids: [contextReceiptId] },
    dependencies: [],
    exports: [
      {
        kind: "schema", export_id: "inventory_observation", contract_version: "1.0.0",
        content: { type: "object", required: ["source", "sku", "quantity", "observed_at"],
          properties: { source: { type: "string" }, sku: { type: "string" }, quantity: { type: "integer" },
            observed_at: { type: "string", format: "date-time" } } }
      },
      {
        kind: "schema", export_id: "inventory_correction_configuration", contract_version: "1.0.0",
        content: { type: "object", required: ["minimum_available_quantity"],
          properties: { minimum_available_quantity: { type: "integer" } } }
      },
      {
        kind: "skill", export_id: "compare_inventory", contract_version: "1.0.0",
        content: { program: {
          discrepancy: { "-": [{ var: "erp_quantity" }, { var: "storefront_quantity" }] },
          correction_required: { "!==": [{ var: "erp_quantity" }, { var: "storefront_quantity" }] }
        },
          input_schema: { refs: ["inventory_observation"] },
          output_schema: { type: "object", required: ["discrepancy", "correction_required"] },
          steps: ["select authoritative ERP observation", "compare storefront representation", "emit typed discrepancy"],
          context_requirements: { authority: ["authoritative", "representational"], max_age_seconds: 300 },
          uncertainty_behavior: "stop when authority or freshness is unresolved",
          evaluation_ref: "inventory_comparison_evaluation" }
      },
      {
        kind: "evaluation", export_id: "inventory_comparison_evaluation", contract_version: "1.0.0",
        content: { skill_ref: "compare_inventory", cases: [
          { case_id: "discrepancy", input: { erp_quantity: 24, storefront_quantity: 18 },
            expected: { discrepancy: 6, correction_required: true } },
          { case_id: "already_equal", input: { erp_quantity: 10, storefront_quantity: 10 },
            expected: { discrepancy: 0, correction_required: false } }
        ] }
      },
      {
        kind: "capability", export_id: "inventory_read", contract_version: "1.0.0",
        content: { effect_class: "read_only", skill_ref: "compare_inventory",
          context_requirements: { authority: ["authoritative", "representational"], max_age_seconds: 300 } }
      },
      {
        kind: "capability", export_id: "inventory_correction", contract_version: "1.0.0",
        content: { effect_class: "external_write", operation: "set_storefront_inventory",
          supported_operations: ["set_storefront_inventory"],
          declared_effects: [{ target: "storefront.inventory", action: "set_quantity", maximum_items: 1 }],
          context_requirements: { authority: ["authoritative", "representational"], max_age_seconds: 300 },
          idempotency: { key: "storefront_id+sku+target_quantity", duplicate_result: "return_original_effect" },
          evidence: { required: ["storefront_response", "post_write_observation"] },
          recovery: { strategy: "restore_previous_quantity", uncertainty: "reconcile_before_retry" },
          accountability_contract_ref: "inventory_correction_accountability",
          adapter_ref: "storefront_inventory_adapter" }
      },
      {
        kind: "adapter", export_id: "storefront_inventory_adapter", contract_version: "1.0.0",
        content: { artifact_ref: `oci://registry.example.invalid/inventory-adapter@sha256:${"a".repeat(64)}`,
          artifact_digest: `sha256:${"a".repeat(64)}`, artifact_attestation_id: artifactAttestationId,
          operations: ["set_storefront_inventory"],
          operation_effects: { set_storefront_inventory: { target: "storefront.inventory", action: "set_quantity" } } }
      },
      {
        kind: "view", export_id: "inventory_exception_view", contract_version: "1.0.0",
        content: { fields: ["sku", "erp_quantity", "storefront_quantity", "freshness", "proposed_correction"],
          actions: ["request_correction_review"] }
      },
      {
        kind: "accountability_contract", export_id: "inventory_correction_accountability", contract_version: "1.0.0",
        content: { outcome: "storefront quantity matches admitted ERP observation",
          evidence_requirements: ["effect receipt", "fresh post-write observation"], deadline_seconds: 120,
          escalation: { on_timeout: "operator_review" }, recovery: { on_failure: "restore_previous_quantity" } }
      }
    ]
  };
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait");

  const toolkit = {
    package_id: "dev.mattpocock.builder-toolkit",
    version: "1.0.0",
    artifact_digest: `sha256:${"b".repeat(64)}`,
    skill_exports: ["grill-with-docs", "to-spec", "prototype", "writing-great-skills", "implement", "code-review"]
      .map((exportId, index) => ({ export_id: exportId, contract_version: "1.0.0",
        export_digest: `sha256:${String(index + 1).repeat(64)}` }))
  };
  const toolkitDigest = sha256Digest(toolkit);
  const now = Date.now();

  const human = await post("/kernel/v0/principals", command("t04-human", "kernel.principal.create",
    { principal_type: "human", display_name: "Package Sponsor" }));
  assert.equal(human.response.status, 201);
  const humanId = human.body.principal.principal_id;
  const agent = await post("/kernel/v0/principals", command("t04-agent", "kernel.principal.create",
    { principal_type: "agent", display_name: "Builder Agent" }));
  assert.equal(agent.response.status, 201);
  const agentId = agent.body.principal.principal_id;

  const passport = await post("/kernel/v0/agent-passports", command("t04-passport", "kernel.agent_passport.issue", {
    agent_principal_id: agentId, sponsor_principal_id: humanId,
    runtime: { kind: "codex", version: "workspace" }, model_configuration: { provider: "openai", model: "frontier" },
    package_skill_configuration: { builder_toolkit: toolkit }, agent_authentication_token: agentToken,
    permitted_intent_classes: ["package_build", "capability_activation"], provenance: { source: "ticket-05-acceptance" },
    valid_from: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 3_600_000).toISOString()
  }));
  assert.equal(passport.response.status, 201);
  const passportId = passport.body.passport.passport_id;

  const proposal = await postAgent("/kernel/v0/work-intent-proposals", command("t04-proposal", "kernel.work_intent.propose", {
    passport_id: passportId, intent_class: "package_build",
    objective: "Build an immutable inventory correction Operational Package.",
    requested_outcome: "Publish validated and simulated package bytes.", scope: { systems: ["erp", "storefront"] },
    constraints: { no_activation: true, no_external_effects: true }
  }));
  assert.equal(proposal.response.status, 201);
  const confirmed = await post(`/kernel/v0/work-intent-proposals/${proposal.body.proposal.proposal_id}/confirm`,
    command("t04-confirm", "kernel.work_intent.confirm", {}));
  assert.equal(confirmed.response.status, 201);
  const workIntentId = confirmed.body.work_intent.work_intent_id;

  const session = await post("/kernel/v0/build-sessions", command("t04-session", "kernel.build_session.open", {
    principal_id: agentId, passport_id: passportId, work_intent_id: workIntentId,
    base_references: { kernel_protocol: "0.1.0", toolkit_digest: toolkitDigest, builder_toolkit: toolkit },
    expires_at: new Date(now + 1_800_000).toISOString()
  }));
  assert.equal(session.response.status, 201);
  assert.deepEqual(session.body.build_session.base_references.builder_toolkit.skill_exports, toolkit.skill_exports);
  const buildSessionId = session.body.build_session.build_session_id;

  const artifactAttestation = await post("/kernel/v0/artifact-attestations", command("t04-artifact-attestation",
    "kernel.artifact.trust_attest", {
      artifact_ref: `oci://registry.example.invalid/inventory-adapter@sha256:${"a".repeat(64)}`,
      artifact_digest: `sha256:${"a".repeat(64)}`, build_attestation_digest: `sha256:${"c".repeat(64)}`
    }));
  assert.equal(artifactAttestation.response.status, 201);
  const artifactAttestationId = artifactAttestation.body.artifact_attestation.artifact_attestation_id;

  const grant = await post("/kernel/v0/context-access-grants", command("t04-context-grant", "kernel.context_access_grant.issue", {
    passport_id: passportId, work_intent_id: workIntentId,
    purpose: "Construct and observationally simulate an inventory correction package.",
    subjects: ["SKU-100"], sources: ["erp", "storefront"], sensitivity_classes: ["internal"],
    max_items: 2, max_age_seconds: 300, expires_at: new Date(now + 1_200_000).toISOString()
  }));
  assert.equal(grant.response.status, 201);
  const delivered = await request(dataPlaneUrl, "/v0/inventory/query", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Agent ${agentToken}` },
    body: JSON.stringify({ grant_id: grant.body.context_access_grant.grant_id, subjects: ["SKU-100"], sources: ["erp", "storefront"] })
  });
  assert.equal(delivered.response.status, 200);
  const contextReceiptId = delivered.body.delivery.receipt_id;
  const candidate = inventoryCandidate(toolkit, contextReceiptId, artifactAttestationId);

  const invalidCandidate = structuredClone(candidate);
  invalidCandidate.configuration = { auth: "sk-must-never-persist-1234567890" };
  const correction = invalidCandidate.exports.find((entry) => entry.export_id === "inventory_correction");
  correction.content.operation = "invent_inventory";
  delete correction.content.declared_effects;
  correction.content.idempotency = {};
  correction.content.evidence = {};
  correction.content.recovery = {};
  correction.content.adapter_ref = "missing_adapter";
  const readCapability = invalidCandidate.exports.find((entry) => entry.export_id === "inventory_read");
  delete readCapability.content.context_requirements;
  const invalid = await postAgent("/kernel/v0/package-validations", command("t04-invalid-validation",
    "kernel.package_candidate.validate", { build_session_id: buildSessionId, candidate: invalidCandidate }));
  assert.equal(invalid.response.status, 201);
  assert.equal(invalid.body.validation_receipt.valid, false);
  const issueCodes = new Set(invalid.body.validation_receipt.issues.map((entry) => entry.code));
  for (const code of ["SECRET_MATERIAL_PROHIBITED", "UNDECLARED_EFFECT", "IDEMPOTENCY_REQUIRED", "EVIDENCE_REQUIRED",
    "RECOVERY_REQUIRED", "CONTEXT_AUTHORITY_REQUIRED", "CONTEXT_FRESHNESS_REQUIRED", "INCOMPATIBLE_EXPORT_REFERENCE",
    "UNSUPPORTED_CORRECTION_OPERATION"]) assert.ok(issueCodes.has(code), `missing ${code}`);
  const unsupported = invalid.body.validation_receipt.issues.find((entry) => entry.code === "UNSUPPORTED_CORRECTION_OPERATION");
  assert.match(unsupported.path, /^candidate\.exports\[\d+\]\.content\.operation$/);
  assert.deepEqual(unsupported.supported_operations, ["set_storefront_inventory"]);
  const inspectedInvalid = await kernel(`/kernel/v0/package-validations/${invalid.body.validation_receipt.validation_receipt_id}`);
  assert.doesNotMatch(JSON.stringify(inspectedInvalid.body), /sk-must-never-persist/);

  const malformedEvaluationCandidate = structuredClone(candidate);
  malformedEvaluationCandidate.exports.find((entry) => entry.kind === "evaluation").content.cases = [{ case_id: "bad" }];
  const malformedEvaluation = await postAgent("/kernel/v0/package-validations", command("t04-malformed-evaluation",
    "kernel.package_candidate.validate", { build_session_id: buildSessionId, candidate: malformedEvaluationCandidate }));
  assert.equal(malformedEvaluation.response.status, 201);
  assert.equal(malformedEvaluation.body.validation_receipt.valid, false);
  assert.ok(malformedEvaluation.body.validation_receipt.issues.some((entry) => entry.code === "EVALUATION_CONTRACT_INCOMPLETE"));
  const malformedExportsCandidate = structuredClone(candidate);
  malformedExportsCandidate.exports = {};
  const malformedExports = await postAgent("/kernel/v0/package-validations", command("t04-malformed-exports",
    "kernel.package_candidate.validate", { build_session_id: buildSessionId, candidate: malformedExportsCandidate }));
  assert.equal(malformedExports.response.status, 201);
  assert.equal(malformedExports.body.validation_receipt.valid, false);
  assert.ok(malformedExports.body.validation_receipt.issues.some((entry) => entry.code === "EXPORTS_REQUIRED"));

  async function validate(candidateValue, suffix) {
    return postAgent("/kernel/v0/package-validations", command(`t04-validation-${suffix}`,
      "kernel.package_candidate.validate", { build_session_id: buildSessionId, candidate: candidateValue }));
  }
  async function simulate(candidateValue, validationId, mode, suffix) {
    let observationalBinding = {};
    if (mode === "observational_read_only") {
      const observed = await request(dataPlaneUrl, "/v0/inventory/simulate", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Agent ${agentToken}` },
        body: JSON.stringify({ grant_id: grant.body.context_access_grant.grant_id, subjects: ["SKU-100"],
          sources: ["erp", "storefront"], candidate_digest: sha256Digest(candidateValue), validation_receipt_id: validationId,
          skill_export_id: "compare_inventory",
          skill_content: candidateValue.exports.find((entry) => entry.export_id === "compare_inventory").content })
      });
      assert.equal(observed.response.status, 200);
      observationalBinding = { observational_attestation: observed.body.observational_attestation,
        observational_attestation_signature: observed.body.observational_attestation_signature };
    }
    return postAgent("/kernel/v0/package-simulations", command(`t04-simulation-${mode}-${suffix}`,
      "kernel.package_candidate.simulate", { validation_receipt_id: validationId, candidate: candidateValue, mode,
        ...observationalBinding }));
  }

  const valid = await validate(candidate, "original");
  assert.equal(valid.response.status, 201);
  assert.equal(valid.body.validation_receipt.valid, true);
  assert.equal(valid.body.validation_receipt.issues.length, 0);
  assert.equal(valid.body.validation_receipt.toolkit_digest, toolkitDigest);
  const validationId = valid.body.validation_receipt.validation_receipt_id;
  const validReplay = await validate(candidate, "original");
  assert.equal(validReplay.response.status, 200);
  assert.deepEqual(validReplay.body, valid.body);

  const fixture = await simulate(candidate, validationId, "deterministic_fixture", "original");
  assert.equal(fixture.response.status, 201);
  assert.equal(fixture.body.simulation_receipt.passed, true);
  assert.equal(fixture.body.simulation_receipt.authority_granted, false);
  assert.equal(fixture.body.simulation_receipt.fidelity, "deterministic_fixture");
  const unsignedObservation = await request(dataPlaneUrl, "/v0/inventory/simulate", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Agent ${agentToken}` },
    body: JSON.stringify({ grant_id: grant.body.context_access_grant.grant_id, subjects: ["SKU-100"],
      sources: ["erp", "storefront"], candidate_digest: sha256Digest(candidate), validation_receipt_id: validationId,
      skill_export_id: "compare_inventory",
      skill_content: candidate.exports.find((entry) => entry.export_id === "compare_inventory").content })
  });
  assert.equal(unsignedObservation.response.status, 200);
  const unverifiedObservation = await postAgent("/kernel/v0/package-simulations", command("t04-unverified-observation",
    "kernel.package_candidate.simulate", { validation_receipt_id: validationId, candidate, mode: "observational_read_only",
      observational_attestation: unsignedObservation.body.observational_attestation,
      observational_attestation_signature: `hmac-sha256:${"0".repeat(64)}` }));
  assert.equal(unverifiedObservation.response.status, 403);
  assert.equal(unverifiedObservation.body.error.code, "INVALID_OBSERVATIONAL_ATTESTATION_SIGNATURE");
  const observational = await simulate(candidate, validationId, "observational_read_only", "original");
  assert.equal(observational.response.status, 201);
  assert.match(observational.body.simulation_receipt.input_digest, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(observational.body.simulation_receipt.context_receipt_id, null);
  assert.equal(observational.body.simulation_receipt.authority_granted, false);
  assert.equal(observational.body.simulation_receipt.fidelity, "data_plane_attested_observational_read_only");
  assert.equal(observational.body.simulation_receipt.attester_id, "reference-data-plane");
  assert.match(observational.body.simulation_receipt.attestation_signature, /^hmac-sha256:[0-9a-f]{64}$/);

  const publicationInput = { build_session_id: buildSessionId, validation_receipt_id: validationId,
    simulation_receipt_ids: [fixture.body.simulation_receipt.simulation_receipt_id,
      observational.body.simulation_receipt.simulation_receipt_id], candidate };
  const published = await postAgent("/kernel/v0/package-versions", command("t04-publication",
    "kernel.package_version.publish", publicationInput));
  assert.equal(published.response.status, 201);
  assert.equal(published.body.package_version.artifact_digest, sha256Digest(candidate));
  assert.equal(published.body.package_version.dependency_digest, sha256Digest([]));
  assert.equal(published.body.package_version.immutable, true);
  assert.equal(published.body.package_version.authority_granted, false);
  assert.match(published.body.package_version.publication_signature, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.equal(published.body.package_version.signature_verified, true);
  assert.equal(published.body.package_version.publication_key_id, "local-package-signing-key-v1");
  assert.equal(published.body.package_version.normalized_exports.length, candidate.exports.length);
  const packageVersionId = published.body.package_version.package_version_id;
  const publicationReplay = await postAgent("/kernel/v0/package-versions", command("t04-publication",
    "kernel.package_version.publish", publicationInput));
  assert.equal(publicationReplay.response.status, 200);
  assert.deepEqual(publicationReplay.body, published.body);
  const inspected = await kernel(`/kernel/v0/package-versions/${packageVersionId}`);
  assert.equal(inspected.body.package_version.artifact_digest, sha256Digest(candidate));
  assert.equal(inspected.body.package_version.signature_verified, true);
  assert.equal(inspected.body.package_version.candidate.identity.package_id, "com.alphonse.inventory.correction");
  const butler = await kernel("/kernel/v0/accountable-work/overview");
  const packageProjection = butler.body.accountable_work.items[0].package_versions[0];
  assert.equal(packageProjection.package_version_id, packageVersionId);
  assert.equal(packageProjection.authority_granted, false);
  assert.equal(Object.hasOwn(packageProjection, "candidate"), false);

  const changedCandidate = structuredClone(candidate);
  changedCandidate.identity.summary = "Changed bytes under the same identity and semantic version.";
  const changedValidation = await validate(changedCandidate, "changed");
  assert.equal(changedValidation.body.validation_receipt.valid, true);
  const changedValidationId = changedValidation.body.validation_receipt.validation_receipt_id;
  const changedFixture = await simulate(changedCandidate, changedValidationId, "deterministic_fixture", "changed");
  const changedObservational = await simulate(changedCandidate, changedValidationId, "observational_read_only", "changed");
  const collision = await postAgent("/kernel/v0/package-versions", command("t04-publication-changed",
    "kernel.package_version.publish", { build_session_id: buildSessionId, validation_receipt_id: changedValidationId,
      simulation_receipt_ids: [changedFixture.body.simulation_receipt.simulation_receipt_id,
        changedObservational.body.simulation_receipt.simulation_receipt_id], candidate: changedCandidate }));
  assert.equal(collision.response.status, 409);
  assert.equal(collision.body.error.code, "PACKAGE_VERSION_BYTES_CONFLICT");

  compose("stop");
  compose("up", "--wait");
  await waitUntilHealthy();
  const persisted = await kernel(`/kernel/v0/package-versions/${packageVersionId}`);
  assert.equal(persisted.body.package_version.publication_signature, published.body.package_version.publication_signature);

  const activationProposal = await postAgent("/kernel/v0/work-intent-proposals", command("t05-activation-proposal",
    "kernel.work_intent.propose", { passport_id: passportId, intent_class: "capability_activation",
      objective: "Stage and activate exact bounded inventory correction authority.",
      requested_outcome: "Approve one exact correction Capability without admitting execution.",
      scope: { systems: ["erp", "storefront"] }, constraints: { bounded_effects_only: true } }));
  assert.equal(activationProposal.response.status, 201);
  const activationIntent = await post(`/kernel/v0/work-intent-proposals/${activationProposal.body.proposal.proposal_id}/confirm`,
    command("t05-activation-confirm", "kernel.work_intent.confirm", {}));
  assert.equal(activationIntent.response.status, 201);
  const activationWorkIntentId = activationIntent.body.work_intent.work_intent_id;
  const packageVersion = persisted.body.package_version;
  const exportEntry = (exportId) => candidate.exports.find((entry) => entry.export_id === exportId);
  const configurationSchema = exportEntry("inventory_correction_configuration");
  const adapterExport = exportEntry("storefront_inventory_adapter");
  const capabilityExport = exportEntry("inventory_correction");
  const plan = {
    schema_version: "alphonse.deployment_plan.v0.1",
    work_intent_id: activationWorkIntentId,
    package: {
      package_version_id: packageVersionId, package_id: packageVersion.package_id,
      semantic_version: packageVersion.semantic_version, artifact_digest: packageVersion.artifact_digest,
      manifest_digest: packageVersion.manifest_digest, dependency_digest: packageVersion.dependency_digest
    },
    dependency_lock: [],
    extension_bindings: [],
    configuration_binding: {
      schema_export_id: configurationSchema.export_id,
      schema_export_digest: sha256Digest(configurationSchema.content),
      redacted_values: { minimum_available_quantity: 5 },
      credential_bindings: [{ binding_ref: "credential://storefront/inventory-writer",
        revision: "storefront-writer-rev-7", scopes: ["storefront.inventory.write"] }]
    },
    adapter_bindings: [{ adapter_export_id: adapterExport.export_id,
      adapter_export_digest: sha256Digest(adapterExport.content), target_system: "storefront-staging" }],
    capability_candidates: [{ capability_export_id: capabilityExport.export_id,
      capability_export_digest: sha256Digest(capabilityExport.content),
      context_binding: { sources: ["erp", "storefront"],
        authority: ["authoritative", "representational"], max_age_seconds: 300 },
      credential_binding_ref: "credential://storefront/inventory-writer",
      effect_limits: [{ system: "storefront-staging", target: "storefront.inventory", action: "set_quantity", maximum_items: 1 }] }]
  };

  const invalidPlan = structuredClone(plan);
  invalidPlan.dependency_lock = [{ package_id: "com.example.ambient", artifact_digest: `sha256:${"d".repeat(64)}` }];
  invalidPlan.extension_bindings = [{ extension_point: "ambient", provider: "undeclared" }];
  invalidPlan.configuration_binding.redacted_values.api_key = "sk-must-never-persist-ticket-05";
  invalidPlan.adapter_bindings[0].adapter_export_digest = `sha256:${"e".repeat(64)}`;
  const invalidPlanResult = await post("/kernel/v0/deployment-plan-validations", command("t05-plan-invalid",
    "kernel.deployment_plan.validate", { plan: invalidPlan }));
  assert.equal(invalidPlanResult.response.status, 201);
  assert.equal(invalidPlanResult.body.validation_receipt.valid, false);
  assert.equal(Object.hasOwn(invalidPlanResult.body, "deployment_plan"), false);
  const invalidCodes = new Set(invalidPlanResult.body.validation_receipt.issues.map((entry) => entry.code));
  for (const code of ["DEPENDENCY_LOCK_CONFLICT", "UNDECLARED_EXTENSION_BEHAVIOR", "SECRET_MATERIAL_PROHIBITED",
    "ADAPTER_BINDING_MISMATCH"]) assert.ok(invalidCodes.has(code), `missing ${code}`);
  const invalidReceipt = await kernel(`/kernel/v0/deployment-plan-validations/${invalidPlanResult.body.validation_receipt.validation_receipt_id}`);
  assert.doesNotMatch(JSON.stringify(invalidReceipt.body), /sk-must-never-persist-ticket-05/);

  async function validatePlan(planValue, suffix) {
    return post("/kernel/v0/deployment-plan-validations", command(`t05-plan-${suffix}`,
      "kernel.deployment_plan.validate", { plan: planValue }));
  }
  async function reviewPlan(planResult, decision, suffix) {
    return post(`/kernel/v0/deployment-plans/${planResult.body.deployment_plan.deployment_plan_id}/technical-reviews`,
      command(`t05-review-${suffix}`, "kernel.deployment_plan.technical_review", {
        plan_digest: planResult.body.deployment_plan.plan_digest, decision, rationale: `${decision} exact plan in acceptance proof.`
      }));
  }

  const changesPlan = structuredClone(plan);
  changesPlan.configuration_binding.redacted_values.minimum_available_quantity = 6;
  const changesValidation = await validatePlan(changesPlan, "changes");
  assert.equal(changesValidation.body.validation_receipt.valid, true);
  const changesReview = await reviewPlan(changesValidation, "request_changes", "changes");
  assert.equal(changesReview.response.status, 201);
  assert.equal(changesReview.body.technical_review.decision, "request_changes");
  const blockedStage = await post("/kernel/v0/deployments", command("t05-stage-blocked", "kernel.deployment.stage", {
    deployment_plan_id: changesValidation.body.deployment_plan.deployment_plan_id,
    technical_review_id: changesReview.body.technical_review.technical_review_id,
    plan_digest: changesValidation.body.deployment_plan.plan_digest
  }));
  assert.equal(blockedStage.response.status, 409);
  assert.equal(blockedStage.body.error.code, "TECHNICAL_REVIEW_NOT_PASSED");

  const rejectedPlan = structuredClone(plan);
  rejectedPlan.configuration_binding.redacted_values.minimum_available_quantity = 7;
  const rejectedValidation = await validatePlan(rejectedPlan, "rejected");
  const rejectedReview = await reviewPlan(rejectedValidation, "reject", "rejected");
  assert.equal(rejectedReview.body.technical_review.decision, "reject");

  const validPlan = await validatePlan(plan, "valid");
  assert.equal(validPlan.response.status, 201);
  assert.equal(validPlan.body.validation_receipt.valid, true, JSON.stringify(validPlan.body.validation_receipt.issues));
  assert.equal(validPlan.body.deployment_plan.authority_granted, false);
  const validPlanReplay = await validatePlan(plan, "valid");
  assert.equal(validPlanReplay.response.status, 200);
  assert.deepEqual(validPlanReplay.body, validPlan.body);
  const deploymentPlanId = validPlan.body.deployment_plan.deployment_plan_id;
  const technicalReview = await reviewPlan(validPlan, "pass", "pass");
  assert.equal(technicalReview.response.status, 201);
  assert.equal(technicalReview.body.technical_review.decision, "pass");
  assert.equal(technicalReview.body.technical_review.authority_granted, false);

  const staged = await post("/kernel/v0/deployments", command("t05-stage", "kernel.deployment.stage", {
    deployment_plan_id: deploymentPlanId,
    technical_review_id: technicalReview.body.technical_review.technical_review_id,
    plan_digest: validPlan.body.deployment_plan.plan_digest
  }));
  assert.equal(staged.response.status, 201);
  assert.equal(staged.body.deployment.state, "staged");
  assert.equal(staged.body.deployment.authority_granted, false);
  assert.equal(staged.body.deployment.business_approval_state, "not_approved");
  assert.equal(staged.body.deployment.capability_activation_state, "inactive");
  const deploymentId = staged.body.deployment.deployment_id;

  const actionCardResult = await kernel(`/kernel/v0/deployments/${deploymentId}/capabilities/inventory_correction/action-card`);
  assert.equal(actionCardResult.response.status, 200);
  const actionCard = actionCardResult.body.action_card;
  assert.deepEqual(actionCard.source_reads.sources, ["erp", "storefront"]);
  assert.deepEqual(actionCard.write_target, [{ system: "storefront-staging", target: "storefront.inventory", action: "set_quantity" }]);
  assert.equal(actionCard.credential_scope.revision, "storefront-writer-rev-7");
  assert.deepEqual(actionCard.credential_scope.scopes, ["storefront.inventory.write"]);
  assert.deepEqual(actionCard.evidence.required, ["storefront_response", "post_write_observation"]);
  assert.equal(actionCard.recovery.strategy, "restore_previous_quantity");
  assert.equal(actionCard.current_revision, 0);
  assert.equal(actionCard.states.package, "published");
  assert.equal(actionCard.states.deployment, "staged");
  assert.equal(actionCard.states.business_approval, "not_approved");
  assert.equal(actionCard.states.capability_activation, "inactive");

  const fakeId = "00000000-0000-4000-8000-000000000599";
  const unapprovedAdmission = await post("/kernel/v0/capability-admission/check", {
    deployment_id: deploymentId, business_approval_id: fakeId, capability_activation_id: fakeId,
    capability_export_id: "inventory_correction", capability_export_digest: actionCard.affected_objects.capability_export_digest,
    authority_digest: actionCard.affected_objects.authority_digest, expected_revision: 0
  });
  assert.equal(unapprovedAdmission.response.status, 409);
  assert.equal(unapprovedAdmission.body.error.code, "CAPABILITY_UNAPPROVED");

  const approvalInput = {
    deployment_id: deploymentId, capability_export_id: "inventory_correction",
    capability_export_digest: actionCard.affected_objects.capability_export_digest,
    authority_digest: actionCard.affected_objects.authority_digest,
    action_card_digest: actionCard.action_card_digest, expected_revision: actionCard.current_revision
  };
  const staleApproval = await post("/kernel/v0/capability-business-approvals", command("t05-approval-stale",
    "kernel.capability.business_approve", { ...approvalInput, expected_revision: 1 }));
  assert.equal(staleApproval.response.status, 409);
  assert.equal(staleApproval.body.error.code, "STALE_ACTION_REVISION");
  const approvalCommand = command("t05-approval", "kernel.capability.business_approve", approvalInput);
  const approved = await post("/kernel/v0/capability-business-approvals", approvalCommand);
  assert.equal(approved.response.status, 201);
  assert.equal(approved.body.business_approval.capability_authority_granted, false);
  assert.equal(approved.body.business_approval.execution_authority_granted, false);
  const businessApprovalId = approved.body.business_approval.business_approval_id;
  const approvedReplay = await post("/kernel/v0/capability-business-approvals", approvalCommand);
  assert.equal(approvedReplay.response.status, 200);
  assert.deepEqual(approvedReplay.body, approved.body);

  const inactiveAdmission = await post("/kernel/v0/capability-admission/check", {
    deployment_id: deploymentId, business_approval_id: businessApprovalId, capability_activation_id: fakeId,
    capability_export_id: "inventory_correction", capability_export_digest: approvalInput.capability_export_digest,
    authority_digest: approvalInput.authority_digest, expected_revision: 0
  });
  assert.equal(inactiveAdmission.response.status, 409);
  assert.equal(inactiveAdmission.body.error.code, "CAPABILITY_INACTIVE");

  const activationCardResult = await kernel(`/kernel/v0/deployments/${deploymentId}/capabilities/inventory_correction/action-card`);
  const activationCard = activationCardResult.body.action_card;
  assert.equal(activationCard.states.business_approval, "approved");
  assert.equal(activationCard.states.capability_activation, "inactive");
  assert.equal(activationCard.operation_id, "kernel.capability_activation.activate");
  const activationCommand = command("t05-activation", "kernel.capability_activation.activate", {
      business_approval_id: businessApprovalId,
      deployment_id: deploymentId, capability_export_id: "inventory_correction",
      capability_export_digest: activationCard.affected_objects.capability_export_digest,
      authority_digest: activationCard.affected_objects.authority_digest,
      action_card_digest: activationCard.action_card_digest, expected_revision: activationCard.current_revision });
  const activated = await post("/kernel/v0/capability-activations", activationCommand);
  assert.equal(activated.response.status, 201);
  assert.equal(activated.body.capability_activation.state, "active");
  assert.equal(activated.body.capability_activation.capability_authority_granted, true);
  assert.equal(activated.body.capability_activation.execution_authority_granted, false);
  assert.equal(activated.body.capability_activation.to_revision, 1);
  const capabilityActivationId = activated.body.capability_activation.capability_activation_id;
  const activatedReplay = await post("/kernel/v0/capability-activations", activationCommand);
  assert.equal(activatedReplay.response.status, 200);
  assert.deepEqual(activatedReplay.body, activated.body);

  const staleAdmission = await post("/kernel/v0/capability-admission/check", {
    deployment_id: deploymentId, business_approval_id: businessApprovalId, capability_activation_id: capabilityActivationId,
    capability_export_id: "inventory_correction", capability_export_digest: approvalInput.capability_export_digest,
    authority_digest: approvalInput.authority_digest, expected_revision: 0
  });
  assert.equal(staleAdmission.response.status, 409);
  assert.equal(staleAdmission.body.error.code, "STALE_ACTION_REVISION");
  const wrongVersionAdmission = await post("/kernel/v0/capability-admission/check", {
    deployment_id: deploymentId, business_approval_id: businessApprovalId, capability_activation_id: fakeId,
    capability_export_id: "inventory_correction", capability_export_digest: approvalInput.capability_export_digest,
    authority_digest: approvalInput.authority_digest, expected_revision: 1
  });
  assert.equal(wrongVersionAdmission.response.status, 409);
  assert.equal(wrongVersionAdmission.body.error.code, "CAPABILITY_VERSION_MISMATCH");
  const admitted = await post("/kernel/v0/capability-admission/check", {
    deployment_id: deploymentId, business_approval_id: businessApprovalId, capability_activation_id: capabilityActivationId,
    capability_export_id: "inventory_correction", capability_export_digest: approvalInput.capability_export_digest,
    authority_digest: approvalInput.authority_digest, expected_revision: 1
  });
  assert.equal(admitted.response.status, 200);
  assert.equal(admitted.body.admissible, true);
  assert.equal(admitted.body.capability_authority_granted, true);
  assert.equal(admitted.body.execution_envelope_created, false);

  const authorityOverview = await kernel("/kernel/v0/accountable-work/overview");
  assert.equal(authorityOverview.body.deployments.count, 1);
  const projectedCard = authorityOverview.body.deployments.items[0].action_cards[0];
  assert.equal(projectedCard.states.package, "published");
  assert.equal(projectedCard.states.deployment, "staged");
  assert.equal(projectedCard.states.business_approval, "approved");
  assert.equal(projectedCard.states.capability_activation, "active");
  assert.equal(projectedCard.current_revision, 1);
  assert.equal(projectedCard.operation_id, null);

  compose("stop");
  compose("up", "--wait");
  await waitUntilHealthy();
  const persistedActivation = await kernel(`/kernel/v0/capability-activations/${capabilityActivationId}`);
  assert.equal(persistedActivation.body.capability_activation.state, "active");
  const persistedCard = await kernel(`/kernel/v0/deployments/${deploymentId}/capabilities/inventory_correction/action-card`);
  assert.equal(persistedCard.body.action_card.states.capability_activation, "active");
  assert.equal(persistedCard.body.action_card.current_revision, 1);

  console.log("Ticket 05 black-box acceptance passed.");
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
