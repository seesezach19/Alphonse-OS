export const PROTOCOL_VERSION = "0.1.0";

const emptyInputSchema = { type: "object", additionalProperties: false };
const environmentOutputSchema = {
  type: "object",
  required: ["installation_id", "environment_id", "display_name", "environment_class", "revision", "execution_epoch", "created_at", "updated_at"],
  properties: {
    installation_id: { type: "string", format: "uuid" },
    environment_id: { type: "string", format: "uuid" },
    display_name: { type: "string" },
    environment_class: { enum: ["development", "staging", "production"] },
    revision: { type: "string", pattern: "^[0-9]+$" },
    execution_epoch: { type: "string", pattern: "^[1-9][0-9]*$" },
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
  const agentCommand = authorityClass.includes("agent");
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
    "kernel.trust_policy.create": "kernel.trust_policy.created",
    "kernel.package.import": ["kernel.package.quarantined", "kernel.package_import.denied"],
    "kernel.artifact.trust_attest": "kernel.artifact.trust_attested",
    "kernel.deployment_plan.validate": "kernel.deployment_plan.validated",
    "kernel.deployment_plan.technical_review": "kernel.deployment_plan.technical_reviewed",
    "kernel.deployment.stage": "kernel.deployment.staged",
    "kernel.capability.business_approve": "kernel.capability.business_approved",
    "kernel.capability_activation.activate": "kernel.capability.activated",
    "kernel.handoff.propose": "kernel.handoff.proposed",
    "kernel.handoff.accept": "kernel.handoff.accepted",
    "kernel.handoff.reject": "kernel.handoff.rejected",
    "kernel.environment.execution_epoch.advance": "kernel.environment.execution_epoch.advanced",
    "kernel.execution_envelope.admit": "kernel.execution_envelope.admitted",
    "kernel.run.complete_comparison": "kernel.run.completed",
    "kernel.effect.admit": "kernel.effect.admitted",
    "kernel.effect.dispatch": ["kernel.effect.succeeded", "kernel.effect.uncertain"],
    "kernel.recovery_case.reconcile": ["kernel.recovery_case.reconciled_applied",
      "kernel.recovery_case.reconciled_not_applied"]
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
    preconditions: [agentCommand ? "authenticated_agent_matches_bound_passport" : "authenticated_human_matches_sponsor"],
    outcomes: [`${resultKey}_created`, "command_replayed"],
    issues: [...(agentCommand
      ? ["AGENT_AUTHENTICATION_REQUIRED", "INVALID_JSON", "REQUEST_TOO_LARGE", "INVALID_INPUT", "IDEMPOTENCY_CONFLICT"]
      : identityCommandIssues), ...issues],
    emitted_events: Array.isArray(emittedEvent) ? emittedEvent : [emittedEvent],
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
  commandDescriptor("kernel.trust_policy.create", "Create one immutable destination-local Package Trust Policy.",
    "/kernel/v0/trust-policies", "trust_policy", ["TRUST_POLICY_VERSION_EXISTS", "PRIVATE_KEY_PROHIBITED",
      "TRUST_POLICY_ENVIRONMENT_MISMATCH"], {
      type: "object", required: ["policy"], properties: { policy: { type: "object" } }, additionalProperties: false
    }),
  {
    operation_id: "kernel.trust_policy.get",
    version: "0.1.0",
    summary: "Inspect one exact immutable Trust Policy version.",
    visibility: "public",
    authority_class: "authenticated_sponsoring_human",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/trust-policies/{policy_id}/versions/{version}" },
    input_schema: { type: "object", required: ["policy_id", "version"] },
    output_schema: { type: "object", required: ["trust_policy"] },
    supported_modes: ["live"],
    preconditions: ["trust_policy_version_exists"],
    outcomes: ["trust_policy_returned"],
    issues: ["TRUST_POLICY_NOT_FOUND"],
    emitted_events: [],
    next_operations: ["kernel.package.import"]
  },
  commandDescriptor("kernel.package.import", "Verify an exact portable bundle and quarantine it without Deployment authority.",
    "/kernel/v0/package-imports", "import_receipt", ["PUBLISHER_NOT_PINNED", "NO_TRUSTED_CUSTODY_RECEIPT",
      "MISSING_DEPENDENCY", "INVALID_TRANSPORT"], {
      type: "object", required: ["policy_id", "policy_version", "work_intent_id", "transport", "bundle"], properties: {
        policy_id: { type: "string" }, policy_version: { type: "integer", minimum: 1 },
        work_intent_id: { type: "string", format: "uuid" },
        transport: { enum: ["registry", "mirror", "offline_bundle"] }, bundle: { type: "object" }
      }, additionalProperties: false
    }),
  readDescriptor("kernel.package_import_receipt.get", "Inspect one immutable Package Import Receipt.",
    "/kernel/v0/package-import-receipts/{import_receipt_id}", "import_receipt", "IMPORT_RECEIPT_NOT_FOUND"),
  readDescriptor("kernel.quarantined_package.get", "Inspect one imported Package still isolated from Deployment authority.",
    "/kernel/v0/quarantined-packages/{quarantine_id}", "quarantined_package", "QUARANTINED_PACKAGE_NOT_FOUND")
);

const runtimeAgentAuthority = "authenticated_agent_bound_to_handoff";
const executionAgentAuthority = "authenticated_agent_bound_to_execution";
descriptors.push(
  commandDescriptor("kernel.handoff.propose", "Propose exact structured responsibility transfer without conversation history.",
    "/kernel/v0/handoffs", "handoff", ["AMBIENT_MEMORY_PROHIBITED", "HANDOFF_BINDING_MISMATCH",
      "TARGET_RUNTIME_MISMATCH", "SKILL_VERSION_MISMATCH", "SOURCE_AUTHORITY_CLOSED"],
    { type: "object", required: ["source_passport_id", "target_passport_id", "work_intent_id", "target_runtime",
      "exact_bindings", "context_receipt_ids", "delegation_proposal", "open_obligations", "workload", "expires_at"],
      additionalProperties: false }, runtimeAgentAuthority),
  commandDescriptor("kernel.handoff.accept", "Atomically accept responsibility and issue one signed bounded Workload Grant.",
    "/kernel/v0/handoffs/{handoff_id}/accept", "handoff", ["HANDOFF_EXPIRED", "HANDOFF_NOT_PENDING",
      "WORKLOAD_DIGEST_MISMATCH", "SOURCE_AUTHORITY_CLOSED"],
    { type: "object", required: ["workload_digest"], properties: { workload_digest: { type: "string" } },
      additionalProperties: false }, runtimeAgentAuthority),
  commandDescriptor("kernel.handoff.reject", "Reject one pending Hand Off as its exact target.",
    "/kernel/v0/handoffs/{handoff_id}/reject", "handoff", ["HANDOFF_NOT_PENDING", "HANDOFF_TARGET_MISMATCH"],
    { type: "object", required: ["reason"], properties: { reason: { type: "string" } }, additionalProperties: false },
    runtimeAgentAuthority),
  readDescriptor("kernel.handoff.get", "Inspect structured Hand Off state without ambient conversation memory.",
    "/kernel/v0/handoffs/{handoff_id}", "handoff", "HANDOFF_NOT_FOUND"),
  readDescriptor("kernel.workload_grant.get", "Inspect one signed bounded Workload Grant without effect authority.",
    "/kernel/v0/workload-grants/{workload_grant_id}", "workload_grant", "WORKLOAD_GRANT_NOT_FOUND"),
  commandDescriptor("kernel.environment.execution_epoch.advance", "Fence all Workload Grants from the previous execution epoch.",
    "/kernel/v0/environments/current/execution-epoch/advance", "execution_epoch", [],
    { type: "object", additionalProperties: false })
);

descriptors.push({
  operation_id: "kernel.workload_admission.check", version: "0.1.0",
  summary: "Check exact workload bytes, lease, and Environment epoch without granting external effects.",
  visibility: "public", authority_class: "authenticated_substrate_adapter", effect_class: "read_only",
  idempotency: "naturally_idempotent", transport: { method: "POST", path: "/internal/v0/workloads/admission" },
  input_schema: { type: "object", required: ["workload_grant_id", "workload_digest"] },
  output_schema: { type: "object", required: ["admissible", "external_effect_authority", "dispatch_permit_required"] },
  supported_modes: ["live"], preconditions: ["exact_workload", "unexpired_lease", "current_environment_epoch"],
  outcomes: ["workload_admissible", "workload_denied"],
  issues: ["WORKLOAD_DIGEST_MISMATCH", "WORKLOAD_LEASE_EXPIRED", "ENVIRONMENT_EPOCH_FENCED"],
  emitted_events: [], next_operations: []
}, {
  operation_id: "kernel.host_observation.record", version: "0.1.0",
  summary: "Record one signed, chained host fact using namespace, cgroup, boot, start, and nonce identity.",
  visibility: "public", authority_class: "authenticated_substrate_adapter", effect_class: "kernel_state_transition",
  idempotency: "observation_id_derived_command_id_and_canonical_request_digest",
  transport: { method: "POST", path: "/internal/v0/workloads/observations" },
  input_schema: { type: "object", required: ["observation_id", "workload_grant_id", "workload_instance_id",
    "sequence", "observation_type", "identity", "observed_at", "payload_digest", "previous_observation_digest",
    "key_id", "signature"] },
  output_schema: { type: "object", required: ["host_observation", "transition"] },
  supported_modes: ["live"], preconditions: ["valid_host_signature", "identity_is_not_pid_only", "chain_continues"],
  outcomes: ["host_observation_recorded", "command_replayed"],
  issues: ["INVALID_HOST_OBSERVATION_SIGNATURE", "WORKLOAD_IDENTITY_MISMATCH", "OBSERVATION_CHAIN_MISMATCH"],
  emitted_events: ["kernel.host_observation.recorded"], next_operations: []
});

descriptors.push(
  commandDescriptor("kernel.execution_envelope.admit", "Atomically admit exact read work into one Envelope, Run, and initial Obligations.",
    "/kernel/v0/execution-envelopes", "execution_envelope", ["EXECUTION_PASSPORT_MISMATCH", "DELEGATION_EXPIRED",
      "CAPABILITY_INACTIVE", "STALE_CONTEXT", "EXECUTION_BOUNDS_EXCEEDED", "EXECUTION_IDEMPOTENCY_CONFLICT"],
    { type: "object", required: ["idempotency_key", "passport_id", "work_intent_id", "delegation_id",
      "capability_activation_id", "package_version_id", "skill", "context_receipt_ids", "limits",
      "evidence_requirements", "expires_at"], additionalProperties: false }, executionAgentAuthority),
  commandDescriptor("kernel.run.complete_comparison", "Complete exact read-only comparison and atomically satisfy evidence Obligations.",
    "/kernel/v0/runs/{run_id}/complete-comparison", "run", ["EXECUTION_ENVELOPE_EXPIRED", "DELEGATION_EXPIRED",
      "EVIDENCE_SOURCE_MISMATCH", "COMPARISON_OUTPUT_MISMATCH", "RUN_ALREADY_FINAL"],
    { type: "object", required: ["run_id", "envelope_id", "observations", "output"], additionalProperties: false },
    executionAgentAuthority),
  readDescriptor("kernel.execution_envelope.get", "Inspect one immutable exact Execution Envelope.",
    "/kernel/v0/execution-envelopes/{envelope_id}", "execution_envelope", "EXECUTION_ENVELOPE_NOT_FOUND"),
  readDescriptor("kernel.run.get", "Inspect Run execution and accountability states separately.",
    "/kernel/v0/runs/{run_id}", "run", "RUN_NOT_FOUND"),
  readDescriptor("kernel.evidence_record.get", "Inspect one immutable Evidence Record with exact source links.",
    "/kernel/v0/evidence-records/{evidence_record_id}", "evidence_record", "EVIDENCE_RECORD_NOT_FOUND")
);

descriptors.push(
  commandDescriptor("kernel.effect.admit", "Admit one exact bounded correction into an Effect Record and signed one-use Dispatch Permit.",
    "/kernel/v0/effects", "effect_record", ["CAPABILITY_INACTIVE", "CREDENTIAL_REVISION_MISMATCH",
      "EFFECT_BOUNDS_EXCEEDED", "STALE_CONTEXT", "EFFECT_IDEMPOTENCY_CONFLICT"],
    { type: "object", required: ["effect_idempotency_key", "passport_id", "work_intent_id", "delegation_id",
      "workload_grant_id", "capability_activation_id", "package_version_id", "context_receipt_ids", "target",
      "action", "requested_value", "limits", "credential_binding", "adapter", "evidence_requirements", "recovery",
      "expires_at"], additionalProperties: false }, executionAgentAuthority),
  { ...commandDescriptor("kernel.effect.dispatch", "Consume one exact Dispatch Permit through the trusted adapter path.",
    "/kernel/v0/effects/{effect_id}/dispatch", "effect_record", ["DISPATCH_PERMIT_EXPIRED",
      "DISPATCH_PERMIT_CONSUMED", "IMMEDIATE_EFFECT_GATE_DENIED", "ADAPTER_DISPATCH_FAILED"],
    { type: "object", required: ["effect_id", "permit_id", "permit_digest"], additionalProperties: false },
  executionAgentAuthority), effect_class: "external_effect" },
  readDescriptor("kernel.effect.get", "Inspect one Effect Record and current effect state.",
    "/kernel/v0/effects/{effect_id}", "effect_record", "EFFECT_NOT_FOUND"),
  readDescriptor("kernel.dispatch_permit.get", "Inspect one signed Dispatch Permit and consumption state.",
    "/kernel/v0/dispatch-permits/{permit_id}", "dispatch_permit", "DISPATCH_PERMIT_NOT_FOUND"),
  { ...commandDescriptor("kernel.recovery_case.reconcile",
    "Observe exact target state under a one-use read-only permit; never redispatch the uncertain Effect.",
    "/kernel/v0/recovery-cases/{recovery_case_id}/reconcile", "recovery_case",
    ["RECOVERY_ACTOR_MISMATCH", "RECONCILIATION_NOT_AVAILABLE", "RECONCILIATION_PERMIT_EXPIRED",
      "RECONCILIATION_EVIDENCE_INVALID"],
    { type: "object", required: ["recovery_case_id", "reconciliation_permit_id", "permit_digest"],
      additionalProperties: false }, executionAgentAuthority), effect_class: "external_observation" },
  readDescriptor("kernel.recovery_case.get", "Inspect uncertainty, responsibility, options, and preserved recovery history.",
    "/kernel/v0/recovery-cases/{recovery_case_id}", "recovery_case", "RECOVERY_CASE_NOT_FOUND"),
  readDescriptor("kernel.reconciliation_permit.get", "Inspect one signed one-use read-only Reconciliation Permit.",
    "/kernel/v0/reconciliation-permits/{reconciliation_permit_id}", "reconciliation_permit",
    "RECONCILIATION_PERMIT_NOT_FOUND")
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
        delegation_id: { type: "string", format: "uuid" },
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

const exactDecisionSchema = {
  type: "object",
  required: ["deployment_id", "capability_export_id", "capability_export_digest", "authority_digest",
    "action_card_digest", "expected_revision"],
  properties: {
    deployment_id: { type: "string", format: "uuid" },
    capability_export_id: { type: "string", minLength: 1 },
    capability_export_digest: { type: "string" },
    authority_digest: { type: "string" },
    action_card_digest: { type: "string" },
    expected_revision: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
};

descriptors.push(
  commandDescriptor("kernel.deployment_plan.validate", "Validate and record one exact inert Deployment Plan.",
    "/kernel/v0/deployment-plan-validations", "validation_receipt", ["PACKAGE_REFERENCE_MISMATCH",
      "WORK_INTENT_SPONSOR_MISMATCH", "WORK_INTENT_PROHIBITS_ACTIVATION"], {
      type: "object", required: ["plan"], properties: { plan: { type: "object" } }, additionalProperties: false
    }),
  readDescriptor("kernel.deployment_plan_validation_receipt.get", "Inspect one structured Deployment Plan validation receipt.",
    "/kernel/v0/deployment-plan-validations/{validation_receipt_id}", "validation_receipt", "DEPLOYMENT_VALIDATION_NOT_FOUND"),
  readDescriptor("kernel.deployment_plan.get", "Inspect one immutable validated Deployment Plan.",
    "/kernel/v0/deployment-plans/{deployment_plan_id}", "deployment_plan", "DEPLOYMENT_PLAN_NOT_FOUND"),
  commandDescriptor("kernel.deployment_plan.technical_review", "Record pass, request-changes, or reject against one exact plan.",
    "/kernel/v0/deployment-plans/{deployment_plan_id}/technical-reviews", "technical_review",
    ["DEPLOYMENT_PLAN_VERSION_MISMATCH", "TECHNICAL_REVIEW_EXISTS", "TECHNICAL_REVIEW_DECISION_INVALID"], {
      type: "object", required: ["plan_digest", "decision", "rationale"], properties: {
        plan_digest: { type: "string" }, decision: { enum: ["pass", "request_changes", "reject"] },
        rationale: { type: "string", minLength: 1, maxLength: 2000 }
      }, additionalProperties: false
    }),
  readDescriptor("kernel.deployment_technical_review.get", "Inspect one immutable exact technical review decision.",
    "/kernel/v0/deployment-technical-reviews/{technical_review_id}", "technical_review", "TECHNICAL_REVIEW_NOT_FOUND"),
  commandDescriptor("kernel.deployment.stage", "Stage one technically passed exact Deployment without authority.",
    "/kernel/v0/deployments", "deployment", ["STAGING_VERSION_MISMATCH", "TECHNICAL_REVIEW_NOT_PASSED",
      "DEPLOYMENT_ALREADY_STAGED"], {
      type: "object", required: ["deployment_plan_id", "technical_review_id", "plan_digest"], properties: {
        deployment_plan_id: { type: "string", format: "uuid" },
        technical_review_id: { type: "string", format: "uuid" }, plan_digest: { type: "string" }
      }, additionalProperties: false
    }),
  readDescriptor("kernel.deployment.get", "Inspect one immutable staged Deployment separately from authority.",
    "/kernel/v0/deployments/{deployment_id}", "deployment", "DEPLOYMENT_NOT_FOUND"),
  commandDescriptor("kernel.capability.business_approve", "Approve one exact staged Capability authority contract.",
    "/kernel/v0/capability-business-approvals", "business_approval", ["ACTION_CARD_MISMATCH",
      "STALE_ACTION_REVISION", "CAPABILITY_ALREADY_APPROVED"], exactDecisionSchema),
  readDescriptor("kernel.capability_business_approval.get", "Inspect one exact immutable business approval.",
    "/kernel/v0/capability-business-approvals/{business_approval_id}", "business_approval", "BUSINESS_APPROVAL_NOT_FOUND"),
  commandDescriptor("kernel.capability_activation.activate", "Activate exact approved Capability authority separately from Deployment.",
    "/kernel/v0/capability-activations", "capability_activation", ["ACTION_CARD_MISMATCH",
      "STALE_ACTION_REVISION", "STALE_BUSINESS_APPROVAL", "BUSINESS_APPROVAL_VERSION_MISMATCH"], {
      ...exactDecisionSchema,
      required: ["business_approval_id", ...exactDecisionSchema.required],
      properties: { business_approval_id: { type: "string", format: "uuid" }, ...exactDecisionSchema.properties }
    }),
  readDescriptor("kernel.capability_activation.get", "Inspect one exact active Capability authority record.",
    "/kernel/v0/capability-activations/{capability_activation_id}", "capability_activation", "CAPABILITY_ACTIVATION_NOT_FOUND"),
  {
    operation_id: "kernel.capability_action_card.get",
    version: "0.1.0",
    summary: "Read Butler's Kernel-derived current action card for one staged Capability.",
    visibility: "public",
    authority_class: "authenticated_sponsoring_human",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/deployments/{deployment_id}/capabilities/{capability_export_id}/action-card" },
    input_schema: { type: "object", required: ["deployment_id", "capability_export_id"], properties: {
      deployment_id: { type: "string", format: "uuid" }, capability_export_id: { type: "string", minLength: 1 }
    } },
    output_schema: { type: "object", required: ["action_card"] },
    supported_modes: ["live"],
    preconditions: ["deployment_is_staged", "capability_is_exact"],
    outcomes: ["action_card_returned"],
    issues: ["DEPLOYMENT_NOT_FOUND", "DEPLOYED_CAPABILITY_NOT_FOUND"],
    emitted_events: [],
    next_operations: ["kernel.capability.business_approve", "kernel.capability_activation.activate"]
  },
  {
    operation_id: "kernel.capability_admission.check",
    version: "0.1.0",
    summary: "Precheck exact active approved Capability authority without creating execution state.",
    visibility: "public",
    authority_class: "authenticated_sponsoring_human",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "POST", path: "/kernel/v0/capability-admission/check" },
    input_schema: { type: "object", required: ["deployment_id", "business_approval_id", "capability_activation_id",
      "capability_export_id", "capability_export_digest", "authority_digest", "expected_revision"] },
    output_schema: { type: "object", required: ["admissible", "basis", "capability_authority_granted", "execution_envelope_created"] },
    supported_modes: ["live"],
    preconditions: ["exact_business_approval", "exact_active_capability", "current_revision"],
    outcomes: ["capability_authority_admissible", "capability_authority_denied"],
    issues: ["CAPABILITY_UNAPPROVED", "CAPABILITY_INACTIVE", "CAPABILITY_VERSION_MISMATCH", "STALE_ACTION_REVISION"],
    emitted_events: [],
    next_operations: []
  }
);

export function listOperationDescriptors() {
  return structuredClone(descriptors);
}

export function getOperationDescriptor(operationId) {
  const descriptor = descriptors.find((item) => item.operation_id === operationId);
  return descriptor ? structuredClone(descriptor) : null;
}
