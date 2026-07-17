const observationPlan = [
  { id: "source-1", type: "source.delivery", tokenReceipt: "token-delivery-1" },
  { id: "source-2", type: "source.delivery", tokenReceipt: "token-delivery-2" },
  { id: "runtime-1", type: "runtime.execution" },
  { id: "runtime-2", type: "runtime.execution" },
  { id: "request-1", type: "destination.request", tokenReceipt: "token-request-1" },
  { id: "request-2", type: "destination.request", tokenReceipt: "token-request-2" },
  { id: "effect-1", type: "destination.effect" },
  { id: "effect-2", type: "destination.effect" }
];

const tokenReceiptPlan = [
  { id: "token-delivery-1", token: "eq-A", fieldRole: "delivery_identity" },
  { id: "token-request-1", token: "eq-A", fieldRole: "idempotency_key" },
  { id: "token-delivery-2", token: "eq-B", fieldRole: "delivery_identity" },
  { id: "token-request-2", token: "eq-B", fieldRole: "idempotency_key" }
];

export function createState() {
  return {
    step: 0,
    authority: {
      readinessBound: false,
      desiredSnapshotsPublished: false,
      observationApplied: false,
      tokenizationApplied: false,
      kernelEffective: false,
      revocationPending: false,
      observationRevokedEffective: false,
      manifestSealed: false
    },
    retention: {
      pretriggerObservationHorizon: 30,
      pretriggerPipelineRetryHorizon: 20,
      collectionWindow: 30,
      postTriggerRetryHorizon: 15,
      gcMargin: 10,
      ordinaryConfigured: 60,
      collectionLeaseConfigured: 55
    },
    stimulus: { delivered: false, deliveries: 0 },
    tokenization: { receipts: [] },
    intake: { outcomes: [], cutoff: null },
    pipeline: {
      correlation: "pending",
      effects: "pending",
      evaluation: "pending",
      trigger: "pending",
      collectionLease: false,
      package: "pending",
      assignment: "none"
    },
    verification: {
      bundlePositions: [],
      status: "not_run",
      reason: null
    },
    reportingProbe: "not_run",
    lastResult: { ok: true, action: "initialized", message: "Prototype ready." },
    history: []
  };
}

export function retentionReadiness(state) {
  const r = state.retention;
  const ordinaryMinimum = r.pretriggerObservationHorizon + r.pretriggerPipelineRetryHorizon + r.gcMargin;
  const collectionMinimum = r.collectionWindow + r.postTriggerRetryHorizon + r.gcMargin;
  return {
    ordinaryMinimum,
    collectionMinimum,
    ready: r.ordinaryConfigured >= ordinaryMinimum && r.collectionLeaseConfigured >= collectionMinimum
  };
}

function finish(state, action, ok, message) {
  state.step += 1;
  state.lastResult = { ok, action, message };
  state.history.push(state.lastResult);
  state.history = state.history.slice(-8);
  return state;
}

function fail(state, action, message) {
  return finish(state, action, false, message);
}

function allTokenReceiptsPresent(state) {
  const available = new Set(state.tokenization.receipts.map((receipt) => receipt.id));
  return observationPlan.every((observation) => !observation.tokenReceipt || available.has(observation.tokenReceipt));
}

function prefixIsComplete(state) {
  const positions = state.intake.outcomes.map((outcome) => outcome.position);
  return positions.length === observationPlan.length && positions.every((position, index) => position === index + 1);
}

export function transition(current, action) {
  const state = structuredClone(current);
  const authority = state.authority;

  switch (action) {
    case "complete_readiness":
      authority.readinessBound = true;
      return finish(state, action, true, "Workflow binding and readiness receipt created.");

    case "publish_grants":
      if (!authority.readinessBound) return fail(state, action, "Readiness binding required.");
      authority.desiredSnapshotsPublished = true;
      return finish(state, action, true, "Desired observation and tokenization grant snapshots published.");

    case "apply_observation_grant":
      if (!authority.desiredSnapshotsPublished) return fail(state, action, "No desired snapshot to apply.");
      authority.observationApplied = true;
      return finish(state, action, true, "Diagnostic Plane durably applied grant and signed receipt.");

    case "apply_tokenization_grant":
      if (!authority.desiredSnapshotsPublished) return fail(state, action, "No desired snapshot to apply.");
      authority.tokenizationApplied = true;
      return finish(state, action, true, "Tokenization Service durably applied grant and signed receipt.");

    case "record_effective":
      if (!authority.observationApplied || !authority.tokenizationApplied) {
        return fail(state, action, "Both signed application receipts must verify first.");
      }
      authority.kernelEffective = true;
      return finish(state, action, true, "Kernel recorded both grants active_effective.");

    case "set_retention_short":
      state.retention.ordinaryConfigured = 30;
      state.retention.collectionLeaseConfigured = 30;
      return finish(state, action, true, "Each largest interval fits, but cumulative horizons do not.");

    case "set_retention_valid":
      state.retention.ordinaryConfigured = 60;
      state.retention.collectionLeaseConfigured = 55;
      return finish(state, action, true, "Cumulative retention horizons restored.");

    case "seal_manifest":
      if (!authority.kernelEffective) return fail(state, action, "Effective applied grant state required.");
      if (!retentionReadiness(state).ready) return fail(state, action, "Cumulative retention readiness failed.");
      authority.manifestSealed = true;
      return finish(state, action, true, "Deployment manifest sealed; stimulus may begin.");

    case "send_stimulus":
      if (!authority.manifestSealed) return fail(state, action, "Sealed deployment manifest required.");
      state.stimulus = { delivered: true, deliveries: 2 };
      return finish(state, action, true, "Stimulus sent two deliveries and authored no evidence.");

    case "preserve_token_receipts":
      if (!authority.kernelEffective || authority.observationRevokedEffective) {
        return fail(state, action, "Effective tokenization authority required.");
      }
      if (!state.stimulus.delivered) return fail(state, action, "No observed values exist before stimulus.");
      state.tokenization.receipts = structuredClone(tokenReceiptPlan);
      return finish(state, action, true, "Four signed token receipts preserved before observation reference.");

    case "accept_observations":
      if (!state.stimulus.delivered) return fail(state, action, "Stimulus has not occurred.");
      if (!authority.kernelEffective || authority.observationRevokedEffective) {
        return fail(state, action, "Observation grant is not effective.");
      }
      if (!allTokenReceiptsPresent(state)) {
        return fail(state, action, "Referenced token receipts are missing from Diagnostic Plane.");
      }
      state.intake.outcomes = observationPlan.map((observation, index) => ({
        ...observation,
        position: index + 1
      }));
      return finish(state, action, true, "Eight canonical observations accepted at positions 1..8.");

    case "project_correlation":
      if (!prefixIsComplete(state)) return fail(state, action, "Complete committed intake prefix required.");
      state.intake.cutoff = state.intake.outcomes.length;
      state.pipeline.correlation = "created";
      return finish(state, action, true, "Projection derived one operation, two deliveries, and scoped equality edges.");

    case "interpret_effects":
      if (state.pipeline.correlation !== "created") return fail(state, action, "Correlation projection required.");
      state.pipeline.effects = "two_committed";
      return finish(state, action, true, "Contract-designated ledger claims became two committed diagnostic effects.");

    case "evaluate_behavior":
      if (state.pipeline.effects !== "two_committed") return fail(state, action, "Effect projection required.");
      state.pipeline.evaluation = "violated:2>1";
      return finish(state, action, true, "Count-by-correlation invariant violated.");

    case "create_trigger":
      if (state.pipeline.evaluation !== "violated:2>1") return fail(state, action, "Violated evaluation required.");
      state.pipeline.trigger = "created";
      state.pipeline.collectionLease = true;
      return finish(state, action, true, "Trigger created with active evidence collection lease.");

    case "freeze_package":
      if (state.pipeline.trigger !== "created") return fail(state, action, "Diagnostic trigger required.");
      if (!prefixIsComplete(state)) return fail(state, action, "Stable complete prefix required.");
      state.pipeline.package = "frozen";
      state.pipeline.collectionLease = false;
      state.verification.bundlePositions = state.intake.outcomes.map((outcome) => outcome.position);
      return finish(state, action, true, "Package frozen and selected artifacts retention-pinned.");

    case "create_assignment":
      if (state.pipeline.package !== "frozen") return fail(state, action, "Frozen evidence package required.");
      state.pipeline.assignment = "unclaimed:authority_none";
      return finish(state, action, true, "Immutable unclaimed assignment created; no model contacted.");

    case "omit_prefix_position":
      if (state.pipeline.package !== "frozen") return fail(state, action, "Freeze a package first.");
      state.verification.bundlePositions = state.verification.bundlePositions.filter((position) => position !== 4);
      state.verification.status = "not_run";
      return finish(state, action, true, "Verifier bundle now omits committed position 4.");

    case "restore_prefix":
      state.verification.bundlePositions = state.intake.outcomes.map((outcome) => outcome.position);
      state.verification.status = "not_run";
      return finish(state, action, true, "Verifier bundle restored from all committed outcomes.");

    case "verify_prefix": { // eslint-disable-line no-case-declarations
      const cutoff = state.intake.cutoff;
      const expected = cutoff ? Array.from({ length: cutoff }, (_, index) => index + 1) : [];
      const actual = state.verification.bundlePositions;
      const complete = expected.length > 0 && expected.every((position, index) => actual[index] === position);
      state.verification.status = complete ? "passed" : "failed";
      state.verification.reason = complete ? "Complete prefix independently eligible." : "Committed prefix incomplete.";
      return finish(state, action, complete, state.verification.reason);
    }

    case "request_observation_revocation":
      authority.revocationPending = true;
      return finish(state, action, true, "Revocation desired; prior applied state remains effective.");

    case "apply_observation_revocation":
      if (!authority.revocationPending) return fail(state, action, "No pending revocation snapshot.");
      authority.observationRevokedEffective = true;
      authority.revocationPending = false;
      return finish(state, action, true, "Diagnostic Plane applied revocation; later reporting must fail.");

    case "probe_reporting":
      state.reportingProbe = authority.kernelEffective && !authority.observationRevokedEffective ? "accepted" : "rejected";
      return finish(state, action, true, `Reporting probe ${state.reportingProbe}.`);

    default:
      return fail(state, action, "Unknown prototype action.");
  }
}

export function nextHappyAction(state) {
  const a = state.authority;
  const p = state.pipeline;
  if (!a.readinessBound) return "complete_readiness";
  if (!a.desiredSnapshotsPublished) return "publish_grants";
  if (!a.observationApplied) return "apply_observation_grant";
  if (!a.tokenizationApplied) return "apply_tokenization_grant";
  if (!a.kernelEffective) return "record_effective";
  if (!a.manifestSealed) return "seal_manifest";
  if (!state.stimulus.delivered) return "send_stimulus";
  if (state.tokenization.receipts.length === 0) return "preserve_token_receipts";
  if (state.intake.outcomes.length === 0) return "accept_observations";
  if (p.correlation === "pending") return "project_correlation";
  if (p.effects === "pending") return "interpret_effects";
  if (p.evaluation === "pending") return "evaluate_behavior";
  if (p.trigger === "pending") return "create_trigger";
  if (p.package === "pending") return "freeze_package";
  if (p.assignment === "none") return "create_assignment";
  if (state.verification.status !== "passed") return "verify_prefix";
  return null;
}

export function prototypeReport(state) {
  const retention = retentionReadiness(state);
  return {
    question: "Can deterministic canonical diagnostics create an unclaimed assignment without a model?",
    assignment: state.pipeline.assignment,
    model_contacted: false,
    grants_effective: state.authority.kernelEffective,
    token_receipts_preserved: state.tokenization.receipts.length,
    committed_prefix: state.intake.cutoff,
    verification: state.verification.status,
    retention_ready: retention.ready,
    verdict: state.pipeline.assignment === "unclaimed:authority_none" && state.verification.status === "passed"
      ? "SUPPORTED"
      : "NOT_YET_SUPPORTED"
  };
}
