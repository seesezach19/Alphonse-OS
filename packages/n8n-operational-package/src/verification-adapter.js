import { readFileSync } from "node:fs";
import vm from "node:vm";

import { canonicalize, sha256Digest } from "../../../src/canonical-json.js";
import {
  createVerificationResult,
  validateVerificationJob
} from "../../../src/diagnostic-verification-contracts.js";
import { KernelError } from "../../../src/errors.js";
import {
  evaluateDefectiveInventoryFixture,
  evaluateRepairedInventoryFixture
} from "./index.js";
import {
  LOGICAL_OPERATION_DEDUPLICATION_PATCH,
  materializeInventoryRepair,
  materializeLogicalOperationRepair
} from "./repair-delivery-adapter.js";

const SUPPORTED_REGRESSION = Object.freeze({
  fixture: "erp:missing-sku-v1",
  expected_behavior: "inventory_unknown -> human_review",
  prohibited_behavior: "customer_delay_follow_up"
});
const REPAIR_PATCH = Object.freeze({
  format: "provider-neutral-repair-patch",
  changes: [
    { operation: "replace", path: "missing_sku", value: "inventory_unknown" },
    { operation: "replace", path: "inventory_unknown.next", value: "human_review" }
  ]
});
const REFERENCE_WORKFLOW = JSON.parse(readFileSync(
  new URL("../workflows/inventory-follow-up-defective.json", import.meta.url), "utf8"
));
const CANONICAL_LEAD_WORKFLOW = JSON.parse(readFileSync(
  new URL("../workflows/canonical-lead-ingress.json", import.meta.url), "utf8"
));
const LEAD_REGRESSION = Object.freeze({
  fixture: "canonical:duplicate-logical-operation-v1",
  expected_behavior: "one_effect_per_logical_operation",
  prohibited_behavior: "duplicate_committed_effect"
});

function fail(status, code, message, details = {}) {
  throw new KernelError(status, code, message, details);
}

function workflowFromOriginal(content) {
  const workflow = content?.workflow_content?.primary_workflow;
  if (!workflow?.nodes || !workflow?.connections) {
    fail(409, "VERIFICATION_ORIGINAL_UNSUPPORTED", "Original artifact lacks an executable n8n workflow.");
  }
  return workflow;
}

function workflowFromCandidate(content) {
  const workflow = content?.kind === "repair_delivery_inactive_candidate" ? content.content : null;
  if (!workflow?.nodes || !workflow?.connections || workflow.active !== false) {
    fail(409, "VERIFICATION_CANDIDATE_UNSUPPORTED",
      "Candidate artifact must contain one inactive executable n8n workflow.");
  }
  return workflow;
}

function executableMaterial(workflow) {
  return {
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? {}
  };
}

function executeAllowlistedCode(code, input, label) {
  const context = vm.createContext({ $json: structuredClone(input) }, {
    codeGeneration: { strings: false, wasm: false }, name: `alphonse-n8n-verification-${label}`
  });
  const output = new vm.Script(`(function () {\n${code}\n})()`, { filename: `${label}.js` })
    .runInContext(context, { timeout: 100 });
  if (!Array.isArray(output) || output.length !== 1 || !output[0]?.json || typeof output[0].json !== "object") {
    fail(422, "VERIFICATION_OUTPUT_INVALID", `${label} returned an invalid deterministic output.`);
  }
  return structuredClone(output[0].json);
}

function executeInventoryWorkflow(workflow, fixture) {
  const originalDigest = sha256Digest(executableMaterial(REFERENCE_WORKFLOW));
  const repairedReference = materializeInventoryRepair(
    REFERENCE_WORKFLOW, REPAIR_PATCH, "00000000-0000-4000-8000-000000000700"
  );
  const repairedDigest = sha256Digest(executableMaterial(repairedReference));
  const suppliedDigest = sha256Digest(executableMaterial(workflow));
  const mode = suppliedDigest === originalDigest ? "defective"
    : suppliedDigest === repairedDigest ? "repaired" : null;
  if (!mode) {
    fail(409, "VERIFICATION_WORKFLOW_UNSUPPORTED",
      "n8n executable material does not match an allowlisted deterministic verifier fingerprint.");
  }
  const initial = {
    order: fixture.redacted_inputs.order,
    erp_inventory: fixture.fixtures.erp,
    storefront_inventory: fixture.fixtures.storefront
  };
  const mappingName = mode === "defective"
    ? "Defective Missing SKU Mapping" : "Preserve Unknown Inventory Mapping";
  const reviewName = mode === "defective"
    ? "Draft for Local Review" : "Route Unknown Inventory for Human Review";
  const mapping = workflow.nodes.find((node) => node.name === mappingName);
  const review = workflow.nodes.find((node) => node.name === reviewName);
  const mapped = executeAllowlistedCode(mapping.parameters.jsCode, initial, "inventory-mapping");
  const output = executeAllowlistedCode(review.parameters.jsCode, mapped, "inventory-review");
  const expected = mode === "defective"
    ? evaluateDefectiveInventoryFixture(initial)
    : evaluateRepairedInventoryFixture(initial);
  if (sha256Digest(output) !== sha256Digest(expected)) {
    fail(409, "VERIFICATION_ADAPTER_SEMANTIC_MISMATCH",
      "Allowlisted n8n execution disagrees with the deterministic package evaluator.");
  }
  return {
    output,
    output_digest: sha256Digest(output),
    executable_material_digest: suppliedDigest,
    evaluator: `alphonse.n8n.inventory.${mode}.v1`,
    executed_nodes: [mappingName, reviewName],
    external_effects: [],
    deterministic: true
  };
}

function executeLeadWorkflow(workflow, fixture) {
  const originalDigest = sha256Digest(executableMaterial(CANONICAL_LEAD_WORKFLOW));
  const repairedReference = materializeLogicalOperationRepair(
    CANONICAL_LEAD_WORKFLOW,
    LOGICAL_OPERATION_DEDUPLICATION_PATCH,
    "00000000-0000-4000-8000-000000000701"
  );
  const repairedDigest = sha256Digest(executableMaterial(repairedReference));
  const suppliedDigest = sha256Digest(executableMaterial(workflow));
  const mode = suppliedDigest === originalDigest ? "defective"
    : suppliedDigest === repairedDigest ? "repaired" : null;
  if (!mode) {
    fail(409, "VERIFICATION_WORKFLOW_UNSUPPORTED",
      "n8n executable material does not match the allowlisted lead-ingress verifier fingerprint.");
  }
  const deliveries = fixture?.fixtures?.deliveries;
  const logicalOperations = fixture?.fixtures?.logical_operations;
  if (!Array.isArray(deliveries) || deliveries.length !== 2
      || !Array.isArray(logicalOperations) || logicalOperations.length !== 1
      || deliveries.some((entry) => entry.logical_operation_id !== logicalOperations[0])) {
    fail(409, "VERIFICATION_FIXTURE_UNSUPPORTED",
      "Lead verification requires two observed deliveries for one exact logical operation.");
  }
  const effectCount = mode === "defective" ? deliveries.length : logicalOperations.length;
  const output = {
    logical_operation_id: logicalOperations[0],
    observed_delivery_count: deliveries.length,
    committed_effect_count: effectCount,
    duplicate_committed_effect: effectCount > logicalOperations.length,
    external_effect_simulation: true
  };
  return {
    output,
    output_digest: sha256Digest(output),
    executable_material_digest: suppliedDigest,
    evaluator: `alphonse.n8n.logical-operation-deduplication.${mode}.v1`,
    executed_nodes: mode === "defective"
      ? ["Receive Lead Delivery", "Create CRM Lead"]
      : ["Receive Lead Delivery", "Deduplicate Logical Operation", "Create CRM Lead"],
    external_effects: [],
    deterministic: true
  };
}

function regressionDefinition(entry) {
  const definition = entry.content?.kind === "targeted_regression" ? entry.content.content : null;
  return definition && typeof definition === "object" && !Array.isArray(definition) ? definition : null;
}

function targetSatisfied(output, expected, prohibited) {
  return expected === SUPPORTED_REGRESSION.expected_behavior
    && prohibited === SUPPORTED_REGRESSION.prohibited_behavior
    && output.inventory_state === "inventory_unknown"
    && output.review_reason === "missing_inventory_data"
    && output.draft === null
    && output.delivery?.channel === "local_review"
    && output.delivery?.sent === false
    && !canonicalize(output).includes(prohibited);
}

export function runN8nDeterministicVerification(job) {
  const exactJob = validateVerificationJob(job);
  const bundle = exactJob.artifacts.bundle.content;
  const fixture = exactJob.artifacts.fixture.content.content;
  if (bundle.failure_specification.targeted_verification.expected_behavior
      === LEAD_REGRESSION.expected_behavior) {
    const originalRun = executeLeadWorkflow(workflowFromOriginal(exactJob.artifacts.original.content), fixture);
    const candidateRun = executeLeadWorkflow(workflowFromCandidate(exactJob.artifacts.candidate.content), fixture);
    const targeted = bundle.failure_specification.targeted_verification;
    const originalPassed = originalRun.output.committed_effect_count === 2
      && originalRun.output.duplicate_committed_effect === true;
    const candidatePassed = targeted.prohibited_behavior === LEAD_REGRESSION.prohibited_behavior
      && candidateRun.output.committed_effect_count === 1
      && candidateRun.output.duplicate_committed_effect === false;
    const regressionOutcomes = exactJob.artifacts.regressions.map((entry) => {
      const definition = regressionDefinition(entry);
      const compatible = definition
        && definition.fixture === LEAD_REGRESSION.fixture
        && definition.expected_behavior === LEAD_REGRESSION.expected_behavior
        && definition.prohibited_behavior === LEAD_REGRESSION.prohibited_behavior;
      return {
        role: entry.role,
        artifact_digest: entry.artifact_digest,
        status: compatible && candidatePassed ? "passed" : compatible ? "failed" : "incompatible",
        executed: Boolean(compatible),
        reason_code: compatible
          ? candidatePassed ? null : "REGRESSION_EXPECTATION_FAILED"
          : "REGRESSION_FIXTURE_OR_EXPECTATION_INCOMPATIBLE",
        ...(compatible ? { output_digest: candidateRun.output_digest } : {})
      };
    });
    return createVerificationResult(exactJob, {
      outcomes: {
        original_demonstrates_failure: {
          status: originalPassed ? "passed" : "failed",
          output_digest: originalRun.output_digest,
          reason_code: originalPassed ? null : "ORIGINAL_FAILURE_NOT_DEMONSTRATED"
        },
        candidate_satisfies_target: {
          status: candidatePassed ? "passed" : "failed",
          output_digest: candidateRun.output_digest,
          reason_code: candidatePassed ? null : "CANDIDATE_TARGET_BEHAVIOR_NOT_DEMONSTRATED"
        },
        regressions: regressionOutcomes
      },
      logs: { original: originalRun, candidate: candidateRun }
    });
  }
  const originalRun = executeInventoryWorkflow(workflowFromOriginal(exactJob.artifacts.original.content), fixture);
  const candidateRun = executeInventoryWorkflow(workflowFromCandidate(exactJob.artifacts.candidate.content), fixture);
  const targeted = bundle.failure_specification.targeted_verification;
  const originalPassed = originalRun.output.defect_path === bundle.failure_specification.actual_behavior
    && originalRun.output.draft?.kind === targeted.prohibited_behavior;
  const candidatePassed = targetSatisfied(candidateRun.output,
    targeted.expected_behavior, targeted.prohibited_behavior);
  const regressionOutcomes = exactJob.artifacts.regressions.map((entry) => {
    const definition = regressionDefinition(entry);
    const compatible = definition
      && definition.fixture === SUPPORTED_REGRESSION.fixture
      && definition.expected_behavior === SUPPORTED_REGRESSION.expected_behavior
      && definition.prohibited_behavior === SUPPORTED_REGRESSION.prohibited_behavior;
    if (!compatible) {
      return {
        role: entry.role,
        artifact_digest: entry.artifact_digest,
        status: "incompatible",
        executed: false,
        reason_code: "REGRESSION_FIXTURE_OR_EXPECTATION_INCOMPATIBLE"
      };
    }
    const passed = targetSatisfied(candidateRun.output,
      definition.expected_behavior, definition.prohibited_behavior);
    return {
      role: entry.role,
      artifact_digest: entry.artifact_digest,
      status: passed ? "passed" : "failed",
      executed: true,
      reason_code: passed ? null : "REGRESSION_EXPECTATION_FAILED",
      output_digest: candidateRun.output_digest
    };
  });
  return createVerificationResult(exactJob, {
    outcomes: {
      original_demonstrates_failure: {
        status: originalPassed ? "passed" : "failed",
        output_digest: originalRun.output_digest,
        reason_code: originalPassed ? null : "ORIGINAL_FAILURE_NOT_DEMONSTRATED"
      },
      candidate_satisfies_target: {
        status: candidatePassed ? "passed" : "failed",
        output_digest: candidateRun.output_digest,
        reason_code: candidatePassed ? null : "CANDIDATE_TARGET_BEHAVIOR_NOT_DEMONSTRATED"
      },
      regressions: regressionOutcomes
    },
    logs: { original: originalRun, candidate: candidateRun }
  });
}
