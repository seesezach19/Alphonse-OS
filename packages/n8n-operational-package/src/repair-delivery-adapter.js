import { sha256Digest } from "../../../src/canonical-json.js";
import { KernelError } from "../../../src/errors.js";

const ADAPTER = Object.freeze({
  adapter_id: "alphonse.n8n.repair-delivery",
  adapter_version: "0.2.0"
});

export const N8N_REPAIR_DELIVERY_ADAPTER_MANIFEST = Object.freeze({
  ...ADAPTER,
  target_system: "n8n",
  operations: Object.freeze({
    inspect: Object.freeze({ supported: true, effect: "read_only" }),
    snapshot: Object.freeze({ supported: true, effect: "read_only" }),
    candidate: Object.freeze({ supported: true, effect: "create_inactive_candidate" }),
    candidate_execution: Object.freeze({ supported: false, effect: "unavailable" }),
    review: Object.freeze({ supported: false, effect: "unavailable" }),
    promotion: Object.freeze({ supported: true, effect: "promote_candidate" }),
    confirmation: Object.freeze({ supported: true, effect: "confirm_target_revision" }),
    rollback: Object.freeze({ supported: true, effect: "rollback_target_revision" })
  })
});

function clone(value) {
  return structuredClone(value);
}

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new KernelError(400, "INVALID_N8N_REPAIR_INPUT", `${field} is required.`);
  }
  return value.trim();
}

function exactInventoryPatch(value) {
  const repaired = [
    { operation: "replace", path: "missing_sku", value: "inventory_unknown" },
    { operation: "replace", path: "inventory_unknown.next", value: "human_review" }
  ];
  const ineffective = [
    { operation: "replace", path: "missing_sku", value: "zero_inventory" },
    { operation: "replace", path: "zero_inventory.next", value: "delay_draft" }
  ];
  if (value?.format !== "provider-neutral-repair-patch") {
    throw new KernelError(400, "N8N_REPAIR_PATCH_UNSUPPORTED",
      "n8n adapter requires one exact bounded missing-SKU patch.");
  }
  if (JSON.stringify(value.changes) === JSON.stringify(repaired)) return "repaired";
  if (JSON.stringify(value.changes) === JSON.stringify(ineffective)) return "ineffective";
  throw new KernelError(400, "N8N_REPAIR_PATCH_UNSUPPORTED",
    "n8n adapter does not support this missing-SKU patch.");
}

function behaviorMaterial(workflow) {
  return {
    target_type: "n8n.workflow",
    target_id: required(workflow.id, "workflow.id"),
    name: required(workflow.name, "workflow.name"),
    active: workflow.active === true,
    nodes: clone(workflow.nodes ?? []),
    connections: clone(workflow.connections ?? {}),
    settings: clone(workflow.settings ?? {}),
    static_data: clone(workflow.staticData ?? null),
    pin_data: clone(workflow.pinData ?? null),
    version_id: workflow.versionId ?? null
  };
}

export function n8nTargetRevisionMaterial(workflow) {
  return behaviorMaterial(workflow);
}

export function materializeInventoryRepair(baseWorkflow, repairArtifact, repairCandidateId) {
  if (exactInventoryPatch(repairArtifact) !== "repaired") {
    throw new KernelError(400, "N8N_REPAIR_PATCH_UNSUPPORTED",
      "This operation requires the exact inventory_unknown repair patch.");
  }
  return materializeInventoryCandidate(baseWorkflow, repairArtifact, repairCandidateId);
}

export function materializeInventoryCandidate(baseWorkflow, repairArtifact, repairCandidateId) {
  const mode = exactInventoryPatch(repairArtifact);
  const candidate = clone(baseWorkflow);
  candidate.id = `alphonse-${required(repairCandidateId, "repair_candidate_id")}`;
  candidate.name = `${baseWorkflow.name} [Alphonse ${repairCandidateId}]`;
  candidate.active = false;
  delete candidate.createdAt;
  delete candidate.updatedAt;
  delete candidate.versionId;
  if (mode === "ineffective") return candidate;
  const mapping = candidate.nodes?.find((node) => node.name === "Defective Missing SKU Mapping");
  const drafting = candidate.nodes?.find((node) => node.name === "Draft for Local Review");
  if (!mapping || !drafting) {
    throw new KernelError(409, "N8N_REPAIR_TARGET_UNSUPPORTED",
      "Expected inventory mapping and review nodes are unavailable.");
  }
  mapping.name = "Preserve Unknown Inventory Mapping";
  mapping.parameters.jsCode = [
    "const erpRecord = $json.erp_inventory.find((record) => record.sku === $json.order.sku);",
    "return [{ json: { ...$json, erp_quantity: erpRecord?.quantity ?? null,",
    "  inventory_state: erpRecord ? 'known' : 'inventory_unknown',",
    "  defect_path: erpRecord ? 'matched_sku' : 'missing_sku -> inventory_unknown -> human_review' } }];"
  ].join("\n");
  drafting.name = "Route Unknown Inventory for Human Review";
  drafting.parameters.jsCode = [
    "if ($json.inventory_state === 'inventory_unknown') {",
    "  return [{ json: { ...$json, fulfillment_risk: 'unknown', draft: null,",
    "    delivery: { channel: 'local_review', sent: false }, review_reason: 'missing_inventory_data' } }];",
    "}",
    "const risk = $json.erp_quantity < $json.order.quantity ? 'delay_likely' : 'ready';",
    "return [{ json: { ...$json, fulfillment_risk: risk, draft: null,",
    "  delivery: { channel: 'local_review', sent: false } } }];"
  ].join("\n");
  const connections = candidate.connections ?? {};
  if (connections["Defective Missing SKU Mapping"]) {
    connections["Preserve Unknown Inventory Mapping"] = connections["Defective Missing SKU Mapping"];
    delete connections["Defective Missing SKU Mapping"];
  }
  for (const outputs of Object.values(connections)) {
    for (const branches of Object.values(outputs)) {
      for (const branch of branches) {
        for (const target of branch ?? []) {
          if (target.node === "Defective Missing SKU Mapping") target.node = mapping.name;
          if (target.node === "Draft for Local Review") target.node = drafting.name;
        }
      }
    }
  }
  if (connections["Draft for Local Review"]) {
    connections[drafting.name] = connections["Draft for Local Review"];
    delete connections["Draft for Local Review"];
  }
  return candidate;
}

function createPayload(candidate) {
  return {
    name: candidate.name,
    nodes: clone(candidate.nodes),
    connections: clone(candidate.connections),
    settings: clone(candidate.settings ?? {})
  };
}

function executableBehavior(value) {
  return {
    nodes: clone(value.nodes ?? []),
    connections: clone(value.connections ?? {}),
    settings: clone(value.settings ?? {})
  };
}

export function createN8nRepairDeliveryAdapter({
  baseUrl, apiKey, fetchImpl = fetch, requestTimeoutMs = 5000
}) {
  const root = required(baseUrl, "baseUrl").replace(/\/$/, "");
  const credential = required(apiKey, "apiKey");

  async function request(path, init = {}) {
    const response = await fetchImpl(`${root}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-N8N-API-KEY": credential,
        ...(init.headers ?? {})
      }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new KernelError(502, "N8N_REPAIR_DELIVERY_FAILED", "n8n public API rejected repair delivery.", {
        status: response.status, operation: init.method ?? "GET"
      });
    }
    return body;
  }

  async function inspect(target) {
    const workflow = await request(`/workflows/${encodeURIComponent(required(target.target_id, "target.target_id"))}`);
    const material = n8nTargetRevisionMaterial(workflow);
    return {
      target: { system: "n8n", target_type: "workflow", target_id: workflow.id },
      target_revision_digest: sha256Digest(material),
      active: workflow.active === true,
      representation: material,
      adapter: { ...ADAPTER }
    };
  }

  async function snapshot(target) {
    return inspect(target);
  }

  async function createCandidate({
    target, expected_base_revision_digest: expectedBase, repair_candidate_id: repairCandidateId,
    repair_artifact: repairArtifact, idempotency_key: idempotencyKey
  }) {
    required(idempotencyKey, "idempotency_key");
    const base = await inspect(target);
    if (base.target_revision_digest !== expectedBase) {
      throw new KernelError(409, "REPAIR_TARGET_DRIFT",
        "Current n8n target revision does not match the expected base.", {
          expected_base_revision_digest: expectedBase,
          current_target_revision_digest: base.target_revision_digest
        });
    }
    const nativeCandidate = materializeInventoryCandidate(base.representation, repairArtifact, repairCandidateId);
    const created = await request("/workflows", {
      method: "POST",
      body: JSON.stringify(createPayload(nativeCandidate))
    });
    if (created.active === true) {
      throw new KernelError(502, "N8N_CANDIDATE_NOT_INACTIVE",
        "n8n returned an active workflow for candidate creation.");
    }
    const candidateMaterial = n8nTargetRevisionMaterial({ ...created, active: false });
    const receiptMaterial = {
      adapter: { ...ADAPTER },
      operation: "candidate",
      idempotency_key: idempotencyKey,
      repair_candidate_id: repairCandidateId,
      base_target_revision_digest: base.target_revision_digest,
      target_candidate_id: created.id,
      target_candidate_revision_digest: sha256Digest(candidateMaterial),
      target_candidate_state: "inactive"
    };
    return {
      base,
      candidate: {
        target_id: created.id,
        target_revision_digest: receiptMaterial.target_candidate_revision_digest,
        active: false,
        representation: candidateMaterial
      },
      receipt: { ...receiptMaterial, receipt_digest: sha256Digest(receiptMaterial) }
    };
  }

  async function promote({
    target, expected_base_revision_digest: expectedBase,
    candidate_target_id: candidateTargetId,
    candidate_target_revision_digest: candidateTargetRevisionDigest,
    idempotency_key: idempotencyKey
  }) {
    required(idempotencyKey, "idempotency_key");
    const previous = await inspect(target);
    if (previous.target_revision_digest !== expectedBase) {
      throw new KernelError(409, "REPAIR_TARGET_DRIFT",
        "Current n8n target revision does not match the authorized base.", {
          expected_base_revision_digest: expectedBase,
          current_target_revision_digest: previous.target_revision_digest
        });
    }
    const candidateWorkflow = await request(`/workflows/${encodeURIComponent(
      required(candidateTargetId, "candidate_target_id"))}`);
    const candidateMaterial = n8nTargetRevisionMaterial(candidateWorkflow);
    const actualCandidateDigest = sha256Digest(candidateMaterial);
    if (actualCandidateDigest !== required(candidateTargetRevisionDigest,
      "candidate_target_revision_digest")) {
      throw new KernelError(409, "REPAIR_CANDIDATE_TARGET_DRIFT",
        "Inactive n8n candidate no longer matches the verified candidate revision.", {
          expected_candidate_revision_digest: candidateTargetRevisionDigest,
          current_candidate_revision_digest: actualCandidateDigest
        });
    }
    const expectedBehaviorDigest = sha256Digest(executableBehavior(candidateMaterial));
    const requestMaterial = {
      adapter: { ...ADAPTER },
      operation: "promotion",
      idempotency_key: idempotencyKey,
      target_id: target.target_id,
      candidate_target_id: candidateTargetId,
      previous_target_revision_digest: previous.target_revision_digest,
      candidate_target_revision_digest: actualCandidateDigest,
      candidate_behavior_digest: expectedBehaviorDigest
    };
    const requestReceipt = { ...requestMaterial, receipt_digest: sha256Digest(requestMaterial) };
    try {
      await request(`/workflows/${encodeURIComponent(required(target.target_id, "target.target_id"))}`, {
        method: "PUT",
        body: JSON.stringify({
          name: previous.representation.name,
          ...executableBehavior(candidateMaterial)
        })
      });
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError" ||
          !(error instanceof KernelError)) {
        throw new KernelError(504, "REPAIR_PROMOTION_RESULT_UNCERTAIN",
          "n8n promotion request was dispatched but its result was not received.", {
            request_receipt: requestReceipt,
            cause: error?.name ?? "transport_failure"
          });
      }
      throw error;
    }
    const confirmation = await inspect(target);
    if (confirmation.active !== previous.active) {
      throw new KernelError(502, "N8N_PROMOTION_CONFIRMATION_MISMATCH",
        "n8n target activation state changed during workflow promotion.", {
          previous_active: previous.active,
          resulting_active: confirmation.active
        });
    }
    const actualBehaviorDigest = sha256Digest(executableBehavior(confirmation.representation));
    if (actualBehaviorDigest !== expectedBehaviorDigest) {
      throw new KernelError(502, "N8N_PROMOTION_CONFIRMATION_MISMATCH",
        "n8n target does not contain the exact authorized candidate behavior.", {
          expected_candidate_behavior_digest: expectedBehaviorDigest,
          actual_target_behavior_digest: actualBehaviorDigest
        });
    }
    const confirmationMaterial = {
      adapter: { ...ADAPTER },
      operation: "confirmation",
      target_id: target.target_id,
      target_revision_digest: confirmation.target_revision_digest,
      candidate_behavior_digest: expectedBehaviorDigest,
      candidate_behavior_confirmed: true
    };
    return {
      previous,
      request_receipt: requestReceipt,
      confirmation: {
        ...confirmationMaterial,
        receipt_digest: sha256Digest(confirmationMaterial),
        representation: confirmation.representation
      }
    };
  }

  async function reconcilePromotion({
    target, previous_target_revision_digest: previousTargetRevisionDigest,
    candidate_target_id: candidateTargetId,
    candidate_target_revision_digest: candidateTargetRevisionDigest
  }) {
    const current = await inspect(target);
    const candidateWorkflow = await request(`/workflows/${encodeURIComponent(
      required(candidateTargetId, "candidate_target_id"))}`);
    const candidateMaterial = n8nTargetRevisionMaterial(candidateWorkflow);
    const actualCandidateDigest = sha256Digest(candidateMaterial);
    if (actualCandidateDigest !== required(candidateTargetRevisionDigest,
      "candidate_target_revision_digest")) {
      throw new KernelError(409, "REPAIR_CANDIDATE_TARGET_DRIFT",
        "Inactive n8n candidate no longer matches the verified candidate revision.");
    }
    const candidateBehaviorDigest = sha256Digest(executableBehavior(candidateMaterial));
    const currentBehaviorDigest = sha256Digest(executableBehavior(current.representation));
    let outcome = "target_mismatch";
    if (current.target_revision_digest === required(previousTargetRevisionDigest,
      "previous_target_revision_digest")) {
      outcome = "not_applied";
    } else if (currentBehaviorDigest === candidateBehaviorDigest) {
      outcome = "applied";
    }
    const material = {
      adapter: { ...ADAPTER },
      operation: "confirmation",
      outcome,
      target_id: target.target_id,
      previous_target_revision_digest: previousTargetRevisionDigest,
      candidate_target_revision_digest: actualCandidateDigest,
      current_target_revision_digest: current.target_revision_digest,
      candidate_behavior_digest: candidateBehaviorDigest,
      current_behavior_digest: currentBehaviorDigest,
      read_only: true
    };
    return { ...material, receipt_digest: sha256Digest(material) };
  }

  async function rollback({
    target, expected_current_revision_digest: expectedCurrentRevisionDigest,
    rollback_representation: rollbackRepresentation, idempotency_key: idempotencyKey
  }) {
    required(idempotencyKey, "idempotency_key");
    const current = await inspect(target);
    if (current.target_revision_digest !== required(expectedCurrentRevisionDigest,
      "expected_current_revision_digest")) {
      throw new KernelError(409, "REPAIR_TARGET_DRIFT",
        "Current n8n target revision does not match the rollback precondition.", {
          expected_current_revision_digest: expectedCurrentRevisionDigest,
          current_target_revision_digest: current.target_revision_digest
        });
    }
    const expectedBehaviorDigest = sha256Digest(executableBehavior(rollbackRepresentation));
    const requestMaterial = {
      adapter: { ...ADAPTER },
      operation: "rollback",
      idempotency_key: idempotencyKey,
      target_id: target.target_id,
      expected_current_revision_digest: expectedCurrentRevisionDigest,
      rollback_behavior_digest: expectedBehaviorDigest
    };
    await request(`/workflows/${encodeURIComponent(required(target.target_id, "target.target_id"))}`, {
      method: "PUT",
      body: JSON.stringify({
        name: required(rollbackRepresentation.name, "rollback_representation.name"),
        ...executableBehavior(rollbackRepresentation)
      })
    });
    const confirmation = await inspect(target);
    const actualBehaviorDigest = sha256Digest(executableBehavior(confirmation.representation));
    if (actualBehaviorDigest !== expectedBehaviorDigest ||
        confirmation.active !== rollbackRepresentation.active) {
      throw new KernelError(502, "N8N_ROLLBACK_CONFIRMATION_MISMATCH",
        "n8n target does not match the authorized rollback snapshot.");
    }
    const confirmationMaterial = {
      adapter: { ...ADAPTER },
      operation: "rollback_confirmation",
      target_id: target.target_id,
      target_revision_digest: confirmation.target_revision_digest,
      rollback_behavior_digest: expectedBehaviorDigest,
      rollback_behavior_confirmed: true
    };
    return {
      request_receipt: { ...requestMaterial, receipt_digest: sha256Digest(requestMaterial) },
      confirmation: {
        ...confirmationMaterial,
        receipt_digest: sha256Digest(confirmationMaterial),
        representation: confirmation.representation
      }
    };
  }

  return {
    manifest: structuredClone(N8N_REPAIR_DELIVERY_ADAPTER_MANIFEST),
    inspect,
    snapshot,
    createCandidate,
    promote,
    reconcilePromotion,
    rollback
  };
}
