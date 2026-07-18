import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import jsonLogic from "json-logic-js";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  DIAGNOSTIC_INTERPRETATION_EXPORT_KINDS,
  validateDiagnosticInterpretationExport
} from "./diagnostic-effect-contracts.js";
import {
  DIAGNOSTIC_EVIDENCE_EXPORT_KINDS,
  validateDiagnosticEvidenceExport
} from "./diagnostic-evidence-contracts.js";
import {
  DIAGNOSTIC_ASSIGNMENT_EXPORT_KINDS,
  validateDiagnosticAssignmentExport
} from "./diagnostic-assignment-contracts.js";
import { KernelError } from "./errors.js";

const VALIDATOR_VERSION = "alphonse.package-validator.v0.1";
const CANDIDATE_SCHEMA = "alphonse.package_candidate.v0.1";
const REQUIRED_EXPORT_KINDS = ["schema", "skill", "evaluation", "adapter", "view", "accountability_contract"];
const JSON_LOGIC_OPERATIONS = new Set(["var", "+", "-", "*", "/", "%", "==", "===", "!=", "!==",
  ">", ">=", "<", "<=", "and", "or", "!", "if"]);

function issue(code, path, message, supportedOperations) {
  return { code, path, message, ...(supportedOperations ? { supported_operations: supportedOperations } : {}) };
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function string(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uuid(value, path) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new KernelError(400, "INVALID_IDENTIFIER", `${path} must be a UUID.`);
  }
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new KernelError(400, "INVALID_DIGEST", `${path} must be a SHA-256 digest.`);
  }
  return value;
}

function findSensitivePath(value, path = "candidate") {
  if (typeof value === "string" && (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    || /\bAKIA[0-9A-Z]{16}\b/.test(value) || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)
    || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value)
    || /^Bearer\s+\S+$/i.test(value) || /\b(?:password|passwd|token|api[_-]?key|secret)\s*[=:]\s*\S+/i.test(value)
    || /^[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i.test(value)
    || (!value.includes(" ") && value.length >= 40 && !/^(?:sha256:|oci:\/\/)/.test(value)
      && new Set(value).size / value.length > 0.55))) return path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitivePath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!object(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (/(^|_)(secret|password|private_key|token|api_key|credential|auth|authorization|cookie|dsn|connection_string)($|_)/i.test(key)
      && !/_ref$/i.test(key) && !path.endsWith(".properties")) return `${path}.${key}`;
    const found = findSensitivePath(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function exceedsDepth(value, maximum = 32) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (current.depth > maximum) return true;
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
    } else if (object(current.value)) {
      for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return false;
}

function rejectUnknownKeys(value, allowed, path, issues) {
  if (!object(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(issue("UNKNOWN_PACKAGE_FIELD", `${path}.${key}`, "Field is not declared by this contract version."));
  }
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => Boolean(string(item)));
}

function validateJsonSchemaSubset(schema, path, issues) {
  if (!object(schema)) {
    issues.push(issue("SCHEMA_CONTRACT_INCOMPLETE", path, "Schema must be an object."));
    return;
  }
  rejectUnknownKeys(schema, ["type", "additionalProperties", "required", "properties", "observation"], path, issues);
  if (schema.type !== "object" || !nonEmptyStrings(schema.required) || !object(schema.properties)) {
    issues.push(issue("SCHEMA_CONTRACT_INCOMPLETE", path, "Schema requires object type, required fields, and properties."));
    return;
  }
  for (const [name, property] of Object.entries(schema.properties)) {
    rejectUnknownKeys(property, ["type", "format", "minLength", "maxLength", "enum"], `${path}.properties.${name}`, issues);
    if (!new Set(["string", "integer", "number", "boolean", "object", "array"]).has(property?.type)
      || (property.format !== undefined && !new Set(["date-time", "uuid"]).has(property.format))) {
      issues.push(issue("SCHEMA_CONTRACT_INCOMPLETE", `${path}.properties.${name}`, "Schema property type or format is unsupported."));
    }
  }
  if (schema.observation !== undefined) {
    rejectUnknownKeys(schema.observation,
      ["observation_type", "allowed_detail_media_types", "required_correlation_roles"],
      `${path}.observation`, issues);
    if (!string(schema.observation?.observation_type)
      || !Array.isArray(schema.observation?.allowed_detail_media_types)
      || !schema.observation.allowed_detail_media_types.every((item) => Boolean(string(item)))
      || !nonEmptyStrings(schema.observation?.required_correlation_roles)
      || schema.additionalProperties !== false) {
      issues.push(issue("OBSERVATION_SCHEMA_CONTRACT_INCOMPLETE", `${path}.observation`,
        "Observation Schema requires closed claims, a type, detail media types, and correlation roles."));
    }
  }
}

function validJsonLogicRule(rule) {
  if (rule === null || ["string", "number", "boolean"].includes(typeof rule)) return true;
  if (Array.isArray(rule)) return rule.every(validJsonLogicRule);
  if (!object(rule)) return false;
  const keys = Object.keys(rule);
  if (keys.length !== 1 || !JSON_LOGIC_OPERATIONS.has(keys[0])) return false;
  return validJsonLogicRule(rule[keys[0]]);
}

function validFixtureValue(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(validFixtureValue);
  if (!object(value)) return false;
  return Object.entries(value).every(([key, child]) => /^[a-z][a-z0-9_]{0,63}$/i.test(key) && validFixtureValue(child));
}

function requireExactObject(value, keys, path) {
  if (!object(value)) throw new KernelError(400, "INVALID_INPUT", `${path} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new KernelError(400, "INVALID_INPUT", `${path} has an invalid shape.`);
  }
  return value;
}

function validateToolkit(toolkit, passport, session, issues) {
  const passportToolkit = passport.package_skill_configuration?.builder_toolkit;
  const sessionToolkit = session.base_references?.builder_toolkit;
  if (!object(toolkit) || !object(passportToolkit) || !object(sessionToolkit)) {
    issues.push(issue("BUILDER_TOOLKIT_REQUIRED", "candidate.builder_provenance.builder_toolkit",
      "Passport, Build Session, and candidate must bind one exact Builder Toolkit export set."));
    return null;
  }
  rejectUnknownKeys(toolkit, ["package_id", "version", "artifact_digest", "skill_exports"],
    "candidate.builder_provenance.builder_toolkit", issues);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(toolkit.package_id ?? "") || !/^\d+\.\d+\.\d+$/.test(toolkit.version ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(toolkit.artifact_digest ?? "")) {
    issues.push(issue("BUILDER_TOOLKIT_IDENTITY_INVALID", "candidate.builder_provenance.builder_toolkit",
      "Builder Toolkit requires package ID, exact semantic version, and artifact digest."));
  }
  const toolkitDigest = sha256Digest(toolkit);
  if (toolkitDigest !== session.base_references.toolkit_digest || canonicalize(toolkit) !== canonicalize(passportToolkit)
    || canonicalize(toolkit) !== canonicalize(sessionToolkit)) {
    issues.push(issue("BUILDER_TOOLKIT_MISMATCH", "candidate.builder_provenance.builder_toolkit",
      "Builder Toolkit exports do not match Passport and Build Session."));
  }
  if (!Array.isArray(toolkit.skill_exports) || toolkit.skill_exports.length === 0
    || toolkit.skill_exports.some((item) => !string(item?.export_id) || !/^\d+\.\d+\.\d+$/.test(item?.contract_version ?? "")
      || !/^sha256:[0-9a-f]{64}$/.test(item?.export_digest ?? ""))) {
    issues.push(issue("BUILDER_TOOLKIT_EXPORTS_INVALID", "candidate.builder_provenance.builder_toolkit.skill_exports",
      "Builder Toolkit requires exact versioned Skill Export digests."));
  }
  const exportIds = Array.isArray(toolkit.skill_exports) ? toolkit.skill_exports.map((item) => item.export_id) : [];
  if (new Set(exportIds).size !== exportIds.length) {
    issues.push(issue("BUILDER_TOOLKIT_EXPORTS_INVALID", "candidate.builder_provenance.builder_toolkit.skill_exports",
      "Builder Toolkit Skill Export IDs must be unique."));
  }
  if (Array.isArray(toolkit.skill_exports)) toolkit.skill_exports.forEach((item, index) => rejectUnknownKeys(item,
    ["export_id", "contract_version", "export_digest"],
    `candidate.builder_provenance.builder_toolkit.skill_exports[${index}]`, issues));
  return toolkitDigest;
}

function validateCandidateShape(candidate, passport, session) {
  const issues = [];
  const checks = [];
  if (!object(candidate) || JSON.stringify(candidate).length > 256 * 1024) {
    return { issues: [issue("INVALID_PACKAGE_CANDIDATE", "candidate", "Candidate must be an object no larger than 256 KiB.")], checks };
  }
  if (exceedsDepth(candidate)) issues.push(issue("PACKAGE_NESTING_LIMIT_EXCEEDED", "candidate", "Candidate nesting exceeds 32 levels."));
  rejectUnknownKeys(candidate, ["schema_version", "identity", "compatibility", "builder_provenance", "dependencies", "exports"], "candidate", issues);
  if (candidate.schema_version !== CANDIDATE_SCHEMA) issues.push(issue("UNSUPPORTED_CANDIDATE_SCHEMA", "candidate.schema_version", `Expected ${CANDIDATE_SCHEMA}.`));
  const identity = object(candidate.identity);
  rejectUnknownKeys(identity, ["package_id", "version", "name", "summary"], "candidate.identity", issues);
  if (!identity || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(identity.package_id ?? "")) {
    issues.push(issue("INVALID_PACKAGE_ID", "candidate.identity.package_id", "Package ID must be stable and namespaced."));
  }
  if (!identity || !/^\d+\.\d+\.\d+$/.test(identity.version ?? "")) {
    issues.push(issue("INVALID_SEMANTIC_VERSION", "candidate.identity.version", "Package version must be exact semantic version."));
  }
  if (!string(identity?.name) || !string(identity?.summary)) issues.push(issue("PACKAGE_IDENTITY_INCOMPLETE", "candidate.identity", "Package name and summary are required."));
  if (candidate.compatibility?.kernel_api !== ">=0.1 <0.2") {
    issues.push(issue("INCOMPATIBLE_KERNEL_API", "candidate.compatibility.kernel_api", "V0.1 requires >=0.1 <0.2."));
  }
  rejectUnknownKeys(candidate.compatibility, ["kernel_api"], "candidate.compatibility", issues);
  rejectUnknownKeys(candidate.builder_provenance, ["builder_toolkit", "context_receipt_ids"], "candidate.builder_provenance", issues);
  if (!Array.isArray(candidate.dependencies) || candidate.dependencies.length !== 0) {
    issues.push(issue("DEPENDENCIES_UNSUPPORTED", "candidate.dependencies", "V0.1 reference publication supports an explicit empty dependency set."));
  }
  const sensitivePath = findSensitivePath(candidate);
  if (sensitivePath) issues.push(issue("SECRET_MATERIAL_PROHIBITED", sensitivePath, "Package candidates may contain credential references, never secret material."));
  const toolkitDigest = validateToolkit(candidate.builder_provenance?.builder_toolkit, passport, session, issues);

  const exports = Array.isArray(candidate.exports) ? candidate.exports : [];
  if (exports.length === 0) issues.push(issue("EXPORTS_REQUIRED", "candidate.exports", "Package must declare exports."));
  const exportMap = new Map();
  exports.forEach((entry, index) => {
    const path = `candidate.exports[${index}]`;
    if (!object(entry) || !string(entry.kind) || !string(entry.export_id) || !/^\d+\.\d+\.\d+$/.test(entry.contract_version ?? "") || !object(entry.content)) {
      issues.push(issue("INVALID_EXPORT", path, "Export requires kind, stable ID, contract version, and content."));
      return;
    }
    rejectUnknownKeys(entry, ["kind", "export_id", "contract_version", "content"], path, issues);
    if (![...REQUIRED_EXPORT_KINDS, "capability", ...DIAGNOSTIC_INTERPRETATION_EXPORT_KINDS,
      ...DIAGNOSTIC_EVIDENCE_EXPORT_KINDS, ...DIAGNOSTIC_ASSIGNMENT_EXPORT_KINDS]
      .includes(entry.kind)) {
      issues.push(issue("UNKNOWN_EXPORT_KIND", `${path}.kind`, "Export kind is unsupported."));
    }
    if (exportMap.has(entry.export_id)) issues.push(issue("DUPLICATE_EXPORT_ID", `${path}.export_id`, "Export IDs must be package-unique."));
    exportMap.set(entry.export_id, { ...entry, index });
  });
  for (const kind of REQUIRED_EXPORT_KINDS) {
    if (![...exportMap.values()].some((entry) => entry.kind === kind)) {
      issues.push(issue("REQUIRED_EXPORT_MISSING", "candidate.exports", `Package requires a ${kind} export.`));
    }
  }
  const capabilities = [...exportMap.values()].filter((entry) => entry.kind === "capability");
  if (!capabilities.some((entry) => entry.content.effect_class === "read_only")) {
    issues.push(issue("READ_CAPABILITY_REQUIRED", "candidate.exports", "Package requires a read-only Capability."));
  }
  if (!capabilities.some((entry) => entry.content.effect_class === "external_write")) {
    issues.push(issue("CORRECTION_CAPABILITY_REQUIRED", "candidate.exports", "Package requires an effectful correction Capability."));
  }

  for (const entry of exportMap.values()) {
    const path = `candidate.exports[${entry.index}].content`;
    if (DIAGNOSTIC_INTERPRETATION_EXPORT_KINDS.includes(entry.kind)) {
      try {
        validateDiagnosticInterpretationExport(entry.kind, entry.content);
      } catch (error) {
        issues.push(issue(error.code ?? "DIAGNOSTIC_INTERPRETATION_CONTRACT_INVALID", path,
          error.message ?? "Diagnostic interpretation export is invalid."));
      }
    }
    if (DIAGNOSTIC_EVIDENCE_EXPORT_KINDS.includes(entry.kind)) {
      try {
        validateDiagnosticEvidenceExport(entry.kind, entry.content);
      } catch (error) {
        issues.push(issue(error.code ?? "DIAGNOSTIC_EVIDENCE_POLICY_INVALID", path,
          error.message ?? "Diagnostic evidence policy export is invalid."));
      }
    }
    if (DIAGNOSTIC_ASSIGNMENT_EXPORT_KINDS.includes(entry.kind)) {
      try {
        validateDiagnosticAssignmentExport(entry.kind, entry.content);
      } catch (error) {
        issues.push(issue(error.code ?? "DIAGNOSTIC_ASSIGNMENT_POLICY_INVALID", path,
          error.message ?? "Diagnostic Assignment policy export is invalid."));
      }
    }
    if (entry.kind === "schema") validateJsonSchemaSubset(entry.content, path, issues);
    if (entry.kind === "skill") {
      rejectUnknownKeys(entry.content, ["program", "input_schema", "output_schema", "steps", "context_requirements",
        "uncertainty_behavior", "evaluation_ref"], path, issues);
      if (!object(entry.content.program) || Object.keys(entry.content.program).length === 0
        || Object.values(entry.content.program).some((rule) => !validJsonLogicRule(rule))) {
        issues.push(issue("SKILL_PROGRAM_INVALID", `${path}.program`, "Skill requires a pure supported JSON-Logic output program."));
      }
      if (!object(entry.content.input_schema) || !object(entry.content.output_schema) || !Array.isArray(entry.content.steps)
        || !string(entry.content.uncertainty_behavior) || !string(entry.content.evaluation_ref)) {
        issues.push(issue("SKILL_CONTRACT_INCOMPLETE", path, "Skill requires typed input/output, steps, uncertainty behavior, and evaluation reference."));
      }
      rejectUnknownKeys(entry.content.input_schema, ["refs"], `${path}.input_schema`, issues);
      rejectUnknownKeys(entry.content.output_schema, ["type", "required"], `${path}.output_schema`, issues);
      if (!nonEmptyStrings(entry.content.steps) || entry.content.steps.some((step) => step.length > 200)
        || entry.content.output_schema?.type !== "object" || !nonEmptyStrings(entry.content.output_schema?.required)) {
        issues.push(issue("SKILL_CONTRACT_INCOMPLETE", path, "Skill steps and output schema must be concrete and typed."));
      }
      if (object(entry.content.program) && nonEmptyStrings(entry.content.output_schema?.required)
        && canonicalize(Object.keys(entry.content.program).sort()) !== canonicalize([...entry.content.output_schema.required].sort())) {
        issues.push(issue("SKILL_OUTPUT_CONTRACT_MISMATCH", `${path}.program`, "Program outputs must exactly match required output fields."));
      }
      if (exportMap.get(entry.content.evaluation_ref)?.kind !== "evaluation") {
        issues.push(issue("INCOMPATIBLE_EXPORT_REFERENCE", `${path}.evaluation_ref`, "Skill evaluation reference must resolve to an Evaluation export."));
      }
      const schemaRefs = entry.content.input_schema?.refs;
      if (!nonEmptyStrings(schemaRefs) || schemaRefs.some((reference) => exportMap.get(reference)?.kind !== "schema")) {
        issues.push(issue("INCOMPATIBLE_EXPORT_REFERENCE", `${path}.input_schema.refs`, "Skill input schema references must resolve to Schema exports."));
      }
    }
    if (entry.kind === "skill" || entry.kind === "capability") {
      const context = entry.content.context_requirements;
      rejectUnknownKeys(context, ["authority", "max_age_seconds"], `${path}.context_requirements`, issues);
      if (!object(context) || !Array.isArray(context.authority) || context.authority.length === 0) {
        issues.push(issue("CONTEXT_AUTHORITY_REQUIRED", `${path}.context_requirements.authority`, "Context authority requirements are mandatory."));
      }
      if (!object(context) || !Number.isInteger(context.max_age_seconds) || context.max_age_seconds < 1) {
        issues.push(issue("CONTEXT_FRESHNESS_REQUIRED", `${path}.context_requirements.max_age_seconds`, "Context freshness bound is mandatory."));
      }
    }
    if (entry.kind === "capability" && entry.content.effect_class === "external_write") {
      rejectUnknownKeys(entry.content, ["effect_class", "operation", "supported_operations", "declared_effects",
        "context_requirements", "idempotency", "evidence", "recovery", "accountability_contract_ref", "adapter_ref"], path, issues);
      const operationPath = `${path}.operation`;
      const adapter = exportMap.get(entry.content.adapter_ref);
      const supportedOperations = adapter?.kind === "adapter" && Array.isArray(adapter.content.operations)
        ? adapter.content.operations : [...exportMap.values()].filter((candidate) => candidate.kind === "adapter")
          .flatMap((candidate) => Array.isArray(candidate.content.operations) ? candidate.content.operations : []);
      if (!string(entry.content.operation) || !supportedOperations.includes(entry.content.operation)) {
        issues.push(issue("UNSUPPORTED_CORRECTION_OPERATION", operationPath, "Correction operation is unsupported by the referenced adapter.", supportedOperations));
      }
      if (!Array.isArray(entry.content.declared_effects) || entry.content.declared_effects.length === 0) {
        issues.push(issue("UNDECLARED_EFFECT", `${path}.declared_effects`, "Effectful Capability must declare exact effects."));
      } else if (entry.content.declared_effects.length !== 1 || entry.content.declared_effects.some((effect) => !object(effect)
        || !string(effect.target) || !string(effect.action) || !Number.isInteger(effect.maximum_items) || effect.maximum_items < 1)) {
        issues.push(issue("UNDECLARED_EFFECT", `${path}.declared_effects`, "Every effect requires target, action, and positive item limit."));
      }
      if (Array.isArray(entry.content.declared_effects)) entry.content.declared_effects.forEach((effect, index) => rejectUnknownKeys(effect,
        ["target", "action", "maximum_items"], `${path}.declared_effects[${index}]`, issues));
      if (!nonEmptyStrings(entry.content.supported_operations) || !entry.content.supported_operations.includes(entry.content.operation)
        || entry.content.supported_operations.some((operation) => !supportedOperations.includes(operation))) {
        issues.push(issue("UNSUPPORTED_CORRECTION_OPERATION", `${path}.supported_operations`,
          "Capability operations must be supported by the referenced adapter.", supportedOperations));
      }
      const idempotency = entry.content.idempotency;
      if (!object(idempotency) || !string(idempotency.key) || !string(idempotency.duplicate_result)) {
        issues.push(issue("IDEMPOTENCY_REQUIRED", `${path}.idempotency`, "Effectful Capability requires a complete idempotency contract."));
      }
      rejectUnknownKeys(idempotency, ["key", "duplicate_result"], `${path}.idempotency`, issues);
      const evidence = entry.content.evidence;
      if (!object(evidence) || !nonEmptyStrings(evidence.required)) {
        issues.push(issue("EVIDENCE_REQUIRED", `${path}.evidence`, "Effectful Capability requires evidence claims."));
      }
      rejectUnknownKeys(evidence, ["required"], `${path}.evidence`, issues);
      const recovery = entry.content.recovery;
      if (!object(recovery) || !string(recovery.strategy) || !string(recovery.uncertainty)) {
        issues.push(issue("RECOVERY_REQUIRED", `${path}.recovery`, "Effectful Capability requires strategy and uncertainty handling."));
      }
      rejectUnknownKeys(recovery, ["strategy", "uncertainty"], `${path}.recovery`, issues);
      for (const [field, expectedKind] of [["accountability_contract_ref", "accountability_contract"], ["adapter_ref", "adapter"]]) {
        const reference = entry.content[field];
        if (!string(reference) || exportMap.get(reference)?.kind !== expectedKind) {
          issues.push(issue("INCOMPATIBLE_EXPORT_REFERENCE", `${path}.${field}`, `${field} must resolve to a compatible ${expectedKind} export.`));
        }
      }
      if (adapter?.kind === "adapter" && !adapter.content.operations?.includes(entry.content.operation)) {
        issues.push(issue("INCOMPATIBLE_EXPORT_REFERENCE", `${path}.adapter_ref`, "Adapter does not declare the correction operation."));
      }
      const operationEffect = adapter?.content.operation_effects?.[entry.content.operation];
      const declaredEffect = entry.content.declared_effects?.[0];
      if (operationEffect && declaredEffect
        && (operationEffect.target !== declaredEffect.target || operationEffect.action !== declaredEffect.action)) {
        issues.push(issue("UNDECLARED_EFFECT", `${path}.declared_effects`, "Declared effect does not match the adapter operation contract."));
      }
    } else if (entry.kind === "capability") {
      rejectUnknownKeys(entry.content, ["effect_class", "skill_ref", "context_requirements", "accountability_contract_ref"], path, issues);
      if (entry.content.effect_class !== "read_only" || exportMap.get(entry.content.skill_ref)?.kind !== "skill") {
        issues.push(issue("INCOMPATIBLE_EXPORT_REFERENCE", `${path}.skill_ref`, "Read Capability must resolve one Skill export."));
      }
      if (entry.content.accountability_contract_ref !== undefined
        && exportMap.get(entry.content.accountability_contract_ref)?.kind !== "accountability_contract") {
        issues.push(issue("INCOMPATIBLE_EXPORT_REFERENCE", `${path}.accountability_contract_ref`,
          "Read Capability Accountability Contract must resolve an exact export."));
      }
    }
    if (entry.kind === "evaluation") {
      rejectUnknownKeys(entry.content, ["skill_ref", "cases"], path, issues);
      if (exportMap.get(entry.content.skill_ref)?.kind !== "skill" || !Array.isArray(entry.content.cases) || entry.content.cases.length === 0) {
        issues.push(issue("EVALUATION_CONTRACT_INCOMPLETE", path, "Evaluation requires a Skill reference and deterministic cases."));
      } else if (entry.content.cases.some((testCase) => !object(testCase) || !string(testCase.case_id)
        || !object(testCase.input) || !object(testCase.expected) || !validFixtureValue(testCase.input)
        || !validFixtureValue(testCase.expected))) {
        issues.push(issue("EVALUATION_CONTRACT_INCOMPLETE", `${path}.cases`, "Evaluation fixtures require non-secret primitive object inputs and expected outputs."));
      }
      const evaluationSkill = exportMap.get(entry.content.skill_ref);
      const requiredOutputs = evaluationSkill?.content.output_schema?.required;
      if (nonEmptyStrings(requiredOutputs) && Array.isArray(entry.content.cases) && entry.content.cases.some((testCase) => object(testCase?.expected)
        && canonicalize(Object.keys(testCase.expected).sort()) !== canonicalize([...requiredOutputs].sort()))) {
        issues.push(issue("EVALUATION_OUTPUT_CONTRACT_MISMATCH", `${path}.cases`, "Expected outputs must exactly match the Skill output schema."));
      }
      if (Array.isArray(entry.content.cases)) entry.content.cases.forEach((testCase, index) => {
        rejectUnknownKeys(testCase, ["case_id", "input", "expected"], `${path}.cases[${index}]`, issues);
      });
    }
    if (entry.kind === "adapter") {
      rejectUnknownKeys(entry.content, ["artifact_ref", "artifact_digest", "artifact_attestation_id", "operations", "operation_effects"], path, issues);
      const referenceDigest = entry.content.artifact_ref?.match(/@(sha256:[0-9a-f]{64})$/)?.[1];
      if (!referenceDigest || referenceDigest !== entry.content.artifact_digest || !nonEmptyStrings(entry.content.operations)
        || !string(entry.content.artifact_attestation_id)) {
        issues.push(issue("ADAPTER_REFERENCE_INVALID", path, "Adapter requires matching digest-pinned reference, operations, and trusted artifact attestation."));
      }
      if (!Array.isArray(entry.content.operations) || !object(entry.content.operation_effects) || entry.content.operations.some((operation) => {
        const effect = entry.content.operation_effects[operation];
        return !object(effect) || !string(effect.target) || !string(effect.action);
      }) || Object.keys(entry.content.operation_effects ?? {}).some((operation) => !entry.content.operations?.includes(operation))) {
        issues.push(issue("ADAPTER_REFERENCE_INVALID", `${path}.operation_effects`, "Every adapter operation requires one exact target/action effect contract."));
      }
      if (object(entry.content.operation_effects)) Object.entries(entry.content.operation_effects).forEach(([operation, effect]) =>
        rejectUnknownKeys(effect, ["target", "action"], `${path}.operation_effects.${operation}`, issues));
    }
    if (entry.kind === "view") {
      rejectUnknownKeys(entry.content, ["fields", "actions"], path, issues);
      if (!nonEmptyStrings(entry.content.fields) || !nonEmptyStrings(entry.content.actions)) {
        issues.push(issue("OPERATOR_VIEW_INCOMPLETE", path, "Operator View requires explicit fields and actions."));
      }
    }
    if (entry.kind === "accountability_contract") {
      rejectUnknownKeys(entry.content, ["outcome", "evidence_requirements", "deadline_seconds", "escalation", "recovery"], path, issues);
      for (const field of ["outcome", "evidence_requirements", "deadline_seconds", "escalation", "recovery"]) {
        if (entry.content[field] === undefined || entry.content[field] === null) issues.push(issue("ACCOUNTABILITY_CONTRACT_INCOMPLETE", `${path}.${field}`, `${field} is required.`));
      }
      if (!string(entry.content.outcome) || !nonEmptyStrings(entry.content.evidence_requirements)
        || !Number.isInteger(entry.content.deadline_seconds) || entry.content.deadline_seconds < 1
        || !string(entry.content.escalation?.on_timeout) || !string(entry.content.recovery?.on_failure)) {
        issues.push(issue("ACCOUNTABILITY_CONTRACT_INCOMPLETE", path, "Accountability Contract fields must be operationally complete."));
      }
      rejectUnknownKeys(entry.content.escalation, ["on_timeout"], `${path}.escalation`, issues);
      rejectUnknownKeys(entry.content.recovery, ["on_failure"], `${path}.recovery`, issues);
    }
  }

  checks.push("candidate_shape", "secret_scan", "builder_toolkit_binding", "required_exports", "context_contracts",
    "effect_contracts", "export_compatibility", "adapter_trust");
  issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  return { issues, checks, toolkitDigest, exportMap };
}

export function createPackageService(database, identityIntent, contextService, installationId, environmentId, signingSecret,
  signingKeyId, dataPlaneReceiptSecret, dataPlaneId, verificationKeys = {}) {
  const { pool, executeCommand } = database;

  async function attestArtifact(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    const artifactRef = string(envelope.input.artifact_ref);
    const artifactDigest = digest(envelope.input.artifact_digest, "input.artifact_digest");
    const buildAttestationDigest = digest(envelope.input.build_attestation_digest, "input.build_attestation_digest");
    if (!artifactRef || artifactRef.match(/@(sha256:[0-9a-f]{64})$/)?.[1] !== artifactDigest) {
      throw new KernelError(400, "ADAPTER_REFERENCE_INVALID", "Artifact reference must be digest-pinned to the attested bytes.");
    }
    const artifactAttestationId = randomUUID();
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    return executeCommand({ installationId, environmentId, command, requestDigest,
      apply: async (client, { acceptedAt }) => {
        await client.query(
          `INSERT INTO kernel_trusted_artifact_attestations
           (artifact_attestation_id,installation_id,environment_id,artifact_ref,artifact_digest,
            build_attestation_digest,trusted_by_principal_id,attested_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [artifactAttestationId, installationId, environmentId, artifactRef, artifactDigest,
            buildAttestationDigest, actor.id, acceptedAt]
        );
        return { aggregateType: "trusted_artifact_attestation", aggregateId: artifactAttestationId,
          transitionType: "kernel.artifact.trust_attested", transitionPayload: { artifact_digest: artifactDigest },
          result: { artifact_attestation: { artifact_attestation_id: artifactAttestationId, artifact_ref: artifactRef,
            artifact_digest: artifactDigest, build_attestation_digest: buildAttestationDigest,
            trusted_by_principal_id: actor.id, attested_at: acceptedAt, authority_granted: false } } };
      }
    });
  }

  async function getArtifactAttestation(id, client = pool) {
    uuid(id, "artifact_attestation_id");
    const result = await client.query(
      `SELECT * FROM kernel_trusted_artifact_attestations
       WHERE installation_id=$1 AND environment_id=$2 AND artifact_attestation_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "ARTIFACT_ATTESTATION_NOT_FOUND", "Trusted artifact attestation does not exist.");
    return result.rows[0];
  }

  async function boundBuild(input, authenticatedPassport) {
    const buildSessionId = uuid(input.build_session_id, "input.build_session_id");
    const session = await identityIntent.getBuildSession(buildSessionId);
    const passport = await identityIntent.getPassport(session.passport_id);
    if (session.status !== "active") throw new KernelError(409, "BUILD_SESSION_EXPIRED", "Build Session is not active.");
    if (passport.passport_id !== authenticatedPassport.passport_id
      || passport.agent_principal_id !== authenticatedPassport.agent_principal_id) {
      throw new KernelError(403, "BUILD_SESSION_AGENT_MISMATCH", "Build Session does not bind the authenticated Builder Agent.");
    }
    return { buildSessionId, session, passport };
  }

  async function validateContextProvenance(candidate, session, validation) {
    const receiptIds = candidate.builder_provenance?.context_receipt_ids;
    if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
      validation.issues.push(issue("GOVERNED_CONTEXT_REQUIRED", "candidate.builder_provenance.context_receipt_ids",
        "Package candidate must cite governed context used during construction."));
      return;
    }
    for (let index = 0; index < receiptIds.length; index += 1) {
      try {
        const receipt = await contextService.getReceipt(receiptIds[index]);
        const grant = await contextService.getGrant(receipt.grant_id);
        if (grant.work_intent_id !== session.work_intent_id || grant.passport_id !== session.passport_id) {
          validation.issues.push(issue("CONTEXT_PROVENANCE_MISMATCH", `candidate.builder_provenance.context_receipt_ids[${index}]`,
            "Context Receipt does not bind this Build Session's Passport and Work Intent."));
        }
      } catch (error) {
        validation.issues.push(issue("CONTEXT_RECEIPT_INVALID", `candidate.builder_provenance.context_receipt_ids[${index}]`,
          `Context Receipt cannot be verified: ${error.code ?? "UNKNOWN"}.`));
      }
    }
    validation.checks.push("governed_context_provenance");
    validation.issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  }

  async function validateArtifactAttestations(candidate, passport, validation) {
    const adapters = Array.isArray(candidate.exports) ? candidate.exports.filter((entry) => entry?.kind === "adapter") : [];
    for (const adapter of adapters) {
      const index = candidate.exports.indexOf(adapter);
      try {
        const attestation = await getArtifactAttestation(adapter.content.artifact_attestation_id);
        if (attestation.artifact_ref !== adapter.content.artifact_ref
          || attestation.artifact_digest !== adapter.content.artifact_digest
          || attestation.trusted_by_principal_id !== passport.sponsor_principal_id) {
          validation.issues.push(issue("ADAPTER_ATTESTATION_MISMATCH",
            `candidate.exports[${index}].content.artifact_attestation_id`,
            "Adapter bytes are not bound by the sponsoring human's trusted artifact attestation."));
        }
      } catch (error) {
        validation.issues.push(issue("ADAPTER_ATTESTATION_INVALID",
          `candidate.exports[${index}].content.artifact_attestation_id`,
          `Adapter attestation cannot be verified: ${error.code ?? "UNKNOWN"}.`));
      }
    }
    validation.checks.push("trusted_artifact_attestations");
    validation.issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  }

  async function validateCandidate(envelope, authenticatedPassport) {
    const actor = { type: "agent", id: authenticatedPassport.agent_principal_id };
    const command = { ...envelope, actor };
    const { buildSessionId, session, passport } = await boundBuild(envelope.input, authenticatedPassport);
    const candidate = object(envelope.input.candidate) ?? {};
    if (exceedsDepth(candidate)) throw new KernelError(400, "PACKAGE_NESTING_LIMIT_EXCEEDED", "Candidate nesting exceeds 32 levels.");
    const candidateDigest = sha256Digest(candidate);
    const manifestDigest = sha256Digest({ schema_version: candidate?.schema_version, identity: candidate?.identity,
      compatibility: candidate?.compatibility, dependencies: candidate?.dependencies ?? [], exports: (Array.isArray(candidate?.exports)
        ? candidate.exports : []).map((entry) => ({
        kind: entry?.kind, export_id: entry?.export_id, contract_version: entry?.contract_version,
        export_digest: sha256Digest(entry?.content ?? null)
      })) });
    const validation = validateCandidateShape(candidate, passport, session);
    await validateContextProvenance(candidate, session, validation);
    await validateArtifactAttestations(candidate, passport, validation);
    const validationReceiptId = randomUUID();
    const toolkitDigest = validation.toolkitDigest ?? sha256Digest(candidate?.builder_provenance?.builder_toolkit ?? null);
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    return executeCommand({ installationId, environmentId, command, requestDigest,
      apply: async (client, { acceptedAt }) => {
        await client.query(
          `INSERT INTO kernel_package_validation_receipts
           (validation_receipt_id,installation_id,environment_id,build_session_id,passport_id,work_intent_id,
            candidate_digest,manifest_digest,toolkit_digest,validator_version,valid,checks,issues,validated_by_principal_id,validated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [validationReceiptId, installationId, environmentId, buildSessionId, session.passport_id, session.work_intent_id,
            candidateDigest, manifestDigest, toolkitDigest, VALIDATOR_VERSION, validation.issues.length === 0,
            JSON.stringify(validation.checks), JSON.stringify(validation.issues), actor.id, acceptedAt]
        );
        return { aggregateType: "package_validation_receipt", aggregateId: validationReceiptId,
          transitionType: "kernel.package_candidate.validated", transitionPayload: { candidate_digest: candidateDigest,
            valid: validation.issues.length === 0 },
          result: { validation_receipt: { validation_receipt_id: validationReceiptId, build_session_id: buildSessionId,
            candidate_digest: candidateDigest, manifest_digest: manifestDigest, toolkit_digest: toolkitDigest,
            validator_version: VALIDATOR_VERSION, valid: validation.issues.length === 0,
            checks: validation.checks, issues: validation.issues, validated_at: acceptedAt } } };
      }
    });
  }

  async function getValidationReceipt(id, client = pool) {
    uuid(id, "validation_receipt_id");
    const result = await client.query(
      `SELECT * FROM kernel_package_validation_receipts WHERE installation_id=$1 AND environment_id=$2 AND validation_receipt_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "VALIDATION_RECEIPT_NOT_FOUND", "Validation Receipt does not exist.");
    return result.rows[0];
  }

  function runFixtureEvaluation(candidate) {
    const evaluation = candidate.exports.find((entry) => entry.kind === "evaluation");
    const skill = candidate.exports.find((entry) => entry.kind === "skill" && entry.export_id === evaluation?.content.skill_ref);
    if (!evaluation || !skill) throw new KernelError(409, "EVALUATION_EXPORT_NOT_FOUND", "Evaluation and referenced Skill exports are required.");
    const results = evaluation.content.cases.map((testCase) => {
      const actual = Object.fromEntries(Object.entries(skill.content.program)
        .map(([output, rule]) => [output, jsonLogic.apply(rule, testCase.input)]));
      return { case_id: testCase.case_id, passed: canonicalize(actual) === canonicalize(testCase.expected), actual_digest: sha256Digest(actual) };
    });
    return { inputDigest: sha256Digest(evaluation.content.cases), resultDigest: sha256Digest(results),
      passed: results.every((result) => result.passed) };
  }

  async function simulate(envelope, authenticatedPassport) {
    const actor = { type: "agent", id: authenticatedPassport.agent_principal_id };
    const command = { ...envelope, actor };
    const validationReceipt = await getValidationReceipt(envelope.input.validation_receipt_id);
    if (validationReceipt.passport_id !== authenticatedPassport.passport_id) {
      throw new KernelError(403, "VALIDATION_RECEIPT_AGENT_MISMATCH", "Validation Receipt does not bind the authenticated Builder Agent.");
    }
    const { session } = await boundBuild({ build_session_id: validationReceipt.build_session_id }, authenticatedPassport);
    if (!validationReceipt.valid) throw new KernelError(409, "CANDIDATE_NOT_VALID", "Candidate must pass deterministic validation before simulation.");
    const candidate = object(envelope.input.candidate);
    if (!candidate || exceedsDepth(candidate)) throw new KernelError(400, "INVALID_PACKAGE_CANDIDATE", "Simulation candidate is invalid or excessively nested.");
    const candidateDigest = sha256Digest(candidate);
    if (candidateDigest !== validationReceipt.candidate_digest) throw new KernelError(409, "CANDIDATE_DIGEST_MISMATCH", "Simulation candidate differs from validated bytes.");
    const mode = envelope.input.mode;
    if (!new Set(["deterministic_fixture", "observational_read_only"]).has(mode)) throw new KernelError(400, "UNSUPPORTED_SIMULATION_MODE", "Simulation mode is unsupported.");
    let contextReceiptId = null;
    let simulation;
    if (mode === "deterministic_fixture") {
      simulation = { ...runFixtureEvaluation(candidate), fidelity: "deterministic_fixture",
        assumptions: ["fixture inputs are package-owned test data"], limitations: ["no live systems observed"],
        attesterId: null, attestationSignature: null };
    } else {
      const attestation = requireExactObject(envelope.input.observational_attestation,
        ["data_plane_id", "validation_receipt_id", "candidate_digest", "context_receipt_id", "input_digest",
          "result_digest", "skill_export_id", "skill_export_digest", "issued_at"], "input.observational_attestation");
      const attestedSkill = candidate.exports.find((entry) => entry.kind === "skill" && entry.export_id === attestation.skill_export_id);
      const attestedEvaluation = candidate.exports.find((entry) => entry.kind === "evaluation"
        && entry.content.skill_ref === attestation.skill_export_id);
      if (attestation.data_plane_id !== dataPlaneId || attestation.validation_receipt_id !== validationReceipt.validation_receipt_id
        || attestation.candidate_digest !== candidateDigest || !attestedSkill || !attestedEvaluation
        || sha256Digest(attestedSkill.content) !== attestation.skill_export_digest) {
        throw new KernelError(409, "OBSERVATIONAL_ATTESTATION_MISMATCH", "Data Plane attestation does not bind the exact simulation.");
      }
      const signature = envelope.input.observational_attestation_signature;
      const expectedSignature = `hmac-sha256:${createHmac("sha256", dataPlaneReceiptSecret).update(canonicalize(attestation)).digest("hex")}`;
      const suppliedBytes = Buffer.from(signature ?? "", "utf8");
      const expectedBytes = Buffer.from(expectedSignature, "utf8");
      if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
        throw new KernelError(403, "INVALID_OBSERVATIONAL_ATTESTATION_SIGNATURE", "Observational simulation requires a valid Data Plane signature.");
      }
      if (!Number.isFinite(Date.parse(attestation.issued_at)) || Math.abs(Date.now() - Date.parse(attestation.issued_at)) > 60_000) {
        throw new KernelError(409, "OBSERVATIONAL_ATTESTATION_EXPIRED", "Observational attestation is outside its admission window.");
      }
      contextReceiptId = uuid(attestation.context_receipt_id, "observational_attestation.context_receipt_id");
      const contextReceipt = await contextService.getReceipt(contextReceiptId);
      const grant = await contextService.getGrant(contextReceipt.grant_id);
      if (grant.work_intent_id !== session.work_intent_id || grant.passport_id !== session.passport_id
        || contextReceipt.packet_hash !== attestation.input_digest) {
        throw new KernelError(409, "OBSERVATIONAL_CONTEXT_MISMATCH", "Observed context does not bind the Build Session and attestation.");
      }
      const currentAges = contextReceipt.freshness_claims.map((claim) => Math.floor((Date.now() - Date.parse(claim.observed_at)) / 1000));
      if (currentAges.some((age) => age > grant.max_age_seconds)) {
        throw new KernelError(409, "STALE_CONTEXT", "Observational simulation context is stale.");
      }
      simulation = { inputDigest: contextReceipt.packet_hash,
        resultDigest: digest(attestation.result_digest, "observational_attestation.result_digest"),
        passed: true, fidelity: "data_plane_attested_observational_read_only",
        assumptions: [`Data Plane evaluated Skill Export ${attestation.skill_export_id}`, "source observations remain external to Kernel"],
        limitations: ["no external write attempted", `maximum current observation age ${Math.max(...currentAges)} seconds`],
        attesterId: dataPlaneId, attestationSignature: signature };
    }
    const simulationReceiptId = randomUUID();
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    return executeCommand({ installationId, environmentId, command, requestDigest,
      apply: async (client, { acceptedAt }) => {
        await client.query(
          `INSERT INTO kernel_package_simulation_receipts
           (simulation_receipt_id,installation_id,environment_id,validation_receipt_id,candidate_digest,mode,
            context_receipt_id,input_digest,result_digest,fidelity,assumptions,limitations,attester_id,
            attestation_signature,passed,simulated_by_principal_id,simulated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [simulationReceiptId, installationId, environmentId, validationReceipt.validation_receipt_id, candidateDigest,
            mode, contextReceiptId, simulation.inputDigest, simulation.resultDigest, simulation.fidelity,
            JSON.stringify(simulation.assumptions), JSON.stringify(simulation.limitations), simulation.attesterId,
            simulation.attestationSignature, simulation.passed, actor.id, acceptedAt]
        );
        return { aggregateType: "package_simulation_receipt", aggregateId: simulationReceiptId,
          transitionType: "kernel.package_candidate.simulated", transitionPayload: { candidate_digest: candidateDigest, mode },
          result: { simulation_receipt: { simulation_receipt_id: simulationReceiptId,
            validation_receipt_id: validationReceipt.validation_receipt_id, candidate_digest: candidateDigest,
            mode, context_receipt_id: contextReceiptId, input_digest: simulation.inputDigest,
            result_digest: simulation.resultDigest, fidelity: simulation.fidelity, assumptions: simulation.assumptions,
            limitations: simulation.limitations, attester_id: simulation.attesterId,
            attestation_signature: simulation.attestationSignature, passed: simulation.passed,
            authority_granted: false, simulated_at: acceptedAt } } };
      }
    });
  }

  async function getSimulationReceipt(id, client = pool) {
    uuid(id, "simulation_receipt_id");
    const result = await client.query(
      `SELECT * FROM kernel_package_simulation_receipts WHERE installation_id=$1 AND environment_id=$2 AND simulation_receipt_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "SIMULATION_RECEIPT_NOT_FOUND", "Simulation Receipt does not exist.");
    return result.rows[0];
  }

  async function publish(envelope, authenticatedPassport) {
    const actor = { type: "agent", id: authenticatedPassport.agent_principal_id };
    const command = { ...envelope, actor };
    const { buildSessionId, session, passport } = await boundBuild(envelope.input, authenticatedPassport);
    const candidate = object(envelope.input.candidate);
    if (!candidate || exceedsDepth(candidate)) throw new KernelError(400, "INVALID_PACKAGE_CANDIDATE", "Publication candidate is invalid or excessively nested.");
    const artifactDigest = sha256Digest(candidate);
    const validationReceipt = await getValidationReceipt(envelope.input.validation_receipt_id);
    if (!validationReceipt.valid || validationReceipt.candidate_digest !== artifactDigest || validationReceipt.build_session_id !== buildSessionId) {
      throw new KernelError(409, "PUBLICATION_VALIDATION_MISMATCH", "Publication requires a passing receipt for exact candidate and Build Session.");
    }
    const revalidation = validateCandidateShape(candidate, passport, session);
    await validateContextProvenance(candidate, session, revalidation);
    await validateArtifactAttestations(candidate, passport, revalidation);
    if (revalidation.issues.length) throw new KernelError(409, "CANDIDATE_REVALIDATION_FAILED", "Candidate no longer satisfies publication contract.", { issues: revalidation.issues });
    const simulationIds = envelope.input.simulation_receipt_ids;
    if (!Array.isArray(simulationIds) || simulationIds.length < 2) throw new KernelError(400, "SIMULATION_RECEIPTS_REQUIRED", "Publication requires fixture and observational Simulation Receipts.");
    const simulations = [];
    for (const id of simulationIds) simulations.push(await getSimulationReceipt(id));
    if (simulations.some((receipt) => !receipt.passed || receipt.candidate_digest !== artifactDigest
      || receipt.validation_receipt_id !== validationReceipt.validation_receipt_id)
      || !new Set(simulations.map((receipt) => receipt.mode)).has("deterministic_fixture")
      || !new Set(simulations.map((receipt) => receipt.mode)).has("observational_read_only")) {
      throw new KernelError(409, "SIMULATION_COVERAGE_INCOMPLETE", "Exact passing fixture and observational simulations are required.");
    }
    const packageId = candidate.identity.package_id;
    const semanticVersion = candidate.identity.version;
    const normalizedExports = candidate.exports.map((entry) => ({ kind: entry.kind, export_id: entry.export_id,
      contract_version: entry.contract_version, export_digest: sha256Digest(entry.content) }));
    const manifestDigest = sha256Digest({ schema_version: candidate.schema_version, identity: candidate.identity,
      compatibility: candidate.compatibility, dependencies: candidate.dependencies ?? [], exports: normalizedExports });
    const dependencyDigest = sha256Digest(candidate.dependencies ?? []);
    const packageVersionId = randomUUID();
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    return executeCommand({ installationId, environmentId, command, requestDigest,
      apply: async (client, { acceptedAt }) => {
        const validity = await client.query(
          `SELECT b.expires_at AS session_expires_at,p.valid_from AS passport_valid_from,p.expires_at AS passport_expires_at
           FROM kernel_build_sessions b JOIN kernel_agent_passports p
            ON p.installation_id=b.installation_id AND p.environment_id=b.environment_id AND p.passport_id=b.passport_id
           WHERE b.installation_id=$1 AND b.environment_id=$2 AND b.build_session_id=$3`,
          [installationId, environmentId, buildSessionId]
        );
        const acceptedTime = Date.parse(acceptedAt);
        const validityRow = validity.rows[0];
        if (!validityRow || acceptedTime >= Date.parse(validityRow.session_expires_at)
          || acceptedTime < Date.parse(validityRow.passport_valid_from) || acceptedTime >= Date.parse(validityRow.passport_expires_at)) {
          throw new KernelError(409, "PUBLICATION_AUTHORITY_EXPIRED", "Passport or Build Session expired before publication commit.");
        }
        const existing = await client.query(
          `SELECT artifact_digest FROM kernel_package_versions
           WHERE installation_id=$1 AND environment_id=$2 AND package_id=$3 AND semantic_version=$4`,
          [installationId, environmentId, packageId, semanticVersion]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].artifact_digest !== artifactDigest) {
            throw new KernelError(409, "PACKAGE_VERSION_BYTES_CONFLICT", "Package identity and semantic version already bind different bytes.");
          }
          throw new KernelError(409, "PACKAGE_VERSION_EXISTS", "Exact Package Version is already published.");
        }
        const publication = { installation_id: installationId, environment_id: environmentId,
          package_version_id: packageVersionId, package_id: packageId, semantic_version: semanticVersion,
          artifact_digest: artifactDigest, manifest_digest: manifestDigest, dependency_digest: dependencyDigest,
          canonicalization_version: "canonical-json.v0.1", normalized_exports: normalizedExports,
          build_session_id: buildSessionId, validation_receipt_id: validationReceipt.validation_receipt_id,
          simulation_receipt_ids: simulationIds, toolkit_digest: validationReceipt.toolkit_digest,
          publisher_principal_id: actor.id, validator_version: VALIDATOR_VERSION,
          publication_key_id: signingKeyId, published_at: acceptedAt };
        const publicationSignature = `hmac-sha256:${createHmac("sha256", signingSecret).update(canonicalize(publication)).digest("hex")}`;
        await client.query(
          `INSERT INTO kernel_package_versions
           (package_version_id,installation_id,environment_id,package_id,semantic_version,artifact_digest,manifest_digest,
            dependency_digest,canonicalization_version,candidate,normalized_exports,build_session_id,validation_receipt_id,
            simulation_receipt_ids,toolkit_digest,publisher_principal_id,validator_version,publication_key_id,
            publication_signature,published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [packageVersionId, installationId, environmentId, packageId, semanticVersion, artifactDigest, manifestDigest,
            dependencyDigest, "canonical-json.v0.1", JSON.stringify(candidate), JSON.stringify(normalizedExports), buildSessionId,
            validationReceipt.validation_receipt_id, JSON.stringify(simulationIds), validationReceipt.toolkit_digest,
            actor.id, VALIDATOR_VERSION, signingKeyId, publicationSignature, acceptedAt]
        );
        return { aggregateType: "package_version", aggregateId: packageVersionId,
          transitionType: "kernel.package_version.published", transitionPayload: { package_id: packageId,
            semantic_version: semanticVersion, artifact_digest: artifactDigest },
          result: { package_version: { ...publication, publication_signature: publicationSignature,
            signature_verified: true, authority_granted: false, immutable: true } } };
      }
    });
  }

  async function getPackageVersion(id) {
    uuid(id, "package_version_id");
    const result = await pool.query(
      `SELECT * FROM kernel_package_versions WHERE installation_id=$1 AND environment_id=$2 AND package_version_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "PACKAGE_VERSION_NOT_FOUND", "Package Version does not exist.");
    const row = result.rows[0];
    const recomputedExports = row.candidate.exports.map((entry) => ({ kind: entry.kind, export_id: entry.export_id,
      contract_version: entry.contract_version, export_digest: sha256Digest(entry.content) }));
    const recomputedArtifactDigest = sha256Digest(row.candidate);
    const recomputedManifestDigest = sha256Digest({ schema_version: row.candidate.schema_version,
      identity: row.candidate.identity, compatibility: row.candidate.compatibility,
      dependencies: row.candidate.dependencies ?? [], exports: recomputedExports });
    const recomputedDependencyDigest = sha256Digest(row.candidate.dependencies ?? []);
    if (recomputedArtifactDigest !== row.artifact_digest || recomputedManifestDigest !== row.manifest_digest
      || recomputedDependencyDigest !== row.dependency_digest || canonicalize(recomputedExports) !== canonicalize(row.normalized_exports)) {
      throw new KernelError(500, "PACKAGE_CONTENT_INTEGRITY_VIOLATION", "Stored Package Version bytes do not match signed digests.");
    }
    const publication = { installation_id: row.installation_id, environment_id: row.environment_id,
      package_version_id: row.package_version_id, package_id: row.package_id, semantic_version: row.semantic_version,
      artifact_digest: row.artifact_digest, manifest_digest: row.manifest_digest, dependency_digest: row.dependency_digest,
      canonicalization_version: row.canonicalization_version, normalized_exports: row.normalized_exports,
      build_session_id: row.build_session_id, validation_receipt_id: row.validation_receipt_id,
      simulation_receipt_ids: row.simulation_receipt_ids, toolkit_digest: row.toolkit_digest,
      publisher_principal_id: row.publisher_principal_id, validator_version: row.validator_version,
      publication_key_id: row.publication_key_id, published_at: new Date(row.published_at).toISOString() };
    const verificationSecret = row.publication_key_id === signingKeyId ? signingSecret : verificationKeys[row.publication_key_id];
    if (!verificationSecret) throw new KernelError(500, "PACKAGE_SIGNING_KEY_UNAVAILABLE", "Package signing key is unavailable for verification.");
    const expected = `hmac-sha256:${createHmac("sha256", verificationSecret).update(canonicalize(publication)).digest("hex")}`;
    if (row.publication_signature !== expected) {
      throw new KernelError(500, "PACKAGE_SIGNATURE_INTEGRITY_VIOLATION", "Package publication signature does not verify.");
    }
    return { ...row, signature_verified: true };
  }

  async function packageVersionsForWorkIntent(workIntentId) {
    const result = await pool.query(
      `SELECT p.package_version_id
       FROM kernel_package_versions p
       JOIN kernel_build_sessions b ON b.installation_id=p.installation_id AND b.environment_id=p.environment_id
        AND b.build_session_id=p.build_session_id
       WHERE p.installation_id=$1 AND p.environment_id=$2 AND b.work_intent_id=$3
       ORDER BY p.published_at DESC`,
      [installationId, environmentId, workIntentId]
    );
    const verified = [];
    for (const row of result.rows) {
      const packageVersion = await getPackageVersion(row.package_version_id);
      verified.push({ package_version_id: packageVersion.package_version_id, package_id: packageVersion.package_id,
        semantic_version: packageVersion.semantic_version, artifact_digest: packageVersion.artifact_digest,
        manifest_digest: packageVersion.manifest_digest, dependency_digest: packageVersion.dependency_digest,
        toolkit_digest: packageVersion.toolkit_digest, publisher_principal_id: packageVersion.publisher_principal_id,
        published_at: packageVersion.published_at, signature_verified: true, immutable: true, authority_granted: false });
    }
    return verified;
  }

  return { attestArtifact, getArtifactAttestation, validateCandidate, getValidationReceipt, simulate,
    getSimulationReceipt, publish, getPackageVersion,
    packageVersionsForWorkIntent };
}
