import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

function requireString(value, path, max = 500) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must contain 1 to ${max} characters.`);
  }
  return value.trim();
}

function requireUuid(value, path) {
  const id = requireString(value, path, 100);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new KernelError(400, "INVALID_IDENTIFIER", `${path} must be a UUID.`);
  }
  return id;
}

function requireObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be an object.`);
  }
  return value;
}

function requireSafeObject(value, path) {
  const object = requireObject(value, path);
  if (JSON.stringify(object).length > 32_768) throw new KernelError(400, "INVALID_INPUT", `${path} exceeds 32 KiB.`);
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    for (const [key, nested] of Object.entries(item)) {
      if (/(secret|password|token|credential|private[_-]?key)/i.test(key)) {
        throw new KernelError(400, "SENSITIVE_METADATA_REJECTED", `${path} contains a credential-like field.`);
      }
      visit(nested);
    }
  };
  visit(object);
  return object;
}

function requireBaseReferences(value) {
  const references = requireSafeObject(value, "input.base_references");
  if (typeof references.kernel_protocol !== "string" || !/^\d+\.\d+\.\d+$/.test(references.kernel_protocol) ||
      typeof references.toolkit_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(references.toolkit_digest)) {
    throw new KernelError(400, "INVALID_BASE_REFERENCES", "Base references require exact kernel_protocol semver and toolkit_digest SHA-256.");
  }
  return references;
}

function requireStringArray(value, path) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be a non-empty string array.`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function requireTimestamp(value, path) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new KernelError(400, "INVALID_INPUT", `${path} must be an ISO timestamp.`);
  return new Date(timestamp).toISOString();
}

function passportState(passport, now = Date.now()) {
  if (now < Date.parse(passport.valid_from)) return "not_yet_valid";
  if (now >= Date.parse(passport.expires_at)) return "expired";
  return "valid";
}

function assertPassportValid(passport) {
  const state = passportState(passport);
  if (state === "expired") throw new KernelError(409, "PASSPORT_EXPIRED", "Agent Passport has expired.");
  if (state === "not_yet_valid") throw new KernelError(409, "PASSPORT_NOT_YET_VALID", "Agent Passport is not yet valid.");
}

export function validateCommandEnvelope(value, operationId) {
  requireObject(value, "command");
  const commandId = requireString(value.command_id, "command_id", 160);
  if (value.operation_id !== operationId) {
    throw new KernelError(400, "UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  }
  return { command_id: commandId, operation_id: operationId, input: requireObject(value.input, "input") };
}

export function createIdentityIntentService(database, installationId, environmentId, bootstrapSubject) {
  const { pool, executeCommand } = database;

  async function findHumanActor() {
    const result = await pool.query(
      `SELECT principal_id, principal_type, display_name FROM kernel_principals
       WHERE installation_id = $1 AND environment_id = $2 AND external_subject = $3`,
      [installationId, environmentId, bootstrapSubject]
    );
    return result.rows[0] ?? null;
  }

  async function findAcceptedActor(commandId) {
    const result = await pool.query(
      `SELECT actor_type, actor_id FROM kernel_commands
       WHERE installation_id=$1 AND environment_id=$2 AND command_id=$3`,
      [installationId, environmentId, commandId]
    );
    return result.rows[0] ? { type: result.rows[0].actor_type, id: result.rows[0].actor_id } : null;
  }

  async function requireHumanActor() {
    const actor = await findHumanActor();
    if (!actor || actor.principal_type !== "human") {
      throw new KernelError(403, "HUMAN_PRINCIPAL_REQUIRED", "Create the sponsoring human Principal first.");
    }
    return { type: "human", id: actor.principal_id };
  }

  async function authenticateAgent(token) {
    const digest = sha256Digest(requireString(token, "agent authentication token", 500));
    const result = await pool.query(
      `SELECT passport_id FROM kernel_agent_passports
       WHERE installation_id=$1 AND environment_id=$2 AND authentication_digest=$3`,
      [installationId, environmentId, digest]
    );
    if (!result.rows[0]) throw new KernelError(403, "INVALID_AGENT_CREDENTIAL", "Agent credential is invalid.");
    const passport = await getPassport(result.rows[0].passport_id);
    assertPassportValid(passport);
    return passport;
  }

  function digestCommand(command) {
    return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
  }

  async function createPrincipal(envelope) {
    const principalType = requireString(envelope.input.principal_type, "input.principal_type", 20);
    if (!new Set(["human", "agent", "system"]).has(principalType)) {
      throw new KernelError(400, "INVALID_INPUT", "input.principal_type is unsupported.");
    }
    const displayName = requireString(envelope.input.display_name, "input.display_name", 120);
    const acceptedActor = await findAcceptedActor(envelope.command_id);
    const existingHuman = acceptedActor ? null : await findHumanActor();
    if (!acceptedActor && !existingHuman && principalType !== "human") {
      throw new KernelError(409, "SPONSOR_PRINCIPAL_REQUIRED", "The first Principal must be the sponsoring human.");
    }
    if (!acceptedActor && existingHuman && principalType === "human") {
      throw new KernelError(409, "HUMAN_PRINCIPAL_EXISTS", "The bootstrap subject already has a human Principal.");
    }
    const actor = acceptedActor ?? (existingHuman
      ? { type: "human", id: existingHuman.principal_id }
      : { type: "bootstrap", id: bootstrapSubject });
    const command = { ...envelope, actor };
    const principalId = randomUUID();
    return executeCommand({
      installationId, environmentId, command, requestDigest: digestCommand(command),
      apply: async (client, { acceptedAt }) => {
        await client.query(
          `INSERT INTO kernel_principals
            (principal_id, installation_id, environment_id, principal_type, display_name, external_subject,
             created_by_type, created_by_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [principalId, installationId, environmentId, principalType, displayName,
            principalType === "human" ? bootstrapSubject : null, actor.type, actor.id, acceptedAt]
        );
        return {
          aggregateType: "principal", aggregateId: principalId, transitionType: "kernel.principal.created",
          transitionPayload: { principal_type: principalType },
          result: { principal: { principal_id: principalId, principal_type: principalType, display_name: displayName,
            external_subject: principalType === "human" ? bootstrapSubject : null, created_at: acceptedAt,
            authority_granted: false } }
        };
      }
    });
  }

  async function getPrincipal(principalId) {
    requireUuid(principalId, "principal_id");
    const result = await pool.query(
      `SELECT principal_id, principal_type, display_name, external_subject, created_at
       FROM kernel_principals WHERE installation_id=$1 AND environment_id=$2 AND principal_id=$3`,
      [installationId, environmentId, principalId]
    );
    if (!result.rows[0]) throw new KernelError(404, "PRINCIPAL_NOT_FOUND", "Principal does not exist.");
    return { ...result.rows[0], authority_granted: false };
  }

  async function issuePassport(envelope) {
    const actor = await requireHumanActor();
    const command = { ...envelope, actor };
    const input = envelope.input;
    const agentPrincipalId = requireUuid(input.agent_principal_id, "input.agent_principal_id");
    const sponsorPrincipalId = requireUuid(input.sponsor_principal_id, "input.sponsor_principal_id");
    if (sponsorPrincipalId !== actor.id) throw new KernelError(403, "SPONSOR_MISMATCH", "Sponsor must be the authenticated human Principal.");
    const runtime = requireSafeObject(input.runtime, "input.runtime");
    const modelConfiguration = requireSafeObject(input.model_configuration, "input.model_configuration");
    const packageSkillConfiguration = requireSafeObject(input.package_skill_configuration, "input.package_skill_configuration");
    const authenticationToken = requireString(input.agent_authentication_token, "input.agent_authentication_token", 500);
    if (authenticationToken.length < 32) throw new KernelError(400, "INVALID_AGENT_CREDENTIAL", "Agent authentication token must contain at least 32 characters.");
    const authenticationDigest = sha256Digest(authenticationToken);
    const permittedIntentClasses = requireStringArray(input.permitted_intent_classes, "input.permitted_intent_classes");
    const provenance = requireSafeObject(input.provenance, "input.provenance");
    const validFrom = requireTimestamp(input.valid_from, "input.valid_from");
    const expiresAt = requireTimestamp(input.expires_at, "input.expires_at");
    if (Date.parse(expiresAt) <= Date.parse(validFrom)) throw new KernelError(400, "INVALID_VALIDITY_WINDOW", "Passport expiry must follow validity start.");
    const passportId = randomUUID();
    const configurationDigest = sha256Digest({ runtime, model_configuration: modelConfiguration,
      package_skill_configuration: packageSkillConfiguration });
    return executeCommand({
      installationId, environmentId, command, requestDigest: digestCommand(command),
      apply: async (client, { acceptedAt }) => {
        const principals = await client.query(
          `SELECT principal_id, principal_type FROM kernel_principals
           WHERE installation_id=$1 AND environment_id=$2 AND principal_id = ANY($3::uuid[])`,
          [installationId, environmentId, [agentPrincipalId, sponsorPrincipalId]]
        );
        const agent = principals.rows.find((row) => row.principal_id === agentPrincipalId);
        const sponsor = principals.rows.find((row) => row.principal_id === sponsorPrincipalId);
        if (!agent || agent.principal_type !== "agent") throw new KernelError(409, "AGENT_PRINCIPAL_INVALID", "Agent Principal is missing or not an agent.");
        if (!sponsor || sponsor.principal_type !== "human") throw new KernelError(409, "SPONSOR_PRINCIPAL_INVALID", "Sponsor Principal is missing or not human.");
        await client.query(
          `INSERT INTO kernel_agent_passports
            (passport_id,installation_id,environment_id,agent_principal_id,sponsor_principal_id,runtime,
             model_configuration,package_skill_configuration,configuration_digest,authentication_digest,permitted_intent_classes,
             provenance,valid_from,expires_at,issued_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [passportId, installationId, environmentId, agentPrincipalId, sponsorPrincipalId, runtime,
            modelConfiguration, packageSkillConfiguration, configurationDigest, authenticationDigest, permittedIntentClasses,
            provenance, validFrom, expiresAt, acceptedAt]
        );
        return {
          aggregateType: "agent_passport", aggregateId: passportId, transitionType: "kernel.agent_passport.issued",
          transitionPayload: { agent_principal_id: agentPrincipalId, sponsor_principal_id: sponsorPrincipalId },
          result: { passport: { passport_id: passportId, agent_principal_id: agentPrincipalId,
            sponsor_principal_id: sponsorPrincipalId, runtime, model_configuration: modelConfiguration,
            package_skill_configuration: packageSkillConfiguration, configuration_digest: configurationDigest,
            permitted_intent_classes: permittedIntentClasses, provenance, valid_from: validFrom,
            expires_at: expiresAt, issued_at: acceptedAt, validity_status: passportState({ valid_from: validFrom, expires_at: expiresAt }),
            authority_granted: false } }
        };
      }
    });
  }

  async function getPassport(passportId, client = pool) {
    requireUuid(passportId, "passport_id");
    const result = await client.query(
      `SELECT * FROM kernel_agent_passports WHERE installation_id=$1 AND environment_id=$2 AND passport_id=$3`,
      [installationId, environmentId, passportId]
    );
    if (!result.rows[0]) throw new KernelError(404, "PASSPORT_NOT_FOUND", "Agent Passport does not exist.");
    const expectedDigest = sha256Digest({ runtime: result.rows[0].runtime,
      model_configuration: result.rows[0].model_configuration,
      package_skill_configuration: result.rows[0].package_skill_configuration });
    if (expectedDigest !== result.rows[0].configuration_digest) {
      throw new KernelError(500, "INTEGRITY_VIOLATION", "Agent Passport digest does not match stored content.");
    }
    const { authentication_digest: _authenticationDigest, ...passport } = result.rows[0];
    return { ...passport, validity_status: passportState(passport), authority_granted: false };
  }

  async function proposeIntent(envelope, authenticatedPassport) {
    const actor = { type: "agent", id: authenticatedPassport.agent_principal_id };
    const command = { ...envelope, actor };
    const input = envelope.input;
    const passportId = requireUuid(input.passport_id, "input.passport_id");
    const intentClass = requireString(input.intent_class, "input.intent_class", 100);
    const objective = requireString(input.objective, "input.objective", 1000);
    const requestedOutcome = requireString(input.requested_outcome, "input.requested_outcome", 1000);
    const scope = requireSafeObject(input.scope, "input.scope");
    const constraints = requireSafeObject(input.constraints, "input.constraints");
    const proposalId = randomUUID();
    const payloadDigest = sha256Digest({ intent_class: intentClass, objective, requested_outcome: requestedOutcome, scope, constraints });
    return executeCommand({
      installationId, environmentId, command, requestDigest: digestCommand(command),
      apply: async (client, { acceptedAt }) => {
        const passport = await getPassport(passportId, client);
        assertPassportValid(passport);
        if (passport.passport_id !== authenticatedPassport.passport_id) throw new KernelError(403, "PASSPORT_AUTHENTICATION_MISMATCH", "Authenticated Passport does not match proposal Passport.");
        if (!passport.permitted_intent_classes.includes(intentClass)) throw new KernelError(409, "INTENT_CLASS_NOT_PERMITTED", "Passport does not permit this intent class.");
        await client.query(
          `INSERT INTO kernel_work_intent_proposals
            (proposal_id,installation_id,environment_id,passport_id,agent_principal_id,proposed_by_principal_id,
             intent_class,objective,requested_outcome,scope,constraints,payload_digest,proposed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [proposalId, installationId, environmentId, passportId, passport.agent_principal_id, passport.agent_principal_id,
            intentClass, objective, requestedOutcome, scope, constraints, payloadDigest, acceptedAt]
        );
        return {
          aggregateType: "work_intent_proposal", aggregateId: proposalId, transitionType: "kernel.work_intent.proposed",
          transitionPayload: { passport_id: passportId, payload_digest: payloadDigest },
          result: { proposal: { proposal_id: proposalId, status: "proposed", passport_id: passportId,
            agent_principal_id: passport.agent_principal_id, proposed_by_principal_id: passport.agent_principal_id, intent_class: intentClass,
            objective, requested_outcome: requestedOutcome, scope, constraints, payload_digest: payloadDigest,
            proposed_at: acceptedAt, authority_granted: false } }
        };
      }
    });
  }

  async function getProposal(proposalId, client = pool) {
    requireUuid(proposalId, "proposal_id");
    const result = await client.query(
      `SELECT p.*, w.work_intent_id FROM kernel_work_intent_proposals p
       LEFT JOIN kernel_work_intents w ON w.installation_id=p.installation_id AND w.environment_id=p.environment_id
        AND w.proposal_id=p.proposal_id
       WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.proposal_id=$3`,
      [installationId, environmentId, proposalId]
    );
    if (!result.rows[0]) throw new KernelError(404, "PROPOSAL_NOT_FOUND", "Work Intent proposal does not exist.");
    const expectedDigest = sha256Digest({ intent_class: result.rows[0].intent_class, objective: result.rows[0].objective,
      requested_outcome: result.rows[0].requested_outcome, scope: result.rows[0].scope,
      constraints: result.rows[0].constraints });
    if (expectedDigest !== result.rows[0].payload_digest) throw new KernelError(500, "INTEGRITY_VIOLATION", "Proposal digest mismatch.");
    return { ...result.rows[0], status: result.rows[0].work_intent_id ? "confirmed" : "proposed", authority_granted: false };
  }

  async function confirmIntent(envelope, proposalId) {
    requireUuid(proposalId, "proposal_id");
    const actor = await requireHumanActor();
    const command = { ...envelope, input: { ...envelope.input, proposal_id: proposalId }, actor };
    const workIntentId = randomUUID();
    return executeCommand({
      installationId, environmentId, command, requestDigest: digestCommand(command),
      apply: async (client, { acceptedAt }) => {
        const proposal = await getProposal(proposalId, client);
        if (proposal.work_intent_id) throw new KernelError(409, "INTENT_ALREADY_CONFIRMED", "Proposal already has a confirmed Work Intent.");
        const passport = await getPassport(proposal.passport_id, client);
        assertPassportValid(passport);
        if (passport.sponsor_principal_id !== actor.id) throw new KernelError(403, "SPONSOR_MISMATCH", "Only the sponsoring human may confirm this intent.");
        await client.query(
          `INSERT INTO kernel_work_intents
            (work_intent_id,installation_id,environment_id,proposal_id,passport_id,agent_principal_id,
             confirmed_by_principal_id,intent_class,objective,requested_outcome,scope,constraints,payload_digest,confirmed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [workIntentId, installationId, environmentId, proposalId, proposal.passport_id,
            proposal.agent_principal_id, actor.id, proposal.intent_class, proposal.objective,
            proposal.requested_outcome, proposal.scope, proposal.constraints, proposal.payload_digest, acceptedAt]
        );
        return {
          aggregateType: "work_intent", aggregateId: workIntentId, transitionType: "kernel.work_intent.confirmed",
          transitionPayload: { proposal_id: proposalId, payload_digest: proposal.payload_digest },
          result: { work_intent: { work_intent_id: workIntentId, proposal_id: proposalId,
            passport_id: proposal.passport_id, agent_principal_id: proposal.agent_principal_id,
            confirmed_by_principal_id: actor.id, intent_class: proposal.intent_class, objective: proposal.objective,
            requested_outcome: proposal.requested_outcome, scope: proposal.scope, constraints: proposal.constraints,
            payload_digest: proposal.payload_digest, confirmed_at: acceptedAt, authority_granted: false } }
        };
      }
    });
  }

  async function getWorkIntent(workIntentId, client = pool) {
    requireUuid(workIntentId, "work_intent_id");
    const result = await client.query(
      `SELECT * FROM kernel_work_intents WHERE installation_id=$1 AND environment_id=$2 AND work_intent_id=$3`,
      [installationId, environmentId, workIntentId]
    );
    if (!result.rows[0]) throw new KernelError(404, "WORK_INTENT_NOT_FOUND", "Confirmed Work Intent does not exist.");
    const expectedDigest = sha256Digest({ intent_class: result.rows[0].intent_class, objective: result.rows[0].objective,
      requested_outcome: result.rows[0].requested_outcome, scope: result.rows[0].scope,
      constraints: result.rows[0].constraints });
    if (expectedDigest !== result.rows[0].payload_digest) throw new KernelError(500, "INTEGRITY_VIOLATION", "Work Intent digest mismatch.");
    return { ...result.rows[0], status: "confirmed", authority_granted: false };
  }

  async function openBuildSession(envelope) {
    const actor = await requireHumanActor();
    const command = { ...envelope, actor };
    const input = envelope.input;
    const principalId = requireUuid(input.principal_id, "input.principal_id");
    const passportId = requireUuid(input.passport_id, "input.passport_id");
    const workIntentId = requireUuid(input.work_intent_id, "input.work_intent_id");
    const baseReferences = requireBaseReferences(input.base_references);
    const expiresAt = requireTimestamp(input.expires_at, "input.expires_at");
    if (Date.parse(expiresAt) <= Date.now()) throw new KernelError(400, "INVALID_EXPIRY", "Build Session expiry must be in the future.");
    const buildSessionId = randomUUID();
    return executeCommand({
      installationId, environmentId, command, requestDigest: digestCommand(command),
      apply: async (client, { acceptedAt }) => {
        const passport = await getPassport(passportId, client);
        assertPassportValid(passport);
        const workIntent = await getWorkIntent(workIntentId, client);
        if (passport.sponsor_principal_id !== actor.id) throw new KernelError(403, "SPONSOR_MISMATCH", "Passport sponsor does not match authenticated human.");
        if (passport.agent_principal_id !== principalId) throw new KernelError(409, "PASSPORT_PRINCIPAL_MISMATCH", "Passport does not bind the requested agent Principal.");
        if (workIntent.passport_id !== passportId || workIntent.agent_principal_id !== principalId) {
          throw new KernelError(409, "PASSPORT_INTENT_MISMATCH", "Passport, agent Principal, and Work Intent do not match.");
        }
        if (Date.parse(expiresAt) > Date.parse(passport.expires_at)) {
          throw new KernelError(409, "SESSION_EXCEEDS_PASSPORT", "Build Session cannot outlive its Passport.");
        }
        await client.query(
          `INSERT INTO kernel_build_sessions
            (build_session_id,installation_id,environment_id,principal_id,passport_id,work_intent_id,
             base_references,expires_at,opened_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [buildSessionId, installationId, environmentId, principalId, passportId, workIntentId,
            baseReferences, expiresAt, acceptedAt]
        );
        return {
          aggregateType: "build_session", aggregateId: buildSessionId, transitionType: "kernel.build_session.opened",
          transitionPayload: { principal_id: principalId, passport_id: passportId, work_intent_id: workIntentId },
          result: { build_session: { build_session_id: buildSessionId, principal_id: principalId,
            passport_id: passportId, work_intent_id: workIntentId, base_references: baseReferences,
            expires_at: expiresAt, opened_at: acceptedAt, status: "active", authority_granted: false } }
        };
      }
    });
  }

  async function getBuildSession(buildSessionId) {
    requireUuid(buildSessionId, "build_session_id");
    const result = await pool.query(
      `SELECT * FROM kernel_build_sessions WHERE installation_id=$1 AND environment_id=$2 AND build_session_id=$3`,
      [installationId, environmentId, buildSessionId]
    );
    if (!result.rows[0]) throw new KernelError(404, "BUILD_SESSION_NOT_FOUND", "Build Session does not exist.");
    return { ...result.rows[0], status: Date.now() >= Date.parse(result.rows[0].expires_at) ? "expired" : "active",
      authority_granted: false };
  }

  async function checkAdmission(input) {
    const actor = await requireHumanActor();
    const passportId = requireUuid(input.passport_id, "passport_id");
    const accessClass = requireString(input.access_class, "access_class", 50);
    const passport = await getPassport(passportId);
    assertPassportValid(passport);
    if (passport.sponsor_principal_id !== actor.id) throw new KernelError(403, "SPONSOR_MISMATCH", "Passport sponsor does not match authenticated human.");
    if (input.proposal_id) {
      const proposal = await getProposal(input.proposal_id);
      if (proposal.passport_id !== passportId) throw new KernelError(409, "PASSPORT_INTENT_MISMATCH", "Passport does not match proposal.");
      if (accessClass === "public_discovery") return { allowed: true, basis: "provisional_intent", authority_granted: false };
      throw new KernelError(403, "PROVISIONAL_INTENT_LIMIT", "Proposed intent permits public discovery only.");
    }
    if (input.work_intent_id) {
      const workIntent = await getWorkIntent(input.work_intent_id);
      if (workIntent.passport_id !== passportId) throw new KernelError(409, "PASSPORT_INTENT_MISMATCH", "Passport does not match Work Intent.");
      if (accessClass === "public_discovery") return { allowed: true, basis: "confirmed_intent", authority_granted: false };
      throw new KernelError(403, "AUTHORITY_NOT_GRANTED", "Confirmed intent does not grant context or effect authority.");
    }
    throw new KernelError(400, "INTENT_REFERENCE_REQUIRED", "proposal_id or work_intent_id is required.");
  }

  async function getAccountableWork() {
    const result = await pool.query(
      `SELECT b.*, p.display_name AS agent_name, ap.sponsor_principal_id, ap.runtime, ap.model_configuration,
              ap.configuration_digest, ap.valid_from, ap.expires_at AS passport_expires_at,
              w.objective, w.requested_outcome, w.intent_class, w.payload_digest
       FROM kernel_build_sessions b
       JOIN kernel_principals p ON p.principal_id=b.principal_id
       JOIN kernel_agent_passports ap ON ap.passport_id=b.passport_id
       JOIN kernel_work_intents w ON w.work_intent_id=b.work_intent_id
       WHERE b.installation_id=$1 AND b.environment_id=$2 ORDER BY b.opened_at DESC`,
      [installationId, environmentId]
    );
    return result.rows.map((row) => ({
      thread_id: `build-session:${row.build_session_id}`,
      thread_type: "build_session",
      identity: { agent_principal_id: row.principal_id, agent_name: row.agent_name,
        sponsor_principal_id: row.sponsor_principal_id, passport_id: row.passport_id,
        runtime: row.runtime, model_configuration: row.model_configuration,
        configuration_digest: row.configuration_digest, passport_valid_from: row.valid_from,
        passport_expires_at: row.passport_expires_at },
      intent: { work_intent_id: row.work_intent_id, intent_class: row.intent_class,
        objective: row.objective, requested_outcome: row.requested_outcome, payload_digest: row.payload_digest,
        status: "confirmed" },
      build_session: { build_session_id: row.build_session_id, base_references: row.base_references,
        opened_at: row.opened_at, expires_at: row.expires_at,
        status: Date.now() >= Date.parse(row.expires_at) ? "expired" : "active" },
      authority: { context_access: "not_granted", effects: "not_granted", execution: "not_granted" }
    }));
  }

  return { createPrincipal, getPrincipal, issuePassport, getPassport, proposeIntent, getProposal,
    confirmIntent, getWorkIntent, openBuildSession, getBuildSession, checkAdmission, getAccountableWork,
    requireHumanActor, authenticateAgent };
}
