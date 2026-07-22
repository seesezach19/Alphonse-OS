import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

function keyBytes(key) {
  const bytes = Buffer.isBuffer(key) ? key : Buffer.from(String(key), "base64");
  if (bytes.length !== 32) throw new KernelError(400, "INVALID_BACKUP_KEY", "Backup key must be 32 bytes.");
  return bytes;
}

function bytesDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function buildArtifactManifest(artifacts) {
  return artifacts.map((artifact) => {
    const bytes = Buffer.from(artifact.bytes);
    const digest = bytesDigest(bytes);
    if (artifact.digest && artifact.digest !== digest) {
      throw new KernelError(409, "ARTIFACT_DIGEST_MISMATCH", `Artifact ${artifact.digest} failed digest verification.`);
    }
    return { digest, size_bytes: bytes.length };
  }).sort((left, right) => left.digest.localeCompare(right.digest));
}

export function createEncryptedBackup({ backupId, environmentId, restorePointSequence, executionEpoch,
  postgresDump, artifacts = [], key, keyId, createdAt = new Date().toISOString() }) {
  const artifactManifest = buildArtifactManifest(artifacts);
  const manifest = {
    schema_version: "alphonse.local_backup.v0.1", backup_id: backupId, environment_id: environmentId,
    restore_point_sequence: Number(restorePointSequence), execution_epoch: Number(executionEpoch),
    postgres_dump_digest: bytesDigest(Buffer.from(postgresDump)), artifacts: artifactManifest,
    created_at: createdAt, encryption: { algorithm: "aes-256-gcm", key_id: keyId }
  };
  const payload = canonicalize({ postgres_dump: Buffer.from(postgresDump).toString("base64"),
    artifacts: artifacts.map((artifact) => ({ digest: bytesDigest(Buffer.from(artifact.bytes)),
      bytes: Buffer.from(artifact.bytes).toString("base64") })) });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  cipher.setAAD(Buffer.from(canonicalize(manifest)));
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return { manifest, manifest_digest: sha256Digest(manifest), iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function openEncryptedBackup(bundle, key) {
  if (sha256Digest(bundle.manifest) !== bundle.manifest_digest) {
    throw new KernelError(409, "BACKUP_MANIFEST_DIGEST_MISMATCH", "Backup manifest digest is invalid.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(bundle.iv, "base64"));
    decipher.setAAD(Buffer.from(canonicalize(bundle.manifest)));
    decipher.setAuthTag(Buffer.from(bundle.auth_tag, "base64"));
    const payload = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(bundle.ciphertext, "base64")), decipher.final()
    ]).toString("utf8"));
    const postgresDump = Buffer.from(payload.postgres_dump, "base64");
    if (bytesDigest(postgresDump) !== bundle.manifest.postgres_dump_digest) {
      throw new KernelError(409, "POSTGRES_DUMP_DIGEST_MISMATCH", "PostgreSQL dump digest is invalid.");
    }
    const artifacts = payload.artifacts.map((artifact) => ({ digest: artifact.digest,
      bytes: Buffer.from(artifact.bytes, "base64") }));
    const actual = buildArtifactManifest(artifacts);
    if (canonicalize(actual) !== canonicalize(bundle.manifest.artifacts)) {
      throw new KernelError(409, "ARTIFACT_MANIFEST_MISMATCH", "Artifact set does not match backup manifest.");
    }
    return { manifest: bundle.manifest, postgresDump, artifacts };
  } catch (error) {
    if (error instanceof KernelError) throw error;
    throw new KernelError(409, "BACKUP_DECRYPTION_FAILED", "Backup authentication or decryption failed.");
  }
}

function archiveManifest(items, kind) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new KernelError(400, "EMPTY_BACKUP_SCOPE", `Backup requires at least one ${kind}.`);
  }
  const names = new Set();
  return items.map((item) => {
    if (typeof item.name !== "string" || !/^[a-z][a-z0-9_-]{1,63}$/.test(item.name) || names.has(item.name)) {
      throw new KernelError(400, "INVALID_BACKUP_SCOPE", `Backup ${kind} names must be unique stable identifiers.`);
    }
    names.add(item.name);
    const bytes = Buffer.from(item.bytes);
    return { name: item.name, digest: bytesDigest(bytes), size_bytes: bytes.length };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function createEncryptedNodeBackup({ backupId, environmentId, restorePointSequence, executionEpoch,
  databaseDumps, storeArchives, artifacts = [], key, keyId, createdAt = new Date().toISOString() }) {
  const databases = archiveManifest(databaseDumps, "database dump");
  const stores = archiveManifest(storeArchives, "store archive");
  const manifest = {
    schema_version: "alphonse.single_tenant_backup.v0.2",
    backup_id: backupId,
    environment_id: environmentId,
    restore_point_sequence: Number(restorePointSequence),
    execution_epoch: Number(executionEpoch),
    database_dumps: databases,
    store_archives: stores,
    artifacts: [...artifacts].map((item) => ({ digest: item.digest, size_bytes: Number(item.size_bytes) }))
      .sort((left, right) => left.digest.localeCompare(right.digest)),
    created_at: createdAt,
    encryption: { algorithm: "aes-256-gcm", key_id: keyId }
  };
  const byName = (items) => [...items].sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => ({ name: item.name, bytes: Buffer.from(item.bytes).toString("base64") }));
  const payload = canonicalize({ database_dumps: byName(databaseDumps), store_archives: byName(storeArchives) });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  cipher.setAAD(Buffer.from(canonicalize(manifest)));
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return {
    manifest,
    manifest_digest: sha256Digest(manifest),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

export function openEncryptedNodeBackup(bundle, key) {
  if (bundle?.manifest?.schema_version !== "alphonse.single_tenant_backup.v0.2"
      || sha256Digest(bundle.manifest) !== bundle.manifest_digest) {
    throw new KernelError(409, "BACKUP_MANIFEST_DIGEST_MISMATCH", "Node backup manifest is invalid.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(bundle.iv, "base64"));
    decipher.setAAD(Buffer.from(canonicalize(bundle.manifest)));
    decipher.setAuthTag(Buffer.from(bundle.auth_tag, "base64"));
    const payload = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(bundle.ciphertext, "base64")), decipher.final()
    ]).toString("utf8"));
    const open = (items) => items.map((item) => ({ name: item.name, bytes: Buffer.from(item.bytes, "base64") }));
    const databaseDumps = open(payload.database_dumps);
    const storeArchives = open(payload.store_archives);
    if (canonicalize(archiveManifest(databaseDumps, "database dump")) !== canonicalize(bundle.manifest.database_dumps)
        || canonicalize(archiveManifest(storeArchives, "store archive")) !== canonicalize(bundle.manifest.store_archives)) {
      throw new KernelError(409, "BACKUP_PAYLOAD_MANIFEST_MISMATCH",
        "Node backup payload does not match its authenticated manifest.");
    }
    return { manifest: bundle.manifest, databaseDumps, storeArchives };
  } catch (error) {
    if (error instanceof KernelError) throw error;
    throw new KernelError(409, "BACKUP_DECRYPTION_FAILED", "Node backup authentication or decryption failed.");
  }
}
