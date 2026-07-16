import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateDefectiveLeadFixture,
  evaluateRepairedLeadFixture
} from "../packages/n8n-operational-package/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages", "n8n-operational-package");
const readJson = async (relativePath) => JSON.parse(
  await readFile(path.join(packageRoot, relativePath), "utf8")
);

const fixture = await readJson("fixtures/lead-duplicate-webhook.json");
const workflow = await readJson("workflows/lead-ingestion-defective.json");
const defective = evaluateDefectiveLeadFixture(fixture);
const repaired = evaluateRepairedLeadFixture(fixture);
const duplicateSubmissionIds = [...new Set(
  fixture.lead_form_events.map((event) => event.submission_id)
    .filter((submissionId, index, values) => values.indexOf(submissionId) !== index)
)];

assert.equal(duplicateSubmissionIds.length, 1);
const [duplicateSubmissionId] = duplicateSubmissionIds;

assert.equal(defective.crm_leads.length, fixture.expected.defective.crm_lead_count);
assert.equal(defective.notifications.length, fixture.expected.defective.notification_count);
assert.deepEqual(defective.duplicate_submission_ids, [duplicateSubmissionId]);
assert.equal(defective.lead_state, fixture.expected.defective.lead_state);
assert.equal(defective.defect_path, fixture.expected.defective.defect_path);
assert.equal(defective.external_effects.filter((effect) => effect.operation === "create_lead").length, 2);
assert.equal(defective.external_effects.filter((effect) => effect.operation === "send_notification").length, 2);
assert.equal(defective.external_effects.every((effect) => effect.idempotency_key === null), true);

assert.equal(repaired.crm_leads.length, fixture.expected.repaired.crm_lead_count);
assert.equal(repaired.notifications.length, fixture.expected.repaired.notification_count);
assert.equal(repaired.suppressed_duplicates.length, fixture.expected.repaired.suppressed_duplicate_count);
assert.equal(repaired.lead_state, fixture.expected.repaired.lead_state);
assert.equal(repaired.external_effects.filter((effect) => effect.operation === "upsert_lead").length, 1);
assert.equal(repaired.external_effects.filter((effect) => effect.operation === "send_notification").length, 1);
assert.equal(repaired.external_effects.every((effect) =>
  effect.idempotency_key === duplicateSubmissionId), true);

const report = {
  scenario_id: "agency-lab.lead-ingestion.duplicate-webhook.v1",
  workflow: {
    id: workflow.id,
    name: workflow.name
  },
  fault_class: "missing_idempotency_gate",
  baseline_passed: true,
  failure_demonstrated: true,
  repaired_passed: true,
  duplicate_submission_id: duplicateSubmissionId,
  external_effect_counts: {
    defective: {
      crm_leads: defective.crm_leads.length,
      notifications: defective.notifications.length,
      total: defective.external_effects.length
    },
    repaired: {
      crm_leads: repaired.crm_leads.length,
      notifications: repaired.notifications.length,
      suppressed_duplicates: repaired.suppressed_duplicates.length,
      total: repaired.external_effects.length
    }
  },
  expected_kernel_question: "What evidence must Kernel preserve for a worker to diagnose this?"
};

console.log(JSON.stringify(report, null, 2));
