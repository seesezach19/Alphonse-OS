import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildV02Release, releaseDigest } from "./release-bundle-v0.2.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suites = [
  ["v0.2_release_policy", ["run", "release:v0.2:build"]],
  ["v0.2_clean_extraction", ["run", "test:v0.2-ticket-11"]],
  ["v0.2_repeatable_debug_loop", ["run", "rehearse:v0.2"]],
  ["v0.1_complete_release_qualification", ["run", "release:qualify", "--", "--resume"]]
];

const release = await buildV02Release(root, { write: true });

async function qualificationPlanDigest() {
  const files = ["package.json"];
  for (const directory of ["scripts", "test/unit", "release/v0.2.0"]) {
    async function walk(relative) {
      const entries = await readdir(path.join(root, relative), { withFileTypes: true });
      for (const entry of entries) {
        const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile()) files.push(child);
      }
    }
    await walk(directory);
  }
  const chunks = [];
  for (const file of [...new Set(files)].sort()) {
    const bytes = (await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n");
    chunks.push(`${file}\0${bytes}\0`);
  }
  return releaseDigest(Buffer.from(chunks.join(""), "utf8"));
}

const planDigest = await qualificationPlanDigest();
const output = path.join(root, "dist");
const checkpointPath = path.join(output, "alphonse-v0.2.0-qualification-checkpoint.json");
await mkdir(output, { recursive: true });
let results = [];
if (process.argv.includes("--resume")) {
  const checkpoint = await readFile(checkpointPath, "utf8").then(JSON.parse).catch(() => null);
  if (checkpoint?.release_archive_digest === release.archiveDigest
      && checkpoint?.qualification_plan_digest === planDigest && Array.isArray(checkpoint.suites)) {
    results = checkpoint.suites;
  }
}

for (const [name, args] of suites) {
  if (results.some((result) => result.name === name && result.status === "passed")) {
    console.log(`\n=== V0.2 qualification: ${name} (checkpoint passed) ===`);
    continue;
  }
  console.log(`\n=== V0.2 qualification: ${name} ===`);
  const completed = spawnSync("npm", args, {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 35 * 60_000,
    windowsHide: true,
    shell: process.platform === "win32"
  });
  if (completed.error) throw completed.error;
  if (completed.status !== 0) throw new Error(`V0.2 release qualification failed at ${name}.`);
  results.push({ name, command: ["npm", ...args].join(" "), status: "passed" });
  await writeFile(checkpointPath, `${JSON.stringify({
    release_archive_digest: release.archiveDigest,
    qualification_plan_digest: planDigest,
    suites: results
  }, null, 2)}\n`, "utf8");
}

const v01EvidenceLine = await readFile(path.join(output, "alphonse-kernel-v0.1.0-evidence.sha256"), "ascii");
const v01EvidenceDigest = `sha256:${v01EvidenceLine.trim().split(/\s+/)[0]}`;
const evidence = {
  schema_version: "alphonse.release_qualification.v0.2",
  release_version: "0.2.0",
  release_archive_digest: release.archiveDigest,
  release_manifest_digest: release.manifestDigest,
  release_spec_digest: release.manifest.payload_files.find((item) => item.path === "release-spec.json").digest,
  qualification_plan_digest: planDigest,
  "v0.1_qualification_evidence_digest": v01EvidenceDigest,
  scope: "complete_customer_controlled_local_non_aws",
  suites: results,
  assertions: {
    clean_extraction_and_generated_credentials: true,
    pinned_headless_debug_loop_components: true,
    happy_duplicate_conflict_expiry_verification_and_stale_target: true,
    uncertain_promotion_reconciliation_and_rollback: true,
    "complete_v0.1_regression": true,
    n8n_customer_owned_and_not_redistributed: true,
    provider_credentials_included: false,
    managed_cloud_required: false,
    aws_activity_performed: false
  }
};
const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
const evidenceDigest = releaseDigest(evidenceBytes);
const evidenceName = `alphonse-v0.2.0-evidence-${evidenceDigest.slice(7, 23)}.json`;
await writeFile(path.join(output, evidenceName), evidenceBytes);
await writeFile(path.join(output, "alphonse-v0.2.0-evidence.sha256"),
  `${evidenceDigest.slice(7)}  ${evidenceName}\n`, "ascii");
await rm(checkpointPath, { force: true });

console.log(JSON.stringify({
  qualification: "passed",
  evidence: evidenceName,
  evidence_digest: evidenceDigest,
  suites: results.length,
  aws_activity: false
}, null, 2));
