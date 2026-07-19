import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import {
  citationIndexFromWorkerInput,
  DIAGNOSTIC_BROKER_GRANT_SCHEMA,
  DIAGNOSTIC_BROKER_RECEIPT_SCHEMA,
  signDiagnosticRuntimeDocument,
  validateDiagnosticWorkerOutput,
  verifyBrokerGrant
} from "./diagnostic-worker-execution-contracts.js";

const port = Number(process.env.DIAGNOSTIC_MODEL_BROKER_PORT ?? 3900);
const audience = process.env.DIAGNOSTIC_MODEL_BROKER_AUDIENCE
  ?? "diagnostic-model-broker:v0.1";
const stateRoot = process.env.DIAGNOSTIC_MODEL_BROKER_STATE_ROOT
  ?? "/var/lib/alphonse-model-broker";
const grantSigning = {
  keyId: process.env.DIAGNOSTIC_MODEL_BROKER_GRANT_KEY_ID,
  secret: process.env.DIAGNOSTIC_MODEL_BROKER_GRANT_SIGNING_SECRET
};
const receiptSigning = {
  keyId: process.env.DIAGNOSTIC_MODEL_BROKER_RECEIPT_KEY_ID,
  secret: process.env.DIAGNOSTIC_MODEL_BROKER_RECEIPT_SECRET
};
const providerCredential = process.env.DIAGNOSTIC_REFERENCE_PROVIDER_CREDENTIAL;
const referenceModel = {
  provider: "reference-provider",
  model: "synthetic-diagnostic-fixture",
  version: "ticket-17-v1",
  capability_class: "diagnostic_reasoning",
  snapshot: { identifier: "ticket-17-v1", verification: "broker_asserted" },
  reasoning: { effort: "fixed" },
  sampling: { temperature: 0, top_p: 1 },
  seed: { value: null, verification: "not_supported" }
};
if (!grantSigning.keyId || !grantSigning.secret || !receiptSigning.keyId
    || !receiptSigning.secret || !providerCredential) {
  throw new Error("Model Broker grant, receipt, and provider credentials are required.");
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {never}
 */
function fail(status, code, message, details = {}) {
  throw new KernelError(status, code, message, details);
}

function send(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

async function readJson(request, maximum = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) fail(413, "MODEL_BROKER_REQUEST_TOO_LARGE",
      "Model Broker request exceeds the absolute request ceiling.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "MODEL_BROKER_REQUEST_INVALID", "Model Broker request must be valid JSON.");
  }
}

function referenceProvider(input) {
  const citations = [...citationIndexFromWorkerInput(input).values()]
    .sort((left, right) => {
      const leftCanonical = canonicalize(left);
      const rightCanonical = canonicalize(right);
      return leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0;
    });
  const diagnosis = {
    causal_summary: "Two delivery attempts for one logical operation used delivery-scoped request identity while the governed outcome requires one committed effect per logical operation.",
    best_supported_hypothesis: {
      mechanism: "identity_scope_mismatch",
      observed_identity_scope: "delivery",
      required_identity_scope: "logical_operation",
      support: "BEST_SUPPORTED_HYPOTHESIS",
      confidence: "high",
      implementation_location: { status: "not_proven", component_id: null }
    },
    identity_cardinality: { deliveries: 2, logical_operations: 1 },
    supporting_evidence: citations,
    counterevidence: [],
    alternatives: [
      {
        hypothesis: "The workflow is deduplicating delivery attempts rather than one logical operation.",
        status: "supported",
        reason: "Distinct delivery-scoped identities coexist with two committed effects for one correlated logical operation."
      },
      {
        hypothesis: "A provider behavior change independently duplicated the destination effect.",
        status: "unresolved",
        reason: "The assigned package does not establish an independent provider-side change."
      }
    ],
    not_established: [
      "The responsible implementation location is NOT_ESTABLISHED by the assigned package.",
      "No repair correctness or external failure truth is established by this diagnosis."
    ],
    falsifiers: [
      "A stable logical-operation idempotency key already governed both committed destination requests.",
      "The two committed effects resolve to different logical operations under verified correlation material."
    ],
    recommended_investigations: [{
      type: "destination_request_idempotency_key_scope",
      purpose: "Inspect the request-key derivation boundary without assuming which workflow component implements it."
    }],
    actions_taken: []
  };
  return validateDiagnosticWorkerOutput(diagnosis, citationIndexFromWorkerInput(input));
}

async function consumeGrantOnce(grantDigest, consumedAt) {
  const directory = path.join(stateRoot, "consumed");
  await mkdir(directory, { recursive: true });
  const markerPath = path.join(directory, `${grantDigest.slice("sha256:".length)}.json`);
  let handle;
  try {
    handle = await open(markerPath, "wx", 0o600);
    await handle.writeFile(canonicalize({ grant_digest: grantDigest, consumed_at: consumedAt }));
    await handle.sync();
  } catch (error) {
    if (error.code === "EEXIST") {
      fail(409, "MODEL_BROKER_GRANT_ALREADY_CONSUMED",
        "Model Broker grant has already been consumed.");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function diagnose(request) {
  const value = await readJson(request);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "input,signed_broker_grant") {
    fail(400, "MODEL_BROKER_REQUEST_INVALID",
      "Model Broker request fields must be exact.");
  }
  const verified = verifyBrokerGrant(value.signed_broker_grant, grantSigning);
  const grant = verified.document;
  const { configuration_digest: modelConfigurationDigest, ...model } = grant.model ?? {};
  if (grant.schema_version !== DIAGNOSTIC_BROKER_GRANT_SCHEMA
      || grant.broker?.audience !== audience
      || grant.authority?.model_requests !== 1
      || grant.authority?.external_business_effects !== "none"
      || grant.broker?.max_requests !== 1
      || !same(model, referenceModel)
      || modelConfigurationDigest !== sha256Digest(referenceModel)
      || grant.data_policy?.classification !== "diagnostic_internal"
      || grant.data_policy?.residency !== "customer_controlled_installation"
      || grant.data_policy?.evidence_scope !== "exact_assigned_package_only"
      || grant.data_policy?.provider_training !== "prohibited"
      || grant.egress_policy?.mode !== "model_broker_only_after_claim"
      || grant.egress_policy?.allowed_destination_audience !== audience
      || grant.egress_policy?.general_egress !== false) {
    fail(403, "MODEL_BROKER_GRANT_BOUNDARY_INVALID",
      "Model Broker grant exceeds the closed diagnostic request boundary.");
  }
  if (request.headers.authorization !== `BrokerGrant ${value.signed_broker_grant.document_digest}`) {
    fail(401, "MODEL_BROKER_GRANT_AUTHENTICATION_REQUIRED",
      "Exact Broker Grant authentication is required.");
  }
  const acceptedAt = new Date().toISOString();
  if (Date.parse(acceptedAt) < Date.parse(grant.temporal.not_before)
      || Date.parse(acceptedAt) >= Date.parse(grant.temporal.expires_at)) {
    fail(409, "MODEL_BROKER_GRANT_NOT_CURRENT", "Model Broker grant is not current.");
  }
  const inputBytes = Buffer.from(canonicalize(value.input), "utf8");
  if (sha256Digest(value.input) !== grant.input.input_digest
      || value.input.worker_run_id !== grant.worker_run_id
      || value.input.assignment.assignment_id !== grant.assignment.assignment_id
      || value.input.assignment.assignment_digest !== grant.assignment.assignment_digest
      || value.input.evidence_package_artifact.semantic_digest
        !== grant.assignment.evidence_package_semantic_digest
      || sha256Digest(value.input.evidence_package_artifact)
        !== grant.assignment.evidence_package_artifact_digest
      || inputBytes.length > grant.broker.max_input_units) {
    fail(409, "MODEL_BROKER_INPUT_BINDING_MISMATCH",
      "Model Broker request does not match the exact authorized Worker Run input.");
  }
  await consumeGrantOnce(value.signed_broker_grant.document_digest, acceptedAt);
  const diagnosis = referenceProvider(value.input);
  const outputBytes = Buffer.from(canonicalize(diagnosis), "utf8");
  if (outputBytes.length > grant.broker.max_output_units) {
    fail(413, "MODEL_BROKER_OUTPUT_TOO_LARGE",
      "Provider output exceeds the exact Broker Grant output ceiling.");
  }
  const completedAt = new Date().toISOString();
  const receipt = {
    schema_version: DIAGNOSTIC_BROKER_RECEIPT_SCHEMA,
    receipt_id: randomUUID(),
    grant_id: grant.grant_id,
    grant_digest: value.signed_broker_grant.document_digest,
    launch_id: grant.launch_id,
    worker_run_id: grant.worker_run_id,
    assignment_id: grant.assignment.assignment_id,
    request_digest: sha256Digest({
      grant_digest: value.signed_broker_grant.document_digest,
      input_digest: grant.input.input_digest
    }),
    input_digest: grant.input.input_digest,
    diagnosis_digest: sha256Digest(diagnosis),
    model: structuredClone(grant.model),
    broker: {
      broker_id: grant.broker.broker_id,
      policy_id: grant.broker.policy_id,
      policy_version: grant.broker.policy_version,
      audience: grant.broker.audience
    },
    usage: {
      requests: 1,
      input_units: inputBytes.length,
      output_units: outputBytes.length
    },
    temporal: { accepted_at: acceptedAt, completed_at: completedAt },
    provider_assurance: {
      adapter: "synthetic-reference-provider",
      credential_location: "model_broker_only",
      provider_training: "prohibited_by_broker_policy",
      limitation: "execution_boundary_fixture_not_frontier_model_quality_evidence"
    },
    authority: { diagnosis_proposal: "produced", external_business_effects: "none" }
  };
  return {
    diagnosis,
    signed_broker_receipt: signDiagnosticRuntimeDocument(receipt, receiptSigning)
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") {
      return send(response, 200, { status: "healthy", audience });
    }
    if (request.method === "POST" && url.pathname === "/v0/diagnose") {
      return send(response, 200, await diagnose(request));
    }
    return send(response, 404, { error: { code: "ROUTE_NOT_FOUND", message: "Route does not exist." } });
  } catch (error) {
    const status = error instanceof KernelError ? error.status : (error.status ?? 500);
    const code = error instanceof KernelError ? error.code : (error.code ?? "INTERNAL_ERROR");
    const details = error instanceof KernelError ? error.details : (error.details ?? {});
    return send(response, status, { error: {
      code, message: error.message, details
    } });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Diagnostic Model Broker listening on ${port}`);
});
