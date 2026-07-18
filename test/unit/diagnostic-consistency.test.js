import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DIAGNOSTIC_WORKER_OUTPUT_SCHEMA_V0_2 } from
  "../../src/diagnostic-assignment-contracts.js";
import { sha256Digest } from "../../src/canonical-json.js";
import {
  DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_DIGEST,
  DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_MANIFEST
} from "../../src/diagnostic-consistency-artifact.js";
import {
  buildWorkerRunConfiguration,
  DIAGNOSTIC_CONSISTENCY_POLICY_V0_1,
  DIAGNOSTIC_CONSISTENCY_REQUIRED_CITATION_ROLES,
  measureDiagnosticConsistency,
  validateDiagnosticConsistencyPolicy,
  validateDiagnosticConsistencyRubric
} from "../../src/diagnostic-consistency-contracts.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function configurationFixture() {
  return {
    assignmentDocument: {
      evidence_package: {
        evidence_package_id: randomUUID(),
        semantic_digest: digest("1"),
        package_artifact_digest: digest("2")
      },
      work_requirements: {
        required_worker_capabilities: [
          "produce_schema_validated_diagnostic_output", "read_exact_evidence_package"
        ],
        prohibitions: ["external_effect", "repair_execution"]
      }
    },
    workerRunDocument: {
      worker_run_id: randomUUID(),
      assignment_id: randomUUID(),
      runtime_boundary: {
        runtime: { kind: "isolated_diagnostic_worker",
          image: { digest: digest("3") } },
        model: {
          provider: "reference-provider", model: "synthetic-diagnostic-fixture",
          version: "ticket-17-v1", capability_class: "diagnostic_reasoning",
          snapshot: { identifier: "ticket-17-v1", verification: "broker_asserted" },
          reasoning: { effort: "fixed" }, sampling: { temperature: 0, top_p: 1 },
          seed: { value: null, verification: "not_supported" },
          configuration_digest: digest("4")
        },
        broker: { audience: "diagnostic-model-broker:v0.1", max_requests: 1,
          policy_digest: digest("5"), token_status: "not_issued" },
        resources: { max_memory_bytes: 536870912, max_cpus: 1, max_pids: 64,
          max_output_bytes: 1048576, max_runtime_seconds: 600 },
        data_policy: { classification: "diagnostic_internal",
          residency: "customer_controlled_installation",
          evidence_scope: "exact_assigned_package_only", provider_training: "prohibited" },
        egress_policy: { mode: "model_broker_only_after_claim",
          allowed_destination_audience: "diagnostic-model-broker:v0.1", general_egress: false }
      }
    },
    inputDocument: { assignment: {
      assignment_id: randomUUID(),
      instruction: { objective: "diagnose", required_output: "closed_schema" },
      output_schema: DIAGNOSTIC_WORKER_OUTPUT_SCHEMA_V0_2
    } }
  };
}

function score(confidence, citationKeys, investigationTypes, causalSummary, unsupported = 0) {
  return { score_document: {
    observed: { confidence },
    metrics: { citation_keys: citationKeys, investigation_types: investigationTypes,
      causal_summary: causalSummary, unsupported_claim_count: unsupported }
  } };
}

test("the canonical policy and hidden rubric are exact, package-bound, and three-of-three", () => {
  assert.deepEqual(validateDiagnosticConsistencyPolicy(DIAGNOSTIC_CONSISTENCY_POLICY_V0_1),
    DIAGNOSTIC_CONSISTENCY_POLICY_V0_1);
  assert.throws(() => validateDiagnosticConsistencyPolicy({
    ...DIAGNOSTIC_CONSISTENCY_POLICY_V0_1, required_pass_count: 2
  }), (error) => error.code === "DIAGNOSTIC_CONSISTENCY_INPUT_INVALID");

  const expectedPackage = { evidence_package_id: randomUUID(),
    semantic_digest: digest("6"), artifact_digest: digest("7") };
  const rubric = {
    schema_version: "alphonse.diagnostic-consistency-hidden-rubric.v0.1",
    rubric_id: randomUUID(),
    artifact: { artifact_id: "diagnostic-consistency-rubric:canonical", version: "v0.1" },
    expected_package: expectedPackage,
    expected_diagnosis: {
      mechanism: "identity_scope_mismatch", observed_identity_scope: "delivery",
      required_identity_scope: "logical_operation", support: "BEST_SUPPORTED_HYPOTHESIS",
      identity_cardinality: { deliveries: 2, logical_operations: 1 },
      implementation_location: { status: "not_proven", component_id: null }
    },
    required_citation_roles: DIAGNOSTIC_CONSISTENCY_REQUIRED_CITATION_ROLES,
    scoring: { required_runs: 3, required_passes: 3,
      confidence_scale: { low: 25, medium: 50, high: 75 } }
  };
  assert.deepEqual(validateDiagnosticConsistencyRubric(rubric, expectedPackage), rubric);
  assert.throws(() => validateDiagnosticConsistencyRubric(rubric, {
    ...expectedPackage, semantic_digest: digest("8")
  }), (error) => error.code === "DIAGNOSTIC_CONSISTENCY_INPUT_INVALID");
});

test("run configuration excludes ephemeral identities and detects semantic changes", () => {
  const first = configurationFixture();
  const second = structuredClone(first);
  second.workerRunDocument.worker_run_id = randomUUID();
  second.workerRunDocument.assignment_id = randomUUID();
  second.inputDocument.assignment.assignment_id = randomUUID();
  const left = buildWorkerRunConfiguration(first);
  const right = buildWorkerRunConfiguration(second);
  assert.equal(left.configuration_digest, right.configuration_digest);
  assert.deepEqual(left.limitations, [
    "model_snapshot_not_provider_verified", "seed_not_provider_verified",
    "synthetic_reference_provider_not_model_quality_evidence"
  ]);

  second.workerRunDocument.runtime_boundary.model.sampling.temperature = 0.1;
  assert.notEqual(buildWorkerRunConfiguration(second).configuration_digest,
    left.configuration_digest);
});

test("consistency metrics preserve prose variation while measuring structured convergence", () => {
  const scores = [
    score("high", ["a", "b"], ["inspect_scope"], "delivery scope differs"),
    score("high", ["a", "b"], ["inspect_scope"], "scope differs by delivery"),
    score("medium", ["a", "c"], ["inspect_scope", "inspect_provider"],
      "one operation has two deliveries", 1)
  ];
  const metrics = measureDiagnosticConsistency(scores, { low: 25, medium: 50, high: 75 });
  assert.deepEqual(metrics.confidence.values, [75, 75, 50]);
  assert.equal(metrics.confidence.population_variance, 138.888889);
  assert.equal(metrics.unsupported_claim_count.total, 1);
  assert.equal(metrics.evidence_selection_overlap.pairs.length, 3);
  assert.ok(metrics.prose_divergence.summary.mean > 0);
  assert.equal(metrics.prose_divergence.semantic_equivalence_inferred, false);
});

test("the worker output schema exposes a neutral taxonomy without rubric answer defaults", () => {
  const hypothesis = DIAGNOSTIC_WORKER_OUTPUT_SCHEMA_V0_2.properties.best_supported_hypothesis;
  assert.ok(hypothesis.properties.mechanism.enum.length > 1);
  assert.ok(hypothesis.properties.observed_identity_scope.enum.length > 1);
  assert.ok(hypothesis.properties.required_identity_scope.enum.length > 1);
  const forbiddenSchemaKeys = [];
  const visit = (value, path = "$") => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["const", "default", "examples"].includes(key)) forbiddenSchemaKeys.push(`${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(DIAGNOSTIC_WORKER_OUTPUT_SCHEMA_V0_2);
  assert.deepEqual(forbiddenSchemaKeys, []);
});

test("the consistency stage identity binds evaluator code and all dependent migrations", () => {
  assert.equal(DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_DIGEST,
    sha256Digest(DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_MANIFEST));
  const closure = new Set(DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_MANIFEST.module_closure
    .map((entry) => entry.path));
  const bound = new Set(DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_MANIFEST.bound_files
    .map((entry) => entry.path));
  for (const path of ["src/diagnostic-consistency-service.js",
    "src/diagnostic-consistency-contracts.js", "src/diagnostic-assignment-projector.js",
    "src/diagnostic-assignment-persistence.js", "src/canonical-json.js"]) {
    assert.ok(closure.has(path), `missing ${path}`);
  }
  for (const migration of ["019_model_free_diagnostic_assignments.sql",
    "022_diagnostic_dispatch_claims.sql", "023_diagnostic_worker_execution.sql",
    "024_diagnostic_consistency_tests.sql"]) {
    assert.ok(bound.has(`diagnostic-migrations/${migration}`), `missing ${migration}`);
  }
});
