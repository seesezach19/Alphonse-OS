import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pilotDigest, validatePilotPlan } from "../pilot/v0.2.0/pilot-contract.js";
import { createDeterministicTar } from "./release-bundle.js";
import { releaseDigest } from "./release-bundle-v0.2.js";

const PILOT_VERSION = "0.2.0";
const FILES = {
  "pilot/v0.2.0/START-HERE.md": "START-HERE.md",
  "release/v0.2.0/OPERATOR.md": "RELEASE-OPERATOR.md",
  "pilot/v0.2.0/WORKFLOW-SELECTION.md": "WORKFLOW-SELECTION.md",
  "pilot/v0.2.0/PILOT-AGREEMENT.md": "PILOT-AGREEMENT.md",
  "pilot/v0.2.0/pilot-plan.json": "pilot-plan.json",
  "pilot/v0.2.0/pilot-evidence.template.json": "pilot-evidence.template.json",
  "pilot/v0.2.0/assurance-receipt.sample.json": "assurance-receipt.sample.json"
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(stable(value), null, 2)}\n`, "utf8");
}

function normalize(bytes) {
  return Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}

export function validatePilotPacketEntries(entries, plan) {
  const issues = [];
  const paths = entries.map((entry) => entry.path);
  const expected = [...plan.release.public_materials].sort();
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(expected)) {
    issues.push({ code: "PILOT_PUBLIC_MATERIALS_MISMATCH", path: "packet",
      message: "Packet contents must exactly match the plan's public material allowlist." });
  }
  for (const entry of entries) {
    const content = entry.bytes.toString("utf8");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:Bearer|Owner|Operator)\s+[A-Za-z0-9+/=_-]{16,}|\bxox[baprs]-[A-Za-z0-9-]{10,}/i.test(content)) {
      issues.push({ code: "PILOT_SECRET_MATERIAL_INCLUDED", path: entry.path,
        message: "Public pilot materials may contain credential references, never credential values." });
    }
  }
  return { valid: issues.length === 0, issues };
}

export async function buildPilotPacket(root, {
  outputDirectory = path.join(root, "dist"),
  write = false
} = {}) {
  const entries = [];
  for (const [source, target] of Object.entries(FILES)) {
    entries.push({ path: target, bytes: normalize(await readFile(path.join(root, source))), mode: 0o644 });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const plan = JSON.parse(entries.find((entry) => entry.path === "pilot-plan.json").bytes.toString("utf8"));
  const planValidation = validatePilotPlan(plan);
  if (!planValidation.valid) {
    throw new Error(`Pilot plan failed closed-contract validation: ${JSON.stringify(planValidation.issues)}`);
  }
  const policy = validatePilotPacketEntries(entries, plan);
  if (!policy.valid) throw new Error(`Pilot packet policy failed: ${JSON.stringify(policy.issues)}`);

  const embeddedManifest = {
    schema_version: "alphonse.design_partner_pilot_packet_manifest.v0.2",
    pilot_version: PILOT_VERSION,
    plan_digest: pilotDigest(plan),
    release: plan.release,
    payload_files: entries.map((entry) => ({
      path: entry.path,
      size_bytes: entry.bytes.length,
      digest: releaseDigest(entry.bytes),
      mode: entry.mode.toString(8)
    }))
  };
  const embeddedBytes = jsonBytes(embeddedManifest);
  const archive = createDeterministicTar([
    ...entries,
    { path: "PILOT-PACKET-MANIFEST.json", bytes: embeddedBytes, mode: 0o644 }
  ]);
  const archiveDigest = releaseDigest(archive);
  const archiveName = `alphonse-v${PILOT_VERSION}-pilot-packet-${archiveDigest.slice(7, 23)}.tar`;
  const manifest = {
    ...embeddedManifest,
    embedded_manifest_digest: releaseDigest(embeddedBytes),
    archive: {
      file: archiveName,
      size_bytes: archive.length,
      digest: archiveDigest,
      format: "ustar",
      normalized_text_line_endings: "lf",
      normalized_mtime: 0
    }
  };
  const manifestBytes = jsonBytes(manifest);
  const manifestDigest = releaseDigest(manifestBytes);
  if (write) {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, archiveName), archive);
    await writeFile(path.join(outputDirectory, `alphonse-v${PILOT_VERSION}-pilot-packet-manifest.json`), manifestBytes);
    await writeFile(path.join(outputDirectory, `alphonse-v${PILOT_VERSION}-pilot-packet-manifest.sha256`),
      Buffer.from(`${manifestDigest.slice(7)}  alphonse-v${PILOT_VERSION}-pilot-packet-manifest.json\n`, "ascii"));
  }
  return { archive, archiveName, archiveDigest, entries, manifest, manifestBytes, manifestDigest, plan, policy };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const root = path.resolve(path.dirname(scriptPath), "..");
  const result = await buildPilotPacket(root, { write: true });
  console.log(JSON.stringify({
    schema_version: result.manifest.schema_version,
    packet_prepared: true,
    qualified: false,
    archive: result.archiveName,
    archive_digest: result.archiveDigest,
    manifest_digest: result.manifestDigest,
    plan_digest: result.manifest.plan_digest,
    payload_files: result.manifest.payload_files.length,
    release_archive_digest: result.plan.release.archive_digest,
    external_gate: result.plan.external_gate
  }, null, 2));
}
