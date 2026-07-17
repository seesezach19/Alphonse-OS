import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath] = process.argv.slice(2);
const endpoint = process.env.CANONICAL_PROOF_INGRESS_URL;
const token = process.env.CANONICAL_PROOF_STIMULUS_TOKEN;
assert.ok(inputPath && outputPath && endpoint && token, "Stimulus configuration is incomplete.");
for (const forbidden of ["INGRESS_OBSERVATION_SECRET", "INGRESS_OBSERVATION_GRANT_ID",
  "TOKENIZATION_REQUESTER_TOKEN", "INGRESS_OPERATOR_TOKEN"]) {
  assert.equal(process.env[forbidden], undefined, `Stimulus must not receive ${forbidden}.`);
}

const deliveries = JSON.parse(await readFile(inputPath, "utf8"));
assert.equal(deliveries.length, 2, "Stimulus is permitted exactly two deliveries.");
const results = [];
for (const delivery of deliveries) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(delivery)
  });
  results.push({ status: response.status, body: await response.json() });
}
await writeFile(outputPath, `${JSON.stringify({
  schema_version: "0.1.0", role: "scenario_stimulus", request_count: results.length,
  authored_observations: 0, reporting_credentials_received: false, results
}, null, 2)}\n`);
