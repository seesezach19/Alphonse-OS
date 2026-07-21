import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  buildN8nExecutionWorkflowFingerprint,
  normalizeAttestationBinding
} from "./runtime-attestation.js";
import { normalizeN8nInventoryScope } from "./workflow-inventory.js";

export const N8N_EXECUTION_HISTORY_SCHEMA_VERSION =
  "alphonse.workflow-execution-history-page.v0.1";

const PROVIDER_STATUSES = Object.freeze([
  "success", "error", "crashed", "canceled", "new", "running", "waiting"
]);
const EXECUTION_CLASSES = Object.freeze({
  webhook: "production", trigger: "production", retry: "retry", manual: "manual",
  evaluation: "test", integrated: "test"
});

export class N8nExecutionHistoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "N8nExecutionHistoryError";
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new N8nExecutionHistoryError(status, code, message);
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

function exact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || canonicalize(Object.keys(value).sort()) !== canonicalize([...fields].sort())) {
    fail(400, "N8N_EXECUTION_HISTORY_INVALID_INPUT", `${label} fields must be exact.`);
  }
  return value;
}

function string(value, label, maximum = 200) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    fail(400, "N8N_EXECUTION_HISTORY_INVALID_INPUT", `${label} is invalid.`);
  }
  return value;
}

function timestamp(value, label, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    fail(502, "N8N_EXECUTION_HISTORY_PROVIDER_RESPONSE_INVALID", `${label} is invalid.`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function nullableId(value, label) {
  if (value === null || value === undefined) return null;
  return string(String(value), label, 200);
}

function assertCursorSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 4096) {
    fail(503, "N8N_EXECUTION_HISTORY_NOT_CONFIGURED",
      "A dedicated execution-history cursor secret is required.");
  }
  return secret;
}

function encodeCursor(payload, secret) {
  const encoded = Buffer.from(canonicalize(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", assertCursorSecret(secret)).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function normalizeN8nExecutionHistoryRequest(value) {
  const request = exact(value, ["scope_id", "provider_workflow_id", "page_size", "cursor"], "request");
  const scopeId = string(request.scope_id, "request.scope_id", 160);
  const providerWorkflowId = string(request.provider_workflow_id,
    "request.provider_workflow_id", 200);
  if (!Number.isInteger(request.page_size) || request.page_size < 1 || request.page_size > 100) {
    fail(400, "N8N_EXECUTION_HISTORY_INVALID_INPUT",
      "request.page_size must be an integer from 1 through 100.");
  }
  if (request.cursor !== null && (typeof request.cursor !== "string" || request.cursor.length > 4096)) {
    fail(400, "N8N_EXECUTION_HISTORY_INVALID_INPUT", "request.cursor must be null or bounded text.");
  }
  return { scope_id: scopeId, provider_workflow_id: providerWorkflowId,
    page_size: request.page_size, cursor: request.cursor };
}

export function decodeN8nExecutionHistoryCursor(cursor, { scopeDigest, providerWorkflowId }, secret) {
  if (cursor === null) return null;
  const parts = cursor.split(".");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    fail(400, "N8N_EXECUTION_HISTORY_CURSOR_INVALID", "Execution-history cursor is malformed.");
  }
  const expected = createHmac("sha256", assertCursorSecret(secret)).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], "base64url"); }
  catch { fail(400, "N8N_EXECUTION_HISTORY_CURSOR_INVALID", "Cursor signature is malformed."); }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    fail(400, "N8N_EXECUTION_HISTORY_CURSOR_INVALID", "Cursor signature is invalid.");
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { fail(400, "N8N_EXECUTION_HISTORY_CURSOR_INVALID", "Cursor payload is invalid."); }
  exact(payload, ["version", "scope_digest", "provider_workflow_id", "source_cutoff",
    "provider_cursor", "page_index"], "cursor");
  if (payload.version !== 1 || payload.scope_digest !== scopeDigest
      || payload.provider_workflow_id !== providerWorkflowId
      || typeof payload.provider_cursor !== "string" || payload.provider_cursor.length > 4096
      || !Number.isInteger(payload.page_index) || payload.page_index < 1
      || !Number.isFinite(Date.parse(payload.source_cutoff))) {
    fail(409, "N8N_EXECUTION_HISTORY_CURSOR_SCOPE_CONFLICT",
      "Cursor does not belong to the exact workflow, scope, or reconciliation cutoff.");
  }
  return payload;
}

export function buildN8nExecutionHistoryUrl(baseUrl, request, providerCursor) {
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
    fail(503, "N8N_EXECUTION_HISTORY_NOT_CONFIGURED", "n8n API URL is unavailable.");
  }
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/executions`);
  url.searchParams.set("includeData", "true");
  url.searchParams.set("limit", String(request.page_size));
  url.searchParams.set("workflowId", request.provider_workflow_id);
  if (providerCursor !== null) url.searchParams.set("cursor", providerCursor);
  return url;
}

function normalizeExecution(value, index, binding) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(502, "N8N_EXECUTION_HISTORY_PROVIDER_RESPONSE_INVALID",
      `executions[${index}] must be an object.`);
  }
  const providerExecutionId = string(String(value.id ?? ""), `executions[${index}].id`, 200);
  if (!/^[0-9]+$/.test(providerExecutionId)) {
    fail(502, "N8N_EXECUTION_HISTORY_PROVIDER_RESPONSE_INVALID",
      `executions[${index}].id must be numeric text.`);
  }
  const providerWorkflowId = string(String(value.workflowId ?? ""),
    `executions[${index}].workflowId`, 200);
  const providerStatus = string(value.status, `executions[${index}].status`, 40);
  if (!PROVIDER_STATUSES.includes(providerStatus)) {
    fail(502, "N8N_EXECUTION_HISTORY_PROVIDER_RESPONSE_INVALID",
      `executions[${index}].status is unsupported.`);
  }
  const providerMode = string(value.mode, `executions[${index}].mode`, 80);
  const executionClass = EXECUTION_CLASSES[providerMode] ?? "unknown";
  const startedAt = timestamp(value.startedAt, `executions[${index}].startedAt`);
  const stoppedAt = timestamp(value.stoppedAt, `executions[${index}].stoppedAt`, true);
  const waitUntil = timestamp(value.waitTill, `executions[${index}].waitTill`, true);
  let fingerprint = null;
  try { fingerprint = buildN8nExecutionWorkflowFingerprint(value); } catch {}
  const normalizedBinding = binding ? normalizeAttestationBinding(providerWorkflowId, binding) : null;
  const bindingDigest = normalizedBinding ? digest(normalizedBinding) : null;
  const revisionStatus = !fingerprint || !normalizedBinding ? "unavailable"
    : fingerprint.execution_workflow_material_digest === normalizedBinding.execution_workflow_material_digest
      ? "matched" : "mismatched";
  const material = {
    provider_execution_id: providerExecutionId,
    provider_workflow_id: providerWorkflowId,
    provider_status: providerStatus,
    execution_class: executionClass,
    provider_mode: providerMode,
    retry_of: nullableId(value.retryOf, `executions[${index}].retryOf`),
    retry_success_id: nullableId(value.retrySuccessId, `executions[${index}].retrySuccessId`),
    started_at: startedAt,
    stopped_at: stoppedAt,
    wait_until: waitUntil,
    revision: {
      status: revisionStatus,
      provider_workflow_version_id: fingerprint?.provider_workflow_version_id ?? null,
      execution_workflow_material_digest: fingerprint?.execution_workflow_material_digest ?? null,
      binding_digest: bindingDigest
    }
  };
  return { ...material, observation_digest: digest(material), authority: "none" };
}

export function normalizeN8nExecutionHistoryPage({ providerResponse, scope, request,
  cursorPayload, cursorSecret, binding, retrievedAt }) {
  if (!providerResponse || typeof providerResponse !== "object" || Array.isArray(providerResponse)
      || !Array.isArray(providerResponse.data)) {
    fail(502, "N8N_EXECUTION_HISTORY_PROVIDER_RESPONSE_INVALID",
      "n8n execution-history response is invalid.");
  }
  if (providerResponse.nextCursor !== undefined && providerResponse.nextCursor !== null
      && (typeof providerResponse.nextCursor !== "string" || providerResponse.nextCursor.length > 4096)) {
    fail(502, "N8N_EXECUTION_HISTORY_PROVIDER_RESPONSE_INVALID", "n8n nextCursor is invalid.");
  }
  const sourceCutoff = cursorPayload?.source_cutoff ?? timestamp(retrievedAt, "retrievedAt");
  const pageIndex = cursorPayload?.page_index ?? 0;
  const providerCursor = cursorPayload?.provider_cursor ?? null;
  const executions = [];
  let outsideWorkflow = 0;
  let afterCutoff = 0;
  for (const [index, raw] of providerResponse.data.entries()) {
    if (String(raw?.workflowId ?? "") !== request.provider_workflow_id) {
      outsideWorkflow += 1;
      continue;
    }
    const normalized = normalizeExecution(raw, index, binding);
    if (Date.parse(normalized.started_at) > Date.parse(sourceCutoff)) {
      afterCutoff += 1;
      continue;
    }
    executions.push(normalized);
  }
  if (new Set(executions.map((item) => item.provider_execution_id)).size !== executions.length) {
    fail(502, "N8N_EXECUTION_HISTORY_PROVIDER_RESPONSE_INVALID",
      "n8n execution-history page contains duplicate execution identities.");
  }
  const omissions = [];
  const count = (predicate) => executions.filter(predicate).length;
  if (outsideWorkflow) omissions.push({ code: "OUTSIDE_CONFIGURED_WORKFLOW", count: outsideWorkflow });
  if (afterCutoff) omissions.push({ code: "AFTER_FIXED_SOURCE_CUTOFF", count: afterCutoff });
  const nonProduction = count((item) => ["manual", "test"].includes(item.execution_class));
  if (nonProduction) omissions.push({ code: "NON_PRODUCTION_EXECUTIONS_PRESENT", count: nonProduction });
  const unknownModes = count((item) => item.execution_class === "unknown");
  if (unknownModes) omissions.push({ code: "UNKNOWN_EXECUTION_MODE", count: unknownModes });
  const unavailableRevision = count((item) => item.revision.status === "unavailable");
  if (unavailableRevision) omissions.push({ code: "REVISION_EVIDENCE_UNAVAILABLE", count: unavailableRevision });
  const nextProviderCursor = providerResponse.nextCursor ?? null;
  const nextCursor = nextProviderCursor === null ? null : encodeCursor({
    version: 1,
    scope_digest: scope.scope_digest,
    provider_workflow_id: request.provider_workflow_id,
    source_cutoff: sourceCutoff,
    provider_cursor: nextProviderCursor,
    page_index: pageIndex + 1
  }, cursorSecret);
  const normalizedScope = { scope_id: scope.scope_id, provider: "n8n", environment: scope.environment,
    provider_workflow_id: request.provider_workflow_id, scope_digest: scope.scope_digest };
  const normalizedPagination = { current_cursor: request.cursor, next_cursor: nextCursor,
    page_index: pageIndex, item_count: executions.length, scope_complete: nextCursor === null,
    source_cutoff: sourceCutoff };
  const health = { status: "healthy", observed_at: timestamp(retrievedAt, "retrievedAt"), issues: [] };
  const completeness = {
    basis: "credential_scoped_public_api_cursor_walk",
    embedded_signals_are_completeness_proof: false,
    provider_retention_and_deletion_visible_as_limitations: true
  };
  const pageDigest = digest({ schema_version: N8N_EXECUTION_HISTORY_SCHEMA_VERSION,
    scope: normalizedScope, executions, page: normalizedPagination, omissions, health,
    completeness, authority: "none" });
  return {
    schema_version: N8N_EXECUTION_HISTORY_SCHEMA_VERSION,
    scope: normalizedScope,
    executions,
    page: { ...normalizedPagination, page_digest: pageDigest },
    omissions,
    health,
    completeness,
    authority: "none"
  };
}

export async function listN8nExecutionHistory({ baseUrl, apiKey, scope: scopeInput,
  cursorSecret, input, attestationBindings = {}, fetchImpl = fetch,
  now = () => new Date().toISOString() }) {
  if (typeof apiKey !== "string" || apiKey.length === 0 || apiKey.length > 8192) {
    fail(503, "N8N_EXECUTION_HISTORY_NOT_CONFIGURED",
      "A provider API credential is required at the adapter edge.");
  }
  const scope = normalizeN8nInventoryScope(scopeInput);
  const request = normalizeN8nExecutionHistoryRequest(input);
  if (request.scope_id !== scope.scope_id
      || (scope.allowed_workflow_ids.length > 0
        && !scope.allowed_workflow_ids.includes(request.provider_workflow_id))) {
    fail(403, "N8N_EXECUTION_HISTORY_SCOPE_REJECTED",
      "Requested workflow is outside the configured credential scope.");
  }
  const cursorPayload = decodeN8nExecutionHistoryCursor(request.cursor, {
    scopeDigest: scope.scope_digest, providerWorkflowId: request.provider_workflow_id
  }, cursorSecret);
  const url = buildN8nExecutionHistoryUrl(baseUrl, request,
    cursorPayload?.provider_cursor ?? null);
  let response;
  try {
    response = await fetchImpl(url, { method: "GET",
      headers: { accept: "application/json", "x-n8n-api-key": apiKey } });
  } catch {
    fail(502, "N8N_EXECUTION_HISTORY_PROVIDER_UNAVAILABLE",
      "n8n execution-history request failed.");
  }
  if (!response.ok) {
    const code = [401, 403].includes(response.status)
      ? "N8N_EXECUTION_HISTORY_CREDENTIAL_REJECTED" : "N8N_EXECUTION_HISTORY_PROVIDER_UNAVAILABLE";
    fail(502, code, `n8n execution-history request returned HTTP ${response.status}.`);
  }
  let providerResponse;
  try { providerResponse = await response.json(); }
  catch {
    fail(502, "N8N_EXECUTION_HISTORY_PROVIDER_RESPONSE_INVALID",
      "n8n execution-history response was not JSON.");
  }
  return normalizeN8nExecutionHistoryPage({ providerResponse, scope, request, cursorPayload,
    cursorSecret, binding: attestationBindings[request.provider_workflow_id] ?? null,
    retrievedAt: now() });
}
