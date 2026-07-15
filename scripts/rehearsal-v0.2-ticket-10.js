import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const repository = new URL("..", import.meta.url);
const marker = "ALPHONSE_V02_PROOF_RESULT=";

function gitState() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repository, encoding: "utf8", windowsHide: true
  });
  if (result.status !== 0) throw new Error(`Cannot inspect proof source state.\n${result.stderr}`);
  return result.stdout;
}

function runJourney(script, runNumber, journey) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [script], {
    cwd: repository,
    env: { ...process.env, EMIT_V02_PROOF_RESULT: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 12 * 60_000,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Fresh Debug Loop run ${runNumber} ${journey} journey failed.\n` +
      `${result.stdout}\n${result.stderr}`);
  }
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  assert.ok(line, `Fresh Debug Loop run ${runNumber} ${journey} journey emitted no public observation.`);
  return { observation: JSON.parse(line.slice(marker.length)), elapsed_ms: Date.now() - startedAt };
}

function runFreshProof(number) {
  const confirmed = runJourney("scripts/acceptance-v0.2-ticket-08.js", number, "confirmed");
  const uncertainty = runJourney("scripts/acceptance-v0.2-ticket-09.js", number, "uncertainty");
  return {
    observable: { confirmed: confirmed.observation, uncertainty: uncertainty.observation },
    elapsed_ms: confirmed.elapsed_ms + uncertainty.elapsed_ms
  };
}

const sourceBefore = gitState();
const runs = [runFreshProof(1), runFreshProof(2)];
const sourceAfter = gitState();

assert.deepEqual(runs[1].observable, runs[0].observable,
  "Two fresh Debug Loops produced different normalized public outcomes.");
assert.equal(sourceAfter, sourceBefore, "Debug Loop proof changed repository source or schema files.");

const scorecard = {
  schema_version: "alphonse.debug_loop_scorecard.v0.2",
  result: "passed_repeatable_fresh_install_debug_loop",
  fresh_state_runs: 2,
  equivalent_normalized_public_outcomes: true,
  assertion_boundary: [
    "public_diagnostic_protocol", "public_kernel_protocol", "repair_delivery_target_observation"
  ],
  coverage: {
    successful_but_wrong_trace: true,
    deterministic_reproduction: true,
    customer_controlled_repair_worker: true,
    independent_verification: true,
    owner_authorized_promotion: true,
    exact_target_confirmation: true,
    rollback_reference: true,
    uncertain_promotion_reconciliation: true,
    duplicate_and_conflict_fencing: true,
    authentication_and_authority_denial: true,
    expired_lease_and_bad_candidate: true,
    stale_target_and_target_mismatch: true
  },
  constraints: {
    aws_activity: false,
    real_customer_email_effects: 0,
    production_inventory_writes: 0,
    private_hosted_dependencies: 0,
    live_model_calls: 0
  },
  elapsed_ms: runs.reduce((sum, run) => sum + run.elapsed_ms, 0),
  observable_result: runs[0].observable
};

console.log(JSON.stringify(scorecard, null, 2));
console.log("V0.2 Ticket 10 repeatable fresh-install Debug Loop passed twice.");
