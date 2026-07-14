import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import { validateDeploymentPlanShape } from "../../src/deployment-service.js";

function packageVersion() {
  const candidate = {
    dependencies: [],
    exports: [
      { kind: "schema", export_id: "configuration", contract_version: "1.0.0", content: {
        type: "object", required: ["threshold"], properties: { threshold: { type: "integer" } }
      } },
      { kind: "adapter", export_id: "writer", contract_version: "1.0.0", content: {
        operations: ["set_value"], operation_effects: { set_value: { target: "system.record", action: "set" } }
      } },
      { kind: "accountability_contract", export_id: "write_accountability", contract_version: "1.0.0", content: {
        outcome: "value matches", evidence_requirements: ["receipt"], deadline_seconds: 60,
        escalation: { on_timeout: "operator" }, recovery: { on_failure: "restore" }
      } },
      { kind: "capability", export_id: "bounded_write", contract_version: "1.0.0", content: {
        effect_class: "external_write", operation: "set_value", adapter_ref: "writer",
        accountability_contract_ref: "write_accountability",
        context_requirements: { authority: ["authoritative"], max_age_seconds: 300 },
        declared_effects: [{ target: "system.record", action: "set", maximum_items: 2 }],
        evidence: { required: ["receipt"] }, recovery: { strategy: "restore", uncertainty: "reconcile" }
      } }
      ,
      { kind: "skill", export_id: "compare", contract_version: "1.0.0", content: {} },
      { kind: "accountability_contract", export_id: "read_accountability", contract_version: "1.0.0", content: {
        outcome: "comparison recorded", evidence_requirements: ["typed_result"], deadline_seconds: 60,
        escalation: { on_timeout: "operator" }, recovery: { on_failure: "retry" }
      } },
      { kind: "capability", export_id: "bounded_read", contract_version: "1.0.0", content: {
        effect_class: "read_only", skill_ref: "compare", accountability_contract_ref: "read_accountability",
        context_requirements: { authority: ["authoritative"], max_age_seconds: 300 }
      } }
    ]
  };
  return {
    package_version_id: "00000000-0000-4000-8000-000000000501",
    package_id: "com.example.operations",
    semantic_version: "1.0.0",
    artifact_digest: sha256Digest(candidate),
    manifest_digest: `sha256:${"a".repeat(64)}`,
    dependency_digest: sha256Digest([]),
    candidate
  };
}

function plan(pkg) {
  const schema = pkg.candidate.exports.find((entry) => entry.export_id === "configuration");
  const adapter = pkg.candidate.exports.find((entry) => entry.export_id === "writer");
  const capability = pkg.candidate.exports.find((entry) => entry.export_id === "bounded_write");
  return {
    schema_version: "alphonse.deployment_plan.v0.1",
    work_intent_id: "00000000-0000-4000-8000-000000000502",
    package: {
      package_version_id: pkg.package_version_id, package_id: pkg.package_id,
      semantic_version: pkg.semantic_version, artifact_digest: pkg.artifact_digest,
      manifest_digest: pkg.manifest_digest, dependency_digest: pkg.dependency_digest
    },
    dependency_lock: [],
    extension_bindings: [],
    configuration_binding: {
      schema_export_id: schema.export_id, schema_export_digest: sha256Digest(schema.content), redacted_values: { threshold: 1 },
      credential_bindings: [{ binding_ref: "credential://writer", revision: "rev-1", scopes: ["record.write"] }]
    },
    adapter_bindings: [{ adapter_export_id: adapter.export_id, adapter_export_digest: sha256Digest(adapter.content),
      target_system: "records-production" }],
    capability_candidates: [{ capability_export_id: capability.export_id,
      capability_export_digest: sha256Digest(capability.content),
      context_binding: { sources: ["source-system"], authority: ["authoritative"], max_age_seconds: 300 },
      credential_binding_ref: "credential://writer",
      effect_limits: [{ system: "records-production", target: "system.record", action: "set", maximum_items: 1 }] }]
  };
}

test("exact bounded deployment plan validates", () => {
  const pkg = packageVersion();
  const result = validateDeploymentPlanShape(plan(pkg), pkg);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

test("effect authority requires an exact deployment-local target system", () => {
  const pkg = packageVersion();
  const missing = plan(pkg);
  delete missing.capability_candidates[0].effect_limits[0].system;
  const result = validateDeploymentPlanShape(missing, pkg);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((entry) => entry.code === "EFFECT_SYSTEM_REQUIRED"));
});

test("effect authority target system must match the trusted adapter binding", () => {
  const pkg = packageVersion();
  const mismatched = plan(pkg);
  mismatched.adapter_bindings[0].target_system = "different-production-system";
  const result = validateDeploymentPlanShape(mismatched, pkg);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((entry) => entry.code === "ADAPTER_TARGET_SYSTEM_MISMATCH"));
});

test("conflicts, ambient extensions, excessive effects, and secrets reject deterministically", () => {
  const pkg = packageVersion();
  const invalid = plan(pkg);
  invalid.dependency_lock = [{ package_id: "ambient" }];
  invalid.extension_bindings = [{ extension_point: "ambient" }];
  invalid.configuration_binding.redacted_values.api_key = "sk-this-value-must-never-persist";
  invalid.capability_candidates[0].effect_limits[0].maximum_items = 3;
  const result = validateDeploymentPlanShape(invalid, pkg);
  assert.equal(result.valid, false);
  const codes = new Set(result.issues.map((entry) => entry.code));
  for (const code of ["DEPENDENCY_LOCK_CONFLICT", "UNDECLARED_EXTENSION_BEHAVIOR", "SECRET_MATERIAL_PROHIBITED",
    "EFFECT_LIMIT_EXCEEDS_CONTRACT"]) assert.ok(codes.has(code), `missing ${code}`);
});

test("opaque high-entropy values and excessive nesting cannot enter a plan", () => {
  const pkg = packageVersion();
  const opaque = plan(pkg);
  opaque.configuration_binding.redacted_values.endpoint = "G7xQ2mP9vL4kR8sT1wY6zN3cB5dF0hJ2uK9qW4eR";
  assert.ok(validateDeploymentPlanShape(opaque, pkg).issues.some((entry) => entry.code === "SECRET_MATERIAL_PROHIBITED"));

  const nested = plan(pkg);
  let cursor = {};
  nested.configuration_binding.redacted_values.nested = cursor;
  for (let index = 0; index < 40; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.deepEqual(validateDeploymentPlanShape(nested, pkg).issues.map((entry) => entry.code), ["PLAN_DEPTH_EXCEEDED"]);
});

test("read Capability activates without credentials or effect limits", () => {
  const pkg = packageVersion();
  const readPlan = plan(pkg);
  const read = pkg.candidate.exports.find((entry) => entry.export_id === "bounded_read");
  readPlan.capability_candidates = [{ capability_export_id: read.export_id,
    capability_export_digest: sha256Digest(read.content),
    context_binding: { sources: ["source-system"], authority: ["authoritative"], max_age_seconds: 300 },
    credential_binding_ref: null, effect_limits: [] }];
  assert.equal(validateDeploymentPlanShape(readPlan, pkg).valid, true);
});
