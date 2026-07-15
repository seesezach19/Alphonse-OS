import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

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

function uuid(value, path) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new KernelError(400, "INVALID_IDENTIFIER", `${path} must be a UUID.`);
  }
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new KernelError(400, "INVALID_DIGEST", `${path} must be a SHA-256 digest.`);
  }
  return value;
}

export function validateReconciliationInput(value) {
  const input = exact(value, "input", ["recovery_case_id", "reconciliation_permit_id", "permit_digest"]);
  return { recovery_case_id: uuid(input.recovery_case_id, "input.recovery_case_id"),
    reconciliation_permit_id: uuid(input.reconciliation_permit_id, "input.reconciliation_permit_id"),
    permit_digest: digest(input.permit_digest, "input.permit_digest") };
}

export function signReconciliationPermit(document, secret) {
  return `hmac-sha256:${createHmac("sha256", secret).update(canonicalize(document)).digest("hex")}`;
}

export function verifyReconciliationPermit(document, signature, secret) {
  const expected = Buffer.from(signReconciliationPermit(document, secret), "utf8");
  const supplied = Buffer.from(String(signature), "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createRecoveryService(database, contextService, executionService, installationId, environmentId,
  permitSecret, permitKeyId, trustedAdapterUrl, kernelAdapterToken) {
  const { pool, executeCommand } = database;

  async function effectRecord(effectId, client = pool) {
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

  async function getReconciliationPermit(permitId, client = pool) {
    uuid(permitId, "reconciliation_permit_id");
    const result = await client.query(`SELECT p.*,s.status,s.consumed_at,s.brokered_at,s.updated_at
      FROM kernel_reconciliation_permits p JOIN kernel_reconciliation_permit_states s
       ON s.installation_id=p.installation_id AND s.environment_id=p.environment_id
       AND s.reconciliation_permit_id=p.reconciliation_permit_id
      WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.reconciliation_permit_id=$3`,
    [installationId, environmentId, permitId]);
    const permit = result.rows[0];
    if (!permit) throw new KernelError(404, "RECONCILIATION_PERMIT_NOT_FOUND", "Reconciliation Permit does not exist.");
    if (sha256Digest(permit.permit_document) !== permit.permit_digest
      || !verifyReconciliationPermit(permit.permit_document, permit.signature, permitSecret)) {
      throw new KernelError(500, "INTEGRITY_VIOLATION", "Reconciliation Permit digest or signature is invalid.");
    }
    return { ...permit, immutable_record: true };
  }

  async function issueReconciliationPermit(client, recoveryCaseId, effect, issuedAt, minimumExpiry) {
    const reconciliationPermitId = randomUUID();
    const expiresAt = new Date(Math.max(Date.parse(minimumExpiry), Date.parse(issuedAt) + 15 * 60_000)).toISOString();
    const permitDocument = { permit_type: "effect_reconciliation",
      reconciliation_permit_id: reconciliationPermitId, recovery_case_id: recoveryCaseId,
      effect_id: effect.effect_id, run_id: effect.run_id, effect_idempotency_key: effect.effect_idempotency_key,
      target: effect.target, request_digest: effect.effect_request_digest ?? sha256Digest(effect.effect_request),
      requested_value: effect.requested_value,
      action: "observe_quantity", adapter: effect.adapter_binding,
      credential_binding: { binding_ref: effect.credential_binding.binding_ref,
        revision: effect.credential_binding.revision, scopes: ["storefront.inventory.read"] },
      one_use: true, issued_at: issuedAt, expires_at: expiresAt };
    const permitDigest = sha256Digest(permitDocument);
    await client.query(`INSERT INTO kernel_reconciliation_permits
      (reconciliation_permit_id,installation_id,environment_id,recovery_case_id,effect_id,permit_document,
       permit_digest,key_id,signature,expires_at,issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [reconciliationPermitId, installationId, environmentId, recoveryCaseId, effect.effect_id, permitDocument,
      permitDigest, permitKeyId, signReconciliationPermit(permitDocument, permitSecret), expiresAt, issuedAt]);
    await client.query(`INSERT INTO kernel_reconciliation_permit_states
      (installation_id,environment_id,reconciliation_permit_id,status,updated_at) VALUES ($1,$2,$3,'issued',$4)`,
    [installationId, environmentId, reconciliationPermitId, issuedAt]);
    return getReconciliationPermit(reconciliationPermitId, client);
  }

  async function getRecoveryCase(recoveryCaseId, client = pool) {
    uuid(recoveryCaseId, "recovery_case_id");
    const result = await client.query(`SELECT c.*,s.status,s.reconciliation_status,s.reconciliation_record_id,s.updated_at
      FROM kernel_recovery_cases c JOIN kernel_recovery_case_states s ON s.installation_id=c.installation_id
       AND s.environment_id=c.environment_id AND s.recovery_case_id=c.recovery_case_id
      WHERE c.installation_id=$1 AND c.environment_id=$2 AND c.recovery_case_id=$3`,
    [installationId, environmentId, recoveryCaseId]);
    if (!result.rows[0]) throw new KernelError(404, "RECOVERY_CASE_NOT_FOUND", "Recovery Case does not exist.");
    const permitResult = await client.query(`SELECT reconciliation_permit_id FROM kernel_reconciliation_permits
      WHERE installation_id=$1 AND environment_id=$2 AND recovery_case_id=$3 ORDER BY issued_at`,
    [installationId, environmentId, recoveryCaseId]);
    const reconciliationResult = await client.query(`SELECT * FROM kernel_reconciliation_records
      WHERE installation_id=$1 AND environment_id=$2 AND recovery_case_id=$3 ORDER BY recorded_at`,
    [installationId, environmentId, recoveryCaseId]);
    const failureResult = await client.query(`SELECT * FROM kernel_reconciliation_failures
      WHERE installation_id=$1 AND environment_id=$2 AND recovery_case_id=$3 ORDER BY recorded_at`,
    [installationId, environmentId, recoveryCaseId]);
    const permits = await Promise.all(permitResult.rows.map(({ reconciliation_permit_id: permitId }) =>
      getReconciliationPermit(permitId, client)));
    return { ...result.rows[0], immutable_case: true, was_uncertain: true,
      reconciliation_permit: [...permits].reverse().find((permit) => permit.status === "issued") ?? permits.at(-1),
      reconciliation_permits: permits,
      reconciliation_failures: failureResult.rows.map((entry) => ({ ...entry, immutable_record: true })),
      reconciliations: reconciliationResult.rows.map((entry) => ({ ...entry, immutable_record: true })) };
  }

  async function getRecoveryCaseForEffect(effectId, client = pool) {
    const result = await client.query(`SELECT recovery_case_id FROM kernel_recovery_cases
      WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3`,
    [installationId, environmentId, effectId]);
    return result.rows[0] ? getRecoveryCase(result.rows[0].recovery_case_id, client) : null;
  }

  async function openUncertainty({ command, requestDigest, effect, dispatchPermit, authenticatedPassport, cause }) {
    const recoveryCaseId = randomUUID();
    return executeCommand({ installationId, environmentId, command, requestDigest,
      apply: async (client, { acceptedAt }) => {
        const state = await client.query(`SELECT status FROM kernel_effect_states
          WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3 FOR UPDATE`,
        [installationId, environmentId, effect.effect_id]);
        if (state.rows[0]?.status !== "dispatching") {
          throw new KernelError(409, "EFFECT_NOT_DISPATCHING", "Effect is not awaiting a dispatch result.");
        }
        const obligation = await client.query(`SELECT min(deadline_at) AS deadline_at FROM kernel_operational_obligations
          WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3`,
        [installationId, environmentId, effect.run_id]);
        const deadlineAt = obligation.rows[0].deadline_at;
        const knownFacts = [
          { fact: "effect_recorded_before_dispatch", effect_id: effect.effect_id,
            request_digest: effect.effect_request_digest ?? sha256Digest(effect.effect_request) },
          { fact: "dispatch_permit_consumed", permit_id: dispatchPermit.permit_id,
            consumed_at: dispatchPermit.consumed_at ?? acceptedAt },
          { fact: "trusted_adapter_response_missing", reason: cause.code, timeout_ms: cause.timeout_ms },
          { fact: "target_may_have_applied_effect", target: effect.target,
            effect_idempotency_key: effect.effect_idempotency_key }
        ];
        const missingEvidence = ["target_effect_receipt", "post_write_observation"];
        const responsibleActor = { type: "agent", principal_id: authenticatedPassport.agent_principal_id,
          passport_id: authenticatedPassport.passport_id };
        const allowedOptions = [
          { option: "reconcile", operation_id: "kernel.recovery_case.reconcile",
            authority: "authenticated_agent_bound_to_original_effect", external_write: false },
          { option: "separate_corrective_work", available_when: "reconciled_not_applied",
            authority_sequence: ["work_intent", "delegation", "capability", "execution_envelope", "run", "effect", "evidence"] },
          { option: "complete_remaining_obligations", available_when: "reconciled_applied_accountability_open",
            authority: "normal_accountability_contract_evidence_path" }
        ];
        await client.query(`INSERT INTO kernel_recovery_cases
          (recovery_case_id,installation_id,environment_id,effect_id,run_id,known_facts,missing_evidence,
           responsible_actor,allowed_options,deadline_at,opened_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [recoveryCaseId, installationId, environmentId, effect.effect_id, effect.run_id, JSON.stringify(knownFacts),
          JSON.stringify(missingEvidence), JSON.stringify(responsibleActor), JSON.stringify(allowedOptions), deadlineAt, acceptedAt]);
        await client.query(`INSERT INTO kernel_recovery_case_states
          (installation_id,environment_id,recovery_case_id,status,reconciliation_status,updated_at)
          VALUES ($1,$2,$3,'open','pending',$4)`, [installationId, environmentId, recoveryCaseId, acceptedAt]);
        await issueReconciliationPermit(client, recoveryCaseId, effect, acceptedAt, deadlineAt);
        await client.query(`UPDATE kernel_effect_states SET status='uncertain',was_uncertain=true,recovery_case_id=$4,
          updated_at=$5 WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3`,
        [installationId, environmentId, effect.effect_id, recoveryCaseId, acceptedAt]);
        await client.query(`UPDATE kernel_run_states SET execution_status='uncertain',accountability_status='pending',
          updated_at=$4 WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3`,
        [installationId, environmentId, effect.run_id, acceptedAt]);
        return { aggregateType: "effect", aggregateId: effect.effect_id,
          transitionType: "kernel.effect.uncertain",
          transitionPayload: { run_id: effect.run_id, dispatch_permit_id: dispatchPermit.permit_id,
            recovery_case_id: recoveryCaseId, cause: cause.code },
          result: { effect_record: await effectRecord(effect.effect_id, client),
            run: await executionService.getRun(effect.run_id, client),
            recovery_case: await getRecoveryCase(recoveryCaseId, client) } };
      }
    });
  }

  async function openRestoreUncertainty(client, effectId, restoreId, acceptedAt) {
    const existing = await getRecoveryCaseForEffect(effectId, client);
    if (existing) return existing;
    const effect = await effectRecord(effectId, client);
    const envelope = await executionService.getEnvelope(effect.envelope_id, client);
    const recoveryCaseId = randomUUID();
    const obligation = await client.query(`SELECT min(deadline_at) AS deadline_at FROM kernel_operational_obligations
      WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3`,
    [installationId, environmentId, effect.run_id]);
    const deadlineAt = obligation.rows[0]?.deadline_at ?? new Date(Date.parse(acceptedAt) + 15 * 60_000).toISOString();
    const knownFacts = [
      { fact: "effect_present_at_restore_point", effect_id: effect.effect_id,
        request_digest: effect.effect_request_digest ?? sha256Digest(effect.effect_request) },
      { fact: "restore_point_precedes_possible_external_result", restore_id: restoreId },
      { fact: "target_may_have_applied_effect", target: effect.target,
        effect_idempotency_key: effect.effect_idempotency_key }
    ];
    const responsibleActor = { type: "agent", principal_id: envelope.agent_principal_id,
      passport_id: envelope.passport_id };
    const allowedOptions = [
      { option: "reconcile", operation_id: "kernel.recovery_case.reconcile",
        authority: "authenticated_agent_bound_to_original_effect", external_write: false },
      { option: "separate_corrective_work", available_when: "reconciled_not_applied",
        authority_sequence: ["work_intent", "delegation", "capability", "execution_envelope", "run", "effect", "evidence"] },
      { option: "complete_remaining_obligations", available_when: "reconciled_applied_accountability_open",
        authority: "normal_accountability_contract_evidence_path" }
    ];
    await client.query(`INSERT INTO kernel_recovery_cases
      (recovery_case_id,installation_id,environment_id,effect_id,run_id,known_facts,missing_evidence,
       responsible_actor,allowed_options,deadline_at,opened_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [recoveryCaseId, installationId, environmentId, effect.effect_id, effect.run_id, JSON.stringify(knownFacts),
      JSON.stringify(["target_effect_receipt", "post_write_observation"]), JSON.stringify(responsibleActor),
      JSON.stringify(allowedOptions), deadlineAt, acceptedAt]);
    await client.query(`INSERT INTO kernel_recovery_case_states
      (installation_id,environment_id,recovery_case_id,status,reconciliation_status,updated_at)
      VALUES ($1,$2,$3,'open','pending',$4)`, [installationId, environmentId, recoveryCaseId, acceptedAt]);
    await issueReconciliationPermit(client, recoveryCaseId, effect, acceptedAt, deadlineAt);
    await client.query(`UPDATE kernel_dispatch_permit_states SET status='expired',updated_at=$4
      WHERE installation_id=$1 AND environment_id=$2 AND permit_id IN
       (SELECT permit_id FROM kernel_dispatch_permits WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3)
       AND status='issued'`, [installationId, environmentId, effect.effect_id, acceptedAt]);
    await client.query(`UPDATE kernel_effect_states SET status='uncertain',was_uncertain=true,recovery_case_id=$4,
      updated_at=$5 WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3`,
    [installationId, environmentId, effect.effect_id, recoveryCaseId, acceptedAt]);
    await client.query(`UPDATE kernel_run_states SET execution_status='uncertain',accountability_status='pending',
      updated_at=$4 WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3`,
    [installationId, environmentId, effect.run_id, acceptedAt]);
    return getRecoveryCase(recoveryCaseId, client);
  }

  async function claimReconciliation(command, recoveryCase, permit, effect) {
    const claimCommand = { command_id: `${command.command_id}:claim`, operation_id: "kernel.recovery_case.reconcile.claim",
      input: command.input, actor: command.actor };
    return executeCommand({ installationId, environmentId, command: claimCommand,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...claimCommand }),
      apply: async (client, { acceptedAt }) => {
        const state = await client.query(`SELECT c.status,c.reconciliation_status,p.status AS permit_status
          FROM kernel_recovery_case_states c JOIN kernel_reconciliation_permit_states p
           ON p.installation_id=c.installation_id AND p.environment_id=c.environment_id
          WHERE c.installation_id=$1 AND c.environment_id=$2 AND c.recovery_case_id=$3
           AND p.reconciliation_permit_id=$4 FOR UPDATE OF c,p`,
        [installationId, environmentId, recoveryCase.recovery_case_id, permit.reconciliation_permit_id]);
        if (state.rows[0]?.status !== "open" || state.rows[0]?.reconciliation_status !== "pending"
          || state.rows[0]?.permit_status !== "issued") {
          throw new KernelError(409, "RECONCILIATION_NOT_AVAILABLE", "Recovery Case is not available for reconciliation.");
        }
        if (Date.parse(permit.expires_at) <= Date.parse(acceptedAt)) {
          throw new KernelError(409, "RECONCILIATION_PERMIT_EXPIRED", "Reconciliation Permit expired before use.");
        }
        await client.query(`UPDATE kernel_reconciliation_permit_states SET status='consumed',consumed_at=$4,updated_at=$4
          WHERE installation_id=$1 AND environment_id=$2 AND reconciliation_permit_id=$3`,
        [installationId, environmentId, permit.reconciliation_permit_id, acceptedAt]);
        await client.query(`UPDATE kernel_recovery_case_states SET status='reconciling',reconciliation_status='in_progress',
          updated_at=$4 WHERE installation_id=$1 AND environment_id=$2 AND recovery_case_id=$3`,
        [installationId, environmentId, recoveryCase.recovery_case_id, acceptedAt]);
        return { aggregateType: "recovery_case", aggregateId: recoveryCase.recovery_case_id,
          transitionType: "kernel.recovery_case.reconciliation_started",
          transitionPayload: { effect_id: effect.effect_id, reconciliation_permit_id: permit.reconciliation_permit_id },
          result: { recovery_case_id: recoveryCase.recovery_case_id, reconciliation_gate: "passed" } };
      }
    });
  }

  async function reopenReconciliation(recoveryCase, permit, effect, issue) {
    const command = { command_id: randomUUID(), operation_id: "kernel.recovery_case.reconciliation_failed",
      input: { recovery_case_id: recoveryCase.recovery_case_id,
        reconciliation_permit_id: permit.reconciliation_permit_id, issue },
      actor: { type: "service", id: "kernel-recovery-coordinator" } };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt }) => {
        const state = await client.query(`SELECT status,reconciliation_status FROM kernel_recovery_case_states
          WHERE installation_id=$1 AND environment_id=$2 AND recovery_case_id=$3 FOR UPDATE`,
        [installationId, environmentId, recoveryCase.recovery_case_id]);
        if (state.rows[0]?.status !== "reconciling" || state.rows[0]?.reconciliation_status !== "in_progress") {
          throw new KernelError(409, "RECOVERY_CASE_NOT_RECONCILING", "Recovery Case cannot record reconciliation failure.");
        }
        await client.query(`INSERT INTO kernel_reconciliation_failures
          (reconciliation_failure_id,installation_id,environment_id,recovery_case_id,reconciliation_permit_id,
           issue,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), installationId, environmentId, recoveryCase.recovery_case_id,
          permit.reconciliation_permit_id, JSON.stringify(issue), acceptedAt]);
        const replacement = await issueReconciliationPermit(client, recoveryCase.recovery_case_id, effect,
          acceptedAt, recoveryCase.deadline_at);
        await client.query(`UPDATE kernel_recovery_case_states SET status='open',reconciliation_status='pending',updated_at=$4
          WHERE installation_id=$1 AND environment_id=$2 AND recovery_case_id=$3`,
        [installationId, environmentId, recoveryCase.recovery_case_id, acceptedAt]);
        return { aggregateType: "recovery_case", aggregateId: recoveryCase.recovery_case_id,
          transitionType: "kernel.recovery_case.reconciliation_failed",
          transitionPayload: { failed_permit_id: permit.reconciliation_permit_id,
            replacement_permit_id: replacement.reconciliation_permit_id, issue_code: issue.code },
          result: { recovery_case: await getRecoveryCase(recoveryCase.recovery_case_id, client) } };
      }
    });
  }

  async function reconcile(envelope, authenticatedPassport) {
    const input = validateReconciliationInput(envelope.input);
    const recoveryCase = await getRecoveryCase(input.recovery_case_id);
    const effect = await effectRecord(recoveryCase.effect_id);
    const executionEnvelope = await executionService.getEnvelope(effect.envelope_id);
    if (executionEnvelope.passport_id !== authenticatedPassport.passport_id
      || recoveryCase.responsible_actor.principal_id !== authenticatedPassport.agent_principal_id) {
      throw new KernelError(403, "RECOVERY_ACTOR_MISMATCH", "Only the responsible original Runtime may reconcile this Effect.");
    }
    const permit = await getReconciliationPermit(input.reconciliation_permit_id);
    if (permit.recovery_case_id !== recoveryCase.recovery_case_id || permit.effect_id !== effect.effect_id
      || permit.permit_digest !== input.permit_digest) {
      throw new KernelError(409, "RECONCILIATION_PERMIT_MISMATCH", "Reconciliation Permit does not bind exact Recovery Case.");
    }
    const command = { ...envelope, input, actor: { type: "agent", id: authenticatedPassport.agent_principal_id } };
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    const existing = await database.getCommandReceipt(installationId, environmentId, command.command_id);
    if (existing) {
      if (existing.request_digest !== requestDigest) {
        throw new KernelError(409, "IDEMPOTENCY_CONFLICT", "Reconciliation command ID was reused with different input.");
      }
      return { replayed: true, result: existing.result };
    }
    const claim = await claimReconciliation(command, recoveryCase, permit, effect);
    if (claim.replayed) throw new KernelError(409, "RECONCILIATION_IN_PROGRESS", "Reconciliation already started.");
    let response;
    let adapterResult;
    try {
      response = await fetch(`${trustedAdapterUrl}/v0/reconcile`, { method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${kernelAdapterToken}` },
        signal: AbortSignal.timeout(2_000),
        body: JSON.stringify({ permit_document: permit.permit_document, permit_digest: permit.permit_digest,
          signature: permit.signature, effect_request: effect.effect_request }) });
      adapterResult = await response.json();
    } catch (error) {
      await reopenReconciliation(recoveryCase, permit, effect,
        { code: "RECONCILIATION_OBSERVATION_FAILED", retryable: true });
      throw new KernelError(502, "RECONCILIATION_OBSERVATION_FAILED", "Trusted adapter did not return target observation.",
        { cause: error.message });
    }
    const effectReceipt = adapterResult.effect_receipt;
    const validReceipt = effectReceipt?.idempotency_key === effect.effect_idempotency_key
      && (effectReceipt.found === false || (effectReceipt.found === true
        && effectReceipt.request?.sku === effect.target.subject
        && effectReceipt.request?.quantity === effect.requested_value.quantity
        && effectReceipt.response?.status === "applied"
        && effectReceipt.response?.sku === effect.target.subject
        && effectReceipt.response?.quantity === effect.requested_value.quantity));
    if (!response.ok || adapterResult.recovery_case_id !== recoveryCase.recovery_case_id
      || adapterResult.effect_id !== effect.effect_id
      || adapterResult.reconciliation_permit_id !== permit.reconciliation_permit_id
      || adapterResult.outcome !== "observed"
      || adapterResult.observation?.subject !== effect.target.subject
      || adapterResult.observation?.system !== effect.target.system
      || adapterResult.observation?.resource !== effect.target.resource
      || !Number.isInteger(adapterResult.observation?.quantity)
      || !validReceipt
      || adapterResult.credential?.material_returned !== false
      || canonicalize(adapterResult.credential?.scopes) !== canonicalize(["storefront.inventory.read"])) {
      await reopenReconciliation(recoveryCase, permit, effect,
        { code: "RECONCILIATION_EVIDENCE_INVALID", retryable: true });
      throw new KernelError(502, "RECONCILIATION_EVIDENCE_INVALID", "Trusted adapter observation is invalid.", {
        adapter_status: response.status, adapter_error: adapterResult.error ?? null,
        adapter_checks: adapterResult.checks ?? null,
        checks: { recovery_case: adapterResult.recovery_case_id === recoveryCase.recovery_case_id,
          effect: adapterResult.effect_id === effect.effect_id,
          permit: adapterResult.reconciliation_permit_id === permit.reconciliation_permit_id,
          outcome: adapterResult.outcome === "observed", observation: Number.isInteger(adapterResult.observation?.quantity),
          receipt: validReceipt, credential: adapterResult.credential?.material_returned === false,
          scopes: canonicalize(adapterResult.credential?.scopes) === canonicalize(["storefront.inventory.read"]) } });
    }
    const outcome = effectReceipt.found ? "applied" : "not_applied";
    const reconciliationRecordId = randomUUID();
    const evidenceRecordId = outcome === "applied" ? randomUUID() : null;
    try {
      return await executeCommand({ installationId, environmentId, command, requestDigest,
      apply: async (client, { acceptedAt }) => {
        const state = await client.query(`SELECT status,reconciliation_status FROM kernel_recovery_case_states
          WHERE installation_id=$1 AND environment_id=$2 AND recovery_case_id=$3 FOR UPDATE`,
        [installationId, environmentId, recoveryCase.recovery_case_id]);
        if (state.rows[0]?.status !== "reconciling" || state.rows[0]?.reconciliation_status !== "in_progress") {
          throw new KernelError(409, "RECOVERY_CASE_NOT_RECONCILING", "Recovery Case is not awaiting observation.");
        }
        let evidenceDocument = null;
        let evidenceDigest = null;
        let correctiveWorkIntentProposal = null;
        let remainingObligations = 0;
        if (outcome === "applied") {
          const sourceLinks = [];
          for (const receiptId of effect.context_receipt_ids) {
            const receipt = await contextService.getReceipt(receiptId);
            sourceLinks.push(...receipt.item_references.map((reference) => ({ context_receipt_id: receiptId, ...reference })));
          }
          const obligations = await client.query(`SELECT * FROM kernel_operational_obligations
            WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3 AND status='open' FOR UPDATE`,
          [installationId, environmentId, effect.run_id]);
          const obligationEvidence = obligations.rows.map((obligation) => {
            if (obligation.requirement === "storefront_response") {
              return { obligation_id: obligation.obligation_id, requirement: obligation.requirement,
                satisfied: effectReceipt.found, evidence_path: "effect_receipt.response" };
            }
            if (obligation.requirement === "post_write_observation") {
              return { obligation_id: obligation.obligation_id, requirement: obligation.requirement,
                satisfied: adapterResult.observation.quantity === effect.requested_value.quantity,
                evidence_path: "observation" };
            }
            return { obligation_id: obligation.obligation_id, requirement: obligation.requirement,
              satisfied: false, evidence_path: null };
          });
          evidenceDocument = { evidence_record_id: evidenceRecordId, evidence_type: "reconciled_effect_verification",
            recovery_case_id: recoveryCase.recovery_case_id, reconciliation_record_id: reconciliationRecordId,
            run_id: effect.run_id, envelope_id: effect.envelope_id, effect_id: effect.effect_id,
            original_dispatch_permit_id: recoveryCase.known_facts.find((fact) => fact.fact === "dispatch_permit_consumed")?.permit_id,
            exact_action: { target: effect.target, action: effect.action, requested_value: effect.requested_value },
            effect_receipt: effectReceipt, observation: adapterResult.observation,
            obligation_evidence: obligationEvidence, source_links: sourceLinks,
            preserves_uncertainty_history: true, recorded_at: acceptedAt };
          evidenceDigest = sha256Digest(evidenceDocument);
          await client.query(`INSERT INTO kernel_evidence_records
            (evidence_record_id,installation_id,environment_id,run_id,envelope_id,evidence_document,evidence_digest,
             source_links,result,recorded_by_principal_id,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [evidenceRecordId, installationId, environmentId, effect.run_id, effect.envelope_id, evidenceDocument,
            evidenceDigest, JSON.stringify(sourceLinks), JSON.stringify({ outcome: "reconciled_applied",
              observation: adapterResult.observation }), authenticatedPassport.agent_principal_id, acceptedAt]);
          for (const mapping of obligationEvidence.filter((entry) => entry.satisfied)) {
            await client.query(`UPDATE kernel_operational_obligations SET status='satisfied',evidence_record_id=$4,
              satisfied_at=$5,resolution_detail=$6 WHERE installation_id=$1 AND environment_id=$2 AND obligation_id=$3`,
            [installationId, environmentId, mapping.obligation_id, evidenceRecordId, acceptedAt,
              JSON.stringify({ evidence_path: mapping.evidence_path, reconciliation_record_id: reconciliationRecordId })]);
          }
          remainingObligations = obligationEvidence.filter((entry) => !entry.satisfied).length;
          await client.query(`UPDATE kernel_effect_states SET status='succeeded',evidence_record_id=$4,completed_at=$5,
            updated_at=$5 WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3`,
          [installationId, environmentId, effect.effect_id, evidenceRecordId, acceptedAt]);
          await client.query(`UPDATE kernel_run_states SET execution_status='succeeded',accountability_status=$4,
            result_digest=$5,evidence_record_id=$6,completed_at=$7,updated_at=$7
            WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3`,
          [installationId, environmentId, effect.run_id, remainingObligations === 0 ? "satisfied" : "pending",
            sha256Digest(adapterResult), evidenceRecordId, acceptedAt]);
        } else {
          correctiveWorkIntentProposal = { status: "requires_normal_submission",
            operation_id: "kernel.work_intent.propose",
            input: { passport_id: authenticatedPassport.passport_id, intent_class: "runtime_execution",
              objective: `Correct storefront inventory for ${effect.target.subject} after reconciliation proved the original Effect was not applied.`,
              requested_outcome: `Create a new governed correction to set quantity to ${effect.requested_value.quantity}.`,
              scope: { systems: [effect.target.system], resources: [effect.target.resource], subjects: [effect.target.subject] },
              constraints: { original_effect_id: effect.effect_id, recovery_case_id: recoveryCase.recovery_case_id,
                required_authority_sequence: ["delegation", "capability", "execution_envelope", "run", "effect", "evidence"],
                no_retry_of_original_effect: true } } };
          const obligations = await client.query(`SELECT obligation_id,requirement FROM kernel_operational_obligations
            WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3 AND status='open' FOR UPDATE`,
          [installationId, environmentId, effect.run_id]);
          for (const obligation of obligations.rows) {
            await client.query(`UPDATE kernel_operational_obligations SET status='breached',breached_at=$4,
              resolution_detail=$5 WHERE installation_id=$1 AND environment_id=$2 AND obligation_id=$3`,
            [installationId, environmentId, obligation.obligation_id, acceptedAt,
              JSON.stringify({ requirement: obligation.requirement, reason: "original_effect_not_applied",
                reconciliation_record_id: reconciliationRecordId })]);
          }
          await client.query(`UPDATE kernel_effect_states SET status='failed',completed_at=$4,updated_at=$4
            WHERE installation_id=$1 AND environment_id=$2 AND effect_id=$3`,
          [installationId, environmentId, effect.effect_id, acceptedAt]);
          await client.query(`UPDATE kernel_run_states SET execution_status='failed',accountability_status='breached',
            result_digest=$4,completed_at=$5,updated_at=$5 WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3`,
          [installationId, environmentId, effect.run_id, sha256Digest(adapterResult), acceptedAt]);
        }
        const reconciliationObservation = { effect_receipt: effectReceipt,
          target_observation: adapterResult.observation };
        await client.query(`INSERT INTO kernel_reconciliation_records
          (reconciliation_record_id,installation_id,environment_id,recovery_case_id,effect_id,reconciliation_permit_id,
           outcome,observation,observation_digest,evidence_record_id,corrective_work_intent_proposal,
           recorded_by_principal_id,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [reconciliationRecordId, installationId, environmentId, recoveryCase.recovery_case_id, effect.effect_id,
          permit.reconciliation_permit_id, outcome, JSON.stringify(reconciliationObservation),
          sha256Digest(reconciliationObservation), evidenceRecordId, correctiveWorkIntentProposal,
          authenticatedPassport.agent_principal_id, acceptedAt]);
        await client.query(`UPDATE kernel_recovery_case_states SET status=$4,reconciliation_status=$5,
          reconciliation_record_id=$6,updated_at=$7 WHERE installation_id=$1 AND environment_id=$2 AND recovery_case_id=$3`,
        [installationId, environmentId, recoveryCase.recovery_case_id,
          outcome === "applied"
            ? (remainingObligations === 0 ? "resolved_applied" : "open_applied_accountability")
            : "open_not_applied", outcome, reconciliationRecordId, acceptedAt]);
        return { aggregateType: "recovery_case", aggregateId: recoveryCase.recovery_case_id,
          transitionType: outcome === "applied" ? "kernel.recovery_case.reconciled_applied"
            : "kernel.recovery_case.reconciled_not_applied",
          transitionPayload: { effect_id: effect.effect_id, reconciliation_record_id: reconciliationRecordId,
            outcome, preserves_uncertainty_history: true },
          result: { recovery_case: await getRecoveryCase(recoveryCase.recovery_case_id, client),
            effect_record: await effectRecord(effect.effect_id, client),
            run: await executionService.getRun(effect.run_id, client),
            evidence_record: evidenceDocument ? { ...evidenceDocument, evidence_digest: evidenceDigest, immutable: true } : null,
            corrective_work_intent_proposal: correctiveWorkIntentProposal } };
      }
      });
    } catch (error) {
      await reopenReconciliation(recoveryCase, permit, effect,
        { code: "RECONCILIATION_FINALIZATION_FAILED", retryable: true });
      throw error;
    }
  }

  async function authorizeCredentialDelivery(permitId, permitDigest) {
    uuid(permitId, "reconciliation_permit_id");
    digest(permitDigest, "permit_digest");
    const command = { command_id: randomUUID(), operation_id: "kernel.reconciliation_permit.credential_deliver",
      input: { reconciliation_permit_id: permitId, permit_digest: permitDigest },
      actor: { type: "service", id: "local-credential-broker" } };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt }) => {
        const permit = await getReconciliationPermit(permitId, client);
        if (permit.permit_digest !== permitDigest || permit.status !== "consumed"
          || Date.parse(permit.expires_at) <= Date.parse(acceptedAt)) {
          throw new KernelError(409, "RECONCILIATION_CREDENTIAL_DENIED",
            "Credential requires exact consumed unexpired Reconciliation Permit.");
        }
        if (permit.brokered_at) {
          throw new KernelError(409, "CREDENTIAL_ALREADY_DELIVERED",
            "Reconciliation Permit already delivered its one scoped credential.");
        }
        await client.query(`UPDATE kernel_reconciliation_permit_states SET brokered_at=$4,updated_at=$4
          WHERE installation_id=$1 AND environment_id=$2 AND reconciliation_permit_id=$3`,
        [installationId, environmentId, permitId, acceptedAt]);
        return { aggregateType: "reconciliation_permit", aggregateId: permitId,
          transitionType: "kernel.reconciliation_permit.credential_delivered",
          transitionPayload: { recovery_case_id: permit.recovery_case_id },
          result: { authorized: true, binding_ref: permit.permit_document.credential_binding.binding_ref,
            revision: permit.permit_document.credential_binding.revision,
            scopes: permit.permit_document.credential_binding.scopes, target: permit.permit_document.target,
            action: permit.permit_document.action, effect_id: permit.effect_id,
            effect_idempotency_key: permit.permit_document.effect_idempotency_key,
            expires_at: permit.permit_document.expires_at } };
      }
    });
  }

  async function getButlerProjection() {
    const result = await pool.query(`SELECT recovery_case_id FROM kernel_recovery_cases
      WHERE installation_id=$1 AND environment_id=$2 ORDER BY opened_at DESC`, [installationId, environmentId]);
    return Promise.all(result.rows.map(({ recovery_case_id: recoveryCaseId }) => getRecoveryCase(recoveryCaseId)));
  }

  return { openUncertainty, openRestoreUncertainty, reconcile, authorizeCredentialDelivery, getRecoveryCase,
    getRecoveryCaseForEffect, getReconciliationPermit, getButlerProjection };
}
