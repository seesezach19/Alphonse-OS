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

const coverageWorkflowReference = {
  type: "object",
  required: ["system", "environment", "provider_workflow_id"],
  additionalProperties: false,
  properties: {
    system: { type: "string", minLength: 1, maxLength: 80 },
    environment: { type: "string", minLength: 1, maxLength: 80 },
    provider_workflow_id: { type: "string", minLength: 1, maxLength: 200 }
  }
};

const coverageAdapterBinding = {
  type: "object",
  required: [
    "adapter_id", "adapter_version", "contract_version", "inventory_scope_id", "inventory_scope_digest"
  ],
  additionalProperties: false,
  properties: {
    adapter_id: { type: "string", minLength: 1, maxLength: 160 },
    adapter_version: { type: "string", minLength: 1, maxLength: 100 },
    contract_version: { type: "string", minLength: 1, maxLength: 100 },
    inventory_scope_id: { type: "string", minLength: 3, maxLength: 160 },
    inventory_scope_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
  }
};

const coverageOnboardingOpenInput = {
  type: "object",
  required: [
    "environment_id", "reason", "prior_onboarding_id", "work_intent_id", "passport_id",
    "agent_principal_id", "workflow_reference", "adapter_binding"
  ],
  additionalProperties: false,
  properties: {
    environment_id: { type: "string", format: "uuid" },
    reason: { enum: ["initial_coverage", "revision_change"] },
    prior_onboarding_id: { type: ["string", "null"], format: "uuid" },
    work_intent_id: { type: "string", format: "uuid" },
    passport_id: { type: "string", format: "uuid" },
    agent_principal_id: { type: "string", format: "uuid" },
    workflow_reference: coverageWorkflowReference,
    adapter_binding: coverageAdapterBinding
  }
};

const coverageEvidenceCaptureInput = {
  type: "object",
  required: [
    "onboarding_id", "passport_id", "expected_revision", "inventory_request", "selection",
    "redaction_policy_id"
  ],
  additionalProperties: false,
  properties: {
    onboarding_id: { type: "string", format: "uuid" },
    passport_id: { type: "string", format: "uuid" },
    expected_revision: { type: "integer", minimum: 1 },
    inventory_request: {
      type: "object",
      required: ["scope_id", "page_size", "cursor"],
      additionalProperties: false,
      properties: {
        scope_id: { type: "string", minLength: 3, maxLength: 160 },
        page_size: { type: "integer", minimum: 1, maximum: 250 },
        cursor: { type: ["string", "null"], maxLength: 4096 }
      }
    },
    selection: {
      type: "object",
      required: [
        "provider_workflow_id", "expected_scope_digest", "expected_page_digest", "expected_metadata_digest"
      ],
      additionalProperties: false,
      properties: {
        provider_workflow_id: { type: "string", minLength: 1, maxLength: 200 },
        expected_scope_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        expected_page_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        expected_metadata_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
      }
    },
    redaction_policy_id: { const: "alphonse.workflow-discovery-redaction.v0.1" }
  }
};

const coverageEvidenceReference = {
  type: "object",
  required: ["artifact_digest", "json_pointer"],
  additionalProperties: false,
  properties: {
    artifact_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    json_pointer: { type: "string", minLength: 1, maxLength: 1000, pattern: "^/" }
  }
};

const coverageInterpretationAssignInput = {
  type: "object",
  required: [
    "onboarding_id", "snapshot_digest", "expected_revision", "passport_id", "agent_principal_id",
    "work_intent_id", "expires_at"
  ],
  additionalProperties: false,
  properties: {
    onboarding_id: { type: "string", format: "uuid" },
    snapshot_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    expected_revision: { type: "integer", minimum: 2 },
    passport_id: { type: "string", format: "uuid" },
    agent_principal_id: { type: "string", format: "uuid" },
    work_intent_id: { type: "string", format: "uuid" },
    expires_at: { type: "string", format: "date-time" }
  }
};

const coverageClaimInput = {
  type: "object",
  required: [
    "claim_id", "kind", "status", "statement", "evidence_references", "confidence",
    "conflicting_evidence_references", "unknown_reason", "limitations"
  ],
  additionalProperties: false,
  properties: {
    claim_id: { type: "string", minLength: 1, maxLength: 160 },
    kind: { enum: ["objective", "consequence", "integration", "effect", "dependency", "limitation"] },
    status: { enum: ["observed", "inferred", "conflicted", "unknown"] },
    statement: { type: "string", minLength: 1, maxLength: 3000 },
    evidence_references: { type: "array", minItems: 1, maxItems: 30, items: coverageEvidenceReference },
    confidence: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
    conflicting_evidence_references: {
      type: "array", maxItems: 30, items: coverageEvidenceReference
    },
    unknown_reason: { type: ["string", "null"], maxLength: 1000 },
    limitations: { type: "array", maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 1000 } }
  }
};

const coverageAmbiguityInput = {
  type: "object",
  required: [
    "ambiguity_id", "kind", "claim_references", "question", "blocking", "choices",
    "evidence_references"
  ],
  additionalProperties: false,
  properties: {
    ambiguity_id: { type: "string", minLength: 1, maxLength: 160 },
    kind: { enum: [
      "objective", "consequence", "evidence", "effect", "privacy", "fixture", "repair", "promotion", "rollback"
    ] },
    claim_references: { type: "array", minItems: 1, maxItems: 30,
      items: { type: "string", minLength: 1, maxLength: 160 } },
    question: { type: "string", minLength: 1, maxLength: 2000 },
    blocking: { type: "boolean" },
    choices: { type: "array", minItems: 2, maxItems: 20, items: {
      type: "object", required: ["choice_id", "meaning"], additionalProperties: false,
      properties: {
        choice_id: { type: "string", minLength: 1, maxLength: 160 },
        meaning: { type: "string", minLength: 1, maxLength: 1000 }
      }
    } },
    evidence_references: { type: "array", minItems: 1, maxItems: 30, items: coverageEvidenceReference }
  }
};

const coverageInterpretationSubmitInput = {
  type: "object",
  required: [
    "assignment_id", "onboarding_id", "snapshot_digest", "expected_revision", "proposed_at",
    "claims", "ambiguities", "provenance", "supersedes_interpretation_digest"
  ],
  additionalProperties: false,
  properties: {
    assignment_id: { type: "string", format: "uuid" },
    onboarding_id: { type: "string", format: "uuid" },
    snapshot_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    expected_revision: { type: "integer", minimum: 2 },
    proposed_at: { type: "string", format: "date-time" },
    claims: { type: "array", minItems: 1, maxItems: 100, items: coverageClaimInput },
    ambiguities: { type: "array", maxItems: 100, items: coverageAmbiguityInput },
    provenance: {
      type: "object",
      required: [
        "passport_id", "work_intent_id", "instruction_digest", "model", "runtime",
        "input_artifact_digests"
      ],
      additionalProperties: false,
      properties: {
        passport_id: { type: "string", format: "uuid" },
        work_intent_id: { type: "string", format: "uuid" },
        instruction_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        model: { type: "object", required: ["provider", "model", "version"], additionalProperties: false,
          properties: { provider: { type: "string" }, model: { type: "string" }, version: { type: "string" } } },
        runtime: { type: "object", required: ["name", "version"], additionalProperties: false,
          properties: { name: { type: "string" }, version: { type: "string" } } },
        input_artifact_digests: { type: "array", minItems: 1, maxItems: 30,
          items: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } }
      }
    },
    supersedes_interpretation_digest: {
      type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$"
    }
  }
};

const coverageAmbiguityResolveInput = {
  type: "object",
  required: [
    "onboarding_id", "ambiguity_id", "ambiguity_digest", "expected_revision", "disposition",
    "choice_id", "supplied_value", "work_intent_id", "scope", "rationale"
  ],
  additionalProperties: false,
  properties: {
    onboarding_id: { type: "string", format: "uuid" },
    ambiguity_id: { type: "string", minLength: 1, maxLength: 160 },
    ambiguity_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    expected_revision: { type: "integer", minimum: 4 },
    disposition: { enum: ["selected_choice", "supplied_value", "accepted_unknown"] },
    choice_id: { type: ["string", "null"], maxLength: 160 },
    supplied_value: { type: ["string", "number", "boolean", "null"] },
    work_intent_id: { type: "string", format: "uuid" },
    scope: { enum: ["exact_workflow", "exact_revision", "exact_profile_version"] },
    rationale: { type: "string", minLength: 1, maxLength: 2000 }
  }
};

const coverageReviewArtifactReference = {
  type: "object",
  required: ["reference_kind", "reference_id", "artifact_digest"],
  additionalProperties: false,
  properties: {
    reference_kind: { type: "string", minLength: 1, maxLength: 100 },
    reference_id: { type: "string", minLength: 1, maxLength: 200 },
    artifact_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
  }
};

const coverageReviewBundleCreateInput = {
  type: "object",
  required: [
    "onboarding_id", "expected_revision", "expected_event_head_digest", "snapshot_digest",
    "interpretation_digest", "integration_contract_references", "behavior_contract_references",
    "fixture_references", "repair_binding_reference", "verification_strategy_reference",
    "coverage_profile_reference"
  ],
  additionalProperties: false,
  properties: {
    onboarding_id: { type: "string", format: "uuid" },
    expected_revision: { type: "integer", minimum: 4 },
    expected_event_head_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    snapshot_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    interpretation_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    integration_contract_references: { type: "array", maxItems: 100,
      items: coverageReviewArtifactReference },
    behavior_contract_references: { type: "array", maxItems: 100,
      items: coverageReviewArtifactReference },
    fixture_references: { type: "array", maxItems: 100, items: coverageReviewArtifactReference },
    repair_binding_reference: { anyOf: [{ type: "null" }, coverageReviewArtifactReference] },
    verification_strategy_reference: { anyOf: [{ type: "null" }, coverageReviewArtifactReference] },
    coverage_profile_reference: { anyOf: [{ type: "null" }, coverageReviewArtifactReference] }
  }
};

const coverageReviewBundleSchema = {
  type: "object",
  required: [
    "review_bundle_id", "review_bundle_digest", "size_bytes", "media_type", "onboarding_id",
    "onboarding_revision", "event_head_digest", "workflow_reference_digest", "snapshot_digest",
    "interpretation_digest", "confirmation_manifest_digest", "reference_manifest_digest",
    "content", "created_by", "created_at", "authority", "immutable"
  ],
  additionalProperties: false,
  properties: {
    review_bundle_id: { type: "string", format: "uuid" },
    review_bundle_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    size_bytes: { type: "integer", minimum: 0 },
    media_type: { const: "application/json" },
    onboarding_id: { type: "string", format: "uuid" },
    onboarding_revision: { type: "integer", minimum: 4 },
    event_head_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    workflow_reference_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    snapshot_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    interpretation_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    confirmation_manifest_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    reference_manifest_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    content: { type: "object" },
    created_by: { type: "object" },
    created_at: { type: "string", format: "date-time" },
    authority: { const: "none" },
    immutable: { const: true }
  }
};

const implementationIdentitySchema = {
  type: "object",
  required: ["id", "version", "artifact_digest"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1, maxLength: 160 },
    version: { type: "string", minLength: 1, maxLength: 80 },
    artifact_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
  }
};

const coverageCompilationInput = {
  type: "object",
  required: ["onboarding_id", "review_bundle_digest", "approval_id", "approval_digest",
    "expected_review_state_digest", "base_manifest_reference", "compiler"],
  additionalProperties: false,
  properties: {
    onboarding_id: { type: "string", format: "uuid" },
    review_bundle_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    approval_id: { type: "string", format: "uuid" },
    approval_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    expected_review_state_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    base_manifest_reference: { anyOf: [{ type: "null" }, coverageReviewArtifactReference] },
    compiler: implementationIdentitySchema
  }
};

const coverageValidationInput = {
  type: "object",
  required: ["onboarding_id", "compilation_id", "compilation_input_digest",
    "coverage_specification_digest", "workflow_manifest_proposal_digest", "validator"],
  additionalProperties: false,
  properties: {
    onboarding_id: { type: "string", format: "uuid" },
    compilation_id: { type: "string", format: "uuid" },
    compilation_input_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    coverage_specification_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    workflow_manifest_proposal_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    validator: implementationIdentitySchema
  }
};

const coverageCompilationSchema = {
  type: "object",
  required: ["compilation_id", "onboarding_id", "review_bundle_digest", "approval_id",
    "approval_digest", "review_state_digest", "compilation_input", "compilation_input_digest",
    "compiler", "coverage_specification_digest", "workflow_manifest_proposal_digest",
    "coverage_specification", "workflow_manifest_proposal", "compiled_by", "compiled_at",
    "side_effects", "authority", "immutable"],
  additionalProperties: false,
  properties: {
    compilation_id: { type: "string", format: "uuid" },
    onboarding_id: { type: "string", format: "uuid" },
    review_bundle_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    approval_id: { type: "string", format: "uuid" },
    approval_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    review_state_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    compilation_input: { type: "object" },
    compilation_input_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    compiler: implementationIdentitySchema,
    coverage_specification_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    workflow_manifest_proposal_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    coverage_specification: { type: "object" },
    workflow_manifest_proposal: { type: "object" },
    compiled_by: { type: "object" },
    compiled_at: { type: "string", format: "date-time" },
    side_effects: { const: "none" },
    authority: { const: "none" },
    immutable: { const: true }
  }
};

const coverageValidationSchema = {
  type: "object",
  required: ["validation_id", "compilation_id", "onboarding_id", "validation_input_digest",
    "validation_receipt_digest", "validator", "status", "workflow_manifest_proposal_digest",
    "receipt", "validated_by", "validated_at", "registration_request_eligible", "authority", "immutable"],
  additionalProperties: false,
  properties: {
    validation_id: { type: "string", format: "uuid" },
    compilation_id: { type: "string", format: "uuid" },
    onboarding_id: { type: "string", format: "uuid" },
    validation_input_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    validation_receipt_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    validator: implementationIdentitySchema,
    status: { enum: ["valid", "invalid"] },
    workflow_manifest_proposal_digest: { type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$" },
    receipt: { type: "object" },
    validated_by: { type: "object" },
    validated_at: { type: "string", format: "date-time" },
    registration_request_eligible: { const: false },
    authority: { const: "none" },
    immutable: { const: true }
  }
};

const coverageProjectionSchema = {
  type: "object",
  required: [
    "schema_version", "onboarding_id", "installation_id", "environment_id", "reason",
    "prior_onboarding_id", "workflow_reference", "work_intent", "agent", "adapter_binding",
    "identity_digest", "revision", "event_head_digest", "status", "active_snapshot_digest",
    "active_interpretation_digest", "active_review_bundle_digest", "latest_review_invalidation_event_digest",
    "active_compilation_id", "active_coverage_specification_digest",
    "active_workflow_manifest_proposal_digest", "active_validation_id",
    "active_validation_receipt_digest", "validation_status",
    "superseded_snapshot_digests", "superseded_interpretation_digests",
    "snapshot_history", "interpretation_history", "interpretation_assignments", "review_bundle_history",
    "compilation_history", "validation_history", "ambiguities",
    "blocking_ambiguity_ids", "unresolved_nonblocking_ambiguity_ids", "limitations", "review_eligible",
    "legal_next_operations", "events", "opened_at",
    "authority", "immutable"
  ],
  additionalProperties: false,
  properties: {
    schema_version: { const: "alphonse.coverage-onboarding-projection.v0.1" },
    onboarding_id: { type: "string", format: "uuid" },
    installation_id: { type: "string", format: "uuid" },
    environment_id: { type: "string", format: "uuid" },
    reason: { enum: ["initial_coverage", "revision_change"] },
    prior_onboarding_id: { type: ["string", "null"], format: "uuid" },
    workflow_reference: coverageWorkflowReference,
    work_intent: { type: "object" },
    agent: { type: "object" },
    adapter_binding: coverageAdapterBinding,
    identity_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    revision: { type: "integer", minimum: 1 },
    event_head_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    status: { enum: ["gathering_evidence", "interpreting", "resolving_ambiguity", "reviewable",
      "awaiting_approval", "compiled", "validated", "validation_failed", "review_required"] },
    active_snapshot_digest: { type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$" },
    active_interpretation_digest: { type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$" },
    active_review_bundle_digest: { type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$" },
    latest_review_invalidation_event_digest: {
      type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$"
    },
    active_compilation_id: { type: ["string", "null"], format: "uuid" },
    active_coverage_specification_digest: {
      type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$"
    },
    active_workflow_manifest_proposal_digest: {
      type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$"
    },
    active_validation_id: { type: ["string", "null"], format: "uuid" },
    active_validation_receipt_digest: {
      type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$"
    },
    validation_status: { type: ["string", "null"], enum: ["valid", "invalid", null] },
    superseded_snapshot_digests: { type: "array", items: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } },
    superseded_interpretation_digests: { type: "array",
      items: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } },
    snapshot_history: { type: "array" },
    interpretation_history: { type: "array" },
    interpretation_assignments: { type: "array" },
    review_bundle_history: { type: "array" },
    compilation_history: { type: "array" },
    validation_history: { type: "array" },
    ambiguities: { type: "array" },
    blocking_ambiguity_ids: { type: "array", items: { type: "string" } },
    unresolved_nonblocking_ambiguity_ids: { type: "array", items: { type: "string" } },
    limitations: { type: "array" },
    review_eligible: { type: "boolean" },
    legal_next_operations: { type: "array", items: { type: "string" } },
    events: { type: "array", minItems: 1 },
    opened_at: { type: "string", format: "date-time" },
    authority: { type: "object" },
    immutable: { const: true }
  }
};

const coverageCommandOutput = (operationId, capture = false) => ({
  type: "object",
  required: [
    "command_id", "request_digest", "accepted_at", "operation_id", "actor", "authorization",
    "coverage_onboarding", "created", ...(capture
      ? ["workflow_discovery_snapshot", "material_replaced"] : []), "transition"
  ],
  additionalProperties: false,
  properties: {
    command_id: { type: "string" },
    request_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    accepted_at: { type: "string", format: "date-time" },
    operation_id: { const: operationId },
    actor: { type: "object" },
    authorization: { type: "object" },
    coverage_onboarding: coverageProjectionSchema,
    created: { type: "boolean" },
    ...(capture ? {
      workflow_discovery_snapshot: {
        type: "object",
        required: [
          "artifact_digest", "size_bytes", "media_type", "source_scope_digest", "source_page_digest",
          "selected_metadata_digest", "authority", "immutable"
        ],
        additionalProperties: false
      },
      material_replaced: { type: "boolean" }
    } : {}),
    transition: { type: "object" }
  }
});

const coverageInterpretationCommandOutput = (operationId, resultKey, resultSchema,
  includeProjection = false) => ({
  type: "object",
  required: [
    "command_id", "request_digest", "accepted_at", "operation_id", "actor", "authorization",
    ...(includeProjection ? ["coverage_onboarding"] : []), resultKey, "created", "transition"
  ],
  additionalProperties: false,
  properties: {
    command_id: { type: "string" },
    request_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    accepted_at: { type: "string", format: "date-time" },
    operation_id: { const: operationId },
    actor: { type: "object" },
    authorization: { type: "object" },
    ...(includeProjection ? { coverage_onboarding: coverageProjectionSchema } : {}),
    [resultKey]: resultSchema,
    created: { type: "boolean" },
    transition: { type: "object" }
  }
});

const coverageInterpretationAssignmentSchema = {
  type: "object",
  required: [
    "assignment_id", "onboarding_id", "snapshot_digest", "onboarding_revision", "event_head_digest",
    "passport_id", "agent_principal_id", "work_intent_id", "work_intent_digest", "assignment_digest",
    "assigned_by_principal_id", "executed_by", "assigned_at", "expires_at", "constraints", "authority",
    "immutable"
  ],
  additionalProperties: false,
  properties: {
    assignment_id: { type: "string", format: "uuid" },
    onboarding_id: { type: "string", format: "uuid" },
    snapshot_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    onboarding_revision: { type: "integer", minimum: 2 },
    event_head_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    passport_id: { type: "string", format: "uuid" },
    agent_principal_id: { type: "string", format: "uuid" },
    work_intent_id: { type: "string", format: "uuid" },
    work_intent_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    assignment_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    assigned_by_principal_id: { type: "string" },
    executed_by: { type: "object" },
    assigned_at: { type: "string", format: "date-time" },
    expires_at: { type: "string", format: "date-time" },
    constraints: { type: "object" },
    authority: { const: "none" },
    immutable: { const: true }
  }
};

const workflowInterpretationSchema = {
  type: "object",
  required: [
    "interpretation_id", "artifact_digest", "size_bytes", "media_type", "onboarding_id",
    "snapshot_digest", "claims_digest", "ambiguity_manifest_digest", "claim_count", "ambiguity_count",
    "supersedes_interpretation_digest", "content_class", "instruction_authority", "authority", "immutable"
  ],
  additionalProperties: false,
  properties: {
    interpretation_id: { type: "string", format: "uuid" },
    artifact_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    size_bytes: { type: "integer", minimum: 0 },
    media_type: { const: "application/json" },
    onboarding_id: { type: "string", format: "uuid" },
    snapshot_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    claims_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    ambiguity_manifest_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    claim_count: { type: "integer", minimum: 1 },
    ambiguity_count: { type: "integer", minimum: 0 },
    supersedes_interpretation_digest: { type: ["string", "null"], pattern: "^sha256:[0-9a-f]{64}$" },
    content_class: { const: "untrusted_agent_proposal" },
    instruction_authority: { const: "none" },
    authority: { const: "none" },
    immutable: { const: true }
  }
};

const coverageAmbiguityResolutionSchema = {
  type: "object",
  required: [
    "schema_version", "resolution_id", "onboarding_id", "ambiguity_id", "ambiguity_digest",
    "confirmation_id", "confirmation_digest", "status", "authority", "confirmation",
    "resolution_digest", "immutable"
  ],
  additionalProperties: false,
  properties: {
    schema_version: { const: "alphonse.coverage-ambiguity-resolution.v0.1" },
    resolution_id: { type: "string", format: "uuid" },
    onboarding_id: { type: "string", format: "uuid" },
    ambiguity_id: { type: "string" },
    ambiguity_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    confirmation_id: { type: "string", format: "uuid" },
    confirmation_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    status: { enum: ["resolved", "accepted_nonblocking_unknown"] },
    authority: { const: "none" },
    confirmation: { type: "object" },
    resolution_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    immutable: { const: true }
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
    next_operations: ["runtime_adapter.workflow_inventory.list", "diagnostic.runtime_event.receive"]
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
  {
    operation_id: "diagnostic.coverage_onboarding.open",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Open one durable authority-free Coverage Onboarding bound to an exact confirmed Work Intent.",
    visibility: "public",
    authority_class: "authenticated_coverage_onboarding_agent",
    effect_class: "append_only_diagnostic_state_transition",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: { method: "POST", path: "/diagnostic/v0/coverage-onboardings" },
    input_schema: commandEnvelope("diagnostic.coverage_onboarding.open", coverageOnboardingOpenInput),
    output_schema: coverageCommandOutput("diagnostic.coverage_onboarding.open"),
    supported_modes: ["live"],
    preconditions: [
      "diagnostic_plane_available", "authenticated_agent_passport", "confirmed_exact_work_intent",
      "configured_runtime_adapter_binding"
    ],
    outcomes: ["coverage_onboarding_opened", "coverage_onboarding_reused", "command_replayed"],
    issues: [
      "AGENT_AUTHENTICATION_REQUIRED", "COVERAGE_ONBOARDING_INPUT_INVALID", "IDEMPOTENCY_CONFLICT",
      "COVERAGE_ONBOARDING_INTENT_MISMATCH", "COVERAGE_ONBOARDING_ADAPTER_BINDING_MISMATCH"
    ],
    emitted_events: ["diagnostic.coverage_onboarding.opened", "diagnostic.coverage_onboarding.reused"],
    next_operations: ["diagnostic.coverage_onboarding.get", "diagnostic.coverage_onboarding.evidence_capture"]
  },
  {
    operation_id: "diagnostic.coverage_onboarding.evidence_capture",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Freeze one exact selected workflow inventory item as an immutable authority-free discovery snapshot.",
    visibility: "public",
    authority_class: "authenticated_bound_coverage_onboarding_agent",
    effect_class: "content_addressed_evidence_and_append_only_state_transition",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: { method: "POST", path: "/diagnostic/v0/coverage-onboardings/{onboarding_id}/evidence-captures" },
    input_schema: commandEnvelope(
      "diagnostic.coverage_onboarding.evidence_capture", coverageEvidenceCaptureInput
    ),
    output_schema: coverageCommandOutput("diagnostic.coverage_onboarding.evidence_capture", true),
    supported_modes: ["live"],
    preconditions: [
      "coverage_onboarding_exists", "authenticated_bound_agent_passport", "exact_expected_revision",
      "scoped_inventory_adapter_available"
    ],
    outcomes: ["discovery_snapshot_captured", "discovery_snapshot_reused",
      "prior_snapshot_visibly_superseded", "command_replayed"],
    issues: [
      "AGENT_AUTHENTICATION_REQUIRED", "COVERAGE_ONBOARDING_INPUT_INVALID", "IDEMPOTENCY_CONFLICT",
      "COVERAGE_ONBOARDING_REVISION_CONFLICT", "COVERAGE_DISCOVERY_PROVENANCE_CONFLICT",
      "COVERAGE_ONBOARDING_SENSITIVE_MATERIAL_REJECTED"
    ],
    emitted_events: [
      "diagnostic.coverage_onboarding.evidence_captured",
      "diagnostic.coverage_onboarding.evidence_reused",
      "diagnostic.coverage_onboarding.snapshot_replaced"
    ],
    next_operations: ["diagnostic.coverage_onboarding.get", "diagnostic.coverage_interpretation.assign"]
  },
  {
    operation_id: "diagnostic.coverage_onboarding.get",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Read one Coverage Onboarding projection derived from its immutable event chain.",
    visibility: "public",
    authority_class: "authenticated_customer_reader",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/diagnostic/v0/coverage-onboardings/{onboarding_id}" },
    input_schema: {
      type: "object", required: ["onboarding_id"], additionalProperties: false,
      properties: { onboarding_id: { type: "string", format: "uuid" } }
    },
    output_schema: {
      type: "object", required: ["coverage_onboarding"], additionalProperties: false,
      properties: { coverage_onboarding: coverageProjectionSchema }
    },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available", "authenticated_customer_reader", "coverage_onboarding_exists"],
    outcomes: ["coverage_onboarding_projection_returned", "coverage_onboarding_not_found"],
    issues: ["AUTHENTICATION_REQUIRED", "COVERAGE_ONBOARDING_NOT_FOUND",
      "COVERAGE_ONBOARDING_INTEGRITY_VIOLATION"],
    emitted_events: [],
    next_operations: [
      "diagnostic.coverage_onboarding.evidence_capture", "diagnostic.coverage_interpretation.assign"
    ]
  },
  {
    operation_id: "diagnostic.coverage_interpretation.assign",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Create one immutable, expiring agent assignment over the exact active discovery snapshot.",
    visibility: "public",
    authority_class: "named_customer_owner_or_exact_trusted_operator",
    effect_class: "authority_free_interpretation_assignment",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: {
      method: "POST",
      path: "/diagnostic/v0/coverage-onboardings/{onboarding_id}/interpretation-assignments"
    },
    input_schema: commandEnvelope(
      "diagnostic.coverage_interpretation.assign", coverageInterpretationAssignInput
    ),
    output_schema: coverageInterpretationCommandOutput(
      "diagnostic.coverage_interpretation.assign", "coverage_interpretation_assignment",
      coverageInterpretationAssignmentSchema
    ),
    supported_modes: ["live"],
    preconditions: [
      "coverage_onboarding_exists", "named_human_authorization", "exact_active_snapshot",
      "exact_onboarding_agent_and_confirmed_work_intent", "exact_expected_revision"
    ],
    outcomes: ["interpretation_assignment_created", "command_replayed"],
    issues: [
      "COVERAGE_INTERPRETATION_OWNER_REQUIRED", "COVERAGE_INTERPRETATION_BASE_CONFLICT",
      "COVERAGE_INTERPRETATION_ASSIGNEE_MISMATCH", "COVERAGE_INTERPRETATION_EXPIRY_INVALID",
      "IDEMPOTENCY_CONFLICT"
    ],
    emitted_events: ["diagnostic.coverage_interpretation.assigned"],
    next_operations: [
      "diagnostic.coverage_interpretation_assignment.get", "diagnostic.coverage_interpretation.submit"
    ]
  },
  {
    operation_id: "diagnostic.coverage_interpretation_assignment.get",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Read one immutable Coverage Interpretation Assignment without evidence contents.",
    visibility: "public",
    authority_class: "authenticated_customer_reader",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: {
      method: "GET", path: "/diagnostic/v0/coverage-interpretation-assignments/{assignment_id}"
    },
    input_schema: {
      type: "object", required: ["assignment_id"], additionalProperties: false,
      properties: { assignment_id: { type: "string", format: "uuid" } }
    },
    output_schema: {
      type: "object", required: ["coverage_interpretation_assignment"], additionalProperties: false,
      properties: { coverage_interpretation_assignment: coverageInterpretationAssignmentSchema }
    },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available", "authenticated_customer_reader", "assignment_exists"],
    outcomes: ["interpretation_assignment_returned", "assignment_not_found"],
    issues: ["AUTHENTICATION_REQUIRED", "COVERAGE_INTERPRETATION_ASSIGNMENT_NOT_FOUND"],
    emitted_events: [],
    next_operations: ["diagnostic.coverage_interpretation.submit"]
  },
  {
    operation_id: "diagnostic.coverage_interpretation.submit",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Admit one closed evidence-linked agent interpretation and deterministically project typed ambiguities.",
    visibility: "public",
    authority_class: "authenticated_exactly_assigned_agent_passport",
    effect_class: "content_addressed_proposal_and_append_only_projection",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: { method: "POST", path: "/diagnostic/v0/coverage-onboardings/{onboarding_id}/interpretations" },
    input_schema: commandEnvelope(
      "diagnostic.coverage_interpretation.submit", coverageInterpretationSubmitInput
    ),
    output_schema: coverageInterpretationCommandOutput(
      "diagnostic.coverage_interpretation.submit", "workflow_interpretation",
      workflowInterpretationSchema, true
    ),
    supported_modes: ["live"],
    preconditions: [
      "exact_unexpired_assignment", "authenticated_assignee_passport", "exact_active_snapshot",
      "unchanged_onboarding_revision_and_event_head", "all_citations_exist_in_assigned_snapshot"
    ],
    outcomes: [
      "workflow_interpretation_admitted", "typed_ambiguities_projected", "review_blocked_or_reviewable",
      "command_replayed"
    ],
    issues: [
      "COVERAGE_INTERPRETATION_INPUT_INVALID", "COVERAGE_INTERPRETATION_ASSIGNMENT_MISMATCH",
      "COVERAGE_INTERPRETATION_ASSIGNMENT_STALE", "COVERAGE_INTERPRETATION_CITATION_INVALID",
      "COVERAGE_INTERPRETATION_SUPERSESSION_CONFLICT", "COVERAGE_INTERPRETATION_PROPOSED_AT_INVALID",
      "IDEMPOTENCY_CONFLICT"
    ],
    emitted_events: [
      "diagnostic.coverage_onboarding.interpretation_submitted",
      "diagnostic.coverage_onboarding.ambiguities_projected"
    ],
    next_operations: ["diagnostic.coverage_onboarding.get", "diagnostic.coverage_ambiguity.resolve"]
  },
  {
    operation_id: "diagnostic.coverage_ambiguity.resolve",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Append one named-human resolution over the exact active Coverage Ambiguity digest.",
    visibility: "public",
    authority_class: "named_customer_owner_or_exact_trusted_operator",
    effect_class: "human_confirmation_without_business_authority",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: {
      method: "POST", path: "/diagnostic/v0/coverage-onboardings/{onboarding_id}/ambiguity-resolutions"
    },
    input_schema: commandEnvelope(
      "diagnostic.coverage_ambiguity.resolve", coverageAmbiguityResolveInput
    ),
    output_schema: coverageInterpretationCommandOutput(
      "diagnostic.coverage_ambiguity.resolve", "coverage_ambiguity_resolution",
      coverageAmbiguityResolutionSchema, true
    ),
    supported_modes: ["live"],
    preconditions: [
      "named_human_authorization", "exact_active_ambiguity_digest", "exact_expected_revision",
      "exact_confirmed_work_intent"
    ],
    outcomes: [
      "blocking_ambiguity_resolved", "nonblocking_unknown_retained_as_limitation", "command_replayed"
    ],
    issues: [
      "COVERAGE_AMBIGUITY_NOT_OPEN", "COVERAGE_AMBIGUITY_REVISION_CONFLICT",
      "COVERAGE_AMBIGUITY_CHOICE_INVALID", "COVERAGE_AMBIGUITY_BLOCKING_UNKNOWN",
      "IDEMPOTENCY_CONFLICT"
    ],
    emitted_events: ["diagnostic.coverage_onboarding.ambiguity_resolved"],
    next_operations: ["diagnostic.coverage_onboarding.get"]
  },
  {
    operation_id: "diagnostic.coverage_review_bundle.create",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Assemble immutable content-addressed review bytes from one exact current reviewable onboarding state.",
    visibility: "public",
    authority_class: "authenticated_bound_coverage_onboarding_agent",
    effect_class: "content_addressed_review_bundle_and_append_only_state_transition",
    idempotency: "required_command_id_and_canonical_request_digest",
    transport: { method: "POST", path: "/diagnostic/v0/coverage-onboardings/{onboarding_id}/review-bundles" },
    input_schema: commandEnvelope("diagnostic.coverage_review_bundle.create", coverageReviewBundleCreateInput),
    output_schema: coverageInterpretationCommandOutput(
      "diagnostic.coverage_review_bundle.create", "coverage_review_bundle", coverageReviewBundleSchema, true
    ),
    supported_modes: ["live"],
    preconditions: ["exact_current_reviewable_state", "blocking_ambiguities_resolved",
      "all_references_are_admitted_exact_artifacts"],
    outcomes: ["immutable_review_bundle_created", "onboarding_awaiting_approval", "command_replayed"],
    issues: ["COVERAGE_REVIEW_STATE_CONFLICT", "COVERAGE_REVIEW_REFERENCE_NOT_ADMITTED",
      "COVERAGE_REVIEW_AGENT_MISMATCH", "IDEMPOTENCY_CONFLICT"],
    emitted_events: ["diagnostic.coverage_review_bundle.created",
      "diagnostic.coverage_onboarding.review_bundle_created"],
    next_operations: ["diagnostic.coverage_review_bundle.get", "kernel.coverage_review.approve"]
  },
  {
    operation_id: "diagnostic.coverage_review_bundle.get",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Read and verify one immutable content-addressed Coverage Review Bundle.",
    visibility: "public",
    authority_class: "authenticated_customer_reader",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/diagnostic/v0/coverage-review-bundles/{review_bundle_digest}" },
    input_schema: { type: "object", required: ["review_bundle_digest"], additionalProperties: false,
      properties: { review_bundle_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" } } },
    output_schema: { type: "object", required: ["coverage_review_bundle"], additionalProperties: false,
      properties: { coverage_review_bundle: coverageReviewBundleSchema } },
    supported_modes: ["live"],
    preconditions: ["authenticated_customer_reader", "review_bundle_exists"],
    outcomes: ["verified_review_bundle_returned"],
    issues: ["COVERAGE_REVIEW_BUNDLE_NOT_FOUND", "COVERAGE_REVIEW_INTEGRITY_VIOLATION"],
    emitted_events: [],
    next_operations: ["kernel.coverage_review.approve", "diagnostic.coverage_specification.compile"]
  },
  {
    operation_id: "diagnostic.coverage_specification.compile",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Compile one exact eligible Coverage Review approval into deterministic authority-free proposal bytes.",
    visibility: "public",
    authority_class: "authenticated_bound_coverage_onboarding_agent",
    effect_class: "deterministic_content_addressed_proposal_compilation",
    idempotency: "required_command_id_and_canonical_request_digest_plus_semantic_reuse",
    transport: { method: "POST", path: "/diagnostic/v0/coverage-onboardings/{onboarding_id}/coverage-compilations" },
    input_schema: commandEnvelope("diagnostic.coverage_specification.compile", coverageCompilationInput),
    output_schema: coverageInterpretationCommandOutput(
      "diagnostic.coverage_specification.compile", "coverage_compilation", coverageCompilationSchema, true
    ),
    supported_modes: ["live"],
    preconditions: ["exact_active_review_bundle", "exact_current_eligible_kernel_approval",
      "exact_compiler_artifact_identity"],
    outcomes: ["deterministic_coverage_specification_compiled",
      "workflow_manifest_proposal_compiled_without_authority", "semantic_compilation_reused"],
    issues: ["COVERAGE_COMPILATION_APPROVAL_CONFLICT", "COVERAGE_COMPILER_IDENTITY_MISMATCH",
      "COVERAGE_COMPILATION_AGENT_MISMATCH", "IDEMPOTENCY_CONFLICT"],
    emitted_events: ["diagnostic.coverage_specification.compiled"],
    next_operations: ["diagnostic.coverage_specification.get", "diagnostic.coverage_specification.validate"]
  },
  {
    operation_id: "diagnostic.coverage_specification.get",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Read and verify one immutable Coverage compilation and its exact semantic proposal artifacts.",
    visibility: "public",
    authority_class: "authenticated_customer_reader",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/diagnostic/v0/coverage-compilations/{compilation_id}" },
    input_schema: { type: "object", required: ["compilation_id"], additionalProperties: false,
      properties: { compilation_id: { type: "string", format: "uuid" } } },
    output_schema: { type: "object", required: ["coverage_compilation"], additionalProperties: false,
      properties: { coverage_compilation: coverageCompilationSchema } },
    supported_modes: ["live"],
    preconditions: ["authenticated_customer_reader", "coverage_compilation_exists"],
    outcomes: ["verified_coverage_compilation_returned"],
    issues: ["COVERAGE_COMPILATION_NOT_FOUND", "COVERAGE_COMPILATION_INTEGRITY_VIOLATION"],
    emitted_events: [],
    next_operations: ["diagnostic.coverage_specification.validate"]
  },
  {
    operation_id: "diagnostic.coverage_specification.validate",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Validate exact compiled proposal bytes and persist a visible fail-closed authority-free receipt.",
    visibility: "public",
    authority_class: "authenticated_bound_coverage_onboarding_agent",
    effect_class: "deterministic_validation_receipt_without_registration",
    idempotency: "required_command_id_and_canonical_request_digest_plus_semantic_reuse",
    transport: { method: "POST", path: "/diagnostic/v0/coverage-compilations/{compilation_id}/validations" },
    input_schema: commandEnvelope("diagnostic.coverage_specification.validate", coverageValidationInput),
    output_schema: coverageInterpretationCommandOutput(
      "diagnostic.coverage_specification.validate", "coverage_validation", coverageValidationSchema, true
    ),
    supported_modes: ["live"],
    preconditions: ["exact_active_compilation", "exact_current_eligible_kernel_approval",
      "exact_validator_artifact_identity"],
    outcomes: ["valid_proposal_receipt_created", "invalid_proposal_receipt_visible",
      "registration_request_not_granted"],
    issues: ["COVERAGE_VALIDATION_INPUT_CONFLICT", "COVERAGE_VALIDATOR_IDENTITY_MISMATCH",
      "COVERAGE_VALIDATION_COMPILATION_STALE", "IDEMPOTENCY_CONFLICT"],
    emitted_events: ["diagnostic.coverage_specification.validated"],
    next_operations: ["diagnostic.coverage_validation.get"]
  },
  {
    operation_id: "diagnostic.coverage_validation.get",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Read and verify one immutable Coverage Validation Receipt and its downstream authority boundary.",
    visibility: "public",
    authority_class: "authenticated_customer_reader",
    effect_class: "read_only",
    idempotency: "naturally_idempotent",
    transport: { method: "GET", path: "/diagnostic/v0/coverage-validations/{validation_id}" },
    input_schema: { type: "object", required: ["validation_id"], additionalProperties: false,
      properties: { validation_id: { type: "string", format: "uuid" } } },
    output_schema: { type: "object", required: ["coverage_validation"], additionalProperties: false,
      properties: { coverage_validation: coverageValidationSchema } },
    supported_modes: ["live"],
    preconditions: ["authenticated_customer_reader", "coverage_validation_exists"],
    outcomes: ["verified_coverage_validation_returned"],
    issues: ["COVERAGE_VALIDATION_NOT_FOUND", "COVERAGE_VALIDATION_INTEGRITY_VIOLATION"],
    emitted_events: [],
    next_operations: []
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
  {
    operation_id: "diagnostic.correlation_registration.register",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Bind one exact deployed scope, revision, contract dependency set, and deterministic projector.",
    visibility: "public",
    authority_class: "authenticated_customer_owner_requester",
    effect_class: "immutable_diagnostic_contract_registration",
    idempotency: "registration_identity_and_canonical_registration_digest",
    transport: { method: "POST", path: "/diagnostic/v0/correlation-registrations" },
    input_schema: {
      type: "object",
      required: ["registration_id", "deployment_id", "workflow_id", "revision_id", "integration_id"],
      additionalProperties: false,
      properties: {
        registration_id: { type: "string", format: "uuid" },
        deployment_id: { type: "string", format: "uuid" },
        workflow_id: { type: "string", minLength: 1, maxLength: 160 },
        revision_id: { type: "string", format: "uuid" },
        integration_id: { type: "string", minLength: 1, maxLength: 160 }
      }
    },
    output_schema: { type: "object", required: ["correlation_registration"] },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available", "authenticated_customer_owner",
      "deployment_exists", "exact_agent_revision_exists"],
    outcomes: ["correlation_registration_created", "correlation_registration_replayed"],
    issues: ["AUTHENTICATION_REQUIRED", "CORRELATION_INPUT_INVALID",
      "CORRELATION_REVISION_SCOPE_MISMATCH", "CORRELATION_REGISTRATION_IDENTITY_CONFLICT"],
    emitted_events: [],
    next_operations: ["diagnostic.correlation_registration.get", "diagnostic.correlation_projection.create"]
  },
  readDescriptor({
    operationId: "diagnostic.correlation_registration.get",
    summary: "Inspect one immutable correlation scope and its exact projector and contract dependencies.",
    path: "/diagnostic/v0/correlation-registrations/{registration_id}",
    idName: "registration_id",
    resultKey: "correlation_registration",
    issues: ["CORRELATION_REGISTRATION_NOT_FOUND"],
    nextOperations: ["diagnostic.correlation_projection.create"]
  }),
  {
    operation_id: "diagnostic.correlation_projection.create",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Project one immutable cross-stream graph at a stable committed intake cutoff without guessed joins.",
    visibility: "public",
    authority_class: "authenticated_customer_owner_requester",
    effect_class: "deterministic_diagnostic_projection",
    idempotency: "registration_operation_and_stable_committed_cutoff_with_semantic_digest",
    transport: { method: "POST", path: "/diagnostic/v0/correlation-projections" },
    input_schema: {
      type: "object",
      required: ["registration_id", "logical_operation_id"],
      additionalProperties: false,
      properties: {
        registration_id: { type: "string", format: "uuid" },
        logical_operation_id: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    output_schema: { type: "object", required: ["correlation_projection"] },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available", "authenticated_customer_owner",
      "correlation_registration_exists", "committed_intake_prefix_nonempty"],
    outcomes: ["correlation_projection_created", "correlation_projection_replayed",
      "correlation_nondeterminism_conflict_preserved"],
    issues: ["AUTHENTICATION_REQUIRED", "CORRELATION_INPUT_INVALID",
      "CORRELATION_REGISTRATION_NOT_FOUND", "DIAGNOSTIC_COMMITTED_PREFIX_INCOMPLETE",
      "CORRELATION_PROJECTION_NONDETERMINISM"],
    emitted_events: [],
    next_operations: ["diagnostic.correlation_projection.get"]
  },
  readDescriptor({
    operationId: "diagnostic.correlation_projection.get",
    summary: "Inspect one immutable deterministic correlation graph and its frozen dependency manifests.",
    path: "/diagnostic/v0/correlation-projections/{projection_id}",
    idName: "projection_id",
    resultKey: "correlation_projection",
    issues: ["CORRELATION_PROJECTION_NOT_FOUND"]
  }),
  {
    operation_id: "diagnostic.interpretation_activation.activate",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Activate exact deployed Integration, Behavior, evaluator, and deterministic stage material.",
    visibility: "public",
    authority_class: "authenticated_customer_owner_requester",
    effect_class: "immutable_diagnostic_contract_activation",
    idempotency: "activation_identity_and_canonical_activation_digest",
    transport: { method: "POST", path: "/diagnostic/v0/interpretation-activations" },
    input_schema: {
      type: "object",
      required: ["activation_id", "deployment_id", "integration_contract_export_id",
        "behavior_contract_export_id", "evaluator_export_id"],
      additionalProperties: false,
      properties: {
        activation_id: { type: "string", format: "uuid" },
        deployment_id: { type: "string", format: "uuid" },
        integration_contract_export_id: { type: "string", minLength: 1, maxLength: 200 },
        behavior_contract_export_id: { type: "string", minLength: 1, maxLength: 200 },
        evaluator_export_id: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    output_schema: { type: "object", required: ["interpretation_activation"] },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available", "authenticated_customer_owner", "deployment_exists"],
    outcomes: ["interpretation_activation_created", "interpretation_activation_replayed"],
    issues: ["AUTHENTICATION_REQUIRED", "DIAGNOSTIC_INTERPRETATION_CONTRACT_INVALID",
      "DIAGNOSTIC_INTERPRETATION_EXPORT_MISMATCH", "DIAGNOSTIC_INTERPRETATION_SCOPE_MISMATCH"],
    emitted_events: [],
    next_operations: ["diagnostic.interpretation_activation.get", "diagnostic.effect_evaluation.process"]
  },
  readDescriptor({
    operationId: "diagnostic.interpretation_activation.get",
    summary: "Inspect exact activated interpretation contracts, evaluator, and deterministic stage identity.",
    path: "/diagnostic/v0/interpretation-activations/{activation_id}",
    idName: "activation_id",
    resultKey: "interpretation_activation",
    issues: ["DIAGNOSTIC_INTERPRETATION_ACTIVATION_NOT_FOUND"],
    nextOperations: ["diagnostic.effect_evaluation.process"]
  }),
  {
    operation_id: "diagnostic.effect_evaluation.process",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Interpret designated-feed claims, evaluate one bounded invariant, and open a case only on violation.",
    visibility: "public",
    authority_class: "authenticated_customer_owner_requester",
    effect_class: "deterministic_diagnostic_derivation",
    idempotency: "correlation_projection_and_interpretation_activation",
    transport: { method: "POST", path: "/diagnostic/v0/effect-evaluations" },
    input_schema: {
      type: "object",
      required: ["correlation_projection_id", "activation_id"],
      additionalProperties: false,
      properties: {
        correlation_projection_id: { type: "string", format: "uuid" },
        activation_id: { type: "string", format: "uuid" }
      }
    },
    output_schema: { type: "object", required: ["diagnostic_effect_projection", "behavior_evaluation",
      "diagnostic_trigger", "diagnostic_case"] },
    supported_modes: ["live"],
    preconditions: ["diagnostic_plane_available", "hardened_correlation_projection_exists",
      "interpretation_activation_exists"],
    outcomes: ["diagnostic_case_created", "diagnostic_case_replayed", "behavior_not_violated"],
    issues: ["AUTHENTICATION_REQUIRED", "DIAGNOSTIC_EFFECT_PROJECTION_VERSION_UNSUPPORTED",
      "DIAGNOSTIC_INTERPRETATION_ARTIFACT_MISMATCH", "BEHAVIOR_EVALUATION_NOT_VIOLATED"],
    emitted_events: ["diagnostic.case.behavior_violation_opened"],
    next_operations: ["diagnostic.effect_projection.get", "diagnostic.behavior_evaluation.get",
      "diagnostic.trigger.get", "diagnostic.deterministic_case.get"]
  },
  readDescriptor({
    operationId: "diagnostic.effect_projection.get",
    summary: "Inspect immutable contract-bound external-effect interpretations with no Kernel Effect authority.",
    path: "/diagnostic/v0/effect-projections/{effect_projection_id}",
    idName: "effect_projection_id",
    resultKey: "diagnostic_effect_projection",
    issues: ["DIAGNOSTIC_EFFECT_PROJECTION_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.behavior_evaluation.get",
    summary: "Inspect one immutable bounded Behavior Evaluation over normalized effects only.",
    path: "/diagnostic/v0/behavior-evaluations/{evaluation_id}",
    idName: "evaluation_id",
    resultKey: "behavior_evaluation",
    issues: ["BEHAVIOR_EVALUATION_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.trigger.get",
    summary: "Inspect one deterministic violated-evaluation trigger without causal or repair claims.",
    path: "/diagnostic/v0/diagnostic-triggers/{trigger_id}",
    idName: "trigger_id",
    resultKey: "diagnostic_trigger",
    issues: ["DIAGNOSTIC_TRIGGER_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.claim_envelope.get",
    summary: "Inspect one minimal temporal claim with separate provenance, support, and authority fields.",
    path: "/diagnostic/v0/claim-envelopes/{claim_id}",
    idName: "claim_id",
    resultKey: "claim_envelope",
    issues: ["DIAGNOSTIC_CLAIM_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.deterministic_case.get",
    summary: "Inspect one deterministic invariant-violation case and its bounded Claim Envelopes.",
    path: "/diagnostic/v0/deterministic-cases/{case_id}",
    idName: "case_id",
    resultKey: "diagnostic_case",
    issues: ["DIAGNOSTIC_CASE_NOT_FOUND"]
  }),
  {
    operation_id: "diagnostic.evidence_policy_activation.activate",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Activate exact deployed evidence-selection and cumulative-retention policies.",
    visibility: "public",
    authority_class: "authenticated_customer_owner_requester",
    effect_class: "immutable_diagnostic_policy_activation",
    idempotency: "activation_identity_and_canonical_policy_digest",
    transport: { method: "POST", path: "/diagnostic/v0/evidence-policy-activations" },
    input_schema: {
      type: "object",
      required: ["evidence_policy_activation_id", "interpretation_activation_id", "deployment_id",
        "selection_policy_export_id", "retention_policy_export_id"],
      additionalProperties: false,
      properties: {
        evidence_policy_activation_id: { type: "string", format: "uuid" },
        interpretation_activation_id: { type: "string", format: "uuid" },
        deployment_id: { type: "string", format: "uuid" },
        selection_policy_export_id: { type: "string", minLength: 1, maxLength: 200 },
        retention_policy_export_id: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    output_schema: { type: "object", required: ["evidence_policy_activation"] },
    supported_modes: ["live"],
    preconditions: ["interpretation_activation_exists", "exact_deployment_exports_exist"],
    outcomes: ["evidence_policy_activation_created", "evidence_policy_activation_replayed"],
    issues: ["DIAGNOSTIC_EVIDENCE_POLICY_INVALID", "DIAGNOSTIC_EVIDENCE_POLICY_SCOPE_MISMATCH"],
    emitted_events: [],
    next_operations: ["diagnostic.evidence_policy_activation.get", "diagnostic.effect_evaluation.process"]
  },
  readDescriptor({
    operationId: "diagnostic.evidence_policy_activation.get",
    summary: "Inspect exact activated evidence-selection, retention formulas, and packager identity.",
    path: "/diagnostic/v0/evidence-policy-activations/{evidence_policy_activation_id}",
    idName: "evidence_policy_activation_id",
    resultKey: "evidence_policy_activation",
    issues: ["DIAGNOSTIC_EVIDENCE_POLICY_ACTIVATION_NOT_FOUND"],
    nextOperations: ["diagnostic.evidence_collection.process"]
  }),
  {
    operation_id: "diagnostic.evidence_collection.process",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Request one durable collection-job wake and freeze only on completion or its stored deadline.",
    visibility: "public",
    authority_class: "authenticated_diagnostic_owner_wakeup_requester",
    effect_class: "deterministic_evidence_package_freeze",
    idempotency: "case_collection_job_and_exact_semantic_package_digest",
    transport: { method: "POST", path: "/diagnostic/v0/evidence-collections/process" },
    input_schema: {
      type: "object",
      required: ["case_id"],
      additionalProperties: false,
      properties: {
        case_id: { type: "string", format: "uuid" },
        assignment_policy_activation_id: { type: "string", format: "uuid" }
      }
    },
    output_schema: { type: "object", required: ["collection", "evidence_package"] },
    supported_modes: ["live"],
    preconditions: ["policy_bound_trigger_exists", "durable_collection_job_exists"],
    outcomes: ["collection_pending", "evidence_package_frozen", "evidence_package_replayed"],
    issues: ["DIAGNOSTIC_EVIDENCE_POLICY_NOT_BOUND", "DIAGNOSTIC_EVIDENCE_PACKAGE_NONDETERMINISM"],
    emitted_events: ["diagnostic.evidence_package.frozen"],
    next_operations: ["diagnostic.evidence_collection.get", "diagnostic.evidence_package.get"]
  },
  readDescriptor({
    operationId: "diagnostic.evidence_collection.get",
    summary: "Inspect one durable collection lease, reference set, scheduler state, and package-pin release.",
    path: "/diagnostic/v0/evidence-collections/{case_id}",
    idName: "case_id",
    resultKey: "evidence_collection",
    issues: ["DIAGNOSTIC_EVIDENCE_COLLECTION_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.evidence_package.get",
    summary: "Inspect one immutable content-addressed worker package with complete disclosure accounting.",
    path: "/diagnostic/v0/evidence-packages/{evidence_package_id}",
    idName: "evidence_package_id",
    resultKey: "evidence_package",
    issues: ["DIAGNOSTIC_EVIDENCE_PACKAGE_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.evidence_package_material_availability.get",
    summary: "Inspect current temporal material availability separately from immutable package history.",
    path: "/diagnostic/v0/evidence-packages/{evidence_package_id}/material-availability",
    idName: "evidence_package_id",
    resultKey: "material_availability",
    issues: ["DIAGNOSTIC_EVIDENCE_PACKAGE_NOT_FOUND",
      "DIAGNOSTIC_PACKAGE_MATERIAL_AVAILABILITY_INTEGRITY_VIOLATION"]
  }),
  {
    operation_id: "diagnostic.material_erasure.request",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Commit immediate material-access revocation and its exact package and assignment blast radius before physical deletion.",
    visibility: "public",
    authority_class: "authenticated_customer_owner_or_exact_trusted_operator",
    effect_class: "local_diagnostic_material_access_revocation",
    idempotency: "command_id_and_exact_authorized_erasure_request",
    transport: { method: "POST", path: "/diagnostic/v0/material-erasures" },
    input_schema: {
      type: "object",
      required: ["erasure_decision_id", "artifact_digest", "reason_code", "reason",
        "override_retention_classes"],
      additionalProperties: false,
      properties: {
        erasure_decision_id: { type: "string", format: "uuid" },
        artifact_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        reason_code: { type: "string", enum: ["privacy_request", "security_response",
          "legal_requirement", "customer_retention_request"] },
        reason: { type: "string", minLength: 1, maxLength: 500 },
        override_retention_classes: { type: "array", uniqueItems: true,
          items: { type: "string", enum: ["active_case", "audit", "diagnosis", "package_pin",
            "review", "worker_run"] } }
      }
    },
    output_schema: { type: "object", required: ["material_erasure", "transition"] },
    supported_modes: ["live"],
    preconditions: ["supported_customer_evidence_artifact", "exact_retention_overrides",
      "no_active_legal_hold"],
    outcomes: ["availability_revoked", "affected_assignments_invalidated",
      "physical_deletion_pending"],
    issues: ["DIAGNOSTIC_ERASABLE_ARTIFACT_NOT_FOUND",
      "DIAGNOSTIC_MATERIAL_ERASURE_DECISION_ID_CONFLICT",
      "DIAGNOSTIC_MATERIAL_RETENTION_OVERRIDE_REQUIRED", "DIAGNOSTIC_MATERIAL_LEGAL_HOLD_ACTIVE",
      "DIAGNOSTIC_STAGE_ARTIFACT_ERASURE_PROHIBITED"],
    emitted_events: ["diagnostic.material_erasure.availability_revoked",
      "diagnostic.assignment.expired", "diagnostic.assignment.cancelled"],
    next_operations: ["diagnostic.material_erasure.complete", "diagnostic.material_erasure.get",
      "diagnostic.evidence_package_material_availability.get"]
  },
  {
    operation_id: "diagnostic.material_erasure.complete",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Idempotently delete and verify one already-revoked local CAS object without claiming universal deletion.",
    visibility: "public",
    authority_class: "authenticated_customer_owner_or_exact_trusted_operator_wakeup",
    effect_class: "local_primary_cas_physical_deletion",
    idempotency: "command_id_and_erasure_decision_id",
    transport: { method: "POST", path: "/diagnostic/v0/material-erasures/{erasure_decision_id}/complete" },
    input_schema: { type: "object", required: ["erasure_decision_id"], additionalProperties: false,
      properties: { erasure_decision_id: { type: "string", format: "uuid" } } },
    output_schema: { type: "object", required: ["material_erasure", "transition"] },
    supported_modes: ["live"],
    preconditions: ["committed_availability_revocation"],
    outcomes: ["deleted_verified", "already_absent_verified", "deletion_incomplete",
      "completed_tombstone_replayed"],
    issues: ["DIAGNOSTIC_MATERIAL_ERASURE_NOT_FOUND",
      "DIAGNOSTIC_MATERIAL_ERASURE_INTEGRITY_VIOLATION"],
    emitted_events: ["diagnostic.material_erasure.deleted_verified",
      "diagnostic.material_erasure.deletion_incomplete",
      "diagnostic.material_erasure.deletion_reused"],
    next_operations: ["diagnostic.material_erasure.get",
      "diagnostic.evidence_package_material_availability.get"]
  },
  readDescriptor({
    operationId: "diagnostic.material_erasure.get",
    summary: "Inspect immutable authority, impact, local deletion attempts, tombstone, and external limitations.",
    path: "/diagnostic/v0/material-erasures/{erasure_decision_id}",
    idName: "erasure_decision_id",
    resultKey: "material_erasure",
    issues: ["DIAGNOSTIC_MATERIAL_ERASURE_NOT_FOUND",
      "DIAGNOSTIC_MATERIAL_ERASURE_INTEGRITY_VIOLATION"]
  }),
  {
    operation_id: "diagnostic.evidence_revision.process",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Assess newly committed case-relevant evidence and create a separate immutable package revision only for exact material change.",
    visibility: "public",
    authority_class: "authenticated_diagnostic_owner_wakeup_requester",
    effect_class: "deterministic_evidence_revision_assessment",
    idempotency: "case_predecessor_cutoff_pinned_activations_and_revision_rules",
    transport: { method: "POST", path: "/diagnostic/v0/evidence-revisions/process" },
    input_schema: {
      type: "object",
      required: ["case_id"],
      additionalProperties: false,
      properties: { case_id: { type: "string", format: "uuid" } }
    },
    output_schema: { type: "object", required: ["status", "evidence_package", "assessment",
      "reevaluation_available"] },
    supported_modes: ["live"],
    preconditions: ["revision_monitor_exists", "committed_prefix_advanced",
      "case_opening_activations_available"],
    outcomes: ["no_new_committed_outcomes", "awaiting_initial_assignment_handoff",
      "nonmaterial_change_recorded",
      "evidence_package_revision_created", "reevaluation_notice_created"],
    issues: ["DIAGNOSTIC_EVIDENCE_REVISION_MONITOR_NOT_FOUND",
      "DIAGNOSTIC_EVIDENCE_REVISION_ACTIVATION_DRIFT",
      "DIAGNOSTIC_EVIDENCE_MATERIAL_CHANGE_UNCLASSIFIED"],
    emitted_events: ["diagnostic.evidence_package.revised", "diagnostic.reevaluation.available",
      "diagnostic.assignment.replacement_requested"],
    next_operations: ["diagnostic.evidence_revision.get", "diagnostic.evidence_package.get"]
  },
  readDescriptor({
    operationId: "diagnostic.evidence_revision.get",
    summary: "Inspect the current package lineage, latest exact assessment, and reevaluation notice for one case.",
    path: "/diagnostic/v0/evidence-revisions/{case_id}",
    idName: "case_id",
    resultKey: "evidence_revision",
    issues: ["DIAGNOSTIC_EVIDENCE_REVISION_MONITOR_NOT_FOUND"]
  }),
  {
    operation_id: "diagnostic.assignment_policy_activation.activate",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Activate one exact answer-free Diagnostic Assignment work contract without granting execution authority.",
    visibility: "public",
    authority_class: "authenticated_customer_owner_requester",
    effect_class: "immutable_diagnostic_assignment_policy_activation",
    idempotency: "activation_identity_and_canonical_policy_digest",
    transport: { method: "POST", path: "/diagnostic/v0/assignment-policy-activations" },
    input_schema: {
      type: "object",
      required: ["assignment_policy_activation_id", "deployment_id", "assignment_policy_export_id"],
      additionalProperties: false,
      properties: {
        assignment_policy_activation_id: { type: "string", format: "uuid" },
        deployment_id: { type: "string", format: "uuid" },
        assignment_policy_export_id: { type: "string", minLength: 1, maxLength: 200 }
      }
    },
    output_schema: { type: "object", required: ["assignment_policy_activation"] },
    supported_modes: ["live"],
    preconditions: ["exact_deployment_export_exists", "answer_free_assignment_contract_valid"],
    outcomes: ["assignment_policy_activation_created", "assignment_policy_activation_replayed"],
    issues: ["DIAGNOSTIC_ASSIGNMENT_POLICY_INVALID", "DIAGNOSTIC_ASSIGNMENT_POLICY_EXPORT_MISMATCH"],
    emitted_events: [],
    next_operations: ["diagnostic.assignment_policy_activation.get", "diagnostic.evidence_collection.process"]
  },
  readDescriptor({
    operationId: "diagnostic.assignment_policy_activation.get",
    summary: "Inspect one exact immutable Assignment Policy and deterministic stage identity.",
    path: "/diagnostic/v0/assignment-policy-activations/{assignment_policy_activation_id}",
    idName: "assignment_policy_activation_id",
    resultKey: "assignment_policy_activation",
    issues: ["DIAGNOSTIC_ASSIGNMENT_POLICY_ACTIVATION_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.assignment.get",
    summary: "Inspect immutable available-work facts and their separately fenced current state.",
    path: "/diagnostic/v0/assignments/{assignment_id}",
    idName: "assignment_id",
    resultKey: "diagnostic_assignment",
    issues: ["DIAGNOSTIC_ASSIGNMENT_NOT_FOUND", "DIAGNOSTIC_ASSIGNMENT_INTEGRITY_VIOLATION"]
  }),
  {
    operation_id: "diagnostic.assignment.claim",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Atomically consume one signed Kernel authorization, claim one exact Assignment, and create one not-yet-launched Worker Run.",
    visibility: "public",
    authority_class: "exact_signed_kernel_dispatch_authorization_and_bound_dispatcher",
    effect_class: "diagnostic_assignment_claim_and_worker_run_binding",
    idempotency: "command_id_and_exact_signed_authorization",
    transport: { method: "POST", path: "/diagnostic/v0/assignments/{assignment_id}/claim" },
    input_schema: {
      type: "object",
      required: ["command_id", "operation_id", "input"],
      additionalProperties: false,
      properties: {
        command_id: { type: "string", minLength: 1, maxLength: 160 },
        operation_id: { const: "diagnostic.assignment.claim" },
        input: {
          type: "object",
          required: ["assignment_id", "signed_authorization"],
          additionalProperties: false,
          properties: {
            assignment_id: { type: "string", format: "uuid" },
            signed_authorization: { type: "object" }
          }
        }
      }
    },
    output_schema: { type: "object", required: ["diagnostic_assignment_claim", "transition"] },
    supported_modes: ["live"],
    preconditions: ["assignment_unclaimed_and_current", "material_currently_available",
      "authorization_signature_current_and_exact", "dispatcher_and_runner_audiences_match"],
    outcomes: ["assignment_claimed", "worker_run_bound_not_launched", "command_replayed",
      "competing_claim_rejected"],
    issues: ["DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID",
      "DIAGNOSTIC_DISPATCH_AUTHORIZATION_EXPIRED",
      "DIAGNOSTIC_DISPATCH_AUTHORIZATION_BINDING_MISMATCH",
      "DIAGNOSTIC_ASSIGNMENT_CLAIM_CONFLICT",
      "DIAGNOSTIC_EVIDENCE_PACKAGE_MATERIAL_UNAVAILABLE"],
    emitted_events: ["diagnostic.assignment.claimed"],
    next_operations: ["diagnostic.worker_run.get"]
  },
  readDescriptor({
    operationId: "diagnostic.worker_run.get",
    summary: "Inspect one immutable Worker Run boundary, launch provenance, and ingested diagnosis state.",
    path: "/diagnostic/v0/worker-runs/{worker_run_id}",
    idName: "worker_run_id",
    resultKey: "diagnostic_worker_run",
    issues: ["DIAGNOSTIC_WORKER_RUN_NOT_FOUND", "DIAGNOSTIC_WORKER_RUN_INTEGRITY_VIOLATION",
      "DIAGNOSTIC_WORKER_EXECUTION_INTEGRITY_VIOLATION"]
  }),
  {
    operation_id: "diagnostic.worker_run.launch_authorize",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Fence current package material, issue one exact Broker Grant, and advance a claimed Worker Run to launching.",
    visibility: "public",
    authority_class: "customer_owner_dispatcher",
    effect_class: "isolated_diagnostic_launch_and_one_broker_request_only",
    idempotency: "command_id_and_exact_worker_run",
    transport: { method: "POST", path: "/diagnostic/v0/worker-runs/{worker_run_id}/launch-authorizations" },
    input_schema: commandEnvelope("diagnostic.worker_run.launch_authorize", {
      type: "object", required: ["worker_run_id"], additionalProperties: false,
      properties: { worker_run_id: { type: "string", format: "uuid" } }
    }),
    output_schema: { type: "object", required: ["diagnostic_worker_launch", "transition"] },
    supported_modes: ["live"],
    preconditions: ["worker_run_claimed_not_launched", "package_material_currently_available"],
    outcomes: ["broker_grant_created", "worker_input_bound", "worker_run_launching"],
    issues: ["DIAGNOSTIC_WORKER_RUN_LAUNCH_CONFLICT",
      "DIAGNOSTIC_BROKER_INPUT_BUDGET_INSUFFICIENT"],
    emitted_events: ["diagnostic.worker_run.launch_authorized"],
    next_operations: ["diagnostic.worker_run.started"]
  },
  {
    operation_id: "diagnostic.worker_run.started",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Accept signed trusted-runner proof of the exact running isolated container and Broker-only network.",
    visibility: "public", authority_class: "customer_owner_dispatcher",
    effect_class: "runtime_provenance_recording", idempotency: "command_id_and_exact_attestation",
    transport: { method: "POST", path: "/diagnostic/v0/worker-runs/{worker_run_id}/started" },
    input_schema: commandEnvelope("diagnostic.worker_run.started", {
      type: "object", required: ["worker_run_id", "signed_start_attestation"],
      additionalProperties: false,
      properties: { worker_run_id: { type: "string", format: "uuid" },
        signed_start_attestation: { type: "object" } }
    }),
    output_schema: { type: "object", required: ["diagnostic_worker_start", "transition"] },
    supported_modes: ["live"], preconditions: ["signed_runner_attestation_exact_and_current"],
    outcomes: ["worker_run_running", "runtime_boundary_recorded"],
    issues: ["DIAGNOSTIC_RUNNER_ATTESTATION_BINDING_MISMATCH",
      "DIAGNOSTIC_RUNNER_ISOLATION_INVALID", "DIAGNOSTIC_RUNNER_NETWORK_INVALID"],
    emitted_events: ["diagnostic.worker_run.started"],
    next_operations: ["diagnostic.worker_run.complete"]
  },
  {
    operation_id: "diagnostic.worker_run.complete",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Validate post-exit runtime proof, one regular bounded output, one Broker Receipt, exact claim citations, and ingest one diagnosis.",
    visibility: "public", authority_class: "customer_owner_dispatcher",
    effect_class: "diagnosis_ingestion_without_external_business_effects",
    idempotency: "command_id_exact_final_attestation_and_output_bytes",
    transport: { method: "POST", path: "/diagnostic/v0/worker-runs/{worker_run_id}/completions" },
    input_schema: commandEnvelope("diagnostic.worker_run.complete", {
      type: "object", required: ["worker_run_id", "signed_final_attestation", "output_bytes_base64"],
      additionalProperties: false,
      properties: { worker_run_id: { type: "string", format: "uuid" },
        signed_final_attestation: { type: "object" }, output_bytes_base64: { type: "string" } }
    }),
    output_schema: { type: "object", required: ["diagnostic_worker_completion", "transition"] },
    supported_modes: ["live"],
    preconditions: ["worker_run_running", "package_material_currently_available",
      "signed_final_provenance_exact", "sole_output_schema_and_citations_valid"],
    outcomes: ["worker_run_completed", "diagnosis_ingested", "broker_request_proven"],
    issues: ["DIAGNOSTIC_WORKER_OUTPUT_BOUNDARY_INVALID",
      "DIAGNOSTIC_MODEL_BROKER_RECEIPT_INVALID", "DIAGNOSTIC_WORKER_CITATION_INVALID"],
    emitted_events: ["diagnostic.worker_run.completed"],
    next_operations: ["diagnostic.worker_run.get"]
  },
  {
    operation_id: "diagnostic.consistency_test.register",
    version: DIAGNOSTIC_PROTOCOL_VERSION,
    summary: "Commit one hidden rubric and create exactly three fresh authority-free assignments over a completed governed package.",
    visibility: "public", authority_class: "authenticated_customer_owner",
    effect_class: "diagnostic_test_registration_without_dispatch_authority",
    idempotency: "command_id_and_exact_policy_rubric_source_run",
    transport: { method: "POST", path: "/diagnostic/v0/consistency-tests" },
    input_schema: commandEnvelope("diagnostic.consistency_test.register", {
      type: "object",
      required: ["consistency_test_id", "source_worker_run_id", "policy", "hidden_rubric"],
      additionalProperties: false,
      properties: {
        consistency_test_id: { type: "string", format: "uuid" },
        source_worker_run_id: { type: "string", format: "uuid" },
        policy: { type: "object" },
        hidden_rubric: { type: "object" }
      }
    }),
    output_schema: { type: "object", required: ["diagnostic_consistency_test", "transition"] },
    supported_modes: ["live"],
    preconditions: ["completed_governed_source_run", "same_frozen_package_available",
      "hidden_rubric_committed_before_dispatch"],
    outcomes: ["rubric_committed", "three_unclaimed_assignments_created"],
    issues: ["DIAGNOSTIC_CONSISTENCY_SOURCE_RUN_INCOMPLETE",
      "DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_SERIES_CONFLICT"],
    emitted_events: ["diagnostic.consistency_test.registered",
      "diagnostic.consistency_assignment.authorized", "diagnostic.assignment.created"],
    next_operations: ["diagnostic.consistency_test.get", "kernel.diagnostic_dispatch.authorize"]
  },
  readDescriptor({
    operationId: "diagnostic.consistency_test.get",
    summary: "Inspect the rubric commitment, three independent assignment/run scores, and separate platform and model-consistency report.",
    path: "/diagnostic/v0/consistency-tests/{consistency_test_id}",
    idName: "consistency_test_id",
    resultKey: "diagnostic_consistency_test",
    issues: ["DIAGNOSTIC_CONSISTENCY_TEST_NOT_FOUND",
      "DIAGNOSTIC_CONSISTENCY_INTEGRITY_VIOLATION"]
  }),
  readDescriptor({
    operationId: "diagnostic.evidence_package_assignment.get",
    summary: "Inspect the deterministic initial Assignment created from one frozen Evidence Package event.",
    path: "/diagnostic/v0/evidence-packages/{evidence_package_id}/assignment",
    idName: "evidence_package_id",
    resultKey: "diagnostic_assignment",
    issues: ["DIAGNOSTIC_ASSIGNMENT_NOT_FOUND"]
  }),
  readDescriptor({
    operationId: "diagnostic.evidence_package_assignment_status.get",
    summary: "Inspect pending, terminal, created, or nondeterministic Assignment Service processing truth.",
    path: "/diagnostic/v0/evidence-packages/{evidence_package_id}/assignment-status",
    idName: "evidence_package_id",
    resultKey: "assignment_processing",
    issues: ["DIAGNOSTIC_EVIDENCE_PACKAGE_NOT_FOUND",
      "DIAGNOSTIC_ASSIGNMENT_STAGE_RECORD_INTEGRITY_VIOLATION"]
  }),
  readDescriptor({
    operationId: "diagnostic.assignment_verification_material.get",
    summary: "Acquire read-only material for separate offline assignment-lineage recomputation.",
    path: "/diagnostic/v0/assignment-verification-material/{assignment_id}",
    idName: "assignment_id",
    resultKey: "assignment_verification_material",
    issues: ["DIAGNOSTIC_ASSIGNMENT_NOT_FOUND", "DIAGNOSTIC_ASSIGNMENT_INTEGRITY_VIOLATION"]
  }),
  readDescriptor({
    operationId: "diagnostic.independent_verification_bundle.get",
    summary: "Acquire one sealed complete-prefix verification bundle without invoking a production recomputation.",
    path: "/diagnostic/v0/independent-verification-bundles/{evidence_package_id}",
    idName: "evidence_package_id",
    resultKey: "independent_verification_bundle",
    issues: ["INDEPENDENT_VERIFICATION_BUNDLE_NOT_FOUND",
      "INDEPENDENT_VERIFICATION_BUNDLE_INTEGRITY_VIOLATION"]
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
    summary: "Compatibility facade for committed material revocation followed by verified local deletion of a Reproduction Bundle.",
    path: "/diagnostic/v0/artifact-retirements",
    input: {
      type: "object", required: ["artifact_digest", "reason"], additionalProperties: false,
      properties: {
        artifact_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        reason: { type: "string", minLength: 1, maxLength: 500 }
      }
    },
    resultKey: "artifact_tombstone",
    event: ["diagnostic.material_erasure.availability_revoked",
      "diagnostic.material_erasure.deleted_verified", "diagnostic.material_erasure.deletion_reused"],
    issues: ["DIAGNOSTIC_ERASABLE_ARTIFACT_NOT_FOUND",
      "DIAGNOSTIC_MATERIAL_RETENTION_OVERRIDE_REQUIRED", "DIAGNOSTIC_MATERIAL_LEGAL_HOLD_ACTIVE"],
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
