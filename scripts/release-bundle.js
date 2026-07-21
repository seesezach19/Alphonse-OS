import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RELEASE_VERSION = "0.1.0";
const TEXT_EXTENSIONS = new Set([".js", ".json", ".md", ".sql", ".yaml", ".yml", ".ps1", ".sh"]);
const STATIC_FILES = ["Dockerfile", "package.json", "package-lock.json"];
const TREES = ["src", "schemas", "migrations", "diagnostic-migrations", "docs", "runtime"];
const RELEASE_FILES = {
  "release/v0.1.0/compose.yaml": "compose.yaml",
  "release/v0.1.0/install-local.ps1": "install-local.ps1",
  "release/v0.1.0/install-local.sh": "install-local.sh",
  "release/v0.1.0/release-spec.json": "release-spec.json",
  "release/v0.1.0/upgrade-baseline.json": "upgrade-baseline.json",
  "release/v0.1.0/OPERATOR.md": "OPERATOR.md"
};

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizedBytes(file, bytes) {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
    ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : bytes;
}

async function treeFiles(root, relative) {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) files.push(...await treeFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Release input cannot contain links or special files: ${child}`);
  }
  return files;
}

export async function collectReleaseEntries(root) {
  const mappings = STATIC_FILES.map((file) => [file, file]);
  for (const tree of TREES) {
    for (const file of await treeFiles(root, tree)) mappings.push([file, file]);
  }
  mappings.push(...Object.entries(RELEASE_FILES));
  const entries = [];
  for (const [source, target] of mappings) {
    const bytes = normalizedBytes(source, await readFile(path.join(root, source)));
    entries.push({ path: target.replaceAll("\\", "/"), bytes,
      mode: target.endsWith(".sh") ? 0o755 : 0o644 });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function writeText(buffer, offset, length, value) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "ascii");
}

function writeOctal(buffer, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  writeText(buffer, offset, length, `${encoded}\0`);
}

function tarHeader(entry) {
  if (Buffer.byteLength(entry.path) > 100) throw new Error(`Release path exceeds USTAR name limit: ${entry.path}`);
  const header = Buffer.alloc(512);
  writeText(header, 0, 100, entry.path);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.bytes.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeText(header, 257, 6, "ustar\0");
  writeText(header, 263, 2, "00");
  writeText(header, 265, 32, "root");
  writeText(header, 297, 32, "root");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  writeText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

export function createDeterministicTar(entries) {
  const parts = [];
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    parts.push(tarHeader(entry), entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function validateReleaseEntries(entries) {
  const issues = [];
  const paths = new Set(entries.map((entry) => entry.path));
  const forbiddenPaths = [...paths].filter((entry) => /(^|\/)(\.scratch|test|proof|node_modules|CONTEXT\.md)(\/|$)/i.test(entry));
  for (const file of forbiddenPaths) issues.push({ code: "HIDDEN_SCAFFOLD_INCLUDED", path: file });
  for (const entry of entries) {
    const text = entry.bytes.toString("utf8");
    if (/ed25519-pkcs8:[A-Za-z0-9+/]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{32}|local-development-bootstrap-token/i.test(text)) {
      issues.push({ code: "SECRET_MATERIAL_INCLUDED", path: entry.path });
    }
    if (/\b(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/.test(text)) {
      issues.push({ code: "PROVIDER_CREDENTIAL_REQUIREMENT", path: entry.path });
    }
  }
  const compose = entries.find((entry) => entry.path === "compose.yaml")?.bytes.toString("utf8") ?? "";
  const postgresBlock = compose.match(/\n  postgres:\n([\s\S]*?)\n  kernel:\n/)?.[1] ?? "";
  if (/\n\s+ports:/.test(postgresBlock)) issues.push({ code: "DIRECT_DATABASE_HOST_PORT", path: "compose.yaml" });
  if (!compose.includes("POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?generated by installer}")) {
    issues.push({ code: "DATABASE_CREDENTIAL_NOT_GENERATED", path: "compose.yaml" });
  }
  if (!paths.has("release-spec.json") || !paths.has("OPERATOR.md") || !paths.has("install-local.ps1")) {
    issues.push({ code: "RELEASE_CONTROL_FILE_MISSING", path: "release" });
  }
  return { valid: issues.length === 0, issues };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(stableJson(value), null, 2)}\n`, "utf8");
}

export async function buildRelease(root, { outputDirectory = path.join(root, "dist"), write = false } = {}) {
  const payload = await collectReleaseEntries(root);
  const policy = validateReleaseEntries(payload);
  if (!policy.valid) throw new Error(`Release policy failed: ${JSON.stringify(policy.issues)}`);
  const spec = JSON.parse(payload.find((entry) => entry.path === "release-spec.json").bytes.toString("utf8"));
  const packageDocument = JSON.parse(payload.find((entry) => entry.path === "package.json").bytes.toString("utf8"));
  if (packageDocument.version !== spec.release_version
      || Object.values(packageDocument.dependencies ?? {}).some((version) => !/^\d+\.\d+\.\d+$/.test(version))) {
    throw new Error("Release package version and direct dependencies must be exact.");
  }
  const migrationNames = payload.filter((entry) => entry.path.startsWith("migrations/"))
    .map((entry) => path.posix.basename(entry.path));
  if (JSON.stringify(migrationNames) !== JSON.stringify(spec.migrations)) {
    throw new Error("Release spec must pin every migration in exact lexical order.");
  }
  const dockerfile = payload.find((entry) => entry.path === "Dockerfile").bytes.toString("utf8");
  const compose = payload.find((entry) => entry.path === "compose.yaml").bytes.toString("utf8");
  if (!dockerfile.includes(`FROM ${spec.base_images.node}`) || !compose.includes(`image: ${spec.base_images.postgres}`)) {
    throw new Error("Release base-image pins do not match build and composition inputs.");
  }
  if (spec.required_provider !== "none" || spec.aws_deployment_included !== false) {
    throw new Error("V0.1 release boundary must remain provider-independent and non-AWS.");
  }
  const payloadFiles = payload.map((entry) => ({ path: entry.path, size_bytes: entry.bytes.length,
    digest: digest(entry.bytes), mode: entry.mode.toString(8) }));
  const componentPins = Object.fromEntries(Object.entries(spec.components).map(([name, component]) => {
    const source = component.entrypoint ? payload.find((entry) => entry.path === component.entrypoint) : null;
    if (component.entrypoint && !source) throw new Error(`Pinned component entrypoint is missing: ${component.entrypoint}`);
    return [name, { ...component, ...(source ? { source_digest: digest(source.bytes) } : {}) }];
  }));
  const embeddedManifest = { schema_version: "alphonse.release_manifest.v0.1", release_version: RELEASE_VERSION,
    protocol_version: spec.protocol_version, base_images: spec.base_images, components: componentPins,
    payload_files: payloadFiles };
  const embeddedBytes = jsonBytes(embeddedManifest);
  const archiveEntries = [...payload, { path: "RELEASE-MANIFEST.json", bytes: embeddedBytes, mode: 0o644 }];
  const archive = createDeterministicTar(archiveEntries);
  const archiveDigest = digest(archive);
  const suffix = archiveDigest.slice("sha256:".length, "sha256:".length + 16);
  const archiveName = `alphonse-kernel-v${RELEASE_VERSION}-${suffix}.tar`;
  const manifest = { ...embeddedManifest, embedded_manifest_digest: digest(embeddedBytes),
    archive: { file: archiveName, size_bytes: archive.length, digest: archiveDigest,
      format: "ustar", normalized_text_line_endings: "lf", normalized_mtime: 0 } };
  const manifestBytes = jsonBytes(manifest);
  const manifestDigest = digest(manifestBytes);
  if (write) {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, archiveName), archive);
    await writeFile(path.join(outputDirectory, `alphonse-kernel-v${RELEASE_VERSION}-manifest.json`), manifestBytes);
    await writeFile(path.join(outputDirectory, `alphonse-kernel-v${RELEASE_VERSION}-manifest.sha256`),
      Buffer.from(`${manifestDigest.slice(7)}  alphonse-kernel-v${RELEASE_VERSION}-manifest.json\n`, "ascii"));
  }
  return { archive, archiveName, archiveDigest, manifest, manifestBytes, manifestDigest, policy };
}

export { digest as releaseDigest };
