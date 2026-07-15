import { KernelError } from "./errors.js";

export const WORKFLOW_RUNTIME_ADAPTER_CONTRACT_VERSION = "0.2.0";

const objectSchema = (required, properties = {}) => ({
  type: "object",
  required,
  additionalProperties: false,
  properties
});

const CAPABILITIES = Object.freeze({
  workflow_identity: {
    requirement: "required",
    purpose: "Describe one stable provider-neutral external workflow identity.",
    operation: {
      operation_id: "runtime_adapter.workflow_identity.describe",
      direction: "alphonse_to_adapter",
      input_schema: objectSchema(["external_workflow_reference"], {
        external_workflow_reference: { type: "string", minLength: 1, maxLength: 500 }
      }),
      output_schema: objectSchema(["display_name", "objective", "external_reference"], {
        display_name: { type: "string" },
        objective: { type: "string" },
        external_reference: { type: "object" }
      })
    }
  },
  revision_identity: {
    requirement: "required",
    purpose: "Resolve exact behavior-bearing revision material and fingerprints.",
    operation: {
      operation_id: "runtime_adapter.revision_identity.resolve",
      direction: "alphonse_to_adapter",
      input_schema: objectSchema(["workflow_id", "external_revision_reference"], {
        workflow_id: { type: "string" },
        external_revision_reference: { type: "string" }
      }),
      output_schema: objectSchema([
        "workflow_content", "runtime", "nodes", "model", "configuration", "adapter_fingerprint"
      ])
    }
  },
  event_receipt: {
    requirement: "required",
    purpose: "Submit signed minimal Runtime Event Envelopes and receive immutable receipts.",
    operation: {
      operation_id: "diagnostic.runtime_event.receive",
      direction: "adapter_to_alphonse",
      input_schema: { $ref: "diagnostic://schemas/runtime-event-envelope/0.2.0" },
      output_schema: objectSchema(["receipt_id", "trace_id", "envelope_digest", "accepted_at"])
    }
  },
  detail_retrieval: {
    requirement: "optional",
    purpose: "Retrieve explicitly requested execution detail without direct runtime database access.",
    operation: {
      operation_id: "runtime_adapter.execution_detail.retrieve",
      direction: "alphonse_to_adapter",
      input_schema: objectSchema(["external_execution_id", "payload_reference", "requested_fields"], {
        external_execution_id: { type: "string" },
        payload_reference: { type: "string" },
        requested_fields: { type: "array", items: { type: "string" } }
      }),
      output_schema: objectSchema(["artifact_digest", "redaction_applied", "omitted_fields"], {
        artifact_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        redaction_applied: { type: "boolean" },
        omitted_fields: { type: "array", items: { type: "string" } }
      })
    }
  },
  replay: {
    requirement: "optional",
    purpose: "Request only replay modes explicitly supported by the external runtime.",
    operation: {
      operation_id: "runtime_adapter.execution.replay",
      direction: "alphonse_to_adapter",
      input_schema: objectSchema(["workflow_id", "revision_id", "replay_mode", "bundle_digest"], {
        workflow_id: { type: "string" },
        revision_id: { type: "string", format: "uuid" },
        replay_mode: { type: "string" },
        bundle_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
      }),
      output_schema: objectSchema(["accepted", "external_execution_id"], {
        accepted: { type: "boolean" },
        external_execution_id: { type: ["string", "null"] }
      })
    }
  },
  health: {
    requirement: "required",
    purpose: "Report bounded adapter and external runtime reachability.",
    operation: {
      operation_id: "runtime_adapter.health.get",
      direction: "alphonse_to_adapter",
      input_schema: objectSchema([]),
      output_schema: objectSchema(["status", "observed_at", "issues"], {
        status: { enum: ["healthy", "degraded", "unavailable", "unknown"] },
        observed_at: { type: "string", format: "date-time" },
        issues: { type: "array", items: { type: "string" } }
      })
    }
  }
});

const CONTRACT = Object.freeze({
  contract_name: "alphonse-workflow-runtime-adapter",
  contract_version: WORKFLOW_RUNTIME_ADAPTER_CONTRACT_VERSION,
  provider_neutral: true,
  custody: {
    provider_credentials: "external_runtime_only",
    routine_business_payloads: "prohibited",
    direct_runtime_database_access: "prohibited"
  },
  authority: {
    kernel_run_admission: "not_granted",
    execution_authority: "not_granted",
    effect_evidence: "not_trusted"
  },
  capabilities: CAPABILITIES
});

function fail(code, message) {
  throw new KernelError(400, code, message);
}

function exact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_RUNTIME_ADAPTER_MANIFEST", `${label} must be an object.`);
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    fail("INVALID_RUNTIME_ADAPTER_MANIFEST", `${label} fields must be exact.`);
  }
  return value;
}

function string(value, label, maximum) {
  if (typeof value !== "string" || !value || value.length > maximum
      || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    fail("INVALID_RUNTIME_ADAPTER_MANIFEST", `${label} is invalid.`);
  }
  return value;
}

export function getWorkflowRuntimeAdapterContract() {
  return structuredClone(CONTRACT);
}

export function assertWorkflowRuntimeAdapterManifest(value) {
  exact(value, ["adapter_id", "adapter_version", "contract_version", "capabilities"], "manifest");
  if (value.contract_version !== WORKFLOW_RUNTIME_ADAPTER_CONTRACT_VERSION) {
    fail("RUNTIME_ADAPTER_CONTRACT_UNSUPPORTED", `contract_version must be ${WORKFLOW_RUNTIME_ADAPTER_CONTRACT_VERSION}.`);
  }
  exact(value.capabilities, Object.keys(CAPABILITIES), "capabilities");
  for (const [name, definition] of Object.entries(CAPABILITIES)) {
    const capability = exact(value.capabilities[name], ["supported"], `capabilities.${name}`);
    if (typeof capability.supported !== "boolean") {
      fail("INVALID_RUNTIME_ADAPTER_MANIFEST", `capabilities.${name}.supported must be boolean.`);
    }
    if (definition.requirement === "required" && !capability.supported) {
      fail("RUNTIME_ADAPTER_CAPABILITY_REQUIRED", `${name} is required by the adapter contract.`);
    }
  }
  string(value.adapter_id, "adapter_id", 160);
  string(value.adapter_version, "adapter_version", 100);
  return structuredClone(value);
}
