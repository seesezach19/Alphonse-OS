import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import { toEpochMilliseconds } from "./execution-service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

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

function strings(value, path, maximum = 100) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum
    || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be a bounded string array.`);
  }
  const normalized = value.map((entry) => entry.trim());
  if (new Set(normalized).size !== normalized.length) throw new KernelError(400, "INVALID_INPUT", `${path} contains duplicates.`);
  return normalized;
}

function timestamp(value, path) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be an ISO-8601 timestamp.`);
  }
  return new Date(value).toISOString();
}

function sameStrings(left, right) {
  return canonicalize([...left].sort()) === canonicalize([...right].sort());
}

export function validateCorrectionAdmissionInput(value) {
  const input = exact(value, "input", ["effect_idempotency_key", "passport_id", "work_intent_id", "delegation_id",
    "workload_grant_id", "capability_activation_id", "package_version_id", "context_receipt_ids", "target", "action",
    "requested_value", "limits", "credential_binding", "adapter", "evidence_requirements", "recovery", "expires_at"]);
  const target = exact(input.target, "input.target", ["system", "resource", "subject"]);
  const requestedValue = exact(input.requested_value, "input.requested_value", ["quantity"]);
  const limits = exact(input.limits, "input.limits", ["maximum_items", "maximum_quantity"]);
  const credential = exact(input.credential_binding, "input.credential_binding", ["binding_ref", "revision", "scopes"]);
  const adapter = exact(input.adapter, "input.adapter", ["export_id", "contract_version", "export_digest"]);
  const recovery = exact(input.recovery, "input.recovery", ["strategy", "uncertainty"]);
  if (!Number.isInteger(limits.maximum_items) || limits.maximum_items !== 1
    || !Number.isInteger(limits.maximum_quantity) || limits.maximum_quantity < 0 || limits.maximum_quantity > 1_000_000
    || !Number.isInteger(requestedValue.quantity) || requestedValue.quantity < 0
    || requestedValue.quantity > limits.maximum_quantity) {
    throw new KernelError(400, "EFFECT_LIMIT_INVALID", "Correction quantity exceeds exact bounded limits.");
  }
  return {
    effect_idempotency_key: string(input.effect_idempotency_key, "input.effect_idempotency_key", 200),
    passport_id: uuid(input.passport_id, "input.passport_id"),
    work_intent_id: uuid(input.work_intent_id, "input.work_intent_id"),
    delegation_id: uuid(input.delegation_id, "input.delegation_id"),
    workload_grant_id: uuid(input.workload_grant_id, "input.workload_grant_id"),
    capability_activation_id: uuid(input.capability_activation_id, "input.capability_activation_id"),
    package_version_id: uuid(input.package_version_id, "input.package_version_id"),
    context_receipt_ids: strings(input.context_receipt_ids, "input.context_receipt_ids")
      .map((entry) => uuid(entry, "context_receipt_id")),
    target: { system: string(target.system, "input.target.system", 100),
      resource: string(target.resource, "input.target.resource", 160),
      subject: string(target.subject, "input.target.subject", 200) },
    action: string(input.action, "input.action", 100),
    requested_value: { quantity: requestedValue.quantity },
    limits: { maximum_items: limits.maximum_items, maximum_quantity: limits.maximum_quantity },
    credential_binding: { binding_ref: string(credential.binding_ref, "input.credential_binding.binding_ref", 300),
      revision: string(credential.revision, "input.credential_binding.revision", 160),
      scopes: strings(credential.scopes, "input.credential_binding.scopes", 20) },
    adapter: { export_id: string(adapter.export_id, "input.adapter.export_id", 200),
      contract_version: string(adapter.contract_version, "input.adapter.contract_version", 100),
      export_digest: digest(adapter.export_digest, "input.adapter.export_digest") },
    evidence_requirements: strings(input.evidence_requirements, "input.evidence_requirements", 20),
    recovery: { strategy: string(recovery.strategy, "input.recovery.strategy", 200),
      uncertainty: string(recovery.uncertainty, "input.recovery.uncertainty", 300) },
    expires_at: timestamp(input.expires_at, "input.expires_at")
  };
}

export function signDispatchPermit(document, secret) {
  return `hmac-sha256:${createHmac("sha256", secret).update(canonicalize(document)).digest("hex")}`;
}

export function verifyDispatchPermit(document, signature, secret) {
  const expected = Buffer.from(signDispatchPermit(document, secret), "utf8");
  const supplied = Buffer.from(String(signature), "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createEffectService(database, identityIntent, contextService, packageService, deploymentService,
  handoffService, executionService, installationId, environmentId, permitSecret, permitKeyId,
  trustedAdapterUrl, kernelAdapterToken, recoveryService, adapterDispatchTimeoutMs = 2_000) {
  const { pool, executeCommand } = database;

  async function getEffect(effectId, client = pool) {
    uuid(effectId, "effect_id");
    const result = await client.query(`SELECT e.*,s.status,s.evidence_record_id,s.dispatch_started_at,s.completed_at,
        s.was_uncertain,s.recovery_case_id,s.updated_at
      FROM kernel_effect_records e JOIN kernel_effect_states s ON s.installation_id=e.installation_id
       AND s.environment_id=e.environment_id AND s.effect_id=e.effect_id
      WHERE e.installation_id=$1 AND e.environment_id=$2 AND e.effect_id=$3`,
    [installationId, environmentId, effectId]);
    if (!result.rows[0]) throw new KernelError(404, "EFFECT_NOT_FOUND", "Effect Record does not exist.");
    return { ...result.rows[0], immutable_record: true };
  }

  async function getPermit(permitId, client = pool) {
    uuid(permitId, "permit_id");
    const result = await client.query(`SELECT p.*,s.status,s.consumed_at,s.brokered_at,s.updated_at
      FROM kernel_dispatch_permits p JOIN kernel_dispatch_permit_states s ON s.installation_id=p.installation_id
       AND s.environment_id=p.environment_id AND s.permit_id=p.permit_id
      WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.permit_id=$3`,
    [installationId, environmentId, permitId]);
    if (!result.rows[0]) throw new KernelError(404, "DISPATCH_PERMIT_NOT_FOUND", "Dispatch Permit does not exist.");
    const row = result.rows[0];
    if (sha256Digest(row.permit_document) !== row.permit_digest
      || !verifyDispatchPermit(row.permit_document, row.signature, permitSecret)) {
      throw new KernelError(500, "INTEGRITY_VIOLATION", "Dispatch Permit digest or signature is invalid.");
    }
    return { ...row, immutable_record: true };
  }

  async function bundle(effectId, client = pool) {
    const effect = await getEffect(effectId, client);
    const permitResult = await client.query(`SELECT permit_id FROM kernel_dispatch_permits
      WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3`, [installationId, environmentId, effectId]);
    return { effect_record: effect, dispatch_permit: await getPermit(permitResult.rows[0].permit_id, client),
      run: await executionService.getRun(effect.run_id, client),
      execution_envelope: await executionService.getEnvelope(effect.envelope_id, client) };
  }

  async function activeCorrectionAuthority(input, acceptedAt, client) {
    const passport = await identityIntent.getPassport(input.passport_id, client);
    if (passport.validity_status !== "valid" || toEpochMilliseconds(passport.expires_at) <= toEpochMilliseconds(acceptedAt)) {
      throw new KernelError(409, "PASSPORT_NOT_VALID", "Runtime Passport is not valid for correction admission.");
    }
    const intent = await identityIntent.getWorkIntent(input.work_intent_id, client);
    const delegationResult = await client.query(`SELECT * FROM kernel_delegations
      WHERE installation_id=$1 AND environment_id=$2 AND delegation_id=$3`,
    [installationId, environmentId, input.delegation_id]);
    const delegation = delegationResult.rows[0];
    if (!delegation || delegation.work_intent_id !== intent.work_intent_id
      || delegation.target_passport_id !== passport.passport_id
      || delegation.target_agent_principal_id !== passport.agent_principal_id) {
      throw new KernelError(409, "DELEGATION_MISMATCH", "Correction requires exact Runtime Delegation.");
    }
    if (toEpochMilliseconds(delegation.expires_at) <= toEpochMilliseconds(acceptedAt)) {
      throw new KernelError(409, "DELEGATION_EXPIRED", "Delegation expired before correction admission.");
    }
    const responsibility = await client.query(`SELECT * FROM kernel_task_responsibilities
      WHERE installation_id=$1 AND environment_id=$2 AND work_intent_id=$3`,
    [installationId, environmentId, input.work_intent_id]);
    if (responsibility.rows[0]?.responsible_passport_id !== passport.passport_id
      || responsibility.rows[0]?.delegation_id !== delegation.delegation_id) {
      throw new KernelError(409, "RUNTIME_RESPONSIBILITY_MISMATCH", "Runtime does not hold current task responsibility.");
    }
    const grant = await handoffService.getGrant(input.workload_grant_id, client);
    if (grant.target_passport_id !== passport.passport_id || grant.work_intent_id !== input.work_intent_id
      || grant.delegation_id !== input.delegation_id || grant.network.mode !== "none"
      || grant.external_effect_authority !== false || grant.dispatch_permit_required !== true) {
      throw new KernelError(409, "WORKLOAD_GRANT_MISMATCH", "Correction requires exact authority-free networkless Workload Grant.");
    }
    await handoffService.checkWorkloadGate({ workload_grant_id: grant.workload_grant_id,
      workload_digest: grant.workload_digest });
    const activation = await deploymentService.getCapabilityActivation(input.capability_activation_id, client)
      .catch((error) => {
        if (error.code === "CAPABILITY_ACTIVATION_NOT_FOUND") throw new KernelError(409, "CAPABILITY_INACTIVE", "Correction Capability is inactive.");
        throw error;
      });
    const card = await deploymentService.getActionCard(activation.deployment_id, activation.capability_export_id, client);
    if (card.states.capability_activation !== "active" || card.capability_activation_id !== input.capability_activation_id
      || activation.package_version_id !== input.package_version_id) {
      throw new KernelError(409, "CAPABILITY_INACTIVE", "Correction requires current exact Capability activation.");
    }
    if (card.write_target.length !== 1 || card.write_target[0].system !== input.target.system
      || card.write_target[0].target !== input.target.resource
      || card.write_target[0].action !== input.action || card.limits[0].maximum_items < input.limits.maximum_items) {
      throw new KernelError(409, "EFFECT_BOUNDS_EXCEEDED", "Correction target, action, or item limits exceed active authority.");
    }
    if (!card.credential_scope || canonicalize(card.credential_scope) !== canonicalize(input.credential_binding)) {
      throw new KernelError(409, "CREDENTIAL_REVISION_MISMATCH", "Correction requires exact active credential binding revision and scopes.");
    }
    if (!sameStrings(card.evidence.required, input.evidence_requirements)
      || canonicalize(card.recovery) !== canonicalize(input.recovery)) {
      throw new KernelError(409, "ACCOUNTABILITY_CONTRACT_MISMATCH", "Evidence and recovery must match active Accountability Contract.");
    }
    const packageVersion = await packageService.getPackageVersion(input.package_version_id);
    const capability = packageVersion.candidate.exports.find((entry) => entry.export_id === activation.capability_export_id);
    const adapter = packageVersion.candidate.exports.find((entry) => entry.export_id === capability?.content.adapter_ref);
    if (!adapter || adapter.kind !== "adapter" || adapter.export_id !== input.adapter.export_id
      || adapter.contract_version !== input.adapter.contract_version || sha256Digest(adapter.content) !== input.adapter.export_digest) {
      throw new KernelError(409, "ADAPTER_VERSION_MISMATCH", "Correction requires exact trusted adapter version.");
    }
    if (card.adapter_binding?.adapter_export_id !== input.adapter.export_id
      || card.adapter_binding?.adapter_export_digest !== input.adapter.export_digest
      || card.adapter_binding?.target_system !== input.target.system) {
      throw new KernelError(409, "ADAPTER_TARGET_SYSTEM_MISMATCH",
        "Correction target must match the exact active trusted adapter binding.");
    }
    const receipts = [];
    for (const receiptId of input.context_receipt_ids) {
      const receipt = await contextService.getReceipt(receiptId);
      const contextGrant = await contextService.getGrant(receipt.grant_id, client);
      if (contextGrant.passport_id !== passport.passport_id || contextGrant.work_intent_id !== input.work_intent_id
        || contextGrant.delegation_id !== input.delegation_id
        || toEpochMilliseconds(contextGrant.expires_at) <= toEpochMilliseconds(acceptedAt)) {
        throw new KernelError(409, "EFFECT_CONTEXT_MISMATCH", "Correction context does not bind exact Runtime authority.");
      }
      if (!receipt.item_references.some((item) => item.subject === input.target.subject)
        || !input.target.subject || !card.source_reads.sources.every((source) => receipt.item_references.some((item) => item.source === source))) {
        throw new KernelError(409, "EFFECT_CONTEXT_MISMATCH", "Correction context lacks exact target or required sources.");
      }
      for (const claim of receipt.freshness_claims) {
        if (toEpochMilliseconds(acceptedAt) - toEpochMilliseconds(claim.observed_at)
          > card.source_reads.max_age_seconds * 1000) throw new KernelError(409, "STALE_CONTEXT", "Correction context is stale.");
      }
      receipts.push({ receipt, contextGrant });
    }
    return { passport, delegation, grant, activation, card, adapter, receipts };
  }

  async function admitCorrection(envelope, authenticatedPassport) {
    const input = validateCorrectionAdmissionInput(envelope.input);
    if (authenticatedPassport.passport_id !== input.passport_id) {
      throw new KernelError(403, "EXECUTION_PASSPORT_MISMATCH", "Authenticated Runtime Passport does not match correction admission.");
    }
    const command = { ...envelope, input, actor: { type: "agent", id: authenticatedPassport.agent_principal_id } };
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, input });
    const envelopeId = randomUUID();
    const runId = randomUUID();
    const effectId = randomUUID();
    const permitId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`effect-admission:${installationId}:${environmentId}:${input.effect_idempotency_key}`]);
        const existing = await client.query(`SELECT effect_id,request_digest FROM kernel_effect_records
          WHERE installation_id=$1 AND environment_id=$2 AND effect_idempotency_key=$3`,
        [installationId, environmentId, input.effect_idempotency_key]);
        if (existing.rows[0]) {
          if (existing.rows[0].request_digest !== requestDigest) {
            throw new KernelError(409, "EFFECT_IDEMPOTENCY_CONFLICT", "Effect idempotency identity binds different correction bytes.");
          }
          return { aggregateType: "effect", aggregateId: existing.rows[0].effect_id,
            transitionType: "kernel.effect.replayed", transitionPayload: { effect_idempotency_key: input.effect_idempotency_key },
            result: { ...(await bundle(existing.rows[0].effect_id, client)), domain_replayed: true } };
        }
        const authority = await activeCorrectionAuthority(input, acceptedAt, client);
        const ceilings = [toEpochMilliseconds(input.expires_at), toEpochMilliseconds(authority.passport.expires_at),
          toEpochMilliseconds(authority.delegation.expires_at), toEpochMilliseconds(authority.grant.expires_at),
          ...authority.receipts.map(({ contextGrant }) => toEpochMilliseconds(contextGrant.expires_at)),
          ...authority.receipts.flatMap(({ receipt }) => receipt.freshness_claims
            .map((claim) => toEpochMilliseconds(claim.observed_at) + authority.card.source_reads.max_age_seconds * 1000))];
        const correctionExpiry = Math.min(...ceilings);
        if (toEpochMilliseconds(input.expires_at) <= toEpochMilliseconds(acceptedAt)
          || toEpochMilliseconds(input.expires_at) > correctionExpiry) {
          throw new KernelError(409, "EFFECT_EXPIRY_INVALID", "Correction expiry exceeds an authority, workload, or context lease.");
        }
        const effectRequest = { effect_id: effectId, effect_idempotency_key: input.effect_idempotency_key,
          target: input.target, action: input.action, requested_value: input.requested_value, limits: input.limits,
          context_receipt_ids: input.context_receipt_ids };
        const permitExpiry = new Date(Math.min(correctionExpiry, toEpochMilliseconds(acceptedAt) + 15_000)).toISOString();
        const permitDocument = { permit_id: permitId, effect_id: effectId, run_id: runId,
          workload_grant_id: input.workload_grant_id, passport_id: input.passport_id,
          capability_activation_id: input.capability_activation_id, request_digest: sha256Digest(effectRequest),
          effect_idempotency_key: input.effect_idempotency_key, target: input.target, action: input.action,
          adapter: input.adapter, credential_binding: input.credential_binding, issued_at: acceptedAt,
          expires_at: permitExpiry, one_use: true };
        const permitDigest = sha256Digest(permitDocument);
        const permitSignature = signDispatchPermit(permitDocument, permitSecret);
        const envelopeDocument = { envelope_id: envelopeId, installation_id: installationId, environment_id: environmentId,
          idempotency_key: input.effect_idempotency_key, passport_id: input.passport_id,
          agent_principal_id: authority.passport.agent_principal_id, work_intent_id: input.work_intent_id,
          delegation_id: input.delegation_id, capability_activation_id: input.capability_activation_id,
          package_version_id: input.package_version_id, skill_binding: { kind: "effect_adapter", ...input.adapter },
          context_receipt_ids: input.context_receipt_ids, limits: input.limits,
          evidence_requirements: input.evidence_requirements, expires_at: input.expires_at, admitted_at: acceptedAt,
          external_effect_authority: false };
        const envelopeDigest = sha256Digest(envelopeDocument);
        await client.query(`INSERT INTO kernel_execution_envelopes
          (envelope_id,installation_id,environment_id,idempotency_key,admission_digest,envelope_digest,passport_id,
           agent_principal_id,work_intent_id,delegation_id,capability_activation_id,package_version_id,skill_binding,
           context_receipt_ids,limits,evidence_requirements,expires_at,admitted_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [envelopeId, installationId, environmentId, input.effect_idempotency_key, requestDigest, envelopeDigest,
          input.passport_id, authority.passport.agent_principal_id, input.work_intent_id, input.delegation_id,
          input.capability_activation_id, input.package_version_id, envelopeDocument.skill_binding,
          JSON.stringify(input.context_receipt_ids), input.limits, JSON.stringify(input.evidence_requirements),
          input.expires_at, acceptedAt]);
        await client.query(`INSERT INTO kernel_runs (run_id,installation_id,environment_id,envelope_id,created_at)
          VALUES ($1,$2,$3,$4,$5)`, [runId, installationId, environmentId, envelopeId, acceptedAt]);
        await client.query(`INSERT INTO kernel_run_states
          (installation_id,environment_id,run_id,execution_status,accountability_status,updated_at)
          VALUES ($1,$2,$3,'admitted','pending',$4)`, [installationId, environmentId, runId, acceptedAt]);
        await client.query(`INSERT INTO kernel_effect_records
          (effect_id,installation_id,environment_id,run_id,envelope_id,effect_idempotency_key,effect_request,request_digest,
           effect_request_digest,
           capability_activation_id,workload_grant_id,context_receipt_ids,target,action,requested_value,limits,
           credential_binding,adapter_binding,evidence_requirements,recovery_posture,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [effectId, installationId, environmentId, runId, envelopeId, input.effect_idempotency_key, effectRequest,
          requestDigest, permitDocument.request_digest, input.capability_activation_id, input.workload_grant_id,
          JSON.stringify(input.context_receipt_ids),
          input.target, input.action, input.requested_value, input.limits, input.credential_binding, input.adapter,
          JSON.stringify(input.evidence_requirements), input.recovery, acceptedAt]);
        await client.query(`INSERT INTO kernel_effect_states (installation_id,environment_id,effect_id,status,updated_at)
          VALUES ($1,$2,$3,'admitted',$4)`, [installationId, environmentId, effectId, acceptedAt]);
        await client.query(`INSERT INTO kernel_dispatch_permits
          (permit_id,installation_id,environment_id,effect_id,run_id,workload_grant_id,permit_document,permit_digest,
           key_id,signature,expires_at,issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [permitId, installationId, environmentId, effectId, runId, input.workload_grant_id, permitDocument,
          permitDigest, permitKeyId, permitSignature, permitExpiry, acceptedAt]);
        await client.query(`INSERT INTO kernel_dispatch_permit_states
          (installation_id,environment_id,permit_id,status,updated_at) VALUES ($1,$2,$3,'issued',$4)`,
        [installationId, environmentId, permitId, acceptedAt]);
        const deadline = new Date(Math.min(toEpochMilliseconds(input.expires_at),
          toEpochMilliseconds(acceptedAt) + authority.card.accountability_contract.deadline_seconds * 1000)).toISOString();
        for (const requirement of input.evidence_requirements) {
          await client.query(`INSERT INTO kernel_operational_obligations
            (obligation_id,installation_id,environment_id,run_id,obligation_key,requirement,status,deadline_at,created_at)
            VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8)`,
          [randomUUID(), installationId, environmentId, runId, sha256Digest(requirement), requirement, deadline, acceptedAt]);
        }
        return { aggregateType: "effect", aggregateId: effectId, transitionType: "kernel.effect.admitted",
          transitionPayload: { run_id: runId, permit_id: permitId, request_digest: permitDocument.request_digest },
          result: { ...(await bundle(effectId, client)), domain_replayed: false } };
      }
    });
  }

  async function claimDispatch(command, effect, permit, authenticatedPassport) {
    const claimCommand = { command_id: `${command.command_id}:claim`, operation_id: "kernel.effect.dispatch.claim",
      input: command.input, actor: { type: "agent", id: authenticatedPassport.agent_principal_id } };
    return executeCommand({ installationId, environmentId, command: claimCommand,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...claimCommand }),
      apply: async (client, { acceptedAt }) => {
        const locked = await client.query(`SELECT p.status,e.status AS effect_status
          FROM kernel_dispatch_permit_states p JOIN kernel_effect_states e
           ON e.installation_id=p.installation_id AND e.environment_id=p.environment_id AND e.effect_id=$4
          WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.permit_id=$3 FOR UPDATE OF p,e`,
        [installationId, environmentId, permit.permit_id, effect.effect_id]);
        if (locked.rows[0]?.status !== "issued" || locked.rows[0]?.effect_status !== "admitted") {
          throw new KernelError(409, "DISPATCH_PERMIT_CONSUMED", "Dispatch Permit is not available for another dispatch.");
        }
        if (toEpochMilliseconds(permit.expires_at) <= toEpochMilliseconds(acceptedAt)) {
          throw new KernelError(409, "DISPATCH_PERMIT_EXPIRED", "Dispatch Permit expired before immediate gate.");
        }
        const executionEnvelope = await executionService.getEnvelope(effect.envelope_id, client);
        if (toEpochMilliseconds(executionEnvelope.expires_at) <= toEpochMilliseconds(acceptedAt)) {
          throw new KernelError(409, "EFFECT_ENVELOPE_EXPIRED", "Correction Envelope expired before dispatch.");
        }
        const delegation = await client.query(`SELECT expires_at FROM kernel_delegations
          WHERE installation_id=$1 AND environment_id=$2 AND delegation_id=$3`,
        [installationId, environmentId, executionEnvelope.delegation_id]);
        if (!delegation.rows[0]
          || toEpochMilliseconds(delegation.rows[0].expires_at) <= toEpochMilliseconds(acceptedAt)) {
          throw new KernelError(409, "DELEGATION_EXPIRED", "Delegation expired before immediate effect gate.");
        }
        const activation = await deploymentService.getCapabilityActivation(effect.capability_activation_id, client);
        const card = await deploymentService.getActionCard(activation.deployment_id, activation.capability_export_id, client);
        if (card.capability_activation_id !== effect.capability_activation_id
          || canonicalize(card.credential_scope) !== canonicalize(effect.credential_binding)) {
          throw new KernelError(409, "IMMEDIATE_EFFECT_GATE_DENIED", "Capability or credential authority changed before dispatch.");
        }
        for (const receiptId of effect.context_receipt_ids) {
          const receipt = await contextService.getReceipt(receiptId);
          const contextGrant = await contextService.getGrant(receipt.grant_id, client);
          if (toEpochMilliseconds(contextGrant.expires_at) <= toEpochMilliseconds(acceptedAt)
            || receipt.freshness_claims.some((claim) => toEpochMilliseconds(acceptedAt)
              - toEpochMilliseconds(claim.observed_at) > card.source_reads.max_age_seconds * 1000)) {
            throw new KernelError(409, "STALE_CONTEXT", "Context expired or became stale before immediate effect gate.");
          }
        }
        const grant = await handoffService.getGrant(effect.workload_grant_id, client);
        await handoffService.checkWorkloadGate({ workload_grant_id: grant.workload_grant_id,
          workload_digest: grant.workload_digest });
        await client.query(`UPDATE kernel_dispatch_permit_states SET status='consumed',consumed_at=$4,updated_at=$4
          WHERE installation_id=$1 AND environment_id=$2 AND permit_id=$3`,
        [installationId, environmentId, permit.permit_id, acceptedAt]);
        await client.query(`UPDATE kernel_effect_states SET status='dispatching',dispatch_started_at=$4,updated_at=$4
          WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3`,
        [installationId, environmentId, effect.effect_id, acceptedAt]);
        return { aggregateType: "effect", aggregateId: effect.effect_id, transitionType: "kernel.effect.dispatch_started",
          transitionPayload: { permit_id: permit.permit_id }, result: { effect_id: effect.effect_id,
            permit_id: permit.permit_id, dispatch_gate: "passed" } };
      }
    });
  }

  async function dispatch(envelope, authenticatedPassport) {
    const input = exact(envelope.input, "input", ["effect_id", "permit_id", "permit_digest"]);
    const effectId = uuid(input.effect_id, "input.effect_id");
    const permitId = uuid(input.permit_id, "input.permit_id");
    digest(input.permit_digest, "input.permit_digest");
    const effect = await getEffect(effectId);
    const executionEnvelope = await executionService.getEnvelope(effect.envelope_id);
    if (executionEnvelope.passport_id !== authenticatedPassport.passport_id) {
      throw new KernelError(403, "EXECUTION_PASSPORT_MISMATCH", "Only admitted Runtime Passport may dispatch Effect.");
    }
    const permit = await getPermit(permitId);
    if (permit.effect_id !== effectId || permit.permit_digest !== input.permit_digest) {
      throw new KernelError(409, "DISPATCH_PERMIT_MISMATCH", "Dispatch Permit does not bind exact Effect.");
    }
    const command = { ...envelope, input: { effect_id: effectId, permit_id: permitId, permit_digest: input.permit_digest },
      actor: { type: "agent", id: authenticatedPassport.agent_principal_id } };
    const commandRequestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    const existingReceipt = await database.getCommandReceipt(installationId, environmentId, envelope.command_id);
    if (existingReceipt) {
      if (existingReceipt.request_digest !== commandRequestDigest) {
        throw new KernelError(409, "IDEMPOTENCY_CONFLICT", "Dispatch command ID was already used with different input.");
      }
      return { replayed: true, result: existingReceipt.result };
    }
    const claim = await claimDispatch(command, effect, permit, authenticatedPassport);
    if (claim.replayed) throw new KernelError(409, "EFFECT_DISPATCH_IN_PROGRESS", "Effect was already released for dispatch; inspect before retry.");
    let response;
    let adapterResult;
    try {
      response = await fetch(`${trustedAdapterUrl}/v0/dispatch`, { method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${kernelAdapterToken}` },
        signal: AbortSignal.timeout(adapterDispatchTimeoutMs),
        body: JSON.stringify({ permit_document: permit.permit_document, permit_digest: permit.permit_digest,
          signature: permit.signature, request_digest: permit.permit_document.request_digest,
          effect_request: effect.effect_request }) });
      adapterResult = await response.json();
    } catch (error) {
      return recoveryService.openUncertainty({ command, requestDigest: commandRequestDigest, effect,
        dispatchPermit: permit, authenticatedPassport,
        cause: { code: error.name === "TimeoutError" ? "ADAPTER_RESPONSE_TIMEOUT" : "ADAPTER_RESULT_UNAVAILABLE",
          timeout_ms: adapterDispatchTimeoutMs,
          error_name: error.name } });
    }
    if (!response.ok || adapterResult.effect_id !== effect.effect_id || adapterResult.permit_id !== permit.permit_id
      || adapterResult.effect_idempotency_key !== effect.effect_idempotency_key
      || adapterResult.outcome !== "succeeded"
      || adapterResult.post_write_observation?.subject !== effect.target.subject
      || adapterResult.post_write_observation?.quantity !== effect.requested_value.quantity
      || adapterResult.credential?.material_returned !== false
      || canonicalize(adapterResult.credential?.scopes) !== canonicalize(effect.credential_binding.scopes)) {
      return recoveryService.openUncertainty({ command, requestDigest: commandRequestDigest, effect,
        dispatchPermit: permit, authenticatedPassport,
        cause: { code: response.ok ? "ADAPTER_EVIDENCE_INVALID" : "ADAPTER_DISPATCH_UNRESOLVED",
          timeout_ms: adapterDispatchTimeoutMs } });
    }
    const evidenceRecordId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandRequestDigest,
      apply: async (client, { acceptedAt }) => {
        const state = await client.query(`SELECT status FROM kernel_effect_states
          WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3 FOR UPDATE`,
        [installationId, environmentId, effect.effect_id]);
        if (state.rows[0]?.status !== "dispatching") throw new KernelError(409, "EFFECT_NOT_DISPATCHING", "Effect is not awaiting dispatch result.");
        const sourceLinks = [];
        for (const receiptId of effect.context_receipt_ids) {
          const receipt = await contextService.getReceipt(receiptId);
          sourceLinks.push(...receipt.item_references.map((reference) => ({ context_receipt_id: receiptId, ...reference })));
        }
        const resultDigest = sha256Digest(adapterResult);
        const evidenceDocument = { evidence_record_id: evidenceRecordId, run_id: effect.run_id,
          envelope_id: effect.envelope_id, effect_id: effect.effect_id, dispatch_permit_id: permit.permit_id,
          passport_id: executionEnvelope.passport_id, capability_activation_id: effect.capability_activation_id,
          context_receipt_ids: effect.context_receipt_ids, source_links: sourceLinks,
          exact_action: { target: effect.target, action: effect.action, requested_value: effect.requested_value },
          adapter_result: adapterResult, result_digest: resultDigest,
          evidence_requirements: effect.evidence_requirements, recorded_at: acceptedAt };
        const evidenceDigest = sha256Digest(evidenceDocument);
        await client.query(`INSERT INTO kernel_evidence_records
          (evidence_record_id,installation_id,environment_id,run_id,envelope_id,evidence_document,evidence_digest,
           source_links,result,recorded_by_principal_id,recorded_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [evidenceRecordId, installationId, environmentId, effect.run_id, effect.envelope_id, evidenceDocument,
          evidenceDigest, JSON.stringify(sourceLinks), adapterResult, authenticatedPassport.agent_principal_id, acceptedAt]);
        const obligations = await client.query(`UPDATE kernel_operational_obligations
          SET status='satisfied',evidence_record_id=$4,satisfied_at=$5
          WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3 AND status='open' RETURNING *`,
        [installationId, environmentId, effect.run_id, evidenceRecordId, acceptedAt]);
        if (obligations.rowCount !== effect.evidence_requirements.length) {
          throw new KernelError(409, "OBLIGATION_STATE_MISMATCH", "Effect evidence obligations do not match admission.");
        }
        await client.query(`UPDATE kernel_effect_states SET status='succeeded',evidence_record_id=$4,
          completed_at=$5,updated_at=$5 WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3`,
        [installationId, environmentId, effect.effect_id, evidenceRecordId, acceptedAt]);
        await client.query(`UPDATE kernel_run_states SET execution_status='succeeded',accountability_status='satisfied',
          result_digest=$4,evidence_record_id=$5,completed_at=$6,updated_at=$6
          WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3`,
        [installationId, environmentId, effect.run_id, resultDigest, evidenceRecordId, acceptedAt]);
        return { aggregateType: "effect", aggregateId: effect.effect_id, transitionType: "kernel.effect.succeeded",
          transitionPayload: { run_id: effect.run_id, permit_id: permit.permit_id, evidence_record_id: evidenceRecordId },
          result: { effect_record: { ...(await getEffect(effect.effect_id, client)), status: "succeeded" },
            run: await executionService.getRun(effect.run_id, client),
            evidence_record: { ...evidenceDocument, evidence_digest: evidenceDigest, immutable: true },
            operational_obligations: obligations.rows } };
      }
    });
  }

  async function authorizeCredentialDelivery(permitId, permitDigest) {
    uuid(permitId, "permit_id");
    digest(permitDigest, "permit_digest");
    const command = { command_id: randomUUID(), operation_id: "kernel.dispatch_permit.credential_deliver",
      input: { permit_id: permitId, permit_digest: permitDigest }, actor: { type: "service", id: "local-credential-broker" } };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt }) => {
        const permit = await getPermit(permitId, client);
        if (permit.permit_digest !== permitDigest || permit.status !== "consumed"
          || toEpochMilliseconds(permit.expires_at) <= toEpochMilliseconds(acceptedAt)) {
          throw new KernelError(409, "CREDENTIAL_DELIVERY_DENIED", "Credential requires exact consumed unexpired Dispatch Permit.");
        }
        if (permit.brokered_at) {
          throw new KernelError(409, "CREDENTIAL_ALREADY_DELIVERED", "Dispatch Permit already delivered its one scoped credential.");
        }
        await client.query(`UPDATE kernel_dispatch_permit_states SET brokered_at=$4,updated_at=$4
          WHERE installation_id=$1 AND environment_id=$2 AND permit_id=$3`,
        [installationId, environmentId, permitId, acceptedAt]);
        return { aggregateType: "dispatch_permit", aggregateId: permitId,
          transitionType: "kernel.dispatch_permit.credential_delivered",
          transitionPayload: { effect_id: permit.effect_id }, result: { authorized: true,
            binding_ref: permit.permit_document.credential_binding.binding_ref,
            revision: permit.permit_document.credential_binding.revision,
            scopes: permit.permit_document.credential_binding.scopes,
            expires_at: permit.permit_document.expires_at } };
      }
    });
  }

  async function getButlerProjection() {
    const result = await pool.query(`SELECT effect_id FROM kernel_effect_records
      WHERE installation_id=$1 AND environment_id=$2 ORDER BY created_at DESC`, [installationId, environmentId]);
    return Promise.all(result.rows.map(async ({ effect_id: effectId }) => {
      const effect = await getEffect(effectId);
      const permitResult = await pool.query(`SELECT permit_id FROM kernel_dispatch_permits
        WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3`, [installationId, environmentId, effectId]);
      const permit = await getPermit(permitResult.rows[0].permit_id);
      const run = await executionService.getRun(effect.run_id);
      const evidence = effect.evidence_record_id ? await executionService.getEvidence(effect.evidence_record_id) : null;
      const recoveryCase = effect.recovery_case_id
        ? await recoveryService.getRecoveryCase(effect.recovery_case_id) : null;
      return { effect_id: effect.effect_id, effect_idempotency_key: effect.effect_idempotency_key,
        run_id: effect.run_id, execution_status: run.execution_status, accountability_status: run.accountability_status,
        effect_status: effect.status, was_uncertain: effect.was_uncertain,
        target: effect.target, action: effect.action, requested_value: effect.requested_value,
        authority: { capability_activation_id: effect.capability_activation_id,
          workload_grant_id: effect.workload_grant_id, credential_binding: effect.credential_binding,
          adapter: effect.adapter_binding, context_receipt_ids: effect.context_receipt_ids },
        permit: { permit_id: permit.permit_id, status: permit.status, expires_at: permit.expires_at,
          consumed_at: permit.consumed_at, brokered_at: permit.brokered_at },
        evidence: evidence ? { evidence_record_id: evidence.evidence_record_id,
          evidence_digest: evidence.evidence_digest, source_links: evidence.source_links,
          outcome: evidence.result.outcome } : null,
        recovery: effect.recovery_posture, recovery_case: recoveryCase };
    }));
  }

  return { admitCorrection, dispatch, getEffect, getPermit, authorizeCredentialDelivery, getButlerProjection };
}
