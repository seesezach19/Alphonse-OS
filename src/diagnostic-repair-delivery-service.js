import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  requireDigest,
  requireExact,
  requireObject,
  requireString,
  requireUuid
} from "./diagnostic-repair-worker-contracts.js";
import { KernelError } from "./errors.js";
import {
  projectRepairDelivery,
  repairDeliveryAuthority,
  requireRepairDeliveryOperation,
  validateRepairDeliveryBinding
} from "./repair-delivery-adapter-contract.js";

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

function bindingView(row) {
  return {
    binding_id: row.binding_id,
    adapter: { adapter_id: row.adapter_id, adapter_version: row.adapter_version },
    target: row.target,
    external_credential_binding_ref: row.external_credential_binding_ref,
    permitted_operations: row.permitted_operations,
    transition_policy: row.transition_policy,
    binding_digest: row.binding_digest,
    created_by: { type: row.created_by_actor_type, id: row.created_by_actor_id },
    created_at: row.created_at,
    secrets_stored: false,
    immutable: true
  };
}

function deliveryView(row) {
  if (!row) return null;
  const delivery = {
    delivery_id: row.delivery_id,
    candidate_id: row.candidate_id,
    binding_id: row.binding_id,
    delivery_request_digest: row.delivery_request_digest,
    base: {
      expected_target_revision_digest: row.expected_base_revision_digest,
      actual_target_revision_digest: row.actual_base_revision_digest,
      snapshot_artifact_digest: row.base_snapshot_artifact_digest,
      active_target_confirmed_unchanged: row.active_target_confirmed_unchanged
    },
    inactive_candidate: {
      target_id: row.target_candidate_id,
      target_revision_digest: row.target_candidate_revision_digest,
      artifact_digest: row.target_candidate_artifact_digest,
      state: row.target_candidate_state
    },
    adapter_receipt: row.adapter_receipt,
    adapter_receipt_digest: row.adapter_receipt_digest,
    idempotency_key: row.idempotency_key,
    created_by: { type: row.created_by_actor_type, id: row.created_by_actor_id },
    created_at: row.created_at,
    credentials_stored: false,
    immutable: true
  };
  return { ...delivery, projection: projectRepairDelivery(row) };
}

export function createDiagnosticRepairDeliveryService({
  database, artifactStore, installationId, adapter, adapterManifest, credentialBindingRef
}) {
  const { pool, executeCommand } = database;

  function commandDigest(command) {
    return sha256Digest({ installation_id: installationId, ...command });
  }

  function requireAdapter(binding) {
    if (!adapter) {
      throw new KernelError(503, "REPAIR_DELIVERY_ADAPTER_UNAVAILABLE",
        "Repair Delivery Adapter is not configured.");
    }
    if (binding.adapter.adapter_id !== adapterManifest.adapter_id ||
        binding.adapter.adapter_version !== adapterManifest.adapter_version) {
      throw new KernelError(409, "REPAIR_DELIVERY_ADAPTER_MISMATCH",
        "Binding does not select the configured Repair Delivery Adapter.");
    }
    if (binding.external_credential_binding_ref !== credentialBindingRef) {
      throw new KernelError(409, "REPAIR_DELIVERY_CREDENTIAL_BINDING_UNAVAILABLE",
        "External credential binding reference is not available to this adapter.");
    }
    return adapter;
  }

  async function getBinding(bindingId, client = pool) {
    requireUuid(bindingId, "binding_id");
    const result = await client.query(
      `SELECT * FROM diagnostic_repair_delivery_bindings
       WHERE installation_id=$1 AND binding_id=$2`, [installationId, bindingId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "REPAIR_DELIVERY_BINDING_NOT_FOUND",
        "Repair Delivery Binding does not exist.");
    }
    return bindingView(result.rows[0]);
  }

  async function getDelivery(deliveryId, client = pool) {
    requireUuid(deliveryId, "delivery_id");
    const result = await client.query(
      `SELECT * FROM diagnostic_repair_deliveries
       WHERE installation_id=$1 AND delivery_id=$2`, [installationId, deliveryId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "REPAIR_DELIVERY_NOT_FOUND", "Repair Delivery does not exist.");
    }
    return deliveryView(result.rows[0]);
  }

  async function registerBinding(value, actor) {
    const envelope = parseCommand(value, "diagnostic.repair_delivery_binding.register");
    const input = validateRepairDeliveryBinding(envelope.input, adapterManifest);
    const accepted = { ...envelope, input: envelope.input, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: commandDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        const existing = await client.query(
          `SELECT * FROM diagnostic_repair_delivery_bindings
           WHERE installation_id=$1 AND binding_id=$2 FOR SHARE`,
          [installationId, input.binding_id]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].binding_digest !== input.binding_digest) {
            throw new KernelError(409, "REPAIR_DELIVERY_BINDING_CONFLICT",
              "Binding ID already selects different immutable material.");
          }
          return {
            aggregateType: "repair_delivery_binding", aggregateId: input.binding_id,
            transitionType: "diagnostic.repair_delivery_binding.reused", fromRevision: 1, toRevision: 1,
            transitionPayload: { binding_id: input.binding_id, binding_digest: input.binding_digest },
            result: { repair_delivery_binding: bindingView(existing.rows[0]), created: false }
          };
        }
        const inserted = await client.query(
          `INSERT INTO diagnostic_repair_delivery_bindings
            (binding_id,installation_id,adapter_id,adapter_version,target,
             external_credential_binding_ref,permitted_operations,transition_policy,binding_digest,
             created_by_actor_type,created_by_actor_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [input.binding_id, installationId, input.adapter.adapter_id, input.adapter.adapter_version,
            JSON.stringify(input.target), input.external_credential_binding_ref,
            JSON.stringify(input.permitted_operations), JSON.stringify(input.transition_policy),
            input.binding_digest, actor.type, actor.id, acceptedAt]
        );
        return {
          aggregateType: "repair_delivery_binding", aggregateId: input.binding_id,
          transitionType: "diagnostic.repair_delivery_binding.registered", fromRevision: 0, toRevision: 1,
          transitionPayload: { binding_id: input.binding_id, binding_digest: input.binding_digest },
          result: { repair_delivery_binding: bindingView(inserted.rows[0]), created: true }
        };
      }
    });
  }

  async function inspectTarget(bindingId) {
    const binding = await getBinding(bindingId);
    requireRepairDeliveryOperation(binding, "inspect");
    const selected = requireAdapter(binding);
    const target = await selected.inspect(binding.target);
    return {
      repair_delivery_binding: binding,
      target: {
        ...target,
        legal_next_operations: ["diagnostic.repair_delivery.materialize"],
        authority: repairDeliveryAuthority()
      }
    };
  }

  async function persistArtifact(client, kind, content, acceptedAt) {
    const stored = await artifactStore.putJson({ schema_version: "0.2.0", kind, content });
    await client.query(
      `INSERT INTO diagnostic_artifacts
        (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
      [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
        stored.storage_key, acceptedAt]
    );
    return stored;
  }

  async function candidateInput(client, candidateId) {
    const result = await client.query(
      `SELECT c.*,e.event_type AS current_status
       FROM diagnostic_repair_candidates c
       JOIN LATERAL (
         SELECT event_type FROM diagnostic_repair_candidate_events
         WHERE installation_id=c.installation_id AND candidate_id=c.candidate_id
         ORDER BY event_index DESC LIMIT 1
       ) e ON true
       WHERE c.installation_id=$1 AND c.candidate_id=$2 FOR SHARE`,
      [installationId, candidateId]
    );
    const candidate = result.rows[0];
    if (!candidate) throw new KernelError(404, "REPAIR_CANDIDATE_NOT_FOUND", "Repair Candidate does not exist.");
    if (candidate.current_status !== "proposed") {
      throw new KernelError(409, "REPAIR_CANDIDATE_NOT_DELIVERABLE",
        "Only a proposed immutable Repair Candidate may be materialized.");
    }
    const artifact = await artifactStore.getJson(candidate.candidate_artifact_digest);
    if (artifact.content?.kind !== "repair_candidate" || !artifact.content?.content) {
      throw new KernelError(409, "REPAIR_CANDIDATE_ARTIFACT_INVALID",
        "Repair Candidate artifact does not contain provider-neutral repair material.");
    }
    return { row: candidate, repairArtifact: artifact.content.content };
  }

  async function materializeCandidate(value, actor) {
    const envelope = parseCommand(value, "diagnostic.repair_delivery.materialize");
    const raw = requireExact(envelope.input, "input", [
      "candidate_id", "binding_id", "expected_base_revision_digest", "idempotency_key"
    ]);
    const input = {
      candidate_id: requireUuid(raw.candidate_id, "candidate_id"),
      binding_id: requireUuid(raw.binding_id, "binding_id"),
      expected_base_revision_digest: requireDigest(
        raw.expected_base_revision_digest, "expected_base_revision_digest"),
      idempotency_key: requireString(raw.idempotency_key, "idempotency_key", 200)
    };
    const accepted = { ...envelope, input, actor };
    const deliveryRequestDigest = sha256Digest(input);
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: commandDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:repair-delivery:${input.candidate_id}`
        ]);
        const existing = await client.query(
          `SELECT * FROM diagnostic_repair_deliveries
           WHERE installation_id=$1 AND candidate_id=$2 FOR SHARE`,
          [installationId, input.candidate_id]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].delivery_request_digest !== deliveryRequestDigest) {
            throw new KernelError(409, "REPAIR_DELIVERY_CONFLICT",
              "Repair Candidate already has a different target delivery.");
          }
          return {
            aggregateType: "repair_delivery", aggregateId: existing.rows[0].delivery_id,
            transitionType: "diagnostic.repair_delivery.reused", fromRevision: 1, toRevision: 1,
            transitionPayload: { delivery_id: existing.rows[0].delivery_id,
              candidate_id: input.candidate_id },
            result: { repair_delivery: deliveryView(existing.rows[0]), created: false }
          };
        }
        const binding = await getBinding(input.binding_id, client);
        for (const operation of ["inspect", "snapshot", "candidate"]) {
          requireRepairDeliveryOperation(binding, operation);
        }
        const selected = requireAdapter(binding);
        const candidate = await candidateInput(client, input.candidate_id);
        const snapshot = await selected.snapshot(binding.target);
        if (snapshot.target_revision_digest !== input.expected_base_revision_digest) {
          throw new KernelError(409, "REPAIR_TARGET_DRIFT",
            "Target changed before inactive candidate creation.", {
              expected_base_revision_digest: input.expected_base_revision_digest,
              current_target_revision_digest: snapshot.target_revision_digest
            });
        }
        const delivered = await selected.createCandidate({
          target: binding.target,
          expected_base_revision_digest: input.expected_base_revision_digest,
          repair_candidate_id: input.candidate_id,
          repair_artifact: candidate.repairArtifact,
          idempotency_key: input.idempotency_key
        });
        if (delivered.candidate.active !== false || delivered.receipt.target_candidate_state !== "inactive") {
          throw new KernelError(502, "REPAIR_CANDIDATE_NOT_INACTIVE",
            "Repair Delivery Adapter did not return an inactive candidate.");
        }
        const unchanged = await selected.inspect(binding.target);
        if (unchanged.target_revision_digest !== snapshot.target_revision_digest ||
            unchanged.active !== snapshot.active) {
          throw new KernelError(409, "ACTIVE_REPAIR_TARGET_MUTATED",
            "Inactive candidate creation changed the bound target.");
        }
        const baseArtifact = await persistArtifact(
          client, "repair_delivery_base_snapshot", snapshot.representation, acceptedAt);
        const targetCandidateArtifact = await persistArtifact(
          client, "repair_delivery_inactive_candidate", delivered.candidate.representation, acceptedAt);
        const deliveryId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO diagnostic_repair_deliveries
            (delivery_id,installation_id,candidate_id,binding_id,delivery_request_digest,
             expected_base_revision_digest,actual_base_revision_digest,base_snapshot_artifact_digest,
             target_candidate_id,target_candidate_revision_digest,target_candidate_artifact_digest,
             target_candidate_state,adapter_receipt,adapter_receipt_digest,idempotency_key,
             active_target_confirmed_unchanged,created_by_actor_type,created_by_actor_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'inactive',$12,$13,$14,true,$15,$16,$17)
           RETURNING *`,
          [deliveryId, installationId, input.candidate_id, input.binding_id, deliveryRequestDigest,
            input.expected_base_revision_digest, snapshot.target_revision_digest,
            baseArtifact.artifact_digest, delivered.candidate.target_id,
            delivered.candidate.target_revision_digest, targetCandidateArtifact.artifact_digest,
            delivered.receipt, delivered.receipt.receipt_digest, input.idempotency_key,
            actor.type, actor.id, acceptedAt]
        );
        const eventIndex = await client.query(
          `SELECT COALESCE(MAX(event_index),0)+1 AS event_index
           FROM diagnostic_repair_candidate_events
           WHERE installation_id=$1 AND candidate_id=$2`, [installationId, input.candidate_id]
        );
        await client.query(
          `INSERT INTO diagnostic_repair_candidate_events
            (event_id,installation_id,candidate_id,event_index,event_type,detail,actor_type,actor_id,occurred_at)
           VALUES ($1,$2,$3,$4,'verification_pending',$5,$6,$7,$8)`,
          [randomUUID(), installationId, input.candidate_id, eventIndex.rows[0].event_index,
            { delivery_id: deliveryId, target_candidate_revision_digest: delivered.candidate.target_revision_digest },
            actor.type, actor.id, acceptedAt]
        );
        return {
          aggregateType: "repair_delivery", aggregateId: deliveryId,
          transitionType: "diagnostic.repair_delivery.materialized", fromRevision: 0, toRevision: 1,
          transitionPayload: { delivery_id: deliveryId, candidate_id: input.candidate_id,
            target_candidate_revision_digest: delivered.candidate.target_revision_digest },
          result: { repair_delivery: deliveryView(inserted.rows[0]), created: true }
        };
      }
    });
  }

  return { getBinding, getDelivery, inspectTarget, materializeCandidate, registerBinding };
}
