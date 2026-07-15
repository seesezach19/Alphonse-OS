export const DIAGNOSTIC_PROTOCOL_VERSION = "0.2.0";

const commandEnvelope = (operationId, input) => ({
  type: "object",
  required: ["command_id", "operation_id", "input"],
  additionalProperties: false,
  properties: {
    command_id: { type: "string", minLength: 1, maxLength: 160 },
    operation_id: { const: operationId },
    input
  }
});

const workflowInput = {
  type: "object",
  required: ["workflow_id", "display_name", "objective", "external_ref"],
  additionalProperties: false,
  properties: {
    workflow_id: { type: "string", pattern: "^[a-z][a-z0-9._:-]{2,159}$" },
    display_name: { type: "string", minLength: 1, maxLength: 120 },
    objective: { type: "string", minLength: 1, maxLength: 1000 },
    external_ref: {
      type: "object",
      required: ["system", "workflow_key", "environment"],
      additionalProperties: false,
      properties: {
        system: { type: "string", minLength: 1, maxLength: 80 },
        workflow_key: { type: "string", minLength: 1, maxLength: 200 },
        environment: { type: "string", minLength: 1, maxLength: 80 }
      }
    }
  }
};

const revisionInput = {
  type: "object",
  required: ["workflow_id", "workflow_content", "runtime", "nodes", "model", "configuration", "adapter"],
  additionalProperties: false,
  properties: {
    workflow_id: { type: "string" },
    workflow_content: { type: "object" },
    runtime: {
      type: "object",
      required: ["runtime_id", "runtime_version", "image_digest"],
      additionalProperties: false,
      properties: {
        runtime_id: { type: "string", minLength: 1, maxLength: 100 },
        runtime_version: { type: "string", minLength: 1, maxLength: 100 },
        image_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
      }
    },
    nodes: {
      type: "array",
      minItems: 1,
      maxItems: 500,
      items: {
        type: "object",
        required: ["node_type", "node_version"],
        additionalProperties: false,
        properties: {
          node_type: { type: "string", minLength: 1, maxLength: 200 },
          node_version: { type: "string", minLength: 1, maxLength: 100 }
        }
      }
    },
    model: {
      type: "object",
      required: ["provider", "model", "version"],
      additionalProperties: false,
      properties: {
        provider: { type: "string", minLength: 1, maxLength: 100 },
        model: { type: "string", minLength: 1, maxLength: 160 },
        version: { type: "string", minLength: 1, maxLength: 160 }
      }
    },
    configuration: { type: "object" },
    adapter: {
      type: "object",
      required: ["adapter_id", "adapter_version", "fingerprint_rules_digest"],
      additionalProperties: false,
      properties: {
        adapter_id: { type: "string", minLength: 1, maxLength: 160 },
        adapter_version: { type: "string", minLength: 1, maxLength: 100 },
        fingerprint_rules_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
      }
    }
  }
};

const runtimeEventInput = {
  type: "object",
  required: [
    "schema_version", "adapter", "workflow_id", "revision_id", "external_execution_id", "event_id",
    "event_sequence", "lifecycle_claim", "correlation_id", "idempotency_key", "occurred_at", "payload"
  ],
  additionalProperties: false,
  properties: {
    schema_version: { const: "0.2.0" },
    adapter: {
      type: "object",
      required: ["adapter_id", "adapter_version"],
      additionalProperties: false,
      properties: {
        adapter_id: { type: "string", minLength: 1, maxLength: 160 },
        adapter_version: { type: "string", minLength: 1, maxLength: 100 }
      }
    },
    workflow_id: { type: "string", minLength: 1, maxLength: 160 },
    revision_id: { type: "string", format: "uuid" },
    external_execution_id: { type: "string", minLength: 1, maxLength: 200 },
    event_id: { type: "string", minLength: 1, maxLength: 140 },
    event_sequence: { type: "integer", minimum: 0 },
    lifecycle_claim: { enum: ["accepted", "running", "succeeded", "failed", "cancelled"] },
    correlation_id: { type: "string", minLength: 1, maxLength: 200 },
    idempotency_key: { type: "string", minLength: 1, maxLength: 200 },
    occurred_at: { type: "string", format: "date-time" },
    payload: {
      type: "object",
      required: ["digest", "reference"],
      additionalProperties: false,
      properties: {
        digest: { type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$" },
        reference: { type: ["string", "null"], maxLength: 500 }
      }
    }
  }
};

function commandDescriptor({ operationId, summary, path, input, resultKey, event, issues, nextOperations }) {
  return {
    operation_id: operationId,
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary,
    visibility: "public",
    authority_class: "authenticated_builder_attribution_only",
    effect_class: "diagnostic_state_transition",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: { method: "POST", path },
    input_schema: commandEnvelope(operationId, input),
    output_schema: {
      type: "object",
      required: ["command_id", "request_digest", resultKey, "transition"]
    },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available", "authenticated_builder"],
    outcomes: [`${resultKey}_created`, `${resultKey}_reused`, "command_replayed"],
    issues: ["AUTHENTICATION_REQUIRED", "INVALID_INPUT", "IDEMPOTENCY_CONFLICT", ...issues],
    emitted_events: Array.isArray(event) ? event : [event],
    next_operations: nextOperations
  };
}

function readDescriptor({ operationId, summary, path, idName, resultKey, issues, nextOperations = [] }) {
  return {
    operation_id: operationId,
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary,
    visibility: "public",
    authority_class: "authenticated_customer_reader",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path },
    input_schema: {
      type: "object",
      required: [idName],
      additionalProperties: false,
      properties: { [idName]: { type: "string" } }
    },
    output_schema: { type: "object", required: [resultKey] },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available", "authenticated_customer_reader", `${resultKey}_exists`],
    outcomes: [`${resultKey}_returned`, `${resultKey}_not_found`],
    issues: ["AUTHENTICATION_REQUIRED", ...issues],
    emitted_events: [],
    next_operations: nextOperations
  };
}

const descriptors = [
  {
    operation_id: "diagnostic.workflow_runtime_adapter.contract.get",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Discover the provider-neutral Workflow Runtime Adapter contract and optional seams.",
    visibility: "public",
    authority_class: "none",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/diagnostic/v0/runtime-adapter-contract" },
    input_schema: { type: "object", additionalProperties: false },
    output_schema: { type: "object", required: ["contract_name", "contract_version", "capabilities"] },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available"],
    outcomes: ["runtime_adapter_contract_returned"],
    issues: ["DIAGNOSTIC_PLANE_UNAVAILABLE"],
    emitted_events: [],
    next_operations: ["diagnostic.runtime_event.receive"]
  },
  commandDescriptor({
    operationId: "diagnostic.agent_workflow.register",
    summary: "Register one stable external Agent Workflow identity without granting authority.",
    path: "/diagnostic/v0/agent-workflows",
    input: workflowInput,
    resultKey: "agent_workflow",
    event: ["diagnostic.agent_workflow.registered", "diagnostic.agent_workflow.reused"],
    issues: ["WORKFLOW_IDENTITY_CONFLICT", "SENSITIVE_METADATA_REJECTED"],
    nextOperations: ["diagnostic.agent_workflow.get", "diagnostic.agent_revision.register"]
  }),
  readDescriptor({
    operationId: "diagnostic.agent_workflow.get",
    summary: "Inspect one stable Agent Workflow identity and its authority-free status.",
    path: "/diagnostic/v0/agent-workflows/{workflow_id}",
    idName: "workflow_id",
    resultKey: "agent_workflow",
    issues: ["AGENT_WORKFLOW_NOT_FOUND"],
    nextOperations: ["diagnostic.agent_revision.register"]
  }),
  commandDescriptor({
    operationId: "diagnostic.agent_revision.register",
    summary: "Register one exact immutable external Agent Revision and content-addressed snapshot.",
    path: "/diagnostic/v0/agent-revisions",
    input: revisionInput,
    resultKey: "agent_revision",
    event: ["diagnostic.agent_revision.registered", "diagnostic.agent_revision.reused"],
    issues: ["AGENT_WORKFLOW_NOT_FOUND", "SENSITIVE_METADATA_REJECTED", "ARTIFACT_DIGEST_MISMATCH"],
    nextOperations: ["diagnostic.agent_revision.get"]
  }),
  readDescriptor({
    operationId: "diagnostic.agent_revision.get",
    summary: "Inspect one exact immutable Agent Revision without current or active labels.",
    path: "/diagnostic/v0/agent-revisions/{revision_id}",
    idName: "revision_id",
    resultKey: "agent_revision",
    issues: ["AGENT_REVISION_NOT_FOUND"],
    nextOperations: ["diagnostic.artifact.get"]
  }),
  readDescriptor({
    operationId: "diagnostic.artifact.get",
    summary: "Retrieve and verify one content-addressed Diagnostic artifact.",
    path: "/diagnostic/v0/artifacts/{artifact_digest}",
    idName: "artifact_digest",
    resultKey: "artifact",
    issues: ["INVALID_ARTIFACT_DIGEST", "ARTIFACT_NOT_FOUND", "ARTIFACT_DIGEST_MISMATCH"]
  }),
  {
    operation_id: "diagnostic.runtime_event.receive",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Authenticate and preserve one external runtime lifecycle claim without Kernel admission.",
    visibility: "public",
    authority_class: "exact_workflow_runtime_adapter_hmac",
    effect_class: "diagnostic_observation_append",
    idempotency: "event_identity_sequence_and_idempotency_key_with_canonical_envelope_digest",
    transport: {
      method: "POST",
      path: "/diagnostic/v0/runtime-events",
      authentication_headers: [
        "x-alphonse-runtime-key-id",
        "x-alphonse-runtime-signed-at",
        "x-alphonse-runtime-signature"
      ]
    },
    input_schema: runtimeEventInput,
    output_schema: {
      type: "object",
      required: ["receipt_id", "trace_id", "event_id", "http_acceptance", "authority", "transition"]
    },
    supported_modes: ["live"],
    preconditions: [
      "diagnostic_plane_available", "exact_adapter_key_binding", "signature_timestamp_current",
      "agent_workflow_exists", "exact_agent_revision_exists"
    ],
    outcomes: ["external_claim_preserved", "identical_event_replayed", "event_conflict_preserved"],
    issues: [
      "RUNTIME_EVENT_KEY_MISMATCH", "RUNTIME_EVENT_SIGNATURE_INVALID",
      "RUNTIME_EVENT_TIMESTAMP_OUT_OF_WINDOW", "AGENT_REVISION_IDENTITY_MISMATCH",
      "RUNTIME_EVENT_IDENTITY_CONFLICT"
    ],
    emitted_events: ["diagnostic.runtime_event.received"],
    next_operations: ["diagnostic.external_activity_trace.get"]
  },
  readDescriptor({
    operationId: "diagnostic.external_activity_trace.get",
    summary: "Inspect one immutable external observation and its sequence-based projection.",
    path: "/diagnostic/v0/external-activity-traces/{trace_id}",
    idName: "trace_id",
    resultKey: "external_activity_trace",
    issues: ["EXTERNAL_ACTIVITY_TRACE_NOT_FOUND"],
    nextOperations: []
  }),
  readDescriptor({
    operationId: "diagnostic.runtime_event_conflict.get",
    summary: "Inspect one preserved Runtime Event identity conflict without changing accepted truth.",
    path: "/diagnostic/v0/runtime-event-conflicts/{conflict_id}",
    idName: "conflict_id",
    resultKey: "runtime_event_conflict",
    issues: ["RUNTIME_EVENT_CONFLICT_NOT_FOUND"],
    nextOperations: ["diagnostic.external_activity_trace.get"]
  })
];

export function listDiagnosticOperationDescriptors() {
  return structuredClone(descriptors);
}

export function getDiagnosticOperationDescriptor(operationId) {
  const descriptor = descriptors.find((item) => item.operation_id === operationId);
  return descriptor ? structuredClone(descriptor) : null;
}
