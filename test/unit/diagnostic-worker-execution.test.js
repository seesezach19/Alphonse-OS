import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalize, sha256Digest } from "../../src/canonical-json.js";
import { diagnosticWorkerCreateArguments } from "../../src/diagnostic-runner.js";
import {
  DIAGNOSTIC_BROKER_GRANT_SCHEMA,
  DIAGNOSTIC_RUNNER_ATTESTATION_SCHEMA,
  signDiagnosticRuntimeDocument,
  validateDiagnosticOutputFileBoundary,
  validateDiagnosticWorkerOutput,
  verifyBrokerGrant,
  verifyRunnerAttestation
} from "../../src/diagnostic-worker-execution-contracts.js";

const signing = { keyId: "diagnostic-key:v1",
  secret: "unit-test-diagnostic-runtime-secret-with-at-least-32-bytes" };
const citations = [
  { role: "behavior_contract", reference_type: "behavior_contract",
    reference_id: "behavior-contract:unit", reference_digest: `sha256:${"1".repeat(64)}` },
  { role: "correlation_projection", reference_type: "correlation_projection",
    reference_id: "00000000-0000-4000-8000-000000000161",
    reference_digest: `sha256:${"2".repeat(64)}` },
  { role: "destination_request", reference_type: "diagnostic_observation_receipt",
    reference_id: "00000000-0000-4000-8000-000000000162",
    reference_digest: `sha256:${"3".repeat(64)}` },
  { role: "interpreted_effect", reference_type: "diagnostic_effect_projection",
    reference_id: "00000000-0000-4000-8000-000000000163",
    reference_digest: `sha256:${"4".repeat(64)}` },
  { role: "source_delivery", reference_type: "diagnostic_observation_receipt",
    reference_id: "00000000-0000-4000-8000-000000000164",
    reference_digest: `sha256:${"5".repeat(64)}` }
];
const citationIndex = new Map(citations.map((citation) => [canonicalize(citation), citation]));

function diagnosis() {
  return {
    causal_summary: "Two delivery attempts represent one logical operation, so delivery-scoped identity is too narrow.",
    best_supported_hypothesis: {
      mechanism: "identity_scope_mismatch",
      observed_identity_scope: "delivery",
      required_identity_scope: "logical_operation",
      support: "BEST_SUPPORTED_HYPOTHESIS",
      confidence: "high",
      implementation_location: { status: "not_proven", component_id: null }
    },
    identity_cardinality: { deliveries: 2, logical_operations: 1 },
    supporting_evidence: structuredClone(citations),
    counterevidence: [],
    alternatives: [{ hypothesis: "delivery-scoped identity", status: "supported",
      reason: "delivery attempts are distinct while the logical operation is shared" }],
    not_established: ["implementation location is NOT_ESTABLISHED"],
    falsifiers: ["a logical-operation key already governed both requests"],
    recommended_investigations: [
      { type: "idempotency_key_scope", purpose: "distinguish delivery and operation scopes" }
    ],
    actions_taken: []
  };
}

test("runtime documents are exact-digest signed and schema bound", () => {
  const grant = { schema_version: DIAGNOSTIC_BROKER_GRANT_SCHEMA,
    grant_id: "00000000-0000-4000-8000-000000000162", authority: { model_requests: 1 } };
  const signed = signDiagnosticRuntimeDocument(grant, signing);
  assert.deepEqual(verifyBrokerGrant(signed, signing).document, grant);
  const tampered = structuredClone(signed);
  tampered.document.authority.model_requests = 2;
  assert.throws(() => verifyBrokerGrant(tampered, signing),
    (error) => error.code === "DIAGNOSTIC_RUNTIME_SIGNATURE_INVALID");
  assert.throws(() => verifyRunnerAttestation(signed, signing),
    (error) => error.code === "DIAGNOSTIC_RUNTIME_SIGNATURE_INVALID");

  const runner = signDiagnosticRuntimeDocument({
    schema_version: DIAGNOSTIC_RUNNER_ATTESTATION_SCHEMA, phase: "started"
  }, signing);
  assert.equal(verifyRunnerAttestation(runner, signing).document.phase, "started");
});

test("diagnosis validation uses the closed taxonomy and resolves exact typed package citations", () => {
  const checked = validateDiagnosticWorkerOutput(diagnosis(), citationIndex);
  assert.equal(checked.best_supported_hypothesis.mechanism, "identity_scope_mismatch");
  assert.deepEqual(checked.supporting_evidence, citations);

  const inventedCitation = diagnosis();
  inventedCitation.supporting_evidence[0].reference_id = "behavior-contract:invented";
  assert.throws(() => validateDiagnosticWorkerOutput(inventedCitation, citationIndex),
    (error) => error.code === "DIAGNOSTIC_WORKER_CITATION_INVALID");
  const extraField = diagnosis();
  extraField.fixture_answer = "identity_scope_mismatch";
  assert.throws(() => validateDiagnosticWorkerOutput(extraField, citationIndex),
    (error) => error.code === "DIAGNOSTIC_WORKER_OUTPUT_INVALID");
});

test("reference runner arguments enforce the exact isolated Worker mount and resource boundary", () => {
  const input = { worker_run_id: "00000000-0000-4000-8000-000000000163" };
  const launch = {
    launch_id: "00000000-0000-4000-8000-000000000164",
    worker_run_id: input.worker_run_id,
    input_digest: sha256Digest(input),
    worker_input: input,
    signed_broker_grant: { document_digest: `sha256:${"a".repeat(64)}` },
    runtime_boundary: {
      runtime: { image: { digest: `sha256:${"b".repeat(64)}` } },
      resources: { max_memory_bytes: 536870912, max_cpus: 1, max_pids: 64,
        max_output_bytes: 1048576, max_runtime_seconds: 600 }
    }
  };
  const args = diagnosticWorkerCreateArguments({ launch, inputDirectory: "/exact/input",
    networkName: "internal-broker-only", containerName: "worker" });
  const joined = args.join(" ");
  for (const expected of ["--user 10001:10001", "--read-only", "--cap-drop ALL",
    "--security-opt no-new-privileges:true", "--network internal-broker-only",
    "--memory 536870912", "--cpus 1", "--pids-limit 64",
    "type=bind,src=/exact/input,dst=/input,readonly,bind-propagation=rprivate",
    "/output:rw,noexec,nosuid,nodev,size=1048576"] ) {
    assert.ok(joined.includes(expected), `missing ${expected}`);
  }
  assert.doesNotMatch(joined, /docker\.sock|KERNEL_|DATABASE_|PROVIDER_CREDENTIAL/u);
  assert.equal(args.at(-1), `sha256:${"b".repeat(64)}`);
});

test("post-exit output validation rejects links, devices, unexpected files, and oversize bytes", () => {
  const bytes = Buffer.from('{"diagnosis":true}\n', "utf8");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const valid = { entries: [{ path: "diagnosis.json", type: "regular_file",
    size_bytes: bytes.length }], sole_expected_regular_file: true,
  total_size_bytes: bytes.length, maximum_size_bytes: 1024, diagnosis_file_digest: digest };
  assert.deepEqual(validateDiagnosticOutputFileBoundary(valid, bytes, 1024), {
    output_file_digest: digest, output_size_bytes: bytes.length
  });
  for (const entries of [
    [{ path: "diagnosis.json", type: "symbolic_link", size_bytes: bytes.length }],
    [{ path: "diagnosis.json", type: "character_device", size_bytes: 0 }],
    [...valid.entries, { path: "unexpected.txt", type: "regular_file", size_bytes: 1 }]
  ]) {
    assert.throws(() => validateDiagnosticOutputFileBoundary({ ...valid, entries }, bytes, 1024),
      (error) => error.code === "DIAGNOSTIC_WORKER_OUTPUT_BOUNDARY_INVALID");
  }
  assert.throws(() => validateDiagnosticOutputFileBoundary({ ...valid,
    maximum_size_bytes: 4 }, bytes, 4),
  (error) => error.code === "DIAGNOSTIC_WORKER_OUTPUT_BOUNDARY_INVALID");
});
