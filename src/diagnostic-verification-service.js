import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  buildVerificationJob,
  projectVerificationReceipt
} from "./diagnostic-verification-contracts.js";
import {
  requireExact,
  requireObject,
  requireString,
  requireUuid
} from "./diagnostic-repair-worker-contracts.js";
import { KernelError } from "./errors.js";

function parseCommand(value) {
  const envelope = requireExact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== "diagnostic.repair_verification.create") {
    throw new KernelError(400, "UNSUPPORTED_OPERATION",
      "operation_id must be diagnostic.repair_verification.create.");
  }
  return {
    command_id: requireString(envelope.command_id, "command_id", 160),
    operation_id: envelope.operation_id,
    input: requireObject(envelope.input, "input")
  };
}

function receiptView(row) {
  if (!row) return null;
  return {
    verification_id: row.verification_id,
    case_id: row.case_id,
    candidate_id: row.candidate_id,
    delivery_id: row.delivery_id,
    reproduction_bundle_id: row.reproduction_bundle_id,
    verification_request_digest: row.verification_request_digest,
    artifacts: {
      original: row.original_artifact_digest,
      candidate: row.candidate_artifact_digest,
      bundle: row.bundle_artifact_digest,
      fixture: row.fixture_artifact_digest,
      regressions: row.regression_artifact_digests,
      logs: row.logs_artifact_digest,
      receipt: row.receipt_artifact_digest
    },
    runner: {
      runner_id: row.runner_id,
      runner_version: row.runner_version,
      fixture_version: row.fixture_version
    },
    overall_result: row.overall_result,
    outcomes: row.outcomes,
    receipt_digest: row.receipt_digest,
    signed_receipt: row.receipt,
    environment: {
      disposable: true,
      destroyed: row.environment_destroyed,
      production_credentials_received: false
    },
    verified_at: row.verified_at,
    projection: projectVerificationReceipt(row.receipt),
    immutable: true
  };
}

function artifactEntry(content) {
  return { artifact_digest: sha256Digest(content), content };
}

export function createDiagnosticVerificationService({
  database, artifactStore, installationId, runnerClient, runner
}) {
  const { pool, executeCommand } = database;

  function commandDigest(command) {
    return sha256Digest({ installation_id: installationId, ...command });
  }

  async function getVerification(verificationId, client = pool) {
    requireUuid(verificationId, "verification_id");
    const result = await client.query(
      `SELECT * FROM diagnostic_verification_receipts
       WHERE installation_id=$1 AND verification_id=$2`, [installationId, verificationId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "VERIFICATION_RECEIPT_NOT_FOUND", "Verification Receipt does not exist.");
    }
    return receiptView(result.rows[0]);
  }

  async function persistArtifact(client, content, acceptedAt) {
    const stored = await artifactStore.putJson(content);
    await client.query(
      `INSERT INTO diagnostic_artifacts
        (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
      [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
        stored.storage_key, acceptedAt]
    );
    return stored;
  }

  async function loadArtifact(digest) {
    const result = await artifactStore.getJson(digest);
    return { artifact_digest: result.artifact.artifact_digest, content: result.content };
  }

  async function verificationSource(client, candidateId, deliveryId) {
    const result = await client.query(
      `SELECT c.*,d.delivery_id,d.target_candidate_artifact_digest,b.artifact_digest AS bundle_artifact_digest,
              r.snapshot_digest AS original_artifact_digest,dc.workflow_id,e.event_type AS current_status
       FROM diagnostic_repair_candidates c
       JOIN diagnostic_repair_deliveries d
         ON d.installation_id=c.installation_id AND d.candidate_id=c.candidate_id
       JOIN diagnostic_reproduction_bundles b
         ON b.installation_id=c.installation_id AND b.bundle_id=c.reproduction_bundle_id
       JOIN diagnostic_agent_revisions r
         ON r.installation_id=c.installation_id AND r.revision_id=c.base_revision_id
       JOIN diagnostic_cases dc
         ON dc.installation_id=c.installation_id AND dc.case_id=c.case_id
       JOIN LATERAL (
         SELECT event_type FROM diagnostic_repair_candidate_events
         WHERE installation_id=c.installation_id AND candidate_id=c.candidate_id
         ORDER BY event_index DESC LIMIT 1
       ) e ON true
       WHERE c.installation_id=$1 AND c.candidate_id=$2 AND d.delivery_id=$3
       FOR SHARE OF c,d,b,r,dc`, [installationId, candidateId, deliveryId]
    );
    if (!result.rows[0]) {
      throw new KernelError(409, "VERIFICATION_SOURCE_MISMATCH",
        "Candidate, inactive delivery, bundle, and original revision must exist and match exactly.");
    }
    if (!['verification_pending', 'verified', 'rejected'].includes(result.rows[0].current_status)) {
      throw new KernelError(409, "REPAIR_CANDIDATE_NOT_VERIFIABLE",
        "Repair Candidate must have an inactive delivered representation before verification.");
    }
    return result.rows[0];
  }

  async function regressionArtifacts(client, source) {
    const retained = await client.query(
      `SELECT DISTINCT c.regression_artifact_digest
       FROM diagnostic_verification_receipts v
       JOIN diagnostic_repair_candidates c
         ON c.installation_id=v.installation_id AND c.candidate_id=v.candidate_id
       JOIN diagnostic_cases dc
         ON dc.installation_id=c.installation_id AND dc.case_id=c.case_id
       WHERE v.installation_id=$1 AND v.overall_result='passed' AND dc.workflow_id=$2
         AND c.regression_artifact_digest<>$3
       ORDER BY c.regression_artifact_digest`,
      [installationId, source.workflow_id, source.regression_artifact_digest]
    );
    return [
      { role: "targeted", ...(await loadArtifact(source.regression_artifact_digest)) },
      ...(await Promise.all(retained.rows.map(async (row) => ({
        role: "retained", ...(await loadArtifact(row.regression_artifact_digest))
      }))))
    ];
  }

  async function bindIdempotency(client, idempotencyKey, requestDigest, verificationId, acceptedAt) {
    await client.query(
      `INSERT INTO diagnostic_verification_idempotency
        (installation_id,idempotency_key,verification_request_digest,verification_id,bound_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [installationId, idempotencyKey, requestDigest, verificationId, acceptedAt]
    );
  }

  async function createVerification(value, actor) {
    if (!runnerClient) {
      throw new KernelError(503, "VERIFICATION_RUNNER_UNAVAILABLE", "Verification Runner is not configured.");
    }
    const envelope = parseCommand(value);
    const raw = requireExact(envelope.input, "input", ["candidate_id", "delivery_id", "idempotency_key"]);
    const input = {
      candidate_id: requireUuid(raw.candidate_id, "candidate_id"),
      delivery_id: requireUuid(raw.delivery_id, "delivery_id"),
      idempotency_key: requireString(raw.idempotency_key, "idempotency_key", 200)
    };
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: commandDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:repair-verification:${input.candidate_id}`
        ]);
        const source = await verificationSource(client, input.candidate_id, input.delivery_id);
        const original = await loadArtifact(source.original_artifact_digest);
        const candidate = await loadArtifact(source.target_candidate_artifact_digest);
        const bundle = await loadArtifact(source.bundle_artifact_digest);
        const fixtureContent = {
          schema_version: "0.2.0",
          kind: "verification_fixture",
          content: {
            redacted_inputs: bundle.content.redacted_inputs,
            fixtures: bundle.content.fixtures
          }
        };
        const fixture = artifactEntry(fixtureContent);
        const regressions = await regressionArtifacts(client, source);
        const verificationId = randomUUID();
        const job = buildVerificationJob({
          verificationId,
          candidateId: input.candidate_id,
          deliveryId: input.delivery_id,
          runner,
          artifacts: { original, candidate, bundle, fixture, regressions },
          verifiedAt: acceptedAt
        });

        const idempotency = await client.query(
          `SELECT i.*,v.* FROM diagnostic_verification_idempotency i
           JOIN diagnostic_verification_receipts v
             ON v.installation_id=i.installation_id AND v.verification_id=i.verification_id
           WHERE i.installation_id=$1 AND i.idempotency_key=$2 FOR SHARE OF i,v`,
          [installationId, input.idempotency_key]
        );
        if (idempotency.rows[0]) {
          if (idempotency.rows[0].verification_request_digest !== job.verification_request_digest) {
            throw new KernelError(409, "VERIFICATION_IDEMPOTENCY_CONFLICT",
              "Verification idempotency key already binds different exact dependencies.");
          }
          return {
            aggregateType: "repair_verification", aggregateId: idempotency.rows[0].verification_id,
            transitionType: "diagnostic.repair_verification.reused", fromRevision: 1, toRevision: 1,
            transitionPayload: { verification_id: idempotency.rows[0].verification_id,
              verification_request_digest: job.verification_request_digest },
            result: { repair_verification: receiptView(idempotency.rows[0]), created: false }
          };
        }
        const sameRequest = await client.query(
          `SELECT * FROM diagnostic_verification_receipts
           WHERE installation_id=$1 AND verification_request_digest=$2 FOR SHARE`,
          [installationId, job.verification_request_digest]
        );
        if (sameRequest.rows[0]) {
          await bindIdempotency(client, input.idempotency_key, job.verification_request_digest,
            sameRequest.rows[0].verification_id, acceptedAt);
          return {
            aggregateType: "repair_verification", aggregateId: sameRequest.rows[0].verification_id,
            transitionType: "diagnostic.repair_verification.reused", fromRevision: 1, toRevision: 1,
            transitionPayload: { verification_id: sameRequest.rows[0].verification_id,
              verification_request_digest: job.verification_request_digest },
            result: { repair_verification: receiptView(sameRequest.rows[0]), created: false }
          };
        }

        const executed = await runnerClient.verify(job);
        if (executed.environment.workspace_destroyed !== true
            || executed.environment.production_credentials_received !== false) {
          throw new KernelError(502, "VERIFICATION_ENVIRONMENT_NOT_DESTROYED",
            "Verification evidence cannot be accepted before disposable cleanup completes.");
        }
        const fixtureStored = await persistArtifact(client, fixtureContent, acceptedAt);
        const logsStored = await persistArtifact(client, executed.logs, acceptedAt);
        if (logsStored.artifact_digest !== executed.receipt.evidence.logs_artifact_digest) {
          throw new KernelError(409, "VERIFICATION_EVIDENCE_DIGEST_MISMATCH",
            "Signed Verification Receipt does not bind the retained logs artifact.");
        }
        const receiptStored = await persistArtifact(client, executed.receipt, acceptedAt);
        const inserted = await client.query(
          `INSERT INTO diagnostic_verification_receipts
            (verification_id,installation_id,case_id,candidate_id,delivery_id,reproduction_bundle_id,
             verification_request_digest,original_artifact_digest,candidate_artifact_digest,bundle_artifact_digest,
             fixture_artifact_digest,regression_artifact_digests,runner_id,runner_version,fixture_version,
             overall_result,outcomes,logs_artifact_digest,receipt_artifact_digest,receipt_digest,receipt,
             environment_destroyed,verified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,true,$22)
           RETURNING *`,
          [verificationId, installationId, source.case_id, input.candidate_id, input.delivery_id,
            source.reproduction_bundle_id, job.verification_request_digest, source.original_artifact_digest,
            source.target_candidate_artifact_digest, source.bundle_artifact_digest,
            fixtureStored.artifact_digest, JSON.stringify(job.artifact_bindings.regressions),
            runner.runner_id, runner.runner_version, runner.fixture_version,
            executed.receipt.overall_result, executed.receipt.outcomes, logsStored.artifact_digest,
            receiptStored.artifact_digest, executed.receipt.receipt_digest, executed.receipt, acceptedAt]
        );
        await bindIdempotency(client, input.idempotency_key, job.verification_request_digest,
          verificationId, acceptedAt);
        const eventIndex = await client.query(
          `SELECT COALESCE(MAX(event_index),0)+1 AS event_index
           FROM diagnostic_repair_candidate_events
           WHERE installation_id=$1 AND candidate_id=$2`, [installationId, input.candidate_id]
        );
        const candidateStatus = executed.receipt.overall_result === "passed" ? "verified" : "rejected";
        await client.query(
          `INSERT INTO diagnostic_repair_candidate_events
            (event_id,installation_id,candidate_id,event_index,event_type,detail,actor_type,actor_id,occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,'verification_runner',$7,$8)`,
          [randomUUID(), installationId, input.candidate_id, eventIndex.rows[0].event_index,
            candidateStatus, { verification_id: verificationId,
              receipt_digest: executed.receipt.receipt_digest,
              overall_result: executed.receipt.overall_result }, runner.runner_id, acceptedAt]
        );
        return {
          aggregateType: "repair_verification", aggregateId: verificationId,
          transitionType: `diagnostic.repair_verification.${executed.receipt.overall_result}`,
          fromRevision: 0, toRevision: 1,
          transitionPayload: { verification_id: verificationId, candidate_id: input.candidate_id,
            receipt_digest: executed.receipt.receipt_digest,
            overall_result: executed.receipt.overall_result },
          result: { repair_verification: receiptView(inserted.rows[0]), created: true }
        };
      }
    });
  }

  return { createVerification, getVerification };
}
