import { randomBytes, randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  assertCoordinationPoll,
  assertCoordinatorBindingRevocation,
  assertEnvironmentDescriptor,
  assertEnvironmentHealth,
  assertPromotionProposal,
  assertPromotionReceipt,
  assertPromotionRequest,
  assertRegistrationChallenge,
  assertRegistrationRequest,
  assertSupportCaseRequest,
  assertSupportPassportNotice,
  publicCoordinationKey,
  signCoordinationDocument,
  verifyCoordinationEnvelope
} from "./coordination-contracts.js";

const GATE_MAPPING = {
  package_validation: "package_validation",
  compatibility: "compatibility",
  deployed: "staging_deployed",
  activated: "staging_activated",
  recovery_verified: "staging_recovery"
};
const DEFAULT_PROMOTION_GRAPH = {
  "development:staging": ["package_validation", "compatibility"],
  "staging:production": ["staging_deployed", "staging_activated", "staging_recovery"]
};
const PROMOTION_GATES = new Set(["package_validation", "compatibility", "deterministic_evaluation",
  "staging_deployed", "staging_activated", "staging_recovery", "technical_review"]);

export function validatePromotionGraph(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Promotion Graph must be an object.");
  }
  const requiredEdges = Object.keys(DEFAULT_PROMOTION_GRAPH);
  const unknownEdges = Object.keys(value).filter((edge) => !requiredEdges.includes(edge));
  if (unknownEdges.length) throw new Error(`Promotion Graph contains unsupported edge: ${unknownEdges.join(", ")}.`);
  for (const edge of requiredEdges) {
    if (!Array.isArray(value[edge])) throw new Error(`Promotion Graph edge ${edge} is required.`);
    const gates = new Set(value[edge]);
    const missing = DEFAULT_PROMOTION_GRAPH[edge].filter((gate) => !gates.has(gate));
    if (missing.length) throw new Error(`Promotion Graph edge ${edge} omits required gate: ${missing.join(", ")}.`);
    if (value[edge].some((gate) => typeof gate !== "string" || gate.length < 1)) {
      throw new Error(`Promotion Graph edge ${edge} contains an invalid gate.`);
    }
    const unsupported = value[edge].filter((gate) => !PROMOTION_GATES.has(gate));
    if (unsupported.length) throw new Error(`Promotion Graph edge ${edge} contains unsupported gate: ${unsupported.join(", ")}.`);
  }
  return structuredClone(value);
}

export class CoordinatorError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "CoordinatorError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function error(status, code, message, details) {
  throw new CoordinatorError(status, code, message, details);
}

function current(document) {
  const now = Date.now();
  return Date.parse(document.issued_at) <= now && Date.parse(document.expires_at) > now;
}

export function environmentHealthProjection(row, now = new Date()) {
  if (!row) return { status: "unknown", freshness: "missing", observed_at: null, expires_at: null };
  const expired = new Date(row.health.document.expires_at).getTime() <= now.getTime();
  return { status: expired ? "unknown" : row.health.document.status,
    freshness: expired ? "stale" : "fresh", observed_at: row.health.document.issued_at,
    expires_at: row.health.document.expires_at,
    counters: expired ? undefined : row.health.document.counters };
}

function gateReference(envelope) {
  const receipt = envelope.document;
  return {
    type: GATE_MAPPING[receipt.receipt_type] ?? receipt.receipt_type,
    receipt_id: receipt.receipt_id,
    receipt_digest: sha256Digest(receipt),
    issuer_environment_id: receipt.environment_id
  };
}

function promotionStatus(receipts, proposal) {
  const successful = new Set(receipts.filter((row) => row.receipt.document.outcome === "succeeded")
    .map((row) => row.receipt.document.receipt_type));
  const declined = receipts.some((row) => row.receipt.document.receipt_type === "declined");
  const failed = receipts.some((row) => row.receipt.document.receipt_type === "target_validation_failed");
  const expiresAt = Date.parse(proposal.document.expires_at);
  let status = "proposed";
  if (Date.now() >= expiresAt) status = "expired";
  else if (declined) status = "declined";
  else if (successful.has("activated")) status = "activated";
  else if (successful.has("deployed")) status = "deployed";
  else if (successful.has("deployment_plan_resolved")) status = "awaiting_local_review";
  else if (failed) status = "target_validation_failed";
  else if (successful.has("discovered")) status = "discovered";
  const latest = receipts.map((row) => Date.parse(row.receipt.document.issued_at))
    .filter(Number.isFinite).sort((left, right) => right - left)[0];
  return { status, receipt_freshness: latest ? new Date(latest).toISOString() : null };
}

export function createHostedCoordinatorService(pool, {
  coordinatorId,
  customerId,
  privateKey,
  promotionGraph = DEFAULT_PROMOTION_GRAPH,
  challengeTtlSeconds = 300,
  proposalTtlSeconds = 3600
}) {
  promotionGraph = validatePromotionGraph(promotionGraph);
  const publicKey = publicCoordinationKey(privateKey);

  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coordinator_registration_challenges (
        challenge_id text PRIMARY KEY,
        customer_id text NOT NULL,
        environment_id uuid NOT NULL,
        challenge_nonce text NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS coordinator_environments (
        customer_id text NOT NULL,
        environment_id uuid PRIMARY KEY,
        installation_id uuid NOT NULL,
        environment_class text NOT NULL,
        signing_key_id text NOT NULL,
        signing_public_key text NOT NULL,
        descriptor jsonb NOT NULL,
        descriptor_digest text NOT NULL,
        registration_state text NOT NULL,
        registered_at timestamptz NOT NULL,
        last_contact_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coordinator_promotion_proposals (
        proposal_id text PRIMARY KEY,
        request_id text NOT NULL UNIQUE,
        request_digest text NOT NULL,
        customer_id text NOT NULL,
        source_environment_id uuid NOT NULL,
        target_environment_id uuid NOT NULL,
        package_identity text NOT NULL,
        proposal jsonb NOT NULL,
        proposal_digest text NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coordinator_promotion_receipts (
        receipt_id text PRIMARY KEY,
        proposal_id text NOT NULL REFERENCES coordinator_promotion_proposals(proposal_id),
        environment_id uuid NOT NULL,
        receipt_type text NOT NULL,
        receipt jsonb NOT NULL,
        receipt_digest text NOT NULL,
        received_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coordinator_environment_health (
        health_digest text PRIMARY KEY,
        customer_id text NOT NULL,
        environment_id uuid NOT NULL,
        binding_id uuid NOT NULL,
        health jsonb NOT NULL,
        received_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coordinator_support_cases (
        support_case_id uuid PRIMARY KEY,
        customer_id text NOT NULL,
        environment_id uuid NOT NULL,
        request jsonb NOT NULL,
        request_digest text NOT NULL UNIQUE,
        state text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coordinator_support_passport_notices (
        support_passport_id uuid PRIMARY KEY,
        support_case_id uuid NOT NULL REFERENCES coordinator_support_cases(support_case_id),
        environment_id uuid NOT NULL,
        notice jsonb NOT NULL,
        notice_digest text NOT NULL UNIQUE,
        received_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coordinator_binding_revocations (
        revocation_id uuid PRIMARY KEY,
        environment_id uuid NOT NULL,
        binding_id uuid NOT NULL,
        revocation jsonb NOT NULL,
        revocation_digest text NOT NULL UNIQUE,
        received_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS coordinator_target_proposals_idx
        ON coordinator_promotion_proposals(target_environment_id, created_at);
      CREATE INDEX IF NOT EXISTS coordinator_proposal_receipts_idx
        ON coordinator_promotion_receipts(proposal_id, received_at);
      CREATE INDEX IF NOT EXISTS coordinator_health_environment_idx
        ON coordinator_environment_health(environment_id, received_at DESC);
      CREATE INDEX IF NOT EXISTS coordinator_support_environment_idx
        ON coordinator_support_cases(environment_id, created_at);
      CREATE OR REPLACE FUNCTION coordinator_reject_immutable_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'immutable coordinator record';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS coordinator_promotion_proposals_immutable ON coordinator_promotion_proposals;
      CREATE TRIGGER coordinator_promotion_proposals_immutable BEFORE UPDATE OR DELETE ON coordinator_promotion_proposals
        FOR EACH ROW EXECUTE FUNCTION coordinator_reject_immutable_mutation();
      DROP TRIGGER IF EXISTS coordinator_promotion_receipts_immutable ON coordinator_promotion_receipts;
      CREATE TRIGGER coordinator_promotion_receipts_immutable BEFORE UPDATE OR DELETE ON coordinator_promotion_receipts
        FOR EACH ROW EXECUTE FUNCTION coordinator_reject_immutable_mutation();
      DROP TRIGGER IF EXISTS coordinator_environment_health_immutable ON coordinator_environment_health;
      CREATE TRIGGER coordinator_environment_health_immutable BEFORE UPDATE OR DELETE ON coordinator_environment_health
        FOR EACH ROW EXECUTE FUNCTION coordinator_reject_immutable_mutation();
      DROP TRIGGER IF EXISTS coordinator_support_passport_notices_immutable ON coordinator_support_passport_notices;
      CREATE TRIGGER coordinator_support_passport_notices_immutable BEFORE UPDATE OR DELETE ON coordinator_support_passport_notices
        FOR EACH ROW EXECUTE FUNCTION coordinator_reject_immutable_mutation();
      DROP TRIGGER IF EXISTS coordinator_binding_revocations_immutable ON coordinator_binding_revocations;
      CREATE TRIGGER coordinator_binding_revocations_immutable BEFORE UPDATE OR DELETE ON coordinator_binding_revocations
        FOR EACH ROW EXECUTE FUNCTION coordinator_reject_immutable_mutation();
    `);
  }

  async function issueRegistrationChallenge(input) {
    if (input?.customer_id !== customerId || typeof input?.environment_id !== "string") {
      error(400, "INVALID_REGISTRATION_CHALLENGE_REQUEST", "Customer and Environment identity are required.");
    }
    const now = new Date();
    const challenge = assertRegistrationChallenge({
      schema_version: "alphonse.registration_challenge.v0.1",
      challenge_id: randomUUID(),
      challenge_nonce: randomBytes(32).toString("base64url"),
      coordinator_id: coordinatorId,
      customer_id: customerId,
      environment_id: input.environment_id,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + challengeTtlSeconds * 1000).toISOString()
    });
    await pool.query(
      `INSERT INTO coordinator_registration_challenges
       (challenge_id,customer_id,environment_id,challenge_nonce,expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [challenge.challenge_id, customerId, challenge.environment_id, challenge.challenge_nonce, challenge.expires_at]
    );
    return signCoordinationDocument(challenge, privateKey);
  }

  async function registerEnvironment(envelope) {
    const request = assertRegistrationRequest(envelope?.document);
    const descriptorEnvelope = request.environment_descriptor;
    const descriptor = assertEnvironmentDescriptor(descriptorEnvelope.document);
    if (request.customer_id !== customerId || request.coordinator_id !== coordinatorId
        || descriptor.coordinator_id !== coordinatorId) {
      error(409, "REGISTRATION_SCOPE_MISMATCH", "Registration does not bind this coordinator and customer.");
    }
    verifyCoordinationEnvelope(descriptorEnvelope, descriptor.signing_public_key, assertEnvironmentDescriptor);
    verifyCoordinationEnvelope(envelope, descriptor.signing_public_key, assertRegistrationRequest);
    if (!current(request) || !current(descriptor)) error(409, "REGISTRATION_EXPIRED", "Registration documents are not current.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const challengeResult = await client.query(
        `SELECT * FROM coordinator_registration_challenges WHERE challenge_id=$1 FOR UPDATE`,
        [request.challenge_id]
      );
      const challenge = challengeResult.rows[0];
      if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()
          || challenge.customer_id !== customerId || challenge.environment_id !== descriptor.environment_id
          || challenge.challenge_nonce !== request.challenge_nonce) {
        error(409, "REGISTRATION_CHALLENGE_INVALID", "Registration challenge is missing, expired, consumed, or mismatched.");
      }
      const existing = await client.query(
        `SELECT installation_id,environment_class,signing_key_id,signing_public_key
         FROM coordinator_environments WHERE environment_id=$1 FOR UPDATE`, [descriptor.environment_id]
      );
      if (existing.rows[0] && (existing.rows[0].installation_id !== descriptor.installation_id
          || existing.rows[0].environment_class !== descriptor.environment_class
          || existing.rows[0].signing_key_id !== descriptor.signing_key_id
          || existing.rows[0].signing_public_key !== descriptor.signing_public_key)) {
        error(409, "ENVIRONMENT_REGISTRATION_CONTINUITY_REQUIRED",
          "Existing Environment identity cannot be replaced through enrollment. Use an explicit key-rotation protocol.");
      }
      const now = new Date().toISOString();
      await client.query(`
        INSERT INTO coordinator_environments
          (customer_id,environment_id,installation_id,environment_class,signing_key_id,signing_public_key,
           descriptor,descriptor_digest,registration_state,registered_at,last_contact_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$9)
        ON CONFLICT (environment_id) DO UPDATE SET
          installation_id=EXCLUDED.installation_id,
          environment_class=EXCLUDED.environment_class,
          signing_key_id=EXCLUDED.signing_key_id,
          signing_public_key=EXCLUDED.signing_public_key,
          descriptor=EXCLUDED.descriptor,
          descriptor_digest=EXCLUDED.descriptor_digest,
          registration_state='active',
          last_contact_at=EXCLUDED.last_contact_at`,
      [customerId, descriptor.environment_id, descriptor.installation_id, descriptor.environment_class,
        descriptor.signing_key_id, descriptor.signing_public_key, JSON.stringify(descriptorEnvelope),
        sha256Digest(descriptorEnvelope), now]);
      await client.query("UPDATE coordinator_registration_challenges SET consumed_at=$2 WHERE challenge_id=$1",
        [request.challenge_id, now]);
      await client.query("COMMIT");
      return { environment_id: descriptor.environment_id, registration_state: "active",
        descriptor_digest: sha256Digest(descriptorEnvelope), registered_at: now };
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      client.release();
    }
  }

  async function registeredEnvironment(environmentId) {
    const result = await pool.query("SELECT * FROM coordinator_environments WHERE environment_id=$1", [environmentId]);
    const environment = result.rows[0];
    if (!environment || environment.customer_id !== customerId || environment.registration_state !== "active") {
      error(403, "ENVIRONMENT_NOT_REGISTERED", "Environment is not actively registered.");
    }
    return environment;
  }

  async function submitPromotion(envelope) {
    const request = assertPromotionRequest(envelope?.document);
    const source = await registeredEnvironment(request.source_environment_id);
    const target = await registeredEnvironment(request.target_environment_id);
    verifyCoordinationEnvelope(envelope, source.signing_public_key, assertPromotionRequest);
    const requestDigest = sha256Digest(envelope);
    const replay = await pool.query(
      "SELECT proposal,request_digest FROM coordinator_promotion_proposals WHERE request_id=$1", [request.request_id]
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_digest !== requestDigest) {
        error(409, "PROMOTION_REQUEST_CONFLICT", "Promotion Request ID already binds different signed bytes.");
      }
      return replay.rows[0].proposal;
    }
    if (!current(request) || request.customer_id !== customerId
        || request.source_class !== source.environment_class || request.target_class !== target.environment_class) {
      error(409, "PROMOTION_SCOPE_MISMATCH", "Promotion request does not bind current registered Environment classes.");
    }
    const edge = `${request.source_class}:${request.target_class}`;
    const required = promotionGraph[edge];
    if (!required) error(409, "PROMOTION_EDGE_DENIED", "Customer Promotion Graph does not allow this edge.");
    const gateTypes = new Set();
    for (const receiptEnvelope of request.gate_receipts) {
      const receipt = assertPromotionReceipt(receiptEnvelope.document);
      const issuer = await registeredEnvironment(receipt.environment_id);
      verifyCoordinationEnvelope(receiptEnvelope, issuer.signing_public_key, assertPromotionReceipt);
      if (receipt.environment_id !== request.source_environment_id
          || receipt.package_identity !== request.package_identity || receipt.outcome !== "succeeded") {
        error(409, "PROMOTION_GATE_SCOPE_MISMATCH", "Promotion gate receipt does not bind source Package success.");
      }
      if (request.source_class !== "development") {
        const predecessor = await pool.query(
          `SELECT proposal FROM coordinator_promotion_proposals WHERE proposal_id=$1`, [receipt.proposal_id]
        );
        const predecessorProposal = predecessor.rows[0]?.proposal?.document;
        if (!predecessorProposal || predecessorProposal.target_environment_id !== request.source_environment_id
            || predecessorProposal.package_identity !== request.package_identity) {
          error(409, "PROMOTION_GATE_PROPOSAL_MISMATCH",
            "Higher-environment gate receipt must derive from the prior Promotion Proposal.");
        }
      }
      gateTypes.add(GATE_MAPPING[receipt.receipt_type] ?? receipt.receipt_type);
    }
    const missing = required.filter((gate) => !gateTypes.has(gate));
    if (missing.length) error(409, "PROMOTION_GATES_INCOMPLETE", "Required promotion evidence is missing.", { missing_gates: missing });
    const now = new Date();
    const proposal = assertPromotionProposal({
      schema_version: "alphonse.promotion_proposal.v0.1",
      proposal_id: randomUUID(),
      customer_id: customerId,
      source_environment_id: request.source_environment_id,
      target_environment_id: request.target_environment_id,
      source_class: request.source_class,
      target_class: request.target_class,
      package_identity: request.package_identity,
      manifest_digest: request.manifest_digest,
      package_artifact_digest: request.package_artifact_digest,
      dependency_lock: request.dependency_lock,
      source_receipt_digests: request.source_receipt_digests,
      compatibility: request.compatibility,
      change_summary: request.change_summary,
      required_configuration_schema: request.required_configuration_schema,
      gate_receipts: request.gate_receipts.map(gateReference),
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + proposalTtlSeconds * 1000).toISOString()
    });
    const signed = signCoordinationDocument(proposal, privateKey);
    const inserted = await pool.query(
      `INSERT INTO coordinator_promotion_proposals
       (proposal_id,request_id,request_digest,customer_id,source_environment_id,target_environment_id,package_identity,
        proposal,proposal_digest,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (request_id) DO NOTHING
       RETURNING proposal`,
      [proposal.proposal_id, request.request_id, requestDigest, customerId, proposal.source_environment_id,
        proposal.target_environment_id, proposal.package_identity, JSON.stringify(signed), sha256Digest(signed),
        proposal.issued_at]
    );
    if (inserted.rows[0]) return inserted.rows[0].proposal;
    const concurrentReplay = await pool.query(
      "SELECT proposal,request_digest FROM coordinator_promotion_proposals WHERE request_id=$1", [request.request_id]
    );
    if (concurrentReplay.rows[0]?.request_digest !== requestDigest) {
      error(409, "PROMOTION_REQUEST_CONFLICT", "Promotion Request ID already binds different signed bytes.");
    }
    return concurrentReplay.rows[0].proposal;
  }

  async function pollPromotions(envelope) {
    const poll = assertCoordinationPoll(envelope?.document);
    const environment = await registeredEnvironment(poll.environment_id);
    verifyCoordinationEnvelope(envelope, environment.signing_public_key, assertCoordinationPoll);
    if (!current(poll) || poll.customer_id !== customerId || poll.coordinator_id !== coordinatorId) {
      error(409, "COORDINATION_POLL_INVALID", "Coordination poll is expired or mismatched.");
    }
    await pool.query("UPDATE coordinator_environments SET last_contact_at=now() WHERE environment_id=$1", [poll.environment_id]);
    const proposals = await pool.query(
      `SELECT proposal FROM coordinator_promotion_proposals
       WHERE customer_id=$1 AND target_environment_id=$2
         AND (proposal->'document'->>'expires_at')::timestamptz > now()
       ORDER BY created_at,proposal_id`,
      [customerId, poll.environment_id]
    );
    return proposals.rows.map((row) => row.proposal);
  }

  async function recordPromotionReceipt(envelope) {
    const receipt = assertPromotionReceipt(envelope?.document);
    const environment = await registeredEnvironment(receipt.environment_id);
    verifyCoordinationEnvelope(envelope, environment.signing_public_key, assertPromotionReceipt);
    const receiptDigest = sha256Digest(envelope);
    const existing = await pool.query("SELECT receipt_digest FROM coordinator_promotion_receipts WHERE receipt_id=$1",
      [receipt.receipt_id]);
    if (existing.rows[0]) {
      if (existing.rows[0].receipt_digest !== receiptDigest) error(409, "PROMOTION_RECEIPT_CONFLICT", "Receipt ID binds different bytes.");
      return getPromotionStatus(receipt.proposal_id);
    }
    const proposalResult = await pool.query(
      "SELECT proposal FROM coordinator_promotion_proposals WHERE proposal_id=$1", [receipt.proposal_id]
    );
    const proposal = proposalResult.rows[0]?.proposal;
    if (!proposal || proposal.document.target_environment_id !== receipt.environment_id
        || proposal.document.package_identity !== receipt.package_identity) {
      error(409, "PROMOTION_RECEIPT_SCOPE_MISMATCH", "Target receipt does not bind the exact Promotion Proposal.");
    }
    if (!current(proposal.document)) {
      error(409, "PROMOTION_PROPOSAL_EXPIRED", "Expired Promotion Proposal cannot change hosted status.");
    }
    const predecessor = { deployed: "deployment_plan_resolved", activated: "deployed" }[receipt.receipt_type];
    if (predecessor) {
      const prior = await pool.query(`SELECT receipt_id FROM coordinator_promotion_receipts
        WHERE proposal_id=$1 AND environment_id=$2 AND receipt_type=$3
          AND receipt->'document'->>'outcome'='succeeded'`,
      [receipt.proposal_id, receipt.environment_id, predecessor]);
      if (!prior.rows[0]) error(409, "PROMOTION_RECEIPT_PREDECESSOR_MISSING",
        `Hosted ${receipt.receipt_type} status requires a signed ${predecessor} target receipt.`);
    }
    const inserted = await pool.query(
      `INSERT INTO coordinator_promotion_receipts
       (receipt_id,proposal_id,environment_id,receipt_type,receipt,receipt_digest,received_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (receipt_id) DO NOTHING
       RETURNING receipt_id`,
      [receipt.receipt_id, receipt.proposal_id, receipt.environment_id, receipt.receipt_type,
        JSON.stringify(envelope), receiptDigest]
    );
    if (!inserted.rows[0]) {
      const concurrentReplay = await pool.query(
        "SELECT receipt_digest FROM coordinator_promotion_receipts WHERE receipt_id=$1", [receipt.receipt_id]
      );
      if (concurrentReplay.rows[0]?.receipt_digest !== receiptDigest) {
        error(409, "PROMOTION_RECEIPT_CONFLICT", "Receipt ID binds different bytes.");
      }
    }
    return getPromotionStatus(receipt.proposal_id);
  }

  async function getPromotionStatus(proposalId) {
    const proposalResult = await pool.query(
      "SELECT proposal FROM coordinator_promotion_proposals WHERE proposal_id=$1", [proposalId]
    );
    const proposal = proposalResult.rows[0]?.proposal;
    if (!proposal) error(404, "PROMOTION_PROPOSAL_NOT_FOUND", "Promotion Proposal does not exist.");
    const result = await pool.query(
      "SELECT receipt,receipt_digest FROM coordinator_promotion_receipts WHERE proposal_id=$1 ORDER BY received_at,receipt_id",
      [proposalId]
    );
    const projection = promotionStatus(result.rows, proposal);
    return {
      proposal_id: proposalId,
      package_identity: proposal.document.package_identity,
      source_environment_id: proposal.document.source_environment_id,
      target_environment_id: proposal.document.target_environment_id,
      status: projection.status,
      receipt_freshness: projection.receipt_freshness,
      receipt_digests: result.rows.map((row) => row.receipt_digest),
      authority_granted: false
    };
  }

  async function recordEnvironmentHealth(envelope) {
    const health = assertEnvironmentHealth(envelope?.document);
    const environment = await registeredEnvironment(health.environment_id);
    verifyCoordinationEnvelope(envelope, environment.signing_public_key, assertEnvironmentHealth);
    if (!current(health) || health.customer_id !== customerId || health.coordinator_id !== coordinatorId) {
      error(409, "ENVIRONMENT_HEALTH_SCOPE_MISMATCH", "Environment health is expired or mismatched.");
    }
    const healthDigest = sha256Digest(envelope);
    await pool.query(`INSERT INTO coordinator_environment_health
      (health_digest,customer_id,environment_id,binding_id,health,received_at)
      VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (health_digest) DO NOTHING`,
    [healthDigest, customerId, health.environment_id, health.binding_id, JSON.stringify(envelope)]);
    await pool.query("UPDATE coordinator_environments SET last_contact_at=now() WHERE environment_id=$1",
      [health.environment_id]);
    return { environment_id: health.environment_id, health_digest: healthDigest, accepted: true,
      business_payload_received: false };
  }

  async function createSupportCase(input) {
    const environment = await registeredEnvironment(input?.environment_id);
    const now = new Date();
    const duration = Number(input?.requested_duration_seconds);
    const request = assertSupportCaseRequest({ schema_version: "alphonse.support_case_request.v0.1",
      support_case_id: randomUUID(), coordinator_id: coordinatorId, customer_id: customerId,
      environment_id: environment.environment_id, support_identity: input.support_identity,
      diagnostic_scopes: input.diagnostic_scopes, requested_duration_seconds: duration, reason: input.reason,
      issued_at: now.toISOString(), expires_at: new Date(now.getTime() + duration * 1000).toISOString() });
    const signed = signCoordinationDocument(request, privateKey);
    await pool.query(`INSERT INTO coordinator_support_cases
      (support_case_id,customer_id,environment_id,request,request_digest,state,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,'requested',$6,$6)`, [request.support_case_id, customerId,
      request.environment_id, JSON.stringify(signed), sha256Digest(signed), request.issued_at]);
    return { support_case_id: request.support_case_id, environment_id: request.environment_id,
      state: "requested", request: signed, access_granted: false };
  }

  async function pollSupportCases(envelope) {
    const poll = assertCoordinationPoll(envelope?.document);
    const environment = await registeredEnvironment(poll.environment_id);
    verifyCoordinationEnvelope(envelope, environment.signing_public_key, assertCoordinationPoll);
    if (!current(poll) || poll.customer_id !== customerId || poll.coordinator_id !== coordinatorId) {
      error(409, "SUPPORT_POLL_INVALID", "Support poll is expired or mismatched.");
    }
    const result = await pool.query(`SELECT request FROM coordinator_support_cases
      WHERE customer_id=$1 AND environment_id=$2 AND state='requested'
        AND (request->'document'->>'expires_at')::timestamptz > now()
      ORDER BY created_at,support_case_id`, [customerId, poll.environment_id]);
    await pool.query("UPDATE coordinator_environments SET last_contact_at=now() WHERE environment_id=$1",
      [poll.environment_id]);
    return result.rows.map((row) => row.request);
  }

  async function recordSupportPassportNotice(envelope) {
    const notice = assertSupportPassportNotice(envelope?.document);
    const environment = await registeredEnvironment(notice.environment_id);
    verifyCoordinationEnvelope(envelope, environment.signing_public_key, assertSupportPassportNotice);
    if (!current(notice) || notice.customer_id !== customerId) {
      error(409, "SUPPORT_PASSPORT_SCOPE_MISMATCH", "Support Passport notice is expired or mismatched.");
    }
    const noticeDigest = sha256Digest(envelope);
    const existing = await pool.query(`SELECT notice_digest FROM coordinator_support_passport_notices
      WHERE support_passport_id=$1`, [notice.support_passport_id]);
    if (existing.rows[0]) {
      if (existing.rows[0].notice_digest !== noticeDigest) {
        error(409, "SUPPORT_PASSPORT_CONFLICT", "Support Passport ID already binds different signed bytes.");
      }
      return { support_case_id: notice.support_case_id, support_passport_id: notice.support_passport_id,
        state: "approved", credential_received: false, remediation_authority: false };
    }
    const supportCase = await pool.query(`SELECT * FROM coordinator_support_cases
      WHERE support_case_id=$1 AND environment_id=$2 FOR UPDATE`, [notice.support_case_id, notice.environment_id]);
    if (!supportCase.rows[0] || supportCase.rows[0].state !== "requested") {
      error(409, "SUPPORT_CASE_NOT_REQUESTED", "Support case is not awaiting customer approval.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO coordinator_support_passport_notices
        (support_passport_id,support_case_id,environment_id,notice,notice_digest,received_at)
        VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (support_passport_id) DO NOTHING`,
      [notice.support_passport_id, notice.support_case_id, notice.environment_id, JSON.stringify(envelope), noticeDigest]);
      await client.query(`UPDATE coordinator_support_cases SET state='approved',updated_at=now()
        WHERE support_case_id=$1 AND state='requested'`, [notice.support_case_id]);
      await client.query("COMMIT");
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      client.release();
    }
    return { support_case_id: notice.support_case_id, support_passport_id: notice.support_passport_id,
      state: "approved", credential_received: false, remediation_authority: false };
  }

  async function recordBindingRevocation(envelope) {
    const revocation = assertCoordinatorBindingRevocation(envelope?.document);
    const result = await pool.query("SELECT * FROM coordinator_environments WHERE environment_id=$1",
      [revocation.environment_id]);
    const environment = result.rows[0];
    if (!environment || environment.customer_id !== customerId) error(404, "ENVIRONMENT_NOT_FOUND", "Environment is unknown.");
    verifyCoordinationEnvelope(envelope, environment.signing_public_key, assertCoordinatorBindingRevocation);
    if (!current(revocation) || revocation.customer_id !== customerId || revocation.coordinator_id !== coordinatorId) {
      error(409, "BINDING_REVOCATION_SCOPE_MISMATCH", "Binding Revocation is expired or mismatched.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO coordinator_binding_revocations
        (revocation_id,environment_id,binding_id,revocation,revocation_digest,received_at)
        VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (revocation_id) DO NOTHING`,
      [revocation.revocation_id, revocation.environment_id, revocation.binding_id,
        JSON.stringify(envelope), sha256Digest(envelope)]);
      await client.query(`UPDATE coordinator_environments SET registration_state='revoked',last_contact_at=now()
        WHERE environment_id=$1`, [revocation.environment_id]);
      await client.query(`UPDATE coordinator_support_cases SET state='cancelled',updated_at=now()
        WHERE environment_id=$1 AND state IN ('requested','approved')`, [revocation.environment_id]);
      await client.query("COMMIT");
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      client.release();
    }
    return { environment_id: revocation.environment_id, registration_state: "revoked",
      hosted_visibility: false, hosted_support: false };
  }

  async function getSupportCase(supportCaseId) {
    const result = await pool.query(`SELECT support_case_id,environment_id,state,request_digest,created_at,updated_at
      FROM coordinator_support_cases WHERE customer_id=$1 AND support_case_id=$2`, [customerId, supportCaseId]);
    if (!result.rows[0]) error(404, "SUPPORT_CASE_NOT_FOUND", "Support case does not exist.");
    return result.rows[0];
  }

  async function listEnvironments() {
    const result = await pool.query(
      `SELECT environment_id,installation_id,environment_class,descriptor_digest,registration_state,registered_at,last_contact_at
       FROM coordinator_environments WHERE customer_id=$1 ORDER BY environment_class,environment_id`, [customerId]
    );
    return result.rows.map((environment) => environment.registration_state === "active" ? environment : {
      environment_id: environment.environment_id, registration_state: "revoked",
      hosted_visibility: false, hosted_support: false
    });
  }

  async function getEnvironment(environmentId) {
    const result = await pool.query("SELECT * FROM coordinator_environments WHERE environment_id=$1 AND customer_id=$2",
      [environmentId, customerId]);
    const environment = result.rows[0];
    if (!environment) error(404, "ENVIRONMENT_NOT_FOUND", "Environment does not exist.");
    if (environment.registration_state !== "active") {
      return { environment_id: environment.environment_id, registration_state: "revoked",
        hosted_visibility: false, hosted_support: false };
    }
    const latest = await pool.query(`SELECT health FROM coordinator_environment_health
      WHERE environment_id=$1 ORDER BY received_at DESC LIMIT 1`, [environmentId]);
    return { environment_id: environment.environment_id, installation_id: environment.installation_id,
      environment_class: environment.environment_class, registration_state: environment.registration_state,
      descriptor: environment.descriptor.document, descriptor_digest: environment.descriptor_digest,
      health: environmentHealthProjection(latest.rows[0]), last_contact_at: environment.last_contact_at };
  }

  function getPromotionGraph() {
    return structuredClone(promotionGraph);
  }

  return { coordinatorId, customerId, publicKey, migrate, issueRegistrationChallenge, registerEnvironment,
    submitPromotion, pollPromotions, recordPromotionReceipt, getPromotionStatus, listEnvironments, getEnvironment,
    getPromotionGraph, recordEnvironmentHealth, createSupportCase, pollSupportCases,
    recordSupportPassportNotice, recordBindingRevocation, getSupportCase };
}
