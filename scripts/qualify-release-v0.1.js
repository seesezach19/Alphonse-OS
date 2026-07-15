import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRelease, releaseDigest } from "./release-bundle.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = "npm";
const suites = [
  ["unit", ["test"]],
  ["fresh_install", ["run", "test:ticket-17"]],
  ["kernel_blackbox", ["run", "test:blackbox"]],
  ["identity_intent", ["run", "test:ticket-02"]],
  ["governed_context", ["run", "test:ticket-03"]],
  ["package_publication", ["run", "test:ticket-04"]],
  ["deployment_authority", ["run", "test:ticket-05"]],
  ["runtime_handoff", ["run", "test:ticket-06"]],
  ["accountable_execution", ["run", "test:ticket-07"]],
  ["effect_dispatch", ["run", "test:ticket-08"]],
  ["uncertainty_recovery", ["run", "test:ticket-09"]],
  ["repeatability_rehearsal", ["run", "rehearse"]],
  ["portable_trust", ["run", "test:ticket-12"]],
  ["environment_promotion_and_outage", ["run", "test:ticket-13"]],
  ["user_space_upgrade", ["run", "test:ticket-14"]],
  ["backup_restore", ["run", "test:ticket-15"]],
  ["governed_support", ["run", "test:ticket-16"]]
];

const release = await buildRelease(root, { write: true });
async function qualificationPlanDigest() {
  const files = ["package.json"];
  for (const directory of ["scripts", "test/unit"]) {
    const names = await readdir(path.join(root, directory));
    files.push(...names.filter((name) => name.endsWith(".js")).map((name) => `${directory}/${name}`));
  }
  const chunks = [];
  for (const file of files.sort()) {
    const bytes = (await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n");
    chunks.push(`${file}\0${bytes}\0`);
  }
  return releaseDigest(Buffer.from(chunks.join(""), "utf8"));
}
const planDigest = await qualificationPlanDigest();
const output = path.join(root, "dist");
const checkpointPath = path.join(output, "alphonse-kernel-v0.1.0-qualification-checkpoint.json");
await mkdir(output, { recursive: true });
let results = [];
if (process.argv.includes("--resume")) {
  const checkpoint = await readFile(checkpointPath, "utf8").then((text) => JSON.parse(text)).catch(() => null);
  if (checkpoint?.release_archive_digest === release.archiveDigest
      && checkpoint?.qualification_plan_digest === planDigest && Array.isArray(checkpoint.suites)) {
    results = checkpoint.suites;
  }
}
for (const [name, args] of suites) {
  if (results.some((result) => result.name === name && result.status === "passed")) {
    console.log(`\n=== V0.1 qualification: ${name} (checkpoint passed) ===`);
    continue;
  }
  console.log(`\n=== V0.1 qualification: ${name} ===`);
  const completed = spawnSync(npm, args, { cwd: root, env: process.env,
    stdio: ["ignore", "inherit", "inherit"], timeout: 20 * 60_000, windowsHide: true,
    shell: process.platform === "win32" });
  if (completed.error) throw completed.error;
  if (completed.status !== 0) throw new Error(`Release qualification failed at ${name}.`);
  results.push({ name, command: ["npm", ...args].join(" "), status: "passed" });
  await writeFile(checkpointPath, `${JSON.stringify({ release_archive_digest: release.archiveDigest,
    qualification_plan_digest: planDigest, suites: results }, null, 2)}\n`, "utf8");
}

const evidence = {
  schema_version: "alphonse.release_qualification.v0.1",
  release_version: "0.1.0",
  release_archive_digest: release.archiveDigest,
  release_manifest_digest: release.manifestDigest,
  release_spec_digest: release.manifest.payload_files.find((item) => item.path === "release-spec.json").digest,
  qualification_plan_digest: planDigest,
  scope: "complete_local_non_aws",
  suites: results,
  assertions: {
    fresh_install_and_inventory_regression: true,
    stale_duplicate_uncertainty_recovery: true,
    handoff_and_accountability: true,
    pinned_run_migration_canary_and_repair: true,
    backup_restore_and_worker_fencing: true,
    temporary_support_and_coordinator_outage: true,
    aws_activity_performed: false
  }
};
const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
const evidenceDigest = releaseDigest(evidenceBytes);
const evidenceName = `alphonse-kernel-v0.1.0-evidence-${evidenceDigest.slice(7, 23)}.json`;
await writeFile(path.join(output, evidenceName), evidenceBytes);
await writeFile(path.join(output, "alphonse-kernel-v0.1.0-evidence.sha256"),
  `${evidenceDigest.slice(7)}  ${evidenceName}\n`, "ascii");
await rm(checkpointPath, { force: true });
console.log(JSON.stringify({ qualification: "passed", evidence: evidenceName,
  evidence_digest: evidenceDigest, suites: results.length }, null, 2));
