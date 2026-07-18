import { createHash, randomUUID } from "node:crypto";
import http from "node:http";

const port = Number(process.env.WAREHOUSE_PORT ?? 4580);
const loads = [];

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request, maximumBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) fail(413, "WAREHOUSE_REQUEST_TOO_LARGE", "Warehouse request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "WAREHOUSE_REQUEST_INVALID", "Warehouse request must be JSON.");
  }
}

function validateLoad(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, "WAREHOUSE_LOAD_INVALID", "Warehouse load must be an object.");
  }
  const required = [
    "batch_id", "execution_id", "source_contract_version", "transform_revision",
    "normalized_rows", "currency_totals"
  ];
  for (const field of required) {
    if (!Object.hasOwn(value, field)) fail(400, "WAREHOUSE_LOAD_INVALID", `Warehouse load is missing ${field}.`);
  }
  if (!Array.isArray(value.normalized_rows) || !Array.isArray(value.currency_totals)) {
    fail(400, "WAREHOUSE_LOAD_INVALID", "Warehouse load collections are invalid.");
  }
  for (const row of value.normalized_rows) {
    if (!Number.isFinite(row.amount_major) || typeof row.currency !== "string") {
      fail(400, "WAREHOUSE_LOAD_INVALID", "Warehouse normalized row is invalid.");
    }
  }
  return structuredClone(value);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") {
      return send(response, 200, { status: "healthy" });
    }
    if (request.method === "GET" && url.pathname === "/v1/warehouse/state") {
      return send(response, 200, { loads: structuredClone(loads) });
    }
    if (request.method === "POST" && url.pathname === "/v1/warehouse/settlement-facts") {
      const payload = validateLoad(await readJson(request));
      const committedAt = new Date().toISOString();
      const receipt = {
        receipt_id: randomUUID(),
        status: "committed",
        batch_id: payload.batch_id,
        execution_id: payload.execution_id,
        row_count: payload.normalized_rows.length,
        payload_digest: digest(payload),
        committed_at: committedAt
      };
      loads.push({ receipt, payload });
      return send(response, 201, receipt);
    }
    return send(response, 404, { error: { code: "ROUTE_NOT_FOUND", message: "Route does not exist." } });
  } catch (error) {
    return send(response, error.status ?? 500, { error: {
      code: error.code ?? "INTERNAL_ERROR",
      message: error.message
    } });
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Mock warehouse listening on ${port}\n`);
});
