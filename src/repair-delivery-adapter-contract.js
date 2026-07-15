import { sha256Digest } from "./canonical-json.js";
import {
  requireExact,
  requireString,
  requireUuid
} from "./diagnostic-repair-worker-contracts.js";
import { KernelError } from "./errors.js";

const OPERATION_EFFECTS = Object.freeze({
  inspect: "read_only",
  snapshot: "read_only",
  candidate: "create_inactive_candidate",
  candidate_execution: "execute_inactive_candidate",
  review: "record_review",
  promotion: "promote_candidate",
  confirmation: "confirm_target_revision",
  rollback: "rollback_target_revision"
});
const OPERATION_NAMES = Object.freeze(Object.keys(OPERATION_EFFECTS));
const AUTHORITY = Object.freeze({
  verification: "not_granted",
  owner_authorization: "not_granted",
  promotion: "not_granted",
  rollback: "not_granted"
});

export function getRepairDeliveryAdapterContract() {
  return {
    contract_name: "alphonse.repair_delivery_adapter",
    contract_version: "0.2.0",
    operations: Object.fromEntries(OPERATION_NAMES.map((name) => [name, {
      effect: OPERATION_EFFECTS[name], independently_declared: true
    }])),
    invariants: {
      bindings_are_secret_free: true,
      unsupported_operations_are_unavailable: true,
      candidate_creation_is_inactive: true,
      expected_base_revision_is_required: true,
      promotion_authority_is_separate: true
    }
  };
}

function fail(code, message, details = {}) {
  throw new KernelError(400, code, message, details);
}

function externalCredentialReference(value) {
  const reference = requireString(value, "external_credential_binding_ref", 300);
  if (!/^(customer-secret-store|environment-binding|credential-broker):[a-zA-Z0-9][a-zA-Z0-9._:/-]+$/.test(reference)) {
    fail("INVALID_EXTERNAL_CREDENTIAL_BINDING_REF",
      "External credential binding must use an approved reference scheme, never credential material.");
  }
  return reference;
}

export function assertRepairDeliveryAdapterManifest(value) {
  const manifest = requireExact(value, "Repair Delivery Adapter manifest", [
    "adapter_id", "adapter_version", "target_system", "operations"
  ]);
  let operations;
  try {
    operations = requireExact(manifest.operations, "Repair Delivery Adapter operations", OPERATION_NAMES);
  } catch (error) {
    if (error.code === "INVALID_INPUT") {
      fail("INVALID_REPAIR_DELIVERY_ADAPTER", "Repair Delivery Adapter must declare every operation independently.");
    }
    throw error;
  }
  const normalized = {};
  for (const name of OPERATION_NAMES) {
    const operation = requireExact(operations[name], `operations.${name}`, ["supported", "effect"]);
    if (typeof operation.supported !== "boolean") {
      fail("INVALID_REPAIR_DELIVERY_ADAPTER", `${name}.supported must be boolean.`);
    }
    const expectedEffect = operation.supported ? OPERATION_EFFECTS[name] : "unavailable";
    if (operation.effect !== expectedEffect) {
      fail("INVALID_REPAIR_DELIVERY_ADAPTER", `${name}.effect must be ${expectedEffect}.`);
    }
    normalized[name] = { supported: operation.supported, effect: operation.effect };
  }
  return {
    adapter_id: requireString(manifest.adapter_id, "adapter_id", 160),
    adapter_version: requireString(manifest.adapter_version, "adapter_version", 100),
    target_system: requireString(manifest.target_system, "target_system", 80),
    operations: normalized
  };
}

export function validateRepairDeliveryBinding(value, adapterManifest) {
  const manifest = assertRepairDeliveryAdapterManifest(adapterManifest);
  const input = requireExact(value, "Repair Delivery Binding", [
    "binding_id", "adapter", "target", "external_credential_binding_ref",
    "permitted_operations", "transition_policy"
  ]);
  const adapter = requireExact(input.adapter, "adapter", ["adapter_id", "adapter_version"]);
  if (adapter.adapter_id !== manifest.adapter_id || adapter.adapter_version !== manifest.adapter_version) {
    fail("REPAIR_DELIVERY_ADAPTER_MISMATCH", "Binding must select the exact available adapter version.");
  }
  const target = requireExact(input.target, "target", [
    "system", "target_type", "target_id", "environment"
  ]);
  if (target.system !== manifest.target_system) {
    fail("REPAIR_DELIVERY_TARGET_MISMATCH", "Binding target system does not match the adapter.");
  }
  if (!Array.isArray(input.permitted_operations) || input.permitted_operations.length === 0) {
    fail("INVALID_INPUT", "permitted_operations must be a non-empty array.");
  }
  const permittedOperations = input.permitted_operations.map((name, index) =>
    requireString(name, `permitted_operations[${index}]`, 80));
  if (new Set(permittedOperations).size !== permittedOperations.length) {
    fail("INVALID_INPUT", "permitted_operations cannot contain duplicates.");
  }
  for (const name of permittedOperations) {
    if (!manifest.operations[name]?.supported) {
      fail("REPAIR_DELIVERY_OPERATION_UNAVAILABLE", `Repair Delivery operation ${name} is unavailable.`);
    }
  }
  for (const required of ["inspect", "snapshot", "candidate"]) {
    if (!permittedOperations.includes(required)) {
      fail("INVALID_REPAIR_DELIVERY_BINDING", `Repair Delivery Binding requires ${required}.`);
    }
  }
  const policy = requireExact(input.transition_policy, "transition_policy", [
    "candidate_initial_state", "require_expected_base_revision",
    "preserve_prechange_snapshot", "promotion_authority"
  ]);
  if (policy.candidate_initial_state !== "inactive" || policy.require_expected_base_revision !== true ||
      policy.preserve_prechange_snapshot !== true || policy.promotion_authority !== "owner_only") {
    fail("INVALID_REPAIR_DELIVERY_BINDING", "Transition policy must preserve the inactive, drift-fenced boundary.");
  }
  const normalized = {
    binding_id: requireUuid(input.binding_id, "binding_id"),
    adapter: {
      adapter_id: requireString(adapter.adapter_id, "adapter.adapter_id", 160),
      adapter_version: requireString(adapter.adapter_version, "adapter.adapter_version", 100)
    },
    target: {
      system: requireString(target.system, "target.system", 80),
      target_type: requireString(target.target_type, "target.target_type", 80),
      target_id: requireString(target.target_id, "target.target_id", 200),
      environment: requireString(target.environment, "target.environment", 80)
    },
    external_credential_binding_ref: externalCredentialReference(input.external_credential_binding_ref),
    permitted_operations: permittedOperations,
    transition_policy: {
      candidate_initial_state: "inactive",
      require_expected_base_revision: true,
      preserve_prechange_snapshot: true,
      promotion_authority: "owner_only"
    }
  };
  return { ...normalized, binding_digest: sha256Digest(normalized) };
}

export function requireRepairDeliveryOperation(binding, operation) {
  if (!OPERATION_NAMES.includes(operation) || !binding.permitted_operations.includes(operation)) {
    throw new KernelError(409, "REPAIR_DELIVERY_OPERATION_UNAVAILABLE",
      `Repair Delivery operation ${operation} is unavailable for this binding.`);
  }
}

export function projectRepairDelivery(delivery) {
  if (delivery.target_candidate_state !== "inactive") {
    return { state: "invalid", legal_next_operations: [], authority: { ...AUTHORITY } };
  }
  return {
    state: "inactive_candidate",
    legal_next_operations: ["diagnostic.repair_verification.create"],
    authority: { ...AUTHORITY }
  };
}

export function repairDeliveryAuthority() {
  return { ...AUTHORITY };
}
