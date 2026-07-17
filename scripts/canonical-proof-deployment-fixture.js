import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { sha256Digest } from "../src/canonical-json.js";

export async function createCanonicalProofDeployment({ kernel, dataPlane, agentToken }) {
  const toolkit = {
    package_id: "dev.mattpocock.builder-toolkit",
    version: "1.0.0",
    artifact_digest: `sha256:${"b".repeat(64)}`,
    skill_exports: ["grill-with-docs", "to-spec", "prototype", "writing-great-skills", "implement", "code-review"]
      .map((exportId, index) => ({ export_id: exportId, contract_version: "1.0.0",
        export_digest: `sha256:${String(index + 1).repeat(64)}` }))
  };
  const now = Date.now();
  const command = (operationId, input) => ({ command_id: randomUUID(), operation_id: operationId, input });
  const post = (path, body) => kernel(path, { method: "POST", body: JSON.stringify(body) });
  const postAgent = (path, body) => kernel(path, {
    method: "POST", headers: { authorization: `Agent ${agentToken}` }, body: JSON.stringify(body)
  });

  const human = await post("/kernel/v0/principals", command("kernel.principal.create",
    { principal_type: "human", display_name: "Canonical Proof Sponsor" }));
  const agent = await post("/kernel/v0/principals", command("kernel.principal.create",
    { principal_type: "agent", display_name: "Canonical Proof Builder" }));
  assert.equal(human.response.status, 201);
  assert.equal(agent.response.status, 201);
  const passport = await post("/kernel/v0/agent-passports", command("kernel.agent_passport.issue", {
    agent_principal_id: agent.body.principal.principal_id,
    sponsor_principal_id: human.body.principal.principal_id,
    runtime: { kind: "codex", version: "workspace" },
    model_configuration: { provider: "openai", model: "frontier" },
    package_skill_configuration: { builder_toolkit: toolkit },
    agent_authentication_token: agentToken,
    permitted_intent_classes: ["package_build", "capability_activation"],
    provenance: { source: "canonical-proof-deployment-fixture" },
    valid_from: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 3_600_000).toISOString()
  }));
  assert.equal(passport.response.status, 201);

  const proposal = await postAgent("/kernel/v0/work-intent-proposals", command("kernel.work_intent.propose", {
    passport_id: passport.body.passport.passport_id,
    intent_class: "package_build",
    objective: "Publish exact canonical observation semantics for the deterministic proof.",
    requested_outcome: "One staged Operational Package with an immutable source delivery schema.",
    scope: { systems: ["webhook", "mock-crm"] }, constraints: { no_external_effects: true }
  }));
  const intent = await post(`/kernel/v0/work-intent-proposals/${proposal.body.proposal.proposal_id}/confirm`,
    command("kernel.work_intent.confirm", {}));
  const session = await post("/kernel/v0/build-sessions", command("kernel.build_session.open", {
    principal_id: agent.body.principal.principal_id,
    passport_id: passport.body.passport.passport_id,
    work_intent_id: intent.body.work_intent.work_intent_id,
    base_references: { kernel_protocol: "0.1.0", toolkit_digest: sha256Digest(toolkit), builder_toolkit: toolkit },
    expires_at: new Date(now + 1_800_000).toISOString()
  }));

  const attestation = await post("/kernel/v0/artifact-attestations", command("kernel.artifact.trust_attest", {
    artifact_ref: `oci://registry.example.invalid/canonical-proof-adapter@sha256:${"a".repeat(64)}`,
    artifact_digest: `sha256:${"a".repeat(64)}`,
    build_attestation_digest: `sha256:${"c".repeat(64)}`
  }));
  const contextGrant = await post("/kernel/v0/context-access-grants", command("kernel.context_access_grant.issue", {
    passport_id: passport.body.passport.passport_id,
    work_intent_id: intent.body.work_intent.work_intent_id,
    purpose: "Observationally validate the canonical proof package.",
    subjects: ["SKU-100"], sources: ["erp", "storefront"], sensitivity_classes: ["internal"],
    max_items: 2, max_age_seconds: 300, expires_at: new Date(now + 1_200_000).toISOString()
  }));
  const context = await dataPlane("/v0/inventory/query", {
    method: "POST", headers: { authorization: `Agent ${agentToken}` },
    body: JSON.stringify({ grant_id: contextGrant.body.context_access_grant.grant_id,
      subjects: ["SKU-100"], sources: ["erp", "storefront"] })
  });
  assert.equal(context.response.status, 200);

  const sourceDeliverySchema = {
    kind: "schema",
    export_id: "observation:source.delivery",
    contract_version: "0.1.0",
    content: {
      type: "object",
      additionalProperties: false,
      required: ["delivery_id", "logical_operation_id"],
      properties: {
        delivery_id: { type: "string", minLength: 1, maxLength: 160 },
        logical_operation_id: { type: "string", minLength: 1, maxLength: 160 }
      },
      observation: {
        observation_type: "source.delivery",
        allowed_detail_media_types: ["application/json"],
        required_correlation_roles: ["logical_operation"]
      }
    }
  };
  const tokenizedSourceDeliverySchema = {
    kind: "schema",
    export_id: "observation:source.delivery-equality",
    contract_version: "0.1.0",
    content: {
      type: "object",
      additionalProperties: false,
      required: ["delivery_id", "logical_operation_id", "delivery_identity_equality_token"],
      properties: {
        delivery_id: { type: "string", minLength: 1, maxLength: 160 },
        logical_operation_id: { type: "string", minLength: 1, maxLength: 160 },
        delivery_identity_equality_token: { type: "string", minLength: 1, maxLength: 160 }
      },
      observation: {
        observation_type: "source.delivery",
        allowed_detail_media_types: [],
        required_correlation_roles: ["logical_operation"]
      }
    }
  };
  const candidate = {
    schema_version: "alphonse.package_candidate.v0.1",
    identity: { package_id: "com.alphonse.canonical-proof", version: "0.1.0",
      name: "Canonical Diagnostic Proof", summary: "Exact observation semantics for the stimulus-only proof." },
    compatibility: { kernel_api: ">=0.1 <0.2" },
    builder_provenance: { builder_toolkit: toolkit, context_receipt_ids: [context.body.delivery.receipt_id] },
    dependencies: [],
    exports: [
      sourceDeliverySchema,
      tokenizedSourceDeliverySchema,
      { kind: "schema", export_id: "configuration", contract_version: "1.0.0", content: {
        type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } }
      } },
      { kind: "skill", export_id: "compare_inventory", contract_version: "1.0.0", content: {
        program: { discrepancy: { "-": [{ var: "erp_quantity" }, { var: "storefront_quantity" }] },
          correction_required: { "!==": [{ var: "erp_quantity" }, { var: "storefront_quantity" }] } },
        input_schema: { refs: ["observation:source.delivery"] },
        output_schema: { type: "object", required: ["discrepancy", "correction_required"] },
        steps: ["compare two governed quantities"],
        context_requirements: { authority: ["authoritative"], max_age_seconds: 300 },
        uncertainty_behavior: "stop when context is unresolved",
        evaluation_ref: "comparison_evaluation"
      } },
      { kind: "evaluation", export_id: "comparison_evaluation", contract_version: "1.0.0", content: {
        skill_ref: "compare_inventory", cases: [{ case_id: "different",
          input: { erp_quantity: 2, storefront_quantity: 1 },
          expected: { discrepancy: 1, correction_required: true } }]
      } },
      { kind: "capability", export_id: "proof_read", contract_version: "1.0.0", content: {
        effect_class: "read_only", skill_ref: "compare_inventory",
        context_requirements: { authority: ["authoritative"], max_age_seconds: 300 }
      } },
      { kind: "adapter", export_id: "proof_adapter", contract_version: "1.0.0", content: {
        artifact_ref: `oci://registry.example.invalid/canonical-proof-adapter@sha256:${"a".repeat(64)}`,
        artifact_digest: `sha256:${"a".repeat(64)}`,
        artifact_attestation_id: attestation.body.artifact_attestation.artifact_attestation_id,
        operations: ["write_fixture"],
        operation_effects: { write_fixture: { target: "fixture.record", action: "set" } }
      } },
      { kind: "accountability_contract", export_id: "proof_accountability", contract_version: "1.0.0", content: {
        outcome: "fixture write is confirmed", evidence_requirements: ["receipt"], deadline_seconds: 60,
        escalation: { on_timeout: "operator" }, recovery: { on_failure: "restore" }
      } },
      { kind: "capability", export_id: "proof_write", contract_version: "1.0.0", content: {
        effect_class: "external_write", operation: "write_fixture", supported_operations: ["write_fixture"],
        adapter_ref: "proof_adapter", accountability_contract_ref: "proof_accountability",
        context_requirements: { authority: ["authoritative"], max_age_seconds: 300 },
        declared_effects: [{ target: "fixture.record", action: "set", maximum_items: 1 }],
        idempotency: { key: "fixture_id", duplicate_result: "return_original_effect" },
        evidence: { required: ["receipt"] }, recovery: { strategy: "restore", uncertainty: "reconcile" }
      } },
      { kind: "view", export_id: "proof_view", contract_version: "1.0.0", content: {
        fields: ["logical_operation_id"], actions: ["inspect"]
      } }
    ]
  };

  const validation = await postAgent("/kernel/v0/package-validations", command("kernel.package_candidate.validate", {
    build_session_id: session.body.build_session.build_session_id, candidate
  }));
  assert.equal(validation.response.status, 201);
  assert.equal(validation.body.validation_receipt.valid, true, JSON.stringify(validation.body.validation_receipt.issues));
  const fixture = await postAgent("/kernel/v0/package-simulations", command("kernel.package_candidate.simulate", {
    validation_receipt_id: validation.body.validation_receipt.validation_receipt_id,
    candidate, mode: "deterministic_fixture"
  }));
  const observed = await dataPlane("/v0/inventory/simulate", {
    method: "POST", headers: { authorization: `Agent ${agentToken}` },
    body: JSON.stringify({ grant_id: contextGrant.body.context_access_grant.grant_id,
      subjects: ["SKU-100"], sources: ["erp", "storefront"], candidate_digest: sha256Digest(candidate),
      validation_receipt_id: validation.body.validation_receipt.validation_receipt_id,
      skill_export_id: "compare_inventory",
      skill_content: candidate.exports.find((entry) => entry.export_id === "compare_inventory").content })
  });
  const observational = await postAgent("/kernel/v0/package-simulations", command("kernel.package_candidate.simulate", {
    validation_receipt_id: validation.body.validation_receipt.validation_receipt_id,
    candidate, mode: "observational_read_only",
    observational_attestation: observed.body.observational_attestation,
    observational_attestation_signature: observed.body.observational_attestation_signature
  }));
  const publication = await postAgent("/kernel/v0/package-versions", command("kernel.package_version.publish", {
    build_session_id: session.body.build_session.build_session_id,
    validation_receipt_id: validation.body.validation_receipt.validation_receipt_id,
    simulation_receipt_ids: [fixture.body.simulation_receipt.simulation_receipt_id,
      observational.body.simulation_receipt.simulation_receipt_id], candidate
  }));
  assert.equal(publication.response.status, 201);
  const packageVersion = publication.body.package_version;

  const activationProposal = await postAgent("/kernel/v0/work-intent-proposals", command("kernel.work_intent.propose", {
    passport_id: passport.body.passport.passport_id,
    intent_class: "capability_activation",
    objective: "Stage canonical proof observation semantics.",
    requested_outcome: "One exact deployment without execution authority.",
    scope: { systems: ["webhook", "mock-crm"] }, constraints: { bounded_effects_only: true }
  }));
  const activationIntent = await post(`/kernel/v0/work-intent-proposals/${activationProposal.body.proposal.proposal_id}/confirm`,
    command("kernel.work_intent.confirm", {}));
  const config = candidate.exports.find((entry) => entry.export_id === "configuration");
  const adapter = candidate.exports.find((entry) => entry.export_id === "proof_adapter");
  const capability = candidate.exports.find((entry) => entry.export_id === "proof_write");
  const plan = {
    schema_version: "alphonse.deployment_plan.v0.1",
    work_intent_id: activationIntent.body.work_intent.work_intent_id,
    package: { package_version_id: packageVersion.package_version_id, package_id: packageVersion.package_id,
      semantic_version: packageVersion.semantic_version, artifact_digest: packageVersion.artifact_digest,
      manifest_digest: packageVersion.manifest_digest, dependency_digest: packageVersion.dependency_digest },
    dependency_lock: [], extension_bindings: [],
    configuration_binding: { schema_export_id: config.export_id, schema_export_digest: sha256Digest(config.content),
      redacted_values: { enabled: true }, credential_bindings: [{ binding_ref: "credential://proof",
        revision: "proof-rev-1", scopes: ["fixture.write"] }] },
    adapter_bindings: [{ adapter_export_id: adapter.export_id,
      adapter_export_digest: sha256Digest(adapter.content), target_system: "fixture" }],
    capability_candidates: [{ capability_export_id: capability.export_id,
      capability_export_digest: sha256Digest(capability.content),
      context_binding: { sources: ["erp"], authority: ["authoritative"], max_age_seconds: 300 },
      credential_binding_ref: "credential://proof",
      effect_limits: [{ system: "fixture", target: "fixture.record", action: "set", maximum_items: 1 }] }]
  };
  const planValidation = await post("/kernel/v0/deployment-plan-validations", command("kernel.deployment_plan.validate", { plan }));
  assert.equal(planValidation.body.validation_receipt.valid, true, JSON.stringify(planValidation.body.validation_receipt.issues));
  const review = await post(`/kernel/v0/deployment-plans/${planValidation.body.deployment_plan.deployment_plan_id}/technical-reviews`,
    command("kernel.deployment_plan.technical_review", {
      plan_digest: planValidation.body.deployment_plan.plan_digest,
      decision: "pass", rationale: "Exact canonical proof deployment is technically bounded."
    }));
  const deployment = await post("/kernel/v0/deployments", command("kernel.deployment.stage", {
    deployment_plan_id: planValidation.body.deployment_plan.deployment_plan_id,
    technical_review_id: review.body.technical_review.technical_review_id,
    plan_digest: planValidation.body.deployment_plan.plan_digest
  }));
  assert.equal(deployment.response.status, 201);
  return {
    deployment_id: deployment.body.deployment.deployment_id,
    package_version_id: packageVersion.package_version_id,
    package_artifact_digest: packageVersion.artifact_digest,
    schema_export: sourceDeliverySchema,
    tokenized_schema_export: tokenizedSourceDeliverySchema
  };
}
