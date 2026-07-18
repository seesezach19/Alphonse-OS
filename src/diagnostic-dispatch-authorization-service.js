import { randomBytes, randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_DIGEST } from "./diagnostic-dispatch-artifact.js";
import {
  buildDiagnosticDispatchAuthorization,
  evaluateDiagnosticDispatchCandidate,
  signDiagnosticDispatchAuthorization,
  validateDiagnosticDispatchCommand,
  verifySignedDiagnosticDispatchAuthorization
} from "./diagnostic-dispatch-contracts.js";
import { KernelError } from "./errors.js";
import { isAuthorizedOwner } from "./trusted-operator.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function iso(value) {
  return new Date(value).toISOString();
}

function authorizationView(row) {
  return {
    dispatch_authorization_id: row.dispatch_authorization_id,
    assignment_id: row.assignment_id,
    assignment_digest: row.assignment_digest,
    evidence_package_id: row.evidence_package_id,
    worker: {
      principal_id: row.worker_principal_id,
      passport_id: row.worker_passport_id,
      passport_configuration_digest: row.worker_passport_configuration_digest
    },
    worker_run_id: row.worker_run_id,
    dispatcher: {
      type: row.dispatcher_type,
      id: row.dispatcher_id,
      audience: row.dispatcher_audience
    },
    runner_audience: row.runner_audience,
    eligibility_snapshot_digest: row.eligibility_snapshot_digest,
    decision_artifact_digest: row.decision_artifact_digest,
    authorization_digest: row.authorization_digest,
    signed_authorization_digest: row.signed_authorization_digest,
    signed_authorization: row.signed_authorization,
    issued_at: iso(row.issued_at),
    expires_at: iso(row.expires_at),
    issuance_state: "issued",
    consumption_state: "diagnostic_plane_owned_not_mirrored",
    authority: {
      diagnostic_assignment_claim: "granted_once_to_exact_audiences",
      external_business_effects: "none",
      repair: "none",
      model_credential: "not_granted",
      broker_token: "not_created",
      container_launch: "not_performed"
    },
    immutable: true
  };
}

export function createDiagnosticDispatchAuthorizationService({ database, identityIntent,
  eligibilityReader, installationId, environmentId, signingKeyId, signingSecret,
  dispatcherAudience, allowedRunnerAudiences }) {
  const { pool, executeCommand } = database;
  if (typeof signingSecret !== "string" || Buffer.byteLength(signingSecret, "utf8") < 32) {
    throw new Error("Diagnostic dispatch signing secret must contain at least 32 bytes.");
  }
  if (!Array.isArray(allowedRunnerAudiences) || allowedRunnerAudiences.length === 0) {
    throw new Error("At least one Diagnostic Worker runner audience must be configured.");
  }
  const signing = { keyId: signingKeyId, secret: signingSecret };

  function verifyRow(row) {
    if (!row) {
      throw new KernelError(404, "DIAGNOSTIC_DISPATCH_AUTHORIZATION_NOT_FOUND",
        "Diagnostic Dispatch Authorization does not exist.");
    }
    const verified = verifySignedDiagnosticDispatchAuthorization(row.signed_authorization, signing);
    const document = verified.document;
    if (row.installation_id !== installationId || row.environment_id !== environmentId
        || document.authorization_id !== row.dispatch_authorization_id
        || document.assignment.assignment_id !== row.assignment_id
        || document.assignment.assignment_digest !== row.assignment_digest
        || document.assignment.evidence_package_id !== row.evidence_package_id
        || document.assignment.evidence_package_semantic_digest
          !== row.evidence_package_semantic_digest
        || document.assignment.evidence_package_artifact_digest
          !== row.evidence_package_artifact_digest
        || document.assignment.assignment_policy_activation_id
          !== row.assignment_policy_activation_id
        || document.assignment.assignment_policy_activation_digest
          !== row.assignment_policy_activation_digest
        || document.worker.principal_id !== row.worker_principal_id
        || document.worker.passport_id !== row.worker_passport_id
        || document.worker.passport_configuration_digest
          !== row.worker_passport_configuration_digest
        || document.worker_run.worker_run_id !== row.worker_run_id
        || document.dispatcher.type !== row.dispatcher_type
        || document.dispatcher.id !== row.dispatcher_id
        || document.dispatcher.audience !== row.dispatcher_audience
        || document.runner_audience !== row.runner_audience
        || document.nonce_digest !== row.nonce_digest
        || document.eligibility_snapshot_digest !== row.eligibility_snapshot_digest
        || document.decision_artifact_digest !== row.decision_artifact_digest
        || sha256Digest(row.authorization_document) !== row.authorization_digest
        || sha256Digest(document) !== row.authorization_digest
        || verified.authorization_digest !== row.authorization_digest
        || verified.signed_digest !== row.signed_authorization_digest
        || sha256Digest(row.signed_authorization) !== row.signed_authorization_digest
        || document.temporal.issued_at !== iso(row.issued_at)
        || document.temporal.expires_at !== iso(row.expires_at)) {
      throw new KernelError(500, "DIAGNOSTIC_DISPATCH_AUTHORIZATION_INTEGRITY_VIOLATION",
        "Stored Diagnostic Dispatch Authorization does not match its immutable signed material.");
    }
    return row;
  }

  async function authorize(value, actor) {
    const parsed = validateDiagnosticDispatchCommand(value);
    if (!isAuthorizedOwner(actor)) {
      throw new KernelError(403, "OWNER_AUTHORITY_REQUIRED",
        "Diagnostic dispatch authorization requires customer Owner authority.");
    }
    const command = { ...parsed, actor };
    const requestDigest = sha256Digest({ installation_id: installationId,
      environment_id: environmentId, command });
    const authorizationId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    return executeCommand({
      installationId,
      environmentId,
      command,
      requestDigest,
      apply: async (client, { acceptedAt }) => {
        const eligibility = await eligibilityReader.getDispatchEligibility(
          parsed.input.candidate.assignment.assignment_id, { now: acceptedAt });
        const passport = await identityIntent.getPassport(
          parsed.input.candidate.worker.passport_id, client);
        const boundEligibility = {
          ...eligibility,
          passport_expires_at: iso(passport.expires_at)
        };
        const evaluation = evaluateDiagnosticDispatchCandidate({
          candidate: parsed.input.candidate,
          assignment: eligibility.diagnostic_assignment,
          passport,
          eligibility: boundEligibility,
          acceptedAt,
          dispatcherAudience,
          allowedRunnerAudiences
        });
        const material = buildDiagnosticDispatchAuthorization({
          authorizationId,
          installationId,
          environmentId,
          evaluation,
          eligibility: boundEligibility,
          dispatcher: actor,
          nonce,
          issuedAt: acceptedAt,
          decisionArtifactDigest: DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_DIGEST
        });
        const signed = signDiagnosticDispatchAuthorization(material.document, signing);
        const row = (await client.query(
          `INSERT INTO kernel_diagnostic_dispatch_authorizations
            (dispatch_authorization_id,installation_id,environment_id,assignment_id,
             assignment_digest,evidence_package_id,evidence_package_semantic_digest,
             evidence_package_artifact_digest,assignment_policy_activation_id,
             assignment_policy_activation_digest,worker_principal_id,worker_passport_id,
             worker_passport_configuration_digest,worker_run_id,dispatcher_type,dispatcher_id,
             dispatcher_audience,runner_audience,nonce_digest,eligibility_snapshot_digest,
             decision_artifact_digest,authorization_document,authorization_digest,
             signed_authorization,signed_authorization_digest,issued_at,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26,$27)
           RETURNING *`,
          [authorizationId, installationId, environmentId,
            material.document.assignment.assignment_id,
            material.document.assignment.assignment_digest,
            material.document.assignment.evidence_package_id,
            material.document.assignment.evidence_package_semantic_digest,
            material.document.assignment.evidence_package_artifact_digest,
            material.document.assignment.assignment_policy_activation_id,
            material.document.assignment.assignment_policy_activation_digest,
            material.document.worker.principal_id, material.document.worker.passport_id,
            material.document.worker.passport_configuration_digest,
            material.document.worker_run.worker_run_id, material.document.dispatcher.type,
            material.document.dispatcher.id, material.document.dispatcher.audience,
            material.document.runner_audience, material.document.nonce_digest,
            material.document.eligibility_snapshot_digest,
            material.document.decision_artifact_digest, material.document,
            material.authorization_digest, signed.signed, signed.signed_digest,
            material.document.temporal.issued_at, material.document.temporal.expires_at]
        )).rows[0];
        verifyRow(row);
        return {
          aggregateType: "diagnostic_dispatch_authorization",
          aggregateId: authorizationId,
          transitionType: "kernel.diagnostic_dispatch.authorized",
          transitionPayload: {
            dispatch_authorization_id: authorizationId,
            authorization_digest: material.authorization_digest,
            assignment_id: material.document.assignment.assignment_id,
            assignment_digest: material.document.assignment.assignment_digest,
            evidence_package_id: material.document.assignment.evidence_package_id,
            worker_run_id: material.document.worker_run.worker_run_id,
            worker_passport_id: material.document.worker.passport_id,
            runner_audience: material.document.runner_audience,
            expires_at: material.document.temporal.expires_at,
            external_business_effect_authority: "none"
          },
          result: { diagnostic_dispatch_authorization: authorizationView(row) }
        };
      }
    });
  }

  async function getAuthorization(authorizationId) {
    if (typeof authorizationId !== "string" || !UUID.test(authorizationId)) {
      throw new KernelError(400, "DIAGNOSTIC_DISPATCH_INPUT_INVALID",
        "dispatch_authorization_id must be a UUID.");
    }
    const row = (await pool.query(
      `SELECT * FROM kernel_diagnostic_dispatch_authorizations
       WHERE installation_id=$1 AND environment_id=$2 AND dispatch_authorization_id=$3`,
      [installationId, environmentId, authorizationId]
    )).rows[0];
    verifyRow(row);
    return authorizationView(row);
  }

  return { authorize, getAuthorization };
}
