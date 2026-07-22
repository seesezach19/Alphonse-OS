import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import {
  assertExecutionBinding,
  buildAttestedRuntimeEvent,
  normalizeAttestationBinding,
  normalizeAttestationRequest,
  normalizeN8nExecutionObservation,
  unwrapN8nApiEntity
} from "./runtime-attestation.js";
import {
  listN8nWorkflowInventory,
  N8nInventoryError,
  normalizeN8nInventoryScope
} from "./workflow-inventory.js";
import {
  listN8nExecutionHistory,
  N8nExecutionHistoryError
} from "./execution-history.js";

const port = Number(process.env.PORT ?? 5680);
const token = process.env.N8N_DETAIL_ADAPTER_TOKEN;
const repairApiKey = process.env.N8N_REPAIR_API_KEY ?? "local-customer-owned-n8n-api-key-v1";
const testControlsEnabled = process.env.N8N_ADAPTER_TEST_CONTROLS_ENABLED === "true";
const stateFile = process.env.N8N_ADAPTER_STATE_FILE;
const n8nApiUrl = process.env.N8N_API_URL?.replace(/\/$/, "");
const n8nApiKey = process.env.N8N_API_KEY;
const inventoryCursorSecret = process.env.N8N_INVENTORY_CURSOR_SECRET;
const executionHistoryCursorSecret = process.env.N8N_EXECUTION_HISTORY_CURSOR_SECRET;
const maintenanceLiveEnabled = process.env.N8N_MAINTENANCE_LIVE === "true";
const maintenanceFaultDelayMs = Number(process.env.N8N_MAINTENANCE_FAULT_DELAY_MS ?? 1_500);
if (!Number.isSafeInteger(maintenanceFaultDelayMs) || maintenanceFaultDelayMs < 1) {
  throw new Error("N8N_MAINTENANCE_FAULT_DELAY_MS must be a positive integer.");
}
const inventoryScopeInput = process.env.N8N_INVENTORY_SCOPE
  ? JSON.parse(process.env.N8N_INVENTORY_SCOPE) : null;
const inventoryScope = inventoryScopeInput ? normalizeN8nInventoryScope(inventoryScopeInput) : null;
const kernelRuntimeEventUrl = process.env.ALPHONSE_RUNTIME_EVENT_URL;
const runtimeAdapter = {
  adapter_id: process.env.ALPHONSE_RUNTIME_ADAPTER_ID,
  adapter_version: process.env.ALPHONSE_RUNTIME_ADAPTER_VERSION
};
const runtimeSigning = {
  key_id: process.env.ALPHONSE_RUNTIME_ADAPTER_KEY_ID,
  secret: process.env.ALPHONSE_RUNTIME_ADAPTER_SECRET
};
const attestationBindings = new Map(Object.entries(
  JSON.parse(process.env.N8N_ATTESTATION_BINDINGS ?? "{}")
).map(([providerWorkflowId, binding]) => [
  providerWorkflowId,
  normalizeAttestationBinding(providerWorkflowId, binding)
]));
const attestationConfigured = Boolean(
  n8nApiUrl && n8nApiKey && kernelRuntimeEventUrl && runtimeAdapter.adapter_id
  && runtimeAdapter.adapter_version && runtimeSigning.key_id && runtimeSigning.secret
  && attestationBindings.size > 0
);
const inventoryConfigured = Boolean(
  n8nApiUrl && n8nApiKey && inventoryCursorSecret && inventoryScope
);
const executionHistoryConfigured = Boolean(
  n8nApiUrl && n8nApiKey && executionHistoryCursorSecret && inventoryScope
);
const repairProxyConfigured = Boolean(maintenanceLiveEnabled && n8nApiUrl && n8nApiKey);
const attestationJobs = new Map();
const attestationReceipts = new Map();
if (!token) throw new Error("N8N_DETAIL_ADAPTER_TOKEN is required.");
const baseWorkflow = {
  ...JSON.parse(await readFile(new URL("../workflows/inventory-follow-up-defective.json", import.meta.url), "utf8")),
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  versionId: "fixture-base-v1"
};
const canonicalLeadWorkflow = JSON.parse(await readFile(
  new URL("../workflows/canonical-lead-ingress.json", import.meta.url), "utf8"
));
async function loadState() {
  if (!stateFile) return null;
  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8"));
    if (!Array.isArray(parsed.workflows) || !Number.isInteger(parsed.candidate_sequence) ||
        !Number.isInteger(parsed.promotion_sequence)) throw new Error("invalid state shape");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to load n8n adapter state: ${error.message}`);
  }
}

const persisted = await loadState();
const workflows = new Map((persisted?.workflows ?? [baseWorkflow]).map((workflow) => [workflow.id, workflow]));
let candidateSequence = persisted?.candidate_sequence ?? 0;
let promotionSequence = persisted?.promotion_sequence ?? 0;
let nextPromotionMode = "normal";
let persistenceQueue = Promise.resolve();

async function persistState() {
  if (!stateFile) return;
  persistenceQueue = persistenceQueue.then(async () => {
    await mkdir(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({
      schema_version: "0.2.0",
      candidate_sequence: candidateSequence,
      promotion_sequence: promotionSequence,
      workflows: [...workflows.values()]
    }, null, 2)}\n`, "utf8");
    await rename(temporary, stateFile);
  });
  await persistenceQueue;
}

const policy = Object.freeze({
  policy_id: "alphonse.runtime.n8n.detail.v1",
  extract_paths: ["input.order", "input.customer_email", "fixtures", "output"],
  redact_paths: ["input.customer_email"],
  replacement: "[REDACTED]"
});
const omittedFields = Object.freeze(["credentials", "runtime.logs", "input.internal_notes"]);
const source = Object.freeze({
  input: {
    order: { order_id: "ORDER-FIXTURE-42", sku: "SKU-MISSING", quantity: 1 },
    customer_email: "private-customer@example.test",
    internal_notes: "not required for reproduction"
  },
  fixtures: {
    erp: [{ sku: "SKU-EXISTS", quantity: 12 }],
    storefront: { sku: "SKU-MISSING", quantity: 4 },
    model: { provider: "fixture", model: "deterministic-follow-up", version: "1" },
    review: { channel: "local_review", sent: false }
  },
  output: {
    fulfillment_risk: "delay_likely",
    draft: { kind: "customer_delay_follow_up", subject: "Possible delay for ORDER-FIXTURE-42" },
    delivery: { channel: "local_review", sent: false },
    defect_path: "missing_sku -> zero_inventory -> delay_draft"
  },
  credentials: { provider_token: "not-exposed" },
  runtime: { logs: "not-exposed" }
});

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authenticated(request) {
  const supplied = request.headers.authorization?.startsWith("Bearer ")
    ? Buffer.from(request.headers.authorization.slice(7), "utf8") : Buffer.alloc(0);
  const expected = Buffer.from(token, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function repairApiAuthenticated(request) {
  const supplied = Buffer.from(String(request.headers["x-n8n-api-key"] ?? ""), "utf8");
  const expected = Buffer.from(repairApiKey, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function getAtPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function setAtPath(target, path, value) {
  const parts = path.split(".");
  let current = target;
  for (const key of parts.slice(0, -1)) current = current[key] ??= {};
  current[parts.at(-1)] = structuredClone(value);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

async function n8nApi(pathname, init = {}) {
  const response = await fetch(`${n8nApiUrl}${pathname}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-n8n-api-key": n8nApiKey,
      ...(init.headers ?? {})
    }
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

function executionInput(execution) {
  const runData = execution?.data?.resultData?.runData ?? execution?.resultData?.runData ?? {};
  for (const runs of Object.values(runData)) {
    for (const run of Array.isArray(runs) ? runs : []) {
      const items = run?.data?.main?.flat(3) ?? [];
      for (const item of items) {
        const headers = item?.json?.headers;
        if (headers?.["x-alphonse-logical-operation-id"]
            && headers?.["x-alphonse-delivery-id"]) return item.json;
      }
    }
  }
  return null;
}

function destinationSucceeded(execution) {
  return Array.isArray(execution?.data?.resultData?.runData?.["Create CRM Lead"])
    && execution.data.resultData.runData["Create CRM Lead"].length > 0;
}

async function liveLeadDetail(externalExecutionId) {
  const providerExecutionId = String(externalExecutionId).replace(/^n8n-/, "");
  if (!/^[0-9]+$/.test(providerExecutionId)) throw new Error("invalid execution identity");
  const selected = await n8nApi(
    `/api/v1/executions/${encodeURIComponent(providerExecutionId)}?includeData=true`
  );
  if (!selected.response.ok) throw new Error("selected execution unavailable");
  const selectedExecution = unwrapN8nApiEntity(selected.body);
  const logicalOperationId = executionInput(selectedExecution)?.headers
    ?.["x-alphonse-logical-operation-id"];
  if (typeof logicalOperationId !== "string" || !logicalOperationId) {
    throw new Error("logical operation identity unavailable");
  }
  const listed = await n8nApi(
    `/api/v1/executions?workflowId=${encodeURIComponent(canonicalLeadWorkflow.id)}&status=success&limit=100`
  );
  if (!listed.response.ok) throw new Error("execution history unavailable");
  const summaries = Array.isArray(listed.body?.data) ? listed.body.data : [];
  const details = await Promise.all(summaries.map(async (summary) => {
    const result = await n8nApi(`/api/v1/executions/${encodeURIComponent(summary.id)}?includeData=true`);
    return result.response.ok ? unwrapN8nApiEntity(result.body) : null;
  }));
  const deliveries = details.filter(Boolean).map((execution) => {
    const input = executionInput(execution);
    return {
      provider_execution_id: String(execution.id),
      delivery_id: input?.headers?.["x-alphonse-delivery-id"] ?? null,
      logical_operation_id: input?.headers?.["x-alphonse-logical-operation-id"] ?? null,
      destination_effect_node_succeeded: destinationSucceeded(execution)
    };
  }).filter((entry) => entry.logical_operation_id === logicalOperationId
    && typeof entry.delivery_id === "string" && entry.destination_effect_node_succeeded);
  const uniqueDeliveries = [...new Map(deliveries.map((entry) => [entry.delivery_id, entry])).values()]
    .sort((left, right) => left.delivery_id.localeCompare(right.delivery_id));
  if (uniqueDeliveries.length !== 2) {
    throw new Error("exact duplicate-delivery reproduction evidence unavailable");
  }
  return {
    input: { logical_operation_id: logicalOperationId, provider_execution_id: providerExecutionId },
    fixtures: { deliveries: uniqueDeliveries, logical_operations: [logicalOperationId] },
    output: {
      actual_behavior: "two_deliveries -> two_committed_effects",
      committed_effect_count: 2,
      duplicate_committed_effect: true
    }
  };
}

function executableMaterial(workflow) {
  return {
    nodes: workflow?.nodes ?? [],
    connections: workflow?.connections ?? {},
    settings: workflow?.settings ?? {}
  };
}

async function proxyWorkflowRequest(request, response) {
  const route = request.url;
  let body;
  if (["POST", "PUT"].includes(request.method)) body = await readJson(request);
  let mode = "normal";
  let current = null;
  if (request.method === "PUT") {
    current = await n8nApi(route);
    if (!current.response.ok) return send(response, current.response.status, current.body);
    mode = nextPromotionMode;
    nextPromotionMode = "normal";
    if (mode === "no_apply_timeout") {
      await new Promise((resolve) => setTimeout(resolve, maintenanceFaultDelayMs));
      return send(response, 200, { result: "not_applied" });
    }
    if (mode === "mismatch_then_timeout") {
      body = { ...body, settings: { ...(body.settings ?? {}), injectedTargetMismatch: true } };
    }
  }
  const upstream = await n8nApi(route, {
    method: request.method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let result = upstream;
  if (request.method === "PUT" && upstream.response.ok && current.body?.active === true) {
    result = await n8nApi(`${route}/activate`, {
      method: "POST",
      body: JSON.stringify({ versionId: upstream.body?.versionId })
    });
  }
  if (request.method === "PUT" && mode !== "normal") {
    await new Promise((resolve) => setTimeout(resolve, maintenanceFaultDelayMs));
  }
  return send(response, result.response.status, result.body ?? { message: "Empty provider response" });
}

async function fetchN8nExecution(executionId) {
  const response = await fetch(`${n8nApiUrl}/api/v1/executions/${encodeURIComponent(executionId)}?includeData=true`, {
    headers: { "x-n8n-api-key": n8nApiKey, accept: "application/json" }
  });
  if (!response.ok) throw new Error(`n8n execution lookup failed with HTTP ${response.status}`);
  const entity = unwrapN8nApiEntity(await response.json());
  if (!/^[0-9]+$/.test(String(entity.id ?? ""))) {
    throw new Error(`n8n execution response has invalid identity ${JSON.stringify(entity.id)}; keys=${Object.keys(entity).sort().join(",")}`);
  }
  if (String(entity.id) !== String(executionId)) {
    throw new Error("n8n API returned a different execution identity");
  }
  return entity;
}

async function submitAttestedEvent(attestation) {
  const response = await fetch(kernelRuntimeEventUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alphonse-runtime-key-id": attestation.authentication.key_id,
      "x-alphonse-runtime-signed-at": attestation.authentication.signed_at,
      "x-alphonse-runtime-signature": attestation.authentication.signature
    },
    body: JSON.stringify(attestation.envelope)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Kernel runtime event intake failed with HTTP ${response.status}`);
  return body;
}

async function observeTerminalExecution(executionId) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const rawObservation = await fetchN8nExecution(executionId);
      const observedIdentity = normalizeN8nExecutionObservation(rawObservation);
      const binding = attestationBindings.get(observedIdentity.provider_workflow_id);
      const observation = assertExecutionBinding(rawObservation, binding);
      if (["success", "error", "crashed", "canceled"].includes(observation.status)) {
        const attestation = buildAttestedRuntimeEvent({
          observation: rawObservation,
          binding,
          adapter: runtimeAdapter,
          signing: runtimeSigning,
          signedAt: new Date().toISOString()
        });
        const receipt = await submitAttestedEvent(attestation);
        attestationReceipts.set(executionId, {
          envelope: attestation.envelope,
          attestation_basis: attestation.attestation_basis,
          kernel_receipt: receipt
        });
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`n8n execution could not be independently attested: ${lastError?.message ?? "timeout"}`);
}

function queueAttestation(executionId) {
  if (attestationJobs.has(executionId) || attestationReceipts.has(executionId)) return false;
  const job = observeTerminalExecution(executionId)
    .catch((error) => process.stderr.write(`n8n attestation ${executionId} failed: ${error.message}\n`))
    .finally(() => attestationJobs.delete(executionId));
  attestationJobs.set(executionId, job);
  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      return send(response, 200, {
        status: "healthy",
        api: "alphonse.n8n.runtime.detail/0.4.0",
        state_persistence: stateFile ? "configured" : "ephemeral",
        runtime_attestation: attestationConfigured ? "independent_n8n_api_observation" : "not_configured",
        workflow_inventory: inventoryConfigured ? "credential_scoped_n8n_api" : "not_configured",
        execution_history: executionHistoryConfigured ? "cursor_reconciled_n8n_api" : "not_configured",
        repair_delivery: repairProxyConfigured ? "credential_scoped_n8n_api_proxy" : "fixture_only",
        provider_credential_location: n8nApiKey ? "adapter_edge_only" : "not_configured"
      });
    }
    if (request.method === "POST" && request.url === "/v0/runtime-attestations") {
      if (!attestationConfigured) {
        return send(response, 503, { error: { code: "RUNTIME_ATTESTATION_NOT_CONFIGURED" } });
      }
      const body = await readJson(request);
      const candidate = normalizeAttestationRequest(body);
      const executionId = candidate.external_execution_id;
      const queued = queueAttestation(executionId);
      return send(response, 202, {
        external_execution_id: executionId,
        queued,
        claim_source: "independent_n8n_api_observation"
      });
    }
    if (testControlsEnabled && request.method === "POST" && request.url === "/test/v0/promotion-mode") {
      if (!authenticated(request)) return send(response, 403, { error: { code: "AUTHENTICATION_FAILED" } });
      const body = await readJson(request);
      if (!["normal", "apply_then_timeout", "no_apply_timeout", "mismatch_then_timeout"].includes(body.mode)) {
        return send(response, 400, { error: { code: "INVALID_PROMOTION_MODE" } });
      }
      nextPromotionMode = body.mode;
      return send(response, 200, { next_promotion_mode: nextPromotionMode });
    }
    if (testControlsEnabled && request.method === "POST" && request.url === "/test/v0/reset-workflow") {
      if (!authenticated(request)) return send(response, 403, { error: { code: "AUTHENTICATION_FAILED" } });
      workflows.set(baseWorkflow.id, structuredClone(baseWorkflow));
      nextPromotionMode = "normal";
      await persistState();
      return send(response, 200, { reset: true, workflow_id: baseWorkflow.id });
    }
    if (request.url?.startsWith("/api/v1/workflows")) {
      if (!repairApiAuthenticated(request)) {
        return send(response, 401, { message: "Unauthorized" });
      }
      if (repairProxyConfigured) return proxyWorkflowRequest(request, response);
      if (request.method === "GET" && /^\/api\/v1\/workflows\/[^/?]+$/.test(request.url)) {
        const workflowId = decodeURIComponent(request.url.split("/").at(-1));
        const workflow = workflows.get(workflowId);
        return workflow ? send(response, 200, workflow) : send(response, 404, { message: "Not found" });
      }
      if (request.method === "POST" && request.url === "/api/v1/workflows") {
        const input = await readJson(request);
        const fields = Object.keys(input).sort();
        if (JSON.stringify(fields) !== JSON.stringify(["connections", "name", "nodes", "settings"]) ||
            !Array.isArray(input.nodes) || !input.connections || input.active !== undefined) {
          return send(response, 400, { message: "Invalid workflow candidate" });
        }
        const id = `AlphonseCandidate${++candidateSequence}`;
        const created = {
          ...input,
          id,
          active: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versionId: `fixture-candidate-v${candidateSequence}`
        };
        workflows.set(id, created);
        await persistState();
        return send(response, 200, created);
      }
      if (request.method === "PUT" && /^\/api\/v1\/workflows\/[^/?]+$/.test(request.url)) {
        const workflowId = decodeURIComponent(request.url.split("/").at(-1));
        const current = workflows.get(workflowId);
        if (!current) return send(response, 404, { message: "Not found" });
        const input = await readJson(request);
        const fields = Object.keys(input).sort();
        if (JSON.stringify(fields) !== JSON.stringify(["connections", "name", "nodes", "settings"]) ||
            !Array.isArray(input.nodes) || !input.connections || input.active !== undefined) {
          return send(response, 400, { message: "Invalid workflow update" });
        }
        const mode = nextPromotionMode;
        nextPromotionMode = "normal";
        if (mode === "no_apply_timeout") {
          await new Promise((resolve) => setTimeout(resolve, maintenanceFaultDelayMs));
          return send(response, 200, current);
        }
        const updated = {
          ...current,
          ...input,
          id: current.id,
          active: current.active,
          updatedAt: new Date().toISOString(),
          versionId: `fixture-promotion-v${++promotionSequence}`
        };
        if (mode === "mismatch_then_timeout") {
          updated.settings = { ...updated.settings, injectedTargetMismatch: true };
        }
        workflows.set(workflowId, updated);
        await persistState();
        if (mode !== "normal") {
          await new Promise((resolve) => setTimeout(resolve, maintenanceFaultDelayMs));
        }
        return send(response, 200, updated);
      }
      return send(response, 404, { message: "Not found" });
    }
    if (!authenticated(request)) return send(response, 403, { error: { code: "AUTHENTICATION_FAILED" } });
    const body = await readJson(request);
    if (request.method === "POST" && request.url === "/v0/workflow-inventory:list") {
      if (!inventoryConfigured) {
        return send(response, 503, { error: { code: "N8N_INVENTORY_NOT_CONFIGURED" } });
      }
      const inventory = await listN8nWorkflowInventory({
        baseUrl: n8nApiUrl,
        apiKey: n8nApiKey,
        scope: inventoryScopeInput,
        cursorSecret: inventoryCursorSecret,
        input: body
      });
      return send(response, 200, inventory);
    }
    if (request.method === "POST" && request.url === "/v0/execution-history:list") {
      if (!executionHistoryConfigured) {
        return send(response, 503, { error: { code: "N8N_EXECUTION_HISTORY_NOT_CONFIGURED" } });
      }
      const history = await listN8nExecutionHistory({
        baseUrl: n8nApiUrl,
        apiKey: n8nApiKey,
        scope: inventoryScopeInput,
        cursorSecret: executionHistoryCursorSecret,
        input: body,
        attestationBindings: Object.fromEntries(attestationBindings)
      });
      return send(response, 200, history);
    }
    if (request.method === "POST" && request.url === "/v0/execution-details:retrieve") {
      if (!/^n8n-[0-9]+$/.test(body.external_execution_id ?? "")) {
        return send(response, 404, { error: { code: "EXECUTION_NOT_FOUND" } });
      }
      const requested = body.requested_fields;
      if (!Array.isArray(requested) || requested.some((field) => !policy.extract_paths.includes(field))) {
        return send(response, 400, { error: { code: "DETAIL_SCOPE_REJECTED" } });
      }
      const detailSource = maintenanceLiveEnabled
        ? await liveLeadDetail(body.external_execution_id) : source;
      const detail = {};
      for (const field of requested) setAtPath(detail, field, getAtPath(detailSource, field));
      return send(response, 200, {
        external_execution_id: body.external_execution_id,
        detail,
        omitted_fields: omittedFields
      });
    }
    if (request.method === "POST" && request.url === "/v0/reproductions:run") {
      const bindings = body.fixture_bindings ?? {};
      const liveSupported = maintenanceLiveEnabled
        && bindings.erp === "canonical:delivery-evidence-v1"
        && bindings.storefront === "canonical:logical-operation-v1"
        && bindings.model === "model:deterministic-identity-analysis-v1"
        && bindings.review === "review:local-only-v1";
      if (liveSupported) {
        const workflow = body.revision_material?.workflow_content?.primary_workflow;
        const exactWorkflow = digest(executableMaterial(workflow))
          === digest(executableMaterial(canonicalLeadWorkflow));
        const fixtures = body.fixtures ?? {};
        const exactEvidence = Array.isArray(fixtures.deliveries) && fixtures.deliveries.length === 2
          && Array.isArray(fixtures.logical_operations) && fixtures.logical_operations.length === 1
          && fixtures.deliveries.every((entry) =>
            entry.logical_operation_id === fixtures.logical_operations[0]
            && entry.destination_effect_node_succeeded === true);
        if (digest(body.revision_material) !== body.revision?.material_digest
            || !exactWorkflow || !exactEvidence) {
          return send(response, 200, { status: "incomplete", actual_behavior: null,
            output_digest: null });
        }
        const output = { logical_operation_id: fixtures.logical_operations[0],
          delivery_count: 2, committed_effect_count: 2, duplicate_committed_effect: true };
        return send(response, 200, {
          status: "completed",
          actual_behavior: "two_deliveries -> two_committed_effects",
          output_digest: digest(output)
        });
      }
      const supported = ["erp:missing-sku-v1", "erp:matching-sku-v1"].includes(bindings.erp)
        && bindings.storefront === "storefront:in-stock-v1"
        && bindings.model === "model:deterministic-follow-up-v1"
        && bindings.review === "review:local-only-v1";
      const workflow = body.revision_material?.workflow_content?.primary_workflow;
      const defectNode = workflow?.nodes?.find((node) => node.name === "Defective Missing SKU Mapping");
      if (!supported || digest(body.revision_material) !== body.revision?.material_digest
          || !defectNode?.parameters?.jsCode?.includes("erpRecord?.quantity ?? 0")) {
        return send(response, 200, { status: "incomplete", actual_behavior: null, output_digest: null });
      }
      const erpFixture = bindings.erp === "erp:matching-sku-v1"
        ? [{ sku: "SKU-MISSING", quantity: 12 }] : body.fixtures.erp;
      const erpRecord = erpFixture.find((record) => record.sku === source.input.order.sku);
      const erpQuantity = erpRecord?.quantity ?? 0;
      const output = {
        erp_quantity: erpQuantity,
        fulfillment_risk: erpQuantity < source.input.order.quantity ? "delay_likely" : "ready",
        delivery: { channel: "local_review", sent: false },
        defect_path: erpRecord ? "matched_sku" : "missing_sku -> zero_inventory -> delay_draft"
      };
      return send(response, 200, {
        status: "completed",
        actual_behavior: output.defect_path,
        output_digest: digest(output)
      });
    }
    return send(response, 404, { error: { code: "NOT_FOUND" } });
  } catch (error) {
    if (error instanceof N8nInventoryError || error instanceof N8nExecutionHistoryError) {
      return send(response, error.status, { error: { code: error.code } });
    }
    return send(response, 400, { error: { code: "INVALID_REQUEST" } });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`n8n detail adapter listening on ${port}`));
