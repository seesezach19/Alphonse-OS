import { createHash } from "node:crypto";

export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);

  return `{${entries.join(",")}}`;
}

export function sha256Digest(value) {
  const hash = createHash("sha256").update(canonicalize(value)).digest("hex");
  return `sha256:${hash}`;
}
