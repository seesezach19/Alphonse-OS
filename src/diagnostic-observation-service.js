import { createHash, randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import {
  authorizeObservation,
  projectStreamCoverage,
  validateObservationClaims,
  verifySignedObservation
} from "./observation-contracts.js";

function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function schemaArtifactFromExport(exportRecord) {
  const observation = exportRecord.content?.observation;
  if (!observation || typeof observation !== "object" || Array.isArray(observation)
      || typeof observation.observation_type !== "string"
      || !Array.isArray(observation.allowed_detail_media_types)
      || !Array.isArray(observation.required_correlation_roles)) {
    throw new KernelError(409, "OBSERVATION_SCHEMA_EXPORT_INVALID",
      "Deployed Schema export does not declare canonical observation semantics.");
  }
  const claimsSchema = {
    type: exportRecord.content.type,
    additionalProperties: exportRecord.content.additionalProperties,
    required: exportRecord.content.required,
    properties: exportRecord.content.properties
  };
  validateObservationClaims(
    Object.fromEntries((claimsSchema.required ?? []).map((key) => {
      const rule = claimsSchema.properties?.[key];
      if (rule?.type === "integer") return [key, 0];
      if (rule?.type === "boolean") return [key, false];
      return [key, rule?.enum?.[0] ?? "x"];
    })),
    { claims_schema: claimsSchema }
  );
  return {
    schema_id: exportRecord.export_id,
    schema_version: exportRecord.contract_version,
    observation_type: observation.observation_type,
    claims_schema: claimsSchema,
    allowed_detail_media_types: observation.allowed_detail_media_types,
    required_correlation_roles: observation.required_correlation_roles
  };
}

function receiptView(row) {
  return row.receipt ?? row;
}

export function createDiagnosticObservationService({
  database,
  artifactStore,
  installationId,
  environmentId,
  observerKeys = {},
  resolveDeployedSchema,
  dependencyValidator = null,
  timestampToleranceSeconds = 300
}) {
  const { pool } = database;

  async function allocatePosition(client, committedAt) {
    const row = (await client.query(
      `SELECT next_position FROM diagnostic_intake_prefixes WHERE installation_id=$1 FOR UPDATE`,
      [installationId]
    )).rows[0];
    if (!row) throw new KernelError(503, "DIAGNOSTIC_INTAKE_PREFIX_UNAVAILABLE", "Intake prefix is not initialized.");
    const position = String(row.next_position);
    await client.query(
      `UPDATE diagnostic_intake_prefixes SET next_position=next_position+1,updated_at=$2 WHERE installation_id=$1`,
      [installationId, committedAt]
    );
    return position;
  }

  async function activateSchema({ deployment_id: deploymentId, schema_export_id: schemaExportId }, actorId,
    now = new Date()) {
    if (typeof resolveDeployedSchema !== "function") {
      throw new KernelError(503, "OBSERVATION_SCHEMA_RESOLVER_UNAVAILABLE", "Deployed schema resolution is unavailable.");
    }
    const resolved = await resolveDeployedSchema(deploymentId, schemaExportId);
    const exportRecord = resolved.export_record;
    if (exportRecord?.kind !== "schema" || exportRecord.export_id !== schemaExportId) {
      throw new KernelError(404, "DEPLOYED_OBSERVATION_SCHEMA_NOT_FOUND", "Deployment does not contain the requested Schema export.");
    }
    const schemaArtifact = schemaArtifactFromExport(exportRecord);
    const schemaDigest = exportRecord.export_digest ?? sha256Digest(exportRecord.content);
    if (schemaDigest !== sha256Digest(exportRecord.content)) {
      throw new KernelError(409, "OBSERVATION_SCHEMA_DIGEST_MISMATCH", "Deployed Schema export digest does not match its content.");
    }
    const activationId = randomUUID();
    const activatedAt = new Date(now).toISOString();
    const inserted = await pool.query(
      `INSERT INTO diagnostic_observation_schema_activations
        (activation_id,installation_id,environment_id,deployment_id,package_version_id,package_artifact_digest,
         schema_id,schema_version,schema_digest,observation_type,schema_artifact,activated_by,activated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (installation_id,environment_id,schema_id,schema_version,schema_digest) DO NOTHING
       RETURNING *`,
      [activationId, installationId, environmentId, resolved.deployment_id, resolved.package_version_id,
        resolved.package_artifact_digest, schemaArtifact.schema_id, schemaArtifact.schema_version, schemaDigest,
        schemaArtifact.observation_type, schemaArtifact, actorId, activatedAt]
    );
    const row = inserted.rows[0] ?? (await pool.query(
      `SELECT * FROM diagnostic_observation_schema_activations
       WHERE installation_id=$1 AND environment_id=$2 AND schema_id=$3 AND schema_version=$4 AND schema_digest=$5`,
      [installationId, environmentId, schemaArtifact.schema_id, schemaArtifact.schema_version, schemaDigest]
    )).rows[0];
    if (row.deployment_id !== resolved.deployment_id || row.package_version_id !== resolved.package_version_id) {
      throw new KernelError(409, "OBSERVATION_SCHEMA_ACTIVATION_CONFLICT",
        "Exact Schema tuple is already activated through different deployed material.");
    }
    return { replayed: !inserted.rows[0], result: {
      schema_activation: {
        activation_id: row.activation_id,
        deployment_id: row.deployment_id,
        package_version_id: row.package_version_id,
        package_artifact_digest: row.package_artifact_digest,
        schema: { schema_id: row.schema_id, schema_version: row.schema_version, schema_digest: row.schema_digest },
        observation_type: row.observation_type,
        activated_at: row.activated_at,
        immutable: true,
        authority_granted: false
      }
    } };
  }

  async function preserveRejection(bytes, envelope, authentication, error, now) {
    if (!(error instanceof KernelError) || error.status >= 500) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const committedAt = new Date(now).toISOString();
      const position = await allocatePosition(client, committedAt);
      const rejectionId = randomUUID();
      const document = {
        rejection_id: rejectionId,
        intake_position: position,
        authenticated_principal_id: authentication?.principal_id ?? null,
        authenticated_grant_id: authentication?.grant_id ?? null,
        claimed_schema: envelope?.schema ?? null,
        body_digest: rawDigest(bytes),
        body_size_bytes: bytes.length,
        reason_code: error.code,
        received_at: committedAt
      };
      const outcomeDigest = sha256Digest(document);
      await client.query(
        `INSERT INTO diagnostic_observation_rejections
          (rejection_id,installation_id,intake_position,authenticated_principal_id,authenticated_grant_id,
           claimed_schema_id,claimed_schema_version,claimed_schema_digest,body_digest,body_size_bytes,reason_code,received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [rejectionId, installationId, position, authentication?.principal_id ?? null,
          authentication?.grant_id ?? null, envelope?.schema?.schema_id ?? null,
          envelope?.schema?.schema_version ?? null, envelope?.schema?.schema_digest ?? null,
          document.body_digest, document.body_size_bytes, error.code, committedAt]
      );
      await client.query(
        `INSERT INTO diagnostic_intake_outcomes
          (installation_id,intake_position,outcome_type,outcome_id,outcome_digest,committed_at)
         VALUES ($1,$2,'rejected',$3,$4,$5)`,
        [installationId, position, rejectionId, outcomeDigest, committedAt]
      );
      await client.query("COMMIT");
      error.details = { ...error.details, rejection_id: rejectionId, intake_position: position };
    } catch (recordingError) {
      await client.query("ROLLBACK");
      error.details = { ...error.details, rejection_preservation_failed: recordingError.code ?? "unknown" };
    } finally {
      client.release();
    }
  }

  async function receiveObservation({ envelope_bytes: envelopeBytes, authentication, detail_base64: detailBase64 = null },
    now = new Date()) {
    const rawEnvelopeBytes = Buffer.from(envelopeBytes ?? "", "utf8");
    let envelope = null;
    let authenticationVerified = false;
    try {
      try { envelope = JSON.parse(envelopeBytes); } catch {}
      const key = observerKeys[authentication?.key_id];
      if (!key) throw new KernelError(401, "OBSERVATION_KEY_UNKNOWN", "Observation key is not configured.");
      const verified = verifySignedObservation(envelopeBytes, authentication, {
        keyId: authentication.key_id,
        secret: key,
        now,
        toleranceSeconds: timestampToleranceSeconds
      });
      authenticationVerified = true;
      envelope = verified.envelope;
      if (envelope.installation_id !== installationId || envelope.environment_id !== environmentId) {
        throw new KernelError(403, "OBSERVATION_ENVIRONMENT_MISMATCH", "Observation targets another installation or environment.");
      }
      const grantRow = (await pool.query(
        `SELECT * FROM diagnostic_grant_effective_states
         WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3`,
        [installationId, environmentId, envelope.grant_id]
      )).rows[0];
      if (!grantRow || grantRow.grant_type !== "observation_reporting") {
        throw new KernelError(403, "OBSERVATION_GRANT_UNAVAILABLE", "Effective Reporting Grant does not exist.");
      }
      const schemaRow = (await pool.query(
        `SELECT * FROM diagnostic_observation_schema_activations
         WHERE installation_id=$1 AND environment_id=$2 AND schema_id=$3 AND schema_version=$4
           AND schema_digest=$5 AND observation_type=$6`,
        [installationId, environmentId, envelope.schema.schema_id, envelope.schema.schema_version,
          envelope.schema.schema_digest, envelope.observation_type]
      )).rows[0];
      if (!schemaRow) throw new KernelError(422, "OBSERVATION_SCHEMA_NOT_DEPLOYED", "Exact observation schema is not activated.");
      validateObservationClaims(envelope.claims, schemaRow.schema_artifact);

      const detailBytes = detailBase64 === null ? null : Buffer.from(detailBase64, "base64");
      if ((envelope.detail === null) !== (detailBytes === null)) {
        throw new KernelError(422, "OBSERVATION_DETAIL_BINDING_INVALID", "Signed detail reference and supplied bytes must agree.");
      }
      if (detailBytes && (detailBytes.length !== envelope.detail.size_bytes
          || !schemaRow.schema_artifact.allowed_detail_media_types.includes(envelope.detail.media_type))) {
        throw new KernelError(422, "OBSERVATION_DETAIL_INVALID", "Observation detail violates the deployed schema.");
      }
      const coverageRow = (await pool.query(
        `SELECT highest_sequence_seen FROM diagnostic_observation_stream_coverage
         WHERE installation_id=$1 AND grant_id=$2 AND stream_id=$3`,
        [installationId, envelope.grant_id, envelope.stream_id]
      )).rows[0];
      const authority = authorizeObservation(envelope, grantRow.grant_document, {
        grantId: grantRow.grant_id,
        grantState: grantRow.effective_state,
        now,
        envelopeBytes: rawEnvelopeBytes.length,
        detailBytes: detailBytes?.length ?? 0,
        highestSequenceSeen: String(coverageRow?.highest_sequence_seen ?? 0)
      });
      let verifiedDependencies = [];
      if (envelope.provenance_dependencies.length) {
        if (!dependencyValidator) throw new KernelError(422, "OBSERVATION_PROVENANCE_UNSUPPORTED",
          "Observation references unsupported provenance dependencies.");
        verifiedDependencies = await dependencyValidator.verify(envelope.provenance_dependencies, envelope);
      }

      let storedDetail = null;
      if (detailBytes) {
        storedDetail = await artifactStore.putBytes(detailBytes, {
          mediaType: envelope.detail.media_type,
          expectedDigest: envelope.detail.digest,
          maxBytes: grantRow.grant_document.limits.max_detail_bytes
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const lockKeys = [
          `observation:${installationId}:identity:${envelope.observation_id}`,
          `observation:${installationId}:stream:${envelope.grant_id}:${envelope.stream_id}`
        ].sort();
        for (const keyValue of lockKeys) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [keyValue]);
        }
        const currentGrant = (await client.query(
          `SELECT effective_state,snapshot_digest,grant_digest,grant_document
           FROM diagnostic_grant_effective_states
           WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3 FOR SHARE`,
          [installationId, environmentId, envelope.grant_id]
        )).rows[0];
        if (!currentGrant || currentGrant.effective_state !== "active"
            || currentGrant.snapshot_digest !== grantRow.snapshot_digest
            || currentGrant.grant_digest !== grantRow.grant_digest
            || canonicalize(currentGrant.grant_document) !== canonicalize(grantRow.grant_document)) {
          throw new KernelError(403, "OBSERVATION_GRANT_CHANGED",
            "Reporting Grant changed before the observation receipt transaction.");
        }
        const candidates = await client.query(
          `SELECT * FROM diagnostic_observation_receipts
           WHERE installation_id=$1 AND (observation_id=$2 OR (grant_id=$3 AND stream_id=$4 AND stream_sequence=$5))`,
          [installationId, envelope.observation_id, envelope.grant_id, envelope.stream_id, envelope.sequence]
        );
        const exactReplay = candidates.rows.find((row) => row.observation_id === envelope.observation_id
          && row.grant_id === envelope.grant_id && row.stream_id === envelope.stream_id
          && String(row.stream_sequence) === envelope.sequence && row.envelope_digest === verified.envelope_digest
          && (row.detail_artifact_digest ?? null) === (storedDetail?.artifact_digest ?? null));
        if (exactReplay) {
          await client.query("COMMIT");
          return { replayed: true, result: { observation_receipt: receiptView(exactReplay) } };
        }
        if (candidates.rows.length) {
          const committedAt = new Date(now).toISOString();
          const position = await allocatePosition(client, committedAt);
          const conflictTypes = [...new Set(candidates.rows.flatMap((row) => [
            ...(row.observation_id === envelope.observation_id ? ["observation_identity"] : []),
            ...(row.grant_id === envelope.grant_id && row.stream_id === envelope.stream_id
              && String(row.stream_sequence) === envelope.sequence ? ["stream_sequence"] : [])
          ]))].sort();
          const conflictDocument = {
            intake_position: position,
            received_observation_id: envelope.observation_id,
            received_envelope_digest: verified.envelope_digest,
            conflict_types: conflictTypes,
            accepted_receipt_ids: candidates.rows.map((row) => row.receipt_id).sort(),
            detected_at: committedAt
          };
          const conflictDigest = sha256Digest(conflictDocument);
          const conflictId = randomUUID();
          await client.query(
            `INSERT INTO diagnostic_observation_conflicts
              (conflict_id,installation_id,intake_position,received_observation_id,received_grant_id,
               received_stream_id,received_stream_sequence,received_envelope_digest,conflict_types,
               accepted_receipt_ids,detected_at,conflict_digest)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [conflictId, installationId, position, envelope.observation_id, envelope.grant_id,
              envelope.stream_id, envelope.sequence, verified.envelope_digest, JSON.stringify(conflictTypes),
              JSON.stringify(conflictDocument.accepted_receipt_ids), committedAt, conflictDigest]
          );
          await client.query(
            `INSERT INTO diagnostic_intake_outcomes
              (installation_id,intake_position,outcome_type,outcome_id,outcome_digest,committed_at)
             VALUES ($1,$2,'conflict',$3,$4,$5)`,
            [installationId, position, conflictId, conflictDigest, committedAt]
          );
          await client.query("COMMIT");
          throw new KernelError(409, "OBSERVATION_IDENTITY_CONFLICT",
            "Observation identity or stream sequence conflicts with accepted material.", {
              conflict_id: conflictId, intake_position: position, conflict_types: conflictTypes
            });
        }

        const currentCoverage = (await client.query(
          `SELECT * FROM diagnostic_observation_stream_coverage
           WHERE installation_id=$1 AND grant_id=$2 AND stream_id=$3 FOR UPDATE`,
          [installationId, envelope.grant_id, envelope.stream_id]
        )).rows[0] ?? null;
        const coverage = projectStreamCoverage(currentCoverage, envelope.sequence);
        const receivedAt = new Date(now).toISOString();
        const position = await allocatePosition(client, receivedAt);
        const node = (await client.query(
          `SELECT revision,next_sequence FROM diagnostic_nodes WHERE installation_id=$1 FOR UPDATE`,
          [installationId]
        )).rows[0];
        const receiptId = randomUUID();
        const transitionId = randomUUID();
        const diagnosticSequence = String(node.next_sequence);
        const receiptDocument = {
          receipt_id: receiptId,
          intake_position: position,
          observation_id: envelope.observation_id,
          observation_type: envelope.observation_type,
          envelope_digest: verified.envelope_digest,
          detail_artifact_digest: storedDetail?.artifact_digest ?? null,
          principal_id: envelope.principal_id,
          grant_id: envelope.grant_id,
          grant_snapshot_digest: grantRow.snapshot_digest,
          stream_id: envelope.stream_id,
          stream_sequence: envelope.sequence,
          schema: envelope.schema,
          received_at: receivedAt,
          attribution: authority.attribution,
          exclusive_authorship_established: false,
          external_truth_established: false,
          coverage,
          transition: {
            transition_id: transitionId,
            type: "diagnostic.observation.accepted",
            diagnostic_sequence: diagnosticSequence
          }
        };
        const receiptDigest = sha256Digest(receiptDocument);
        if (storedDetail) {
          await client.query(
            `INSERT INTO diagnostic_artifacts
              (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
            [installationId, storedDetail.artifact_digest, storedDetail.size_bytes,
              storedDetail.media_type, storedDetail.storage_key, receivedAt]
          );
        }
        const commandId = `canonical-observation:${envelope.observation_id}`;
        await client.query(
          `INSERT INTO diagnostic_commands
            (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
           VALUES ($1,$2,$3,$4,'observation_reporter',$5,$6,$7)`,
          [installationId, commandId, verified.envelope_digest, "diagnostic.observation.receive",
            envelope.principal_id, receiptDocument, receivedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_transitions
            (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,transition_type,
             from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
           VALUES ($1,$2,$3,'observation_stream',$4,'diagnostic.observation.accepted',$5,$6,$7,
             'observation_reporter',$8,$9,$10)`,
          [transitionId, installationId, diagnosticSequence, `${envelope.grant_id}:${envelope.stream_id}`,
            currentCoverage ? String(currentCoverage.highest_sequence_seen) : "0", coverage.highest_sequence_seen,
            commandId, envelope.principal_id, {
              receipt_id: receiptId, intake_position: position, envelope_digest: verified.envelope_digest
            }, receivedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_outbox
            (outbox_id,installation_id,transition_id,event_type,payload,created_at)
           VALUES ($1,$2,$3,'observation.accepted',$4,$5)`,
          [randomUUID(), installationId, transitionId, {
            receipt_id: receiptId, intake_position: position, receipt_digest: receiptDigest
          }, receivedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_observation_receipts
            (receipt_id,installation_id,environment_id,intake_position,observation_id,principal_id,grant_id,key_id,
             stream_id,stream_sequence,observation_type,schema_id,schema_version,schema_digest,schema_activation_id,
             workflow_id,integration_id,envelope,envelope_bytes,envelope_digest,detail_artifact_digest,authentication,
             grant_snapshot_digest,attribution,external_truth_established,exclusive_authorship_established,
             received_at,transition_id,receipt,receipt_digest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
             false,false,$25,$26,$27,$28)`,
          [receiptId, installationId, environmentId, position, envelope.observation_id, envelope.principal_id,
            envelope.grant_id, envelope.key_id, envelope.stream_id, envelope.sequence, envelope.observation_type,
            envelope.schema.schema_id, envelope.schema.schema_version, envelope.schema.schema_digest,
            schemaRow.activation_id, envelope.workflow_id, envelope.integration_id, envelope,
            Buffer.from(canonicalize(envelope)), verified.envelope_digest, storedDetail?.artifact_digest ?? null,
            authentication, grantRow.snapshot_digest, authority.attribution, receivedAt, transitionId,
            receiptDocument, receiptDigest]
        );
        await client.query(
          `INSERT INTO diagnostic_intake_outcomes
            (installation_id,intake_position,outcome_type,outcome_id,outcome_digest,committed_at)
           VALUES ($1,$2,'accepted',$3,$4,$5)`,
          [installationId, position, receiptId, receiptDigest, receivedAt]
        );
        for (const dependency of verifiedDependencies) {
          await client.query(
            `INSERT INTO diagnostic_observation_provenance_dependencies
              (installation_id,observation_receipt_id,dependency_type,dependency_id,dependency_digest)
             VALUES ($1,$2,$3,$4,$5)`,
            [installationId, receiptId, dependency.dependency_type,
              dependency.dependency_id, dependency.dependency_digest]
          );
        }
        await client.query(
          `INSERT INTO diagnostic_observation_stream_coverage
            (installation_id,grant_id,stream_id,highest_sequence_seen,contiguous_through,received_ranges,
             missing_ranges,coverage_status,last_received_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (installation_id,grant_id,stream_id) DO UPDATE SET
             highest_sequence_seen=EXCLUDED.highest_sequence_seen,
             contiguous_through=EXCLUDED.contiguous_through,
             received_ranges=EXCLUDED.received_ranges,
             missing_ranges=EXCLUDED.missing_ranges,
             coverage_status=EXCLUDED.coverage_status,
             last_received_at=EXCLUDED.last_received_at`,
          [installationId, envelope.grant_id, envelope.stream_id, coverage.highest_sequence_seen,
            coverage.contiguous_through, JSON.stringify(coverage.received_ranges),
            JSON.stringify(coverage.missing_ranges), coverage.coverage_status, receivedAt]
        );
        await client.query(
          `UPDATE diagnostic_nodes SET revision=revision+1,next_sequence=next_sequence+1,updated_at=$2
           WHERE installation_id=$1`, [installationId, receivedAt]
        );
        await client.query("COMMIT");
        return { replayed: false, result: { observation_receipt: receiptDocument } };
      } catch (error) {
        if (error.code !== "OBSERVATION_IDENTITY_CONFLICT") await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error.code !== "OBSERVATION_IDENTITY_CONFLICT") {
        await preserveRejection(rawEnvelopeBytes, envelope,
          authenticationVerified ? authentication : null, error, now);
      }
      throw error;
    }
  }

  async function getReceipt(receiptId) {
    const row = (await pool.query(
      `SELECT * FROM diagnostic_observation_receipts WHERE installation_id=$1 AND receipt_id=$2`,
      [installationId, receiptId]
    )).rows[0];
    if (!row) throw new KernelError(404, "OBSERVATION_RECEIPT_NOT_FOUND", "Observation receipt does not exist.");
    return receiptView(row);
  }

  async function getIntakePrefix() {
    const prefix = (await pool.query(
      `SELECT next_position-1 AS committed_through FROM diagnostic_intake_prefixes WHERE installation_id=$1`,
      [installationId]
    )).rows[0];
    return { committed_through: String(prefix?.committed_through ?? 0) };
  }

  return { activateSchema, getIntakePrefix, getReceipt, receiveObservation };
}
