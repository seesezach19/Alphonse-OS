import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildDiagnosticDispatchDecisionArtifactManifest,
  DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_DIGEST
} from "../../src/diagnostic-dispatch-artifact.js";
import {
  assertDiagnosticDispatchAuthorizationCurrent,
  buildDiagnosticDispatchAuthorization,
  DIAGNOSTIC_DISPATCH_CANDIDATE_SCHEMA,
  DIAGNOSTIC_WORKER_PASSPORT_PROFILE_SCHEMA,
  evaluateDiagnosticDispatchCandidate,
  signDiagnosticDispatchAuthorization,
  validateDiagnosticDispatchCandidate,
  verifySignedDiagnosticDispatchAuthorization
} from "../../src/diagnostic-dispatch-contracts.js";

const ids = {
  installation: "00000000-0000-4000-8000-00000000a001",
  environment: "00000000-0000-4000-8000-000000000001",
  assignment: "00000000-0000-4000-8000-000000000150",
  evidence: "00000000-0000-4000-8000-000000000151",
  activation: "00000000-0000-4000-8000-000000000152",
  worker: "00000000-0000-4000-8000-000000000153",
  passport: "00000000-0000-4000-8000-000000000154",
  run: "00000000-0000-4000-8000-000000000155",
  authorization: "00000000-0000-4000-8000-000000000156",
  transition: "00000000-0000-4000-8000-000000000157"
};

const acceptedAt = "2026-07-18T16:00:00.000Z";
const assignmentExpiresAt = "2026-07-18T17:00:00.000Z";
const passportExpiresAt = "2026-07-18T18:00:00.000Z";

function fixture() {
  const isolation = {
    fresh_container_per_run: true,
    non_root: true,
    read_only_root: true,
    no_new_privileges: true,
    drop_all_capabilities: true
  };
  const mounts = {
    input: "read_only_exact_package",
    output: "bounded_write_only_result",
    temporary: "bounded_tmpfs",
    host_workspace: "prohibited"
  };
  const network = { mode: "model_broker_only_after_claim", general_egress: false };
  const resources = {
    max_cpus: 1,
    max_memory_bytes: 536870912,
    max_pids: 64,
    max_output_bytes: 1048576,
    max_runtime_seconds: 600
  };
  const runtime = {
    kind: "isolated_diagnostic_worker",
    image: {
      reference: "local/alphonse-diagnostic-worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      digest: `sha256:${"a".repeat(64)}`
    },
    runner: {
      runner_id: "diagnostic-runner:canonical",
      runner_version: "0.1.0",
      audience: "diagnostic-runner:v0.1"
    },
    isolation,
    mounts,
    network
  };
  const model = {
    provider: "openai",
    model: "frontier-diagnostic",
    version: "pinned-v1",
    capability_class: "diagnostic_reasoning"
  };
  const broker = {
    broker_id: "model-broker:customer-local",
    policy_id: "broker-policy:canonical-diagnostic",
    policy_version: "0.1.0",
    audience: "diagnostic-model-broker:v0.1",
    max_requests: 1,
    max_input_units: 20000,
    max_output_units: 4000,
    access_delivery: "after_claim_only"
  };
  const dataPolicy = {
    classification: "diagnostic_internal",
    residency: "customer_controlled_installation",
    evidence_scope: "exact_assigned_package_only",
    provider_training: "prohibited"
  };
  const egressPolicy = {
    mode: "model_broker_only_after_claim",
    general_egress: false,
    allowed_destination_audience: broker.audience
  };
  const capabilities = [
    "read_exact_evidence_package",
    "produce_schema_validated_diagnostic_output"
  ];
  const prohibitions = [
    "credential_access", "evidence_outside_assigned_package", "external_effect",
    "kernel_authority", "repair_execution", "unbrokered_model_access"
  ];
  const workRequirements = {
    required_passport_class: "diagnostic_interpreter",
    required_worker_capabilities: capabilities,
    prohibitions,
    model: {
      selection: "dispatch_time_exact_match",
      capability_class: "diagnostic_reasoning",
      access_delivery: "broker_after_claim_only"
    },
    runtime: {
      kind: "isolated_diagnostic_worker",
      image_selection: "dispatch_time_exact_match"
    },
    isolation,
    mounts,
    network,
    resources,
    data_classification: "diagnostic_internal",
    disclosure: {
      before_claim: "none",
      evidence_scope: "exact_assigned_package_only",
      recipient: "authorized_claimed_worker_run_only",
      provider_training: "prohibited"
    }
  };
  const assignmentDigest = sha256Digest({ assignment: 15 });
  const semanticDigest = sha256Digest({ package: 15 });
  const artifactDigest = sha256Digest({ package_artifact: 15 });
  const activationDigest = sha256Digest({ assignment_policy_activation: 15 });
  const assignment = {
    assignment_id: ids.assignment,
    evidence_package_id: ids.evidence,
    assignment_policy_activation_id: ids.activation,
    assignment_digest: assignmentDigest,
    state: { current: "unclaimed", revision: "0", last_transition_id: ids.transition,
      updated_at: acceptedAt },
    assignment: {
      evidence_package: { evidence_package_id: ids.evidence, semantic_digest: semanticDigest,
        package_artifact_digest: artifactDigest },
      assignment_policy: { assignment_policy_activation_id: ids.activation,
        activation_digest: activationDigest },
      work_requirements: workRequirements,
      temporal: { available_at: acceptedAt, expires_at: assignmentExpiresAt }
    }
  };
  const candidate = {
    schema_version: DIAGNOSTIC_DISPATCH_CANDIDATE_SCHEMA,
    assignment: {
      assignment_id: ids.assignment,
      assignment_digest: assignmentDigest,
      evidence_package_id: ids.evidence,
      evidence_package_semantic_digest: semanticDigest,
      evidence_package_artifact_digest: artifactDigest,
      assignment_policy_activation_id: ids.activation,
      assignment_policy_activation_digest: activationDigest
    },
    worker: {
      principal_id: ids.worker,
      passport_id: ids.passport,
      passport_configuration_digest: "pending",
      passport_class: "diagnostic_interpreter"
    },
    worker_run: {
      worker_run_id: ids.run,
      expires_at: "2026-07-18T16:45:00.000Z"
    },
    runtime: structuredClone(runtime),
    model: structuredClone(model),
    broker: structuredClone(broker),
    resources: structuredClone(resources),
    data_policy: structuredClone(dataPolicy),
    egress_policy: structuredClone(egressPolicy),
    dispatcher_audience: "diagnostic-dispatcher:v0.1",
    authorization_expires_at: "2026-07-18T16:04:00.000Z"
  };
  const packageSkillConfiguration = {
    diagnostic_worker_profile: {
      schema_version: DIAGNOSTIC_WORKER_PASSPORT_PROFILE_SCHEMA,
      passport_class: "diagnostic_interpreter",
      capabilities,
      prohibitions,
      data_policy: dataPolicy,
      egress_policy: egressPolicy
    }
  };
  const passport = {
    passport_id: ids.passport,
    agent_principal_id: ids.worker,
    runtime: { ...structuredClone(runtime), resources: structuredClone(resources) },
    model_configuration: { ...structuredClone(model), broker: structuredClone(broker) },
    package_skill_configuration: structuredClone(packageSkillConfiguration),
    permitted_intent_classes: ["diagnostic_analysis"],
    valid_from: "2026-07-18T15:00:00.000Z",
    expires_at: passportExpiresAt,
    validity_status: "valid"
  };
  passport.configuration_digest = sha256Digest({ runtime: passport.runtime,
    model_configuration: passport.model_configuration,
    package_skill_configuration: passport.package_skill_configuration });
  candidate.worker.passport_configuration_digest = passport.configuration_digest;
  const availability = {
    material_status: "complete",
    execution_eligible: true,
    integrity_status: "verified_present",
    current_as_of: acceptedAt
  };
  const eligibility = {
    eligible: true,
    assignment_expires_at: assignmentExpiresAt,
    passport_expires_at: passportExpiresAt,
    material_availability: availability,
    snapshot_digest: sha256Digest({ eligibility: 15 })
  };
  return { assignment, candidate, passport, eligibility };
}

test("dispatch candidate binds exact assignment, Passport, runtime, model, broker, data, and resources", () => {
  const input = fixture();
  const result = evaluateDiagnosticDispatchCandidate({
    ...input,
    acceptedAt,
    dispatcherAudience: "diagnostic-dispatcher:v0.1",
    allowedRunnerAudiences: ["diagnostic-runner:v0.1"]
  });
  assert.equal(result.candidate.worker.passport_class, "diagnostic_interpreter");
  assert.equal(result.candidate.runtime.network.general_egress, false);
  assert.equal(result.candidate.broker.access_delivery, "after_claim_only");
  assert.equal(result.candidate.data_policy.provider_training, "prohibited");
  assert.equal(result.passport_configuration_digest, input.passport.configuration_digest);
  assert.match(result.runtime_boundary_digest, /^sha256:[0-9a-f]{64}$/u);
});

test("signed dispatch authorization is canonical, audience-bound, single-use, and authority-limited", () => {
  const input = fixture();
  const evaluation = evaluateDiagnosticDispatchCandidate({ ...input, acceptedAt,
    dispatcherAudience: "diagnostic-dispatcher:v0.1",
    allowedRunnerAudiences: ["diagnostic-runner:v0.1"] });
  const built = buildDiagnosticDispatchAuthorization({
    authorizationId: ids.authorization,
    installationId: ids.installation,
    environmentId: ids.environment,
    evaluation,
    eligibility: input.eligibility,
    dispatcher: { type: "human", id: "local-bootstrap-operator",
      authorization: { mode: "direct_owner" } },
    nonce: "n".repeat(48),
    issuedAt: acceptedAt,
    decisionArtifactDigest: DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_DIGEST
  });
  const signing = { keyId: "diagnostic-dispatch-key:v1",
    secret: "unit-test-diagnostic-dispatch-secret-with-at-least-32-bytes" };
  const signed = signDiagnosticDispatchAuthorization(built.document, signing);
  const verified = verifySignedDiagnosticDispatchAuthorization(signed.signed, signing);
  assert.deepEqual(verified.document, built.document);
  assert.equal(verified.document.authority.single_use, true);
  assert.equal(verified.document.authority.external_business_effect_authority, "none");
  assert.equal(verified.document.authority.broker_token, "not_created");
  assert.equal(verified.document.authority.container_launch, "not_performed");
  assert.equal(assertDiagnosticDispatchAuthorizationCurrent(verified.document,
    "2026-07-18T16:03:59.999Z"), "2026-07-18T16:03:59.999Z");
  assert.throws(() => assertDiagnosticDispatchAuthorizationCurrent(verified.document,
    "2026-07-18T16:04:00.000Z"),
  (error) => error.code === "DIAGNOSTIC_DISPATCH_AUTHORIZATION_EXPIRED");

  const tampered = structuredClone(signed.signed);
  tampered.document_digest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => verifySignedDiagnosticDispatchAuthorization(tampered, signing),
    (error) => error.code === "DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID");
});

test("dispatch fails closed on ambient egress, Passport ambiguity, resource expansion, and audience drift", () => {
  const egress = fixture();
  egress.candidate.runtime.network.general_egress = true;
  assert.throws(() => validateDiagnosticDispatchCandidate(egress.candidate),
    (error) => error.code === "DIAGNOSTIC_DISPATCH_INPUT_INVALID");

  const ambiguousPassport = fixture();
  ambiguousPassport.passport.package_skill_configuration.unrelated_tooling = {};
  ambiguousPassport.passport.configuration_digest = sha256Digest({
    runtime: ambiguousPassport.passport.runtime,
    model_configuration: ambiguousPassport.passport.model_configuration,
    package_skill_configuration: ambiguousPassport.passport.package_skill_configuration
  });
  ambiguousPassport.candidate.worker.passport_configuration_digest =
    ambiguousPassport.passport.configuration_digest;
  assert.throws(() => evaluateDiagnosticDispatchCandidate({ ...ambiguousPassport, acceptedAt,
    dispatcherAudience: "diagnostic-dispatcher:v0.1",
    allowedRunnerAudiences: ["diagnostic-runner:v0.1"] }),
  (error) => error.code === "DIAGNOSTIC_DISPATCH_PASSPORT_INELIGIBLE");

  const expanded = fixture();
  expanded.candidate.resources.max_cpus = 2;
  expanded.passport.runtime.resources.max_cpus = 2;
  expanded.passport.configuration_digest = sha256Digest({ runtime: expanded.passport.runtime,
    model_configuration: expanded.passport.model_configuration,
    package_skill_configuration: expanded.passport.package_skill_configuration });
  expanded.candidate.worker.passport_configuration_digest = expanded.passport.configuration_digest;
  assert.throws(() => evaluateDiagnosticDispatchCandidate({ ...expanded, acceptedAt,
    dispatcherAudience: "diagnostic-dispatcher:v0.1",
    allowedRunnerAudiences: ["diagnostic-runner:v0.1"] }),
  (error) => error.code === "DIAGNOSTIC_DISPATCH_RESOURCE_LIMIT_EXCEEDED");

  const audience = fixture();
  audience.candidate.runtime.runner.audience = "diagnostic-runner:other";
  audience.passport.runtime.runner.audience = "diagnostic-runner:other";
  audience.passport.configuration_digest = sha256Digest({ runtime: audience.passport.runtime,
    model_configuration: audience.passport.model_configuration,
    package_skill_configuration: audience.passport.package_skill_configuration });
  audience.candidate.worker.passport_configuration_digest = audience.passport.configuration_digest;
  assert.throws(() => evaluateDiagnosticDispatchCandidate({ ...audience, acceptedAt,
    dispatcherAudience: "diagnostic-dispatcher:v0.1",
    allowedRunnerAudiences: ["diagnostic-runner:v0.1"] }),
  (error) => error.code === "DIAGNOSTIC_DISPATCH_RUNNER_NOT_ALLOWED");
});

test("dispatch decision artifact binds both databases, contracts, authority service, and claim service", () => {
  const manifest = buildDiagnosticDispatchDecisionArtifactManifest();
  for (const required of [
    "migrations/023_diagnostic_dispatch_authority.sql",
    "diagnostic-migrations/022_diagnostic_dispatch_claims.sql",
    "src/diagnostic-dispatch-contracts.js",
    "src/diagnostic-dispatch-authorization-service.js",
    "src/diagnostic-dispatch-service.js"
  ]) assert.ok(manifest.bound_files.some((entry) => entry.path === required), required);
  assert.equal(sha256Digest(manifest), DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_DIGEST);
});
