import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  adapterHealthProjection,
  buildN8nRevisionMaterial,
  evaluateDefectiveInventoryFixture,
  evaluateRepairedInventoryFixture,
  validateN8nOperationalPackage
} from "../../packages/n8n-operational-package/src/index.js";
import { assertRepairDeliveryAdapterManifest } from "../../src/repair-delivery-adapter-contract.js";
import { assertWorkflowRuntimeAdapterManifest } from "../../src/workflow-runtime-adapter-contract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = path.join(root, "packages", "n8n-operational-package");
const json = async (relativePath) => JSON.parse(await readFile(path.join(packageRoot, relativePath), "utf8"));

test("first-party n8n Operational Package is pinned, complete, and conforming", async () => {
  const packageManifest = await json("operational-package.json");
  const adapterManifest = await json("runtime-adapter-manifest.json");
  const repairDeliveryManifest = await json("repair-delivery-adapter-manifest.json");

  assert.equal(validateN8nOperationalPackage(packageManifest).valid, true);
  assert.deepEqual(assertWorkflowRuntimeAdapterManifest(adapterManifest), adapterManifest);
  assert.deepEqual(assertRepairDeliveryAdapterManifest(repairDeliveryManifest), repairDeliveryManifest);
  assert.equal(packageManifest.package_id, "alphonse.runtime.n8n");
  assert.equal(packageManifest.package_version, "0.2.0");
  assert.equal(packageManifest.compatibility.n8n, ">=2.25.0 <3.0.0");
  assert.equal(packageManifest.compatibility.reference_image,
    "n8nio/n8n@sha256:761374d4eb841b0a22771d6bd68f0e8d827b4979ae4e490045517b13fc1259dd");
  assert.ok(packageManifest.exports.workflow_runtime_adapter);
  assert.ok(packageManifest.exports.repair_delivery_adapter);
  assert.ok(packageManifest.exports.verification_adapter);
  assert.ok(packageManifest.exports.event_reporter_workflow);
  assert.ok(packageManifest.exports.reference_workflow);
  assert.ok(packageManifest.mappings.workflow_identity);
  assert.ok(packageManifest.fingerprint_rules.included_fields.length > 0);
  assert.ok(packageManifest.health_checks.runtime_reachability);
  assert.deepEqual(packageManifest.detail_policy.redact_paths, ["input.customer_email"]);
  assert.equal(adapterManifest.capabilities.detail_retrieval.supported, true);
  assert.equal(repairDeliveryManifest.operations.promotion.supported, true);
  assert.equal(repairDeliveryManifest.operations.confirmation.supported, true);
  assert.equal(repairDeliveryManifest.operations.rollback.supported, true);
  assert.ok(packageManifest.tests.includes("real_n8n_successful_but_wrong_execution"));
  assert.doesNotMatch(JSON.stringify(packageManifest), /password|api_key|access_token|credential_value/i);
});

test("Event Reporter is importable and uses only approved standard n8n primitives", async () => {
  const workflow = await json("workflows/alphonse-event-reporter.json");
  const types = new Set(workflow.nodes.map((node) => node.type));
  assert.deepEqual([...types].sort(), [
    "n8n-nodes-base.code",
    "n8n-nodes-base.errorTrigger",
    "n8n-nodes-base.executeWorkflowTrigger",
    "n8n-nodes-base.httpRequest"
  ]);
  assert.equal(workflow.active, false);
  assert.match(JSON.stringify(workflow), /x-alphonse-runtime-signature/);
  assert.doesNotMatch(JSON.stringify(workflow), /n8n-nodes-[^b]|community/i);
});

test("n8n adapter fault controls are disabled unless explicitly enabled", async () => {
  const source = await readFile(path.join(packageRoot, "src", "detail-adapter-server.js"), "utf8");
  const releaseCompose = await readFile(path.join(root, "release", "v0.2.0", "compose.yaml"), "utf8")
    .catch(() => "");
  assert.match(source, /N8N_ADAPTER_TEST_CONTROLS_ENABLED === "true"/);
  assert.doesNotMatch(releaseCompose, /N8N_ADAPTER_TEST_CONTROLS_ENABLED:\s*"true"/);
});

test("defective workflow deterministically converts missing SKU to zero and drafts delay for local review", async () => {
  const fixture = await json("fixtures/missing-sku.json");
  const result = evaluateDefectiveInventoryFixture(fixture);
  assert.equal(result.erp_quantity, 0);
  assert.equal(result.inventory_state, "out_of_stock");
  assert.equal(result.fulfillment_risk, "delay_likely");
  assert.equal(result.draft.kind, "customer_delay_follow_up");
  assert.equal(result.delivery.channel, "local_review");
  assert.equal(result.delivery.sent, false);
  assert.equal(result.defect_path, "missing_sku -> zero_inventory -> delay_draft");
});

test("repaired evaluator preserves unknown inventory and routes human review", async () => {
  const fixture = await json("fixtures/missing-sku.json");
  const result = evaluateRepairedInventoryFixture(fixture);
  assert.equal(result.erp_quantity, null);
  assert.equal(result.inventory_state, "inventory_unknown");
  assert.equal(result.fulfillment_risk, "unknown");
  assert.equal(result.draft, null);
  assert.equal(result.review_reason, "missing_inventory_data");
  assert.equal(result.delivery.sent, false);
});

test("adapter mapping binds exact workflow, runtime, nodes, model, configuration, and fingerprint rules", async () => {
  const packageManifest = await json("operational-package.json");
  const workflow = await json("workflows/inventory-follow-up-defective.json");
  const reporter = await json("workflows/alphonse-event-reporter.json");
  const material = buildN8nRevisionMaterial({ packageManifest, workflow, reporter });

  assert.deepEqual(material.workflow_content, { primary_workflow: workflow, dependencies: [reporter] });
  assert.equal(material.runtime.runtime_id, "n8n");
  assert.equal(material.runtime.runtime_version, "2.25.7");
  assert.match(material.runtime.image_digest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(material.nodes.some((node) => node.node_type === "n8n-nodes-base.executeWorkflow"));
  assert.deepEqual(material.model, { provider: "fixture", model: "deterministic-follow-up", version: "1" });
  assert.match(material.configuration.configuration_fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(material.adapter.fingerprint_rules_digest, /^sha256:[0-9a-f]{64}$/);
});

test("adapter health distinguishes broken reporting from workflow silence", () => {
  assert.deepEqual(adapterHealthProjection({ runtimeReachable: true, reportingReachable: true, lastEventAt: null }), {
    status: "healthy",
    runtime: "reachable",
    reporting: "reachable",
    workflow_activity: "none_observed"
  });
  assert.deepEqual(adapterHealthProjection({ runtimeReachable: true, reportingReachable: false, lastEventAt: null }), {
    status: "degraded",
    runtime: "reachable",
    reporting: "broken",
    workflow_activity: "unknown"
  });
});
