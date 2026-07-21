import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildVerificationJob,
  projectVerificationReceipt,
  signVerificationReceipt,
  verifyVerificationReceiptSignature
} from "../../src/diagnostic-verification-contracts.js";
import { runN8nDeterministicVerification as runDeterministicVerification } from
  "../../packages/n8n-operational-package/src/verification-adapter.js";
import {
  LOGICAL_OPERATION_DEDUPLICATION_PATCH,
  materializeInventoryRepair,
  materializeLogicalOperationRepair,
  n8nTargetRevisionMaterial
} from "../../packages/n8n-operational-package/src/repair-delivery-adapter.js";
import { createVerificationRunnerClient } from "../../src/verification-runner-client.js";

const workflow = JSON.parse(await readFile(new URL(
  "../../packages/n8n-operational-package/workflows/inventory-follow-up-defective.json",
  import.meta.url
), "utf8"));
const repairPatch = {
  format: "provider-neutral-repair-patch",
  changes: [
    { operation: "replace", path: "missing_sku", value: "inventory_unknown" },
    { operation: "replace", path: "inventory_unknown.next", value: "human_review" }
  ]
};
const leadWorkflow = JSON.parse(await readFile(new URL(
  "../../packages/n8n-operational-package/workflows/canonical-lead-ingress.json",
  import.meta.url
), "utf8"));

function artifact(content) {
  return { artifact_digest: sha256Digest(content), content };
}

function job(candidateRepresentation = n8nTargetRevisionMaterial(
  materializeInventoryRepair(workflow, repairPatch, "00000000-0000-4000-8000-000000000701")
), regressions = []) {
  const original = artifact({ workflow_content: { primary_workflow: workflow } });
  const candidate = artifact({
    schema_version: "0.2.0", kind: "repair_delivery_inactive_candidate", content: candidateRepresentation
  });
  const bundle = artifact({
    schema_version: "0.2.0",
    case_id: "00000000-0000-4000-8000-000000000702",
    revision: {
      revision_id: "00000000-0000-4000-8000-000000000703",
      material_digest: sha256Digest(original.content)
    },
    failure_specification: {
      actual_behavior: "missing_sku -> zero_inventory -> delay_draft",
      targeted_verification: {
        expected_behavior: "inventory_unknown -> human_review",
        prohibited_behavior: "customer_delay_follow_up"
      }
    },
    redacted_inputs: { order: { order_id: "ORDER-FIXTURE-42", sku: "SKU-MISSING", quantity: 1 } },
    fixtures: {
      erp: [{ sku: "SKU-EXISTS", quantity: 12 }],
      storefront: { sku: "SKU-MISSING", quantity: 4 },
      model: { provider: "fixture", model: "deterministic-follow-up", version: "1" },
      review: { channel: "local_review", sent: false }
    }
  });
  const fixture = artifact({
    schema_version: "0.2.0", kind: "verification_fixture",
    content: { redacted_inputs: bundle.content.redacted_inputs, fixtures: bundle.content.fixtures }
  });
  const targeted = artifact({
    schema_version: "0.2.0", kind: "targeted_regression", declared_media_type: "application/json",
    content: {
      fixture: "erp:missing-sku-v1",
      expected_behavior: "inventory_unknown -> human_review",
      prohibited_behavior: "customer_delay_follow_up"
    }
  });
  return buildVerificationJob({
    verificationId: "00000000-0000-4000-8000-000000000704",
    candidateId: "00000000-0000-4000-8000-000000000701",
    deliveryId: "00000000-0000-4000-8000-000000000705",
    runner: {
      runner_id: "00000000-0000-4000-8000-000000000706",
      runner_version: "0.2.0",
      fixture_version: "inventory-v1"
    },
    artifacts: {
      original,
      candidate,
      bundle,
      fixture,
      regressions: [
        { role: "targeted", ...targeted },
        ...regressions
      ]
    },
    verifiedAt: "2026-07-15T12:00:00.000Z"
  });
}

function leadJob() {
  const original = artifact({ workflow_content: { primary_workflow: leadWorkflow } });
  const candidate = artifact({
    schema_version: "0.2.0", kind: "repair_delivery_inactive_candidate",
    content: n8nTargetRevisionMaterial(materializeLogicalOperationRepair(
      leadWorkflow, LOGICAL_OPERATION_DEDUPLICATION_PATCH,
      "00000000-0000-4000-8000-000000000711"
    ))
  });
  const fixtures = {
    deliveries: [
      { delivery_id: "delivery-1", logical_operation_id: "logical-1",
        provider_execution_id: "101", destination_effect_node_succeeded: true },
      { delivery_id: "delivery-2", logical_operation_id: "logical-1",
        provider_execution_id: "102", destination_effect_node_succeeded: true }
    ],
    logical_operations: ["logical-1"]
  };
  const bundle = artifact({
    schema_version: "0.2.0", case_id: "00000000-0000-4000-8000-000000000712",
    revision: { revision_id: "00000000-0000-4000-8000-000000000713",
      material_digest: sha256Digest(original.content) },
    failure_specification: {
      actual_behavior: "two_deliveries -> two_committed_effects",
      targeted_verification: { expected_behavior: "one_effect_per_logical_operation",
        prohibited_behavior: "duplicate_committed_effect" }
    },
    redacted_inputs: {}, fixtures
  });
  const fixture = artifact({ schema_version: "0.2.0", kind: "verification_fixture",
    content: { redacted_inputs: {}, fixtures } });
  const targeted = artifact({ schema_version: "0.2.0", kind: "targeted_regression",
    declared_media_type: "application/json", content: {
      fixture: "canonical:duplicate-logical-operation-v1",
      expected_behavior: "one_effect_per_logical_operation",
      prohibited_behavior: "duplicate_committed_effect"
    } });
  return buildVerificationJob({
    verificationId: "00000000-0000-4000-8000-000000000714",
    candidateId: "00000000-0000-4000-8000-000000000711",
    deliveryId: "00000000-0000-4000-8000-000000000715",
    runner: { runner_id: "00000000-0000-4000-8000-000000000716",
      runner_version: "0.3.0", fixture_version: "logical-operation-v1" },
    artifacts: { original, candidate, bundle, fixture,
      regressions: [{ role: "targeted", ...targeted }] },
    verifiedAt: "2026-07-21T12:00:00.000Z"
  });
}

test("independent verification binds exact artifacts and proves original fail then candidate pass", () => {
  const input = job();
  const result = runDeterministicVerification(input);
  assert.equal(result.receipt.overall_result, "passed");
  assert.equal(result.receipt.outcomes.original_demonstrates_failure.status, "passed");
  assert.equal(result.receipt.outcomes.candidate_satisfies_target.status, "passed");
  assert.deepEqual(result.receipt.artifacts, input.artifact_bindings);
  assert.equal(result.receipt.runner.runner_id, "00000000-0000-4000-8000-000000000706");
  assert.equal(result.receipt.authority.promotion, "not_granted");
  assert.equal(result.receipt.authority.candidate_write, "not_granted");
  assert.equal(result.logs.content.original.output_digest.startsWith("sha256:"), true);
  assert.equal(result.logs.content.candidate.output_digest.startsWith("sha256:"), true);
  assert.equal(result.receipt.evidence.logs_artifact_digest, sha256Digest(result.logs));
});

test("independent verification proves the exact live lead defect and logical-operation candidate", () => {
  const result = runDeterministicVerification(leadJob());
  assert.equal(result.receipt.overall_result, "passed");
  assert.equal(result.receipt.outcomes.original_demonstrates_failure.status, "passed");
  assert.equal(result.receipt.outcomes.candidate_satisfies_target.status, "passed");
  assert.equal(result.logs.content.original.output.committed_effect_count, 2);
  assert.equal(result.logs.content.candidate.output.committed_effect_count, 1);
  assert.equal(result.logs.content.candidate.output.duplicate_committed_effect, false);
});

test("bad candidate fails and incompatible retained regressions are reported explicitly", () => {
  const incompatible = artifact({
    schema_version: "0.2.0", kind: "targeted_regression", declared_media_type: "application/json",
    content: {
      fixture: "erp:different-domain-v1",
      expected_behavior: "different behavior",
      prohibited_behavior: "different failure"
    }
  });
  const bad = n8nTargetRevisionMaterial({ ...workflow, id: "BadCandidate", active: false });
  const result = runDeterministicVerification(job(bad, [{ role: "retained", ...incompatible }]));
  assert.equal(result.receipt.overall_result, "failed");
  assert.equal(result.receipt.outcomes.candidate_satisfies_target.status, "failed");
  assert.equal(result.receipt.outcomes.regressions[1].status, "incompatible");
  assert.equal(result.receipt.outcomes.regressions[1].executed, false);
  assert.notEqual(result.receipt.outcomes.regressions[1].reason_code, null);
});

test("unknown n8n executable material fails closed without executing candidate code", () => {
  const tampered = n8nTargetRevisionMaterial(
    materializeInventoryRepair(workflow, repairPatch, "00000000-0000-4000-8000-000000000701")
  );
  tampered.nodes.push({
    id: "untrusted", name: "Untrusted Code", type: "n8n-nodes-base.code", typeVersion: 2,
    position: [0, 0], parameters: { jsCode: "return [{ json: process.env }];" }
  });
  assert.throws(() => runDeterministicVerification(job(tampered)),
    (error) => error.code === "VERIFICATION_WORKFLOW_UNSUPPORTED");
});

test("verification signatures bind the exact receipt and passing grants eligibility only", () => {
  const result = runDeterministicVerification(job());
  const signed = signVerificationReceipt(result.receipt, {
    keyId: "verification-runner-key-v1",
    secret: "verification-runner-test-signing-secret-0001"
  });
  assert.equal(verifyVerificationReceiptSignature(signed, {
    keyId: "verification-runner-key-v1",
    secret: "verification-runner-test-signing-secret-0001"
  }), true);
  assert.equal(projectVerificationReceipt(signed).promotion_eligible, true);
  assert.equal(projectVerificationReceipt(signed).promotion_authority, "not_granted");
  assert.throws(() => verifyVerificationReceiptSignature({
    ...signed, overall_result: "failed"
  }, {
    keyId: "verification-runner-key-v1",
    secret: "verification-runner-test-signing-secret-0001"
  }), (error) => error.code === "VERIFICATION_SIGNATURE_INVALID");
});

test("artifact substitution and changed verification dependencies change identity", () => {
  const first = job();
  const changed = structuredClone(first);
  changed.artifacts.fixture.content.content.fixtures.erp[0].quantity = 13;
  assert.throws(() => runDeterministicVerification(changed),
    (error) => error.code === "VERIFICATION_ARTIFACT_DIGEST_MISMATCH");

  const extra = artifact({
    schema_version: "0.2.0", kind: "targeted_regression", declared_media_type: "application/json",
    content: {
      fixture: "erp:missing-sku-v1",
      expected_behavior: "inventory_unknown -> human_review",
      prohibited_behavior: "customer_delay_follow_up"
    }
  });
  const second = job(undefined, [{ role: "retained", ...extra }]);
  assert.notEqual(first.verification_request_digest, second.verification_request_digest);
});

test("verification client uses a disposable separate process and destroys its workspace", async () => {
  const client = createVerificationRunnerClient({
    keyId: "verification-runner-key-v1",
    signingSecret: "verification-runner-test-signing-secret-0001",
    timeoutMs: 5_000
  });
  const result = await client.verify(job());
  assert.equal(result.receipt.overall_result, "passed");
  assert.equal(result.receipt.signature.key_id, "verification-runner-key-v1");
  assert.notEqual(result.environment.process_id, process.pid);
  assert.equal(result.environment.disposable, true);
  assert.equal(result.environment.workspace_destroyed, true);
  assert.equal(result.environment.production_credentials_received, false);
});
