import { canonicalize, sha256Digest } from "./canonical-json.js";
import { validateEvidenceSelectionPolicy } from "./diagnostic-evidence-contracts.js";
import { KernelError } from "./errors.js";

export const DIAGNOSTIC_EVIDENCE_SELECTION_RULES = Object.freeze({
  schema_version: "alphonse.diagnostic-evidence-selection-rules.v0.1",
  seed: "matched_committed_effects",
  selection: "typed_graph_paths_only",
  broad_logical_operation_search: false,
  cardinality: "required_ancestors_for_every_matched_effect",
  model_selected_evidence: false,
  optional_destination_snapshot_blocks_freeze: false
});
export const DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST =
  sha256Digest(DIAGNOSTIC_EVIDENCE_SELECTION_RULES);

function compareCanonical(left, right) {
  const leftBytes = canonicalize(left);
  const rightBytes = canonicalize(right);
  return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
}

function fail(code, message, details = {}) {
  throw new KernelError(500, code, message, details);
}

function recordCardinality(values, missing, effectId, role, missingReason, context = {}) {
  if (values.length === 1) return;
  missing.push({ effect_id: effectId, role,
    reason: values.length === 0 ? missingReason : `ambiguous_${role}`,
    candidate_count: values.length,
    ...context });
}

function evidenceReference(node, bases) {
  return {
    receipt_id: node.receipt_reference.receipt_id,
    receipt_digest: node.receipt_reference.receipt_digest,
    intake_position: String(node.receipt_reference.intake_position),
    observation_type: node.node_type,
    node_key: node.node_key,
    selection_bases: [...bases].sort()
  };
}

export function selectDiagnosticEvidence({
  correlationProjection,
  effectProjection,
  behaviorEvaluation,
  observationEvidence,
  selectionPolicy
}) {
  const policy = validateEvidenceSelectionPolicy(selectionPolicy);
  if (correlationProjection?.schema_version !== "alphonse.correlation-projection.v0.2"
      || effectProjection?.schema_version !== "alphonse.diagnostic-effect-projection.v0.1"
      || behaviorEvaluation?.schema_version !== "alphonse.behavior-evaluation.v0.1") {
    fail("DIAGNOSTIC_EVIDENCE_INPUT_VERSION_UNSUPPORTED",
      "Evidence selection requires hardened correlation, normalized effects, and bounded evaluation inputs.");
  }
  if (behaviorEvaluation.result !== "violated") {
    fail("DIAGNOSTIC_EVIDENCE_EVALUATION_NOT_VIOLATED",
      "Evidence collection may start only from an exact violated Behavior Evaluation.");
  }
  const nodes = correlationProjection.graph.nodes;
  const edges = correlationProjection.graph.edges;
  const nodesByKey = new Map(nodes.map((node) => [node.node_key, node]));
  const evidenceByReceipt = new Map(observationEvidence.map((entry) => [entry.receipt_id, entry]));
  const effectsById = new Map(effectProjection.effects.map((effect) => [effect.effect_id, effect]));
  const selectedNodeKeys = new Set();
  const selectedEdgeKeys = new Set();
  const selectionBasesByNode = new Map();
  const missingRoles = [];

  function selectNode(node, basis) {
    if (!node) return;
    selectedNodeKeys.add(node.node_key);
    const bases = selectionBasesByNode.get(node.node_key) ?? new Set();
    bases.add(basis);
    selectionBasesByNode.set(node.node_key, bases);
  }

  function selectEdge(edge) {
    if (edge) selectedEdgeKeys.add(edge.edge_key);
  }

  for (const matched of behaviorEvaluation.measurement.matched_effects) {
    const effect = effectsById.get(matched.effect_id);
    if (!effect || sha256Digest(effect) !== matched.effect_digest || effect.status !== "committed") {
      fail("DIAGNOSTIC_EVIDENCE_MATCHED_EFFECT_INTEGRITY_VIOLATION",
        "Behavior Evaluation does not resolve to one exact normalized committed effect.", {
          effect_id: matched.effect_id
        });
    }
    const supportingReceiptIds = new Set(effect.supporting_receipts.map((entry) => entry.receipt_id));
    const effectNodes = nodes.filter((node) => node.node_type === "destination.effect"
      && node.receipt_reference && supportingReceiptIds.has(node.receipt_reference.receipt_id));
    recordCardinality(effectNodes, missingRoles, effect.effect_id,
      "designated_commit", "designated_commit_missing");
    for (const effectNode of effectNodes) {
      selectNode(effectNode, `matched_effect:${effect.effect_id}`);
      const requestEdges = edges.filter((edge) => edge.relationship === "request_reported_ledger_claim"
        && edge.to_node_key === effectNode.node_key);
      recordCardinality(requestEdges, missingRoles, effect.effect_id,
        "destination_request", "typed_request_path_missing", { from_node_key: effectNode.node_key });
      for (const requestEdge of requestEdges) {
        const requestNode = nodesByKey.get(requestEdge.from_node_key);
        if (!requestNode || requestNode.node_type !== "destination.request") {
          missingRoles.push({ effect_id: effect.effect_id, role: "destination_request",
            reason: "typed_request_node_missing", candidate_count: 0,
            from_node_key: effectNode.node_key, candidate_node_key: requestEdge.from_node_key });
          continue;
        }
        selectEdge(requestEdge);
        selectNode(requestNode, `required_ancestor_of:${effect.effect_id}`);

        const deliveryEdges = edges.filter((edge) => edge.relationship === "delivery_reported_request"
          && edge.to_node_key === requestNode.node_key);
        recordCardinality(deliveryEdges, missingRoles, effect.effect_id,
          "source_delivery", "typed_delivery_path_missing", { from_node_key: requestNode.node_key });
        for (const deliveryEdge of deliveryEdges) {
          const deliveryNode = nodesByKey.get(deliveryEdge.from_node_key);
          if (!deliveryNode || deliveryNode.node_type !== "source.delivery") {
            missingRoles.push({ effect_id: effect.effect_id, role: "source_delivery",
              reason: "typed_delivery_node_missing", candidate_count: 0,
              from_node_key: requestNode.node_key, candidate_node_key: deliveryEdge.from_node_key });
            continue;
          }
          selectEdge(deliveryEdge);
          selectNode(deliveryNode, `required_ancestor_of:${effect.effect_id}`);

          const operationEdges = edges.filter((edge) =>
            edge.relationship === "logical_operation_contains_delivery"
            && edge.to_node_key === deliveryNode.node_key);
          recordCardinality(operationEdges, missingRoles, effect.effect_id,
            "source_delivery", "logical_operation_path_missing", { from_node_key: deliveryNode.node_key });
          for (const operationEdge of operationEdges) {
            const operationNode = nodesByKey.get(operationEdge.from_node_key);
            if (operationNode?.node_type === "logical_operation") {
              selectEdge(operationEdge);
              selectNode(operationNode, `correlation_root_for:${effect.effect_id}`);
            } else {
              missingRoles.push({ effect_id: effect.effect_id, role: "source_delivery",
                reason: "logical_operation_node_missing", candidate_count: 0,
                from_node_key: deliveryNode.node_key,
                candidate_node_key: operationEdge.from_node_key });
            }
          }

          const runtimeEdges = edges.filter((edge) => edge.relationship === "delivery_reported_execution"
            && edge.from_node_key === deliveryNode.node_key);
          recordCardinality(runtimeEdges, missingRoles, effect.effect_id,
            "terminal_runtime_execution", "typed_runtime_path_missing",
            { from_node_key: deliveryNode.node_key });
          for (const runtimeEdge of runtimeEdges) {
            const runtimeNode = nodesByKey.get(runtimeEdge.to_node_key);
            const runtimeEvidence = runtimeNode?.receipt_reference
              ? evidenceByReceipt.get(runtimeNode.receipt_reference.receipt_id) : null;
            if (!runtimeNode || runtimeNode.node_type !== "runtime.execution" || !runtimeEvidence
                || !["cancelled", "failed", "succeeded"].includes(
                  runtimeEvidence.envelope.claims?.lifecycle)) {
              missingRoles.push({ effect_id: effect.effect_id, role: "terminal_runtime_execution",
                reason: "terminal_runtime_evidence_missing", candidate_count: 0,
                from_node_key: deliveryNode.node_key,
                candidate_node_key: runtimeEdge.to_node_key });
            } else {
              selectEdge(runtimeEdge);
              selectNode(runtimeNode, `required_execution_for:${effect.effect_id}`);
            }
          }
        }
      }
    }
  }

  const allowedRelationships = new Set(policy.allowed_relationships);
  for (const edge of edges) {
    if (allowedRelationships.has(edge.relationship)
        && selectedNodeKeys.has(edge.from_node_key) && selectedNodeKeys.has(edge.to_node_key)) {
      selectEdge(edge);
    }
  }

  const selectedNodes = nodes.filter((node) => selectedNodeKeys.has(node.node_key)).sort(compareCanonical);
  const selectedEdges = edges.filter((edge) => selectedEdgeKeys.has(edge.edge_key)).sort(compareCanonical);
  const selectedObservations = selectedNodes.filter((node) => node.receipt_reference).map((node) => {
    const evidence = evidenceByReceipt.get(node.receipt_reference.receipt_id);
    if (!evidence || evidence.receipt_digest !== node.receipt_reference.receipt_digest) {
      fail("DIAGNOSTIC_EVIDENCE_OBSERVATION_INTEGRITY_VIOLATION",
        "Selected typed graph node does not resolve to exact verified observation material.", {
          node_key: node.node_key
        });
    }
    return {
      ...evidenceReference(node, selectionBasesByNode.get(node.node_key)),
      envelope: structuredClone(evidence.envelope)
    };
  }).sort(compareCanonical);

  const provenanceByReceipt = new Map(correlationProjection.manifests.tokenization_provenance
    .map((entry) => [entry.result_receipt_id, entry]));
  const selectedProvenance = [];
  const seenProvenance = new Set();
  const provenanceReferences = new Map();
  for (const reference of selectedEdges.flatMap((edge) =>
    edge.supporting_tokenization_provenance ?? [])) {
    provenanceReferences.set(reference.result_receipt_id, reference);
  }
  for (const resultReceiptId of selectedObservations.flatMap((entry) =>
    entry.envelope.provenance_dependencies ?? [])) {
    if (!provenanceReferences.has(resultReceiptId)) {
      provenanceReferences.set(resultReceiptId, { result_receipt_id: resultReceiptId });
    }
  }
  for (const reference of [...provenanceReferences.values()].sort(compareCanonical)) {
    const material = provenanceByReceipt.get(reference.result_receipt_id);
    if (!material || (reference.receipt_digest && material.receipt_digest !== reference.receipt_digest)
        || (reference.grant_snapshot_digest
          && material.grant_snapshot_digest !== reference.grant_snapshot_digest)
        || (reference.grant_application_receipt_digest
          && material.grant_application_receipt_digest !== reference.grant_application_receipt_digest)) {
      missingRoles.push({ effect_id: null, role: "authenticated_provenance_dependency",
        reason: "complete_tokenization_proof_chain_missing", candidate_count: material ? 1 : 0,
        result_receipt_id: reference.result_receipt_id });
      continue;
    }
    if (!seenProvenance.has(material.result_receipt_id)) {
      seenProvenance.add(material.result_receipt_id);
      selectedProvenance.push(structuredClone(material));
    }
  }
  selectedProvenance.sort(compareCanonical);

  const incompleteStreams = correlationProjection.coverage.streams.filter((stream) =>
    stream.coverage_status !== "complete_through_high_water").map((stream) => ({
    grant_id: stream.grant_id,
    stream_id: stream.stream_id,
    coverage_status: stream.coverage_status
  })).sort(compareCanonical);
  const selectedCountByType = Object.fromEntries([
    "destination.effect", "destination.request", "runtime.execution", "source.delivery"
  ].map((type) => [type, selectedObservations.filter((entry) => entry.observation_type === type).length]));
  const allSelectedCountByType = Object.fromEntries(Object.keys(correlationProjection.graph.counts_by_type)
    .map((type) => [type, selectedNodes.filter((entry) => entry.node_type === type).length]));
  const excludedRelatedCounts = Object.fromEntries(Object.entries(correlationProjection.graph.counts_by_type)
    .map(([type, count]) => [type, Math.max(0, count - (allSelectedCountByType[type] ?? 0))]));
  const selectedReceiptIds = new Set(selectedObservations.map((entry) => entry.receipt_id));
  const omittedDetails = correlationProjection.manifests.receipts.filter((receipt) =>
    selectedReceiptIds.has(receipt.receipt_id) && receipt.detail_artifact_digest).map((receipt) => ({
    receipt_id: receipt.receipt_id,
    detail_artifact_digest: receipt.detail_artifact_digest,
    reason: policy.detail.omission_reason
  })).sort(compareCanonical);
  const requiredSourcesComplete = missingRoles.length === 0 && incompleteStreams.length === 0;
  const contradictions = missingRoles.filter((entry) => entry.reason.startsWith("ambiguous_"))
    .map((entry) => ({ contradiction_type: "typed_path_cardinality_conflict", ...entry }))
    .sort(compareCanonical);
  return {
    schema_version: "alphonse.diagnostic-evidence-selection.v0.1",
    rules_digest: DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST,
    required_sources_complete: requiredSourcesComplete,
    selected_nodes: selectedNodes,
    selected_edges: selectedEdges,
    selected_observations: selectedObservations,
    authenticated_provenance_dependencies: selectedProvenance,
    role_completion: {
      required_roles: [...policy.required_roles].sort(),
      matched_effect_count: behaviorEvaluation.measurement.matched_effect_count,
      selected_counts_by_type: selectedCountByType,
      missing_roles: missingRoles.sort(compareCanonical),
      incomplete_contributing_streams: incompleteStreams
    },
    coverage_and_limitations: {
      streams: structuredClone(correlationProjection.coverage.streams),
      gaps: structuredClone(correlationProjection.coverage.streams.flatMap((stream) =>
        stream.missing_ranges.map((range) => ({ grant_id: stream.grant_id, stream_id: stream.stream_id, range })))),
      conflicts: structuredClone(correlationProjection.coverage.conflicts),
      rejections: structuredClone(correlationProjection.coverage.rejections),
      contradictions,
      unresolved_relationships: structuredClone(correlationProjection.graph.unresolved_relationships),
      limitations: structuredClone(correlationProjection.coverage.limitations)
    },
    disclosure_accounting: {
      selection_seed: "matched_committed_effects",
      broad_logical_operation_search_used: false,
      model_selected_evidence: false,
      selected_receipt_count: selectedObservations.length,
      selected_edge_count: selectedEdges.length,
      selected_provenance_dependency_count: selectedProvenance.length,
      excluded_related_counts_by_type: excludedRelatedCounts,
      omitted_detail: omittedDetails,
      optional_destination_snapshot: "not_required"
    }
  };
}

export function decideEvidenceFreeze({ requiredSourcesComplete, collectionDeadline, now }) {
  const assessedAt = new Date(now).toISOString();
  const deadline = new Date(collectionDeadline).toISOString();
  if (requiredSourcesComplete) return { ready: true, reason: "required_sources_complete", assessed_at: assessedAt };
  if (Date.parse(assessedAt) >= Date.parse(deadline)) {
    return { ready: true, reason: "collection_deadline", assessed_at: assessedAt };
  }
  return { ready: false, reason: "awaiting_required_sources", assessed_at: assessedAt, wake_at: deadline };
}
