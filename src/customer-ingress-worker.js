import http from "node:http";

import { sha256Digest } from "./canonical-json.js";
import { createCustomerIngressDatabase } from "./customer-ingress-database.js";
import { decryptIngressPayload } from "./customer-ingress-contracts.js";
import { createCustomerIngressJournalService } from "./customer-ingress-journal-service.js";
import { createSignedObservation } from "./observation-contracts.js";

const mode = process.env.INGRESS_WORKER_MODE;
if (!["forwarder", "reporter"].includes(mode)) throw new Error("INGRESS_WORKER_MODE must be forwarder or reporter.");

const database = createCustomerIngressDatabase(process.env.INGRESS_DATABASE_URL);
const journal = createCustomerIngressJournalService(database, {
  sourceBindingId: process.env.INGRESS_SOURCE_BINDING_ID,
  payloadSecret: process.env.INGRESS_PAYLOAD_SECRET,
  mappingSecret: process.env.INGRESS_MAPPING_SECRET
});
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function forward(row) {
  const delivery = row.payload_ciphertext ? {
    algorithm: row.payload_algorithm,
    nonce: Buffer.from(row.payload_nonce).toString("base64"),
    ciphertext: Buffer.from(row.payload_ciphertext).toString("base64"),
    authentication_tag: Buffer.from(row.payload_authentication_tag).toString("base64"),
    payload_digest: row.payload_digest
  } : null;
  if (!delivery) throw new Error("FORWARD_PAYLOAD_UNAVAILABLE");
  const payload = decryptIngressPayload(delivery, process.env.INGRESS_PAYLOAD_SECRET);
  const response = await fetch(process.env.INGRESS_FORWARD_URL, {
    method: "POST", headers: {
      "content-type": "application/json",
      "x-alphonse-logical-operation-id": row.logical_operation_id,
      "x-alphonse-delivery-id": `delivery_${row.delivery_id}`,
      "x-alphonse-forwarding-id": row.forwarding_id
    }, body: JSON.stringify(payload)
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`FORWARD_HTTP_${response.status}`);
  await journal.completeForward(row, { status: response.status,
    responseDigest: sha256Digest(bytes.toString("base64")) });
}

async function report(row) {
  const schema = JSON.parse(process.env.INGRESS_OBSERVATION_SCHEMA);
  const adapter = JSON.parse(process.env.INGRESS_OBSERVATION_ADAPTER_BINDING);
  const envelope = {
    schema_version: "0.1.0", observation_id: row.observation_id,
    observation_type: "source.delivery", schema,
    principal_id: process.env.INGRESS_OBSERVER_PRINCIPAL_ID,
    grant_id: process.env.INGRESS_OBSERVATION_GRANT_ID,
    key_id: process.env.INGRESS_OBSERVATION_KEY_ID,
    installation_id: process.env.KERNEL_INSTALLATION_ID,
    environment_id: process.env.KERNEL_ENVIRONMENT_ID,
    adapter_binding: adapter, stream_id: process.env.INGRESS_OBSERVATION_STREAM_ID,
    sequence: String(row.journal_sequence),
    workflow_id: process.env.INGRESS_WORKFLOW_ID,
    integration_id: process.env.INGRESS_INTEGRATION_ID,
    occurred_at: new Date(row.occurred_at).toISOString(), observed_at: new Date(row.received_at).toISOString(),
    claims: row.redacted_claims, limitations: [],
    redaction: { policy_id: "redaction:opaque-ingress-identities",
      policy_digest: `sha256:${"6".repeat(64)}` },
    detail: null,
    provenance_dependencies: [row.source_token_result_receipt_id, row.delivery_token_result_receipt_id]
  };
  const signed = createSignedObservation(envelope, {
    keyId: process.env.INGRESS_OBSERVATION_KEY_ID,
    secret: process.env.INGRESS_OBSERVATION_SECRET
  });
  const response = await fetch(process.env.INGRESS_DIAGNOSTIC_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ envelope_bytes: signed.bytes, authentication: signed.authentication })
  });
  const body = await response.json();
  if (![200, 201].includes(response.status)) throw new Error(body.error?.code ?? `REPORT_HTTP_${response.status}`);
  if (process.env.INGRESS_TEST_CONTROLS_ENABLED === "true"
      && process.env.INGRESS_REPORTER_CRASH_AFTER_ACCEPT_ONCE === "true"
      && await journal.consumeTestFault("reporter-after-accept")) {
    process.exit(86);
  }
  const receipt = body.observation_receipt;
  await journal.completeReport(row, { status: response.status,
    receiptId: receipt.receipt_id, receiptDigest: receipt.receipt_digest, replayed: response.status === 200 });
}

async function run() {
  if (mode === "forwarder") await journal.recoverForwardingLeases();
  else await journal.recoverReportingLeases();
  for (;;) {
    const row = mode === "forwarder" ? await journal.claimForwarding() : await journal.claimReporting();
    if (!row) { await sleep(100); continue; }
    try {
      if (mode === "forwarder") await forward(row); else await report(row);
    } catch (error) {
      const code = String(error.message ?? "WORKER_FAILED").slice(0, 120);
      process.stderr.write(`${mode} attempt failed: ${code}\n`);
      if (mode === "forwarder") await journal.failForward(row, code);
      else await journal.failReport(row, code);
    }
  }
}

const healthPort = Number(process.env.INGRESS_WORKER_HEALTH_PORT ?? (mode === "forwarder" ? 3601 : 3602));
const health = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "healthy", service_id: `customer-ingress-${mode}` }));
});
health.listen(healthPort, "0.0.0.0");
run().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exit(1); });
