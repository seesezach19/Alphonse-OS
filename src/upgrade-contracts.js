import { sha256Digest } from "./canonical-json.js";

const STATUS_WEIGHT = {
  compatible_in_place: 0,
  migration_required: 1,
  parallel_major_required: 2,
  unsupported: 3
};

function same(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return sha256Digest(left) === sha256Digest(right);
}

function major(version) {
  const match = /^([0-9]+)\./.exec(version ?? "");
  return match ? Number(match[1]) : null;
}

export function upgradeMajorAdmissible(classification, currentVersion, targetVersion) {
  if (classification !== "parallel_major_required") return true;
  const currentMajor = major(currentVersion);
  const targetMajor = major(targetVersion);
  return currentMajor !== null && targetMajor !== null && targetMajor > currentMajor;
}

function dimension(status = "compatible_in_place", changes = []) {
  return { status, changes };
}

function strongest(statuses) {
  return statuses.reduce((selected, status) => STATUS_WEIGHT[status] > STATUS_WEIGHT[selected] ? status : selected,
    "compatible_in_place");
}

function keyed(exports) {
  return new Map(exports.map((entry) => [`${entry.kind}:${entry.export_id}`, entry]));
}

const LOWER_BOUNDS = ["minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties"];
const UPPER_BOUNDS = ["maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"];

function additiveOptionalOnly(source, destination) {
  if (same(source, destination)) return true;
  if (!source || !destination || source.type !== "object" || destination.type !== "object") return false;
  const sourceProperties = source.properties ?? {};
  const targetProperties = destination.properties ?? {};
  if (Object.keys(sourceProperties).some((property) => !Object.hasOwn(targetProperties, property))) return false;
  const sourceRequired = [...(source.required ?? [])].sort();
  const targetRequired = [...(destination.required ?? [])].sort();
  if (!same(sourceRequired, targetRequired)) return false;
  if (Object.keys(sourceProperties).some((property) => !additiveOptionalOnly(sourceProperties[property], targetProperties[property]))) {
    return false;
  }
  const sourceRest = { ...source };
  const targetRest = { ...destination };
  delete sourceRest.properties;
  delete targetRest.properties;
  if (!same(sourceRest, targetRest)) return false;
  return Object.keys(targetProperties).filter((property) => !Object.hasOwn(sourceProperties, property))
    .every((property) => !targetRequired.includes(property));
}

function compareSchemaNode(source, destination, path, changes) {
  if (!destination || source?.type !== destination?.type) {
    changes.push({ path, change: "type_changed", from: source?.type, to: destination?.type });
    return;
  }
  if (source.format && source.format !== destination.format) {
    changes.push({ path, change: "format_changed", from: source.format, to: destination.format });
  }
  for (const key of LOWER_BOUNDS) {
    if (destination[key] !== undefined && (source[key] === undefined || destination[key] > source[key])) {
      changes.push({ path, change: "constraint_tightened", constraint: key });
    }
  }
  for (const key of UPPER_BOUNDS) {
    if (destination[key] !== undefined && (source[key] === undefined || destination[key] < source[key])) {
      changes.push({ path, change: "constraint_tightened", constraint: key });
    }
  }
  if (Array.isArray(source.enum) && Array.isArray(destination.enum)) {
    const removed = source.enum.filter((value) => !destination.enum.some((candidate) => same(candidate, value)));
    const added = destination.enum.filter((value) => !source.enum.some((candidate) => same(candidate, value)));
    if (removed.length || (added.length && source.open_enum !== true && source["x-open-enum"] !== true)) {
      changes.push({ path, change: "enum_changed", removed, added });
    }
  }
  if (source.type === "object") {
    const sourceProperties = source.properties ?? {};
    const targetProperties = destination.properties ?? {};
    const sourceRequired = new Set(source.required ?? []);
    const targetRequired = new Set(destination.required ?? []);
    const removed = Object.keys(sourceProperties).filter((property) => !Object.hasOwn(targetProperties, property));
    const addedRequired = [...targetRequired].filter((property) => !sourceRequired.has(property));
    if (removed.length) changes.push({ path, change: "properties_removed", properties: removed });
    if (addedRequired.length) changes.push({ path, change: "required_fields_added", properties: addedRequired });
    const sourceAllowsUnknown = source.additionalProperties !== false;
    const targetAllowsUnknown = destination.additionalProperties !== false;
    if (sourceAllowsUnknown && !targetAllowsUnknown) changes.push({ path, change: "unknown_fields_closed" });
    for (const property of Object.keys(sourceProperties).filter((key) => Object.hasOwn(targetProperties, key))) {
      compareSchemaNode(sourceProperties[property], targetProperties[property], `${path}.properties.${property}`, changes);
    }
  }
  if (source.type === "array" && source.items) compareSchemaNode(source.items, destination.items, `${path}.items`, changes);
}

function compareSchemas(currentExports, targetExports) {
  const current = keyed(currentExports.filter((entry) => entry.kind === "schema"));
  const target = keyed(targetExports.filter((entry) => entry.kind === "schema"));
  const changes = [];
  let status = "compatible_in_place";
  for (const [key, source] of current) {
    const destination = target.get(key);
    if (!destination) {
      changes.push({ export: key, change: "removed" });
      status = "parallel_major_required";
      continue;
    }
    const schemaChanges = [];
    compareSchemaNode(source.schema, destination.schema, key, schemaChanges);
    if (schemaChanges.length || major(source.contract_version) !== major(destination.contract_version)) {
      changes.push({ export: key, change: "breaking_schema", details: schemaChanges });
      status = "parallel_major_required";
    } else if (!same(source.schema, destination.schema) && additiveOptionalOnly(source.schema, destination.schema)) {
      changes.push({ export: key, change: "additive_optional_schema" });
    } else if (!same(source.schema, destination.schema)) {
      changes.push({ export: key, change: "unrecognized_schema_change" });
      status = "parallel_major_required";
    }
  }
  return dimension(status, changes);
}

function compareAdapters(currentExports, targetExports) {
  const current = keyed(currentExports.filter((entry) => entry.kind === "adapter"));
  const target = keyed(targetExports.filter((entry) => entry.kind === "adapter"));
  const changes = [];
  let status = "compatible_in_place";
  for (const [key, source] of current) {
    const destination = target.get(key);
    if (!destination) {
      changes.push({ export: key, change: "removed" });
      status = "parallel_major_required";
      continue;
    }
    const removedOperations = (source.operations ?? []).filter((operation) => !(destination.operations ?? []).includes(operation));
    const changedEffects = (source.operations ?? []).filter((operation) => destination.operations?.includes(operation)
      && !same(source.operation_effects?.[operation], destination.operation_effects?.[operation]));
    if (removedOperations.length || changedEffects.length || major(source.contract_version) !== major(destination.contract_version)) {
      changes.push({ export: key, change: "breaking_adapter", removed_operations: removedOperations,
        changed_effects: changedEffects });
      status = "parallel_major_required";
    } else if (!same(source.operations ?? [], destination.operations ?? [])) {
      changes.push({ export: key, change: "additive_adapter_operation" });
    } else if (source.contract_digest !== destination.contract_digest) {
      changes.push({ export: key, change: "adapter_implementation_changed" });
      status = "migration_required";
    }
  }
  return dimension(status, changes);
}

function compareExports(currentExports, targetExports) {
  const current = keyed(currentExports);
  const target = keyed(targetExports);
  const changes = [];
  let status = "compatible_in_place";
  for (const [key, source] of current) {
    const destination = target.get(key);
    if (!destination) {
      changes.push({ export: key, change: "removed" });
      status = "parallel_major_required";
    } else if (major(source.contract_version) !== major(destination.contract_version)) {
      changes.push({ export: key, change: "major_contract_changed" });
      status = "parallel_major_required";
    } else if (!["schema", "adapter"].includes(source.kind)
        && source.contract_digest !== destination.contract_digest) {
      changes.push({ export: key, change: "contract_bytes_changed" });
      if (status === "compatible_in_place") status = "migration_required";
    }
  }
  for (const key of target.keys()) if (!current.has(key)) changes.push({ export: key, change: "added" });
  return dimension(status, changes);
}

function semanticDimension(current, target, change) {
  return same(current, target) ? dimension() : dimension("migration_required", [{ change }]);
}

export function analyzeUpgradeCompatibility(current, target) {
  if (!current?.package_identity || !target?.package_identity
      || !Array.isArray(current.exports) || !Array.isArray(target.exports)) {
    throw new TypeError("Current and target compatibility snapshots are required.");
  }
  const authorityEquivalent = same({ authority: current.authority_semantics, context: current.context_semantics,
    bindings: current.binding_semantics,
    evidence: current.evidence_semantics, recovery: current.recovery_semantics },
  { authority: target.authority_semantics, context: target.context_semantics,
    bindings: target.binding_semantics,
    evidence: target.evidence_semantics, recovery: target.recovery_semantics });
  const dimensions = {
    protocol: same(current.protocol, target.protocol) ? dimension()
      : dimension("unsupported", [{ change: "kernel_protocol_changed" }]),
    dependencies: semanticDimension(current.dependencies, target.dependencies, "dependency_lock_changed"),
    exports: compareExports(current.exports, target.exports),
    schemas: compareSchemas(current.exports, target.exports),
    adapters: compareAdapters(current.exports, target.exports),
    context: semanticDimension(current.context_semantics, target.context_semantics, "context_semantics_changed"),
    authority: authorityEquivalent ? dimension()
      : dimension("migration_required", [{ change: "authority_semantics_changed" }]),
    evidence: semanticDimension(current.evidence_semantics, target.evidence_semantics, "evidence_semantics_changed"),
    recovery: semanticDimension(current.recovery_semantics, target.recovery_semantics, "recovery_semantics_changed")
  };
  return {
    schema_version: "alphonse.upgrade_compatibility_report.v0.1",
    current_package_identity: current.package_identity,
    target_package_identity: target.package_identity,
    dimensions,
    classification: strongest(Object.values(dimensions).map((entry) => entry.status)),
    authority_equivalent: authorityEquivalent,
    fresh_business_approval_required: !authorityEquivalent
  };
}

export function deterministicCanaryAssignment(seed, routingKey, basisPoints) {
  if (typeof seed !== "string" || seed.length < 1 || typeof routingKey !== "string" || routingKey.length < 1) {
    throw new TypeError("Canary seed and routing key are required.");
  }
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
    throw new RangeError("Canary basis points must be an integer from 0 through 10000.");
  }
  const routingKeyDigest = sha256Digest(routingKey);
  const assignmentDigest = sha256Digest({ seed, routing_key_digest: routingKeyDigest });
  const bucket = Number(BigInt(`0x${assignmentDigest.slice(7, 23)}`) % 10000n);
  return { routing_key_digest: routingKeyDigest, assignment_digest: assignmentDigest,
    bucket, selected: bucket < basisPoints };
}

export function retirementBlockers(references, now = Date.now()) {
  const blockers = [];
  if (references.consumers > 0) blockers.push({ code: "CONSUMERS_REMAIN", count: references.consumers });
  if (references.active_runs > 0) blockers.push({ code: "ACTIVE_RUNS_REMAIN", count: references.active_runs });
  if (references.evidence_records > 0) blockers.push({ code: "EVIDENCE_REFERENCES_REMAIN", count: references.evidence_records });
  if (references.recovery_cases > 0) blockers.push({ code: "RECOVERY_REFERENCES_REMAIN", count: references.recovery_cases });
  if ((references.open_obligations ?? 0) > 0) blockers.push({ code: "OPEN_OBLIGATIONS_REMAIN", count: references.open_obligations });
  if ((references.pending_handoffs ?? 0) > 0) blockers.push({ code: "PENDING_HANDOFFS_REMAIN", count: references.pending_handoffs });
  if ((references.upgrade_recovery_records ?? 0) > 0) {
    blockers.push({ code: "UPGRADE_RECOVERY_REFERENCES_REMAIN", count: references.upgrade_recovery_records });
  }
  if (Date.parse(references.retention_until) > now) {
    blockers.push({ code: "RETENTION_WINDOW_ACTIVE", retention_until: references.retention_until });
  }
  return blockers;
}
