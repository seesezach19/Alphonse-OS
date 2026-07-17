import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import pg from "pg";

import { createCrmCommit } from "./mock-crm-contracts.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.MOCK_CRM_DATABASE_URL });
const port = Number(process.env.MOCK_CRM_PORT ?? 3701);
const writeToken = process.env.MOCK_CRM_WRITE_TOKEN;
const ledgerToken = process.env.MOCK_CRM_LEDGER_TOKEN;
if (!writeToken || !ledgerToken) throw new Error("Mock CRM tokens are required.");
function same(left, right) {
  const a = Buffer.from(String(left ?? "")); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function json(request) {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body));
}
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://mock-crm");
    if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, { status: "healthy" });
    if (request.method === "POST" && url.pathname === "/v0/leads") {
      if (!same(request.headers.authorization, `Bearer ${writeToken}`)) return send(response, 403, { error: "forbidden" });
      const body = await json(request);
      const material = { request_id: request.headers["x-request-id"],
        logical_operation_id: request.headers["x-logical-operation-id"],
        delivery_id: request.headers["x-delivery-id"], idempotency_key: request.headers["idempotency-key"],
        lead: body };
      const commit = createCrmCommit(material);
      const inserted = await pool.query(
        `INSERT INTO mock_crm_commits
          (commit_id,resource_id,request_id,logical_operation_id,delivery_id,idempotency_key,operation,lead_digest,committed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
        [commit.commit_id, commit.resource_id, commit.request_id, commit.logical_operation_id, commit.delivery_id,
          commit.idempotency_key, commit.operation, commit.lead_digest, commit.committed_at]
      );
      const row = inserted.rows[0] ?? (await pool.query(
        "SELECT * FROM mock_crm_commits WHERE idempotency_key=$1", [commit.idempotency_key])).rows[0];
      return send(response, inserted.rows[0] ? 201 : 200,
        { resource_id: row.resource_id, commit_id: row.commit_id, replayed: !inserted.rows[0] });
    }
    if (request.method === "GET" && url.pathname === "/internal/v0/commit-ledger") {
      if (!same(request.headers.authorization, `Bearer ${ledgerToken}`)) return send(response, 403, { error: "forbidden" });
      const after = Number(url.searchParams.get("after") ?? 0);
      const rows = await pool.query(
        `SELECT ledger_sequence,commit_id,resource_id,request_id,logical_operation_id,delivery_id,operation,lead_digest,committed_at
         FROM mock_crm_commits WHERE ledger_sequence>$1 ORDER BY ledger_sequence`, [after]);
      return send(response, 200, { commits: rows.rows });
    }
    return send(response, 404, { error: "not_found" });
  } catch (error) { return send(response, 500, { error: error.message }); }
});
server.listen(port, "0.0.0.0");
