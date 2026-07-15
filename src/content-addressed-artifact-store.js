import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalize } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;

function bytesDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function location(root, digest) {
  const match = DIGEST_PATTERN.exec(digest);
  if (!match) {
    throw new KernelError(400, "INVALID_ARTIFACT_DIGEST", "Artifact digest must be an exact SHA-256 digest.");
  }
  const hex = match[1];
  const storageKey = path.posix.join("objects", hex.slice(0, 2), `${hex}.json`);
  return { absolutePath: path.join(root, ...storageKey.split("/")), storageKey };
}

export function createContentAddressedArtifactStore(root) {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw new Error("Artifact store root is required.");
  }
  const resolvedRoot = path.resolve(root);

  async function getJson(digest) {
    const { absolutePath, storageKey } = location(resolvedRoot, digest);
    let bytes;
    try {
      bytes = await readFile(absolutePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new KernelError(404, "ARTIFACT_NOT_FOUND", "Artifact bytes do not exist.", { artifact_digest: digest });
      }
      throw error;
    }
    const actualDigest = bytesDigest(bytes);
    if (actualDigest !== digest) {
      throw new KernelError(409, "ARTIFACT_DIGEST_MISMATCH", "Artifact bytes failed digest verification.", {
        expected_digest: digest,
        actual_digest: actualDigest
      });
    }
    let content;
    try {
      content = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new KernelError(409, "ARTIFACT_INVALID_JSON", "Verified artifact bytes are not valid JSON.");
    }
    return {
      artifact: {
        artifact_digest: digest,
        size_bytes: bytes.length,
        media_type: "application/json",
        storage_key: storageKey,
        verified: true
      },
      content
    };
  }

  async function putJson(value) {
    const bytes = Buffer.from(canonicalize(value), "utf8");
    const digest = bytesDigest(bytes);
    const { absolutePath, storageKey } = location(resolvedRoot, digest);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      try {
        await copyFile(temporaryPath, absolutePath, fsConstants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    } finally {
      await rm(temporaryPath, { force: true });
    }
    const stored = await getJson(digest);
    return {
      artifact_digest: stored.artifact.artifact_digest,
      size_bytes: stored.artifact.size_bytes,
      media_type: stored.artifact.media_type,
      storage_key: storageKey
    };
  }

  return { getJson, putJson };
}
