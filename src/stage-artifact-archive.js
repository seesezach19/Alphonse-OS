import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

export const STAGE_ARTIFACT_ARCHIVE_SCHEMA = "alphonse.stage-artifact-archive.v0.1";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fail(message, details = {}) {
  throw new KernelError(500, "DIAGNOSTIC_STAGE_ARTIFACT_ARCHIVE_INTEGRITY_VIOLATION", message, details);
}

function manifestFiles(manifest) {
  const files = [...(manifest?.module_closure ?? []), ...(manifest?.bound_files ?? [])];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || !Array.isArray(manifest.module_closure) || !Array.isArray(manifest.bound_files)
      || files.length === 0) {
    fail("Stage artifact manifest does not contain an exact file closure.");
  }
  const seen = new Set();
  for (const entry of files) {
    if (!entry || typeof entry.path !== "string" || !entry.path
        || path.posix.normalize(entry.path) !== entry.path || entry.path.startsWith("../")
        || path.posix.isAbsolute(entry.path) || !Number.isInteger(entry.size_bytes)
        || entry.size_bytes < 0 || !DIGEST.test(entry.digest) || seen.has(entry.path)) {
      fail("Stage artifact manifest contains an invalid or duplicated file entry.", { path: entry?.path ?? null });
    }
    seen.add(entry.path);
  }
  return files;
}

export function buildStageArtifactArchive(manifest, {
  projectRoot = PROJECT_ROOT,
  readFile = readFileSync
} = {}) {
  const files = manifestFiles(manifest).map((entry) => {
    const absolutePath = path.resolve(projectRoot, ...entry.path.split("/"));
    const relative = path.relative(projectRoot, absolutePath).replaceAll(path.sep, "/");
    if (relative !== entry.path) fail("Stage artifact path escapes its project root.", { path: entry.path });
    const bytes = readFile(absolutePath);
    const actualDigest = rawDigest(bytes);
    if (bytes.length !== entry.size_bytes || actualDigest !== entry.digest) {
      fail("Stage artifact bytes do not match the activated manifest.", {
        path: entry.path,
        expected_digest: entry.digest,
        actual_digest: actualDigest,
        expected_size_bytes: entry.size_bytes,
        actual_size_bytes: bytes.length
      });
    }
    return {
      path: entry.path,
      size_bytes: entry.size_bytes,
      digest: entry.digest,
      bytes_base64: Buffer.from(bytes).toString("base64")
    };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    schema_version: STAGE_ARTIFACT_ARCHIVE_SCHEMA,
    stage_artifact_digest: sha256Digest(manifest),
    artifact_manifest: structuredClone(manifest),
    files
  };
}

export function verifyStageArtifactArchive(archive, expectedStageArtifactDigest = null) {
  if (!archive || archive.schema_version !== STAGE_ARTIFACT_ARCHIVE_SCHEMA
      || !DIGEST.test(archive.stage_artifact_digest)
      || sha256Digest(archive.artifact_manifest) !== archive.stage_artifact_digest
      || (expectedStageArtifactDigest && archive.stage_artifact_digest !== expectedStageArtifactDigest)
      || !Array.isArray(archive.files)) {
    fail("Stage artifact archive envelope does not match its manifest identity.");
  }
  const manifest = manifestFiles(archive.artifact_manifest)
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (archive.files.length !== manifest.length) fail("Stage artifact archive file count is incomplete.");
  for (let index = 0; index < manifest.length; index += 1) {
    const expected = manifest[index];
    const actual = archive.files[index];
    let bytes;
    try {
      bytes = Buffer.from(actual?.bytes_base64 ?? "", "base64");
    } catch {
      fail("Stage artifact archive contains invalid base64 bytes.", { path: actual?.path ?? null });
    }
    if (!actual || actual.path !== expected.path || actual.size_bytes !== expected.size_bytes
        || actual.digest !== expected.digest || bytes.length !== expected.size_bytes
        || rawDigest(bytes) !== expected.digest) {
      fail("Stage artifact archive file does not match the activated manifest.", { path: expected.path });
    }
  }
  return archive;
}

export async function prepareStageArtifactArchive(artifactStore, manifest) {
  const archive = verifyStageArtifactArchive(buildStageArtifactArchive(manifest));
  const stored = await artifactStore.putJson(archive);
  return { archive, stored };
}

export async function recordStageArtifactArchive({
  client,
  installationId,
  prepared,
  archivedAt
}) {
  const { archive, stored } = prepared;
  await client.query(
    `INSERT INTO diagnostic_artifacts
      (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
    [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type, stored.storage_key, archivedAt]
  );
  await client.query(
    `INSERT INTO diagnostic_stage_artifact_archives
      (installation_id,stage_artifact_digest,archive_artifact_digest,archived_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (installation_id,stage_artifact_digest) DO NOTHING`,
    [installationId, archive.stage_artifact_digest, stored.artifact_digest, archivedAt]
  );
  const row = (await client.query(
    `SELECT * FROM diagnostic_stage_artifact_archives
     WHERE installation_id=$1 AND stage_artifact_digest=$2`,
    [installationId, archive.stage_artifact_digest]
  )).rows[0];
  if (row.archive_artifact_digest !== stored.artifact_digest) {
    fail("Stage artifact identity is already bound to a different archive.", {
      stage_artifact_digest: archive.stage_artifact_digest,
      accepted_archive_artifact_digest: row.archive_artifact_digest,
      received_archive_artifact_digest: stored.artifact_digest
    });
  }
  return row;
}

export async function loadStageArtifactArchive({
  client,
  artifactStore,
  installationId,
  stageArtifactDigest
}) {
  const row = (await client.query(
    `SELECT * FROM diagnostic_stage_artifact_archives
     WHERE installation_id=$1 AND stage_artifact_digest=$2`,
    [installationId, stageArtifactDigest]
  )).rows[0];
  if (!row) {
    throw new KernelError(409, "INDEPENDENT_VERIFICATION_MATERIAL_UNAVAILABLE",
      "Exact activated stage artifact bytes are not preserved.", { stage_artifact_digest: stageArtifactDigest });
  }
  const stored = await artifactStore.getJson(row.archive_artifact_digest);
  verifyStageArtifactArchive(stored.content, stageArtifactDigest);
  if (sha256Digest(JSON.parse(canonicalize(stored.content))) !== sha256Digest(stored.content)) {
    fail("Stage artifact archive canonical material is unstable.");
  }
  return {
    stage_artifact_digest: stageArtifactDigest,
    archive_artifact_digest: row.archive_artifact_digest,
    archive: stored.content
  };
}
