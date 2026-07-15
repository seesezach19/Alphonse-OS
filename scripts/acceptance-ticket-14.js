import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";

import { canonicalize, sha256Digest } from "../src/canonical-json.js";
import { deterministicCanaryAssignment } from "../src/upgrade-contracts.js";

const kernelUrl = "http://127.0.0.1:43114";
const installationId = "00000000-0000-4000-8000-00000000a001";
const environmentId = "00000000-0000-4000-8000-000000000001";
const agentToken = "ticket-14-runtime-agent-token-000000000001";
const headers = { "content-type": "application/json", authorization: "Bearer local-development-bootstrap-token" };
const agentHeaders = { "content-type": "application/json", authorization: `Agent ${agentToken}` };
const composeEnvironment = { ...process.env, COMPOSE_PROJECT_NAME: "alphonse-kernel-ticket-14-acceptance",
  KERNEL_PORT: "43114", POSTGRES_PORT: "45444" };
const ids = {
  packages: ["10000000-0000-4000-8000-000000000141", "10000000-0000-4000-8000-000000000142",
    "10000000-0000-4000-8000-000000000143"],
  plans: ["20000000-0000-4000-8000-000000000141", "20000000-0000-4000-8000-000000000142",
    "20000000-0000-4000-8000-000000000143"],
  deployments: ["30000000-0000-4000-8000-000000000141", "30000000-0000-4000-8000-000000000142",
    "30000000-0000-4000-8000-000000000143"],
  reviews: ["40000000-0000-4000-8000-000000000141", "40000000-0000-4000-8000-000000000142",
    "40000000-0000-4000-8000-000000000143"],
  sourceApproval: "50000000-0000-4000-8000-000000000141",
  sourceActivation: "60000000-0000-4000-8000-000000000141",
  workIntent: "70000000-0000-4000-8000-000000000141",
  delegation: "71000000-0000-4000-8000-000000000141",
  handoff: "72000000-0000-4000-8000-000000000141",
  grant: "73000000-0000-4000-8000-000000000141",
  receipt: "74000000-0000-4000-8000-000000000141",
  envelope: "75000000-0000-4000-8000-000000000141",
  run: "76000000-0000-4000-8000-000000000141"
};

function compose(...args) {
  const result = spawnSync("docker", ["compose", ...args], { cwd: new URL("..", import.meta.url),
    env: composeEnvironment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000,
    windowsHide: true });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

function psql(sql) {
  const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "alphonse", "-d",
    "alphonse_kernel", "-v", "ON_ERROR_STOP=1"], { cwd: new URL("..", import.meta.url), env: composeEnvironment,
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  if (result.status !== 0) throw new Error(`fixture SQL failed\n${result.stdout}\n${result.stderr}`);
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function json(value) {
  return sql(JSON.stringify(value));
}

async function request(path, options = {}) {
  const response = await fetch(`${kernelUrl}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}

async function post(path, value, agent = false) {
  return request(path, { method: "POST", headers: agent ? agentHeaders : headers, body: JSON.stringify(value) });
}

function command(commandId, operationId, input = {}) {
  return { command_id: commandId, operation_id: operationId, input };
}

function migrationSign(document) {
  return `hmac-sha256:${createHmac("sha256", "local-data-plane-receipt-secret")
    .update(canonicalize(document)).digest("hex")}`;
}

async function healthy() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${kernelUrl}/healthz`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Ticket 14 Kernel did not become healthy.");
}

function candidate(version, requiredLocation = false) {
  const schema = { type: "object", required: ["source", "sku", "quantity", "observed_at"], properties: {
    source: { type: "string" }, sku: { type: "string" }, quantity: { type: "integer" },
    observed_at: { type: "string", format: "date-time" }, location: { type: "string" }
  } };
  if (requiredLocation) schema.required.push("location");
  return { schema_version: "alphonse.package_candidate.v0.1",
    identity: { package_id: "com.alphonse.inventory", version, name: "Inventory Operations", summary: "Governed inventory operations." },
    compatibility: { kernel_api: ">=0.1 <0.2" }, dependencies: [], exports: [
      { kind: "schema", export_id: "inventory_observation", contract_version: requiredLocation ? "2.0.0" : "1.0.0", content: schema },
      { kind: "skill", export_id: "compare_inventory", contract_version: "1.0.0", content: {
        program: { discrepancy: { "-": [{ var: "erp_quantity" }, { var: "storefront_quantity" }] },
          correction_required: { "!==": [{ var: "erp_quantity" }, { var: "storefront_quantity" }] } },
        output_schema: { type: "object", required: ["discrepancy", "correction_required"] }
      } },
      { kind: "adapter", export_id: "storefront_inventory_adapter", contract_version: "1.0.0", content: {
        operations: ["set_storefront_inventory"], operation_effects: {
          set_storefront_inventory: { target: "inventory", action: "set_quantity" }
        }
      } },
      { kind: "accountability_contract", export_id: "inventory_accountability", contract_version: "1.0.0", content: {
        outcome: "inventory result is linked to source observations",
        evidence_requirements: ["signed source links", "typed discrepancy result"], deadline_seconds: 300,
        escalation: { on_timeout: "operator_review" }, recovery: { on_failure: "readmission_required" }
      } },
      { kind: "capability", export_id: "inventory_correction", contract_version: "1.0.0", content: {
        effect_class: "external_write", supported_operations: ["set_storefront_inventory"],
        evidence: { required: ["signed source links", "typed discrepancy result"] },
        recovery: { strategy: "restore_previous_quantity", uncertainty: "reconcile_before_retry" },
        accountability_contract_ref: "inventory_accountability", adapter_ref: "storefront_inventory_adapter"
      } }
    ] };
}

function deploymentPlan(packageId, packageVersion, maxItems) {
  const credential = { binding_ref: "credential://storefront-writer", revision: "writer-rev-1",
    scopes: ["storefront.inventory.write"] };
  const adapterBinding = { adapter_export_id: "storefront_inventory_adapter",
    binding_ref: "adapter://storefront-inventory", contract_version: "1.0.0" };
  const contextBinding = { sources: ["erp", "storefront"], authority: ["authoritative", "representational"],
    max_age_seconds: 300 };
  const effectLimits = [{ system: "storefront", target: "inventory", action: "set_quantity", max_items: maxItems }];
  return { schema_version: "alphonse.deployment_plan.v0.1", work_intent_id: ids.workIntent,
    package: { package_version_id: packageId, package_id: "com.alphonse.inventory", semantic_version: packageVersion },
    dependency_lock: [], extension_bindings: [],
    configuration_binding: { schema_export_id: "inventory_observation", redacted_values: {}, credential_bindings: [credential] },
    adapter_bindings: [adapterBinding], capability_candidates: [{ capability_export_id: "inventory_correction",
      context_binding: contextBinding, credential_binding_ref: credential.binding_ref, effect_limits: effectLimits }] };
}

function compositionDigest(plan) {
  return sha256Digest({ package: plan.package, dependency_lock: plan.dependency_lock,
    extension_bindings: plan.extension_bindings, configuration_binding: plan.configuration_binding,
    adapter_bindings: plan.adapter_bindings, capability_candidates: plan.capability_candidates });
}

function packageFixture(packageVersionId, value, publishedAt) {
  const normalizedExports = value.exports.map((entry) => ({ kind: entry.kind, export_id: entry.export_id,
    contract_version: entry.contract_version, export_digest: sha256Digest(entry.content) }));
  const artifactDigest = sha256Digest(value);
  const manifestDigest = sha256Digest({ schema_version: value.schema_version, identity: value.identity,
    compatibility: value.compatibility, dependencies: value.dependencies, exports: normalizedExports });
  const dependencyDigest = sha256Digest(value.dependencies);
  const publication = { installation_id: installationId, environment_id: environmentId,
    package_version_id: packageVersionId, package_id: value.identity.package_id,
    semantic_version: value.identity.version, artifact_digest: artifactDigest, manifest_digest: manifestDigest,
    dependency_digest: dependencyDigest, canonicalization_version: "canonical-json.v0.1", normalized_exports: normalizedExports,
    build_session_id: "81000000-0000-4000-8000-000000000141",
    validation_receipt_id: "82000000-0000-4000-8000-000000000141",
    simulation_receipt_ids: ["83000000-0000-4000-8000-000000000141"], toolkit_digest: sha256Digest("ticket-14-toolkit"),
    publisher_principal_id: "84000000-0000-4000-8000-000000000141", validator_version: "fixture-v0.1",
    publication_key_id: "local-package-signing-key-v1", published_at: publishedAt };
  return { candidate: value, normalizedExports, ...publication,
    signature: `hmac-sha256:${createHmac("sha256", "local-package-signing-secret").update(canonicalize(publication)).digest("hex")}` };
}

function authorityFixture(packageFixtureValue, plan, deploymentId, deploymentPlanId, planDigest) {
  const capability = packageFixtureValue.candidate.exports.find((entry) => entry.kind === "capability");
  const adapter = packageFixtureValue.candidate.exports.find((entry) => entry.kind === "adapter");
  const accountability = packageFixtureValue.candidate.exports.find((entry) => entry.kind === "accountability_contract");
  const candidatePlan = plan.capability_candidates[0];
  const credential = plan.configuration_binding.credential_bindings[0];
  const adapterBinding = plan.adapter_bindings[0];
  const contract = { deployment_id: deploymentId, deployment_plan_id: deploymentPlanId, plan_digest: planDigest,
    package_version_id: packageFixtureValue.package_version_id, package_artifact_digest: packageFixtureValue.artifact_digest,
    capability_key: "com.alphonse.inventory/inventory_correction", capability_export_id: capability.export_id,
    capability_contract_version: capability.contract_version, capability_export_digest: sha256Digest(capability.content),
    configuration_binding: plan.configuration_binding, adapter_binding: adapterBinding,
    context_binding: candidatePlan.context_binding, credential_binding: credential, effect_limits: candidatePlan.effect_limits,
    evidence: capability.content.evidence, recovery: capability.content.recovery, accountability_contract: accountability.content };
  assert.equal(adapter.export_id, adapterBinding.adapter_export_id);
  return { capabilityDigest: sha256Digest(capability.content), authorityDigest: sha256Digest(contract) };
}

function seed({ humanId, agentId, passportId }) {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  const packageValues = [candidate("1.0.0", false), candidate("2.0.0", true), candidate("2.1.0", true)];
  const packages = packageValues.map((value, index) => packageFixture(ids.packages[index], value, now));
  const plans = [deploymentPlan(ids.packages[0], "1.0.0", 1), deploymentPlan(ids.packages[1], "2.0.0", 1),
    deploymentPlan(ids.packages[2], "2.1.0", 5)];
  const planDigests = plans.map((plan) => sha256Digest(plan));
  const authorities = packages.map((value, index) => authorityFixture(value, plans[index], ids.deployments[index],
    ids.plans[index], planDigests[index]));
  const statements = ["SET session_replication_role=replica"];
  for (let index = 0; index < packages.length; index += 1) {
    const value = packages[index];
    statements.push(`INSERT INTO kernel_package_versions
      (package_version_id,installation_id,environment_id,package_id,semantic_version,artifact_digest,manifest_digest,
       dependency_digest,canonicalization_version,candidate,normalized_exports,build_session_id,validation_receipt_id,
       simulation_receipt_ids,toolkit_digest,publisher_principal_id,validator_version,publication_key_id,publication_signature,published_at)
      VALUES (${sql(value.package_version_id)},${sql(installationId)},${sql(environmentId)},${sql(value.package_id)},
       ${sql(value.semantic_version)},${sql(value.artifact_digest)},${sql(value.manifest_digest)},${sql(value.dependency_digest)},
       ${sql(value.canonicalization_version)},${json(value.candidate)},${json(value.normalizedExports)},${sql(value.build_session_id)},
       ${sql(value.validation_receipt_id)},${json(value.simulation_receipt_ids)},${sql(value.toolkit_digest)},
       ${sql(value.publisher_principal_id)},${sql(value.validator_version)},${sql(value.publication_key_id)},
       ${sql(value.signature)},${sql(value.published_at)})`);
    statements.push(`INSERT INTO kernel_deployment_plans
      (deployment_plan_id,installation_id,environment_id,package_version_id,work_intent_id,validation_receipt_id,
       plan_digest,composition_digest,plan,created_by_principal_id,created_at)
      VALUES (${sql(ids.plans[index])},${sql(installationId)},${sql(environmentId)},${sql(ids.packages[index])},
       ${sql(ids.workIntent)},${sql(`85000000-0000-4000-8000-00000000014${index + 1}`)},${sql(planDigests[index])},
       ${sql(compositionDigest(plans[index]))},${json(plans[index])},${sql(humanId)},${sql(now)})`);
    statements.push(`INSERT INTO kernel_deployments
      (deployment_id,installation_id,environment_id,deployment_plan_id,technical_review_id,package_version_id,
       work_intent_id,plan_digest,composition_digest,state,staged_by_principal_id,staged_at)
      VALUES (${sql(ids.deployments[index])},${sql(installationId)},${sql(environmentId)},${sql(ids.plans[index])},
       ${sql(ids.reviews[index])},${sql(ids.packages[index])},${sql(ids.workIntent)},${sql(planDigests[index])},
       ${sql(compositionDigest(plans[index]))},'staged',${sql(humanId)},${sql(now)})`);
  }
  statements.push(`INSERT INTO kernel_capability_business_approvals
    (business_approval_id,installation_id,environment_id,deployment_id,capability_key,capability_export_id,
     capability_export_digest,authority_digest,approved_against_revision,approved_by_principal_id,approved_at)
    VALUES (${sql(ids.sourceApproval)},${sql(installationId)},${sql(environmentId)},${sql(ids.deployments[0])},
     'com.alphonse.inventory/inventory_correction','inventory_correction',${sql(authorities[0].capabilityDigest)},
     ${sql(authorities[0].authorityDigest)},0,${sql(humanId)},${sql(now)})`,
  `INSERT INTO kernel_capability_activations
    (capability_activation_id,installation_id,environment_id,business_approval_id,deployment_id,package_version_id,
     capability_key,capability_export_id,capability_contract_version,capability_export_digest,authority_digest,
     from_revision,to_revision,activated_by_principal_id,activated_at)
    VALUES (${sql(ids.sourceActivation)},${sql(installationId)},${sql(environmentId)},${sql(ids.sourceApproval)},
     ${sql(ids.deployments[0])},${sql(ids.packages[0])},'com.alphonse.inventory/inventory_correction','inventory_correction',
     '1.0.0',${sql(authorities[0].capabilityDigest)},${sql(authorities[0].authorityDigest)},0,1,${sql(humanId)},${sql(now)})`,
  `INSERT INTO kernel_capability_authority_states
    (installation_id,environment_id,capability_key,current_revision,active_activation_id,updated_at)
    VALUES (${sql(installationId)},${sql(environmentId)},'com.alphonse.inventory/inventory_correction',1,
     ${sql(ids.sourceActivation)},${sql(now)})`);

  const observations = [{ source: "erp", subject: "SKU-14", quantity: 24, observed_at: now },
    { source: "storefront", subject: "SKU-14", quantity: 18, observed_at: now }]
    .map((item) => ({ ...item, item_hash: sha256Digest({ source: item.source, sku: item.subject,
      quantity: item.quantity, observed_at: item.observed_at }) }));
  const references = observations.map((item) => ({ source: item.source, subject: item.subject,
    release_id: `${item.source}-release-14`, item_hash: item.item_hash, observed_at: item.observed_at }));
  const skill = packages[0].candidate.exports.find((entry) => entry.kind === "skill");
  const evidenceRequirements = ["signed source links", "typed discrepancy result"];
  statements.push(`INSERT INTO kernel_delegations
    (delegation_id,installation_id,environment_id,handoff_id,work_intent_id,source_passport_id,target_passport_id,
     target_agent_principal_id,scope,valid_from,expires_at)
    VALUES (${sql(ids.delegation)},${sql(installationId)},${sql(environmentId)},${sql(ids.handoff)},${sql(ids.workIntent)},
     ${sql(passportId)},${sql(passportId)},${sql(agentId)},'{}',${sql(now)},${sql(future)})`,
  `INSERT INTO kernel_context_access_grants
    (grant_id,installation_id,environment_id,passport_id,work_intent_id,agent_principal_id,purpose,subjects,sources,
     sensitivity_classes,max_items,max_age_seconds,expires_at,issued_by_principal_id,issued_at,delegation_id)
    VALUES (${sql(ids.grant)},${sql(installationId)},${sql(environmentId)},${sql(passportId)},${sql(ids.workIntent)},
     ${sql(agentId)},'complete pinned inventory run','["SKU-14"]','["erp","storefront"]','["operational"]',2,300,
     ${sql(future)},${sql(humanId)},${sql(now)},${sql(ids.delegation)})`,
  `INSERT INTO kernel_context_receipts
    (receipt_id,installation_id,environment_id,grant_id,data_plane_id,recipient_principal_id,packet_hash,item_references,
     authority_claims,freshness_claims,provenance,limitations,delivered_at,signature)
    VALUES (${sql(ids.receipt)},${sql(installationId)},${sql(environmentId)},${sql(ids.grant)},'ticket-14-data-plane',
     ${sql(agentId)},${sql(sha256Digest(references))},${json(references)},'["authoritative","representational"]',
     ${json(references.map((item) => ({ source: item.source, observed_at: item.observed_at })))},'{}','{}',${sql(now)},
     ${sql(`hmac-sha256:${"a".repeat(64)}`)})`,
  `INSERT INTO kernel_execution_envelopes
    (envelope_id,installation_id,environment_id,idempotency_key,admission_digest,envelope_digest,passport_id,
     agent_principal_id,work_intent_id,delegation_id,capability_activation_id,package_version_id,skill_binding,
     context_receipt_ids,limits,evidence_requirements,expires_at,admitted_at)
    VALUES (${sql(ids.envelope)},${sql(installationId)},${sql(environmentId)},'ticket-14-pinned-run',
     ${sql(sha256Digest("admission"))},${sql(sha256Digest("envelope"))},${sql(passportId)},${sql(agentId)},
     ${sql(ids.workIntent)},${sql(ids.delegation)},${sql(ids.sourceActivation)},${sql(ids.packages[0])},
     ${json({ export_id: skill.export_id, contract_version: skill.contract_version, export_digest: sha256Digest(skill.content) })},
     ${json([ids.receipt])},${json({ subjects: ["SKU-14"], sources: ["erp", "storefront"], max_items: 2,
       max_context_age_seconds: 300 })},${json(evidenceRequirements)},${sql(future)},${sql(now)})`,
  `INSERT INTO kernel_runs (run_id,installation_id,environment_id,envelope_id,created_at)
    VALUES (${sql(ids.run)},${sql(installationId)},${sql(environmentId)},${sql(ids.envelope)},${sql(now)})`,
  `INSERT INTO kernel_run_states
    (installation_id,environment_id,run_id,execution_status,accountability_status,updated_at)
    VALUES (${sql(installationId)},${sql(environmentId)},${sql(ids.run)},'admitted','pending',${sql(now)})`);
  evidenceRequirements.forEach((requirement, index) => statements.push(`INSERT INTO kernel_operational_obligations
    (obligation_id,installation_id,environment_id,run_id,obligation_key,requirement,status,deadline_at,created_at)
    VALUES (${sql(`77000000-0000-4000-8000-00000000014${index + 1}`)},${sql(installationId)},${sql(environmentId)},
     ${sql(ids.run)},${sql(`evidence-${index + 1}`)},${sql(requirement)},'open',${sql(future)},${sql(now)})`));
  statements.push("SET session_replication_role=origin");
  psql(`${statements.join(";\n")};`);
  return { observations, authorities };
}

function planInput(reportId, preapprovalPolicyId, suffix) {
  return { compatibility_report_id: reportId,
    migration: { declaration_version: `ticket-14-${suffix}`, scope: "package_owned_indexes",
      checkpoints: [{ name: "expand", invariants: ["source_unchanged", "target_isolated"] },
        { name: "backfill", invariants: ["counts_match", "references_valid"] }] },
    canary: { seed: `ticket-14-${suffix}-cohort`, basis_points: 5000, gates: ["health", "evidence"] },
    verification: { criteria: ["counts_match", "resume_proven", "zero_undeclared_effects"] },
    repair: { reversibility: "conditionally_reversible", strategy: "compensate_after_external_change",
      rollback_boundary: { allowed_real_world_changes: ["none", "compatible"],
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString() } },
    retention_until: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    ...(preapprovalPolicyId ? { preapproval_policy_id: preapprovalPolicyId } : {}) };
}

async function migrateAndCanary(planId, suffix, restart = false) {
  const started = await post("/kernel/v0/upgrade-migrations", command(`t14-${suffix}-migration-start`,
    "kernel.upgrade.migration_start", { upgrade_plan_id: planId }));
  assert.equal(started.response.status, 201, JSON.stringify(started.body));
  const migrationId = started.body.migration_run.migration_run_id;
  const checkpoint = async (ordinal, name, invariants) => {
    const document = {
      migration_run_id: migrationId,
      checkpoint_ordinal: ordinal, checkpoint_name: name, input_digest: sha256Digest({ suffix, ordinal, side: "in" }),
      output_digest: sha256Digest({ suffix, ordinal, side: "out" }), source_count: 2, target_count: 2, invariants
    };
    const { migration_run_id: _migrationRunId, ...checkpointInput } = document;
    return post(`/kernel/v0/upgrade-migrations/${migrationId}/checkpoints`,
      command(`t14-${suffix}-checkpoint-${ordinal}`, "kernel.upgrade.migration_checkpoint",
        { ...checkpointInput, attestation_signature: migrationSign(document) }));
  };
  const firstCheckpoint = await checkpoint(0, "expand", { source_unchanged: true, target_isolated: true });
  assert.equal(firstCheckpoint.response.status, 201, JSON.stringify(firstCheckpoint.body));
  if (restart) {
    compose("stop", "kernel");
    compose("up", "-d", "--wait", "kernel");
    await healthy();
    const resumed = await request(`/kernel/v0/upgrade-migrations/${migrationId}`);
    assert.equal(resumed.body.migration_run.next_checkpoint, 1);
  }
  const secondCheckpoint = await checkpoint(1, "backfill", { counts_match: true, references_valid: true });
  assert.equal(secondCheckpoint.response.status, 201, JSON.stringify(secondCheckpoint.body));
  const criteria = { counts_match: true, resume_proven: true, zero_undeclared_effects: true };
  const verificationDocument = { migration_run_id: migrationId, criteria,
    checkpoint_digests: [firstCheckpoint.body.migration_checkpoint.checkpoint_digest,
      secondCheckpoint.body.migration_checkpoint.checkpoint_digest] };
  const verified = await post(`/kernel/v0/upgrade-migrations/${migrationId}/verify`, command(`t14-${suffix}-verify`,
    "kernel.upgrade.migration_verify", { criteria, attestation_signature: migrationSign(verificationDocument) }));
  assert.equal(verified.response.status, 201, JSON.stringify(verified.body));
  if (restart) {
    psql(`SET session_replication_role=replica;
      UPDATE kernel_upgrade_migration_verifications SET attestation_signature =
       'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000'
       WHERE migration_run_id=${sql(migrationId)};
      SET session_replication_role=origin;`);
    const reverified = await post(`/kernel/v0/upgrade-migrations/${migrationId}/verify`, command(
      `t14-${suffix}-reverify`, "kernel.upgrade.migration_verify",
      { criteria, attestation_signature: migrationSign(verificationDocument) }));
    assert.equal(reverified.response.status, 201, JSON.stringify(reverified.body));
  }
  const routingKeys = ["customer-1", "customer-2"];
  const assignments = routingKeys.map((routingKey) => deterministicCanaryAssignment(
    `ticket-14-${suffix}-cohort`, routingKey, 5000));
  const assignmentDigest = sha256Digest({ seed_digest: sha256Digest(`ticket-14-${suffix}-cohort`),
    basis_points: 5000, assignments });
  const gate = (attemptNumber, gateId, passed, evidenceDigest) => {
    const receipt = { upgrade_plan_id: planId, attempt_number: attemptNumber, assignment_digest: assignmentDigest,
      gate_id: gateId, passed, evidence_digest: evidenceDigest };
    return { gate_id: gateId, passed, evidence_digest: evidenceDigest,
      attestation_signature: migrationSign(receipt) };
  };
  const mismatchedCohort = await post("/kernel/v0/upgrade-canary-attempts", command(
    `t14-${suffix}-canary-cohort-mismatch`, "kernel.upgrade.canary_evaluate", { upgrade_plan_id: planId,
      attempt_number: 1, routing_keys: routingKeys, assignment_digest: sha256Digest("wrong-cohort"),
      gate_results: [gate(1, "health", true, sha256Digest(`${suffix}-health-mismatch`)),
        gate(1, "evidence", true, sha256Digest(`${suffix}-evidence-mismatch`))] }));
  assert.equal(mismatchedCohort.response.status, 409);
  assert.equal(mismatchedCohort.body.error.code, "CANARY_ASSIGNMENT_MISMATCH");
  const failed = await post("/kernel/v0/upgrade-canary-attempts", command(`t14-${suffix}-canary-fail`,
    "kernel.upgrade.canary_evaluate", { upgrade_plan_id: planId, attempt_number: 1,
      routing_keys: routingKeys, assignment_digest: assignmentDigest,
      gate_results: [gate(1, "health", true, sha256Digest(`${suffix}-health-1`)),
        gate(1, "evidence", false, sha256Digest(`${suffix}-evidence-1`))] }));
  assert.equal(failed.response.status, 201, JSON.stringify(failed.body));
  assert.equal(failed.body.canary_attempt.outcome, "paused");
  const passed = await post("/kernel/v0/upgrade-canary-attempts", command(`t14-${suffix}-canary-pass`,
    "kernel.upgrade.canary_evaluate", { upgrade_plan_id: planId, attempt_number: 2,
      routing_keys: routingKeys, assignment_digest: assignmentDigest,
      gate_results: [gate(2, "health", true, sha256Digest(`${suffix}-health-2`)),
        gate(2, "evidence", true, sha256Digest(`${suffix}-evidence-2`))] }));
  assert.equal(passed.response.status, 201, JSON.stringify(passed.body));
  assert.equal(passed.body.canary_attempt.outcome, "passed");
  assert.equal(passed.body.canary_attempt.assignment_digest, failed.body.canary_attempt.assignment_digest);
  assert.equal(JSON.stringify(passed.body.canary_attempt.assignment_receipt).includes("customer-1"), false);
}

async function main() {
  compose("down", "-v", "--remove-orphans");
  compose("up", "-d", "--build", "--wait", "postgres", "kernel");
  await healthy();
  const human = await post("/kernel/v0/principals", command("t14-human", "kernel.principal.create",
    { principal_type: "human", display_name: "Upgrade Operator" }));
  assert.equal(human.response.status, 201, JSON.stringify(human.body));
  const agent = await post("/kernel/v0/principals", command("t14-agent", "kernel.principal.create",
    { principal_type: "agent", display_name: "Pinned Runtime" }));
  assert.equal(agent.response.status, 201);
  const passport = await post("/kernel/v0/agent-passports", command("t14-passport", "kernel.agent_passport.issue", {
    agent_principal_id: agent.body.principal.principal_id, sponsor_principal_id: human.body.principal.principal_id,
    runtime: { kind: "docker", version: "ticket-14" }, model_configuration: { provider: "openai", model: "frontier" },
    package_skill_configuration: { runtime_toolkit: "ticket-14" }, agent_authentication_token: agentToken,
    permitted_intent_classes: ["runtime_execution"], provenance: { source: "ticket-14-acceptance" },
    valid_from: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
  }));
  assert.equal(passport.response.status, 201, JSON.stringify(passport.body));
  const fixture = seed({ humanId: human.body.principal.principal_id, agentId: agent.body.principal.principal_id,
    passportId: passport.body.passport.passport_id });

  const reportResult = await post("/kernel/v0/upgrade-compatibility-reports", command("t14-report-v2",
    "kernel.upgrade.compatibility_analyze", { current_deployment_id: ids.deployments[0],
      target_deployment_id: ids.deployments[1], capability_export_id: "inventory_correction" }));
  assert.equal(reportResult.response.status, 201, JSON.stringify(reportResult.body));
  const report = reportResult.body.compatibility_report;
  assert.equal(report.report.classification, "parallel_major_required");
  assert.equal(report.report.breaking_install_strategy, "side_by_side");
  assert.equal(report.report.authority_equivalent, true);
  assert.deepEqual(report.report.active_run_ids, [ids.run]);
  const reportReplay = await post("/kernel/v0/upgrade-compatibility-reports", command("t14-report-v2",
    "kernel.upgrade.compatibility_analyze", { current_deployment_id: ids.deployments[0],
      target_deployment_id: ids.deployments[1], capability_export_id: "inventory_correction" }));
  assert.equal(reportReplay.response.status, 200);
  assert.equal(reportReplay.body.compatibility_report.compatibility_report_id, report.compatibility_report_id);
  assert.equal((await request(`/kernel/v0/package-versions/${ids.packages[0]}`)).response.status, 200);
  assert.equal((await request(`/kernel/v0/package-versions/${ids.packages[1]}`)).response.status, 200);

  const policyResult = await post("/kernel/v0/upgrade-activation-policies", command("t14-policy-v2",
    "kernel.upgrade.activation_policy_create", { compatibility_report_id: report.compatibility_report_id,
      rationale: "Preapprove the exact authority-equivalent v2 report.",
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString() }));
  assert.equal(policyResult.response.status, 201, JSON.stringify(policyResult.body));
  const policyId = policyResult.body.upgrade_activation_policy.upgrade_activation_policy_id;
  assert.equal((await request(`/kernel/v0/upgrade-activation-policies/${policyId}`)).response.status, 200);
  const planResult = await post("/kernel/v0/upgrade-plans", command("t14-plan-v2", "kernel.upgrade.plan_create",
    planInput(report.compatibility_report_id, policyId, "v2")));
  assert.equal(planResult.response.status, 201, JSON.stringify(planResult.body));
  const planId = planResult.body.upgrade_plan.upgrade_plan_id;
  assert.equal(planResult.body.upgrade_plan.plan.in_flight_runs.policy, "pin_original_exact_versions");
  await migrateAndCanary(planId, "v2", true);
  const activated = await post("/kernel/v0/upgrade-activations", command("t14-activate-v2", "kernel.upgrade.activate",
    { upgrade_plan_id: planId }));
  assert.equal(activated.response.status, 201, JSON.stringify(activated.body));
  assert.equal(activated.body.upgrade_activation.approval_basis, "preapproved_authority_equivalent");
  const pinnedBeforeCompletion = await request(`/kernel/v0/runs/${ids.run}`);
  assert.equal(pinnedBeforeCompletion.body.run.execution_status, "admitted");
  const complete = await post(`/kernel/v0/runs/${ids.run}/complete-comparison`, command("t14-complete-pinned-run",
    "kernel.run.complete_comparison", { run_id: ids.run, envelope_id: ids.envelope,
      observations: fixture.observations, output: { discrepancy: 6, correction_required: true } }), true);
  assert.equal(complete.response.status, 201, JSON.stringify(complete.body));
  assert.equal(complete.body.evidence_record.package_version_id, ids.packages[0]);
  assert.equal(complete.body.evidence_record.skill_binding.contract_version, "1.0.0");

  const changedReportResult = await post("/kernel/v0/upgrade-compatibility-reports", command("t14-report-v3",
    "kernel.upgrade.compatibility_analyze", { current_deployment_id: ids.deployments[1],
      target_deployment_id: ids.deployments[2], capability_export_id: "inventory_correction" }));
  assert.equal(changedReportResult.response.status, 201, JSON.stringify(changedReportResult.body));
  assert.equal(changedReportResult.body.compatibility_report.report.authority_equivalent, false);
  const changedPlanResult = await post("/kernel/v0/upgrade-plans", command("t14-plan-v3", "kernel.upgrade.plan_create",
    planInput(changedReportResult.body.compatibility_report.compatibility_report_id, null, "v3")));
  const changedPlanId = changedPlanResult.body.upgrade_plan.upgrade_plan_id;
  await migrateAndCanary(changedPlanId, "v3", false);
  const blockedActivation = await post("/kernel/v0/upgrade-activations", command("t14-activate-v3-blocked",
    "kernel.upgrade.activate", { upgrade_plan_id: changedPlanId }));
  assert.equal(blockedActivation.response.status, 409);
  assert.equal(blockedActivation.body.error.code, "FRESH_BUSINESS_APPROVAL_REQUIRED");
  const actionCard = (await request(`/kernel/v0/deployments/${ids.deployments[2]}/capabilities/inventory_correction/action-card`)).body.action_card;
  const approval = await post("/kernel/v0/capability-business-approvals", command("t14-v3-fresh-approval",
    "kernel.capability.business_approve", { deployment_id: ids.deployments[2], capability_export_id: "inventory_correction",
      capability_export_digest: actionCard.affected_objects.capability_export_digest,
      authority_digest: actionCard.affected_objects.authority_digest, action_card_digest: actionCard.action_card_digest,
      expected_revision: actionCard.current_revision }));
  assert.equal(approval.response.status, 201, JSON.stringify(approval.body));
  const changedActivation = await post("/kernel/v0/upgrade-activations", command("t14-activate-v3",
    "kernel.upgrade.activate", { upgrade_plan_id: changedPlanId,
      business_approval_id: approval.body.business_approval.business_approval_id }));
  assert.equal(changedActivation.response.status, 201, JSON.stringify(changedActivation.body));
  assert.equal(changedActivation.body.upgrade_activation.approval_basis, "fresh_business_approval");

  const falseRollback = await post("/kernel/v0/upgrade-recovery-actions", command("t14-false-rollback",
    "kernel.upgrade.recovery_record", { upgrade_plan_id: changedPlanId, action_type: "deployment_rollback",
      real_world_change: "incompatible", reference_digest: sha256Digest("incompatible-world"), detail: { reason: "writes changed schema" } }));
  assert.equal(falseRollback.response.status, 409);
  assert.equal(falseRollback.body.error.code, "FALSE_ROLLBACK_PROHIBITED");
  const rollbackReceipt = { upgrade_plan_id: changedPlanId, action_type: "deployment_rollback",
    real_world_change: "compatible", reference_digest: sha256Digest("pre-cutover-compatible"),
    detail: { reason: "software-only regression" } };
  const rollback = await post("/kernel/v0/upgrade-recovery-actions", command("t14-compatible-rollback",
    "kernel.upgrade.recovery_record", { ...rollbackReceipt, attestation_signature: migrationSign(rollbackReceipt) }));
  assert.equal(rollback.response.status, 201, JSON.stringify(rollback.body));
  assert.equal(rollback.body.upgrade_recovery_action.history_preserved, true);
  assert.notEqual(rollback.body.upgrade_recovery_action.detail.rollback_activation_id,
    changedActivation.body.upgrade_activation.source_activation_id);

  const retryReport = await post("/kernel/v0/upgrade-compatibility-reports", command("t14-report-v3-retry",
    "kernel.upgrade.compatibility_analyze", { current_deployment_id: ids.deployments[1],
      target_deployment_id: ids.deployments[2], capability_export_id: "inventory_correction" }));
  assert.equal(retryReport.response.status, 201, JSON.stringify(retryReport.body));
  const retryPlan = await post("/kernel/v0/upgrade-plans", command("t14-plan-v3-retry", "kernel.upgrade.plan_create",
    planInput(retryReport.body.compatibility_report.compatibility_report_id, null, "v3-retry")));
  const retryPlanId = retryPlan.body.upgrade_plan.upgrade_plan_id;
  await migrateAndCanary(retryPlanId, "v3-retry", false);
  const retryCard = (await request(`/kernel/v0/deployments/${ids.deployments[2]}/capabilities/inventory_correction/action-card`)).body.action_card;
  const retryApproval = await post("/kernel/v0/capability-business-approvals", command("t14-v3-retry-approval",
    "kernel.capability.business_approve", { deployment_id: ids.deployments[2], capability_export_id: "inventory_correction",
      capability_export_digest: retryCard.affected_objects.capability_export_digest,
      authority_digest: retryCard.affected_objects.authority_digest, action_card_digest: retryCard.action_card_digest,
      expected_revision: retryCard.current_revision }));
  assert.equal(retryApproval.response.status, 201, JSON.stringify(retryApproval.body));
  const retryActivation = await post("/kernel/v0/upgrade-activations", command("t14-activate-v3-retry",
    "kernel.upgrade.activate", { upgrade_plan_id: retryPlanId,
      business_approval_id: retryApproval.body.business_approval.business_approval_id }));
  assert.equal(retryActivation.response.status, 201, JSON.stringify(retryActivation.body));
  const unboundForwardRepair = await post("/kernel/v0/upgrade-recovery-actions", command("t14-unbound-forward-repair",
    "kernel.upgrade.recovery_record", { upgrade_plan_id: retryPlanId, action_type: "forward_repair",
      real_world_change: "incompatible", reference_digest: sha256Digest("repair-plan"), detail: { plan: "normalize new records" } }));
  assert.equal(unboundForwardRepair.response.status, 409);
  assert.equal(unboundForwardRepair.body.error.code, "FORWARD_REPAIR_BINDING_REQUIRED");
  const repair = await post("/kernel/v0/upgrade-recovery-actions", command("t14-compensation",
    "kernel.upgrade.recovery_record", { upgrade_plan_id: retryPlanId, action_type: "compensation",
      real_world_change: "incompatible", reference_digest: sha256Digest("compensation-plan"),
      detail: { plan: "normalize new records manually" } }));
  assert.equal(repair.body.upgrade_recovery_action.resulting_state, "repair_required");
  const repairPlanState = (await request(`/kernel/v0/upgrade-plans/${retryPlanId}`)).body.upgrade_plan;
  const blockedRollbackReceipt = { upgrade_plan_id: retryPlanId, action_type: "deployment_rollback",
    real_world_change: "compatible", reference_digest: sha256Digest("unsupported-rollback"),
    detail: { reason: "attempt after incompatible change" } };
  const blockedAfterRepair = await post("/kernel/v0/upgrade-recovery-actions", command("t14-rollback-after-repair",
    "kernel.upgrade.recovery_record", { ...blockedRollbackReceipt,
      attestation_signature: migrationSign(blockedRollbackReceipt) }));
  assert.equal(blockedAfterRepair.response.status, 409);
  assert.equal(blockedAfterRepair.body.error.code, "UNRESOLVED_REAL_WORLD_CHANGE");
  const repairDetail = { result: "new records normalized and verified" };
  const repairReference = sha256Digest("repair-verification");
  const repairReceipt = { upgrade_plan_id: retryPlanId, action_type: "compensation_verified",
    real_world_change: "compatible", reference_digest: repairReference, detail: repairDetail,
    resolves_recovery_action_id: repair.body.upgrade_recovery_action.upgrade_recovery_action_id,
    expected_state_revision: repairPlanState.revision };
  const repairVerified = await post("/kernel/v0/upgrade-recovery-actions", command("t14-compensation-verified",
    "kernel.upgrade.recovery_record", { ...repairReceipt, attestation_signature: migrationSign(repairReceipt) }));
  assert.equal(repairVerified.response.status, 201, JSON.stringify(repairVerified.body));
  assert.equal(repairVerified.body.upgrade_recovery_action.resulting_state, "repair_verified");
  const secondRepair = await post("/kernel/v0/upgrade-recovery-actions", command("t14-second-compensation",
    "kernel.upgrade.recovery_record", { upgrade_plan_id: retryPlanId, action_type: "compensation",
      real_world_change: "incompatible", reference_digest: sha256Digest("second-repair-plan"),
      detail: { plan: "normalize another changed batch" } }));
  assert.equal(secondRepair.response.status, 201, JSON.stringify(secondRepair.body));
  const staleVerification = await post("/kernel/v0/upgrade-recovery-actions", command("t14-stale-repair-verification",
    "kernel.upgrade.recovery_record", { ...repairReceipt, attestation_signature: migrationSign(repairReceipt) }));
  assert.equal(staleVerification.response.status, 409);
  assert.equal(staleVerification.body.error.code, "UPGRADE_STATE_CHANGED");
  const secondRepairState = (await request(`/kernel/v0/upgrade-plans/${retryPlanId}`)).body.upgrade_plan;
  const secondRepairReceipt = { upgrade_plan_id: retryPlanId, action_type: "compensation_verified",
    real_world_change: "compatible", reference_digest: sha256Digest("second-repair-verification"),
    detail: { result: "second changed batch normalized" },
    resolves_recovery_action_id: secondRepair.body.upgrade_recovery_action.upgrade_recovery_action_id,
    expected_state_revision: secondRepairState.revision };
  const secondRepairVerified = await post("/kernel/v0/upgrade-recovery-actions", command(
    "t14-second-compensation-verified", "kernel.upgrade.recovery_record", { ...secondRepairReceipt,
      attestation_signature: migrationSign(secondRepairReceipt) }));
  assert.equal(secondRepairVerified.response.status, 201, JSON.stringify(secondRepairVerified.body));
  const verifiedRollbackReceipt = { upgrade_plan_id: retryPlanId, action_type: "deployment_rollback",
    real_world_change: "compatible", reference_digest: sha256Digest("verified-rollback"),
    detail: { reason: "verified reality permits rollback" } };
  const rollbackAfterVerification = await post("/kernel/v0/upgrade-recovery-actions", command(
    "t14-rollback-after-repair-verification", "kernel.upgrade.recovery_record", { ...verifiedRollbackReceipt,
      attestation_signature: migrationSign(verifiedRollbackReceipt) }));
  assert.equal(rollbackAfterVerification.response.status, 201, JSON.stringify(rollbackAfterVerification.body));

  const retirement = await request(`/kernel/v0/upgrade-plans/${planId}/retirement-status`);
  assert.equal(retirement.body.retirement_status.eligible, false);
  const blockerCodes = retirement.body.retirement_status.blockers.map((item) => item.code);
  assert.ok(blockerCodes.includes("EVIDENCE_REFERENCES_REMAIN"));
  assert.ok(blockerCodes.includes("RETENTION_WINDOW_ACTIVE"));
  const blockedRetirement = await post("/kernel/v0/package-retirements", command("t14-retire-blocked",
    "kernel.package_version.retire", { upgrade_plan_id: planId }));
  assert.equal(blockedRetirement.response.status, 409);
  assert.equal(blockedRetirement.body.error.code, "PACKAGE_RETIREMENT_BLOCKED");
  const forcedRetirementId = "79000000-0000-4000-8000-000000000141";
  psql(`SET session_replication_role=replica;
    INSERT INTO kernel_package_retirements
    (package_retirement_id,installation_id,environment_id,upgrade_plan_id,package_version_id,reference_snapshot,
     approved_by_actor_id,retired_at) VALUES (${sql(forcedRetirementId)},${sql(installationId)},${sql(environmentId)},
     ${sql(planId)},${sql(ids.packages[0])},'{}',${sql(human.body.principal.principal_id)},${sql(new Date().toISOString())});
    SET session_replication_role=origin;`);
  const retiredCard = (await request(`/kernel/v0/deployments/${ids.deployments[0]}/capabilities/inventory_correction/action-card`)).body.action_card;
  const retiredApproval = await post("/kernel/v0/capability-business-approvals", command("t14-retired-approval",
    "kernel.capability.business_approve", { deployment_id: ids.deployments[0], capability_export_id: "inventory_correction",
      capability_export_digest: retiredCard.affected_objects.capability_export_digest,
      authority_digest: retiredCard.affected_objects.authority_digest, action_card_digest: retiredCard.action_card_digest,
      expected_revision: retiredCard.current_revision }));
  assert.equal(retiredApproval.response.status, 201, JSON.stringify(retiredApproval.body));
  const retiredActivation = await post("/kernel/v0/capability-activations", command("t14-retired-activation",
    "kernel.capability_activation.activate", { business_approval_id: retiredApproval.body.business_approval.business_approval_id,
      deployment_id: ids.deployments[0], capability_export_id: "inventory_correction",
      capability_export_digest: retiredCard.affected_objects.capability_export_digest,
      authority_digest: retiredCard.affected_objects.authority_digest, action_card_digest: (await request(
        `/kernel/v0/deployments/${ids.deployments[0]}/capabilities/inventory_correction/action-card`)).body.action_card.action_card_digest,
      expected_revision: retiredCard.current_revision }));
  assert.equal(retiredActivation.response.status, 409);
  assert.equal(retiredActivation.body.error.code, "PACKAGE_VERSION_RETIRED");
  console.log("Ticket 14 acceptance passed: side-by-side compatibility, resumable migration, deterministic canary, pinned Run, exact authority, replay-safe recovery, and retirement blockers.");
}

try {
  await main();
} catch (error) {
  console.error(compose("logs", "kernel").stdout);
  throw error;
} finally {
  compose("down", "-v", "--remove-orphans");
}
