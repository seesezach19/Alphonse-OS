import { canonicalize, sha256Digest } from "./canonical-json.js";
import { assertNoSensitiveMaterial } from "./coverage-onboarding-contracts.js";
import { KernelError } from "./errors.js";

export const COVERAGE_COMPILATION_INPUT_SCHEMA_VERSION = "alphonse.coverage-compilation-input.v0.1";
export const COVERAGE_SPECIFICATION_SCHEMA_VERSION = "alphonse.coverage-specification.v0.1";
export const WORKFLOW_MANIFEST_SCHEMA_VERSION = "alphonse.workflow-manifest.v0.1";
export const COVERAGE_VALIDATION_RECEIPT_SCHEMA_VERSION = "alphonse.coverage-validation-receipt.v0.1";
export const COVERAGE_COMPILER_ID = "com.alphonse.coverage.compiler";
export const COVERAGE_COMPILER_VERSION = "0.1.0";
export const COVERAGE_VALIDATOR_ID = "com.alphonse.coverage.validator";
export const COVERAGE_VALIDATOR_VERSION = "0.1.0";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const STABLE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

function fail(code, message, details = {}) {
  throw new KernelError(400, code, message, details);
}

function exact(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("COVERAGE_COMPILATION_INPUT_INVALID", `${field} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalize(actual) !== canonicalize(expected)) {
    fail("COVERAGE_COMPILATION_INPUT_INVALID", `${field} fields must be exact.`, { expected, actual });
  }
  return value;
}

function string(value, field, maximum = 1000, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
      || (pattern && !pattern.test(value))) {
    fail("COVERAGE_COMPILATION_INPUT_INVALID", `${field} is invalid.`);
  }
  return value;
}

function digest(value, field) { return string(value, field, 80, DIGEST); }
function uuid(value, field) { return string(value, field, 100, UUID); }

function command(value, operationId) {
  const envelope = exact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) fail("UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  return { command_id: string(envelope.command_id, "command_id", 160), operation_id: operationId,
    input: envelope.input };
}

function reference(value, field) {
  const input = exact(value, field, ["reference_kind", "reference_id", "artifact_digest"]);
  return {
    reference_kind: string(input.reference_kind, `${field}.reference_kind`, 100, STABLE),
    reference_id: string(input.reference_id, `${field}.reference_id`, 200, STABLE),
    artifact_digest: digest(input.artifact_digest, `${field}.artifact_digest`)
  };
}

function implementation(value, field) {
  const input = exact(value, field, ["id", "version", "artifact_digest"]);
  return { id: string(input.id, `${field}.id`, 160, STABLE),
    version: string(input.version, `${field}.version`, 80, STABLE),
    artifact_digest: digest(input.artifact_digest, `${field}.artifact_digest`) };
}

export function validateCoverageCompileCommand(value) {
  const envelope = command(value, "diagnostic.coverage_specification.compile");
  const input = exact(envelope.input, "input", ["onboarding_id", "review_bundle_digest",
    "approval_id", "approval_digest", "expected_review_state_digest", "base_manifest_reference",
    "compiler"]);
  const normalized = {
    onboarding_id: uuid(input.onboarding_id, "input.onboarding_id"),
    review_bundle_digest: digest(input.review_bundle_digest, "input.review_bundle_digest"),
    approval_id: uuid(input.approval_id, "input.approval_id"),
    approval_digest: digest(input.approval_digest, "input.approval_digest"),
    expected_review_state_digest: digest(input.expected_review_state_digest,
      "input.expected_review_state_digest"),
    base_manifest_reference: input.base_manifest_reference === null ? null
      : reference(input.base_manifest_reference, "input.base_manifest_reference"),
    compiler: implementation(input.compiler, "input.compiler")
  };
  assertNoSensitiveMaterial(normalized, "input", 128 * 1024);
  return { ...envelope, input: normalized };
}

export function validateCoverageValidateCommand(value) {
  const envelope = command(value, "diagnostic.coverage_specification.validate");
  const input = exact(envelope.input, "input", ["onboarding_id", "compilation_id",
    "compilation_input_digest", "coverage_specification_digest",
    "workflow_manifest_proposal_digest", "validator"]);
  const normalized = {
    onboarding_id: uuid(input.onboarding_id, "input.onboarding_id"),
    compilation_id: uuid(input.compilation_id, "input.compilation_id"),
    compilation_input_digest: digest(input.compilation_input_digest, "input.compilation_input_digest"),
    coverage_specification_digest: digest(input.coverage_specification_digest,
      "input.coverage_specification_digest"),
    workflow_manifest_proposal_digest: digest(input.workflow_manifest_proposal_digest,
      "input.workflow_manifest_proposal_digest"),
    validator: implementation(input.validator, "input.validator")
  };
  assertNoSensitiveMaterial(normalized, "input", 128 * 1024);
  return { ...envelope, input: normalized };
}

function effectRecord(claim) {
  return {
    claim_id: claim.claim_id,
    status: claim.status,
    evidence_reference_digests: claim.evidence_references.map(sha256Digest).sort(),
    conflicting_evidence_reference_digests:
      claim.conflicting_evidence_references.map(sha256Digest).sort(),
    limitation_digests: claim.limitations.map(sha256Digest).sort()
  };
}

export function buildCoverageCompilation({ reviewBundle, approval, input, compiler }) {
  if (approval.status !== "eligible" || approval.approval_id !== input.approval_id
      || approval.approval_digest !== input.approval_digest
      || approval.review_bundle_digest !== input.review_bundle_digest
      || approval.review_state_digest !== input.expected_review_state_digest
      || reviewBundle.review_bundle_digest !== input.review_bundle_digest
      || reviewBundle.onboarding_id !== input.onboarding_id
      || canonicalize(input.compiler) !== canonicalize(compiler)) {
    throw new KernelError(409, "COVERAGE_COMPILATION_APPROVAL_CONFLICT",
      "Compilation requires the exact currently eligible review bundle, approval, review state, and compiler identity.");
  }
  const compilationInput = {
    schema_version: COVERAGE_COMPILATION_INPUT_SCHEMA_VERSION,
    onboarding_id: input.onboarding_id,
    review_bundle_digest: input.review_bundle_digest,
    approval_id: input.approval_id,
    approval_digest: input.approval_digest,
    review_state: approval.review_state,
    review_state_digest: approval.review_state_digest,
    base_manifest_reference: input.base_manifest_reference,
    compiler
  };
  const compilationInputDigest = sha256Digest(compilationInput);
  const bundle = reviewBundle.content;
  const contractReferences = [...bundle.integration_contract_references,
    ...bundle.behavior_contract_references]
    .sort((left, right) => canonicalize(left).localeCompare(canonicalize(right)));
  const specification = {
    schema_version: COVERAGE_SPECIFICATION_SCHEMA_VERSION,
    compilation_input_digest: compilationInputDigest,
    review_bundle_digest: input.review_bundle_digest,
    approval_digest: input.approval_digest,
    workflow_identity: { ...bundle.workflow_reference,
      workflow_reference_digest: bundle.workflow_reference_digest },
    revision_closure: {
      onboarding_id: input.onboarding_id,
      onboarding_revision: bundle.onboarding_revision,
      event_head_digest: bundle.event_head_digest,
      snapshot_digest: bundle.snapshot_digest,
      interpretation_digest: bundle.interpretation_digest
    },
    effect_inventory: bundle.effect_inventory.map(effectRecord)
      .sort((left, right) => left.claim_id.localeCompare(right.claim_id)),
    evidence_and_redaction_policy: {
      evidence_snapshot_digest: bundle.snapshot_digest,
      redaction_policy_reference: bundle.redaction_policy_reference
    },
    capability_prerequisites: {
      integration_contract_admitted: bundle.integration_contract_references.length > 0,
      behavior_contract_admitted: bundle.behavior_contract_references.length > 0,
      fixture_admitted: bundle.fixture_references.length > 0,
      repair_binding_admitted: bundle.repair_binding_reference !== null,
      verification_strategy_admitted: bundle.verification_strategy_reference !== null,
      coverage_profile_admitted: bundle.coverage_profile_reference !== null
    },
    unknowns: bundle.unknowns.map((item) => ({ claim_id: item.subject_reference.id,
      reason: item.reason, reason_digest: sha256Digest(item.reason), blocking: item.blocking })),
    limitations: [...bundle.limitations].sort(),
    contract_references: contractReferences,
    fixture_references: bundle.fixture_references,
    adapter_and_binding_references: {
      workflow_binding: bundle.workflow_binding,
      repair_binding_reference: bundle.repair_binding_reference,
      verification_strategy_reference: bundle.verification_strategy_reference,
      coverage_profile_reference: bundle.coverage_profile_reference
    },
    authority: "none"
  };
  const coverageSpecificationDigest = sha256Digest(specification);
  const manifest = {
    schema_version: WORKFLOW_MANIFEST_SCHEMA_VERSION,
    semantic_material: {
      workflow_identity: specification.workflow_identity,
      revision: {
        snapshot_digest: bundle.snapshot_digest,
        interpretation_digest: bundle.interpretation_digest
      },
      coverage: {
        coverage_specification_digest: coverageSpecificationDigest,
        effect_claim_ids: specification.effect_inventory.map((item) => item.claim_id),
        unknown_claim_ids: specification.unknowns.map((item) => item.claim_id).sort(),
        limitation_digests: specification.limitations.map(sha256Digest).sort()
      },
      contracts: {
        integration: bundle.integration_contract_references,
        behavior: bundle.behavior_contract_references,
        coverage_profile: bundle.coverage_profile_reference
      },
      fixtures: bundle.fixture_references,
      bindings: {
        adapter: bundle.workflow_binding,
        repair: bundle.repair_binding_reference,
        verification: bundle.verification_strategy_reference
      },
      base_manifest_reference: input.base_manifest_reference
    },
    authority: "none"
  };
  assertNoSensitiveMaterial(compilationInput, "coverage_compilation_input", 256 * 1024);
  assertNoSensitiveMaterial(specification, "coverage_specification", 2 * 1024 * 1024);
  assertNoSensitiveMaterial(manifest, "workflow_manifest_proposal", 2 * 1024 * 1024);
  return { compilation_input: compilationInput, compilation_input_digest: compilationInputDigest,
    coverage_specification: specification, coverage_specification_digest: coverageSpecificationDigest,
    workflow_manifest_proposal: manifest,
    workflow_manifest_proposal_digest: sha256Digest(manifest) };
}

function issue(code, path, message, severity = "error") {
  return { code, severity, path, message };
}

function check(checkId, passed, evidenceReferences = [], notApplicable = false) {
  return { check_id: checkId, status: notApplicable ? "not_applicable" : passed ? "passed" : "failed",
    evidence_references: evidenceReferences };
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && canonicalize(Object.keys(value).sort()) === canonicalize([...keys].sort());
}

function everyExact(values, keys) {
  return Array.isArray(values) && values.every((value) => exactKeys(value, keys));
}

export function buildCoverageValidation({ compilation, reviewBundle, approval, validator }) {
  const spec = compilation.coverage_specification;
  const manifest = compilation.workflow_manifest_proposal;
  const issues = [];
  const checks = [];
  const inputIntegrity = sha256Digest(compilation.compilation_input) === compilation.compilation_input_digest
    && sha256Digest(spec) === compilation.coverage_specification_digest
    && sha256Digest(manifest) === compilation.workflow_manifest_proposal_digest;
  checks.push(check("coverage.input_integrity", inputIntegrity, [compilation.compilation_input_digest,
    compilation.coverage_specification_digest, compilation.workflow_manifest_proposal_digest]));
  if (!inputIntegrity) issues.push(issue("coverage.integrity_mismatch", "", "Compiled artifact digest mismatch."));

  const schemaClosed = exactKeys(spec, ["schema_version", "compilation_input_digest",
    "review_bundle_digest", "approval_digest", "workflow_identity", "revision_closure",
    "effect_inventory", "evidence_and_redaction_policy", "capability_prerequisites", "unknowns",
    "limitations", "contract_references", "fixture_references", "adapter_and_binding_references",
    "authority"])
    && exactKeys(manifest, ["schema_version", "semantic_material", "authority"])
    && exactKeys(spec.workflow_identity, ["system", "environment", "provider_workflow_id",
      "workflow_reference_digest"])
    && exactKeys(spec.revision_closure, ["onboarding_id", "onboarding_revision",
      "event_head_digest", "snapshot_digest", "interpretation_digest"])
    && exactKeys(spec.evidence_and_redaction_policy,
      ["evidence_snapshot_digest", "redaction_policy_reference"])
    && exactKeys(spec.capability_prerequisites, ["integration_contract_admitted",
      "behavior_contract_admitted", "fixture_admitted", "repair_binding_admitted",
      "verification_strategy_admitted", "coverage_profile_admitted"])
    && exactKeys(spec.adapter_and_binding_references, ["workflow_binding",
      "repair_binding_reference", "verification_strategy_reference", "coverage_profile_reference"])
    && exactKeys(manifest.semantic_material, ["workflow_identity", "revision", "coverage",
      "contracts", "fixtures", "bindings", "base_manifest_reference"])
    && exactKeys(manifest.semantic_material.revision, ["snapshot_digest", "interpretation_digest"])
    && exactKeys(manifest.semantic_material.coverage, ["coverage_specification_digest",
      "effect_claim_ids", "unknown_claim_ids", "limitation_digests"])
    && exactKeys(manifest.semantic_material.contracts,
      ["integration", "behavior", "coverage_profile"])
    && exactKeys(manifest.semantic_material.bindings, ["adapter", "repair", "verification"])
    && everyExact(spec.effect_inventory, ["claim_id", "status", "evidence_reference_digests",
      "conflicting_evidence_reference_digests", "limitation_digests"])
    && everyExact(spec.unknowns, ["claim_id", "reason", "reason_digest", "blocking"])
    && everyExact(spec.contract_references, ["reference_kind", "reference_id", "artifact_digest"])
    && everyExact(spec.fixture_references, ["reference_kind", "reference_id", "artifact_digest"])
    && everyExact(manifest.semantic_material.contracts.integration,
      ["reference_kind", "reference_id", "artifact_digest"])
    && everyExact(manifest.semantic_material.contracts.behavior,
      ["reference_kind", "reference_id", "artifact_digest"])
    && everyExact(manifest.semantic_material.fixtures,
      ["reference_kind", "reference_id", "artifact_digest"])
    && spec.schema_version === COVERAGE_SPECIFICATION_SCHEMA_VERSION
    && manifest.schema_version === WORKFLOW_MANIFEST_SCHEMA_VERSION;
  checks.push(check("coverage.closed_schema", schemaClosed));
  if (!schemaClosed) issues.push(issue("coverage.schema_invalid", "", "Compiled output schema is not exact."));

  const revisionClosed = spec.compilation_input_digest === compilation.compilation_input_digest
    && spec.review_bundle_digest === reviewBundle.review_bundle_digest
    && spec.approval_digest === approval.approval_digest
    && spec.revision_closure.onboarding_id === reviewBundle.onboarding_id
    && spec.revision_closure.snapshot_digest === reviewBundle.snapshot_digest
    && spec.revision_closure.interpretation_digest === reviewBundle.interpretation_digest
    && compilation.compilation_input.review_state_digest === approval.review_state_digest;
  checks.push(check("coverage.revision_closure", revisionClosed));
  if (!revisionClosed) issues.push(issue("coverage.revision_closure_mismatch", "/revision_closure",
    "Revision closure does not bind the exact review and approval material."));

  const prerequisites = spec.capability_prerequisites;
  const required = ["integration_contract_admitted", "fixture_admitted", "repair_binding_admitted",
    "verification_strategy_admitted", "coverage_profile_admitted"];
  for (const name of required) {
    checks.push(check(`coverage.${name}`, prerequisites[name] === true));
    if (prerequisites[name] !== true) issues.push(issue(`coverage.${name}_required`,
      `/capability_prerequisites/${name}`, `${name} must be established before validation can pass.`));
  }
  checks.push(check("coverage.behavior_contract_admitted", prerequisites.behavior_contract_admitted === true,
    [], prerequisites.behavior_contract_admitted !== true));

  const blockingUnknown = spec.unknowns.some((item) => item.blocking === true);
  checks.push(check("coverage.no_blocking_unknowns", !blockingUnknown));
  if (blockingUnknown) issues.push(issue("coverage.blocking_unknown", "/unknowns",
    "Blocking unknowns prevent a valid Coverage Specification."));

  let secretFree = true;
  try {
    assertNoSensitiveMaterial({ spec, manifest }, "compiled_coverage", 4 * 1024 * 1024);
  } catch {
    secretFree = false;
  }
  checks.push(check("coverage.secret_exclusion", secretFree));
  if (!secretFree) issues.push(issue("coverage.secret_material_rejected", "",
    "Compiled outputs contain secret-shaped material."));

  const operationalProvenance = schemaClosed
    && canonicalize(manifest.semantic_material.workflow_identity)
      === canonicalize(spec.workflow_identity)
    && canonicalize(manifest.semantic_material.revision) === canonicalize({
      snapshot_digest: spec.revision_closure.snapshot_digest,
      interpretation_digest: spec.revision_closure.interpretation_digest
    })
    && canonicalize(manifest.semantic_material.coverage) === canonicalize({
      coverage_specification_digest: compilation.coverage_specification_digest,
      effect_claim_ids: spec.effect_inventory.map((item) => item.claim_id),
      unknown_claim_ids: spec.unknowns.map((item) => item.claim_id).sort(),
      limitation_digests: spec.limitations.map(sha256Digest).sort()
    })
    && canonicalize(manifest.semantic_material.contracts) === canonicalize({
      integration: reviewBundle.content.integration_contract_references,
      behavior: reviewBundle.content.behavior_contract_references,
      coverage_profile: reviewBundle.content.coverage_profile_reference
    })
    && canonicalize(manifest.semantic_material.fixtures)
      === canonicalize(reviewBundle.content.fixture_references)
    && canonicalize(manifest.semantic_material.bindings) === canonicalize({
      adapter: reviewBundle.content.workflow_binding,
      repair: reviewBundle.content.repair_binding_reference,
      verification: reviewBundle.content.verification_strategy_reference
    })
    && canonicalize(manifest.semantic_material.base_manifest_reference)
      === canonicalize(compilation.compilation_input.base_manifest_reference);
  checks.push(check("coverage.operational_configuration_provenance", operationalProvenance));
  if (!operationalProvenance) issues.push(issue("coverage.agent_prose_in_operational_configuration",
    "/semantic_material", "Workflow Manifest material must be exactly derived from reviewed structured references."));

  for (const limitation of spec.limitations) {
    issues.push(issue("coverage.disclosed_limitation", "/limitations", limitation, "warning"));
  }
  const status = issues.some((item) => item.severity === "error") ? "invalid" : "valid";
  const receipt = {
    schema_version: COVERAGE_VALIDATION_RECEIPT_SCHEMA_VERSION,
    compilation_input_digest: compilation.compilation_input_digest,
    coverage_specification_digest: compilation.coverage_specification_digest,
    review_bundle_digest: reviewBundle.review_bundle_digest,
    approval_digest: approval.approval_digest,
    review_state_digest: approval.review_state_digest,
    compiler: compilation.compilation_input.compiler,
    validator,
    checks,
    issues,
    unknowns: spec.unknowns,
    limitations: spec.limitations,
    workflow_manifest_proposal_digest: status === "valid"
      ? compilation.workflow_manifest_proposal_digest : null,
    status,
    downstream_eligibility: {
      source_control_proposal: status === "valid",
      registration_request: false,
      registration_reason: status === "valid"
        ? "landed_manifest_import_required" : "coverage_validation_invalid"
    },
    authority: "none"
  };
  assertNoSensitiveMaterial(receipt, "coverage_validation_receipt", 2 * 1024 * 1024);
  return { validation_input_digest: sha256Digest({
    compilation_input_digest: compilation.compilation_input_digest,
    coverage_specification_digest: compilation.coverage_specification_digest,
    workflow_manifest_proposal_digest: compilation.workflow_manifest_proposal_digest,
    validator
  }), receipt, receipt_digest: sha256Digest(receipt) };
}
