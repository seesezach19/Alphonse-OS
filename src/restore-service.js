import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LIFECYCLE_KINDS = new Set(["typed_tombstone", "authority_expiration", "identity_pseudonymization",
  "environment_destruction"]);

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
  if (canonicalize(actual) !== canonicalize(expected)) {
    throw new KernelError(400, "INVALID_INPUT", `${path} has an invalid shape.`);
  }
  return candidate;
}

function uuid(value, path) {
  if (typeof value !== "string" || !UUID.test(value)) throw new KernelError(400, "INVALID_IDENTIFIER", `${path} must be a UUID.`);
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new KernelError(400, "INVALID_DIGEST", `${path} must be a SHA-256 digest.`);
  return value;
}

function text(value, path, maximum = 200) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) throw new KernelError(400, "INVALID_INPUT", `${path} is invalid.`);
  return value;
}

export function validateRestoreManifest(value) {
  const manifest = exact(value, "backup_manifest", ["schema_version", "backup_id", "environment_id",
    "restore_point_sequence", "execution_epoch", "postgres_dump_digest", "artifacts", "created_at", "encryption"]);
  if (manifest.schema_version !== "alphonse.local_backup.v0.1") throw new KernelError(400, "BACKUP_SCHEMA_UNSUPPORTED", "Backup schema is unsupported.");
  if (!Number.isSafeInteger(manifest.restore_point_sequence) || manifest.restore_point_sequence < 0
    || !Number.isSafeInteger(manifest.execution_epoch) || manifest.execution_epoch < 1) {
    throw new KernelError(400, "INVALID_BACKUP_CURSOR", "Backup cursor or epoch is invalid.");
  }
  const artifacts = manifest.artifacts.map((entry) => {
    const item = exact(entry, "backup_manifest.artifacts[]", ["digest", "size_bytes"]);
    if (!Number.isSafeInteger(item.size_bytes) || item.size_bytes < 0) throw new KernelError(400, "INVALID_INPUT", "Artifact size is invalid.");
    return { digest: digest(item.digest, "artifact.digest"), size_bytes: item.size_bytes };
  });
  if (new Set(artifacts.map((entry) => entry.digest)).size !== artifacts.length) {
    throw new KernelError(400, "DUPLICATE_ARTIFACT_DIGEST", "Backup manifest artifact digests must be unique.");
  }
  const encryption = exact(manifest.encryption, "backup_manifest.encryption", ["algorithm", "key_id"]);
  if (encryption.algorithm !== "aes-256-gcm") throw new KernelError(400, "BACKUP_ENCRYPTION_UNSUPPORTED", "Backup must use AES-256-GCM.");
  return { ...manifest, backup_id: text(manifest.backup_id, "backup_manifest.backup_id"),
    environment_id: uuid(manifest.environment_id, "backup_manifest.environment_id"),
    postgres_dump_digest: digest(manifest.postgres_dump_digest, "backup_manifest.postgres_dump_digest"),
    artifacts, encryption: { algorithm: encryption.algorithm, key_id: text(encryption.key_id, "encryption.key_id") } };
}

export function validateRestoreBeginInput(value) {
  const input = exact(value, "input", ["backup_manifest", "backup_manifest_digest"]);
  const backupManifest = validateRestoreManifest(input.backup_manifest);
  const backupManifestDigest = digest(input.backup_manifest_digest, "input.backup_manifest_digest");
  if (sha256Digest(backupManifest) !== backupManifestDigest) {
    throw new KernelError(409, "BACKUP_MANIFEST_DIGEST_MISMATCH", "Backup manifest digest does not match exact manifest.");
  }
  return { backup_manifest: backupManifest, backup_manifest_digest: backupManifestDigest };
}

export function validateLifecycleInput(value) {
  const input = exact(value, "input", ["lifecycle_kind", "subject_type", "subject_id", "detail"]);
  if (!LIFECYCLE_KINDS.has(input.lifecycle_kind)) throw new KernelError(400, "INVALID_LIFECYCLE_KIND", "Lifecycle kind is invalid.");
  return { lifecycle_kind: input.lifecycle_kind, subject_type: text(input.subject_type, "input.subject_type"),
    subject_id: text(input.subject_id, "input.subject_id", 500), detail: object(input.detail, "input.detail") };
}

export function createRestoreService(database, identityIntent, recoveryService, installationId, environmentId) {
  const { pool, executeCommand } = database;

  async function getRestore(restoreId, client = pool) {
    uuid(restoreId, "restore_id");
    const result = await client.query(`SELECT * FROM kernel_restore_sessions
      WHERE installation_id=$1 AND environment_id=$2 AND restore_id=$3`, [installationId, environmentId, restoreId]);
    if (!result.rows[0]) throw new KernelError(404, "RESTORE_NOT_FOUND", "Restore session does not exist.");
    const obligations = await client.query(`SELECT o.*,s.status AS recovery_status,s.reconciliation_status
      FROM kernel_restore_obligations o JOIN kernel_recovery_case_states s
       ON s.installation_id=o.installation_id AND s.environment_id=o.environment_id
       AND s.recovery_case_id=o.recovery_case_id
      WHERE o.installation_id=$1 AND o.environment_id=$2 AND o.restore_id=$3 ORDER BY o.created_at`,
    [installationId, environmentId, restoreId]);
    const projections = await client.query(`SELECT * FROM kernel_projection_states
      WHERE installation_id=$1 AND environment_id=$2 ORDER BY projection_name`, [installationId, environmentId]);
    return { ...result.rows[0], obligations: obligations.rows.map((row) => ({ ...row,
      resolved: row.recovery_status === "resolved_applied" })), projections: projections.rows };
  }

  async function begin(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const input = validateRestoreBeginInput(envelope.input);
    const command = { ...envelope, input, actor };
    const restoreId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt, environment }) => {
        const existingRestore = await client.query(`SELECT restore_id FROM kernel_restore_sessions
          WHERE installation_id=$1 AND environment_id=$2 AND status<>'resumed' LIMIT 1`, [installationId, environmentId]);
        if (existingRestore.rowCount > 0) throw new KernelError(409, "RESTORE_ALREADY_ACTIVE", "Environment already has an active restore.");
        const preFenced = environment.operational_state === "restore_suspended"
          && Number(environment.execution_epoch) === Number(input.backup_manifest.execution_epoch) + 1;
        if (environment.operational_state !== "active" && !preFenced) {
          throw new KernelError(409, "RESTORE_STATE_MISMATCH", "Environment is not active or correctly pre-fenced for this restore.");
        }
        if (input.backup_manifest.environment_id !== environmentId
          || (!preFenced && Number(input.backup_manifest.execution_epoch) !== Number(environment.execution_epoch))
          || Number(input.backup_manifest.restore_point_sequence) !== Number(environment.next_sequence) - 1) {
          throw new KernelError(409, "RESTORE_POINT_MISMATCH", "Restored database does not match the backup manifest cursor, epoch, or Environment.");
        }
        const previousEpoch = Number(input.backup_manifest.execution_epoch);
        const executionEpoch = previousEpoch + 1;
        if (!preFenced) {
          await client.query(`UPDATE kernel_environments SET operational_state='restore_suspended',execution_epoch=$3,
            restore_generation=restore_generation+1,updated_at=$4 WHERE installation_id=$1 AND environment_id=$2`,
          [installationId, environmentId, executionEpoch, acceptedAt]);
        }
        await client.query(`INSERT INTO kernel_restore_sessions
          (restore_id,installation_id,environment_id,backup_id,backup_manifest,backup_manifest_digest,
           restore_point_sequence,previous_execution_epoch,execution_epoch,status,started_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'suspended',$10)`,
        [restoreId, installationId, environmentId, input.backup_manifest.backup_id, input.backup_manifest,
          input.backup_manifest_digest, input.backup_manifest.restore_point_sequence, previousEpoch, executionEpoch, acceptedAt]);
        const candidates = await client.query(`SELECT e.effect_id FROM kernel_effect_records e
          JOIN kernel_effect_states s ON s.installation_id=e.installation_id AND s.environment_id=e.environment_id
           AND s.effect_id=e.effect_id
          WHERE e.installation_id=$1 AND e.environment_id=$2 AND s.status IN ('admitted','dispatching','uncertain')`,
        [installationId, environmentId]);
        for (const { effect_id: effectId } of candidates.rows) {
          const recovery = await recoveryService.openRestoreUncertainty(client, effectId, restoreId, acceptedAt);
          await client.query(`INSERT INTO kernel_restore_obligations
            (restore_obligation_id,installation_id,environment_id,restore_id,effect_id,recovery_case_id,reason,created_at)
            VALUES ($1,$2,$3,$4,$5,$6,'possibly_applied_after_restore_point',$7)`,
          [randomUUID(), installationId, environmentId, restoreId, effectId, recovery.recovery_case_id, acceptedAt]);
        }
        if (candidates.rowCount > 0) await client.query(`UPDATE kernel_restore_sessions SET status='reconciling' WHERE restore_id=$1`, [restoreId]);
        return { aggregateType: "kernel_environment", aggregateId: environmentId,
          transitionType: "kernel.environment.restore_started", fromRevision: BigInt(environment.revision),
          toRevision: BigInt(environment.revision), transitionPayload: { restore_id: restoreId,
            from_epoch: previousEpoch, to_epoch: executionEpoch, restore_point_sequence: input.backup_manifest.restore_point_sequence,
            reconciliation_count: candidates.rowCount, pre_fenced: preFenced },
          result: { restore: await getRestore(restoreId, client) } };
      } });
  }

  async function rebuildProjection(envelope, restoreId) {
    const actor = await identityIntent.requireHumanActor();
    const input = exact(envelope.input, "input", []);
    const command = { ...envelope, input, actor };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt, environment }) => {
        const restore = await getRestore(restoreId, client);
        if (restore.status === "resumed") throw new KernelError(409, "RESTORE_ALREADY_RESUMED", "Restore already resumed authority.");
        const counts = await client.query(`SELECT
          (SELECT count(*) FROM kernel_work_intents WHERE installation_id=$1 AND environment_id=$2) AS work_intents,
          (SELECT count(*) FROM kernel_deployments WHERE installation_id=$1 AND environment_id=$2) AS deployments,
          (SELECT count(*) FROM kernel_runs WHERE installation_id=$1 AND environment_id=$2) AS runs,
          (SELECT count(*) FROM kernel_effect_records WHERE installation_id=$1 AND environment_id=$2) AS effects,
          (SELECT count(*) FROM kernel_recovery_cases WHERE installation_id=$1 AND environment_id=$2) AS recovery_cases`,
        [installationId, environmentId]);
        const cursor = Number(environment.next_sequence) - 1;
        const snapshot = { projection_name: "butler.accountable_work", projection_version: "0.1.0",
          source_cursor: cursor, counts: Object.fromEntries(Object.entries(counts.rows[0]).map(([key, value]) => [key, Number(value)])) };
        const current = await client.query(`SELECT revision FROM kernel_projection_states
          WHERE installation_id=$1 AND environment_id=$2 AND projection_name='butler.accountable_work' FOR UPDATE`,
        [installationId, environmentId]);
        const revision = Number(current.rows[0]?.revision ?? 0) + 1;
        await client.query(`INSERT INTO kernel_projection_states
          (installation_id,environment_id,projection_name,projection_version,source_cursor,health,projection_digest,revision,generated_at)
          VALUES ($1,$2,'butler.accountable_work','0.1.0',$3,'current',$4,$5,$6)
          ON CONFLICT (installation_id,environment_id,projection_name) DO UPDATE SET projection_version=EXCLUDED.projection_version,
           source_cursor=EXCLUDED.source_cursor,health='current',projection_digest=EXCLUDED.projection_digest,
           revision=EXCLUDED.revision,generated_at=EXCLUDED.generated_at`,
        [installationId, environmentId, cursor, sha256Digest(snapshot), revision, acceptedAt]);
        return { aggregateType: "projection", aggregateId: "butler.accountable_work",
          transitionType: "kernel.environment.restore_projection_rebuilt", transitionPayload: { restore_id: restoreId,
            projection_digest: sha256Digest(snapshot), source_cursor: cursor },
          result: { restore: await getRestore(restoreId, client), projection: { ...snapshot,
            projection_digest: sha256Digest(snapshot), health: "current", revision, generated_at: acceptedAt } } };
      } });
  }

  async function verify(envelope, restoreId) {
    const actor = await identityIntent.requireHumanActor();
    const input = exact(envelope.input, "input", ["verified_artifact_digests"]);
    if (!Array.isArray(input.verified_artifact_digests)) throw new KernelError(400, "INVALID_INPUT", "verified_artifact_digests must be an array.");
    const verified = [...new Set(input.verified_artifact_digests.map((value) => digest(value, "verified_artifact_digests[]")))].sort();
    const command = { ...envelope, input: { verified_artifact_digests: verified }, actor };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt, environment }) => {
        const restore = await getRestore(restoreId, client);
        const expected = restore.backup_manifest.artifacts.map((item) => item.digest).sort();
        const transitionCheck = await client.query(`SELECT count(*)::int AS count,coalesce(min(environment_sequence),0)::bigint AS first,
          coalesce(max(environment_sequence),0)::bigint AS last,count(DISTINCT command_id)::int AS distinct_commands,
          (SELECT count(*)::int FROM kernel_commands WHERE installation_id=$1 AND environment_id=$2) AS commands,
          (SELECT count(*)::int FROM kernel_outbox WHERE installation_id=$1 AND environment_id=$2) AS outbox
          FROM kernel_transitions WHERE installation_id=$1 AND environment_id=$2`, [installationId, environmentId]);
        const row = transitionCheck.rows[0];
        const transitionIntegrity = Number(row.count) === Number(row.distinct_commands)
          && Number(row.count) === Number(row.commands) && Number(row.count) === Number(row.outbox)
          && (Number(row.count) === 0 || (Number(row.first) === 1 && Number(row.last) === Number(row.count)));
        const projection = restore.projections.find((item) => item.projection_name === "butler.accountable_work");
        const unresolved = restore.obligations.filter((item) => !item.resolved);
        const checks = { transition_integrity: transitionIntegrity,
          artifact_manifest: canonicalize(expected) === canonicalize(verified),
          projection_current: projection?.health === "current" && Number(projection.source_cursor) <= Number(environment.next_sequence) - 1,
          restore_obligations_resolved: unresolved.length === 0 };
        if (!Object.values(checks).every(Boolean)) throw new KernelError(409, "RESTORE_VERIFICATION_FAILED",
          "Restore verification has unresolved checks.", { checks, unresolved_restore_obligations: unresolved.length });
        await client.query(`UPDATE kernel_restore_sessions SET status='verified',verification=$2,verified_at=$3 WHERE restore_id=$1`,
        [restoreId, checks, acceptedAt]);
        return { aggregateType: "kernel_environment", aggregateId: environmentId,
          transitionType: "kernel.environment.restore_verified", transitionPayload: { restore_id: restoreId, checks },
          result: { restore: await getRestore(restoreId, client), verification: checks } };
      } });
  }

  async function resume(envelope, restoreId) {
    const actor = await identityIntent.requireHumanActor();
    const input = exact(envelope.input, "input", []);
    const command = { ...envelope, input, actor };
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt, environment }) => {
        const restore = await getRestore(restoreId, client);
        if (restore.status !== "verified" || restore.obligations.some((item) => !item.resolved)) {
          throw new KernelError(409, "RESTORE_NOT_READY", "Restore verification and obligations must complete before authority resumes.");
        }
        await client.query(`UPDATE kernel_restore_sessions SET status='resumed',resumed_at=$2 WHERE restore_id=$1`, [restoreId, acceptedAt]);
        await client.query(`UPDATE kernel_environments SET operational_state='active',updated_at=$3
          WHERE installation_id=$1 AND environment_id=$2`, [installationId, environmentId, acceptedAt]);
        const resumedEnvironment = await client.query(`SELECT installation_id,environment_id,display_name,environment_class,
          revision,execution_epoch,operational_state,restore_generation,created_at,updated_at FROM kernel_environments
          WHERE installation_id=$1 AND environment_id=$2`, [installationId, environmentId]);
        return { aggregateType: "kernel_environment", aggregateId: environmentId,
          transitionType: "kernel.environment.restore_resumed", transitionPayload: { restore_id: restoreId,
            execution_epoch: Number(environment.execution_epoch) }, result: { restore: await getRestore(restoreId, client),
            environment: resumedEnvironment.rows[0] } };
      } });
  }

  async function recordLifecycle(envelope) {
    const actor = await identityIntent.requireHumanActor();
    const input = validateLifecycleInput(envelope.input);
    const command = { ...envelope, input, actor };
    const lifecycleRecordId = randomUUID();
    return executeCommand({ installationId, environmentId, command,
      requestDigest: sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command }),
      apply: async (client, { acceptedAt }) => {
        await client.query(`INSERT INTO kernel_data_lifecycle_records
          (lifecycle_record_id,installation_id,environment_id,lifecycle_kind,subject_type,subject_id,detail,detail_digest,recorded_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [lifecycleRecordId, installationId, environmentId,
          input.lifecycle_kind, input.subject_type, input.subject_id, input.detail, sha256Digest(input.detail), acceptedAt]);
        return { aggregateType: "data_lifecycle", aggregateId: lifecycleRecordId,
          transitionType: `kernel.data_lifecycle.${input.lifecycle_kind}`, transitionPayload: { subject_type: input.subject_type,
            subject_id: input.subject_id, detail_digest: sha256Digest(input.detail) }, result: { lifecycle_record: {
              lifecycle_record_id: lifecycleRecordId, ...input, detail_digest: sha256Digest(input.detail), recorded_at: acceptedAt } } };
      } });
  }

  async function getLatest() {
    const result = await pool.query(`SELECT restore_id FROM kernel_restore_sessions
      WHERE installation_id=$1 AND environment_id=$2 ORDER BY started_at DESC LIMIT 1`, [installationId, environmentId]);
    return result.rows[0] ? getRestore(result.rows[0].restore_id) : null;
  }

  return { begin, rebuildProjection, verify, resume, recordLifecycle, getRestore, getLatest };
}
