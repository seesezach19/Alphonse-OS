import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

function text(value, path, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new KernelError(400, "INVALID_INPUT", `${path} is invalid.`);
  return value.trim();
}

function uuid(value, path) {
  const id = text(value, path, 100);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new KernelError(400, "INVALID_IDENTIFIER", `${path} must be a UUID.`);
  }
  return id;
}

function strings(value, path, max = 100) {
  if (!Array.isArray(value) || value.length === 0 || value.length > max || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be a bounded non-empty string array.`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function exactObject(value, path, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", `${path} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", `${path} has an invalid shape.`);
  }
  return value;
}

function receiptArray(value, path, max = 1000) {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", `${path} must be a bounded non-empty array.`);
  }
  return value;
}

function digest(value, path) {
  const candidate = text(value, path, 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(candidate)) {
    throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", `${path} must be a SHA-256 digest.`);
  }
  return candidate;
}

function subset(requested, allowed) {
  return requested.every((item) => allowed.includes(item));
}

function timestamp(value, path) {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(parsed)) {
    throw new KernelError(400, "INVALID_INPUT", `${path} must be an ISO-8601 timestamp.`);
  }
  return new Date(parsed).toISOString();
}

export function createContextService(database, identityIntent, installationId, environmentId) {
  const { pool, executeCommand } = database;

  async function issueGrant(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const command = { ...envelope, actor };
    const passportId = uuid(envelope.input.passport_id, "input.passport_id");
    const workIntentId = uuid(envelope.input.work_intent_id, "input.work_intent_id");
    const purpose = text(envelope.input.purpose, "input.purpose", 500);
    const subjects = strings(envelope.input.subjects, "input.subjects");
    const sources = strings(envelope.input.sources, "input.sources", 10);
    const sensitivityClasses = strings(envelope.input.sensitivity_classes, "input.sensitivity_classes", 10);
    const maxItems = envelope.input.max_items;
    const maxAgeSeconds = envelope.input.max_age_seconds;
    const expiresAt = timestamp(envelope.input.expires_at, "input.expires_at");
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 1000) throw new KernelError(400, "INVALID_LIMIT", "max_items is invalid.");
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 86400) throw new KernelError(400, "INVALID_FRESHNESS", "max_age_seconds is invalid.");
    if (Date.parse(expiresAt) <= Date.now()) throw new KernelError(400, "INVALID_EXPIRY", "Grant expiry must be in the future.");
    const passport = await identityIntent.getPassport(passportId);
    const workIntent = await identityIntent.getWorkIntent(workIntentId);
    if (passport.sponsor_principal_id !== actor.id) throw new KernelError(403, "SPONSOR_MISMATCH", "Only the sponsor may issue this grant.");
    if (workIntent.passport_id !== passportId || workIntent.agent_principal_id !== passport.agent_principal_id) {
      throw new KernelError(409, "PASSPORT_INTENT_MISMATCH", "Passport and Work Intent do not match.");
    }
    if (Date.parse(expiresAt) > Date.parse(passport.expires_at)) throw new KernelError(409, "GRANT_EXCEEDS_PASSPORT", "Grant cannot outlive Passport.");
    const grantId = randomUUID();
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    return executeCommand({ installationId, environmentId, command, requestDigest,
      apply: async (client, { acceptedAt }) => {
        await client.query(
          `INSERT INTO kernel_context_access_grants
           (grant_id,installation_id,environment_id,passport_id,work_intent_id,agent_principal_id,purpose,
            subjects,sources,sensitivity_classes,max_items,max_age_seconds,expires_at,issued_by_principal_id,issued_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [grantId, installationId, environmentId, passportId, workIntentId, passport.agent_principal_id,
            purpose, JSON.stringify(subjects), JSON.stringify(sources), JSON.stringify(sensitivityClasses),
            maxItems, maxAgeSeconds, expiresAt, actor.id, acceptedAt]
        );
        return { aggregateType: "context_access_grant", aggregateId: grantId,
          transitionType: "kernel.context_access_grant.issued",
          transitionPayload: { passport_id: passportId, work_intent_id: workIntentId },
          result: { context_access_grant: { grant_id: grantId, passport_id: passportId,
            work_intent_id: workIntentId, agent_principal_id: passport.agent_principal_id, purpose, subjects,
            sources, sensitivity_classes: sensitivityClasses, max_items: maxItems, max_age_seconds: maxAgeSeconds,
            expires_at: expiresAt, issued_by_principal_id: actor.id, issued_at: acceptedAt, access: "read_only" } } };
      }
    });
  }

  async function getGrant(grantId, client = pool) {
    uuid(grantId, "grant_id");
    const result = await client.query(
      `SELECT * FROM kernel_context_access_grants WHERE installation_id=$1 AND environment_id=$2 AND grant_id=$3`,
      [installationId, environmentId, grantId]
    );
    if (!result.rows[0]) throw new KernelError(404, "CONTEXT_GRANT_NOT_FOUND", "Context Access Grant does not exist.");
    return result.rows[0];
  }

  async function authorize({ grant_id, agent_token, subjects: requestedSubjects, sources: requestedSources }) {
    const grant = await getGrant(grant_id);
    const passport = await identityIntent.authenticateAgent(agent_token);
    const subjects = strings(requestedSubjects, "subjects");
    const sources = strings(requestedSources, "sources", 10);
    if (grant.passport_id !== passport.passport_id || grant.agent_principal_id !== passport.agent_principal_id) {
      throw new KernelError(403, "GRANT_RECIPIENT_MISMATCH", "Grant does not bind the authenticated agent.");
    }
    if (Date.now() >= Date.parse(grant.expires_at)) throw new KernelError(409, "CONTEXT_GRANT_EXPIRED", "Context Access Grant expired.");
    if (!subset(subjects, grant.subjects) || !subset(sources, grant.sources)) throw new KernelError(403, "OVER_BROAD_CONTEXT_REQUEST", "Request exceeds Context Access Grant.");
    if (subjects.length * sources.length > grant.max_items) throw new KernelError(403, "CONTEXT_ITEM_LIMIT_EXCEEDED", "Request exceeds grant item limit.");
    return { grant_id: grant.grant_id, passport_id: grant.passport_id, work_intent_id: grant.work_intent_id,
      recipient_principal_id: grant.agent_principal_id, purpose: grant.purpose, subjects, sources,
      sensitivity_classes: grant.sensitivity_classes, max_items: grant.max_items,
      max_age_seconds: grant.max_age_seconds, expires_at: grant.expires_at };
  }

  async function recordReceipt(receipt, signature, authenticatedDataPlaneId) {
    if (JSON.stringify(receipt).length > 32_768) throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", "Context Receipt exceeds 32 KiB.");
    exactObject(receipt, "receipt", ["receipt_id", "grant_id", "data_plane_id", "recipient_principal_id",
      "packet_hash", "item_references", "authority_claims", "freshness_claims", "provenance", "limitations", "delivered_at"]);
    const receiptId = uuid(receipt.receipt_id, "receipt_id");
    const grant = await getGrant(receipt.grant_id);
    const dataPlaneId = text(receipt.data_plane_id, "receipt.data_plane_id", 100);
    if (dataPlaneId !== authenticatedDataPlaneId) throw new KernelError(403, "DATA_PLANE_IDENTITY_MISMATCH", "Receipt identity does not match authenticated Data Plane.");
    const recipientPrincipalId = uuid(receipt.recipient_principal_id, "receipt.recipient_principal_id");
    if (grant.agent_principal_id !== recipientPrincipalId) throw new KernelError(409, "RECEIPT_RECIPIENT_MISMATCH", "Receipt recipient does not match grant.");
    const deliveredAt = timestamp(receipt.delivered_at, "receipt.delivered_at");
    if (Date.parse(deliveredAt) > Date.now() + 30_000 || Date.parse(deliveredAt) >= Date.parse(grant.expires_at)) {
      throw new KernelError(409, "RECEIPT_OUTSIDE_GRANT_WINDOW", "Receipt delivery falls outside the grant window.");
    }
    const packetHash = digest(receipt.packet_hash, "receipt.packet_hash");
    const itemReferences = receiptArray(receipt.item_references, "receipt.item_references", grant.max_items).map((item, index) => {
      exactObject(item, `receipt.item_references[${index}]`, ["source", "subject", "release_id", "item_hash", "observed_at"]);
      const source = text(item.source, "item source", 100);
      const subject = text(item.subject, "item subject", 200);
      if (!grant.sources.includes(source) || !grant.subjects.includes(subject)) {
        throw new KernelError(403, "RECEIPT_EXCEEDS_GRANT", "Receipt item exceeds granted subjects or sources.");
      }
      const observedAt = timestamp(item.observed_at, "item observed_at");
      if (Date.parse(observedAt) > Date.parse(deliveredAt)) throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", "Observation cannot follow delivery.");
      return { source, subject, release_id: text(item.release_id, "item release_id", 200),
        item_hash: digest(item.item_hash, "item item_hash"), observed_at: observedAt };
    });
    const pairKeys = itemReferences.map((item) => `${item.source}\u0000${item.subject}`);
    if (new Set(pairKeys).size !== pairKeys.length) throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", "Receipt contains duplicate item references.");

    const authorityClaims = receiptArray(receipt.authority_claims, "receipt.authority_claims", grant.max_items).map((claim, index) => {
      exactObject(claim, `receipt.authority_claims[${index}]`, ["source", "subject", "authority"]);
      const source = text(claim.source, "authority source", 100);
      const subject = text(claim.subject, "authority subject", 200);
      if (!pairKeys.includes(`${source}\u0000${subject}`)) throw new KernelError(403, "RECEIPT_EXCEEDS_GRANT", "Authority claim lacks a granted item reference.");
      const authority = text(claim.authority, "authority", 50);
      if (!new Set(["authoritative", "representational"]).has(authority)) throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", "Authority class is invalid.");
      return { source, subject, authority };
    });
    const freshnessClaims = receiptArray(receipt.freshness_claims, "receipt.freshness_claims", grant.max_items).map((claim, index) => {
      exactObject(claim, `receipt.freshness_claims[${index}]`, ["source", "subject", "observed_at", "delivered_at",
        "cache_age_seconds", "cache_reset_observation_time"]);
      const source = text(claim.source, "freshness source", 100);
      const subject = text(claim.subject, "freshness subject", 200);
      const item = itemReferences.find((candidate) => candidate.source === source && candidate.subject === subject);
      if (!item) throw new KernelError(403, "RECEIPT_EXCEEDS_GRANT", "Freshness claim lacks a granted item reference.");
      const observedAt = timestamp(claim.observed_at, "freshness observed_at");
      const claimDeliveredAt = timestamp(claim.delivered_at, "freshness delivered_at");
      if (observedAt !== item.observed_at || claimDeliveredAt !== deliveredAt || claim.cache_reset_observation_time !== false
        || !Number.isInteger(claim.cache_age_seconds) || claim.cache_age_seconds < 0) {
        throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", "Freshness claim is inconsistent.");
      }
      const calculatedAge = Math.floor((Date.parse(deliveredAt) - Date.parse(observedAt)) / 1000);
      if (Math.abs(calculatedAge - claim.cache_age_seconds) > 1 || claim.cache_age_seconds > grant.max_age_seconds) {
        throw new KernelError(409, "STALE_CONTEXT", "Receipt exceeds the grant freshness bound.");
      }
      return { source, subject, observed_at: observedAt, delivered_at: deliveredAt,
        cache_age_seconds: claim.cache_age_seconds, cache_reset_observation_time: false };
    });
    const authorityPairs = authorityClaims.map((claim) => `${claim.source}\u0000${claim.subject}`);
    const freshnessPairs = freshnessClaims.map((claim) => `${claim.source}\u0000${claim.subject}`);
    if (authorityClaims.length !== itemReferences.length || freshnessClaims.length !== itemReferences.length
      || new Set(authorityPairs).size !== pairKeys.length || new Set(freshnessPairs).size !== pairKeys.length
      || pairKeys.some((pair) => !authorityPairs.includes(pair) || !freshnessPairs.includes(pair))) {
      throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", "Receipt must include one authority and freshness claim per item.");
    }
    exactObject(receipt.provenance, "receipt.provenance", ["adapter", "policy_version"]);
    const provenance = { adapter: text(receipt.provenance.adapter, "provenance adapter", 100),
      policy_version: text(receipt.provenance.policy_version, "provenance policy_version", 50) };
    exactObject(receipt.limitations, "receipt.limitations", ["fields_redacted", "policy"]);
    const fieldsRedacted = Array.isArray(receipt.limitations.fields_redacted)
      ? receipt.limitations.fields_redacted.map((field) => text(field, "redacted field", 100)) : null;
    if (!fieldsRedacted || fieldsRedacted.length > 100) throw new KernelError(400, "INVALID_CONTEXT_RECEIPT", "Redacted fields are invalid.");
    const limitations = { fields_redacted: fieldsRedacted, policy: text(receipt.limitations.policy, "limitations policy", 100) };
    const normalizedReceipt = { receipt_id: receiptId, grant_id: grant.grant_id, data_plane_id: dataPlaneId,
      recipient_principal_id: recipientPrincipalId, packet_hash: packetHash, item_references: itemReferences,
      authority_claims: authorityClaims, freshness_claims: freshnessClaims, provenance, limitations, delivered_at: deliveredAt };
    const command = { command_id: `context-receipt:${receiptId}`, operation_id: "kernel.context_receipt.record",
      actor: { type: "system", id: dataPlaneId }, input: { receipt_id: receiptId, packet_hash: packetHash } };
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command,
      receipt: normalizedReceipt, signature });
    return executeCommand({ installationId, environmentId, command, requestDigest,
      apply: async (client, { acceptedAt }) => {
        await client.query(
          `INSERT INTO kernel_context_receipts
           (receipt_id,installation_id,environment_id,grant_id,data_plane_id,recipient_principal_id,packet_hash,
            item_references,authority_claims,freshness_claims,provenance,limitations,delivered_at,signature)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [receiptId, installationId, environmentId, grant.grant_id, dataPlaneId,
            recipientPrincipalId, packetHash, JSON.stringify(itemReferences),
            JSON.stringify(authorityClaims), JSON.stringify(freshnessClaims),
            JSON.stringify(provenance), JSON.stringify(limitations), deliveredAt, signature]
        );
        return { aggregateType: "context_receipt", aggregateId: receiptId,
          transitionType: "kernel.context_receipt.recorded", transitionPayload: { grant_id: grant.grant_id },
          result: { context_receipt: { ...normalizedReceipt, signature, recorded_at: acceptedAt } } };
      }
    });
  }

  async function getReceipt(receiptId) {
    uuid(receiptId, "receipt_id");
    const result = await pool.query(
      `SELECT receipt_id,grant_id,data_plane_id,recipient_principal_id,packet_hash,item_references,
              authority_claims,freshness_claims,provenance,limitations,delivered_at,signature
       FROM kernel_context_receipts
       WHERE installation_id=$1 AND environment_id=$2 AND receipt_id=$3`,
      [installationId, environmentId, receiptId]
    );
    if (!result.rows[0]) throw new KernelError(404, "CONTEXT_RECEIPT_NOT_FOUND", "Context Receipt does not exist.");
    return result.rows[0];
  }

  async function contextForWorkIntent(workIntentId) {
    const result = await pool.query(
      `SELECT g.grant_id,g.purpose,g.subjects,g.sources,g.sensitivity_classes,g.max_age_seconds,g.expires_at,
              r.receipt_id,r.packet_hash,r.authority_claims,r.freshness_claims,r.limitations,r.delivered_at
       FROM kernel_context_access_grants g LEFT JOIN LATERAL (
         SELECT * FROM kernel_context_receipts r WHERE r.installation_id=g.installation_id
          AND r.environment_id=g.environment_id AND r.grant_id=g.grant_id ORDER BY r.delivered_at DESC LIMIT 1
       ) r ON true WHERE g.installation_id=$1 AND g.environment_id=$2 AND g.work_intent_id=$3`,
      [installationId, environmentId, workIntentId]
    );
    return result.rows.map((row) => {
      const freshnessClaims = row.freshness_claims?.map((claim) => {
        const currentAgeSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(claim.observed_at)) / 1000));
        return { ...claim, current_age_seconds: currentAgeSeconds,
          status: currentAgeSeconds <= row.max_age_seconds ? "fresh" : "stale" };
      });
      return { grant_id: row.grant_id, purpose: row.purpose, subjects: row.subjects,
      sources: row.sources, sensitivity_classes: row.sensitivity_classes, expires_at: row.expires_at,
      max_age_seconds: row.max_age_seconds,
      authority: Date.now() < Date.parse(row.expires_at) ? "granted_read_only" : "expired",
      latest_receipt: row.receipt_id ? { receipt_id: row.receipt_id, packet_hash: row.packet_hash,
        authority_claims: row.authority_claims, freshness_claims: freshnessClaims,
        limitations: row.limitations, delivered_at: row.delivered_at } : null };
    });
  }

  return { issueGrant, getGrant, authorize, recordReceipt, getReceipt, contextForWorkIntent };
}
