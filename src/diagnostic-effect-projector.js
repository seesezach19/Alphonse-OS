import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import { selectCaseRelevantCoverage } from "./diagnostic-case-coverage.js";
import { validateIntegrationBehaviorContract } from "./diagnostic-effect-contracts.js";

export const DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA = "alphonse.diagnostic-effect-projection.v0.1";
export const DIAGNOSTIC_EFFECT_INTERPRETER = Object.freeze({
  interpreter_id: "alphonse.designated-commit-feed-interpreter",
  interpreter_version: "0.1.0",
  input_projection_schema: "alphonse.correlation-projection.v0.2",
  output_projection_schema: DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA,
  statuses: ["ambiguous", "committed", "not_committed", "unknown"],
  committed_basis: "designated_append_only_commit_record",
  request_acknowledgement_is_commitment: false
});
export const DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST = sha256Digest(DIAGNOSTIC_EFFECT_INTERPRETER);

function compareCanonical(left, right) {
  const leftBytes = canonicalize(left);
  const rightBytes = canonicalize(right);
  return leftBytes < rightBytes ? -1 : leftBytes > rightBytes ? 1 : 0;
}

function stringClaim(envelope, field) {
  const value = envelope?.claims?.[field];
  return typeof value === "string" && value ? value : null;
}

function evidenceReference(evidence) {
  return { receipt_id: evidence.receipt_id, receipt_digest: evidence.receipt_digest };
}

function interpretedEffect({
  effectNode,
  requestNode,
  effectEvidence,
  requestEvidence,
  contract,
  correlationProjection,
  correlationSemanticDigest,
  integrationContractDigest
}) {
  const effectClaims = effectEvidence?.envelope?.claims;
  const feedId = stringClaim(effectEvidence?.envelope, contract.commit_feed.feed_identity_claim);
  const effectIdentity = stringClaim(effectEvidence?.envelope, contract.commit_feed.event_identity_claim);
  const resourceIdentity = stringClaim(effectEvidence?.envelope, contract.commit_feed.resource_identity_claim);
  const requestIdentity = stringClaim(effectEvidence?.envelope, contract.commit_feed.request_identity_claim);
  const operation = stringClaim(effectEvidence?.envelope, contract.commit_feed.operation_claim);
  const committedAt = stringClaim(effectEvidence?.envelope, contract.commit_feed.committed_at_claim);
  const externalClaim = effectClaims?.[contract.commit_feed.external_claim_field] === true;
  const requestBound = Boolean(requestNode && requestEvidence
    && requestNode.claimed_identity === requestIdentity
    && stringClaim(requestEvidence.envelope, contract.commit_feed.request_identity_claim) === requestIdentity
    && stringClaim(requestEvidence.envelope, contract.commit_feed.operation_claim) === operation
    && stringClaim(requestEvidence.envelope, "logical_operation_id")
      === correlationProjection.scope.logical_operation_id);
  const feedBound = feedId === contract.commit_feed.feed_id
    && contract.commit_feed.feed_kind === "append_only_ledger"
    && contract.commit_feed.commit_record_semantics === "record_means_resource_operation_committed"
    && contract.commit_feed.consistency === "append_visible_after_commit";
  const identityBound = effectNode.claimed_identity === effectIdentity
    && stringClaim(effectEvidence?.envelope, "logical_operation_id")
      === correlationProjection.scope.logical_operation_id
    && Boolean(effectIdentity && resourceIdentity && requestIdentity && operation && committedAt)
    && Number.isFinite(Date.parse(committedAt));
  const committed = feedBound && identityBound && requestBound && externalClaim;
  const status = committed ? "committed" : requestNode && effectEvidence ? "unknown" : "ambiguous";
  const limitations = ["contract_bound_interpretation_not_external_truth"];
  if (externalClaim) limitations.push("authenticated_external_commit_feed_claim");
  if (!committed) limitations.push("commitment_not_established_from_designated_feed");
  const effectId = deterministicUuid({
    namespace: "diagnostic-effect",
    correlation_semantic_digest: correlationSemanticDigest,
    integration_contract_digest: integrationContractDigest,
    effect_receipt_digest: effectEvidence?.receipt_digest ?? effectNode.receipt_reference.receipt_digest
  });
  return {
    effect_id: effectId,
    effect_class: "diagnostic_derived_external_effect",
    logical_operation_id: correlationProjection.scope.logical_operation_id,
    destination_id: contract.destination_id,
    integration_id: contract.integration_id,
    operation,
    effect_identity: effectIdentity,
    resource_reference: resourceIdentity ? { resource_id: resourceIdentity } : null,
    request_reference: requestNode && requestEvidence ? {
      node_key: requestNode.node_key,
      request_id: requestNode.claimed_identity,
      ...evidenceReference(requestEvidence)
    } : null,
    status,
    commitment_basis: committed ? DIAGNOSTIC_EFFECT_INTERPRETER.committed_basis : null,
    committed_at: committed ? new Date(committedAt).toISOString() : null,
    supporting_receipts: [effectEvidence, requestEvidence].filter(Boolean)
      .map(evidenceReference).sort(compareCanonical),
    limitations: limitations.sort(),
    authority: "none"
  };
}

export function buildDiagnosticEffectProjection({
  correlationProjectionId,
  correlationSemanticDigest,
  correlationProjection,
  integrationActivationId,
  integrationContract,
  integrationContractDigest,
  interpreterArtifactDigest,
  observationEvidence
}) {
  const contract = validateIntegrationBehaviorContract(integrationContract);
  if (correlationProjection?.schema_version !== "alphonse.correlation-projection.v0.2") {
    throw new TypeError("correlationProjection must be alphonse.correlation-projection.v0.2.");
  }
  if (contract.integration_id !== correlationProjection.scope.integration_id) {
    throw new TypeError("Integration Behavior Contract does not match the Correlation Projection scope.");
  }
  const evidenceByReceipt = new Map(observationEvidence.map((item) => [item.receipt_id, item]));
  const nodesByKey = new Map(correlationProjection.graph.nodes.map((node) => [node.node_key, node]));
  const effectNodes = correlationProjection.graph.nodes.filter((node) => node.node_type === "destination.effect");
  const effects = effectNodes.map((effectNode) => {
    const edges = correlationProjection.graph.edges.filter((edge) =>
      edge.relationship === "request_reported_ledger_claim" && edge.to_node_key === effectNode.node_key);
    const requestNode = edges.length === 1 ? nodesByKey.get(edges[0].from_node_key) : null;
    return interpretedEffect({
      effectNode,
      requestNode,
      effectEvidence: evidenceByReceipt.get(effectNode.receipt_reference.receipt_id),
      requestEvidence: requestNode ? evidenceByReceipt.get(requestNode.receipt_reference.receipt_id) : null,
      contract,
      correlationProjection,
      correlationSemanticDigest,
      integrationContractDigest
    });
  }).sort(compareCanonical);
  const caseCoverage = selectCaseRelevantCoverage({ correlationProjection, observationEvidence });
  const requiredSourcesComplete = caseCoverage.streams.every((stream) =>
    stream.coverage_status === "complete_through_high_water")
    && caseCoverage.conflicts.length === 0
    && !correlationProjection.graph.unresolved_relationships.some((item) =>
      ["required_observer_stream", "request_reported_ledger_claim"].includes(item.relationship));
  const semanticProjection = {
    schema_version: DIAGNOSTIC_EFFECT_PROJECTION_SCHEMA,
    classification: "diagnostic_derived_external_effect",
    scope: structuredClone(correlationProjection.scope),
    dependencies: {
      correlation_projection_id: correlationProjectionId,
      correlation_semantic_digest: correlationSemanticDigest,
      integration_activation_id: integrationActivationId,
      integration_contract_digest: integrationContractDigest,
      interpreter: {
        interpreter_id: DIAGNOSTIC_EFFECT_INTERPRETER.interpreter_id,
        interpreter_version: DIAGNOSTIC_EFFECT_INTERPRETER.interpreter_version,
        artifact_digest: interpreterArtifactDigest,
        rules_digest: DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST
      }
    },
    cutoff: structuredClone(correlationProjection.cutoff),
    effects,
    coverage: {
      required_sources_complete: requiredSourcesComplete,
      contributing_streams_digest: sha256Digest(caseCoverage.streams),
      unresolved_relationships_digest: sha256Digest(correlationProjection.graph.unresolved_relationships),
      limitations: structuredClone(caseCoverage.limitations)
    },
    authority: {
      kernel_effect: false,
      execution_authorized: false,
      external_truth_established: false,
      diagnosis_established: false
    }
  };
  return { semantic_projection: semanticProjection, semantic_digest: sha256Digest(semanticProjection) };
}
