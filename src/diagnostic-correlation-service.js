import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  buildCorrelationProjection,
  CORRELATION_PROJECTOR_ARTIFACT_DIGEST,
  CORRELATION_PROJECTOR_ID,
  CORRELATION_PROJECTOR_VERSION,
  CORRELATION_RULES,
  CORRELATION_RULES_DIGEST
} from "./correlation-projector.js";
import { KernelError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "CORRELATION_INPUT_INVALID", `${label} must be an object.`);
  }
  return value;
}

function exactFields(value, fields, label) {
  object(value, label);
  const expected = new Set(fields);
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  const unexpected = Object.keys(value).filter((field) => !expected.has(field));
  if (missing.length || unexpected.length) {
    throw new KernelError(400, "CORRELATION_INPUT_INVALID", `${label} has invalid fields.`, {
      missing,
      unexpected
    });
  }
  return value;
}

function uuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new KernelError(400, "CORRELATION_INPUT_INVALID", `${label} must be a UUID.`);
  }
  return value;
}

function identifier(value, label, maximum = 200) {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new KernelError(400, "CORRELATION_INPUT_INVALID", `${label} must be bounded text.`);
  }
  return value;
}

function registrationInput(value) {
  const input = exactFields(value, [
    "registration_id",
    "deployment_id",
    "workflow_id",
    "revision_id",
    "integration_id"
  ], "correlation registration");
  return {
    registration_id: uuid(input.registration_id, "registration_id"),
    deployment_id: uuid(input.deployment_id, "deployment_id"),
    workflow_id: identifier(input.workflow_id, "workflow_id", 160),
    revision_id: uuid(input.revision_id, "revision_id"),
    integration_id: identifier(input.integration_id, "integration_id", 160)
  };
}

function projectionInput(value) {
  const input = exactFields(value, ["registration_id", "logical_operation_id"], "correlation projection");
  return {
    registration_id: uuid(input.registration_id, "registration_id"),
    logical_operation_id: identifier(input.logical_operation_id, "logical_operation_id", 200)
  };
}

function contractDocument(input) {
  return {
    schema_version: "alphonse.correlation-contract.v0.1",
    workflow_id: input.workflow_id,
    revision_id: input.revision_id,
    integration_id: input.integration_id,
    required_observation_types: [...CORRELATION_RULES.accepted_observation_types],
    permitted_relationship_bases: [...CORRELATION_RULES.relationship_bases],
    forbidden_relationship_bases: [...CORRELATION_RULES.forbidden_bases],
    unresolved_policy: CORRELATION_RULES.unresolved_policy
  };
}

function registrationView(row) {
  return {
    registration_id: row.registration_id,
    installation_id: row.installation_id,
    environment_id: row.environment_id,
    deployment_id: row.deployment_id,
    package_version_id: row.package_version_id,
    package_artifact_digest: row.package_artifact_digest,
    package_manifest_digest: row.package_manifest_digest,
    package_dependency_digest: row.package_dependency_digest,
    workflow_id: row.workflow_id,
    revision_id: row.revision_id,
    revision_snapshot_digest: row.revision_snapshot_digest,
    integration_id: row.integration_id,
    contract_document: row.contract_document,
    contract_digest: row.contract_digest,
    contract_dependency_digests: row.contract_dependency_digests,
    projector: {
      projector_id: row.projector_id,
      projector_version: row.projector_version,
      artifact_digest: row.projector_artifact_digest,
      rules_digest: row.projector_rules_digest
    },
    registration_digest: row.registration_digest,
    registered_by: row.registered_by,
    registered_at: new Date(row.registered_at).toISOString(),
    immutable: true,
    authority_granted: false
  };
}

function verifyRegistrationRow(row) {
  const document = row.registration_document;
  if (sha256Digest(document) !== row.registration_digest
      || document.installation_id !== row.installation_id
      || document.environment_id !== row.environment_id
      || document.deployment_id !== row.deployment_id
      || document.package_version_id !== row.package_version_id
      || document.package_artifact_digest !== row.package_artifact_digest
      || document.package_manifest_digest !== row.package_manifest_digest
      || document.package_dependency_digest !== row.package_dependency_digest
      || document.workflow_id !== row.workflow_id
      || document.revision_id !== row.revision_id
      || document.revision_snapshot_digest !== row.revision_snapshot_digest
      || document.integration_id !== row.integration_id
      || canonicalize(document.contract_document) !== canonicalize(row.contract_document)
      || document.contract_digest !== row.contract_digest
      || canonicalize(document.contract_dependency_digests) !== canonicalize(row.contract_dependency_digests)
      || document.projector?.projector_id !== row.projector_id
      || document.projector?.projector_version !== row.projector_version
      || document.projector?.artifact_digest !== row.projector_artifact_digest
      || document.projector?.rules_digest !== row.projector_rules_digest) {
    throw new KernelError(500, "CORRELATION_REGISTRATION_INTEGRITY_VIOLATION",
      "Stored Correlation Registration does not match its immutable digest.");
  }
  return row;
}

function projectionView(row) {
  if (sha256Digest(row.semantic_projection) !== row.semantic_digest
      || sha256Digest(row.record_document) !== row.record_digest
      || row.record_document.projection_id !== row.projection_id
      || row.record_document.registration_id !== row.registration_id
      || row.record_document.logical_operation_id !== row.logical_operation_id
      || row.record_document.committed_intake_cutoff !== String(row.committed_intake_cutoff)
      || row.record_document.revision_number !== String(row.revision_number)
      || row.record_document.semantic_digest !== row.semantic_digest
      || row.record_document.requested_by !== row.requested_by
      || row.record_document.created_at !== new Date(row.created_at).toISOString()) {
    throw new KernelError(500, "CORRELATION_PROJECTION_INTEGRITY_VIOLATION",
      "Stored Correlation Projection does not match its immutable digests.");
  }
  return {
    projection_id: row.projection_id,
    registration_id: row.registration_id,
    logical_operation_id: row.logical_operation_id,
    committed_intake_cutoff: String(row.committed_intake_cutoff),
    revision_number: String(row.revision_number),
    semantic_projection: row.semantic_projection,
    semantic_digest: row.semantic_digest,
    record_digest: row.record_digest,
    requested_by: row.requested_by,
    created_at: new Date(row.created_at).toISOString(),
    immutable: true,
    diagnostic_authority: "deterministic_projection_only"
  };
}

function ensureCompletePrefix(rows, cutoff) {
  let expected = 1n;
  for (const row of rows) {
    if (BigInt(row.intake_position) !== expected) {
      throw new KernelError(503, "DIAGNOSTIC_COMMITTED_PREFIX_INCOMPLETE",
        "Committed intake positions do not form one contiguous stable prefix.", {
          expected_position: expected.toString(),
          received_position: String(row.intake_position)
        });
    }
    expected += 1n;
  }
  if (expected !== BigInt(cutoff) + 1n) {
    throw new KernelError(503, "DIAGNOSTIC_COMMITTED_PREFIX_INCOMPLETE",
      "Committed intake prefix is missing an outcome.", {
        committed_through: String(cutoff),
        complete_through: (expected - 1n).toString()
      });
  }
}

function ensureAcceptedReceiptIntegrity(outcomeRows, observationRows) {
  const accepted = outcomeRows.filter((row) => row.outcome_type === "accepted");
  const byPosition = new Map(observationRows.map((row) => [String(row.intake_position), row]));
  if (accepted.length !== observationRows.length) {
    throw new KernelError(503, "CORRELATION_RECEIPT_SET_INCOMPLETE",
      "Accepted intake outcomes and preserved receipts do not form one exact receipt set.");
  }
  for (const outcome of accepted) {
    const row = byPosition.get(String(outcome.intake_position));
    const envelopeBytes = row ? Buffer.from(row.envelope_bytes).toString("utf8") : null;
    if (!row
        || row.receipt_id !== outcome.outcome_id
        || row.receipt_digest !== outcome.outcome_digest
        || sha256Digest(row.envelope) !== row.envelope_digest
        || envelopeBytes !== canonicalize(row.envelope)
        || sha256Digest(row.receipt) !== row.receipt_digest
        || row.receipt.receipt_id !== row.receipt_id
        || row.receipt.intake_position !== String(row.intake_position)
        || row.receipt.envelope_digest !== row.envelope_digest
        || row.envelope.schema?.schema_id !== row.schema_id
        || row.envelope.schema?.schema_version !== row.schema_version
        || row.envelope.schema?.schema_digest !== row.schema_digest) {
      throw new KernelError(500, "CORRELATION_RECEIPT_INTEGRITY_VIOLATION",
        "Accepted receipt material does not match its committed intake outcome.", {
          intake_position: String(outcome.intake_position)
        });
    }
  }
}

function ensureOutcomeMaterialIntegrity(outcomeRows, conflicts, rejections) {
  const expectedConflicts = outcomeRows.filter((row) => row.outcome_type === "conflict");
  const expectedRejections = outcomeRows.filter((row) => row.outcome_type === "rejected");
  const conflictByPosition = new Map(conflicts.map((row) => [String(row.intake_position), row]));
  const rejectionByPosition = new Map(rejections.map((row) => [String(row.intake_position), row]));
  if (expectedConflicts.length !== conflicts.length || expectedRejections.length !== rejections.length) {
    throw new KernelError(503, "CORRELATION_INTAKE_OUTCOME_MATERIAL_INCOMPLETE",
      "Conflict or rejection material is missing from the committed prefix.");
  }
  for (const outcome of expectedConflicts) {
    const conflict = conflictByPosition.get(String(outcome.intake_position));
    if (!conflict || conflict.conflict_id !== outcome.outcome_id
        || conflict.conflict_digest !== outcome.outcome_digest) {
      throw new KernelError(500, "CORRELATION_CONFLICT_INTEGRITY_VIOLATION",
        "Conflict material does not match its committed intake outcome.");
    }
  }
  for (const outcome of expectedRejections) {
    const rejection = rejectionByPosition.get(String(outcome.intake_position));
    if (!rejection || rejection.rejection_id !== outcome.outcome_id) {
      throw new KernelError(500, "CORRELATION_REJECTION_INTEGRITY_VIOLATION",
        "Rejection material does not match its committed intake outcome.");
    }
  }
}

function dependencyView(row) {
  return {
    result_receipt_id: row.result_receipt_id,
    receipt_digest: row.receipt_digest,
    grant_snapshot_digest: row.grant_snapshot_digest,
    grant_application_receipt_digest: row.grant_application_receipt_digest,
    requester_principal_id: row.requester_principal_id,
    integration_id: row.integration_id,
    field_role: row.field_role,
    claim_field: row.claim_field,
    namespace: row.namespace,
    algorithm_version: row.algorithm_version,
    equality_token: row.equality_token
  };
}

export function createDiagnosticCorrelationService({
  database,
  installationId,
  environmentId,
  resolveDeployment
}) {
  const { pool } = database;

  async function register(value, actorId, now = new Date()) {
    const input = registrationInput(value);
    if (typeof resolveDeployment !== "function") {
      throw new KernelError(503, "CORRELATION_DEPLOYMENT_RESOLVER_UNAVAILABLE",
        "Deployed package resolution is unavailable.");
    }
    const deployed = await resolveDeployment(input.deployment_id);
    const revision = (await pool.query(
      `SELECT * FROM diagnostic_agent_revisions
       WHERE installation_id=$1 AND revision_id=$2 AND workflow_id=$3`,
      [installationId, input.revision_id, input.workflow_id]
    )).rows[0];
    if (!revision) {
      throw new KernelError(409, "CORRELATION_REVISION_SCOPE_MISMATCH",
        "Correlation Registration requires an existing exact workflow revision.");
    }
    const contract = contractDocument(input);
    const contractDigest = sha256Digest(contract);
    const dependencyDigests = [
      deployed.package_artifact_digest,
      deployed.package_manifest_digest,
      deployed.package_dependency_digest,
      revision.snapshot_digest,
      contractDigest
    ].sort();
    const document = {
      schema_version: "alphonse.correlation-registration.v0.1",
      installation_id: installationId,
      environment_id: environmentId,
      deployment_id: input.deployment_id,
      package_version_id: deployed.package_version_id,
      package_artifact_digest: deployed.package_artifact_digest,
      package_manifest_digest: deployed.package_manifest_digest,
      package_dependency_digest: deployed.package_dependency_digest,
      workflow_id: input.workflow_id,
      revision_id: input.revision_id,
      revision_snapshot_digest: revision.snapshot_digest,
      integration_id: input.integration_id,
      contract_document: contract,
      contract_digest: contractDigest,
      contract_dependency_digests: dependencyDigests,
      projector: {
        projector_id: CORRELATION_PROJECTOR_ID,
        projector_version: CORRELATION_PROJECTOR_VERSION,
        artifact_digest: CORRELATION_PROJECTOR_ARTIFACT_DIGEST,
        rules_digest: CORRELATION_RULES_DIGEST
      }
    };
    const registrationDigest = sha256Digest(document);
    const registeredAt = new Date(now).toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lockKeys = [
        `correlation-registration:${installationId}:digest:${registrationDigest}`,
        `correlation-registration:${installationId}:id:${input.registration_id}`
      ].sort();
      for (const lockKey of lockKeys) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lockKey]);
      }
      const existing = (await client.query(
        `SELECT * FROM diagnostic_correlation_registrations
         WHERE installation_id=$1 AND (registration_id=$2 OR registration_digest=$3)`,
        [installationId, input.registration_id, registrationDigest]
      )).rows[0];
      if (existing) {
        verifyRegistrationRow(existing);
        if (existing.registration_id !== input.registration_id
            || existing.registration_digest !== registrationDigest) {
          throw new KernelError(409, "CORRELATION_REGISTRATION_IDENTITY_CONFLICT",
            "Correlation Registration identity is already bound to different exact material.");
        }
        await client.query("COMMIT");
        return { replayed: true, result: { correlation_registration: registrationView(existing) } };
      }
      const row = (await client.query(
        `INSERT INTO diagnostic_correlation_registrations
          (registration_id,installation_id,environment_id,deployment_id,package_version_id,
           package_artifact_digest,package_manifest_digest,package_dependency_digest,workflow_id,revision_id,
           revision_snapshot_digest,integration_id,contract_document,contract_digest,contract_dependency_digests,
           projector_id,projector_version,projector_artifact_digest,projector_rules_digest,
           registration_document,registration_digest,registered_by,registered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING *`,
        [input.registration_id, installationId, environmentId, input.deployment_id, deployed.package_version_id,
          deployed.package_artifact_digest, deployed.package_manifest_digest, deployed.package_dependency_digest,
          input.workflow_id, input.revision_id, revision.snapshot_digest, input.integration_id, contract,
          contractDigest, JSON.stringify(dependencyDigests), CORRELATION_PROJECTOR_ID,
          CORRELATION_PROJECTOR_VERSION, CORRELATION_PROJECTOR_ARTIFACT_DIGEST, CORRELATION_RULES_DIGEST,
          document, registrationDigest, actorId, registeredAt]
      )).rows[0];
      await client.query("COMMIT");
      return { replayed: false, result: { correlation_registration: registrationView(row) } };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function createProjection(value, actorId, now = new Date()) {
    const input = projectionInput(value);
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `correlation-projection:${installationId}:${input.registration_id}:${input.logical_operation_id}`
      ]);
      const prefix = (await client.query(
        `SELECT next_position FROM diagnostic_intake_prefixes
         WHERE installation_id=$1 FOR UPDATE`, [installationId]
      )).rows[0];
      if (!prefix) {
        throw new KernelError(503, "DIAGNOSTIC_INTAKE_PREFIX_UNAVAILABLE",
          "Intake prefix is not initialized.");
      }
      const cutoff = BigInt(prefix.next_position) - 1n;
      if (cutoff < 1n) {
        throw new KernelError(409, "CORRELATION_INPUT_PREFIX_EMPTY",
          "Correlation Projection requires at least one committed intake outcome.");
      }
      const registrationRow = (await client.query(
        `SELECT * FROM diagnostic_correlation_registrations
         WHERE installation_id=$1 AND environment_id=$2 AND registration_id=$3`,
        [installationId, environmentId, input.registration_id]
      )).rows[0];
      if (!registrationRow) {
        throw new KernelError(404, "CORRELATION_REGISTRATION_NOT_FOUND",
          "Correlation Registration does not exist.");
      }
      verifyRegistrationRow(registrationRow);
      if (registrationRow.projector_id !== CORRELATION_PROJECTOR_ID
          || registrationRow.projector_version !== CORRELATION_PROJECTOR_VERSION
          || registrationRow.projector_artifact_digest !== CORRELATION_PROJECTOR_ARTIFACT_DIGEST
          || registrationRow.projector_rules_digest !== CORRELATION_RULES_DIGEST) {
        throw new KernelError(409, "CORRELATION_REGISTRATION_PROJECTOR_MISMATCH",
          "Registered projector material differs from the running projector; create a new registration.");
      }
      const registration = registrationView(registrationRow);
      const outcomeRows = (await client.query(
        `SELECT * FROM diagnostic_intake_outcomes
         WHERE installation_id=$1 AND intake_position<=$2 ORDER BY intake_position`,
        [installationId, cutoff.toString()]
      )).rows;
      ensureCompletePrefix(outcomeRows, cutoff);
      const observationRows = (await client.query(
        `SELECT r.*,a.deployment_id AS schema_deployment_id,a.package_version_id AS schema_package_version_id,
                a.package_artifact_digest AS schema_package_artifact_digest,a.schema_artifact
         FROM diagnostic_observation_receipts r
         JOIN diagnostic_observation_schema_activations a
           ON a.installation_id=r.installation_id AND a.activation_id=r.schema_activation_id
         WHERE r.installation_id=$1 AND r.intake_position<=$2
         ORDER BY r.intake_position,r.receipt_id`,
        [installationId, cutoff.toString()]
      )).rows;
      ensureAcceptedReceiptIntegrity(outcomeRows, observationRows);
      const receiptIds = observationRows.map((row) => row.receipt_id);
      const dependencyRows = receiptIds.length ? (await client.query(
        `SELECT d.observation_receipt_id,t.*
         FROM diagnostic_observation_provenance_dependencies d
         JOIN diagnostic_tokenization_result_receipts t
           ON t.installation_id=d.installation_id AND t.result_receipt_id=d.dependency_id
         WHERE d.installation_id=$1 AND d.observation_receipt_id=ANY($2::uuid[])
         ORDER BY d.observation_receipt_id,t.result_receipt_id`,
        [installationId, receiptIds]
      )).rows : [];
      const dependenciesByReceipt = new Map();
      for (const row of dependencyRows) {
        const values = dependenciesByReceipt.get(row.observation_receipt_id) ?? [];
        values.push(dependencyView(row));
        dependenciesByReceipt.set(row.observation_receipt_id, values);
      }
      const observations = observationRows.map((row) => ({
        receipt_id: row.receipt_id,
        receipt_digest: row.receipt_digest,
        intake_position: String(row.intake_position),
        envelope_digest: row.envelope_digest,
        observation_type: row.observation_type,
        principal_id: row.principal_id,
        grant_id: row.grant_id,
        stream_id: row.stream_id,
        stream_sequence: String(row.stream_sequence),
        workflow_id: row.workflow_id,
        integration_id: row.integration_id,
        claims: row.envelope.claims,
        limitations: row.envelope.limitations,
        dependencies: dependenciesByReceipt.get(row.receipt_id) ?? []
      }));
      const receiptManifest = observationRows.map((row) => ({
        intake_position: String(row.intake_position),
        receipt_id: row.receipt_id,
        receipt_digest: row.receipt_digest,
        observation_type: row.observation_type,
        envelope_digest: row.envelope_digest,
        schema_activation_id: row.schema_activation_id,
        schema_digest: row.schema_digest,
        grant_snapshot_digest: row.grant_snapshot_digest,
        detail_artifact_digest: row.detail_artifact_digest,
        provenance_dependencies: (dependenciesByReceipt.get(row.receipt_id) ?? []).map((dependency) => ({
          result_receipt_id: dependency.result_receipt_id,
          receipt_digest: dependency.receipt_digest
        })).sort((left, right) => left.result_receipt_id < right.result_receipt_id ? -1
          : left.result_receipt_id > right.result_receipt_id ? 1 : 0)
      }));
      const schemas = new Map();
      for (const row of observationRows) schemas.set(row.schema_activation_id, {
        schema_activation_id: row.schema_activation_id,
        deployment_id: row.schema_deployment_id,
        package_version_id: row.schema_package_version_id,
        package_artifact_digest: row.schema_package_artifact_digest,
        schema_id: row.schema_id,
        schema_version: row.schema_version,
        schema_digest: row.schema_digest,
        schema_artifact_digest: sha256Digest(row.schema_artifact)
      });
      const tokens = new Map();
      for (const row of dependencyRows) tokens.set(row.result_receipt_id, {
        result_receipt_id: row.result_receipt_id,
        receipt_digest: row.receipt_digest,
        grant_snapshot_digest: row.grant_snapshot_digest,
        grant_application_receipt_digest: row.grant_application_receipt_digest,
        requester_principal_id: row.requester_principal_id,
        integration_id: row.integration_id,
        field_role: row.field_role,
        claim_field: row.claim_field,
        namespace: row.namespace,
        algorithm_version: row.algorithm_version,
        raw_input_preserved: false
      });
      const conflicts = (await client.query(
        `SELECT conflict_id,intake_position,conflict_digest,received_envelope_digest,conflict_types,
                accepted_receipt_ids
         FROM diagnostic_observation_conflicts
         WHERE installation_id=$1 AND intake_position<=$2 ORDER BY intake_position`,
        [installationId, cutoff.toString()]
      )).rows.map((row) => ({ ...row, intake_position: String(row.intake_position) }));
      const rejections = (await client.query(
        `SELECT rejection_id,intake_position,body_digest,reason_code
         FROM diagnostic_observation_rejections
         WHERE installation_id=$1 AND intake_position<=$2 ORDER BY intake_position`,
        [installationId, cutoff.toString()]
      )).rows.map((row) => ({ ...row, intake_position: String(row.intake_position) }));
      ensureOutcomeMaterialIntegrity(outcomeRows, conflicts, rejections);
      const intakeOutcomes = outcomeRows.map((row) => ({
        intake_position: String(row.intake_position),
        outcome_type: row.outcome_type,
        outcome_id: row.outcome_id,
        outcome_digest: row.outcome_digest
      }));
      const projected = buildCorrelationProjection({
        registration,
        logicalOperationId: input.logical_operation_id,
        cutoff: cutoff.toString(),
        intakeOutcomes,
        receiptManifest,
        schemaManifest: [...schemas.values()],
        tokenizationManifest: [...tokens.values()],
        observations,
        conflicts,
        rejections
      });
      const existing = (await client.query(
        `SELECT * FROM diagnostic_correlation_projections
         WHERE installation_id=$1 AND registration_id=$2 AND logical_operation_id=$3
           AND committed_intake_cutoff=$4`,
        [installationId, input.registration_id, input.logical_operation_id, cutoff.toString()]
      )).rows[0];
      if (existing) {
        if (existing.semantic_digest !== projected.semantic_digest
            || canonicalize(existing.semantic_projection) !== canonicalize(projected.semantic_projection)) {
          const conflictId = randomUUID();
          await client.query(
            `INSERT INTO diagnostic_correlation_projection_conflicts
              (conflict_id,installation_id,registration_id,logical_operation_id,committed_intake_cutoff,
               accepted_projection_id,accepted_semantic_digest,received_semantic_digest,detected_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [conflictId, installationId, input.registration_id, input.logical_operation_id, cutoff.toString(),
              existing.projection_id, existing.semantic_digest, projected.semantic_digest,
              new Date(now).toISOString()]
          );
          await client.query("COMMIT");
          committed = true;
          throw new KernelError(409, "CORRELATION_PROJECTION_NONDETERMINISM",
            "Exact projection inputs and registered rules produced conflicting semantic material.", {
              conflict_id: conflictId,
              accepted_semantic_digest: existing.semantic_digest,
              received_semantic_digest: projected.semantic_digest
            });
        }
        await client.query("COMMIT");
        committed = true;
        return { replayed: true, result: { correlation_projection: projectionView(existing) } };
      }
      const revisionNumber = String((await client.query(
        `SELECT COALESCE(MAX(revision_number),0)+1 AS revision_number
         FROM diagnostic_correlation_projections
         WHERE installation_id=$1 AND registration_id=$2 AND logical_operation_id=$3`,
        [installationId, input.registration_id, input.logical_operation_id]
      )).rows[0].revision_number);
      const projectionId = randomUUID();
      const createdAt = new Date(now).toISOString();
      const recordDocument = {
        projection_id: projectionId,
        registration_id: input.registration_id,
        logical_operation_id: input.logical_operation_id,
        committed_intake_cutoff: cutoff.toString(),
        revision_number: revisionNumber,
        semantic_digest: projected.semantic_digest,
        requested_by: actorId,
        created_at: createdAt
      };
      const recordDigest = sha256Digest(recordDocument);
      const row = (await client.query(
        `INSERT INTO diagnostic_correlation_projections
          (projection_id,installation_id,environment_id,registration_id,logical_operation_id,
           committed_intake_cutoff,revision_number,semantic_projection,semantic_digest,record_document,
           record_digest,requested_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [projectionId, installationId, environmentId, input.registration_id, input.logical_operation_id,
          cutoff.toString(), revisionNumber, projected.semantic_projection, projected.semantic_digest,
          recordDocument, recordDigest, actorId, createdAt]
      )).rows[0];
      await client.query("COMMIT");
      committed = true;
      return { replayed: false, result: { correlation_projection: projectionView(row) } };
    } catch (error) {
      if (!committed) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getRegistration(registrationId) {
    uuid(registrationId, "registration_id");
    const row = (await pool.query(
      `SELECT * FROM diagnostic_correlation_registrations
       WHERE installation_id=$1 AND environment_id=$2 AND registration_id=$3`,
      [installationId, environmentId, registrationId]
    )).rows[0];
    if (!row) throw new KernelError(404, "CORRELATION_REGISTRATION_NOT_FOUND",
      "Correlation Registration does not exist.");
    return registrationView(verifyRegistrationRow(row));
  }

  async function getProjection(projectionId) {
    uuid(projectionId, "projection_id");
    const row = (await pool.query(
      `SELECT * FROM diagnostic_correlation_projections
       WHERE installation_id=$1 AND environment_id=$2 AND projection_id=$3`,
      [installationId, environmentId, projectionId]
    )).rows[0];
    if (!row) throw new KernelError(404, "CORRELATION_PROJECTION_NOT_FOUND",
      "Correlation Projection does not exist.");
    return projectionView(row);
  }

  return { createProjection, getProjection, getRegistration, register };
}
