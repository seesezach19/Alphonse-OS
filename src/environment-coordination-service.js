import { randomBytes, randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  assertCoordinationPoll,
  assertEnvironmentDescriptor,
  assertPromotionProposal,
  assertPromotionReceipt,
  assertRegistrationChallenge,
  publicCoordinationKey,
  signCoordinationDocument,
  verifyCoordinationEnvelope
} from "./coordination-contracts.js";
import { KernelError } from "./errors.js";

const DISCLOSURE_SCOPE = ["identity", "compatibility", "package_digests", "deployment_digests", "coarse_health"];
const RECEIPT_TYPES = new Set(["package_validation", "compatibility", "deployment_plan_resolved",
  "deployed", "activated", "recovery_verified", "declined"]);
const SECRET_KEY = /(^|_)(secret|password|private_key|token|api_key|credential_value|authorization|cookie|dsn)($|_)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_COORDINATION_INPUT", `${label} must be an object.`);
  }
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new KernelError(400, "UNDECLARED_COORDINATION_FIELD", `${label} contains undeclared fields.`);
  }
  return value;
}

function string(value, label, maximum = 2000) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new KernelError(400, "INVALID_COORDINATION_INPUT", `${label} must be a bounded non-empty string.`);
  }
  return value;
}

function uuid(value, label) {
  string(value, label, 36);
  if (!UUID.test(value)) throw new KernelError(400, "INVALID_COORDINATION_INPUT", `${label} must be a UUID.`);
  return value;
}

function rejectSecrets(value, path = "input") {
  if (typeof value === "string") {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|ed25519-pkcs8:|^Bearer\s+/i.test(value)) {
      throw new KernelError(400, "SECRET_MATERIAL_PROHIBITED", `${path} contains secret material.`);
    }
    return;
  }
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectSecrets(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new KernelError(400, "SECRET_MATERIAL_PROHIBITED", `${path}.${key} is prohibited.`);
    rejectSecrets(child, `${path}.${key}`);
  }
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (cause) {
    throw new KernelError(503, "COORDINATOR_UNAVAILABLE", "Hosted coordinator is unavailable.", { cause: cause.code });
  }
  const body = await response.json();
  if (!response.ok) {
    throw new KernelError(response.status, body.error?.code ?? "COORDINATOR_REJECTED",
      body.error?.message ?? "Hosted coordinator rejected the request.", body.error?.details ?? {});
  }
  return body;
}

function operationalPackageIdentity(packageRecord) {
  return `${packageRecord.package_id}@${packageRecord.semantic_version}#${packageRecord.manifest_digest}+${packageRecord.artifact_digest}`;
}

function commandDigest(installationId, environmentId, command) {
  return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
}

function iso(value) {
  return new Date(value).toISOString();
}

export function createEnvironmentCoordinationService(database, {
  installationId,
  environmentId,
  environmentClass,
  environmentPrivateKey,
  coordinatorEnrollmentToken,
  kernelBuild,
  protocolVersion
}) {
  const { pool, executeCommand } = database;
  const environmentPublicKey = environmentPrivateKey ? publicCoordinationKey(environmentPrivateKey) : null;

  function requireConfigured() {
    if (!environmentPrivateKey) throw new KernelError(503, "COORDINATION_NOT_CONFIGURED", "Environment coordination signing is not configured.");
  }

  async function requireLocalPackage(packageIdentity, client = pool) {
    const result = await client.query(`SELECT * FROM kernel_package_versions
      WHERE installation_id=$1 AND environment_id=$2
        AND package_id || '@' || semantic_version || '#' || manifest_digest || '+' || artifact_digest=$3`,
    [installationId, environmentId, packageIdentity]);
    if (!result.rows[0]) {
      throw new KernelError(409, "LOCAL_PACKAGE_IDENTITY_UNVERIFIED",
        "Promotion requires the exact Package Version to exist in the source Environment.");
    }
    return result.rows[0];
  }

  async function authoritativeEvidence(receiptType, proposalId, packageIdentity, localReference,
    predecessorReference = null) {
    const packageVersion = await requireLocalPackage(packageIdentity);
    let result;
    if (receiptType === "package_validation") {
      exact(localReference, ["package_version_id", "validation_receipt_id"], "local_reference");
      uuid(localReference.package_version_id, "local_reference.package_version_id");
      uuid(localReference.validation_receipt_id, "local_reference.validation_receipt_id");
      result = await pool.query(`SELECT v.validation_receipt_id,v.candidate_digest,v.manifest_digest,v.valid,v.validated_at
        FROM kernel_package_validation_receipts v JOIN kernel_package_versions p
          ON p.installation_id=v.installation_id AND p.environment_id=v.environment_id
         AND p.validation_receipt_id=v.validation_receipt_id
        WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.package_version_id=$3
          AND v.validation_receipt_id=$4 AND v.valid=true`,
      [installationId, environmentId, localReference.package_version_id, localReference.validation_receipt_id]);
      if (!result.rows[0] || localReference.package_version_id !== packageVersion.package_version_id) {
        throw new KernelError(409, "LOCAL_PACKAGE_VALIDATION_UNVERIFIED",
          "Package validation receipt is not the passing receipt bound to the exact local Package Version.");
      }
      const row = result.rows[0];
      return { evidence_type: receiptType, package_version_id: packageVersion.package_version_id,
        validation_receipt_id: row.validation_receipt_id, candidate_digest: row.candidate_digest,
        manifest_digest: row.manifest_digest, validated_at: iso(row.validated_at) };
    }
    if (receiptType === "compatibility") {
      exact(localReference, ["package_version_id", "simulation_receipt_id"], "local_reference");
      uuid(localReference.package_version_id, "local_reference.package_version_id");
      uuid(localReference.simulation_receipt_id, "local_reference.simulation_receipt_id");
      result = await pool.query(`SELECT simulation_receipt_id,candidate_digest,result_digest,fidelity,passed,simulated_at
        FROM kernel_package_simulation_receipts
        WHERE installation_id=$1 AND environment_id=$2 AND simulation_receipt_id=$3 AND passed=true`,
      [installationId, environmentId, localReference.simulation_receipt_id]);
      const simulationIds = packageVersion.simulation_receipt_ids ?? [];
      if (!result.rows[0] || localReference.package_version_id !== packageVersion.package_version_id
          || !simulationIds.includes(localReference.simulation_receipt_id)) {
        throw new KernelError(409, "LOCAL_PACKAGE_COMPATIBILITY_UNVERIFIED",
          "Compatibility receipt is not a passing Simulation bound to the exact local Package Version.");
      }
      const row = result.rows[0];
      return { evidence_type: receiptType, package_version_id: packageVersion.package_version_id,
        simulation_receipt_id: row.simulation_receipt_id, candidate_digest: row.candidate_digest,
        result_digest: row.result_digest, fidelity: row.fidelity, simulated_at: iso(row.simulated_at) };
    }
    if (receiptType === "deployment_plan_resolved") {
      exact(localReference, ["resolution_id"], "local_reference");
      uuid(localReference.resolution_id, "local_reference.resolution_id");
      result = await pool.query(`SELECT resolution_id,proposal_id,plan_digest,resolved_at
        FROM kernel_promotion_resolutions WHERE installation_id=$1 AND environment_id=$2
          AND proposal_id=$3 AND package_identity=$4 AND resolution_id=$5`,
      [installationId, environmentId, proposalId, packageIdentity, localReference.resolution_id]);
      if (!result.rows[0]) throw new KernelError(409, "LOCAL_DEPLOYMENT_PLAN_UNVERIFIED",
        "Promotion plan receipt must bind the exact local target resolution.");
      const row = result.rows[0];
      return { evidence_type: receiptType, resolution_id: row.resolution_id, proposal_id: row.proposal_id,
        plan_digest: row.plan_digest, resolved_at: iso(row.resolved_at) };
    }
    if (receiptType === "deployed") {
      exact(localReference, ["deployment_id"], "local_reference");
      uuid(localReference.deployment_id, "local_reference.deployment_id");
      result = await pool.query(`SELECT d.deployment_id,d.package_version_id,d.plan_digest,d.state,d.staged_at
        FROM kernel_deployments d JOIN kernel_promotion_resolutions r
          ON r.installation_id=d.installation_id AND r.environment_id=d.environment_id
         AND r.proposal_id=$3 AND r.package_identity=$4
         AND (r.local_deployment_plan->>'deployment_plan_id')::uuid=d.deployment_plan_id
         AND r.plan_digest=d.plan_digest
        WHERE d.installation_id=$1 AND d.environment_id=$2
          AND d.deployment_id=$5 AND d.package_version_id=$6 AND d.state='staged'`,
      [installationId, environmentId, proposalId, packageIdentity, localReference.deployment_id,
        packageVersion.package_version_id]);
      if (!result.rows[0]) throw new KernelError(409, "LOCAL_DEPLOYMENT_UNVERIFIED",
        "Deployed receipt must bind an actual staged Deployment of the exact local Package Version.");
      const row = result.rows[0];
      return { evidence_type: receiptType, deployment_id: row.deployment_id,
        package_version_id: row.package_version_id, plan_digest: row.plan_digest, staged_at: iso(row.staged_at) };
    }
    if (receiptType === "activated") {
      exact(localReference, ["capability_activation_id"], "local_reference");
      uuid(localReference.capability_activation_id, "local_reference.capability_activation_id");
      if (!predecessorReference?.deployment_id) throw new KernelError(409, "LOCAL_PROMOTION_PREDECESSOR_MISSING",
        "Activation receipt requires the authoritative Deployment reference from this Promotion Proposal.");
      result = await pool.query(`SELECT a.capability_activation_id,a.deployment_id,a.package_version_id,
          a.authority_digest,a.activated_at
        FROM kernel_capability_activations a JOIN kernel_capability_authority_states s
          ON s.installation_id=a.installation_id AND s.environment_id=a.environment_id
         AND s.capability_key=a.capability_key AND s.active_activation_id=a.capability_activation_id
        WHERE a.installation_id=$1 AND a.environment_id=$2 AND a.capability_activation_id=$3
          AND a.package_version_id=$4 AND a.deployment_id=$5`,
      [installationId, environmentId, localReference.capability_activation_id, packageVersion.package_version_id,
        predecessorReference.deployment_id]);
      if (!result.rows[0]) throw new KernelError(409, "LOCAL_ACTIVATION_UNVERIFIED",
        "Activated receipt must bind the currently active Capability of the exact local Package Version.");
      const row = result.rows[0];
      return { evidence_type: receiptType, capability_activation_id: row.capability_activation_id,
        deployment_id: row.deployment_id, package_version_id: row.package_version_id,
        authority_digest: row.authority_digest, activated_at: iso(row.activated_at) };
    }
    if (receiptType === "recovery_verified") {
      exact(localReference, ["recovery_case_id"], "local_reference");
      uuid(localReference.recovery_case_id, "local_reference.recovery_case_id");
      if (!predecessorReference?.capability_activation_id) {
        throw new KernelError(409, "LOCAL_PROMOTION_PREDECESSOR_MISSING",
          "Recovery receipt requires the authoritative active Capability reference from this Promotion Proposal.");
      }
      result = await pool.query(`SELECT c.recovery_case_id,s.reconciliation_record_id,s.status,
          s.reconciliation_status,s.updated_at
        FROM kernel_recovery_cases c JOIN kernel_recovery_case_states s
          ON s.installation_id=c.installation_id AND s.environment_id=c.environment_id
         AND s.recovery_case_id=c.recovery_case_id
        JOIN kernel_effect_records e ON e.installation_id=c.installation_id AND e.environment_id=c.environment_id
         AND e.effect_id=c.effect_id
        JOIN kernel_capability_activations a ON a.installation_id=e.installation_id AND a.environment_id=e.environment_id
         AND a.capability_activation_id=e.capability_activation_id
        WHERE c.installation_id=$1 AND c.environment_id=$2 AND c.recovery_case_id=$3
          AND a.package_version_id=$4 AND a.capability_activation_id=$5
          AND s.status='resolved_applied' AND s.reconciliation_status='applied'`,
      [installationId, environmentId, localReference.recovery_case_id, packageVersion.package_version_id,
        predecessorReference.capability_activation_id]);
      if (!result.rows[0]) throw new KernelError(409, "LOCAL_RECOVERY_UNVERIFIED",
        "Recovery receipt must bind a resolved applied Recovery Case for the exact local Package Version.");
      const row = result.rows[0];
      return { evidence_type: receiptType, recovery_case_id: row.recovery_case_id,
        reconciliation_record_id: row.reconciliation_record_id, status: row.status,
        reconciliation_status: row.reconciliation_status, updated_at: iso(row.updated_at) };
    }
    exact(localReference, ["decision_digest"], "local_reference");
    return { evidence_type: receiptType, decision_digest: localReference.decision_digest };
  }

  async function activeBinding(client = pool) {
    const result = await client.query(`
      SELECT b.*,s.state,s.revision,s.updated_at
      FROM kernel_coordinator_bindings b
      JOIN kernel_coordinator_binding_states s
        ON s.installation_id=b.installation_id AND s.environment_id=b.environment_id AND s.binding_id=b.binding_id
      WHERE b.installation_id=$1 AND b.environment_id=$2 AND s.state='active' AND b.expires_at > now()
      ORDER BY b.issued_at DESC LIMIT 1`, [installationId, environmentId]);
    if (!result.rows[0]) throw new KernelError(409, "ACTIVE_COORDINATOR_BINDING_REQUIRED", "No active local Coordinator Binding exists.");
    return result.rows[0];
  }

  async function replay(envelope, operationId, actor) {
    const command = { ...envelope, actor };
    const requestDigest = commandDigest(installationId, environmentId, command);
    const receipt = await database.getCommandReceipt(installationId, environmentId, envelope.command_id);
    if (!receipt) return null;
    if (receipt.request_digest !== requestDigest || envelope.operation_id !== operationId) {
      throw new KernelError(409, "IDEMPOTENCY_CONFLICT", "Command ID already binds different coordination work.");
    }
    return { replayed: true, result: receipt.result };
  }

  async function createBinding(envelope, actor) {
    requireConfigured();
    const input = exact(envelope.input, ["coordinator_id", "coordinator_endpoint", "coordinator_public_key",
      "customer_id", "promotion_scope", "expires_at"], "input");
    rejectSecrets(input);
    string(input.coordinator_id, "coordinator_id");
    string(input.coordinator_endpoint, "coordinator_endpoint");
    string(input.coordinator_public_key, "coordinator_public_key", 1000);
    string(input.customer_id, "customer_id");
    object(input.promotion_scope, "promotion_scope");
    if (!Number.isFinite(Date.parse(input.expires_at)) || Date.parse(input.expires_at) <= Date.now()) {
      throw new KernelError(400, "INVALID_COORDINATOR_BINDING_EXPIRY", "Coordinator Binding expiry must be in the future.");
    }
    const command = { ...envelope, actor };
    const bindingId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const existing = await client.query(`SELECT binding_id FROM kernel_coordinator_binding_states
          WHERE installation_id=$1 AND environment_id=$2 AND state='active'`, [installationId, environmentId]);
        if (existing.rows[0]) throw new KernelError(409, "ACTIVE_COORDINATOR_BINDING_EXISTS", "Revoke the active Coordinator Binding before replacement.");
        await client.query(`INSERT INTO kernel_coordinator_bindings
          (binding_id,installation_id,environment_id,coordinator_id,coordinator_endpoint,coordinator_public_key,
           customer_id,disclosure_scope,promotion_scope,issued_at,expires_at,created_by_actor_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [bindingId, installationId, environmentId, input.coordinator_id, input.coordinator_endpoint.replace(/\/$/, ""),
          input.coordinator_public_key, input.customer_id, JSON.stringify(DISCLOSURE_SCOPE),
          JSON.stringify(input.promotion_scope), acceptedAt, input.expires_at, actor.id]);
        await client.query(`INSERT INTO kernel_coordinator_binding_states
          (installation_id,environment_id,binding_id,state,revision,updated_at)
          VALUES ($1,$2,$3,'active',0,$4)`, [installationId, environmentId, bindingId, acceptedAt]);
        return { aggregateType: "coordinator_binding", aggregateId: bindingId,
          transitionType: "kernel.coordinator_binding.created",
          transitionPayload: { coordinator_id: input.coordinator_id, disclosure_scope: DISCLOSURE_SCOPE },
          result: { coordinator_binding: { binding_id: bindingId, coordinator_id: input.coordinator_id,
            customer_id: input.customer_id, disclosure_scope: DISCLOSURE_SCOPE,
            promotion_scope: input.promotion_scope, state: "active", revision: "0", issued_at: acceptedAt,
            expires_at: input.expires_at, kernel_authority_granted: false } } };
      }});
  }

  async function descriptor(binding) {
    const environment = await database.getEnvironment(installationId, environmentId);
    const packageVersions = await pool.query(`SELECT package_id,semantic_version,manifest_digest,artifact_digest
      FROM kernel_package_versions WHERE installation_id=$1 AND environment_id=$2 ORDER BY package_id,semantic_version`,
    [installationId, environmentId]);
    const quarantined = await pool.query(`SELECT package_identity FROM kernel_quarantined_packages
      WHERE installation_id=$1 AND environment_id=$2 ORDER BY package_identity`, [installationId, environmentId]);
    const deploymentPlans = await pool.query(`SELECT p.plan_digest FROM kernel_deployments d
      JOIN kernel_deployment_plans p ON p.installation_id=d.installation_id AND p.environment_id=d.environment_id
       AND p.deployment_plan_id=d.deployment_plan_id
      WHERE d.installation_id=$1 AND d.environment_id=$2 ORDER BY p.plan_digest`, [installationId, environmentId]);
    const outbox = await pool.query(`SELECT count(*)::int AS count FROM kernel_outbox
      WHERE installation_id=$1 AND environment_id=$2 AND published_at IS NULL`, [installationId, environmentId]);
    const obligations = await pool.query(`SELECT count(*)::int AS count FROM kernel_operational_obligations
      WHERE installation_id=$1 AND environment_id=$2 AND status <> 'satisfied'`, [installationId, environmentId]);
    const migration = await pool.query("SELECT version FROM kernel_schema_migrations ORDER BY version DESC LIMIT 1");
    const now = new Date();
    const packageIdentities = [...packageVersions.rows.map(operationalPackageIdentity),
      ...quarantined.rows.map((row) => row.package_identity)].sort();
    const document = assertEnvironmentDescriptor({
      schema_version: "alphonse.environment_descriptor.v0.1",
      coordinator_id: binding.coordinator_id,
      installation_id: installationId,
      environment_id: environmentId,
      display_label: environment.display_name,
      environment_class: environmentClass,
      kernel_build: kernelBuild,
      protocol_version: protocolVersion,
      storage_schema_version: migration.rows[0]?.version ?? "unknown",
      signing_key_id: sha256Digest(environmentPublicKey),
      signing_public_key: environmentPublicKey,
      execution_epoch: String(environment.execution_epoch),
      package_identities: [...new Set(packageIdentities)],
      deployment_digests: [...new Set(deploymentPlans.rows.map((row) => row.plan_digest))],
      adapter_contract_versions: ["reference-adapter@0.1"],
      health: { status: "healthy", outbox_lag: outbox.rows[0].count,
        unresolved_obligations: obligations.rows[0].count },
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 5 * 60_000).toISOString()
    });
    return signCoordinationDocument(document, environmentPrivateKey);
  }

  async function registerOutbound(envelope, actor) {
    requireConfigured();
    const replayed = await replay(envelope, "kernel.coordinator.register_outbound", actor);
    if (replayed) return replayed;
    const binding = await activeBinding();
    const challengeBody = await fetchJson(`${binding.coordinator_endpoint}/coordinator/v0/registration-challenges`, {
      method: "POST", headers: { "content-type": "application/json",
        authorization: `Bearer ${coordinatorEnrollmentToken}` },
      body: JSON.stringify({ customer_id: binding.customer_id, environment_id: environmentId })
    });
    const challenge = verifyCoordinationEnvelope(challengeBody.challenge, binding.coordinator_public_key,
      assertRegistrationChallenge);
    if (challenge.coordinator_id !== binding.coordinator_id || challenge.customer_id !== binding.customer_id
        || challenge.environment_id !== environmentId) {
      throw new KernelError(409, "COORDINATOR_CHALLENGE_SCOPE_MISMATCH", "Coordinator challenge does not bind this Environment.");
    }
    const signedDescriptor = await descriptor(binding);
    const now = new Date();
    const registration = signCoordinationDocument({
      schema_version: "alphonse.registration_request.v0.1",
      challenge_id: challenge.challenge_id,
      challenge_nonce: challenge.challenge_nonce,
      coordinator_id: binding.coordinator_id,
      customer_id: binding.customer_id,
      environment_descriptor: signedDescriptor,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 5 * 60_000).toISOString()
    }, environmentPrivateKey);
    const remote = await fetchJson(`${binding.coordinator_endpoint}/coordinator/v0/registrations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(registration)
    });
    const command = { ...envelope, actor };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const descriptorId = randomUUID();
        await client.query(`INSERT INTO kernel_environment_descriptors
          (descriptor_id,installation_id,environment_id,binding_id,signed_descriptor,descriptor_digest,registered_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [descriptorId, installationId, environmentId, binding.binding_id,
          JSON.stringify(signedDescriptor), sha256Digest(signedDescriptor), acceptedAt]);
        return { aggregateType: "environment_descriptor", aggregateId: descriptorId,
          transitionType: "kernel.coordinator.registered_outbound",
          transitionPayload: { binding_id: binding.binding_id, descriptor_digest: sha256Digest(signedDescriptor) },
          result: { registration: { ...remote.registration, binding_id: binding.binding_id,
            initiated_by: "customer_environment", inbound_administration_opened: false } } };
      }});
  }

  async function pollPromotions(envelope, actor) {
    requireConfigured();
    const replayed = await replay(envelope, "kernel.promotion.poll_outbound", actor);
    if (replayed) return replayed;
    const binding = await activeBinding();
    const now = new Date();
    const pollDocument = assertCoordinationPoll({ schema_version: "alphonse.coordination_poll.v0.1",
      coordinator_id: binding.coordinator_id, customer_id: binding.customer_id, environment_id: environmentId,
      request_nonce: randomBytes(24).toString("base64url"), issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 5 * 60_000).toISOString() });
    const signedPoll = signCoordinationDocument(pollDocument, environmentPrivateKey);
    const remote = await fetchJson(`${binding.coordinator_endpoint}/coordinator/v0/promotion-polls`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signedPoll)
    });
    const proposals = remote.promotion_proposals.map((signed) => {
      const proposal = verifyCoordinationEnvelope(signed, binding.coordinator_public_key, assertPromotionProposal);
      if (proposal.target_environment_id !== environmentId || proposal.customer_id !== binding.customer_id) {
        throw new KernelError(409, "PROMOTION_PROPOSAL_SCOPE_MISMATCH", "Coordinator proposal targets another Environment.");
      }
      return { signed, proposal };
    }).filter(({ proposal }) => Date.parse(proposal.issued_at) <= Date.now()
      && Date.parse(proposal.expires_at) > Date.now());
    const command = { ...envelope, actor };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        for (const { signed, proposal } of proposals) {
          const existing = await client.query(`SELECT proposal_digest FROM kernel_received_promotion_proposals
            WHERE installation_id=$1 AND environment_id=$2 AND proposal_id=$3`,
          [installationId, environmentId, proposal.proposal_id]);
          if (existing.rows[0] && existing.rows[0].proposal_digest !== sha256Digest(signed)) {
            throw new KernelError(409, "PROMOTION_PROPOSAL_CONFLICT", "Proposal ID binds different signed bytes.");
          }
          if (!existing.rows[0]) await client.query(`INSERT INTO kernel_received_promotion_proposals
            (proposal_id,installation_id,environment_id,binding_id,package_identity,signed_proposal,proposal_digest,received_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [proposal.proposal_id, installationId, environmentId,
            binding.binding_id, proposal.package_identity, JSON.stringify(signed), sha256Digest(signed), acceptedAt]);
        }
        return { aggregateType: "promotion_poll", aggregateId: envelope.command_id,
          transitionType: "kernel.promotion.proposals_pulled",
          transitionPayload: { proposal_ids: proposals.map(({ proposal }) => proposal.proposal_id) },
          result: { promotion_proposals: proposals.map(({ proposal }) => ({ ...proposal,
            local_authority_granted: false })), outbound_channel: true } };
      }});
  }

  async function getProposal(proposalId, client = pool) {
    const result = await client.query(`SELECT * FROM kernel_received_promotion_proposals
      WHERE installation_id=$1 AND environment_id=$2 AND proposal_id=$3`, [installationId, environmentId, proposalId]);
    if (!result.rows[0]) throw new KernelError(404, "PROMOTION_PROPOSAL_NOT_FOUND", "Local Promotion Proposal does not exist.");
    const row = result.rows[0];
    return { proposal: row.signed_proposal.document, proposal_digest: row.proposal_digest,
      received_at: new Date(row.received_at).toISOString(), authority_granted: false };
  }

  async function resolveProposal(envelope, proposalId, actor) {
    const input = exact(envelope.input, ["deployment_plan_id"], "input");
    uuid(input.deployment_plan_id, "input.deployment_plan_id");
    const local = await getProposal(proposalId);
    const proposal = local.proposal;
    if (Date.parse(proposal.expires_at) <= Date.now()) {
      throw new KernelError(409, "PROMOTION_PROPOSAL_EXPIRED", "Expired Promotion Proposal cannot be resolved.");
    }
    const planResult = await pool.query(`SELECT p.deployment_plan_id,p.plan_digest,p.plan,v.package_id,
        v.semantic_version,v.manifest_digest,v.artifact_digest
      FROM kernel_deployment_plans p JOIN kernel_package_versions v
        ON v.installation_id=p.installation_id AND v.environment_id=p.environment_id
       AND v.package_version_id=p.package_version_id
      WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.deployment_plan_id=$3`,
    [installationId, environmentId, input.deployment_plan_id]);
    const localPlan = planResult.rows[0];
    if (!localPlan || operationalPackageIdentity(localPlan) !== proposal.package_identity) {
      throw new KernelError(409, "TARGET_DEPLOYMENT_PLAN_PACKAGE_MISMATCH",
        "Target Deployment Plan must bind the exact proposed local Package Version.");
    }
    const configurationValues = localPlan.plan.configuration_binding?.redacted_values ?? {};
    const credentialBindings = localPlan.plan.configuration_binding?.credential_bindings ?? [];
    const adapterBindings = localPlan.plan.adapter_bindings ?? [];
    const schema = proposal.required_configuration_schema;
    if (JSON.stringify(Object.keys(configurationValues).sort()) !== JSON.stringify([...schema.required].sort())) {
      throw new KernelError(409, "TARGET_CONFIGURATION_INCOMPLETE", "Local configuration must resolve the exact required schema.");
    }
    for (const [key, value] of Object.entries(configurationValues)) {
      const expected = schema.properties[key]?.type;
      const actual = Number.isInteger(value) ? "integer" : typeof value;
      if (!expected || (expected !== actual && !(expected === "number" && actual === "integer"))) {
        throw new KernelError(409, "TARGET_CONFIGURATION_TYPE_MISMATCH", `Local configuration ${key} has wrong type.`);
      }
    }
    credentialBindings.forEach((binding, index) => {
      exact(binding, ["binding_ref", "revision", "scopes"], `credential_bindings[${index}]`);
      string(binding.binding_ref, "binding_ref");
      string(binding.revision, "revision");
      if (!Array.isArray(binding.scopes) || binding.scopes.length < 1) {
        throw new KernelError(400, "INVALID_CREDENTIAL_REFERENCE", "Credential binding scopes are required.");
      }
    });
    const plan = { schema_version: "alphonse.promotion_local_deployment_plan.v0.1", proposal_id: proposalId,
      package_identity: proposal.package_identity, deployment_plan_id: localPlan.deployment_plan_id,
      configuration_values: configurationValues, credential_bindings: credentialBindings,
      adapter_bindings: adapterBindings };
    const command = { ...envelope, actor };
    const resolutionId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        await client.query(`INSERT INTO kernel_promotion_resolutions
          (resolution_id,installation_id,environment_id,proposal_id,package_identity,local_deployment_plan,
           plan_digest,configuration_fingerprint,resolved_by_actor_id,resolved_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [resolutionId, installationId, environmentId, proposalId,
          proposal.package_identity, JSON.stringify(plan), localPlan.plan_digest, sha256Digest(configurationValues),
          actor.id, acceptedAt]);
        return { aggregateType: "promotion_resolution", aggregateId: resolutionId,
          transitionType: "kernel.promotion.target_plan_resolved",
          transitionPayload: { proposal_id: proposalId, package_identity: proposal.package_identity,
            plan_digest: localPlan.plan_digest },
          result: { promotion_resolution: { resolution_id: resolutionId, proposal_id: proposalId,
            package_identity: proposal.package_identity, deployment_plan_id: localPlan.deployment_plan_id,
            plan_digest: localPlan.plan_digest, configuration_fingerprint: sha256Digest(configurationValues),
            credential_bindings: credentialBindings, adapter_bindings: adapterBindings,
            local_only: true, authority_granted: false,
            resolved_at: acceptedAt } } };
      }});
  }

  async function localReceipt(envelope, actor) {
    requireConfigured();
    const input = exact(envelope.input, ["proposal_id", "package_identity", "receipt_type", "local_reference"], "input");
    rejectSecrets(input.local_reference);
    if (!RECEIPT_TYPES.has(input.receipt_type)) throw new KernelError(400, "PROMOTION_RECEIPT_TYPE_INVALID", "Receipt type is unsupported.");
    string(input.proposal_id, "proposal_id");
    string(input.package_identity, "package_identity");
    object(input.local_reference, "local_reference");
    let predecessorReference = null;
    if (["deployment_plan_resolved", "deployed", "activated", "recovery_verified"].includes(input.receipt_type)) {
      const proposal = await getProposal(input.proposal_id);
      if (proposal.proposal.package_identity !== input.package_identity) {
        throw new KernelError(409, "PROMOTION_RECEIPT_SCOPE_MISMATCH", "Receipt Package differs from local proposal.");
      }
      if (Date.parse(proposal.proposal.expires_at) <= Date.now()) {
        throw new KernelError(409, "PROMOTION_PROPOSAL_EXPIRED", "Expired Promotion Proposal cannot receive target receipts.");
      }
      const predecessor = { deployed: "deployment_plan_resolved", activated: "deployed",
        recovery_verified: "activated" }[input.receipt_type];
      if (predecessor) {
        const prior = await pool.query(`SELECT receipt_id,authoritative_reference FROM kernel_promotion_receipts
          WHERE installation_id=$1 AND environment_id=$2 AND proposal_id=$3 AND package_identity=$4
           AND receipt_type=$5`, [installationId, environmentId, input.proposal_id, input.package_identity, predecessor]);
        if (!prior.rows[0]) {
          throw new KernelError(409, "LOCAL_PROMOTION_PREDECESSOR_MISSING",
            `${input.receipt_type} receipt requires a prior local ${predecessor} receipt.`);
        }
        predecessorReference = prior.rows[0].authoritative_reference;
      }
    }
    const evidence = await authoritativeEvidence(input.receipt_type, input.proposal_id,
      input.package_identity, input.local_reference, predecessorReference);
    const subjectDigest = sha256Digest(evidence);
    const command = { ...envelope, actor };
    const receiptId = randomUUID();
    const issuedAt = new Date().toISOString();
    const document = assertPromotionReceipt({ schema_version: "alphonse.promotion_receipt.v0.1",
      receipt_id: receiptId, proposal_id: input.proposal_id, environment_id: environmentId,
      environment_class: environmentClass, receipt_type: input.receipt_type,
      package_identity: input.package_identity, subject_digest: subjectDigest,
      local_reference_digest: sha256Digest(input.local_reference), outcome: "succeeded", issued_at: issuedAt });
    const signed = signCoordinationDocument(document, environmentPrivateKey);
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        await client.query(`INSERT INTO kernel_promotion_receipts
          (receipt_id,installation_id,environment_id,proposal_id,package_identity,receipt_type,
           authoritative_reference,signed_receipt,receipt_digest,created_by_actor_id,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [receiptId, installationId, environmentId,
          input.proposal_id, input.package_identity, input.receipt_type, JSON.stringify(evidence),
          JSON.stringify(signed), sha256Digest(signed), actor.id, acceptedAt]);
        await client.query(`INSERT INTO kernel_promotion_receipt_delivery_states
          (installation_id,environment_id,receipt_id,delivery_state) VALUES ($1,$2,$3,'pending')`,
        [installationId, environmentId, receiptId]);
        return { aggregateType: "promotion_receipt", aggregateId: receiptId,
          transitionType: "kernel.promotion.receipt_created",
          transitionPayload: { proposal_id: input.proposal_id, receipt_type: input.receipt_type,
            receipt_digest: sha256Digest(signed) },
          result: { promotion_receipt: { ...document, receipt_digest: sha256Digest(signed),
            authoritative_reference: evidence, delivery_state: "pending", authority_granted: false } } };
      }});
  }

  async function pushReceipt(envelope, receiptId, actor) {
    const replayed = await replay(envelope, "kernel.promotion_receipt.deliver_outbound", actor);
    if (replayed) return replayed;
    const binding = await activeBinding();
    const result = await pool.query(`SELECT r.signed_receipt,s.delivery_state FROM kernel_promotion_receipts r
      JOIN kernel_promotion_receipt_delivery_states s ON s.installation_id=r.installation_id
       AND s.environment_id=r.environment_id AND s.receipt_id=r.receipt_id
      WHERE r.installation_id=$1 AND r.environment_id=$2 AND r.receipt_id=$3`,
    [installationId, environmentId, receiptId]);
    if (!result.rows[0]) throw new KernelError(404, "PROMOTION_RECEIPT_NOT_FOUND", "Local Promotion Receipt does not exist.");
    const remote = result.rows[0].delivery_state === "delivered" ? null
      : await fetchJson(`${binding.coordinator_endpoint}/coordinator/v0/promotion-receipts`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(result.rows[0].signed_receipt)
      });
    const command = { ...envelope, actor };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        await client.query(`UPDATE kernel_promotion_receipt_delivery_states SET delivery_state='delivered',
          attempt_count=attempt_count+1,last_attempt_at=$4,delivered_at=COALESCE(delivered_at,$4)
          WHERE installation_id=$1 AND environment_id=$2 AND receipt_id=$3`,
        [installationId, environmentId, receiptId, acceptedAt]);
        return { aggregateType: "promotion_receipt_delivery", aggregateId: receiptId,
          transitionType: "kernel.promotion.receipt_delivered_outbound",
          transitionPayload: { receipt_id: receiptId, coordinator_id: binding.coordinator_id },
          result: { delivery: { receipt_id: receiptId, delivery_state: "delivered",
            promotion_status: remote?.promotion_status ?? null } } };
      }});
  }

  async function requestPromotion(envelope, actor) {
    requireConfigured();
    const replayed = await replay(envelope, "kernel.promotion.request_outbound", actor);
    if (replayed) return replayed;
    const input = exact(envelope.input, ["target_environment_id", "target_class", "package_identity",
      "manifest_digest", "package_artifact_digest", "dependency_lock", "source_receipt_digests",
      "compatibility", "change_summary", "required_configuration_schema", "gate_receipt_ids"], "input");
    rejectSecrets(input);
    const binding = await activeBinding();
    if (!Array.isArray(binding.promotion_scope.allowed_targets)
        || !binding.promotion_scope.allowed_targets.includes(input.target_class)) {
      throw new KernelError(409, "LOCAL_PROMOTION_SCOPE_DENIED", "Coordinator Binding does not permit this target class.");
    }
    if (!Array.isArray(input.gate_receipt_ids)) throw new KernelError(400, "PROMOTION_GATE_RECEIPTS_REQUIRED", "gate_receipt_ids must be an array.");
    const packageVersion = await requireLocalPackage(input.package_identity);
    if (packageVersion.manifest_digest !== input.manifest_digest
        || packageVersion.artifact_digest !== input.package_artifact_digest
        || packageVersion.dependency_digest !== sha256Digest(input.dependency_lock)) {
      throw new KernelError(409, "LOCAL_PACKAGE_BYTES_MISMATCH",
        "Promotion request does not match the exact local Package Version bytes and dependency lock.");
    }
    const gateResult = await pool.query(`SELECT signed_receipt,receipt_digest FROM kernel_promotion_receipts
      WHERE installation_id=$1 AND environment_id=$2 AND receipt_id = ANY($3::text[]) ORDER BY receipt_id`,
    [installationId, environmentId, input.gate_receipt_ids]);
    if (gateResult.rowCount !== input.gate_receipt_ids.length) {
      throw new KernelError(409, "PROMOTION_GATE_RECEIPT_NOT_FOUND", "Every gate receipt must be local and signed.");
    }
    const expectedSourceReceipts = gateResult.rows.map((row) => row.receipt_digest).sort();
    if (!Array.isArray(input.source_receipt_digests)
        || JSON.stringify([...input.source_receipt_digests].sort()) !== JSON.stringify(expectedSourceReceipts)) {
      throw new KernelError(409, "SOURCE_RECEIPT_DIGEST_MISMATCH",
        "Source receipt digests must exactly identify the signed local gate receipts.");
    }
    const now = new Date();
    const requestDocument = { schema_version: "alphonse.promotion_request.v0.1", request_id: randomUUID(),
      customer_id: binding.customer_id, source_environment_id: environmentId,
      target_environment_id: input.target_environment_id, source_class: environmentClass,
      target_class: input.target_class, package_identity: input.package_identity,
      manifest_digest: input.manifest_digest, package_artifact_digest: input.package_artifact_digest,
      dependency_lock: input.dependency_lock, source_receipt_digests: input.source_receipt_digests,
      compatibility: input.compatibility, change_summary: input.change_summary,
      required_configuration_schema: input.required_configuration_schema,
      gate_receipts: gateResult.rows.map((row) => row.signed_receipt), issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 10 * 60_000).toISOString() };
    const signedRequest = signCoordinationDocument(requestDocument, environmentPrivateKey);
    const remote = await fetchJson(`${binding.coordinator_endpoint}/coordinator/v0/promotion-requests`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signedRequest)
    });
    const proposal = verifyCoordinationEnvelope(remote.promotion_proposal, binding.coordinator_public_key,
      assertPromotionProposal);
    const scalarBindings = ["customer_id", "source_environment_id", "target_environment_id", "source_class",
      "target_class", "package_identity", "manifest_digest", "package_artifact_digest"];
    const structuredBindings = ["dependency_lock", "source_receipt_digests", "compatibility",
      "change_summary", "required_configuration_schema"];
    const proposalGates = [...proposal.gate_receipts].sort((left, right) => left.receipt_id.localeCompare(right.receipt_id));
    const requestGates = requestDocument.gate_receipts.map(({ document: receipt }) => ({
      type: receipt.receipt_type === "recovery_verified" ? "staging_recovery"
        : receipt.receipt_type === "deployed" ? "staging_deployed"
          : receipt.receipt_type === "activated" ? "staging_activated" : receipt.receipt_type,
      receipt_id: receipt.receipt_id, receipt_digest: sha256Digest(receipt),
      issuer_environment_id: receipt.environment_id
    })).sort((left, right) => left.receipt_id.localeCompare(right.receipt_id));
    if (scalarBindings.some((field) => proposal[field] !== requestDocument[field])
        || structuredBindings.some((field) => sha256Digest(proposal[field]) !== sha256Digest(requestDocument[field]))
        || sha256Digest(proposalGates) !== sha256Digest(requestGates)) {
      throw new KernelError(409, "PROMOTION_PROPOSAL_RESPONSE_MISMATCH",
        "Coordinator response does not bind the exact submitted Promotion Request.");
    }
    const command = { ...envelope, actor };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async () => ({ aggregateType: "promotion_request", aggregateId: requestDocument.request_id,
        transitionType: "kernel.promotion.requested_outbound",
        transitionPayload: { proposal_id: proposal.proposal_id, target_environment_id: proposal.target_environment_id,
          package_identity: proposal.package_identity },
        result: { promotion_proposal: { ...proposal, authority_granted: false },
          submitted_by_actor_id: actor.id, outbound_channel: true } }) });
  }

  async function revokeBinding(envelope, bindingId, actor) {
    const input = exact(envelope.input, ["reason", "expected_revision"], "input");
    string(input.reason, "reason");
    const command = { ...envelope, actor };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command),
      apply: async (client, { acceptedAt }) => {
        const stateResult = await client.query(`SELECT state,revision FROM kernel_coordinator_binding_states
          WHERE installation_id=$1 AND environment_id=$2 AND binding_id=$3 FOR UPDATE`,
        [installationId, environmentId, bindingId]);
        const state = stateResult.rows[0];
        if (!state) throw new KernelError(404, "COORDINATOR_BINDING_NOT_FOUND", "Coordinator Binding does not exist.");
        if (Number(state.revision) !== input.expected_revision) throw new KernelError(409, "REVISION_CONFLICT", "Coordinator Binding revision changed.");
        if (state.state === "revoked") throw new KernelError(409, "COORDINATOR_BINDING_REVOKED", "Coordinator Binding is already revoked.");
        await client.query(`UPDATE kernel_coordinator_binding_states SET state='revoked',revision=revision+1,updated_at=$4
          WHERE installation_id=$1 AND environment_id=$2 AND binding_id=$3`,
        [installationId, environmentId, bindingId, acceptedAt]);
        return { aggregateType: "coordinator_binding", aggregateId: bindingId,
          transitionType: "kernel.coordinator_binding.revoked",
          transitionPayload: { reason: input.reason },
          result: { coordinator_binding: { binding_id: bindingId, state: "revoked", revision: "1",
            revoked_at: acceptedAt, local_authority_changed: false } } };
      }});
  }

  async function getResolution(proposalId) {
    const result = await pool.query(`SELECT * FROM kernel_promotion_resolutions
      WHERE installation_id=$1 AND environment_id=$2 AND proposal_id=$3`, [installationId, environmentId, proposalId]);
    const row = result.rows[0];
    if (!row) throw new KernelError(404, "PROMOTION_RESOLUTION_NOT_FOUND", "Local Promotion Resolution does not exist.");
    return { resolution_id: row.resolution_id, proposal_id: row.proposal_id, package_identity: row.package_identity,
      deployment_plan_id: row.local_deployment_plan.deployment_plan_id, plan_digest: row.plan_digest,
      configuration_fingerprint: row.configuration_fingerprint,
      credential_bindings: row.local_deployment_plan.credential_bindings,
      adapter_bindings: row.local_deployment_plan.adapter_bindings,
      local_only: true, authority_granted: false, resolved_at: new Date(row.resolved_at).toISOString() };
  }

  return { environmentPublicKey, createBinding, registerOutbound, pollPromotions, getProposal, resolveProposal,
    localReceipt, pushReceipt, requestPromotion, revokeBinding, getResolution };
}
