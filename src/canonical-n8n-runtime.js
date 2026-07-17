import { sha256Digest } from "./canonical-json.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label, maximum = 200) {
  if (typeof value !== "string" || !value || value.length > maximum) throw new Error(`${label} must be bounded text`);
  return value;
}

function metadataDigest(metadata) {
  object(metadata, "n8n node metadata");
  if (metadata.schema_version !== "alphonse.n8n_node_metadata.v0.1"
      || typeof metadata.runtime_version !== "string") throw new Error("n8n node metadata is unsupported");
  const provenance = object(metadata.provenance, "n8n node metadata provenance");
  if (!DIGEST.test(provenance.runtime_image_digest ?? "")
      || !DIGEST.test(provenance.extractor_artifact_digest ?? "")
      || !String(provenance.runtime_image_reference ?? "").endsWith(provenance.runtime_image_digest)) {
    throw new Error("n8n node metadata provenance is invalid");
  }
  return sha256Digest(metadata);
}

function normalizeCredentialBindings(credentials) {
  if (credentials === undefined) return {};
  object(credentials, "node credential bindings");
  return Object.fromEntries(Object.entries(credentials).sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, binding]) => [kind, {
      id: text(object(binding, "credential binding").id, "credential binding id"),
      name: text(binding.name, "credential binding name")
    }]));
}

function normalizeNode(node, metadata) {
  object(node, "n8n node");
  const type = text(node.type, "node type");
  const typeVersion = Number(node.typeVersion);
  const semantics = metadata.supported_nodes?.[`${type}@${typeVersion}`];
  if (!semantics) throw new Error(`unsupported node semantics: ${type}@${typeVersion}`);
  const ignored = new Set(metadata.ui_only_node_fields ?? []);
  const known = new Set(["id", "name", "type", "typeVersion", "parameters", "credentials", "webhookId", ...ignored]);
  const unknown = Object.keys(node).filter((field) => !known.has(field));
  if (unknown.length) throw new Error(`unclassified behavior-affecting node fields: ${unknown.join(",")}`);
  const normalized = {
    id: text(node.id, "node id"), name: text(node.name, "node name"), type, typeVersion,
    parameters: { ...object(semantics.parameter_defaults ?? {}, "parameter defaults"),
      ...object(node.parameters ?? {}, "node parameters") },
    credentials: normalizeCredentialBindings(node.credentials)
  };
  if (node.webhookId !== undefined) normalized.webhookId = text(node.webhookId, "webhook id");
  return normalized;
}

export function normalizeN8nPublishedWorkflow(value, metadata) {
  const workflow = object(value, "published n8n workflow");
  metadataDigest(metadata);
  const providerWorkflowId = text(String(workflow.id ?? ""), "provider workflow id");
  const providerVersionId = text(String(workflow.versionId ?? ""), "provider workflow version id");
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) throw new Error("workflow nodes are required");
  const material = {
    provider_workflow_id: providerWorkflowId,
    nodes: workflow.nodes.map((node) => normalizeNode(node, metadata)),
    connections: object(workflow.connections ?? {}, "workflow connections"),
    settings: { ...object(metadata.workflow_defaults?.settings ?? {}, "workflow setting defaults"),
      ...object(workflow.settings ?? {}, "workflow settings") }
  };
  return {
    provider_workflow_id: providerWorkflowId,
    provider_workflow_version_id: providerVersionId,
    normalized_workflow_digest: sha256Digest(material),
    normalized_material: material,
    node_metadata_digest: metadataDigest(metadata)
  };
}

export function createN8nReadinessBinding({ workflow, metadata, revision_id: revisionId,
  workflow_id: workflowId, revision_material: revisionMaterial, execution_probe: executionProbe,
  runtime_identity: runtimeIdentity, dependencies = [] }) {
  if (workflow.active !== true) throw new Error("exact published workflow must be active before readiness");
  if (!UUID.test(revisionId ?? "")) throw new Error("exact Agent Revision ID is required");
  text(workflowId, "Alphonse workflow id");
  object(revisionMaterial, "registered Agent Revision material");
  if (revisionMaterial.workflow_id !== workflowId) throw new Error("registered Agent Revision workflow mismatch");
  const identity = object(runtimeIdentity, "live runtime identity");
  if (identity.source !== "docker_inspect_config_image"
      || !DIGEST.test(identity.image_digest ?? "")
      || !String(identity.image_reference ?? "").endsWith(identity.image_digest)
      || identity.runtime_version !== metadata.runtime_version) {
    throw new Error("live runtime image identity is invalid");
  }
  if (identity.image_digest !== metadata.provenance.runtime_image_digest
      || revisionMaterial.runtime?.image_digest !== identity.image_digest
      || revisionMaterial.runtime?.runtime_version !== metadata.runtime_version) {
    throw new Error("runtime image, metadata, and registered Agent Revision do not match");
  }
  const probe = object(executionProbe, "retained execution probe");
  if (probe.status !== "success" || !probe.stoppedAt || !probe.data?.resultData?.runData) {
    throw new Error("successful retained execution detail probe is required");
  }
  const normalized = normalizeN8nPublishedWorkflow(workflow, metadata);
  const revisionWorkflow = object(revisionMaterial.workflow_content?.primary_workflow,
    "registered Agent Revision primary workflow");
  const normalizedRevision = normalizeN8nPublishedWorkflow({ ...revisionWorkflow,
    id: workflow.id, versionId: workflow.versionId, active: true }, metadata);
  if (normalizedRevision.normalized_workflow_digest !== normalized.normalized_workflow_digest) {
    throw new Error("published workflow does not match registered Agent Revision material");
  }
  const binding = {
    schema_version: "alphonse.n8n_runtime_binding.v0.1",
    workflow_id: workflowId, revision_id: revisionId,
    provider_workflow_id: normalized.provider_workflow_id,
    provider_workflow_version_id: normalized.provider_workflow_version_id,
    normalized_workflow_digest: normalized.normalized_workflow_digest,
    runtime_image_digest: identity.image_digest,
    runtime_identity_digest: sha256Digest(identity),
    runtime_version: metadata.runtime_version,
    node_metadata_digest: normalized.node_metadata_digest,
    revision_material_digest: sha256Digest(revisionMaterial),
    execution_probe_digest: sha256Digest({ id: String(probe.id), workflowId: String(probe.workflowId),
      status: probe.status, stoppedAt: probe.stoppedAt, resultData: probe.data.resultData }),
    normalizer_artifact_digest: sha256Digest({ module: "canonical-n8n-runtime", version: "0.1.0" }),
    normalizer_rules_digest: sha256Digest({ schema: metadata.schema_version,
      ignored_node_fields: metadata.ui_only_node_fields, fail_closed_unknown_fields: true }),
    dependency_digests: dependencies.map((item) => text(item, "dependency digest")).sort(),
    readiness: { published_workflow_read: true, execution_detail_read: true, include_data_verified: true,
      successful_execution_retention_verified: true, live_runtime_identity_verified: true,
      node_metadata_provenance_verified: true, registered_revision_material_verified: true }
  };
  return { ...binding, binding_digest: sha256Digest(binding) };
}

function workflowSnapshot(execution) {
  const snapshot = execution.data?.workflowData ?? execution.workflowData ?? execution.workflowSnapshot;
  return { ...object(snapshot, "n8n execution workflow snapshot"),
    versionId: text(execution.workflowVersionId, "executed provider workflow version id") };
}

function findPropagationContext(execution) {
  const runData = execution.data?.resultData?.runData ?? execution.resultData?.runData;
  object(runData, "n8n execution run data");
  for (const runs of Object.values(runData)) {
    for (const run of Array.isArray(runs) ? runs : []) {
      const items = run?.data?.main?.flat(3) ?? [];
      for (const item of items) {
        const headers = item?.json?.headers;
        if (headers?.["x-alphonse-logical-operation-id"] && headers?.["x-alphonse-delivery-id"]) {
          return { logical_operation_id: headers["x-alphonse-logical-operation-id"],
            delivery_id: headers["x-alphonse-delivery-id"] };
        }
      }
    }
  }
  throw new Error("propagated execution context is unavailable");
}

export function observeBoundN8nExecution(execution, binding, metadata) {
  const observed = normalizeN8nPublishedWorkflow(workflowSnapshot(execution), metadata);
  const expected = binding.normalized_workflow_digest;
  if (String(execution.workflowId) !== binding.provider_workflow_id
      || observed.provider_workflow_version_id !== binding.provider_workflow_version_id
      || observed.normalized_workflow_digest !== expected) {
    return { status: "revision_mismatch", expected_normalized_workflow_digest: expected,
      observed_normalized_workflow_digest: observed.normalized_workflow_digest,
      expected_provider_workflow_version_id: binding.provider_workflow_version_id,
      observed_provider_workflow_version_id: observed.provider_workflow_version_id,
      binding_digest: binding.binding_digest };
  }
  if (execution.status !== "success" || !execution.stoppedAt) throw new Error("only terminal successful executions qualify");
  const context = findPropagationContext(execution);
  return { status: "matched", claims: {
    execution_id: `n8n-${text(String(execution.id), "execution id")}`,
    ...context, provider_workflow_id: binding.provider_workflow_id,
    provider_workflow_version_id: binding.provider_workflow_version_id,
    revision_id: binding.revision_id,
    normalized_workflow_digest: expected,
    binding_digest: binding.binding_digest,
    lifecycle: "succeeded",
    started_at: text(execution.startedAt, "execution started at"),
    stopped_at: text(execution.stoppedAt, "execution stopped at")
  } };
}
