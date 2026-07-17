import { sha256Digest } from "./canonical-json.js";

function text(value, label, maximum = 200) {
  if (typeof value !== "string" || !value || value.length > maximum) throw new Error(`${label} must be bounded text`);
  return value;
}

export function createCrmRequestObservationClaims(value) {
  const status = Number(value.transport_status);
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("transport status is invalid");
  return {
    request_id: text(value.request_id, "request id"),
    logical_operation_id: text(value.logical_operation_id, "logical operation id"),
    delivery_id: text(value.delivery_id, "delivery id"),
    operation: text(value.operation, "operation"),
    transport_status: status,
    transport_outcome: status >= 200 && status < 300 ? "acknowledged" : "rejected",
    idempotency_key_equality_token: text(value.idempotency_key_equality_token, "idempotency equality token")
  };
}

export function createCrmCommit(value, committedAt = new Date().toISOString()) {
  const identity = {
    request_id: text(value.request_id, "request id"),
    logical_operation_id: text(value.logical_operation_id, "logical operation id"),
    delivery_id: text(value.delivery_id, "delivery id"),
    idempotency_key: text(value.idempotency_key, "idempotency key")
  };
  const commitId = `crm_commit_${sha256Digest(identity).slice("sha256:".length, "sha256:".length + 32)}`;
  return { commit_id: commitId, resource_id: `crm_lead_${commitId.slice(-16)}`,
    operation: "create_lead", ...identity, lead_digest: sha256Digest(value.lead), committed_at: committedAt };
}

export function createCrmEffectObservationClaims(commit) {
  return {
    commit_id: text(commit.commit_id, "commit id"),
    resource_id: text(commit.resource_id, "resource id"),
    request_id: text(commit.request_id, "request id"),
    logical_operation_id: text(commit.logical_operation_id, "logical operation id"),
    delivery_id: text(commit.delivery_id, "delivery id"),
    operation: "create_lead",
    effect_feed: "mock_crm_append_only_ledger",
    committed_at: text(commit.committed_at, "committed at"),
    external_claim: true
  };
}
