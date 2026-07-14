import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FORBIDDEN_MEMORY_KEYS = new Set(["conversation_history", "messages", "hidden_memory", "transcript", "chat_history"]);

function string(value, path, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new KernelError(400, "INVALID_INPUT", `${path} is invalid.`);
  }
  return value.trim();
}

function uuid(value, path) {
  const candidate = string(value, path, 100);
  if (!UUID.test(candidate)) throw new KernelError(400, "INVALID_IDENTIFIER", `${path} must be a UUID.`);
  return candidate;
}

function digest(value, path) {
  const candidate = string(value, path, 80);
  if (!DIGEST.test(candidate)) throw new KernelError(400, "INVALID_DIGEST", `${path} must be a SHA-256 digest.`);
  return candidate;
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be an object.`);
  }
  return value;
}

function exact(value, path, keys) {
  const candidate = object(value, path);
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new KernelError(400, "INVALID_INPUT", `${path} has an invalid shape.`);
  }
  return candidate;
}

function timestamp(value, path) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be an ISO-8601 timestamp.`);
  }
  return new Date(value).toISOString();
}

function assertNoAmbientMemory(value, path = "input") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_MEMORY_KEYS.has(key.toLowerCase())) {
      throw new KernelError(400, "AMBIENT_MEMORY_PROHIBITED", `${path}.${key} is not accepted; handoffs carry structured state only.`);
    }
    assertNoAmbientMemory(child, `${path}.${key}`);
  }
}

function validateWorkload(value) {
  const workload = exact(value, "input.workload", ["run_intent", "workload_digest", "adapter", "resources", "network", "filesystem", "lease_seconds"]);
  const resources = exact(workload.resources, "input.workload.resources", ["memory_mb", "cpu_millis", "pids"]);
  const network = exact(workload.network, "input.workload.network", ["mode"]);
  const filesystem = exact(workload.filesystem, "input.workload.filesystem", ["root", "scratch_mb", "mounts"]);
  if (!Number.isInteger(resources.memory_mb) || resources.memory_mb < 32 || resources.memory_mb > 4096
    || !Number.isInteger(resources.cpu_millis) || resources.cpu_millis < 50 || resources.cpu_millis > 4000
    || !Number.isInteger(resources.pids) || resources.pids < 1 || resources.pids > 256) {
    throw new KernelError(400, "INVALID_WORKLOAD_LIMIT", "Workload resource limits are invalid.");
  }
  if (network.mode !== "none") throw new KernelError(400, "WORKLOAD_NETWORK_NOT_DENIED", "V0 workloads require default-deny networking.");
  if (filesystem.root !== "read_only" || !Array.isArray(filesystem.mounts) || filesystem.mounts.length !== 0
    || !Number.isInteger(filesystem.scratch_mb) || filesystem.scratch_mb < 1 || filesystem.scratch_mb > 1024) {
    throw new KernelError(400, "INVALID_WORKLOAD_FILESYSTEM", "V0 workloads require read-only root, bounded scratch, and no mounts.");
  }
  if (!Number.isInteger(workload.lease_seconds) || workload.lease_seconds < 5 || workload.lease_seconds > 900) {
    throw new KernelError(400, "INVALID_WORKLOAD_LEASE", "Workload lease must be between 5 and 900 seconds.");
  }
  return { run_intent: string(workload.run_intent, "input.workload.run_intent", 500),
    workload_digest: digest(workload.workload_digest, "input.workload.workload_digest"),
    adapter: string(workload.adapter, "input.workload.adapter", 100), resources, network, filesystem,
    lease_seconds: workload.lease_seconds };
}

export function validateHandoffInput(value) {
  assertNoAmbientMemory(value);
  const input = exact(value, "input", ["source_passport_id", "target_passport_id", "work_intent_id", "target_runtime",
    "exact_bindings", "context_receipt_ids", "delegation_proposal", "open_obligations", "workload", "expires_at"]);
  const exactBindings = exact(input.exact_bindings, "input.exact_bindings", ["package_version_id", "package_artifact_digest",
    "skill", "deployment_id", "capability_activation_id", "capability_export_id", "capability_contract_version",
    "capability_export_digest", "authority_digest"]);
  const skill = exact(exactBindings.skill, "input.exact_bindings.skill", ["package_id", "semantic_version", "export_id",
    "contract_version", "export_digest"]);
  const delegation = exact(input.delegation_proposal, "input.delegation_proposal", ["scope", "expires_at"]);
  object(delegation.scope, "input.delegation_proposal.scope");
  if (!Array.isArray(input.context_receipt_ids) || input.context_receipt_ids.length === 0 || input.context_receipt_ids.length > 100) {
    throw new KernelError(400, "INVALID_INPUT", "input.context_receipt_ids must be a bounded non-empty array.");
  }
  if (!Array.isArray(input.open_obligations) || input.open_obligations.length > 100
    || input.open_obligations.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    throw new KernelError(400, "INVALID_INPUT", "input.open_obligations must be a bounded object array.");
  }
  return {
    source_passport_id: uuid(input.source_passport_id, "input.source_passport_id"),
    target_passport_id: uuid(input.target_passport_id, "input.target_passport_id"),
    work_intent_id: uuid(input.work_intent_id, "input.work_intent_id"),
    target_runtime: object(input.target_runtime, "input.target_runtime"),
    exact_bindings: {
      package_version_id: uuid(exactBindings.package_version_id, "input.exact_bindings.package_version_id"),
      package_artifact_digest: digest(exactBindings.package_artifact_digest, "input.exact_bindings.package_artifact_digest"),
      skill: { package_id: string(skill.package_id, "skill.package_id", 200),
        semantic_version: string(skill.semantic_version, "skill.semantic_version", 100),
        export_id: string(skill.export_id, "skill.export_id", 200),
        contract_version: string(skill.contract_version, "skill.contract_version", 100),
        export_digest: digest(skill.export_digest, "skill.export_digest") },
      deployment_id: uuid(exactBindings.deployment_id, "input.exact_bindings.deployment_id"),
      capability_activation_id: uuid(exactBindings.capability_activation_id, "input.exact_bindings.capability_activation_id"),
      capability_export_id: string(exactBindings.capability_export_id, "input.exact_bindings.capability_export_id", 200),
      capability_contract_version: string(exactBindings.capability_contract_version, "input.exact_bindings.capability_contract_version", 100),
      capability_export_digest: digest(exactBindings.capability_export_digest, "input.exact_bindings.capability_export_digest"),
      authority_digest: digest(exactBindings.authority_digest, "input.exact_bindings.authority_digest")
    },
    context_receipt_ids: [...new Set(input.context_receipt_ids.map((id) => uuid(id, "input.context_receipt_ids[]")))],
    delegation_proposal: { scope: delegation.scope, expires_at: timestamp(delegation.expires_at, "input.delegation_proposal.expires_at") },
    open_obligations: input.open_obligations,
    workload: validateWorkload(input.workload),
    expires_at: timestamp(input.expires_at, "input.expires_at")
  };
}

function passportIsValid(passport) {
  return passport.validity_status === "valid";
}

function configuredSkill(passport, expected) {
  const configurations = Object.values(passport.package_skill_configuration ?? {});
  return configurations.some((configuration) => configuration?.package_id === expected.package_id
    && configuration?.version === expected.semantic_version
    && configuration?.skill_exports?.some((entry) => entry.export_id === expected.export_id
      && entry.contract_version === expected.contract_version && entry.export_digest === expected.export_digest));
}

function sign(secret, value) {
  return `hmac-sha256:${createHmac("sha256", secret).update(canonicalize(value)).digest("hex")}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHandoffService(database, identityIntent, contextService, packageService, deploymentService,
  installationId, environmentId, grantSecret, grantKeyId, observationSecret, observationKeyId) {
  const { pool, executeCommand } = database;

  async function getHandoff(handoffId, client = pool) {
    uuid(handoffId, "handoff_id");
    const result = await client.query(
      `SELECT * FROM kernel_handoffs WHERE installation_id=$1 AND environment_id=$2 AND handoff_id=$3`,
      [installationId, environmentId, handoffId]
    );
    if (!result.rows[0]) throw new KernelError(404, "HANDOFF_NOT_FOUND", "Hand Off does not exist.");
    const row = result.rows[0];
    return { ...row, state: row.state === "pending" && Date.now() >= Date.parse(row.expires_at) ? "expired" : row.state,
      conversation_history_received: false, hidden_memory_received: false };
  }

  async function propose(envelope, authenticatedPassport) {
    const input = validateHandoffInput(envelope.input);
    const command = { ...envelope, input, actor: { type: "agent", id: authenticatedPassport.agent_principal_id } };
    const handoffId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt, environment }) => {
        const source = await identityIntent.getPassport(input.source_passport_id, client);
        const target = await identityIntent.getPassport(input.target_passport_id, client);
        const intent = await identityIntent.getWorkIntent(input.work_intent_id, client);
        if (source.passport_id !== authenticatedPassport.passport_id) throw new KernelError(403, "HANDOFF_SOURCE_MISMATCH", "Authenticated Agent is not the handoff source.");
        if (!passportIsValid(source) || !passportIsValid(target)) throw new KernelError(409, "PASSPORT_NOT_VALID", "Both Passports must be currently valid.");
        if (intent.passport_id !== source.passport_id || intent.agent_principal_id !== source.agent_principal_id) {
          throw new KernelError(409, "HANDOFF_INTENT_MISMATCH", "Source does not own the confirmed Work Intent.");
        }
        if (!target.permitted_intent_classes.includes("runtime_execution")) {
          throw new KernelError(409, "TARGET_RUNTIME_NOT_PERMITTED", "Target Passport does not permit runtime_execution.");
        }
        if (sha256Digest(target.runtime) !== sha256Digest(input.target_runtime)) {
          throw new KernelError(409, "TARGET_RUNTIME_MISMATCH", "Target runtime does not match its Passport.");
        }
        if (!configuredSkill(target, input.exact_bindings.skill)) {
          throw new KernelError(409, "SKILL_VERSION_MISMATCH", "Target Passport does not bind the exact Skill version.");
        }
        const packageVersion = await packageService.getPackageVersion(input.exact_bindings.package_version_id);
        const deployment = await deploymentService.getDeployment(input.exact_bindings.deployment_id, client);
        const activation = await deploymentService.getCapabilityActivation(input.exact_bindings.capability_activation_id, client);
        const activeState = await client.query(`SELECT active_activation_id FROM kernel_capability_authority_states
          WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3`,
        [installationId, environmentId, activation.capability_key]);
        if (packageVersion.artifact_digest !== input.exact_bindings.package_artifact_digest
          || deployment.package_version_id !== packageVersion.package_version_id || deployment.work_intent_id !== intent.work_intent_id
          || activation.deployment_id !== deployment.deployment_id
          || activation.capability_export_id !== input.exact_bindings.capability_export_id
          || activation.capability_contract_version !== input.exact_bindings.capability_contract_version
          || activation.capability_export_digest !== input.exact_bindings.capability_export_digest
          || activation.authority_digest !== input.exact_bindings.authority_digest
          || activeState.rows[0]?.active_activation_id !== activation.capability_activation_id) {
          throw new KernelError(409, "HANDOFF_BINDING_MISMATCH", "Hand Off does not bind the exact active Package and Capability authority.");
        }
        for (const receiptId of input.context_receipt_ids) await contextService.getReceipt(receiptId);
        const expiresAt = input.expires_at;
        if (Date.parse(expiresAt) <= Date.parse(acceptedAt) || Date.parse(input.delegation_proposal.expires_at) > Date.parse(expiresAt)
          || Date.parse(expiresAt) > Date.parse(source.expires_at) || Date.parse(expiresAt) > Date.parse(target.expires_at)) {
          throw new KernelError(409, "HANDOFF_EXPIRY_INVALID", "Hand Off and Delegation must fit both Passport validity windows.");
        }
        await client.query(
          `INSERT INTO kernel_task_responsibilities
           (installation_id,environment_id,work_intent_id,responsible_passport_id,responsible_agent_principal_id,revision,updated_at)
           VALUES ($1,$2,$3,$4,$5,0,$6) ON CONFLICT (installation_id,environment_id,work_intent_id) DO NOTHING`,
          [installationId, environmentId, intent.work_intent_id, source.passport_id, source.agent_principal_id, acceptedAt]
        );
        const responsibility = await client.query(
          `SELECT * FROM kernel_task_responsibilities WHERE installation_id=$1 AND environment_id=$2 AND work_intent_id=$3 FOR UPDATE`,
          [installationId, environmentId, intent.work_intent_id]
        );
        if (responsibility.rows[0].responsible_passport_id !== source.passport_id) {
          throw new KernelError(409, "SOURCE_AUTHORITY_CLOSED", "Source no longer holds task responsibility.");
        }
        const ledgerCursor = Number(environment.next_sequence) - 1;
        await client.query(
          `INSERT INTO kernel_handoffs
           (handoff_id,installation_id,environment_id,work_intent_id,source_passport_id,source_agent_principal_id,
            target_passport_id,target_agent_principal_id,target_runtime,exact_bindings,context_receipt_ids,ledger_cursor,
            delegation_proposal,open_obligations,workload_spec,workload_digest,expires_at,state,proposed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending',$18)`,
          [handoffId, installationId, environmentId, intent.work_intent_id, source.passport_id, source.agent_principal_id,
            target.passport_id, target.agent_principal_id, input.target_runtime, input.exact_bindings,
            JSON.stringify(input.context_receipt_ids), ledgerCursor, input.delegation_proposal,
            JSON.stringify(input.open_obligations), input.workload, input.workload.workload_digest, expiresAt, acceptedAt]
        );
        return { aggregateType: "handoff", aggregateId: handoffId, transitionType: "kernel.handoff.proposed",
          transitionPayload: { work_intent_id: intent.work_intent_id, target_passport_id: target.passport_id, ledger_cursor: ledgerCursor },
          result: { handoff: { handoff_id: handoffId, work_intent_id: intent.work_intent_id,
            source_passport_id: source.passport_id, target_passport_id: target.passport_id, target_runtime: input.target_runtime,
            exact_bindings: input.exact_bindings, context_receipt_ids: input.context_receipt_ids, ledger_cursor: ledgerCursor,
            delegation_proposal: input.delegation_proposal, open_obligations: input.open_obligations,
            workload_spec: input.workload, expires_at: expiresAt, state: "pending", proposed_at: acceptedAt,
            conversation_history_received: false, hidden_memory_received: false } } };
      }
    });
  }

  async function reject(envelope, handoffId, authenticatedPassport) {
    const reason = string(envelope.input.reason, "input.reason", 1000);
    const command = { ...envelope, input: { reason, handoff_id: uuid(handoffId, "handoff_id") },
      actor: { type: "agent", id: authenticatedPassport.agent_principal_id } };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt }) => {
        const handoff = await getHandoff(handoffId, client);
        if (handoff.target_passport_id !== authenticatedPassport.passport_id) throw new KernelError(403, "HANDOFF_TARGET_MISMATCH", "Only target may reject Hand Off.");
        if (handoff.state !== "pending") throw new KernelError(409, "HANDOFF_NOT_PENDING", "Hand Off is not pending.");
        await client.query(`UPDATE kernel_handoffs SET state='rejected',decided_at=$4,rejection_reason=$5
          WHERE installation_id=$1 AND environment_id=$2 AND handoff_id=$3`, [installationId, environmentId, handoffId, acceptedAt, reason]);
        return { aggregateType: "handoff", aggregateId: handoffId, transitionType: "kernel.handoff.rejected",
          transitionPayload: { reason }, result: { handoff: { ...handoff, state: "rejected", decided_at: acceptedAt, rejection_reason: reason } } };
      }
    });
  }

  async function accept(envelope, handoffId, authenticatedPassport) {
    const input = exact(envelope.input, "input", ["workload_digest"]);
    const suppliedDigest = digest(input.workload_digest, "input.workload_digest");
    const command = { ...envelope, input: { handoff_id: uuid(handoffId, "handoff_id"), workload_digest: suppliedDigest },
      actor: { type: "agent", id: authenticatedPassport.agent_principal_id } };
    const delegationId = randomUUID();
    const transferId = randomUUID();
    const grantId = randomUUID();
    const nonce = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt, environment }) => {
        const handoff = await getHandoff(handoffId, client);
        if (handoff.target_passport_id !== authenticatedPassport.passport_id) throw new KernelError(403, "HANDOFF_TARGET_MISMATCH", "Only exact target may accept Hand Off.");
        if (handoff.state === "expired") throw new KernelError(409, "HANDOFF_EXPIRED", "Hand Off expired before acceptance.");
        if (handoff.state !== "pending") throw new KernelError(409, "HANDOFF_NOT_PENDING", "Hand Off is not pending.");
        if (suppliedDigest !== handoff.workload_digest) throw new KernelError(409, "WORKLOAD_DIGEST_MISMATCH", "Target did not accept exact workload bytes.");
        const target = await identityIntent.getPassport(handoff.target_passport_id, client);
        if (!passportIsValid(target)) throw new KernelError(409, "PASSPORT_NOT_VALID", "Target Passport is not valid.");
        const responsibilityResult = await client.query(
          `SELECT * FROM kernel_task_responsibilities WHERE installation_id=$1 AND environment_id=$2 AND work_intent_id=$3 FOR UPDATE`,
          [installationId, environmentId, handoff.work_intent_id]
        );
        const responsibility = responsibilityResult.rows[0];
        if (!responsibility || responsibility.responsible_passport_id !== handoff.source_passport_id) {
          throw new KernelError(409, "SOURCE_AUTHORITY_CLOSED", "Source responsibility changed before target acceptance.");
        }
        const delegationExpiresAt = handoff.delegation_proposal.expires_at;
        const requestedGrantExpiry = new Date(Date.parse(acceptedAt) + handoff.workload_spec.lease_seconds * 1000).toISOString();
        const grantExpiresAt = new Date(Math.min(Date.parse(requestedGrantExpiry), Date.parse(delegationExpiresAt),
          Date.parse(handoff.expires_at), Date.parse(target.expires_at))).toISOString();
        await client.query(
          `INSERT INTO kernel_delegations
           (delegation_id,installation_id,environment_id,handoff_id,work_intent_id,source_passport_id,target_passport_id,
            target_agent_principal_id,scope,valid_from,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [delegationId, installationId, environmentId, handoffId, handoff.work_intent_id, handoff.source_passport_id,
            handoff.target_passport_id, handoff.target_agent_principal_id, handoff.delegation_proposal.scope, acceptedAt, delegationExpiresAt]
        );
        const fromRevision = Number(responsibility.revision);
        await client.query(
          `UPDATE kernel_task_responsibilities SET responsible_passport_id=$4,responsible_agent_principal_id=$5,
           delegation_id=$6,revision=$7,updated_at=$8 WHERE installation_id=$1 AND environment_id=$2 AND work_intent_id=$3`,
          [installationId, environmentId, handoff.work_intent_id, handoff.target_passport_id,
            handoff.target_agent_principal_id, delegationId, fromRevision + 1, acceptedAt]
        );
        await client.query(
          `INSERT INTO kernel_responsibility_transfers
           (transfer_id,installation_id,environment_id,handoff_id,delegation_id,work_intent_id,from_passport_id,
            to_passport_id,from_revision,to_revision,transferred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [transferId, installationId, environmentId, handoffId, delegationId, handoff.work_intent_id,
            handoff.source_passport_id, handoff.target_passport_id, fromRevision, fromRevision + 1, acceptedAt]
        );
        const grant = { workload_grant_id: grantId, installation_id: installationId, environment_id: environmentId,
          execution_epoch: Number(environment.execution_epoch), handoff_id: handoffId, delegation_id: delegationId,
          work_intent_id: handoff.work_intent_id, target_passport_id: handoff.target_passport_id,
          run_intent: handoff.workload_spec.run_intent, workload_digest: handoff.workload_digest,
          adapter: handoff.workload_spec.adapter, resources: handoff.workload_spec.resources,
          network: handoff.workload_spec.network, filesystem: handoff.workload_spec.filesystem,
          issued_at: acceptedAt, expires_at: grantExpiresAt, nonce, key_id: grantKeyId,
          external_effect_authority: false, dispatch_permit_required: true };
        const grantDigest = sha256Digest(grant);
        const signature = sign(grantSecret, grant);
        await client.query(
          `INSERT INTO kernel_workload_grants
           (workload_grant_id,installation_id,environment_id,handoff_id,delegation_id,execution_epoch,run_intent,
            workload_digest,adapter,resources,network,filesystem,issued_at,expires_at,nonce,key_id,grant_document,grant_digest,signature)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [grantId, installationId, environmentId, handoffId, delegationId, grant.execution_epoch, grant.run_intent,
            grant.workload_digest, grant.adapter, grant.resources, grant.network, grant.filesystem,
            acceptedAt, grantExpiresAt, nonce, grantKeyId, grant, grantDigest, signature]
        );
        await client.query(`UPDATE kernel_handoffs SET state='accepted',decided_at=$4
          WHERE installation_id=$1 AND environment_id=$2 AND handoff_id=$3`, [installationId, environmentId, handoffId, acceptedAt]);
        return { aggregateType: "handoff", aggregateId: handoffId, transitionType: "kernel.handoff.accepted",
          transitionPayload: { delegation_id: delegationId, transfer_id: transferId, workload_grant_id: grantId },
          result: { handoff: { ...handoff, state: "accepted", decided_at: acceptedAt },
            delegation: { delegation_id: delegationId, handoff_id: handoffId, work_intent_id: handoff.work_intent_id,
              scope: handoff.delegation_proposal.scope, valid_from: acceptedAt, expires_at: delegationExpiresAt },
            responsibility_transfer: { transfer_id: transferId, from_passport_id: handoff.source_passport_id,
              to_passport_id: handoff.target_passport_id, from_revision: fromRevision, to_revision: fromRevision + 1 },
            workload_grant: { ...grant, grant_digest: grantDigest, signature } } };
      }
    });
  }

  async function getGrant(grantId, client = pool) {
    uuid(grantId, "workload_grant_id");
    const result = await client.query(`SELECT * FROM kernel_workload_grants
      WHERE installation_id=$1 AND environment_id=$2 AND workload_grant_id=$3`, [installationId, environmentId, grantId]);
    if (!result.rows[0]) throw new KernelError(404, "WORKLOAD_GRANT_NOT_FOUND", "Workload Grant does not exist.");
    const row = result.rows[0];
    if (sha256Digest(row.grant_document) !== row.grant_digest || !safeEqual(row.signature, sign(grantSecret, row.grant_document))) {
      throw new KernelError(500, "INTEGRITY_VIOLATION", "Stored Workload Grant signature or digest is invalid.");
    }
    return { ...row.grant_document, grant_digest: row.grant_digest, signature: row.signature };
  }

  async function checkWorkloadGate(input) {
    const grant = await getGrant(input.workload_grant_id);
    const suppliedDigest = digest(input.workload_digest, "workload_digest");
    if (suppliedDigest !== grant.workload_digest) throw new KernelError(409, "WORKLOAD_DIGEST_MISMATCH", "Workload bytes do not match grant.");
    const environment = await database.getEnvironment(installationId, environmentId);
    if (Number(environment.execution_epoch) !== Number(grant.execution_epoch)) {
      throw new KernelError(409, "ENVIRONMENT_EPOCH_FENCED", "Workload Grant belongs to an old Environment epoch.");
    }
    if (Date.now() >= Date.parse(grant.expires_at)) throw new KernelError(409, "WORKLOAD_LEASE_EXPIRED", "Workload Grant lease expired.");
    return { admissible: true, basis: "current_epoch_unexpired_exact_workload", workload_grant_id: grant.workload_grant_id,
      execution_epoch: Number(grant.execution_epoch), external_effect_authority: false, dispatch_permit_required: true };
  }

  async function advanceEpoch(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt, environment }) => {
        const fromEpoch = Number(environment.execution_epoch);
        await client.query(`UPDATE kernel_environments SET execution_epoch=$3,updated_at=$4
          WHERE installation_id=$1 AND environment_id=$2`, [installationId, environmentId, fromEpoch + 1, acceptedAt]);
        return { aggregateType: "kernel_environment", aggregateId: environmentId,
          transitionType: "kernel.environment.execution_epoch.advanced", fromRevision: BigInt(environment.revision),
          toRevision: BigInt(environment.revision), transitionPayload: { from_epoch: fromEpoch, to_epoch: fromEpoch + 1 },
          result: { execution_epoch: { from_epoch: fromEpoch, to_epoch: fromEpoch + 1, advanced_at: acceptedAt } } };
      }
    });
  }

  async function recordObservation(observation) {
    const normalized = exact(observation, "observation", ["observation_id", "workload_grant_id", "workload_instance_id",
      "sequence", "observation_type", "identity", "observed_at", "payload_digest", "previous_observation_digest", "key_id", "signature"]);
    const observationId = uuid(normalized.observation_id, "observation.observation_id");
    const workloadInstanceId = uuid(normalized.workload_instance_id, "observation.workload_instance_id");
    const grant = await getGrant(normalized.workload_grant_id);
    const identity = exact(normalized.identity, "observation.identity", ["namespace_id", "cgroup_path", "boot_id", "start_identity", "workload_nonce"]);
    for (const key of ["namespace_id", "cgroup_path", "boot_id", "start_identity"]) string(identity[key], `observation.identity.${key}`, 500);
    if (identity.workload_nonce !== grant.nonce) throw new KernelError(409, "WORKLOAD_IDENTITY_MISMATCH", "Host identity nonce does not match Workload Grant.");
    if (!Number.isInteger(normalized.sequence) || normalized.sequence < 1) throw new KernelError(400, "INVALID_OBSERVATION_SEQUENCE", "Observation sequence is invalid.");
    const unsigned = { ...normalized };
    delete unsigned.signature;
    if (normalized.key_id !== observationKeyId || !safeEqual(normalized.signature, sign(observationSecret, unsigned))) {
      throw new KernelError(403, "INVALID_HOST_OBSERVATION_SIGNATURE", "Host observation signature is invalid.");
    }
    const observationDigest = sha256Digest(unsigned);
    const command = { command_id: `host-observation:${observationId}`, operation_id: "kernel.host_observation.record",
      actor: { type: "system", id: observationKeyId }, input: { observation_id: observationId, observation_digest: observationDigest } };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command, observation: normalized }),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`host-observation:${workloadInstanceId}`]);
        const previous = await client.query(`SELECT observation_digest FROM kernel_host_observations
          WHERE installation_id=$1 AND environment_id=$2 AND workload_instance_id=$3 ORDER BY sequence DESC LIMIT 1`,
        [installationId, environmentId, workloadInstanceId]);
        const expectedPrevious = previous.rows[0]?.observation_digest ?? null;
        if (normalized.previous_observation_digest !== expectedPrevious) {
          throw new KernelError(409, "OBSERVATION_CHAIN_MISMATCH", "Host observation chain does not continue from latest fact.");
        }
        await client.query(`INSERT INTO kernel_host_observations
          (observation_id,installation_id,environment_id,workload_grant_id,workload_instance_id,sequence,
           observation_type,identity,observed_at,payload_digest,previous_observation_digest,observation_digest,key_id,signature)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [observationId, installationId, environmentId, grant.workload_grant_id, workloadInstanceId, normalized.sequence,
          string(normalized.observation_type, "observation.observation_type", 100), identity,
          timestamp(normalized.observed_at, "observation.observed_at"), digest(normalized.payload_digest, "observation.payload_digest"),
          normalized.previous_observation_digest, observationDigest, normalized.key_id, normalized.signature]);
        return { aggregateType: "workload_instance", aggregateId: workloadInstanceId,
          transitionType: "kernel.host_observation.recorded", transitionPayload: { observation_type: normalized.observation_type,
            observation_digest: observationDigest }, result: { host_observation: { ...normalized, observation_digest: observationDigest,
              recorded_at: acceptedAt } } };
      }
    });
  }

  async function getButlerProjection() {
    const result = await pool.query(`SELECT handoff_id FROM kernel_handoffs
      WHERE installation_id=$1 AND environment_id=$2 ORDER BY proposed_at DESC`, [installationId, environmentId]);
    return Promise.all(result.rows.map((row) => getHandoff(row.handoff_id)));
  }

  return { propose, reject, accept, getHandoff, getGrant, checkWorkloadGate, advanceEpoch, recordObservation,
    getButlerProjection };
}
