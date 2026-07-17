import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalize, sha256Digest } from "../../src/canonical-json.js";
import {
  buildDiagnosticEvidenceArtifactManifest,
  collectDiagnosticEvidenceModuleClosure,
  DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST
} from "../../src/diagnostic-evidence-artifact.js";
import {
  calculateRetentionRequirements,
  validateDiagnosticRetentionPolicy,
  validateEvidenceSelectionPolicy
} from "../../src/diagnostic-evidence-contracts.js";
import {
  decideEvidenceFreeze,
  selectDiagnosticEvidence
} from "../../src/diagnostic-evidence-selector.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const digest = (value) => sha256Digest({ value });
const operationId = "operation:00000000-0000-4000-8000-000000001001";

function selectionPolicy() {
  return {
    schema_version: "alphonse.evidence-selection-policy.v0.1",
    policy_id: "policy:typed-effect-ancestors",
    seed: "matched_committed_effects",
    required_roles: ["designated_commit", "destination_request", "source_delivery",
      "terminal_runtime_execution"],
    required_relationships: ["delivery_reported_execution", "delivery_reported_request",
      "logical_operation_contains_delivery", "request_reported_ledger_claim"],
    allowed_relationships: ["delivery_identity_equals_request_key", "delivery_reported_execution",
      "delivery_reported_request", "logical_operation_contains_delivery", "request_keys_are_distinct",
      "request_reported_ledger_claim"],
    coverage: {
      require_contributing_streams_complete: true,
      include_gaps: true,
      include_conflicts: true,
      include_rejections: true,
      include_unresolved_relationships: true,
      include_limitations: true
    },
    provenance: { follow_tokenization_dependencies: true, require_complete_proof_chain: true },
    detail: { allowed_media_types: [], omission_reason: "policy_excludes_opaque_detail" },
    optional_roles: ["destination_snapshot"]
  };
}

function retentionPolicy() {
  return {
    schema_version: "alphonse.diagnostic-retention-policy.v0.1",
    policy_id: "policy:first-evidence-package-retention",
    ordinary_retention_seconds: 300,
    collection_lease_seconds: 240,
    package_pin_seconds: 604800,
    pretrigger_observation_horizon_seconds: 120,
    pretrigger_stage_intervals: [
      { stage: "correlation_projection", max_scheduling_delay_seconds: 10, max_retry_delay_seconds: 20 },
      { stage: "effect_interpretation", max_scheduling_delay_seconds: 10, max_retry_delay_seconds: 20 },
      { stage: "behavior_evaluation", max_scheduling_delay_seconds: 10, max_retry_delay_seconds: 20 },
      { stage: "diagnostic_trigger", max_scheduling_delay_seconds: 10, max_retry_delay_seconds: 20 }
    ],
    collection_window_seconds: 60,
    post_trigger_stage_intervals: [
      { stage: "evidence_collection", max_scheduling_delay_seconds: 10, max_retry_delay_seconds: 20 },
      { stage: "evidence_packaging", max_scheduling_delay_seconds: 10, max_retry_delay_seconds: 20 },
      { stage: "assignment_creation", max_scheduling_delay_seconds: 10, max_retry_delay_seconds: 20 }
    ],
    gc_margin_seconds: 30
  };
}

function evidenceInputs() {
  const operation = { node_key: "operation", node_type: "logical_operation", claimed_identity: operationId,
    receipt_reference: null, identity_claim_location: null };
  const nodes = [operation];
  const edges = [];
  const observations = [];
  const effects = [];
  for (let index = 1; index <= 2; index += 1) {
    const receipt = (offset) => `00000000-0000-4000-8000-000000001${offset}${index}`;
    const source = { node_key: `source-${index}`, node_type: "source.delivery",
      claimed_identity: `delivery-${index}`, receipt_reference: { receipt_id: receipt(1),
        receipt_digest: digest(`source-${index}`), intake_position: String(index) } };
    const runtime = { node_key: `runtime-${index}`, node_type: "runtime.execution",
      claimed_identity: `execution-${index}`, receipt_reference: { receipt_id: receipt(2),
        receipt_digest: digest(`runtime-${index}`), intake_position: String(index + 2) } };
    const request = { node_key: `request-${index}`, node_type: "destination.request",
      claimed_identity: `request-${index}`, receipt_reference: { receipt_id: receipt(3),
        receipt_digest: digest(`request-${index}`), intake_position: String(index + 4) } };
    const effectNode = { node_key: `effect-${index}`, node_type: "destination.effect",
      claimed_identity: `commit-${index}`, receipt_reference: { receipt_id: receipt(4),
        receipt_digest: digest(`effect-${index}`), intake_position: String(index + 6) } };
    nodes.push(source, runtime, request, effectNode);
    const addEdge = (relationship, from, to, provenance = []) => edges.push({
      edge_key: `${relationship}-${index}-${edges.length}`,
      relationship,
      from_node_key: from.node_key,
      to_node_key: to.node_key,
      basis: "exact",
      supporting_claim_locations: [],
      supporting_tokenization_provenance: provenance
    });
    addEdge("logical_operation_contains_delivery", operation, source);
    addEdge("delivery_reported_execution", source, runtime);
    addEdge("delivery_reported_request", source, request);
    addEdge("request_reported_ledger_claim", request, effectNode);
    addEdge("delivery_identity_equals_request_key", source, request, [{
      result_receipt_id: `00000000-0000-4000-8000-0000000015${index}`,
      receipt_digest: digest(`token-${index}`),
      grant_snapshot_digest: digest(`snapshot-${index}`),
      grant_application_receipt_digest: digest(`application-${index}`)
    }]);
    observations.push(
      { receipt_id: source.receipt_reference.receipt_id, receipt_digest: source.receipt_reference.receipt_digest,
        envelope: { claims: { delivery_id: `delivery-${index}`, logical_operation_id: operationId } } },
      { receipt_id: runtime.receipt_reference.receipt_id, receipt_digest: runtime.receipt_reference.receipt_digest,
        envelope: { claims: { execution_id: `execution-${index}`, lifecycle: "succeeded",
          logical_operation_id: operationId } } },
      { receipt_id: request.receipt_reference.receipt_id, receipt_digest: request.receipt_reference.receipt_digest,
        envelope: { claims: { request_id: `request-${index}`, logical_operation_id: operationId } } },
      { receipt_id: effectNode.receipt_reference.receipt_id,
        receipt_digest: effectNode.receipt_reference.receipt_digest,
        envelope: { claims: { commit_id: `commit-${index}`, logical_operation_id: operationId } } }
    );
    effects.push({
      effect_id: `00000000-0000-4000-8000-0000000016${index}`,
      effect_class: "diagnostic_derived_external_effect",
      logical_operation_id: operationId,
      destination_id: "destination:crm-primary",
      integration_id: "integration:mock-crm",
      operation: "create_lead",
      effect_identity: `commit-${index}`,
      resource_reference: { resource_id: `resource-${index}` },
      request_reference: { node_key: request.node_key, request_id: `request-${index}`,
        receipt_id: request.receipt_reference.receipt_id, receipt_digest: request.receipt_reference.receipt_digest },
      status: "committed",
      commitment_basis: "designated_append_only_commit_record",
      committed_at: `2026-07-17T15:00:0${index}.000Z`,
      supporting_receipts: [request.receipt_reference, effectNode.receipt_reference]
        .map(({ receipt_id, receipt_digest }) => ({ receipt_id, receipt_digest })),
      limitations: ["contract_bound_interpretation_not_external_truth"],
      authority: "none"
    });
  }
  edges.push({
    edge_key: "request-keys-distinct",
    relationship: "request_keys_are_distinct",
    from_node_key: "request-1",
    to_node_key: "request-2",
    basis: "exact",
    supporting_claim_locations: [],
    supporting_tokenization_provenance: []
  });
  const tokenization = [1, 2].map((index) => ({
    result_receipt_id: `00000000-0000-4000-8000-0000000015${index}`,
    receipt_digest: digest(`token-${index}`),
    grant_snapshot_digest: digest(`snapshot-${index}`),
    grant_application_receipt_digest: digest(`application-${index}`),
    requester_principal_id: "principal:test",
    integration_id: "integration:mock-crm",
    field_role: "delivery_identity",
    claim_field: "delivery_identity_equality_token",
    namespace: "namespace:test",
    algorithm_version: "0.1.0",
    raw_input_preserved: false
  }));
  const correlation = {
    schema_version: "alphonse.correlation-projection.v0.2",
    scope: { logical_operation_id: operationId },
    manifests: {
      tokenization_provenance: tokenization,
      receipts: observations.map((entry) => ({ receipt_id: entry.receipt_id, detail_artifact_digest: null }))
    },
    coverage: { streams: [{ grant_id: "grant:test", stream_id: "stream:test",
      coverage_status: "complete_through_high_water", missing_ranges: [] }],
    conflicts: [], rejections: [], limitations: [] },
    graph: {
      counts_by_type: { "destination.effect": 2, "destination.request": 2,
        "runtime.execution": 2, "source.delivery": 2 },
      nodes,
      edges,
      unresolved_relationships: []
    }
  };
  const effectProjection = { schema_version: "alphonse.diagnostic-effect-projection.v0.1", effects };
  const evaluation = {
    schema_version: "alphonse.behavior-evaluation.v0.1",
    result: "violated",
    measurement: {
      matched_effect_count: 2,
      matched_effects: effects.map((effect) => ({ effect_id: effect.effect_id, effect_digest: sha256Digest(effect) }))
    }
  };
  return { correlation, effectProjection, evaluation, observations };
}

test("retention readiness validates complete cumulative critical paths", () => {
  const policy = retentionPolicy();
  const requirements = calculateRetentionRequirements(policy);
  assert.deepEqual(requirements, {
    pretrigger_observation_horizon_seconds: 120,
    pretrigger_pipeline_retry_horizon_seconds: 120,
    ordinary_retention_min_seconds: 270,
    collection_window_seconds: 60,
    post_trigger_retry_horizon_seconds: 90,
    collection_lease_min_seconds: 180
  });
  assert.equal(validateDiagnosticRetentionPolicy(policy).ordinary_retention_seconds, 300);
  assert.equal(validateEvidenceSelectionPolicy(selectionPolicy()).seed, "matched_committed_effects");

  const individuallyPlausibleButCumulativelyShort = retentionPolicy();
  individuallyPlausibleButCumulativelyShort.ordinary_retention_seconds = 200;
  assert.throws(() => validateDiagnosticRetentionPolicy(individuallyPlausibleButCumulativelyShort),
    (error) => error.code === "DIAGNOSTIC_EVIDENCE_POLICY_INVALID"
      && error.details.required_ordinary_retention_seconds === 270);
});

test("selection begins at matched effects and follows exact typed ancestor paths", () => {
  const input = evidenceInputs();
  const selected = selectDiagnosticEvidence({
    correlationProjection: input.correlation,
    effectProjection: input.effectProjection,
    behaviorEvaluation: input.evaluation,
    observationEvidence: input.observations,
    selectionPolicy: selectionPolicy()
  });
  assert.equal(selected.required_sources_complete, true);
  assert.equal(selected.selected_observations.length, 8);
  assert.deepEqual(selected.role_completion.selected_counts_by_type, {
    "destination.effect": 2,
    "destination.request": 2,
    "runtime.execution": 2,
    "source.delivery": 2
  });
  assert.equal(selected.authenticated_provenance_dependencies.length, 2);
  assert.equal(selected.disclosure_accounting.broad_logical_operation_search_used, false);
  assert.equal(selected.disclosure_accounting.model_selected_evidence, false);
  assert.ok(Object.values(selected.disclosure_accounting.excluded_related_counts_by_type)
    .every((count) => count === 0));
  assert.deepEqual(selected.coverage_and_limitations.contradictions, []);
  assert.ok(selected.selected_edges.some((edge) => edge.relationship === "request_keys_are_distinct"));

  const reordered = selectDiagnosticEvidence({
    correlationProjection: { ...input.correlation, graph: { ...input.correlation.graph,
      nodes: [...input.correlation.graph.nodes].reverse(), edges: [...input.correlation.graph.edges].reverse() } },
    effectProjection: input.effectProjection,
    behaviorEvaluation: input.evaluation,
    observationEvidence: [...input.observations].reverse(),
    selectionPolicy: selectionPolicy()
  });
  assert.equal(canonicalize(reordered), canonicalize(selected));
});

test("selected observation dependencies and contradictory typed paths remain disclosed", () => {
  const input = evidenceInputs();
  const extraProvenance = {
    result_receipt_id: "00000000-0000-4000-8000-000000001599",
    receipt_digest: digest("token-extra"),
    grant_snapshot_digest: digest("snapshot-extra"),
    grant_application_receipt_digest: digest("application-extra"),
    requester_principal_id: "principal:test",
    integration_id: "integration:mock-crm",
    field_role: "delivery_identity",
    claim_field: "delivery_identity_equality_token",
    namespace: "namespace:test",
    algorithm_version: "0.1.0",
    raw_input_preserved: false
  };
  input.correlation.manifests.tokenization_provenance.push(extraProvenance);
  input.observations[0].envelope.provenance_dependencies = [extraProvenance.result_receipt_id];
  input.correlation.graph.edges.push({
    edge_key: "contradictory-request-path",
    relationship: "request_reported_ledger_claim",
    from_node_key: "request-2",
    to_node_key: "effect-1",
    basis: "exact",
    supporting_claim_locations: [],
    supporting_tokenization_provenance: []
  });
  const selected = selectDiagnosticEvidence({
    correlationProjection: input.correlation,
    effectProjection: input.effectProjection,
    behaviorEvaluation: input.evaluation,
    observationEvidence: input.observations,
    selectionPolicy: selectionPolicy()
  });
  assert.equal(selected.required_sources_complete, false);
  assert.equal(selected.authenticated_provenance_dependencies.length, 3);
  assert.deepEqual(selected.coverage_and_limitations.contradictions, [{
    contradiction_type: "typed_path_cardinality_conflict",
    effect_id: input.effectProjection.effects[0].effect_id,
    role: "destination_request",
    reason: "ambiguous_destination_request",
    candidate_count: 2,
    from_node_key: "effect-1"
  }]);
  assert.ok(selected.selected_edges.some((edge) => edge.edge_key === "contradictory-request-path"));
});

test("missing terminal evidence waits until the durable collection deadline", () => {
  const input = evidenceInputs();
  input.correlation.graph.edges = input.correlation.graph.edges.filter((edge) =>
    !(edge.relationship === "delivery_reported_execution" && edge.to_node_key === "runtime-2"));
  const selected = selectDiagnosticEvidence({
    correlationProjection: input.correlation,
    effectProjection: input.effectProjection,
    behaviorEvaluation: input.evaluation,
    observationEvidence: input.observations,
    selectionPolicy: selectionPolicy()
  });
  assert.equal(selected.required_sources_complete, false);
  assert.ok(selected.role_completion.missing_roles.some((entry) =>
    entry.role === "terminal_runtime_execution"));
  assert.deepEqual(decideEvidenceFreeze({
    requiredSourcesComplete: false,
    collectionDeadline: "2026-07-17T15:01:00.000Z",
    now: "2026-07-17T15:00:30.000Z"
  }), {
    ready: false,
    reason: "awaiting_required_sources",
    assessed_at: "2026-07-17T15:00:30.000Z",
    wake_at: "2026-07-17T15:01:00.000Z"
  });
  assert.equal(decideEvidenceFreeze({
    requiredSourcesComplete: false,
    collectionDeadline: "2026-07-17T15:01:00.000Z",
    now: "2026-07-17T15:01:00.000Z"
  }).reason, "collection_deadline");
});

test("evidence stage identity binds selector, policy, persistence, packager, and migration", () => {
  const closure = collectDiagnosticEvidenceModuleClosure();
  for (const required of [
    "src/canonical-json.js",
    "src/correlation-input-integrity.js",
    "src/diagnostic-evidence-collection-persistence.js",
    "src/diagnostic-evidence-contracts.js",
    "src/diagnostic-evidence-package-service.js",
    "src/diagnostic-evidence-selector.js"
  ]) assert.ok(closure.includes(required), required);
  assert.match(DIAGNOSTIC_EVIDENCE_STAGE_ARTIFACT_DIGEST, /^sha256:[0-9a-f]{64}$/u);
  const baseline = sha256Digest(buildDiagnosticEvidenceArtifactManifest());
  for (const changedPath of [
    "src/diagnostic-evidence-package-service.js",
    "src/diagnostic-evidence-selector.js",
    "src/diagnostic-evidence-contracts.js",
    "diagnostic-migrations/017_evidence_collection_and_packages.sql",
    "package-lock.json"
  ]) {
    const manifest = buildDiagnosticEvidenceArtifactManifest({
      readFile(absolutePath, encoding) {
        const value = readFileSync(absolutePath, encoding);
        const relative = path.relative(root, absolutePath).replaceAll(path.sep, "/");
        if (relative !== changedPath) return value;
        return encoding ? `${value}\n// simulated semantic drift\n`
          : Buffer.concat([value, Buffer.from("\n// simulated semantic drift\n", "utf8")]);
      }
    });
    assert.notEqual(sha256Digest(manifest), baseline, changedPath);
  }
});
