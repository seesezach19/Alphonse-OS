import { TextDecoder } from "node:util";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import { validateObservationEnvelope } from "./observation-contracts.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function fail(code, message, details = {}) {
  throw new KernelError(500, code, message, details);
}

function iso(value) {
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function canonicalEnvelope(row, intakePosition) {
  let text;
  let envelope;
  try {
    text = UTF8.decode(Buffer.from(row.envelope_bytes));
    envelope = JSON.parse(text);
    validateObservationEnvelope(envelope);
  } catch (error) {
    fail("CORRELATION_ACCEPTED_RECEIPT_INTEGRITY_VIOLATION",
      "Accepted receipt does not preserve one valid canonical observation envelope.", {
        intake_position: intakePosition,
        cause_code: error.code ?? "invalid_envelope_bytes"
      });
  }
  if (text !== canonicalize(envelope)
      || !same(row.envelope, envelope)
      || sha256Digest(envelope) !== row.envelope_digest) {
    fail("CORRELATION_ACCEPTED_RECEIPT_INTEGRITY_VIOLATION",
      "Accepted envelope bytes, JSON, or digest disagree.", { intake_position: intakePosition });
  }
  return envelope;
}

function verifyReceiptBindings(row, outcome, envelope) {
  const position = String(outcome.intake_position);
  const receipt = row.receipt;
  const detailDigest = envelope.detail?.digest ?? null;
  const receiptBindings = [
    [row.receipt_id, outcome.outcome_id, "outcome_id"],
    [row.receipt_digest, outcome.outcome_digest, "outcome_digest"],
    [receipt?.receipt_id, row.receipt_id, "receipt.receipt_id"],
    [receipt?.intake_position, position, "receipt.intake_position"],
    [receipt?.observation_id, envelope.observation_id, "receipt.observation_id"],
    [receipt?.observation_type, envelope.observation_type, "receipt.observation_type"],
    [receipt?.envelope_digest, row.envelope_digest, "receipt.envelope_digest"],
    [receipt?.detail_artifact_digest ?? null, detailDigest, "receipt.detail_artifact_digest"],
    [receipt?.principal_id, envelope.principal_id, "receipt.principal_id"],
    [receipt?.grant_id, envelope.grant_id, "receipt.grant_id"],
    [receipt?.grant_snapshot_digest, row.grant_snapshot_digest, "receipt.grant_snapshot_digest"],
    [receipt?.stream_id, envelope.stream_id, "receipt.stream_id"],
    [receipt?.stream_sequence, envelope.sequence, "receipt.stream_sequence"],
    [iso(receipt?.received_at), iso(row.received_at), "receipt.received_at"],
    [receipt?.attribution, row.attribution, "receipt.attribution"],
    [receipt?.exclusive_authorship_established, false, "receipt.exclusive_authorship_established"],
    [receipt?.external_truth_established, false, "receipt.external_truth_established"],
    [receipt?.transition?.transition_id, row.transition_id, "receipt.transition.transition_id"],
    [receipt?.transition?.type, "diagnostic.observation.accepted", "receipt.transition.type"]
  ];
  const rowBindings = [
    [row.installation_id, envelope.installation_id, "installation_id"],
    [row.environment_id, envelope.environment_id, "environment_id"],
    [row.observation_id, envelope.observation_id, "observation_id"],
    [row.observation_type, envelope.observation_type, "observation_type"],
    [row.principal_id, envelope.principal_id, "principal_id"],
    [row.grant_id, envelope.grant_id, "grant_id"],
    [row.key_id, envelope.key_id, "key_id"],
    [row.stream_id, envelope.stream_id, "stream_id"],
    [String(row.stream_sequence), envelope.sequence, "stream_sequence"],
    [row.workflow_id ?? null, envelope.workflow_id, "workflow_id"],
    [row.integration_id ?? null, envelope.integration_id, "integration_id"],
    [row.schema_id, envelope.schema.schema_id, "schema_id"],
    [row.schema_version, envelope.schema.schema_version, "schema_version"],
    [row.schema_digest, envelope.schema.schema_digest, "schema_digest"],
    [row.detail_artifact_digest ?? null, detailDigest, "detail_artifact_digest"],
    [row.attribution, "authenticated_under_observer_specific_grant", "attribution"],
    [row.external_truth_established, false, "external_truth_established"],
    [row.exclusive_authorship_established, false, "exclusive_authorship_established"]
  ];
  const schemaBindings = [
    [row.schema_installation_id, envelope.installation_id, "schema_activation.installation_id"],
    [row.schema_environment_id, envelope.environment_id, "schema_activation.environment_id"],
    [row.schema_observation_type, envelope.observation_type, "schema_activation.observation_type"],
    [row.schema_activation_schema_id, envelope.schema.schema_id, "schema_activation.schema_id"],
    [row.schema_activation_schema_version, envelope.schema.schema_version, "schema_activation.schema_version"],
    [row.schema_activation_schema_digest, envelope.schema.schema_digest, "schema_activation.schema_digest"]
  ];
  const failed = [...receiptBindings, ...rowBindings, ...schemaBindings]
    .find(([stored, expected]) => stored !== expected);
  const authentication = row.authentication;
  const authenticationBound = object(authentication)
    && authentication.principal_id === envelope.principal_id
    && authentication.grant_id === envelope.grant_id
    && authentication.key_id === envelope.key_id
    && Number.isFinite(Date.parse(authentication.signed_at))
    && typeof authentication.signature === "string"
    && authentication.signature.length > 0;
  const receiptValid = object(receipt)
    && object(receipt.coverage)
    && object(receipt.transition)
    && same(receipt.schema, envelope.schema)
    && sha256Digest(receipt) === row.receipt_digest;
  if (failed || !authenticationBound || !receiptValid) {
    fail("CORRELATION_ACCEPTED_RECEIPT_INTEGRITY_VIOLATION",
      "Accepted receipt fields do not match their authenticated envelope and committed outcome.", {
        intake_position: position,
        failed_binding: failed?.[2] ?? (!authenticationBound ? "authentication_binding" : "receipt_document")
      });
  }
}

function verifyAcceptedReceiptSet(outcomeRows, observationRows, installationId, environmentId) {
  const accepted = outcomeRows.filter((row) => row.outcome_type === "accepted");
  const byPosition = new Map();
  for (const row of observationRows) {
    const position = String(row.intake_position);
    if (byPosition.has(position)) {
      fail("CORRELATION_COMMITTED_PREFIX_INTEGRITY_VIOLATION",
        "More than one accepted receipt occupies one committed intake position.", { intake_position: position });
    }
    byPosition.set(position, row);
  }
  if (accepted.length !== observationRows.length) {
    fail("CORRELATION_COMMITTED_PREFIX_INTEGRITY_VIOLATION",
      "Accepted outcomes and preserved receipts do not form one exact set.");
  }
  return accepted.map((outcome) => {
    const position = String(outcome.intake_position);
    const row = byPosition.get(position);
    if (!row) {
      fail("CORRELATION_COMMITTED_PREFIX_INTEGRITY_VIOLATION",
        "An accepted outcome is missing its preserved receipt.", { intake_position: position });
    }
    const envelope = canonicalEnvelope(row, position);
    if (envelope.installation_id !== installationId || envelope.environment_id !== environmentId) {
      fail("CORRELATION_ACCEPTED_RECEIPT_INTEGRITY_VIOLATION",
        "Accepted receipt is outside the projection installation or environment.", { intake_position: position });
    }
    verifyReceiptBindings(row, outcome, envelope);
    return { outcome, row, envelope };
  });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function verifyCorrelationAcceptedInputs({
  outcomeRows,
  observationRows,
  dependencyRows,
  installationId,
  environmentId,
  tokenizationVerifier
}) {
  const accepted = verifyAcceptedReceiptSet(
    outcomeRows, observationRows, installationId, environmentId
  );
  const dependencyRowsByReceipt = new Map();
  for (const row of dependencyRows) {
    const rows = dependencyRowsByReceipt.get(row.observation_receipt_id) ?? [];
    rows.push(row);
    dependencyRowsByReceipt.set(row.observation_receipt_id, rows);
  }
  const observations = [];
  const receiptManifest = [];
  const schemaManifest = new Map();
  const tokenizationManifest = new Map();
  for (const acceptedInput of accepted) {
    const { row, envelope } = acceptedInput;
    const expectedIds = [...envelope.provenance_dependencies].sort(compareText);
    if (new Set(expectedIds).size !== expectedIds.length) {
      fail("CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION",
        "Signed observation provenance dependencies contain duplicates.", { receipt_id: row.receipt_id });
    }
    const joinedRows = dependencyRowsByReceipt.get(row.receipt_id) ?? [];
    const joinedIds = joinedRows.map((dependency) => dependency.dependency_id).sort(compareText);
    if (joinedIds.length !== expectedIds.length
        || joinedIds.some((dependencyId, index) => dependencyId !== expectedIds[index])) {
      fail("CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION",
        "Signed observation dependencies and the preserved dependency join are not one exact set.", {
          receipt_id: row.receipt_id
        });
    }
    if (joinedRows.length && typeof tokenizationVerifier?.verifyStoredResultReceipt !== "function") {
      fail("CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION",
        "Tokenization proof verification is unavailable for a referenced dependency.", { receipt_id: row.receipt_id });
    }
    const dependencies = [];
    for (const dependencyRow of joinedRows) {
      if (dependencyRow.dependency_type !== "tokenization_result_receipt") {
        fail("CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION",
          "Observation dependency type is unsupported.", { receipt_id: row.receipt_id });
      }
      const proof = tokenizationVerifier.verifyStoredResultReceipt(dependencyRow);
      const proofBound = dependencyRow.dependency_id === proof.result_receipt_id
        && dependencyRow.dependency_digest === proof.receipt_digest
        && proof.requester_principal_id === envelope.principal_id
        && proof.installation_id === envelope.installation_id
        && proof.environment_id === envelope.environment_id
        && proof.integration_id === envelope.integration_id
        && envelope.claims[proof.claim_field] === proof.equality_token;
      if (!proofBound) {
        fail("CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION",
          "Signed tokenization proof is not exactly bound to its observation dependency.", {
            receipt_id: row.receipt_id,
            dependency_id: dependencyRow.dependency_id
          });
      }
      const dependency = {
        result_receipt_id: proof.result_receipt_id,
        receipt_digest: proof.receipt_digest,
        grant_snapshot_digest: proof.grant_snapshot_digest,
        grant_application_receipt_digest: proof.grant_application_receipt_digest,
        requester_principal_id: proof.requester_principal_id,
        integration_id: proof.integration_id,
        field_role: proof.field_role,
        claim_field: proof.claim_field,
        namespace: proof.namespace,
        algorithm_version: proof.algorithm_version,
        equality_token: proof.equality_token
      };
      dependencies.push(dependency);
      const tokenManifestEntry = {
        result_receipt_id: proof.result_receipt_id,
        receipt_digest: proof.receipt_digest,
        grant_snapshot_digest: proof.grant_snapshot_digest,
        grant_application_receipt_digest: proof.grant_application_receipt_digest,
        requester_principal_id: proof.requester_principal_id,
        integration_id: proof.integration_id,
        field_role: proof.field_role,
        claim_field: proof.claim_field,
        namespace: proof.namespace,
        algorithm_version: proof.algorithm_version,
        raw_input_preserved: false
      };
      const previous = tokenizationManifest.get(proof.result_receipt_id);
      if (previous && !same(previous, tokenManifestEntry)) {
        fail("CORRELATION_TOKEN_PROVENANCE_INTEGRITY_VIOLATION",
          "One Tokenization Result Receipt resolved to conflicting verified material.", {
            dependency_id: proof.result_receipt_id
          });
      }
      tokenizationManifest.set(proof.result_receipt_id, tokenManifestEntry);
    }
    dependencies.sort((left, right) => compareText(left.result_receipt_id, right.result_receipt_id));
    observations.push({
      receipt_id: row.receipt_id,
      receipt_digest: row.receipt_digest,
      intake_position: String(row.intake_position),
      envelope_digest: row.envelope_digest,
      installation_id: envelope.installation_id,
      environment_id: envelope.environment_id,
      observation_id: envelope.observation_id,
      observation_type: envelope.observation_type,
      principal_id: envelope.principal_id,
      grant_id: envelope.grant_id,
      key_id: envelope.key_id,
      stream_id: envelope.stream_id,
      stream_sequence: envelope.sequence,
      workflow_id: envelope.workflow_id,
      integration_id: envelope.integration_id,
      claims: envelope.claims,
      limitations: envelope.limitations,
      dependencies
    });
    receiptManifest.push({
      intake_position: String(row.intake_position),
      receipt_id: row.receipt_id,
      receipt_digest: row.receipt_digest,
      observation_type: envelope.observation_type,
      envelope_digest: row.envelope_digest,
      schema: envelope.schema,
      grant_snapshot_digest: row.grant_snapshot_digest,
      detail_artifact_digest: envelope.detail?.digest ?? null,
      provenance_dependencies: dependencies.map((dependency) => ({
        result_receipt_id: dependency.result_receipt_id,
        receipt_digest: dependency.receipt_digest
      }))
    });
    const schemaKey = canonicalize({ observation_type: envelope.observation_type, ...envelope.schema });
    schemaManifest.set(schemaKey, {
      observation_type: envelope.observation_type,
      schema_id: envelope.schema.schema_id,
      schema_version: envelope.schema.schema_version,
      schema_digest: envelope.schema.schema_digest
    });
  }
  return {
    observations,
    receipt_manifest: receiptManifest,
    schema_manifest: [...schemaManifest.values()],
    tokenization_manifest: [...tokenizationManifest.values()]
  };
}
