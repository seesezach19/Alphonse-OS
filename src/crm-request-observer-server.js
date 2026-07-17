import { randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import pg from "pg";

import { sha256Digest } from "./canonical-json.js";
import { createEncryptedIngressPayload } from "./customer-ingress-contracts.js";
import { createCrmRequestObservationClaims } from "./mock-crm-contracts.js";
import { createSignedObservation } from "./observation-contracts.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.CRM_GATEWAY_DATABASE_URL });
const config = {
  port: Number(process.env.CRM_GATEWAY_PORT ?? 3700), routeToken: process.env.CRM_GATEWAY_ROUTE_TOKEN,
  crmUrl: process.env.MOCK_CRM_URL, crmToken: process.env.MOCK_CRM_WRITE_TOKEN,
  tokenizationUrl: process.env.TOKENIZATION_URL, requesterToken: process.env.TOKENIZATION_REQUESTER_TOKEN,
  tokenizationGrantId: process.env.CRM_IDEMPOTENCY_TOKENIZATION_GRANT_ID,
  diagnosticUrl: process.env.CRM_REQUEST_DIAGNOSTIC_URL, schema: process.env.CRM_REQUEST_OBSERVATION_SCHEMA,
  adapter: process.env.CRM_REQUEST_ADAPTER_BINDING, principalId: process.env.CRM_REQUEST_PRINCIPAL_ID,
  grantId: process.env.CRM_REQUEST_OBSERVATION_GRANT_ID, keyId: process.env.CRM_REQUEST_OBSERVATION_KEY_ID,
  secret: process.env.CRM_REQUEST_OBSERVATION_SECRET, installationId: process.env.KERNEL_INSTALLATION_ID,
  environmentId: process.env.KERNEL_ENVIRONMENT_ID, streamId: process.env.CRM_REQUEST_STREAM_ID,
  payloadSecret: process.env.CRM_GATEWAY_PAYLOAD_SECRET
};
if (Object.entries(config).some(([key, value]) => key !== "port" && !value)) throw new Error("CRM request observer configuration is incomplete.");
function same(left, right) {
  const a = Buffer.from(String(left ?? "")); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readJson(request) {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body));
}
async function tokenize(raw) {
  const response = await fetch(`${config.tokenizationUrl}/v0/tokenize`, { method: "POST",
    headers: { authorization: `Bearer ${config.requesterToken}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: randomUUID(), grant_id: config.tokenizationGrantId,
      requester_principal_id: config.principalId, installation_id: config.installationId,
      environment_id: config.environmentId, integration_id: "integration:mock-crm",
      field_role: "destination.idempotency_key", claim_field: "idempotency_key_equality_token",
      namespace: "lead-idempotency", algorithm_version: "hmac-sha256-length-prefixed.v1",
      input_base64: Buffer.from(raw).toString("base64"), requested_at: new Date().toISOString() }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.code ?? `TOKENIZATION_HTTP_${response.status}`);
  return body.tokenization_result;
}
async function acceptAndForward(request, lead) {
  const forwardingId = String(request.headers["x-alphonse-forwarding-id"] ?? "");
  const logicalOperationId = String(request.headers["x-alphonse-logical-operation-id"] ?? "");
  const deliveryId = String(request.headers["x-alphonse-delivery-id"] ?? "");
  const idempotencyKey = String(request.headers["x-alphonse-source-delivery-key"] ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(forwardingId) || !logicalOperationId || !deliveryId || !idempotencyKey) {
    throw new Error("CRM_REQUEST_CONTEXT_INVALID");
  }
  let row = (await pool.query("SELECT * FROM crm_gateway_requests WHERE forwarding_id=$1", [forwardingId])).rows[0];
  if (!row) {
    const token = await tokenize(idempotencyKey);
    const encrypted = createEncryptedIngressPayload(lead, config.payloadSecret);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [forwardingId]);
      row = (await client.query("SELECT * FROM crm_gateway_requests WHERE forwarding_id=$1", [forwardingId])).rows[0];
      if (!row) {
        const sequence = (await client.query("SELECT next_sequence FROM crm_gateway_state WHERE singleton=true FOR UPDATE")).rows[0].next_sequence;
        row = (await client.query(
          `INSERT INTO crm_gateway_requests
            (request_id,forwarding_id,journal_sequence,logical_operation_id,delivery_id,operation,
             idempotency_key_equality_token,token_result_receipt_id,payload_digest,payload_algorithm,payload_nonce,
             payload_ciphertext,payload_authentication_tag,received_at,forwarding_state,reporting_state,observation_id)
           VALUES ($1,$2,$3,$4,$5,'create_lead',$6,$7,$8,$9,$10,$11,$12,now(),'pending','pending',$13) RETURNING *`,
          [randomUUID(), forwardingId, sequence, logicalOperationId, deliveryId, token.equality_token,
            token.result_receipt_id, encrypted.payload_digest, encrypted.algorithm, Buffer.from(encrypted.nonce, "base64"),
            Buffer.from(encrypted.ciphertext, "base64"), Buffer.from(encrypted.authentication_tag, "base64"),
            randomUUID()]
        )).rows[0];
        await client.query("UPDATE crm_gateway_state SET next_sequence=next_sequence+1 WHERE singleton=true");
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  if (row.forwarding_state === "succeeded") return { status: row.transport_status, replayed: true };
  const crm = await fetch(`${config.crmUrl}/v0/leads`, { method: "POST", headers: {
    authorization: `Bearer ${config.crmToken}`, "content-type": "application/json",
    "x-request-id": row.request_id, "x-logical-operation-id": row.logical_operation_id,
    "x-delivery-id": row.delivery_id, "idempotency-key": idempotencyKey
  }, body: JSON.stringify(lead) });
  const bytes = Buffer.from(await crm.arrayBuffer());
  if (!crm.ok) throw new Error(`MOCK_CRM_HTTP_${crm.status}`);
  await pool.query(
    `UPDATE crm_gateway_requests SET forwarding_state='succeeded',transport_status=$2,transport_response_digest=$3,
       payload_algorithm=NULL,payload_nonce=NULL,payload_ciphertext=NULL,payload_authentication_tag=NULL
     WHERE request_id=$1`, [row.request_id, crm.status, sha256Digest(bytes.toString("base64"))]);
  return { status: crm.status, replayed: false, crm: JSON.parse(bytes.toString("utf8")) };
}
async function reportPending() {
  const row = (await pool.query(
    `SELECT * FROM crm_gateway_requests WHERE forwarding_state='succeeded' AND reporting_state!='reported'
     ORDER BY journal_sequence LIMIT 1`)).rows[0];
  if (!row) return;
  const claims = createCrmRequestObservationClaims({ request_id: row.request_id,
    logical_operation_id: row.logical_operation_id, delivery_id: row.delivery_id, operation: row.operation,
    transport_status: row.transport_status, idempotency_key_equality_token: row.idempotency_key_equality_token });
  const envelope = { schema_version: "0.1.0", observation_id: row.observation_id,
    observation_type: "destination.request", schema: JSON.parse(config.schema), principal_id: config.principalId,
    grant_id: config.grantId, key_id: config.keyId, installation_id: config.installationId,
    environment_id: config.environmentId, adapter_binding: JSON.parse(config.adapter), stream_id: config.streamId,
    sequence: String(row.journal_sequence), workflow_id: "workflow:agency-lab:lead-ingestion",
    integration_id: "integration:mock-crm", occurred_at: new Date(row.received_at).toISOString(),
    observed_at: new Date(row.received_at).toISOString(), claims, limitations: [],
    redaction: { policy_id: "redaction:crm-request-claims", policy_digest: `sha256:${"8".repeat(64)}` },
    detail: null, provenance_dependencies: [row.token_result_receipt_id] };
  const signed = createSignedObservation(envelope, { keyId: config.keyId, secret: config.secret });
  const response = await fetch(config.diagnosticUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ envelope_bytes: signed.bytes, authentication: signed.authentication }) });
  const body = await response.json();
  if (![200, 201].includes(response.status)) throw new Error(body.error?.code ?? `REPORT_HTTP_${response.status}`);
  await pool.query("UPDATE crm_gateway_requests SET reporting_state='reported',observation_receipt_id=$2,reported_at=now() WHERE request_id=$1",
    [row.request_id, body.observation_receipt.receipt_id]);
}
let lastError = null;
let reporting = false;
async function guardedReport() {
  if (reporting) return;
  reporting = true;
  try { await reportPending(); lastError = null; } catch (error) { lastError = error.message; } finally { reporting = false; }
}
setInterval(guardedReport, 250).unref();
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://crm-request-observer");
    if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, { status: lastError ? "degraded" : "healthy", last_error: lastError });
    if (request.method === "GET" && url.pathname === "/internal/v0/status") {
      const rows = await pool.query("SELECT request_id,logical_operation_id,delivery_id,idempotency_key_equality_token,transport_status,forwarding_state,reporting_state,observation_receipt_id FROM crm_gateway_requests ORDER BY journal_sequence");
      return send(response, 200, { requests: rows.rows, request_count: rows.rowCount,
        reported_count: rows.rows.filter((row) => row.reporting_state === "reported").length });
    }
    if (request.method === "POST" && url.pathname === "/v0/crm/leads") {
      if (!same(request.headers.authorization, `Bearer ${config.routeToken}`)) return send(response, 403, { error: "forbidden" });
      return send(response, 202, await acceptAndForward(request, await readJson(request)));
    }
    return send(response, 404, { error: "not_found" });
  } catch (error) { return send(response, 500, { error: error.message }); }
});
server.listen(config.port, "0.0.0.0");
