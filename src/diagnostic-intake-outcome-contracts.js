import { TextDecoder } from "node:util";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function fail(code, message, details = {}, status = 500) {
  throw new KernelError(status, code, message, details);
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

function jsonKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validSchemaTuple(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3
    && keys[0] === "schema_digest"
    && keys[1] === "schema_id"
    && keys[2] === "schema_version"
    && typeof value.schema_id === "string"
    && value.schema_id.length > 0
    && value.schema_id.length <= 200
    && typeof value.schema_version === "string"
    && value.schema_version.length > 0
    && value.schema_version.length <= 32
    && typeof value.schema_digest === "string"
    && DIGEST.test(value.schema_digest);
}

function schemaSummary(envelope, parseStatus) {
  if (parseStatus === "unparsed_oversize") {
    return { status: "unparsed_oversize", json_kind: null,
      schema_id: null, schema_version: null, schema_digest: null };
  }
  if (parseStatus === "unparsed_invalid_json") {
    return { status: "unparsed_invalid_json", json_kind: null,
      schema_id: null, schema_version: null, schema_digest: null };
  }
  const hasSchema = envelope && typeof envelope === "object" && !Array.isArray(envelope)
    && Object.hasOwn(envelope, "schema");
  if (!hasSchema) {
    return { status: "absent", json_kind: null,
      schema_id: null, schema_version: null, schema_digest: null };
  }
  if (validSchemaTuple(envelope.schema)) {
    return { status: "valid_tuple", json_kind: "object",
      schema_id: envelope.schema.schema_id,
      schema_version: envelope.schema.schema_version,
      schema_digest: envelope.schema.schema_digest };
  }
  return { status: "malformed", json_kind: jsonKind(envelope.schema),
    schema_id: null, schema_version: null, schema_digest: null };
}

export function buildConflictOutcomeDocument({
  conflictId,
  installationId,
  environmentId,
  intakePosition,
  envelope,
  envelopeDigest,
  authentication,
  conflictTypes,
  acceptedReceiptIds,
  detectedAt
}) {
  return {
    schema_version: "alphonse.observation-conflict.v0.2",
    installation_id: installationId,
    environment_id: environmentId,
    intake_position: String(intakePosition),
    outcome_type: "conflict",
    conflict_id: conflictId,
    received_observation: {
      observation_id: envelope.observation_id,
      principal_id: envelope.principal_id,
      grant_id: envelope.grant_id,
      key_id: envelope.key_id,
      stream_id: envelope.stream_id,
      stream_sequence: envelope.sequence,
      envelope_digest: envelopeDigest,
      authentication_digest: sha256Digest(authentication)
    },
    conflict_types: [...conflictTypes],
    accepted_receipt_ids: [...acceptedReceiptIds],
    detected_at: detectedAt
  };
}

export function buildRejectionOutcomeDocument({
  rejectionId,
  installationId,
  environmentId,
  intakePosition,
  authenticationVerified,
  authentication,
  envelope,
  parseStatus,
  bodyDigest,
  bodySizeBytes,
  reasonCode,
  receivedAt
}) {
  return {
    schema_version: "alphonse.observation-rejection.v0.2",
    installation_id: installationId,
    environment_id: environmentId,
    intake_position: String(intakePosition),
    outcome_type: "rejected",
    rejection_id: rejectionId,
    authentication: {
      status: authenticationVerified ? "verified" : "unverified",
      principal_id: authenticationVerified ? authentication.principal_id : null,
      grant_id: authenticationVerified ? authentication.grant_id : null,
      key_id: authenticationVerified ? authentication.key_id : null
    },
    claimed_schema: schemaSummary(envelope, parseStatus),
    body_digest: bodyDigest,
    body_size_bytes: bodySizeBytes,
    reason_code: reasonCode,
    received_at: receivedAt
  };
}

export function outcomeDocumentMaterial(document) {
  const canonicalBytes = canonicalize(document);
  return {
    document,
    canonical_document_bytes: Buffer.from(canonicalBytes, "utf8"),
    document_digest: sha256Digest(document)
  };
}

function verifyPreservedDocument(row, outcome, installationId, environmentId) {
  let bytes;
  let parsed;
  try {
    bytes = UTF8.decode(Buffer.from(row.canonical_document_bytes));
    parsed = JSON.parse(bytes);
  } catch {
    fail("CORRELATION_OUTCOME_DOCUMENT_INTEGRITY_VIOLATION",
      "Preserved intake outcome document bytes are invalid.", { intake_position: String(outcome.intake_position) });
  }
  if (bytes !== canonicalize(parsed)
      || !same(row.document, parsed)
      || sha256Digest(parsed) !== row.document_digest
      || row.document_digest !== outcome.outcome_digest
      || row.installation_id !== installationId
      || row.outcome_type !== outcome.outcome_type
      || row.outcome_id !== outcome.outcome_id
      || String(row.intake_position) !== String(outcome.intake_position)
      || parsed.installation_id !== installationId
      || parsed.environment_id !== environmentId
      || parsed.intake_position !== String(outcome.intake_position)
      || parsed.outcome_type !== outcome.outcome_type) {
    fail("CORRELATION_OUTCOME_DOCUMENT_INTEGRITY_VIOLATION",
      "Preserved intake outcome document does not match its committed outcome.", {
        intake_position: String(outcome.intake_position)
      });
  }
  return parsed;
}

function legacyConflictDocument(row) {
  return {
    intake_position: String(row.intake_position),
    received_observation_id: row.received_observation_id,
    received_envelope_digest: row.received_envelope_digest,
    conflict_types: row.conflict_types,
    accepted_receipt_ids: row.accepted_receipt_ids,
    detected_at: iso(row.detected_at)
  };
}

function legacyRejectionCandidates(row) {
  const base = {
    rejection_id: row.rejection_id,
    intake_position: String(row.intake_position),
    authenticated_principal_id: row.authenticated_principal_id ?? null,
    authenticated_grant_id: row.authenticated_grant_id ?? null,
    body_digest: row.body_digest,
    body_size_bytes: Number(row.body_size_bytes),
    reason_code: row.reason_code,
    received_at: iso(row.received_at)
  };
  const candidates = [{ ...base, claimed_schema: null }];
  if (typeof row.claimed_schema_id === "string"
      && typeof row.claimed_schema_version === "string"
      && typeof row.claimed_schema_digest === "string") {
    candidates.push({ ...base, claimed_schema: {
      schema_id: row.claimed_schema_id,
      schema_version: row.claimed_schema_version,
      schema_digest: row.claimed_schema_digest
    } });
  }
  return candidates;
}

function conflictView(row, document, format, digest) {
  const received = format === "alphonse.observation-conflict.v0.2"
    ? document.received_observation
    : { observation_id: document.received_observation_id,
      envelope_digest: document.received_envelope_digest };
  return {
    conflict_id: row.conflict_id,
    intake_position: String(row.intake_position),
    conflict_digest: digest,
    document_format: format,
    received_observation_id: received.observation_id,
    received_envelope_digest: received.envelope_digest,
    conflict_types: document.conflict_types,
    accepted_receipt_ids: document.accepted_receipt_ids
  };
}

function rejectionView(row, document, format, digest) {
  const native = format === "alphonse.observation-rejection.v0.2";
  return {
    rejection_id: row.rejection_id,
    intake_position: String(row.intake_position),
    rejection_digest: digest,
    document_format: format,
    authentication_status: native ? document.authentication.status
      : document.authenticated_principal_id ? "verified" : "unverified",
    claimed_schema_status: native ? document.claimed_schema.status
      : document.claimed_schema === null ? "absent_or_digest_verified_null" : "valid_tuple",
    body_digest: document.body_digest,
    body_size_bytes: Number(document.body_size_bytes),
    reason_code: document.reason_code
  };
}

export function verifyCorrelationOutcomeMaterials({
  outcomeRows,
  conflictRows,
  rejectionRows,
  documentRows,
  acceptedReceiptPositions,
  installationId,
  environmentId
}) {
  const expectedConflicts = outcomeRows.filter((row) => row.outcome_type === "conflict");
  const expectedRejections = outcomeRows.filter((row) => row.outcome_type === "rejected");
  const conflictByPosition = new Map(conflictRows.map((row) => [String(row.intake_position), row]));
  const rejectionByPosition = new Map(rejectionRows.map((row) => [String(row.intake_position), row]));
  const documentByPosition = new Map(documentRows.map((row) => [String(row.intake_position), row]));
  if (expectedConflicts.length !== conflictRows.length || expectedRejections.length !== rejectionRows.length) {
    fail("CORRELATION_COMMITTED_PREFIX_INTEGRITY_VIOLATION",
      "Committed conflict or rejection material is missing from the intake prefix.");
  }
  const conflicts = expectedConflicts.map((outcome) => {
    const position = String(outcome.intake_position);
    const row = conflictByPosition.get(position);
    if (!row || row.conflict_id !== outcome.outcome_id) {
      fail("CORRELATION_CONFLICT_INTEGRITY_VIOLATION",
        "Conflict row does not match its committed outcome.", { intake_position: position });
    }
    const preserved = documentByPosition.get(position);
    let document;
    let format;
    if (preserved) {
      document = verifyPreservedDocument(preserved, outcome, installationId, environmentId);
      format = preserved.document_format;
      const received = document.received_observation;
      const bindings = [
        [format, "alphonse.observation-conflict.v0.2"],
        [document.conflict_id, row.conflict_id],
        [received?.observation_id, row.received_observation_id],
        [received?.grant_id, row.received_grant_id],
        [received?.stream_id, row.received_stream_id],
        [received?.stream_sequence, String(row.received_stream_sequence)],
        [received?.envelope_digest, row.received_envelope_digest],
        [iso(document.detected_at), iso(row.detected_at)]
      ];
      if (bindings.some(([left, right]) => left !== right)
          || !same(document.conflict_types, row.conflict_types)
          || !same(document.accepted_receipt_ids, row.accepted_receipt_ids)
          || row.conflict_digest !== outcome.outcome_digest) {
        fail("CORRELATION_CONFLICT_INTEGRITY_VIOLATION",
          "Native conflict document does not match its stored conflict row.", { intake_position: position });
      }
    } else {
      document = legacyConflictDocument(row);
      format = "alphonse.observation-conflict.v0.1";
      if (sha256Digest(document) !== row.conflict_digest || row.conflict_digest !== outcome.outcome_digest) {
        fail("CORRELATION_CONFLICT_INTEGRITY_VIOLATION",
          "Legacy conflict document does not recompute to its committed digest.", { intake_position: position });
      }
    }
    for (const receiptId of document.accepted_receipt_ids) {
      const acceptedPosition = acceptedReceiptPositions.get(receiptId);
      if (acceptedPosition === undefined || BigInt(acceptedPosition) >= BigInt(position)) {
        fail("CORRELATION_CONFLICT_INTEGRITY_VIOLATION",
          "Conflict references a receipt outside its earlier accepted history.", {
            intake_position: position, receipt_id: receiptId
          });
      }
    }
    return conflictView(row, document, format, outcome.outcome_digest);
  });
  const rejections = expectedRejections.map((outcome) => {
    const position = String(outcome.intake_position);
    const row = rejectionByPosition.get(position);
    if (!row || row.rejection_id !== outcome.outcome_id) {
      fail("CORRELATION_REJECTION_INTEGRITY_VIOLATION",
        "Rejection row does not match its committed outcome.", { intake_position: position });
    }
    const preserved = documentByPosition.get(position);
    if (preserved) {
      const document = verifyPreservedDocument(preserved, outcome, installationId, environmentId);
      const schema = document.claimed_schema;
      const expectedSchema = schema.status === "valid_tuple"
        ? [schema.schema_id, schema.schema_version, schema.schema_digest]
        : [null, null, null];
      const bindings = [
        [preserved.document_format, "alphonse.observation-rejection.v0.2"],
        [document.rejection_id, row.rejection_id],
        [document.authentication.principal_id, row.authenticated_principal_id ?? null],
        [document.authentication.grant_id, row.authenticated_grant_id ?? null],
        [expectedSchema[0], row.claimed_schema_id ?? null],
        [expectedSchema[1], row.claimed_schema_version ?? null],
        [expectedSchema[2], row.claimed_schema_digest ?? null],
        [document.body_digest, row.body_digest],
        [String(document.body_size_bytes), String(row.body_size_bytes)],
        [document.reason_code, row.reason_code],
        [iso(document.received_at), iso(row.received_at)]
      ];
      if (bindings.some(([left, right]) => left !== right)) {
        fail("CORRELATION_REJECTION_INTEGRITY_VIOLATION",
          "Native rejection document does not match its stored rejection row.", { intake_position: position });
      }
      return rejectionView(row, document, preserved.document_format, outcome.outcome_digest);
    }
    const candidates = legacyRejectionCandidates(row)
      .filter((candidate) => sha256Digest(candidate) === outcome.outcome_digest);
    if (candidates.length !== 1) {
      fail("CORRELATION_OUTCOME_MATERIAL_UNVERIFIABLE",
        "Legacy rejection cannot be reconstructed exactly from preserved bounded material.", {
          intake_position: position
        }, 409);
    }
    return rejectionView(row, candidates[0], "alphonse.observation-rejection.v0.1", outcome.outcome_digest);
  });
  const expectedDocumentPositions = new Set([...expectedConflicts, ...expectedRejections]
    .map((outcome) => String(outcome.intake_position)));
  if (documentRows.some((row) => !expectedDocumentPositions.has(String(row.intake_position)))) {
    fail("CORRELATION_OUTCOME_DOCUMENT_INTEGRITY_VIOLATION",
      "An outcome document is not bound to a conflict or rejection in the committed prefix.");
  }
  return { conflicts, rejections };
}
