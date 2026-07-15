import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";

const port = Number(process.env.PORT ?? 5680);
const token = process.env.N8N_DETAIL_ADAPTER_TOKEN;
const repairApiKey = process.env.N8N_REPAIR_API_KEY ?? "local-customer-owned-n8n-api-key-v1";
if (!token) throw new Error("N8N_DETAIL_ADAPTER_TOKEN is required.");
const baseWorkflow = {
  ...JSON.parse(await readFile(new URL("../workflows/inventory-follow-up-defective.json", import.meta.url), "utf8")),
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  versionId: "fixture-base-v1"
};
const workflows = new Map([[baseWorkflow.id, baseWorkflow]]);
let candidateSequence = 0;

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

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      return send(response, 200, { status: "healthy", api: "alphonse.n8n.runtime.detail/0.2.0" });
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
        return send(response, 200, created);
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
