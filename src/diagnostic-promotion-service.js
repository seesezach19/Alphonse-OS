import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { buildPromotionAuthorization, projectPromotion } from "./diagnostic-promotion-contracts.js";
import {
  requireDigest,
  requireExact,
  requireObject,
  requireString,
  requireUuid
} from "./diagnostic-repair-worker-contracts.js";
import { KernelError } from "./errors.js";
import { requireRepairDeliveryOperation } from "./repair-delivery-adapter-contract.js";
import { isAuthorizedOwner } from "./trusted-operator.js";

function parseCommand(value, operationId) {
  const envelope = requireExact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) {
    throw new KernelError(400, "UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  }
  return {
    command_id: requireString(envelope.command_id, "command_id", 160),
    operation_id: operationId,
    input: requireObject(envelope.input, "input")
  };
}

function requireOwner(actor) {
  if (!isAuthorizedOwner(actor) || !actor.id) {
    throw new KernelError(403, "OWNER_AUTHORITY_REQUIRED",
      "Promotion requires an authenticated customer Owner.");
  }
  return actor;
}

function bindingView(row) {
  return {
    binding_id: row.binding_id,
    adapter: { adapter_id: row.adapter_id, adapter_version: row.adapter_version },
    target: row.target,
    external_credential_binding_ref: row.external_credential_binding_ref,
    permitted_operations: row.permitted_operations,
    transition_policy: row.transition_policy
  };
}

function promotionView(row, events) {
  const normalizedEvents = events.map((event) => ({
    event_id: event.event_id,
    event_index: Number(event.event_index),
    event_type: event.event_type,
    detail: event.detail,
    actor: { type: event.actor_type, id: event.actor_id },
    occurred_at: event.occurred_at,
    immutable: true
  }));
  const latest = (eventType) => normalizedEvents.findLast((event) => event.event_type === eventType);
  const requested = latest("application_requested");
  const uncertain = latest("uncertain");
  const confirmed = latest("confirmed");
  const failed = latest("failed");
  const mismatch = latest("target_mismatch");
  const rollbackAuthorized = latest("rollback_authorized");
  const rolledBack = latest("rolled_back");
  return {
    promotion_id: row.promotion_id,
    case_id: row.case_id,
    candidate_id: row.candidate_id,
    delivery_id: row.delivery_id,
    verification_id: row.verification_id,
    binding_id: row.binding_id,
    authorization_digest: row.authorization_digest,
    expected_target_revision_digest: row.expected_target_revision_digest,
    candidate_target_revision_digest: row.candidate_target_revision_digest,
    verification_receipt_digest: row.verification_receipt_digest,
    owner: { type: row.owner_actor_type, id: row.owner_actor_id },
    idempotency_key: row.idempotency_key,
    authorized_at: row.authorized_at,
    application: requested ? {
      request_digest: requested.detail.application_request_digest,
      previous_target_revision_digest: requested.detail.previous_target_revision_digest,
      rollback_reference: requested.detail.rollback_reference,
      adapter_request_receipt: confirmed?.detail.adapter_request_receipt ??
        uncertain?.detail.adapter_request_receipt ?? null,
      requested_at: requested.occurred_at
    } : null,
    confirmation: confirmed ? {
      resulting_target_revision_digest: confirmed.detail.resulting_target_revision_digest,
      adapter_confirmation_receipt: confirmed.detail.adapter_confirmation_receipt,
      confirmed_at: confirmed.occurred_at
    } : null,
    uncertainty: uncertain ? {
      reason_code: uncertain.detail.reason_code,
      adapter_request_receipt: uncertain.detail.adapter_request_receipt,
      confirmation_missing: true,
      recorded_at: uncertain.occurred_at
    } : null,
    reconciliation: confirmed?.detail.reconciliation_receipt || failed?.detail.reconciliation_receipt ||
      mismatch?.detail.reconciliation_receipt ? {
        outcome: confirmed?.detail.reconciliation_outcome ?? failed?.detail.reconciliation_outcome ??
          mismatch?.detail.reconciliation_outcome,
        receipt: confirmed?.detail.reconciliation_receipt ?? failed?.detail.reconciliation_receipt ??
          mismatch?.detail.reconciliation_receipt,
        was_uncertain: true
      } : null,
    rollback: rollbackAuthorized ? {
      authorized_by: rollbackAuthorized.actor,
      expected_target_revision_digest: rollbackAuthorized.detail.expected_target_revision_digest,
      rollback_reference: rollbackAuthorized.detail.rollback_reference,
      request_receipt: rolledBack?.detail.adapter_request_receipt ?? null,
      confirmation_receipt: rolledBack?.detail.adapter_confirmation_receipt ?? null,
      authorized_at: rollbackAuthorized.occurred_at,
      rolled_back_at: rolledBack?.occurred_at ?? null
    } : null,
    failure: failed?.detail ?? mismatch?.detail ?? null,
    events: normalizedEvents,
    projection: projectPromotion(normalizedEvents),
    immutable: true
  };
}

export function createDiagnosticPromotionService({
  database, artifactStore, installationId, adapter, adapterManifest, credentialBindingRef
}) {
  const { pool, executeCommand } = database;

  function commandDigest(command) {
    return sha256Digest({ installation_id: installationId, ...command });
  }

  async function appendPromotionEvent(client, {
    promotionId, eventType, detail, actor, occurredAt
  }) {
    const index = await client.query(
      `SELECT COALESCE(MAX(event_index),0)+1 AS next_index
       FROM diagnostic_promotion_events WHERE installation_id=$1 AND promotion_id=$2`,
      [installationId, promotionId]
    );
    const eventIndex = Number(index.rows[0].next_index);
    await client.query(
      `INSERT INTO diagnostic_promotion_events
        (event_id,installation_id,promotion_id,event_index,event_type,detail,actor_type,actor_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), installationId, promotionId, eventIndex, eventType, detail,
        actor.type, actor.id, occurredAt]
    );
    return eventIndex;
  }

  async function getBinding(bindingId, client = pool) {
    const result = await client.query(
      `SELECT * FROM diagnostic_repair_delivery_bindings
       WHERE installation_id=$1 AND binding_id=$2`, [installationId, bindingId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "REPAIR_DELIVERY_BINDING_NOT_FOUND",
        "Promotion binding does not exist.");
    }
    return bindingView(result.rows[0]);
  }

  async function getCandidateTargetId(deliveryId, client = pool) {
    const result = await client.query(
      `SELECT target_candidate_id FROM diagnostic_repair_deliveries
       WHERE installation_id=$1 AND delivery_id=$2`, [installationId, deliveryId]
    );
    return result.rows[0]?.target_candidate_id;
  }

  function requireAdapter(binding) {
    if (!adapter) {
      throw new KernelError(503, "REPAIR_DELIVERY_ADAPTER_UNAVAILABLE",
        "Repair Delivery Adapter is not configured.");
    }
    if (binding.adapter.adapter_id !== adapterManifest.adapter_id ||
        binding.adapter.adapter_version !== adapterManifest.adapter_version) {
      throw new KernelError(409, "REPAIR_DELIVERY_ADAPTER_MISMATCH",
        "Promotion binding does not select the configured adapter.");
    }
    if (binding.external_credential_binding_ref !== credentialBindingRef) {
      throw new KernelError(409, "REPAIR_DELIVERY_CREDENTIAL_BINDING_UNAVAILABLE",
        "Promotion credential binding is unavailable to the adapter.");
    }
    return adapter;
  }

  async function getPromotion(promotionId, client = pool) {
    requireUuid(promotionId, "promotion_id");
    const result = await client.query(
      `SELECT * FROM diagnostic_promotions WHERE installation_id=$1 AND promotion_id=$2`,
      [installationId, promotionId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "PROMOTION_NOT_FOUND", "Promotion does not exist.");
    }
    const events = await client.query(
      `SELECT * FROM diagnostic_promotion_events
       WHERE installation_id=$1 AND promotion_id=$2 ORDER BY event_index`,
      [installationId, promotionId]
    );
    return promotionView(result.rows[0], events.rows);
  }

  async function sourceForAuthorization(client, candidateId, verificationId) {
    const result = await client.query(
      `SELECT c.case_id,c.candidate_artifact_digest,e.event_type AS candidate_status,
              d.*,v.overall_result,v.receipt_digest AS verification_receipt_digest,
              v.candidate_artifact_digest AS verified_candidate_artifact_digest,
              b.adapter_id,b.adapter_version,b.target,b.external_credential_binding_ref,
              b.permitted_operations,b.transition_policy
       FROM diagnostic_repair_candidates c
       JOIN LATERAL (
         SELECT event_type FROM diagnostic_repair_candidate_events
         WHERE installation_id=c.installation_id AND candidate_id=c.candidate_id
         ORDER BY event_index DESC LIMIT 1
       ) e ON true
       JOIN diagnostic_repair_deliveries d
         ON d.installation_id=c.installation_id AND d.candidate_id=c.candidate_id
       JOIN diagnostic_verification_receipts v
         ON v.installation_id=c.installation_id AND v.candidate_id=c.candidate_id
          AND v.delivery_id=d.delivery_id
       JOIN diagnostic_repair_delivery_bindings b
         ON b.installation_id=d.installation_id AND b.binding_id=d.binding_id
       WHERE c.installation_id=$1 AND c.candidate_id=$2 AND v.verification_id=$3
       FOR SHARE OF c,d,v,b`,
      [installationId, candidateId, verificationId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "PROMOTION_SOURCE_NOT_FOUND",
        "Exact candidate, delivery, and Verification Receipt were not found together.");
    }
    return result.rows[0];
  }

  async function authorizePromotion(value, actorValue) {
    const actor = requireOwner(actorValue);
    const envelope = parseCommand(value, "diagnostic.promotion.authorize");
    const raw = requireExact(envelope.input, "input", [
      "candidate_id", "verification_id", "expected_target_revision_digest", "idempotency_key"
    ]);
    const input = {
      candidate_id: requireUuid(raw.candidate_id, "candidate_id"),
      verification_id: requireUuid(raw.verification_id, "verification_id"),
      expected_target_revision_digest: requireDigest(raw.expected_target_revision_digest,
        "expected_target_revision_digest"),
      idempotency_key: requireString(raw.idempotency_key, "idempotency_key", 200)
    };
    const accepted = { ...envelope, input, actor };
    const requestDigest = sha256Digest({ input, owner: actor });
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: commandDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:promotion-authorization:${input.idempotency_key}`
        ]);
        const replay = await client.query(
          `SELECT * FROM diagnostic_promotion_idempotency
           WHERE installation_id=$1 AND idempotency_key=$2 FOR SHARE`,
          [installationId, input.idempotency_key]
        );
        if (replay.rows[0]) {
          if (replay.rows[0].request_digest !== requestDigest) {
            throw new KernelError(409, "PROMOTION_IDEMPOTENCY_CONFLICT",
              "Promotion idempotency key is already bound to different authorization material.");
          }
          return {
            aggregateType: "promotion", aggregateId: replay.rows[0].promotion_id,
            transitionType: "diagnostic.promotion.authorization_reused", fromRevision: 1, toRevision: 1,
            transitionPayload: { promotion_id: replay.rows[0].promotion_id },
            result: { promotion: await getPromotion(replay.rows[0].promotion_id, client), created: false }
          };
        }
        const source = await sourceForAuthorization(client, input.candidate_id, input.verification_id);
        if (source.candidate_status !== "verified" || source.overall_result !== "passed") {
          throw new KernelError(409, "PROMOTION_CANDIDATE_NOT_VERIFIED",
            "Only the current verified candidate with a passing receipt can be authorized.");
        }
        if (source.target_candidate_artifact_digest !== source.verified_candidate_artifact_digest) {
          throw new KernelError(409, "PROMOTION_VERIFICATION_ARTIFACT_MISMATCH",
            "Verification Receipt does not bind the current immutable candidate artifact.");
        }
        if (source.actual_base_revision_digest !== input.expected_target_revision_digest) {
          throw new KernelError(409, "PROMOTION_STALE_BASE",
            "Authorization expected target revision differs from the delivered candidate base.");
        }
        const binding = bindingView(source);
        for (const operation of ["inspect", "snapshot", "promotion", "confirmation"]) {
          requireRepairDeliveryOperation(binding, operation);
        }
        const selected = requireAdapter(binding);
        const target = await selected.inspect(binding.target);
        if (target.target_revision_digest !== input.expected_target_revision_digest) {
          throw new KernelError(409, "REPAIR_TARGET_DRIFT",
            "Target changed before Owner promotion authorization.", {
              expected_target_revision_digest: input.expected_target_revision_digest,
              current_target_revision_digest: target.target_revision_digest
            });
        }
        const promotionId = randomUUID();
        const authorization = buildPromotionAuthorization({
          promotionId,
          caseId: source.case_id,
          candidateId: input.candidate_id,
          deliveryId: source.delivery_id,
          verificationId: input.verification_id,
          binding: {
            binding_id: binding.binding_id,
            adapter: binding.adapter,
            target: binding.target
          },
          owner: actor,
          expectedTargetRevisionDigest: input.expected_target_revision_digest,
          candidateTargetRevisionDigest: source.target_candidate_revision_digest,
          verificationReceiptDigest: source.verification_receipt_digest,
          idempotencyKey: input.idempotency_key
        });
        const inserted = await client.query(
          `INSERT INTO diagnostic_promotions
            (promotion_id,installation_id,case_id,candidate_id,delivery_id,verification_id,binding_id,
             authorization_digest,expected_target_revision_digest,candidate_target_revision_digest,
             verification_receipt_digest,owner_actor_type,owner_actor_id,idempotency_key,authorized_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'human',$12,$13,$14) RETURNING *`,
          [promotionId, installationId, source.case_id, input.candidate_id, source.delivery_id,
            input.verification_id, source.binding_id, authorization.authorization_digest,
            input.expected_target_revision_digest, source.target_candidate_revision_digest,
            source.verification_receipt_digest, actor.id, input.idempotency_key, acceptedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_promotion_events
            (event_id,installation_id,promotion_id,event_index,event_type,detail,actor_type,actor_id,occurred_at)
           VALUES ($1,$2,$3,1,'authorized',$4,'human',$5,$6)`,
          [randomUUID(), installationId, promotionId, authorization, actor.id, acceptedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_promotion_idempotency
            (installation_id,idempotency_key,request_digest,promotion_id,bound_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [installationId, input.idempotency_key, requestDigest, promotionId, acceptedAt]
        );
        return {
          aggregateType: "promotion", aggregateId: promotionId,
          transitionType: "diagnostic.promotion.authorized", fromRevision: 0, toRevision: 1,
          transitionPayload: { promotion_id: promotionId, candidate_id: input.candidate_id,
            authorization_digest: authorization.authorization_digest },
          result: { promotion: await getPromotion(inserted.rows[0].promotion_id, client), created: true }
        };
      }
    });
  }

  async function persistRollbackArtifact(client, snapshot, acceptedAt) {
    const stored = await artifactStore.putJson({
      schema_version: "0.2.0", kind: "promotion_rollback_snapshot", content: snapshot.representation
    });
    await client.query(
      `INSERT INTO diagnostic_artifacts
        (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
      [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
        stored.storage_key, acceptedAt]
    );
    return stored;
  }

  async function applyPromotion(value, actorValue) {
    const actor = requireOwner(actorValue);
    const envelope = parseCommand(value, "diagnostic.promotion.apply");
    const raw = requireExact(envelope.input, "input", ["promotion_id", "idempotency_key"]);
    const input = {
      promotion_id: requireUuid(raw.promotion_id, "promotion_id"),
      idempotency_key: requireString(raw.idempotency_key, "idempotency_key", 200)
    };
    const accepted = { ...envelope, input, actor };
    const applicationRequestDigest = sha256Digest({ input, owner: actor });
    const requested = await executeCommand({
      installationId,
      command: accepted,
      requestDigest: commandDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:promotion-application:${input.promotion_id}`
        ]);
        const semanticReplay = await client.query(
          `SELECT * FROM diagnostic_promotion_apply_idempotency
           WHERE installation_id=$1 AND idempotency_key=$2 FOR SHARE`,
          [installationId, input.idempotency_key]
        );
        if (semanticReplay.rows[0]) {
          if (semanticReplay.rows[0].request_digest !== applicationRequestDigest ||
              semanticReplay.rows[0].promotion_id !== input.promotion_id) {
            throw new KernelError(409, "PROMOTION_APPLY_IDEMPOTENCY_CONFLICT",
              "Promotion application key is already bound to different material.");
          }
          const current = await getPromotion(input.promotion_id, client);
          return {
            aggregateType: "promotion", aggregateId: input.promotion_id,
            transitionType: "diagnostic.promotion.application_reused",
            fromRevision: current.events.length, toRevision: current.events.length,
            transitionPayload: { promotion_id: input.promotion_id },
            result: { promotion: current, requested: false }
          };
        }
        const promotion = await getPromotion(input.promotion_id, client);
        if (promotion.projection.state !== "authorized") {
          throw new KernelError(409, "PROMOTION_NOT_AUTHORIZED",
            "Only an authorized Promotion can request target application.", {
              state: promotion.projection.state
            });
        }
        const bindingResult = await client.query(
          `SELECT * FROM diagnostic_repair_delivery_bindings
           WHERE installation_id=$1 AND binding_id=$2 FOR SHARE`,
          [installationId, promotion.binding_id]
        );
        const binding = bindingView(bindingResult.rows[0]);
        for (const operation of ["snapshot", "promotion", "confirmation"]) {
          requireRepairDeliveryOperation(binding, operation);
        }
        const selected = requireAdapter(binding);
        const snapshot = await selected.snapshot(binding.target);
        if (snapshot.target_revision_digest !== promotion.expected_target_revision_digest) {
          throw new KernelError(409, "REPAIR_TARGET_DRIFT",
            "Target changed after authorization and before promotion application.", {
              expected_target_revision_digest: promotion.expected_target_revision_digest,
              current_target_revision_digest: snapshot.target_revision_digest
            });
        }
        const rollback = await persistRollbackArtifact(client, snapshot, acceptedAt);
        const detail = {
          application_request_digest: applicationRequestDigest,
          previous_target_revision_digest: snapshot.target_revision_digest,
          rollback_reference: {
            artifact_digest: rollback.artifact_digest,
            target_revision_digest: snapshot.target_revision_digest
          },
          idempotency_key: input.idempotency_key
        };
        await client.query(
          `INSERT INTO diagnostic_promotion_events
            (event_id,installation_id,promotion_id,event_index,event_type,detail,actor_type,actor_id,occurred_at)
           VALUES ($1,$2,$3,2,'application_requested',$4,'human',$5,$6)`,
          [randomUUID(), installationId, input.promotion_id, detail, actor.id, acceptedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_promotion_events
            (event_id,installation_id,promotion_id,event_index,event_type,detail,actor_type,actor_id,occurred_at)
           VALUES ($1,$2,$3,3,'applying',$4,'repair_delivery_adapter',$5,$6)`,
          [randomUUID(), installationId, input.promotion_id, {
            application_request_digest: applicationRequestDigest,
            adapter_id: binding.adapter.adapter_id
          }, binding.adapter.adapter_id, acceptedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_promotion_apply_idempotency
            (installation_id,idempotency_key,request_digest,promotion_id,bound_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [installationId, input.idempotency_key, applicationRequestDigest, input.promotion_id, acceptedAt]
        );
        return {
          aggregateType: "promotion", aggregateId: input.promotion_id,
          transitionType: "diagnostic.promotion.applying", fromRevision: 1, toRevision: 3,
          transitionPayload: { promotion_id: input.promotion_id,
            previous_target_revision_digest: snapshot.target_revision_digest,
            rollback_artifact_digest: rollback.artifact_digest },
          result: { promotion: await getPromotion(input.promotion_id, client), requested: true }
        };
      }
    });
    if (requested.replayed || requested.result.requested === false) {
      const current = await getPromotion(input.promotion_id);
      return { replayed: true, result: {
        ...requested.result,
        promotion: current,
        confirmed: current.projection.state === "confirmed"
      } };
    }
    const promotion = requested.result.promotion;
    const binding = await getBinding(promotion.binding_id);
    const selected = requireAdapter(binding);
    const candidateTargetId = await getCandidateTargetId(promotion.delivery_id);
    let applied;
    try {
      applied = await selected.promote({
        target: binding.target,
        expected_base_revision_digest: promotion.expected_target_revision_digest,
        candidate_target_id: candidateTargetId,
        candidate_target_revision_digest: promotion.candidate_target_revision_digest,
        idempotency_key: input.idempotency_key
      });
    } catch (error) {
      if (error?.code !== "REPAIR_PROMOTION_RESULT_UNCERTAIN") throw error;
      const uncertaintyCommand = {
        command_id: `${envelope.command_id}:uncertain`,
        operation_id: "diagnostic.promotion.record_uncertain",
        input: { promotion_id: input.promotion_id,
          adapter_request_receipt_digest: error.details?.request_receipt?.receipt_digest },
        actor: { type: "repair_delivery_adapter", id: binding.adapter.adapter_id }
      };
      const uncertain = await executeCommand({
        installationId,
        command: uncertaintyCommand,
        requestDigest: commandDigest(uncertaintyCommand),
        apply: async (client, { acceptedAt }) => {
          const current = await getPromotion(input.promotion_id, client);
          if (current.projection.state !== "applying") {
            throw new KernelError(409, "PROMOTION_UNCERTAINTY_CONFLICT",
              "Promotion is not awaiting an adapter result.");
          }
          const detail = {
            reason_code: error.code,
            adapter_request_receipt: error.details?.request_receipt ?? null,
            confirmation_missing: true
          };
          const eventIndex = await appendPromotionEvent(client, {
            promotionId: input.promotion_id, eventType: "uncertain", detail,
            actor: uncertaintyCommand.actor, occurredAt: acceptedAt
          });
          return {
            aggregateType: "promotion", aggregateId: input.promotion_id,
            transitionType: "diagnostic.promotion.uncertain", fromRevision: eventIndex - 1,
            toRevision: eventIndex,
            transitionPayload: { promotion_id: input.promotion_id,
              adapter_request_receipt_digest: error.details?.request_receipt?.receipt_digest ?? null },
            result: { promotion: await getPromotion(input.promotion_id, client), uncertain: true }
          };
        }
      });
      return { replayed: false, result: {
        ...requested.result,
        promotion: uncertain.result.promotion,
        confirmed: false,
        uncertain: true
      } };
    }
    if (applied.confirmation.candidate_behavior_confirmed !== true) {
      throw new KernelError(502, "PROMOTION_NOT_CONFIRMED",
        "Repair Delivery Adapter did not confirm the exact candidate behavior.");
    }
    const confirmationCommand = {
      command_id: `${envelope.command_id}:confirmation`,
      operation_id: "diagnostic.promotion.confirm",
      input: {
        promotion_id: input.promotion_id,
        adapter_request_receipt_digest: applied.request_receipt.receipt_digest,
        adapter_confirmation_receipt_digest: applied.confirmation.receipt_digest
      },
      actor: { type: "repair_delivery_adapter", id: binding.adapter.adapter_id }
    };
    const confirmed = await executeCommand({
      installationId,
      command: confirmationCommand,
      requestDigest: commandDigest(confirmationCommand),
      apply: async (client, { acceptedAt }) => {
        const current = await getPromotion(input.promotion_id, client);
        if (current.projection.state !== "applying") {
          throw new KernelError(409, "PROMOTION_CONFIRMATION_CONFLICT",
            "Promotion is not awaiting target confirmation.");
        }
        const detail = {
          resulting_target_revision_digest: applied.confirmation.target_revision_digest,
          candidate_behavior_digest: applied.confirmation.candidate_behavior_digest,
          adapter_request_receipt: applied.request_receipt,
          adapter_confirmation_receipt: {
            ...applied.confirmation,
            representation: undefined
          }
        };
        const eventIndex = await appendPromotionEvent(client, {
          promotionId: input.promotion_id, eventType: "confirmed", detail,
          actor: confirmationCommand.actor, occurredAt: acceptedAt
        });
        return {
          aggregateType: "promotion", aggregateId: input.promotion_id,
          transitionType: "diagnostic.promotion.confirmed", fromRevision: eventIndex - 1,
          toRevision: eventIndex,
          transitionPayload: { promotion_id: input.promotion_id,
            resulting_target_revision_digest: applied.confirmation.target_revision_digest },
          result: { promotion: await getPromotion(input.promotion_id, client), confirmed: true }
        };
      }
    });
    return { replayed: false, result: {
      ...requested.result,
      promotion: confirmed.result.promotion,
      confirmed: true
    } };
  }

  async function reconcilePromotion(value, actorValue) {
    const actor = requireOwner(actorValue);
    const envelope = parseCommand(value, "diagnostic.promotion.reconcile");
    const raw = requireExact(envelope.input, "input", ["promotion_id", "idempotency_key"]);
    const input = {
      promotion_id: requireUuid(raw.promotion_id, "promotion_id"),
      idempotency_key: requireString(raw.idempotency_key, "idempotency_key", 200)
    };
    const accepted = { ...envelope, input, actor };
    const requestDigest = sha256Digest({ input, owner: actor });
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: commandDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:promotion-reconciliation:${input.promotion_id}`
        ]);
        const replay = await client.query(
          `SELECT * FROM diagnostic_promotion_reconciliation_idempotency
           WHERE installation_id=$1 AND idempotency_key=$2 FOR SHARE`,
          [installationId, input.idempotency_key]
        );
        if (replay.rows[0]) {
          if (replay.rows[0].request_digest !== requestDigest ||
              replay.rows[0].promotion_id !== input.promotion_id) {
            throw new KernelError(409, "PROMOTION_RECONCILIATION_IDEMPOTENCY_CONFLICT",
              "Reconciliation key is already bound to different material.");
          }
          const current = await getPromotion(input.promotion_id, client);
          return {
            aggregateType: "promotion", aggregateId: input.promotion_id,
            transitionType: "diagnostic.promotion.reconciliation_reused",
            fromRevision: current.events.length, toRevision: current.events.length,
            transitionPayload: { promotion_id: input.promotion_id },
            result: { promotion: current, reconciled: false }
          };
        }
        const promotion = await getPromotion(input.promotion_id, client);
        if (promotion.projection.state !== "uncertain") {
          throw new KernelError(409, "PROMOTION_NOT_UNCERTAIN",
            "Only an uncertain Promotion can be reconciled.", { state: promotion.projection.state });
        }
        const binding = await getBinding(promotion.binding_id, client);
        requireRepairDeliveryOperation(binding, "confirmation");
        const selected = requireAdapter(binding);
        const receipt = await selected.reconcilePromotion({
          target: binding.target,
          previous_target_revision_digest: promotion.application.previous_target_revision_digest,
          candidate_target_id: await getCandidateTargetId(promotion.delivery_id, client),
          candidate_target_revision_digest: promotion.candidate_target_revision_digest
        });
        const eventType = receipt.outcome === "applied" ? "confirmed" :
          receipt.outcome === "not_applied" ? "failed" : "target_mismatch";
        const detail = {
          reconciliation_outcome: receipt.outcome,
          reconciliation_receipt: receipt,
          was_uncertain: true,
          previous_target_revision_digest: promotion.application.previous_target_revision_digest,
          candidate_target_revision_digest: promotion.candidate_target_revision_digest,
          current_target_revision_digest: receipt.current_target_revision_digest
        };
        if (eventType === "confirmed") {
          Object.assign(detail, {
            resulting_target_revision_digest: receipt.current_target_revision_digest,
            candidate_behavior_digest: receipt.candidate_behavior_digest,
            adapter_request_receipt: promotion.uncertainty.adapter_request_receipt,
            adapter_confirmation_receipt: receipt
          });
        } else if (eventType === "failed") {
          Object.assign(detail, { reason_code: "PROMOTION_NOT_APPLIED", unresolved: true });
        } else {
          Object.assign(detail, { reason_code: "PROMOTION_TARGET_MISMATCH",
            human_review_required: true, unresolved: true });
        }
        const eventIndex = await appendPromotionEvent(client, {
          promotionId: input.promotion_id, eventType, detail, actor, occurredAt: acceptedAt
        });
        await client.query(
          `INSERT INTO diagnostic_promotion_reconciliation_idempotency
            (installation_id,idempotency_key,request_digest,promotion_id,bound_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [installationId, input.idempotency_key, requestDigest, input.promotion_id, acceptedAt]
        );
        return {
          aggregateType: "promotion", aggregateId: input.promotion_id,
          transitionType: `diagnostic.promotion.${eventType}`,
          fromRevision: eventIndex - 1, toRevision: eventIndex,
          transitionPayload: { promotion_id: input.promotion_id, reconciliation_outcome: receipt.outcome,
            reconciliation_receipt_digest: receipt.receipt_digest },
          result: { promotion: await getPromotion(input.promotion_id, client),
            reconciled: true, outcome: receipt.outcome }
        };
      }
    });
  }

  async function rollbackPromotion(value, actorValue) {
    const actor = requireOwner(actorValue);
    const envelope = parseCommand(value, "diagnostic.promotion.rollback");
    const raw = requireExact(envelope.input, "input", [
      "promotion_id", "expected_target_revision_digest", "idempotency_key"
    ]);
    const input = {
      promotion_id: requireUuid(raw.promotion_id, "promotion_id"),
      expected_target_revision_digest: requireDigest(raw.expected_target_revision_digest,
        "expected_target_revision_digest"),
      idempotency_key: requireString(raw.idempotency_key, "idempotency_key", 200)
    };
    const accepted = { ...envelope, input, actor };
    const requestDigest = sha256Digest({ input, owner: actor });
    const authorized = await executeCommand({
      installationId,
      command: accepted,
      requestDigest: commandDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:promotion-rollback:${input.promotion_id}`
        ]);
        const replay = await client.query(
          `SELECT * FROM diagnostic_promotion_rollback_idempotency
           WHERE installation_id=$1 AND idempotency_key=$2 FOR SHARE`,
          [installationId, input.idempotency_key]
        );
        if (replay.rows[0]) {
          if (replay.rows[0].request_digest !== requestDigest ||
              replay.rows[0].promotion_id !== input.promotion_id) {
            throw new KernelError(409, "PROMOTION_ROLLBACK_IDEMPOTENCY_CONFLICT",
              "Rollback key is already bound to different material.");
          }
          const current = await getPromotion(input.promotion_id, client);
          return {
            aggregateType: "promotion", aggregateId: input.promotion_id,
            transitionType: "diagnostic.promotion.rollback_reused",
            fromRevision: current.events.length, toRevision: current.events.length,
            transitionPayload: { promotion_id: input.promotion_id },
            result: { promotion: current, authorized: false }
          };
        }
        const promotion = await getPromotion(input.promotion_id, client);
        if (promotion.projection.state !== "confirmed") {
          throw new KernelError(409, "PROMOTION_NOT_CONFIRMED",
            "Only a confirmed Promotion can be rolled back.", { state: promotion.projection.state });
        }
        if (promotion.confirmation.resulting_target_revision_digest !==
            input.expected_target_revision_digest) {
          throw new KernelError(409, "PROMOTION_ROLLBACK_PRECONDITION_MISMATCH",
            "Rollback must bind the exact confirmed target revision.");
        }
        const binding = await getBinding(promotion.binding_id, client);
        requireRepairDeliveryOperation(binding, "rollback");
        requireRepairDeliveryOperation(binding, "confirmation");
        requireAdapter(binding);
        const detail = {
          expected_target_revision_digest: input.expected_target_revision_digest,
          rollback_reference: promotion.application.rollback_reference,
          rollback_request_digest: requestDigest,
          idempotency_key: input.idempotency_key
        };
        const eventIndex = await appendPromotionEvent(client, {
          promotionId: input.promotion_id, eventType: "rollback_authorized", detail,
          actor, occurredAt: acceptedAt
        });
        await client.query(
          `INSERT INTO diagnostic_promotion_rollback_idempotency
            (installation_id,idempotency_key,request_digest,promotion_id,bound_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [installationId, input.idempotency_key, requestDigest, input.promotion_id, acceptedAt]
        );
        return {
          aggregateType: "promotion", aggregateId: input.promotion_id,
          transitionType: "diagnostic.promotion.rollback_authorized",
          fromRevision: eventIndex - 1, toRevision: eventIndex,
          transitionPayload: { promotion_id: input.promotion_id,
            expected_target_revision_digest: input.expected_target_revision_digest,
            rollback_artifact_digest: promotion.application.rollback_reference.artifact_digest },
          result: { promotion: await getPromotion(input.promotion_id, client), authorized: true }
        };
      }
    });
    if (authorized.replayed || authorized.result.authorized === false) {
      const current = await getPromotion(input.promotion_id);
      return { replayed: true, result: { ...authorized.result, promotion: current,
        rolled_back: current.projection.state === "rolled_back" } };
    }
    const promotion = authorized.result.promotion;
    const binding = await getBinding(promotion.binding_id);
    const selected = requireAdapter(binding);
    const stored = await artifactStore.getJson(promotion.application.rollback_reference.artifact_digest);
    if (stored.content?.kind !== "promotion_rollback_snapshot") {
      throw new KernelError(409, "PROMOTION_ROLLBACK_ARTIFACT_INVALID",
        "Rollback reference is not a promotion snapshot.");
    }
    const rolledBack = await selected.rollback({
      target: binding.target,
      expected_current_revision_digest: input.expected_target_revision_digest,
      rollback_representation: stored.content.content,
      idempotency_key: input.idempotency_key
    });
    const confirmationCommand = {
      command_id: `${envelope.command_id}:confirmation`,
      operation_id: "diagnostic.promotion.confirm_rollback",
      input: { promotion_id: input.promotion_id,
        adapter_confirmation_receipt_digest: rolledBack.confirmation.receipt_digest },
      actor: { type: "repair_delivery_adapter", id: binding.adapter.adapter_id }
    };
    const confirmed = await executeCommand({
      installationId,
      command: confirmationCommand,
      requestDigest: commandDigest(confirmationCommand),
      apply: async (client, { acceptedAt }) => {
        const current = await getPromotion(input.promotion_id, client);
        if (current.projection.state !== "rolling_back") {
          throw new KernelError(409, "PROMOTION_ROLLBACK_CONFIRMATION_CONFLICT",
            "Promotion is not awaiting rollback confirmation.");
        }
        const detail = {
          resulting_target_revision_digest: rolledBack.confirmation.target_revision_digest,
          adapter_request_receipt: rolledBack.request_receipt,
          adapter_confirmation_receipt: {
            ...rolledBack.confirmation,
            representation: undefined
          },
          rollback_reference: promotion.application.rollback_reference
        };
        const eventIndex = await appendPromotionEvent(client, {
          promotionId: input.promotion_id, eventType: "rolled_back", detail,
          actor: confirmationCommand.actor, occurredAt: acceptedAt
        });
        return {
          aggregateType: "promotion", aggregateId: input.promotion_id,
          transitionType: "diagnostic.promotion.rolled_back",
          fromRevision: eventIndex - 1, toRevision: eventIndex,
          transitionPayload: { promotion_id: input.promotion_id,
            resulting_target_revision_digest: rolledBack.confirmation.target_revision_digest },
          result: { promotion: await getPromotion(input.promotion_id, client), rolled_back: true }
        };
      }
    });
    return { replayed: false, result: { ...authorized.result,
      promotion: confirmed.result.promotion, rolled_back: true } };
  }

  return {
    applyPromotion, authorizePromotion, getPromotion, reconcilePromotion, rollbackPromotion
  };
}
