import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateDefectiveLeadFixture
} from "../packages/n8n-operational-package/src/index.js";
import { sha256Digest } from "../src/canonical-json.js";
import { createContentAddressedArtifactStore } from "../src/content-addressed-artifact-store.js";
import { buildReproductionBundle } from "../src/diagnostic-reproduction-contracts.js";
import { normalizeRuntimeEventEnvelope } from "../src/runtime-event-envelope.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages", "n8n-operational-package");
const outputRoot = path.join(os.tmpdir(), "alphonse-agency-lab", "lead-case-001");
const workerRoot = path.join(outputRoot, "worker");
const controllerRoot = path.join(outputRoot, "controller");
const readPackageJson = async (relativePath) => JSON.parse(
  await readFile(path.join(packageRoot, relativePath), "utf8")
);
async function readTree(directory) {
  const contents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) contents.push(...await readTree(entryPath));
    else contents.push(await readFile(entryPath, "utf8"));
  }
  return contents;
}

const fixture = await readPackageJson("fixtures/lead-duplicate-webhook.json");
const workflow = await readPackageJson("workflows/lead-ingestion-defective.json");
const reporter = await readPackageJson("workflows/alphonse-event-reporter.json");
const defective = evaluateDefectiveLeadFixture(fixture);

assert.equal(defective.crm_leads.length, 2);
assert.equal(defective.notifications.length, 2);
assert.equal(defective.external_effects.length, 4);
assert.deepEqual(defective.duplicate_submission_ids, ["FORM-LEAD-1001"]);

const caseId = "a6bc9eb3-f218-4d3d-b59a-f445a821a001";
const traceId = "a6bc9eb3-f218-4d3d-b59a-f445a821a002";
const revisionId = "a6bc9eb3-f218-4d3d-b59a-f445a821a003";
const failureSpecificationId = "a6bc9eb3-f218-4d3d-b59a-f445a821a004";
const workflowId = "workflow:agency-lab-lead-ingestion";
const workflowMaterialDigest = sha256Digest({
  workflow_id: workflowId,
  workflow,
  reporter
});

const inboundEvents = fixture.lead_form_events.map((event, index) => ({
  event_id: event.event_id,
  event_sequence: index + 1,
  event_type: "lead_form_received",
  submission_id: event.submission_id,
  occurred_at: event.received_at,
  payload_digest: sha256Digest(event)
}));
const externalEffects = defective.external_effects.map((effect, index) => ({
  effect_id: `lead-effect-${String(index + 1).padStart(3, "0")}`,
  event_id: effect.event_id,
  submission_id: fixture.lead_form_events.find((event) => event.event_id === effect.event_id).submission_id,
  system: effect.system,
  operation: effect.operation,
  result_id: effect.result_id,
  idempotency_key: effect.idempotency_key,
  outcome: "confirmed"
}));
const externalStateSnapshot = {
  captured_after_event_id: inboundEvents.at(-1).event_id,
  crm_leads: defective.crm_leads.map((lead) => ({
    crm_lead_id: lead.crm_lead_id,
    submission_id: lead.form_submission_id,
    created_from_event_id: lead.created_from_event_id
  })),
  notifications: defective.notifications.map((notification) => ({
    notification_id: notification.notification_id,
    submission_id: notification.form_submission_id,
    created_from_event_id: notification.created_from_event_id
  }))
};
externalStateSnapshot.snapshot_digest = sha256Digest(externalStateSnapshot);
const runtimeEvents = inboundEvents.map((event) => normalizeRuntimeEventEnvelope({
  schema_version: "0.2.0",
  adapter: { adapter_id: "alphonse.n8n.runtime", adapter_version: "0.2.0" },
  workflow_id: workflowId,
  revision_id: revisionId,
  external_execution_id: `n8n-${event.event_id}`,
  event_id: `${event.event_id}-succeeded`,
  event_sequence: 1,
  lifecycle_claim: "succeeded",
  correlation_id: event.submission_id,
  idempotency_key: `runtime-report:${event.event_id}:1`,
  occurred_at: event.occurred_at,
  payload: {
    digest: sha256Digest({
      inbound_event: event,
      effects: externalEffects.filter((effect) => effect.event_id === event.event_id)
    }),
    reference: null
  }
}));

const expectedBehavior = "One logical lead submission creates at most one CRM lead and one notification.";
const actualBehavior = "Two deliveries sharing one submission identity produced two CRM creates and two notifications.";
const failureSpecification = {
  failure_specification_id: failureSpecificationId,
  specification_digest: sha256Digest({ expectedBehavior, actualBehavior }),
  expected_behavior: expectedBehavior,
  actual_behavior: actualBehavior,
  reproduction_conditions: [
    "Replay the two preserved inbound deliveries in recorded order.",
    "Start from the preserved empty CRM and notification state."
  ],
  targeted_verification: {
    expected_behavior: expectedBehavior,
    prohibited_behavior: "More than one CRM lead or notification for one submission identity."
  }
};
const redactedDetail = {
  input: {
    inbound_events: inboundEvents,
    lead_payloads: "[REDACTED]"
  },
  fixtures: {
    external_effects: externalEffects,
    external_state_snapshot: externalStateSnapshot
  }
};
const reproductionBundle = buildReproductionBundle({
  caseId,
  revisionId,
  revisionMaterialDigest: workflowMaterialDigest,
  failureSpecification,
  redactedDetail,
  assumptions: [
    "Event and effect identifiers are immutable.",
    "The external state snapshot was captured after both deliveries completed."
  ],
  policyDigest: sha256Digest({
    policy_id: "agency-lab.lead-evidence.v1",
    included: ["event identity", "submission identity", "effect identity", "external state"],
    excluded: ["lead payload", "controller diagnosis"]
  }),
  sourceDetailDigest: sha256Digest({ fixture, defective }),
  reproduction: {
    status: "demonstrated",
    processed_event_count: defective.processed_event_count,
    observed_external_effect_count: defective.external_effects.length,
    actual_behavior: actualBehavior
  },
  redaction: {
    redacted_paths: ["input.lead_payloads"],
    omitted_paths: ["controller.answer_key", "input.lead_payloads.raw"]
  }
});

const caseRegistration = {
  operation_id: "diagnostic.case.report_failure",
  case_id: caseId,
  trace_id: traceId,
  workflow_id: workflowId,
  revision_id: revisionId,
  workflow_material_digest: workflowMaterialDigest,
  summary: "One logical lead submission is associated with repeated confirmed external effects."
};
const workerEvidence = {
  schema_version: "0.1.0",
  scenario_id: "agency-lab.lead-ingestion.case-001.v1",
  case_registration: caseRegistration,
  runtime_events: runtimeEvents,
  reproduction_bundle: reproductionBundle,
  authority: {
    evidence_read: "granted",
    external_effects: "not_granted",
    repair: "not_granted",
    promotion: "not_granted"
  }
};
const controllerAnswerKey = {
  scenario_id: workerEvidence.scenario_id,
  fault_class: "missing_idempotency_gate",
  defect_path: fixture.expected.defective.defect_path,
  expected_repair: fixture.expected.repaired
};

const workerText = JSON.stringify(workerEvidence);
for (const prohibited of [
  "fault_class",
  controllerAnswerKey.fault_class,
  fixture.expected.defective.defect_path,
  fixture.expected.repaired.lead_state,
  "duplicate-webhook",
  "duplicate_webhook",
  "required_idempotency_key"
]) {
  assert.equal(workerText.includes(prohibited), false, `worker evidence leaked controller answer: ${prohibited}`);
}
assert.equal(workerText.includes("lead-event-1001-a"), true);
assert.equal(workerText.includes("lead-event-1001-b"), true);
assert.equal(workerText.match(/FORM-LEAD-1001/g).length >= 6, true);
assert.equal(workerEvidence.reproduction_bundle.fixtures.external_effects.length, 4);
assert.equal(workerEvidence.reproduction_bundle.fixtures.external_state_snapshot.crm_leads.length, 2);
assert.equal(workerEvidence.reproduction_bundle.fixtures.external_state_snapshot.notifications.length, 2);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(workerRoot, { recursive: true });
await mkdir(controllerRoot, { recursive: true });
const artifactStore = createContentAddressedArtifactStore(path.join(workerRoot, "artifacts"));
const evidenceArtifact = await artifactStore.putJson(workerEvidence);
const workerManifest = {
  schema_version: "0.1.0",
  case_id: caseId,
  evidence_artifact_digest: evidenceArtifact.artifact_digest,
  evidence_file: "evidence.json",
  answer_key_included: false
};
const workerManifestText = JSON.stringify(workerManifest);
assert.equal(workerManifestText.includes("controller"), false);
assert.equal(workerManifestText.includes("fault_class"), false);

await writeFile(path.join(workerRoot, "evidence.json"), `${JSON.stringify(workerEvidence, null, 2)}\n`, "utf8");
await writeFile(path.join(workerRoot, "manifest.json"), `${JSON.stringify(workerManifest, null, 2)}\n`, "utf8");
await writeFile(path.join(controllerRoot, "answer-key.json"),
  `${JSON.stringify(controllerAnswerKey, null, 2)}\n`, "utf8");

const workerArtifactBytes = (await readTree(workerRoot)).join("\n");
for (const prohibited of [
  "fault_class",
  controllerAnswerKey.fault_class,
  fixture.expected.defective.defect_path,
  fixture.expected.repaired.lead_state,
  "duplicate-webhook",
  "duplicate_webhook",
  "required_idempotency_key"
]) {
  assert.equal(workerArtifactBytes.includes(prohibited), false,
    `written worker artifact leaked controller answer: ${prohibited}`);
}

console.log(JSON.stringify({
  status: "case packaged, worker-visible evidence complete, answer key withheld.",
  case_id: caseId,
  evidence_artifact_digest: evidenceArtifact.artifact_digest,
  worker_workspace: workerRoot,
  controller_workspace: controllerRoot,
  evidence_counts: {
    inbound_events: inboundEvents.length,
    crm_create_effects: externalEffects.filter((effect) => effect.operation === "create_lead").length,
    notification_effects: externalEffects.filter((effect) => effect.operation === "send_notification").length
  },
  answer_key_withheld: true
}, null, 2));
