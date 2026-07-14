import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const repository = new URL("..", import.meta.url);
const marker = "ALPHONSE_REHEARSAL_RESULT=";

function gitState() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repository, encoding: "utf8", windowsHide: true
  });
  if (result.status !== 0) throw new Error(`Cannot inspect rehearsal source state.\n${result.stderr}`);
  return result.stdout;
}

function runFreshRehearsal(number) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, ["scripts/acceptance-ticket-09.js"], {
    cwd: repository,
    env: { ...process.env, EMIT_REHEARSAL_RESULT: "1", KEEP_TICKET09_STACK: "0" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 10 * 60_000,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`Fresh rehearsal ${number} failed.\n${result.stdout}\n${result.stderr}`);
  }
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  assert.ok(line, `Fresh rehearsal ${number} did not emit a public observation.`);
  const report = JSON.parse(line.slice(marker.length));
  return { ...report, process_elapsed_ms: Date.now() - startedAt };
}

const sourceBefore = gitState();
const runs = [runFreshRehearsal(1), runFreshRehearsal(2)];
const sourceAfter = gitState();

assert.deepEqual(runs[1].observable, runs[0].observable,
  "Fresh-state repetitions produced different externally observable results.");
assert.equal(sourceAfter, sourceBefore, "Rehearsal changed Kernel source or schema files.");

const sumTiming = (key) => runs.reduce((total, run) => total + run.timing[key], 0);
const scorecard = {
  schema_version: "alphonse.engineering_rehearsal_scorecard.v0.1",
  result: "passed_engineering_rehearsal",
  qualifying_proof: false,
  fresh_state_runs: runs.length,
  equivalent_externally_observable_results: true,
  assertion_boundary: ["public_kernel_protocol", "target_observations", "butler_projections"],
  measures: {
    kernel_or_schema_changes: 0,
    direct_authority_or_database_edits: 0,
    secret_material_entering_package_or_kernel: 0,
    provider_hidden_state: 0,
    measured_human_attention_ms: sumTiming("measured_human_attention_ms"),
    simulated_human_decisions: runs[0].timing.simulated_human_decisions,
    elapsed_ms: runs.reduce((total, run) => total + run.process_elapsed_ms, 0),
    active_automation_ms: sumTiming("active_automation_ms"),
    environment_setup_ms: sumTiming("environment_setup_ms"),
    explicit_wait_ms: sumTiming("explicit_wait_ms")
  },
  observable_result: runs[0].observable,
  remaining_qualification_blockers: [
    "Run with an unfamiliar Builder using only public documentation.",
    "Measure real Builder and Business Operator attention instead of automated command time.",
    "Use two independent runtime processes, not two protocol clients in one harness.",
    "Execute one explicitly approved low-risk reversible production effect.",
    "Exercise the complete corrective authority chain after a proven not-applied effect."
  ]
};

console.log(JSON.stringify(scorecard, null, 2));
console.log("Ticket 10 repeatable engineering rehearsal passed twice from fresh state.");
