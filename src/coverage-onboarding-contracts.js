import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const COVERAGE_ONBOARDING_SCHEMA_VERSION = "alphonse.coverage-onboarding-projection.v0.1";
export const WORKFLOW_DISCOVERY_SNAPSHOT_SCHEMA_VERSION = "alphonse.workflow-discovery-snapshot.v0.1";
export const WORKFLOW_DISCOVERY_REDACTION_POLICY_ID = "alphonse.workflow-discovery-redaction.v0.1";
export const WORKFLOW_DISCOVERY_EXCLUDED_FIELDS = Object.freeze([
  "nodes", "connections", "settings", "credentials", "notes", "staticData", "pinData"
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const STABLE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const SECRET_KEY = /(^|_)(secret|password|token|api[_-]?key|private[_-]?key|credential|auth|authorization|cookie|dsn|connection[_-]?string)($|_)/i;
const SECRET_VALUE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|^Bearer\s+\S+|\b(?:password|passwd|token|api[_-]?key|secret)\s*[=:]\s*\S+|^(?:sk-[A-Za-z0-9_-]{16,}|xox[baprs]-\S+|gh[pousr]_\S+)$/i;

function fail(code, message, details = {}) {
  throw new KernelError(400, code, message, details);
}

function exact(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("COVERAGE_ONBOARDING_INPUT_INVALID", `${field} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalize(actual) !== canonicalize(expected)) {
    fail("COVERAGE_ONBOARDING_INPUT_INVALID", `${field} fields must be exact.`, { expected, actual });
  }
  return value;
}

function string(value, field, maximum = 500, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
      || (pattern && !pattern.test(value))) {
    fail("COVERAGE_ONBOARDING_INPUT_INVALID", `${field} is invalid.`);
  }
  return value;
}

function uuid(value, field) {
  return string(value, field, 100, UUID);
}

function digest(value, field) {
  return string(value, field, 80, DIGEST);
}

function dateTime(value, field) {
  if (typeof value !== "string" || value.length > 60 || Number.isNaN(Date.parse(value))) {
    fail("COVERAGE_ONBOARDING_INPUT_INVALID", `${field} must be an exact date-time.`);
  }
  return value;
}

function integer(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("COVERAGE_ONBOARDING_INPUT_INVALID", `${field} is outside its integer bounds.`);
  }
  return value;
}

export function assertNoSensitiveMaterial(value, field = "material", maximumBytes = 1024 * 1024) {
  const serialized = canonicalize(value);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    fail("COVERAGE_ONBOARDING_MATERIAL_OUT_OF_POLICY", `${field} exceeds its byte limit.`);
  }
  const pending = [{ value, path: field, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.depth > 24) {
      fail("COVERAGE_ONBOARDING_MATERIAL_OUT_OF_POLICY", `${field} exceeds its nesting limit.`);
    }
    if (typeof current.value === "string" && SECRET_VALUE.test(current.value)) {
      fail("COVERAGE_ONBOARDING_SENSITIVE_MATERIAL_REJECTED",
        `${current.path} contains secret-shaped material.`);
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, nested] of Object.entries(current.value)) {
      if (SECRET_KEY.test(key)) {
        fail("COVERAGE_ONBOARDING_SENSITIVE_MATERIAL_REJECTED",
          `${current.path}.${key} is a credential-shaped field.`);
      }
      pending.push({ value: nested, path: `${current.path}.${key}`, depth: current.depth + 1 });
    }
  }
  return value;
}

function command(value, operationId) {
  const envelope = exact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) {
    fail("UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  }
  return {
    command_id: string(envelope.command_id, "command_id", 160),
    operation_id: operationId,
    input: envelope.input
  };
}

function workflowReference(value, field = "input.workflow_reference") {
  const reference = exact(value, field, ["system", "environment", "provider_workflow_id"]);
  return {
    system: string(reference.system, `${field}.system`, 80, STABLE),
    environment: string(reference.environment, `${field}.environment`, 80, STABLE),
    provider_workflow_id: string(reference.provider_workflow_id,
      `${field}.provider_workflow_id`, 200)
  };
}

function adapterBinding(value, field = "input.adapter_binding") {
  const binding = exact(value, field, [
    "adapter_id", "adapter_version", "contract_version", "inventory_scope_id", "inventory_scope_digest"
  ]);
  return {
    adapter_id: string(binding.adapter_id, `${field}.adapter_id`, 160, STABLE),
    adapter_version: string(binding.adapter_version, `${field}.adapter_version`, 100),
    contract_version: string(binding.contract_version, `${field}.contract_version`, 100),
    inventory_scope_id: string(binding.inventory_scope_id, `${field}.inventory_scope_id`, 160, STABLE),
    inventory_scope_digest: digest(binding.inventory_scope_digest, `${field}.inventory_scope_digest`)
  };
}

export function validateCoverageOnboardingOpenCommand(value) {
  const envelope = command(value, "diagnostic.coverage_onboarding.open");
  const input = exact(envelope.input, "input", [
    "environment_id", "reason", "prior_onboarding_id", "work_intent_id", "passport_id",
    "agent_principal_id", "workflow_reference", "adapter_binding"
  ]);
  if (!new Set(["initial_coverage", "revision_change"]).has(input.reason)) {
    fail("COVERAGE_ONBOARDING_INPUT_INVALID", "input.reason is unsupported.");
  }
  if ((input.reason === "revision_change") !== (input.prior_onboarding_id !== null)) {
    fail("COVERAGE_ONBOARDING_INPUT_INVALID",
      "revision_change requires one prior onboarding; initial_coverage prohibits one.");
  }
  const normalized = {
    environment_id: uuid(input.environment_id, "input.environment_id"),
    reason: input.reason,
    prior_onboarding_id: input.prior_onboarding_id === null
      ? null : uuid(input.prior_onboarding_id, "input.prior_onboarding_id"),
    work_intent_id: uuid(input.work_intent_id, "input.work_intent_id"),
    passport_id: uuid(input.passport_id, "input.passport_id"),
    agent_principal_id: uuid(input.agent_principal_id, "input.agent_principal_id"),
    workflow_reference: workflowReference(input.workflow_reference),
    adapter_binding: adapterBinding(input.adapter_binding)
  };
  assertNoSensitiveMaterial(normalized, "input", 32 * 1024);
  return { ...envelope, input: normalized };
}

function inventoryRequest(value) {
  const input = exact(value, "input.inventory_request", ["scope_id", "page_size", "cursor"]);
  return {
    scope_id: string(input.scope_id, "input.inventory_request.scope_id", 160, STABLE),
    page_size: integer(input.page_size, "input.inventory_request.page_size", 1, 250),
    cursor: input.cursor === null ? null : string(input.cursor, "input.inventory_request.cursor", 4096)
  };
}

export function validateCoverageEvidenceCaptureCommand(value) {
  const envelope = command(value, "diagnostic.coverage_onboarding.evidence_capture");
  const input = exact(envelope.input, "input", [
    "onboarding_id", "passport_id", "expected_revision", "inventory_request", "selection",
    "redaction_policy_id"
  ]);
  const selection = exact(input.selection, "input.selection", [
    "provider_workflow_id", "expected_scope_digest", "expected_page_digest", "expected_metadata_digest"
  ]);
  if (input.redaction_policy_id !== WORKFLOW_DISCOVERY_REDACTION_POLICY_ID) {
    fail("COVERAGE_ONBOARDING_INPUT_INVALID", "input.redaction_policy_id is unsupported.");
  }
  const normalized = {
    onboarding_id: uuid(input.onboarding_id, "input.onboarding_id"),
    passport_id: uuid(input.passport_id, "input.passport_id"),
    expected_revision: integer(input.expected_revision, "input.expected_revision", 1, Number.MAX_SAFE_INTEGER),
    inventory_request: inventoryRequest(input.inventory_request),
    selection: {
      provider_workflow_id: string(selection.provider_workflow_id,
        "input.selection.provider_workflow_id", 200),
      expected_scope_digest: digest(selection.expected_scope_digest,
        "input.selection.expected_scope_digest"),
      expected_page_digest: digest(selection.expected_page_digest,
        "input.selection.expected_page_digest"),
      expected_metadata_digest: digest(selection.expected_metadata_digest,
        "input.selection.expected_metadata_digest")
    },
    redaction_policy_id: input.redaction_policy_id
  };
  assertNoSensitiveMaterial(normalized, "input", 32 * 1024);
  return { ...envelope, input: normalized };
}

function tag(value, index, candidateIndex) {
  const field = `inventory.candidates[${candidateIndex}].tags[${index}]`;
  const input = exact(value, field, ["id", "name", "content_class", "instruction_authority"]);
  if (input.content_class !== "untrusted_provider_metadata" || input.instruction_authority !== "none") {
    fail("COVERAGE_INVENTORY_RESPONSE_INVALID", `${field} has invalid trust markers.`);
  }
  return {
    id: string(input.id, `${field}.id`, 200),
    name: string(input.name, `${field}.name`, 200),
    content_class: input.content_class,
    instruction_authority: input.instruction_authority
  };
}

function candidate(value, index) {
  const field = `inventory.candidates[${index}]`;
  const input = exact(value, field, [
    "provider_workflow_id", "display_name", "active", "created_at", "updated_at",
    "provider_revision_reference", "tags", "metadata_digest", "content_class",
    "instruction_authority", "omitted_fields"
  ]);
  if (typeof input.active !== "boolean" || !Array.isArray(input.tags) || input.tags.length > 100
      || !Array.isArray(input.omitted_fields)
      || canonicalize(input.omitted_fields) !== canonicalize(WORKFLOW_DISCOVERY_EXCLUDED_FIELDS)
      || input.content_class !== "untrusted_provider_metadata" || input.instruction_authority !== "none") {
    fail("COVERAGE_INVENTORY_RESPONSE_INVALID", `${field} is outside the discovery contract.`);
  }
  const metadata = {
    provider_workflow_id: string(input.provider_workflow_id, `${field}.provider_workflow_id`, 200),
    display_name: string(input.display_name, `${field}.display_name`, 240),
    active: input.active,
    created_at: input.created_at === null ? null : dateTime(input.created_at, `${field}.created_at`),
    updated_at: input.updated_at === null ? null : dateTime(input.updated_at, `${field}.updated_at`),
    provider_revision_reference: input.provider_revision_reference === null ? null
      : string(input.provider_revision_reference, `${field}.provider_revision_reference`, 240),
    tags: input.tags.map((item, tagIndex) => tag(item, tagIndex, index))
  };
  const metadataDigest = digest(input.metadata_digest, `${field}.metadata_digest`);
  if (sha256Digest(metadata) !== metadataDigest) {
    fail("COVERAGE_INVENTORY_RESPONSE_INVALID", `${field}.metadata_digest does not match exact metadata.`);
  }
  return {
    ...metadata,
    metadata_digest: metadataDigest,
    content_class: input.content_class,
    instruction_authority: input.instruction_authority,
    omitted_fields: [...input.omitted_fields]
  };
}

function omission(value, index) {
  const field = `inventory.omissions[${index}]`;
  const input = exact(value, field, ["code", "count", "fields"]);
  const codes = new Set([
    "WORKFLOW_CONTENT_EXCLUDED", "OUTSIDE_CONFIGURED_SCOPE", "INVALID_PROVIDER_METADATA",
    "PROVIDER_REVISION_REFERENCE_UNAVAILABLE"
  ]);
  if (!codes.has(input.code) || !Array.isArray(input.fields) || input.fields.length > 32) {
    fail("COVERAGE_INVENTORY_RESPONSE_INVALID", `${field} is invalid.`);
  }
  return {
    code: input.code,
    count: integer(input.count, `${field}.count`, 0, 1000000),
    fields: input.fields.map((item, fieldIndex) =>
      string(item, `${field}.fields[${fieldIndex}]`, 100))
  };
}

export function validateWorkflowInventoryPage(value) {
  const page = exact(value, "inventory", [
    "schema_version", "scope", "candidates", "page", "omissions", "health", "authority"
  ]);
  if (page.schema_version !== "alphonse.workflow-inventory-page.v0.1" || page.authority !== "none") {
    fail("COVERAGE_INVENTORY_RESPONSE_INVALID", "Inventory envelope trust markers are invalid.");
  }
  const scope = exact(page.scope, "inventory.scope", [
    "scope_id", "provider", "environment", "scope_basis", "scope_digest"
  ]);
  const pageInfo = exact(page.page, "inventory.page", [
    "current_cursor", "next_cursor", "item_count", "scope_complete", "source_cutoff", "page_digest"
  ]);
  const health = exact(page.health, "inventory.health", ["status", "observed_at", "issues"]);
  if (!Array.isArray(page.candidates) || page.candidates.length > 250 || !Array.isArray(page.omissions)
      || page.omissions.length > 300 || !Array.isArray(health.issues) || health.issues.length > 100
      || !new Set(["credential_access", "project", "workflow_allowlist"]).has(scope.scope_basis)
      || !new Set(["healthy", "degraded", "unavailable", "unknown"]).has(health.status)) {
    fail("COVERAGE_INVENTORY_RESPONSE_INVALID", "Inventory collections or states are invalid.");
  }
  const normalized = {
    schema_version: page.schema_version,
    scope: {
      scope_id: string(scope.scope_id, "inventory.scope.scope_id", 160, STABLE),
      provider: string(scope.provider, "inventory.scope.provider", 80, STABLE),
      environment: string(scope.environment, "inventory.scope.environment", 80, STABLE),
      scope_basis: scope.scope_basis,
      scope_digest: digest(scope.scope_digest, "inventory.scope.scope_digest")
    },
    candidates: page.candidates.map(candidate),
    page: {
      current_cursor: pageInfo.current_cursor === null ? null
        : string(pageInfo.current_cursor, "inventory.page.current_cursor", 4096),
      next_cursor: pageInfo.next_cursor === null ? null
        : string(pageInfo.next_cursor, "inventory.page.next_cursor", 4096),
      item_count: integer(pageInfo.item_count, "inventory.page.item_count", 0, 250),
      scope_complete: pageInfo.scope_complete,
      source_cutoff: dateTime(pageInfo.source_cutoff, "inventory.page.source_cutoff"),
      page_digest: digest(pageInfo.page_digest, "inventory.page.page_digest")
    },
    omissions: page.omissions.map(omission),
    health: {
      status: health.status,
      observed_at: dateTime(health.observed_at, "inventory.health.observed_at"),
      issues: health.issues.map((item, index) => string(item, `inventory.health.issues[${index}]`, 500))
    },
    authority: page.authority
  };
  if (typeof normalized.page.scope_complete !== "boolean"
      || normalized.page.item_count !== normalized.candidates.length
      || normalized.page.scope_complete !== (normalized.page.next_cursor === null)) {
    fail("COVERAGE_INVENTORY_RESPONSE_INVALID", "Inventory page counters are inconsistent.");
  }
  const contentOmission = normalized.omissions.find((item) => item.code === "WORKFLOW_CONTENT_EXCLUDED");
  if (!contentOmission || canonicalize(contentOmission.fields) !== canonicalize(WORKFLOW_DISCOVERY_EXCLUDED_FIELDS)) {
    fail("COVERAGE_INVENTORY_RESPONSE_INVALID", "Inventory must disclose excluded workflow content.");
  }
  assertNoSensitiveMaterial(normalized, "inventory", 1024 * 1024);
  return normalized;
}

export function buildWorkflowDiscoverySnapshot({ onboarding, input, inventory }) {
  const page = validateWorkflowInventoryPage(inventory);
  if (page.scope.scope_id !== onboarding.adapter_binding.inventory_scope_id
      || page.scope.scope_digest !== onboarding.adapter_binding.inventory_scope_digest
      || page.scope.scope_digest !== input.selection.expected_scope_digest
      || page.scope.provider !== onboarding.workflow_reference.system
      || page.scope.environment !== onboarding.workflow_reference.environment
      || page.page.page_digest !== input.selection.expected_page_digest
      || input.inventory_request.scope_id !== page.scope.scope_id
      || page.page.current_cursor !== input.inventory_request.cursor
      || page.candidates.length > input.inventory_request.page_size) {
    throw new KernelError(409, "COVERAGE_DISCOVERY_PROVENANCE_CONFLICT",
      "Inventory page does not match the exact onboarding binding and expected discovery provenance.");
  }
  const selected = page.candidates.find((item) =>
    item.provider_workflow_id === input.selection.provider_workflow_id);
  if (!selected || selected.provider_workflow_id !== onboarding.workflow_reference.provider_workflow_id) {
    throw new KernelError(409, "COVERAGE_DISCOVERY_SELECTION_NOT_FOUND",
      "The exact selected workflow is not present in this inventory page.");
  }
  if (selected.metadata_digest !== input.selection.expected_metadata_digest) {
    throw new KernelError(409, "COVERAGE_DISCOVERY_METADATA_CONFLICT",
      "Selected workflow metadata changed before snapshot capture.");
  }
  const snapshot = {
    schema_version: WORKFLOW_DISCOVERY_SNAPSHOT_SCHEMA_VERSION,
    onboarding_id: onboarding.onboarding_id,
    workflow_reference: structuredClone(onboarding.workflow_reference),
    selected_workflow: selected,
    source: {
      adapter_binding: structuredClone(onboarding.adapter_binding),
      adapter_binding_digest: onboarding.adapter_binding_digest,
      scope: page.scope,
      inventory_request: {
        scope_id: input.inventory_request.scope_id,
        page_size: input.inventory_request.page_size,
        current_cursor_digest: input.inventory_request.cursor === null
          ? null : sha256Digest(input.inventory_request.cursor)
      },
      source_cutoff: page.page.source_cutoff,
      observed_at: page.health.observed_at,
      health: { status: page.health.status, issues: page.health.issues },
      page_digest: page.page.page_digest,
      next_cursor_digest: page.page.next_cursor === null ? null : sha256Digest(page.page.next_cursor),
      scope_complete: page.page.scope_complete
    },
    omissions: page.omissions,
    redaction: {
      policy_id: WORKFLOW_DISCOVERY_REDACTION_POLICY_ID,
      excluded_fields: [...WORKFLOW_DISCOVERY_EXCLUDED_FIELDS],
      workflow_content_received: false,
      provider_credentials_received: false
    },
    provenance: {
      scope_digest: page.scope.scope_digest,
      page_digest: page.page.page_digest,
      selected_metadata_digest: selected.metadata_digest
    },
    authority: "none"
  };
  assertNoSensitiveMaterial(snapshot, "workflow_discovery_snapshot", 1024 * 1024);
  return snapshot;
}

export function coverageOnboardingIdentity(input, workIntentDigest) {
  return {
    environment_id: input.environment_id,
    reason: input.reason,
    prior_onboarding_id: input.prior_onboarding_id,
    work_intent_id: input.work_intent_id,
    work_intent_digest: workIntentDigest,
    passport_id: input.passport_id,
    agent_principal_id: input.agent_principal_id,
    workflow_reference: input.workflow_reference,
    workflow_reference_digest: sha256Digest(input.workflow_reference),
    adapter_binding: input.adapter_binding,
    adapter_binding_digest: sha256Digest(input.adapter_binding)
  };
}

export function buildCoverageOnboardingEvent({ eventId, onboardingId, eventIndex, eventType,
  priorEventDigest, payload, actor, occurredAt }) {
  const document = {
    schema_version: "alphonse.coverage-onboarding-event.v0.1",
    event_id: eventId,
    onboarding_id: onboardingId,
    event_index: eventIndex,
    event_type: eventType,
    prior_event_digest: priorEventDigest,
    payload,
    actor,
    occurred_at: new Date(occurredAt).toISOString()
  };
  return { document, event_digest: sha256Digest(document) };
}

function eventView(row) {
  return {
    event_id: row.event_id,
    event_index: Number(row.event_index),
    event_type: row.event_type,
    prior_event_digest: row.prior_event_digest,
    event_digest: row.event_digest,
    payload: row.payload,
    actor: { type: row.actor_type, id: row.actor_id },
    occurred_at: new Date(row.occurred_at).toISOString(),
    immutable: true
  };
}

export function projectCoverageOnboarding(row, eventRows, snapshotRows = []) {
  const events = eventRows.map(eventView);
  if (events.length === 0 || events[0].event_index !== 1 || events[0].event_type !== "opened") {
    throw new KernelError(500, "COVERAGE_ONBOARDING_INTEGRITY_VIOLATION",
      "Coverage Onboarding must begin with one immutable opened event.");
  }
  let prior = null;
  for (const [index, event] of events.entries()) {
    if (event.event_index !== index + 1) {
      throw new KernelError(500, "COVERAGE_ONBOARDING_INTEGRITY_VIOLATION",
        "Coverage Onboarding event indexes are discontinuous.");
    }
    if (event.prior_event_digest !== prior) {
      throw new KernelError(500, "COVERAGE_ONBOARDING_INTEGRITY_VIOLATION",
        "Coverage Onboarding event chain is discontinuous.");
    }
    const rebuilt = buildCoverageOnboardingEvent({
      eventId: event.event_id,
      onboardingId: row.onboarding_id,
      eventIndex: event.event_index,
      eventType: event.event_type,
      priorEventDigest: event.prior_event_digest,
      payload: event.payload,
      actor: event.actor,
      occurredAt: event.occurred_at
    });
    if (rebuilt.event_digest !== event.event_digest) {
      throw new KernelError(500, "COVERAGE_ONBOARDING_INTEGRITY_VIOLATION",
        "Coverage Onboarding event digest does not match stored material.");
    }
    prior = event.event_digest;
  }
  const snapshotsByEvent = new Map(snapshotRows.map((snapshot) => [Number(snapshot.event_index), snapshot]));
  for (const event of events) {
    const snapshot = snapshotsByEvent.get(event.event_index);
    if (["evidence_captured", "snapshot_replaced"].includes(event.event_type)) {
      if (!snapshot || snapshot.snapshot_digest !== event.payload.snapshot_digest
          || snapshot.source_scope_digest !== event.payload.source_scope_digest
          || snapshot.source_page_digest !== event.payload.source_page_digest
          || snapshot.selected_metadata_digest !== event.payload.selected_metadata_digest) {
        throw new KernelError(500, "COVERAGE_ONBOARDING_INTEGRITY_VIOLATION",
          "Workflow Discovery Snapshot row does not match its append-only event.");
      }
    } else if (snapshot) {
      throw new KernelError(500, "COVERAGE_ONBOARDING_INTEGRITY_VIOLATION",
        "Workflow Discovery Snapshot is not bound to a capture event.");
    }
  }
  const activeSnapshotDigest = [...events].reverse().find((event) =>
    ["evidence_captured", "evidence_reused", "snapshot_replaced"].includes(event.event_type))
    ?.payload.snapshot_digest ?? null;
  const superseded = events.filter((event) => event.event_type === "snapshot_replaced")
    .map((event) => event.payload.prior_snapshot_digest);
  return {
    schema_version: COVERAGE_ONBOARDING_SCHEMA_VERSION,
    onboarding_id: row.onboarding_id,
    installation_id: row.installation_id,
    environment_id: row.environment_id,
    reason: row.reason,
    prior_onboarding_id: row.prior_onboarding_id,
    workflow_reference: row.workflow_reference,
    work_intent: { work_intent_id: row.work_intent_id, work_intent_digest: row.work_intent_digest },
    agent: { passport_id: row.passport_id, agent_principal_id: row.agent_principal_id },
    adapter_binding: row.adapter_binding,
    identity_digest: row.identity_digest,
    revision: events.length,
    event_head_digest: prior,
    status: activeSnapshotDigest ? "interpreting" : "gathering_evidence",
    active_snapshot_digest: activeSnapshotDigest,
    superseded_snapshot_digests: [...new Set(superseded)],
    snapshot_history: snapshotRows.map((snapshot) => ({
      snapshot_digest: snapshot.snapshot_digest,
      source_scope_digest: snapshot.source_scope_digest,
      source_page_digest: snapshot.source_page_digest,
      selected_metadata_digest: snapshot.selected_metadata_digest,
      event_index: Number(snapshot.event_index),
      captured_by: { type: snapshot.captured_by_actor_type, id: snapshot.captured_by_actor_id },
      captured_at: new Date(snapshot.captured_at).toISOString(),
      immutable: true
    })),
    legal_next_operations: [
      "diagnostic.coverage_onboarding.get",
      "diagnostic.coverage_onboarding.evidence_capture"
    ],
    events,
    opened_at: new Date(row.opened_at).toISOString(),
    authority: {
      registration: "not_granted",
      execution: "not_granted",
      monitoring: "not_granted",
      repair: "not_granted",
      activation: "not_granted",
      coverage_claim: "not_granted"
    },
    immutable: true
  };
}
