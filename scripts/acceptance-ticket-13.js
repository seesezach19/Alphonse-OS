import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";

import { sha256Digest } from "../src/canonical-json.js";
import { publicCoordinationKey, signCoordinationDocument } from "../src/coordination-contracts.js";

const developmentUrl = "http://127.0.0.1:43161";
const stagingUrl = "http://127.0.0.1:43162";
const productionUrl = "http://127.0.0.1:43163";
const coordinatorUrl = "http://127.0.0.1:43160";
const coordinatorInternalUrl = "http://hosted-coordinator:3600";
const environmentIds = {
  development: "00000000-0000-4000-8000-000000000131",
  staging: "00000000-0000-4000-8000-000000000132",
  production: "00000000-0000-4000-8000-000000000133"
};
const headers = { "content-type": "application/json", authorization: "Bearer local-development-bootstrap-token" };
const coordinatorHeaders = { authorization: "Bearer local-coordinator-account-only" };
const composeEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: "alphonse-kernel-ticket-13-acceptance",
  COMPOSE_PROFILES: "promotion",
  COORDINATOR_PORT: "43160",
  PROMOTION_DEVELOPMENT_PORT: "43161",
  PROMOTION_STAGING_PORT: "43162",
  PROMOTION_PRODUCTION_PORT: "43163"
};
const services = ["hosted-coordinator", "promotion-kernel-development", "promotion-kernel-staging",
  "promotion-kernel-production"];
const manifestDigest = sha256Digest({ package: "inventory", version: "1.0.0", manifest: true });
const artifactDigest = sha256Digest({ package: "inventory", version: "1.0.0", artifact: true });
const dependencyDigest = sha256Digest([]);
const packageIdentity = `com.alphonse.inventory@1.0.0#${manifestDigest}+${artifactDigest}`;
const fixtureIds = {
  development: { packageVersion: "10000000-0000-4000-8000-000000000131",
    validation: "20000000-0000-4000-8000-000000000131", simulation: "30000000-0000-4000-8000-000000000131" },
  staging: { packageVersion: "10000000-0000-4000-8000-000000000132",
    plan: "35000000-0000-4000-8000-000000000132", deployment: "40000000-0000-4000-8000-000000000132",
    unrelatedPlan: "35100000-0000-4000-8000-000000000132",
    unrelatedDeployment: "40100000-0000-4000-8000-000000000132",
    activation: "50000000-0000-4000-8000-000000000132",
    effect: "60000000-0000-4000-8000-000000000132", recovery: "70000000-0000-4000-8000-000000000132",
    reconciliation: "80000000-0000-4000-8000-000000000132" },
  production: { packageVersion: "10000000-0000-4000-8000-000000000133",
    plan: "35000000-0000-4000-8000-000000000133", deployment: "40000000-0000-4000-8000-000000000133",
    activation: "50000000-0000-4000-8000-000000000133" }
};

function compose(...args) {
  const result = spawnSync("docker", ["compose", "--profile", "promotion", ...args], {
    cwd: new URL("..", import.meta.url), env: composeEnvironment, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000, windowsHide: true
  });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

function psql(service, sql) {
  const result = compose("exec", "-T", service, "psql", "-U", "alphonse", "-d", "alphonse_kernel",
    "-v", "ON_ERROR_STOP=1", "-c", sql);
  assert.equal(result.status, 0);
}

function seedAuthoritativeState(service, environmentId, ids, options = {}) {
  const now = new Date().toISOString();
  const validationId = ids.validation ?? "20000000-0000-4000-8000-000000000999";
  const simulationId = ids.simulation ?? "30000000-0000-4000-8000-000000000999";
  const statements = [`SET session_replication_role=replica`, `INSERT INTO kernel_package_versions
    (package_version_id,installation_id,environment_id,package_id,semantic_version,artifact_digest,manifest_digest,
     dependency_digest,canonicalization_version,candidate,normalized_exports,build_session_id,validation_receipt_id,
     simulation_receipt_ids,toolkit_digest,publisher_principal_id,validator_version,publication_key_id,
     publication_signature,published_at)
    VALUES ('${ids.packageVersion}','00000000-0000-4000-8000-00000000a013','${environmentId}',
      'com.alphonse.inventory','1.0.0','${artifactDigest}','${manifestDigest}','${dependencyDigest}','rfc8785',
      '{"identity":{"package_id":"com.alphonse.inventory","version":"1.0.0"},"compatibility":{"kernel_api":">=0.1 <0.2"},"dependencies":[]}',
      '[]','90000000-0000-4000-8000-000000000001','${validationId}','["${simulationId}"]',
      '${sha256Digest("toolkit")}','90000000-0000-4000-8000-000000000002','0.1.0','fixture-key',
      'hmac-sha256:${"a".repeat(64)}','${now}')`];
  if (ids.validation) statements.push(`INSERT INTO kernel_package_validation_receipts
    (validation_receipt_id,installation_id,environment_id,build_session_id,passport_id,work_intent_id,
     candidate_digest,manifest_digest,toolkit_digest,validator_version,valid,checks,issues,
     validated_by_principal_id,validated_at)
    VALUES ('${ids.validation}','00000000-0000-4000-8000-00000000a013','${environmentId}',
      '90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003',
      '90000000-0000-4000-8000-000000000004','${artifactDigest}','${manifestDigest}','${sha256Digest("toolkit")}',
      '0.1.0',true,'["package_shape","compatibility"]','[]','90000000-0000-4000-8000-000000000002','${now}')`,
  `INSERT INTO kernel_package_simulation_receipts
    (simulation_receipt_id,installation_id,environment_id,validation_receipt_id,candidate_digest,mode,
     context_receipt_id,input_digest,result_digest,fidelity,assumptions,limitations,attester_id,
     attestation_signature,passed,simulated_by_principal_id,simulated_at)
    VALUES ('${ids.simulation}','00000000-0000-4000-8000-00000000a013','${environmentId}','${ids.validation}',
      '${artifactDigest}','deterministic_fixture',NULL,'${sha256Digest("input")}','${sha256Digest("compatible")}',
      'deterministic_fixture','[]','[]',NULL,NULL,true,'90000000-0000-4000-8000-000000000002','${now}')`);
  if (ids.deployment) {
    const staging = service.includes("staging");
    const storefront = staging ? "storefront-staging" : "storefront-production";
    const credentialRevision = staging ? "staging-writer-rev-1" : "production-writer-rev-9";
    statements.push(`INSERT INTO kernel_deployment_plans
    (deployment_plan_id,installation_id,environment_id,package_version_id,work_intent_id,validation_receipt_id,
     plan_digest,composition_digest,plan,created_by_principal_id,created_at)
    VALUES ('${ids.plan}','00000000-0000-4000-8000-00000000a013','${environmentId}','${ids.packageVersion}',
      '90000000-0000-4000-8000-000000000013','90000000-0000-4000-8000-000000000015',
      '${sha256Digest(`${service}-plan`)}','${sha256Digest("composition")}',
      '{"configuration_binding":{"redacted_values":{"storefront_system":"${storefront}"},"credential_bindings":[{"binding_ref":"credential://${staging ? "staging" : "production"}/storefront-writer","revision":"${credentialRevision}","scopes":["storefront.inventory.write"]}]},"adapter_bindings":[{"adapter_ref":"adapter://${staging ? "staging" : "production"}/storefront","contract_version":"0.1"}]}',
      '90000000-0000-4000-8000-000000000002','${now}')`,
    `INSERT INTO kernel_deployments
    (deployment_id,installation_id,environment_id,deployment_plan_id,technical_review_id,package_version_id,
     work_intent_id,plan_digest,composition_digest,state,staged_by_principal_id,staged_at)
    VALUES ('${ids.deployment}','00000000-0000-4000-8000-00000000a013','${environmentId}',
      '${ids.plan}','90000000-0000-4000-8000-000000000012','${ids.packageVersion}',
      '90000000-0000-4000-8000-000000000013','${sha256Digest(`${service}-plan`)}','${sha256Digest("composition")}',
      'staged','90000000-0000-4000-8000-000000000002','${now}')`,
  `INSERT INTO kernel_capability_activations
    (capability_activation_id,installation_id,environment_id,business_approval_id,deployment_id,package_version_id,
     capability_key,capability_export_id,capability_contract_version,capability_export_digest,authority_digest,
     from_revision,to_revision,activated_by_principal_id,activated_at)
    VALUES ('${ids.activation}','00000000-0000-4000-8000-00000000a013','${environmentId}',
      '90000000-0000-4000-8000-000000000014','${ids.deployment}','${ids.packageVersion}',
      'com.alphonse.inventory/inventory_correction','inventory_correction','1.0.0','${sha256Digest("capability")}',
      '${sha256Digest(`${service}-authority`)}',0,1,'90000000-0000-4000-8000-000000000002','${now}')`,
  `INSERT INTO kernel_capability_authority_states
    (installation_id,environment_id,capability_key,current_revision,active_activation_id,updated_at)
    VALUES ('00000000-0000-4000-8000-00000000a013','${environmentId}',
      'com.alphonse.inventory/inventory_correction',1,'${ids.activation}','${now}')`);
    if (ids.unrelatedPlan) statements.push(`INSERT INTO kernel_deployment_plans
      (deployment_plan_id,installation_id,environment_id,package_version_id,work_intent_id,validation_receipt_id,
       plan_digest,composition_digest,plan,created_by_principal_id,created_at)
      VALUES ('${ids.unrelatedPlan}','00000000-0000-4000-8000-00000000a013','${environmentId}',
        '${ids.packageVersion}','90000000-0000-4000-8000-000000000031','90000000-0000-4000-8000-000000000032',
        '${sha256Digest("unrelated-plan")}','${sha256Digest("unrelated-composition")}',
        '{"configuration_binding":{"redacted_values":{"storefront_system":"unrelated"},"credential_bindings":[]},"adapter_bindings":[]}',
        '90000000-0000-4000-8000-000000000002','${now}')`,
    `INSERT INTO kernel_deployments
      (deployment_id,installation_id,environment_id,deployment_plan_id,technical_review_id,package_version_id,
       work_intent_id,plan_digest,composition_digest,state,staged_by_principal_id,staged_at)
      VALUES ('${ids.unrelatedDeployment}','00000000-0000-4000-8000-00000000a013','${environmentId}',
        '${ids.unrelatedPlan}','90000000-0000-4000-8000-000000000033','${ids.packageVersion}',
        '90000000-0000-4000-8000-000000000031','${sha256Digest("unrelated-plan")}',
        '${sha256Digest("unrelated-composition")}','staged','90000000-0000-4000-8000-000000000002','${now}')`);
  }
  if (options.recovery) statements.push(`INSERT INTO kernel_effect_records
    (effect_id,installation_id,environment_id,run_id,envelope_id,effect_idempotency_key,effect_request,
     request_digest,capability_activation_id,workload_grant_id,context_receipt_ids,target,action,requested_value,
     limits,credential_binding,adapter_binding,evidence_requirements,recovery_posture,created_at)
    VALUES ('${ids.effect}','00000000-0000-4000-8000-00000000a013','${environmentId}',
      '90000000-0000-4000-8000-000000000021','90000000-0000-4000-8000-000000000022','ticket-13-recovery',
      '{}','${sha256Digest("effect")}','${ids.activation}','90000000-0000-4000-8000-000000000023','[]','{}',
      'set_quantity','{}','{}','{}','{}','[]','{}','${now}')`,
  `INSERT INTO kernel_recovery_cases
    (recovery_case_id,installation_id,environment_id,effect_id,run_id,known_facts,missing_evidence,
     responsible_actor,allowed_options,deadline_at,opened_at)
    VALUES ('${ids.recovery}','00000000-0000-4000-8000-00000000a013','${environmentId}','${ids.effect}',
      '90000000-0000-4000-8000-000000000021','[]','[]','{}','[]','${now}','${now}')`,
  `INSERT INTO kernel_recovery_case_states
    (installation_id,environment_id,recovery_case_id,status,reconciliation_status,reconciliation_record_id,updated_at)
    VALUES ('00000000-0000-4000-8000-00000000a013','${environmentId}','${ids.recovery}',
      'resolved_applied','applied','${ids.reconciliation}','${now}')`);
  statements.push(`SET session_replication_role=origin`);
  psql(service, statements.join(";"));
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() };
}

async function kernel(baseUrl, path, options = {}) {
  return request(baseUrl, path, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
}

async function post(baseUrl, path, value) {
  return kernel(baseUrl, path, { method: "POST", body: JSON.stringify(value) });
}

function command(commandId, operationId, input = {}) {
  return { command_id: commandId, operation_id: operationId, input };
}

async function createBinding(baseUrl, suffix, coordinatorPublicKey) {
  const result = await post(baseUrl, "/kernel/v0/coordinator-bindings",
    command(`t13-binding-${suffix}`, "kernel.coordinator_binding.create", {
      coordinator_id: "coordinator:local",
      coordinator_endpoint: coordinatorInternalUrl,
      coordinator_public_key: coordinatorPublicKey,
      customer_id: "customer:demo",
      promotion_scope: { allowed_targets: ["development", "staging", "production"] },
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
    }));
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  return result.body.coordinator_binding;
}

async function register(baseUrl, suffix) {
  const result = await post(baseUrl, "/kernel/v0/coordinator-registration-sync",
    command(`t13-register-${suffix}`, "kernel.coordinator.register_outbound"));
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.registration.initiated_by, "customer_environment");
  assert.equal(result.body.registration.inbound_administration_opened, false);
  return result.body.registration;
}

async function createReceipt(baseUrl, suffix, input) {
  const result = await post(baseUrl, "/kernel/v0/promotion-receipts",
    command(`t13-receipt-${suffix}`, "kernel.promotion_receipt.create", input));
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.promotion_receipt.authority_granted, false);
  return result.body.promotion_receipt;
}

async function deliverReceipt(baseUrl, suffix, receiptId) {
  const result = await post(baseUrl, `/kernel/v0/promotion-receipts/${receiptId}/deliver`,
    command(`t13-deliver-${suffix}`, "kernel.promotion_receipt.deliver_outbound"));
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.delivery.delivery_state, "delivered");
  return result.body.delivery;
}

function promotionInput(targetEnvironmentId, targetClass, packageIdentity, manifestDigest, artifactDigest,
  gateReceipts) {
  return {
    target_environment_id: targetEnvironmentId,
    target_class: targetClass,
    package_identity: packageIdentity,
    manifest_digest: manifestDigest,
    package_artifact_digest: artifactDigest,
    dependency_lock: [],
    source_receipt_digests: gateReceipts.map((receipt) => receipt.receipt_digest),
    compatibility: { kernel_protocol: ">=0.1 <0.2", storage_schema: ">=12 <14",
      adapter_contracts: ["reference-adapter@0.1"], result: "compatible" },
    change_summary: "Promote exact inventory Package through customer evidence gates.",
    required_configuration_schema: { required: ["storefront_system"],
      properties: { storefront_system: { type: "string" } } },
    gate_receipt_ids: gateReceipts.map((receipt) => receipt.receipt_id)
  };
}

async function resolve(baseUrl, suffix, proposalId, deploymentPlanId) {
  const result = await post(baseUrl, `/kernel/v0/promotion-proposals/${proposalId}/resolve`,
    command(`t13-resolve-${suffix}`, "kernel.promotion.resolve_local_plan", {
      deployment_plan_id: deploymentPlanId
    }));
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.promotion_resolution.local_only, true);
  assert.equal(result.body.promotion_resolution.authority_granted, false);
  return result.body.promotion_resolution;
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "--wait", ...services);

  const coordinatorHealth = await request(coordinatorUrl, "/healthz");
  assert.equal(coordinatorHealth.response.status, 200);
  assert.equal(coordinatorHealth.body.deployment_authority, false);
  const coordinatorPublicKey = coordinatorHealth.body.coordinator_public_key;
  for (const baseUrl of [developmentUrl, stagingUrl, productionUrl]) {
    assert.equal((await request(baseUrl, "/healthz")).response.status, 200);
  }
  seedAuthoritativeState("promotion-postgres-development", environmentIds.development, fixtureIds.development);
  seedAuthoritativeState("promotion-postgres-staging", environmentIds.staging, fixtureIds.staging, { recovery: true });
  seedAuthoritativeState("promotion-postgres-production", environmentIds.production, fixtureIds.production);

  const changedDevelopment = await post(developmentUrl, "/kernel/v0/commands",
    command("t13-isolation", "kernel.environment.profile.update", {
      display_name: "Customer Development Isolated", expected_revision: 0
    }));
  assert.equal(changedDevelopment.response.status, 201, JSON.stringify(changedDevelopment.body));
  const unchangedStaging = await kernel(stagingUrl, "/kernel/v0/environments/current");
  assert.equal(unchangedStaging.body.display_name, "Customer Staging");

  const bindings = {
    development: await createBinding(developmentUrl, "development", coordinatorPublicKey),
    staging: await createBinding(stagingUrl, "staging", coordinatorPublicKey),
    production: await createBinding(productionUrl, "production", coordinatorPublicKey)
  };
  await register(developmentUrl, "development");
  await register(stagingUrl, "staging");
  await register(productionUrl, "production");

  const unauthorizedRegistrations = await request(coordinatorUrl, "/coordinator/v0/environments");
  assert.equal(unauthorizedRegistrations.response.status, 403);
  const registrations = await request(coordinatorUrl, "/coordinator/v0/environments", { headers: coordinatorHeaders });
  assert.equal(registrations.body.environments.length, 3);
  for (const [name, environmentId] of Object.entries(environmentIds)) {
    const registered = await request(coordinatorUrl, `/coordinator/v0/environments/${environmentId}`,
      { headers: coordinatorHeaders });
    assert.equal(registered.body.environment.environment_class, name);
    const serialized = JSON.stringify(registered.body.environment.descriptor);
    assert.doesNotMatch(serialized, /business_payload|credential_value|prompt|evidence_body|actor_activity/i);
    assert.deepEqual(Object.keys(registered.body.environment.descriptor.health).sort(),
      ["outbox_lag", "status", "unresolved_obligations"]);
  }
  const originalDevelopment = await request(coordinatorUrl,
    `/coordinator/v0/environments/${environmentIds.development}`, { headers: coordinatorHeaders });
  const unknownEnvironmentChallenge = await request(coordinatorUrl, "/coordinator/v0/registration-challenges", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer undefined" },
    body: JSON.stringify({ customer_id: "customer:demo",
      environment_id: "00000000-0000-4000-8000-000000000199" })
  });
  assert.equal(unknownEnvironmentChallenge.response.status, 403);
  const crossEnvironmentChallenge = await request(coordinatorUrl, "/coordinator/v0/registration-challenges", {
    method: "POST", headers: { "content-type": "application/json",
      authorization: "Bearer local-development-enrollment-only" },
    body: JSON.stringify({ customer_id: "customer:demo", environment_id: environmentIds.production })
  });
  assert.equal(crossEnvironmentChallenge.response.status, 403);
  const attacker = generateKeyPairSync("ed25519");
  const attackerPublicKey = publicCoordinationKey(attacker.publicKey);
  const challengeResult = await request(coordinatorUrl, "/coordinator/v0/registration-challenges", {
    method: "POST", headers: { "content-type": "application/json",
      authorization: "Bearer local-development-enrollment-only" },
    body: JSON.stringify({ customer_id: "customer:demo", environment_id: environmentIds.development })
  });
  assert.equal(challengeResult.response.status, 201);
  const challenge = challengeResult.body.challenge.document;
  const replacementDescriptor = { ...originalDevelopment.body.environment.descriptor,
    signing_key_id: sha256Digest(attackerPublicKey), signing_public_key: attackerPublicKey,
    issued_at: challenge.issued_at, expires_at: challenge.expires_at };
  const signedReplacement = signCoordinationDocument(replacementDescriptor, attacker.privateKey);
  const replacementRequest = signCoordinationDocument({ schema_version: "alphonse.registration_request.v0.1",
    challenge_id: challenge.challenge_id, challenge_nonce: challenge.challenge_nonce,
    coordinator_id: challenge.coordinator_id, customer_id: challenge.customer_id,
    environment_descriptor: signedReplacement, issued_at: challenge.issued_at,
    expires_at: challenge.expires_at }, attacker.privateKey);
  const blockedReplacement = await request(coordinatorUrl, "/coordinator/v0/registrations", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(replacementRequest)
  });
  assert.equal(blockedReplacement.response.status, 409);
  assert.equal(blockedReplacement.body.error.code, "ENVIRONMENT_REGISTRATION_CONTINUITY_REQUIRED");

  const sourceProposalId = `source-release:${sha256Digest(packageIdentity)}`;
  const fabricatedValidation = await post(developmentUrl, "/kernel/v0/promotion-receipts",
    command("t13-receipt-fabricated", "kernel.promotion_receipt.create", {
      proposal_id: sourceProposalId, package_identity: packageIdentity, receipt_type: "package_validation",
      local_reference: { package_version_id: fixtureIds.development.packageVersion,
        validation_receipt_id: "20000000-0000-4000-8000-000000000999" }
    }));
  assert.equal(fabricatedValidation.response.status, 409);
  assert.equal(fabricatedValidation.body.error.code, "LOCAL_PACKAGE_VALIDATION_UNVERIFIED");
  const validation = await createReceipt(developmentUrl, "dev-validation", {
    proposal_id: sourceProposalId, package_identity: packageIdentity, receipt_type: "package_validation",
    local_reference: { package_version_id: fixtureIds.development.packageVersion,
      validation_receipt_id: fixtureIds.development.validation }
  });
  const compatibility = await createReceipt(developmentUrl, "dev-compatibility", {
    proposal_id: sourceProposalId, package_identity: packageIdentity, receipt_type: "compatibility",
    local_reference: { package_version_id: fixtureIds.development.packageVersion,
      simulation_receipt_id: fixtureIds.development.simulation }
  });

  const stagingRequest = await post(developmentUrl, "/kernel/v0/promotion-requests",
    command("t13-request-staging", "kernel.promotion.request_outbound",
      promotionInput(environmentIds.staging, "staging", packageIdentity, manifestDigest, artifactDigest,
        [validation, compatibility])));
  assert.equal(stagingRequest.response.status, 201, JSON.stringify(stagingRequest.body));
  const stagingProposal = stagingRequest.body.promotion_proposal;
  assert.equal(stagingProposal.target_environment_id, environmentIds.staging);
  assert.equal(stagingProposal.authority_granted, false);
  assert.equal(Object.hasOwn(stagingProposal, "configuration_values"), false);

  const stagingPoll = await post(stagingUrl, "/kernel/v0/promotion-polls",
    command("t13-poll-staging", "kernel.promotion.poll_outbound"));
  assert.equal(stagingPoll.response.status, 201, JSON.stringify(stagingPoll.body));
  assert.equal(stagingPoll.body.promotion_proposals.length, 1);
  const stagingResolution = await resolve(stagingUrl, "staging", stagingProposal.proposal_id,
    fixtureIds.staging.plan);
  const stagingPlanReceipt = await createReceipt(stagingUrl, "staging-plan", {
    proposal_id: stagingProposal.proposal_id, package_identity: packageIdentity,
    receipt_type: "deployment_plan_resolved",
    local_reference: { resolution_id: stagingResolution.resolution_id }
  });
  await deliverReceipt(stagingUrl, "staging-plan", stagingPlanReceipt.receipt_id);
  const unrelatedDeployment = await post(stagingUrl, "/kernel/v0/promotion-receipts",
    command("t13-receipt-staging-unrelated-deployment", "kernel.promotion_receipt.create", {
      proposal_id: stagingProposal.proposal_id, package_identity: packageIdentity, receipt_type: "deployed",
      local_reference: { deployment_id: fixtureIds.staging.unrelatedDeployment }
    }));
  assert.equal(unrelatedDeployment.response.status, 409);
  assert.equal(unrelatedDeployment.body.error.code, "LOCAL_DEPLOYMENT_UNVERIFIED");
  const stagingDeployed = await createReceipt(stagingUrl, "staging-deployed", {
    proposal_id: stagingProposal.proposal_id, package_identity: packageIdentity, receipt_type: "deployed",
    local_reference: { deployment_id: fixtureIds.staging.deployment }
  });
  const deployedDelivery = await deliverReceipt(stagingUrl, "staging-deployed", stagingDeployed.receipt_id);
  assert.equal(deployedDelivery.promotion_status.status, "deployed");
  const stagingActivated = await createReceipt(stagingUrl, "staging-activated", {
    proposal_id: stagingProposal.proposal_id, package_identity: packageIdentity, receipt_type: "activated",
    local_reference: { capability_activation_id: fixtureIds.staging.activation }
  });
  const activatedDelivery = await deliverReceipt(stagingUrl, "staging-activated", stagingActivated.receipt_id);
  assert.equal(activatedDelivery.promotion_status.status, "activated");

  const blockedProduction = await post(stagingUrl, "/kernel/v0/promotion-requests",
    command("t13-request-production-blocked", "kernel.promotion.request_outbound",
      promotionInput(environmentIds.production, "production", packageIdentity, manifestDigest, artifactDigest,
        [stagingDeployed, stagingActivated])));
  assert.equal(blockedProduction.response.status, 409, JSON.stringify(blockedProduction.body));
  assert.equal(blockedProduction.body.error.code, "PROMOTION_GATES_INCOMPLETE");
  assert.deepEqual(blockedProduction.body.error.details.missing_gates, ["staging_recovery"]);

  const stagingRecovery = await createReceipt(stagingUrl, "staging-recovery", {
    proposal_id: stagingProposal.proposal_id, package_identity: packageIdentity, receipt_type: "recovery_verified",
    local_reference: { recovery_case_id: fixtureIds.staging.recovery }
  });
  const productionRequest = await post(stagingUrl, "/kernel/v0/promotion-requests",
    command("t13-request-production", "kernel.promotion.request_outbound",
      promotionInput(environmentIds.production, "production", packageIdentity, manifestDigest, artifactDigest,
        [stagingDeployed, stagingActivated, stagingRecovery])));
  assert.equal(productionRequest.response.status, 201, JSON.stringify(productionRequest.body));
  const productionProposal = productionRequest.body.promotion_proposal;

  const productionPoll = await post(productionUrl, "/kernel/v0/promotion-polls",
    command("t13-poll-production", "kernel.promotion.poll_outbound"));
  assert.equal(productionPoll.response.status, 201, JSON.stringify(productionPoll.body));
  assert.equal(productionPoll.body.promotion_proposals.length, 1);
  const productionResolution = await resolve(productionUrl, "production", productionProposal.proposal_id,
    fixtureIds.production.plan);
  assert.notEqual(productionResolution.configuration_fingerprint, stagingResolution.configuration_fingerprint);
  assert.notEqual(productionResolution.credential_bindings[0].revision,
    stagingResolution.credential_bindings[0].revision);

  const productionPlanReceipt = await createReceipt(productionUrl, "production-plan", {
    proposal_id: productionProposal.proposal_id, package_identity: packageIdentity,
    receipt_type: "deployment_plan_resolved",
    local_reference: { resolution_id: productionResolution.resolution_id }
  });
  await deliverReceipt(productionUrl, "production-plan", productionPlanReceipt.receipt_id);
  const productionDeployed = await createReceipt(productionUrl, "production-deployed", {
    proposal_id: productionProposal.proposal_id, package_identity: packageIdentity, receipt_type: "deployed",
    local_reference: { deployment_id: fixtureIds.production.deployment }
  });
  await deliverReceipt(productionUrl, "production-deployed", productionDeployed.receipt_id);
  const productionActivated = await createReceipt(productionUrl, "production-activated", {
    proposal_id: productionProposal.proposal_id, package_identity: packageIdentity, receipt_type: "activated",
    local_reference: { capability_activation_id: fixtureIds.production.activation }
  });
  const productionDelivery = await deliverReceipt(productionUrl, "production-activated",
    productionActivated.receipt_id);
  assert.equal(productionDelivery.promotion_status.status, "activated");
  const hostedStatus = await request(coordinatorUrl,
    `/coordinator/v0/promotion-status/${productionProposal.proposal_id}`, { headers: coordinatorHeaders });
  assert.equal(hostedStatus.body.promotion_status.status, "activated");
  assert.ok(hostedStatus.body.promotion_status.receipt_digests.length >= 3);
  assert.equal(hostedStatus.body.promotion_status.authority_granted, false);

  compose("stop", "hosted-coordinator");
  for (const baseUrl of [developmentUrl, stagingUrl, productionUrl]) {
    assert.equal((await request(baseUrl, "/healthz")).response.status, 200);
  }
  const localDuringOutage = await kernel(productionUrl,
    `/kernel/v0/promotion-proposals/${productionProposal.proposal_id}/resolution`);
  assert.equal(localDuringOutage.body.promotion_resolution.resolution_id, productionResolution.resolution_id);

  const revoked = await post(productionUrl,
    `/kernel/v0/coordinator-bindings/${bindings.production.binding_id}/revoke`,
    command("t13-revoke-production", "kernel.coordinator_binding.revoke",
      { reason: "Customer ended hosted coordination.", expected_revision: 0 }));
  assert.equal(revoked.response.status, 201, JSON.stringify(revoked.body));
  assert.equal(revoked.body.coordinator_binding.local_authority_changed, false);
  const blockedPoll = await post(productionUrl, "/kernel/v0/promotion-polls",
    command("t13-poll-after-revoke", "kernel.promotion.poll_outbound"));
  assert.equal(blockedPoll.response.status, 409);
  assert.equal(blockedPoll.body.error.code, "ACTIVE_COORDINATOR_BINDING_REQUIRED");
  const environmentStillLocal = await kernel(productionUrl, "/kernel/v0/environments/current");
  assert.equal(environmentStillLocal.body.environment_class, "production");

  console.log("Ticket 13 environment promotion acceptance passed.");
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
