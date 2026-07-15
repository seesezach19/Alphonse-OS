import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  assertCoordinatorBindingRevocation,
  assertCoordinationPoll,
  assertEnvironmentHealth,
  assertSupportCaseRequest,
  assertSupportPassportNotice,
  signCoordinationDocument,
  verifyCoordinationEnvelope
} from "./coordination-contracts.js";
import { KernelError } from "./errors.js";

const DIAGNOSTIC_SCOPES = new Set(["kernel_health", "runtime_health", "host_health", "storage_health",
  "coordination_health"]);

function fail(code, message, status = 400, details = {}) {
  throw new KernelError(status, code, message, details);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_INPUT", `${label} must be an object.`);
  return value;
}

function exact(value, keys, label = "input") {
  object(value, label);
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail("INVALID_INPUT", `${label} fields must be exact.`);
  return value;
}

function string(value, label, max = 1000) {
  if (typeof value !== "string" || value.length < 1 || value.length > max) fail("INVALID_INPUT", `${label} is invalid.`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) fail("INVALID_INPUT", `${label} must be a SHA-256 digest.`);
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail("INVALID_INPUT", `${label} must be an integer >= ${minimum}.`);
  return value;
}

function scopes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8 || new Set(value).size !== value.length
      || value.some((entry) => !DIAGNOSTIC_SCOPES.has(entry))) {
    fail("INVALID_DIAGNOSTIC_SCOPE", "Diagnostic scopes must be a unique supported list.");
  }
  return value;
}

function commandDigest(installationId, environmentId, command) {
  return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
}

export function supportCredentialDigest(token) {
  string(token, "Support credential", 1000);
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (cause) {
    fail("COORDINATOR_UNAVAILABLE", "Coordinator could not be reached.", 503, { cause: cause.message });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) fail(payload?.error?.code ?? "COORDINATOR_REJECTED", payload?.error?.message ?? "Coordinator rejected request.", 502);
  return payload;
}

function encryptionKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("KERNEL_SUPPORT_DIAGNOSTIC_SECRET must be at least 32 characters.");
  return createHash("sha256").update(secret).digest();
}

export function encryptDiagnosticBundle(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64url"), initialization_vector: iv.toString("base64url"),
    authentication_tag: cipher.getAuthTag().toString("base64url"), content_digest: sha256Digest(value) };
}

export function decryptDiagnosticBundle(bundle, secret) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(bundle.initialization_vector, "base64url"));
  decipher.setAuthTag(Buffer.from(bundle.authentication_tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, "base64url")), decipher.final()]);
  const value = JSON.parse(plaintext.toString("utf8"));
  if (sha256Digest(value) !== bundle.content_digest) fail("DIAGNOSTIC_INTEGRITY_FAILED", "Diagnostic bundle integrity check failed.", 500);
  return value;
}

export function createSupportService(database, deploymentService, {
  installationId,
  environmentId,
  environmentPrivateKey,
  diagnosticSecret,
  healthTtlSeconds = 120
}) {
  const { pool, executeCommand } = database;

  function accountableCommand(envelope, actor, routeBinding) {
    return { ...envelope, ...(routeBinding ? { route_binding: routeBinding } : {}), actor };
  }

  async function replay(envelope, actor, routeBinding) {
    const command = accountableCommand(envelope, actor, routeBinding);
    const expectedDigest = commandDigest(installationId, environmentId, command);
    const receipt = await database.getCommandReceipt(installationId, environmentId, envelope.command_id);
    if (!receipt) return null;
    if (receipt.request_digest !== expectedDigest) {
      fail("IDEMPOTENCY_CONFLICT", "Command ID was already used with different input.", 409);
    }
    return { replayed: true, result: receipt.result };
  }

  async function binding(state = "active", client = pool) {
    const result = await client.query(`SELECT b.*,s.state,s.revision FROM kernel_coordinator_bindings b
      JOIN kernel_coordinator_binding_states s USING (installation_id,environment_id,binding_id)
      WHERE b.installation_id=$1 AND b.environment_id=$2 AND s.state=$3
        AND ($3='revoked' OR b.expires_at > now()) ORDER BY b.issued_at DESC LIMIT 1`,
    [installationId, environmentId, state]);
    if (!result.rows[0]) fail("COORDINATOR_BINDING_NOT_FOUND", `No ${state} Coordinator Binding exists.`, 409);
    return result.rows[0];
  }

  async function coarseHealth() {
    const [environment, outbox, obligations, quarantined] = await Promise.all([
      database.getEnvironment(installationId, environmentId),
      pool.query(`SELECT count(*)::int AS count FROM kernel_outbox WHERE installation_id=$1 AND environment_id=$2 AND published_at IS NULL`, [installationId, environmentId]),
      pool.query(`SELECT count(*)::int AS count FROM kernel_operational_obligations
        WHERE installation_id=$1 AND environment_id=$2 AND status <> 'satisfied'`, [installationId, environmentId]),
      pool.query(`SELECT count(*)::int AS count FROM kernel_host_security_states WHERE installation_id=$1 AND environment_id=$2 AND state='quarantined'`, [installationId, environmentId])
    ]);
    const counters = { outbox_lag: outbox.rows[0].count, unresolved_obligations: obligations.rows[0].count,
      quarantined_hosts: quarantined.rows[0].count, restore_suspended: environment.operational_state === "restore_suspended" };
    return { status: counters.restore_suspended || counters.quarantined_hosts > 0 ? "blocked"
      : counters.outbox_lag > 0 || counters.unresolved_obligations > 0 ? "degraded" : "healthy", counters };
  }

  async function publishHealth(envelope, actor) {
    exact(envelope.input, [], "input");
    const prior = await replay(envelope, actor);
    if (prior) return prior;
    const active = await binding();
    const now = new Date();
    const health = assertEnvironmentHealth({ schema_version: "alphonse.environment_health.v0.1",
      coordinator_id: active.coordinator_id, customer_id: active.customer_id, environment_id: environmentId,
      binding_id: active.binding_id, ...(await coarseHealth()), issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + healthTtlSeconds * 1000).toISOString() });
    const signed = signCoordinationDocument(health, environmentPrivateKey);
    await fetchJson(`${active.coordinator_endpoint}/coordinator/v0/environment-health`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(signed) });
    const command = accountableCommand(envelope, actor);
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command), apply: async (client, { acceptedAt }) => {
        const id = randomUUID();
        await client.query(`INSERT INTO kernel_environment_health_publications
          (health_publication_id,installation_id,environment_id,binding_id,signed_health,health_digest,published_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, installationId, environmentId, active.binding_id,
          JSON.stringify(signed), sha256Digest(signed), acceptedAt]);
        return { aggregateType: "environment_health_publication", aggregateId: id,
          transitionType: "kernel.environment_health.published", transitionPayload: { status: health.status },
          result: { environment_health: { ...health, signed: true, coarse: true } } };
      } });
  }

  function signedPoll(active) {
    const now = new Date();
    return signCoordinationDocument(assertCoordinationPoll({ schema_version: "alphonse.coordination_poll.v0.1",
      coordinator_id: active.coordinator_id, customer_id: active.customer_id, environment_id: environmentId,
      request_nonce: randomBytes(16).toString("base64url"), issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 60_000).toISOString() }), environmentPrivateKey);
  }

  async function pollSupportCases(envelope, actor) {
    exact(envelope.input, [], "input");
    const prior = await replay(envelope, actor);
    if (prior) return prior;
    const active = await binding();
    const payload = await fetchJson(`${active.coordinator_endpoint}/coordinator/v0/support-polls`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(signedPoll(active)) });
    const cases = (payload.support_cases ?? []).map((signed) => {
      const request = verifyCoordinationEnvelope(signed, active.coordinator_public_key, assertSupportCaseRequest);
      if (request.environment_id !== environmentId || request.customer_id !== active.customer_id) {
        fail("SUPPORT_CASE_SCOPE_MISMATCH", "Support case does not bind this Environment.", 409);
      }
      return { signed, request };
    });
    const command = accountableCommand(envelope, actor);
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command), apply: async (client, { acceptedAt }) => {
        for (const entry of cases) {
          await client.query(`INSERT INTO kernel_received_support_cases
            (support_case_id,installation_id,environment_id,binding_id,signed_request,request_digest,received_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (installation_id,environment_id,support_case_id) DO NOTHING`,
          [entry.request.support_case_id, installationId, environmentId, active.binding_id, JSON.stringify(entry.signed),
            sha256Digest(entry.signed), acceptedAt]);
          await client.query(`INSERT INTO kernel_support_case_states
            (installation_id,environment_id,support_case_id,state,revision,updated_at)
            VALUES ($1,$2,$3,'requested',0,$4) ON CONFLICT DO NOTHING`,
          [installationId, environmentId, entry.request.support_case_id, acceptedAt]);
        }
        return { aggregateType: "support_poll", aggregateId: envelope.command_id,
          transitionType: "kernel.support_cases.pulled", transitionPayload: { count: cases.length },
          result: { support_cases: cases.map(({ request }) => ({ ...request, state: "requested", access_granted: false })) } };
      } });
  }

  async function approveSupportCase(envelope, supportCaseId, actor) {
    const input = exact(envelope.input, ["authentication_digest", "duration_seconds", "expected_revision"], "input");
    digest(input.authentication_digest, "authentication_digest");
    integer(input.duration_seconds, "duration_seconds", 60);
    integer(input.expected_revision, "expected_revision");
    const routeBinding = { support_case_id: supportCaseId };
    const prior = await replay(envelope, actor, routeBinding);
    if (prior) return prior;
    const active = await binding();
    const command = accountableCommand(envelope, actor, routeBinding);
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command), apply: async (client, { acceptedAt }) => {
        const result = await client.query(`SELECT c.*,s.state,s.revision FROM kernel_received_support_cases c
          JOIN kernel_support_case_states s USING (installation_id,environment_id,support_case_id)
          WHERE c.installation_id=$1 AND c.environment_id=$2 AND c.support_case_id=$3 FOR UPDATE`,
        [installationId, environmentId, supportCaseId]);
        const row = result.rows[0];
        if (!row) fail("SUPPORT_CASE_NOT_FOUND", "Support case does not exist.", 404);
        if (row.binding_id !== active.binding_id) fail("SUPPORT_CASE_BINDING_INACTIVE", "Support case binding is no longer active.", 409);
        if (Number(row.revision) !== input.expected_revision || row.state !== "requested") fail("REVISION_CONFLICT", "Support case is no longer awaiting approval.", 409);
        const request = assertSupportCaseRequest(row.signed_request.document);
        const maximumExpiry = Math.min(Date.parse(request.expires_at), Date.now() + request.requested_duration_seconds * 1000);
        const expiresAt = new Date(Math.min(maximumExpiry, Date.now() + input.duration_seconds * 1000));
        if (expiresAt.getTime() <= Date.now()) fail("SUPPORT_CASE_EXPIRED", "Support case has expired.", 409);
        const passportId = randomUUID();
        const notice = assertSupportPassportNotice({ schema_version: "alphonse.support_passport_notice.v0.1",
          support_passport_id: passportId, support_case_id: supportCaseId, customer_id: active.customer_id,
          environment_id: environmentId, support_identity: request.support_identity,
          diagnostic_scopes: request.diagnostic_scopes, access_class: "diagnostics_read_only",
          issued_at: acceptedAt, expires_at: expiresAt.toISOString() });
        const signedNotice = signCoordinationDocument(notice, environmentPrivateKey);
        await client.query(`INSERT INTO kernel_support_passports
          (support_passport_id,installation_id,environment_id,binding_id,support_case_id,authentication_digest,
           signed_notice,notice_digest,issued_by_actor_id,issued_at,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [passportId, installationId, environmentId,
          active.binding_id, supportCaseId, input.authentication_digest, JSON.stringify(signedNotice),
          sha256Digest(signedNotice), actor.id, acceptedAt, expiresAt.toISOString()]);
        await client.query(`INSERT INTO kernel_support_passport_states
          (installation_id,environment_id,support_passport_id,state,revision,updated_at)
          VALUES ($1,$2,$3,'active',0,$4)`, [installationId, environmentId, passportId, acceptedAt]);
        await client.query(`UPDATE kernel_support_case_states SET state='approved',revision=revision+1,updated_at=$4
          WHERE installation_id=$1 AND environment_id=$2 AND support_case_id=$3`,
        [installationId, environmentId, supportCaseId, acceptedAt]);
        return { aggregateType: "support_passport", aggregateId: passportId,
          transitionType: "kernel.support_passport.issued", transitionPayload: { support_case_id: supportCaseId },
          result: { support_passport: { ...notice, state: "active", credential_stored: false,
            authentication_digest: input.authentication_digest } } };
      } });
  }

  async function pushSupportPassport(envelope, passportId, actor) {
    exact(envelope.input, [], "input");
    const routeBinding = { support_passport_id: passportId };
    const prior = await replay(envelope, actor, routeBinding);
    if (prior) return prior;
    const active = await binding();
    const result = await pool.query(`SELECT * FROM kernel_support_passports WHERE installation_id=$1 AND environment_id=$2
      AND support_passport_id=$3 AND binding_id=$4`, [installationId, environmentId, passportId, active.binding_id]);
    if (!result.rows[0]) fail("SUPPORT_PASSPORT_NOT_FOUND", "Support Passport does not exist for active binding.", 404);
    await fetchJson(`${active.coordinator_endpoint}/coordinator/v0/support-passport-notices`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(result.rows[0].signed_notice) });
    const command = accountableCommand(envelope, actor, routeBinding);
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command), apply: async () => ({
        aggregateType: "support_passport", aggregateId: passportId,
        transitionType: "kernel.support_passport.notice_delivered", transitionPayload: {},
        result: { support_passport_notice: { support_passport_id: passportId, delivered: true, credential_disclosed: false } }
      }) });
  }

  async function authenticateSupport(token, client = pool) {
    string(token, "Support credential", 1000);
    const result = await client.query(`SELECT p.*,s.state,b.state AS binding_state FROM kernel_support_passports p
      JOIN kernel_support_passport_states s USING (installation_id,environment_id,support_passport_id)
      JOIN kernel_coordinator_binding_states b USING (installation_id,environment_id,binding_id)
      WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.authentication_digest=$3`,
    [installationId, environmentId, supportCredentialDigest(token)]);
    const passport = result.rows[0];
    if (!passport || passport.state !== "active" || passport.binding_state !== "active"
        || new Date(passport.expires_at).getTime() <= Date.now()) {
      fail("SUPPORT_AUTHENTICATION_FAILED", "Support Passport is missing, expired, revoked, or detached.", 403);
    }
    return passport;
  }

  async function diagnosticContent(requestedScopes) {
    const content = { schema_version: "alphonse.redacted_diagnostics.v0.1", environment_id: environmentId,
      generated_at: new Date().toISOString(), scopes: {} };
    if (requestedScopes.includes("kernel_health")) content.scopes.kernel_health = await coarseHealth();
    if (requestedScopes.includes("coordination_health")) content.scopes.coordination_health = { active_binding: true };
    if (requestedScopes.includes("host_health")) {
      const hosts = await pool.query(`SELECT host_id,state,placement_eligible,current_key_id,revision,updated_at
        FROM kernel_host_security_states WHERE installation_id=$1 AND environment_id=$2 ORDER BY host_id`,
      [installationId, environmentId]);
      content.scopes.host_health = hosts.rows;
    }
    if (requestedScopes.includes("runtime_health")) {
      const environment = await database.getEnvironment(installationId, environmentId);
      content.scopes.runtime_health = { operational_state: environment.operational_state,
        restore_generation: environment.restore_generation };
    }
    if (requestedScopes.includes("storage_health")) {
      const outbox = await pool.query(`SELECT count(*)::int AS pending FROM kernel_outbox
        WHERE installation_id=$1 AND environment_id=$2 AND published_at IS NULL`, [installationId, environmentId]);
      content.scopes.storage_health = outbox.rows[0];
    }
    return content;
  }

  async function createDiagnostic(envelope, actor) {
    const input = exact(envelope.input, ["support_passport_id", "diagnostic_scopes", "expires_in_seconds"], "input");
    scopes(input.diagnostic_scopes);
    integer(input.expires_in_seconds, "expires_in_seconds", 60);
    const prior = await replay(envelope, actor);
    if (prior) return prior;
    const passportResult = await pool.query(`SELECT p.*,s.state,b.state AS binding_state FROM kernel_support_passports p
      JOIN kernel_support_passport_states s USING (installation_id,environment_id,support_passport_id)
      JOIN kernel_coordinator_binding_states b USING (installation_id,environment_id,binding_id)
      WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.support_passport_id=$3`,
    [installationId, environmentId, input.support_passport_id]);
    const passport = passportResult.rows[0];
    if (!passport || passport.state !== "active" || passport.binding_state !== "active"
        || new Date(passport.expires_at).getTime() <= Date.now()) fail("SUPPORT_PASSPORT_INACTIVE", "Active Support Passport required.", 409);
    const notice = assertSupportPassportNotice(passport.signed_notice.document);
    if (input.diagnostic_scopes.some((scope) => !notice.diagnostic_scopes.includes(scope))) {
      fail("DIAGNOSTIC_SCOPE_DENIED", "Diagnostic request exceeds Support Passport scope.", 403);
    }
    const content = await diagnosticContent(input.diagnostic_scopes);
    const encrypted = encryptDiagnosticBundle(content, diagnosticSecret);
    const command = accountableCommand(envelope, actor);
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command), apply: async (client, { acceptedAt }) => {
        const id = randomUUID();
        const expiresAt = new Date(Math.min(Date.parse(passport.expires_at), Date.now() + input.expires_in_seconds * 1000));
        const redaction = { business_payloads: "excluded", credentials: "excluded", prompts: "excluded", actor_activity: "excluded" };
        await client.query(`INSERT INTO kernel_diagnostic_bundles
          (diagnostic_bundle_id,installation_id,environment_id,support_passport_id,diagnostic_scopes,ciphertext,
           initialization_vector,authentication_tag,content_digest,redaction_manifest,created_by_actor_id,created_at,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, installationId, environmentId,
          input.support_passport_id, JSON.stringify(input.diagnostic_scopes), encrypted.ciphertext,
          encrypted.initialization_vector, encrypted.authentication_tag, encrypted.content_digest,
          JSON.stringify(redaction), actor.id, acceptedAt, expiresAt.toISOString()]);
        return { aggregateType: "diagnostic_bundle", aggregateId: id,
          transitionType: "kernel.diagnostic_bundle.created", transitionPayload: { diagnostic_scopes: input.diagnostic_scopes },
          result: { diagnostic_bundle: { diagnostic_bundle_id: id, support_passport_id: input.support_passport_id,
            diagnostic_scopes: input.diagnostic_scopes, content_digest: encrypted.content_digest,
            redaction_manifest: redaction, encrypted: true, immutable: true, expires_at: expiresAt.toISOString() } } };
      } });
  }

  async function readDiagnostic(bundleId, token) {
    const passport = await authenticateSupport(token);
    const result = await pool.query(`SELECT * FROM kernel_diagnostic_bundles WHERE installation_id=$1
      AND environment_id=$2 AND diagnostic_bundle_id=$3`, [installationId, environmentId, bundleId]);
    const bundle = result.rows[0];
    if (!bundle || bundle.support_passport_id !== passport.support_passport_id
        || new Date(bundle.expires_at).getTime() <= Date.now()) fail("DIAGNOSTIC_BUNDLE_UNAVAILABLE", "Diagnostic bundle is missing or expired.", 404);
    const notice = assertSupportPassportNotice(passport.signed_notice.document);
    const accessedAt = new Date().toISOString();
    await pool.query(`INSERT INTO kernel_diagnostic_access_records
      (access_record_id,installation_id,environment_id,diagnostic_bundle_id,support_passport_id,support_identity,accessed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), installationId, environmentId, bundleId,
      passport.support_passport_id, JSON.stringify(notice.support_identity), accessedAt]);
    return { diagnostic_bundle_id: bundleId, content_digest: bundle.content_digest,
      diagnostics: decryptDiagnosticBundle(bundle, diagnosticSecret), accessed_at: accessedAt };
  }

  async function getDiagnostic(bundleId) {
    const result = await pool.query(`SELECT b.diagnostic_bundle_id,b.support_passport_id,b.diagnostic_scopes,
      b.content_digest,b.redaction_manifest,b.created_at,b.expires_at,
      COALESCE(json_agg(json_build_object('access_record_id',a.access_record_id,'support_identity',a.support_identity,
        'accessed_at',a.accessed_at) ORDER BY a.accessed_at) FILTER (WHERE a.access_record_id IS NOT NULL),'[]') AS access_log
      FROM kernel_diagnostic_bundles b LEFT JOIN kernel_diagnostic_access_records a USING (diagnostic_bundle_id)
      WHERE b.installation_id=$1 AND b.environment_id=$2 AND b.diagnostic_bundle_id=$3 GROUP BY b.diagnostic_bundle_id`,
    [installationId, environmentId, bundleId]);
    if (!result.rows[0]) fail("DIAGNOSTIC_BUNDLE_NOT_FOUND", "Diagnostic bundle does not exist.", 404);
    return { ...result.rows[0], encrypted: true, immutable: true };
  }

  async function authorizeRemediation(envelope, actor) {
    const input = exact(envelope.input, ["support_passport_id", "capability_admission", "requested_action"], "input");
    object(input.requested_action, "requested_action");
    const prior = await replay(envelope, actor);
    if (prior) return prior;
    const passport = await pool.query(`SELECT p.*,s.state,b.state AS binding_state FROM kernel_support_passports p
      JOIN kernel_support_passport_states s USING (installation_id,environment_id,support_passport_id)
      JOIN kernel_coordinator_binding_states b USING (installation_id,environment_id,binding_id)
      WHERE p.installation_id=$1 AND p.environment_id=$2 AND p.support_passport_id=$3`,
    [installationId, environmentId, input.support_passport_id]);
    if (!passport.rows[0] || passport.rows[0].state !== "active" || passport.rows[0].binding_state !== "active"
        || new Date(passport.rows[0].expires_at).getTime() <= Date.now()) fail("SUPPORT_PASSPORT_INACTIVE", "Active Support Passport required.", 409);
    const admission = await deploymentService.checkCapabilityAdmission(input.capability_admission);
    const command = accountableCommand(envelope, actor);
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command), apply: async (client, { acceptedAt }) => {
        const id = randomUUID();
        await client.query(`INSERT INTO kernel_support_remediation_authorizations
          (remediation_authorization_id,installation_id,environment_id,support_passport_id,capability_admission,
           requested_action,authorized_by_actor_id,authorized_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, installationId, environmentId, input.support_passport_id, JSON.stringify(admission),
          JSON.stringify(input.requested_action), actor.id, acceptedAt]);
        return { aggregateType: "support_remediation_authorization", aggregateId: id,
          transitionType: "kernel.support_remediation.authorized", transitionPayload: {
            support_passport_id: input.support_passport_id, capability_activation_id: admission.capability_activation_id },
          result: { remediation_authorization: { remediation_authorization_id: id,
            support_passport_id: input.support_passport_id, capability_admission: admission,
            requested_action: input.requested_action, execution_started: false, external_effects: false,
            immutable: true, authorized_at: acceptedAt } } };
      } });
  }

  async function quarantineHost(envelope, hostId, actor) {
    const input = exact(envelope.input, ["current_key_id", "reason", "expected_revision"], "input");
    string(hostId, "host_id", 200); string(input.current_key_id, "current_key_id", 200);
    string(input.reason, "reason"); integer(input.expected_revision, "expected_revision");
    const routeBinding = { host_id: hostId };
    const prior = await replay(envelope, actor, routeBinding);
    if (prior) return prior;
    const command = accountableCommand(envelope, actor, routeBinding);
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command), apply: async (client, { acceptedAt, environment }) => {
        const stateResult = await client.query(`SELECT * FROM kernel_host_security_states WHERE installation_id=$1
          AND environment_id=$2 AND host_id=$3 FOR UPDATE`, [installationId, environmentId, hostId]);
        const state = stateResult.rows[0] ?? { state: "active", placement_eligible: true,
          current_key_id: input.current_key_id, revision: "0" };
        if (Number(state.revision) !== input.expected_revision || state.current_key_id !== input.current_key_id) {
          fail("HOST_REVISION_CONFLICT", "Host identity or revision changed.", 409);
        }
        if (state.state === "quarantined") fail("HOST_ALREADY_QUARANTINED", "Host is already quarantined.", 409);
        const replacementKeyId = `host-key:${randomUUID()}`;
        await client.query(`INSERT INTO kernel_host_security_states
          (installation_id,environment_id,host_id,state,placement_eligible,current_key_id,revoked_key_id,revision,updated_at)
          VALUES ($1,$2,$3,'quarantined',false,$4,$5,1,$6)
          ON CONFLICT (installation_id,environment_id,host_id) DO UPDATE SET state='quarantined',placement_eligible=false,
            current_key_id=EXCLUDED.current_key_id,revoked_key_id=EXCLUDED.revoked_key_id,
            revision=kernel_host_security_states.revision+1,updated_at=EXCLUDED.updated_at`,
        [installationId, environmentId, hostId, replacementKeyId, state.current_key_id, acceptedAt]);
        await client.query(`INSERT INTO kernel_host_key_events
          (host_key_event_id,installation_id,environment_id,host_id,event_type,prior_key_id,replacement_key_id,reason,actor_id,occurred_at)
          VALUES ($1,$2,$3,$4,'revoked_and_rotated',$5,$6,$7,$8,$9)`,
        [randomUUID(), installationId, environmentId, hostId, state.current_key_id, replacementKeyId,
          input.reason, actor.id, acceptedAt]);
        await client.query(`UPDATE kernel_environments SET execution_epoch=execution_epoch+1,updated_at=$3
          WHERE installation_id=$1 AND environment_id=$2`, [installationId, environmentId, acceptedAt]);
        return { aggregateType: "runtime_host", aggregateId: hostId,
          transitionType: "kernel.runtime_host.quarantined", transitionPayload: { revoked_key_id: state.current_key_id },
          result: { host: { host_id: hostId, state: "quarantined", placement_eligible: false,
            revoked_key_id: state.current_key_id, replacement_key_id: replacementKeyId,
            revision: String(Number(state.revision) + 1), workloads_fenced: true,
            execution_epoch: String(BigInt(environment.execution_epoch) + 1n) } } };
      } });
  }

  async function checkHostPlacement(input) {
    exact(input, ["host_id", "host_key_id"], "input");
    const result = await pool.query(`SELECT * FROM kernel_host_security_states WHERE installation_id=$1
      AND environment_id=$2 AND host_id=$3`, [installationId, environmentId, string(input.host_id, "host_id", 200)]);
    const state = result.rows[0];
    if (!state) return { admissible: true, basis: "host_not_quarantined", host_id: input.host_id };
    if (!state.placement_eligible || state.state === "quarantined" || state.current_key_id !== input.host_key_id) {
      return { admissible: false, basis: "host_quarantined_or_key_revoked", host_id: input.host_id,
        state: state.state, current_key_id: state.current_key_id };
    }
    return { admissible: true, basis: "active_host_key", host_id: input.host_id };
  }

  async function syncBindingRevocation(envelope, bindingId, actor) {
    const input = exact(envelope.input, ["reason"], "input"); string(input.reason, "reason");
    const routeBinding = { binding_id: bindingId };
    const prior = await replay(envelope, actor, routeBinding);
    if (prior) return prior;
    const result = await pool.query(`SELECT b.*,s.state,s.revision FROM kernel_coordinator_bindings b
      JOIN kernel_coordinator_binding_states s USING (installation_id,environment_id,binding_id)
      WHERE b.installation_id=$1 AND b.environment_id=$2 AND b.binding_id=$3 AND s.state='revoked'`,
    [installationId, environmentId, bindingId]);
    const revoked = result.rows[0];
    if (!revoked) fail("COORDINATOR_BINDING_NOT_FOUND", "Revoked binding does not match.", 404);
    const now = new Date();
    const document = assertCoordinatorBindingRevocation({ schema_version: "alphonse.coordinator_binding_revocation.v0.1",
      revocation_id: randomUUID(), coordinator_id: revoked.coordinator_id, customer_id: revoked.customer_id,
      environment_id: environmentId, binding_id: bindingId, reason: input.reason, issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 300_000).toISOString() });
    const signed = signCoordinationDocument(document, environmentPrivateKey);
    await fetchJson(`${revoked.coordinator_endpoint}/coordinator/v0/binding-revocations`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(signed) });
    const command = accountableCommand(envelope, actor, routeBinding);
    return executeCommand({ installationId, environmentId, command,
      requestDigest: commandDigest(installationId, environmentId, command), apply: async (client, { acceptedAt }) => {
        await client.query(`INSERT INTO kernel_coordinator_revocation_deliveries
          (revocation_id,installation_id,environment_id,binding_id,signed_revocation,revocation_digest,delivered_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [document.revocation_id, installationId, environmentId, bindingId,
          JSON.stringify(signed), sha256Digest(signed), acceptedAt]);
        return { aggregateType: "coordinator_binding", aggregateId: bindingId,
          transitionType: "kernel.coordinator_binding.revocation_delivered", transitionPayload: { revocation_id: document.revocation_id },
          result: { binding_revocation: { binding_id: bindingId, hosted_visibility: false,
            hosted_support: false, local_history_preserved: true, delivered_at: acceptedAt } } };
      } });
  }

  async function getButlerProjection() {
    const [cases, passports, diagnostics, hosts] = await Promise.all([
      pool.query(`SELECT c.support_case_id,c.binding_id,c.signed_request->'document' AS request,s.state,s.revision,s.updated_at
        FROM kernel_received_support_cases c JOIN kernel_support_case_states s
          USING (installation_id,environment_id,support_case_id)
        WHERE c.installation_id=$1 AND c.environment_id=$2 ORDER BY c.received_at DESC`,
      [installationId, environmentId]),
      pool.query(`SELECT p.support_passport_id,p.support_case_id,p.signed_notice->'document' AS notice,
          s.state,s.revision,p.expires_at
        FROM kernel_support_passports p JOIN kernel_support_passport_states s
          USING (installation_id,environment_id,support_passport_id)
        WHERE p.installation_id=$1 AND p.environment_id=$2 ORDER BY p.issued_at DESC`,
      [installationId, environmentId]),
      pool.query(`SELECT b.diagnostic_bundle_id,b.support_passport_id,b.diagnostic_scopes,b.content_digest,
          b.redaction_manifest,b.created_at,b.expires_at,count(a.access_record_id)::int AS access_count
        FROM kernel_diagnostic_bundles b LEFT JOIN kernel_diagnostic_access_records a USING (diagnostic_bundle_id)
        WHERE b.installation_id=$1 AND b.environment_id=$2 GROUP BY b.diagnostic_bundle_id ORDER BY b.created_at DESC`,
      [installationId, environmentId]),
      pool.query(`SELECT host_id,state,placement_eligible,current_key_id,revoked_key_id,revision,updated_at
        FROM kernel_host_security_states WHERE installation_id=$1 AND environment_id=$2 ORDER BY host_id`,
      [installationId, environmentId])
    ]);
    return { support_cases: cases.rows, support_passports: passports.rows,
      diagnostic_bundles: diagnostics.rows, runtime_hosts: hosts.rows };
  }

  return { publishHealth, pollSupportCases, approveSupportCase, pushSupportPassport, createDiagnostic,
    readDiagnostic, getDiagnostic, authorizeRemediation, quarantineHost, checkHostPlacement,
    syncBindingRevocation, authenticateSupport, getButlerProjection };
}
