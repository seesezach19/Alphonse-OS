import { createHash, createHmac } from "node:crypto";

import { sha256Digest } from "../../../src/canonical-json.js";

const TERMINAL_STATUS = Object.freeze({
  success: "succeeded",
  error: "failed",
  crashed: "failed",
  canceled: "cancelled"
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

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

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function executionWorkflowSnapshot(value) {
  return object(value.workflowData ?? value.data?.workflowData ?? value.workflowSnapshot,
    "n8n execution workflow snapshot");
}

export function buildN8nExecutionWorkflowFingerprint(value) {
  const snapshot = executionWorkflowSnapshot(value);
  const providerWorkflowId = required(String(snapshot.id ?? value.workflowId ?? ""), "n8n workflow id", 160);
  if (!Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
    throw new Error("n8n execution workflow snapshot must contain nodes");
  }
  const material = {
    provider_workflow_id: providerWorkflowId,
    nodes: snapshot.nodes.map((node) => {
      const { credentials: _credentials, ...behavior } = object(node, "n8n workflow node");
      return behavior;
    }),
    connections: object(snapshot.connections ?? {}, "n8n workflow connections"),
    settings: object(snapshot.settings ?? {}, "n8n workflow settings")
  };
  const versionId = snapshot.versionId ?? value.workflowVersionId ?? null;
  return {
    provider_workflow_id: providerWorkflowId,
    provider_workflow_version_id: versionId === null
      ? null
      : required(String(versionId), "n8n workflow version id", 200),
    execution_workflow_material_digest: sha256Digest(material)
  };
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
  const fingerprint = buildN8nExecutionWorkflowFingerprint(value);
  if (fingerprint.provider_workflow_id !== required(String(value.workflowId ?? ""), "n8n workflow id", 160)) {
    throw new Error("n8n execution workflow snapshot identity does not match the execution");
  }
  return {
    execution_id: executionId,
    ...fingerprint,
    status,
    started_at: timestamp(value.startedAt, "n8n startedAt"),
    stopped_at: value.stoppedAt === null || value.stoppedAt === undefined
      ? null
      : timestamp(value.stoppedAt, "n8n stoppedAt")
  };
}

export function normalizeAttestationBinding(providerWorkflowId, value) {
  const binding = object(value, "attestation binding");
  const providerId = required(providerWorkflowId, "provider workflow id", 160);
  const revisionId = required(binding.revision_id, "Alphonse revision id", 160);
  if (!UUID.test(revisionId)) throw new Error("Alphonse revision id must be a UUID");
  const executionDigest = required(binding.execution_workflow_material_digest,
    "execution workflow material digest", 80);
  const rulesDigest = required(binding.fingerprint_rules_digest, "fingerprint rules digest", 80);
  if (!DIGEST.test(executionDigest)) {
    throw new Error("Attestation binding requires an execution workflow material digest");
  }
  if (!DIGEST.test(rulesDigest)) {
    throw new Error("Attestation binding requires a fingerprint rules digest");
  }
  return {
    provider_workflow_id: providerId,
    workflow_id: required(binding.workflow_id, "Alphonse workflow id", 160),
    revision_id: revisionId,
    execution_workflow_material_digest: executionDigest,
    fingerprint_rules_digest: rulesDigest
  };
}

export function assertExecutionBinding(observation, binding) {
  const checked = normalizeN8nExecutionObservation(observation);
  const configured = normalizeAttestationBinding(binding?.provider_workflow_id, binding);
  if (checked.provider_workflow_id !== configured.provider_workflow_id) {
    throw new Error("Observed n8n workflow does not match the attestation binding");
  }
  if (checked.execution_workflow_material_digest !== configured.execution_workflow_material_digest) {
    throw new Error("Executed n8n workflow material does not match the attestation binding");
  }
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
    provider_workflow_version_id: checked.provider_workflow_version_id,
    execution_workflow_material_digest: checked.execution_workflow_material_digest,
    fingerprint_rules_digest: binding.fingerprint_rules_digest,
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
