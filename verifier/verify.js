import { createPublicKey, verify as verifySignature } from "node:crypto";
import { TextDecoder } from "node:util";

import { canonicalize, compareCanonical, deterministicUuid, rawSha256Digest, same,
  sha256Digest } from "./canonical.js";
import { buildCorrelationProjectorInput, buildCorrelationProjection, CORRELATION_PROJECTOR_ID,
  CORRELATION_PROJECTOR_INPUT_SCHEMA_VERSION, CORRELATION_PROJECTOR_VERSION,
  CORRELATION_PROJECTION_SCHEMA_VERSION, CORRELATION_RULES_DIGEST } from "./correlation.js";
import { buildDiagnosticEffectProjection, COUNT_BY_CORRELATION_RULES_DIGEST,
  DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST, evaluateCountByCorrelation } from "./effect.js";
import { DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST, selectDiagnosticEvidence } from "./selection.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const BUNDLE_SCHEMA = "alphonse.independent-diagnostic-verification-bundle.v0.1";
const PACKAGE_SCHEMA = "alphonse.diagnostic-evidence-package.v0.1";
const PACKAGE_ARTIFACT_SCHEMA = "alphonse.diagnostic-evidence-package-artifact.v0.1";
const PACKAGE_RECORD_SCHEMA = "alphonse.diagnostic-evidence-package-record.v0.1";
const EFFECT_RECORD_SCHEMA = "alphonse.diagnostic-effect-projection-record.v0.1";
const EVALUATION_RECORD_SCHEMA = "alphonse.behavior-evaluation-record.v0.1";
const TRIGGER_SCHEMA = "alphonse.diagnostic-trigger.v0.2";
const CASE_SCHEMA = "alphonse.diagnostic-case.v0.2";
const CLAIM_SCHEMA = "alphonse.diagnostic-claim-envelope.v0.1";
const LEASE_SCHEMA = "alphonse.evidence-collection-retention-lease.v0.1";
const RELEASE_SCHEMA = "alphonse.evidence-collection-lease-release.v0.1";
const EFFECT_AUTHOR = "diagnostic-stage-worker:effect-evaluation-v0.1";
const PACKAGE_AUTHOR = "diagnostic-stage-worker:evidence-packaging-v0.1";

function violation(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function assert(condition, code, message, details = {}) {
  if (!condition) violation(code, message, details);
}

function bytes(field, label) {
  assert(field?.encoding === "base64" && typeof field.bytes === "string",
    "VERIFIER_EXACT_BYTES_MISSING", `${label} exact bytes are missing.`);
  const value = Buffer.from(field.bytes, "base64");
  assert(value.toString("base64") === field.bytes, "VERIFIER_EXACT_BYTES_INVALID",
    `${label} bytes are not canonical base64.`);
  return value;
}

function parseCanonicalBytes(field, label) {
  let text;
  let document;
  try {
    text = UTF8.decode(bytes(field, label));
    document = JSON.parse(text);
  } catch {
    violation("VERIFIER_CANONICAL_MATERIAL_INVALID", `${label} is not valid canonical UTF-8 JSON.`);
  }
  assert(text === canonicalize(document), "VERIFIER_CANONICAL_MATERIAL_INVALID",
    `${label} bytes are not canonical JSON.`);
  return { text, document, digest: rawSha256Digest(Buffer.from(text, "utf8")) };
}

function iso(value) {
  try { return new Date(value).toISOString(); } catch { return null; }
}

function byUnique(values, field, code) {
  const result = new Map();
  for (const value of values) {
    const key = String(value[field]);
    assert(!result.has(key), code, `Duplicate ${field} in independent inputs.`, { [field]: key });
    result.set(key, value);
  }
  return result;
}

function schemaArtifactFromExport(exportRecord) {
  const content = exportRecord?.content;
  const observation = content?.observation;
  assert(exportRecord?.kind === "schema" && typeof exportRecord.export_id === "string"
    && typeof exportRecord.contract_version === "string" && observation
    && typeof observation.observation_type === "string"
    && Array.isArray(observation.allowed_detail_media_types)
    && Array.isArray(observation.required_correlation_roles),
  "VERIFIER_SCHEMA_EXPORT_INVALID", "Deployed Schema export is not an exact supported Schema document.");
  return { schema_id: exportRecord.export_id, schema_version: exportRecord.contract_version,
    observation_type: observation.observation_type,
    claims_schema: { type: content.type, additionalProperties: content.additionalProperties,
      required: content.required, properties: content.properties },
    allowed_detail_media_types: observation.allowed_detail_media_types,
    required_correlation_roles: observation.required_correlation_roles };
}

function verifyStageArchives(inputs, expectedDigests) {
  const archives = byUnique(inputs.stage_artifact_archives, "stage_artifact_digest",
    "VERIFIER_STAGE_ARCHIVE_DUPLICATED");
  for (const digest of expectedDigests) {
    const entry = archives.get(digest);
    assert(entry, "VERIFIER_STAGE_ARCHIVE_MISSING", "Activated stage archive is missing.", {
      stage_artifact_digest: digest
    });
    const archive = entry.archive;
    assert(archive?.schema_version === "alphonse.stage-artifact-archive.v0.1"
      && archive.stage_artifact_digest === digest
      && sha256Digest(archive.artifact_manifest) === digest
      && sha256Digest(archive) === entry.archive_artifact_digest,
    "VERIFIER_STAGE_ARCHIVE_INTEGRITY_VIOLATION", "Stage artifact archive identity does not verify.", {
      stage_artifact_digest: digest
    });
    const manifestFiles = [...archive.artifact_manifest.module_closure,
      ...archive.artifact_manifest.bound_files].sort((left, right) => left.path < right.path ? -1 : 1);
    assert(manifestFiles.length === archive.files.length,
      "VERIFIER_STAGE_ARCHIVE_INTEGRITY_VIOLATION", "Stage archive file closure is incomplete.");
    for (let index = 0; index < manifestFiles.length; index += 1) {
      const expected = manifestFiles[index];
      const actual = archive.files[index];
      const content = Buffer.from(actual?.bytes_base64 ?? "", "base64");
      assert(actual?.path === expected.path && actual.size_bytes === expected.size_bytes
        && actual.digest === expected.digest && content.length === expected.size_bytes
        && rawSha256Digest(content) === expected.digest,
      "VERIFIER_STAGE_ARCHIVE_INTEGRITY_VIOLATION", "Stage archive file bytes do not match the manifest.", {
        path: expected.path
      });
    }
  }
  return archives;
}

function verifyGrantMaterial(snapshotRow, applicationRow, expectedSnapshotDigest, expectedGrantId) {
  assert(snapshotRow && applicationRow, "VERIFIER_GRANT_MATERIAL_MISSING",
    "Accepted observation grant material is missing.", { expected_snapshot_digest: expectedSnapshotDigest });
  const snapshot = parseCanonicalBytes(snapshotRow.signed_snapshot_bytes, "grant snapshot");
  const application = parseCanonicalBytes(applicationRow.signed_receipt_bytes, "grant application receipt");
  assert(snapshot.digest === expectedSnapshotDigest && snapshot.digest === snapshotRow.snapshot_digest
    && snapshot.document.document?.snapshot_id === snapshotRow.snapshot_id
    && snapshot.document.document?.grant_id === expectedGrantId
    && snapshot.document.document?.target_state === "active"
    && sha256Digest(snapshot.document.document?.grant_document) === snapshot.document.document?.grant_digest
    && application.digest === applicationRow.receipt_digest
    && application.document.document?.snapshot_id === snapshotRow.snapshot_id
    && application.document.document?.snapshot_digest === snapshotRow.snapshot_digest
    && application.document.document?.grant_id === expectedGrantId
    && application.document.document?.applied_state === "active",
  "VERIFIER_GRANT_MATERIAL_INTEGRITY_VIOLATION",
  "Accepted observation grant snapshot/application bindings do not verify.");
}

function verifyTokenResult(row, identity) {
  assert(row && identity?.service_key_id && identity.public_key_der_base64,
    "VERIFIER_TOKEN_PROVENANCE_MISSING", "Tokenization proof or public verification identity is missing.");
  const signedResult = parseCanonicalBytes(row.signed_receipt_bytes, "tokenization result receipt");
  const wrapper = signedResult.document;
  const publicKey = createPublicKey({ key: Buffer.from(identity.public_key_der_base64, "base64"),
    format: "der", type: "spki" });
  let signatureValid = false;
  try {
    signatureValid = wrapper.authentication?.algorithm === "Ed25519"
      && wrapper.authentication.key_id === identity.service_key_id
      && verifySignature(null, Buffer.from(canonicalize(wrapper.document), "utf8"), publicKey,
        Buffer.from(wrapper.authentication.signature, "base64url"));
  } catch {}
  assert(signatureValid, "VERIFIER_TOKEN_SIGNATURE_INVALID",
    "Tokenization Result Receipt Ed25519 signature does not verify.", {
      result_receipt_id: row.result_receipt_id
    });
  const result = wrapper.document;
  const snapshot = parseCanonicalBytes(row.signed_grant_snapshot_bytes, "tokenization grant snapshot");
  const application = parseCanonicalBytes(row.signed_grant_application_receipt_bytes,
    "tokenization grant application receipt");
  const grant = snapshot.document.document;
  const applied = application.document.document;
  const rowBindings = [
    [row.result_receipt_id, result.result_receipt_id], [row.installation_id, result.installation_id],
    [row.environment_id, result.environment_id], [row.request_id, result.request_id],
    [row.grant_id, result.grant_id], [row.requester_principal_id, result.requester_principal_id],
    [row.integration_id, result.integration_id], [row.field_role, result.field_role],
    [row.claim_field, result.claim_field], [row.namespace, result.namespace],
    [row.algorithm_version, result.algorithm_version], [row.equality_token, result.equality_token],
    [String(row.input_length), String(result.input_length)],
    [row.collection_window_id, result.collection_window_id], [row.service_id, result.service_id],
    [row.service_version, result.service_version], [row.service_key_id, identity.service_key_id]
  ];
  const grantFields = ["requester_principal_id", "installation_id", "environment_id", "integration_id",
    "field_role", "claim_field", "namespace", "algorithm_version", "collection_window_id"];
  assert(rowBindings.every(([left, right]) => left === right)
    && signedResult.digest === row.receipt_digest
    && snapshot.digest === row.grant_snapshot_digest
    && application.digest === row.grant_application_receipt_digest
    && grant?.grant_id === result.grant_id && grant?.grant_type === "tokenization_use"
    && grant?.receiver_service_id === result.service_id && grant?.target_state === "active"
    && applied?.snapshot_digest === snapshot.digest && applied?.grant_id === result.grant_id
    && applied?.applied_state === "active"
    && grantFields.every((field) => grant.grant_document?.[field] === result[field])
    && grant.grant_document?.service_binding?.version === result.service_version
    && result.input_length <= grant.grant_document?.max_input_bytes
    && Date.parse(result.issued_at) >= Date.parse(grant.grant_document?.valid_from)
    && Date.parse(result.issued_at) < Date.parse(grant.grant_document?.expires_at),
  "VERIFIER_TOKEN_PROVENANCE_INTEGRITY_VIOLATION",
  "Tokenization proof fields do not match their exact signed material.", {
    result_receipt_id: row.result_receipt_id
  });
  return { result_receipt_id: result.result_receipt_id, receipt_digest: signedResult.digest,
    grant_snapshot_digest: snapshot.digest, grant_application_receipt_digest: application.digest,
    requester_principal_id: result.requester_principal_id, installation_id: result.installation_id,
    environment_id: result.environment_id, integration_id: result.integration_id,
    field_role: result.field_role, claim_field: result.claim_field, namespace: result.namespace,
    algorithm_version: result.algorithm_version, equality_token: result.equality_token };
}

function verifyAcceptedInputs(bundle) {
  const { independent_inputs: inputs, target } = bundle;
  const allowedMaterialStates = new Set(["exact_material", "verified_legacy_reconstruction",
    "governed_erasure_tombstone", "unavailable_legacy_material", "missing_or_corrupt_material"]);
  const cutoff = BigInt(target.committed_intake_cutoff);
  assert(cutoff >= 1n && inputs.positions.length === Number(cutoff),
    "VERIFIER_PREFIX_NOT_CONTIGUOUS", "Complete prefix position count does not match cutoff.");
  const positions = byUnique(inputs.positions, "intake_position", "VERIFIER_PREFIX_POSITION_DUPLICATED");
  const outcomes = byUnique(inputs.intake_outcomes, "intake_position", "VERIFIER_PREFIX_OUTCOME_DUPLICATED");
  for (let position = 1n; position <= cutoff; position += 1n) {
    const key = position.toString();
    const index = positions.get(key);
    const outcome = outcomes.get(key);
    assert(index && outcome && String(outcome.intake_position) === key
      && index.outcome_type === outcome.outcome_type && index.outcome_id === outcome.outcome_id
      && index.outcome_digest === outcome.outcome_digest
      && allowedMaterialStates.has(index.material?.state)
      && index.material.material_id === outcome.outcome_id
      && index.material.material_digest === outcome.outcome_digest
      && index.material.material_type === (outcome.outcome_type === "accepted"
        ? "accepted_receipt" : outcome.outcome_type),
    "VERIFIER_PREFIX_NOT_CONTIGUOUS", "Committed prefix position is missing or substituted.", {
      intake_position: key
    });
    assert(index.material.state !== "governed_erasure_tombstone",
      "VERIFIER_UNVERIFIABLE_MATERIAL",
      "A governed-erasure tombstone is not explained by exact policy and authority material in this protocol version.", {
        intake_position: key
      });
    assert(outcome.outcome_type !== "accepted" || index.material.state === "exact_material",
      "VERIFIER_MATERIAL_STATE_MISMATCH",
      "An accepted outcome must declare exact receipt material.", { intake_position: key });
  }
  assert(outcomes.size === positions.size, "VERIFIER_PREFIX_OUTCOME_SET_MISMATCH",
    "Position index and intake outcomes are not one exact set.");
  const receiptsByPosition = byUnique(inputs.accepted_receipts, "intake_position",
    "VERIFIER_ACCEPTED_RECEIPT_DUPLICATED");
  const schemasById = byUnique(inputs.schema_activations, "activation_id",
    "VERIFIER_SCHEMA_ACTIVATION_DUPLICATED");
  const schemaExportsByActivation = byUnique(inputs.schema_exports, "activation_id",
    "VERIFIER_SCHEMA_EXPORT_DUPLICATED");
  const dependenciesByReceipt = new Map();
  for (const dependency of inputs.provenance_dependencies) {
    const list = dependenciesByReceipt.get(dependency.observation_receipt_id) ?? [];
    assert(!list.some((entry) => entry.dependency_id === dependency.dependency_id),
      "VERIFIER_TOKEN_DEPENDENCY_DUPLICATED", "Observation dependency is duplicated.");
    list.push(dependency);
    dependenciesByReceipt.set(dependency.observation_receipt_id, list);
  }
  const tokenRowsById = byUnique(inputs.tokenization_result_receipts, "result_receipt_id",
    "VERIFIER_TOKEN_RECEIPT_DUPLICATED");
  const grantSnapshotsByDigest = byUnique(inputs.observation_grant_snapshots, "snapshot_digest",
    "VERIFIER_GRANT_SNAPSHOT_DUPLICATED");
  const grantApplicationsBySnapshot = byUnique(inputs.observation_grant_application_receipts, "snapshot_id",
    "VERIFIER_GRANT_APPLICATION_DUPLICATED");
  const observationEvidence = [];
  const observations = [];
  const receiptManifest = [];
  const schemaManifest = new Map();
  const tokenizationManifest = new Map();
  const acceptedReceiptPositions = new Map();
  for (const outcome of inputs.intake_outcomes.filter((entry) => entry.outcome_type === "accepted")) {
    const position = String(outcome.intake_position);
    const row = receiptsByPosition.get(position);
    assert(row && row.receipt_id === outcome.outcome_id && row.receipt_digest === outcome.outcome_digest,
      "VERIFIER_ACCEPTED_RECEIPT_MISSING", "Accepted outcome does not resolve to one exact receipt.", {
        intake_position: position
      });
    const envelopeMaterial = parseCanonicalBytes(row.envelope_bytes, "accepted observation envelope");
    const envelope = envelopeMaterial.document;
    const schema = schemasById.get(row.schema_activation_id);
    const schemaExport = schemaExportsByActivation.get(row.schema_activation_id);
    const exactExport = schemaExport?.export_record;
    assert(envelopeMaterial.digest === row.envelope_digest && same(row.envelope, envelope)
      && envelope.installation_id === target.installation_id
      && envelope.environment_id === target.environment_id
      && row.installation_id === envelope.installation_id && row.environment_id === envelope.environment_id
      && row.observation_id === envelope.observation_id && row.observation_type === envelope.observation_type
      && row.principal_id === envelope.principal_id && row.grant_id === envelope.grant_id
      && row.key_id === envelope.key_id && row.stream_id === envelope.stream_id
      && String(row.stream_sequence) === envelope.sequence
      && (row.workflow_id ?? null) === envelope.workflow_id
      && (row.integration_id ?? null) === envelope.integration_id
      && row.schema_id === envelope.schema?.schema_id
      && row.schema_version === envelope.schema?.schema_version
      && row.schema_digest === envelope.schema?.schema_digest
      && (row.detail_artifact_digest ?? null) === (envelope.detail?.digest ?? null)
      && row.attribution === "authenticated_under_observer_specific_grant"
      && row.external_truth_established === false && row.exclusive_authorship_established === false
      && schema && schema.installation_id === envelope.installation_id
      && schema.environment_id === envelope.environment_id
      && schema.observation_type === envelope.observation_type
      && schema.schema_id === envelope.schema.schema_id
      && schema.schema_version === envelope.schema.schema_version
      && schema.schema_digest === envelope.schema.schema_digest
      && schemaExport?.deployment_id === schema.deployment_id
      && schemaExport?.package_version_id === schema.package_version_id
      && schemaExport?.package_artifact_digest === schema.package_artifact_digest
      && exactExport?.export_id === schema.schema_id
      && exactExport?.contract_version === schema.schema_version
      && sha256Digest(exactExport?.content) === schema.schema_digest
      && same(schemaArtifactFromExport(exactExport), schema.schema_artifact),
    "VERIFIER_ACCEPTED_RECEIPT_INTEGRITY_VIOLATION",
    "Accepted receipt duplicated fields do not match canonical envelope/schema material.", {
      intake_position: position
    });
    const receipt = row.receipt;
    assert(sha256Digest(receipt) === row.receipt_digest
      && receipt.receipt_id === row.receipt_id && receipt.intake_position === position
      && receipt.observation_id === envelope.observation_id
      && receipt.observation_type === envelope.observation_type
      && receipt.envelope_digest === row.envelope_digest
      && (receipt.detail_artifact_digest ?? null) === (envelope.detail?.digest ?? null)
      && receipt.principal_id === envelope.principal_id && receipt.grant_id === envelope.grant_id
      && receipt.grant_snapshot_digest === row.grant_snapshot_digest
      && receipt.stream_id === envelope.stream_id && receipt.stream_sequence === envelope.sequence
      && same(receipt.schema, envelope.schema) && iso(receipt.received_at) === iso(row.received_at)
      && receipt.attribution === row.attribution
      && receipt.exclusive_authorship_established === false
      && receipt.external_truth_established === false
      && receipt.transition?.transition_id === row.transition_id
      && receipt.transition?.type === "diagnostic.observation.accepted"
      && row.authentication?.principal_id === envelope.principal_id
      && row.authentication?.grant_id === envelope.grant_id
      && row.authentication?.key_id === envelope.key_id
      && Number.isFinite(Date.parse(row.authentication?.signed_at))
      && typeof row.authentication?.signature === "string" && row.authentication.signature.length > 0,
    "VERIFIER_ACCEPTED_RECEIPT_INTEGRITY_VIOLATION",
    "Diagnostic Plane receipt does not bind its exact accepted envelope.", { intake_position: position });
    verifyGrantMaterial(grantSnapshotsByDigest.get(row.grant_snapshot_digest),
      grantApplicationsBySnapshot.get(grantSnapshotsByDigest.get(row.grant_snapshot_digest)?.snapshot_id),
      row.grant_snapshot_digest, row.grant_id);
    const expectedDependencyIds = [...envelope.provenance_dependencies].sort();
    assert(new Set(expectedDependencyIds).size === expectedDependencyIds.length,
      "VERIFIER_TOKEN_DEPENDENCY_DUPLICATED", "Signed envelope dependency IDs are duplicated.");
    const joined = dependenciesByReceipt.get(row.receipt_id) ?? [];
    assert(same(joined.map((entry) => entry.dependency_id).sort(), expectedDependencyIds),
      "VERIFIER_TOKEN_DEPENDENCY_SET_MISMATCH",
      "Signed envelope and preserved dependency join are not one exact set.", { receipt_id: row.receipt_id });
    const verifiedDependencies = joined.map((dependency) => {
      assert(dependency.dependency_type === "tokenization_result_receipt",
        "VERIFIER_TOKEN_DEPENDENCY_TYPE_UNSUPPORTED", "Unsupported provenance dependency type.");
      const proof = verifyTokenResult(tokenRowsById.get(dependency.dependency_id),
        inputs.verification_identities.tokenization_result_receipt);
      assert(dependency.dependency_digest === proof.receipt_digest
        && dependency.dependency_id === proof.result_receipt_id
        && proof.requester_principal_id === envelope.principal_id
        && proof.installation_id === envelope.installation_id
        && proof.environment_id === envelope.environment_id
        && proof.integration_id === envelope.integration_id
        && envelope.claims[proof.claim_field] === proof.equality_token,
      "VERIFIER_TOKEN_DEPENDENCY_BINDING_MISMATCH",
      "Tokenization dependency does not bind the exact signed envelope claim.");
      const normalized = { result_receipt_id: proof.result_receipt_id, receipt_digest: proof.receipt_digest,
        grant_snapshot_digest: proof.grant_snapshot_digest,
        grant_application_receipt_digest: proof.grant_application_receipt_digest,
        requester_principal_id: proof.requester_principal_id, integration_id: proof.integration_id,
        field_role: proof.field_role, claim_field: proof.claim_field, namespace: proof.namespace,
        algorithm_version: proof.algorithm_version, equality_token: proof.equality_token };
      const manifest = { ...normalized, raw_input_preserved: false };
      delete manifest.equality_token;
      const existing = tokenizationManifest.get(proof.result_receipt_id);
      assert(!existing || same(existing, manifest), "VERIFIER_TOKEN_PROVENANCE_CONFLICT",
        "One token receipt resolves to conflicting material.");
      tokenizationManifest.set(proof.result_receipt_id, manifest);
      return normalized;
    }).sort((left, right) => left.result_receipt_id < right.result_receipt_id ? -1 : 1);
    observations.push({ receipt_id: row.receipt_id, receipt_digest: row.receipt_digest,
      intake_position: position, envelope_digest: row.envelope_digest,
      installation_id: envelope.installation_id, environment_id: envelope.environment_id,
      observation_id: envelope.observation_id, observation_type: envelope.observation_type,
      principal_id: envelope.principal_id, grant_id: envelope.grant_id, key_id: envelope.key_id,
      stream_id: envelope.stream_id, stream_sequence: envelope.sequence,
      workflow_id: envelope.workflow_id, integration_id: envelope.integration_id,
      claims: envelope.claims, limitations: envelope.limitations, dependencies: verifiedDependencies });
    observationEvidence.push({ receipt_id: row.receipt_id, receipt_digest: row.receipt_digest, envelope });
    receiptManifest.push({ intake_position: position, receipt_id: row.receipt_id,
      receipt_digest: row.receipt_digest, observation_type: envelope.observation_type,
      envelope_digest: row.envelope_digest, schema: envelope.schema,
      grant_snapshot_digest: row.grant_snapshot_digest,
      detail_artifact_digest: envelope.detail?.digest ?? null,
      provenance_dependencies: verifiedDependencies.map((dependency) => ({
        result_receipt_id: dependency.result_receipt_id, receipt_digest: dependency.receipt_digest
      })) });
    schemaManifest.set(canonicalize({ observation_type: envelope.observation_type, ...envelope.schema }), {
      observation_type: envelope.observation_type, schema_id: envelope.schema.schema_id,
      schema_version: envelope.schema.schema_version, schema_digest: envelope.schema.schema_digest
    });
    acceptedReceiptPositions.set(row.receipt_id, position);
  }
  assert(receiptsByPosition.size === observations.length, "VERIFIER_ACCEPTED_RECEIPT_SET_MISMATCH",
    "Preserved accepted receipts include an outcome-external row.");
  const materialAvailability = inputs.intake_outcomes
    .filter((entry) => entry.outcome_type === "accepted")
    .map((entry) => ({ intake_position: String(entry.intake_position), outcome_type: "accepted",
      outcome_id: entry.outcome_id, outcome_digest: entry.outcome_digest,
      material_state: "exact_material", verification: "canonical_receipt_and_envelope_verified" }));
  return { observations, observationEvidence, receiptManifest,
    schemaManifest: [...schemaManifest.values()], tokenizationManifest: [...tokenizationManifest.values()],
    acceptedReceiptPositions, materialAvailability };
}

function verifyOutcomeMaterial(bundle, acceptedReceiptPositions) {
  const inputs = bundle.independent_inputs;
  const positionByPosition = byUnique(inputs.positions, "intake_position", "VERIFIER_PREFIX_POSITION_DUPLICATED");
  const conflictByPosition = byUnique(inputs.conflicts, "intake_position", "VERIFIER_CONFLICT_DUPLICATED");
  const rejectionByPosition = byUnique(inputs.rejections, "intake_position", "VERIFIER_REJECTION_DUPLICATED");
  const documentByPosition = byUnique(inputs.outcome_documents, "intake_position",
    "VERIFIER_OUTCOME_DOCUMENT_DUPLICATED");
  const conflicts = [];
  const rejections = [];
  const materialAvailability = [];
  for (const outcome of inputs.intake_outcomes.filter((entry) => entry.outcome_type !== "accepted")) {
    const position = String(outcome.intake_position);
    const documentRow = documentByPosition.get(position);
    const declaredMaterial = positionByPosition.get(position)?.material;
    let document;
    let format;
    if (documentRow) {
      assert(declaredMaterial?.state === (documentRow.material_origin === "native_v0.2"
        ? "exact_material" : "verified_legacy_reconstruction"),
      "VERIFIER_MATERIAL_STATE_MISMATCH", "Declared outcome material state does not match preserved material.", {
        intake_position: position
      });
      const material = parseCanonicalBytes(documentRow.canonical_document_bytes, "intake outcome document");
      assert(material.digest === outcome.outcome_digest && material.digest === documentRow.document_digest
        && same(material.document, documentRow.document) && documentRow.outcome_id === outcome.outcome_id
        && documentRow.outcome_type === outcome.outcome_type
        && material.document.installation_id === bundle.target.installation_id
        && material.document.environment_id === bundle.target.environment_id
        && material.document.intake_position === position,
      "VERIFIER_OUTCOME_DOCUMENT_INTEGRITY_VIOLATION",
      "Intake outcome document does not match the committed prefix.", { intake_position: position });
      document = material.document;
      format = documentRow.document_format;
    }
    if (!documentRow) {
      assert(declaredMaterial?.state === "unavailable_legacy_material",
        "VERIFIER_MATERIAL_STATE_MISMATCH",
        "Legacy outcome material must remain unavailable until independently reconstructed.", {
          intake_position: position
        });
    }
    if (outcome.outcome_type === "conflict") {
      const row = conflictByPosition.get(position);
      assert(row && row.conflict_id === outcome.outcome_id,
        "VERIFIER_CONFLICT_MATERIAL_MISSING", "Committed conflict row is missing.");
      if (!document) {
        document = { intake_position: position, received_observation_id: row.received_observation_id,
          received_envelope_digest: row.received_envelope_digest, conflict_types: row.conflict_types,
          accepted_receipt_ids: row.accepted_receipt_ids, detected_at: iso(row.detected_at) };
        format = "alphonse.observation-conflict.v0.1";
        assert(sha256Digest(document) === outcome.outcome_digest
          && row.conflict_digest === outcome.outcome_digest,
        "VERIFIER_CONFLICT_INTEGRITY_VIOLATION", "Legacy conflict does not reconstruct exactly.");
      }
      const received = format.endsWith("v0.2") ? document.received_observation
        : { observation_id: document.received_observation_id, envelope_digest: document.received_envelope_digest };
      for (const receiptId of document.accepted_receipt_ids) {
        assert(acceptedReceiptPositions.has(receiptId)
          && BigInt(acceptedReceiptPositions.get(receiptId)) < BigInt(position),
        "VERIFIER_CONFLICT_INTEGRITY_VIOLATION", "Conflict references non-earlier accepted material.");
      }
      conflicts.push({ conflict_id: row.conflict_id, intake_position: position,
        conflict_digest: outcome.outcome_digest, document_format: format,
        received_observation_id: received.observation_id,
        received_envelope_digest: received.envelope_digest,
        conflict_types: document.conflict_types, accepted_receipt_ids: document.accepted_receipt_ids });
      materialAvailability.push({ intake_position: position, outcome_type: "conflict",
        outcome_id: outcome.outcome_id, outcome_digest: outcome.outcome_digest,
        material_state: documentRow?.material_origin === "native_v0.2"
          ? "exact_material" : "verified_legacy_reconstruction",
        verification: documentRow ? "canonical_outcome_document_verified" : "legacy_digest_reconstruction_verified" });
    } else {
      const row = rejectionByPosition.get(position);
      assert(row && row.rejection_id === outcome.outcome_id,
        "VERIFIER_REJECTION_MATERIAL_MISSING", "Committed rejection row is missing.");
      if (!document) {
        const base = { rejection_id: row.rejection_id, intake_position: position,
          authenticated_principal_id: row.authenticated_principal_id ?? null,
          authenticated_grant_id: row.authenticated_grant_id ?? null, body_digest: row.body_digest,
          body_size_bytes: Number(row.body_size_bytes), reason_code: row.reason_code,
          received_at: iso(row.received_at) };
        const candidates = [{ ...base, claimed_schema: null }];
        if (row.claimed_schema_id && row.claimed_schema_version && row.claimed_schema_digest) {
          candidates.push({ ...base, claimed_schema: { schema_id: row.claimed_schema_id,
            schema_version: row.claimed_schema_version, schema_digest: row.claimed_schema_digest } });
        }
        const matching = candidates.filter((candidate) => sha256Digest(candidate) === outcome.outcome_digest);
        assert(matching.length === 1, "VERIFIER_UNVERIFIABLE_MATERIAL",
          "Historical rejection cannot be reconstructed exactly.", { intake_position: position });
        [document] = matching;
        format = "alphonse.observation-rejection.v0.1";
      }
      const native = format.endsWith("v0.2");
      rejections.push({ rejection_id: row.rejection_id, intake_position: position,
        rejection_digest: outcome.outcome_digest, document_format: format,
        authentication_status: native ? document.authentication.status
          : document.authenticated_principal_id ? "verified" : "unverified",
        claimed_schema_status: native ? document.claimed_schema.status
          : document.claimed_schema === null ? "absent_or_digest_verified_null" : "valid_tuple",
        body_digest: document.body_digest, body_size_bytes: Number(document.body_size_bytes),
        reason_code: document.reason_code });
      materialAvailability.push({ intake_position: position, outcome_type: "rejected",
        outcome_id: outcome.outcome_id, outcome_digest: outcome.outcome_digest,
        material_state: documentRow?.material_origin === "native_v0.2"
          ? "exact_material" : "verified_legacy_reconstruction",
        verification: documentRow ? "canonical_outcome_document_verified" : "legacy_digest_reconstruction_verified" });
    }
  }
  return { conflicts, rejections, materialAvailability };
}

function buildClaim({ claimType, productionMethod, proposition, evidenceReferences, verificationResults,
  assertedSupport, effectiveSupport, evidenceStatus, temporalScope, limitations = [], authorityDecision }) {
  const references = [...evidenceReferences].sort(compareCanonical);
  const document = { schema_version: CLAIM_SCHEMA,
    claim_id: deterministicUuid({ namespace: "diagnostic-claim", claim_type: claimType,
      proposition, evidence_references: references }), claim_type: claimType, processing_profile: "D0",
    production_method: productionMethod, proposition, evidence_references: references,
    verification_results: [...verificationResults].sort(), asserted_support: assertedSupport,
    effective_support: effectiveSupport, evidence_status: evidenceStatus, temporal_scope: temporalScope,
    limitations: [...limitations].sort(), supersedes_claim_id: null, authority_decision: authorityDecision };
  return { document, claim_digest: sha256Digest(document) };
}

function buildClaims({ correlation, effect, evaluation, trigger, caseId, assessedAt }) {
  const commonTemporal = { valid_at: null, observed_at: null, accepted_at: null,
    assessed_at: assessedAt, freshness: "frozen_historical", expires_at: null };
  const claims = correlation.semantic_projection.graph.nodes.filter((node) => node.receipt_reference)
    .map((node) => buildClaim({ claimType: "authenticated_observation", productionMethod: "observed",
      proposition: { subject_type: node.node_type, subject_id: node.claimed_identity,
        predicate: "authenticated_observation_preserved", value: "observer_specific_grant_attribution" },
      evidenceReferences: [{ record_type: "diagnostic_observation_receipt",
        record_id: node.receipt_reference.receipt_id, record_digest: node.receipt_reference.receipt_digest }],
      verificationResults: ["source_identity_verified", "source_bytes_verified", "process_compliance_verified"],
      assertedSupport: "AUTHENTICATED_OBSERVATION", effectiveSupport: "AUTHENTICATED_OBSERVATION",
      evidenceStatus: "complete", temporalScope: commonTemporal,
      limitations: ["exclusive_authorship_not_established", "external_truth_not_established"],
      authorityDecision: { authority: "none", permitted_consequence: "none", decision_basis: "no_authority" } }));
  for (const item of effect.semantic_projection.effects.filter((entry) => entry.status === "committed")) {
    claims.push(buildClaim({ claimType: "committed_effect_interpretation",
      productionMethod: "deterministically_derived",
      proposition: { subject_type: "diagnostic_effect", subject_id: item.effect_id,
        predicate: "contract_interpreted_status", value: "committed" },
      evidenceReferences: [{ record_type: "diagnostic_effect_projection",
        record_id: effect.effect_projection_id, record_digest: effect.semantic_digest },
      ...item.supporting_receipts.map((receipt) => ({ record_type: "diagnostic_observation_receipt",
        record_id: receipt.receipt_id, record_digest: receipt.receipt_digest }))],
      verificationResults: ["deterministically_recomputed", "evidence_references_verified"],
      assertedSupport: "DETERMINISTICALLY_ESTABLISHED", effectiveSupport: "DETERMINISTICALLY_ESTABLISHED",
      evidenceStatus: "complete", temporalScope: { ...commonTemporal, valid_at: item.committed_at },
      limitations: item.limitations,
      authorityDecision: { authority: "none", permitted_consequence: "none", decision_basis: "no_authority" } }));
  }
  claims.push(buildClaim({ claimType: "behavior_invariant_evaluation",
    productionMethod: "deterministically_derived",
    proposition: { subject_type: "behavior_contract",
      subject_id: evaluation.semantic_evaluation.dependencies.behavior_contract_digest,
      predicate: "evaluation_result", value: evaluation.semantic_evaluation.result },
    evidenceReferences: [{ record_type: "behavior_evaluation", record_id: evaluation.evaluation_id,
      record_digest: evaluation.semantic_digest }],
    verificationResults: ["deterministically_recomputed", "evidence_references_verified"],
    assertedSupport: "DETERMINISTICALLY_ESTABLISHED", effectiveSupport: "DETERMINISTICALLY_ESTABLISHED",
    evidenceStatus: "complete", temporalScope: commonTemporal,
    authorityDecision: { authority: "diagnostic", permitted_consequence: "case_creation",
      decision_basis: "closed_deterministic_policy" } }));
  claims.push(buildClaim({ claimType: "unresolved_conclusion", productionMethod: "deterministically_derived",
    proposition: { subject_type: "diagnostic_case", subject_id: caseId,
      predicate: "root_cause", value: null },
    evidenceReferences: [{ record_type: "diagnostic_trigger", record_id: trigger.trigger_id,
      record_digest: trigger.trigger_digest }], verificationResults: ["evidence_references_verified"],
    assertedSupport: "NOT_ESTABLISHED", effectiveSupport: "NOT_ESTABLISHED", evidenceStatus: "partial",
    temporalScope: commonTemporal,
    limitations: ["causal_mechanism_not_evaluated", "responsible_implementation_location_not_established"],
    authorityDecision: { authority: "none", permitted_consequence: "none", decision_basis: "no_authority" } }));
  return claims;
}

function manifestDigest(claims) {
  return sha256Digest(claims.map((claim) => ({ claim_id: claim.document.claim_id,
    claim_type: claim.document.claim_type, claim_digest: claim.claim_digest })).sort(compareCanonical));
}

function packageReference(referenceType, referenceId, referenceDigest, artifactDigest = null) {
  return { reference_type: referenceType, reference_id: referenceId,
    reference_digest: referenceDigest, artifact_digest: artifactDigest };
}

function uniqueCollectionReferences(references) {
  const byIdentity = new Map();
  for (const reference of references) {
    const key = `${reference.reference_type}\u0000${reference.reference_id}`;
    const existing = byIdentity.get(key);
    assert(!existing || (existing.reference_digest === reference.reference_digest
      && existing.artifact_digest === reference.artifact_digest),
    "VERIFIER_COLLECTION_REFERENCE_CONFLICT",
    "One collection reference identity resolves to different immutable material.", { reference });
    if (!existing) byIdentity.set(key, reference);
  }
  return [...byIdentity.values()];
}

function calculateRetentionRequirements(policy) {
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const pre = sum(policy.pretrigger_stage_intervals.flatMap((entry) =>
    [entry.max_scheduling_delay_seconds, entry.max_retry_delay_seconds]));
  const post = sum(policy.post_trigger_stage_intervals.flatMap((entry) =>
    [entry.max_scheduling_delay_seconds, entry.max_retry_delay_seconds]));
  return { pretrigger_observation_horizon_seconds: policy.pretrigger_observation_horizon_seconds,
    pretrigger_pipeline_retry_horizon_seconds: pre,
    ordinary_retention_min_seconds: policy.pretrigger_observation_horizon_seconds + pre + policy.gc_margin_seconds,
    collection_window_seconds: policy.collection_window_seconds,
    post_trigger_retry_horizon_seconds: post,
    collection_lease_min_seconds: policy.collection_window_seconds + post + policy.gc_margin_seconds };
}

function addSeconds(value, seconds) {
  return new Date(Date.parse(value) + seconds * 1000).toISOString();
}

function compareStage(report, stage, recomputed, published, details = {}) {
  const matches = recomputed === published;
  report.stages.push({ stage, recomputed_digest: recomputed, published_digest: published, matches, ...details });
  assert(matches, "VERIFIER_PUBLISHED_OUTPUT_MISMATCH", `Published ${stage} does not match recomputation.`, {
    stage, recomputed_digest: recomputed, published_digest: published
  });
}

export function verifyIndependentDiagnosticBundle(input, verifierIdentity = {}) {
  const bundle = input?.bundle ?? input;
  const claimedBundleDigest = input?.bundle_digest ?? sha256Digest(bundle);
  assert(bundle?.schema_version === BUNDLE_SCHEMA && sha256Digest(bundle) === claimedBundleDigest,
    "VERIFIER_BUNDLE_INTEGRITY_VIOLATION", "Verification bundle digest or schema does not verify.");
  const published = bundle.published_outputs_to_compare;
  const report = {
    schema_version: "alphonse.independent-diagnostic-verification-report.v0.1",
    processing_profile: "D0",
    support: "DETERMINISTICALLY_RECOMPUTED",
    freshness: "frozen_historical",
    evidence_status: "complete",
    authority: "none",
    bundle_digest: claimedBundleDigest,
    evidence_package_id: bundle.target.evidence_package_id,
    committed_intake_cutoff: bundle.target.committed_intake_cutoff,
    verifier: verifierIdentity,
    cryptographic_assurance: {
      acceptance_receipt_integrity: "verified",
      observer_hmac_signature: "accepted_by_diagnostic_plane_not_independently_reverified",
      symmetric_grant_signature: "not_independently_reverified",
      tokenization_result_signature: "independently_verified"
    },
    stages: [], limitations: ["external_truth_not_established", "hostile_host_resistance_not_claimed"],
    nonclaims: ["no_assignment_authority", "no_dispatch_authority", "no_model_contact", "no_repair_authority"],
    authority_effects_created: 0,
    production_events_emitted: 0
  };

  const registration = published.correlation_registration;
  const interpretation = published.interpretation_activation;
  const policy = published.evidence_policy_activation;
  verifyStageArchives(bundle.independent_inputs, [registration.projector_artifact_digest,
    interpretation.stage_artifact_digest, policy.stage_artifact_digest]);
  assert(sha256Digest(registration.registration_document) === registration.registration_digest
    && registration.projector_id === CORRELATION_PROJECTOR_ID
    && registration.projector_version === CORRELATION_PROJECTOR_VERSION
    && registration.projector_rules_digest === CORRELATION_RULES_DIGEST
    && registration.projector_input_schema_version === CORRELATION_PROJECTOR_INPUT_SCHEMA_VERSION
    && registration.projection_schema_version === CORRELATION_PROJECTION_SCHEMA_VERSION
    && sha256Digest(registration.projector_artifact_manifest) === registration.projector_artifact_digest,
  "VERIFIER_CORRELATION_REGISTRATION_INTEGRITY_VIOLATION",
  "Correlation registration or pinned projector identity does not verify.");
  assert(sha256Digest(interpretation.activation_document) === interpretation.activation_digest
    && sha256Digest(interpretation.integration_contract) === interpretation.integration_contract_digest
    && sha256Digest(interpretation.behavior_contract) === interpretation.behavior_contract_digest
    && sha256Digest(interpretation.evaluator_document) === interpretation.evaluator_digest
    && sha256Digest(interpretation.stage_artifact_manifest) === interpretation.stage_artifact_digest
    && interpretation.interpreter_rules_digest === DIAGNOSTIC_EFFECT_INTERPRETER_RULES_DIGEST
    && interpretation.evaluator_rules_digest === COUNT_BY_CORRELATION_RULES_DIGEST,
  "VERIFIER_INTERPRETATION_ACTIVATION_INTEGRITY_VIOLATION",
  "Interpretation activation or rules do not verify.");
  assert(sha256Digest(policy.activation_document) === policy.activation_digest
    && sha256Digest(policy.selection_policy) === policy.selection_policy_digest
    && sha256Digest(policy.retention_policy) === policy.retention_policy_digest
    && sha256Digest(policy.stage_artifact_manifest) === policy.stage_artifact_digest
    && policy.selection_rules_digest === DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST
    && same(calculateRetentionRequirements(policy.retention_policy), policy.retention_requirements),
  "VERIFIER_EVIDENCE_POLICY_INTEGRITY_VIOLATION", "Evidence policy activation does not verify.");

  const accepted = verifyAcceptedInputs(bundle);
  const outcomes = verifyOutcomeMaterial(bundle, accepted.acceptedReceiptPositions);
  report.material_availability = [...accepted.materialAvailability, ...outcomes.materialAvailability]
    .sort((left, right) => BigInt(left.intake_position) < BigInt(right.intake_position) ? -1 : 1);
  const intakeOutcomes = bundle.independent_inputs.intake_outcomes.map((row) => ({
    intake_position: String(row.intake_position), outcome_type: row.outcome_type,
    outcome_id: row.outcome_id, outcome_digest: row.outcome_digest
  }));
  const correlationInput = buildCorrelationProjectorInput({ registration,
    logicalOperationId: published.correlation_projection.logical_operation_id,
    cutoff: bundle.target.committed_intake_cutoff, intakeOutcomes,
    receiptManifest: accepted.receiptManifest, schemaManifest: accepted.schemaManifest,
    tokenizationManifest: accepted.tokenizationManifest, observations: accepted.observations,
    conflicts: outcomes.conflicts, rejections: outcomes.rejections });
  const correlation = buildCorrelationProjection(correlationInput, {
    projectorArtifactDigest: registration.projector_artifact_digest
  });
  assert(published.correlation_projection.record_document
    && sha256Digest(published.correlation_projection.record_document)
      === published.correlation_projection.record_digest
    && published.correlation_projection.projector_input_digest === correlation.projector_input_digest,
  "VERIFIER_CORRELATION_RECORD_INTEGRITY_VIOLATION", "Correlation record/input digest does not verify.");
  compareStage(report, "correlation_projection", correlation.semantic_digest,
    published.correlation_projection.semantic_digest, {
      projector_input_digest: correlation.projector_input_digest
    });
  assert(same(correlation.semantic_projection, published.correlation_projection.semantic_projection),
    "VERIFIER_PUBLISHED_OUTPUT_MISMATCH", "Published correlation bytes differ from recomputation.");

  const effectProjectionId = deterministicUuid({ namespace: "diagnostic-effect-projection",
    correlation_projection_id: published.correlation_projection.projection_id,
    activation_digest: interpretation.activation_digest });
  const effect = buildDiagnosticEffectProjection({
    correlationProjectionId: published.correlation_projection.projection_id,
    correlationSemanticDigest: correlation.semantic_digest,
    correlationProjection: correlation.semantic_projection,
    integrationActivationId: interpretation.activation_id,
    integrationContract: interpretation.integration_contract,
    integrationContractDigest: interpretation.integration_contract_digest,
    interpreterArtifactDigest: interpretation.stage_artifact_digest,
    observationEvidence: accepted.observationEvidence
  });
  assert(effectProjectionId === published.diagnostic_effect_projection.effect_projection_id
    && sha256Digest(published.diagnostic_effect_projection.record_document)
      === published.diagnostic_effect_projection.record_digest,
  "VERIFIER_EFFECT_RECORD_INTEGRITY_VIOLATION", "Diagnostic Effect Projection identity/record does not verify.");
  compareStage(report, "diagnostic_effect_projection", effect.semantic_digest,
    published.diagnostic_effect_projection.semantic_digest);
  assert(same(effect.semantic_projection, published.diagnostic_effect_projection.semantic_projection),
    "VERIFIER_PUBLISHED_OUTPUT_MISMATCH", "Published effect bytes differ from recomputation.");
  const evaluation = evaluateCountByCorrelation({ effectProjectionId,
    effectSemanticDigest: effect.semantic_digest, effectProjection: effect.semantic_projection,
    behaviorActivationId: interpretation.activation_id, behaviorContract: interpretation.behavior_contract,
    behaviorContractDigest: interpretation.behavior_contract_digest,
    evaluatorActivationId: interpretation.activation_id, evaluator: interpretation.evaluator_document,
    evaluatorDigest: interpretation.evaluator_digest,
    evaluatorArtifactDigest: interpretation.stage_artifact_digest,
    evaluatorRulesDigest: COUNT_BY_CORRELATION_RULES_DIGEST });
  assert(evaluation.evaluation_id === published.behavior_evaluation.evaluation_id
    && sha256Digest(published.behavior_evaluation.record_document) === published.behavior_evaluation.record_digest,
  "VERIFIER_EVALUATION_RECORD_INTEGRITY_VIOLATION", "Behavior Evaluation identity/record does not verify.");
  compareStage(report, "behavior_evaluation", evaluation.semantic_digest,
    published.behavior_evaluation.semantic_digest);
  assert(same(evaluation.semantic_evaluation, published.behavior_evaluation.semantic_evaluation),
    "VERIFIER_PUBLISHED_OUTPUT_MISMATCH", "Published evaluation bytes differ from recomputation.");

  const createdAt = iso(published.diagnostic_trigger.created_at);
  const triggerId = deterministicUuid({ namespace: "diagnostic-trigger",
    behavior_contract_digest: interpretation.behavior_contract_digest,
    logical_operation_id: correlation.semantic_projection.scope.logical_operation_id,
    evaluation_semantic_digest: evaluation.semantic_digest });
  const caseId = deterministicUuid({ namespace: "diagnostic-case", trigger_id: triggerId });
  const triggerDocument = { schema_version: TRIGGER_SCHEMA, trigger_id: triggerId, case_id: caseId,
    evaluation_id: evaluation.evaluation_id, evaluation_semantic_digest: evaluation.semantic_digest,
    behavior_contract_digest: interpretation.behavior_contract_digest,
    logical_operation_id: correlation.semantic_projection.scope.logical_operation_id,
    trigger_basis: "deterministically_violated_behavior_contract", root_cause_established: false,
    repair_authority_granted: false, kernel_effect_authority_granted: false,
    evidence_policy_activation_id: policy.evidence_policy_activation_id,
    evidence_policy_activation_digest: policy.activation_digest, evidence_collection_required: true,
    created_at: createdAt };
  const triggerDigest = sha256Digest(triggerDocument);
  assert(triggerId === published.diagnostic_trigger.trigger_id
    && same(triggerDocument, published.diagnostic_trigger.trigger_document)
    && triggerDigest === published.diagnostic_trigger.trigger_digest,
  "VERIFIER_TRIGGER_MISMATCH", "Deterministic trigger does not match recomputation.");
  compareStage(report, "diagnostic_trigger", triggerDigest, published.diagnostic_trigger.trigger_digest);
  const trigger = { ...triggerDocument, trigger_digest: triggerDigest };
  const claimMaterials = buildClaims({ correlation: { ...correlation,
    projection_id: published.correlation_projection.projection_id }, effect: { ...effect, effect_projection_id: effectProjectionId },
  evaluation, trigger, caseId, assessedAt: createdAt });
  const caseDocument = { schema_version: CASE_SCHEMA, case_id: caseId, trigger_id: triggerId,
    trigger_digest: triggerDigest, state: "open", scope: structuredClone(correlation.semantic_projection.scope),
    opening_basis: { evaluation_id: evaluation.evaluation_id,
      evaluation_semantic_digest: evaluation.semantic_digest, result: "violated" },
    claim_manifest_digest: manifestDigest(claimMaterials),
    evidence_policy_activation_id: policy.evidence_policy_activation_id,
    evidence_policy_activation_digest: policy.activation_digest, evidence_collection_required: true,
    root_cause_status: "NOT_ESTABLISHED",
    authority: { diagnosis: "not_granted", repair: "not_granted", kernel_effect: "not_granted" } };
  const caseDigest = sha256Digest(caseDocument);
  assert(caseId === published.diagnostic_case.case_id && same(caseDocument, published.diagnostic_case.case_document)
    && caseDigest === published.diagnostic_case.case_digest,
  "VERIFIER_CASE_MISMATCH", "Deterministic case does not match recomputation.");
  compareStage(report, "diagnostic_case", caseDigest, published.diagnostic_case.case_digest);
  const recomputedClaims = claimMaterials.map((claim) => ({ claim_id: claim.document.claim_id,
    claim_type: claim.document.claim_type, claim_document: claim.document, claim_digest: claim.claim_digest }))
    .sort(compareCanonical);
  const publishedClaims = published.diagnostic_claims.map((claim) => ({ claim_id: claim.claim_id,
    claim_type: claim.claim_type, claim_document: claim.claim_document, claim_digest: claim.claim_digest }))
    .sort(compareCanonical);
  assert(same(recomputedClaims, publishedClaims), "VERIFIER_CLAIM_MANIFEST_MISMATCH",
    "D0 Claim Envelopes do not match recomputation.");
  compareStage(report, "diagnostic_claim_manifest", sha256Digest(recomputedClaims),
    sha256Digest(publishedClaims));

  const selection = selectDiagnosticEvidence({ correlationProjection: correlation.semantic_projection,
    effectProjection: effect.semantic_projection, behaviorEvaluation: evaluation.semantic_evaluation,
    observationEvidence: accepted.observationEvidence, selectionPolicy: policy.selection_policy });
  const lease = published.evidence_collection_lease;
  const initialReferences = [
    packageReference("correlation_projection", published.correlation_projection.projection_id, correlation.semantic_digest),
    packageReference("diagnostic_interpretation_activation", interpretation.activation_id, interpretation.activation_digest),
    packageReference("evidence_policy_activation", policy.evidence_policy_activation_id, policy.activation_digest),
    packageReference("diagnostic_effect_projection", effectProjectionId, effect.semantic_digest),
    packageReference("behavior_evaluation", evaluation.evaluation_id, evaluation.semantic_digest),
    packageReference("diagnostic_trigger", triggerId, triggerDigest),
    packageReference("diagnostic_case", caseId, caseDigest),
    ...claimMaterials.map((claim) => packageReference("diagnostic_claim_envelope",
      claim.document.claim_id, claim.claim_digest))
  ].sort(compareCanonical);
  const leaseId = deterministicUuid({ namespace: "diagnostic-evidence-collection-lease",
    trigger_id: triggerId, evidence_policy_activation_digest: policy.activation_digest });
  const leaseDocument = { schema_version: LEASE_SCHEMA, lease_id: leaseId,
    installation_id: bundle.target.installation_id, environment_id: bundle.target.environment_id,
    case_id: caseId, trigger_id: triggerId, trigger_digest: triggerDigest,
    evidence_policy_activation_id: policy.evidence_policy_activation_id,
    evidence_policy_activation_digest: policy.activation_digest,
    retention_policy_digest: policy.retention_policy_digest,
    retention_requirements: calculateRetentionRequirements(policy.retention_policy),
    initial_reference_manifest_digest: sha256Digest(initialReferences),
    collection_deadline: addSeconds(createdAt, policy.retention_policy.collection_window_seconds),
    lease_expires_at: addSeconds(createdAt, policy.retention_policy.collection_lease_seconds),
    created_at: createdAt };
  const leaseDigest = sha256Digest(leaseDocument);
  assert(leaseId === lease.lease_id && leaseDigest === lease.lease_digest
    && same(leaseDocument, lease.lease_document), "VERIFIER_COLLECTION_LEASE_MISMATCH",
  "Evidence Collection Retention Lease does not match recomputation.");
  compareStage(report, "evidence_collection_lease", leaseDigest, lease.lease_digest);

  const packageRow = published.evidence_package;
  const governedDependencies = [
    { dependency_type: "correlation_registration",
      dependency_id: correlation.semantic_projection.dependencies.correlation_registration_id,
      dependency_digest: correlation.semantic_projection.dependencies.correlation_registration_digest },
    { dependency_type: "correlation_projector_artifact",
      dependency_id: correlation.semantic_projection.dependencies.projector.projector_id,
      dependency_digest: correlation.semantic_projection.dependencies.projector.artifact_digest },
    { dependency_type: "correlation_projector_rules",
      dependency_id: correlation.semantic_projection.dependencies.projector.projector_version,
      dependency_digest: correlation.semantic_projection.dependencies.projector.rules_digest },
    { dependency_type: "diagnostic_interpretation_activation", dependency_id: interpretation.activation_id,
      dependency_digest: interpretation.activation_digest },
    ...Object.values(interpretation.activation_document.exports).map((entry) => ({
      dependency_type: entry.kind, dependency_id: entry.export_id, dependency_digest: entry.export_digest })),
    { dependency_type: "evidence_policy_activation", dependency_id: policy.evidence_policy_activation_id,
      dependency_digest: policy.activation_digest },
    { dependency_type: "evidence_selection_policy", dependency_id: policy.selection_export_id,
      dependency_digest: policy.selection_policy_digest },
    { dependency_type: "diagnostic_retention_policy", dependency_id: policy.retention_export_id,
      dependency_digest: policy.retention_policy_digest },
    { dependency_type: "effect_interpreter_artifact",
      dependency_id: effect.semantic_projection.dependencies.interpreter.interpreter_id,
      dependency_digest: effect.semantic_projection.dependencies.interpreter.artifact_digest },
    { dependency_type: "effect_interpreter_rules",
      dependency_id: effect.semantic_projection.dependencies.interpreter.interpreter_version,
      dependency_digest: effect.semantic_projection.dependencies.interpreter.rules_digest },
    { dependency_type: "behavior_evaluator_artifact",
      dependency_id: evaluation.semantic_evaluation.evaluator.evaluator_id,
      dependency_digest: evaluation.semantic_evaluation.dependencies.evaluator_artifact_digest },
    { dependency_type: "behavior_evaluator_rules",
      dependency_id: evaluation.semantic_evaluation.evaluator.evaluator_version,
      dependency_digest: evaluation.semantic_evaluation.dependencies.evaluator_rules_digest }
  ].sort(compareCanonical);
  const deterministicFacts = [
    { fact_type: "correlation_projection", record_id: published.correlation_projection.projection_id,
      record_digest: correlation.semantic_digest, result: "exact_typed_correlation_graph" },
    { fact_type: "diagnostic_effect_projection", record_id: effectProjectionId,
      record_digest: effect.semantic_digest, result: "contract_interpreted_effects" },
    { fact_type: "behavior_evaluation", record_id: evaluation.evaluation_id,
      record_digest: evaluation.semantic_digest, result: evaluation.semantic_evaluation.result },
    { fact_type: "diagnostic_trigger", record_id: triggerId, record_digest: triggerDigest,
      result: "deterministic_case_creation" },
    { fact_type: "diagnostic_case", record_id: caseId, record_digest: caseDigest,
      result: "open_root_cause_not_established" },
    ...claimMaterials.map((claim) => ({ fact_type: "diagnostic_claim_envelope",
      record_id: claim.document.claim_id, record_digest: claim.claim_digest,
      result: claim.document.effective_support }))
  ].sort(compareCanonical);
  const semanticPackage = { schema_version: PACKAGE_SCHEMA, case_id: caseId, trigger_id: triggerId,
    evidence_policy_activation_id: policy.evidence_policy_activation_id, revision_number: "1",
    scope: structuredClone(correlation.semantic_projection.scope),
    freeze: { reason: packageRow.freeze_reason,
      committed_intake_cutoff: bundle.target.committed_intake_cutoff,
      collection_deadline: leaseDocument.collection_deadline,
      required_sources_complete: selection.required_sources_complete },
    manifest: { governed_interpretation_dependencies: governedDependencies,
      authenticated_observations: { observations: selection.selected_observations,
        authenticated_provenance_dependencies: selection.authenticated_provenance_dependencies },
      deterministic_derived_facts: deterministicFacts,
      coverage_and_limitations: selection.coverage_and_limitations,
      disclosure_accounting: selection.disclosure_accounting,
      role_completion: selection.role_completion },
    selected_graph: { nodes: selection.selected_nodes, edges: selection.selected_edges },
    authority: { assignment_created: false, dispatch_authorized: false, worker_run_created: false,
      model_request_created: false, diagnosis_established: false, repair_authorized: false,
      kernel_effect_authorized: false },
    packager: { component: PACKAGE_AUTHOR, artifact_digest: policy.stage_artifact_digest,
      rules_digest: DIAGNOSTIC_EVIDENCE_SELECTION_RULES_DIGEST, model_selected_evidence: false } };
  const packageDigest = sha256Digest(semanticPackage);
  const evidencePackageId = deterministicUuid({ namespace: "diagnostic-evidence-package",
    case_id: caseId, semantic_digest: packageDigest });
  assert(evidencePackageId === bundle.target.evidence_package_id
    && evidencePackageId === packageRow.evidence_package_id
    && same(semanticPackage, packageRow.semantic_package), "VERIFIER_EVIDENCE_PACKAGE_MISMATCH",
  "Frozen evidence package does not match independent selection and lineage recomputation.");
  compareStage(report, "evidence_package", packageDigest, packageRow.semantic_digest, {
    recomputed_id: evidencePackageId, published_id: packageRow.evidence_package_id
  });
  const packageArtifact = { schema_version: PACKAGE_ARTIFACT_SCHEMA,
    evidence_package_id: evidencePackageId, semantic_digest: packageDigest, semantic_package: semanticPackage };
  const packageArtifactDigest = sha256Digest(packageArtifact);
  assert(same(packageArtifact, published.evidence_package_artifact)
    && packageArtifactDigest === packageRow.package_artifact_digest,
  "VERIFIER_PACKAGE_ARTIFACT_MISMATCH", "Content-addressed package wrapper does not verify.");
  compareStage(report, "evidence_package_artifact", packageArtifactDigest, packageRow.package_artifact_digest);
  const packageRecord = { schema_version: PACKAGE_RECORD_SCHEMA, evidence_package_id: evidencePackageId,
    case_id: caseId, revision_number: "1", semantic_digest: packageDigest,
    package_artifact_digest: packageArtifactDigest, frozen_by: PACKAGE_AUTHOR,
    frozen_at: iso(packageRow.frozen_at) };
  assert(same(packageRecord, packageRow.record_document)
    && sha256Digest(packageRecord) === packageRow.record_digest,
  "VERIFIER_PACKAGE_RECORD_MISMATCH", "Evidence package record document does not verify.");

  const extensionReferences = [
    ...selection.selected_observations.map((entry) => packageReference(
      "diagnostic_observation_receipt", entry.receipt_id, entry.receipt_digest)),
    ...selection.authenticated_provenance_dependencies.flatMap((entry) => [
      packageReference("tokenization_result_receipt", entry.result_receipt_id, entry.receipt_digest),
      packageReference("tokenization_grant_snapshot", entry.grant_snapshot_digest, entry.grant_snapshot_digest),
      packageReference("tokenization_grant_application_receipt", entry.grant_application_receipt_digest,
        entry.grant_application_receipt_digest)
    ]),
    packageReference("correlation_coverage", published.correlation_projection.projection_id,
      sha256Digest(selection.coverage_and_limitations)),
    packageReference("evidence_selection", evidencePackageId, sha256Digest(selection))
  ];
  const allReferences = uniqueCollectionReferences([
    ...initialReferences.map((entry) => ({ ...entry, reference_stage: "trigger_input" })),
    ...extensionReferences.map((entry) => ({ ...entry, reference_stage: "collection_extension" }))]
  ).sort((left, right) => left.reference_type < right.reference_type ? -1
      : left.reference_type > right.reference_type ? 1
        : left.reference_id < right.reference_id ? -1 : left.reference_id > right.reference_id ? 1 : 0);
  const publishedReferenceMaterial = published.evidence_collection_references.map((entry) => ({
    reference_type: entry.reference_type, reference_id: entry.reference_id,
    reference_digest: entry.reference_digest, artifact_digest: entry.artifact_digest ?? null,
    reference_stage: entry.reference_stage
  }));
  assert(same(allReferences, publishedReferenceMaterial), "VERIFIER_COLLECTION_REFERENCE_MISMATCH",
    "Evidence collection reference set does not match recomputation.", {
      recomputed_references: allReferences,
      published_references: publishedReferenceMaterial
    });
  const releaseReferenceMaterial = allReferences.map(({ reference_stage, ...entry }) => entry)
    .sort(compareCanonical);
  const pinMaterials = [packageReference("diagnostic_evidence_package", evidencePackageId,
    packageDigest, packageArtifactDigest), ...releaseReferenceMaterial].sort(compareCanonical);
  const pinExpiry = addSeconds(iso(packageRow.frozen_at), policy.retention_policy.package_pin_seconds);
  const expectedPins = pinMaterials.map((pin) => ({
    pin_id: deterministicUuid({ namespace: "diagnostic-artifact-retention-pin",
      evidence_package_id: evidencePackageId, object_type: pin.reference_type,
      object_id: pin.reference_id, object_digest: pin.reference_digest }),
    object_type: pin.reference_type, object_id: pin.reference_id,
    object_digest: pin.reference_digest, artifact_digest: pin.artifact_digest,
    retention_policy_digest: policy.retention_policy_digest, expires_at: pinExpiry
  })).sort(compareCanonical);
  const publishedPins = published.retention_pins.map((pin) => ({ pin_id: pin.pin_id,
    object_type: pin.object_type, object_id: pin.object_id, object_digest: pin.object_digest,
    artifact_digest: pin.artifact_digest ?? null, retention_policy_digest: pin.retention_policy_digest,
    expires_at: iso(pin.expires_at) })).sort(compareCanonical);
  assert(same(expectedPins, publishedPins), "VERIFIER_RETENTION_PIN_MISMATCH",
    "Replacement retention pins do not match recomputation.");
  compareStage(report, "retention_pin_manifest", sha256Digest(pinMaterials),
    published.evidence_collection_release.release_document.retention_pin_manifest_digest);
  const releaseDocument = { schema_version: RELEASE_SCHEMA, lease_id: leaseId,
    lease_digest: leaseDigest, evidence_package_id: evidencePackageId,
    evidence_package_semantic_digest: packageDigest, package_artifact_digest: packageArtifactDigest,
    reference_manifest_digest: sha256Digest(releaseReferenceMaterial),
    retention_pin_manifest_digest: sha256Digest(pinMaterials), released_at: iso(packageRow.frozen_at) };
  assert(same(releaseDocument, published.evidence_collection_release.release_document)
    && sha256Digest(releaseDocument) === published.evidence_collection_release.release_digest,
  "VERIFIER_COLLECTION_RELEASE_MISMATCH", "Collection release does not match package and pin recomputation.");
  compareStage(report, "evidence_collection_release", sha256Digest(releaseDocument),
    published.evidence_collection_release.release_digest);
  const jobId = deterministicUuid({ namespace: "diagnostic-evidence-collection-job", lease_id: leaseId });
  assert(published.evidence_collection_job.job_id === jobId
    && published.evidence_collection_job.lease_id === leaseId
    && published.evidence_collection_job.status === "frozen",
  "VERIFIER_COLLECTION_JOB_MISMATCH", "Collection scheduler identity or final state does not verify.");
  report.result = "verified";
  report.report_digest = sha256Digest(report);
  return report;
}
