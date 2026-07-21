// @ts-check

/**
 * @typedef {{
 *   operation_id: string,
 *   version: string,
 *   summary: string,
 *   visibility: string,
 *   authority_class: string,
 *   effect_class: string,
 *   idempotency: string,
 *   transport: { method: string, path: string },
 *   input_schema: Record<string, any>,
 *   output_schema: Record<string, any>,
 *   supported_modes: string[],
 *   preconditions: string[],
 *   outcomes: string[],
 *   issues: string[],
 *   emitted_events: string[],
 *   next_operations: string[]
 * }} KernelOperationDescriptor
 */

export const PROTOCOL_VERSION = "0.1.0";

const emptyInputSchema = { type: "object", additionalProperties: false };
const environmentOutputSchema = {
  type: "object",
  required: ["installation_id", "environment_id", "display_name", "environment_class", "revision", "execution_epoch",
    "operational_state", "restore_generation", "created_at", "updated_at"],
  properties: {
    installation_id: { type: "string", format: "uuid" },
    environment_id: { type: "string", format: "uuid" },
    display_name: { type: "string" },
    environment_class: { enum: ["development", "staging", "production"] },
    revision: { type: "string", pattern: "^[0-9]+$" },
    execution_epoch: { type: "string", pattern: "^[1-9][0-9]*$" },
    operational_state: { enum: ["active", "restore_suspended", "destroyed"] },
    restore_generation: { type: "string", pattern: "^[0-9]+$" },
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

const coverageReviewApprovalSchema = {
  type: "object",
  required: [
    "approval_id", "approval_digest", "onboarding_id", "review_bundle_digest", "review_state",
    "review_state_digest", "work_intent_id", "work_intent_digest", "scope", "rationale",
    "principal_id", "executed_by", "issued_at", "valid_until", "status", "eligibility",
    "document", "immutable"
  ],
  additionalProperties: false,
  properties: {
    approval_id: { type: "string", format: "uuid" },
    approval_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    onboarding_id: { type: "string", format: "uuid" },
    review_bundle_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    review_state: { type: "object" },
    review_state_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    work_intent_id: { type: "string", format: "uuid" },
    work_intent_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    scope: { type: "object" },
    rationale: { type: "string" },
    principal_id: { type: "string", format: "uuid" },
    executed_by: { type: "object" },
    issued_at: { type: "string", format: "date-time" },
    valid_until: { type: ["string", "null"], format: "date-time" },
    status: { enum: ["eligible", "review_required", "expired"] },
    eligibility: { type: "object" },
    document: { type: "object" },
    immutable: { const: true }
  }
};

const coverageReviewApproveInput = {
  type: "object",
  required: ["onboarding_id", "review_bundle_digest", "expected_review_state", "work_intent_id",
    "scope", "rationale", "valid_until", "authority_granted", "authority_denied"],
  additionalProperties: false,
  properties: {
    onboarding_id: { type: "string", format: "uuid" },
    review_bundle_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    expected_review_state: {
      type: "object", required: ["onboarding_revision", "event_head_digest", "status"],
      additionalProperties: false,
      properties: {
        onboarding_revision: { type: "integer", minimum: 5 },
        event_head_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        status: { const: "awaiting_approval" }
      }
    },
    work_intent_id: { type: "string", format: "uuid" },
    scope: {
      type: "object", required: ["kind", "onboarding_id", "workflow_reference_digest",
        "review_bundle_digest"], additionalProperties: false,
      properties: {
        kind: { const: "exact_workflow_and_review_digest" },
        onboarding_id: { type: "string", format: "uuid" },
        workflow_reference_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        review_bundle_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
      }
    },
    rationale: { type: "string", minLength: 1, maxLength: 2000 },
    valid_until: { type: ["string", "null"], format: "date-time" },
    authority_granted: { const: ["compile_exact_bundle", "request_exact_registration"] },
    authority_denied: { const: ["source_control", "manifest_import", "registration",
      "provider_credential", "workflow_execution", "repair", "verification", "promotion",
      "target_change", "external_effect"] }
  }
};

/** @type {KernelOperationDescriptor[]} */
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

/**
 * @param {string} operationId
 * @param {string} summary
 * @param {string} path
 * @param {string} resultKey
 * @param {string[]} [issues]
 * @param {Record<string, any>} [inputSchema]
 * @param {string} [authorityClass]
 * @returns {KernelOperationDescriptor}
 */
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
    "kernel.coordinator_binding.create": "kernel.coordinator_binding.created",
    "kernel.coordinator_binding.revoke": "kernel.coordinator_binding.revoked",
    "kernel.coordinator.register_outbound": "kernel.coordinator.registered_outbound",
    "kernel.promotion.poll_outbound": "kernel.promotion.proposals_pulled",
    "kernel.promotion.request_outbound": "kernel.promotion.requested_outbound",
    "kernel.promotion.resolve_local_plan": "kernel.promotion.target_plan_resolved",
    "kernel.promotion_receipt.create": "kernel.promotion.receipt_created",
    "kernel.promotion_receipt.deliver_outbound": "kernel.promotion.receipt_delivered_outbound",
    "kernel.environment_health.publish_outbound": "kernel.environment_health.published",
    "kernel.support.poll_outbound": "kernel.support_cases.pulled",
    "kernel.support_case.approve": "kernel.support_passport.issued",
    "kernel.support_passport.deliver_outbound": "kernel.support_passport.notice_delivered",
    "kernel.diagnostic_bundle.create": "kernel.diagnostic_bundle.created",
    "kernel.support_remediation.authorize": "kernel.support_remediation.authorized",
    "kernel.runtime_host.quarantine": "kernel.runtime_host.quarantined",
    "kernel.coordinator_binding.revocation_sync": "kernel.coordinator_binding.revocation_delivered",
    "kernel.upgrade.compatibility_analyze": "kernel.upgrade.compatibility_analyzed",
    "kernel.upgrade.activation_policy_create": "kernel.upgrade.activation_policy_created",
    "kernel.upgrade.plan_create": "kernel.upgrade.plan_created",
    "kernel.upgrade.migration_start": "kernel.upgrade.migration_started",
    "kernel.upgrade.migration_checkpoint": "kernel.upgrade.migration_checkpointed",
    "kernel.upgrade.migration_verify": "kernel.upgrade.migration_verified",
    "kernel.upgrade.canary_evaluate": ["kernel.upgrade.canary_passed", "kernel.upgrade.canary_paused"],
    "kernel.upgrade.activate": "kernel.upgrade.activated",
    "kernel.upgrade.recovery_record": ["kernel.upgrade.deployment_rollback", "kernel.upgrade.forward_repair",
      "kernel.upgrade.compensation", "kernel.upgrade.forward_repair_verified", "kernel.upgrade.compensation_verified"],
    "kernel.package_version.retire": "kernel.package_version.retired",
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
    "kernel.environment.restore.begin": "kernel.environment.restore_started",
    "kernel.environment.restore.projection_rebuild": "kernel.environment.restore_projection_rebuilt",
    "kernel.environment.restore.verify": "kernel.environment.restore_verified",
    "kernel.environment.restore.resume": "kernel.environment.restore_resumed",
    "kernel.data_lifecycle.record": ["kernel.data_lifecycle.typed_tombstone",
      "kernel.data_lifecycle.authority_expiration", "kernel.data_lifecycle.identity_pseudonymization",
      "kernel.data_lifecycle.environment_destruction"],
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
    emitted_events: /** @type {string[]} */ (
      Array.isArray(emittedEvent) ? emittedEvent : emittedEvent ? [emittedEvent] : []
    ),
    next_operations: []
  };
}

/**
 * @param {string} operationId
 * @param {string} summary
 * @param {string} path
 * @param {string} resultKey
 * @param {string} notFoundIssue
 * @returns {KernelOperationDescriptor}
 */
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
  commandDescriptor("kernel.environment.restore.begin",
    "Suspend restored Environment authority, advance its epoch, and open reconciliation for ambiguous Effects.",
    "/kernel/v0/restores", "restore", ["BACKUP_MANIFEST_DIGEST_MISMATCH", "RESTORE_POINT_MISMATCH"],
    { type: "object", required: ["backup_manifest", "backup_manifest_digest"], additionalProperties: false }),
  commandDescriptor("kernel.environment.restore.projection_rebuild",
    "Rebuild the Butler projection from authoritative restored state with visible cursor and health.",
    "/kernel/v0/restores/{restore_id}/projection-rebuild", "restore", ["RESTORE_NOT_FOUND"],
    { type: "object", additionalProperties: false }),
  commandDescriptor("kernel.environment.restore.verify",
    "Verify transition continuity, artifact digests, projection health, and restore obligations.",
    "/kernel/v0/restores/{restore_id}/verify", "restore", ["RESTORE_VERIFICATION_FAILED"],
    { type: "object", required: ["verified_artifact_digests"], additionalProperties: false }),
  commandDescriptor("kernel.environment.restore.resume",
    "Resume Environment authority only after restore checks and reconciliation complete.",
    "/kernel/v0/restores/{restore_id}/resume", "restore", ["RESTORE_NOT_READY"],
    { type: "object", additionalProperties: false }),
  readDescriptor("kernel.environment.restore.get", "Inspect restore state, projection health, and unresolved obligations.",
    "/kernel/v0/restores/{restore_id}", "restore", "RESTORE_NOT_FOUND"),
  commandDescriptor("kernel.data_lifecycle.record",
    "Record typed tombstone, expiration, identity pseudonymization, or Environment destruction semantics.",
    "/kernel/v0/data-lifecycle-records", "lifecycle_record", ["INVALID_LIFECYCLE_KIND"],
    { type: "object", required: ["lifecycle_kind", "subject_type", "subject_id", "detail"], additionalProperties: false })
);

const upgradeCheckpointInput = {
  type: "object", required: ["checkpoint_ordinal", "checkpoint_name", "input_digest", "output_digest",
    "source_count", "target_count", "invariants", "attestation_signature"], properties: {
    checkpoint_ordinal: { type: "integer", minimum: 0 }, checkpoint_name: { type: "string", minLength: 1 },
    input_digest: { type: "string" }, output_digest: { type: "string" },
    source_count: { type: "integer", minimum: 0 }, target_count: { type: "integer", minimum: 0 },
    invariants: { type: "object", additionalProperties: { type: "boolean" } },
    attestation_signature: { type: "string" }
  }, additionalProperties: false
};

const upgradeCanaryInput = {
  type: "object", required: ["upgrade_plan_id", "attempt_number", "routing_keys", "assignment_digest", "gate_results"], properties: {
    upgrade_plan_id: { type: "string", format: "uuid" },
    attempt_number: { type: "integer", minimum: 1 },
    routing_keys: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
    assignment_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    gate_results: { type: "array", minItems: 1, items: { type: "object",
      required: ["gate_id", "passed", "evidence_digest", "attestation_signature"], properties: {
        gate_id: { type: "string", minLength: 1 }, passed: { type: "boolean" }, evidence_digest: { type: "string" },
        attestation_signature: { type: "string", pattern: "^hmac-sha256:[0-9a-f]{64}$" }
      }, additionalProperties: false } }
  }, additionalProperties: false
};

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
      "CAPABILITY_INACTIVE", "PACKAGE_VERSION_RETIRED", "STALE_CONTEXT", "EXECUTION_BOUNDS_EXCEEDED",
      "EXECUTION_IDEMPOTENCY_CONFLICT"],
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
      "STALE_ACTION_REVISION", "STALE_BUSINESS_APPROVAL", "BUSINESS_APPROVAL_VERSION_MISMATCH",
      "PACKAGE_VERSION_RETIRED"], {
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

descriptors.push(
  commandDescriptor("kernel.coordinator_binding.create", "Create one replaceable local binding to a hosted coordinator.",
    "/kernel/v0/coordinator-bindings", "coordinator_binding", ["ACTIVE_COORDINATOR_BINDING_EXISTS",
      "SECRET_MATERIAL_PROHIBITED"], {
      type: "object", required: ["coordinator_id", "coordinator_endpoint", "coordinator_public_key", "customer_id",
        "promotion_scope", "expires_at"], additionalProperties: false
    }),
  commandDescriptor("kernel.coordinator_binding.revoke", "Revoke hosted coordination without changing local authority.",
    "/kernel/v0/coordinator-bindings/{binding_id}/revoke", "coordinator_binding",
    ["COORDINATOR_BINDING_NOT_FOUND", "REVISION_CONFLICT"], {
      type: "object", required: ["reason", "expected_revision"], additionalProperties: false
    }),
  commandDescriptor("kernel.coordinator.register_outbound", "Register a minimal signed descriptor over a customer-initiated channel.",
    "/kernel/v0/coordinator-registration-sync", "registration", ["COORDINATOR_UNAVAILABLE",
      "COORDINATOR_CHALLENGE_SCOPE_MISMATCH"], { type: "object", additionalProperties: false }),
  commandDescriptor("kernel.promotion.poll_outbound", "Pull signed Promotion Proposals without opening an inbound administration path.",
    "/kernel/v0/promotion-polls", "promotion_proposals", ["COORDINATOR_UNAVAILABLE",
      "PROMOTION_PROPOSAL_SCOPE_MISMATCH"], { type: "object", additionalProperties: false }),
  commandDescriptor("kernel.promotion.request_outbound", "Request one graph-constrained exact Package promotion with signed gates.",
    "/kernel/v0/promotion-requests", "promotion_proposal", ["PROMOTION_GATES_INCOMPLETE",
      "PROMOTION_EDGE_DENIED", "COORDINATOR_UNAVAILABLE"], {
      type: "object", required: ["target_environment_id", "target_class", "package_identity", "manifest_digest",
        "package_artifact_digest", "dependency_lock", "source_receipt_digests", "compatibility", "change_summary",
        "required_configuration_schema", "gate_receipt_ids"], additionalProperties: false
    }),
  readDescriptor("kernel.promotion_proposal.get", "Inspect one immutable coordinator-signed local Promotion Proposal.",
    "/kernel/v0/promotion-proposals/{proposal_id}", "promotion_proposal", "PROMOTION_PROPOSAL_NOT_FOUND"),
  commandDescriptor("kernel.promotion.resolve_local_plan", "Resolve target-local configuration and credential references without hosted authority.",
    "/kernel/v0/promotion-proposals/{proposal_id}/resolve", "promotion_resolution",
    ["TARGET_CONFIGURATION_INCOMPLETE", "TARGET_DEPLOYMENT_PLAN_PACKAGE_MISMATCH"], {
      type: "object", required: ["deployment_plan_id"], additionalProperties: false
    }),
  readDescriptor("kernel.promotion_resolution.get", "Inspect target-local Promotion resolution without configuration values.",
    "/kernel/v0/promotion-proposals/{proposal_id}/resolution", "promotion_resolution", "PROMOTION_RESOLUTION_NOT_FOUND"),
  commandDescriptor("kernel.promotion_receipt.create", "Create a signed local receipt without granting operational authority.",
    "/kernel/v0/promotion-receipts", "promotion_receipt", ["LOCAL_PROMOTION_PREDECESSOR_MISSING",
      "LOCAL_PACKAGE_VALIDATION_UNVERIFIED", "LOCAL_PACKAGE_COMPATIBILITY_UNVERIFIED",
      "LOCAL_DEPLOYMENT_PLAN_UNVERIFIED", "LOCAL_DEPLOYMENT_UNVERIFIED", "LOCAL_ACTIVATION_UNVERIFIED",
      "LOCAL_RECOVERY_UNVERIFIED", "PROMOTION_RECEIPT_SCOPE_MISMATCH", "PROMOTION_PROPOSAL_EXPIRED"], {
      type: "object", required: ["proposal_id", "package_identity", "receipt_type", "local_reference"],
      additionalProperties: false
    }),
  commandDescriptor("kernel.promotion_receipt.deliver_outbound", "Deliver one signed target receipt over the outbound channel.",
    "/kernel/v0/promotion-receipts/{receipt_id}/deliver", "delivery",
    ["PROMOTION_RECEIPT_NOT_FOUND", "COORDINATOR_UNAVAILABLE"], { type: "object", additionalProperties: false })
);

descriptors.push(
  commandDescriptor("kernel.upgrade.compatibility_analyze", "Compare exact active and target user-space contracts.",
    "/kernel/v0/upgrade-compatibility-reports", "compatibility_report",
    ["CURRENT_DEPLOYMENT_NOT_ACTIVE", "UPGRADE_PACKAGE_MISMATCH", "UPGRADE_TARGET_UNCHANGED"], {
      type: "object", required: ["current_deployment_id", "target_deployment_id", "capability_export_id"], properties: {
        current_deployment_id: { type: "string", format: "uuid" },
        target_deployment_id: { type: "string", format: "uuid" },
        capability_export_id: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    }),
  readDescriptor("kernel.upgrade_compatibility_report.get", "Inspect one immutable multidimensional Compatibility Report.",
    "/kernel/v0/upgrade-compatibility-reports/{compatibility_report_id}", "compatibility_report",
    "COMPATIBILITY_REPORT_NOT_FOUND"),
  commandDescriptor("kernel.upgrade.activation_policy_create", "Preapprove one exact authority-equivalent Compatibility Report.",
    "/kernel/v0/upgrade-activation-policies", "upgrade_activation_policy",
    ["AUTHORITY_NOT_EQUIVALENT", "INVALID_POLICY_EXPIRY"], {
      type: "object", required: ["compatibility_report_id", "rationale", "expires_at"], properties: {
        compatibility_report_id: { type: "string", format: "uuid" },
        rationale: { type: "string", minLength: 1, maxLength: 2000 },
        expires_at: { type: "string", format: "date-time" }
      }, additionalProperties: false
    }),
  readDescriptor("kernel.upgrade_activation_policy.get", "Inspect one immutable report-bound Upgrade Activation Policy.",
    "/kernel/v0/upgrade-activation-policies/{upgrade_activation_policy_id}", "upgrade_activation_policy",
    "UPGRADE_ACTIVATION_POLICY_NOT_FOUND"),
  commandDescriptor("kernel.upgrade.plan_create", "Bind exact versions, migration, canary, verification, repair, and retirement.",
    "/kernel/v0/upgrade-plans", "upgrade_plan", ["UPGRADE_UNSUPPORTED", "BUSINESS_PAYLOAD_PROHIBITED",
      "FORWARD_REPAIR_REQUIRED", "ROLLBACK_BOUNDARY_REQUIRED", "BREAKING_MAJOR_REQUIRED",
      "UPGRADE_PREAPPROVAL_MISMATCH", "AUTHORITY_NOT_EQUIVALENT"], {
      type: "object", required: ["compatibility_report_id", "migration", "canary", "verification", "repair",
        "retention_until"], properties: {
        compatibility_report_id: { type: "string", format: "uuid" },
        preapproval_policy_id: { type: "string", format: "uuid" },
        migration: { type: "object", required: ["declaration_version", "scope", "checkpoints"], properties: {
          declaration_version: { type: "string", minLength: 1 }, scope: { type: "string", minLength: 1 },
          checkpoints: { type: "array", minItems: 1, items: { type: "object", required: ["name", "invariants"],
            properties: { name: { type: "string", minLength: 1 },
              invariants: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } } },
            additionalProperties: false } }
        }, additionalProperties: false },
        canary: { type: "object", required: ["seed", "basis_points", "gates"], properties: {
          seed: { type: "string", minLength: 1 }, basis_points: { type: "integer", minimum: 1, maximum: 10000 },
          gates: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } }
        }, additionalProperties: false },
        verification: { type: "object", required: ["criteria"], properties: {
          criteria: { type: "array", minItems: 1, uniqueItems: true, contains: { const: "zero_undeclared_effects" },
            items: { type: "string", minLength: 1 } }
        }, additionalProperties: false },
        repair: { type: "object", required: ["reversibility", "strategy"], properties: {
          reversibility: { enum: ["reversible", "conditionally_reversible", "forward_only"] },
          strategy: { type: "string", minLength: 1 }, forward_repair_capability_id: { type: "string", minLength: 1 },
          rollback_boundary: { type: "object", required: ["allowed_real_world_changes", "expires_at"], properties: {
            allowed_real_world_changes: { type: "array", minItems: 1, uniqueItems: true,
              items: { enum: ["none", "compatible"] } },
            expires_at: { type: "string", format: "date-time" }
          }, additionalProperties: false }
        }, additionalProperties: false },
        retention_until: { type: "string", format: "date-time" }
      }, additionalProperties: false
    }),
  readDescriptor("kernel.upgrade_plan.get", "Inspect one immutable Upgrade Plan and mutable lifecycle state.",
    "/kernel/v0/upgrade-plans/{upgrade_plan_id}", "upgrade_plan", "UPGRADE_PLAN_NOT_FOUND"),
  commandDescriptor("kernel.upgrade.migration_start", "Start resumable Package-owned state migration without external effects.",
    "/kernel/v0/upgrade-migrations", "migration_run", ["UPGRADE_PHASE_MISMATCH"], {
      type: "object", required: ["upgrade_plan_id"], properties: {
        upgrade_plan_id: { type: "string", format: "uuid" }
      }, additionalProperties: false
    }),
  readDescriptor("kernel.upgrade_migration.get", "Inspect one resumable migration and its next checkpoint.",
    "/kernel/v0/upgrade-migrations/{migration_run_id}", "migration_run", "MIGRATION_RUN_NOT_FOUND"),
  commandDescriptor("kernel.upgrade.migration_checkpoint", "Record one exact ordered migration checkpoint.",
    "/kernel/v0/upgrade-migrations/{migration_run_id}/checkpoints", "migration_checkpoint",
    ["MIGRATION_CHECKPOINT_OUT_OF_ORDER", "MIGRATION_CHECKPOINT_UNDECLARED", "MIGRATION_INVARIANT_FAILED"],
    upgradeCheckpointInput),
  commandDescriptor("kernel.upgrade.migration_verify", "Verify all migration checkpoints and declared invariants.",
    "/kernel/v0/upgrade-migrations/{migration_run_id}/verify", "migration_verification",
    ["MIGRATION_INCOMPLETE", "MIGRATION_VERIFICATION_FAILED"], {
      type: "object", required: ["criteria", "attestation_signature"], properties: {
        criteria: { type: "object", additionalProperties: { type: "boolean" } },
        attestation_signature: { type: "string" }
      }, additionalProperties: false
    }),
  commandDescriptor("kernel.upgrade.canary_evaluate", "Evaluate a reproducible deterministic cohort and pause failed gates.",
    "/kernel/v0/upgrade-canary-attempts", "canary_attempt", ["CANARY_GATES_MISMATCH", "UPGRADE_PHASE_MISMATCH",
      "CANARY_COHORT_EMPTY", "DUPLICATE_CANARY_ROUTING_KEY", "CANARY_ASSIGNMENT_MISMATCH",
      "CANARY_ATTEMPT_MISMATCH", "INVALID_CONTROL_PLANE_ATTESTATION"], upgradeCanaryInput),
  commandDescriptor("kernel.upgrade.activate", "Activate the exact target after migration, canary, and authority gates.",
    "/kernel/v0/upgrade-activations", "upgrade_activation", ["UPGRADE_SOURCE_CHANGED",
      "UPGRADE_PREAPPROVAL_MISSING", "UPGRADE_PREAPPROVAL_MISMATCH", "FRESH_BUSINESS_APPROVAL_REQUIRED",
      "MIGRATION_ATTESTATION_REQUIRED", "INVALID_CONTROL_PLANE_ATTESTATION"], {
      type: "object", required: ["upgrade_plan_id"], properties: {
        upgrade_plan_id: { type: "string", format: "uuid" }, business_approval_id: { type: "string", format: "uuid" }
      }, additionalProperties: false
    }),
  commandDescriptor("kernel.upgrade.recovery_record", "Record honest deployment rollback, forward repair, or compensation.",
    "/kernel/v0/upgrade-recovery-actions", "upgrade_recovery_action",
    ["FALSE_ROLLBACK_PROHIBITED", "FORWARD_ONLY_ROLLBACK_PROHIBITED", "UNRESOLVED_REAL_WORLD_CHANGE",
      "ROLLBACK_BOUNDARY_EXPIRED", "ROLLBACK_REALITY_OUTSIDE_BOUNDARY", "INVALID_CONTROL_PLANE_ATTESTATION",
      "RECOVERY_ACTION_BINDING_MISMATCH", "REPAIR_VERIFICATION_PHASE_MISMATCH", "UPGRADE_STATE_CHANGED",
      "FORWARD_REPAIR_BINDING_REQUIRED", "FORWARD_REPAIR_BINDING_MISMATCH", "UPGRADE_NOT_ACTIVE"], {
      type: "object", required: ["upgrade_plan_id", "action_type", "real_world_change", "reference_digest", "detail"],
      properties: { upgrade_plan_id: { type: "string", format: "uuid" },
        action_type: { enum: ["deployment_rollback", "forward_repair", "compensation",
          "forward_repair_verified", "compensation_verified"] },
        real_world_change: { enum: ["none", "compatible", "incompatible"] },
        reference_digest: { type: "string" }, detail: { type: "object" },
        attestation_signature: { type: "string", pattern: "^hmac-sha256:[0-9a-f]{64}$" },
        resolves_recovery_action_id: { type: "string", format: "uuid" },
        expected_state_revision: { type: "integer", minimum: 0 },
        forward_repair_binding: { type: "object", required: ["deployment_id", "package_version_id",
          "capability_export_id", "capability_contract_version", "capability_export_digest", "authority_digest"],
          properties: { deployment_id: { type: "string", format: "uuid" },
            package_version_id: { type: "string", format: "uuid" }, capability_export_id: { type: "string" },
            capability_contract_version: { type: "string" }, capability_export_digest: { type: "string" },
            authority_digest: { type: "string" } }, additionalProperties: false } }, additionalProperties: false
    }),
  {
    ...readDescriptor("kernel.package_retirement_status.get", "Inspect all references blocking old Package retirement.",
      "/kernel/v0/upgrade-plans/{upgrade_plan_id}/retirement-status", "retirement_status", "UPGRADE_PLAN_NOT_FOUND"),
    input_schema: { type: "object", required: ["upgrade_plan_id"], properties: {
      upgrade_plan_id: { type: "string", format: "uuid" }
    } }
  },
  commandDescriptor("kernel.package_version.retire", "Retire old admissions only after every user-space reference closes.",
    "/kernel/v0/package-retirements", "package_retirement", ["PACKAGE_RETIREMENT_BLOCKED", "UPGRADE_PHASE_MISMATCH"], {
      type: "object", required: ["upgrade_plan_id"], properties: {
        upgrade_plan_id: { type: "string", format: "uuid" }
      }, additionalProperties: false
    })
);

descriptors.push(
  commandDescriptor("kernel.environment_health.publish_outbound",
    "Publish signed coarse health without business payloads.",
    "/kernel/v0/environment-health-publications", "environment_health", ["COORDINATOR_UNAVAILABLE"],
    { type: "object", additionalProperties: false }),
  commandDescriptor("kernel.support.poll_outbound",
    "Pull exact signed support requests without opening an inbound administration path.",
    "/kernel/v0/support-polls", "support_cases", ["COORDINATOR_UNAVAILABLE", "SUPPORT_CASE_SCOPE_MISMATCH"],
    { type: "object", additionalProperties: false }),
  commandDescriptor("kernel.support_case.approve",
    "Issue a customer-approved temporary read-only Support Passport.",
    "/kernel/v0/support-cases/{support_case_id}/approve", "support_passport",
    ["SUPPORT_CASE_NOT_FOUND", "SUPPORT_CASE_EXPIRED", "REVISION_CONFLICT"], {
      type: "object", required: ["authentication_digest", "duration_seconds", "expected_revision"],
      additionalProperties: false
    }),
  commandDescriptor("kernel.support_passport.deliver_outbound",
    "Notify the coordinator of Support Passport scope without disclosing its credential.",
    "/kernel/v0/support-passports/{support_passport_id}/deliver", "support_passport_notice",
    ["SUPPORT_PASSPORT_NOT_FOUND", "COORDINATOR_UNAVAILABLE"], { type: "object", additionalProperties: false }),
  commandDescriptor("kernel.diagnostic_bundle.create",
    "Create one explicit immutable encrypted redacted diagnostic bundle.",
    "/kernel/v0/diagnostic-bundles", "diagnostic_bundle",
    ["SUPPORT_PASSPORT_INACTIVE", "DIAGNOSTIC_SCOPE_DENIED"], {
      type: "object", required: ["support_passport_id", "diagnostic_scopes", "expires_in_seconds"],
      additionalProperties: false
    }),
  readDescriptor("kernel.diagnostic_bundle.get",
    "Inspect encrypted diagnostic metadata and immutable access history.",
    "/kernel/v0/diagnostic-bundles/{diagnostic_bundle_id}", "diagnostic_bundle", "DIAGNOSTIC_BUNDLE_NOT_FOUND"),
  commandDescriptor("kernel.support_remediation.authorize",
    "Ledger a support remediation request behind one exact locally active Capability.",
    "/kernel/v0/support-remediation-authorizations", "remediation_authorization",
    ["SUPPORT_PASSPORT_INACTIVE", "CAPABILITY_INACTIVE", "CAPABILITY_VERSION_MISMATCH"], {
      type: "object", required: ["support_passport_id", "capability_admission", "requested_action"],
      additionalProperties: false
    }),
  commandDescriptor("kernel.runtime_host.quarantine",
    "Block placement, fence workloads, and revoke and rotate one host key.",
    "/kernel/v0/runtime-hosts/{host_id}/quarantine", "host",
    ["HOST_REVISION_CONFLICT", "HOST_ALREADY_QUARANTINED"], {
      type: "object", required: ["current_key_id", "reason", "expected_revision"], additionalProperties: false
    }),
  commandDescriptor("kernel.coordinator_binding.revocation_sync",
    "Remove hosted visibility and support after local Coordinator Binding revocation.",
    "/kernel/v0/coordinator-bindings/{binding_id}/revocation-sync", "binding_revocation",
    ["COORDINATOR_BINDING_NOT_FOUND", "COORDINATOR_UNAVAILABLE"], {
      type: "object", required: ["reason"], additionalProperties: false
    }),
  {
    operation_id: "kernel.runtime_host.placement_admission", version: "0.1.0",
    summary: "Deny placement on quarantined hosts and revoked host keys.", visibility: "public",
    authority_class: "authenticated_substrate_adapter", effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "POST", path: "/internal/v0/runtime-hosts/placement-admission" },
    input_schema: { type: "object", required: ["host_id", "host_key_id"] },
    output_schema: { type: "object", required: ["admissible", "basis", "host_id"] },
    supported_modes: ["live"], preconditions: [], outcomes: ["placement_admissible", "placement_denied"],
    issues: [], emitted_events: [], next_operations: []
  },
  {
    operation_id: "kernel.support_diagnostic.read", version: "0.1.0",
    summary: "Read one authorized redacted diagnostic bundle and append an access record.", visibility: "public",
    authority_class: "active_read_only_support_passport", effect_class: "read_only",
    idempotency: "read_is_repeatable_but_each_access_is_logged",
    transport: { method: "GET", path: "/support/v0/diagnostic-bundles/{diagnostic_bundle_id}" },
    input_schema: { type: "object", required: ["diagnostic_bundle_id"] },
    output_schema: { type: "object", required: ["diagnostic_bundle_id", "content_digest", "diagnostics", "accessed_at"] },
    supported_modes: ["live"], preconditions: ["active_unexpired_support_passport", "active_coordinator_binding"],
    outcomes: ["diagnostic_bundle_returned", "access_recorded"],
    issues: ["SUPPORT_AUTHENTICATION_FAILED", "DIAGNOSTIC_BUNDLE_UNAVAILABLE"], emitted_events: [], next_operations: []
  }
);

descriptors.push(
  {
    operation_id: "kernel.diagnostic_dispatch.authorize",
    version: "0.1.0",
    summary: "Authorize one exact eligible diagnostic worker and runtime proposal without launching it or issuing model credentials.",
    visibility: "public",
    authority_class: "authenticated_customer_owner_or_exact_trusted_operator",
    effect_class: "single_use_diagnostic_dispatch_authority",
    idempotency: "command_id_and_exact_dispatch_candidate",
    transport: { method: "POST", path: "/kernel/v0/diagnostic-dispatch-authorizations" },
    input_schema: {
      type: "object",
      required: ["command_id", "operation_id", "input"],
      additionalProperties: false,
      properties: {
        command_id: { type: "string", minLength: 1, maxLength: 160 },
        operation_id: { const: "kernel.diagnostic_dispatch.authorize" },
        input: { type: "object", required: ["candidate"], additionalProperties: false,
          properties: { candidate: { type: "object" } } }
      }
    },
    output_schema: { type: "object", required: ["diagnostic_dispatch_authorization", "transition"] },
    supported_modes: ["live"],
    preconditions: ["assignment_unclaimed_and_current", "material_currently_available",
      "worker_passport_active_and_exact", "zero_external_effect_authority",
      "runtime_model_broker_data_and_resource_boundaries_match"],
    outcomes: ["diagnostic_dispatch_authorized", "command_replayed"],
    issues: ["DIAGNOSTIC_DISPATCH_ASSIGNMENT_NOT_ELIGIBLE",
      "DIAGNOSTIC_DISPATCH_MATERIAL_UNAVAILABLE", "DIAGNOSTIC_DISPATCH_PASSPORT_INELIGIBLE",
      "DIAGNOSTIC_DISPATCH_RUNTIME_POLICY_MISMATCH", "DIAGNOSTIC_DISPATCH_RESOURCE_LIMIT_EXCEEDED"],
    emitted_events: ["kernel.diagnostic_dispatch.authorized"],
    next_operations: ["kernel.diagnostic_dispatch_authorization.get", "diagnostic.assignment.claim"]
  },
  {
    operation_id: "kernel.diagnostic_dispatch_authorization.get",
    version: "0.1.0",
    summary: "Inspect immutable Kernel issuance without pretending Diagnostic Plane consumption is Kernel state.",
    visibility: "public",
    authority_class: "authenticated_customer_owner",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/diagnostic-dispatch-authorizations/{dispatch_authorization_id}" },
    input_schema: { type: "object", required: ["dispatch_authorization_id"],
      properties: { dispatch_authorization_id: { type: "string", format: "uuid" } } },
    output_schema: { type: "object", required: ["diagnostic_dispatch_authorization"] },
    supported_modes: ["live"],
    preconditions: [],
    outcomes: ["diagnostic_dispatch_authorization_returned"],
    issues: ["DIAGNOSTIC_DISPATCH_AUTHORIZATION_NOT_FOUND",
      "DIAGNOSTIC_DISPATCH_AUTHORIZATION_INTEGRITY_VIOLATION"],
    emitted_events: [],
    next_operations: ["diagnostic.assignment.claim"]
  },
  {
    operation_id: "kernel.coverage_review.approve",
    version: "0.1.0",
    summary: "Bind one named human to exact immutable review bytes without granting business execution authority.",
    visibility: "public",
    authority_class: "named_customer_owner_or_exact_trusted_operator",
    effect_class: "immutable_human_coverage_review_approval",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: { method: "POST", path: "/kernel/v0/coverage-review-approvals" },
    input_schema: {
      type: "object", required: ["command_id", "operation_id", "input"], additionalProperties: false,
      properties: {
        command_id: { type: "string", minLength: 1, maxLength: 160 },
        operation_id: { const: "kernel.coverage_review.approve" },
        input: coverageReviewApproveInput
      }
    },
    output_schema: {
      type: "object", required: ["command_id", "request_digest", "accepted_at", "operation_id",
        "coverage_review_approval", "created", "transition"], additionalProperties: false,
      properties: {
        command_id: { type: "string" }, request_digest: { type: "string" },
        accepted_at: { type: "string", format: "date-time" },
        operation_id: { const: "kernel.coverage_review.approve" },
        coverage_review_approval: coverageReviewApprovalSchema,
        created: { type: "boolean" }, transition: { type: "object" }
      }
    },
    supported_modes: ["live"],
    preconditions: ["exact_current_review_bundle", "exact_confirmed_work_intent",
      "named_human_principal", "fixed_non_escalating_authority_boundary"],
    outcomes: ["exact_review_approval_recorded", "compile_and_registration_request_eligibility_only",
      "command_replayed"],
    issues: ["COVERAGE_REVIEW_HUMAN_APPROVAL_REQUIRED", "COVERAGE_REVIEW_APPROVAL_STATE_CONFLICT",
      "COVERAGE_REVIEW_AUTHORITY_INVALID", "IDEMPOTENCY_CONFLICT"],
    emitted_events: ["kernel.coverage_review.approved"],
    next_operations: ["kernel.coverage_review_approval.get"]
  },
  {
    operation_id: "kernel.coverage_review_approval.get",
    version: "0.1.0",
    summary: "Derive current exact-bundle approval eligibility while preserving immutable approval history.",
    visibility: "public",
    authority_class: "authenticated_customer_owner",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/kernel/v0/coverage-review-approvals/{approval_id}" },
    input_schema: { type: "object", required: ["approval_id"], additionalProperties: false,
      properties: { approval_id: { type: "string", format: "uuid" } } },
    output_schema: { type: "object", required: ["coverage_review_approval"], additionalProperties: false,
      properties: { coverage_review_approval: coverageReviewApprovalSchema } },
    supported_modes: ["live"],
    preconditions: ["authenticated_customer_owner", "approval_exists"],
    outcomes: ["eligible", "review_required", "expired"],
    issues: ["COVERAGE_REVIEW_APPROVAL_NOT_FOUND", "COVERAGE_REVIEW_APPROVAL_INTEGRITY_VIOLATION"],
    emitted_events: [],
    next_operations: ["kernel.coverage_compilation.compile", "kernel.coverage_registration.request"]
  }
);

/**
 * @returns {KernelOperationDescriptor[]}
 */
export function listOperationDescriptors() {
  return structuredClone(descriptors);
}

/**
 * @param {string} operationId
 * @returns {KernelOperationDescriptor | null}
 */
export function getOperationDescriptor(operationId) {
  const descriptor = descriptors.find((item) => item.operation_id === operationId);
  return descriptor ? structuredClone(descriptor) : null;
}
