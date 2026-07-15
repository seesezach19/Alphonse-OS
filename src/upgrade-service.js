import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import { analyzeUpgradeCompatibility, deterministicCanaryAssignment, retirementBlockers,
  upgradeMajorAdmissible } from "./upgrade-contracts.js";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function uuid(value, path) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new KernelError(400, "INVALID_IDENTIFIER", `${path} must be a UUID.`);
  }
  return value;
}

function string(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new KernelError(400, "INVALID_INPUT", `${path} is required.`);
  return value.trim();
}

function digest(value, path) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new KernelError(400, "INVALID_DIGEST", `${path} must be a SHA-256 digest.`);
  }
  return value;
}

function integer(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function requireArray(value, path, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be ${nonEmpty ? "a non-empty" : "an"} array.`);
  }
  return value;
}

function exactKeys(value, path, required, optional = []) {
  const candidate = object(value);
  if (!candidate) throw new KernelError(400, "INVALID_INPUT", `${path} must be an object.`);
  for (const key of required) {
    if (!Object.hasOwn(candidate, key)) throw new KernelError(400, "INVALID_INPUT", `${path}.${key} is required.`);
  }
  const allowed = new Set([...required, ...optional]);
  const extra = Object.keys(candidate).find((key) => !allowed.has(key));
  if (extra) throw new KernelError(400, "UNDECLARED_UPGRADE_FIELD", `${path}.${extra} is not declared by the upgrade contract.`);
  return candidate;
}

function prohibitPayloads(value, path = "input") {
  if (!object(value) && !Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (/(payload|record_data|business_data|secret|password|token|credential_value|external_effect)/i.test(key)) {
      throw new KernelError(400, "BUSINESS_PAYLOAD_PROHIBITED", `${childPath} is not permitted in Kernel upgrade state.`);
    }
    prohibitPayloads(child, childPath);
  }
}

function exportSnapshot(entry) {
  const snapshot = { kind: entry.kind, export_id: entry.export_id, contract_version: entry.contract_version,
    contract_digest: sha256Digest(entry.content) };
  if (entry.kind === "schema") snapshot.schema = entry.content;
  if (entry.kind === "adapter") {
    snapshot.operations = entry.content.operations ?? [];
    snapshot.operation_effects = entry.content.operation_effects ?? {};
  }
  return snapshot;
}

function packageIdentity(packageVersion) {
  return `${packageVersion.package_id}@${packageVersion.semantic_version}#${packageVersion.artifact_digest}+${packageVersion.manifest_digest}`;
}

function compatibilitySnapshot(packageVersion, actionCard, deploymentPlan) {
  return {
    package_identity: packageIdentity(packageVersion),
    protocol: packageVersion.candidate.compatibility,
    dependencies: packageVersion.candidate.dependencies ?? [],
    exports: packageVersion.candidate.exports.map(exportSnapshot),
    context_semantics: actionCard.source_reads,
    binding_semantics: {
      configuration: { schema_export_id: deploymentPlan.plan.configuration_binding.schema_export_id,
        redacted_values: deploymentPlan.plan.configuration_binding.redacted_values },
      adapter: actionCard.adapter_binding,
      extensions: deploymentPlan.plan.extension_bindings
    },
    authority_semantics: {
      credential_scope: actionCard.credential_scope,
      limits: actionCard.limits,
      actor: actionCard.authority_required
    },
    evidence_semantics: { evidence: actionCard.evidence, accountability_contract: actionCard.accountability_contract },
    recovery_semantics: actionCard.recovery
  };
}

function commandDigest(installationId, environmentId, command) {
  return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
}

function rowDate(row, key) {
  return row[key] instanceof Date ? row[key].toISOString() : row[key];
}

function authorityEquivalenceDigest(report) {
  return sha256Digest({ current: report.current_authority_digest,
    target: report.target_authority_digest, equivalent: report.authority_equivalent });
}

function verifyAttestation(document, signature, secret) {
  const expected = `hmac-sha256:${createHmac("sha256", secret).update(canonicalize(document)).digest("hex")}`;
  const suppliedBytes = Buffer.from(signature ?? "", "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    throw new KernelError(403, "INVALID_CONTROL_PLANE_ATTESTATION", "Control-plane receipt signature does not verify.");
  }
  return signature;
}

export function createUpgradeService(database, identityIntent, packageService, deploymentService,
  installationId, environmentId, migrationReceiptSecret) {
  const { pool, executeCommand } = database;

  async function stateFor(planId, client = pool, lock = false) {
    const result = await client.query(
      `SELECT * FROM kernel_upgrade_plan_states
       WHERE installation_id=$1 AND environment_id=$2 AND upgrade_plan_id=$3${lock ? " FOR UPDATE" : ""}`,
      [installationId, environmentId, planId]
    );
    if (!result.rows[0]) throw new KernelError(404, "UPGRADE_PLAN_NOT_FOUND", "Upgrade Plan does not exist.");
    const row = result.rows[0];
    return { ...row, revision: Number(row.revision), updated_at: rowDate(row, "updated_at") };
  }

  async function setState(client, state, next, detail, acceptedAt) {
    const updated = await client.query(
      `UPDATE kernel_upgrade_plan_states SET state=$4,revision=revision+1,detail=$5,updated_at=$6
       WHERE installation_id=$1 AND environment_id=$2 AND upgrade_plan_id=$3 AND revision=$7`,
      [installationId, environmentId, state.upgrade_plan_id, next, detail, acceptedAt, state.revision]
    );
    if (updated.rowCount !== 1) throw new KernelError(409, "UPGRADE_STATE_CHANGED", "Upgrade state changed before transition.");
  }

  async function getCompatibilityReport(id, client = pool) {
    uuid(id, "compatibility_report_id");
    const result = await client.query(
      `SELECT * FROM kernel_upgrade_compatibility_reports
       WHERE installation_id=$1 AND environment_id=$2 AND compatibility_report_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "COMPATIBILITY_REPORT_NOT_FOUND", "Compatibility Report does not exist.");
    const row = result.rows[0];
    return { ...row, created_at: rowDate(row, "created_at"), immutable: true };
  }

  async function createCompatibilityReport(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["current_deployment_id", "target_deployment_id", "capability_export_id"]);
    const currentDeploymentId = uuid(envelope.input.current_deployment_id, "input.current_deployment_id");
    const targetDeploymentId = uuid(envelope.input.target_deployment_id, "input.target_deployment_id");
    const capabilityExportId = string(envelope.input.capability_export_id, "input.capability_export_id");
    if (currentDeploymentId === targetDeploymentId) {
      throw new KernelError(409, "UPGRADE_TARGET_UNCHANGED", "Current and target Deployments must differ.");
    }
    const compatibilityReportId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const currentDeployment = await deploymentService.getDeployment(currentDeploymentId, client);
        const targetDeployment = await deploymentService.getDeployment(targetDeploymentId, client);
        const currentPackage = await packageService.getPackageVersion(currentDeployment.package_version_id);
        const targetPackage = await packageService.getPackageVersion(targetDeployment.package_version_id);
        const currentPlan = await deploymentService.getDeploymentPlan(currentDeployment.deployment_plan_id, client);
        const targetPlan = await deploymentService.getDeploymentPlan(targetDeployment.deployment_plan_id, client);
        if (currentPackage.package_id !== targetPackage.package_id) {
          throw new KernelError(409, "UPGRADE_PACKAGE_MISMATCH", "Upgrade versions must share one Package identity.");
        }
        const currentCard = await deploymentService.getActionCard(currentDeploymentId, capabilityExportId, client);
        const targetCard = await deploymentService.getActionCard(targetDeploymentId, capabilityExportId, client);
        const sourceState = await client.query(
          `SELECT active_activation_id FROM kernel_capability_authority_states
           WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3 FOR UPDATE`,
          [installationId, environmentId, currentCard.affected_objects.capability_key]
        );
        const sourceActivationId = sourceState.rows[0]?.active_activation_id ?? null;
        if (!sourceActivationId || currentCard.capability_activation_id !== sourceActivationId) {
          throw new KernelError(409, "CURRENT_DEPLOYMENT_NOT_ACTIVE", "Compatibility analysis requires the exact current Deployment to be active.");
        }
        const activeRuns = await client.query(
          `SELECT r.run_id FROM kernel_runs r
           JOIN kernel_execution_envelopes e ON e.installation_id=r.installation_id AND e.environment_id=r.environment_id AND e.envelope_id=r.envelope_id
           JOIN kernel_run_states s ON s.installation_id=r.installation_id AND s.environment_id=r.environment_id AND s.run_id=r.run_id
           WHERE r.installation_id=$1 AND r.environment_id=$2 AND e.package_version_id=$3
             AND s.execution_status IN ('admitted','uncertain') ORDER BY r.run_id`,
          [installationId, environmentId, currentPackage.package_version_id]
        );
        const analysis = analyzeUpgradeCompatibility(compatibilitySnapshot(currentPackage, currentCard, currentPlan),
          compatibilitySnapshot(targetPackage, targetCard, targetPlan));
        const report = { ...analysis,
          current_deployment_id: currentDeploymentId, target_deployment_id: targetDeploymentId,
          current_package_version_id: currentPackage.package_version_id,
          target_package_version_id: targetPackage.package_version_id,
          capability_export_id: capabilityExportId,
          current_authority_digest: currentCard.affected_objects.authority_digest,
          target_authority_digest: targetCard.affected_objects.authority_digest,
          source_activation_id: sourceActivationId,
          active_run_ids: activeRuns.rows.map((row) => row.run_id),
          active_run_policy: "pin_original_exact_versions",
          breaking_install_strategy: analysis.classification === "parallel_major_required" ? "side_by_side" : "in_place_eligible"
        };
        const reportDigest = sha256Digest(report);
        await client.query(
          `INSERT INTO kernel_upgrade_compatibility_reports
           (compatibility_report_id,installation_id,environment_id,current_deployment_id,target_deployment_id,
            current_package_version_id,target_package_version_id,capability_export_id,source_activation_id,report,
            report_digest,created_by_actor_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [compatibilityReportId, installationId, environmentId, currentDeploymentId, targetDeploymentId,
            currentPackage.package_version_id, targetPackage.package_version_id, capabilityExportId, sourceActivationId,
            report, reportDigest, actor.id, acceptedAt]
        );
        return { aggregateType: "upgrade_compatibility_report", aggregateId: compatibilityReportId,
          transitionType: "kernel.upgrade.compatibility_analyzed",
          transitionPayload: { classification: report.classification, authority_equivalent: report.authority_equivalent },
          result: { compatibility_report: { compatibility_report_id: compatibilityReportId, report, report_digest: reportDigest,
            created_by_actor_id: actor.id, created_at: acceptedAt, immutable: true } } };
      }
    });
  }

  async function getActivationPolicy(id, client = pool) {
    uuid(id, "upgrade_activation_policy_id");
    const result = await client.query(
      `SELECT * FROM kernel_upgrade_activation_policies
       WHERE installation_id=$1 AND environment_id=$2 AND upgrade_activation_policy_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "UPGRADE_ACTIVATION_POLICY_NOT_FOUND", "Upgrade Activation Policy does not exist.");
    const row = result.rows[0];
    return { ...row, expires_at: rowDate(row, "expires_at"), created_at: rowDate(row, "created_at"), immutable: true };
  }

  async function createActivationPolicy(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["compatibility_report_id", "rationale", "expires_at"]);
    const reportId = uuid(envelope.input.compatibility_report_id, "input.compatibility_report_id");
    const rationale = string(envelope.input.rationale, "input.rationale");
    if (rationale.length > 2000) {
      throw new KernelError(400, "INVALID_INPUT", "input.rationale must not exceed 2000 characters.");
    }
    const expiresAt = new Date(envelope.input.expires_at);
    if (!Number.isFinite(expiresAt.getTime())) throw new KernelError(400, "INVALID_POLICY_EXPIRY", "Upgrade Activation Policy expiry must be an ISO timestamp.");
    const policyId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        if (expiresAt.getTime() <= Date.parse(acceptedAt)) {
          throw new KernelError(400, "INVALID_POLICY_EXPIRY", "Upgrade Activation Policy expiry must be in the future.");
        }
        const report = await getCompatibilityReport(reportId, client);
        if (!report.report.authority_equivalent) {
          throw new KernelError(409, "AUTHORITY_NOT_EQUIVALENT", "Changed authority cannot receive equivalence preapproval.");
        }
        const equivalenceDigest = authorityEquivalenceDigest(report.report);
        await client.query(
          `INSERT INTO kernel_upgrade_activation_policies
           (upgrade_activation_policy_id,installation_id,environment_id,compatibility_report_id,
            authority_equivalence_digest,rationale,approved_by_actor_id,expires_at,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [policyId, installationId, environmentId, reportId, equivalenceDigest, rationale, actor.id,
            expiresAt.toISOString(), acceptedAt]
        );
        return { aggregateType: "upgrade_activation_policy", aggregateId: policyId,
          transitionType: "kernel.upgrade.activation_policy_created",
          transitionPayload: { compatibility_report_id: reportId, authority_equivalence_digest: equivalenceDigest },
          result: { upgrade_activation_policy: { upgrade_activation_policy_id: policyId,
            compatibility_report_id: reportId, authority_equivalence_digest: equivalenceDigest, rationale,
            approved_by_actor_id: actor.id, expires_at: expiresAt.toISOString(), created_at: acceptedAt, immutable: true } } };
      }
    });
  }

  async function getUpgradePlan(id, client = pool) {
    uuid(id, "upgrade_plan_id");
    const result = await client.query(
      `SELECT p.*,s.state,s.revision,s.detail,s.updated_at FROM kernel_upgrade_plans p
       JOIN kernel_upgrade_plan_states s ON s.installation_id=p.installation_id AND s.environment_id=p.environment_id
        AND s.upgrade_plan_id=p.upgrade_plan_id
       WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.upgrade_plan_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "UPGRADE_PLAN_NOT_FOUND", "Upgrade Plan does not exist.");
    const row = result.rows[0];
    return { ...row, revision: Number(row.revision), created_at: rowDate(row, "created_at"),
      updated_at: rowDate(row, "updated_at"), immutable_plan: true };
  }

  async function createUpgradePlan(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["compatibility_report_id", "migration", "canary", "verification",
      "repair", "retention_until"], ["preapproval_policy_id"]);
    const compatibilityReportId = uuid(envelope.input.compatibility_report_id, "input.compatibility_report_id");
    const preapprovalPolicyId = envelope.input.preapproval_policy_id
      ? uuid(envelope.input.preapproval_policy_id, "input.preapproval_policy_id") : null;
    const migration = exactKeys(envelope.input.migration, "input.migration",
      ["declaration_version", "scope", "checkpoints"]);
    const canary = exactKeys(envelope.input.canary, "input.canary", ["seed", "basis_points", "gates"]);
    const verification = exactKeys(envelope.input.verification, "input.verification", ["criteria"]);
    const repair = exactKeys(envelope.input.repair, "input.repair", ["reversibility", "strategy"],
      ["forward_repair_capability_id", "rollback_boundary"]);
    prohibitPayloads({ migration, canary, verification, repair });
    string(migration.declaration_version, "input.migration.declaration_version");
    string(migration.scope, "input.migration.scope");
    string(repair.strategy, "input.repair.strategy");
    if (repair.forward_repair_capability_id !== undefined) {
      string(repair.forward_repair_capability_id, "input.repair.forward_repair_capability_id");
    }
    const checkpoints = requireArray(migration.checkpoints, "input.migration.checkpoints", { nonEmpty: true });
    const checkpointNames = [];
    checkpoints.forEach((checkpoint, index) => {
      exactKeys(checkpoint, `input.migration.checkpoints[${index}]`, ["name", "invariants"]);
      string(checkpoint.name, `input.migration.checkpoints[${index}].name`);
      checkpointNames.push(checkpoint.name);
      const invariants = requireArray(checkpoint.invariants, `input.migration.checkpoints[${index}].invariants`, { nonEmpty: true });
      invariants.forEach((item, itemIndex) => string(item, `input.migration.checkpoints[${index}].invariants[${itemIndex}]`));
      if (new Set(invariants).size !== invariants.length) {
        throw new KernelError(400, "DUPLICATE_MIGRATION_INVARIANT", "Checkpoint invariants must be unique.");
      }
    });
    if (new Set(checkpointNames).size !== checkpointNames.length) {
      throw new KernelError(400, "DUPLICATE_MIGRATION_CHECKPOINT", "Migration checkpoint names must be unique.");
    }
    string(canary.seed, "input.canary.seed");
    integer(canary.basis_points, "input.canary.basis_points", { minimum: 1, maximum: 10000 });
    const gates = requireArray(canary.gates, "input.canary.gates", { nonEmpty: true });
    gates.forEach((gate, index) => string(gate, `input.canary.gates[${index}]`));
    if (new Set(gates).size !== gates.length) throw new KernelError(400, "DUPLICATE_CANARY_GATE", "Canary gates must be unique.");
    const criteria = requireArray(verification.criteria, "input.verification.criteria", { nonEmpty: true });
    criteria.forEach((criterion, index) => string(criterion, `input.verification.criteria[${index}]`));
    if (new Set(criteria).size !== criteria.length) {
      throw new KernelError(400, "DUPLICATE_VERIFICATION_CRITERION", "Verification criteria must be unique.");
    }
    if (!criteria.includes("zero_undeclared_effects")) {
      throw new KernelError(400, "UNDECLARED_EFFECTS_CRITERION_REQUIRED",
        "Upgrade verification must declare zero_undeclared_effects.");
    }
    if (!new Set(["reversible", "conditionally_reversible", "forward_only"]).has(repair.reversibility)) {
      throw new KernelError(400, "INVALID_REVERSIBILITY", "Repair reversibility must be explicit.");
    }
    let rollbackBoundary = null;
    if (repair.rollback_boundary !== undefined) {
      rollbackBoundary = exactKeys(repair.rollback_boundary, "input.repair.rollback_boundary",
        ["allowed_real_world_changes", "expires_at"]);
      const allowed = requireArray(rollbackBoundary.allowed_real_world_changes,
        "input.repair.rollback_boundary.allowed_real_world_changes", { nonEmpty: true });
      if (allowed.some((value) => !new Set(["none", "compatible"]).has(value)) || new Set(allowed).size !== allowed.length) {
        throw new KernelError(400, "INVALID_ROLLBACK_BOUNDARY", "Rollback boundary allows unique none/compatible states only.");
      }
      const expiresAt = new Date(rollbackBoundary.expires_at);
      if (!Number.isFinite(expiresAt.getTime())) throw new KernelError(400, "INVALID_ROLLBACK_BOUNDARY", "Rollback boundary expiry must be an ISO timestamp.");
      rollbackBoundary = { allowed_real_world_changes: allowed, expires_at: expiresAt.toISOString(),
        attestation_required: true };
    }
    if (repair.reversibility === "conditionally_reversible" && !rollbackBoundary) {
      throw new KernelError(400, "ROLLBACK_BOUNDARY_REQUIRED", "Conditionally reversible upgrades require an explicit rollback boundary.");
    }
    const retentionUntil = new Date(envelope.input.retention_until);
    if (!Number.isFinite(retentionUntil.getTime())) throw new KernelError(400, "INVALID_RETENTION", "input.retention_until must be an ISO timestamp.");
    const upgradePlanId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        if (rollbackBoundary && Date.parse(rollbackBoundary.expires_at) <= Date.parse(acceptedAt)) {
          throw new KernelError(400, "INVALID_ROLLBACK_BOUNDARY", "Rollback boundary expiry must be in the future.");
        }
        const reportRow = await getCompatibilityReport(compatibilityReportId, client);
        if (reportRow.report.classification === "unsupported") {
          throw new KernelError(409, "UPGRADE_UNSUPPORTED", "Unsupported compatibility dimensions prevent an Upgrade Plan.");
        }
        if (reportRow.report.classification === "parallel_major_required") {
          const currentPackage = await packageService.getPackageVersion(reportRow.current_package_version_id);
          const targetPackage = await packageService.getPackageVersion(reportRow.target_package_version_id);
          if (!upgradeMajorAdmissible(reportRow.report.classification, currentPackage.semantic_version,
            targetPackage.semantic_version)) {
            throw new KernelError(409, "BREAKING_MAJOR_REQUIRED",
              "Breaking compatibility requires a strictly newer Package major installed side by side.");
          }
        }
        let preapprovalPolicy = null;
        if (preapprovalPolicyId) {
          preapprovalPolicy = await getActivationPolicy(preapprovalPolicyId, client);
          if (preapprovalPolicy.compatibility_report_id !== compatibilityReportId
            || preapprovalPolicy.authority_equivalence_digest !== authorityEquivalenceDigest(reportRow.report)
            || Date.parse(preapprovalPolicy.expires_at) <= Date.parse(acceptedAt)) {
            throw new KernelError(409, "UPGRADE_PREAPPROVAL_MISMATCH", "Preapproval policy does not bind this exact current report.");
          }
        }
        if (!reportRow.report.authority_equivalent && preapprovalPolicy) {
          throw new KernelError(409, "AUTHORITY_NOT_EQUIVALENT", "Changed authority requires fresh business approval.");
        }
        let forwardRepairBinding = null;
        if (repair.forward_repair_capability_id) {
          const targetPackage = await packageService.getPackageVersion(reportRow.target_package_version_id);
          const forwardRepair = targetPackage.candidate.exports.find((entry) => entry.kind === "capability"
            && entry.export_id === repair.forward_repair_capability_id);
          if (!forwardRepair) {
            throw new KernelError(409, "FORWARD_REPAIR_CAPABILITY_INVALID",
              "Forward repair must reference an exact Capability exported by the target Package.");
          }
          const repairCard = await deploymentService.getActionCard(reportRow.target_deployment_id,
            repair.forward_repair_capability_id, client);
          forwardRepairBinding = { deployment_id: reportRow.target_deployment_id,
            package_version_id: reportRow.target_package_version_id, capability_export_id: forwardRepair.export_id,
            capability_contract_version: forwardRepair.contract_version,
            capability_export_digest: repairCard.affected_objects.capability_export_digest,
            authority_digest: repairCard.affected_objects.authority_digest };
        }
        const plan = {
          schema_version: "alphonse.upgrade_plan.v0.1",
          compatibility_report_id: compatibilityReportId,
          current: { deployment_id: reportRow.current_deployment_id, package_version_id: reportRow.current_package_version_id,
            package_identity: reportRow.report.current_package_identity },
          target: { deployment_id: reportRow.target_deployment_id, package_version_id: reportRow.target_package_version_id,
            package_identity: reportRow.report.target_package_identity },
          capability_export_id: reportRow.capability_export_id,
          dependency_diff: reportRow.report.dimensions.dependencies,
          contract_diff: reportRow.report.dimensions,
          migration: { ...migration, external_effects: "prohibited", payload_plane: "owner_data_plane" },
          in_flight_runs: { policy: "pin_original_exact_versions", run_ids: reportRow.report.active_run_ids },
          canary, verification, repair: { ...repair, rollback_boundary: rollbackBoundary,
            forward_repair_binding: forwardRepairBinding },
          activation_policy: { preapproval_policy_id: preapprovalPolicy?.upgrade_activation_policy_id ?? null,
            authority_equivalence_digest: preapprovalPolicy?.authority_equivalence_digest ?? null,
            fresh_approval_on_authority_change: true },
          retirement: { retention_until: retentionUntil.toISOString(), require_zero_references: true }
        };
        if (repair.reversibility === "forward_only" && !repair.forward_repair_capability_id) {
          throw new KernelError(400, "FORWARD_REPAIR_REQUIRED", "Forward-only upgrades require a declared forward-repair Capability.");
        }
        const planDigest = sha256Digest(plan);
        await client.query(
          `INSERT INTO kernel_upgrade_plans
           (upgrade_plan_id,installation_id,environment_id,compatibility_report_id,current_deployment_id,target_deployment_id,
            current_package_version_id,target_package_version_id,plan,plan_digest,created_by_actor_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [upgradePlanId, installationId, environmentId, compatibilityReportId, reportRow.current_deployment_id,
            reportRow.target_deployment_id, reportRow.current_package_version_id, reportRow.target_package_version_id,
            plan, planDigest, actor.id, acceptedAt]
        );
        await client.query(
          `INSERT INTO kernel_upgrade_plan_states
           (installation_id,environment_id,upgrade_plan_id,state,revision,detail,updated_at)
           VALUES ($1,$2,$3,'planned',0,$4,$5)`,
          [installationId, environmentId, upgradePlanId, { compatibility_report_id: compatibilityReportId }, acceptedAt]
        );
        return { aggregateType: "upgrade_plan", aggregateId: upgradePlanId,
          transitionType: "kernel.upgrade.plan_created", transitionPayload: { plan_digest: planDigest },
          result: { upgrade_plan: { upgrade_plan_id: upgradePlanId, plan, plan_digest: planDigest,
            state: "planned", revision: 0, created_by_actor_id: actor.id, created_at: acceptedAt, immutable_plan: true } } };
      }
    });
  }

  async function getMigrationRun(id, client = pool) {
    uuid(id, "migration_run_id");
    const result = await client.query(
      `SELECT r.*,s.state,s.next_checkpoint,s.revision,s.updated_at FROM kernel_upgrade_migration_runs r
       JOIN kernel_upgrade_migration_states s ON s.installation_id=r.installation_id AND s.environment_id=r.environment_id
        AND s.migration_run_id=r.migration_run_id
       WHERE r.installation_id=$1 AND r.environment_id=$2 AND r.migration_run_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "MIGRATION_RUN_NOT_FOUND", "Migration Run does not exist.");
    const row = result.rows[0];
    return { ...row, next_checkpoint: Number(row.next_checkpoint), revision: Number(row.revision),
      started_at: rowDate(row, "started_at"), updated_at: rowDate(row, "updated_at") };
  }

  async function startMigration(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["upgrade_plan_id"]);
    const upgradePlanId = uuid(envelope.input.upgrade_plan_id, "input.upgrade_plan_id");
    const migrationRunId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const plan = await getUpgradePlan(upgradePlanId, client);
        const state = await stateFor(upgradePlanId, client, true);
        if (state.state !== "planned") throw new KernelError(409, "UPGRADE_PHASE_MISMATCH", "Migration starts only from planned state.");
        const declarationDigest = sha256Digest(plan.plan.migration);
        await client.query(
          `INSERT INTO kernel_upgrade_migration_runs
           (migration_run_id,installation_id,environment_id,upgrade_plan_id,declaration_digest,started_by_actor_id,started_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [migrationRunId, installationId, environmentId, upgradePlanId, declarationDigest, actor.id, acceptedAt]
        );
        await client.query(
          `INSERT INTO kernel_upgrade_migration_states
           (installation_id,environment_id,migration_run_id,state,next_checkpoint,revision,updated_at)
           VALUES ($1,$2,$3,'running',0,0,$4)`, [installationId, environmentId, migrationRunId, acceptedAt]
        );
        await setState(client, state, "migrating", { migration_run_id: migrationRunId }, acceptedAt);
        return { aggregateType: "upgrade_migration_run", aggregateId: migrationRunId,
          transitionType: "kernel.upgrade.migration_started", transitionPayload: { upgrade_plan_id: upgradePlanId, declaration_digest: declarationDigest },
          result: { migration_run: { migration_run_id: migrationRunId, upgrade_plan_id: upgradePlanId,
            declaration_digest: declarationDigest, state: "running", next_checkpoint: 0, started_at: acceptedAt } } };
      }
    });
  }

  async function checkpointMigration(envelope, migrationRunId) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["checkpoint_ordinal", "checkpoint_name", "input_digest", "output_digest",
      "source_count", "target_count", "invariants", "attestation_signature"]);
    uuid(migrationRunId, "migration_run_id");
    const ordinal = integer(envelope.input.checkpoint_ordinal, "input.checkpoint_ordinal");
    const name = string(envelope.input.checkpoint_name, "input.checkpoint_name");
    digest(envelope.input.input_digest, "input.input_digest");
    digest(envelope.input.output_digest, "input.output_digest");
    integer(envelope.input.source_count, "input.source_count");
    integer(envelope.input.target_count, "input.target_count");
    const invariants = object(envelope.input.invariants);
    if (!invariants || Object.values(invariants).some((value) => typeof value !== "boolean")) {
      throw new KernelError(400, "INVALID_MIGRATION_INVARIANTS", "Checkpoint invariants must be a boolean map.");
    }
    const checkpointId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const run = await getMigrationRun(migrationRunId, client);
        const lock = await client.query(
          `SELECT * FROM kernel_upgrade_migration_states
           WHERE installation_id=$1 AND environment_id=$2 AND migration_run_id=$3 FOR UPDATE`,
          [installationId, environmentId, migrationRunId]
        );
        const migrationState = lock.rows[0];
        if (!new Set(["running", "checkpointed"]).has(migrationState.state)) {
          throw new KernelError(409, "MIGRATION_PHASE_MISMATCH", "Only a running migration accepts checkpoints.");
        }
        if (Number(migrationState.next_checkpoint) !== ordinal) {
          throw new KernelError(409, "MIGRATION_CHECKPOINT_OUT_OF_ORDER", "Checkpoint does not match the resumable next ordinal.",
            { expected: Number(migrationState.next_checkpoint), received: ordinal });
        }
        const plan = await getUpgradePlan(run.upgrade_plan_id, client);
        const declaration = plan.plan.migration.checkpoints[ordinal];
        if (!declaration || declaration.name !== name) {
          throw new KernelError(409, "MIGRATION_CHECKPOINT_UNDECLARED", "Checkpoint must match the exact ordered migration declaration.");
        }
        const declaredInvariants = [...declaration.invariants].sort();
        if (sha256Digest(Object.keys(invariants).sort()) !== sha256Digest(declaredInvariants)) {
          throw new KernelError(409, "MIGRATION_INVARIANTS_MISMATCH", "Checkpoint must report every declared invariant and no others.");
        }
        if (Object.values(invariants).some((passed) => !passed)) {
          throw new KernelError(409, "MIGRATION_INVARIANT_FAILED", "Failed checkpoint invariants cannot advance migration.");
        }
        const checkpoint = { migration_run_id: migrationRunId, checkpoint_ordinal: ordinal, checkpoint_name: name,
          input_digest: envelope.input.input_digest, output_digest: envelope.input.output_digest,
          source_count: envelope.input.source_count, target_count: envelope.input.target_count, invariants };
        const attestationSignature = verifyAttestation(checkpoint, envelope.input.attestation_signature, migrationReceiptSecret);
        const checkpointDigest = sha256Digest(checkpoint);
        await client.query(
          `INSERT INTO kernel_upgrade_migration_checkpoints
           (migration_checkpoint_id,installation_id,environment_id,migration_run_id,checkpoint_ordinal,checkpoint_name,
            input_digest,output_digest,source_count,target_count,invariants,checkpoint_digest,attestation_signature,
            recorded_by_actor_id,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [checkpointId, installationId, environmentId, migrationRunId, ordinal, name, envelope.input.input_digest,
            envelope.input.output_digest, envelope.input.source_count, envelope.input.target_count, invariants,
            checkpointDigest, attestationSignature, actor.id, acceptedAt]
        );
        await client.query(
          `UPDATE kernel_upgrade_migration_states SET state='checkpointed',next_checkpoint=$4,revision=revision+1,updated_at=$5
           WHERE installation_id=$1 AND environment_id=$2 AND migration_run_id=$3`,
          [installationId, environmentId, migrationRunId, ordinal + 1, acceptedAt]
        );
        return { aggregateType: "upgrade_migration_run", aggregateId: migrationRunId,
          transitionType: "kernel.upgrade.migration_checkpointed", fromRevision: Number(migrationState.revision),
          toRevision: Number(migrationState.revision) + 1,
          transitionPayload: { checkpoint_ordinal: ordinal, checkpoint_digest: checkpointDigest },
          result: { migration_checkpoint: { migration_checkpoint_id: checkpointId, ...checkpoint,
            checkpoint_digest: checkpointDigest, attestation_signature: attestationSignature,
            next_checkpoint: ordinal + 1, recorded_at: acceptedAt, immutable: true } } };
      }
    });
  }

  async function verifyMigration(envelope, migrationRunId) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["criteria", "attestation_signature"]);
    uuid(migrationRunId, "migration_run_id");
    const criteria = object(envelope.input.criteria);
    if (!criteria || Object.values(criteria).some((value) => typeof value !== "boolean")) {
      throw new KernelError(400, "INVALID_MIGRATION_VERIFICATION", "Verification criteria must be a boolean map.");
    }
    const verificationId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const run = await getMigrationRun(migrationRunId, client);
        const lock = await client.query(
          `SELECT * FROM kernel_upgrade_migration_states
           WHERE installation_id=$1 AND environment_id=$2 AND migration_run_id=$3 FOR UPDATE`,
          [installationId, environmentId, migrationRunId]
        );
        const migrationState = lock.rows[0];
        const plan = await getUpgradePlan(run.upgrade_plan_id, client);
        const planState = await stateFor(run.upgrade_plan_id, client, true);
        if (!new Set(["migrating", "verified", "canary_paused", "canary_passed"]).has(planState.state)) {
          throw new KernelError(409, "MIGRATION_VERIFICATION_PHASE_MISMATCH",
            "Migration verification cannot rewrite an active, recovered, or retired upgrade decision.");
        }
        if (Number(migrationState.next_checkpoint) !== plan.plan.migration.checkpoints.length) {
          throw new KernelError(409, "MIGRATION_INCOMPLETE", "Every declared migration checkpoint must complete before verification.");
        }
        if (sha256Digest(Object.keys(criteria).sort()) !== sha256Digest([...plan.plan.verification.criteria].sort())) {
          throw new KernelError(409, "MIGRATION_VERIFICATION_MISMATCH", "Verification must bind every declared criterion and no others.");
        }
        if (Object.values(criteria).some((passed) => !passed)) {
          throw new KernelError(409, "MIGRATION_VERIFICATION_FAILED", "Failed verification leaves the target inactive.");
        }
        const checkpoints = await client.query(
          `SELECT checkpoint_digest FROM kernel_upgrade_migration_checkpoints
           WHERE installation_id=$1 AND environment_id=$2 AND migration_run_id=$3 ORDER BY checkpoint_ordinal`,
          [installationId, environmentId, migrationRunId]
        );
        if (criteria.zero_undeclared_effects !== true) {
          throw new KernelError(409, "UNDECLARED_MIGRATION_EFFECTS", "Migration verification must attest zero undeclared Effects.");
        }
        const verification = { migration_run_id: migrationRunId, criteria,
          checkpoint_digests: checkpoints.rows.map((row) => row.checkpoint_digest) };
        const attestationSignature = verifyAttestation(verification, envelope.input.attestation_signature, migrationReceiptSecret);
        const verificationDigest = sha256Digest(verification);
        await client.query(
          `INSERT INTO kernel_upgrade_migration_verifications
           (migration_verification_id,installation_id,environment_id,migration_run_id,verification,verification_digest,
            attestation_signature,verified_by_actor_id,verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [verificationId, installationId, environmentId, migrationRunId, verification, verificationDigest,
            attestationSignature, actor.id, acceptedAt]
        );
        await client.query(
          `UPDATE kernel_upgrade_migration_states SET state='verified',revision=revision+1,updated_at=$4
           WHERE installation_id=$1 AND environment_id=$2 AND migration_run_id=$3`,
          [installationId, environmentId, migrationRunId, acceptedAt]
        );
        await setState(client, planState, "verified", { migration_run_id: migrationRunId,
          verification_digest: verificationDigest }, acceptedAt);
        return { aggregateType: "upgrade_migration_run", aggregateId: migrationRunId,
          transitionType: "kernel.upgrade.migration_verified", transitionPayload: { verification_digest: verificationDigest },
          result: { migration_verification: { migration_verification_id: verificationId, verification,
            verification_digest: verificationDigest, attestation_signature: attestationSignature,
            verified_at: acceptedAt, immutable: true } } };
      }
    });
  }

  async function evaluateCanary(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["upgrade_plan_id", "attempt_number", "routing_keys", "assignment_digest",
      "gate_results"]);
    const upgradePlanId = uuid(envelope.input.upgrade_plan_id, "input.upgrade_plan_id");
    const requestedAttemptNumber = integer(envelope.input.attempt_number, "input.attempt_number", { minimum: 1 });
    const routingKeys = requireArray(envelope.input.routing_keys, "input.routing_keys", { nonEmpty: true });
    const gateResults = requireArray(envelope.input.gate_results, "input.gate_results", { nonEmpty: true });
    if (new Set(routingKeys).size !== routingKeys.length) {
      throw new KernelError(400, "DUPLICATE_CANARY_ROUTING_KEY", "Canary routing keys must be unique.");
    }
    const canaryAttemptId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const plan = await getUpgradePlan(upgradePlanId, client);
        const state = await stateFor(upgradePlanId, client, true);
        if (!new Set(["verified", "canary_paused"]).has(state.state)) {
          throw new KernelError(409, "UPGRADE_PHASE_MISMATCH", "Canary requires verified migration or a paused prior attempt.");
        }
        const assignments = routingKeys.map((routingKey) => deterministicCanaryAssignment(plan.plan.canary.seed,
          string(routingKey, "input.routing_keys[]"), plan.plan.canary.basis_points));
        if (!assignments.some((assignment) => assignment.selected)) {
          throw new KernelError(409, "CANARY_COHORT_EMPTY", "Deterministic canary cohort selected no routing keys.");
        }
        const assignmentReceipt = { seed_digest: sha256Digest(plan.plan.canary.seed),
          basis_points: plan.plan.canary.basis_points, assignments };
        const assignmentDigest = sha256Digest(assignmentReceipt);
        if (digest(envelope.input.assignment_digest, "input.assignment_digest") !== assignmentDigest) {
          throw new KernelError(409, "CANARY_ASSIGNMENT_MISMATCH", "Canary gates must bind the exact computed cohort.");
        }
        const attempt = await client.query(
          `SELECT COALESCE(MAX(attempt_number),0)+1 AS next_attempt FROM kernel_upgrade_canary_attempts
           WHERE installation_id=$1 AND environment_id=$2 AND upgrade_plan_id=$3`,
          [installationId, environmentId, upgradePlanId]
        );
        const attemptNumber = Number(attempt.rows[0].next_attempt);
        if (requestedAttemptNumber !== attemptNumber) {
          throw new KernelError(409, "CANARY_ATTEMPT_MISMATCH", "Canary evidence must bind the exact next attempt.",
            { expected: attemptNumber, received: requestedAttemptNumber });
        }
        const suppliedGates = gateResults.map((gate) => {
          if (!object(gate) || typeof gate.passed !== "boolean") throw new KernelError(400, "INVALID_CANARY_GATE", "Canary gates require gate_id and boolean passed.");
          exactKeys(gate, "input.gate_results[]", ["gate_id", "passed", "evidence_digest", "attestation_signature"]);
          const receipt = { upgrade_plan_id: upgradePlanId, attempt_number: attemptNumber,
            assignment_digest: assignmentDigest,
            gate_id: string(gate.gate_id, "input.gate_results[].gate_id"), passed: gate.passed,
            evidence_digest: digest(gate.evidence_digest, "input.gate_results[].evidence_digest") };
          return { ...receipt, attestation_signature: verifyAttestation(receipt, gate.attestation_signature,
            migrationReceiptSecret) };
        });
        if (sha256Digest(suppliedGates.map((gate) => gate.gate_id).sort()) !== sha256Digest([...plan.plan.canary.gates].sort())) {
          throw new KernelError(409, "CANARY_GATES_MISMATCH", "Canary must evaluate every declared gate and no others.");
        }
        const outcome = suppliedGates.every((gate) => gate.passed) ? "passed" : "paused";
        await client.query(
          `INSERT INTO kernel_upgrade_canary_attempts
           (canary_attempt_id,installation_id,environment_id,upgrade_plan_id,attempt_number,assignment_receipt,
            assignment_digest,gate_results,outcome,evaluated_by_actor_id,evaluated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [canaryAttemptId, installationId, environmentId, upgradePlanId, attemptNumber, assignmentReceipt,
            assignmentDigest, JSON.stringify(suppliedGates), outcome, actor.id, acceptedAt]
        );
        await setState(client, state, outcome === "passed" ? "canary_passed" : "canary_paused",
          { canary_attempt_id: canaryAttemptId, failed_gates: suppliedGates.filter((gate) => !gate.passed).map((gate) => gate.gate_id) }, acceptedAt);
        return { aggregateType: "upgrade_canary_attempt", aggregateId: canaryAttemptId,
          transitionType: outcome === "passed" ? "kernel.upgrade.canary_passed" : "kernel.upgrade.canary_paused",
          transitionPayload: { upgrade_plan_id: upgradePlanId, attempt_number: attemptNumber, assignment_digest: assignmentDigest },
          result: { canary_attempt: { canary_attempt_id: canaryAttemptId, upgrade_plan_id: upgradePlanId,
            attempt_number: attemptNumber, assignment_receipt: assignmentReceipt, assignment_digest: assignmentDigest,
            gate_results: suppliedGates, outcome, evaluated_at: acceptedAt, immutable: true } } };
      }
    });
  }

  async function activateUpgrade(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["upgrade_plan_id"], ["business_approval_id"]);
    const upgradePlanId = uuid(envelope.input.upgrade_plan_id, "input.upgrade_plan_id");
    const upgradeActivationId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const plan = await getUpgradePlan(upgradePlanId, client);
        const state = await stateFor(upgradePlanId, client, true);
        if (state.state !== "canary_passed") throw new KernelError(409, "UPGRADE_PHASE_MISMATCH", "Only a passed canary permits upgrade activation.");
        const reportRow = await getCompatibilityReport(plan.compatibility_report_id, client);
        const migrationAttestation = await client.query(
          `SELECT v.verification,v.attestation_signature FROM kernel_upgrade_migration_runs r
           JOIN kernel_upgrade_migration_verifications v ON v.installation_id=r.installation_id
            AND v.environment_id=r.environment_id AND v.migration_run_id=r.migration_run_id
           WHERE r.installation_id=$1 AND r.environment_id=$2 AND r.upgrade_plan_id=$3
           ORDER BY v.verified_at DESC,v.migration_verification_id DESC LIMIT 1`,
          [installationId, environmentId, upgradePlanId]
        );
        if (!migrationAttestation.rows[0]) {
          throw new KernelError(409, "MIGRATION_ATTESTATION_REQUIRED", "Activation requires an authenticated migration verification receipt.");
        }
        verifyAttestation(migrationAttestation.rows[0].verification,
          migrationAttestation.rows[0].attestation_signature, migrationReceiptSecret);
        const card = await deploymentService.getActionCard(plan.target_deployment_id, reportRow.capability_export_id, client);
        const authorityState = await client.query(
          `SELECT * FROM kernel_capability_authority_states
           WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3 FOR UPDATE`,
          [installationId, environmentId, card.affected_objects.capability_key]
        );
        const currentRevision = Number(authorityState.rows[0]?.current_revision ?? -1);
        if (currentRevision < 0 || authorityState.rows[0].active_activation_id !== reportRow.source_activation_id) {
          throw new KernelError(409, "UPGRADE_SOURCE_CHANGED", "Active user space changed since compatibility analysis.");
        }
        let businessApproval;
        let approvalBasis;
        if (reportRow.report.authority_equivalent) {
          if (!plan.plan.activation_policy.preapproval_policy_id) {
            throw new KernelError(409, "UPGRADE_PREAPPROVAL_MISSING", "Authority-equivalent activation was not preapproved by policy.");
          }
          const policy = await getActivationPolicy(plan.plan.activation_policy.preapproval_policy_id, client);
          if (policy.compatibility_report_id !== reportRow.compatibility_report_id
            || policy.authority_equivalence_digest !== authorityEquivalenceDigest(reportRow.report)
            || Date.parse(policy.expires_at) <= Date.parse(acceptedAt)) {
            throw new KernelError(409, "UPGRADE_PREAPPROVAL_MISMATCH", "Upgrade preapproval policy is stale or mismatched.");
          }
          const businessApprovalId = randomUUID();
          await client.query(
            `INSERT INTO kernel_capability_business_approvals
             (business_approval_id,installation_id,environment_id,deployment_id,capability_key,capability_export_id,
              capability_export_digest,authority_digest,approved_against_revision,approved_by_principal_id,approved_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [businessApprovalId, installationId, environmentId, plan.target_deployment_id,
              card.affected_objects.capability_key, reportRow.capability_export_id,
              card.affected_objects.capability_export_digest, card.affected_objects.authority_digest,
              currentRevision, actor.id, acceptedAt]
          );
          businessApproval = { business_approval_id: businessApprovalId, approved_against_revision: currentRevision };
          approvalBasis = "preapproved_authority_equivalent";
        } else {
          if (!envelope.input.business_approval_id) {
            throw new KernelError(409, "FRESH_BUSINESS_APPROVAL_REQUIRED", "Changed authority requires fresh exact business approval.");
          }
          const businessApprovalId = uuid(envelope.input.business_approval_id, "input.business_approval_id");
          businessApproval = await deploymentService.getBusinessApproval(businessApprovalId, client);
          if (businessApproval.deployment_id !== plan.target_deployment_id
            || businessApproval.capability_export_id !== reportRow.capability_export_id
            || businessApproval.capability_export_digest !== card.affected_objects.capability_export_digest
            || businessApproval.authority_digest !== card.affected_objects.authority_digest
            || Number(businessApproval.approved_against_revision) !== currentRevision) {
            throw new KernelError(409, "FRESH_BUSINESS_APPROVAL_REQUIRED", "Changed authority requires fresh exact business approval.");
          }
          approvalBasis = "fresh_business_approval";
        }
        const targetActivationId = randomUUID();
        const targetPackage = await packageService.getPackageVersion(plan.target_package_version_id);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`package-admission:${targetPackage.package_version_id}`]);
        const targetRetirement = await client.query(
          `SELECT package_retirement_id FROM kernel_package_retirements
           WHERE installation_id=$1 AND environment_id=$2 AND package_version_id=$3`,
          [installationId, environmentId, targetPackage.package_version_id]
        );
        if (targetRetirement.rowCount > 0) {
          throw new KernelError(409, "PACKAGE_VERSION_RETIRED", "A retired target Package cannot be activated.");
        }
        const capability = targetPackage.candidate.exports.find((entry) => entry.kind === "capability"
          && entry.export_id === reportRow.capability_export_id);
        const toRevision = currentRevision + 1;
        await client.query(
          `INSERT INTO kernel_capability_activations
           (capability_activation_id,installation_id,environment_id,business_approval_id,deployment_id,package_version_id,
            capability_key,capability_export_id,capability_contract_version,capability_export_digest,authority_digest,
            from_revision,to_revision,activated_by_principal_id,activated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [targetActivationId, installationId, environmentId, businessApproval.business_approval_id,
            plan.target_deployment_id, plan.target_package_version_id, card.affected_objects.capability_key,
            reportRow.capability_export_id, capability.contract_version, card.affected_objects.capability_export_digest,
            card.affected_objects.authority_digest, currentRevision, toRevision, actor.id, acceptedAt]
        );
        await client.query(
          `UPDATE kernel_capability_authority_states SET current_revision=$4,active_activation_id=$5,updated_at=$6
           WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3`,
          [installationId, environmentId, card.affected_objects.capability_key, toRevision, targetActivationId, acceptedAt]
        );
        const equivalenceDigest = authorityEquivalenceDigest(reportRow.report);
        await client.query(
          `INSERT INTO kernel_upgrade_activations
           (upgrade_activation_id,installation_id,environment_id,upgrade_plan_id,source_activation_id,target_activation_id,
            business_approval_id,approval_basis,authority_equivalence_digest,activated_by_actor_id,activated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [upgradeActivationId, installationId, environmentId, upgradePlanId, reportRow.source_activation_id,
            targetActivationId, businessApproval.business_approval_id, approvalBasis, equivalenceDigest, actor.id, acceptedAt]
        );
        await setState(client, state, "active", { upgrade_activation_id: upgradeActivationId,
          target_activation_id: targetActivationId }, acceptedAt);
        return { aggregateType: "upgrade_activation", aggregateId: upgradeActivationId,
          transitionType: "kernel.upgrade.activated", fromRevision: currentRevision, toRevision,
          transitionPayload: { source_activation_id: reportRow.source_activation_id, target_activation_id: targetActivationId,
            approval_basis: approvalBasis },
          result: { upgrade_activation: { upgrade_activation_id: upgradeActivationId, upgrade_plan_id: upgradePlanId,
            source_activation_id: reportRow.source_activation_id, target_activation_id: targetActivationId,
            business_approval_id: businessApproval.business_approval_id, approval_basis: approvalBasis,
            authority_equivalence_digest: equivalenceDigest, activated_at: acceptedAt, immutable: true } } };
      }
    });
  }

  async function recordRecoveryAction(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["upgrade_plan_id", "action_type", "real_world_change", "reference_digest",
      "detail"], ["attestation_signature", "resolves_recovery_action_id", "expected_state_revision",
        "forward_repair_binding"]);
    const upgradePlanId = uuid(envelope.input.upgrade_plan_id, "input.upgrade_plan_id");
    const actionType = string(envelope.input.action_type, "input.action_type");
    const realWorldChange = string(envelope.input.real_world_change, "input.real_world_change");
    if (!new Set(["deployment_rollback", "forward_repair", "compensation",
      "forward_repair_verified", "compensation_verified"]).has(actionType)
      || !new Set(["none", "compatible", "incompatible"]).has(realWorldChange)) {
      throw new KernelError(400, "INVALID_RECOVERY_ACTION", "Recovery action and real-world change classification are required.");
    }
    if (actionType === "deployment_rollback" && realWorldChange === "incompatible") {
      throw new KernelError(409, "FALSE_ROLLBACK_PROHIBITED", "Incompatible real-world changes require forward repair or compensation.");
    }
    const detail = object(envelope.input.detail);
    if (!detail) throw new KernelError(400, "INVALID_RECOVERY_ACTION", "input.detail must be an object.");
    prohibitPayloads(detail, "input.detail");
    const recoveryDetail = { ...detail };
    const referenceDigest = digest(envelope.input.reference_digest, "input.reference_digest");
    const verificationAction = new Set(["forward_repair_verified", "compensation_verified"]).has(actionType);
    const forwardRepairAction = new Set(["forward_repair", "forward_repair_verified"]).has(actionType);
    const suppliedForwardRepairBinding = envelope.input.forward_repair_binding === undefined ? null
      : exactKeys(envelope.input.forward_repair_binding, "input.forward_repair_binding",
        ["deployment_id", "package_version_id", "capability_export_id", "capability_contract_version",
          "capability_export_digest", "authority_digest"]);
    if (!forwardRepairAction && suppliedForwardRepairBinding) {
      throw new KernelError(400, "INVALID_RECOVERY_ACTION",
        "Forward-repair binding is valid only for forward-repair actions.");
    }
    const resolvesRecoveryActionId = verificationAction
      ? uuid(envelope.input.resolves_recovery_action_id, "input.resolves_recovery_action_id") : null;
    const expectedStateRevision = verificationAction
      ? integer(envelope.input.expected_state_revision, "input.expected_state_revision") : null;
    if (!verificationAction && (envelope.input.resolves_recovery_action_id !== undefined
      || envelope.input.expected_state_revision !== undefined)) {
      throw new KernelError(400, "INVALID_RECOVERY_ACTION",
        "Recovery resolution bindings are valid only for verified repair or compensation.");
    }
    const attestedAction = verificationAction || actionType === "deployment_rollback";
    let recoveryAttestation = null;
    if (attestedAction) {
      const receipt = { upgrade_plan_id: upgradePlanId, action_type: actionType,
        real_world_change: realWorldChange, reference_digest: referenceDigest, detail,
        ...(verificationAction ? { resolves_recovery_action_id: resolvesRecoveryActionId,
          expected_state_revision: expectedStateRevision } : {}),
        ...(suppliedForwardRepairBinding ? { forward_repair_binding: suppliedForwardRepairBinding } : {}) };
      recoveryAttestation = verifyAttestation(receipt, envelope.input.attestation_signature, migrationReceiptSecret);
    }
    const recoveryActionId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const plan = await getUpgradePlan(upgradePlanId, client);
        const state = await stateFor(upgradePlanId, client, true);
        if (!new Set(["active", "repair_required", "repair_verified"]).has(state.state)) {
          throw new KernelError(409, "UPGRADE_PHASE_MISMATCH", "Recovery follows an active or repair-required upgrade.");
        }
        if (verificationAction && (state.state !== "repair_required" || realWorldChange !== "compatible")) {
          throw new KernelError(409, "REPAIR_VERIFICATION_PHASE_MISMATCH", "Repair verification requires unresolved repair and compatible resulting reality.");
        }
        if (forwardRepairAction) {
          const declaredBinding = plan.plan.repair.forward_repair_binding;
          if (!declaredBinding) {
            throw new KernelError(409, "FORWARD_REPAIR_BINDING_REQUIRED",
              "Forward repair requires an exact Capability binding declared by the Upgrade Plan.");
          }
          if (!suppliedForwardRepairBinding
            || sha256Digest(suppliedForwardRepairBinding) !== sha256Digest(declaredBinding)) {
            throw new KernelError(409, "FORWARD_REPAIR_BINDING_MISMATCH",
              "Forward repair must bind the exact deployed repair Capability.");
          }
          recoveryDetail.forward_repair_binding = declaredBinding;
        }
        if (verificationAction) {
          if (state.revision !== expectedStateRevision) {
            throw new KernelError(409, "UPGRADE_STATE_CHANGED", "Repair verification is stale.",
              { expected: expectedStateRevision, current: state.revision });
          }
          const expectedActionType = actionType === "forward_repair_verified" ? "forward_repair" : "compensation";
          if (state.detail?.recovery_action_id !== resolvesRecoveryActionId
            || state.detail?.action_type !== expectedActionType) {
            throw new KernelError(409, "RECOVERY_ACTION_BINDING_MISMATCH",
              "Verification must resolve the exact latest matching recovery action.");
          }
        }
        const activation = await client.query(
          `SELECT * FROM kernel_upgrade_activations WHERE installation_id=$1 AND environment_id=$2 AND upgrade_plan_id=$3`,
          [installationId, environmentId, upgradePlanId]
        );
        if (!activation.rows[0]) throw new KernelError(409, "UPGRADE_NOT_ACTIVE", "Upgrade activation record is missing.");
        if (actionType === "deployment_rollback") {
          if (plan.plan.repair.reversibility === "forward_only") {
            throw new KernelError(409, "FORWARD_ONLY_ROLLBACK_PROHIBITED", "Forward-only Upgrade Plans cannot use Deployment rollback.");
          }
          const boundary = plan.plan.repair.rollback_boundary;
          if (plan.plan.repair.reversibility === "conditionally_reversible") {
            if (!boundary || Date.parse(boundary.expires_at) <= Date.parse(acceptedAt)) {
              throw new KernelError(409, "ROLLBACK_BOUNDARY_EXPIRED", "Conditional rollback is outside its declared time boundary.");
            }
            if (!boundary.allowed_real_world_changes.includes(realWorldChange)) {
              throw new KernelError(409, "ROLLBACK_REALITY_OUTSIDE_BOUNDARY",
                "Observed real-world state is outside the declared rollback boundary.");
            }
          }
          if (state.state === "repair_required") {
            throw new KernelError(409, "UNRESOLVED_REAL_WORLD_CHANGE", "Deployment rollback remains blocked after an incompatible real-world change.");
          }
          const source = await deploymentService.getCapabilityActivation(activation.rows[0].source_activation_id, client);
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`package-admission:${source.package_version_id}`]);
          const retired = await client.query(
            `SELECT package_retirement_id FROM kernel_package_retirements
             WHERE installation_id=$1 AND environment_id=$2 AND package_version_id=$3`,
            [installationId, environmentId, source.package_version_id]
          );
          if (retired.rowCount > 0) throw new KernelError(409, "PACKAGE_VERSION_RETIRED", "A retired source Package cannot be reactivated.");
          const authorityState = await client.query(
            `SELECT * FROM kernel_capability_authority_states
             WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3 FOR UPDATE`,
            [installationId, environmentId, source.capability_key]
          );
          const currentRevision = Number(authorityState.rows[0]?.current_revision ?? -1);
          if (currentRevision < 0 || authorityState.rows[0].active_activation_id !== activation.rows[0].target_activation_id) {
            throw new KernelError(409, "UPGRADE_SOURCE_CHANGED", "Deployment rollback requires the exact target activation to remain active.");
          }
          const sourceCard = await deploymentService.getActionCard(source.deployment_id, source.capability_export_id, client);
          const rollbackApprovalId = randomUUID();
          const rollbackActivationId = randomUUID();
          await client.query(
            `INSERT INTO kernel_capability_business_approvals
             (business_approval_id,installation_id,environment_id,deployment_id,capability_key,capability_export_id,
              capability_export_digest,authority_digest,approved_against_revision,approved_by_principal_id,approved_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [rollbackApprovalId, installationId, environmentId, source.deployment_id, source.capability_key,
              source.capability_export_id, sourceCard.affected_objects.capability_export_digest,
              sourceCard.affected_objects.authority_digest, currentRevision, actor.id, acceptedAt]
          );
          await client.query(
            `INSERT INTO kernel_capability_activations
             (capability_activation_id,installation_id,environment_id,business_approval_id,deployment_id,package_version_id,
              capability_key,capability_export_id,capability_contract_version,capability_export_digest,authority_digest,
              from_revision,to_revision,activated_by_principal_id,activated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [rollbackActivationId, installationId, environmentId, rollbackApprovalId, source.deployment_id,
              source.package_version_id, source.capability_key, source.capability_export_id,
              source.capability_contract_version, sourceCard.affected_objects.capability_export_digest,
              sourceCard.affected_objects.authority_digest, currentRevision, currentRevision + 1, actor.id, acceptedAt]
          );
          const rolledBack = await client.query(
            `UPDATE kernel_capability_authority_states SET current_revision=$4,active_activation_id=$5,updated_at=$6
             WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3 AND current_revision=$7
              AND active_activation_id=$8`,
            [installationId, environmentId, source.capability_key, currentRevision + 1, rollbackActivationId,
              acceptedAt, currentRevision, activation.rows[0].target_activation_id]
          );
          if (rolledBack.rowCount !== 1) {
            throw new KernelError(409, "UPGRADE_SOURCE_CHANGED", "Deployment rollback requires the exact target activation to remain active.");
          }
          recoveryDetail.rollback_business_approval_id = rollbackApprovalId;
          recoveryDetail.rollback_activation_id = rollbackActivationId;
        }
        await client.query(
          `INSERT INTO kernel_upgrade_recovery_actions
           (upgrade_recovery_action_id,installation_id,environment_id,upgrade_plan_id,action_type,real_world_change,
            reference_digest,detail,attestation_signature,recorded_by_actor_id,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [recoveryActionId, installationId, environmentId, upgradePlanId, actionType, realWorldChange,
            referenceDigest, recoveryDetail, recoveryAttestation, actor.id, acceptedAt]
        );
        const nextState = actionType === "deployment_rollback" ? "rolled_back"
          : verificationAction ? "repair_verified" : realWorldChange === "incompatible" ? "repair_required" : state.state;
        if (nextState !== state.state) await setState(client, state, nextState,
          { recovery_action_id: recoveryActionId, action_type: actionType }, acceptedAt);
        return { aggregateType: "upgrade_recovery_action", aggregateId: recoveryActionId,
          transitionType: `kernel.upgrade.${actionType}`,
          transitionPayload: { upgrade_plan_id: upgradePlanId, real_world_change: realWorldChange },
          result: { upgrade_recovery_action: { upgrade_recovery_action_id: recoveryActionId,
            upgrade_plan_id: upgradePlanId, action_type: actionType, real_world_change: realWorldChange,
            reference_digest: referenceDigest, detail: recoveryDetail, attestation_signature: recoveryAttestation,
            resolves_recovery_action_id: resolvesRecoveryActionId,
            resulting_state: nextState, recorded_at: acceptedAt,
            immutable: true, history_preserved: true } } };
      }
    });
  }

  async function retirementStatus(upgradePlanId, client = pool) {
    const plan = await getUpgradePlan(uuid(upgradePlanId, "upgrade_plan_id"), client);
    const packageVersionId = plan.current_package_version_id;
    const counts = await client.query(
      `SELECT
        (SELECT count(*) FROM kernel_capability_authority_states s JOIN kernel_capability_activations a
          ON a.installation_id=s.installation_id AND a.environment_id=s.environment_id
           AND a.capability_activation_id=s.active_activation_id
          WHERE s.installation_id=$1 AND s.environment_id=$2 AND a.package_version_id=$3) AS consumers,
        (SELECT count(*) FROM kernel_runs r JOIN kernel_execution_envelopes e
          ON e.installation_id=r.installation_id AND e.environment_id=r.environment_id AND e.envelope_id=r.envelope_id
          JOIN kernel_run_states s ON s.installation_id=r.installation_id AND s.environment_id=r.environment_id AND s.run_id=r.run_id
          WHERE r.installation_id=$1 AND r.environment_id=$2 AND e.package_version_id=$3
           AND s.execution_status IN ('admitted','uncertain')) AS active_runs,
        (SELECT count(*) FROM kernel_evidence_records x JOIN kernel_runs r
          ON r.installation_id=x.installation_id AND r.environment_id=x.environment_id AND r.run_id=x.run_id
          JOIN kernel_execution_envelopes e ON e.installation_id=r.installation_id AND e.environment_id=r.environment_id
           AND e.envelope_id=r.envelope_id
          WHERE x.installation_id=$1 AND x.environment_id=$2 AND e.package_version_id=$3) AS evidence_records,
        (SELECT count(*) FROM kernel_recovery_cases x JOIN kernel_runs r
          ON r.installation_id=x.installation_id AND r.environment_id=x.environment_id AND r.run_id=x.run_id
          JOIN kernel_execution_envelopes e ON e.installation_id=r.installation_id AND e.environment_id=r.environment_id
           AND e.envelope_id=r.envelope_id
          WHERE x.installation_id=$1 AND x.environment_id=$2 AND e.package_version_id=$3) AS recovery_cases,
        (SELECT count(*) FROM kernel_operational_obligations o JOIN kernel_runs r
          ON r.installation_id=o.installation_id AND r.environment_id=o.environment_id AND r.run_id=o.run_id
          JOIN kernel_execution_envelopes e ON e.installation_id=r.installation_id AND e.environment_id=r.environment_id
           AND e.envelope_id=r.envelope_id
          WHERE o.installation_id=$1 AND o.environment_id=$2 AND e.package_version_id=$3 AND o.status='open') AS open_obligations,
        (SELECT count(*) FROM kernel_handoffs h WHERE h.installation_id=$1 AND h.environment_id=$2
          AND h.state='pending' AND h.exact_bindings->>'package_version_id'=($3::uuid)::text) AS pending_handoffs,
        (SELECT count(*) FROM kernel_upgrade_recovery_actions a JOIN kernel_upgrade_plans p
          ON p.installation_id=a.installation_id AND p.environment_id=a.environment_id AND p.upgrade_plan_id=a.upgrade_plan_id
          JOIN kernel_upgrade_plan_states s ON s.installation_id=p.installation_id AND s.environment_id=p.environment_id
           AND s.upgrade_plan_id=p.upgrade_plan_id
          WHERE a.installation_id=$1 AND a.environment_id=$2 AND p.current_package_version_id=$3
           AND s.state='repair_required') AS upgrade_recovery_records`,
      [installationId, environmentId, packageVersionId]
    );
    const row = counts.rows[0];
    const references = { consumers: Number(row.consumers), active_runs: Number(row.active_runs),
      evidence_records: Number(row.evidence_records), recovery_cases: Number(row.recovery_cases),
      open_obligations: Number(row.open_obligations), pending_handoffs: Number(row.pending_handoffs),
      upgrade_recovery_records: Number(row.upgrade_recovery_records),
      retention_until: plan.plan.retirement.retention_until };
    const blockers = retirementBlockers(references);
    return { upgrade_plan_id: upgradePlanId, package_version_id: packageVersionId, references, blockers,
      eligible: blockers.length === 0 };
  }

  async function retirePackage(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    exactKeys(envelope.input, "input", ["upgrade_plan_id"]);
    const upgradePlanId = uuid(envelope.input.upgrade_plan_id, "input.upgrade_plan_id");
    const retirementId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const plan = await getUpgradePlan(upgradePlanId, client);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`package-admission:${plan.current_package_version_id}`]);
        const status = await retirementStatus(upgradePlanId, client);
        if (!status.eligible) throw new KernelError(409, "PACKAGE_RETIREMENT_BLOCKED", "Old Package Version still has user-space references.",
          { blockers: status.blockers });
        const state = await stateFor(upgradePlanId, client, true);
        if (!new Set(["active", "rolled_back", "repair_verified"]).has(state.state)) {
          throw new KernelError(409, "UPGRADE_PHASE_MISMATCH", "Package retirement requires a completed activation decision.");
        }
        await client.query(
          `INSERT INTO kernel_package_retirements
           (package_retirement_id,installation_id,environment_id,upgrade_plan_id,package_version_id,reference_snapshot,
            approved_by_actor_id,retired_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [retirementId, installationId, environmentId, upgradePlanId, status.package_version_id,
            status.references, actor.id, acceptedAt]
        );
        await setState(client, state, "retired", { package_retirement_id: retirementId }, acceptedAt);
        return { aggregateType: "package_retirement", aggregateId: retirementId,
          transitionType: "kernel.package_version.retired", transitionPayload: { package_version_id: status.package_version_id },
          result: { package_retirement: { package_retirement_id: retirementId, upgrade_plan_id: upgradePlanId,
            package_version_id: status.package_version_id, reference_snapshot: status.references,
            retired_at: acceptedAt, immutable: true, artifacts_preserved: true } } };
      }
    });
  }

  return { createCompatibilityReport, getCompatibilityReport, createActivationPolicy, getActivationPolicy,
    createUpgradePlan, getUpgradePlan,
    startMigration, getMigrationRun, checkpointMigration, verifyMigration, evaluateCanary,
    activateUpgrade, recordRecoveryAction, retirementStatus, retirePackage };
}
