import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildConflictOutcomeDocument,
  buildRejectionOutcomeDocument,
  outcomeDocumentMaterial,
  verifyCorrelationOutcomeMaterials
} from "../../src/diagnostic-intake-outcome-contracts.js";

const installationId = "00000000-0000-4000-8000-00000000a001";
const environmentId = "00000000-0000-4000-8000-000000000001";
const acceptedReceiptId = "00000000-0000-4000-8000-000000000821";
const conflictId = "00000000-0000-4000-8000-000000000822";
const rejectionId = "00000000-0000-4000-8000-000000000823";

function nativeConflict() {
  const detectedAt = "2026-07-17T13:00:00.000Z";
  const document = buildConflictOutcomeDocument({
    conflictId,
    installationId,
    environmentId,
    intakePosition: "2",
    envelope: {
      observation_id: "00000000-0000-4000-8000-000000000824",
      principal_id: "observer:test",
      grant_id: "00000000-0000-4000-8000-000000000825",
      key_id: "observer-key-v1",
      stream_id: "stream:test",
      sequence: "2"
    },
    envelopeDigest: `sha256:${"1".repeat(64)}`,
    authentication: { principal_id: "observer:test", signature: "signed" },
    conflictTypes: ["stream_sequence"],
    acceptedReceiptIds: [acceptedReceiptId],
    detectedAt
  });
  const material = outcomeDocumentMaterial(document);
  return {
    outcome: { intake_position: "2", outcome_type: "conflict", outcome_id: conflictId,
      outcome_digest: material.document_digest },
    row: {
      conflict_id: conflictId,
      intake_position: "2",
      received_observation_id: document.received_observation.observation_id,
      received_grant_id: document.received_observation.grant_id,
      received_stream_id: document.received_observation.stream_id,
      received_stream_sequence: "2",
      received_envelope_digest: document.received_observation.envelope_digest,
      conflict_types: document.conflict_types,
      accepted_receipt_ids: document.accepted_receipt_ids,
      detected_at: new Date(detectedAt),
      conflict_digest: material.document_digest
    },
    preserved: {
      installation_id: installationId,
      intake_position: "2",
      outcome_type: "conflict",
      outcome_id: conflictId,
      document_format: document.schema_version,
      document,
      canonical_document_bytes: material.canonical_document_bytes,
      document_digest: material.document_digest
    }
  };
}

function nativeRejection() {
  const receivedAt = "2026-07-17T13:01:00.000Z";
  const document = buildRejectionOutcomeDocument({
    rejectionId,
    installationId,
    environmentId,
    intakePosition: "3",
    authenticationVerified: false,
    authentication: null,
    envelope: { schema: ["malformed"] },
    parseStatus: "parsed",
    bodyDigest: `sha256:${"2".repeat(64)}`,
    bodySizeBytes: 57,
    reasonCode: "OBSERVATION_ENVELOPE_INVALID",
    receivedAt
  });
  const material = outcomeDocumentMaterial(document);
  return {
    outcome: { intake_position: "3", outcome_type: "rejected", outcome_id: rejectionId,
      outcome_digest: material.document_digest },
    row: {
      rejection_id: rejectionId,
      intake_position: "3",
      authenticated_principal_id: null,
      authenticated_grant_id: null,
      claimed_schema_id: null,
      claimed_schema_version: null,
      claimed_schema_digest: null,
      body_digest: document.body_digest,
      body_size_bytes: "57",
      reason_code: document.reason_code,
      received_at: new Date(receivedAt)
    },
    preserved: {
      installation_id: installationId,
      intake_position: "3",
      outcome_type: "rejected",
      outcome_id: rejectionId,
      document_format: document.schema_version,
      document,
      canonical_document_bytes: material.canonical_document_bytes,
      document_digest: material.document_digest
    }
  };
}

function verify({ outcomes, conflicts = [], rejections = [], documents = [] }) {
  return verifyCorrelationOutcomeMaterials({
    outcomeRows: outcomes,
    conflictRows: conflicts,
    rejectionRows: rejections,
    documentRows: documents,
    acceptedReceiptPositions: new Map([[acceptedReceiptId, "1"]]),
    installationId,
    environmentId
  });
}

test("native conflict and rejection documents recompute to committed outcomes", () => {
  const conflict = nativeConflict();
  const rejection = nativeRejection();
  const result = verify({
    outcomes: [conflict.outcome, rejection.outcome],
    conflicts: [conflict.row],
    rejections: [rejection.row],
    documents: [conflict.preserved, rejection.preserved]
  });
  assert.equal(result.conflicts[0].document_format, "alphonse.observation-conflict.v0.2");
  assert.equal(result.rejections[0].claimed_schema_status, "malformed");
  assert.equal(result.rejections[0].body_size_bytes, 57);
});

test("native outcome row, bytes, and digest tampering fail closed", () => {
  const conflict = nativeConflict();
  conflict.row.conflict_types = ["observation_identity"];
  assert.throws(() => verify({
    outcomes: [conflict.outcome], conflicts: [conflict.row], documents: [conflict.preserved]
  }), (error) => error.code === "CORRELATION_CONFLICT_INTEGRITY_VIOLATION");

  const rejection = nativeRejection();
  rejection.preserved.canonical_document_bytes = Buffer.from("{}", "utf8");
  assert.throws(() => verify({
    outcomes: [rejection.outcome], rejections: [rejection.row], documents: [rejection.preserved]
  }), (error) => error.code === "CORRELATION_OUTCOME_DOCUMENT_INTEGRITY_VIOLATION");
});

test("legacy conflicts are reconstructed from the complete original digest document", () => {
  const detectedAt = "2026-07-17T13:02:00.000Z";
  const document = {
    intake_position: "2",
    received_observation_id: "00000000-0000-4000-8000-000000000826",
    received_envelope_digest: `sha256:${"3".repeat(64)}`,
    conflict_types: ["stream_sequence"],
    accepted_receipt_ids: [acceptedReceiptId],
    detected_at: detectedAt
  };
  const digest = sha256Digest(document);
  const outcome = { intake_position: "2", outcome_type: "conflict", outcome_id: conflictId,
    outcome_digest: digest };
  const row = {
    conflict_id: conflictId,
    intake_position: "2",
    received_observation_id: document.received_observation_id,
    received_envelope_digest: document.received_envelope_digest,
    conflict_types: document.conflict_types,
    accepted_receipt_ids: document.accepted_receipt_ids,
    detected_at: new Date(detectedAt),
    conflict_digest: digest
  };
  assert.equal(verify({ outcomes: [outcome], conflicts: [row] }).conflicts[0].document_format,
    "alphonse.observation-conflict.v0.1");
  row.accepted_receipt_ids = [];
  assert.throws(() => verify({ outcomes: [outcome], conflicts: [row] }),
    (error) => error.code === "CORRELATION_CONFLICT_INTEGRITY_VIOLATION");
});

test("legacy rejection reconstruction succeeds only for an exact digest-matching candidate", () => {
  const receivedAt = "2026-07-17T13:03:00.000Z";
  const row = {
    rejection_id: rejectionId,
    intake_position: "2",
    authenticated_principal_id: null,
    authenticated_grant_id: null,
    claimed_schema_id: null,
    claimed_schema_version: null,
    claimed_schema_digest: null,
    body_digest: `sha256:${"4".repeat(64)}`,
    body_size_bytes: "10",
    reason_code: "OBSERVATION_JSON_INVALID",
    received_at: new Date(receivedAt)
  };
  const legacyDocument = {
    rejection_id: rejectionId,
    intake_position: "2",
    authenticated_principal_id: null,
    authenticated_grant_id: null,
    body_digest: row.body_digest,
    body_size_bytes: 10,
    reason_code: row.reason_code,
    received_at: receivedAt,
    claimed_schema: null
  };
  const outcome = { intake_position: "2", outcome_type: "rejected", outcome_id: rejectionId,
    outcome_digest: sha256Digest(legacyDocument) };
  assert.equal(verify({ outcomes: [outcome], rejections: [row] }).rejections[0].document_format,
    "alphonse.observation-rejection.v0.1");

  const unavailable = { ...outcome, outcome_digest: `sha256:${"f".repeat(64)}` };
  assert.throws(() => verify({ outcomes: [unavailable], rejections: [row] }),
    (error) => error.code === "CORRELATION_OUTCOME_MATERIAL_UNVERIFIABLE");
});

test("rejection summaries retain bounded classification rather than malformed schema values", () => {
  const document = buildRejectionOutcomeDocument({
    rejectionId,
    installationId,
    environmentId,
    intakePosition: "2",
    authenticationVerified: false,
    authentication: null,
    envelope: { schema: { nested: { arbitrary: "material" } } },
    parseStatus: "parsed",
    bodyDigest: `sha256:${"5".repeat(64)}`,
    bodySizeBytes: 500,
    reasonCode: "OBSERVATION_ENVELOPE_INVALID",
    receivedAt: "2026-07-17T13:04:00.000Z"
  });
  assert.deepEqual(document.claimed_schema, {
    status: "malformed",
    json_kind: "object",
    schema_id: null,
    schema_version: null,
    schema_digest: null
  });
  assert.equal(JSON.stringify(document).includes("arbitrary"), false);
});

test("rejection classification is bounded across oversize, invalid JSON, scalar, array, and valid tuple inputs", () => {
  const cases = [
    ["unparsed_oversize", null, "unparsed_oversize", null],
    ["unparsed_invalid_json", null, "unparsed_invalid_json", null],
    ["parsed", 42, "absent", null],
    ["parsed", { schema: [] }, "malformed", "array"],
    ["parsed", { schema: {
      schema_id: "schema:test",
      schema_version: "0.1.0",
      schema_digest: `sha256:${"6".repeat(64)}`
    } }, "valid_tuple", "object"]
  ];
  for (const [parseStatus, envelope, expectedStatus, expectedKind] of cases) {
    const document = buildRejectionOutcomeDocument({
      rejectionId,
      installationId,
      environmentId,
      intakePosition: "2",
      authenticationVerified: false,
      authentication: null,
      envelope,
      parseStatus,
      bodyDigest: `sha256:${"7".repeat(64)}`,
      bodySizeBytes: 1024 * 1024 + 1,
      reasonCode: "OBSERVATION_ENVELOPE_INVALID",
      receivedAt: "2026-07-17T13:05:00.000Z"
    });
    assert.equal(document.claimed_schema.status, expectedStatus);
    assert.equal(document.claimed_schema.json_kind, expectedKind);
    assert.ok(Object.keys(document.claimed_schema).every((key) => [
      "status", "json_kind", "schema_id", "schema_version", "schema_digest"
    ].includes(key)));
  }
});
