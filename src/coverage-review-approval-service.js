import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  buildCoverageReviewApproval,
  COVERAGE_REVIEW_AUTHORITY_DENIED,
  COVERAGE_REVIEW_AUTHORITY_GRANTED,
  validateCoverageReviewApproveCommand
} from "./coverage-review-contracts.js";
import { KernelError } from "./errors.js";
import { isAuthorizedOwner } from "./trusted-operator.js";

function requestDigest(installationId, environmentId, command) {
  return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
}

function executionActor(actor) {
  return { type: actor.type, id: actor.id };
}

export function createCoverageReviewApprovalService({ database, identityIntent, coverageReviewService,
  installationId, environmentId }) {
  const { pool, executeCommand } = database;

  async function principalFor(actor, client = pool) {
    if (!isAuthorizedOwner(actor)) {
      throw new KernelError(403, "COVERAGE_REVIEW_HUMAN_APPROVAL_REQUIRED",
        "Coverage Review Approval requires one named customer human Principal.");
    }
    const humanId = actor.type === "human" ? actor.id : actor.authorization?.authorized_by?.id;
    if (typeof humanId !== "string" || humanId.length === 0) {
      throw new KernelError(403, "COVERAGE_REVIEW_HUMAN_APPROVAL_REQUIRED",
        "Trusted-operator approval must retain its exact named human authorizer.");
    }
    const principal = (await client.query(
      `SELECT principal_id,principal_type FROM kernel_principals
       WHERE installation_id=$1 AND environment_id=$2
         AND (principal_id::text=$3 OR external_subject=$3)`,
      [installationId, environmentId, humanId]
    )).rows[0];
    if (!principal || principal.principal_type !== "human") {
      throw new KernelError(403, "COVERAGE_REVIEW_HUMAN_PRINCIPAL_INVALID",
        "Approval authorizer must resolve to one named human Kernel Principal.");
    }
    return principal.principal_id;
  }

  function rowView(row, bundleState = null) {
    if (sha256Digest(row.approval_document) !== row.approval_digest
        || row.approval_document.approval_id !== row.approval_id
        || row.approval_document.onboarding_id !== row.onboarding_id
        || row.approval_document.review_bundle_digest !== row.review_bundle_digest
        || row.approval_document.review_state_digest !== row.review_state_digest
        || sha256Digest(row.review_state) !== row.review_state_digest
        || row.approval_document.work_intent_id !== row.work_intent_id
        || row.approval_document.work_intent_digest !== row.work_intent_digest
        || canonicalize(row.approval_document.scope) !== canonicalize(row.approval_scope)
        || row.approval_document.rationale !== row.rationale
        || row.approval_document.principal_id !== row.principal_id
        || row.approval_document.issued_at !== new Date(row.issued_at).toISOString()
        || row.approval_document.valid_until !== (row.valid_until === null
          ? null : new Date(row.valid_until).toISOString())
        || canonicalize(row.approval_document.authority_granted)
          !== canonicalize(row.authority_granted)
        || canonicalize(row.approval_document.authority_denied)
          !== canonicalize(row.authority_denied)
        || canonicalize(row.approval_document.executed_by)
          !== canonicalize({ type: row.executed_by_actor_type, id: row.executed_by_actor_id })
        || canonicalize(row.authority_granted) !== canonicalize(COVERAGE_REVIEW_AUTHORITY_GRANTED)
        || canonicalize(row.authority_denied) !== canonicalize(COVERAGE_REVIEW_AUTHORITY_DENIED)) {
      throw new KernelError(500, "COVERAGE_REVIEW_APPROVAL_INTEGRITY_VIOLATION",
        "Coverage Review Approval row does not match its immutable exact document.");
    }
    const expired = row.valid_until !== null && Date.now() >= Date.parse(row.valid_until);
    const current = bundleState !== null
      && bundleState.review_bundle.review_bundle_digest === row.review_bundle_digest
      && bundleState.onboarding.active_review_bundle_digest === row.review_bundle_digest;
    const eligible = current && !expired;
    return {
      approval_id: row.approval_id,
      approval_digest: row.approval_digest,
      onboarding_id: row.onboarding_id,
      review_bundle_digest: row.review_bundle_digest,
      review_state: row.review_state,
      review_state_digest: row.review_state_digest,
      work_intent_id: row.work_intent_id,
      work_intent_digest: row.work_intent_digest,
      scope: row.approval_scope,
      rationale: row.rationale,
      principal_id: row.principal_id,
      executed_by: { type: row.executed_by_actor_type, id: row.executed_by_actor_id },
      issued_at: new Date(row.issued_at).toISOString(),
      valid_until: row.valid_until === null ? null : new Date(row.valid_until).toISOString(),
      status: expired ? "expired" : eligible ? "eligible" : "review_required",
      eligibility: {
        compile_exact_bundle: eligible,
        request_exact_registration: eligible,
        authority_granted: eligible ? [...COVERAGE_REVIEW_AUTHORITY_GRANTED] : [],
        authority_denied: [...COVERAGE_REVIEW_AUTHORITY_DENIED]
      },
      document: row.approval_document,
      immutable: true
    };
  }

  async function loadRow(approvalId, client = pool) {
    const row = (await client.query(
      `SELECT * FROM kernel_coverage_review_approvals
       WHERE installation_id=$1 AND environment_id=$2 AND approval_id=$3`,
      [installationId, environmentId, approvalId]
    )).rows[0];
    if (!row) throw new KernelError(404, "COVERAGE_REVIEW_APPROVAL_NOT_FOUND",
      "Coverage Review Approval does not exist.");
    return row;
  }

  async function get(approvalId) {
    const row = await loadRow(approvalId);
    let bundleState = null;
    try {
      bundleState = await coverageReviewService.getBundleState(row.review_bundle_digest);
    } catch (error) {
      if (!(error instanceof KernelError) || error.code !== "COVERAGE_REVIEW_BUNDLE_NOT_CURRENT") throw error;
    }
    return rowView(row, bundleState);
  }

  async function approve(value, ownerActor) {
    const envelope = validateCoverageReviewApproveCommand(value);
    if (!isAuthorizedOwner(ownerActor)) {
      throw new KernelError(403, "COVERAGE_REVIEW_HUMAN_APPROVAL_REQUIRED",
        "Coverage Review Approval requires one named customer human Principal.");
    }
    const command = { ...envelope, actor: ownerActor };
    const digest = requestDigest(installationId, environmentId, command);
    const existing = await pool.query(
      `SELECT request_digest,result FROM kernel_commands
       WHERE installation_id=$1 AND environment_id=$2 AND command_id=$3`,
      [installationId, environmentId, command.command_id]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_digest !== digest) {
        throw new KernelError(409, "IDEMPOTENCY_CONFLICT", "Command ID was reused with different input.");
      }
      return { replayed: true, result: existing.rows[0].result };
    }
    const bundleState = await coverageReviewService.getBundleState(envelope.input.review_bundle_digest);
    const workIntent = await identityIntent.getWorkIntent(envelope.input.work_intent_id);
    const approvalId = randomUUID();
    return executeCommand({
      installationId,
      environmentId,
      command,
      requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        const principalId = await principalFor(ownerActor, client);
        const currentBundleState = await coverageReviewService.getBundleState(
          envelope.input.review_bundle_digest);
        const currentIntent = await identityIntent.getWorkIntent(envelope.input.work_intent_id, client);
        if (currentIntent.payload_digest !== workIntent.payload_digest
            || currentBundleState.onboarding.event_head_digest !== bundleState.onboarding.event_head_digest) {
          throw new KernelError(409, "COVERAGE_REVIEW_APPROVAL_STATE_CONFLICT",
            "Review material or Work Intent changed before Kernel approval admission.");
        }
        const built = buildCoverageReviewApproval({ approvalId, bundleState: currentBundleState,
          workIntent: currentIntent, input: envelope.input, principalId,
          executedBy: executionActor(ownerActor), issuedAt: acceptedAt });
        await client.query(
          `INSERT INTO kernel_coverage_review_approvals
            (approval_id,installation_id,environment_id,onboarding_id,review_bundle_digest,
             review_state,review_state_digest,work_intent_id,work_intent_digest,approval_scope,
             rationale,authority_granted,authority_denied,principal_id,executed_by_actor_type,
             executed_by_actor_id,approval_document,approval_digest,issued_at,valid_until)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [approvalId, installationId, environmentId, envelope.input.onboarding_id,
            envelope.input.review_bundle_digest, built.document.review_state,
            built.document.review_state_digest, envelope.input.work_intent_id,
            currentIntent.payload_digest, envelope.input.scope, envelope.input.rationale,
            JSON.stringify(envelope.input.authority_granted),
            JSON.stringify(envelope.input.authority_denied), principalId,
            ownerActor.type, ownerActor.id, built.document, built.approval_digest,
            acceptedAt, envelope.input.valid_until]
        );
        const row = await loadRow(approvalId, client);
        return {
          aggregateType: "coverage_review_approval",
          aggregateId: approvalId,
          transitionType: "kernel.coverage_review.approved",
          fromRevision: 0,
          toRevision: 1,
          transitionPayload: { onboarding_id: envelope.input.onboarding_id,
            review_bundle_digest: envelope.input.review_bundle_digest,
            approval_digest: built.approval_digest },
          result: { coverage_review_approval: rowView(row, currentBundleState), created: true }
        };
      }
    });
  }

  async function assertEligible(approvalId, reviewBundleDigest) {
    const approval = await get(approvalId);
    if (approval.review_bundle_digest !== reviewBundleDigest || approval.status !== "eligible") {
      throw new KernelError(409, "COVERAGE_REVIEW_APPROVAL_NOT_ELIGIBLE",
        "Exact Coverage Review Approval is not currently eligible.");
    }
    return approval;
  }

  return { approve, get, assertEligible };
}
