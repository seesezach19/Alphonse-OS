import assert from "node:assert/strict";
import test from "node:test";

import { createLegacyRuntimeCompatibility } from "../../src/legacy-runtime-compatibility.js";

const config = {
  principalId: "observer:legacy-runtime-translator",
  grantId: "00000000-0000-4000-8000-000000000601",
  keyId: "legacy-runtime-translator-key-v1",
  secret: "legacy-runtime-translator-secret-with-sufficient-length-v1",
  installationId: "00000000-0000-4000-8000-00000000a001",
  environmentId: "00000000-0000-4000-8000-000000000001",
  streamId: "stream:legacy-runtime-compatibility",
  schema: { schema_id: "observation:runtime.execution-legacy-compatibility", schema_version: "0.1.0",
    schema_digest: `sha256:${"1".repeat(64)}` },
  adapterBinding: { adapter_binding_id: "adapter:legacy-runtime-translator", version: "0.1.0",
    digest: `sha256:${"2".repeat(64)}` }
};
const verified = {
  envelope: {
    adapter: { adapter_id: "n8n.runtime", adapter_version: "0.2.0" },
    workflow_id: "workflow:lead", revision_id: "00000000-0000-4000-8000-000000000701",
    external_execution_id: "execution-9", event_id: "legacy-event-9", event_sequence: "9",
    lifecycle_claim: "succeeded", correlation_id: "op_opaque", idempotency_key: "runtime-event-9",
    occurred_at: "2026-07-16T18:00:00.000Z", payload: { digest: null, reference: { uri: "artifact:9" } }
  },
  envelope_digest: `sha256:${"3".repeat(64)}`,
  authentication: { key_id: "legacy-key-v1", signed_at: "2026-07-16T18:00:01.000Z",
    signature: `hmac-sha256:${"4".repeat(64)}` }
};

test("legacy translation preserves signed claims and exposes unavailable attestation fields", () => {
  const compatibility = createLegacyRuntimeCompatibility(config, async () => {});
  const translated = compatibility.translate(verified);
  assert.equal(translated.envelope.claims.external_execution_id, "execution-9");
  assert.equal(translated.envelope.claims.legacy_envelope_digest, verified.envelope_digest);
  assert.equal(translated.envelope.claims.payload_reference_present, true);
  assert.deepEqual(JSON.parse(translated.envelope.claims.legacy_envelope_bytes), verified.envelope);
  assert.deepEqual(JSON.parse(translated.envelope.claims.legacy_authentication_bytes), verified.authentication);
  assert.equal("payload_digest" in translated.envelope.claims, false);
  assert.equal("provider_workflow_version_id" in translated.envelope.claims, false);
  assert.equal("normalized_workflow_digest" in translated.envelope.claims, false);
  assert.equal(translated.envelope.sequence, "10");
  assert.ok(translated.envelope.limitations.includes("provider_workflow_version_unavailable"));
  assert.equal(JSON.parse(translated.signed.bytes).observation_id,
    translated.envelope.observation_id);
});

test("legacy compatibility returns the exact canonical receipt linkage", async () => {
  let received;
  const compatibility = createLegacyRuntimeCompatibility(config, async (input) => {
    received = input;
    return { replayed: false, result: { observation_receipt: {
      receipt_id: "00000000-0000-4000-8000-000000000801", receipt_digest: `sha256:${"5".repeat(64)}`
    } } };
  });
  const result = await compatibility.receive(verified);
  assert.ok(received.envelope_bytes);
  assert.equal(result.canonical_receipt.receipt_id, "00000000-0000-4000-8000-000000000801");
  assert.equal(result.translator.translator_id, "alphonse.legacy_runtime.canonical");
});
