import readline from "node:readline";
import {
  createState,
  nextHappyAction,
  prototypeReport,
  retentionReadiness,
  transition
} from "./model.js";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const cyan = "\x1b[36m";
const reset = "\x1b[0m";

let state = createState();

const keyActions = {
  n: () => nextHappyAction(state),
  s: () => "seal_manifest",
  d: () => "send_stimulus",
  o: () => "accept_observations",
  t: () => "set_retention_short",
  y: () => "set_retention_valid",
  m: () => "omit_prefix_position",
  v: () => "verify_prefix",
  f: () => "restore_prefix",
  r: () => "request_observation_revocation",
  a: () => "apply_observation_revocation",
  p: () => "probe_reporting"
};

function bool(value) {
  return value ? `${green}yes${reset}` : `${dim}no${reset}`;
}

function render() {
  const retention = retentionReadiness(state);
  const resultColor = state.lastResult.ok ? green : red;
  console.clear();
  console.log(`${bold}${cyan}Canonical Diagnostic Proof${reset}  ${dim}THROWAWAY LOGIC PROTOTYPE${reset}`);
  console.log(`${dim}Question: can deterministic evidence construction reach an unclaimed assignment safely?${reset}\n`);
  console.log(`${bold}Authority${reset}`);
  console.log(`  readiness bound       ${bool(state.authority.readinessBound)}`);
  console.log(`  snapshots published   ${bool(state.authority.desiredSnapshotsPublished)}`);
  console.log(`  observation applied   ${bool(state.authority.observationApplied)}`);
  console.log(`  tokenization applied  ${bool(state.authority.tokenizationApplied)}`);
  console.log(`  Kernel effective      ${bool(state.authority.kernelEffective)}`);
  console.log(`  manifest sealed       ${bool(state.authority.manifestSealed)}`);
  console.log(`  revocation pending    ${bool(state.authority.revocationPending)}`);
  console.log(`  observation revoked   ${bool(state.authority.observationRevokedEffective)}`);
  console.log(`\n${bold}Evidence${reset}`);
  console.log(`  stimulus deliveries   ${state.stimulus.deliveries}`);
  console.log(`  token receipts        ${state.tokenization.receipts.length}/4`);
  console.log(`  committed positions   ${state.intake.outcomes.length}${state.intake.cutoff ? ` (cutoff ${state.intake.cutoff})` : ""}`);
  console.log(`  verifier positions    [${state.verification.bundlePositions.join(", ")}]`);
  console.log(`  verifier status       ${state.verification.status}`);
  console.log(`\n${bold}Pipeline${reset}`);
  console.log(`  correlation           ${state.pipeline.correlation}`);
  console.log(`  effects               ${state.pipeline.effects}`);
  console.log(`  evaluation            ${state.pipeline.evaluation}`);
  console.log(`  trigger / lease       ${state.pipeline.trigger} / ${state.pipeline.collectionLease ? "active" : "none"}`);
  console.log(`  package               ${state.pipeline.package}`);
  console.log(`  assignment            ${state.pipeline.assignment}`);
  console.log(`\n${bold}Retention${reset}`);
  console.log(`  ordinary              ${state.retention.ordinaryConfigured}/${retention.ordinaryMinimum}`);
  console.log(`  collection lease      ${state.retention.collectionLeaseConfigured}/${retention.collectionMinimum}`);
  console.log(`  readiness             ${retention.ready ? `${green}pass${reset}` : `${red}fail${reset}`}`);
  console.log(`\n${bold}Last transition${reset}`);
  console.log(`  ${resultColor}${state.lastResult.ok ? "ACCEPTED" : "REJECTED"}${reset} ${state.lastResult.action}: ${state.lastResult.message}`);
  console.log(`  ${dim}next valid: ${nextHappyAction(state) ?? "proof complete"}; reporting probe: ${state.reportingProbe}${reset}`);
  console.log(`\n${bold}Drive${reset}`);
  console.log(`  ${bold}[n]${reset} next valid  ${bold}[s]${reset} seal early  ${bold}[d]${reset} stimulus early  ${bold}[o]${reset} observations early`);
  console.log(`  ${bold}[t]${reset} short retention  ${bold}[y]${reset} valid retention  ${bold}[m]${reset} omit prefix  ${bold}[f]${reset} restore prefix`);
  console.log(`  ${bold}[v]${reset} verify prefix  ${bold}[r]${reset} request revoke  ${bold}[a]${reset} apply revoke  ${bold}[p]${reset} probe report`);
  console.log(`  ${bold}[x]${reset} reset  ${bold}[q]${reset} quit`);
}

function runDemo() {
  const actions = [
    "seal_manifest",
    "complete_readiness",
    "publish_grants",
    "record_effective",
    "apply_observation_grant",
    "apply_tokenization_grant",
    "record_effective",
    "set_retention_short",
    "seal_manifest",
    "set_retention_valid",
    "seal_manifest",
    "send_stimulus",
    "accept_observations",
    "preserve_token_receipts",
    "accept_observations",
    "project_correlation",
    "interpret_effects",
    "evaluate_behavior",
    "create_trigger",
    "freeze_package",
    "create_assignment",
    "omit_prefix_position",
    "verify_prefix",
    "restore_prefix",
    "verify_prefix",
    "request_observation_revocation",
    "probe_reporting",
    "apply_observation_revocation",
    "probe_reporting"
  ];
  const transitions = [];
  for (const action of actions) {
    state = transition(state, action);
    transitions.push(state.lastResult);
  }
  const probes = Object.fromEntries([
    ["early_seal", transitions[0]],
    ["effective_before_application", transitions[3]],
    ["seal_with_short_retention", transitions[8]],
    ["observation_before_token_receipts", transitions[12]],
    ["verification_with_omitted_position", transitions[22]],
    ["report_while_revocation_pending", transitions[26]],
    ["report_after_revocation_application", transitions[28]]
  ]);
  console.log(JSON.stringify({ report: prototypeReport(state), probes }, null, 2));
}

if (process.argv.includes("--demo")) {
  runDemo();
  process.exit(0);
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
render();
process.stdin.on("keypress", (_value, key) => {
  if (key?.name === "q" || (key?.ctrl && key.name === "c")) process.exit(0);
  if (key?.name === "x") state = createState();
  else {
    const action = keyActions[key?.name]?.();
    if (action) state = transition(state, action);
  }
  render();
});
