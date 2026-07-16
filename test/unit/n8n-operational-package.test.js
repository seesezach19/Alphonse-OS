import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  adapterHealthProjection,
  buildN8nRevisionMaterial,
  evaluateDefectiveAmbiguousLeadFixture,
  evaluateDefectiveInventoryFixture,
  evaluateDefectiveLeadFixture,
  evaluateDefectiveSchemaChangeFixture,
  evaluateDefectiveStaleRoutingFixture,
  evaluateRepairedAmbiguousLeadFixture,
  evaluateRepairedInventoryFixture,
  evaluateRepairedLeadFixture,
  evaluateRepairedSchemaChangeFixture,
  evaluateRepairedStaleRoutingFixture,
  validateN8nOperationalPackage
} from "../../packages/n8n-operational-package/src/index.js";
import {
  assertAttestationCandidate,
  assertExecutionBinding,
  buildAttestedRuntimeEvent,
  normalizeAttestationRequest
} from "../../packages/n8n-operational-package/src/runtime-attestation.js";
import { assertRepairDeliveryAdapterManifest } from "../../src/repair-delivery-adapter-contract.js";
import { verifyRuntimeEventEnvelope } from "../../src/runtime-event-envelope.js";
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
  assert.match(JSON.stringify(workflow), /v0\/runtime-attestations/);
  assert.match(JSON.stringify(workflow), /external_execution_id/);
  assert.doesNotMatch(JSON.stringify(workflow), /createHmac|RUNTIME_ADAPTER_SECRET|lifecycle_claim|revision_id/);
  assert.doesNotMatch(JSON.stringify(workflow), /n8n-nodes-[^b]|community/i);
});

test("n8n cannot access the runtime attestation signing secret", async () => {
  const compose = await readFile(path.join(packageRoot, "compose.customer.yaml"), "utf8");
  const n8nService = compose.slice(compose.indexOf("\n  n8n:\n"), compose.indexOf("\nvolumes:\n"));
  assert.match(n8nService, /N8N_BLOCK_ENV_ACCESS_IN_NODE: true/);
  assert.doesNotMatch(n8nService, /ALPHONSE_RUNTIME_ADAPTER_SECRET|ALPHONSE_RUNTIME_ADAPTER_KEY_ID/);
  const reporter = await json("workflows/alphonse-event-reporter.json");
  assert.doesNotMatch(JSON.stringify(reporter), /\$env|createHmac|hmac-sha256/);
});

test("sidecar attestation derives identity and lifecycle from an independently observed execution", () => {
  const secret = "local-n8n-runtime-event-secret-with-sufficient-length-v1";
  const binding = {
    provider_workflow_id: "InventoryFollowupDefect1",
    workflow_id: "workflow:inventory-follow-up",
    revision_id: "00000000-0000-4000-8000-000000000201"
  };
  const observation = {
    id: "42",
    workflowId: binding.provider_workflow_id,
    status: "success",
    startedAt: "2026-07-16T16:00:00.000Z",
    stoppedAt: "2026-07-16T16:00:02.000Z"
  };
  const attestation = buildAttestedRuntimeEvent({
    observation,
    binding,
    adapter: { adapter_id: "alphonse.n8n.runtime", adapter_version: "0.2.0" },
    signing: { key_id: "n8n-runtime-key-v1", secret },
    signedAt: "2026-07-16T16:00:03.000Z"
  });
  const verified = verifyRuntimeEventEnvelope(attestation.envelope, attestation.authentication, {
    adapter_id: "alphonse.n8n.runtime",
    adapter_version: "0.2.0",
    key_id: "n8n-runtime-key-v1",
    secret
  }, { now: new Date("2026-07-16T16:00:03.000Z") });
  assert.equal(verified.envelope.lifecycle_claim, "succeeded");
  assert.equal(verified.envelope.workflow_id, binding.workflow_id);
  assert.equal(verified.envelope.revision_id, binding.revision_id);
  assert.equal(attestation.attestation_basis.source, "n8n_api_execution_observation");
  assert.throws(() => assertExecutionBinding(observation, {
    ...binding,
    provider_workflow_id: "AttackerSelectedWorkflow"
  }), /does not match/);
  assert.throws(() => normalizeAttestationRequest({
    external_execution_id: "42",
    lifecycle_claim: "succeeded",
    revision_id: binding.revision_id
  }), /only external_execution_id/);
  assert.throws(() => assertAttestationCandidate(
    { external_execution_id: "41" }, observation, binding
  ), /requested execution identity/);
  assert.throws(() => buildAttestedRuntimeEvent({
    observation: { ...observation, status: "running", stoppedAt: null },
    binding,
    adapter: { adapter_id: "alphonse.n8n.runtime", adapter_version: "0.2.0" },
    signing: { key_id: "n8n-runtime-key-v1", secret },
    signedAt: "2026-07-16T16:00:03.000Z"
  }), /terminal n8n executions/);
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

test("lead ingestion fixture demonstrates duplicate webhook external effects", async () => {
  const fixture = await json("fixtures/lead-duplicate-webhook.json");
  const result = evaluateDefectiveLeadFixture(fixture);
  assert.equal(result.processed_event_count, 2);
  assert.equal(result.crm_leads.length, fixture.expected.defective.crm_lead_count);
  assert.equal(result.notifications.length, fixture.expected.defective.notification_count);
  assert.deepEqual(result.duplicate_submission_ids, ["FORM-LEAD-1001"]);
  assert.equal(result.lead_state, "duplicate_created");
  assert.equal(result.defect_path,
    "duplicate_webhook -> create_without_idempotency -> duplicate_crm_and_notification");
  assert.equal(result.external_effects.filter((effect) => effect.operation === "create_lead").length, 2);
  assert.equal(result.external_effects.some((effect) => effect.idempotency_key), false);
});

test("lead ingestion repaired evaluator suppresses duplicate delivery idempotently", async () => {
  const fixture = await json("fixtures/lead-duplicate-webhook.json");
  const result = evaluateRepairedLeadFixture(fixture);
  assert.equal(result.processed_event_count, 2);
  assert.equal(result.crm_leads.length, fixture.expected.repaired.crm_lead_count);
  assert.equal(result.notifications.length, fixture.expected.repaired.notification_count);
  assert.equal(result.suppressed_duplicates.length, fixture.expected.repaired.suppressed_duplicate_count);
  assert.equal(result.lead_state, "idempotent_duplicate_suppressed");
  assert.equal(result.external_effects.length, 2);
  assert.equal(result.external_effects.every((effect) =>
    effect.idempotency_key === fixture.expected.repaired.required_idempotency_key), true);
});

test("lead ingestion n8n reference workflow is a local-only defective lab target", async () => {
  const workflow = await json("workflows/lead-ingestion-defective.json");
  const types = new Set(workflow.nodes.map((node) => node.type));
  assert.equal(workflow.id, "LeadIngestionDefect1");
  assert.equal(workflow.active, false);
  assert.ok(types.has("n8n-nodes-base.code"));
  assert.ok(types.has("n8n-nodes-base.executeWorkflow"));
  assert.match(JSON.stringify(workflow), /duplicate_webhook -> create_without_idempotency/);
  assert.doesNotMatch(JSON.stringify(workflow), /api_key|access_token|credential_value/i);
});

test("ambiguous CRM write fixture demonstrates unsafe retry after a committed uncertain effect", async () => {
  const fixture = await json("fixtures/lead-ambiguous-crm-timeout.json");
  const result = evaluateDefectiveAmbiguousLeadFixture(fixture);
  assert.equal(result.processed_event_count, 1);
  assert.equal(result.crm_leads.length, fixture.expected.defective.crm_lead_count);
  assert.equal(result.notifications.length, fixture.expected.defective.notification_count);
  assert.equal(result.external_effects.filter((effect) => effect.operation === "create_lead").length, 2);
  assert.equal(result.uncertain_effects.length, 1);
  assert.equal(result.uncertain_effects[0].destination_committed, true);
  assert.equal(result.lead_state, fixture.expected.defective.lead_state);
});

test("ambiguous CRM write repair reconciles destination state before another write", async () => {
  const fixture = await json("fixtures/lead-ambiguous-crm-timeout.json");
  const result = evaluateRepairedAmbiguousLeadFixture(fixture);
  assert.equal(result.crm_leads.length, fixture.expected.repaired.crm_lead_count);
  assert.equal(result.notifications.length, fixture.expected.repaired.notification_count);
  assert.equal(result.external_effects.filter((effect) => effect.operation === "create_lead").length, 1);
  assert.equal(result.reconciliations.length, fixture.expected.repaired.reconciliation_count);
  assert.equal(result.reconciliations[0].result_id, result.crm_leads[0].crm_lead_id);
  assert.equal(result.external_effects.every((effect) => effect.idempotency_key === "FORM-LEAD-2001"), true);
  assert.equal(result.lead_state, fixture.expected.repaired.lead_state);
});

test("outdated routing context assigns and notifies an inactive owner", async () => {
  const fixture = await json("fixtures/lead-stale-routing-context.json");
  const result = evaluateDefectiveStaleRoutingFixture(fixture);
  assert.equal(result.crm_leads.length, 1);
  assert.equal(result.crm_leads[0].assigned_owner_id, "owner-017");
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].to, "owner-017");
  assert.equal(result.authoritative_owner_state.owners[0].status, "inactive");
  assert.equal(result.lead_state, fixture.expected.defective.lead_state);
});

test("routing repair preserves the lead but holds assignment and notification for escalation", async () => {
  const fixture = await json("fixtures/lead-stale-routing-context.json");
  const result = evaluateRepairedStaleRoutingFixture(fixture);
  assert.equal(result.crm_leads.length, 1);
  assert.equal(result.crm_leads[0].assigned_owner_id, null);
  assert.equal(result.notifications.length, 0);
  assert.equal(result.routing_decisions.length, 0);
  assert.equal(result.escalations.length, 1);
  assert.equal(result.lead_state, fixture.expected.repaired.lead_state);
});

test("source schema field change silently defaults a required qualification value", async () => {
  const fixture = await json("fixtures/lead-schema-field-change.json");
  const result = evaluateDefectiveSchemaChangeFixture(fixture);
  const mapping = result.mapping_observations[0];
  assert.equal(result.crm_leads.length, 1);
  assert.equal(result.crm_leads[0].qualification.status, "needs_review");
  assert.equal(result.notifications.length, 0);
  assert.deepEqual(mapping.unresolved_source_paths, ["lead.monthly_budget"]);
  assert.deepEqual(mapping.defaults_applied, [{ target_field: "monthly_budget", value: 0 }]);
  assert.equal(mapping.source_value_observations[0].value, 6100);
  assert.equal(result.lead_state, fixture.expected.defective.lead_state);
});

test("version-aware mapping preserves the renamed qualification value", async () => {
  const fixture = await json("fixtures/lead-schema-field-change.json");
  const result = evaluateRepairedSchemaChangeFixture(fixture);
  const mapping = result.mapping_observations[0];
  assert.equal(result.crm_leads.length, 1);
  assert.equal(result.crm_leads[0].qualification.status, "qualified");
  assert.equal(result.notifications.length, 1);
  assert.deepEqual(mapping.unresolved_source_paths, []);
  assert.equal(mapping.aliases_applied[0].source_path, "lead.estimated_monthly_budget");
  assert.equal(mapping.mapped_values.monthly_budget, 6100);
  assert.equal(result.lead_state, fixture.expected.repaired.lead_state);
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
