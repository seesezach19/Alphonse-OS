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

const repairTaskReference = {
  type: "object",
  required: ["task_id"],
  additionalProperties: false,
  properties: { task_id: { type: "string", format: "uuid" } }
};

const leasedRepairTaskInput = (extraRequired = [], extraProperties = {}) => ({
  type: "object",
  required: ["task_id", "lease_epoch", ...extraRequired],
  additionalProperties: false,
  properties: {
    task_id: { type: "string", format: "uuid" },
    lease_epoch: { type: "integer", minimum: 1 },
    ...extraProperties
  }
});

const repairArtifactLimits = {
  type: "object",
  required: ["max_artifact_bytes", "max_total_bytes", "allowed_media_types"],
  additionalProperties: false,
  properties: {
    max_artifact_bytes: { type: "integer", minimum: 256, maximum: 2097152 },
    max_total_bytes: { type: "integer", minimum: 256, maximum: 6291456 },
    allowed_media_types: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } }
  }
};

const workerRuntimeAttribution = {
  type: "object",
  required: ["worker_kind", "runtime_version", "attachment_version"],
  additionalProperties: false,
  properties: {
    worker_kind: { type: "string", minLength: 1, maxLength: 100 },
    runtime_version: { type: "string", minLength: 1, maxLength: 100 },
    attachment_version: { type: "string", minLength: 1, maxLength: 100 }
  }
};

const diagnosisProvenance = {
  type: "object", required: ["model", "runtime", "instruction_digest", "input_artifact_digests"],
  additionalProperties: false,
  properties: {
    model: { type: "object", required: ["provider", "model", "version"], additionalProperties: false,
      properties: { provider: { type: "string" }, model: { type: "string" }, version: { type: "string" } } },
    runtime: { type: "object", required: ["name", "version"], additionalProperties: false,
      properties: { name: { type: "string" }, version: { type: "string" } } },
    instruction_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    input_artifact_digests: { type: "array", minItems: 1, maxItems: 30,
      items: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } }
  }
};

function commandDescriptor({
  operationId, summary, path, input, resultKey, event, issues, nextOperations,
  authorityClass = "authenticated_builder_attribution_only",
  effectClass = "diagnostic_state_transition",
  preconditions = ["diagnostic_plane_available", "authenticated_builder"],
  outcomes = [`${resultKey}_created`, `${resultKey}_reused`, "command_replayed"]
}) {
  return {
    operation_id: operationId,
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary,
    visibility: "public",
    authority_class: authorityClass,
    effect_class: effectClass,
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: { method: "POST", path },
    input_schema: commandEnvelope(operationId, input),
    output_schema: {
      type: "object",
      required: ["command_id", "request_digest", resultKey, "transition"]
    },
    supported_modes: ["live"],
    preconditions,
    outcomes,
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
  {
    operation_id: "diagnostic.repair_delivery_adapter.contract.get",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Discover independently declared provider-neutral repair delivery operations.",
    visibility: "public",
    authority_class: "none",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/diagnostic/v0/repair-delivery-adapter-contract" },
    input_schema: { type: "object", additionalProperties: false },
    output_schema: { type: "object", required: ["contract_name", "contract_version", "operations"] },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available"],
    outcomes: ["repair_delivery_adapter_contract_returned"],
    issues: ["DIAGNOSTIC_PLANE_UNAVAILABLE"],
    emitted_events: [],
    next_operations: ["diagnostic.repair_delivery_binding.register"]
  },
  {
    operation_id: "diagnostic.verification_runner.contract.get",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Discover the deterministic independent Verification Runner boundary.",
    visibility: "public",
    authority_class: "none",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/diagnostic/v0/verification-runner-contract" },
    input_schema: { type: "object", additionalProperties: false },
    output_schema: { type: "object", required: ["contract_name", "contract_version", "invariants"] },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available"],
    outcomes: ["verification_runner_contract_returned"],
    issues: ["DIAGNOSTIC_PLANE_UNAVAILABLE"],
    emitted_events: [],
    next_operations: ["diagnostic.repair_verification.create"]
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
    nextOperations: ["diagnostic.case.report_failure"]
  }),
  readDescriptor({
    operationId: "diagnostic.runtime_event_conflict.get",
    summary: "Inspect one preserved Runtime Event identity conflict without changing accepted truth.",
    path: "/diagnostic/v0/runtime-event-conflicts/{conflict_id}",
    idName: "conflict_id",
    resultKey: "runtime_event_conflict",
    issues: ["RUNTIME_EVENT_CONFLICT_NOT_FOUND"],
    nextOperations: ["diagnostic.external_activity_trace.get"]
  }),
  commandDescriptor({
    operationId: "diagnostic.case.report_failure",
    summary: "Open one authority-free Diagnostic Case from an explicit authenticated failure report.",
    path: "/diagnostic/v0/cases",
    input: {
      type: "object", required: ["trace_id", "summary"], additionalProperties: false,
      properties: { trace_id: { type: "string", format: "uuid" }, summary: { type: "string", minLength: 1, maxLength: 1000 } }
    },
    resultKey: "diagnostic_case",
    event: ["diagnostic.case.failure_reported", "diagnostic.case.failure_report_reused"],
    issues: ["EXTERNAL_ACTIVITY_TRACE_NOT_FOUND", "DIAGNOSTIC_CASE_IDENTITY_CONFLICT"],
    nextOperations: ["diagnostic.case.get", "diagnostic.failure_specification.confirm"]
  }),
  commandDescriptor({
    operationId: "diagnostic.failure_specification.confirm",
    summary: "Record immutable human-confirmed expected and actual behavior for one case.",
    path: "/diagnostic/v0/failure-specifications",
    input: {
      type: "object",
      required: ["case_id", "expected_behavior", "actual_behavior", "reproduction_conditions", "targeted_verification"],
      additionalProperties: false,
      properties: {
        case_id: { type: "string", format: "uuid" },
        expected_behavior: { type: "string", minLength: 1, maxLength: 1000 },
        actual_behavior: { type: "string", minLength: 1, maxLength: 1000 },
        reproduction_conditions: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } },
        targeted_verification: {
          type: "object", required: ["expected_behavior", "prohibited_behavior"], additionalProperties: false
        }
      }
    },
    resultKey: "failure_specification",
    event: ["diagnostic.failure_specification.confirmed", "diagnostic.failure_specification.reused"],
    issues: [
      "DIAGNOSTIC_CASE_NOT_FOUND", "HUMAN_CONFIRMATION_REQUIRED",
      "FAILURE_SPECIFICATION_INCONSISTENT", "FAILURE_SPECIFICATION_IMMUTABLE"
    ],
    nextOperations: ["diagnostic.case.get", "diagnostic.reproduction.create"],
    authorityClass: "authenticated_human_confirmation"
  }),
  commandDescriptor({
    operationId: "diagnostic.reproduction.create",
    summary: "Retrieve minimal runtime detail, redact it, and deterministically demonstrate the confirmed defect.",
    path: "/diagnostic/v0/reproductions",
    input: {
      type: "object", required: ["case_id", "fixture_bindings", "assumptions"], additionalProperties: false,
      properties: {
        case_id: { type: "string", format: "uuid" },
        fixture_bindings: {
          type: "object", required: ["erp", "storefront", "model", "review"], additionalProperties: false
        },
        assumptions: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } }
      }
    },
    resultKey: "reproduction_attempt",
    event: [
      "diagnostic.reproduction.incomplete", "diagnostic.reproduction.rejected",
      "diagnostic.reproduction.demonstrated", "diagnostic.reproduction_bundle.reused"
    ],
    issues: ["DIAGNOSTIC_CASE_NOT_FOUND", "FAILURE_SPECIFICATION_REQUIRED", "RUNTIME_DETAIL_UNAVAILABLE"],
    nextOperations: ["diagnostic.case.get", "diagnostic.artifact.get", "diagnostic.repair_task.create"]
  }),
  commandDescriptor({
    operationId: "diagnostic.diagnosis_worker.register",
    summary: "Attach a distinct customer-controlled Diagnostic Worker with no operational authority.",
    path: "/diagnostic/v0/diagnosis-workers",
    input: { type: "object", required: ["passport_id", "work_intent_id", "protocol_version", "runtime_attribution"],
      additionalProperties: false, properties: {
        passport_id: { type: "string", format: "uuid" }, work_intent_id: { type: "string", format: "uuid" },
        protocol_version: { const: "0.2.0" }, runtime_attribution: workerRuntimeAttribution
      } },
    resultKey: "diagnosis_worker",
    event: ["diagnostic.diagnosis_worker.registered", "diagnostic.diagnosis_worker.reused"],
    issues: ["DIAGNOSIS_INTENT_REQUIRED", "DIAGNOSIS_WORKER_NOT_DISTINCT", "PASSPORT_INTENT_MISMATCH"],
    nextOperations: ["diagnostic.diagnosis_request.create"],
    authorityClass: "authenticated_diagnostic_worker_passport", effectClass: "advisory_worker_registration",
    preconditions: ["demonstrated_failure", "confirmed_diagnostic_analysis_intent", "distinct_worker_identity"]
  }),
  commandDescriptor({
    operationId: "diagnostic.diagnosis_request.create",
    summary: "Bind one short-lived advisory request to exact confirmed diagnostic sources and instructions.",
    path: "/diagnostic/v0/diagnosis-requests",
    input: { type: "object", required: ["case_id", "worker_registration_id", "reproduction_bundle_id",
      "instruction", "expires_at"], additionalProperties: false, properties: {
      case_id: { type: "string", format: "uuid" }, worker_registration_id: { type: "string", format: "uuid" },
      reproduction_bundle_id: { type: "string", format: "uuid" },
      instruction: { type: "string", minLength: 1, maxLength: 8000 }, expires_at: { type: "string" }
    } },
    resultKey: "diagnosis_request", event: ["diagnostic.diagnosis_request.created", "diagnostic.diagnosis_request.reused"],
    issues: ["DIAGNOSIS_SOURCE_MISMATCH", "DIAGNOSIS_INTENT_SCOPE_MISMATCH",
      "DIAGNOSIS_INTENT_CONSTRAINTS_REQUIRED", "DIAGNOSIS_REQUEST_EXPIRY_INVALID"],
    nextOperations: ["diagnostic.diagnosis_workspace.get", "diagnostic.diagnosis_proposal.submit"],
    authorityClass: "authenticated_customer_builder", effectClass: "advisory_request_record"
  }),
  {
    operation_id: "diagnostic.diagnosis_workspace.get", version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Retrieve exact confirmed sources assigned to the authenticated Diagnostic Worker.", visibility: "public",
    authority_class: "authenticated_diagnostic_worker_passport", effect_class: "read_only",
    idempotency: "naturally_idempotent", transport: { method: "GET",
      path: "/diagnostic/v0/diagnosis-requests/{request_id}/workspace" },
    input_schema: { type: "object", required: ["request_id"], additionalProperties: false,
      properties: { request_id: { type: "string", format: "uuid" } } },
    output_schema: { type: "object", required: ["confirmed_failure_specification", "agent_revision",
      "redacted_reproduction_bundle", "trace_references", "authority"] }, supported_modes: ["live"],
    preconditions: ["authenticated_assigned_diagnostic_worker", "active_request"],
    outcomes: ["bounded_workspace_returned"],
    issues: ["AGENT_AUTHENTICATION_REQUIRED", "DIAGNOSIS_WORKER_MISMATCH", "DIAGNOSIS_REQUEST_NOT_ACTIVE"],
    emitted_events: [], next_operations: ["diagnostic.diagnosis_proposal.submit", "diagnostic.diagnosis_request.fail"]
  },
  commandDescriptor({
    operationId: "diagnostic.diagnosis_proposal.submit",
    summary: "Submit one immutable structured advisory diagnosis with exact provenance.",
    path: "/diagnostic/v0/diagnosis-proposals",
    input: { type: "object", required: ["request_id", "diagnosis"], additionalProperties: false, properties: {
      request_id: { type: "string", format: "uuid" },
      diagnosis: { type: "object", required: ["facts", "inferences", "hypotheses", "uncertainties",
        "recommended_investigation", "artifact_references", "provenance"], additionalProperties: false,
        properties: { facts: { type: "array" }, inferences: { type: "array" }, hypotheses: { type: "array" },
          uncertainties: { type: "array" }, recommended_investigation: { type: "array" },
          artifact_references: { type: "array" }, provenance: diagnosisProvenance } }
    } },
    resultKey: "diagnosis_proposal",
    event: ["diagnostic.diagnosis_proposal.submitted", "diagnostic.diagnosis_proposal.reused"],
    issues: ["DIAGNOSIS_WORKER_MISMATCH", "DIAGNOSIS_REQUEST_NOT_ACTIVE", "INVALID_DIAGNOSIS",
      "SENSITIVE_DIAGNOSIS_REJECTED", "DIAGNOSIS_PROVENANCE_MISMATCH"],
    nextOperations: ["diagnostic.diagnosis_proposal.get", "diagnostic.diagnosis_proposal.review"],
    authorityClass: "authenticated_assigned_diagnostic_worker", effectClass: "non_authoritative_advisory_proposal",
    preconditions: ["active_exact_request", "structured_output", "exact_provenance"]
  }),
  commandDescriptor({
    operationId: "diagnostic.diagnosis_request.fail", summary: "Record worker timeout or failure without blocking the Debug Loop.",
    path: "/diagnostic/v0/diagnosis-requests/{request_id}/fail",
    input: { type: "object", required: ["request_id", "reason"], additionalProperties: false,
      properties: { request_id: { type: "string", format: "uuid" }, reason: { type: "string", maxLength: 1000 } } },
    resultKey: "diagnosis_request", event: "diagnostic.diagnosis_request.failed",
    issues: ["DIAGNOSIS_WORKER_MISMATCH", "DIAGNOSIS_REQUEST_NOT_ACTIVE"],
    nextOperations: ["diagnostic.case.get", "diagnostic.repair_task.create"],
    authorityClass: "authenticated_assigned_diagnostic_worker", effectClass: "advisory_failure_record"
  }),
  commandDescriptor({
    operationId: "diagnostic.diagnosis_proposal.review",
    summary: "Accept or reject advisory usefulness without changing truth or authority.",
    path: "/diagnostic/v0/diagnosis-proposals/{proposal_id}/reviews",
    input: { type: "object", required: ["proposal_id", "decision", "rationale"], additionalProperties: false,
      properties: { proposal_id: { type: "string", format: "uuid" }, decision: { enum: ["accepted", "rejected"] },
        rationale: { type: "string", minLength: 1, maxLength: 2000 } } },
    resultKey: "diagnosis_proposal", event: ["diagnostic.diagnosis_proposal.accepted",
      "diagnostic.diagnosis_proposal.rejected"], issues: ["DIAGNOSIS_ALREADY_REVIEWED"],
    nextOperations: ["diagnostic.case.get"], authorityClass: "authenticated_customer_builder",
    effectClass: "advisory_usefulness_review"
  }),
  readDescriptor({ operationId: "diagnostic.diagnosis_request.get", summary: "Inspect one immutable advisory request.",
    path: "/diagnostic/v0/diagnosis-requests/{request_id}", idName: "request_id", resultKey: "diagnosis_request",
    issues: ["DIAGNOSIS_REQUEST_NOT_FOUND"] }),
  readDescriptor({ operationId: "diagnostic.diagnosis_proposal.get", summary: "Inspect one immutable advisory proposal and usefulness review.",
    path: "/diagnostic/v0/diagnosis-proposals/{proposal_id}", idName: "proposal_id", resultKey: "diagnosis_proposal",
    issues: ["DIAGNOSIS_PROPOSAL_NOT_FOUND"] }),
  commandDescriptor({
    operationId: "diagnostic.repair_worker.register",
    summary: "Attach one customer-controlled Repair Worker using its existing Agent Passport and Work Intent.",
    path: "/diagnostic/v0/repair-workers",
    input: {
      type: "object", required: ["passport_id", "work_intent_id", "protocol_version", "runtime_attribution"],
      additionalProperties: false,
      properties: {
        passport_id: { type: "string", format: "uuid" },
        work_intent_id: { type: "string", format: "uuid" },
        protocol_version: { const: "0.2.0" },
        runtime_attribution: workerRuntimeAttribution
      }
    },
    resultKey: "repair_worker",
    event: ["diagnostic.repair_worker.registered", "diagnostic.repair_worker.reused"],
    issues: ["AGENT_AUTHENTICATION_REQUIRED", "PASSPORT_INTENT_MISMATCH", "REPAIR_INTENT_REQUIRED",
      "REPAIR_WORKER_NOT_DISTINCT"],
    nextOperations: ["diagnostic.repair_task.discover"],
    authorityClass: "authenticated_repair_worker_passport",
    preconditions: ["diagnostic_plane_available", "authenticated_repair_worker", "confirmed_repair_work_intent"]
  }),
  commandDescriptor({
    operationId: "diagnostic.repair_task.create",
    summary: "Create one immutable bounded Repair Task attempt from a demonstrated reproduction.",
    path: "/diagnostic/v0/repair-tasks",
    input: {
      type: "object",
      required: ["case_id", "worker_registration_id", "reproduction_bundle_id", "allowed_operations",
        "artifact_limits", "lease_duration_seconds", "expected_outputs"],
      additionalProperties: false,
      properties: {
        case_id: { type: "string", format: "uuid" },
        worker_registration_id: { type: "string", format: "uuid" },
        reproduction_bundle_id: { type: "string", format: "uuid" },
        allowed_operations: { type: "array", minItems: 2, maxItems: 10, items: { type: "string" } },
        artifact_limits: repairArtifactLimits,
        lease_duration_seconds: { type: "integer", minimum: 5, maximum: 3600 },
        expected_outputs: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } }
      }
    },
    resultKey: "repair_task",
    event: "diagnostic.repair_task.created",
    issues: ["REPAIR_TASK_INPUT_MISMATCH", "ACTIVE_REPAIR_TASK_EXISTS", "REPRODUCTION_BUNDLE_RETIRED",
      "REPAIR_INTENT_SCOPE_MISMATCH", "REPAIR_INTENT_CONSTRAINTS_REQUIRED"],
    nextOperations: ["diagnostic.repair_task.get", "diagnostic.repair_task.discover"],
    authorityClass: "authenticated_customer_repair_commissioner"
  }),
  {
    operation_id: "diagnostic.repair_task.discover",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Discover available or currently leased Repair Tasks assigned to the authenticated worker.",
    visibility: "public",
    authority_class: "authenticated_repair_worker_passport",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/diagnostic/v0/repair-tasks" },
    input_schema: { type: "object", additionalProperties: false },
    output_schema: { type: "object", required: ["repair_tasks", "authority"] },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available", "authenticated_repair_worker", "worker_registered"],
    outcomes: ["active_tasks_returned"],
    issues: ["AGENT_AUTHENTICATION_REQUIRED", "REPAIR_WORKER_NOT_REGISTERED"],
    emitted_events: [],
    next_operations: ["diagnostic.repair_task.claim"]
  },
  commandDescriptor({
    operationId: "diagnostic.repair_task.claim",
    summary: "Claim one available Repair Task under its exact worker identity and lease epoch.",
    path: "/diagnostic/v0/repair-tasks/{task_id}/claim",
    input: repairTaskReference,
    resultKey: "repair_task",
    event: "diagnostic.repair_task.leased",
    issues: ["REPAIR_TASK_NOT_FOUND", "REPAIR_TASK_WORKER_MISMATCH", "REPAIR_TASK_LEASE_CONFLICT"],
    nextOperations: ["diagnostic.repair_workspace_artifact.get", "diagnostic.repair_task.heartbeat",
      "diagnostic.repair_candidate.submit", "diagnostic.repair_task.fail", "diagnostic.repair_task.release"],
    authorityClass: "authenticated_repair_worker_passport",
    preconditions: ["authenticated_repair_worker", "task_available", "passport_current"]
  }),
  commandDescriptor({
    operationId: "diagnostic.repair_task.heartbeat",
    summary: "Renew one live Repair Task lease without expanding its scope.",
    path: "/diagnostic/v0/repair-tasks/{task_id}/heartbeat",
    input: leasedRepairTaskInput(["status_note"], {
      status_note: { type: "string", minLength: 1, maxLength: 500 }
    }),
    resultKey: "repair_task",
    event: "diagnostic.repair_task.heartbeat",
    issues: ["LEASE_EPOCH_FENCED", "LEASE_EXPIRED", "LEASE_NOT_ACTIVE"],
    nextOperations: ["diagnostic.repair_candidate.submit", "diagnostic.repair_task.fail", "diagnostic.repair_task.release"],
    authorityClass: "authenticated_repair_worker_passport",
    preconditions: ["authenticated_repair_worker", "live_matching_lease"]
  }),
  {
    operation_id: "diagnostic.repair_workspace_artifact.get",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Retrieve one exact task-bound workspace artifact under a live worker lease.",
    visibility: "public",
    authority_class: "authenticated_repair_worker_live_lease",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/diagnostic/v0/repair-tasks/{task_id}/artifacts/{artifact_digest}" },
    input_schema: { type: "object", required: ["task_id", "artifact_digest"], additionalProperties: false },
    output_schema: { type: "object", required: ["artifact"] },
    supported_modes: ["live"],
    preconditions: ["authenticated_repair_worker", "live_matching_lease", "artifact_bound_to_task"],
    outcomes: ["verified_artifact_returned"],
    issues: ["LEASE_EXPIRED", "REPAIR_ARTIFACT_SCOPE_DENIED", "REPAIR_ARTIFACT_UNAVAILABLE"],
    emitted_events: [],
    next_operations: ["diagnostic.repair_candidate.submit"]
  },
  commandDescriptor({
    operationId: "diagnostic.repair_candidate.submit",
    summary: "Submit one immutable candidate, regression, logs, attribution, and hashes from a live lease.",
    path: "/diagnostic/v0/repair-candidates",
    input: leasedRepairTaskInput(["output"], {
      output: {
        type: "object",
        required: ["intended_behavior_change", "candidate_artifact", "targeted_regression_artifact",
          "logs_artifact", "runtime_attribution"],
        additionalProperties: false,
        properties: {
          intended_behavior_change: { type: "string", minLength: 1, maxLength: 2000 },
          candidate_artifact: { type: "object", required: ["media_type", "content"], additionalProperties: false },
          targeted_regression_artifact: { type: "object", required: ["media_type", "content"], additionalProperties: false },
          logs_artifact: { type: "object", required: ["media_type", "content"], additionalProperties: false },
          runtime_attribution: workerRuntimeAttribution
        }
      }
    }),
    resultKey: "repair_candidate",
    event: ["diagnostic.repair_candidate.submitted", "diagnostic.repair_candidate.reused",
      "diagnostic.repair_task.failed"],
    issues: ["LEASE_EPOCH_FENCED", "LEASE_EXPIRED", "REPAIR_CANDIDATE_CONFLICT",
      "REPAIR_ARTIFACT_LIMIT_EXCEEDED", "SENSITIVE_WORKER_OUTPUT_REJECTED", "RUNTIME_ATTRIBUTION_MISMATCH"],
    nextOperations: ["diagnostic.repair_candidate.get", "diagnostic.case.get"],
    authorityClass: "authenticated_repair_worker_live_lease",
    preconditions: ["authenticated_repair_worker", "live_matching_lease", "output_within_task_bounds"],
    outcomes: ["repair_candidate_created", "repair_candidate_reused", "invalid_output_attempt_preserved", "command_replayed"]
  }),
  commandDescriptor({
    operationId: "diagnostic.repair_task.fail",
    summary: "Preserve one visible worker failure and terminate its lease.",
    path: "/diagnostic/v0/repair-tasks/{task_id}/fail",
    input: leasedRepairTaskInput(["failure_type", "summary"], {
      failure_type: { enum: ["timeout", "process_loss", "worker_error", "invalid_output"] },
      summary: { type: "string", minLength: 1, maxLength: 500 }
    }),
    resultKey: "repair_task",
    event: "diagnostic.repair_task.failed",
    issues: ["LEASE_EPOCH_FENCED", "LEASE_EXPIRED", "LEASE_NOT_ACTIVE"],
    nextOperations: ["diagnostic.repair_task.create", "diagnostic.case.get"],
    authorityClass: "authenticated_repair_worker_live_lease",
    preconditions: ["authenticated_repair_worker", "live_matching_lease"]
  }),
  commandDescriptor({
    operationId: "diagnostic.repair_task.release",
    summary: "Release one live worker lease and fence later submission from that attempt.",
    path: "/diagnostic/v0/repair-tasks/{task_id}/release",
    input: leasedRepairTaskInput(["reason"], { reason: { type: "string", minLength: 1, maxLength: 500 } }),
    resultKey: "repair_task",
    event: "diagnostic.repair_task.released",
    issues: ["LEASE_EPOCH_FENCED", "LEASE_EXPIRED", "LEASE_NOT_ACTIVE"],
    nextOperations: ["diagnostic.repair_task.create", "diagnostic.case.get"],
    authorityClass: "authenticated_repair_worker_live_lease",
    preconditions: ["authenticated_repair_worker", "live_matching_lease"]
  }),
  commandDescriptor({
    operationId: "diagnostic.repair_task.cancel",
    summary: "Cancel one available or leased Repair Task under customer authority.",
    path: "/diagnostic/v0/repair-tasks/{task_id}/cancel",
    input: {
      type: "object", required: ["task_id", "reason"], additionalProperties: false,
      properties: { task_id: { type: "string", format: "uuid" },
        reason: { type: "string", minLength: 1, maxLength: 500 } }
    },
    resultKey: "repair_task",
    event: "diagnostic.repair_task.cancelled",
    issues: ["REPAIR_TASK_NOT_CANCELLABLE"],
    nextOperations: ["diagnostic.repair_task.create", "diagnostic.case.get"],
    authorityClass: "authenticated_customer_repair_commissioner"
  }),
  readDescriptor({
    operationId: "diagnostic.repair_task.get",
    summary: "Inspect one immutable Repair Task and its append-only lease attempt.",
    path: "/diagnostic/v0/repair-tasks/{task_id}",
    idName: "task_id",
    resultKey: "repair_task",
    issues: ["REPAIR_TASK_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.repair_candidate.get",
    summary: "Inspect one immutable Repair Candidate and exact artifact hashes.",
    path: "/diagnostic/v0/repair-candidates/{candidate_id}",
    idName: "candidate_id",
    resultKey: "repair_candidate",
    issues: ["REPAIR_CANDIDATE_NOT_FOUND"]
  }),
  commandDescriptor({
    operationId: "diagnostic.repair_delivery_binding.register",
    summary: "Register one secret-free exact Repair Delivery Adapter binding.",
    path: "/diagnostic/v0/repair-delivery-bindings",
    input: {
      type: "object",
      required: ["binding_id", "adapter", "target", "external_credential_binding_ref",
        "permitted_operations", "transition_policy"],
      additionalProperties: false,
      properties: {
        binding_id: { type: "string", format: "uuid" },
        adapter: { type: "object", required: ["adapter_id", "adapter_version"], additionalProperties: false },
        target: { type: "object", required: ["system", "target_type", "target_id", "environment"],
          additionalProperties: false },
        external_credential_binding_ref: { type: "string", minLength: 1, maxLength: 300 },
        permitted_operations: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
        transition_policy: { type: "object", required: ["candidate_initial_state",
          "require_expected_base_revision", "preserve_prechange_snapshot", "promotion_authority"],
        additionalProperties: false }
      }
    },
    resultKey: "repair_delivery_binding",
    event: ["diagnostic.repair_delivery_binding.registered", "diagnostic.repair_delivery_binding.reused"],
    issues: ["REPAIR_DELIVERY_ADAPTER_MISMATCH", "REPAIR_DELIVERY_OPERATION_UNAVAILABLE",
      "REPAIR_DELIVERY_BINDING_CONFLICT"],
    nextOperations: ["diagnostic.repair_delivery_binding.get", "diagnostic.repair_delivery_target.inspect"],
    authorityClass: "authenticated_customer_integration_operator"
  }),
  readDescriptor({
    operationId: "diagnostic.repair_delivery_binding.get",
    summary: "Inspect one immutable secret-free Repair Delivery Binding.",
    path: "/diagnostic/v0/repair-delivery-bindings/{binding_id}",
    idName: "binding_id",
    resultKey: "repair_delivery_binding",
    issues: ["REPAIR_DELIVERY_BINDING_NOT_FOUND"],
    nextOperations: ["diagnostic.repair_delivery_target.inspect"]
  }),
  readDescriptor({
    operationId: "diagnostic.repair_delivery_target.inspect",
    summary: "Resolve the exact current target revision through the selected read-only adapter operation.",
    path: "/diagnostic/v0/repair-delivery-bindings/{binding_id}/target",
    idName: "binding_id",
    resultKey: "target",
    issues: ["REPAIR_DELIVERY_BINDING_NOT_FOUND", "REPAIR_DELIVERY_ADAPTER_UNAVAILABLE"],
    nextOperations: ["diagnostic.repair_delivery.materialize"]
  }),
  commandDescriptor({
    operationId: "diagnostic.repair_delivery.materialize",
    summary: "Materialize one exact inactive target-native candidate behind an expected-base fence.",
    path: "/diagnostic/v0/repair-deliveries",
    input: {
      type: "object",
      required: ["candidate_id", "binding_id", "expected_base_revision_digest", "idempotency_key"],
      additionalProperties: false,
      properties: {
        candidate_id: { type: "string", format: "uuid" },
        binding_id: { type: "string", format: "uuid" },
        expected_base_revision_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        idempotency_key: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    resultKey: "repair_delivery",
    event: ["diagnostic.repair_delivery.materialized", "diagnostic.repair_delivery.reused"],
    issues: ["REPAIR_TARGET_DRIFT", "REPAIR_DELIVERY_CONFLICT", "ACTIVE_REPAIR_TARGET_MUTATED",
      "REPAIR_CANDIDATE_NOT_DELIVERABLE", "REPAIR_CANDIDATE_NOT_INACTIVE"],
    nextOperations: ["diagnostic.repair_delivery.get", "diagnostic.repair_verification.create"],
    authorityClass: "authenticated_customer_repair_delivery_operator",
    effectClass: "external_inactive_candidate_creation",
    preconditions: ["proposed_repair_candidate", "exact_delivery_binding", "unchanged_expected_target_base"]
  }),
  readDescriptor({
    operationId: "diagnostic.repair_delivery.get",
    summary: "Inspect exact base, inactive target candidate, retained artifacts, receipt, and next operation.",
    path: "/diagnostic/v0/repair-deliveries/{delivery_id}",
    idName: "delivery_id",
    resultKey: "repair_delivery",
    issues: ["REPAIR_DELIVERY_NOT_FOUND"]
  }),
  commandDescriptor({
    operationId: "diagnostic.repair_verification.create",
    summary: "Independently execute the exact original and inactive candidate and retain one signed result.",
    path: "/diagnostic/v0/repair-verifications",
    input: {
      type: "object",
      required: ["candidate_id", "delivery_id", "idempotency_key"],
      additionalProperties: false,
      properties: {
        candidate_id: { type: "string", format: "uuid" },
        delivery_id: { type: "string", format: "uuid" },
        idempotency_key: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    resultKey: "repair_verification",
    event: ["diagnostic.repair_verification.passed", "diagnostic.repair_verification.failed",
      "diagnostic.repair_verification.reused"],
    issues: ["VERIFICATION_RUNNER_UNAVAILABLE", "VERIFICATION_SOURCE_MISMATCH",
      "VERIFICATION_ARTIFACT_DIGEST_MISMATCH", "VERIFICATION_IDEMPOTENCY_CONFLICT"],
    nextOperations: ["diagnostic.repair_verification.get", "diagnostic.promotion.authorize",
      "diagnostic.repair_task.create"],
    authorityClass: "authenticated_customer_verification_requester",
    effectClass: "diagnostic_state_transition",
    preconditions: ["exact_inactive_candidate", "verified_immutable_artifacts", "independent_runner"]
  }),
  readDescriptor({
    operationId: "diagnostic.repair_verification.get",
    summary: "Inspect one immutable signed Verification Receipt, outcomes, evidence, and eligibility.",
    path: "/diagnostic/v0/repair-verifications/{verification_id}",
    idName: "verification_id",
    resultKey: "repair_verification",
    issues: ["VERIFICATION_RECEIPT_NOT_FOUND"]
  }),
  commandDescriptor({
    operationId: "diagnostic.promotion.authorize",
    summary: "Authorize one exact verified candidate for promotion through customer Owner authority.",
    path: "/diagnostic/v0/promotions",
    input: {
      type: "object",
      required: ["candidate_id", "verification_id", "expected_target_revision_digest", "idempotency_key"],
      additionalProperties: false,
      properties: {
        candidate_id: { type: "string", format: "uuid" },
        verification_id: { type: "string", format: "uuid" },
        expected_target_revision_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        idempotency_key: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    resultKey: "promotion",
    event: ["diagnostic.promotion.authorized", "diagnostic.promotion.authorization_reused"],
    issues: ["OWNER_AUTHORITY_REQUIRED", "PROMOTION_CANDIDATE_NOT_VERIFIED",
      "PROMOTION_VERIFICATION_ARTIFACT_MISMATCH", "PROMOTION_IDEMPOTENCY_CONFLICT", "REPAIR_TARGET_DRIFT"],
    nextOperations: ["diagnostic.promotion.get", "diagnostic.promotion.apply"],
    authorityClass: "authenticated_customer_owner",
    effectClass: "promotion_authorization_record",
    preconditions: ["current_verified_candidate", "passing_exact_verification_receipt", "unchanged_target_base"]
  }),
  commandDescriptor({
    operationId: "diagnostic.promotion.apply",
    summary: "Apply one Owner-authorized candidate once and confirm the exact resulting target revision.",
    path: "/diagnostic/v0/promotions/{promotion_id}/apply",
    input: {
      type: "object",
      required: ["promotion_id", "idempotency_key"],
      additionalProperties: false,
      properties: {
        promotion_id: { type: "string", format: "uuid" },
        idempotency_key: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    resultKey: "promotion",
    event: ["diagnostic.promotion.application_requested", "diagnostic.promotion.applying",
      "diagnostic.promotion.confirmed", "diagnostic.promotion.uncertain",
      "diagnostic.promotion.application_reused"],
    issues: ["OWNER_AUTHORITY_REQUIRED", "PROMOTION_NOT_AUTHORIZED",
      "PROMOTION_APPLY_IDEMPOTENCY_CONFLICT", "REPAIR_TARGET_DRIFT", "PROMOTION_NOT_CONFIRMED",
      "REPAIR_PROMOTION_RESULT_UNCERTAIN"],
    nextOperations: ["diagnostic.promotion.get", "diagnostic.promotion.reconcile",
      "diagnostic.promotion.rollback", "diagnostic.case.get"],
    authorityClass: "authenticated_customer_owner",
    effectClass: "owner_authorized_target_change",
    preconditions: ["durable_owner_authorization", "rollback_snapshot_before_request", "unchanged_target_base"]
  }),
  commandDescriptor({
    operationId: "diagnostic.promotion.reconcile",
    summary: "Read the target once to resolve an uncertain Promotion without redispatching it.",
    path: "/diagnostic/v0/promotions/{promotion_id}/reconcile",
    input: {
      type: "object",
      required: ["promotion_id", "idempotency_key"],
      additionalProperties: false,
      properties: {
        promotion_id: { type: "string", format: "uuid" },
        idempotency_key: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    resultKey: "promotion",
    event: ["diagnostic.promotion.confirmed", "diagnostic.promotion.failed",
      "diagnostic.promotion.target_mismatch", "diagnostic.promotion.reconciliation_reused"],
    issues: ["OWNER_AUTHORITY_REQUIRED", "PROMOTION_NOT_UNCERTAIN",
      "PROMOTION_RECONCILIATION_IDEMPOTENCY_CONFLICT", "REPAIR_CANDIDATE_TARGET_DRIFT"],
    nextOperations: ["diagnostic.promotion.get", "diagnostic.promotion.rollback",
      "diagnostic.case.get"],
    authorityClass: "authenticated_customer_owner",
    effectClass: "read_only_external_reconciliation",
    preconditions: ["uncertain_promotion", "preserved_request_receipt", "read_only_target_inspection"]
  }),
  commandDescriptor({
    operationId: "diagnostic.promotion.rollback",
    summary: "Owner-authorize one exact rollback and confirm the restored target revision.",
    path: "/diagnostic/v0/promotions/{promotion_id}/rollback",
    input: {
      type: "object",
      required: ["promotion_id", "expected_target_revision_digest", "idempotency_key"],
      additionalProperties: false,
      properties: {
        promotion_id: { type: "string", format: "uuid" },
        expected_target_revision_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        idempotency_key: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    resultKey: "promotion",
    event: ["diagnostic.promotion.rollback_authorized", "diagnostic.promotion.rolled_back",
      "diagnostic.promotion.rollback_reused"],
    issues: ["OWNER_AUTHORITY_REQUIRED", "PROMOTION_NOT_CONFIRMED",
      "PROMOTION_ROLLBACK_PRECONDITION_MISMATCH", "PROMOTION_ROLLBACK_IDEMPOTENCY_CONFLICT",
      "REPAIR_TARGET_DRIFT", "PROMOTION_ROLLBACK_ARTIFACT_INVALID"],
    nextOperations: ["diagnostic.promotion.get", "diagnostic.case.get"],
    authorityClass: "authenticated_customer_owner",
    effectClass: "owner_authorized_target_rollback",
    preconditions: ["confirmed_promotion", "exact_current_target_revision", "immutable_rollback_snapshot"]
  }),
  readDescriptor({
    operationId: "diagnostic.promotion.get",
    summary: "Inspect Owner authorization, application request, confirmation, rollback reference, and history.",
    path: "/diagnostic/v0/promotions/{promotion_id}",
    idName: "promotion_id",
    resultKey: "promotion",
    issues: ["PROMOTION_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.case.get",
    summary: "Inspect one Diagnostic Case projection, immutable evidence links, attempts, and legal next operations.",
    path: "/diagnostic/v0/cases/{case_id}",
    idName: "case_id",
    resultKey: "diagnostic_case",
    issues: ["DIAGNOSTIC_CASE_NOT_FOUND"]
  }),
  commandDescriptor({
    operationId: "diagnostic.artifact.retire",
    summary: "Delete selected Reproduction Bundle bytes while preserving an immutable identity tombstone.",
    path: "/diagnostic/v0/artifact-retirements",
    input: {
      type: "object", required: ["artifact_digest", "reason"], additionalProperties: false,
      properties: {
        artifact_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        reason: { type: "string", minLength: 1, maxLength: 500 }
      }
    },
    resultKey: "artifact_tombstone",
    event: ["diagnostic.artifact.bytes_retired", "diagnostic.artifact.tombstone_reused"],
    issues: ["RETIRABLE_ARTIFACT_NOT_FOUND", "ARTIFACT_NOT_FOUND"],
    nextOperations: ["diagnostic.artifact.get", "diagnostic.case.get"],
    authorityClass: "authenticated_customer_retention_operator",
    effectClass: "diagnostic_payload_retention"
  })
];

export function listDiagnosticOperationDescriptors() {
  return structuredClone(descriptors);
}

export function getDiagnosticOperationDescriptor(operationId) {
  const descriptor = descriptors.find((item) => item.operation_id === operationId);
  return descriptor ? structuredClone(descriptor) : null;
}
