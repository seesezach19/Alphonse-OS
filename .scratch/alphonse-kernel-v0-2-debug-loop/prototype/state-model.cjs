"use strict";

function initialState() {
  return {
    revision: 0,
    clock: 0,
    workflow: {
      id: "inventory-follow-up",
      observedRevision: null,
      targetRevision: "rev-buggy"
    },
    events: [],
    idempotency: {},
    case: {
      exists: false,
      failureSpecification: null,
      reproductionBundle: null,
      closedUnresolved: false
    },
    repairTasks: [],
    candidates: [],
    verifications: [],
    promotions: [],
    artifacts: [],
    lastResult: {
      status: "ready",
      action: "none",
      reason: "Choose an action or scenario"
    },
    ledger: []
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function latest(list) {
  return list.length ? list[list.length - 1] : null;
}

function caseProjection(state) {
  if (!state.case.exists) return "none";
  if (state.case.closedUnresolved) return "closed_unresolved";

  const confirmed = state.promotions.find((promotion) =>
    promotion.status === "confirmed" &&
    state.workflow.targetRevision === promotion.candidateRevision
  );
  if (confirmed) return "resolved";
  if (state.candidates.some((candidate) => candidate.status === "verified")) return "verified";
  if (state.candidates.some((candidate) =>
    ["proposed", "verification_pending"].includes(candidate.status)
  )) return "candidate_available";
  if (state.repairTasks.some((task) => ["available", "leased"].includes(task.status))) {
    return "repair_in_progress";
  }
  if (state.case.reproductionBundle) return "reproducible";
  if (state.case.failureSpecification) return "specified";
  return "open";
}

function eventProjection(state) {
  if (!state.events.length) return "none";
  const ordered = [...state.events].sort((a, b) => a.sequence - b.sequence);
  return ordered[ordered.length - 1].claim;
}

function validate(state) {
  const violations = [];

  for (const candidate of state.candidates) {
    if (candidate.status === "verified") {
      const receipt = state.verifications.find((item) =>
        item.candidateId === candidate.id && item.result === "pass"
      );
      if (!receipt) violations.push(`Verified candidate ${candidate.id} lacks passing receipt`);
    }
  }

  for (const promotion of state.promotions) {
    if (["authorized", "applying", "uncertain", "confirmed"].includes(promotion.status)) {
      const candidate = state.candidates.find((item) => item.id === promotion.candidateId);
      if (!candidate || candidate.status !== "verified") {
        violations.push(`Promotion ${promotion.id} lacks verified candidate`);
      }
      if (promotion.authorizedBy !== "owner") {
        violations.push(`Promotion ${promotion.id} lacks Owner authorization`);
      }
    }
    if (promotion.status === "confirmed" &&
        state.workflow.targetRevision !== promotion.candidateRevision) {
      violations.push(`Confirmed promotion ${promotion.id} does not match target revision`);
    }
  }

  for (const task of state.repairTasks) {
    if (task.status === "submitted" &&
        !state.candidates.some((candidate) => candidate.taskId === task.id)) {
      violations.push(`Submitted task ${task.id} lacks candidate`);
    }
  }

  if (caseProjection(state) === "resolved" &&
      !state.promotions.some((promotion) => promotion.status === "confirmed")) {
    violations.push("Resolved case lacks confirmed promotion");
  }

  return violations;
}

function legalActions(state) {
  const task = latest(state.repairTasks);
  const candidate = latest(state.candidates);
  const promotion = latest(state.promotions);
  const actions = [];

  if (!state.events.length) actions.push("receive_success_event");
  if (state.events.length) actions.push("receive_duplicate_event", "receive_conflicting_event");
  if (state.events.length && !state.case.exists) actions.push("report_failure");
  if (state.case.exists && !state.case.failureSpecification) actions.push("confirm_failure_spec");
  if (state.case.failureSpecification && !state.case.reproductionBundle) actions.push("create_reproduction_bundle");
  const liveCandidate = state.candidates.some((item) =>
    ["proposed", "verification_pending", "verified"].includes(item.status)
  );
  if (state.case.reproductionBundle &&
      (!task || !["available", "leased"].includes(task.status)) &&
      !liveCandidate) {
    actions.push("create_repair_task");
  }
  if (task && task.status === "available") actions.push("lease_repair_task");
  if (task && task.status === "leased") {
    actions.push("submit_good_candidate", "submit_bad_candidate", "expire_repair_task");
  }
  if (candidate && candidate.status === "proposed") actions.push("verify_candidate");
  if (candidate && candidate.status === "verified" && !promotion) {
    if (state.workflow.targetRevision === candidate.baseRevision) {
      actions.push("authorize_promotion", "worker_authorize_promotion");
    }
    actions.push("change_target_revision");
  }
  if (promotion && promotion.status === "authorized") actions.push("apply_promotion");
  if (promotion && promotion.status === "applying") {
    actions.push("confirm_promotion", "timeout_promotion_applied", "timeout_promotion_not_applied");
  }
  if (promotion && promotion.status === "uncertain") actions.push("retry_uncertain_promotion", "reconcile_promotion");
  return actions;
}

function reject(state, action, reason) {
  const next = clone(state);
  next.lastResult = { status: "rejected", action, reason };
  return next;
}

function accept(state, action, mutate, detail = "accepted") {
  const next = clone(state);
  next.clock += 1;
  mutate(next);
  next.revision += 1;
  next.lastResult = { status: "accepted", action, reason: detail };
  next.ledger.push({
    revision: next.revision,
    action,
    caseProjection: caseProjection(next),
    targetRevision: next.workflow.targetRevision
  });
  return next;
}

function idempotent(state, action, key, digest, mutate) {
  const prior = state.idempotency[key];
  if (prior) {
    if (prior.digest !== digest) {
      return reject(state, action, `idempotency conflict for ${key}`);
    }
    const replay = clone(state);
    replay.lastResult = {
      status: "replayed",
      action,
      reason: `original receipt ${prior.receipt}`
    };
    return replay;
  }

  return accept(state, action, (next) => {
    mutate(next);
    next.idempotency[key] = {
      digest,
      receipt: `receipt-${next.revision + 1}`
    };
  });
}

function dispatch(state, action) {
  const task = latest(state.repairTasks);
  const candidate = latest(state.candidates);
  const promotion = latest(state.promotions);

  switch (action) {
    case "receive_success_event":
      return idempotent(state, action, "event-exec-1-2", "sha-success", (next) => {
        next.events.push({
          id: "event-exec-1-2",
          sequence: 2,
          claim: "succeeded",
          externalExecution: "n8n-exec-1",
          revision: "rev-buggy",
          trustedAsKernelRun: false
        });
        next.workflow.observedRevision = "rev-buggy";
      });

    case "receive_duplicate_event":
      return idempotent(state, action, "event-exec-1-2", "sha-success", () => {});

    case "receive_conflicting_event":
      return idempotent(state, action, "event-exec-1-2", "sha-failed-conflict", () => {});

    case "report_failure":
      if (!state.events.length || state.case.exists) {
        return reject(state, action, "one observed execution and no existing case required");
      }
      return idempotent(state, action, "case-exec-1", "sha-case", (next) => {
        next.case.exists = true;
      });

    case "confirm_failure_spec":
      if (!state.case.exists || state.case.failureSpecification) {
        return reject(state, action, "open case without specification required");
      }
      return idempotent(state, action, "spec-case-1", "sha-spec", (next) => {
        next.case.failureSpecification = {
          expected: "inventory_unknown -> human_review",
          actual: "missing_sku -> zero_inventory -> delay_draft",
          confirmedBy: "owner"
        };
      });

    case "create_reproduction_bundle":
      if (!state.case.failureSpecification || state.case.reproductionBundle) {
        return reject(state, action, "confirmed specification without bundle required");
      }
      return idempotent(state, action, "bundle-case-1", "sha-bundle-input", (next) => {
        next.case.reproductionBundle = "bundle-sha-001";
        next.artifacts.push({ id: "bundle-sha-001", kind: "reproduction", immutable: true });
      });

    case "create_repair_task": {
      if (!state.case.reproductionBundle) return reject(state, action, "reproduction bundle required");
      const active = state.repairTasks.some((item) => ["available", "leased"].includes(item.status));
      if (active) return reject(state, action, "active repair task already exists");
      const liveCandidate = state.candidates.some((item) =>
        ["proposed", "verification_pending", "verified"].includes(item.status)
      );
      if (liveCandidate) return reject(state, action, "active candidate already exists");
      const id = `task-${state.repairTasks.length + 1}`;
      return idempotent(state, action, `create-${id}`, `sha-${id}`, (next) => {
        next.repairTasks.push({
          id,
          status: "available",
          worker: null,
          leaseEpoch: 0,
          baseRevision: state.workflow.observedRevision
        });
      });
    }

    case "lease_repair_task":
      if (!task || task.status !== "available") return reject(state, action, "available task required");
      return idempotent(state, action, `lease-${task.id}`, `sha-lease-${task.id}`, (next) => {
        const current = latest(next.repairTasks);
        current.status = "leased";
        current.worker = "repair-worker";
        current.leaseEpoch += 1;
      });

    case "expire_repair_task":
      if (!task || task.status !== "leased") return reject(state, action, "leased task required");
      return accept(state, action, (next) => {
        latest(next.repairTasks).status = "expired";
      });

    case "submit_good_candidate":
    case "submit_bad_candidate": {
      if (!task || task.status !== "leased") return reject(state, action, "live leased task required");
      const kind = action === "submit_good_candidate" ? "good" : "bad";
      const id = `candidate-${state.candidates.length + 1}`;
      return idempotent(state, action, `submit-${task.id}`, `sha-${id}-${kind}`, (next) => {
        latest(next.repairTasks).status = "submitted";
        next.candidates.push({
          id,
          taskId: task.id,
          status: "proposed",
          baseRevision: task.baseRevision,
          candidateRevision: kind === "good" ? "rev-fixed" : "rev-still-buggy",
          behavior: kind,
          regression: `regression-${id}`,
          immutable: true
        });
        next.artifacts.push({ id: `regression-${id}`, kind: "regression", immutable: true });
      });
    }

    case "verify_candidate":
      if (!candidate || candidate.status !== "proposed") {
        return reject(state, action, "proposed candidate required");
      }
      return idempotent(state, action, `verify-${candidate.id}`, `sha-verify-${candidate.id}`, (next) => {
        const current = latest(next.candidates);
        const passed = current.behavior === "good";
        current.status = passed ? "verified" : "rejected";
        next.verifications.push({
          id: `verification-${next.verifications.length + 1}`,
          candidateId: current.id,
          originalResult: "fail_as_expected",
          candidateResult: passed ? "pass" : "fail",
          retainedRegressions: passed ? "pass" : "not_reached",
          result: passed ? "pass" : "fail",
          signedBy: "verification-runner"
        });
      });

    case "worker_authorize_promotion":
      return reject(state, action, "repair worker lacks promotion authority");

    case "authorize_promotion":
      if (!candidate || candidate.status !== "verified") {
        return reject(state, action, "verified candidate required");
      }
      if (state.workflow.targetRevision !== candidate.baseRevision) {
        return reject(state, action, "target revision changed after candidate base");
      }
      return idempotent(state, action, `authorize-${candidate.id}`, `sha-owner-${candidate.id}`, (next) => {
        next.promotions.push({
          id: `promotion-${next.promotions.length + 1}`,
          candidateId: candidate.id,
          candidateRevision: candidate.candidateRevision,
          expectedTargetRevision: candidate.baseRevision,
          previousRevision: null,
          rollbackReference: null,
          authorizedBy: "owner",
          status: "authorized"
        });
      });

    case "change_target_revision":
      return accept(state, action, (next) => {
        next.workflow.targetRevision = "rev-unrelated-newer";
      }, "simulated external target change");

    case "apply_promotion":
      if (!promotion || promotion.status !== "authorized") {
        return reject(state, action, "authorized promotion required");
      }
      if (state.workflow.targetRevision !== promotion.expectedTargetRevision) {
        return reject(state, action, "stale target revision");
      }
      return idempotent(state, action, `apply-${promotion.id}`, `sha-apply-${promotion.id}`, (next) => {
        const current = latest(next.promotions);
        current.status = "applying";
        current.previousRevision = next.workflow.targetRevision;
        current.rollbackReference = `rollback-${next.workflow.targetRevision}`;
      });

    case "confirm_promotion":
      if (!promotion || promotion.status !== "applying") {
        return reject(state, action, "applying promotion required");
      }
      return accept(state, action, (next) => {
        const current = latest(next.promotions);
        next.workflow.targetRevision = current.candidateRevision;
        current.status = "confirmed";
      });

    case "timeout_promotion_applied":
    case "timeout_promotion_not_applied":
      if (!promotion || promotion.status !== "applying") {
        return reject(state, action, "applying promotion required");
      }
      return accept(state, action, (next) => {
        const current = latest(next.promotions);
        current.status = "uncertain";
        if (action === "timeout_promotion_applied") {
          next.workflow.targetRevision = current.candidateRevision;
        }
      }, "adapter response lost; target reality requires reconciliation");

    case "retry_uncertain_promotion":
      return reject(state, action, "blind retry prohibited while target effect is uncertain");

    case "reconcile_promotion":
      if (!promotion || promotion.status !== "uncertain") {
        return reject(state, action, "uncertain promotion required");
      }
      return accept(state, action, (next) => {
        const current = latest(next.promotions);
        current.status = next.workflow.targetRevision === current.candidateRevision
          ? "confirmed"
          : "failed";
      });

    case "stale_worker_submit":
      return reject(state, action, "expired lease is fenced");

    default:
      return reject(state, action, "unknown action");
  }
}

module.exports = {
  caseProjection,
  dispatch,
  eventProjection,
  initialState,
  legalActions,
  validate
};
