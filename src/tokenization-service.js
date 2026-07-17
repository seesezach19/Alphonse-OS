import { createHmac, randomUUID } from "node:crypto";

import { canonicalize } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import {
  authorizeTokenizationRequest,
  createEqualityToken,
  createSignedTokenizationResultReceipt,
  validateTokenizationRequest
} from "./tokenization-contracts.js";

export function createTokenizationService({
  database,
  installationId,
  environmentId,
  serviceId = "tokenization-service",
  serviceVersion = "0.1.0",
  serviceKeyId,
  servicePrivateKey,
  rootSecret,
  proofClient
}) {
  const { pool } = database;

  function keyedRequestDigest(value) {
    return `hmac-sha256:${createHmac("sha256", rootSecret).update(canonicalize(value)).digest("hex")}`;
  }

  async function submitProof(row) {
    const accepted = await proofClient.preserve({
      signed_result_receipt_bytes: row.signed_receipt_bytes.toString("utf8"),
      signed_grant_snapshot_bytes: row.signed_grant_snapshot_bytes.toString("utf8"),
      signed_grant_application_receipt_bytes: row.signed_grant_application_receipt_bytes.toString("utf8")
    });
    return accepted.tokenization_result_receipt;
  }

  async function tokenize(value, authenticatedPrincipalId, now = new Date()) {
    const input = validateTokenizationRequest(value);
    if (authenticatedPrincipalId !== input.requester_principal_id) {
      throw new KernelError(403, "TOKENIZATION_REQUESTER_AUTHENTICATION_MISMATCH",
        "Authenticated requester does not match the tokenization request.");
    }
    if (input.installation_id !== installationId || input.environment_id !== environmentId) {
      throw new KernelError(403, "TOKENIZATION_ENVIRONMENT_MISMATCH", "Tokenization request targets another environment.");
    }
    const requestDigest = keyedRequestDigest(input);
    const client = await pool.connect();
    let resultRow;
    let replayed = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `tokenization:${installationId}:${input.request_id}`
      ]);
      const existing = (await client.query(
        `SELECT r.request_digest,t.* FROM tokenization_requests r
         JOIN tokenization_result_receipts t ON t.request_id=r.request_id
         WHERE r.installation_id=$1 AND r.request_id=$2`, [installationId, input.request_id]
      )).rows[0];
      if (existing) {
        if (existing.request_digest !== requestDigest) {
          throw new KernelError(409, "TOKENIZATION_REQUEST_IDENTITY_CONFLICT",
            "Tokenization request ID is already bound to different keyed material.");
        }
        resultRow = existing;
        replayed = true;
        await client.query("COMMIT");
      } else {
        const grant = (await client.query(
          `SELECT s.*,a.signed_snapshot_bytes,r.signed_receipt_bytes AS application_receipt_bytes,
                  r.receipt_digest AS application_receipt_digest
           FROM tokenization_grant_effective_states s
           JOIN tokenization_grant_activation_snapshots a ON a.snapshot_id=s.snapshot_id
           JOIN tokenization_grant_application_receipts r ON r.application_receipt_id=s.application_receipt_id
           WHERE s.installation_id=$1 AND s.environment_id=$2 AND s.grant_id=$3 FOR SHARE OF s`,
          [installationId, environmentId, input.grant_id]
        )).rows[0];
        if (!grant || grant.grant_type !== "tokenization_use" || grant.receiver_service_id !== serviceId) {
          throw new KernelError(403, "TOKENIZATION_GRANT_UNAVAILABLE", "Effective Tokenization Use Grant does not exist.");
        }
        const authorized = authorizeTokenizationRequest(input, grant.grant_document, {
          grantId: grant.grant_id, effectiveState: grant.effective_state, now
        });
        const recent = await client.query(
          `SELECT COUNT(*)::bigint AS count FROM tokenization_requests
           WHERE installation_id=$1 AND grant_id=$2 AND accepted_at >= $3`,
          [installationId, input.grant_id, new Date(new Date(now).getTime() - 60_000).toISOString()]
        );
        if (BigInt(recent.rows[0].count) >= BigInt(grant.grant_document.requests_per_minute)) {
          throw new KernelError(429, "TOKENIZATION_RATE_LIMITED", "Tokenization Use Grant rate limit is exhausted.");
        }
        const equalityToken = createEqualityToken(authorized.input_bytes, input, rootSecret);
        const issuedAt = new Date(now).toISOString();
        const receipt = createSignedTokenizationResultReceipt({
          result_receipt_id: randomUUID(),
          request_id: input.request_id,
          grant_id: input.grant_id,
          requester_principal_id: input.requester_principal_id,
          installation_id: input.installation_id,
          environment_id: input.environment_id,
          integration_id: input.integration_id,
          field_role: input.field_role,
          claim_field: input.claim_field,
          namespace: input.namespace,
          algorithm_version: input.algorithm_version,
          equality_token: equalityToken,
          input_length: authorized.input_bytes.length,
          collection_window_id: grant.grant_document.collection_window_id,
          service_id: serviceId,
          service_version: serviceVersion,
          issued_at: issuedAt
        }, { keyId: serviceKeyId, privateKey: servicePrivateKey });
        await client.query(
          `INSERT INTO tokenization_requests
            (request_id,installation_id,environment_id,grant_id,requester_principal_id,integration_id,
             field_role,claim_field,namespace,algorithm_version,input_length,request_digest,accepted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [input.request_id, installationId, environmentId, input.grant_id, input.requester_principal_id,
            input.integration_id, input.field_role, input.claim_field, input.namespace, input.algorithm_version,
            authorized.input_bytes.length, requestDigest, issuedAt]
        );
        resultRow = (await client.query(
          `INSERT INTO tokenization_result_receipts
            (result_receipt_id,installation_id,environment_id,request_id,grant_id,requester_principal_id,
             integration_id,field_role,claim_field,namespace,algorithm_version,equality_token,input_length,
             collection_window_id,service_id,service_version,service_key_id,signed_receipt_bytes,receipt_digest,
             signed_grant_snapshot_bytes,grant_snapshot_digest,signed_grant_application_receipt_bytes,
             grant_application_receipt_digest,issued_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
           RETURNING *`,
          [receipt.document.result_receipt_id, installationId, environmentId, input.request_id, input.grant_id,
            input.requester_principal_id, input.integration_id, input.field_role, input.claim_field, input.namespace,
            input.algorithm_version, equalityToken, authorized.input_bytes.length,
            grant.grant_document.collection_window_id, serviceId, serviceVersion, serviceKeyId,
            Buffer.from(receipt.bytes, "utf8"), receipt.digest, grant.signed_snapshot_bytes,
            grant.snapshot_digest, grant.application_receipt_bytes, grant.application_receipt_digest, issuedAt]
        )).rows[0];
        await client.query("COMMIT");
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const diagnosticReceipt = await submitProof(resultRow);
    return {
      replayed,
      result: {
        tokenization_result: {
          result_receipt_id: resultRow.result_receipt_id,
          request_id: resultRow.request_id,
          equality_token: resultRow.equality_token,
          claim_field: resultRow.claim_field,
          receipt_digest: resultRow.receipt_digest,
          diagnostic_receipt_digest: diagnosticReceipt.receipt_digest,
          diagnostic_preserved: true,
          raw_input_retained: false,
          unsalted_input_digest_retained: false
        }
      }
    };
  }

  return { tokenize };
}
