import { createHash, createHmac } from "node:crypto";

const TERMINAL_STATUS = Object.freeze({
  success: "succeeded",
  error: "failed",
  crashed: "failed",
  canceled: "cancelled"
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function required(value, field, maximum = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`${field} must be bounded text`);
  }
  return value.trim();
}

function timestamp(value, field) {
  const checked = required(value, field, 40);
  if (!Number.isFinite(Date.parse(checked)) || new Date(Date.parse(checked)).toISOString() !== checked) {
    throw new Error(`${field} must be an exact UTC timestamp`);
  }
  return checked;
}

export function normalizeN8nExecutionObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("n8n execution observation must be an object");
  }
  const executionId = String(value.id ?? "");
  if (!/^[0-9]+$/.test(executionId)) throw new Error("n8n execution id must be numeric");
  const status = required(value.status, "n8n execution status", 40);
  if (![...Object.keys(TERMINAL_STATUS), "new", "running", "waiting"].includes(status)) {
    throw new Error("n8n execution status is unsupported");
  }
  return {
    execution_id: executionId,
    provider_workflow_id: required(String(value.workflowId ?? ""), "n8n workflow id", 160),
    status,
    started_at: timestamp(value.startedAt, "n8n startedAt"),
    stopped_at: value.stoppedAt === null || value.stoppedAt === undefined
      ? null
      : timestamp(value.stoppedAt, "n8n stoppedAt")
  };
}

export function assertExecutionBinding(observation, binding) {
  const checked = normalizeN8nExecutionObservation(observation);
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("n8n execution binding is required");
  }
  if (checked.provider_workflow_id !== binding.provider_workflow_id) {
    throw new Error("Observed n8n workflow does not match the attestation binding");
  }
  required(binding.workflow_id, "Alphonse workflow id", 160);
  if (!UUID.test(binding.revision_id ?? "")) throw new Error("Alphonse revision id must be a UUID");
  return checked;
}

export function normalizeAttestationRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["external_execution_id"])) {
    throw new Error("Attestation request must contain only external_execution_id");
  }
  const externalExecutionId = String(value.external_execution_id ?? "");
  if (!/^[0-9]+$/.test(externalExecutionId)) throw new Error("Attestation execution id must be numeric");
  return { external_execution_id: externalExecutionId };
}

export function assertAttestationCandidate(request, observation, binding) {
  const candidate = normalizeAttestationRequest(request);
  const checked = assertExecutionBinding(observation, binding);
  if (candidate.external_execution_id !== checked.execution_id) {
    throw new Error("Observed n8n execution does not match the requested execution identity");
  }
  return checked;
}

export function buildAttestedRuntimeEvent({ observation, binding, adapter, signing, signedAt }) {
  const checked = assertExecutionBinding(observation, binding);
  const lifecycleClaim = TERMINAL_STATUS[checked.status];
  if (!lifecycleClaim || !checked.stopped_at) {
    throw new Error("Only independently observed terminal n8n executions can be attested");
  }
  const adapterId = required(adapter?.adapter_id, "adapter_id", 160);
  const adapterVersion = required(adapter?.adapter_version, "adapter_version", 100);
  const keyId = required(signing?.key_id, "key_id", 160);
  if (typeof signing?.secret !== "string" || signing.secret.length < 32) {
    throw new Error("Runtime Event HMAC secret must be at least 32 characters");
  }
  const basis = {
    source: "n8n_api_execution_observation",
    execution_id: checked.execution_id,
    provider_workflow_id: checked.provider_workflow_id,
    status: checked.status,
    started_at: checked.started_at,
    stopped_at: checked.stopped_at
  };
  const envelope = {
    schema_version: "0.2.0",
    adapter: { adapter_id: adapterId, adapter_version: adapterVersion },
    workflow_id: binding.workflow_id,
    revision_id: binding.revision_id,
    external_execution_id: `n8n-${checked.execution_id}`,
    event_id: `n8n-${checked.execution_id}-${lifecycleClaim}`,
    event_sequence: 1,
    lifecycle_claim: lifecycleClaim,
    correlation_id: `n8n-${checked.execution_id}`,
    idempotency_key: `n8n-${checked.execution_id}:terminal`,
    occurred_at: checked.stopped_at,
    payload: {
      digest: `sha256:${createHash("sha256").update(canonicalize(basis)).digest("hex")}`,
      reference: null
    }
  };
  const checkedSignedAt = timestamp(signedAt, "signed_at");
  const bytes = ["alphonse-runtime-event-hmac-v1", keyId, checkedSignedAt, canonicalize(envelope)].join("\n");
  return {
    envelope,
    authentication: {
      key_id: keyId,
      signed_at: checkedSignedAt,
      signature: `hmac-sha256:${createHmac("sha256", signing.secret).update(bytes, "utf8").digest("hex")}`
    },
    attestation_basis: basis
  };
}
