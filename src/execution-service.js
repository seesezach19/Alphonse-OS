import { randomUUID } from "node:crypto";
import jsonLogic from "json-logic-js";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

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

function strings(value, path, { min = 1, max = 100 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max
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

export function toEpochMilliseconds(value) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new KernelError(500, "INVALID_STORED_TIMESTAMP", "Stored timestamp is invalid.");
  return parsed;
}

function sameStrings(left, right) {
  return canonicalize([...left].sort()) === canonicalize([...right].sort());
}

export function validateExecutionAdmissionInput(value) {
  const input = exact(value, "input", ["idempotency_key", "passport_id", "work_intent_id", "delegation_id",
    "capability_activation_id", "package_version_id", "skill", "context_receipt_ids", "limits",
    "evidence_requirements", "expires_at"]);
  const skill = exact(input.skill, "input.skill", ["export_id", "contract_version", "export_digest"]);
  const limits = exact(input.limits, "input.limits", ["subjects", "sources", "max_items", "max_context_age_seconds"]);
  if (!Number.isInteger(limits.max_items) || limits.max_items < 1 || limits.max_items > 1000
    || !Number.isInteger(limits.max_context_age_seconds) || limits.max_context_age_seconds < 1
    || limits.max_context_age_seconds > 86400) {
    throw new KernelError(400, "INVALID_EXECUTION_LIMIT", "Execution item and freshness limits are invalid.");
  }
  return {
    idempotency_key: string(input.idempotency_key, "input.idempotency_key", 160),
    passport_id: uuid(input.passport_id, "input.passport_id"),
    work_intent_id: uuid(input.work_intent_id, "input.work_intent_id"),
    delegation_id: uuid(input.delegation_id, "input.delegation_id"),
    capability_activation_id: uuid(input.capability_activation_id, "input.capability_activation_id"),
    package_version_id: uuid(input.package_version_id, "input.package_version_id"),
    skill: { export_id: string(skill.export_id, "input.skill.export_id", 200),
      contract_version: string(skill.contract_version, "input.skill.contract_version", 100),
      export_digest: digest(skill.export_digest, "input.skill.export_digest") },
    context_receipt_ids: strings(input.context_receipt_ids, "input.context_receipt_ids").map((id) => uuid(id, "context_receipt_id")),
    limits: { subjects: strings(limits.subjects, "input.limits.subjects"),
      sources: strings(limits.sources, "input.limits.sources", { max: 20 }), max_items: limits.max_items,
      max_context_age_seconds: limits.max_context_age_seconds },
    evidence_requirements: strings(input.evidence_requirements, "input.evidence_requirements"),
    expires_at: timestamp(input.expires_at, "input.expires_at")
  };
}

export function compareInventory(program, observations) {
  if (!Array.isArray(observations)) throw new KernelError(400, "INVALID_COMPARISON_INPUT", "Observations must be an array.");
  const quantities = Object.fromEntries(observations.map((entry) => [`${entry.source}_quantity`, entry.quantity]));
  return Object.fromEntries(Object.entries(object(program, "skill.program"))
    .map(([output, rule]) => [output, jsonLogic.apply(rule, quantities)]));
}

export function validateExecutionCompletionInput(value) {
  const input = exact(value, "input", ["run_id", "envelope_id", "observations", "output"]);
  if (!Array.isArray(input.observations) || input.observations.length === 0 || input.observations.length > 100) {
    throw new KernelError(400, "INVALID_COMPARISON_INPUT", "Comparison observations are invalid.");
  }
  const observations = input.observations.map((entry, index) => {
    const item = exact(entry, `input.observations[${index}]`, ["source", "subject", "quantity", "observed_at", "item_hash"]);
    if (!Number.isInteger(item.quantity)) throw new KernelError(400, "INVALID_COMPARISON_INPUT", "Observation quantity must be an integer.");
    return { source: string(item.source, "observation.source", 100), subject: string(item.subject, "observation.subject", 200),
      quantity: item.quantity, observed_at: timestamp(item.observed_at, "observation.observed_at"),
      item_hash: digest(item.item_hash, "observation.item_hash") };
  });
  const observationKeys = observations.map((item) => `${item.source}\u0000${item.subject}`);
  if (new Set(observationKeys).size !== observationKeys.length) {
    throw new KernelError(400, "INVALID_COMPARISON_INPUT", "Comparison observations must identify unique source subjects.");
  }
  return { run_id: uuid(input.run_id, "input.run_id"), envelope_id: uuid(input.envelope_id, "input.envelope_id"),
    observations, output: object(input.output, "input.output") };
}

export function createExecutionService(database, identityIntent, packageService, deploymentService,
  installationId, environmentId) {
  const { pool, executeCommand } = database;

  async function getEnvelope(envelopeId, client = pool) {
    uuid(envelopeId, "envelope_id");
    const result = await client.query(`SELECT * FROM kernel_execution_envelopes
      WHERE installation_id=$1 AND environment_id=$2 AND envelope_id=$3`, [installationId, environmentId, envelopeId]);
    if (!result.rows[0]) throw new KernelError(404, "EXECUTION_ENVELOPE_NOT_FOUND", "Execution Envelope does not exist.");
    return { ...result.rows[0], immutable: true, external_effect_authority: false };
  }

  async function getRun(runId, client = pool) {
    uuid(runId, "run_id");
    const result = await client.query(
      `SELECT r.*,s.execution_status,s.accountability_status,s.result_digest,s.evidence_record_id,s.completed_at,s.updated_at
       FROM kernel_runs r JOIN kernel_run_states s ON s.installation_id=r.installation_id
        AND s.environment_id=r.environment_id AND s.run_id=r.run_id
       WHERE r.installation_id=$1 AND r.environment_id=$2 AND r.run_id=$3`,
      [installationId, environmentId, runId]
    );
    if (!result.rows[0]) throw new KernelError(404, "RUN_NOT_FOUND", "Run does not exist.");
    const obligations = await client.query(`SELECT * FROM kernel_operational_obligations
      WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3 ORDER BY obligation_key`,
    [installationId, environmentId, runId]);
    return { ...result.rows[0], obligations: obligations.rows };
  }

  async function getEvidence(evidenceRecordId, client = pool) {
    uuid(evidenceRecordId, "evidence_record_id");
    const result = await client.query(`SELECT * FROM kernel_evidence_records
      WHERE installation_id=$1 AND environment_id=$2 AND evidence_record_id=$3`,
    [installationId, environmentId, evidenceRecordId]);
    if (!result.rows[0]) throw new KernelError(404, "EVIDENCE_RECORD_NOT_FOUND", "Evidence Record does not exist.");
    const row = result.rows[0];
    if (sha256Digest(row.evidence_document) !== row.evidence_digest) {
      throw new KernelError(500, "INTEGRITY_VIOLATION", "Evidence Record digest does not match stored document.");
    }
    return { ...row, immutable: true };
  }

  async function contextRows(receiptIds, client = pool) {
    const result = await client.query(
      `SELECT r.*,g.work_intent_id AS grant_work_intent_id,g.agent_principal_id AS grant_agent_principal_id,
              g.subjects AS grant_subjects,g.sources AS grant_sources,g.max_items AS grant_max_items,
              g.max_age_seconds AS grant_max_age_seconds,g.expires_at AS grant_expires_at
       FROM kernel_context_receipts r JOIN kernel_context_access_grants g
        ON g.installation_id=r.installation_id AND g.environment_id=r.environment_id AND g.grant_id=r.grant_id
       WHERE r.installation_id=$1 AND r.environment_id=$2 AND r.receipt_id=ANY($3::uuid[])`,
      [installationId, environmentId, receiptIds]
    );
    if (result.rows.length !== receiptIds.length) throw new KernelError(409, "CONTEXT_RECEIPT_MISSING", "Every exact Context Receipt must exist.");
    return result.rows;
  }

  async function bundleForEnvelope(envelopeId, client = pool) {
    const envelope = await getEnvelope(envelopeId, client);
    const runResult = await client.query(`SELECT run_id FROM kernel_runs
      WHERE installation_id=$1 AND environment_id=$2 AND envelope_id=$3`, [installationId, environmentId, envelopeId]);
    const run = await getRun(runResult.rows[0].run_id, client);
    return { execution_envelope: envelope, run, operational_obligations: run.obligations };
  }

  async function admit(envelope, authenticatedPassport) {
    const input = validateExecutionAdmissionInput(envelope.input);
    if (authenticatedPassport.passport_id !== input.passport_id) {
      throw new KernelError(403, "EXECUTION_PASSPORT_MISMATCH", "Authenticated Runtime Passport does not match admission.");
    }
    const command = { ...envelope, input, actor: { type: "agent", id: authenticatedPassport.agent_principal_id } };
    const admissionDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, input });
    const envelopeId = randomUUID();
    const runId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`execution-admission:${installationId}:${environmentId}:${input.idempotency_key}`]);
        const existing = await client.query(`SELECT envelope_id,admission_digest FROM kernel_execution_envelopes
          WHERE installation_id=$1 AND environment_id=$2 AND idempotency_key=$3 FOR SHARE`,
        [installationId, environmentId, input.idempotency_key]);
        if (existing.rows[0]) {
          if (existing.rows[0].admission_digest !== admissionDigest) {
            throw new KernelError(409, "EXECUTION_IDEMPOTENCY_CONFLICT", "Execution idempotency key binds different admission input.");
          }
          const result = await bundleForEnvelope(existing.rows[0].envelope_id, client);
          return { aggregateType: "execution_envelope", aggregateId: existing.rows[0].envelope_id,
            transitionType: "kernel.execution_envelope.replayed", transitionPayload: { idempotency_key: input.idempotency_key },
            result: { ...result, domain_replayed: true } };
        }
        const passport = await identityIntent.getPassport(input.passport_id, client);
        if (passport.passport_id !== authenticatedPassport.passport_id) {
          throw new KernelError(403, "EXECUTION_PASSPORT_MISMATCH", "Authenticated Runtime Passport does not match admission.");
        }
        if (passport.validity_status !== "valid") throw new KernelError(409, "PASSPORT_NOT_VALID", "Runtime Passport is not valid.");
        const intent = await identityIntent.getWorkIntent(input.work_intent_id, client);
        const delegationResult = await client.query(`SELECT * FROM kernel_delegations
          WHERE installation_id=$1 AND environment_id=$2 AND delegation_id=$3`,
        [installationId, environmentId, input.delegation_id]);
        const delegation = delegationResult.rows[0];
        if (!delegation || delegation.work_intent_id !== intent.work_intent_id
          || delegation.target_passport_id !== passport.passport_id
          || delegation.target_agent_principal_id !== passport.agent_principal_id) {
          throw new KernelError(409, "DELEGATION_MISMATCH", "Delegation does not bind exact Runtime Passport and Work Intent.");
        }
        if (toEpochMilliseconds(delegation.expires_at) <= toEpochMilliseconds(acceptedAt)) {
          throw new KernelError(409, "DELEGATION_EXPIRED", "Delegation expired before execution admission.");
        }
        const responsibility = await client.query(`SELECT * FROM kernel_task_responsibilities
          WHERE installation_id=$1 AND environment_id=$2 AND work_intent_id=$3`,
        [installationId, environmentId, input.work_intent_id]);
        if (responsibility.rows[0]?.responsible_passport_id !== passport.passport_id
          || responsibility.rows[0]?.delegation_id !== delegation.delegation_id) {
          throw new KernelError(409, "RUNTIME_RESPONSIBILITY_MISMATCH", "Runtime does not hold current task responsibility.");
        }
        const activation = await deploymentService.getCapabilityActivation(input.capability_activation_id, client)
          .catch((error) => {
            if (error.code === "CAPABILITY_ACTIVATION_NOT_FOUND") {
              throw new KernelError(409, "CAPABILITY_INACTIVE", "Execution requires an existing active read Capability.");
            }
            throw error;
          });
        const active = await client.query(`SELECT active_activation_id FROM kernel_capability_authority_states
          WHERE installation_id=$1 AND environment_id=$2 AND capability_key=$3`,
        [installationId, environmentId, activation.capability_key]);
        if (active.rows[0]?.active_activation_id !== activation.capability_activation_id) {
          throw new KernelError(409, "CAPABILITY_INACTIVE", "Execution requires the current active Capability version.");
        }
        const deployment = await deploymentService.getDeployment(activation.deployment_id, client);
        if (deployment.work_intent_id !== input.work_intent_id || activation.package_version_id !== input.package_version_id) {
          throw new KernelError(409, "EXECUTION_BINDING_MISMATCH", "Capability, Package, and Work Intent bindings do not match.");
        }
        const packageVersion = await packageService.getPackageVersion(input.package_version_id);
        const capability = packageVersion.candidate.exports.find((entry) => entry.export_id === activation.capability_export_id);
        if (capability?.kind !== "capability" || capability.content.effect_class !== "read_only") {
          throw new KernelError(409, "READ_CAPABILITY_REQUIRED", "Ticket 07 admits only active read Capability authority.");
        }
        const skill = packageVersion.candidate.exports.find((entry) => entry.export_id === capability.content.skill_ref);
        if (!skill || skill.kind !== "skill" || skill.export_id !== input.skill.export_id
          || skill.contract_version !== input.skill.contract_version || sha256Digest(skill.content) !== input.skill.export_digest) {
          throw new KernelError(409, "SKILL_VERSION_MISMATCH", "Execution does not bind the exact Skill version required by Capability.");
        }
        const accountability = packageVersion.candidate.exports
          .find((entry) => entry.export_id === capability.content.accountability_contract_ref);
        if (!accountability || accountability.kind !== "accountability_contract"
          || !sameStrings(accountability.content.evidence_requirements, input.evidence_requirements)) {
          throw new KernelError(409, "EVIDENCE_REQUIREMENTS_MISMATCH", "Execution evidence must exactly match Accountability Contract.");
        }
        const plan = await deploymentService.getDeploymentPlan(deployment.deployment_plan_id, client);
        const planCandidate = plan.plan.capability_candidates.find((entry) => entry.capability_export_id === capability.export_id);
        if (!planCandidate || !sameStrings(planCandidate.context_binding.sources, input.limits.sources)
          || input.limits.max_context_age_seconds > capability.content.context_requirements.max_age_seconds) {
          throw new KernelError(409, "EXECUTION_BOUNDS_EXCEEDED", "Execution context bounds exceed active Capability authority.");
        }
        const receipts = await contextRows(input.context_receipt_ids, client);
        const itemReferences = receipts.flatMap((row) => row.item_references);
        const authorities = receipts.flatMap((row) => row.authority_claims.map((claim) => claim.authority));
        const actualSubjects = [...new Set(itemReferences.map((item) => item.subject))];
        const actualSources = [...new Set(itemReferences.map((item) => item.source))];
        const requiredAuthorities = capability.content.context_requirements.authority;
        if (receipts.some((row) => input.limits.max_items > row.grant_max_items)
          || itemReferences.length > input.limits.max_items) {
          throw new KernelError(409, "EXECUTION_BOUNDS_EXCEEDED", "Execution item bounds exceed Context Grant or exact receipt.");
        }
        if (receipts.some((row) => row.recipient_principal_id !== passport.agent_principal_id
          || row.grant_work_intent_id !== input.work_intent_id
          || toEpochMilliseconds(row.grant_expires_at) <= toEpochMilliseconds(acceptedAt))
          || !sameStrings(actualSubjects, input.limits.subjects) || !sameStrings(actualSources, input.limits.sources)
          || requiredAuthorities.some((required) => !authorities.includes(required))) {
          throw new KernelError(409, "EXECUTION_CONTEXT_MISMATCH", "Context does not bind recipient, intent, authority, subjects, sources, and limits.");
        }
        for (const row of receipts) {
          for (const claim of row.freshness_claims) {
            const currentAge = Math.max(0, Math.floor((toEpochMilliseconds(acceptedAt)
              - toEpochMilliseconds(claim.observed_at)) / 1000));
            if (currentAge > input.limits.max_context_age_seconds || currentAge > row.grant_max_age_seconds) {
              throw new KernelError(409, "STALE_CONTEXT", "Context is stale at execution admission.", { current_age_seconds: currentAge });
            }
          }
        }
        const freshnessCeiling = Math.min(...receipts.flatMap((row) => row.freshness_claims
          .map((claim) => toEpochMilliseconds(claim.observed_at) + input.limits.max_context_age_seconds * 1000)));
        const expiryCeiling = Math.min(toEpochMilliseconds(passport.expires_at),
          toEpochMilliseconds(delegation.expires_at), freshnessCeiling,
          ...receipts.map((row) => toEpochMilliseconds(row.grant_expires_at)));
        if (toEpochMilliseconds(input.expires_at) <= toEpochMilliseconds(acceptedAt)
          || toEpochMilliseconds(input.expires_at) > expiryCeiling) {
          throw new KernelError(409, "EXECUTION_EXPIRY_INVALID", "Execution Envelope expiry exceeds an authority or context lease.");
        }
        const envelopeDocument = { envelope_id: envelopeId, installation_id: installationId, environment_id: environmentId,
          idempotency_key: input.idempotency_key, passport_id: passport.passport_id,
          agent_principal_id: passport.agent_principal_id, work_intent_id: input.work_intent_id,
          delegation_id: delegation.delegation_id, capability_activation_id: activation.capability_activation_id,
          package_version_id: packageVersion.package_version_id, skill_binding: input.skill,
          context_receipt_ids: input.context_receipt_ids, limits: input.limits,
          evidence_requirements: input.evidence_requirements, expires_at: input.expires_at, admitted_at: acceptedAt,
          external_effect_authority: false };
        const envelopeDigest = sha256Digest(envelopeDocument);
        await client.query(`INSERT INTO kernel_execution_envelopes
          (envelope_id,installation_id,environment_id,idempotency_key,admission_digest,envelope_digest,passport_id,
           agent_principal_id,work_intent_id,delegation_id,capability_activation_id,package_version_id,skill_binding,
           context_receipt_ids,limits,evidence_requirements,expires_at,admitted_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [envelopeId, installationId, environmentId, input.idempotency_key, admissionDigest, envelopeDigest,
          passport.passport_id, passport.agent_principal_id, input.work_intent_id, delegation.delegation_id,
          activation.capability_activation_id, packageVersion.package_version_id, input.skill,
          JSON.stringify(input.context_receipt_ids), input.limits, JSON.stringify(input.evidence_requirements),
          input.expires_at, acceptedAt]);
        await client.query(`INSERT INTO kernel_runs (run_id,installation_id,environment_id,envelope_id,created_at)
          VALUES ($1,$2,$3,$4,$5)`, [runId, installationId, environmentId, envelopeId, acceptedAt]);
        await client.query(`INSERT INTO kernel_run_states
          (installation_id,environment_id,run_id,execution_status,accountability_status,updated_at)
          VALUES ($1,$2,$3,'admitted','pending',$4)`, [installationId, environmentId, runId, acceptedAt]);
        const deadline = new Date(Math.min(toEpochMilliseconds(input.expires_at),
          toEpochMilliseconds(acceptedAt) + accountability.content.deadline_seconds * 1000)).toISOString();
        for (const requirement of input.evidence_requirements) {
          await client.query(`INSERT INTO kernel_operational_obligations
            (obligation_id,installation_id,environment_id,run_id,obligation_key,requirement,status,deadline_at,created_at)
            VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8)`,
          [randomUUID(), installationId, environmentId, runId, sha256Digest(requirement), requirement, deadline, acceptedAt]);
        }
        return { aggregateType: "execution_envelope", aggregateId: envelopeId,
          transitionType: "kernel.execution_envelope.admitted", transitionPayload: { run_id: runId,
            capability_activation_id: activation.capability_activation_id, envelope_digest: envelopeDigest },
          result: { execution_envelope: { ...envelopeDocument, envelope_digest: envelopeDigest, immutable: true },
            run: { run_id: runId, envelope_id: envelopeId, execution_status: "admitted",
              accountability_status: "pending", created_at: acceptedAt },
            operational_obligations: input.evidence_requirements.map((requirement) => ({ requirement, status: "open", deadline_at: deadline })),
            domain_replayed: false } };
      }
    });
  }

  async function completeComparison(envelope, authenticatedPassport) {
    const input = validateExecutionCompletionInput(envelope.input);
    const admittedEnvelope = await getEnvelope(input.envelope_id);
    if (admittedEnvelope.passport_id !== authenticatedPassport.passport_id) {
      throw new KernelError(403, "EXECUTION_PASSPORT_MISMATCH", "Only admitted Runtime Passport may complete Run.");
    }
    const command = { ...envelope, input, actor: { type: "agent", id: authenticatedPassport.agent_principal_id } };
    const evidenceRecordId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt }) => {
        const executionEnvelope = await getEnvelope(input.envelope_id, client);
        if (executionEnvelope.passport_id !== authenticatedPassport.passport_id) {
          throw new KernelError(403, "EXECUTION_PASSPORT_MISMATCH", "Only admitted Runtime Passport may complete Run.");
        }
        if (toEpochMilliseconds(executionEnvelope.expires_at) <= toEpochMilliseconds(acceptedAt)) {
          throw new KernelError(409, "EXECUTION_ENVELOPE_EXPIRED", "Execution Envelope expired before completion.");
        }
        const stateResult = await client.query(
          `SELECT s.* FROM kernel_runs r JOIN kernel_run_states s ON s.installation_id=r.installation_id
            AND s.environment_id=r.environment_id AND s.run_id=r.run_id
           WHERE r.installation_id=$1 AND r.environment_id=$2 AND r.run_id=$3 AND r.envelope_id=$4 FOR UPDATE OF s`,
          [installationId, environmentId, input.run_id, input.envelope_id]
        );
        const state = stateResult.rows[0];
        if (!state) throw new KernelError(404, "RUN_NOT_FOUND", "Run and Envelope binding does not exist.");
        if (state.execution_status !== "admitted") throw new KernelError(409, "RUN_ALREADY_FINAL", "Run already reached a final execution state.");
        const delegation = await client.query(`SELECT expires_at FROM kernel_delegations
          WHERE installation_id=$1 AND environment_id=$2 AND delegation_id=$3`,
        [installationId, environmentId, executionEnvelope.delegation_id]);
        if (toEpochMilliseconds(delegation.rows[0].expires_at) <= toEpochMilliseconds(acceptedAt)) {
          throw new KernelError(409, "DELEGATION_EXPIRED", "Delegation expired before Run completion.");
        }
        const receipts = await contextRows(executionEnvelope.context_receipt_ids, client);
        const references = receipts.flatMap((row) => row.item_references.map((reference) => ({
          context_receipt_id: row.receipt_id, ...reference
        })));
        if (references.length !== input.observations.length) {
          throw new KernelError(409, "EVIDENCE_SOURCE_MISMATCH", "Comparison must cover every exact Context Receipt item.");
        }
        for (const observation of input.observations) {
          const payload = { source: observation.source, sku: observation.subject, quantity: observation.quantity,
            observed_at: observation.observed_at };
          if (sha256Digest(payload) !== observation.item_hash
            || !references.some((reference) => reference.source === observation.source
              && reference.subject === observation.subject && reference.item_hash === observation.item_hash
              && new Date(reference.observed_at).toISOString() === observation.observed_at)) {
            throw new KernelError(409, "EVIDENCE_SOURCE_MISMATCH", "Observation does not match exact signed context source link.");
          }
        }
        const packageVersion = await packageService.getPackageVersion(executionEnvelope.package_version_id);
        const skill = packageVersion.candidate.exports.find((entry) => entry.export_id === executionEnvelope.skill_binding.export_id);
        if (!skill || sha256Digest(skill.content) !== executionEnvelope.skill_binding.export_digest) {
          throw new KernelError(409, "SKILL_VERSION_MISMATCH", "Run Skill no longer verifies against Envelope.");
        }
        const computed = compareInventory(skill.content.program, input.observations);
        const requiredOutputs = skill.content.output_schema.required;
        if (!sameStrings(Object.keys(input.output), requiredOutputs) || canonicalize(input.output) !== canonicalize(computed)) {
          throw new KernelError(409, "COMPARISON_OUTPUT_MISMATCH", "Runtime output does not match exact deterministic Skill result.");
        }
        const sourceLinks = references.map((reference) => ({ context_receipt_id: reference.context_receipt_id,
          source: reference.source, subject: reference.subject, release_id: reference.release_id,
          item_hash: reference.item_hash, observed_at: new Date(reference.observed_at).toISOString() }));
        const resultDigest = sha256Digest(input.output);
        const evidenceDocument = { evidence_record_id: evidenceRecordId, run_id: input.run_id,
          envelope_id: input.envelope_id, passport_id: executionEnvelope.passport_id,
          work_intent_id: executionEnvelope.work_intent_id,
          capability_activation_id: executionEnvelope.capability_activation_id,
          package_version_id: executionEnvelope.package_version_id, skill_binding: executionEnvelope.skill_binding,
          context_receipt_ids: executionEnvelope.context_receipt_ids, source_links: sourceLinks,
          result: input.output, result_digest: resultDigest, evidence_requirements: executionEnvelope.evidence_requirements,
          recorded_at: acceptedAt, external_effects: [] };
        const evidenceDigest = sha256Digest(evidenceDocument);
        await client.query(`INSERT INTO kernel_evidence_records
          (evidence_record_id,installation_id,environment_id,run_id,envelope_id,evidence_document,evidence_digest,
           source_links,result,recorded_by_principal_id,recorded_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [evidenceRecordId, installationId, environmentId, input.run_id, input.envelope_id, evidenceDocument,
          evidenceDigest, JSON.stringify(sourceLinks), input.output, authenticatedPassport.agent_principal_id, acceptedAt]);
        const obligations = await client.query(`UPDATE kernel_operational_obligations
          SET status='satisfied',evidence_record_id=$4,satisfied_at=$5
          WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3 AND status='open' RETURNING *`,
        [installationId, environmentId, input.run_id, evidenceRecordId, acceptedAt]);
        if (obligations.rowCount !== executionEnvelope.evidence_requirements.length) {
          throw new KernelError(409, "OBLIGATION_STATE_MISMATCH", "Run obligations do not match Envelope evidence requirements.");
        }
        await client.query(`UPDATE kernel_run_states SET execution_status='completed',accountability_status='satisfied',
          result_digest=$4,evidence_record_id=$5,completed_at=$6,updated_at=$6
          WHERE installation_id=$1 AND environment_id=$2 AND run_id=$3`,
        [installationId, environmentId, input.run_id, resultDigest, evidenceRecordId, acceptedAt]);
        return { aggregateType: "run", aggregateId: input.run_id, transitionType: "kernel.run.completed",
          transitionPayload: { envelope_id: input.envelope_id, evidence_record_id: evidenceRecordId, result_digest: resultDigest },
          result: { run: { run_id: input.run_id, envelope_id: input.envelope_id, execution_status: "completed",
            accountability_status: "satisfied", result_digest: resultDigest, evidence_record_id: evidenceRecordId,
            completed_at: acceptedAt }, evidence_record: { ...evidenceDocument, evidence_digest: evidenceDigest,
              immutable: true }, operational_obligations: obligations.rows } };
      }
    });
  }

  async function getButlerProjection() {
    const result = await pool.query(`SELECT run_id FROM kernel_runs
      WHERE installation_id=$1 AND environment_id=$2 ORDER BY created_at DESC`, [installationId, environmentId]);
    const projected = [];
    for (const row of result.rows) {
      const run = await getRun(row.run_id);
      const envelope = await getEnvelope(run.envelope_id);
      const evidence = run.evidence_record_id ? await getEvidence(run.evidence_record_id) : null;
      projected.push({ run_id: run.run_id, envelope_id: run.envelope_id,
        execution: { status: run.execution_status, result_digest: run.result_digest, completed_at: run.completed_at },
        accountability: { status: run.accountability_status,
          obligations: run.obligations.map((obligation) => ({ obligation_id: obligation.obligation_id,
            requirement: obligation.requirement, status: obligation.status, deadline_at: obligation.deadline_at,
            evidence_record_id: obligation.evidence_record_id })) },
        bindings: { passport_id: envelope.passport_id, work_intent_id: envelope.work_intent_id,
          delegation_id: envelope.delegation_id, capability_activation_id: envelope.capability_activation_id,
          package_version_id: envelope.package_version_id, skill: envelope.skill_binding,
          context_receipt_ids: envelope.context_receipt_ids },
        evidence: evidence ? { evidence_record_id: evidence.evidence_record_id,
          evidence_digest: evidence.evidence_digest, source_links: evidence.source_links } : null });
    }
    return projected;
  }

  return { admit, getEnvelope, getRun, getEvidence, completeComparison, getButlerProjection };
}
