import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  buildCoverageReviewBundle,
  validateCoverageReviewBundleCreateCommand
} from "./coverage-review-contracts.js";
import { KernelError } from "./errors.js";

function requestDigest(installationId, environmentId, command) {
  return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
}

function actorFor(passport) {
  return { type: "agent", id: passport.agent_principal_id };
}

function view(row, stored) {
  const content = stored.content;
  if (stored.artifact.artifact_digest !== row.review_bundle_digest
      || sha256Digest(content) !== row.review_bundle_digest
      || content.onboarding_id !== row.onboarding_id
      || content.onboarding_revision !== Number(row.base_onboarding_revision)
      || content.event_head_digest !== row.base_event_head_digest
      || content.snapshot_digest !== row.snapshot_digest
      || content.interpretation_digest !== row.interpretation_digest
      || sha256Digest(content.confirmation_digests) !== row.confirmation_manifest_digest
      || content.reference_manifest_digest !== row.reference_manifest_digest) {
    throw new KernelError(500, "COVERAGE_REVIEW_INTEGRITY_VIOLATION",
      "Coverage Review Bundle row and verified content-addressed bytes do not match.");
  }
  return {
    review_bundle_id: row.review_bundle_id,
    review_bundle_digest: row.review_bundle_digest,
    size_bytes: stored.artifact.size_bytes,
    media_type: stored.artifact.media_type,
    onboarding_id: row.onboarding_id,
    onboarding_revision: Number(row.base_onboarding_revision),
    event_head_digest: row.base_event_head_digest,
    workflow_reference_digest: content.workflow_reference_digest,
    snapshot_digest: row.snapshot_digest,
    interpretation_digest: row.interpretation_digest,
    confirmation_manifest_digest: row.confirmation_manifest_digest,
    reference_manifest_digest: row.reference_manifest_digest,
    content,
    created_by: { type: row.created_by_actor_type, id: row.created_by_actor_id },
    created_at: new Date(row.created_at).toISOString(),
    authority: "none",
    immutable: true
  };
}

export function createCoverageReviewService({ database, artifactStore, coverageOnboardingService,
  installationId, environmentId }) {
  const { pool, executeCommand } = database;
  const coverageInternal = coverageOnboardingService?.internal;
  if (!coverageInternal) throw new Error("Coverage Onboarding internal persistence seam is required.");

  async function commandReplay(command, digest) {
    const existing = await pool.query(
      `SELECT request_digest,result FROM diagnostic_commands
       WHERE installation_id=$1 AND command_id=$2`, [installationId, command.command_id]
    );
    if (!existing.rows[0]) return null;
    if (existing.rows[0].request_digest !== digest) {
      throw new KernelError(409, "IDEMPOTENCY_CONFLICT",
        "Diagnostic command ID was reused with different input.");
    }
    return { replayed: true, result: existing.rows[0].result };
  }

  async function loadRow(reference, client = pool) {
    const result = await client.query(
      `SELECT * FROM diagnostic_coverage_review_bundles
       WHERE installation_id=$1 AND (review_bundle_digest=$2 OR review_bundle_id::text=$2)`,
      [installationId, reference]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "COVERAGE_REVIEW_BUNDLE_NOT_FOUND",
        "Coverage Review Bundle does not exist.");
    }
    return result.rows[0];
  }

  async function get(reference, client = pool) {
    const row = await loadRow(reference, client);
    return view(row, await artifactStore.getJson(row.review_bundle_digest));
  }

  async function assertReferences(input, client = pool) {
    const references = [
      ...input.integration_contract_references,
      ...input.behavior_contract_references,
      ...input.fixture_references,
      ...(input.repair_binding_reference ? [input.repair_binding_reference] : []),
      ...(input.verification_strategy_reference ? [input.verification_strategy_reference] : []),
      ...(input.coverage_profile_reference ? [input.coverage_profile_reference] : [])
    ];
    for (const reference of references) {
      const admitted = await client.query(
        `SELECT artifact_digest FROM diagnostic_artifacts
         WHERE installation_id=$1 AND artifact_digest=$2`,
        [installationId, reference.artifact_digest]
      );
      if (!admitted.rows[0]) {
        throw new KernelError(409, "COVERAGE_REVIEW_REFERENCE_NOT_ADMITTED",
          "Every review reference must identify exact admitted Diagnostic artifact bytes.", { reference });
      }
      await artifactStore.getJson(reference.artifact_digest);
    }
  }

  async function create(value, authenticatedPassport) {
    const envelope = validateCoverageReviewBundleCreateCommand(value);
    const actor = actorFor(authenticatedPassport);
    const command = { ...envelope, actor };
    const digest = requestDigest(installationId, environmentId, command);
    const replay = await commandReplay(command, digest);
    if (replay) return replay;
    const onboarding = await coverageInternal.loadOnboarding(envelope.input.onboarding_id);
    if (onboarding.environment_id !== environmentId
        || onboarding.agent.passport_id !== authenticatedPassport.passport_id
        || onboarding.agent.agent_principal_id !== authenticatedPassport.agent_principal_id) {
      throw new KernelError(403, "COVERAGE_REVIEW_AGENT_MISMATCH",
        "Authenticated Passport does not match the exact Coverage Onboarding agent.");
    }
    await assertReferences(envelope.input);
    const snapshot = await artifactStore.getJson(envelope.input.snapshot_digest);
    const interpretation = await artifactStore.getJson(envelope.input.interpretation_digest);
    const built = buildCoverageReviewBundle({ onboarding, snapshot: snapshot.content,
      interpretation: interpretation.content, input: envelope.input });
    const stored = await artifactStore.putJson(built.document);
    const reviewBundleId = randomUUID();
    return executeCommand({
      installationId,
      command,
      requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-onboarding:${onboarding.onboarding_id}`
        ]);
        const current = await coverageInternal.loadOnboarding(onboarding.onboarding_id, client);
        buildCoverageReviewBundle({ onboarding: current, snapshot: snapshot.content,
          interpretation: interpretation.content, input: envelope.input });
        await assertReferences(envelope.input, client);
        await client.query(
          `INSERT INTO diagnostic_artifacts
            (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
          [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
            stored.storage_key, acceptedAt]
        );
        const eventIndex = current.revision + 1;
        await client.query(
          `INSERT INTO diagnostic_coverage_review_bundles
            (review_bundle_id,installation_id,onboarding_id,base_onboarding_revision,
             base_event_head_digest,snapshot_digest,interpretation_digest,review_bundle_digest,
             confirmation_manifest_digest,reference_manifest_digest,event_index,
             created_by_actor_type,created_by_actor_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [reviewBundleId, installationId, current.onboarding_id, current.revision,
            current.event_head_digest, current.active_snapshot_digest,
            current.active_interpretation_digest, stored.artifact_digest,
            built.confirmation_manifest_digest, built.reference_manifest_digest, eventIndex,
            actor.type, actor.id, acceptedAt]
        );
        const payload = {
          review_bundle_digest: stored.artifact_digest,
          snapshot_digest: current.active_snapshot_digest,
          interpretation_digest: current.active_interpretation_digest,
          confirmation_manifest_digest: built.confirmation_manifest_digest,
          reference_manifest_digest: built.reference_manifest_digest,
          authority: "none"
        };
        await coverageInternal.appendEvent(client, {
          onboardingId: current.onboarding_id,
          eventIndex,
          eventType: "review_bundle_created",
          priorEventDigest: current.event_head_digest,
          payload,
          actor,
          occurredAt: acceptedAt
        });
        const projection = await coverageInternal.loadOnboarding(current.onboarding_id, client);
        const row = await loadRow(stored.artifact_digest, client);
        return {
          aggregateType: "coverage_onboarding",
          aggregateId: current.onboarding_id,
          transitionType: "diagnostic.coverage_review_bundle.created",
          fromRevision: current.revision,
          toRevision: projection.revision,
          transitionPayload: payload,
          result: { coverage_onboarding: projection,
            coverage_review_bundle: view(row, { artifact: {
              artifact_digest: stored.artifact_digest, size_bytes: stored.size_bytes,
              media_type: stored.media_type }, content: built.document }), created: true }
        };
      }
    });
  }

  async function getBundleState(reference) {
    const reviewBundle = await get(reference);
    const onboarding = await coverageInternal.loadOnboarding(reviewBundle.onboarding_id);
    if (onboarding.status !== "awaiting_approval"
        || onboarding.active_review_bundle_digest !== reviewBundle.review_bundle_digest) {
      throw new KernelError(409, "COVERAGE_REVIEW_BUNDLE_NOT_CURRENT",
        "Coverage Review Bundle is historical and no longer approval-eligible.");
    }
    return { review_bundle: reviewBundle, onboarding };
  }

  return { create, get, getBundleState };
}
