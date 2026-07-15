import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const VALIDATOR_VERSION = "alphonse.deployment-plan-validator.v0.1";
const PLAN_SCHEMA = "alphonse.deployment_plan.v0.1";

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

function integer(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new KernelError(400, "INVALID_REVISION", `${path} must be a non-negative safe integer.`);
  }
  return value;
}

function issue(code, path, message) {
  return { code, path, message };
}

function exactKeys(value, allowed, path, issues) {
  if (!object(value)) {
    issues.push(issue("INVALID_PLAN_SHAPE", path, "Value must be an object."));
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(issue("UNDECLARED_PLAN_FIELD", `${path}.${key}`, "Field is not declared by this plan contract."));
  }
  for (const key of allowed) {
    if (!(key in value)) issues.push(issue("INVALID_PLAN_SHAPE", `${path}.${key}`, "Required field is missing."));
  }
  return true;
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => Boolean(string(item)));
}

function sameStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && canonicalize([...left].sort()) === canonicalize([...right].sort());
}

function sensitivePath(value, path = "plan") {
  if (typeof value === "string" && (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    || /\bAKIA[0-9A-Z]{16}\b/.test(value) || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)
    || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value)
    || /^Bearer\s+\S+$/i.test(value) || /\b(?:password|passwd|token|api[_-]?key|secret)\s*[=:]\s*\S+/i.test(value)
    || /^[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/i.test(value)
    || (!value.includes(" ") && value.length >= 40 && !/^(?:sha256:|oci:\/\/|credential:\/\/)/.test(value)
      && new Set(value).size / value.length > 0.55))) return path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = sensitivePath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!object(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (/(^|_)(secret|password|private_key|token|api_key|credential|auth|authorization|cookie|dsn|connection_string)($|_)/i.test(key)
      && !/(credential_binding_refs|credential_bindings|credential_binding_ref|binding_ref)$/i.test(key)) return `${path}.${key}`;
    const found = sensitivePath(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function exceedsDepth(value, maximum = 32) {
  const pending = [{ value, depth: 0 }];
  while (pending.length > 0) {
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

function valueMatchesType(value, type) {
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return Boolean(object(value));
  if (type === "array") return Array.isArray(value);
  return false;
}

function validateConfiguration(schema, values, issues) {
  if (!object(schema) || schema.type !== "object" || !object(schema.properties) || !Array.isArray(schema.required)) {
    issues.push(issue("CONFIGURATION_SCHEMA_INVALID", "plan.configuration_binding.schema_export_id",
      "Configuration binding must reference a supported object Schema export."));
    return;
  }
  if (!object(values)) {
    issues.push(issue("CONFIGURATION_INVALID", "plan.configuration_binding.redacted_values", "Redacted configuration values must be an object."));
    return;
  }
  for (const required of schema.required) {
    if (!(required in values)) issues.push(issue("CONFIGURATION_REQUIRED_VALUE_MISSING",
      `plan.configuration_binding.redacted_values.${required}`, "Required configuration value is missing."));
  }
  for (const [key, value] of Object.entries(values)) {
    const property = schema.properties[key];
    if (!property) {
      issues.push(issue("UNDECLARED_CONFIGURATION_VALUE", `plan.configuration_binding.redacted_values.${key}`,
        "Configuration value is not declared by the bound schema."));
    } else if (!valueMatchesType(value, property.type)) {
      issues.push(issue("CONFIGURATION_TYPE_MISMATCH", `plan.configuration_binding.redacted_values.${key}`,
        `Configuration value must have type ${property.type}.`));
    }
  }
}

function exportById(packageVersion, exportId) {
  const entry = packageVersion.candidate.exports.find((candidate) => candidate.export_id === exportId);
  if (!entry) return null;
  return { ...entry, export_digest: sha256Digest(entry.content) };
}

function compositionOf(plan) {
  return {
    package: plan.package,
    dependency_lock: plan.dependency_lock,
    extension_bindings: plan.extension_bindings,
    configuration_binding: plan.configuration_binding,
    adapter_bindings: plan.adapter_bindings,
    capability_candidates: plan.capability_candidates
  };
}

export function validateDeploymentPlanShape(plan, packageVersion) {
  const issues = [];
  const checks = [];
  if (exceedsDepth(plan)) {
    return { valid: false, checks, issues: [issue("PLAN_DEPTH_EXCEEDED", "plan", "Deployment Plan exceeds maximum nesting depth.")] };
  }
  if (!exactKeys(plan, ["schema_version", "work_intent_id", "package", "dependency_lock", "extension_bindings",
    "configuration_binding", "adapter_bindings", "capability_candidates"], "plan", issues)) {
    return { valid: false, checks, issues };
  }
  if (plan.schema_version !== PLAN_SCHEMA) issues.push(issue("PLAN_SCHEMA_UNSUPPORTED", "plan.schema_version", "Deployment Plan schema is unsupported."));
  const secret = sensitivePath(plan);
  if (secret) issues.push(issue("SECRET_MATERIAL_PROHIBITED", secret, "Deployment Plans store references and redacted values, never credentials."));

  const packageRef = plan.package;
  exactKeys(packageRef, ["package_version_id", "package_id", "semantic_version", "artifact_digest", "manifest_digest",
    "dependency_digest"], "plan.package", issues);
  if (!packageVersion || packageRef?.package_version_id !== packageVersion?.package_version_id
    || packageRef?.package_id !== packageVersion?.package_id || packageRef?.semantic_version !== packageVersion?.semantic_version
    || packageRef?.artifact_digest !== packageVersion?.artifact_digest || packageRef?.manifest_digest !== packageVersion?.manifest_digest
    || packageRef?.dependency_digest !== packageVersion?.dependency_digest) {
    issues.push(issue("PACKAGE_REFERENCE_MISMATCH", "plan.package", "Plan must bind the exact verified Package Version and digests."));
  }

  if (!Array.isArray(plan.dependency_lock)
    || canonicalize(plan.dependency_lock) !== canonicalize(packageVersion?.candidate?.dependencies ?? [])) {
    issues.push(issue("DEPENDENCY_LOCK_CONFLICT", "plan.dependency_lock", "Dependency lock must exactly resolve the Package dependency set."));
  }
  if (!Array.isArray(plan.extension_bindings)) {
    issues.push(issue("INVALID_PLAN_SHAPE", "plan.extension_bindings", "Extension bindings must be an array."));
  } else if (plan.extension_bindings.length > 0) {
    issues.push(issue("UNDECLARED_EXTENSION_BEHAVIOR", "plan.extension_bindings", "Package declares no V0 extension points; ambient behavior is forbidden."));
  }

  const configuration = plan.configuration_binding;
  if (exactKeys(configuration, ["schema_export_id", "schema_export_digest", "redacted_values", "credential_bindings"],
    "plan.configuration_binding", issues)) {
    const schemaExport = exportById(packageVersion, configuration.schema_export_id);
    if (!schemaExport || schemaExport.kind !== "schema" || configuration.schema_export_digest !== schemaExport.export_digest) {
      issues.push(issue("CONFIGURATION_SCHEMA_MISMATCH", "plan.configuration_binding.schema_export_id",
        "Configuration must bind one exact Schema export from the Package Version."));
    } else {
      validateConfiguration(schemaExport.content, configuration.redacted_values, issues);
    }
    if (!Array.isArray(configuration.credential_bindings)) {
      issues.push(issue("CREDENTIAL_BINDINGS_INVALID", "plan.configuration_binding.credential_bindings", "Credential bindings must be an array."));
    } else {
      const references = new Set();
      configuration.credential_bindings.forEach((binding, index) => {
        const path = `plan.configuration_binding.credential_bindings[${index}]`;
        exactKeys(binding, ["binding_ref", "revision", "scopes"], path, issues);
        if (!string(binding?.binding_ref) || !string(binding?.revision) || !nonEmptyStrings(binding?.scopes)) {
          issues.push(issue("CREDENTIAL_BINDING_INVALID", path, "Credential binding requires reference, revision, and non-empty scopes."));
        }
        if (references.has(binding?.binding_ref)) issues.push(issue("CREDENTIAL_BINDING_CONFLICT", `${path}.binding_ref`, "Credential binding reference is duplicated."));
        references.add(binding?.binding_ref);
      });
    }
  }

  const adapterMap = new Map();
  if (!Array.isArray(plan.adapter_bindings)) {
    issues.push(issue("ADAPTER_BINDINGS_INVALID", "plan.adapter_bindings", "Adapter bindings must be an array."));
  } else {
    plan.adapter_bindings.forEach((binding, index) => {
      const path = `plan.adapter_bindings[${index}]`;
      exactKeys(binding, ["adapter_export_id", "adapter_export_digest", "target_system"], path, issues);
      const adapter = exportById(packageVersion, binding?.adapter_export_id);
      if (!adapter || adapter.kind !== "adapter" || adapter.export_digest !== binding?.adapter_export_digest) {
        issues.push(issue("ADAPTER_BINDING_MISMATCH", path, "Adapter binding must reference one exact Package Adapter export."));
      }
      if (!string(binding?.target_system)) {
        issues.push(issue("ADAPTER_TARGET_SYSTEM_REQUIRED", `${path}.target_system`,
          "Adapter binding must identify one exact target system."));
      }
      if (adapterMap.has(binding?.adapter_export_id)) issues.push(issue("ADAPTER_BINDING_CONFLICT", path, "Adapter binding is duplicated."));
      adapterMap.set(binding?.adapter_export_id, binding);
    });
  }

  const capabilityIds = new Set();
  if (!Array.isArray(plan.capability_candidates) || plan.capability_candidates.length === 0) {
    issues.push(issue("CAPABILITY_CANDIDATES_REQUIRED", "plan.capability_candidates", "At least one exact Capability candidate is required."));
  } else {
    plan.capability_candidates.forEach((candidate, index) => {
      const path = `plan.capability_candidates[${index}]`;
      exactKeys(candidate, ["capability_export_id", "capability_export_digest", "context_binding",
        "credential_binding_ref", "effect_limits"], path, issues);
      const capability = exportById(packageVersion, candidate?.capability_export_id);
      if (!capability || capability.kind !== "capability" || capability.export_digest !== candidate?.capability_export_digest) {
        issues.push(issue("CAPABILITY_REFERENCE_MISMATCH", `${path}.capability_export_id`, "Candidate must bind one exact Capability export."));
        return;
      }
      if (capabilityIds.has(candidate.capability_export_id)) issues.push(issue("CAPABILITY_CANDIDATE_CONFLICT", path, "Capability candidate is duplicated."));
      capabilityIds.add(candidate.capability_export_id);

      const context = candidate.context_binding;
      exactKeys(context, ["sources", "authority", "max_age_seconds"], `${path}.context_binding`, issues);
      const requiredContext = capability.content.context_requirements;
      if (!nonEmptyStrings(context?.sources) || !sameStrings(context?.authority, requiredContext?.authority)
        || !Number.isInteger(context?.max_age_seconds) || context.max_age_seconds < 1
        || context.max_age_seconds > requiredContext?.max_age_seconds) {
        issues.push(issue("CONTEXT_BINDING_EXCEEDS_CONTRACT", `${path}.context_binding`,
          "Context binding requires explicit sources, exact authority classes, and no weaker freshness bound."));
      }

      if (capability.content.effect_class === "read_only") {
        if (candidate.credential_binding_ref !== null) issues.push(issue("READ_CAPABILITY_CREDENTIAL_PROHIBITED",
          `${path}.credential_binding_ref`, "Read Capability must not bind write credentials."));
        if (!Array.isArray(candidate.effect_limits) || candidate.effect_limits.length !== 0) {
          issues.push(issue("READ_CAPABILITY_EFFECT_PROHIBITED", `${path}.effect_limits`, "Read Capability cannot declare effect limits."));
        }
        const skill = exportById(packageVersion, capability.content.skill_ref);
        if (!skill || skill.kind !== "skill") issues.push(issue("READ_SKILL_UNRESOLVED", `${path}.capability_export_id`,
          "Read Capability must bind one exact Package Skill."));
        const accountability = exportById(packageVersion, capability.content.accountability_contract_ref);
        if (!accountability || accountability.kind !== "accountability_contract") {
          issues.push(issue("ACCOUNTABILITY_CONTRACT_UNRESOLVED", `${path}.capability_export_id`,
            "Read Capability requires one exact Accountability Contract."));
        }
        return;
      }
      const credentials = configuration?.credential_bindings;
      const credential = Array.isArray(credentials)
        ? credentials.find((binding) => binding.binding_ref === candidate.credential_binding_ref) : null;
      if (!credential) issues.push(issue("CREDENTIAL_BINDING_UNRESOLVED", `${path}.credential_binding_ref`,
        "Effectful Capability candidate must reference one exact local credential binding."));
      if (capability.content.effect_class !== "external_write") {
        issues.push(issue("CAPABILITY_EFFECT_CLASS_UNSUPPORTED", `${path}.capability_export_id`,
          "Capability effect class is unsupported."));
        return;
      }
      const adapter = exportById(packageVersion, capability.content.adapter_ref);
      if (!adapter || !adapterMap.has(adapter.export_id)) issues.push(issue("ADAPTER_BINDING_UNRESOLVED", `${path}.capability_export_id`,
        "Capability adapter must have one exact Deployment Plan binding."));
      const adapterBinding = adapter ? adapterMap.get(adapter.export_id) : null;
      const declaredEffects = capability.content.declared_effects;
      if (!Array.isArray(candidate.effect_limits) || candidate.effect_limits.length !== declaredEffects?.length) {
        issues.push(issue("EFFECT_LIMITS_INCOMPLETE", `${path}.effect_limits`, "Every declared effect requires one bounded limit."));
      } else {
        candidate.effect_limits.forEach((limit, effectIndex) => {
          const limitPath = `${path}.effect_limits[${effectIndex}]`;
          exactKeys(limit, ["system", "target", "action", "maximum_items"], limitPath, issues);
          const declared = declaredEffects[effectIndex];
          if (!string(limit?.system)) {
            issues.push(issue("EFFECT_SYSTEM_REQUIRED", `${limitPath}.system`,
              "Deployment must bind each effect to one exact target system."));
          }
          if (!declared || limit?.target !== declared.target || limit?.action !== declared.action
            || !Number.isInteger(limit?.maximum_items) || limit.maximum_items < 1 || limit.maximum_items > declared.maximum_items) {
            issues.push(issue("EFFECT_LIMIT_EXCEEDS_CONTRACT", limitPath, "Effect target/action must match and limit cannot exceed the Package contract."));
          }
          if (adapterBinding && limit?.system !== adapterBinding.target_system) {
            issues.push(issue("ADAPTER_TARGET_SYSTEM_MISMATCH", `${limitPath}.system`,
              "Effect target system must match the exact trusted adapter binding."));
          }
        });
      }
      if (!exportById(packageVersion, capability.content.accountability_contract_ref)) {
        issues.push(issue("ACCOUNTABILITY_CONTRACT_UNRESOLVED", `${path}.capability_export_id`, "Effectful Capability requires its exact Accountability Contract."));
      }
    });
  }

  checks.push("exact_package", "dependency_lock", "extension_bindings", "configuration_schema", "credential_references",
    "adapter_bindings", "capability_contracts", "effect_limits", "secret_scan");
  issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  return { valid: issues.length === 0, checks, issues };
}

export function createDeploymentService(database, identityIntent, packageService, installationId, environmentId) {
  const { pool, executeCommand } = database;

  function commandDigest(command) {
    return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
  }

  async function validatePlan(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    const plan = object(envelope.input.plan);
    if (!plan) throw new KernelError(400, "INVALID_DEPLOYMENT_PLAN", "input.plan must be an object.");
    const packageVersionId = uuid(plan.package?.package_version_id, "input.plan.package.package_version_id");
    const packageVersion = await packageService.getPackageVersion(packageVersionId);
    const workIntent = await identityIntent.getWorkIntent(uuid(plan.work_intent_id, "input.plan.work_intent_id"));
    if (workIntent.confirmed_by_principal_id !== actor.id) throw new KernelError(403, "WORK_INTENT_SPONSOR_MISMATCH", "Deployment Work Intent must be confirmed by the authenticated human.");
    const validation = validateDeploymentPlanShape(plan, packageVersion);
    if (workIntent.constraints?.no_activation === true || workIntent.constraints?.no_external_effects === true) {
      validation.issues.push(issue("WORK_INTENT_PROHIBITS_ACTIVATION", "plan.work_intent_id", "Work Intent constraints prohibit capability activation."));
      validation.valid = false;
    }
    const validationReceiptId = randomUUID();
    const deploymentPlanId = validation.valid ? randomUUID() : null;
    const planDigest = sha256Digest(plan);
    const compositionDigest = sha256Digest(compositionOf(plan));
    return executeCommand({ installationId, environmentId, command, requestDigest: commandDigest(command),
      apply: async (client, { acceptedAt }) => {
        await client.query(
          `INSERT INTO kernel_deployment_plan_validation_receipts
           (validation_receipt_id,installation_id,environment_id,package_version_id,plan_digest,composition_digest,
            validator_version,valid,checks,issues,validated_by_principal_id,validated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [validationReceiptId, installationId, environmentId, packageVersionId, planDigest, compositionDigest,
            VALIDATOR_VERSION, validation.valid, JSON.stringify(validation.checks), JSON.stringify(validation.issues), actor.id, acceptedAt]
        );
        if (validation.valid) {
          await client.query(
            `INSERT INTO kernel_deployment_plans
             (deployment_plan_id,installation_id,environment_id,package_version_id,work_intent_id,validation_receipt_id,
              plan_digest,composition_digest,plan,created_by_principal_id,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [deploymentPlanId, installationId, environmentId, packageVersionId, plan.work_intent_id, validationReceiptId,
              planDigest, compositionDigest, JSON.stringify(plan), actor.id, acceptedAt]
          );
        }
        return { aggregateType: "deployment_plan_validation_receipt", aggregateId: validationReceiptId,
          transitionType: "kernel.deployment_plan.validated", transitionPayload: { plan_digest: planDigest, valid: validation.valid },
          result: { validation_receipt: { validation_receipt_id: validationReceiptId, package_version_id: packageVersionId,
            plan_digest: planDigest, composition_digest: compositionDigest, validator_version: VALIDATOR_VERSION,
            valid: validation.valid, checks: validation.checks, issues: validation.issues, validated_at: acceptedAt,
            authority_granted: false }, ...(deploymentPlanId ? { deployment_plan: { deployment_plan_id: deploymentPlanId,
              package_version_id: packageVersionId, work_intent_id: plan.work_intent_id, validation_receipt_id: validationReceiptId,
              plan_digest: planDigest, composition_digest: compositionDigest, created_at: acceptedAt,
              state: "validated", authority_granted: false, immutable: true } } : {}) } };
      }
    });
  }

  async function getValidationReceipt(id, client = pool) {
    uuid(id, "validation_receipt_id");
    const result = await client.query(
      `SELECT * FROM kernel_deployment_plan_validation_receipts
       WHERE installation_id=$1 AND environment_id=$2 AND validation_receipt_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "DEPLOYMENT_VALIDATION_NOT_FOUND", "Deployment Plan validation receipt does not exist.");
    return result.rows[0];
  }

  async function getDeploymentPlan(id, client = pool) {
    uuid(id, "deployment_plan_id");
    const result = await client.query(
      `SELECT * FROM kernel_deployment_plans WHERE installation_id=$1 AND environment_id=$2 AND deployment_plan_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "DEPLOYMENT_PLAN_NOT_FOUND", "Deployment Plan does not exist.");
    const row = result.rows[0];
    if (sha256Digest(row.plan) !== row.plan_digest || sha256Digest(compositionOf(row.plan)) !== row.composition_digest) {
      throw new KernelError(500, "DEPLOYMENT_PLAN_INTEGRITY_VIOLATION", "Stored Deployment Plan does not match its exact digests.");
    }
    return { ...row, state: "validated", authority_granted: false, immutable: true };
  }

  async function reviewPlan(envelope, deploymentPlanId) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    uuid(deploymentPlanId, "deployment_plan_id");
    const planDigest = digest(envelope.input.plan_digest, "input.plan_digest");
    const decision = string(envelope.input.decision);
    if (!new Set(["pass", "request_changes", "reject"]).has(decision)) throw new KernelError(400, "TECHNICAL_REVIEW_DECISION_INVALID", "decision must be pass, request_changes, or reject.");
    const rationale = string(envelope.input.rationale);
    if (!rationale || rationale.length > 2000) throw new KernelError(400, "TECHNICAL_REVIEW_RATIONALE_INVALID", "rationale must contain 1 to 2000 characters.");
    const technicalReviewId = randomUUID();
    return executeCommand({ installationId, environmentId, command, requestDigest: commandDigest(command),
      apply: async (client, { acceptedAt }) => {
        const plan = await getDeploymentPlan(deploymentPlanId, client);
        if (plan.plan_digest !== planDigest) throw new KernelError(409, "DEPLOYMENT_PLAN_VERSION_MISMATCH", "Technical review must bind the exact Deployment Plan digest.");
        const existing = await client.query(
          `SELECT technical_review_id FROM kernel_deployment_technical_reviews
           WHERE installation_id=$1 AND environment_id=$2 AND deployment_plan_id=$3`,
          [installationId, environmentId, deploymentPlanId]
        );
        if (existing.rows[0]) throw new KernelError(409, "TECHNICAL_REVIEW_EXISTS", "Exact Deployment Plan already has a technical review decision.");
        await client.query(
          `INSERT INTO kernel_deployment_technical_reviews
           (technical_review_id,installation_id,environment_id,deployment_plan_id,plan_digest,decision,rationale,
            reviewed_by_principal_id,reviewed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [technicalReviewId, installationId, environmentId, deploymentPlanId, planDigest, decision, rationale, actor.id, acceptedAt]
        );
        return { aggregateType: "deployment_technical_review", aggregateId: technicalReviewId,
          transitionType: "kernel.deployment_plan.technical_reviewed", transitionPayload: { deployment_plan_id: deploymentPlanId, plan_digest: planDigest, decision },
          result: { technical_review: { technical_review_id: technicalReviewId, deployment_plan_id: deploymentPlanId,
            plan_digest: planDigest, decision, rationale, reviewed_by_principal_id: actor.id, reviewed_at: acceptedAt,
            authority_granted: false, immutable: true } } };
      }
    });
  }

  async function getTechnicalReview(id, client = pool) {
    uuid(id, "technical_review_id");
    const result = await client.query(
      `SELECT * FROM kernel_deployment_technical_reviews
       WHERE installation_id=$1 AND environment_id=$2 AND technical_review_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "TECHNICAL_REVIEW_NOT_FOUND", "Technical review does not exist.");
    return { ...result.rows[0], authority_granted: false, immutable: true };
  }

  async function stageDeployment(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    const deploymentPlanId = uuid(envelope.input.deployment_plan_id, "input.deployment_plan_id");
    const technicalReviewId = uuid(envelope.input.technical_review_id, "input.technical_review_id");
    const planDigest = digest(envelope.input.plan_digest, "input.plan_digest");
    const deploymentId = randomUUID();
    return executeCommand({ installationId, environmentId, command, requestDigest: commandDigest(command),
      apply: async (client, { acceptedAt }) => {
        const plan = await getDeploymentPlan(deploymentPlanId, client);
        const review = await getTechnicalReview(technicalReviewId, client);
        if (plan.plan_digest !== planDigest || review.deployment_plan_id !== deploymentPlanId || review.plan_digest !== planDigest) {
          throw new KernelError(409, "STAGING_VERSION_MISMATCH", "Staging must bind one exact reviewed Deployment Plan.");
        }
        if (review.decision !== "pass") throw new KernelError(409, "TECHNICAL_REVIEW_NOT_PASSED", "Only a passed exact technical review permits staging.");
        const existing = await client.query(
          `SELECT deployment_id FROM kernel_deployments WHERE installation_id=$1 AND environment_id=$2 AND deployment_plan_id=$3`,
          [installationId, environmentId, deploymentPlanId]
        );
        if (existing.rows[0]) throw new KernelError(409, "DEPLOYMENT_ALREADY_STAGED", "Deployment Plan is already staged.");
        await client.query(
          `INSERT INTO kernel_deployments
           (deployment_id,installation_id,environment_id,deployment_plan_id,technical_review_id,package_version_id,
            work_intent_id,plan_digest,composition_digest,state,staged_by_principal_id,staged_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staged',$10,$11)`,
          [deploymentId, installationId, environmentId, deploymentPlanId, technicalReviewId, plan.package_version_id,
            plan.work_intent_id, plan.plan_digest, plan.composition_digest, actor.id, acceptedAt]
        );
        for (const candidate of plan.plan.capability_candidates) {
          const capabilityKey = `${plan.plan.package.package_id}/${candidate.capability_export_id}`;
          await client.query(
            `INSERT INTO kernel_capability_authority_states
             (installation_id,environment_id,capability_key,current_revision,active_activation_id,updated_at)
             VALUES ($1,$2,$3,0,NULL,$4) ON CONFLICT (installation_id,environment_id,capability_key) DO NOTHING`,
            [installationId, environmentId, capabilityKey, acceptedAt]
          );
        }
        return { aggregateType: "deployment", aggregateId: deploymentId,
          transitionType: "kernel.deployment.staged", transitionPayload: { deployment_plan_id: deploymentPlanId, plan_digest: planDigest },
          result: { deployment: { deployment_id: deploymentId, deployment_plan_id: deploymentPlanId,
            technical_review_id: technicalReviewId, package_version_id: plan.package_version_id, work_intent_id: plan.work_intent_id,
            plan_digest: plan.plan_digest, composition_digest: plan.composition_digest, state: "staged", staged_at: acceptedAt,
            business_approval_state: "not_approved", capability_activation_state: "inactive",
            authority_granted: false, immutable: true } } };
      }
    });
  }

  async function getDeployment(id, client = pool) {
    uuid(id, "deployment_id");
    const result = await client.query(
      `SELECT * FROM kernel_deployments WHERE installation_id=$1 AND environment_id=$2 AND deployment_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "DEPLOYMENT_NOT_FOUND", "Deployment does not exist.");
    return { ...result.rows[0], authority_granted: false, immutable: true };
  }

  async function capabilityDetails(deploymentId, exportId, client = pool) {
    const deployment = await getDeployment(deploymentId, client);
    const plan = await getDeploymentPlan(deployment.deployment_plan_id, client);
    const packageVersion = await packageService.getPackageVersion(deployment.package_version_id);
    const planCandidate = plan.plan.capability_candidates.find((candidate) => candidate.capability_export_id === exportId);
    const capability = exportById(packageVersion, exportId);
    if (!planCandidate || !capability || capability.kind !== "capability") {
      throw new KernelError(404, "DEPLOYED_CAPABILITY_NOT_FOUND", "Deployment does not contain the requested Capability candidate.");
    }
    const credential = plan.plan.configuration_binding.credential_bindings
      .find((binding) => binding.binding_ref === planCandidate.credential_binding_ref) ?? null;
    const accountability = exportById(packageVersion, capability.content.accountability_contract_ref);
    const adapter = exportById(packageVersion, capability.content.adapter_ref);
    const capabilityKey = `${packageVersion.package_id}/${exportId}`;
    const evidence = capability.content.evidence
      ?? (accountability ? { required: accountability.content.evidence_requirements } : undefined);
    const recovery = capability.content.recovery
      ?? (accountability ? { strategy: "none", uncertainty: accountability.content.recovery.on_failure } : undefined);
    const authorityContract = {
      deployment_id: deploymentId,
      deployment_plan_id: plan.deployment_plan_id,
      plan_digest: plan.plan_digest,
      package_version_id: packageVersion.package_version_id,
      package_artifact_digest: packageVersion.artifact_digest,
      capability_key: capabilityKey,
      capability_export_id: exportId,
      capability_contract_version: capability.contract_version,
      capability_export_digest: capability.export_digest,
      configuration_binding: plan.plan.configuration_binding,
      adapter_binding: plan.plan.adapter_bindings.find((binding) => binding.adapter_export_id === adapter?.export_id),
      context_binding: planCandidate.context_binding,
      credential_binding: credential,
      effect_limits: planCandidate.effect_limits,
      evidence,
      recovery,
      accountability_contract: accountability?.content
    };
    return { deployment, plan, packageVersion, planCandidate, capability, credential, accountability, adapter, evidence, recovery,
      capabilityKey, authorityContract, authorityDigest: sha256Digest(authorityContract) };
  }

  async function getActionCard(deploymentId, exportId, client = pool) {
    const details = await capabilityDetails(deploymentId, exportId, client);
    const stateResult = await client.query(
      `SELECT * FROM kernel_capability_authority_states
       WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3`,
      [installationId, environmentId, details.capabilityKey]
    );
    const state = stateResult.rows[0];
    if (!state) throw new KernelError(409, "CAPABILITY_STATE_MISSING", "Staged Capability authority state is missing.");
    const approvalResult = await client.query(
      `SELECT * FROM kernel_capability_business_approvals
       WHERE installation_id=$1 AND environment_id=$2 AND deployment_id=$3 AND capability_export_id=$4
        AND authority_digest=$5 ORDER BY approved_at DESC LIMIT 1`,
      [installationId, environmentId, deploymentId, exportId, details.authorityDigest]
    );
    const approval = approvalResult.rows[0] ?? null;
    const currentRevision = Number(state.current_revision);
    const active = state.active_activation_id ? await client.query(
      `SELECT * FROM kernel_capability_activations
       WHERE installation_id=$1 AND environment_id=$2 AND capability_activation_id=$3`,
      [installationId, environmentId, state.active_activation_id]
    ) : null;
    const activeActivation = active?.rows[0] ?? null;
    const exactActive = activeActivation?.deployment_id === deploymentId
      && activeActivation?.capability_export_digest === details.capability.export_digest
      && activeActivation?.authority_digest === details.authorityDigest;
    const approvalCurrent = approval && (exactActive || Number(approval.approved_against_revision) === currentRevision);
    const operationId = exactActive || (approval && !approvalCurrent) ? null
      : approvalCurrent ? "kernel.capability_activation.activate" : "kernel.capability.business_approve";
    const card = {
      operation_id: operationId,
      affected_objects: {
        package_version_id: details.packageVersion.package_version_id,
        package_artifact_digest: details.packageVersion.artifact_digest,
        deployment_plan_id: details.plan.deployment_plan_id,
        plan_digest: details.plan.plan_digest,
        deployment_id: deploymentId,
        capability_key: details.capabilityKey,
        capability_export_id: exportId,
        capability_export_digest: details.capability.export_digest,
        authority_digest: details.authorityDigest
      },
      source_reads: details.planCandidate.context_binding,
      write_target: details.planCandidate.effect_limits.map(({ system, target, action }) => ({ system, target, action })),
      adapter_binding: details.authorityContract.adapter_binding,
      credential_scope: details.credential,
      limits: details.planCandidate.effect_limits,
      evidence: details.evidence,
      recovery: details.recovery,
      accountability_contract: details.accountability.content,
      authority_required: "authenticated_business_operator",
      expected_consequence: operationId === "kernel.capability_activation.activate" ? "activate_exact_capability_authority"
        : operationId === "kernel.capability.business_approve" ? "approve_exact_capability_authority" : "none",
      current_revision: currentRevision,
      expected_revision: currentRevision,
      states: {
        package: "published",
        deployment: details.deployment.state,
        technical_review: "pass",
        business_approval: approvalCurrent ? "approved" : approval ? "stale" : "not_approved",
        capability_activation: exactActive ? "active" : "inactive"
      },
      business_approval_id: approval?.business_approval_id ?? null,
      capability_activation_id: exactActive ? activeActivation.capability_activation_id : null
    };
    return { ...card, action_card_digest: sha256Digest(card) };
  }

  function requireCardMatch(input, card) {
    if (input.action_card_digest !== card.action_card_digest || input.authority_digest !== card.affected_objects.authority_digest
      || input.capability_export_digest !== card.affected_objects.capability_export_digest) {
      throw new KernelError(409, "ACTION_CARD_MISMATCH", "Decision must bind the exact current Butler action card and authority contract.");
    }
    if (input.expected_revision !== card.current_revision) {
      throw new KernelError(409, "STALE_ACTION_REVISION", "Action card revision is stale.", {
        expected_revision: input.expected_revision, current_revision: card.current_revision
      });
    }
  }

  async function approveCapability(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    const deploymentId = uuid(envelope.input.deployment_id, "input.deployment_id");
    const exportId = string(envelope.input.capability_export_id);
    if (!exportId) throw new KernelError(400, "INVALID_INPUT", "input.capability_export_id is required.");
    digest(envelope.input.capability_export_digest, "input.capability_export_digest");
    digest(envelope.input.authority_digest, "input.authority_digest");
    digest(envelope.input.action_card_digest, "input.action_card_digest");
    integer(envelope.input.expected_revision, "input.expected_revision");
    const businessApprovalId = randomUUID();
    return executeCommand({ installationId, environmentId, command, requestDigest: commandDigest(command),
      apply: async (client, { acceptedAt }) => {
        const card = await getActionCard(deploymentId, exportId, client);
        requireCardMatch(envelope.input, card);
        if (card.states.business_approval === "approved") throw new KernelError(409, "CAPABILITY_ALREADY_APPROVED", "Exact Capability authority is already approved.");
        await client.query(
          `INSERT INTO kernel_capability_business_approvals
           (business_approval_id,installation_id,environment_id,deployment_id,capability_key,capability_export_id,
            capability_export_digest,authority_digest,approved_against_revision,approved_by_principal_id,approved_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [businessApprovalId, installationId, environmentId, deploymentId,
            card.affected_objects.capability_key, exportId,
            envelope.input.capability_export_digest, envelope.input.authority_digest,
            envelope.input.expected_revision, actor.id, acceptedAt]
        );
        return { aggregateType: "capability_business_approval", aggregateId: businessApprovalId,
          transitionType: "kernel.capability.business_approved", transitionPayload: { deployment_id: deploymentId,
            capability_export_id: exportId, authority_digest: envelope.input.authority_digest,
            approved_against_revision: envelope.input.expected_revision },
          result: { business_approval: { business_approval_id: businessApprovalId, deployment_id: deploymentId,
            capability_export_id: exportId, capability_export_digest: envelope.input.capability_export_digest,
            authority_digest: envelope.input.authority_digest, approved_against_revision: envelope.input.expected_revision,
            approved_by_principal_id: actor.id, approved_at: acceptedAt, capability_authority_granted: false,
            execution_authority_granted: false, immutable: true } } };
      }
    });
  }

  async function getBusinessApproval(id, client = pool) {
    uuid(id, "business_approval_id");
    const result = await client.query(
      `SELECT * FROM kernel_capability_business_approvals
       WHERE installation_id=$1 AND environment_id=$2 AND business_approval_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "BUSINESS_APPROVAL_NOT_FOUND", "Capability business approval does not exist.");
    return { ...result.rows[0], capability_authority_granted: false, execution_authority_granted: false, immutable: true };
  }

  async function activateCapability(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    const businessApprovalId = uuid(envelope.input.business_approval_id, "input.business_approval_id");
    const deploymentId = uuid(envelope.input.deployment_id, "input.deployment_id");
    const exportId = string(envelope.input.capability_export_id);
    if (!exportId) throw new KernelError(400, "INVALID_INPUT", "input.capability_export_id is required.");
    digest(envelope.input.capability_export_digest, "input.capability_export_digest");
    digest(envelope.input.authority_digest, "input.authority_digest");
    digest(envelope.input.action_card_digest, "input.action_card_digest");
    integer(envelope.input.expected_revision, "input.expected_revision");
    const capabilityActivationId = randomUUID();
    return executeCommand({ installationId, environmentId, command, requestDigest: commandDigest(command),
      apply: async (client, { acceptedAt }) => {
        const approval = await getBusinessApproval(businessApprovalId, client);
        const card = await getActionCard(deploymentId, exportId, client);
        requireCardMatch(envelope.input, card);
        if (approval.deployment_id !== deploymentId || approval.capability_export_id !== exportId
          || approval.capability_export_digest !== envelope.input.capability_export_digest
          || approval.authority_digest !== envelope.input.authority_digest) {
          throw new KernelError(409, "BUSINESS_APPROVAL_VERSION_MISMATCH", "Activation requires approval for the exact Deployment Capability authority.");
        }
        if (Number(approval.approved_against_revision) !== card.current_revision) {
          throw new KernelError(409, "STALE_BUSINESS_APPROVAL", "Capability authority changed after business approval.");
        }
        if (card.states.capability_activation === "active") throw new KernelError(409, "CAPABILITY_ALREADY_ACTIVE", "Exact Capability is already active.");
        const details = await capabilityDetails(deploymentId, exportId, client);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`package-admission:${details.packageVersion.package_version_id}`]);
        const retirement = await client.query(
          `SELECT package_retirement_id FROM kernel_package_retirements
           WHERE installation_id=$1 AND environment_id=$2 AND package_version_id=$3`,
          [installationId, environmentId, details.packageVersion.package_version_id]
        );
        if (retirement.rowCount > 0) {
          throw new KernelError(409, "PACKAGE_VERSION_RETIRED", "Retired Package Versions cannot receive new Capability activation.");
        }
        const toRevision = card.current_revision + 1;
        await client.query(
          `INSERT INTO kernel_capability_activations
           (capability_activation_id,installation_id,environment_id,business_approval_id,deployment_id,package_version_id,
            capability_key,capability_export_id,capability_contract_version,capability_export_digest,authority_digest,
            from_revision,to_revision,activated_by_principal_id,activated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [capabilityActivationId, installationId, environmentId, businessApprovalId, deploymentId,
            details.packageVersion.package_version_id, details.capabilityKey, exportId, details.capability.contract_version,
            envelope.input.capability_export_digest, envelope.input.authority_digest, card.current_revision, toRevision, actor.id, acceptedAt]
        );
        const updated = await client.query(
          `UPDATE kernel_capability_authority_states SET current_revision=$4,active_activation_id=$5,updated_at=$6
           WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3 AND current_revision=$7`,
          [installationId, environmentId, details.capabilityKey, toRevision, capabilityActivationId, acceptedAt, card.current_revision]
        );
        if (updated.rowCount !== 1) throw new KernelError(409, "STALE_ACTION_REVISION", "Capability authority revision changed before activation.");
        return { aggregateType: "capability_activation", aggregateId: capabilityActivationId,
          transitionType: "kernel.capability.activated", fromRevision: card.current_revision, toRevision,
          transitionPayload: { deployment_id: deploymentId, capability_export_id: exportId,
            capability_export_digest: envelope.input.capability_export_digest, authority_digest: envelope.input.authority_digest },
          result: { capability_activation: { capability_activation_id: capabilityActivationId,
            business_approval_id: businessApprovalId, deployment_id: deploymentId,
            package_version_id: details.packageVersion.package_version_id, capability_key: details.capabilityKey,
            capability_export_id: exportId, capability_contract_version: details.capability.contract_version,
            capability_export_digest: envelope.input.capability_export_digest,
            authority_digest: envelope.input.authority_digest, from_revision: card.current_revision,
            to_revision: toRevision, activated_by_principal_id: actor.id, activated_at: acceptedAt,
            state: "active", capability_authority_granted: true, execution_authority_granted: false,
            immutable: true } } };
      }
    });
  }

  async function getCapabilityActivation(id, client = pool) {
    uuid(id, "capability_activation_id");
    const result = await client.query(
      `SELECT * FROM kernel_capability_activations
       WHERE installation_id=$1 AND environment_id=$2 AND capability_activation_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "CAPABILITY_ACTIVATION_NOT_FOUND", "Capability Activation does not exist.");
    return { ...result.rows[0], state: "active", capability_authority_granted: true,
      execution_authority_granted: false, immutable: true };
  }

  async function checkCapabilityAdmission(input) {
    const deploymentId = uuid(input.deployment_id, "deployment_id");
    const exportId = string(input.capability_export_id);
    const approvalId = uuid(input.business_approval_id, "business_approval_id");
    const activationId = uuid(input.capability_activation_id, "capability_activation_id");
    const exportDigest = digest(input.capability_export_digest, "capability_export_digest");
    const authorityDigest = digest(input.authority_digest, "authority_digest");
    const expectedRevision = integer(input.expected_revision, "expected_revision");
    const approval = await getBusinessApproval(approvalId).catch((error) => {
      if (error.code === "BUSINESS_APPROVAL_NOT_FOUND") throw new KernelError(409, "CAPABILITY_UNAPPROVED", "Execution admission requires exact business approval.");
      throw error;
    });
    if (approval.deployment_id !== deploymentId || approval.capability_export_id !== exportId
      || approval.capability_export_digest !== exportDigest || approval.authority_digest !== authorityDigest) {
      throw new KernelError(409, "CAPABILITY_UNAPPROVED", "Business approval does not bind the requested exact Capability authority.");
    }
    const details = await capabilityDetails(deploymentId, exportId);
    const stateResult = await pool.query(
      `SELECT * FROM kernel_capability_authority_states
       WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3`,
      [installationId, environmentId, details.capabilityKey]
    );
    const state = stateResult.rows[0];
    if (Number(state?.current_revision ?? -1) !== expectedRevision) throw new KernelError(409, "STALE_ACTION_REVISION", "Capability authority revision is stale.", {
      expected_revision: expectedRevision, current_revision: Number(state?.current_revision ?? -1)
    });
    if (!state?.active_activation_id) throw new KernelError(409, "CAPABILITY_INACTIVE", "Capability has business approval but is not active.");
    if (state.active_activation_id !== activationId) throw new KernelError(409, "CAPABILITY_VERSION_MISMATCH", "Requested activation is not the current active Capability version.");
    const activation = await getCapabilityActivation(activationId);
    if (activation.deployment_id !== deploymentId || activation.business_approval_id !== approvalId
      || activation.capability_export_digest !== exportDigest || activation.authority_digest !== authorityDigest) {
      throw new KernelError(409, "CAPABILITY_VERSION_MISMATCH", "Requested Deployment, approval, and Capability version are not the exact active authority.");
    }
    return { admissible: true, basis: "exact_active_approved_capability", deployment_id: deploymentId,
      capability_activation_id: activationId, business_approval_id: approvalId, capability_export_id: exportId,
      capability_export_digest: exportDigest, authority_digest: authorityDigest, current_revision: expectedRevision,
      capability_authority_granted: true, execution_envelope_created: false };
  }

  async function getButlerProjection() {
    const deployments = await pool.query(
      `SELECT deployment_id FROM kernel_deployments WHERE installation_id=$1 AND environment_id=$2 ORDER BY staged_at DESC`,
      [installationId, environmentId]
    );
    const projected = [];
    for (const row of deployments.rows) {
      const deployment = await getDeployment(row.deployment_id);
      const plan = await getDeploymentPlan(deployment.deployment_plan_id);
      const actionCards = [];
      for (const candidate of plan.plan.capability_candidates) {
        actionCards.push(await getActionCard(deployment.deployment_id, candidate.capability_export_id));
      }
      projected.push({ deployment_id: deployment.deployment_id, deployment_plan_id: deployment.deployment_plan_id,
        package_version_id: deployment.package_version_id, work_intent_id: deployment.work_intent_id,
        plan_digest: deployment.plan_digest, composition_digest: deployment.composition_digest,
        package_state: "published", deployment_state: "staged", action_cards: actionCards });
    }
    return projected;
  }

  return { validatePlan, getValidationReceipt, getDeploymentPlan, reviewPlan, getTechnicalReview,
    stageDeployment, getDeployment, getActionCard, approveCapability, getBusinessApproval,
    activateCapability, getCapabilityActivation, checkCapabilityAdmission, getButlerProjection };
}
