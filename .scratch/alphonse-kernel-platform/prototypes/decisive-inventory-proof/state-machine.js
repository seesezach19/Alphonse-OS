"use strict";

const ACTIONS = {
  confirm_intent: {
    description: "Confirm the proposed Work Intent",
    guard: (s) => s.workIntent === "proposed" ? null : "Work Intent is not proposed",
    apply: (s) => { s.workIntent = "confirmed"; }
  },
  grant_fresh_context: {
    description: "Grant fresh ERP/storefront context",
    guard: (s) => s.workIntent === "confirmed" && s.context !== "fresh"
      ? null
      : "Confirmed Work Intent required and context must not already be fresh",
    apply: (s) => { s.context = "fresh"; }
  },
  make_context_stale: {
    description: "Expire the current context",
    guard: (s) => s.context === "fresh" ? null : "Only fresh context can become stale",
    apply: (s) => { s.context = "stale"; }
  },
  publish_package: {
    description: "Publish the immutable inventory Package",
    guard: (s) => s.workIntent === "confirmed" && s.context === "fresh" && s.packageVersion === "draft"
      ? null
      : "Confirmed intent, fresh context, and draft Package required",
    apply: (s) => { s.packageVersion = "published"; }
  },
  stage_deployment: {
    description: "Create the staged Deployment",
    guard: (s) => s.packageVersion === "published" && s.deployment === "none"
      ? null
      : "Published Package and no existing Deployment required",
    apply: (s) => { s.deployment = "staged"; }
  },
  activate_capability: {
    description: "Approve and activate the exact correction Capability",
    guard: (s) => s.deployment === "staged" && s.capability === "inactive"
      ? null
      : "Staged Deployment and inactive Capability required",
    apply: (s) => { s.capability = "active"; }
  },
  request_handoff: {
    description: "Request handoff from Builder Agent to Runtime B",
    guard: (s) => s.capability === "active" && s.handoff === "none"
      ? null
      : "Active Capability and no existing handoff required",
    apply: (s) => { s.handoff = "pending"; }
  },
  accept_handoff: {
    description: "Runtime B accepts exact structured handoff",
    guard: (s) => s.handoff === "pending" ? null : "Pending handoff required",
    apply: (s) => {
      s.handoff = "accepted";
      s.runtime = "runtime-b";
    }
  },
  admit_envelope: {
    description: "Admit one exact Execution Envelope",
    guard: (s) => {
      if (s.runtime !== "runtime-b" || s.handoff !== "accepted") return "Accepted runtime handoff required";
      if (s.capability !== "active") return "Active Capability required";
      if (s.context !== "fresh") return "Fresh context required";
      if (s.envelope !== "none") return "Envelope already exists";
      return null;
    },
    apply: (s) => { s.envelope = "admitted"; }
  },
  create_run: {
    description: "Consume Envelope into one Run and Obligation",
    guard: (s) => s.envelope === "admitted" && s.run === "none"
      ? null
      : "One admitted unconsumed Envelope required",
    apply: (s) => {
      s.envelope = "consumed";
      s.run = "created";
      s.obligation = "open";
    }
  },
  start_workload: {
    description: "Launch the bounded Linux workload",
    guard: (s) => s.run === "created" && s.workload === "none"
      ? null
      : "Created Run and no workload required",
    apply: (s) => {
      s.run = "running";
      s.workload = "running";
    }
  },
  admit_effect: {
    description: "Admit exact storefront correction Effect",
    guard: (s) => {
      if (s.run !== "running" || s.workload !== "running") return "Running Run/workload required";
      if (s.context !== "fresh") return "Fresh context required at Effect gate";
      if (s.effect !== "none") return "Effect already exists";
      return null;
    },
    apply: (s) => { s.effect = "admitted"; }
  },
  dispatch_effect: {
    description: "Dispatch using one-use Permit",
    guard: (s) => {
      if (s.effect !== "admitted") return "Exactly one admitted Effect required";
      if (s.workload !== "running") return "Live workload required";
      if (s.context !== "fresh") return "Fresh context required immediately before dispatch";
      return null;
    },
    apply: (s) => { s.effect = "dispatched"; }
  },
  confirm_effect: {
    description: "Verify storefront correction applied",
    guard: (s) => s.effect === "dispatched" ? null : "Dispatched Effect required",
    apply: (s) => { s.effect = "confirmed"; }
  },
  timeout_after_dispatch: {
    description: "Inject timeout after dispatch",
    guard: (s) => s.effect === "dispatched" ? null : "Dispatched Effect required",
    apply: (s) => {
      s.effect = "uncertain";
      s.run = "uncertain";
      s.recovery = "open";
      s.workload = "lost";
    }
  },
  reconcile_applied: {
    description: "Reconcile that uncertain Effect was applied",
    guard: (s) => s.effect === "uncertain" && s.recovery === "open"
      ? null
      : "Open recovery for uncertain Effect required",
    apply: (s) => {
      s.effect = "reconciled_confirmed";
      s.run = "reconciled_success";
      s.recovery = "recovered";
    }
  },
  reconcile_not_applied: {
    description: "Reconcile that uncertain Effect was not applied",
    guard: (s) => s.effect === "uncertain" && s.recovery === "open"
      ? null
      : "Open recovery for uncertain Effect required",
    apply: (s) => {
      s.effect = "reconciled_not_applied";
      s.run = "reconciled_failure";
      s.recovery = "corrective_work_required";
      s.obligation = "breached";
    }
  },
  propose_corrective_work: {
    description: "Propose a new governed Work Intent for corrective work",
    guard: (s) => s.recovery === "corrective_work_required" && s.correctiveWork === "none"
      ? null
      : "Reconciled failure requiring corrective work is required",
    apply: (s) => { s.correctiveWork = "proposed"; }
  },
  submit_evidence: {
    description: "Submit verification evidence",
    guard: (s) => ["confirmed", "reconciled_confirmed"].includes(s.effect) && s.evidence === "missing"
      ? null
      : "Confirmed or reconciled-confirmed Effect with missing evidence required",
    apply: (s) => { s.evidence = "present"; }
  },
  close_accountability: {
    description: "Satisfy the completion Obligation",
    guard: (s) => {
      if (s.evidence !== "present") return "Verification evidence required";
      if (!["confirmed", "reconciled_confirmed"].includes(s.effect)) return "Confirmed Effect required";
      if (s.obligation !== "open") return "Open Obligation required";
      return null;
    },
    apply: (s) => {
      if (s.run === "running") s.run = "succeeded";
      s.obligation = "satisfied";
      s.workload = s.workload === "running" ? "completed" : s.workload;
    }
  },
  cancel_workload: {
    description: "Cancel before possible external dispatch",
    guard: (s) => s.run === "running" && ["none", "admitted"].includes(s.effect)
      ? null
      : "Running work with no possible dispatched Effect required",
    apply: (s) => {
      if (s.effect === "admitted") s.effect = "rejected";
      s.run = "cancelled";
      s.workload = "cancelled";
      s.obligation = "breached";
    }
  }
};

function createInitialState() {
  return {
    revision: 0,
    workIntent: "proposed",
    context: "unavailable",
    packageVersion: "draft",
    deployment: "none",
    capability: "inactive",
    runtime: "builder-agent",
    handoff: "none",
    envelope: "none",
    run: "none",
    workload: "none",
    effect: "none",
    evidence: "missing",
    obligation: "none",
    recovery: "none",
    correctiveWork: "none",
    lastResult: {
      status: "ready",
      action: "none",
      reason: "Choose a transition or scenario"
    },
    ledger: []
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function deriveAccountability(state) {
  if (["open", "corrective_work_required"].includes(state.recovery)) return "recovery_open";
  if (state.obligation === "satisfied") return "satisfied";
  if (state.obligation === "breached") return "breached";
  if (state.obligation === "open") return "open";
  return "not_started";
}

function validateInvariants(state) {
  const violations = [];

  if (state.capability === "active" && state.deployment !== "staged") {
    violations.push("Active Capability requires staged Deployment");
  }
  if (state.run !== "none" && state.envelope !== "consumed") {
    violations.push("Run requires consumed Envelope");
  }
  if (state.effect !== "none" && state.run === "none") {
    violations.push("Effect requires Run");
  }
  if (deriveAccountability(state) === "satisfied" &&
      (state.evidence !== "present" || !["confirmed", "reconciled_confirmed"].includes(state.effect))) {
    violations.push("Satisfied accountability requires evidence and confirmed Effect");
  }
  if (state.effect === "uncertain" && state.recovery !== "open") {
    violations.push("Uncertain Effect requires open Recovery Case");
  }
  if (state.effect === "reconciled_not_applied" &&
      state.recovery !== "corrective_work_required") {
    violations.push("Reconciled non-application requires corrective-work recovery state");
  }
  if (state.runtime === "runtime-b" && state.handoff !== "accepted") {
    violations.push("Runtime B requires accepted handoff");
  }

  return violations;
}

function legalActions(state) {
  return Object.entries(ACTIONS)
    .filter(([, transition]) => transition.guard(state) === null)
    .map(([name, transition]) => ({ name, description: transition.description }));
}

function dispatch(state, action) {
  const transition = ACTIONS[action];
  if (!transition) {
    const rejected = cloneState(state);
    rejected.lastResult = {
      status: "rejected",
      action,
      reason: "Unknown action"
    };
    return rejected;
  }

  const reason = transition.guard(state);
  if (reason) {
    const rejected = cloneState(state);
    rejected.lastResult = {
      status: "rejected",
      action,
      reason
    };
    return rejected;
  }

  const next = cloneState(state);
  transition.apply(next);
  next.revision += 1;
  next.lastResult = {
    status: "accepted",
    action,
    reason: transition.description
  };
  next.ledger.push({
    revision: next.revision,
    action,
    accountability: deriveAccountability(next),
    run: next.run,
    effect: next.effect
  });
  return next;
}

module.exports = {
  ACTIONS,
  createInitialState,
  deriveAccountability,
  dispatch,
  legalActions,
  validateInvariants
};
