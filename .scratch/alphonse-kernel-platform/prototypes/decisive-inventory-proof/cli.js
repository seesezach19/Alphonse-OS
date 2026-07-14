"use strict";

const readline = require("node:readline");
const {
  createInitialState,
  deriveAccountability,
  dispatch,
  legalActions,
  validateInvariants
} = require("./state-machine");

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";

const scenarios = {
  happy: [
    "confirm_intent",
    "grant_fresh_context",
    "publish_package",
    "stage_deployment",
    "activate_capability",
    "request_handoff",
    "accept_handoff",
    "admit_envelope",
    "create_run",
    "start_workload",
    "admit_effect",
    "dispatch_effect",
    "confirm_effect",
    "submit_evidence",
    "close_accountability"
  ],
  uncertainty: [
    "confirm_intent",
    "grant_fresh_context",
    "publish_package",
    "stage_deployment",
    "activate_capability",
    "request_handoff",
    "accept_handoff",
    "admit_envelope",
    "create_run",
    "start_workload",
    "admit_effect",
    "dispatch_effect",
    "timeout_after_dispatch"
  ],
  not_applied: [
    "confirm_intent",
    "grant_fresh_context",
    "publish_package",
    "stage_deployment",
    "activate_capability",
    "request_handoff",
    "accept_handoff",
    "admit_envelope",
    "create_run",
    "start_workload",
    "admit_effect",
    "dispatch_effect",
    "timeout_after_dispatch",
    "reconcile_not_applied",
    "propose_corrective_work"
  ],
  stale: [
    "confirm_intent",
    "grant_fresh_context",
    "publish_package",
    "stage_deployment",
    "activate_capability",
    "request_handoff",
    "accept_handoff",
    "make_context_stale",
    "admit_envelope"
  ],
  duplicate: [
    "confirm_intent",
    "grant_fresh_context",
    "publish_package",
    "stage_deployment",
    "activate_capability",
    "request_handoff",
    "accept_handoff",
    "admit_envelope",
    "create_run",
    "start_workload",
    "admit_effect",
    "dispatch_effect",
    "dispatch_effect"
  ]
};

let state = createInitialState();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function line(label, value) {
  return "  " + bold + label.padEnd(16) + reset + String(value);
}

function render() {
  console.clear();
  const accountability = deriveAccountability(state);
  const violations = validateInvariants(state);
  const statusColor = state.lastResult.status === "accepted"
    ? green
    : state.lastResult.status === "rejected"
      ? red
      : yellow;

  console.log(bold + "THROWAWAY PROTOTYPE - Decisive Inventory Proof" + reset);
  console.log(dim + "Question: does the cross-lifecycle state model reject unsafe shortcuts while preserving uncertainty and accountability?" + reset);
  console.log("");
  console.log(bold + "Construction / authority" + reset);
  console.log(line("Work Intent", state.workIntent));
  console.log(line("Context", state.context));
  console.log(line("Package", state.packageVersion));
  console.log(line("Deployment", state.deployment));
  console.log(line("Capability", state.capability));
  console.log(line("Runtime", state.runtime));
  console.log(line("Handoff", state.handoff));
  console.log("");
  console.log(bold + "Execution / accountability" + reset);
  console.log(line("Envelope", state.envelope));
  console.log(line("Run", state.run));
  console.log(line("Workload", state.workload));
  console.log(line("Effect", state.effect));
  console.log(line("Evidence", state.evidence));
  console.log(line("Obligation", state.obligation));
  console.log(line("Accountability", accountability));
  console.log(line("Recovery", state.recovery));
  console.log(line("Corrective work", state.correctiveWork));
  console.log(line("Revision", state.revision));
  console.log("");
  console.log(bold + "Last result" + reset);
  console.log("  " + statusColor + state.lastResult.status.toUpperCase() + reset +
    " " + state.lastResult.action + " - " + state.lastResult.reason);
  console.log("");
  console.log(bold + "Invariant check" + reset);
  console.log(violations.length === 0
    ? "  " + green + "PASS" + reset
    : "  " + red + violations.join("; ") + reset);
  console.log("");
  console.log(bold + "Recent accepted transitions" + reset);
  const recent = state.ledger.slice(-5);
  if (recent.length === 0) console.log("  " + dim + "none" + reset);
  for (const entry of recent) {
    console.log("  r" + entry.revision + " " + entry.action +
      "  " + dim + "run=" + entry.run + " effect=" + entry.effect +
      " accountability=" + entry.accountability + reset);
  }
  console.log("");
  console.log(bold + "Legal next actions" + reset);
  console.log("  " + legalActions(state).map((item) => item.name).join(", "));
  console.log("");
  console.log(dim + "Enter action name, scenario happy|uncertainty|not_applied|stale|duplicate, reset, help, or q." + reset);
}

function runScenario(name) {
  const actions = scenarios[name];
  if (!actions) {
    state.lastResult = {
      status: "rejected",
      action: "scenario " + name,
      reason: "Unknown scenario"
    };
    return;
  }

  state = createInitialState();
  for (const action of actions) state = dispatch(state, action);
}

function showHelp() {
  console.clear();
  console.log(bold + "Commands" + reset);
  console.log("");
  console.log("  Type any action name shown under Legal next actions.");
  console.log("  Type a known but currently illegal action to verify rejection.");
  console.log("  scenario happy        Complete confirmed Effect and accountability.");
  console.log("  scenario uncertainty  Stop at timeout-after-dispatch Recovery Case.");
  console.log("  scenario not_applied  Reconcile failure and propose governed corrective work.");
  console.log("  scenario stale        Attempt admission with stale context.");
  console.log("  scenario duplicate    Attempt duplicate Effect dispatch.");
  console.log("  reset                  Return to initial state.");
  console.log("  q                      Quit.");
  console.log("");
}

function prompt() {
  render();
  rl.question("> ", (input) => {
    const command = input.trim();
    if (command === "q" || command === "quit") {
      rl.close();
      return;
    }
    if (command === "reset") {
      state = createInitialState();
    } else if (command === "help") {
      showHelp();
    } else if (command.startsWith("scenario ")) {
      runScenario(command.slice("scenario ".length).trim());
    } else if (command) {
      state = dispatch(state, command);
    }
    prompt();
  });
}

rl.on("close", () => {
  console.log("\nPrototype closed. State was in-memory only.");
});

prompt();
