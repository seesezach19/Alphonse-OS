"use strict";

const readline = require("node:readline");
const {
  caseProjection,
  dispatch,
  eventProjection,
  initialState,
  legalActions,
  validate
} = require("./state-model.cjs");

const SCENARIOS = {
  happy: [
    "receive_success_event",
    "report_failure",
    "confirm_failure_spec",
    "create_reproduction_bundle",
    "create_repair_task",
    "lease_repair_task",
    "submit_good_candidate",
    "verify_candidate",
    "authorize_promotion",
    "apply_promotion",
    "confirm_promotion"
  ],
  duplicate_event: [
    "receive_success_event",
    "receive_duplicate_event",
    "receive_conflicting_event"
  ],
  expired_worker: [
    "receive_success_event",
    "report_failure",
    "confirm_failure_spec",
    "create_reproduction_bundle",
    "create_repair_task",
    "lease_repair_task",
    "expire_repair_task",
    "stale_worker_submit",
    "create_repair_task",
    "lease_repair_task",
    "submit_good_candidate"
  ],
  failed_verification: [
    "receive_success_event",
    "report_failure",
    "confirm_failure_spec",
    "create_reproduction_bundle",
    "create_repair_task",
    "lease_repair_task",
    "submit_bad_candidate",
    "verify_candidate",
    "authorize_promotion"
  ],
  worker_self_promotion: [
    "receive_success_event",
    "report_failure",
    "confirm_failure_spec",
    "create_reproduction_bundle",
    "create_repair_task",
    "lease_repair_task",
    "submit_good_candidate",
    "verify_candidate",
    "worker_authorize_promotion"
  ],
  stale_target: [
    "receive_success_event",
    "report_failure",
    "confirm_failure_spec",
    "create_reproduction_bundle",
    "create_repair_task",
    "lease_repair_task",
    "submit_good_candidate",
    "verify_candidate",
    "change_target_revision",
    "authorize_promotion"
  ],
  uncertain_applied: [
    "receive_success_event",
    "report_failure",
    "confirm_failure_spec",
    "create_reproduction_bundle",
    "create_repair_task",
    "lease_repair_task",
    "submit_good_candidate",
    "verify_candidate",
    "authorize_promotion",
    "apply_promotion",
    "timeout_promotion_applied",
    "retry_uncertain_promotion",
    "reconcile_promotion"
  ],
  uncertain_not_applied: [
    "receive_success_event",
    "report_failure",
    "confirm_failure_spec",
    "create_reproduction_bundle",
    "create_repair_task",
    "lease_repair_task",
    "submit_good_candidate",
    "verify_candidate",
    "authorize_promotion",
    "apply_promotion",
    "timeout_promotion_not_applied",
    "retry_uncertain_promotion",
    "reconcile_promotion"
  ]
};

let state = initialState();

function view() {
  return {
    revision: state.revision,
    eventProjection: eventProjection(state),
    externalActivityIsKernelRun: false,
    caseProjection: caseProjection(state),
    workflow: state.workflow,
    case: state.case,
    repairTasks: state.repairTasks,
    candidates: state.candidates,
    verifications: state.verifications,
    promotions: state.promotions,
    artifacts: state.artifacts,
    lastResult: state.lastResult,
    invariants: validate(state),
    legalActions: legalActions(state),
    ledger: state.ledger
  };
}

function show() {
  process.stdout.write(`${JSON.stringify(view(), null, 2)}\n`);
}

function act(action) {
  state = dispatch(state, action);
  process.stdout.write(`\nACTION ${action}\n`);
  show();
}

function scenario(name) {
  const actions = SCENARIOS[name];
  if (!actions) {
    process.stdout.write(`Unknown scenario: ${name}\n`);
    return;
  }
  state = initialState();
  process.stdout.write(`\nSCENARIO ${name}\n`);
  for (const action of actions) act(action);
}

function help() {
  process.stdout.write([
    "Commands:",
    "  scenario <name>",
    `  scenarios: ${Object.keys(SCENARIOS).join(", ")}`,
    "  <action>",
    "  actions",
    "  reset",
    "  show",
    "  help",
    "  q",
    ""
  ].join("\n"));
}

const scenarioArg = process.argv[2];
if (scenarioArg) {
  scenario(scenarioArg);
  process.exit(validate(state).length ? 1 : 0);
}

process.stdout.write("THROWAWAY PROTOTYPE: Alphonse V0.2 debug-loop state model\n");
help();
show();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt("prototype> ");
rl.prompt();
rl.on("line", (line) => {
  const input = line.trim();
  if (input === "q" || input === "quit") return rl.close();
  if (input === "help") help();
  else if (input === "show") show();
  else if (input === "actions") process.stdout.write(`${legalActions(state).join("\n")}\n`);
  else if (input === "reset") {
    state = initialState();
    show();
  } else if (input.startsWith("scenario ")) scenario(input.slice("scenario ".length));
  else if (input) act(input);
  rl.prompt();
});

