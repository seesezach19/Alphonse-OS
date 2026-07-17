import { randomUUID } from "node:crypto";

import { KernelError } from "./errors.js";
import {
  validateGrantApplicationReceipt,
  verifySignedGrantActivationSnapshot,
  verifySignedGrantApplicationReceipt
} from "./grant-authority-contracts.js";
import { verifySignedTokenizationResultReceipt } from "./tokenization-contracts.js";

export function createDiagnosticTokenizationProofService(database, installationId, environmentId, {
  serviceId = "tokenization-service",
  serviceKeyId,
  servicePublicKey,
  authorityKey,
  applicationKey
}) {
  if (!serviceKeyId || !servicePublicKey || !authorityKey?.keyId || !authorityKey?.secret
      || !applicationKey?.keyId || !applicationKey?.secret) {
    throw new KernelError(500, "TOKENIZATION_PROOF_CONFIG_INVALID", "Tokenization verification identity is required.");
  }
  const { pool } = database;

  async function preserveResultReceipt({ signed_result_receipt_bytes: signedReceiptBytes,
    signed_grant_snapshot_bytes: signedGrantSnapshotBytes,
    signed_grant_application_receipt_bytes: signedGrantApplicationReceiptBytes }, now = new Date()) {
    const verified = verifySignedTokenizationResultReceipt(signedReceiptBytes, {
      keyId: serviceKeyId, publicKey: servicePublicKey
    });
    const grantSnapshot = verifySignedGrantActivationSnapshot(signedGrantSnapshotBytes, {
      ...authorityKey, now: new Date(now).toISOString()
    });
    const grantApplication = verifySignedGrantApplicationReceipt(signedGrantApplicationReceiptBytes, applicationKey);
    validateGrantApplicationReceipt(grantSnapshot, grantApplication, { receiverServiceId: serviceId });
    const result = verified.document;
    if (result.installation_id !== installationId || result.environment_id !== environmentId
      || result.service_id !== serviceId) {
      throw new KernelError(403, "TOKENIZATION_RECEIPT_SCOPE_MISMATCH",
        "Tokenization Result Receipt is outside this Diagnostic Plane scope.");
    }
    if (grantSnapshot.document.grant_id !== result.grant_id
        || grantSnapshot.document.grant_type !== "tokenization_use"
        || grantSnapshot.document.receiver_service_id !== serviceId
        || grantSnapshot.document.target_state !== "active"
        || grantApplication.document.applied_state !== "active") {
      throw new KernelError(403, "TOKENIZATION_GRANT_PROOF_INVALID",
        "Tokenization Result Receipt does not bind an applied active Tokenization Use Grant.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `tokenization-result:${installationId}:${result.result_receipt_id}`
      ]);
      const existing = (await client.query(
        `SELECT * FROM diagnostic_tokenization_result_receipts
         WHERE installation_id=$1 AND (result_receipt_id=$2 OR request_id=$3)`,
        [installationId, result.result_receipt_id, result.request_id]
      )).rows[0];
      if (existing) {
        if (existing.receipt_digest === verified.digest && existing.result_receipt_id === result.result_receipt_id) {
          await client.query("COMMIT");
          return { replayed: true, result: { tokenization_result_receipt: view(existing) } };
        }
        const conflictId = randomUUID();
        await client.query(
          `INSERT INTO diagnostic_tokenization_result_conflicts
            (conflict_id,installation_id,result_receipt_id,received_receipt_digest,accepted_receipt_digest,
             reason,detected_at)
           VALUES ($1,$2,$3,$4,$5,'result_or_request_identity_reuse',$6)`,
          [conflictId, installationId, result.result_receipt_id, verified.digest,
            existing.receipt_digest, new Date(now).toISOString()]
        );
        await client.query("COMMIT");
        throw new KernelError(409, "TOKENIZATION_RECEIPT_IDENTITY_CONFLICT",
          "Tokenization result or request identity is already bound to different signed material.", {
            conflict_id: conflictId
          });
      }
      const document = grantSnapshot.document.grant_document;
      const fields = ["requester_principal_id", "installation_id", "environment_id", "integration_id",
        "field_role", "claim_field", "namespace", "algorithm_version", "collection_window_id"];
      const mismatch = fields.find((field) => result[field] !== document[field]);
      if (mismatch || result.service_version !== document.service_binding?.version
          || result.input_length > document.max_input_bytes
          || Date.parse(result.issued_at) < Date.parse(document.valid_from)
          || Date.parse(result.issued_at) >= Date.parse(document.expires_at)) {
        throw new KernelError(403, "TOKENIZATION_RECEIPT_GRANT_BINDING_MISMATCH",
          "Tokenization Result Receipt does not match its exact effective grant.", {
            failed_binding: mismatch ?? "service_version_input_or_time"
          });
      }
      const preservedAt = new Date(now).toISOString();
      const inserted = (await client.query(
        `INSERT INTO diagnostic_tokenization_result_receipts
          (result_receipt_id,installation_id,environment_id,request_id,grant_id,requester_principal_id,
           integration_id,field_role,claim_field,namespace,algorithm_version,equality_token,input_length,
           collection_window_id,service_id,service_version,service_key_id,signed_receipt_bytes,receipt_digest,
           grant_snapshot_digest,grant_application_receipt_digest,signed_grant_snapshot_bytes,
           signed_grant_application_receipt_bytes,preserved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING *`,
        [result.result_receipt_id, installationId, environmentId, result.request_id, result.grant_id,
          result.requester_principal_id, result.integration_id, result.field_role, result.claim_field,
          result.namespace, result.algorithm_version, result.equality_token, result.input_length,
          result.collection_window_id, result.service_id, result.service_version, serviceKeyId,
          Buffer.from(verified.bytes, "utf8"), verified.digest, grantSnapshot.digest,
          grantApplication.digest, Buffer.from(grantSnapshot.bytes, "utf8"),
          Buffer.from(grantApplication.bytes, "utf8"), preservedAt]
      )).rows[0];
      await client.query("COMMIT");
      return { replayed: false, result: { tokenization_result_receipt: view(inserted) } };
    } catch (error) {
      if (error.code !== "TOKENIZATION_RECEIPT_IDENTITY_CONFLICT") await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  function view(row, includeProofBytes = false) {
    return {
      result_receipt_id: row.result_receipt_id,
      request_id: row.request_id,
      grant_id: row.grant_id,
      requester_principal_id: row.requester_principal_id,
      integration_id: row.integration_id,
      field_role: row.field_role,
      claim_field: row.claim_field,
      namespace: row.namespace,
      algorithm_version: row.algorithm_version,
      equality_token: row.equality_token,
      collection_window_id: row.collection_window_id,
      service_id: row.service_id,
      service_version: row.service_version,
      service_key_id: row.service_key_id,
      receipt_digest: row.receipt_digest,
      grant_snapshot_digest: row.grant_snapshot_digest,
      grant_application_receipt_digest: row.grant_application_receipt_digest,
      preserved_at: row.preserved_at,
      exact_signed_bytes_preserved: true,
      raw_input_preserved: false,
      immutable: true,
      ...(includeProofBytes ? {
        signed_result_receipt_bytes: Buffer.from(row.signed_receipt_bytes).toString("utf8"),
        signed_grant_snapshot_bytes: Buffer.from(row.signed_grant_snapshot_bytes).toString("utf8"),
        signed_grant_application_receipt_bytes: Buffer.from(row.signed_grant_application_receipt_bytes).toString("utf8")
      } : {})
    };
  }

  async function getResultReceipt(resultReceiptId) {
    const row = (await pool.query(
      `SELECT * FROM diagnostic_tokenization_result_receipts
       WHERE installation_id=$1 AND result_receipt_id=$2`, [installationId, resultReceiptId]
    )).rows[0];
    if (!row) throw new KernelError(404, "TOKENIZATION_RESULT_RECEIPT_NOT_FOUND",
      "Tokenization Result Receipt does not exist.");
    return view(row, true);
  }

  async function verifyDependencies(dependencyIds, envelope) {
    const verified = [];
    for (const dependencyId of dependencyIds) {
      const row = (await pool.query(
        `SELECT * FROM diagnostic_tokenization_result_receipts
         WHERE installation_id=$1 AND result_receipt_id=$2`, [installationId, dependencyId]
      )).rows[0];
      if (!row) throw new KernelError(422, "OBSERVATION_PROVENANCE_MISSING",
        "Referenced Tokenization Result Receipt is not preserved.", { dependency_id: dependencyId });
      const matches = row.requester_principal_id === envelope.principal_id
        && row.installation_id === envelope.installation_id
        && row.environment_id === envelope.environment_id
        && row.integration_id === envelope.integration_id
        && envelope.claims[row.claim_field] === row.equality_token;
      if (!matches) throw new KernelError(422, "OBSERVATION_TOKEN_BINDING_MISMATCH",
        "Observation token claim does not match its exact signed provenance.", { dependency_id: dependencyId });
      verified.push({ dependency_id: dependencyId, dependency_digest: row.receipt_digest,
        dependency_type: "tokenization_result_receipt" });
    }
    if (new Set(verified.map((item) => item.dependency_id)).size !== dependencyIds.length) {
      throw new KernelError(422, "OBSERVATION_PROVENANCE_DUPLICATED", "Observation provenance dependencies must be unique.");
    }
    return verified;
  }

  return {
    getResultReceipt,
    preserveResultReceipt,
    verify: verifyDependencies
  };
}
