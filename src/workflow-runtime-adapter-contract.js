import { KernelError } from "./errors.js";

export const WORKFLOW_RUNTIME_ADAPTER_CONTRACT_VERSION = "0.4.0";

const objectSchema = (required, properties = {}) => ({
  type: "object",
  required,
  additionalProperties: false,
  properties
});

const CAPABILITIES = Object.freeze({
  workflow_inventory: {
    requirement: "required",
    purpose: "List credential-scoped external workflow candidates as typed untrusted metadata without granting coverage or authority.",
    operation: {
      operation_id: "runtime_adapter.workflow_inventory.list",
      direction: "alphonse_to_adapter",
      input_schema: objectSchema(["scope_id", "page_size", "cursor"], {
        scope_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$" },
        page_size: { type: "integer", minimum: 1, maximum: 250 },
        cursor: { type: ["string", "null"], maxLength: 4096 }
      }),
      output_schema: objectSchema([
        "schema_version", "scope", "candidates", "page", "omissions", "health", "authority"
      ], {
        schema_version: { const: "alphonse.workflow-inventory-page.v0.1" },
        scope: objectSchema(["scope_id", "provider", "environment", "scope_basis", "scope_digest"], {
          scope_id: { type: "string", minLength: 3, maxLength: 160 },
          provider: { type: "string", minLength: 1, maxLength: 80 },
          environment: { type: "string", minLength: 1, maxLength: 80 },
          scope_basis: { enum: ["credential_access", "project", "workflow_allowlist"] },
          scope_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
        }),
        candidates: {
          type: "array",
          maxItems: 250,
          items: objectSchema([
            "provider_workflow_id", "display_name", "active", "created_at", "updated_at",
            "provider_revision_reference", "tags", "metadata_digest", "content_class",
            "instruction_authority", "omitted_fields"
          ], {
            provider_workflow_id: { type: "string", minLength: 1, maxLength: 200 },
            display_name: { type: "string", minLength: 1, maxLength: 240 },
            active: { type: "boolean" },
            created_at: { type: ["string", "null"], format: "date-time" },
            updated_at: { type: ["string", "null"], format: "date-time" },
            provider_revision_reference: { type: ["string", "null"], maxLength: 240 },
            tags: {
              type: "array",
              maxItems: 100,
              items: objectSchema(["id", "name", "content_class", "instruction_authority"], {
                id: { type: "string", minLength: 1, maxLength: 200 },
                name: { type: "string", minLength: 1, maxLength: 200 },
                content_class: { const: "untrusted_provider_metadata" },
                instruction_authority: { const: "none" }
              })
            },
            metadata_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
            content_class: { const: "untrusted_provider_metadata" },
            instruction_authority: { const: "none" },
            omitted_fields: {
              type: "array",
              maxItems: 7,
              items: {
                enum: ["nodes", "connections", "settings", "credentials", "notes", "staticData", "pinData"]
              }
            }
          })
        },
        page: objectSchema([
          "current_cursor", "next_cursor", "item_count", "scope_complete", "source_cutoff", "page_digest"
        ], {
          current_cursor: { type: ["string", "null"], maxLength: 4096 },
          next_cursor: { type: ["string", "null"], maxLength: 4096 },
          item_count: { type: "integer", minimum: 0, maximum: 250 },
          scope_complete: { type: "boolean" },
          source_cutoff: { type: "string", format: "date-time" },
          page_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
        }),
        omissions: {
          type: "array",
          maxItems: 300,
          items: objectSchema(["code", "count", "fields"], {
            code: {
              enum: [
                "WORKFLOW_CONTENT_EXCLUDED",
                "OUTSIDE_CONFIGURED_SCOPE",
                "INVALID_PROVIDER_METADATA",
                "PROVIDER_REVISION_REFERENCE_UNAVAILABLE"
              ]
            },
            count: { type: "integer", minimum: 0, maximum: 1000000 },
            fields: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 100 } }
          })
        },
        health: objectSchema(["status", "observed_at", "issues"], {
          status: { enum: ["healthy", "degraded", "unavailable", "unknown"] },
          observed_at: { type: "string", format: "date-time" },
          issues: { type: "array", maxItems: 100, items: { type: "string", maxLength: 500 } }
        }),
        authority: { const: "none" }
      })
    }
  },
  execution_history: {
    requirement: "required",
    purpose: "Walk credential-scoped retained execution history with a workflow-, cutoff-, and page-bound cursor while preserving run class, gaps, and revision evidence.",
    operation: {
      operation_id: "runtime_adapter.execution_history.list",
      direction: "alphonse_to_adapter",
      input_schema: objectSchema(["scope_id", "provider_workflow_id", "page_size", "cursor"], {
        scope_id: { type: "string", minLength: 3, maxLength: 160 },
        provider_workflow_id: { type: "string", minLength: 1, maxLength: 200 },
        page_size: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: ["string", "null"], maxLength: 4096 }
      }),
      output_schema: objectSchema([
        "schema_version", "scope", "executions", "page", "omissions", "health",
        "completeness", "authority"
      ], {
        schema_version: { const: "alphonse.workflow-execution-history-page.v0.1" },
        scope: objectSchema(["scope_id", "provider", "environment", "provider_workflow_id",
          "scope_digest"]),
        executions: { type: "array", maxItems: 100, items: objectSchema([
          "provider_execution_id", "provider_workflow_id", "provider_status", "execution_class",
          "provider_mode", "retry_of", "retry_success_id", "started_at", "stopped_at",
          "wait_until", "revision", "observation_digest", "authority"
        ], {
          provider_status: { enum: ["success", "error", "crashed", "canceled", "new", "running", "waiting"] },
          execution_class: { enum: ["production", "retry", "manual", "test", "unknown"] },
          revision: objectSchema(["status", "provider_workflow_version_id",
            "execution_workflow_material_digest", "binding_digest"], {
            status: { enum: ["matched", "mismatched", "unavailable"] }
          }),
          observation_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
          authority: { const: "none" }
        }) },
        page: objectSchema(["current_cursor", "next_cursor", "page_index", "item_count",
          "scope_complete", "source_cutoff", "page_digest"]),
        omissions: { type: "array" },
        health: objectSchema(["status", "observed_at", "issues"]),
        completeness: objectSchema(["basis", "embedded_signals_are_completeness_proof",
          "provider_retention_and_deletion_visible_as_limitations"], {
          basis: { const: "credential_scoped_public_api_cursor_walk" },
          embedded_signals_are_completeness_proof: { const: false },
          provider_retention_and_deletion_visible_as_limitations: { const: true }
        }),
        authority: { const: "none" }
      })
    }
  },
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
        payload_reference: { type: ["string", "null"] },
        requested_fields: { type: "array", items: { type: "string" } }
      }),
      output_schema: objectSchema(["external_execution_id", "detail", "omitted_fields"], {
        external_execution_id: { type: "string" },
        detail: { type: "object" },
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
