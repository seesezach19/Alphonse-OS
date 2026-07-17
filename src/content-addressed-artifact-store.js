import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
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

  async function getBytes(digest, mediaType = "application/octet-stream") {
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
    return {
      artifact: {
        artifact_digest: digest,
        size_bytes: bytes.length,
        media_type: mediaType,
        storage_key: storageKey,
        verified: true
      },
      bytes
    };
  }

  async function getJson(digest) {
    const stored = await getBytes(digest, "application/json");
    let content;
    try {
      content = JSON.parse(stored.bytes.toString("utf8"));
    } catch {
      throw new KernelError(409, "ARTIFACT_INVALID_JSON", "Verified artifact bytes are not valid JSON.");
    }
    return {
      artifact: stored.artifact,
      content
    };
  }

  async function fsyncDirectory(directory) {
    let handle;
    try {
      handle = await open(directory, "r");
      await handle.sync();
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EISDIR", "EINVAL"].includes(error.code)) throw error;
    } finally {
      await handle?.close();
    }
  }

  async function putBytes(value, { mediaType = "application/octet-stream", expectedDigest = null,
    maxBytes = 1024 * 1024 } = {}) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (!Number.isInteger(maxBytes) || maxBytes < 0 || bytes.length > maxBytes) {
      throw new KernelError(413, "ARTIFACT_TOO_LARGE", "Artifact exceeds its exact byte limit.", {
        size_bytes: bytes.length, max_bytes: maxBytes
      });
    }
    if (typeof mediaType !== "string" || !mediaType || mediaType.length > 160) {
      throw new KernelError(400, "INVALID_ARTIFACT_MEDIA_TYPE", "Artifact media type is invalid.");
    }
    const digest = bytesDigest(bytes);
    if (expectedDigest !== null && expectedDigest !== digest) {
      throw new KernelError(409, "ARTIFACT_DIGEST_MISMATCH", "Artifact bytes do not match the signed digest.", {
        expected_digest: expectedDigest, actual_digest: digest
      });
    }
    const { absolutePath, storageKey } = location(resolvedRoot, digest);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
    let temporaryHandle;
    try {
      temporaryHandle = await open(temporaryPath, "wx");
      await temporaryHandle.writeFile(bytes);
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = null;
      try {
        await link(temporaryPath, absolutePath);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      if (process.platform !== "win32") {
        const finalHandle = await open(absolutePath, "r");
        try {
          await finalHandle.sync();
        } finally {
          await finalHandle.close();
        }
      }
      await fsyncDirectory(path.dirname(absolutePath));
    } finally {
      await temporaryHandle?.close();
      await rm(temporaryPath, { force: true });
    }
    const stored = await getBytes(digest, mediaType);
    return {
      artifact_digest: stored.artifact.artifact_digest,
      size_bytes: stored.artifact.size_bytes,
      media_type: mediaType,
      storage_key: storageKey
    };
  }

  async function putJson(value) {
    return putBytes(Buffer.from(canonicalize(value), "utf8"), {
      mediaType: "application/json",
      maxBytes: Number.MAX_SAFE_INTEGER
    });
  }

  async function deleteJson(digest) {
    const { absolutePath } = location(resolvedRoot, digest);
    try {
      await rm(absolutePath);
      return { artifact_digest: digest, bytes_deleted: true };
    } catch (error) {
      if (error.code === "ENOENT") return { artifact_digest: digest, bytes_deleted: false };
      throw error;
    }
  }

  return { deleteJson, getBytes, getJson, putBytes, putJson };
}
