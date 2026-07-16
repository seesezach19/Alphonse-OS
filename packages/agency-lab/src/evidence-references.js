import { sha256Digest } from "../../../src/canonical-json.js";

function decodeToken(token) {
  if (/~(?:[^01]|$)/.test(token)) throw new Error("Evidence reference contains invalid JSON Pointer escaping");
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePointer(document, pointer) {
  if (!pointer.startsWith("/")) return { exists: false, value: undefined };
  let current = document;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = decodeToken(rawToken);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return { exists: false, value: undefined };
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return { exists: false, value: undefined };
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object" || !Object.hasOwn(current, token)) {
      return { exists: false, value: undefined };
    }
    current = current[token];
  }
  return { exists: true, value: current };
}

export function validateEvidenceContext({ failureId, manifest, evidence }) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Evidence manifest is required");
  }
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Evidence document is required");
  }
  const computedDigest = sha256Digest(evidence);
  if (manifest.failure_id !== failureId || evidence.failure_id !== failureId) {
    throw new Error("Evidence context does not match the scored failure");
  }
  if (manifest.evidence_file !== "evidence.json" || manifest.answer_key_included !== false) {
    throw new Error("Evidence manifest has an unsupported shape");
  }
  if (manifest.evidence_artifact_digest !== computedDigest) {
    throw new Error("Evidence bytes do not match the manifest artifact digest");
  }
  return { manifest, evidence, artifact_digest: computedDigest };
}

export function resolveEvidenceReference(reference, context) {
  if (typeof reference !== "string") return { reference, exists: false, source: null };
  const separator = reference.indexOf("#");
  if (separator < 1) return { reference, exists: false, source: null };
  const source = reference.slice(0, separator);
  const pointer = reference.slice(separator + 1);
  let document;
  if (source === "manifest.json") document = context.manifest;
  else if (source === "evidence.json") document = context.evidence;
  else {
    const hex = context.artifact_digest.slice("sha256:".length);
    const expected = `artifacts/objects/${hex.slice(0, 2)}/${hex}.json`;
    if (source !== expected) return { reference, exists: false, source };
    document = context.evidence;
  }
  try {
    const resolved = resolvePointer(document, pointer);
    return { reference, exists: resolved.exists, source, value: resolved.value };
  } catch {
    return { reference, exists: false, source };
  }
}
