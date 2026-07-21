import { readFile } from "node:fs/promises";

import { signRuntimeEventEnvelope } from "./runtime-event-envelope.js";

const [command, argument] = process.argv.slice(2);
const baseUrl = (process.env.ALPHONSE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const token = process.env.ALPHONSE_TOKEN;

const commands = {
  bootstrap: { method: "GET", path: "/diagnostic/v0/bootstrap", auth: false },
  operations: { method: "GET", path: "/diagnostic/v0/operations", auth: false },
  "adapter-contract": { method: "GET", path: "/diagnostic/v0/runtime-adapter-contract", auth: false },
  "repair-delivery-contract": { method: "GET", path: "/diagnostic/v0/repair-delivery-adapter-contract", auth: false },
  "verification-runner-contract": { method: "GET", path: "/diagnostic/v0/verification-runner-contract", auth: false },
  "maintenance-agent-profile": { method: "GET", path: "/diagnostic/v0/maintenance-agent-profile" },
  "maintenance-work-queue": { method: "GET", path: "/diagnostic/v0/maintenance-work-queue" },
  "export-maintenance-assurance": { method: "POST", path: "/diagnostic/v0/maintenance-assurances", file: true },
  "get-maintenance-assurance": { method: "GET", path: `/diagnostic/v0/maintenance-assurances/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "register-workflow": { method: "POST", path: "/diagnostic/v0/agent-workflows", file: true },
  "register-revision": { method: "POST", path: "/diagnostic/v0/agent-revisions", file: true },
  "get-workflow": { method: "GET", path: `/diagnostic/v0/agent-workflows/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "get-revision": { method: "GET", path: `/diagnostic/v0/agent-revisions/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "get-artifact": { method: "GET", path: `/diagnostic/v0/artifacts/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "receive-event": { method: "POST", path: "/diagnostic/v0/runtime-events", file: true, runtimeAuth: true },
  "get-trace": { method: "GET", path: `/diagnostic/v0/external-activity-traces/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "get-event-conflict": { method: "GET", path: `/diagnostic/v0/runtime-event-conflicts/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "get-workflow-coverage": { method: "GET", path: `/diagnostic/v0/coverage-onboardings/${encodeURIComponent(argument ?? "")}/capabilities`, argumentRequired: true },
  "advance-coverage-reconciliation": { method: "POST", file: true, coverageReconciliation: true },
  "get-coverage-reconciliation": { method: "GET", path: `/diagnostic/v0/coverage-onboardings/${encodeURIComponent(argument ?? "")}/reconciliation`, argumentRequired: true },
  "report-failure": { method: "POST", path: "/diagnostic/v0/cases", file: true },
  "confirm-failure-spec": { method: "POST", path: "/diagnostic/v0/failure-specifications", file: true },
  "create-reproduction": { method: "POST", path: "/diagnostic/v0/reproductions", file: true },
  "register-repair-worker": { method: "POST", path: "/diagnostic/v0/repair-workers", file: true, agentAuth: true },
  "register-diagnosis-worker": { method: "POST", path: "/diagnostic/v0/diagnosis-workers", file: true, agentAuth: true },
  "create-diagnosis-request": { method: "POST", path: "/diagnostic/v0/diagnosis-requests", file: true },
  "get-diagnosis-workspace": { method: "GET", agentAuth: true, diagnosisWorkspace: true, argumentRequired: true },
  "fail-diagnosis-request": { method: "POST", file: true, agentAuth: true, diagnosisRequestAction: "fail" },
  "submit-diagnosis-proposal": { method: "POST", path: "/diagnostic/v0/diagnosis-proposals", file: true, agentAuth: true },
  "review-diagnosis-proposal": { method: "POST", file: true, diagnosisProposalReview: true },
  "get-diagnosis-request": { method: "GET", path: `/diagnostic/v0/diagnosis-requests/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "get-diagnosis-proposal": { method: "GET", path: `/diagnostic/v0/diagnosis-proposals/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "create-repair-task": { method: "POST", path: "/diagnostic/v0/repair-tasks", file: true },
  "discover-repair-tasks": { method: "GET", path: "/diagnostic/v0/repair-tasks", agentAuth: true },
  "claim-repair-task": { method: "POST", file: true, agentAuth: true, taskAction: "claim" },
  "heartbeat-repair-task": { method: "POST", file: true, agentAuth: true, taskAction: "heartbeat" },
  "fail-repair-task": { method: "POST", file: true, agentAuth: true, taskAction: "fail" },
  "release-repair-task": { method: "POST", file: true, agentAuth: true, taskAction: "release" },
  "cancel-repair-task": { method: "POST", file: true, taskAction: "cancel" },
  "submit-repair-candidate": { method: "POST", path: "/diagnostic/v0/repair-candidates", file: true, agentAuth: true },
  "get-repair-task": { method: "GET", path: `/diagnostic/v0/repair-tasks/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "get-repair-candidate": { method: "GET", path: `/diagnostic/v0/repair-candidates/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "register-repair-delivery-binding": { method: "POST", path: "/diagnostic/v0/repair-delivery-bindings", file: true },
  "get-repair-delivery-binding": { method: "GET", path: `/diagnostic/v0/repair-delivery-bindings/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "inspect-repair-delivery-target": { method: "GET", path: `/diagnostic/v0/repair-delivery-bindings/${encodeURIComponent(argument ?? "")}/target`, argumentRequired: true },
  "materialize-repair-candidate": { method: "POST", path: "/diagnostic/v0/repair-deliveries", file: true },
  "get-repair-delivery": { method: "GET", path: `/diagnostic/v0/repair-deliveries/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "verify-repair": { method: "POST", path: "/diagnostic/v0/repair-verifications", file: true },
  "get-repair-verification": { method: "GET", path: `/diagnostic/v0/repair-verifications/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "authorize-promotion": { method: "POST", path: "/diagnostic/v0/promotions", file: true },
  "apply-promotion": { method: "POST", file: true, promotionAction: "apply" },
  "reconcile-promotion": { method: "POST", file: true, promotionAction: "reconcile" },
  "rollback-promotion": { method: "POST", file: true, promotionAction: "rollback" },
  "get-promotion": { method: "GET", path: `/diagnostic/v0/promotions/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "get-repair-artifact": { method: "GET", agentAuth: true, repairArtifact: true, argumentRequired: true },
  "get-case": { method: "GET", path: `/diagnostic/v0/cases/${encodeURIComponent(argument ?? "")}`, argumentRequired: true },
  "retire-artifact": { method: "POST", path: "/diagnostic/v0/artifact-retirements", file: true }
};

function usage() {
  return [
    "Usage: node src/diagnostic-cli.js <command> [argument]",
    "Commands:",
    "  bootstrap",
    "  operations",
    "  adapter-contract",
    "  repair-delivery-contract",
    "  verification-runner-contract",
    "  maintenance-agent-profile",
    "  maintenance-work-queue",
    "  export-maintenance-assurance <command-json-file>",
    "  get-maintenance-assurance <export-id>",
    "  register-workflow <command-json-file>",
    "  register-revision <command-json-file>",
    "  get-workflow <workflow-id>",
    "  get-revision <revision-id>",
    "  get-artifact <sha256-digest>",
    "  receive-event <envelope-json-file>",
    "  get-trace <trace-id>",
    "  get-event-conflict <conflict-id>",
    "  get-workflow-coverage <onboarding-id>",
    "  advance-coverage-reconciliation <command-json-file>",
    "  get-coverage-reconciliation <onboarding-id>",
    "  report-failure <command-json-file>",
    "  confirm-failure-spec <command-json-file>",
    "  create-reproduction <command-json-file>",
    "  register-repair-worker <command-json-file>",
    "  register-diagnosis-worker <command-json-file>",
    "  create-diagnosis-request <command-json-file>",
    "  get-diagnosis-workspace <request-id>",
    "  fail-diagnosis-request <command-json-file>",
    "  submit-diagnosis-proposal <command-json-file>",
    "  review-diagnosis-proposal <command-json-file>",
    "  get-diagnosis-request <request-id>",
    "  get-diagnosis-proposal <proposal-id>",
    "  create-repair-task <command-json-file>",
    "  discover-repair-tasks",
    "  claim-repair-task <command-json-file>",
    "  heartbeat-repair-task <command-json-file>",
    "  fail-repair-task <command-json-file>",
    "  release-repair-task <command-json-file>",
    "  cancel-repair-task <command-json-file>",
    "  submit-repair-candidate <command-json-file>",
    "  get-repair-task <task-id>",
    "  get-repair-candidate <candidate-id>",
    "  register-repair-delivery-binding <command-json-file>",
    "  get-repair-delivery-binding <binding-id>",
    "  inspect-repair-delivery-target <binding-id>",
    "  materialize-repair-candidate <command-json-file>",
    "  get-repair-delivery <delivery-id>",
    "  verify-repair <command-json-file>",
    "  get-repair-verification <verification-id>",
    "  authorize-promotion <command-json-file>",
    "  apply-promotion <command-json-file>",
    "  reconcile-promotion <command-json-file>",
    "  rollback-promotion <command-json-file>",
    "  get-promotion <promotion-id>",
    "  get-repair-artifact <task-id>,<sha256-digest>",
    "  get-case <case-id>",
    "  retire-artifact <command-json-file>",
    "Environment: ALPHONSE_URL, ALPHONSE_TOKEN, ALPHONSE_AGENT_TOKEN",
    "Runtime event: ALPHONSE_RUNTIME_ADAPTER_KEY_ID, ALPHONSE_RUNTIME_ADAPTER_SECRET"
  ].join("\n");
}

const selected = commands[command];
if (!selected || (selected.file && !argument) || (selected.argumentRequired && !argument)) {
  console.error(usage());
  process.exit(2);
}
const agentToken = process.env.ALPHONSE_AGENT_TOKEN;
if (selected.agentAuth && !agentToken) {
  console.error("ALPHONSE_AGENT_TOKEN is required for this command.");
  process.exit(2);
}
if (selected.auth !== false && !selected.runtimeAuth && !selected.agentAuth && !token) {
  console.error("ALPHONSE_TOKEN is required for this command.");
  process.exit(2);
}

const headers = { accept: "application/json" };
if (selected.agentAuth) headers.authorization = `Agent ${agentToken}`;
else if (selected.auth !== false && !selected.runtimeAuth) headers.authorization = `Bearer ${token}`;
const options = { method: selected.method, headers };
let selectedPath = selected.path;
if (selected.file) {
  headers["content-type"] = "application/json";
  const fileBody = await readFile(argument, "utf8");
  if (selected.taskAction) {
    const body = JSON.parse(fileBody);
    const taskId = body?.input?.task_id;
    if (!taskId) {
      console.error("Repair Task command input.task_id is required.");
      process.exit(2);
    }
    selectedPath = `/diagnostic/v0/repair-tasks/${encodeURIComponent(taskId)}/${selected.taskAction}`;
  }
  if (selected.runtimeAuth) {
    const keyId = process.env.ALPHONSE_RUNTIME_ADAPTER_KEY_ID;
    const secret = process.env.ALPHONSE_RUNTIME_ADAPTER_SECRET;
    if (!keyId || !secret) {
      console.error("ALPHONSE_RUNTIME_ADAPTER_KEY_ID and ALPHONSE_RUNTIME_ADAPTER_SECRET are required.");
      process.exit(2);
    }
    const envelope = JSON.parse(fileBody);
    const authentication = signRuntimeEventEnvelope(envelope, {
      keyId,
      secret,
      signedAt: process.env.ALPHONSE_RUNTIME_SIGNED_AT ?? new Date().toISOString()
    });
    headers["x-alphonse-runtime-key-id"] = authentication.key_id;
    headers["x-alphonse-runtime-signed-at"] = authentication.signed_at;
    headers["x-alphonse-runtime-signature"] = authentication.signature;
    options.body = JSON.stringify(envelope);
  } else {
    options.body = fileBody;
  }
}
if (selected.promotionAction) {
  const body = JSON.parse(await readFile(argument, "utf8"));
  selectedPath = `/diagnostic/v0/promotions/${encodeURIComponent(body?.input?.promotion_id ?? "")}/${selected.promotionAction}`;
}

if (selected.diagnosisRequestAction) {
  const body = JSON.parse(await readFile(argument, "utf8"));
  selectedPath = `/diagnostic/v0/diagnosis-requests/${encodeURIComponent(body?.input?.request_id ?? "")}` +
    `/${selected.diagnosisRequestAction}`;
}

if (selected.coverageReconciliation) {
  const body = JSON.parse(await readFile(argument, "utf8"));
  selectedPath = `/diagnostic/v0/coverage-onboardings/${encodeURIComponent(
    body?.input?.onboarding_id ?? "")}/reconciliations`;
}

if (selected.diagnosisProposalReview) {
  const body = JSON.parse(await readFile(argument, "utf8"));
  selectedPath = `/diagnostic/v0/diagnosis-proposals/${encodeURIComponent(body?.input?.proposal_id ?? "")}/reviews`;
}

if (selected.diagnosisWorkspace) {
  selectedPath = `/diagnostic/v0/diagnosis-requests/${encodeURIComponent(argument)}/workspace`;
}

if (selected.repairArtifact) {
  const separator = argument.indexOf(",");
  if (separator < 1) {
    console.error("Repair artifact argument must be <task-id>,<sha256-digest>.");
    process.exit(2);
  }
  selectedPath = `/diagnostic/v0/repair-tasks/${encodeURIComponent(argument.slice(0, separator))}` +
    `/artifacts/${encodeURIComponent(argument.slice(separator + 1))}`;
}

const response = await fetch(`${baseUrl}${selectedPath}`, options);
const body = await response.json();
process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
if (!response.ok) process.exit(1);
