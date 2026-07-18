import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import { selectCaseRelevantCoverage } from "../../src/diagnostic-case-coverage.js";
import {
  buildEvidencePackageMaterial,
  classifyEvidenceMaterialChange,
  DIAGNOSTIC_EVIDENCE_MATERIAL_SCHEMA
} from "../../src/diagnostic-evidence-revision.js";

const digest = (value) => sha256Digest({ value });

function inputs(effectId = "effect:one") {
  const observation = {
    receipt_id: "00000000-0000-4000-8000-000000001301",
    receipt_digest: digest("receipt"),
    observation_type: "destination.effect",
    node_key: "effect-node",
    selection_bases: ["matched_effect"],
    envelope: { grant_id: "00000000-0000-4000-8000-000000001302", stream_id: "stream:effect",
      claims: { logical_operation_id: "operation:one" } }
  };
  const effect = {
    effect_id: effectId,
    effect_class: "diagnostic_derived_external_effect",
    logical_operation_id: "operation:one",
    destination_id: "destination:one",
    integration_id: "integration:one",
    operation: "create",
    effect_identity: "commit:one",
    resource_reference: { resource_id: "resource:one" },
    request_reference: { node_key: "request-node", request_id: "request:one",
      receipt_id: observation.receipt_id, receipt_digest: observation.receipt_digest },
    status: "committed",
    commitment_basis: "designated_append_only_commit_record",
    committed_at: "2026-07-17T12:00:00.000Z",
    supporting_receipts: [{ receipt_id: observation.receipt_id,
      receipt_digest: observation.receipt_digest }],
    limitations: ["contract_bound_interpretation_not_external_truth"],
    authority: "none"
  };
  return {
    scope: { installation_id: "00000000-0000-4000-8000-00000000a001",
      environment_id: "00000000-0000-4000-8000-000000000001", workflow_id: "workflow:one",
      revision_id: "00000000-0000-4000-8000-000000001303", integration_id: "integration:one",
      logical_operation_id: "operation:one" },
    governedDependencies: [{ dependency_type: "behavior_contract", dependency_id: "contract:one",
      dependency_digest: digest("contract") }],
    selection: {
      selected_observations: [observation],
      authenticated_provenance_dependencies: [],
      selected_nodes: [{ node_key: "effect-node", node_type: "destination.effect" }],
      selected_edges: [],
      coverage_and_limitations: { streams: [{ grant_id: observation.envelope.grant_id,
        stream_id: observation.envelope.stream_id, coverage_status: "complete_through_high_water",
        missing_ranges: [] }], gaps: [], conflicts: [], rejections: [], contradictions: [],
      unresolved_relationships: [], limitations: [] },
      role_completion: { required_roles: ["designated_commit"], matched_effect_count: 1,
        selected_counts_by_type: { "destination.effect": 1 }, missing_roles: [],
        incomplete_contributing_streams: [] },
      disclosure_accounting: { selection_seed: "matched_committed_effects",
        broad_logical_operation_search_used: false, model_selected_evidence: false,
        selected_receipt_count: 1, selected_edge_count: 0,
        selected_provenance_dependency_count: 0, excluded_related_counts_by_type: {}, omitted_detail: [] }
    },
    effectProjection: { effects: [effect] },
    evaluation: {
      evaluator: { evaluator_id: "evaluator:one", evaluator_version: "0.1.0",
        operation: "count_by_correlation", input_boundary: ["behavior_contract"] },
      assertion: { comparison: "less_than_or_equal", threshold: 1 },
      measurement: { group_field: "logical_operation_id", group_value: "operation:one",
        matched_effect_count: 1, matched_effects: [{ effect_id: effectId, effect_digest: sha256Digest(effect) }] },
      coverage: { required_sources_complete: true, satisfaction_established: true,
        violation_established: false },
      result: "satisfied"
    },
    caseClaims: []
  };
}

test("material digest ignores record identity while preserving deterministic interpretation", () => {
  const first = buildEvidencePackageMaterial(inputs("effect:one"));
  const second = buildEvidencePackageMaterial(inputs("effect:replacement-record-id"));
  assert.equal(first.document.schema_version, DIAGNOSTIC_EVIDENCE_MATERIAL_SCHEMA);
  assert.equal(first.digest, second.digest);
  const changed = inputs("effect:one");
  changed.effectProjection.effects[0].status = "unknown";
  assert.notEqual(buildEvidencePackageMaterial(changed).digest, first.digest);
});

test("material changes use a closed exact classification and activation drift fails ordinary revision", () => {
  const previous = buildEvidencePackageMaterial(inputs()).document;
  const candidate = structuredClone(previous);
  candidate.coverage_and_limitations.streams[0].coverage_status = "incomplete";
  candidate.coverage_and_limitations.streams[0].missing_ranges = [["2", "2"]];
  candidate.coverage_and_limitations.gaps = [{ grant_id: candidate.coverage_and_limitations.streams[0].grant_id,
    stream_id: "stream:effect", range: ["2", "2"] }];
  candidate.deterministic_interpretation.behavior_evaluation.result = "indeterminate";
  assert.deepEqual(classifyEvidenceMaterialChange(previous, candidate), [
    "behavior_evaluation_changed", "contributing_coverage_changed"
  ]);
  const coverageOnly = structuredClone(previous);
  coverageOnly.coverage_and_limitations.streams[0].coverage_status = "incomplete";
  coverageOnly.coverage_and_limitations.streams[0].missing_ranges = [["2", "2"]];
  coverageOnly.coverage_and_limitations.gaps = [{
    grant_id: coverageOnly.coverage_and_limitations.streams[0].grant_id,
    stream_id: "stream:effect", range: ["2", "2"]
  }];
  coverageOnly.deterministic_interpretation.behavior_evaluation.coverage.required_sources_complete = false;
  assert.deepEqual(classifyEvidenceMaterialChange(previous, coverageOnly), [
    "contributing_coverage_changed"
  ]);
  const evidenceIdentityOnly = structuredClone(previous);
  evidenceIdentityOnly.deterministic_interpretation.effects[0]
    .request_reference.request_id = "request:late-material";
  evidenceIdentityOnly.deterministic_interpretation.behavior_evaluation.measurement
    .matched_material_digests[0] = digest("late-effect-material");
  assert.deepEqual(classifyEvidenceMaterialChange(previous, evidenceIdentityOnly), [
    "selected_evidence_changed"
  ]);
  const drifted = structuredClone(previous);
  drifted.governed_dependencies[0].dependency_digest = digest("changed-contract");
  assert.throws(() => classifyEvidenceMaterialChange(previous, drifted),
    (error) => error.code === "DIAGNOSTIC_EVIDENCE_REVISION_ACTIVATION_DRIFT");
  assert.deepEqual(classifyEvidenceMaterialChange(previous, drifted,
    { governedReinterpretation: true }), ["governed_reinterpretation_requested"]);
});

test("case coverage excludes unrelated streams and unattributable prefix rejections", () => {
  const selectedReceipt = "00000000-0000-4000-8000-000000001311";
  const result = selectCaseRelevantCoverage({
    correlationProjection: { coverage: {
      streams: [
        { grant_id: "grant:a", stream_id: "stream:a", coverage_status: "incomplete" },
        { grant_id: "grant:b", stream_id: "stream:b", coverage_status: "complete_through_high_water" }
      ],
      conflicts: [
        { conflict_id: "related", accepted_receipt_ids: [selectedReceipt] },
        { conflict_id: "unrelated", accepted_receipt_ids: ["other"] }
      ],
      rejections: [{ rejection_id: "unscoped" }],
      limitations: [
        { receipt_id: selectedReceipt, limitation: "selected" },
        { receipt_id: "other", limitation: "unrelated" }
      ]
    } },
    observationEvidence: [{ receipt_id: selectedReceipt,
      envelope: { grant_id: "grant:a", stream_id: "stream:a" } }]
  });
  assert.deepEqual(result.streams.map((entry) => entry.stream_id), ["stream:a"]);
  assert.deepEqual(result.conflicts.map((entry) => entry.conflict_id), ["related"]);
  assert.deepEqual(result.rejections, []);
  assert.deepEqual(result.limitations.map((entry) => entry.limitation), ["selected"]);
});
