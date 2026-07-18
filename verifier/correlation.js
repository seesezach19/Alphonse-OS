import { canonicalize, compareCanonical, sha256Digest } from "./canonical.js";

export const CORRELATION_PROJECTOR_ID = "alphonse.canonical-correlation-projector";
export const CORRELATION_PROJECTOR_VERSION = "0.2.0";
export const CORRELATION_PROJECTOR_INPUT_SCHEMA_VERSION = "alphonse.correlation-projector-input.v0.2";
export const CORRELATION_PROJECTION_SCHEMA_VERSION = "alphonse.correlation-projection.v0.2";
export const CORRELATION_RULES = Object.freeze({
  schema_version: "alphonse.correlation-rules.v0.1",
  accepted_observation_types: [
    "destination.effect", "destination.request", "runtime.execution", "source.delivery"
  ],
  logical_operation_claim: "logical_operation_id",
  identity_claims: {
    "destination.effect": "commit_id",
    "destination.request": "request_id",
    "runtime.execution": "execution_id",
    "source.delivery": "delivery_id"
  },
  relationship_bases: [
    "exact_propagated_logical_operation", "exact_typed_delivery_identity",
    "exact_typed_request_identity", "scoped_exact_value_token_equality",
    "scoped_exact_value_token_inequality"
  ],
  forbidden_bases: ["artifact_parsing", "email", "company_name", "model_similarity", "name", "time_proximity"],
  unresolved_policy: "preserve_without_guessing"
});
export const CORRELATION_RULES_DIGEST = sha256Digest(CORRELATION_RULES);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalList(values) {
  return [...values].sort(compareCanonical);
}

function stringClaim(observation, field) {
  const value = observation.claims?.[field];
  return typeof value === "string" && value ? value : null;
}

function claimLocation(observation, field) {
  return { receipt_id: observation.receipt_id, receipt_digest: observation.receipt_digest,
    claim_path: `claims.${field}` };
}

function provenanceReference(dependency) {
  return {
    result_receipt_id: dependency.result_receipt_id,
    receipt_digest: dependency.receipt_digest,
    grant_snapshot_digest: dependency.grant_snapshot_digest,
    grant_application_receipt_digest: dependency.grant_application_receipt_digest,
    field_role: dependency.field_role,
    claim_field: dependency.claim_field,
    namespace: dependency.namespace,
    algorithm_version: dependency.algorithm_version
  };
}

function makeEdge(relationship, fromNodeKey, toNodeKey, basis, claimLocations, provenance = []) {
  const material = { relationship, from_node_key: fromNodeKey, to_node_key: toNodeKey, basis,
    supporting_claim_locations: canonicalList(claimLocations),
    supporting_tokenization_provenance: canonicalList(provenance) };
  return { edge_key: `edge_${sha256Digest(material).slice(7)}`, ...material };
}

function makeUnresolved(relationship, subject, reason, claimLocations = [], candidateNodeKeys = []) {
  const material = { relationship, subject, reason,
    supporting_claim_locations: canonicalList(claimLocations),
    candidate_node_keys: [...candidateNodeKeys].sort(compareText) };
  return { unresolved_key: `unresolved_${sha256Digest(material).slice(7)}`, ...material };
}

function tokenDependency(observation, claimField) {
  const claimedToken = stringClaim(observation, claimField);
  if (!claimedToken) return { status: "missing_claim", dependency: null };
  const candidates = (observation.dependencies ?? []).filter((dependency) =>
    dependency.claim_field === claimField && dependency.equality_token === claimedToken);
  if (candidates.length !== 1) return {
    status: candidates.length ? "ambiguous_provenance" : "missing_provenance", dependency: null
  };
  return { status: "verified", dependency: candidates[0] };
}

function observationNode(observation, identityField) {
  const identity = stringClaim(observation, identityField);
  if (!identity) return null;
  return {
    node_key: `observation_${sha256Digest({ observation_type: observation.observation_type,
      identity, receipt_digest: observation.receipt_digest }).slice(7)}`,
    node_type: observation.observation_type,
    claimed_identity: identity,
    receipt_reference: { receipt_id: observation.receipt_id, receipt_digest: observation.receipt_digest,
      intake_position: String(observation.intake_position) },
    identity_claim_location: claimLocation(observation, identityField)
  };
}

function toRanges(values) {
  const sorted = [...new Set(values.map((value) => value.toString()))]
    .map(BigInt).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const ranges = [];
  for (const value of sorted) {
    const last = ranges.at(-1);
    if (last && value === last[1] + 1n) last[1] = value;
    else ranges.push([value, value]);
  }
  return ranges;
}

function projectStreamCoverage(current, receivedSequence) {
  if (typeof receivedSequence !== "string" || !/^(0|[1-9][0-9]*)$/.test(receivedSequence)
      || BigInt(receivedSequence) < 1n) throw new Error("VERIFIER_OBSERVATION_SEQUENCE_INVALID");
  const values = [];
  for (const range of current?.received_ranges ?? []) {
    for (let value = BigInt(range[0]); value <= BigInt(range[1]); value += 1n) values.push(value);
  }
  values.push(BigInt(receivedSequence));
  const received = toRanges(values);
  const highest = received.at(-1)[1];
  let contiguous = 0n;
  for (const [start, end] of received) {
    if (start > contiguous + 1n) break;
    contiguous = end;
  }
  const missing = [];
  let cursor = 1n;
  for (const [start, end] of received) {
    if (start > cursor) missing.push([cursor, start - 1n]);
    cursor = end + 1n;
  }
  return { highest_sequence_seen: highest.toString(), contiguous_through: contiguous.toString(),
    received_ranges: received.map(([start, end]) => [start.toString(), end.toString()]),
    missing_ranges: missing.map(([start, end]) => [start.toString(), end.toString()]),
    coverage_status: missing.length ? "incomplete" : "complete_through_high_water" };
}

function streamCoverage(observations) {
  const grouped = new Map();
  for (const observation of observations) {
    const key = `${observation.grant_id}\u0000${observation.stream_id}`;
    const current = grouped.get(key) ?? { grant_id: observation.grant_id,
      stream_id: observation.stream_id, sequences: [] };
    current.sequences.push(String(observation.stream_sequence));
    grouped.set(key, current);
  }
  return canonicalList([...grouped.values()].map((stream) => {
    let coverage = null;
    for (const sequence of [...stream.sequences].sort((left, right) => {
      const difference = BigInt(left) - BigInt(right);
      return difference < 0n ? -1 : difference > 0n ? 1 : 0;
    })) coverage = projectStreamCoverage(coverage, sequence);
    return { grant_id: stream.grant_id, stream_id: stream.stream_id, ...coverage };
  }));
}

function integrationMatches(observation, integrationId) {
  return observation.observation_type === "runtime.execution"
    ? observation.integration_id === null || observation.integration_id === integrationId
    : observation.integration_id === integrationId;
}

function registrationInput(registration) {
  return {
    registration_id: registration.registration_id,
    registration_digest: registration.registration_digest,
    installation_id: registration.installation_id,
    environment_id: registration.environment_id,
    workflow_id: registration.workflow_id,
    revision_id: registration.revision_id,
    integration_id: registration.integration_id,
    contract_dependency_digests: [...registration.contract_dependency_digests].sort(compareText)
  };
}

export function buildCorrelationProjectorInput({ registration, logicalOperationId, cutoff, intakeOutcomes,
  receiptManifest, schemaManifest, tokenizationManifest, observations, conflicts = [], rejections = [] }) {
  return {
    schema_version: CORRELATION_PROJECTOR_INPUT_SCHEMA_VERSION,
    registration: registrationInput(registration),
    logical_operation_id: logicalOperationId,
    committed_intake_cutoff: String(cutoff),
    intake_outcomes: canonicalList(intakeOutcomes),
    receipt_manifest: canonicalList(receiptManifest),
    schema_manifest: canonicalList(schemaManifest),
    tokenization_manifest: canonicalList(tokenizationManifest),
    observations: canonicalList(observations.map((observation) => ({ ...observation,
      dependencies: canonicalList(observation.dependencies ?? []) }))),
    conflicts: canonicalList(conflicts),
    rejections: canonicalList(rejections)
  };
}

export function buildCorrelationProjection(projectorInput, { projectorArtifactDigest }) {
  if (projectorInput?.schema_version !== CORRELATION_PROJECTOR_INPUT_SCHEMA_VERSION) {
    throw new Error("VERIFIER_CORRELATION_INPUT_VERSION_UNSUPPORTED");
  }
  const registration = projectorInput.registration;
  const logicalOperationId = projectorInput.logical_operation_id;
  const cutoff = projectorInput.committed_intake_cutoff;
  const { intake_outcomes: intakeOutcomes, receipt_manifest: receiptManifest,
    schema_manifest: schemaManifest, tokenization_manifest: tokenizationManifest,
    observations, conflicts, rejections } = projectorInput;
  const projectorInputDigest = sha256Digest(projectorInput);
  const unresolved = [];
  const acceptedTypes = new Set(CORRELATION_RULES.accepted_observation_types);
  const operationCandidates = observations.filter((observation) =>
    stringClaim(observation, CORRELATION_RULES.logical_operation_claim) === logicalOperationId);
  const selected = [];
  for (const observation of operationCandidates) {
    if (!acceptedTypes.has(observation.observation_type)) {
      unresolved.push(makeUnresolved("observation_scope", observation.receipt_id,
        "unsupported_observation_type", [claimLocation(observation, "logical_operation_id")]));
      continue;
    }
    if (observation.workflow_id !== registration.workflow_id
        || !integrationMatches(observation, registration.integration_id)) {
      unresolved.push(makeUnresolved("observation_scope", observation.receipt_id,
        "registered_scope_mismatch", [claimLocation(observation, "logical_operation_id")]));
      continue;
    }
    selected.push(observation);
  }
  const nodes = [];
  const nodeByReceipt = new Map();
  const operationNode = {
    node_key: `logical_operation_${sha256Digest({ logical_operation_id: logicalOperationId }).slice(7)}`,
    node_type: "logical_operation", claimed_identity: logicalOperationId,
    receipt_reference: null, identity_claim_location: null
  };
  nodes.push(operationNode);
  for (const observation of selected) {
    const node = observationNode(observation, CORRELATION_RULES.identity_claims[observation.observation_type]);
    if (!node) {
      unresolved.push(makeUnresolved("node_identity", observation.receipt_id,
        "required_typed_identity_missing", [claimLocation(observation, "logical_operation_id")]));
      continue;
    }
    nodeByReceipt.set(observation.receipt_id, node);
    nodes.push(node);
  }
  const byType = (type) => selected.filter((observation) =>
    observation.observation_type === type && nodeByReceipt.has(observation.receipt_id));
  const sources = byType("source.delivery");
  const runtimes = byType("runtime.execution");
  const requests = byType("destination.request");
  const effects = byType("destination.effect");
  const edges = [];
  for (const source of sources) edges.push(makeEdge("logical_operation_contains_delivery",
    operationNode.node_key, nodeByReceipt.get(source.receipt_id).node_key,
    "exact_propagated_logical_operation", [claimLocation(source, "logical_operation_id")]));

  function exactDeliveryRelationship(observation, relationship) {
    const deliveryId = stringClaim(observation, "delivery_id");
    const candidates = sources.filter((source) => stringClaim(source, "delivery_id") === deliveryId);
    if (deliveryId && candidates.length === 1) {
      edges.push(makeEdge(relationship, nodeByReceipt.get(candidates[0].receipt_id).node_key,
        nodeByReceipt.get(observation.receipt_id).node_key, "exact_typed_delivery_identity", [
          claimLocation(candidates[0], "delivery_id"), claimLocation(observation, "delivery_id"),
          claimLocation(candidates[0], "logical_operation_id"),
          claimLocation(observation, "logical_operation_id")
        ]));
      return candidates[0];
    }
    unresolved.push(makeUnresolved(relationship, observation.receipt_id,
      candidates.length > 1 ? "ambiguous_delivery_identity" : "missing_delivery_identity_match",
      [claimLocation(observation, "delivery_id"), claimLocation(observation, "logical_operation_id")],
      candidates.map((candidate) => nodeByReceipt.get(candidate.receipt_id).node_key)));
    return null;
  }
  for (const runtime of runtimes) exactDeliveryRelationship(runtime, "delivery_reported_execution");
  const requestSourceMatches = new Map();
  for (const request of requests) requestSourceMatches.set(request.receipt_id,
    exactDeliveryRelationship(request, "delivery_reported_request"));
  for (const request of requests) {
    const requestToken = tokenDependency(request, "idempotency_key_equality_token");
    if (requestToken.status !== "verified") {
      unresolved.push(makeUnresolved("delivery_identity_equals_request_key", request.receipt_id,
        requestToken.status, [claimLocation(request, "idempotency_key_equality_token")]));
      continue;
    }
    const candidates = sources.map((source) => ({ source,
      token: tokenDependency(source, "delivery_identity_equality_token") }))
      .filter(({ token }) => token.status === "verified"
        && token.dependency.namespace === requestToken.dependency.namespace
        && token.dependency.algorithm_version === requestToken.dependency.algorithm_version
        && token.dependency.equality_token === requestToken.dependency.equality_token);
    if (candidates.length !== 1) {
      unresolved.push(makeUnresolved("delivery_identity_equals_request_key", request.receipt_id,
        candidates.length ? "ambiguous_scoped_equality" : "scoped_equality_not_established",
        [claimLocation(request, "idempotency_key_equality_token")],
        candidates.map(({ source }) => nodeByReceipt.get(source.receipt_id).node_key)));
      continue;
    }
    const source = candidates[0].source;
    if (requestSourceMatches.get(request.receipt_id)?.receipt_id !== source.receipt_id) {
      unresolved.push(makeUnresolved("delivery_identity_equals_request_key", request.receipt_id,
        "typed_identity_and_token_relationship_disagree", [
          claimLocation(request, "delivery_id"), claimLocation(request, "idempotency_key_equality_token"),
          claimLocation(source, "delivery_id"), claimLocation(source, "delivery_identity_equality_token")
        ], [nodeByReceipt.get(source.receipt_id).node_key]));
      continue;
    }
    edges.push(makeEdge("delivery_identity_equals_request_key", nodeByReceipt.get(source.receipt_id).node_key,
      nodeByReceipt.get(request.receipt_id).node_key, "scoped_exact_value_token_equality", [
        claimLocation(source, "delivery_identity_equality_token"),
        claimLocation(request, "idempotency_key_equality_token")
      ], [provenanceReference(candidates[0].token.dependency),
        provenanceReference(requestToken.dependency)]));
  }
  const orderedRequests = [...requests].sort((left, right) => compareText(
    nodeByReceipt.get(left.receipt_id).node_key, nodeByReceipt.get(right.receipt_id).node_key));
  for (let leftIndex = 0; leftIndex < orderedRequests.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < orderedRequests.length; rightIndex += 1) {
      const left = orderedRequests[leftIndex];
      const right = orderedRequests[rightIndex];
      const leftToken = tokenDependency(left, "idempotency_key_equality_token");
      const rightToken = tokenDependency(right, "idempotency_key_equality_token");
      const sameScope = leftToken.status === "verified" && rightToken.status === "verified"
        && leftToken.dependency.namespace === rightToken.dependency.namespace
        && leftToken.dependency.algorithm_version === rightToken.dependency.algorithm_version;
      if (sameScope && leftToken.dependency.equality_token !== rightToken.dependency.equality_token) {
        edges.push(makeEdge("request_keys_are_distinct", nodeByReceipt.get(left.receipt_id).node_key,
          nodeByReceipt.get(right.receipt_id).node_key, "scoped_exact_value_token_inequality", [
            claimLocation(left, "idempotency_key_equality_token"),
            claimLocation(right, "idempotency_key_equality_token")
          ], [provenanceReference(leftToken.dependency), provenanceReference(rightToken.dependency)]));
      } else {
        unresolved.push(makeUnresolved("request_keys_are_distinct", `${left.receipt_id}:${right.receipt_id}`,
          sameScope ? "token_values_not_distinct" : "token_scopes_not_comparable", [
            claimLocation(left, "idempotency_key_equality_token"),
            claimLocation(right, "idempotency_key_equality_token")
          ], [nodeByReceipt.get(left.receipt_id).node_key, nodeByReceipt.get(right.receipt_id).node_key]));
      }
    }
  }
  for (const effect of effects) {
    const requestId = stringClaim(effect, "request_id");
    const candidates = requests.filter((request) => stringClaim(request, "request_id") === requestId
      && stringClaim(request, "delivery_id") === stringClaim(effect, "delivery_id"));
    if (requestId && candidates.length === 1) {
      edges.push(makeEdge("request_reported_ledger_claim",
        nodeByReceipt.get(candidates[0].receipt_id).node_key,
        nodeByReceipt.get(effect.receipt_id).node_key, "exact_typed_request_identity", [
          claimLocation(candidates[0], "request_id"), claimLocation(effect, "request_id"),
          claimLocation(candidates[0], "delivery_id"), claimLocation(effect, "delivery_id"),
          claimLocation(candidates[0], "logical_operation_id"), claimLocation(effect, "logical_operation_id")
        ]));
    } else unresolved.push(makeUnresolved("request_reported_ledger_claim", effect.receipt_id,
      candidates.length > 1 ? "ambiguous_request_identity" : "missing_request_identity_match",
      [claimLocation(effect, "request_id"), claimLocation(effect, "delivery_id")],
      candidates.map((candidate) => nodeByReceipt.get(candidate.receipt_id).node_key)));
  }
  for (const type of CORRELATION_RULES.accepted_observation_types) {
    if (!selected.some((observation) => observation.observation_type === type)) {
      unresolved.push(makeUnresolved("required_observer_stream", type, "observation_type_missing_at_cutoff"));
    }
  }
  const coverage = streamCoverage(observations);
  const limitations = canonicalList(observations.flatMap((observation) =>
    (observation.limitations ?? []).map((limitation) => ({ limitation,
      receipt_id: observation.receipt_id, receipt_digest: observation.receipt_digest }))));
  const countsByType = Object.fromEntries(CORRELATION_RULES.accepted_observation_types.map((type) =>
    [type, selected.filter((observation) => observation.observation_type === type).length]));
  const semanticProjection = {
    schema_version: CORRELATION_PROJECTION_SCHEMA_VERSION,
    scope: { installation_id: registration.installation_id, environment_id: registration.environment_id,
      workflow_id: registration.workflow_id, revision_id: registration.revision_id,
      integration_id: registration.integration_id, logical_operation_id: logicalOperationId },
    cutoff: { committed_through: String(cutoff),
      capture_basis: "diagnostic_intake_prefix_finalization_row_lock" },
    dependencies: {
      projector_input_schema_version: CORRELATION_PROJECTOR_INPUT_SCHEMA_VERSION,
      projector_input_digest: projectorInputDigest,
      receipt_set_manifest_digest: sha256Digest(canonicalList(receiptManifest)),
      intake_outcome_manifest_digest: sha256Digest(canonicalList(intakeOutcomes)),
      schema_manifest_digest: sha256Digest(canonicalList(schemaManifest)),
      tokenization_manifest_digest: sha256Digest(canonicalList(tokenizationManifest)),
      correlation_registration_id: registration.registration_id,
      correlation_registration_digest: registration.registration_digest,
      contract_dependency_digests: [...registration.contract_dependency_digests].sort(),
      projector: { projector_id: CORRELATION_PROJECTOR_ID, projector_version: CORRELATION_PROJECTOR_VERSION,
        artifact_digest: projectorArtifactDigest, rules_digest: CORRELATION_RULES_DIGEST }
    },
    manifests: { intake_outcomes: canonicalList(intakeOutcomes), receipts: canonicalList(receiptManifest),
      schemas: canonicalList(schemaManifest), tokenization_provenance: canonicalList(tokenizationManifest) },
    coverage: { streams: coverage, conflicts: canonicalList(conflicts), rejections: canonicalList(rejections),
      limitations },
    graph: { counts_by_type: countsByType, nodes: canonicalList(nodes), edges: canonicalList(edges),
      unresolved_relationships: canonicalList(unresolved) },
    authority: { diagnosis_established: false, responsible_workflow_node_established: false,
      defect_established: false, repair_prescribed: false }
  };
  return { projector_input_digest: projectorInputDigest, semantic_projection: semanticProjection,
    semantic_digest: sha256Digest(semanticProjection) };
}
