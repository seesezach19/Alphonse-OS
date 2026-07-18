import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const DIAGNOSTIC_DISPATCH_CANDIDATE_SCHEMA =
  "alphonse.diagnostic-dispatch-candidate.v0.1";
export const DIAGNOSTIC_WORKER_PASSPORT_PROFILE_SCHEMA =
  "alphonse.diagnostic-worker-passport-profile.v0.1";
export const DIAGNOSTIC_DISPATCH_AUTHORIZATION_SCHEMA =
  "alphonse.diagnostic-dispatch-authorization.v0.1";
export const SIGNED_DIAGNOSTIC_DISPATCH_AUTHORIZATION_SCHEMA =
  "alphonse.signed-diagnostic-dispatch-authorization.v0.1";
export const DIAGNOSTIC_DISPATCH_ELIGIBILITY_SCHEMA =
  "alphonse.diagnostic-dispatch-eligibility.v0.1";
export const DIAGNOSTIC_WORKER_RUN_SCHEMA = "alphonse.diagnostic-worker-run.v0.1";
export const DIAGNOSTIC_DISPATCH_CONSUMPTION_SCHEMA =
  "alphonse.diagnostic-dispatch-authorization-consumption.v0.1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SIGNATURE = /^hmac-sha256:[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9._:-]{2,199}$/;
const MAX_AUTHORIZATION_SECONDS = 300;

function fail(code, message, status = 400, details = {}) {
  throw new KernelError(status, code, message, details);
}

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must be an object.`);
  }
  return value;
}

function exact(value, path, fields) {
  object(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (!same(actual, expected)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} fields must be exact.`, 400,
      { path, expected, received: actual });
  }
  return value;
}

function string(value, path, maximum = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID",
      `${path} must contain 1 to ${maximum} characters.`);
  }
  return value.trim();
}

function identifier(value, path) {
  const checked = string(value, path, 200);
  if (!IDENTIFIER.test(checked)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must be a bounded identifier.`);
  }
  return checked;
}

function uuid(value, path) {
  const checked = string(value, path, 100);
  if (!UUID.test(checked)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must be a UUID.`);
  }
  return checked;
}

function digest(value, path) {
  const checked = string(value, path, 80);
  if (!DIGEST.test(checked)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must be an exact SHA-256 digest.`);
  }
  return checked;
}

function timestamp(value, path) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must be an ISO timestamp.`);
  }
  const normalized = new Date(parsed).toISOString();
  if (value !== normalized) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must be a normalized ISO timestamp.`);
  }
  return normalized;
}

function integer(value, path, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID",
      `${path} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function exactStrings(value, path, expected = null) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32
      || value.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 160)
      || new Set(value).size !== value.length) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must be a bounded unique string array.`);
  }
  const normalized = [...value].sort();
  if (expected && !same(normalized, [...expected].sort())) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must contain the exact closed values.`,
      400, { expected: [...expected].sort(), received: normalized });
  }
  return normalized;
}

function validateIsolation(value, path) {
  exact(value, path, [
    "fresh_container_per_run", "non_root", "read_only_root", "no_new_privileges",
    "drop_all_capabilities"
  ]);
  if (Object.values(value).some((entry) => entry !== true)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} controls must all be true.`);
  }
  return structuredClone(value);
}

function validateMounts(value, path) {
  exact(value, path, ["input", "output", "temporary", "host_workspace"]);
  const expected = {
    input: "read_only_exact_package",
    output: "bounded_write_only_result",
    temporary: "bounded_tmpfs",
    host_workspace: "prohibited"
  };
  if (!same(value, expected)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must use the closed mount boundary.`);
  }
  return structuredClone(value);
}

function validateNetwork(value, path) {
  exact(value, path, ["mode", "general_egress"]);
  if (value.mode !== "model_broker_only_after_claim" || value.general_egress !== false) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must deny general egress.`);
  }
  return structuredClone(value);
}

function validateResources(value, path) {
  exact(value, path, [
    "max_cpus", "max_memory_bytes", "max_pids", "max_output_bytes", "max_runtime_seconds"
  ]);
  const ceilings = {
    max_cpus: 4,
    max_memory_bytes: 4 * 1024 * 1024 * 1024,
    max_pids: 512,
    max_output_bytes: 16 * 1024 * 1024,
    max_runtime_seconds: 3600
  };
  return Object.fromEntries(Object.entries(ceilings).map(([field, maximum]) => [
    field, integer(value[field], `${path}.${field}`, maximum)
  ]));
}

function validateRuntime(value, path) {
  exact(value, path, ["kind", "image", "runner", "isolation", "mounts", "network"]);
  if (value.kind !== "isolated_diagnostic_worker") {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path}.kind is unsupported.`);
  }
  exact(value.image, `${path}.image`, ["reference", "digest"]);
  const image = {
    reference: string(value.image.reference, `${path}.image.reference`, 500),
    digest: digest(value.image.digest, `${path}.image.digest`)
  };
  exact(value.runner, `${path}.runner`, ["runner_id", "runner_version", "audience"]);
  const runner = {
    runner_id: identifier(value.runner.runner_id, `${path}.runner.runner_id`),
    runner_version: string(value.runner.runner_version, `${path}.runner.runner_version`, 100),
    audience: identifier(value.runner.audience, `${path}.runner.audience`)
  };
  return {
    kind: value.kind,
    image,
    runner,
    isolation: validateIsolation(value.isolation, `${path}.isolation`),
    mounts: validateMounts(value.mounts, `${path}.mounts`),
    network: validateNetwork(value.network, `${path}.network`)
  };
}

function validateModel(value, path) {
  exact(value, path, [
    "provider", "model", "version", "capability_class", "snapshot", "reasoning", "sampling",
    "seed"
  ]);
  if (value.capability_class !== "diagnostic_reasoning") {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path}.capability_class is unsupported.`);
  }
  exact(value.snapshot, `${path}.snapshot`, ["identifier", "verification"]);
  exact(value.reasoning, `${path}.reasoning`, ["effort"]);
  exact(value.sampling, `${path}.sampling`, ["temperature", "top_p"]);
  exact(value.seed, `${path}.seed`, ["value", "verification"]);
  if (!new Set(["provider_verified", "broker_asserted", "unverifiable"])
    .has(value.snapshot.verification)
      || !new Set(["fixed", "low", "medium", "high"]).has(value.reasoning.effort)
      || typeof value.sampling.temperature !== "number"
      || !Number.isFinite(value.sampling.temperature)
      || value.sampling.temperature < 0 || value.sampling.temperature > 2
      || typeof value.sampling.top_p !== "number" || !Number.isFinite(value.sampling.top_p)
      || value.sampling.top_p <= 0 || value.sampling.top_p > 1
      || value.seed.value !== null && (!Number.isSafeInteger(value.seed.value)
        || value.seed.value < 0 || value.seed.value > 2_147_483_647)
      || !new Set(["provider_verified", "broker_asserted", "not_supported", "unverifiable"])
        .has(value.seed.verification)
      || (value.seed.verification === "not_supported" && value.seed.value !== null)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID",
      `${path} snapshot, reasoning, sampling, or seed controls are invalid.`);
  }
  return {
    provider: identifier(value.provider, `${path}.provider`),
    model: string(value.model, `${path}.model`, 200),
    version: string(value.version, `${path}.version`, 200),
    capability_class: value.capability_class,
    snapshot: {
      identifier: identifier(value.snapshot.identifier, `${path}.snapshot.identifier`),
      verification: value.snapshot.verification
    },
    reasoning: { effort: value.reasoning.effort },
    sampling: { temperature: value.sampling.temperature, top_p: value.sampling.top_p },
    seed: { value: value.seed.value, verification: value.seed.verification }
  };
}

function validateBroker(value, path) {
  exact(value, path, [
    "broker_id", "policy_id", "policy_version", "audience", "max_requests",
    "max_input_units", "max_output_units", "access_delivery"
  ]);
  if (value.access_delivery !== "after_claim_only") {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path}.access_delivery must be after_claim_only.`);
  }
  return {
    broker_id: identifier(value.broker_id, `${path}.broker_id`),
    policy_id: identifier(value.policy_id, `${path}.policy_id`),
    policy_version: string(value.policy_version, `${path}.policy_version`, 100),
    audience: identifier(value.audience, `${path}.audience`),
    max_requests: integer(value.max_requests, `${path}.max_requests`, 64),
    max_input_units: integer(value.max_input_units, `${path}.max_input_units`, 1_000_000),
    max_output_units: integer(value.max_output_units, `${path}.max_output_units`, 1_000_000),
    access_delivery: value.access_delivery
  };
}

function validateDataPolicy(value, path) {
  exact(value, path, ["classification", "residency", "evidence_scope", "provider_training"]);
  const expected = {
    classification: "diagnostic_internal",
    residency: "customer_controlled_installation",
    evidence_scope: "exact_assigned_package_only",
    provider_training: "prohibited"
  };
  if (!same(value, expected)) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path} must use the closed data boundary.`);
  }
  return structuredClone(value);
}

function validateEgressPolicy(value, path, brokerAudience) {
  exact(value, path, ["mode", "general_egress", "allowed_destination_audience"]);
  if (value.mode !== "model_broker_only_after_claim" || value.general_egress !== false
      || value.allowed_destination_audience !== brokerAudience) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID",
      `${path} must allow only the exact post-claim Model Broker audience.`);
  }
  return structuredClone(value);
}

function validateAssignmentBinding(value, path) {
  exact(value, path, [
    "assignment_id", "assignment_digest", "evidence_package_id",
    "evidence_package_semantic_digest", "evidence_package_artifact_digest",
    "assignment_policy_activation_id", "assignment_policy_activation_digest"
  ]);
  return {
    assignment_id: uuid(value.assignment_id, `${path}.assignment_id`),
    assignment_digest: digest(value.assignment_digest, `${path}.assignment_digest`),
    evidence_package_id: uuid(value.evidence_package_id, `${path}.evidence_package_id`),
    evidence_package_semantic_digest: digest(value.evidence_package_semantic_digest,
      `${path}.evidence_package_semantic_digest`),
    evidence_package_artifact_digest: digest(value.evidence_package_artifact_digest,
      `${path}.evidence_package_artifact_digest`),
    assignment_policy_activation_id: uuid(value.assignment_policy_activation_id,
      `${path}.assignment_policy_activation_id`),
    assignment_policy_activation_digest: digest(value.assignment_policy_activation_digest,
      `${path}.assignment_policy_activation_digest`)
  };
}

function validateWorker(value, path) {
  exact(value, path, [
    "principal_id", "passport_id", "passport_configuration_digest", "passport_class"
  ]);
  if (value.passport_class !== "diagnostic_interpreter") {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${path}.passport_class is unsupported.`);
  }
  return {
    principal_id: uuid(value.principal_id, `${path}.principal_id`),
    passport_id: uuid(value.passport_id, `${path}.passport_id`),
    passport_configuration_digest: digest(value.passport_configuration_digest,
      `${path}.passport_configuration_digest`),
    passport_class: value.passport_class
  };
}

export function validateDiagnosticDispatchCandidate(value) {
  exact(value, "dispatch_candidate", [
    "schema_version", "assignment", "worker", "worker_run", "runtime", "model", "broker",
    "resources", "data_policy", "egress_policy", "dispatcher_audience",
    "authorization_expires_at"
  ]);
  if (value.schema_version !== DIAGNOSTIC_DISPATCH_CANDIDATE_SCHEMA) {
    fail("DIAGNOSTIC_DISPATCH_INPUT_INVALID", "dispatch_candidate.schema_version is unsupported.");
  }
  exact(value.worker_run, "dispatch_candidate.worker_run", ["worker_run_id", "expires_at"]);
  const broker = validateBroker(value.broker, "dispatch_candidate.broker");
  return {
    schema_version: value.schema_version,
    assignment: validateAssignmentBinding(value.assignment, "dispatch_candidate.assignment"),
    worker: validateWorker(value.worker, "dispatch_candidate.worker"),
    worker_run: {
      worker_run_id: uuid(value.worker_run.worker_run_id,
        "dispatch_candidate.worker_run.worker_run_id"),
      expires_at: timestamp(value.worker_run.expires_at,
        "dispatch_candidate.worker_run.expires_at")
    },
    runtime: validateRuntime(value.runtime, "dispatch_candidate.runtime"),
    model: validateModel(value.model, "dispatch_candidate.model"),
    broker,
    resources: validateResources(value.resources, "dispatch_candidate.resources"),
    data_policy: validateDataPolicy(value.data_policy, "dispatch_candidate.data_policy"),
    egress_policy: validateEgressPolicy(value.egress_policy,
      "dispatch_candidate.egress_policy", broker.audience),
    dispatcher_audience: identifier(value.dispatcher_audience,
      "dispatch_candidate.dispatcher_audience"),
    authorization_expires_at: timestamp(value.authorization_expires_at,
      "dispatch_candidate.authorization_expires_at")
  };
}

export function validateDiagnosticDispatchCommand(value) {
  exact(value, "command", ["command_id", "operation_id", "input"]);
  const commandId = string(value.command_id, "command_id", 160);
  if (value.operation_id !== "kernel.diagnostic_dispatch.authorize") {
    fail("UNSUPPORTED_OPERATION",
      "operation_id must be kernel.diagnostic_dispatch.authorize.");
  }
  exact(value.input, "input", ["candidate"]);
  return {
    command_id: commandId,
    operation_id: value.operation_id,
    input: { candidate: validateDiagnosticDispatchCandidate(value.input.candidate) }
  };
}

export function validateDiagnosticClaimCommand(value) {
  exact(value, "command", ["command_id", "operation_id", "input"]);
  const commandId = string(value.command_id, "command_id", 160);
  if (value.operation_id !== "diagnostic.assignment.claim") {
    fail("UNSUPPORTED_OPERATION", "operation_id must be diagnostic.assignment.claim.");
  }
  exact(value.input, "input", ["assignment_id", "signed_authorization"]);
  return {
    command_id: commandId,
    operation_id: value.operation_id,
    input: {
      assignment_id: uuid(value.input.assignment_id, "input.assignment_id"),
      signed_authorization: structuredClone(object(value.input.signed_authorization,
        "input.signed_authorization"))
    }
  };
}

export function validateDiagnosticWorkerPassportProfile(value) {
  exact(value, "diagnostic_worker_profile", [
    "schema_version", "passport_class", "capabilities", "prohibitions", "data_policy",
    "egress_policy"
  ]);
  if (value.schema_version !== DIAGNOSTIC_WORKER_PASSPORT_PROFILE_SCHEMA
      || value.passport_class !== "diagnostic_interpreter") {
    fail("DIAGNOSTIC_DISPATCH_PASSPORT_INELIGIBLE",
      "Passport worker profile schema or class is unsupported.", 409);
  }
  return {
    schema_version: value.schema_version,
    passport_class: value.passport_class,
    capabilities: exactStrings(value.capabilities, "diagnostic_worker_profile.capabilities"),
    prohibitions: exactStrings(value.prohibitions, "diagnostic_worker_profile.prohibitions"),
    data_policy: validateDataPolicy(value.data_policy, "diagnostic_worker_profile.data_policy"),
    egress_policy: validateEgressPolicy(value.egress_policy,
      "diagnostic_worker_profile.egress_policy",
      value.egress_policy?.allowed_destination_audience)
  };
}

export function evaluateDiagnosticDispatchCandidate({ candidate, assignment, passport,
  eligibility, acceptedAt, dispatcherAudience, allowedRunnerAudiences }) {
  const checked = validateDiagnosticDispatchCandidate(candidate);
  const accepted = timestamp(acceptedAt, "accepted_at");
  const acceptedMs = Date.parse(accepted);
  if (!assignment?.assignment || !assignment?.assignment_digest) {
    fail("DIAGNOSTIC_DISPATCH_ASSIGNMENT_INTEGRITY_VIOLATION",
      "Dispatch eligibility did not include an intact Diagnostic Assignment.", 500);
  }
  const expectedAssignment = {
    assignment_id: assignment.assignment_id,
    assignment_digest: assignment.assignment_digest,
    evidence_package_id: assignment.evidence_package_id,
    evidence_package_semantic_digest: assignment.assignment.evidence_package.semantic_digest,
    evidence_package_artifact_digest: assignment.assignment.evidence_package.package_artifact_digest,
    assignment_policy_activation_id: assignment.assignment_policy_activation_id,
    assignment_policy_activation_digest: assignment.assignment.assignment_policy.activation_digest
  };
  if (!same(checked.assignment, expectedAssignment)) {
    fail("DIAGNOSTIC_DISPATCH_ASSIGNMENT_MISMATCH",
      "Dispatch candidate does not bind the exact current Assignment and Evidence Package.", 409);
  }
  if (assignment.state?.current !== "unclaimed" || eligibility?.eligible !== true) {
    fail("DIAGNOSTIC_DISPATCH_ASSIGNMENT_NOT_ELIGIBLE",
      "Diagnostic Assignment is not currently eligible for dispatch.", 409,
      { assignment_state: assignment.state?.current ?? null });
  }
  if (eligibility.material_availability?.material_status !== "complete"
      || eligibility.material_availability?.execution_eligible !== true
      || eligibility.material_availability?.integrity_status !== "verified_present") {
    fail("DIAGNOSTIC_DISPATCH_MATERIAL_UNAVAILABLE",
      "Diagnostic Evidence Package material is not currently eligible for dispatch.", 409);
  }
  if (checked.dispatcher_audience !== dispatcherAudience) {
    fail("DIAGNOSTIC_DISPATCH_AUDIENCE_MISMATCH",
      "Dispatch candidate uses an unauthorized dispatcher audience.", 409);
  }
  if (!allowedRunnerAudiences.includes(checked.runtime.runner.audience)) {
    fail("DIAGNOSTIC_DISPATCH_RUNNER_NOT_ALLOWED",
      "Dispatch candidate runner audience is not admitted.", 409);
  }
  if (!passport || passport.passport_id !== checked.worker.passport_id
      || passport.agent_principal_id !== checked.worker.principal_id
      || passport.configuration_digest !== checked.worker.passport_configuration_digest
      || passport.validity_status !== "valid") {
    fail("DIAGNOSTIC_DISPATCH_PASSPORT_INELIGIBLE",
      "Worker Principal and active Passport do not match the exact candidate.", 409);
  }
  if (!passport.permitted_intent_classes?.includes("diagnostic_analysis")) {
    fail("DIAGNOSTIC_DISPATCH_PASSPORT_INELIGIBLE",
      "Worker Passport does not permit diagnostic analysis.", 409);
  }
  const packageSkillKeys = Object.keys(passport.package_skill_configuration ?? {}).sort();
  if (!same(packageSkillKeys, ["diagnostic_worker_profile"])) {
    fail("DIAGNOSTIC_DISPATCH_PASSPORT_INELIGIBLE",
      "Worker Passport must expose one closed diagnostic worker profile.", 409);
  }
  const profile = validateDiagnosticWorkerPassportProfile(
    passport.package_skill_configuration.diagnostic_worker_profile);
  if (profile.passport_class !== checked.worker.passport_class) {
    fail("DIAGNOSTIC_DISPATCH_PASSPORT_INELIGIBLE",
      "Worker Passport class does not match the candidate.", 409);
  }
  const requirements = assignment.assignment.work_requirements;
  if (!same(profile.capabilities, [...requirements.required_worker_capabilities].sort())
      || !same(profile.prohibitions, [...requirements.prohibitions].sort())
      || !same(profile.data_policy, checked.data_policy)
      || !same(profile.egress_policy, checked.egress_policy)) {
    fail("DIAGNOSTIC_DISPATCH_PASSPORT_SCOPE_MISMATCH",
      "Worker Passport scope does not satisfy the exact Assignment requirements.", 409);
  }
  const expectedRuntime = { ...checked.runtime, resources: checked.resources };
  const expectedModel = { ...checked.model, broker: checked.broker };
  if (!same(passport.runtime, expectedRuntime)
      || !same(passport.model_configuration, expectedModel)
      || passport.configuration_digest !== sha256Digest({
        runtime: passport.runtime,
        model_configuration: passport.model_configuration,
        package_skill_configuration: passport.package_skill_configuration
      })) {
    fail("DIAGNOSTIC_DISPATCH_PASSPORT_CONFIGURATION_MISMATCH",
      "Worker runtime, model, broker, or Passport configuration digest differs from the candidate.", 409);
  }
  if (requirements.required_passport_class !== checked.worker.passport_class
      || requirements.runtime.kind !== checked.runtime.kind
      || !same(requirements.isolation, checked.runtime.isolation)
      || !same(requirements.mounts, checked.runtime.mounts)
      || !same(requirements.network, checked.runtime.network)
      || requirements.model.capability_class !== checked.model.capability_class
      || requirements.model.selection !== "dispatch_time_exact_match"
      || requirements.runtime.image_selection !== "dispatch_time_exact_match") {
    fail("DIAGNOSTIC_DISPATCH_RUNTIME_POLICY_MISMATCH",
      "Dispatch runtime or model proposal differs from the Assignment policy.", 409);
  }
  for (const [field, ceiling] of Object.entries(requirements.resources)) {
    if (checked.resources[field] > ceiling) {
      fail("DIAGNOSTIC_DISPATCH_RESOURCE_LIMIT_EXCEEDED",
        `Dispatch resource ${field} exceeds the Assignment ceiling.`, 409,
        { field, requested: checked.resources[field], ceiling });
    }
  }
  if (checked.data_policy.classification !== requirements.data_classification
      || checked.data_policy.evidence_scope !== requirements.disclosure.evidence_scope
      || checked.data_policy.provider_training !== requirements.disclosure.provider_training
      || requirements.disclosure.before_claim !== "none"
      || requirements.disclosure.recipient !== "authorized_claimed_worker_run_only") {
    fail("DIAGNOSTIC_DISPATCH_DATA_POLICY_MISMATCH",
      "Dispatch data policy differs from the Assignment disclosure boundary.", 409);
  }
  const assignmentExpiry = Date.parse(assignment.assignment.temporal.expires_at);
  const passportExpiry = Date.parse(passport.expires_at);
  const authorizationExpiry = Date.parse(checked.authorization_expires_at);
  const runExpiry = Date.parse(checked.worker_run.expires_at);
  if (acceptedMs >= assignmentExpiry || acceptedMs < Date.parse(passport.valid_from)
      || acceptedMs >= passportExpiry) {
    fail("DIAGNOSTIC_DISPATCH_TEMPORAL_BOUNDARY_INVALID",
      "Assignment or Passport is not active at authorization time.", 409);
  }
  if (authorizationExpiry <= acceptedMs
      || authorizationExpiry > acceptedMs + MAX_AUTHORIZATION_SECONDS * 1000
      || authorizationExpiry > assignmentExpiry || authorizationExpiry > passportExpiry
      || authorizationExpiry > runExpiry || runExpiry <= acceptedMs
      || runExpiry > assignmentExpiry || runExpiry > passportExpiry) {
    fail("DIAGNOSTIC_DISPATCH_TEMPORAL_BOUNDARY_INVALID",
      "Authorization and Worker Run validity must fit the short-lived Assignment and Passport intersection.",
      409);
  }
  return {
    candidate: checked,
    profile,
    requirement_digest: sha256Digest(requirements),
    passport_configuration_digest: passport.configuration_digest,
    model_configuration_digest: sha256Digest(checked.model),
    broker_policy_digest: sha256Digest(checked.broker),
    runtime_boundary_digest: sha256Digest({ runtime: checked.runtime, resources: checked.resources,
      data_policy: checked.data_policy, egress_policy: checked.egress_policy })
  };
}

export function buildDiagnosticDispatchAuthorization({ authorizationId, installationId,
  environmentId, evaluation, eligibility, dispatcher, nonce, issuedAt,
  decisionArtifactDigest }) {
  uuid(authorizationId, "authorization_id");
  uuid(installationId, "installation_id");
  uuid(environmentId, "environment_id");
  digest(decisionArtifactDigest, "decision_artifact_digest");
  const candidate = evaluation.candidate;
  const document = {
    schema_version: DIAGNOSTIC_DISPATCH_AUTHORIZATION_SCHEMA,
    authorization_id: authorizationId,
    installation_id: installationId,
    environment_id: environmentId,
    assignment: structuredClone(candidate.assignment),
    worker: structuredClone(candidate.worker),
    worker_run: structuredClone(candidate.worker_run),
    runtime: structuredClone(candidate.runtime),
    model: { ...structuredClone(candidate.model),
      configuration_digest: evaluation.model_configuration_digest },
    broker: { ...structuredClone(candidate.broker),
      policy_digest: evaluation.broker_policy_digest, token_status: "not_created" },
    resources: structuredClone(candidate.resources),
    data_policy: structuredClone(candidate.data_policy),
    egress_policy: structuredClone(candidate.egress_policy),
    dispatcher: {
      type: string(dispatcher.type, "dispatcher.type", 40),
      id: string(dispatcher.id, "dispatcher.id", 200),
      audience: candidate.dispatcher_audience,
      authorization: structuredClone(dispatcher.authorization ?? {})
    },
    runner_audience: candidate.runtime.runner.audience,
    nonce: string(nonce, "nonce", 128),
    nonce_digest: sha256Digest(nonce),
    eligibility_snapshot_digest: eligibility.snapshot_digest,
    assignment_requirements_digest: evaluation.requirement_digest,
    runtime_boundary_digest: evaluation.runtime_boundary_digest,
    decision_artifact_digest: decisionArtifactDigest,
    temporal: {
      issued_at: timestamp(issuedAt, "issued_at"),
      not_before: timestamp(issuedAt, "not_before"),
      expires_at: candidate.authorization_expires_at,
      assignment_expires_at: eligibility.assignment_expires_at,
      passport_expires_at: eligibility.passport_expires_at
    },
    authority: {
      grant: "claim_exact_assignment_for_one_worker_run",
      single_use: true,
      external_business_effect_authority: "none",
      repair_authority: "none",
      model_credential: "not_granted",
      broker_token: "not_created",
      container_launch: "not_performed"
    }
  };
  return { document, authorization_digest: sha256Digest(document) };
}

export function signDiagnosticDispatchAuthorization(document, { keyId, secret }) {
  const documentBytes = canonicalize(document);
  const documentDigest = sha256Digest(document);
  const signature = `hmac-sha256:${createHmac("sha256", secret).update(documentBytes).digest("hex")}`;
  const signed = {
    schema_version: SIGNED_DIAGNOSTIC_DISPATCH_AUTHORIZATION_SCHEMA,
    key_id: identifier(keyId, "key_id"),
    algorithm: "hmac-sha256",
    document_bytes: documentBytes,
    document_digest: documentDigest,
    signature
  };
  return { signed, signed_digest: sha256Digest(signed) };
}

export function verifySignedDiagnosticDispatchAuthorization(value, { keyId, secret }) {
  exact(value, "signed_authorization", [
    "schema_version", "key_id", "algorithm", "document_bytes", "document_digest", "signature"
  ]);
  if (value.schema_version !== SIGNED_DIAGNOSTIC_DISPATCH_AUTHORIZATION_SCHEMA
      || value.key_id !== keyId || value.algorithm !== "hmac-sha256"
      || !DIGEST.test(value.document_digest) || !SIGNATURE.test(value.signature)) {
    fail("DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID",
      "Signed Diagnostic Dispatch Authorization metadata is invalid.", 403);
  }
  let document;
  try {
    document = JSON.parse(value.document_bytes);
  } catch {
    fail("DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID",
      "Signed Diagnostic Dispatch Authorization bytes are not valid JSON.", 403);
  }
  if (canonicalize(document) !== value.document_bytes
      || sha256Digest(document) !== value.document_digest) {
    fail("DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID",
      "Signed Diagnostic Dispatch Authorization bytes or digest are not canonical.", 403);
  }
  const expected = Buffer.from(createHmac("sha256", secret)
    .update(value.document_bytes).digest("hex"), "hex");
  const received = Buffer.from(value.signature.slice("hmac-sha256:".length), "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    fail("DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID",
      "Signed Diagnostic Dispatch Authorization signature is invalid.", 403);
  }
  validateDiagnosticDispatchAuthorizationDocument(document);
  return { document, authorization_digest: value.document_digest,
    signed_digest: sha256Digest(value) };
}

export function validateDiagnosticDispatchAuthorizationDocument(value) {
  exact(value, "authorization", [
    "schema_version", "authorization_id", "installation_id", "environment_id", "assignment",
    "worker", "worker_run", "runtime", "model", "broker", "resources", "data_policy",
    "egress_policy", "dispatcher", "runner_audience", "nonce", "nonce_digest",
    "eligibility_snapshot_digest", "assignment_requirements_digest", "runtime_boundary_digest",
    "decision_artifact_digest", "temporal", "authority"
  ]);
  if (value.schema_version !== DIAGNOSTIC_DISPATCH_AUTHORIZATION_SCHEMA) {
    fail("DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID",
      "Diagnostic Dispatch Authorization schema is unsupported.", 403);
  }
  uuid(value.authorization_id, "authorization.authorization_id");
  uuid(value.installation_id, "authorization.installation_id");
  uuid(value.environment_id, "authorization.environment_id");
  validateAssignmentBinding(value.assignment, "authorization.assignment");
  validateWorker(value.worker, "authorization.worker");
  exact(value.worker_run, "authorization.worker_run", ["worker_run_id", "expires_at"]);
  uuid(value.worker_run.worker_run_id, "authorization.worker_run.worker_run_id");
  timestamp(value.worker_run.expires_at, "authorization.worker_run.expires_at");
  validateRuntime(value.runtime, "authorization.runtime");
  exact(value.model, "authorization.model",
    ["provider", "model", "version", "capability_class", "snapshot", "reasoning",
      "sampling", "seed", "configuration_digest"]);
  const { configuration_digest: ignoredConfigurationDigest, ...authorizationModel } = value.model;
  validateModel(authorizationModel, "authorization.model");
  digest(value.model.configuration_digest, "authorization.model.configuration_digest");
  exact(value.broker, "authorization.broker", [
    "broker_id", "policy_id", "policy_version", "audience", "max_requests", "max_input_units",
    "max_output_units", "access_delivery", "policy_digest", "token_status"
  ]);
  validateBroker({ broker_id: value.broker.broker_id, policy_id: value.broker.policy_id,
    policy_version: value.broker.policy_version, audience: value.broker.audience,
    max_requests: value.broker.max_requests, max_input_units: value.broker.max_input_units,
    max_output_units: value.broker.max_output_units, access_delivery: value.broker.access_delivery },
  "authorization.broker");
  digest(value.broker.policy_digest, "authorization.broker.policy_digest");
  if (value.broker.token_status !== "not_created") {
    fail("DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID",
      "Authorization cannot claim that a broker token already exists.", 403);
  }
  validateResources(value.resources, "authorization.resources");
  validateDataPolicy(value.data_policy, "authorization.data_policy");
  validateEgressPolicy(value.egress_policy, "authorization.egress_policy", value.broker.audience);
  exact(value.dispatcher, "authorization.dispatcher", ["type", "id", "audience", "authorization"]);
  string(value.dispatcher.type, "authorization.dispatcher.type", 40);
  string(value.dispatcher.id, "authorization.dispatcher.id", 200);
  identifier(value.dispatcher.audience, "authorization.dispatcher.audience");
  object(value.dispatcher.authorization, "authorization.dispatcher.authorization");
  identifier(value.runner_audience, "authorization.runner_audience");
  const nonce = string(value.nonce, "authorization.nonce", 128);
  if (nonce.length < 40 || sha256Digest(nonce) !== value.nonce_digest) {
    fail("DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID",
      "Authorization nonce is too short or does not match its digest.", 403);
  }
  for (const field of ["nonce_digest", "eligibility_snapshot_digest",
    "assignment_requirements_digest", "runtime_boundary_digest", "decision_artifact_digest"]) {
    digest(value[field], `authorization.${field}`);
  }
  exact(value.temporal, "authorization.temporal",
    ["issued_at", "not_before", "expires_at", "assignment_expires_at", "passport_expires_at"]);
  for (const field of Object.keys(value.temporal)) {
    timestamp(value.temporal[field], `authorization.temporal.${field}`);
  }
  exact(value.authority, "authorization.authority", [
    "grant", "single_use", "external_business_effect_authority", "repair_authority",
    "model_credential", "broker_token", "container_launch"
  ]);
  const authority = {
    grant: "claim_exact_assignment_for_one_worker_run",
    single_use: true,
    external_business_effect_authority: "none",
    repair_authority: "none",
    model_credential: "not_granted",
    broker_token: "not_created",
    container_launch: "not_performed"
  };
  if (!same(value.authority, authority)) {
    fail("DIAGNOSTIC_DISPATCH_AUTHORIZATION_INVALID",
      "Authorization exceeds the closed diagnostic claim authority.", 403);
  }
  return structuredClone(value);
}

export function assertDiagnosticDispatchAuthorizationCurrent(document, now) {
  const checkedAt = timestamp(now, "claim_time");
  const current = Date.parse(checkedAt);
  if (current < Date.parse(document.temporal.not_before)
      || current >= Date.parse(document.temporal.expires_at)
      || current >= Date.parse(document.worker_run.expires_at)
      || current >= Date.parse(document.temporal.assignment_expires_at)
      || current >= Date.parse(document.temporal.passport_expires_at)) {
    fail("DIAGNOSTIC_DISPATCH_AUTHORIZATION_EXPIRED",
      "Diagnostic Dispatch Authorization is not current for this claim.", 409);
  }
  return checkedAt;
}
