export const PROTOCOL_VERSION = "0.1.0";

const emptyInputSchema = { type: "object", additionalProperties: false };
const environmentOutputSchema = {
  type: "object",
  required: ["installation_id", "environment_id", "display_name", "revision", "created_at", "updated_at"],
  properties: {
    installation_id: { type: "string", format: "uuid" },
    environment_id: { type: "string", format: "uuid" },
    display_name: { type: "string" },
    revision: { type: "string", pattern: "^[0-9]+$" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" }
  }
};
const operationDescriptorOutputSchema = {
  type: "object",
  required: ["operation_id", "version", "summary", "visibility", "authority_class", "effect_class",
    "idempotency", "transport", "input_schema", "output_schema", "supported_modes", "preconditions",
    "outcomes", "issues", "emitted_events", "next_operations"],
  properties: {
    operation_id: { type: "string" },
    version: { type: "string" },
    summary: { type: "string" },
    visibility: { type: "string" },
    authority_class: { type: "string" },
    effect_class: { type: "string" },
    idempotency: { type: "string" },
    transport: { type: "object", required: ["method", "path"] },
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    supported_modes: { type: "array", items: { type: "string" } },
    preconditions: { type: "array", items: { type: "string" } },
    outcomes: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { type: "string" } },
    emitted_events: { type: "array", items: { type: "string" } },
    next_operations: { type: "array", items: { type: "string" } }
  }
};

const descriptors = [
  {
    operation_id: "kernel.protocol.bootstrap.get",
    version: "0.1.0",
    summary: "Discover Kernel health, environment identity, and public operations.",
    visibility: "public",
    authority_class: "none",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/bootstrap" },
    input_schema: emptyInputSchema,
    output_schema: {
      type: "object",
      required: ["status", "protocol", "environment", "operations", "butler"],
      properties: {
        status: { const: "healthy" },
        protocol: { type: "object", required: ["name", "version", "discovery"] },
        environment: environmentOutputSchema,
        operations: { type: "array", items: operationDescriptorOutputSchema },
        butler: { type: "object", required: ["overview", "shell"] }
      }
    },
    supported_modes: ["live"],
    preconditions: [],
    outcomes: ["bootstrap_returned"],
    issues: [],
    emitted_events: [],
    next_operations: ["kernel.operation.catalog.list"]
  },
  {
    operation_id: "kernel.operation.catalog.list",
    version: "0.1.0",
    summary: "List visible Kernel Operation Descriptors.",
    visibility: "public",
    authority_class: "none",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/operations" },
    input_schema: emptyInputSchema,
    output_schema: {
      type: "object",
      required: ["protocol_version", "operations"],
      properties: {
        protocol_version: { type: "string" },
        operations: { type: "array", items: operationDescriptorOutputSchema }
      }
    },
    supported_modes: ["live"],
    preconditions: [],
    outcomes: ["operation_catalog_returned"],
    issues: [],
    emitted_events: [],
    next_operations: ["kernel.operation.descriptor.get"]
  },
  {
    operation_id: "kernel.operation.descriptor.get",
    version: "0.1.0",
    summary: "Read one visible Kernel Operation Descriptor.",
    visibility: "public",
    authority_class: "none",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/operations/{operation_id}" },
    input_schema: {
      type: "object",
      required: ["operation_id"],
      properties: { operation_id: { type: "string", minLength: 1 } }
    },
    output_schema: operationDescriptorOutputSchema,
    supported_modes: ["live"],
    preconditions: ["operation_is_visible"],
    outcomes: ["operation_descriptor_returned", "operation_not_found"],
    issues: ["OPERATION_NOT_FOUND"],
    emitted_events: [],
    next_operations: []
  },
  {
    operation_id: "kernel.environment.profile.get",
    version: "0.1.0",
    summary: "Read the current Kernel Environment profile.",
    visibility: "public",
    authority_class: "none",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/environments/current" },
    input_schema: emptyInputSchema,
    output_schema: environmentOutputSchema,
    supported_modes: ["live"],
    preconditions: [],
    outcomes: ["environment_returned"],
    issues: [],
    emitted_events: [],
    next_operations: ["kernel.environment.profile.update"]
  },
  {
    operation_id: "kernel.environment.profile.update",
    version: "0.1.0",
    summary: "Update the local Environment display name through an accountable command.",
    visibility: "public",
    authority_class: "bootstrap_operator",
    effect_class: "kernel_state_transition",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: { method: "POST", path: "/kernel/v0/commands" },
    supported_modes: ["live"],
    input_schema: {
      type: "object",
      required: ["command_id", "operation_id", "input"],
      properties: {
        command_id: { type: "string", minLength: 1, maxLength: 160 },
        operation_id: { const: "kernel.environment.profile.update" },
        input: {
          type: "object",
          required: ["display_name", "expected_revision"],
          properties: {
            display_name: { type: "string", minLength: 1, maxLength: 120 },
            expected_revision: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
          }
        }
      }
    },
    output_schema: {
      type: "object",
      required: ["command_id", "request_digest", "operation_id", "environment", "transition"]
    },
    preconditions: ["expected_revision_matches"],
    outcomes: ["environment_profile_updated", "command_replayed", "revision_conflict", "idempotency_conflict"],
    issues: ["AUTHENTICATION_REQUIRED", "INVALID_BOOTSTRAP_CREDENTIAL", "REQUEST_TOO_LARGE", "INVALID_JSON",
      "INVALID_COMMAND", "INVALID_COMMAND_ID", "UNSUPPORTED_OPERATION", "INVALID_INPUT", "ENVIRONMENT_NOT_FOUND",
      "REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"],
    emitted_events: ["kernel.environment.profile.updated"],
    next_operations: ["kernel.command.receipt.get", "kernel.environment.profile.get"]
  },
  {
    operation_id: "kernel.command.receipt.get",
    version: "0.1.0",
    summary: "Inspect an accepted command, its typed transition, and outbox record.",
    visibility: "public",
    authority_class: "authenticated_sponsoring_human",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/commands/{command_id}" },
    input_schema: {
      type: "object",
      required: ["command_id"],
      properties: { command_id: { type: "string", minLength: 1, maxLength: 160 } }
    },
    output_schema: {
      type: "object",
      required: ["command_id", "request_digest", "actor", "result", "transition", "outbox"]
    },
    supported_modes: ["live"],
    preconditions: ["command_exists"],
    outcomes: ["command_receipt_returned", "command_not_found"],
    issues: ["COMMAND_NOT_FOUND"],
    emitted_events: [],
    next_operations: []
  },
  {
    operation_id: "kernel.accountable_work.overview.get",
    version: "0.1.0",
    summary: "Read Environment health and accountable work requiring operator attention.",
    visibility: "public",
    authority_class: "authenticated_sponsoring_human",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/accountable-work/overview" },
    input_schema: emptyInputSchema,
    output_schema: {
      type: "object",
      required: ["environment", "health", "accountable_work", "authority"]
    },
    supported_modes: ["live"],
    preconditions: [],
    outcomes: ["accountable_work_overview_returned"],
    issues: [],
    emitted_events: [],
    next_operations: []
  }
];

const identityCommandIssues = ["AUTHENTICATION_REQUIRED", "INVALID_BOOTSTRAP_CREDENTIAL", "INVALID_JSON",
  "REQUEST_TOO_LARGE", "INVALID_INPUT", "IDEMPOTENCY_CONFLICT"];

function commandDescriptor(operationId, summary, path, resultKey, issues = [], inputSchema = { type: "object" },
  authorityClass = "authenticated_sponsoring_human") {
  const emittedEvent = {
    "kernel.principal.create": "kernel.principal.created",
    "kernel.agent_passport.issue": "kernel.agent_passport.issued",
    "kernel.work_intent.propose": "kernel.work_intent.proposed",
    "kernel.work_intent.confirm": "kernel.work_intent.confirmed",
    "kernel.build_session.open": "kernel.build_session.opened",
    "kernel.context_access_grant.issue": "kernel.context_access_grant.issued",
    "kernel.package_candidate.validate": "kernel.package_candidate.validated",
    "kernel.package_candidate.simulate": "kernel.package_candidate.simulated",
    "kernel.package_version.publish": "kernel.package_version.published",
    "kernel.artifact.trust_attest": "kernel.artifact.trust_attested"
  }[operationId];
  return {
    operation_id: operationId,
    version: "0.1.0",
    summary,
    visibility: "public",
    authority_class: authorityClass,
    effect_class: "kernel_state_transition",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: { method: "POST", path },
    input_schema: {
      type: "object",
      required: ["command_id", "operation_id", "input"],
      properties: {
        command_id: { type: "string", minLength: 1, maxLength: 160 },
        operation_id: { const: operationId },
        input: inputSchema
      }
    },
    output_schema: { type: "object", required: ["command_id", "request_digest", resultKey, "transition"] },
    supported_modes: ["live"],
    preconditions: ["authenticated_human_matches_sponsor"],
    outcomes: [`${resultKey}_created`, "command_replayed"],
    issues: [...identityCommandIssues, ...issues],
    emitted_events: [emittedEvent],
    next_operations: []
  };
}

function readDescriptor(operationId, summary, path, resultKey, notFoundIssue) {
  const idName = path.match(/\{([^}]+)\}/)?.[1] ?? "id";
  return {
    operation_id: operationId,
    version: "0.1.0",
    summary,
    visibility: "public",
    authority_class: "authenticated_sponsoring_human",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path },
    input_schema: { type: "object", required: [idName], properties: { [idName]: { type: "string", format: "uuid" } } },
    output_schema: { type: "object", required: [resultKey] },
    supported_modes: ["live"],
    preconditions: [`${resultKey}_exists`],
    outcomes: [`${resultKey}_returned`, `${resultKey}_not_found`],
    issues: [notFoundIssue],
    emitted_events: [],
    next_operations: []
  };
}

descriptors.push(
  commandDescriptor("kernel.principal.create", "Create one attribution-only Principal.", "/kernel/v0/principals", "principal",
    ["SPONSOR_PRINCIPAL_REQUIRED", "HUMAN_PRINCIPAL_EXISTS"]),
  readDescriptor("kernel.principal.get", "Inspect one Principal without implying authority.",
    "/kernel/v0/principals/{principal_id}", "principal", "PRINCIPAL_NOT_FOUND"),
  commandDescriptor("kernel.agent_passport.issue", "Issue an immutable Agent Passport identity document.",
    "/kernel/v0/agent-passports", "passport", ["SPONSOR_MISMATCH", "AGENT_PRINCIPAL_INVALID", "SPONSOR_PRINCIPAL_INVALID"]),
  readDescriptor("kernel.agent_passport.get", "Inspect one Agent Passport and current validity.",
    "/kernel/v0/agent-passports/{passport_id}", "passport", "PASSPORT_NOT_FOUND"),
  commandDescriptor("kernel.work_intent.propose", "Record conversation-derived intent as a non-authoritative proposal.",
    "/kernel/v0/work-intent-proposals", "proposal", ["PASSPORT_EXPIRED", "PASSPORT_NOT_YET_VALID", "INTENT_CLASS_NOT_PERMITTED"]),
  commandDescriptor("kernel.work_intent.confirm", "Confirm one exact proposal into an immutable attributed Work Intent.",
    "/kernel/v0/work-intent-proposals/{proposal_id}/confirm", "work_intent",
    ["PROPOSAL_NOT_FOUND", "INTENT_ALREADY_CONFIRMED", "PASSPORT_EXPIRED", "SPONSOR_MISMATCH"]),
  readDescriptor("kernel.work_intent.get", "Inspect one confirmed Work Intent.",
    "/kernel/v0/work-intents/{work_intent_id}", "work_intent", "WORK_INTENT_NOT_FOUND"),
  commandDescriptor("kernel.build_session.open", "Open a bounded Build Session without storing draft contents.",
    "/kernel/v0/build-sessions", "build_session", ["PASSPORT_EXPIRED", "PASSPORT_PRINCIPAL_MISMATCH",
      "PASSPORT_INTENT_MISMATCH", "SESSION_EXCEEDS_PASSPORT"]),
  readDescriptor("kernel.build_session.get", "Inspect one bounded Build Session.",
    "/kernel/v0/build-sessions/{build_session_id}", "build_session", "BUILD_SESSION_NOT_FOUND"),
  {
    operation_id: "kernel.admission.check",
    version: "0.1.0",
    summary: "Check whether an intent stage admits discovery, customer context, or external effects.",
    visibility: "public",
    authority_class: "authenticated_sponsoring_human",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "POST", path: "/kernel/v0/admission/check" },
    input_schema: { type: "object", required: ["passport_id", "access_class"] },
    output_schema: { type: "object", required: ["allowed", "basis", "authority_granted"] },
    supported_modes: ["live"],
    preconditions: ["passport_and_intent_match"],
    outcomes: ["admitted", "denied"],
    issues: ["PASSPORT_EXPIRED", "PASSPORT_INTENT_MISMATCH", "PROVISIONAL_INTENT_LIMIT", "AUTHORITY_NOT_GRANTED"],
    emitted_events: [],
    next_operations: []
  }
);

descriptors.push(
  commandDescriptor("kernel.context_access_grant.issue", "Issue a bounded read-only Context Access Grant.",
    "/kernel/v0/context-access-grants", "context_access_grant", ["PASSPORT_INTENT_MISMATCH",
      "GRANT_EXCEEDS_PASSPORT", "INVALID_LIMIT", "INVALID_FRESHNESS", "INVALID_EXPIRY", "SPONSOR_MISMATCH"], {
      type: "object",
      required: ["passport_id", "work_intent_id", "purpose", "subjects", "sources", "sensitivity_classes",
        "max_items", "max_age_seconds", "expires_at"],
      properties: {
        passport_id: { type: "string", format: "uuid" },
        work_intent_id: { type: "string", format: "uuid" },
        purpose: { type: "string", minLength: 1, maxLength: 500 },
        subjects: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        sources: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
        sensitivity_classes: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
        max_items: { type: "integer", minimum: 1, maximum: 1000 },
        max_age_seconds: { type: "integer", minimum: 1, maximum: 86400 },
        expires_at: { type: "string", format: "date-time" }
      },
      additionalProperties: false
    }),
  readDescriptor("kernel.context_access_grant.get", "Inspect one Context Access Grant without context payload.",
    "/kernel/v0/context-access-grants/{grant_id}", "context_access_grant", "CONTEXT_GRANT_NOT_FOUND"),
  readDescriptor("kernel.context_receipt.get", "Inspect one signed Context Receipt without context payload.",
    "/kernel/v0/context-receipts/{receipt_id}", "context_receipt", "CONTEXT_RECEIPT_NOT_FOUND")
);

const builderAuthority = "authenticated_builder_agent_under_confirmed_intent";
descriptors.push(
  commandDescriptor("kernel.artifact.trust_attest", "Record a human trust decision for exact adapter bytes and build attestation.",
    "/kernel/v0/artifact-attestations", "artifact_attestation", ["ADAPTER_REFERENCE_INVALID"], {
      type: "object", required: ["artifact_ref", "artifact_digest", "build_attestation_digest"],
      properties: { artifact_ref: { type: "string" }, artifact_digest: { type: "string" },
        build_attestation_digest: { type: "string" } }, additionalProperties: false
    }),
  readDescriptor("kernel.artifact_attestation.get", "Inspect one immutable human artifact trust attestation.",
    "/kernel/v0/artifact-attestations/{artifact_attestation_id}", "artifact_attestation", "ARTIFACT_ATTESTATION_NOT_FOUND"),
  commandDescriptor("kernel.package_candidate.validate", "Deterministically validate an inert Operational Package candidate.",
    "/kernel/v0/package-validations", "validation_receipt", ["BUILD_SESSION_AGENT_MISMATCH", "BUILD_SESSION_EXPIRED"], {
      type: "object", required: ["build_session_id", "candidate"],
      properties: { build_session_id: { type: "string", format: "uuid" }, candidate: { type: "object" } },
      additionalProperties: false
    }, builderAuthority),
  readDescriptor("kernel.package_validation_receipt.get", "Inspect structured deterministic package validation results.",
    "/kernel/v0/package-validations/{validation_receipt_id}", "validation_receipt", "VALIDATION_RECEIPT_NOT_FOUND"),
  commandDescriptor("kernel.package_candidate.simulate", "Create an authority-free fixture or observational Simulation Receipt.",
    "/kernel/v0/package-simulations", "simulation_receipt", ["CANDIDATE_NOT_VALID", "CANDIDATE_DIGEST_MISMATCH",
      "UNSUPPORTED_SIMULATION_MODE", "EVALUATION_EXPORT_NOT_FOUND"], {
      type: "object", required: ["validation_receipt_id", "candidate", "mode"],
      properties: { validation_receipt_id: { type: "string", format: "uuid" }, candidate: { type: "object" },
        mode: { enum: ["deterministic_fixture", "observational_read_only"] },
        observational_attestation: { type: "object" }, observational_attestation_signature: { type: "string" } },
      additionalProperties: false
    }, builderAuthority),
  readDescriptor("kernel.package_simulation_receipt.get", "Inspect one authority-free Simulation Receipt.",
    "/kernel/v0/package-simulations/{simulation_receipt_id}", "simulation_receipt", "SIMULATION_RECEIPT_NOT_FOUND"),
  commandDescriptor("kernel.package_version.publish", "Atomically publish one immutable content-addressed Package Version.",
    "/kernel/v0/package-versions", "package_version", ["PUBLICATION_VALIDATION_MISMATCH", "CANDIDATE_REVALIDATION_FAILED",
      "SIMULATION_RECEIPTS_REQUIRED", "SIMULATION_COVERAGE_INCOMPLETE", "PACKAGE_VERSION_BYTES_CONFLICT", "PACKAGE_VERSION_EXISTS"], {
      type: "object", required: ["build_session_id", "validation_receipt_id", "simulation_receipt_ids", "candidate"],
      properties: { build_session_id: { type: "string", format: "uuid" },
        validation_receipt_id: { type: "string", format: "uuid" },
        simulation_receipt_ids: { type: "array", minItems: 2, items: { type: "string", format: "uuid" } },
        candidate: { type: "object" } }, additionalProperties: false
    }, builderAuthority),
  readDescriptor("kernel.package_version.get", "Inspect one immutable Package Version and publication attestation.",
    "/kernel/v0/package-versions/{package_version_id}", "package_version", "PACKAGE_VERSION_NOT_FOUND")
);

export function listOperationDescriptors() {
  return structuredClone(descriptors);
}

export function getOperationDescriptor(operationId) {
  const descriptor = descriptors.find((item) => item.operation_id === operationId);
  return descriptor ? structuredClone(descriptor) : null;
}
