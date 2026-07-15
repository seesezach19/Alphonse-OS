import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExtractionAndRedaction,
  buildReproductionBundle,
  projectDiagnosticCase,
  validateFailureSpecification
} from "../../src/diagnostic-reproduction-contracts.js";

const human = { type: "human", id: "local-bootstrap-operator" };

test("Failure Specification requires explicit human confirmation and exact fields", () => {
  const input = {
    case_id: "00000000-0000-4000-8000-000000000404",
    expected_behavior: "inventory_unknown -> human_review",
    actual_behavior: "missing_sku -> zero_inventory -> delay_draft",
    reproduction_conditions: ["ERP fixture has no matching SKU", "storefront fixture reports stock"],
    targeted_verification: {
      expected_behavior: "inventory_unknown -> human_review",
      prohibited_behavior: "customer_delay_follow_up"
    }
  };
  assert.deepEqual(validateFailureSpecification(input, human), input);
  assert.throws(() => validateFailureSpecification(input, { type: "agent", id: "diagnostic-model" }),
    (error) => error.code === "HUMAN_CONFIRMATION_REQUIRED");
  assert.throws(() => validateFailureSpecification({ ...input, model_confidence: 0.99 }, human),
    (error) => error.code === "INVALID_INPUT");
  assert.throws(() => validateFailureSpecification({
    ...input,
    targeted_verification: { ...input.targeted_verification, expected_behavior: "different" }
  }, human), (error) => error.code === "FAILURE_SPECIFICATION_INCONSISTENT");
});

test("package policy extracts only required detail and redacts before durable material", () => {
  const source = {
    input: {
      order: { order_id: "ORDER-FIXTURE-42", sku: "SKU-MISSING", quantity: 1 },
      customer_email: "private@example.com",
      internal_notes: "must never become durable"
    },
    fixtures: {
      erp: [{ sku: "SKU-EXISTS", quantity: 12 }],
      storefront: { sku: "SKU-MISSING", quantity: 4 },
      model: { provider: "fixture", model: "deterministic-follow-up", version: "1" },
      review: { channel: "local_review", sent: false }
    },
    output: { defect_path: "missing_sku -> zero_inventory -> delay_draft" },
    credentials: { token: "never" }
  };
  const policy = {
    policy_id: "alphonse.runtime.n8n.detail.v1",
    extract_paths: ["input.order", "input.customer_email", "fixtures", "output.defect_path"],
    redact_paths: ["input.customer_email"],
    omit_paths: ["credentials", "input.internal_notes"],
    replacement: "[REDACTED]"
  };
  const result = applyExtractionAndRedaction(source, policy);
  assert.equal(result.content.input.customer_email, "[REDACTED]");
  assert.equal(result.content.input.internal_notes, undefined);
  assert.equal(result.content.credentials, undefined);
  assert.deepEqual(result.redacted_paths, ["input.customer_email"]);
  assert.deepEqual(result.omitted_paths, ["credentials", "input.internal_notes"]);
  assert.doesNotMatch(JSON.stringify(result), /private@example\.com|must never|never/);
  assert.throws(() => applyExtractionAndRedaction(source, {
    ...policy, extract_paths: ["__proto__.polluted"]
  }), (error) => error.code === "INVALID_REDACTION_POLICY");
});

test("Reproduction Bundle binds exact immutable inputs and integrity hashes", () => {
  const bundle = buildReproductionBundle({
    caseId: "00000000-0000-4000-8000-000000000404",
    revisionId: "00000000-0000-4000-8000-000000000403",
    revisionMaterialDigest: `sha256:${"a".repeat(64)}`,
    failureSpecification: {
      failure_specification_id: "00000000-0000-4000-8000-000000000405",
      specification_digest: `sha256:${"b".repeat(64)}`,
      expected_behavior: "inventory_unknown -> human_review",
      actual_behavior: "missing_sku -> zero_inventory -> delay_draft",
      reproduction_conditions: ["ERP fixture has no matching SKU"],
      targeted_verification: {
        expected_behavior: "inventory_unknown -> human_review",
        prohibited_behavior: "customer_delay_follow_up"
      }
    },
    redactedDetail: {
      input: { order: { sku: "SKU-MISSING" }, customer_email: "[REDACTED]" },
      fixtures: { erp: [], storefront: { quantity: 4 }, model: { version: "1" }, review: { sent: false } }
    },
    assumptions: ["fixtures are deterministic"],
    policyDigest: `sha256:${"c".repeat(64)}`,
    sourceDetailDigest: `sha256:${"d".repeat(64)}`,
    reproduction: {
      status: "demonstrated",
      actual_behavior: "missing_sku -> zero_inventory -> delay_draft",
      output_digest: `sha256:${"e".repeat(64)}`
    }
  });
  assert.equal(bundle.schema_version, "0.2.0");
  assert.equal(bundle.revision.revision_id, "00000000-0000-4000-8000-000000000403");
  assert.equal(bundle.reproduction.status, "demonstrated");
  assert.deepEqual(bundle.failure_specification.reproduction_conditions, ["ERP fixture has no matching SKU"]);
  assert.match(bundle.integrity.redacted_detail_digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(bundle.integrity.fixtures_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(bundle.authority_granted, false);
});

test("case projection advances only after demonstrated reproduction", () => {
  assert.deepEqual(projectDiagnosticCase({ failureSpecification: null, bundles: [], attempts: [] }), {
    state: "open", legal_next_operations: ["diagnostic.failure_specification.confirm"]
  });
  assert.deepEqual(projectDiagnosticCase({ failureSpecification: {}, bundles: [], attempts: [{ outcome: "incomplete" }] }), {
    state: "specified", legal_next_operations: ["diagnostic.reproduction.create"]
  });
  assert.deepEqual(projectDiagnosticCase({ failureSpecification: {}, bundles: [{ reproduction_status: "demonstrated" }], attempts: [] }), {
    state: "reproducible", legal_next_operations: ["diagnostic.repair_task.create"]
  });
});
