import { sha256Digest } from "./canonical-json.js";
import {
  requireDigest,
  requireExact,
  requireObject,
  requireString,
  requireUuid
} from "./diagnostic-repair-worker-contracts.js";
import { KernelError } from "./errors.js";

const MACHINE_TYPES = new Set([
  "repair_worker", "diagnostic_worker", "verification_runner", "runtime_adapter", "agent"
]);

export function promotionAuthority(state = "unavailable") {
  const authorizationRecorded = [
    "authorized", "requested", "applying", "uncertain", "confirmed", "failed",
    "target_mismatch", "rolling_back", "rolled_back"
  ].includes(state);
  return {
    owner_authorization: authorizationRecorded ? "recorded" : "not_granted",
    promotion: state === "authorized" ? "owner_authorized_adapter_only" : "not_granted",
    rollback: state === "confirmed" ? "owner_only" : "not_granted",
    production_effects: "not_granted"
  };
}

export function buildPromotionAuthorization({
  promotionId, caseId, candidateId, deliveryId, verificationId, binding, owner,
  expectedTargetRevisionDigest, candidateTargetRevisionDigest, verificationReceiptDigest,
  idempotencyKey
}) {
  const selectedBinding = requireExact(binding, "binding", ["binding_id", "adapter", "target"]);
  const adapter = requireExact(selectedBinding.adapter, "binding.adapter", ["adapter_id", "adapter_version"]);
  const target = requireExact(selectedBinding.target, "binding.target",
    ["system", "target_type", "target_id", "environment"]);
  const selectedOwner = requireExact(requireObject(owner, "owner"), "owner", ["type", "id"]);
  const ownerType = requireString(selectedOwner.type, "owner.type", 80);
  if (ownerType !== "human" || MACHINE_TYPES.has(ownerType)) {
    throw new KernelError(403, "OWNER_AUTHORITY_REQUIRED",
      "Promotion authorization requires an authenticated customer Owner.");
  }
  const material = {
    schema_version: "0.2.0",
    promotion_id: requireUuid(promotionId, "promotion_id"),
    case_id: requireUuid(caseId, "case_id"),
    candidate_id: requireUuid(candidateId, "candidate_id"),
    delivery_id: requireUuid(deliveryId, "delivery_id"),
    verification_id: requireUuid(verificationId, "verification_id"),
    binding_id: requireUuid(selectedBinding.binding_id, "binding.binding_id"),
    adapter: {
      adapter_id: requireString(adapter.adapter_id, "binding.adapter.adapter_id", 160),
      adapter_version: requireString(adapter.adapter_version, "binding.adapter.adapter_version", 100)
    },
    target: {
      system: requireString(target.system, "binding.target.system", 80),
      target_type: requireString(target.target_type, "binding.target.target_type", 80),
      target_id: requireString(target.target_id, "binding.target.target_id", 200),
      environment: requireString(target.environment, "binding.target.environment", 80)
    },
    expected_target_revision_digest: requireDigest(expectedTargetRevisionDigest,
      "expected_target_revision_digest"),
    candidate_target_revision_digest: requireDigest(candidateTargetRevisionDigest,
      "candidate_target_revision_digest"),
    verification_receipt_digest: requireDigest(verificationReceiptDigest, "verification_receipt_digest"),
    owner: { type: "human", id: requireString(selectedOwner.id, "owner.id", 200) },
    idempotency_key: requireString(idempotencyKey, "idempotency_key", 200),
    authority: promotionAuthority("authorized")
  };
  return { ...material, authorization_digest: sha256Digest(material) };
}

export function projectPromotion(events) {
  const latest = [...events].sort((a, b) => Number(a.event_index ?? 0) - Number(b.event_index ?? 0)).at(-1);
  if (!latest) return { state: "invalid", legal_next_operations: [], authority: promotionAuthority() };
  if (latest.event_type === "confirmed") {
    return { state: "confirmed", legal_next_operations: [
      "diagnostic.promotion.rollback", "diagnostic.promotion.get"
    ],
      authority: promotionAuthority("confirmed") };
  }
  if (latest.event_type === "failed") {
    return { state: "failed", legal_next_operations: ["diagnostic.promotion.get"],
      authority: promotionAuthority("failed") };
  }
  if (latest.event_type === "application_requested") {
    return { state: "requested", legal_next_operations: ["diagnostic.promotion.get"],
      authority: promotionAuthority("requested") };
  }
  if (latest.event_type === "applying") {
    return { state: "applying", legal_next_operations: ["diagnostic.promotion.get"],
      authority: promotionAuthority("applying") };
  }
  if (latest.event_type === "uncertain") {
    return { state: "uncertain", legal_next_operations: [
      "diagnostic.promotion.reconcile", "diagnostic.promotion.get"
    ], authority: promotionAuthority("uncertain") };
  }
  if (latest.event_type === "target_mismatch") {
    return { state: "target_mismatch", legal_next_operations: [
      "diagnostic.promotion.get", "diagnostic.case.get"
    ], authority: promotionAuthority("target_mismatch"), human_review_required: true };
  }
  if (latest.event_type === "rollback_authorized") {
    return { state: "rolling_back", legal_next_operations: ["diagnostic.promotion.get"],
      authority: promotionAuthority("rolling_back") };
  }
  if (latest.event_type === "rolled_back") {
    return { state: "rolled_back", legal_next_operations: [
      "diagnostic.promotion.get", "diagnostic.case.get"
    ], authority: promotionAuthority("rolled_back") };
  }
  if (latest.event_type === "authorized") {
    return { state: "authorized", legal_next_operations: ["diagnostic.promotion.apply"],
      authority: promotionAuthority("authorized") };
  }
  return { state: "invalid", legal_next_operations: [], authority: promotionAuthority() };
}
