import assert from "node:assert/strict";
import test from "node:test";

import { getOperationDescriptor, listOperationDescriptors } from "../../src/operations.js";

test("every public operation describes transport, authority, effect, and idempotency", () => {
  const operations = listOperationDescriptors();
  assert.ok(operations.length >= 7);
  for (const operation of operations) {
    assert.equal(operation.visibility, "public");
    assert.ok(operation.transport.method);
    assert.ok(operation.transport.path);
    assert.ok(operation.authority_class);
    assert.ok(operation.effect_class);
    assert.ok(operation.idempotency);
    assert.ok(operation.input_schema);
    assert.ok(operation.output_schema);
    assert.equal(operation.output_schema.type, "object");
    assert.ok(Array.isArray(operation.output_schema.required));
    assert.ok(operation.output_schema.required.length > 0);
    assert.ok(Array.isArray(operation.supported_modes));
    assert.ok(Array.isArray(operation.issues));
    assert.ok(Array.isArray(operation.emitted_events));
    assert.ok(Array.isArray(operation.next_operations));
    assert.ok(Array.isArray(operation.outcomes));
  }
});

test("returned descriptors cannot mutate the catalog", () => {
  const descriptor = getOperationDescriptor("kernel.environment.profile.update");
  descriptor.summary = "mutated";
  assert.notEqual(getOperationDescriptor("kernel.environment.profile.update").summary, "mutated");
});

test("Kernel dispatch authority is exact, single-use, and does not claim consumption", () => {
  const authorize = getOperationDescriptor("kernel.diagnostic_dispatch.authorize");
  assert.equal(authorize.effect_class, "single_use_diagnostic_dispatch_authority");
  assert.ok(authorize.preconditions.includes("zero_external_effect_authority"));
  assert.ok(authorize.outcomes.includes("diagnostic_dispatch_authorized"));

  const read = getOperationDescriptor("kernel.diagnostic_dispatch_authorization.get");
  assert.equal(read.effect_class, "read_only");
  assert.match(read.summary, /without pretending Diagnostic Plane consumption/u);
});

test("governed context descriptors expose exact identifiers and grant fields", () => {
  const issue = getOperationDescriptor("kernel.context_access_grant.issue");
  assert.ok(issue.input_schema.properties.input.required.includes("passport_id"));
  assert.deepEqual(issue.emitted_events, ["kernel.context_access_grant.issued"]);
  const receipt = getOperationDescriptor("kernel.context_receipt.get");
  assert.deepEqual(receipt.input_schema.required, ["receipt_id"]);
});

test("package build operations remain inert Builder Agent work", () => {
  for (const operationId of ["kernel.package_candidate.validate", "kernel.package_candidate.simulate",
    "kernel.package_version.publish"]) {
    const descriptor = getOperationDescriptor(operationId);
    assert.equal(descriptor.authority_class, "authenticated_builder_agent_under_confirmed_intent");
    assert.equal(descriptor.effect_class, "kernel_state_transition");
  }
  assert.deepEqual(getOperationDescriptor("kernel.package_version.publish").emitted_events,
    ["kernel.package_version.published"]);
});

test("deployment, approval, and activation remain separate public transitions", () => {
  assert.deepEqual(getOperationDescriptor("kernel.deployment_plan.technical_review").emitted_events,
    ["kernel.deployment_plan.technical_reviewed"]);
  assert.deepEqual(getOperationDescriptor("kernel.deployment.stage").emitted_events, ["kernel.deployment.staged"]);
  assert.deepEqual(getOperationDescriptor("kernel.capability.business_approve").emitted_events,
    ["kernel.capability.business_approved"]);
  assert.deepEqual(getOperationDescriptor("kernel.capability_activation.activate").emitted_events,
    ["kernel.capability.activated"]);
  assert.equal(getOperationDescriptor("kernel.capability_action_card.get").effect_class, "read_only");
  assert.equal(getOperationDescriptor("kernel.capability_admission.check").effect_class, "read_only");
});

test("handoff, grant admission, and epoch fencing remain separate", () => {
  const operations = listOperationDescriptors();
  const handoff = operations.find((item) => item.operation_id === "kernel.handoff.propose");
  const accept = operations.find((item) => item.operation_id === "kernel.handoff.accept");
  const gate = operations.find((item) => item.operation_id === "kernel.workload_admission.check");
  const epoch = operations.find((item) => item.operation_id === "kernel.environment.execution_epoch.advance");
  assert.equal(handoff.authority_class, "authenticated_agent_bound_to_handoff");
  assert.equal(accept.effect_class, "kernel_state_transition");
  assert.equal(gate.effect_class, "read_only");
  assert.ok(gate.issues.includes("WORKLOAD_LEASE_EXPIRED"));
  assert.ok(gate.issues.includes("ENVIRONMENT_EPOCH_FENCED"));
  assert.equal(epoch.authority_class, "authenticated_sponsoring_human");
});

test("execution admission, completion, and evidence inspection remain separate", () => {
  const admission = getOperationDescriptor("kernel.execution_envelope.admit");
  const completion = getOperationDescriptor("kernel.run.complete_comparison");
  const envelope = getOperationDescriptor("kernel.execution_envelope.get");
  const run = getOperationDescriptor("kernel.run.get");
  const evidence = getOperationDescriptor("kernel.evidence_record.get");

  assert.deepEqual(admission.emitted_events, ["kernel.execution_envelope.admitted"]);
  assert.equal(admission.authority_class, "authenticated_agent_bound_to_execution");
  assert.ok(admission.issues.includes("CAPABILITY_INACTIVE"));
  assert.ok(admission.issues.includes("STALE_CONTEXT"));
  assert.deepEqual(completion.emitted_events, ["kernel.run.completed"]);
  assert.equal(completion.effect_class, "kernel_state_transition");
  assert.equal(envelope.effect_class, "read_only");
  assert.equal(run.effect_class, "read_only");
  assert.equal(evidence.effect_class, "read_only");
});

test("effect admission remains separate from exact external dispatch", () => {
  const admission = getOperationDescriptor("kernel.effect.admit");
  const dispatch = getOperationDescriptor("kernel.effect.dispatch");
  const effect = getOperationDescriptor("kernel.effect.get");
  const permit = getOperationDescriptor("kernel.dispatch_permit.get");
  assert.equal(admission.effect_class, "kernel_state_transition");
  assert.deepEqual(admission.emitted_events, ["kernel.effect.admitted"]);
  assert.equal(dispatch.effect_class, "external_effect");
  assert.deepEqual(dispatch.emitted_events, ["kernel.effect.succeeded", "kernel.effect.uncertain"]);
  assert.ok(dispatch.issues.includes("DISPATCH_PERMIT_CONSUMED"));
  assert.equal(effect.effect_class, "read_only");
  assert.equal(permit.effect_class, "read_only");
});

test("uncertain Effects reconcile through a separate read-only authority path", () => {
  const reconcile = getOperationDescriptor("kernel.recovery_case.reconcile");
  const recovery = getOperationDescriptor("kernel.recovery_case.get");
  const permit = getOperationDescriptor("kernel.reconciliation_permit.get");
  assert.equal(reconcile.effect_class, "external_observation");
  assert.equal(reconcile.authority_class, "authenticated_agent_bound_to_execution");
  assert.deepEqual(reconcile.emitted_events, ["kernel.recovery_case.reconciled_applied",
    "kernel.recovery_case.reconciled_not_applied"]);
  assert.equal(recovery.effect_class, "read_only");
  assert.equal(permit.effect_class, "read_only");
});

test("restore separates suspension, projection rebuild, verification, resume, and retention semantics", () => {
  const begin = getOperationDescriptor("kernel.environment.restore.begin");
  const rebuild = getOperationDescriptor("kernel.environment.restore.projection_rebuild");
  const verify = getOperationDescriptor("kernel.environment.restore.verify");
  const resume = getOperationDescriptor("kernel.environment.restore.resume");
  const lifecycle = getOperationDescriptor("kernel.data_lifecycle.record");
  assert.equal(begin.authority_class, "authenticated_sponsoring_human");
  assert.deepEqual(begin.emitted_events, ["kernel.environment.restore_started"]);
  assert.deepEqual(rebuild.emitted_events, ["kernel.environment.restore_projection_rebuilt"]);
  assert.deepEqual(verify.emitted_events, ["kernel.environment.restore_verified"]);
  assert.deepEqual(resume.emitted_events, ["kernel.environment.restore_resumed"]);
  assert.equal(lifecycle.input_schema.properties.input.required.includes("lifecycle_kind"), true);
});

test("portable import stops at immutable quarantine without deployment authority", () => {
  const policy = getOperationDescriptor("kernel.trust_policy.create");
  const importPackage = getOperationDescriptor("kernel.package.import");
  const quarantine = getOperationDescriptor("kernel.quarantined_package.get");
  assert.equal(policy.authority_class, "authenticated_sponsoring_human");
  assert.equal(importPackage.effect_class, "kernel_state_transition");
  assert.deepEqual(importPackage.emitted_events, ["kernel.package.quarantined", "kernel.package_import.denied"]);
  assert.equal(quarantine.effect_class, "read_only");
  assert.deepEqual(quarantine.next_operations, []);
});

test("hosted promotion coordinates evidence without receiving local authority", () => {
  const operationIds = ["kernel.coordinator_binding.create", "kernel.coordinator_binding.revoke",
    "kernel.coordinator.register_outbound", "kernel.promotion.poll_outbound",
    "kernel.promotion.request_outbound", "kernel.promotion.resolve_local_plan",
    "kernel.promotion_receipt.create", "kernel.promotion_receipt.deliver_outbound"];
  for (const operationId of operationIds) {
    const descriptor = getOperationDescriptor(operationId);
    assert.equal(descriptor.authority_class, "authenticated_sponsoring_human");
    assert.notEqual(descriptor.effect_class, "external_effect");
  }
  assert.equal(getOperationDescriptor("kernel.promotion_proposal.get").effect_class, "read_only");
  assert.equal(getOperationDescriptor("kernel.promotion_resolution.get").effect_class, "read_only");
  assert.ok(getOperationDescriptor("kernel.promotion_receipt.create").issues
    .includes("LOCAL_PROMOTION_PREDECESSOR_MISSING"));
});

test("upgrade operations keep compatibility, migration, activation, recovery, and retirement explicit", () => {
  for (const operationId of ["kernel.upgrade.compatibility_analyze", "kernel.upgrade.activation_policy_create",
    "kernel.upgrade.plan_create",
    "kernel.upgrade.migration_start", "kernel.upgrade.migration_checkpoint", "kernel.upgrade.migration_verify",
    "kernel.upgrade.canary_evaluate", "kernel.upgrade.activate", "kernel.upgrade.recovery_record",
    "kernel.package_version.retire"]) {
    const descriptor = getOperationDescriptor(operationId);
    assert.equal(descriptor.authority_class, "authenticated_sponsoring_human");
    assert.equal(descriptor.effect_class, "kernel_state_transition");
  }
  assert.equal(getOperationDescriptor("kernel.upgrade_compatibility_report.get").effect_class, "read_only");
  assert.equal(getOperationDescriptor("kernel.upgrade_activation_policy.get").effect_class, "read_only");
  assert.equal(getOperationDescriptor("kernel.package_retirement_status.get").effect_class, "read_only");
  assert.deepEqual(getOperationDescriptor("kernel.upgrade.canary_evaluate").emitted_events,
    ["kernel.upgrade.canary_passed", "kernel.upgrade.canary_paused"]);
  assert.ok(getOperationDescriptor("kernel.upgrade.canary_evaluate").input_schema.properties.input.properties
    .gate_results.items.required.includes("attestation_signature"));
  assert.ok(getOperationDescriptor("kernel.upgrade.plan_create").input_schema.properties.input.properties
    .preapproval_policy_id);
});

test("support coordination grants diagnostics but never standing remediation authority", () => {
  const health = getOperationDescriptor("kernel.environment_health.publish_outbound");
  const passport = getOperationDescriptor("kernel.support_case.approve");
  const diagnostic = getOperationDescriptor("kernel.support_diagnostic.read");
  const remediation = getOperationDescriptor("kernel.support_remediation.authorize");
  const quarantine = getOperationDescriptor("kernel.runtime_host.quarantine");
  const revocation = getOperationDescriptor("kernel.coordinator_binding.revocation_sync");
  assert.equal(health.effect_class, "kernel_state_transition");
  assert.equal(passport.authority_class, "authenticated_sponsoring_human");
  assert.equal(diagnostic.authority_class, "active_read_only_support_passport");
  assert.equal(diagnostic.effect_class, "read_only");
  assert.ok(remediation.issues.includes("CAPABILITY_INACTIVE"));
  assert.notEqual(remediation.effect_class, "external_effect");
  assert.ok(quarantine.emitted_events.includes("kernel.runtime_host.quarantined"));
  assert.ok(revocation.emitted_events.includes("kernel.coordinator_binding.revocation_delivered"));
});
