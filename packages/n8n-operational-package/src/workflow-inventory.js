import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const INVENTORY_SCHEMA_VERSION = "alphonse.workflow-inventory-page.v0.1";
const CONTENT_OMITTED_FIELDS = Object.freeze([
  "nodes", "connections", "settings", "credentials", "notes", "staticData", "pinData"
]);

export class N8nInventoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "N8nInventoryError";
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new N8nInventoryError(status, code, message);
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function exactObject(value, allowed, required, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, "N8N_INVENTORY_INVALID_INPUT", `${label} must be an object.`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
    fail(400, "N8N_INVENTORY_INVALID_INPUT", `${label} fields are invalid.`);
  }
  return value;
}

function boundedString(value, label, maximum, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
      || (pattern && !pattern.test(value))) {
    fail(400, "N8N_INVENTORY_INVALID_INPUT", `${label} is invalid.`);
  }
  return value;
}

function nullableDate(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 60 || Number.isNaN(Date.parse(value))) {
    fail(502, "N8N_INVENTORY_PROVIDER_RESPONSE_INVALID", `${label} is invalid.`);
  }
  return value;
}

function omission(code, count, fields = []) {
  return { code, count, fields };
}

export function normalizeN8nInventoryScope(value) {
  const scope = exactObject(value,
    ["scope_id", "environment", "project_id", "active", "allowed_workflow_ids"],
    ["scope_id", "environment"], "scope");
  const scopeId = boundedString(scope.scope_id, "scope.scope_id", 160,
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/);
  const environment = boundedString(scope.environment, "scope.environment", 80,
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/);
  const projectId = scope.project_id === undefined || scope.project_id === null
    ? null : boundedString(scope.project_id, "scope.project_id", 200);
  if (scope.active !== undefined && scope.active !== null && typeof scope.active !== "boolean") {
    fail(400, "N8N_INVENTORY_INVALID_INPUT", "scope.active must be boolean or null.");
  }
  if (scope.allowed_workflow_ids !== undefined && !Array.isArray(scope.allowed_workflow_ids)) {
    fail(400, "N8N_INVENTORY_INVALID_INPUT", "scope.allowed_workflow_ids must be an array.");
  }
  const allowedWorkflowIds = (scope.allowed_workflow_ids ?? []).map((workflowId, index) =>
    boundedString(workflowId, `scope.allowed_workflow_ids[${index}]`, 200));
  if (allowedWorkflowIds.length > 1000 || new Set(allowedWorkflowIds).size !== allowedWorkflowIds.length) {
    fail(400, "N8N_INVENTORY_INVALID_INPUT", "scope.allowed_workflow_ids must be unique and bounded.");
  }
  if (projectId && allowedWorkflowIds.length > 0) {
    fail(400, "N8N_INVENTORY_INVALID_INPUT",
      "Use one provider project scope or one exact workflow allowlist, not both.");
  }
  const normalized = {
    scope_id: scopeId,
    environment,
    project_id: projectId,
    active: scope.active ?? null,
    allowed_workflow_ids: [...allowedWorkflowIds].sort()
  };
  return Object.freeze({
    ...normalized,
    scope_basis: projectId ? "project"
      : allowedWorkflowIds.length > 0 ? "workflow_allowlist" : "credential_access",
    scope_digest: digest(normalized)
  });
}

export function normalizeN8nInventoryRequest(value) {
  const request = exactObject(value, ["scope_id", "page_size", "cursor"],
    ["scope_id", "page_size", "cursor"], "request");
  const scopeId = boundedString(request.scope_id, "request.scope_id", 160,
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/);
  if (!Number.isInteger(request.page_size) || request.page_size < 1 || request.page_size > 250) {
    fail(400, "N8N_INVENTORY_INVALID_INPUT", "request.page_size must be an integer from 1 through 250.");
  }
  if (request.cursor !== null && (typeof request.cursor !== "string" || request.cursor.length > 4096)) {
    fail(400, "N8N_INVENTORY_INVALID_INPUT", "request.cursor must be null or a bounded string.");
  }
  return { scope_id: scopeId, page_size: request.page_size, cursor: request.cursor };
}

function assertCursorSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 4096) {
    fail(503, "N8N_INVENTORY_NOT_CONFIGURED", "A dedicated inventory cursor secret is required.");
  }
  return secret;
}

function encodeCursor(payload, secret) {
  const encodedPayload = Buffer.from(canonicalize(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", assertCursorSecret(secret))
    .update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function decodeN8nInventoryCursor(cursor, scope, secret) {
  if (cursor === null) return null;
  const parts = cursor.split(".");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    fail(400, "N8N_INVENTORY_CURSOR_INVALID", "Inventory cursor is malformed.");
  }
  const expected = createHmac("sha256", assertCursorSecret(secret))
    .update(parts[0]).digest();
  let supplied;
  try {
    supplied = Buffer.from(parts[1], "base64url");
  } catch {
    fail(400, "N8N_INVENTORY_CURSOR_INVALID", "Inventory cursor signature is malformed.");
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    fail(400, "N8N_INVENTORY_CURSOR_INVALID", "Inventory cursor signature is invalid.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    fail(400, "N8N_INVENTORY_CURSOR_INVALID", "Inventory cursor payload is invalid.");
  }
  exactObject(payload, ["version", "scope_digest", "provider_cursor"],
    ["version", "scope_digest", "provider_cursor"], "cursor");
  if (payload.version !== 1 || payload.scope_digest !== scope.scope_digest
      || typeof payload.provider_cursor !== "string" || payload.provider_cursor.length > 4096) {
    fail(409, "N8N_INVENTORY_CURSOR_SCOPE_CONFLICT",
      "Inventory cursor does not belong to the configured scope.");
  }
  return payload.provider_cursor;
}

export function buildN8nInventoryUrl(baseUrl, scope, request, providerCursor) {
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
    fail(503, "N8N_INVENTORY_NOT_CONFIGURED", "n8n API URL is unavailable.");
  }
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/workflows`);
  url.searchParams.set("limit", String(request.page_size));
  if (scope.active !== null) url.searchParams.set("active", String(scope.active));
  if (scope.project_id !== null) url.searchParams.set("projectId", scope.project_id);
  if (providerCursor !== null) url.searchParams.set("cursor", providerCursor);
  return url;
}

function normalizeTag(value, workflowIndex, tagIndex) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(502, "N8N_INVENTORY_PROVIDER_RESPONSE_INVALID",
      `workflows[${workflowIndex}].tags[${tagIndex}] must be an object.`);
  }
  return {
    id: boundedString(String(value.id ?? ""), `workflows[${workflowIndex}].tags[${tagIndex}].id`, 200),
    name: boundedString(value.name, `workflows[${workflowIndex}].tags[${tagIndex}].name`, 200),
    content_class: "untrusted_provider_metadata",
    instruction_authority: "none"
  };
}

function normalizeCandidate(value, workflowIndex) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(502, "N8N_INVENTORY_PROVIDER_RESPONSE_INVALID", `workflows[${workflowIndex}] must be an object.`);
  }
  const providerWorkflowId = boundedString(String(value.id ?? ""),
    `workflows[${workflowIndex}].id`, 200);
  const displayName = boundedString(value.name, `workflows[${workflowIndex}].name`, 240);
  if (typeof value.active !== "boolean") {
    fail(502, "N8N_INVENTORY_PROVIDER_RESPONSE_INVALID",
      `workflows[${workflowIndex}].active must be boolean.`);
  }
  const createdAt = nullableDate(value.createdAt, `workflows[${workflowIndex}].createdAt`);
  const updatedAt = nullableDate(value.updatedAt, `workflows[${workflowIndex}].updatedAt`);
  const revision = value.versionId === null || value.versionId === undefined
    ? null : boundedString(String(value.versionId), `workflows[${workflowIndex}].versionId`, 240);
  if (value.tags !== undefined && !Array.isArray(value.tags)) {
    fail(502, "N8N_INVENTORY_PROVIDER_RESPONSE_INVALID", `workflows[${workflowIndex}].tags must be an array.`);
  }
  if ((value.tags?.length ?? 0) > 100) {
    fail(502, "N8N_INVENTORY_PROVIDER_RESPONSE_INVALID", `workflows[${workflowIndex}].tags is too large.`);
  }
  const tags = (value.tags ?? []).map((tag, tagIndex) => normalizeTag(tag, workflowIndex, tagIndex));
  const metadata = {
    provider_workflow_id: providerWorkflowId,
    display_name: displayName,
    active: value.active,
    created_at: createdAt,
    updated_at: updatedAt,
    provider_revision_reference: revision,
    tags
  };
  return {
    ...metadata,
    metadata_digest: digest(metadata),
    content_class: "untrusted_provider_metadata",
    instruction_authority: "none",
    omitted_fields: [...CONTENT_OMITTED_FIELDS]
  };
}

export function normalizeN8nInventoryPage({
  providerResponse, scope, request, providerCursor, cursorSecret, retrievedAt
}) {
  if (!providerResponse || typeof providerResponse !== "object" || Array.isArray(providerResponse)
      || !Array.isArray(providerResponse.data)) {
    fail(502, "N8N_INVENTORY_PROVIDER_RESPONSE_INVALID", "n8n inventory response is invalid.");
  }
  if (providerResponse.nextCursor !== undefined && providerResponse.nextCursor !== null
      && (typeof providerResponse.nextCursor !== "string" || providerResponse.nextCursor.length > 4096)) {
    fail(502, "N8N_INVENTORY_PROVIDER_RESPONSE_INVALID", "n8n nextCursor is invalid.");
  }
  if (typeof retrievedAt !== "string" || Number.isNaN(Date.parse(retrievedAt))) {
    fail(500, "N8N_INVENTORY_INTERNAL_ERROR", "retrievedAt must be an exact date-time.");
  }
  const allowedIds = new Set(scope.allowed_workflow_ids);
  const candidates = [];
  let scopeFiltered = 0;
  let invalidMetadata = 0;
  let revisionUnavailable = 0;
  for (const [index, workflow] of providerResponse.data.entries()) {
    const workflowId = String(workflow?.id ?? "");
    if (allowedIds.size > 0 && !allowedIds.has(workflowId)) {
      scopeFiltered += 1;
      continue;
    }
    try {
      const candidate = normalizeCandidate(workflow, index);
      if (candidate.provider_revision_reference === null) revisionUnavailable += 1;
      candidates.push(candidate);
    } catch (error) {
      if (!(error instanceof N8nInventoryError)) throw error;
      invalidMetadata += 1;
    }
  }
  const nextProviderCursor = providerResponse.nextCursor ?? null;
  const nextCursor = nextProviderCursor === null ? null : encodeCursor({
    version: 1,
    scope_digest: scope.scope_digest,
    provider_cursor: nextProviderCursor
  }, cursorSecret);
  const omissions = [omission("WORKFLOW_CONTENT_EXCLUDED", candidates.length, [...CONTENT_OMITTED_FIELDS])];
  if (scopeFiltered > 0) omissions.push(omission("OUTSIDE_CONFIGURED_SCOPE", scopeFiltered));
  if (invalidMetadata > 0) omissions.push(omission("INVALID_PROVIDER_METADATA", invalidMetadata));
  if (revisionUnavailable > 0) {
    omissions.push(omission("PROVIDER_REVISION_REFERENCE_UNAVAILABLE", revisionUnavailable,
      ["provider_revision_reference"]));
  }
  const pageMaterial = {
    scope_digest: scope.scope_digest,
    provider_cursor: providerCursor,
    next_provider_cursor: nextProviderCursor,
    candidate_digests: candidates.map((candidate) => candidate.metadata_digest),
    omissions
  };
  return {
    schema_version: INVENTORY_SCHEMA_VERSION,
    scope: {
      scope_id: scope.scope_id,
      provider: "n8n",
      environment: scope.environment,
      scope_basis: scope.scope_basis,
      scope_digest: scope.scope_digest
    },
    candidates,
    page: {
      current_cursor: request.cursor,
      next_cursor: nextCursor,
      item_count: candidates.length,
      scope_complete: nextProviderCursor === null,
      source_cutoff: retrievedAt,
      page_digest: digest(pageMaterial)
    },
    omissions,
    health: { status: "healthy", observed_at: retrievedAt, issues: [] },
    authority: "none"
  };
}

export async function listN8nWorkflowInventory({
  baseUrl, apiKey, scope: scopeInput, cursorSecret, input, fetchImpl = fetch,
  now = () => new Date().toISOString()
}) {
  if (typeof apiKey !== "string" || apiKey.length === 0 || apiKey.length > 8192) {
    fail(503, "N8N_INVENTORY_NOT_CONFIGURED", "A provider API credential is required at the adapter edge.");
  }
  const scope = normalizeN8nInventoryScope(scopeInput);
  const request = normalizeN8nInventoryRequest(input);
  if (request.scope_id !== scope.scope_id) {
    fail(403, "N8N_INVENTORY_SCOPE_REJECTED", "Requested inventory scope is not configured for this adapter.");
  }
  const providerCursor = decodeN8nInventoryCursor(request.cursor, scope, cursorSecret);
  const url = buildN8nInventoryUrl(baseUrl, scope, request, providerCursor);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", "x-n8n-api-key": apiKey }
    });
  } catch {
    fail(502, "N8N_INVENTORY_PROVIDER_UNAVAILABLE", "n8n inventory request failed.");
  }
  if (!response.ok) {
    const code = [401, 403].includes(response.status)
      ? "N8N_INVENTORY_CREDENTIAL_REJECTED" : "N8N_INVENTORY_PROVIDER_UNAVAILABLE";
    fail(502, code, `n8n inventory request returned HTTP ${response.status}.`);
  }
  let providerResponse;
  try {
    providerResponse = await response.json();
  } catch {
    fail(502, "N8N_INVENTORY_PROVIDER_RESPONSE_INVALID", "n8n inventory response was not JSON.");
  }
  return normalizeN8nInventoryPage({
    providerResponse,
    scope,
    request,
    providerCursor,
    cursorSecret,
    retrievedAt: now()
  });
}
