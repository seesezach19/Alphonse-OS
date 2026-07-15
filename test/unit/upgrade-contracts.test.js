import assert from "node:assert/strict";
import test from "node:test";

import { analyzeUpgradeCompatibility, deterministicCanaryAssignment,
  retirementBlockers, upgradeMajorAdmissible } from "../../src/upgrade-contracts.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function snapshot(overrides = {}) {
  return {
    package_identity: `com.alphonse.inventory@1.0.0#${digest("a")}+${digest("b")}`,
    protocol: { kernel_api: ">=0.1 <0.2" },
    dependencies: [],
    exports: [{ kind: "skill", export_id: "compare_inventory", contract_version: "1.0.0",
      contract_digest: digest("c") },
    { kind: "schema", export_id: "inventory_observation", contract_version: "1.0.0",
      contract_digest: digest("d"), schema: { type: "object", required: ["sku"],
        properties: { sku: { type: "string" } } } },
    { kind: "adapter", export_id: "storefront_adapter", contract_version: "1.0.0",
      contract_digest: digest("e"), operations: ["set_quantity"] }],
    context_semantics: { sources: ["erp", "storefront"], authority: ["authoritative", "representational"],
      max_age_seconds: 300 },
    authority_semantics: { digest: digest("f"), effects: ["storefront.inventory:set_quantity:1"] },
    evidence_semantics: { required: ["post_write_observation"] },
    recovery_semantics: { strategy: "restore_previous_quantity", uncertainty: "reconcile_before_retry" },
    ...overrides
  };
}

test("compatibility report evaluates every user-space dimension", () => {
  const current = snapshot();
  const target = snapshot({ package_identity: `com.alphonse.inventory@1.1.0#${digest("1")}+${digest("2")}` });
  const report = analyzeUpgradeCompatibility(current, target);
  assert.deepEqual(Object.keys(report.dimensions).sort(), ["adapters", "authority", "context", "dependencies",
    "evidence", "exports", "protocol", "recovery", "schemas"]);
  assert.equal(report.classification, "compatible_in_place");
  assert.equal(report.authority_equivalent, true);
  assert.equal(report.current_package_identity, current.package_identity);
  assert.equal(report.target_package_identity, target.package_identity);
});

test("additive optional schema field is compatible but required field is breaking", () => {
  const current = snapshot();
  const additive = structuredClone(snapshot({
    package_identity: `com.alphonse.inventory@1.1.0#${digest("1")}+${digest("2")}` }));
  const schema = additive.exports.find((entry) => entry.kind === "schema").schema;
  schema.properties.location = { type: "string" };
  assert.equal(analyzeUpgradeCompatibility(current, additive).dimensions.schemas.status, "compatible_in_place");
  schema.required.push("location");
  const breaking = analyzeUpgradeCompatibility(current, additive);
  assert.equal(breaking.dimensions.schemas.status, "parallel_major_required");
  assert.equal(breaking.classification, "parallel_major_required");
});

test("nested constraints, closed enums, and adapter effect changes are breaking", () => {
  const current = snapshot();
  const sourceSchema = current.exports.find((entry) => entry.kind === "schema").schema;
  sourceSchema.properties.detail = { type: "object", required: ["status"], properties: {
    status: { type: "string", enum: ["open", "closed"] }, count: { type: "integer", minimum: 0 }
  } };
  current.exports.find((entry) => entry.kind === "adapter").operation_effects = {
    set_quantity: { target: "inventory", action: "set_quantity" }
  };
  const target = structuredClone(current);
  target.package_identity = `com.alphonse.inventory@2.0.0#${digest("1")}+${digest("2")}`;
  const targetSchema = target.exports.find((entry) => entry.kind === "schema").schema;
  targetSchema.properties.detail.required.push("count");
  targetSchema.properties.detail.properties.status.enum.push("pending");
  targetSchema.properties.detail.properties.count.minimum = 1;
  target.exports.find((entry) => entry.kind === "adapter").operation_effects.set_quantity.target = "other";
  const report = analyzeUpgradeCompatibility(current, target);
  assert.equal(report.dimensions.schemas.status, "parallel_major_required");
  assert.equal(report.dimensions.adapters.status, "parallel_major_required");
});

test("removed export requires side-by-side major and changed authority requires approval", () => {
  const current = snapshot();
  const target = snapshot({ package_identity: `com.alphonse.inventory@2.0.0#${digest("1")}+${digest("2")}`,
    exports: snapshot().exports.filter((entry) => entry.kind !== "adapter"),
    authority_semantics: { digest: digest("9"), effects: ["storefront.inventory:set_quantity:10"] } });
  const report = analyzeUpgradeCompatibility(current, target);
  assert.equal(report.dimensions.exports.status, "parallel_major_required");
  assert.equal(report.dimensions.authority.status, "migration_required");
  assert.equal(report.authority_equivalent, false);
  assert.equal(report.fresh_business_approval_required, true);
});

test("context, evidence, or recovery changes require fresh business approval", () => {
  const current = snapshot();
  for (const changed of [
    { context_semantics: { ...current.context_semantics, max_age_seconds: 60 } },
    { evidence_semantics: { required: ["post_write_observation", "operator_receipt"] } },
    { recovery_semantics: { strategy: "forward_repair", uncertainty: "reconcile_before_retry" } }
  ]) {
    const report = analyzeUpgradeCompatibility(current, snapshot({
      package_identity: `com.alphonse.inventory@1.1.0#${digest("1")}+${digest("2")}`, ...changed
    }));
    assert.equal(report.authority_equivalent, false);
    assert.equal(report.fresh_business_approval_required, true);
  }
});

test("deployment binding changes require fresh approval", () => {
  const current = snapshot({ binding_semantics: { adapter: "adapter://primary", configuration: { mode: "live" } } });
  const target = snapshot({ package_identity: `com.alphonse.inventory@1.1.0#${digest("1")}+${digest("2")}`,
    binding_semantics: { adapter: "adapter://secondary", configuration: { mode: "live" } } });
  const report = analyzeUpgradeCompatibility(current, target);
  assert.equal(report.authority_equivalent, false);
  assert.equal(report.fresh_business_approval_required, true);
});

test("breaking compatibility requires a strictly newer package major", () => {
  assert.equal(upgradeMajorAdmissible("parallel_major_required", "1.9.0", "1.10.0"), false);
  assert.equal(upgradeMajorAdmissible("parallel_major_required", "1.9.0", "2.0.0"), true);
  assert.equal(upgradeMajorAdmissible("migration_required", "1.9.0", "1.10.0"), true);
});

test("deterministic canary assignment is reproducible and bounded", () => {
  const first = deterministicCanaryAssignment("upgrade-seed-1", "customer-42", 1250);
  const replay = deterministicCanaryAssignment("upgrade-seed-1", "customer-42", 1250);
  assert.deepEqual(replay, first);
  assert.ok(first.bucket >= 0 && first.bucket < 10000);
  assert.equal(first.selected, first.bucket < 1250);
  assert.match(first.routing_key_digest, /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => deterministicCanaryAssignment("seed", "key", 10001), /basis/i);
});

test("retirement remains blocked by every retained user-space reference", () => {
  const blockers = retirementBlockers({ consumers: 1, active_runs: 1, evidence_records: 2,
    recovery_cases: 1, open_obligations: 1, pending_handoffs: 1, upgrade_recovery_records: 1,
    retention_until: "2099-01-01T00:00:00.000Z" }, Date.parse("2030-01-01T00:00:00.000Z"));
  assert.deepEqual(blockers.map((entry) => entry.code), ["CONSUMERS_REMAIN", "ACTIVE_RUNS_REMAIN",
    "EVIDENCE_REFERENCES_REMAIN", "RECOVERY_REFERENCES_REMAIN", "OPEN_OBLIGATIONS_REMAIN",
    "PENDING_HANDOFFS_REMAIN", "UPGRADE_RECOVERY_REFERENCES_REMAIN", "RETENTION_WINDOW_ACTIVE"]);
});
