import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import {
  assertAttestationCandidate,
  assertExecutionBinding,
  buildAttestedRuntimeEvent,
  normalizeAttestationRequest,
  normalizeN8nExecutionObservation
} from "./runtime-attestation.js";

const port = Number(process.env.PORT ?? 5680);
const token = process.env.N8N_DETAIL_ADAPTER_TOKEN;
const repairApiKey = process.env.N8N_REPAIR_API_KEY ?? "local-customer-owned-n8n-api-key-v1";
const testControlsEnabled = process.env.N8N_ADAPTER_TEST_CONTROLS_ENABLED === "true";
const stateFile = process.env.N8N_ADAPTER_STATE_FILE;
const n8nApiUrl = process.env.N8N_API_URL?.replace(/\/$/, "");
const n8nApiKey = process.env.N8N_API_KEY;
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
).map(([providerWorkflowId, binding]) => [providerWorkflowId, {
  provider_workflow_id: providerWorkflowId,
  workflow_id: binding.workflow_id,
  revision_id: binding.revision_id
}]));
const attestationConfigured = Boolean(
  n8nApiUrl && n8nApiKey && kernelRuntimeEventUrl && runtimeAdapter.adapter_id
  && runtimeAdapter.adapter_version && runtimeSigning.key_id && runtimeSigning.secret
  && attestationBindings.size > 0
);
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

async function fetchN8nExecution(executionId) {
  const response = await fetch(`${n8nApiUrl}/api/v1/executions/${encodeURIComponent(executionId)}?includeData=false`, {
    headers: { "x-n8n-api-key": n8nApiKey, accept: "application/json" }
  });
  if (!response.ok) throw new Error(`n8n execution lookup failed with HTTP ${response.status}`);
  const observation = normalizeN8nExecutionObservation(await response.json());
  if (observation.execution_id !== String(executionId)) {
    throw new Error("n8n API returned a different execution identity");
  }
  return observation;
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

async function observeTerminalExecution(executionId, initialObservation) {
  let observation = initialObservation;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const binding = attestationBindings.get(observation.provider_workflow_id);
    assertExecutionBinding(observation, binding);
    if (["success", "error", "crashed", "canceled"].includes(observation.status)) {
      const attestation = buildAttestedRuntimeEvent({
        observation,
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
    await new Promise((resolve) => setTimeout(resolve, 250));
    observation = await fetchN8nExecution(executionId);
  }
  throw new Error("n8n execution did not reach a terminal state inside the attestation window");
}

function queueAttestation(executionId, observation) {
  if (attestationJobs.has(executionId) || attestationReceipts.has(executionId)) return false;
  const job = observeTerminalExecution(executionId, observation)
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
        api: "alphonse.n8n.runtime.detail/0.2.0",
        state_persistence: stateFile ? "configured" : "ephemeral",
        runtime_attestation: attestationConfigured ? "independent_n8n_api_observation" : "not_configured"
      });
    }
    if (request.method === "POST" && request.url === "/v0/runtime-attestations") {
      if (!attestationConfigured) {
        return send(response, 503, { error: { code: "RUNTIME_ATTESTATION_NOT_CONFIGURED" } });
      }
      const body = await readJson(request);
      const candidate = normalizeAttestationRequest(body);
      const executionId = candidate.external_execution_id;
      const observation = await fetchN8nExecution(executionId);
      const binding = attestationBindings.get(observation.provider_workflow_id);
      assertAttestationCandidate(candidate, observation, binding);
      const queued = queueAttestation(executionId, observation);
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
      workflows.clear();
      workflows.set(baseWorkflow.id, structuredClone(baseWorkflow));
      candidateSequence = 0;
      promotionSequence = 0;
      nextPromotionMode = "normal";
      await persistState();
      return send(response, 200, { reset: true, workflow_id: baseWorkflow.id });
    }
    if (request.url?.startsWith("/api/v1/workflows")) {
      if (!repairApiAuthenticated(request)) {
        return send(response, 401, { message: "Unauthorized" });
      }
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
          await new Promise((resolve) => setTimeout(resolve, 1_500));
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
        if (mode !== "normal") await new Promise((resolve) => setTimeout(resolve, 1_500));
        return send(response, 200, updated);
      }
      return send(response, 404, { message: "Not found" });
    }
    if (!authenticated(request)) return send(response, 403, { error: { code: "AUTHENTICATION_FAILED" } });
    const body = await readJson(request);
    if (request.method === "POST" && request.url === "/v0/execution-details:retrieve") {
      if (!/^n8n-[0-9]+$/.test(body.external_execution_id ?? "")) {
        return send(response, 404, { error: { code: "EXECUTION_NOT_FOUND" } });
      }
      const requested = body.requested_fields;
      if (!Array.isArray(requested) || requested.some((field) => !policy.extract_paths.includes(field))) {
        return send(response, 400, { error: { code: "DETAIL_SCOPE_REJECTED" } });
      }
      const detail = {};
      for (const field of requested) setAtPath(detail, field, getAtPath(source, field));
      return send(response, 200, {
        external_execution_id: body.external_execution_id,
        detail,
        omitted_fields: omittedFields
      });
    }
    if (request.method === "POST" && request.url === "/v0/reproductions:run") {
      const bindings = body.fixture_bindings ?? {};
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
  } catch {
    return send(response, 400, { error: { code: "INVALID_REQUEST" } });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`n8n detail adapter listening on ${port}`));
