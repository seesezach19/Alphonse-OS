import { access, readFile, writeFile } from "node:fs/promises";

const brokerUrl = process.env.DIAGNOSTIC_MODEL_BROKER_URL;
const encodedGrant = process.env.DIAGNOSTIC_SIGNED_BROKER_GRANT_BASE64;
if (!brokerUrl || !encodedGrant) throw new Error("Exact Model Broker authority is required.");

const input = JSON.parse(await readFile("/input/input.json", "utf8"));
const signedBrokerGrant = JSON.parse(Buffer.from(encodedGrant, "base64url").toString("utf8"));
if (input.worker_run_id !== signedBrokerGrant.document?.worker_run_id) {
  throw new Error("Worker input and Broker Grant do not bind the same Worker Run.");
}

const forbiddenDestinations = {
  general_dns_internet: "http://example.com",
  internet_address: "http://1.1.1.1",
  cloud_metadata: "http://169.254.169.254/latest/meta-data/",
  kernel: "http://kernel:3000/healthz",
  data_plane: "http://data-plane:3100/healthz"
};
const boundaryProbe = {};
for (const [name, destination] of Object.entries(forbiddenDestinations)) {
  try {
    await fetch(destination, { signal: AbortSignal.timeout(750) });
    boundaryProbe[name] = "reachable_forbidden";
  } catch {
    boundaryProbe[name] = "denied";
  }
}
process.stdout.write(`${JSON.stringify({ event: "worker_network_probe", boundary_probe: boundaryProbe })}\n`);

const response = await fetch(`${brokerUrl}/v0/diagnose`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `BrokerGrant ${signedBrokerGrant.document_digest}`
  },
  body: JSON.stringify({ signed_broker_grant: signedBrokerGrant, input }),
  signal: AbortSignal.timeout(30_000)
});
const result = await response.json();
if (!response.ok) throw new Error(`Model Broker rejected request: ${JSON.stringify(result)}`);
const envelope = {
  schema_version: "alphonse.diagnostic-worker-output-envelope.v0.1",
  diagnosis: result.diagnosis,
  signed_broker_receipt: result.signed_broker_receipt
};
await writeFile("/output/diagnosis.json", `${JSON.stringify(envelope)}\n`, {
  encoding: "utf8", flag: "wx", mode: 0o600
});
process.stdout.write(`${JSON.stringify({ event: "worker_output_written",
  output_path: "/output/diagnosis.json" })}\n`);
const acknowledgementDeadline = Date.now() + 60_000;
while (Date.now() < acknowledgementDeadline) {
  try {
    await access("/tmp/runner-output-collected");
    process.stdout.write(`${JSON.stringify({ event: "runner_output_collection_acknowledged" })}\n`);
    process.exit(0);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
throw new Error("Trusted runner did not acknowledge bounded output collection.");
