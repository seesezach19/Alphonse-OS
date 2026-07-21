import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  buildCoverageOnboardingEvent,
  buildWorkflowDiscoverySnapshot,
  coverageOnboardingIdentity,
  projectCoverageOnboarding,
  validateCoverageEvidenceCaptureCommand,
  validateCoverageOnboardingOpenCommand
} from "./coverage-onboarding-contracts.js";
import { KernelError } from "./errors.js";

const AUTHORIZED_INTENT_CLASS = "workflow_coverage_onboarding";

function actorFor(passport) {
  return { type: "agent", id: passport.agent_principal_id };
}

function requestDigest(installationId, environmentId, command) {
  return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function assertIntentBoundary(workIntent, input) {
  if (workIntent.intent_class !== AUTHORIZED_INTENT_CLASS
      || workIntent.passport_id !== input.passport_id
      || workIntent.agent_principal_id !== input.agent_principal_id) {
    throw new KernelError(409, "COVERAGE_ONBOARDING_INTENT_MISMATCH",
      "Coverage Onboarding requires its exact confirmed Work Intent, Passport, and agent Principal.");
  }
  const scope = workIntent.scope;
  if (!scope || scope.kind !== "workflow_coverage_onboarding"
      || scope.environment_id !== input.environment_id
      || scope.system !== input.workflow_reference.system
      || scope.environment !== input.workflow_reference.environment
      || scope.provider_workflow_id !== input.workflow_reference.provider_workflow_id) {
    throw new KernelError(409, "COVERAGE_ONBOARDING_INTENT_SCOPE_MISMATCH",
      "Confirmed Work Intent scope does not bind the exact onboarding workflow and environment.");
  }
  const constraints = workIntent.constraints;
  if (!constraints || constraints.provider_access_custody !== "adapter_only"
      || constraints.external_effects !== "prohibited"
      || constraints.registration !== "prohibited") {
    throw new KernelError(409, "COVERAGE_ONBOARDING_INTENT_CONSTRAINTS_REQUIRED",
      "Confirmed Work Intent must keep provider access at the adapter and prohibit external effects and registration.");
  }
}

function assertAdapterBinding(binding, configured) {
  if (!configured || binding.adapter_id !== configured.adapter_id
      || binding.adapter_version !== configured.adapter_version
      || binding.contract_version !== configured.contract_version) {
    throw new KernelError(409, "COVERAGE_ONBOARDING_ADAPTER_BINDING_MISMATCH",
      "Coverage Onboarding adapter binding does not match the configured runtime adapter.");
  }
}

export function createCoverageInventoryClient({ baseUrl, token, fetchImpl = fetch }) {
  const endpoint = typeof baseUrl === "string" ? baseUrl.replace(/\/$/, "") : null;
  return {
    async list(input) {
      if (!endpoint || typeof token !== "string" || token.length === 0) {
        throw new KernelError(503, "COVERAGE_INVENTORY_CLIENT_UNAVAILABLE",
          "Workflow inventory adapter access is not configured.");
      }
      let response;
      try {
        response = await fetchImpl(`${endpoint}/v0/workflow-inventory:list`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(input)
        });
      } catch {
        throw new KernelError(502, "COVERAGE_INVENTORY_READ_FAILED",
          "Workflow inventory adapter could not be reached.");
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new KernelError(502, "COVERAGE_INVENTORY_RESPONSE_INVALID",
          "Workflow inventory adapter returned invalid JSON.");
      }
      if (!response.ok) {
        throw new KernelError(502, "COVERAGE_INVENTORY_READ_FAILED",
          "Workflow inventory adapter rejected the bounded read.", {
            adapter_status: response.status,
            adapter_code: body?.error?.code ?? "UNKNOWN"
          });
      }
      return body;
    }
  };
}

export function createCoverageOnboardingService({ database, artifactStore, identityIntent,
  inventoryClient, installationId, environmentId, runtimeAdapter }) {
  const { pool, executeCommand } = database;

  async function commandReplay(command, digest) {
    const existing = await pool.query(
      `SELECT request_digest,result FROM diagnostic_commands
       WHERE installation_id=$1 AND command_id=$2`, [installationId, command.command_id]
    );
    if (!existing.rows[0]) return null;
    if (existing.rows[0].request_digest !== digest) {
      throw new KernelError(409, "IDEMPOTENCY_CONFLICT",
        "Diagnostic command ID was reused with different input.", {
          command_id: command.command_id,
          accepted_request_digest: existing.rows[0].request_digest,
          received_request_digest: digest
        });
    }
    return { replayed: true, result: existing.rows[0].result };
  }

  async function loadOnboarding(onboardingId, client = pool) {
    const row = (await client.query(
      `SELECT * FROM diagnostic_coverage_onboardings
       WHERE installation_id=$1 AND onboarding_id=$2`, [installationId, onboardingId]
    )).rows[0];
    if (!row) {
      throw new KernelError(404, "COVERAGE_ONBOARDING_NOT_FOUND",
        "Coverage Onboarding does not exist.");
    }
    const identity = coverageOnboardingIdentity({
      environment_id: row.environment_id,
      reason: row.reason,
      prior_onboarding_id: row.prior_onboarding_id,
      work_intent_id: row.work_intent_id,
      passport_id: row.passport_id,
      agent_principal_id: row.agent_principal_id,
      workflow_reference: row.workflow_reference,
      adapter_binding: row.adapter_binding
    }, row.work_intent_digest);
    if (sha256Digest(identity) !== row.identity_digest
        || identity.workflow_reference_digest !== row.workflow_reference_digest
        || identity.adapter_binding_digest !== row.adapter_binding_digest) {
      throw new KernelError(500, "COVERAGE_ONBOARDING_INTEGRITY_VIOLATION",
        "Coverage Onboarding identity does not match its immutable digest.");
    }
    const events = (await client.query(
      `SELECT * FROM diagnostic_coverage_onboarding_events
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY event_index`,
      [installationId, onboardingId]
    )).rows;
    const snapshots = (await client.query(
      `SELECT * FROM diagnostic_workflow_discovery_snapshots
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY event_index`,
      [installationId, onboardingId]
    )).rows;
    const interpretations = (await client.query(
      `SELECT * FROM diagnostic_workflow_interpretations
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY event_index`,
      [installationId, onboardingId]
    )).rows;
    const ambiguities = (await client.query(
      `SELECT * FROM diagnostic_coverage_ambiguities
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY projected_event_index,ambiguity_id`,
      [installationId, onboardingId]
    )).rows;
    const resolutions = (await client.query(
      `SELECT * FROM diagnostic_coverage_ambiguity_resolutions
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY resolved_event_index`,
      [installationId, onboardingId]
    )).rows;
    const assignments = (await client.query(
      `SELECT * FROM diagnostic_coverage_interpretation_assignments
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY assigned_at,assignment_id`,
      [installationId, onboardingId]
    )).rows;
    const reviewBundles = (await client.query(
      `SELECT * FROM diagnostic_coverage_review_bundles
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY event_index`,
      [installationId, onboardingId]
    )).rows;
    return projectCoverageOnboarding(row, events, snapshots, interpretations, ambiguities,
      resolutions, assignments, reviewBundles);
  }

  async function appendEvent(client, { onboardingId, eventIndex, eventType, priorEventDigest,
    payload, actor, occurredAt }) {
    const eventId = randomUUID();
    const built = buildCoverageOnboardingEvent({
      eventId, onboardingId, eventIndex, eventType, priorEventDigest, payload, actor, occurredAt
    });
    await client.query(
      `INSERT INTO diagnostic_coverage_onboarding_events
        (event_id,installation_id,onboarding_id,event_index,event_type,prior_event_digest,event_digest,
         payload,actor_type,actor_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [eventId, installationId, onboardingId, eventIndex, eventType, priorEventDigest,
        built.event_digest, payload, actor.type, actor.id, occurredAt]
    );
    return built.event_digest;
  }

  async function appendReviewInvalidation(client, { current, eventIndex, priorEventDigest, trigger,
    priorMaterialDigest, replacementMaterialDigest, actor, occurredAt }) {
    if (!current.active_review_bundle_digest) return { appended: false, event_digest: priorEventDigest };
    const payload = {
      prior_review_bundle_digest: current.active_review_bundle_digest,
      trigger,
      prior_material_digest: priorMaterialDigest,
      replacement_material_digest: replacementMaterialDigest,
      reason: "Material changed after immutable review bundle assembly.",
      eligibility_revoked: ["compile_exact_bundle", "request_exact_registration"],
      authority: "none"
    };
    const eventDigest = await appendEvent(client, {
      onboardingId: current.onboarding_id,
      eventIndex,
      eventType: "review_invalidated",
      priorEventDigest,
      payload,
      actor,
      occurredAt
    });
    return { appended: true, event_digest: eventDigest };
  }

  async function open(value, authenticatedPassport) {
    const envelope = validateCoverageOnboardingOpenCommand(value);
    if (envelope.input.environment_id !== environmentId
        || envelope.input.passport_id !== authenticatedPassport.passport_id
        || envelope.input.agent_principal_id !== authenticatedPassport.agent_principal_id) {
      throw new KernelError(403, "COVERAGE_ONBOARDING_AUTHENTICATION_MISMATCH",
        "Authenticated Passport does not match the exact onboarding identity.");
    }
    const actor = actorFor(authenticatedPassport);
    const command = { ...envelope, actor };
    const digest = requestDigest(installationId, environmentId, command);
    const replay = await commandReplay(command, digest);
    if (replay) return replay;
    assertAdapterBinding(envelope.input.adapter_binding, runtimeAdapter);
    const workIntent = await identityIntent.getWorkIntent(envelope.input.work_intent_id);
    assertIntentBoundary(workIntent, envelope.input);
    if (envelope.input.prior_onboarding_id) {
      const prior = await loadOnboarding(envelope.input.prior_onboarding_id);
      if (!same(prior.workflow_reference, envelope.input.workflow_reference)) {
        throw new KernelError(409, "COVERAGE_ONBOARDING_PRIOR_MISMATCH",
          "Revision-change onboarding must link the same exact external workflow.");
      }
    }
    const onboardingId = randomUUID();
    const identity = coverageOnboardingIdentity(envelope.input, workIntent.payload_digest);
    const identityDigest = sha256Digest(identity);
    return executeCommand({
      installationId,
      command,
      requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-onboarding:${identityDigest}`
        ]);
        const existing = (await client.query(
          `SELECT onboarding_id FROM diagnostic_coverage_onboardings
           WHERE installation_id=$1 AND identity_digest=$2 ORDER BY opened_at LIMIT 1`,
          [installationId, identityDigest]
        )).rows[0];
        if (existing) {
          const projection = await loadOnboarding(existing.onboarding_id, client);
          return {
            aggregateType: "coverage_onboarding",
            aggregateId: existing.onboarding_id,
            transitionType: "diagnostic.coverage_onboarding.reused",
            fromRevision: projection.revision,
            toRevision: projection.revision,
            transitionPayload: { identity_digest: identityDigest, created: false },
            result: { coverage_onboarding: projection, created: false }
          };
        }
        await client.query(
          `INSERT INTO diagnostic_coverage_onboardings
            (onboarding_id,installation_id,environment_id,reason,prior_onboarding_id,workflow_reference,
             workflow_reference_digest,work_intent_id,work_intent_digest,passport_id,agent_principal_id,
             adapter_binding,adapter_binding_digest,identity_digest,opened_by_actor_type,opened_by_actor_id,opened_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [onboardingId, installationId, environmentId, envelope.input.reason,
            envelope.input.prior_onboarding_id, envelope.input.workflow_reference,
            identity.workflow_reference_digest, envelope.input.work_intent_id, workIntent.payload_digest,
            envelope.input.passport_id, envelope.input.agent_principal_id, envelope.input.adapter_binding,
            identity.adapter_binding_digest, identityDigest, actor.type, actor.id, acceptedAt]
        );
        await appendEvent(client, {
          onboardingId,
          eventIndex: 1,
          eventType: "opened",
          priorEventDigest: null,
          payload: { identity_digest: identityDigest, work_intent_digest: workIntent.payload_digest },
          actor,
          occurredAt: acceptedAt
        });
        const projection = await loadOnboarding(onboardingId, client);
        return {
          aggregateType: "coverage_onboarding",
          aggregateId: onboardingId,
          transitionType: "diagnostic.coverage_onboarding.opened",
          fromRevision: 0,
          toRevision: 1,
          transitionPayload: { identity_digest: identityDigest, created: true },
          result: { coverage_onboarding: projection, created: true }
        };
      }
    });
  }

  async function captureEvidence(value, authenticatedPassport) {
    const envelope = validateCoverageEvidenceCaptureCommand(value);
    if (envelope.input.passport_id !== authenticatedPassport.passport_id) {
      throw new KernelError(403, "COVERAGE_ONBOARDING_AUTHENTICATION_MISMATCH",
        "Authenticated Passport does not match evidence capture input.");
    }
    const actor = actorFor(authenticatedPassport);
    const command = { ...envelope, actor };
    const digest = requestDigest(installationId, environmentId, command);
    const replay = await commandReplay(command, digest);
    if (replay) return replay;
    const before = await loadOnboarding(envelope.input.onboarding_id);
    if (before.agent.passport_id !== authenticatedPassport.passport_id
        || before.agent.agent_principal_id !== authenticatedPassport.agent_principal_id) {
      throw new KernelError(403, "COVERAGE_ONBOARDING_AUTHENTICATION_MISMATCH",
        "Authenticated Passport does not own this Coverage Onboarding.");
    }
    if (before.revision !== envelope.input.expected_revision) {
      throw new KernelError(409, "COVERAGE_ONBOARDING_REVISION_CONFLICT",
        "Coverage Onboarding revision changed before evidence capture.", {
          expected_revision: envelope.input.expected_revision,
          current_revision: before.revision
        });
    }
    if (!inventoryClient) {
      throw new KernelError(503, "COVERAGE_INVENTORY_CLIENT_UNAVAILABLE",
        "Workflow inventory adapter access is not configured.");
    }
    const inventory = await inventoryClient.list(envelope.input.inventory_request);
    const snapshot = buildWorkflowDiscoverySnapshot({ onboarding: before, input: envelope.input, inventory });
    const stored = await artifactStore.putJson(snapshot);
    return executeCommand({
      installationId,
      command,
      requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-onboarding:${envelope.input.onboarding_id}`
        ]);
        const current = await loadOnboarding(envelope.input.onboarding_id, client);
        if (current.revision !== envelope.input.expected_revision) {
          throw new KernelError(409, "COVERAGE_ONBOARDING_REVISION_CONFLICT",
            "Coverage Onboarding revision changed before snapshot admission.", {
              expected_revision: envelope.input.expected_revision,
              current_revision: current.revision
            });
        }
        await client.query(
          `INSERT INTO diagnostic_artifacts
            (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
          [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
            stored.storage_key, acceptedAt]
        );
        const eventIndex = current.revision + 1;
        const previousDigest = current.active_snapshot_digest;
        const eventType = previousDigest === null ? "evidence_captured"
          : previousDigest === stored.artifact_digest ? "evidence_reused" : "snapshot_replaced";
        if (eventType !== "evidence_reused") {
          await client.query(
            `INSERT INTO diagnostic_workflow_discovery_snapshots
              (installation_id,onboarding_id,snapshot_digest,source_scope_digest,source_page_digest,
               selected_metadata_digest,event_index,captured_by_actor_type,captured_by_actor_id,captured_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [installationId, current.onboarding_id, stored.artifact_digest,
              snapshot.provenance.scope_digest, snapshot.provenance.page_digest,
              snapshot.provenance.selected_metadata_digest, eventIndex, actor.type, actor.id, acceptedAt]
          );
        }
        const payload = {
          snapshot_digest: stored.artifact_digest,
          source_scope_digest: snapshot.provenance.scope_digest,
          source_page_digest: snapshot.provenance.page_digest,
          selected_metadata_digest: snapshot.provenance.selected_metadata_digest,
          prior_snapshot_digest: eventType === "snapshot_replaced" ? previousDigest : null,
          prior_material_eligible: eventType !== "snapshot_replaced"
        };
        const eventDigest = await appendEvent(client, {
          onboardingId: current.onboarding_id,
          eventIndex,
          eventType,
          priorEventDigest: current.event_head_digest,
          payload,
          actor,
          occurredAt: acceptedAt
        });
        if (eventType === "snapshot_replaced") {
          await appendReviewInvalidation(client, {
            current,
            eventIndex: eventIndex + 1,
            priorEventDigest: eventDigest,
            trigger: "snapshot_replaced",
            priorMaterialDigest: previousDigest,
            replacementMaterialDigest: stored.artifact_digest,
            actor,
            occurredAt: acceptedAt
          });
        }
        const projection = await loadOnboarding(current.onboarding_id, client);
        return {
          aggregateType: "coverage_onboarding",
          aggregateId: current.onboarding_id,
          transitionType: `diagnostic.coverage_onboarding.${eventType}`,
          fromRevision: current.revision,
          toRevision: projection.revision,
          transitionPayload: { ...payload, event_digest: eventDigest },
          result: {
            coverage_onboarding: projection,
            workflow_discovery_snapshot: {
              artifact_digest: stored.artifact_digest,
              size_bytes: stored.size_bytes,
              media_type: stored.media_type,
              source_scope_digest: snapshot.provenance.scope_digest,
              source_page_digest: snapshot.provenance.page_digest,
              selected_metadata_digest: snapshot.provenance.selected_metadata_digest,
              authority: "none",
              immutable: true
            },
            created: eventType !== "evidence_reused",
            material_replaced: eventType === "snapshot_replaced"
          }
        };
      }
    });
  }

  return {
    open,
    captureEvidence,
    get: loadOnboarding,
    internal: Object.freeze({ loadOnboarding, appendEvent, appendReviewInvalidation })
  };
}
