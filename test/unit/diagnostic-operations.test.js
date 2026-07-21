import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTIC_PROTOCOL_VERSION,
  getDiagnosticOperationDescriptor,
  listDiagnosticOperationDescriptors
} from "../../src/diagnostic-operations.js";

test("Diagnostic Protocol is self-describing and authority-free", () => {
  assert.equal(DIAGNOSTIC_PROTOCOL_VERSION, "0.2.0");
  const operations = listDiagnosticOperationDescriptors();
  assert.deepEqual(operations.map((item) => item.operation_id), [
    "diagnostic.workflow_runtime_adapter.contract.get",
    "diagnostic.repair_delivery_adapter.contract.get",
    "diagnostic.verification_runner.contract.get",
    "diagnostic.maintenance_agent_profile.get",
    "diagnostic.maintenance_work_queue.get",
    "diagnostic.maintenance_assurance.export",
    "diagnostic.maintenance_assurance.get",
    "diagnostic.coverage_onboarding.open",
    "diagnostic.coverage_onboarding.evidence_capture",
    "diagnostic.coverage_onboarding.get",
    "diagnostic.coverage_interpretation.assign",
    "diagnostic.coverage_interpretation_assignment.get",
    "diagnostic.coverage_interpretation.submit",
    "diagnostic.coverage_ambiguity.resolve",
    "diagnostic.coverage_review_bundle.create",
    "diagnostic.coverage_review_bundle.get",
    "diagnostic.coverage_specification.compile",
    "diagnostic.coverage_specification.get",
    "diagnostic.coverage_specification.validate",
    "diagnostic.coverage_validation.get",
    "diagnostic.workflow_coverage_capabilities.get",
    "diagnostic.coverage_reconciliation.advance",
    "diagnostic.coverage_reconciliation.get",
    "diagnostic.agent_workflow.register",
    "diagnostic.agent_workflow.get",
    "diagnostic.agent_revision.register",
    "diagnostic.agent_revision.get",
    "diagnostic.artifact.get",
    "diagnostic.runtime_event.receive",
    "diagnostic.external_activity_trace.get",
    "diagnostic.runtime_event_conflict.get",
    "diagnostic.correlation_registration.register",
    "diagnostic.correlation_registration.get",
    "diagnostic.correlation_projection.create",
    "diagnostic.correlation_projection.get",
    "diagnostic.interpretation_activation.activate",
    "diagnostic.interpretation_activation.get",
    "diagnostic.effect_evaluation.process",
    "diagnostic.effect_projection.get",
    "diagnostic.behavior_evaluation.get",
    "diagnostic.trigger.get",
    "diagnostic.claim_envelope.get",
    "diagnostic.deterministic_case.get",
    "diagnostic.evidence_policy_activation.activate",
    "diagnostic.evidence_policy_activation.get",
    "diagnostic.evidence_collection.process",
    "diagnostic.evidence_collection.get",
    "diagnostic.evidence_package.get",
    "diagnostic.evidence_package_material_availability.get",
    "diagnostic.material_erasure.request",
    "diagnostic.material_erasure.complete",
    "diagnostic.material_erasure.get",
    "diagnostic.evidence_revision.process",
    "diagnostic.evidence_revision.get",
    "diagnostic.assignment_policy_activation.activate",
    "diagnostic.assignment_policy_activation.get",
    "diagnostic.assignment.get",
    "diagnostic.assignment.claim",
    "diagnostic.worker_run.get",
    "diagnostic.worker_run.launch_authorize",
    "diagnostic.worker_run.started",
    "diagnostic.worker_run.complete",
    "diagnostic.consistency_test.register",
    "diagnostic.consistency_test.get",
    "diagnostic.evidence_package_assignment.get",
    "diagnostic.evidence_package_assignment_status.get",
    "diagnostic.assignment_verification_material.get",
    "diagnostic.independent_verification_bundle.get",
    "diagnostic.case.report_failure",
    "diagnostic.failure_specification.confirm",
    "diagnostic.reproduction.create",
    "diagnostic.diagnosis_worker.register",
    "diagnostic.diagnosis_request.create",
    "diagnostic.diagnosis_workspace.get",
    "diagnostic.diagnosis_proposal.submit",
    "diagnostic.diagnosis_request.fail",
    "diagnostic.diagnosis_proposal.review",
    "diagnostic.diagnosis_request.get",
    "diagnostic.diagnosis_proposal.get",
    "diagnostic.repair_worker.register",
    "diagnostic.repair_task.create",
    "diagnostic.repair_task.discover",
    "diagnostic.repair_task.claim",
    "diagnostic.repair_task.heartbeat",
    "diagnostic.repair_workspace_artifact.get",
    "diagnostic.repair_candidate.submit",
    "diagnostic.repair_task.fail",
    "diagnostic.repair_task.release",
    "diagnostic.repair_task.cancel",
    "diagnostic.repair_task.get",
    "diagnostic.repair_candidate.get",
    "diagnostic.repair_delivery_binding.register",
    "diagnostic.repair_delivery_binding.get",
    "diagnostic.repair_delivery_target.inspect",
    "diagnostic.repair_delivery.materialize",
    "diagnostic.repair_delivery.get",
    "diagnostic.repair_verification.create",
    "diagnostic.repair_verification.get",
    "diagnostic.promotion.authorize",
    "diagnostic.promotion.apply",
    "diagnostic.promotion.reconcile",
    "diagnostic.promotion.rollback",
    "diagnostic.promotion.get",
    "diagnostic.case.get",
    "diagnostic.artifact.retire"
  ]);

  for (const operation of operations) {
    assert.match(operation.transport.path, /^\/diagnostic\/v0\//);
    assert.equal(operation.visibility, "public");
    assert.notEqual(operation.effect_class, "external_effect");
    assert.notEqual(operation.authority_class, "capability_authority");
    assert.ok(operation.idempotency);
    assert.ok(Array.isArray(operation.preconditions));
    assert.ok(Array.isArray(operation.outcomes));
    assert.ok(Array.isArray(operation.issues));
    assert.ok(Array.isArray(operation.emitted_events));
    assert.ok(Array.isArray(operation.next_operations));
  }
});

test("Diagnostic dispatch consumes exact Kernel authority without launching work", () => {
  const claim = getDiagnosticOperationDescriptor("diagnostic.assignment.claim");
  assert.equal(claim.authority_class,
    "exact_signed_kernel_dispatch_authorization_and_bound_dispatcher");
  assert.equal(claim.effect_class, "diagnostic_assignment_claim_and_worker_run_binding");
  assert.ok(claim.preconditions.includes("material_currently_available"));
  assert.ok(claim.outcomes.includes("worker_run_bound_not_launched"));
  assert.doesNotMatch(JSON.stringify(claim), /provider_credential|ambient_egress/i);

  const run = getDiagnosticOperationDescriptor("diagnostic.worker_run.get");
  assert.equal(run.effect_class, "read_only");
});

test("Coverage Onboarding discovery is closed, append-only, and grants no downstream authority", () => {
  const open = getDiagnosticOperationDescriptor("diagnostic.coverage_onboarding.open");
  const capture = getDiagnosticOperationDescriptor("diagnostic.coverage_onboarding.evidence_capture");
  const read = getDiagnosticOperationDescriptor("diagnostic.coverage_onboarding.get");
  assert.equal(open.input_schema.additionalProperties, false);
  assert.equal(open.input_schema.properties.input.additionalProperties, false);
  assert.equal(capture.input_schema.properties.input.additionalProperties, false);
  assert.equal(capture.input_schema.properties.input.properties.selection.additionalProperties, false);
  assert.equal(open.output_schema.additionalProperties, false);
  assert.equal(capture.output_schema.additionalProperties, false);
  assert.equal(capture.effect_class, "content_addressed_evidence_and_append_only_state_transition");
  assert.equal(read.effect_class, "read_only");
  assert.doesNotMatch(JSON.stringify([open, capture, read]),
    /provider_credential_value|registration_authority|execution_authority/);
});

test("workflow interpretation separates bounded agent proposals from named-human ambiguity resolution", () => {
  const assign = getDiagnosticOperationDescriptor("diagnostic.coverage_interpretation.assign");
  const submit = getDiagnosticOperationDescriptor("diagnostic.coverage_interpretation.submit");
  const resolve = getDiagnosticOperationDescriptor("diagnostic.coverage_ambiguity.resolve");
  assert.equal(assign.input_schema.properties.input.additionalProperties, false);
  assert.equal(submit.input_schema.properties.input.additionalProperties, false);
  assert.equal(submit.input_schema.properties.input.properties.claims.items.additionalProperties, false);
  assert.equal(submit.authority_class, "authenticated_exactly_assigned_agent_passport");
  assert.equal(resolve.authority_class, "named_customer_owner_or_exact_trusted_operator");
  assert.ok(submit.preconditions.includes("all_citations_exist_in_assigned_snapshot"));
  assert.ok(resolve.preconditions.includes("exact_active_ambiguity_digest"));
  assert.doesNotMatch(JSON.stringify(submit.input_schema), /operator_confirmed|authority_granted/);
  assert.doesNotMatch(JSON.stringify([assign, submit, resolve]), /external_effect|registration_authority/);
});

test("coverage review discovery freezes exact bytes and exposes no execution authority", () => {
  const create = getDiagnosticOperationDescriptor("diagnostic.coverage_review_bundle.create");
  const read = getDiagnosticOperationDescriptor("diagnostic.coverage_review_bundle.get");
  assert.equal(create.input_schema.properties.input.additionalProperties, false);
  assert.equal(create.input_schema.properties.input.properties.repair_binding_reference
    .anyOf[1].additionalProperties, false);
  assert.equal(create.effect_class,
    "content_addressed_review_bundle_and_append_only_state_transition");
  assert.equal(read.effect_class, "read_only");
  assert.doesNotMatch(JSON.stringify([create, read]), /provider_credential_value|workflow_execution_authority/);
});

test("coverage compilation is implementation-bound, fail-closed, and never grants registration", () => {
  const compile = getDiagnosticOperationDescriptor("diagnostic.coverage_specification.compile");
  const validate = getDiagnosticOperationDescriptor("diagnostic.coverage_specification.validate");
  const receipt = getDiagnosticOperationDescriptor("diagnostic.coverage_validation.get");
  assert.equal(compile.input_schema.properties.input.additionalProperties, false);
  assert.equal(compile.input_schema.properties.input.properties.compiler.additionalProperties, false);
  assert.equal(validate.input_schema.properties.input.additionalProperties, false);
  assert.ok(validate.outcomes.includes("invalid_proposal_receipt_visible"));
  assert.ok(validate.outcomes.includes("registration_request_not_granted"));
  assert.equal(receipt.effect_class, "read_only");
  assert.doesNotMatch(JSON.stringify([compile, validate, receipt]),
    /workflow_execution_authority|registration_authority|repair_authority|promotion_authority/);
});

test("Accountable Coverage is read-only, non-binary, and cannot grant readiness or authority", () => {
  const coverage = getDiagnosticOperationDescriptor("diagnostic.workflow_coverage_capabilities.get");
  assert.equal(coverage.effect_class, "read_only_deterministic_projection");
  assert.equal(coverage.authority_class, "authenticated_customer_reader");
  assert.ok(coverage.outcomes.includes("partial_and_unavailable_states_disclosed"));
  assert.deepEqual(coverage.output_schema.properties.accountable_coverage.properties.coverage_status.enum,
    ["covered", "partial", "indeterminate", "not_covered", "unavailable"]);
  assert.equal(coverage.output_schema.properties.accountable_coverage.properties
    .claims_destination_commitment.const, false);
  assert.doesNotMatch(JSON.stringify(coverage), /force_ready|execution_authority|promotion_authority/);
});

test("coverage reconciliation persists cursor evidence without treating workflow signals as completeness", () => {
  const advance = getDiagnosticOperationDescriptor("diagnostic.coverage_reconciliation.advance");
  const read = getDiagnosticOperationDescriptor("diagnostic.coverage_reconciliation.get");
  assert.equal(advance.authority_class, "authenticated_bound_coverage_onboarding_agent");
  assert.equal(advance.input_schema.properties.input.additionalProperties, false);
  assert.equal(advance.input_schema.properties.input.properties.page, undefined);
  assert.ok(advance.outcomes.includes("reconciliation_degraded_and_resume_cursor_preserved"));
  assert.equal(read.effect_class, "read_only");
  const projection = read.output_schema.properties.coverage_reconciliation;
  assert.deepEqual(projection.properties.current_coverage.properties.state.enum,
    ["active", "degraded", "suspended", "unavailable"]);
  assert.equal(projection.properties.immutable_history.const, true);
  assert.equal(projection.properties.authority.const, "none");
});

test("Diagnostic execution separates launch, running proof, and diagnosis ingestion", () => {
  const launch = getDiagnosticOperationDescriptor("diagnostic.worker_run.launch_authorize");
  const started = getDiagnosticOperationDescriptor("diagnostic.worker_run.started");
  const completed = getDiagnosticOperationDescriptor("diagnostic.worker_run.complete");
  assert.equal(launch.effect_class, "isolated_diagnostic_launch_and_one_broker_request_only");
  assert.ok(launch.outcomes.includes("broker_grant_created"));
  assert.equal(started.effect_class, "runtime_provenance_recording");
  assert.ok(started.preconditions.includes("signed_runner_attestation_exact_and_current"));
  assert.equal(completed.effect_class,
    "diagnosis_ingestion_without_external_business_effects");
  assert.ok(completed.preconditions.includes("sole_output_schema_and_citations_valid"));
});

test("Diagnostic Worker protocol is advisory, provenance-bound, and authority-free", () => {
  const worker = getDiagnosticOperationDescriptor("diagnostic.diagnosis_worker.register");
  assert.equal(worker.authority_class, "authenticated_diagnostic_worker_passport");
  assert.equal(worker.effect_class, "advisory_worker_registration");
  const proposal = getDiagnosticOperationDescriptor("diagnostic.diagnosis_proposal.submit");
  assert.equal(proposal.effect_class, "non_authoritative_advisory_proposal");
  assert.doesNotMatch(JSON.stringify(proposal), /provider_token|provider_credential/i);
  const review = getDiagnosticOperationDescriptor("diagnostic.diagnosis_proposal.review");
  assert.equal(review.effect_class, "advisory_usefulness_review");
});

test("Repair Worker protocol is exact, replaceable, and excludes promotion authority", () => {
  const registration = getDiagnosticOperationDescriptor("diagnostic.repair_worker.register");
  assert.equal(registration.authority_class, "authenticated_repair_worker_passport");
  assert.equal(registration.input_schema.properties.input.additionalProperties, false);

  const submission = getDiagnosticOperationDescriptor("diagnostic.repair_candidate.submit");
  assert.equal(submission.authority_class, "authenticated_repair_worker_live_lease");
  assert.ok(submission.issues.includes("LEASE_EPOCH_FENCED"));
  assert.doesNotMatch(JSON.stringify(submission), /provider_token|repository_credential/i);

  const operations = listDiagnosticOperationDescriptors()
    .filter((operation) => operation.authority_class.includes("repair_worker"));
  assert.ok(operations.length >= 5);
  assert.ok(operations.every((operation) => !/promotion|rollback|verification/.test(operation.operation_id)));
});

test("reproduction operations preserve human confirmation and authority-free repair boundaries", () => {
  const confirmation = getDiagnosticOperationDescriptor("diagnostic.failure_specification.confirm");
  assert.equal(confirmation.authority_class, "authenticated_human_confirmation");
  assert.equal(confirmation.input_schema.properties.input.additionalProperties, false);
  const reproduction = getDiagnosticOperationDescriptor("diagnostic.reproduction.create");
  assert.equal(reproduction.effect_class, "diagnostic_state_transition");
  assert.ok(reproduction.outcomes.includes("reproduction_attempt_created"));
  assert.doesNotMatch(JSON.stringify(reproduction), /promotion_authority|model_confidence/i);
});

test("verification creates eligibility through an independent authority-free receipt", () => {
  const verification = getDiagnosticOperationDescriptor("diagnostic.repair_verification.create");
  assert.equal(verification.effect_class, "diagnostic_state_transition");
  assert.equal(verification.authority_class, "authenticated_customer_verification_requester");
  assert.ok(verification.preconditions.includes("independent_runner"));
  assert.ok(verification.next_operations.includes("diagnostic.promotion.authorize"));
  assert.doesNotMatch(JSON.stringify(verification), /n8n|provider_credential|promotion_authority/i);
});

test("promotion requires Owner authority and exact confirmed target evidence", () => {
  const authorize = getDiagnosticOperationDescriptor("diagnostic.promotion.authorize");
  assert.equal(authorize.authority_class, "authenticated_customer_owner");
  assert.ok(authorize.preconditions.includes("current_verified_candidate"));
  const apply = getDiagnosticOperationDescriptor("diagnostic.promotion.apply");
  assert.equal(apply.effect_class, "owner_authorized_target_change");
  assert.ok(apply.preconditions.includes("rollback_snapshot_before_request"));
  const reconcile = getDiagnosticOperationDescriptor("diagnostic.promotion.reconcile");
  assert.equal(reconcile.effect_class, "read_only_external_reconciliation");
  const rollback = getDiagnosticOperationDescriptor("diagnostic.promotion.rollback");
  assert.equal(rollback.effect_class, "owner_authorized_target_rollback");
  assert.doesNotMatch(JSON.stringify([authorize, apply, reconcile, rollback]), /n8n|provider_credential/i);
});

test("Runtime Event discovery exposes exact provider-neutral observation semantics", () => {
  const descriptor = getDiagnosticOperationDescriptor("diagnostic.runtime_event.receive");
  assert.equal(descriptor.authority_class, "exact_workflow_runtime_adapter_hmac");
  assert.equal(descriptor.effect_class, "diagnostic_observation_append");
  assert.deepEqual(descriptor.input_schema.required, [
    "schema_version", "adapter", "workflow_id", "revision_id", "external_execution_id", "event_id",
    "event_sequence", "lifecycle_claim", "correlation_id", "idempotency_key", "occurred_at", "payload"
  ]);
  assert.equal(descriptor.input_schema.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(descriptor), /n8n/i);
  assert.ok(descriptor.outcomes.includes("event_conflict_preserved"));
});

test("correlation discovery keeps registration, deterministic projection, and reads explicit", () => {
  const registration = getDiagnosticOperationDescriptor("diagnostic.correlation_registration.register");
  assert.equal(registration.effect_class, "immutable_diagnostic_contract_registration");
  assert.equal(registration.input_schema.additionalProperties, false);
  const projection = getDiagnosticOperationDescriptor("diagnostic.correlation_projection.create");
  assert.equal(projection.effect_class, "deterministic_diagnostic_projection");
  assert.equal(projection.input_schema.additionalProperties, false);
  assert.ok(projection.outcomes.includes("correlation_nondeterminism_conflict_preserved"));
  assert.doesNotMatch(JSON.stringify([registration, projection]), /email|company_name|model_similarity/i);
});

test("revision registration binds every behavior-bearing fingerprint without mutable labels", () => {
  const descriptor = getDiagnosticOperationDescriptor("diagnostic.agent_revision.register");
  const input = descriptor.input_schema.properties.input;
  assert.deepEqual(input.required, [
    "workflow_id",
    "workflow_content",
    "runtime",
    "nodes",
    "model",
    "configuration",
    "adapter"
  ]);
  assert.equal(input.additionalProperties, false);
  assert.equal(input.properties.current, undefined);
  assert.equal(input.properties.active, undefined);
  assert.deepEqual(input.properties.runtime.required, ["runtime_id", "runtime_version", "image_digest"]);
  assert.equal(input.properties.runtime.additionalProperties, false);
  assert.deepEqual(input.properties.nodes.items.required, ["node_type", "node_version"]);
  assert.deepEqual(input.properties.adapter.required,
    ["adapter_id", "adapter_version", "fingerprint_rules_digest"]);
  assert.equal(descriptor.authority_class, "authenticated_builder_attribution_only");
  assert.equal(descriptor.effect_class, "diagnostic_state_transition");
  assert.deepEqual(descriptor.next_operations, ["diagnostic.agent_revision.get"]);
});

test("returned Diagnostic descriptors cannot mutate the catalog", () => {
  const descriptor = getDiagnosticOperationDescriptor("diagnostic.agent_workflow.get");
  descriptor.summary = "changed";
  assert.notEqual(getDiagnosticOperationDescriptor("diagnostic.agent_workflow.get").summary, "changed");
});
