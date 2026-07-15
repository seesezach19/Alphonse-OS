import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.ALPHONSE_ACCEPTANCE_URL ?? "http://127.0.0.1:43212";
const project = process.env.ALPHONSE_ACCEPTANCE_PROJECT ?? `alphonse-v02-ticket12-${process.pid}`;
const ownerToken = "local-development-bootstrap-token";
const repairWorkerToken = "ticket-05-repair-worker-token-0000000000000001";
const diagnosisWorkerToken = "ticket-12-diagnosis-worker-token-00000000000001";
const kernelPort = process.env.ALPHONSE_ACCEPTANCE_KERNEL_PORT ?? "43212";
const postgresPort = process.env.ALPHONSE_ACCEPTANCE_POSTGRES_PORT ?? "45512";
const n8nPort = process.env.ALPHONSE_ACCEPTANCE_N8N_PORT ?? "45682";
const composeFiles = ["-f", "compose.yaml", "-f", "packages/n8n-operational-package/compose.customer.yaml"];

Object.assign(process.env, {
  ALPHONSE_ACCEPTANCE_URL: baseUrl,
  ALPHONSE_ACCEPTANCE_PROJECT: project,
  ALPHONSE_ACCEPTANCE_KERNEL_PORT: kernelPort,
  ALPHONSE_ACCEPTANCE_POSTGRES_PORT: postgresPort,
  ALPHONSE_ACCEPTANCE_N8N_PORT: n8nPort,
  ALPHONSE_TICKET05_KEEP_STACK: "1"
});

const environment = { ...process.env, COMPOSE_PROJECT_NAME: project, KERNEL_PORT: kernelPort,
  POSTGRES_PORT: postgresPort, N8N_PORT: n8nPort };
const ownerHeaders = { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" };
let passed = false;

function run(command, args, { allowFailure = false, timeout = 8 * 60_000 } = {}) {
  const result = spawnSync(command, args, { cwd: root, env: environment, encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

function compose(...args) {
  return run("docker", ["compose", ...composeFiles, ...args]);
}

function sql(database, user, password, query) {
  return compose("exec", "-T", "postgres", "sh", "-lc",
    `PGPASSWORD=${password} psql -U ${user} -d ${database} -tAc '${query}'`).stdout.trim();
}

async function request(route, { method = "GET", headers = ownerHeaders, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { response, body: await response.json() };
}

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

async function ownerCommand(route, commandId, operationId, input) {
  return request(route, { method: "POST", body: command(commandId, operationId, input) });
}

async function agentCommand(token, route, commandId, operationId, input) {
  return request(route, { method: "POST",
    headers: { authorization: `Agent ${token}`, "content-type": "application/json" },
    body: command(commandId, operationId, input) });
}

function diagnosis(workspace, model = "customer-model-a") {
  const [failureSpec, revision, bundle] = workspace.diagnosis_request.input_artifact_digests;
  return {
    facts: [{ statement: "The demonstrated run mapped a missing SKU to zero inventory.",
      artifact_references: [failureSpec, bundle] }],
    inferences: [{ statement: "The mapping erased the distinction between unknown and zero inventory.",
      basis: [revision, bundle] }],
    hypotheses: [{ statement: "Preserving inventory_unknown will prevent the false delay draft.", confidence: "high",
      supporting_artifact_references: [failureSpec, revision, bundle], contradicting_artifact_references: [] }],
    uncertainties: ["This proposal does not establish behavior outside the confirmed fixture."],
    recommended_investigation: [{ step: "Inspect the missing-SKU branch and targeted regression.",
      rationale: "Confirms whether unknown inventory survives until human review.", artifact_references: [revision, bundle] }],
    artifact_references: [failureSpec, revision, bundle],
    provenance: {
      model: { provider: "customer-controlled", model, version: "2026-07-15" },
      runtime: { name: "ticket-12-diagnostic-worker", version: "1.0.0" },
      instruction_digest: workspace.diagnosis_request.instruction_digest,
      input_artifact_digests: [failureSpec, revision, bundle]
    }
  };
}

try {
  await import("./acceptance-v0.2-ticket-05.js");
  const caseId = process.env.ALPHONSE_TICKET05_CASE_ID;
  assert.ok(caseId);
  const before = (await request(`/diagnostic/v0/cases/${caseId}`)).body.diagnostic_case;
  const revisionId = before.revision_id;
  const bundleId = before.reproduction_bundles[0].bundle_id;
  const sponsorId = sql("alphonse_kernel", "alphonse", "local-development-only",
    "select principal_id from kernel_principals where principal_type=concat(chr(104),chr(117),chr(109),chr(97),chr(110)) limit 1");
  const agent = await ownerCommand("/kernel/v0/principals", "v02-ticket12-agent",
    "kernel.principal.create", { principal_type: "agent", display_name: "Customer Diagnostic Worker" });
  assert.equal(agent.response.status, 201, JSON.stringify(agent.body));
  const now = Date.now();
  const passport = await ownerCommand("/kernel/v0/agent-passports", "v02-ticket12-passport",
    "kernel.agent_passport.issue", {
      agent_principal_id: agent.body.principal.principal_id, sponsor_principal_id: sponsorId,
      runtime: { kind: "customer-controlled", version: "replaceable" },
      model_configuration: { provider: "customer-selected", provider_custody: "customer-worker-only" },
      package_skill_configuration: { protocol: "alphonse-diagnostic-worker-0.2.0" },
      agent_authentication_token: diagnosisWorkerToken,
      permitted_intent_classes: ["diagnostic_analysis", "repair_work"],
      provenance: { source: "ticket-12-acceptance" }, valid_from: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 3_600_000).toISOString()
    });
  assert.equal(passport.response.status, 201, JSON.stringify(passport.body));
  const passportId = passport.body.passport.passport_id;
  const intentProposal = await agentCommand(diagnosisWorkerToken, "/kernel/v0/work-intent-proposals",
    "v02-ticket12-intent-proposal", "kernel.work_intent.propose", {
      passport_id: passportId, intent_class: "diagnostic_analysis",
      objective: "Propose an advisory diagnosis from exact confirmed sources.",
      requested_outcome: "Return structured hypotheses and recommended investigation only.",
      scope: { case_id: caseId, revision_id: revisionId, reproduction_bundle_id: bundleId },
      constraints: { no_failure_declaration: true, no_evidence_mutation: true, no_repair_commission: true,
        no_verification: true, no_promotion: true, no_external_effects: true }
    });
  assert.equal(intentProposal.response.status, 201, JSON.stringify(intentProposal.body));
  const intent = await ownerCommand(
    `/kernel/v0/work-intent-proposals/${intentProposal.body.proposal.proposal_id}/confirm`,
    "v02-ticket12-intent-confirm", "kernel.work_intent.confirm", {});
  assert.equal(intent.response.status, 201, JSON.stringify(intent.body));

  const registration = await agentCommand(diagnosisWorkerToken, "/diagnostic/v0/diagnosis-workers",
    "v02-ticket12-worker", "diagnostic.diagnosis_worker.register", {
      passport_id: passportId, work_intent_id: intent.body.work_intent.work_intent_id, protocol_version: "0.2.0",
      runtime_attribution: { worker_kind: "customer-diagnostic-worker", runtime_version: "1.0.0",
        attachment_version: "0.2.0" }
    });
  assert.equal(registration.response.status, 201, JSON.stringify(registration.body));
  assert.equal(registration.body.diagnosis_worker.model_provider_credentials_stored, false);
  assert.equal(registration.body.diagnosis_worker.independent_verification, false);
  const registrationId = registration.body.diagnosis_worker.registration_id;

  const repairIntentProposal = await agentCommand(diagnosisWorkerToken, "/kernel/v0/work-intent-proposals",
    "v02-ticket12-repair-intent-proposal", "kernel.work_intent.propose", {
      passport_id: passportId, intent_class: "repair_work", objective: "Attempt role reuse for boundary proof.",
      requested_outcome: "Registration must be denied.", scope: { case_id: caseId, base_revision_id: revisionId },
      constraints: { no_verification: true, no_promotion: true, no_external_effects: true }
    });
  assert.equal(repairIntentProposal.response.status, 201, JSON.stringify(repairIntentProposal.body));
  const repairIntent = await ownerCommand(
    `/kernel/v0/work-intent-proposals/${repairIntentProposal.body.proposal.proposal_id}/confirm`,
    "v02-ticket12-repair-intent-confirm", "kernel.work_intent.confirm", {});
  assert.equal(repairIntent.response.status, 201, JSON.stringify(repairIntent.body));
  const repairRoleReuse = await agentCommand(diagnosisWorkerToken, "/diagnostic/v0/repair-workers",
    "v02-ticket12-repair-role-reuse", "diagnostic.repair_worker.register", {
      passport_id: passportId, work_intent_id: repairIntent.body.work_intent.work_intent_id,
      protocol_version: "0.2.0", runtime_attribution: { worker_kind: "forbidden-role-reuse",
        runtime_version: "1.0.0", attachment_version: "0.2.0" }
    });
  assert.equal(repairRoleReuse.response.status, 409);
  assert.equal(repairRoleReuse.body.error.code, "REPAIR_WORKER_NOT_DISTINCT");

  async function createRequest(index, instruction, expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()) {
    const created = await ownerCommand("/diagnostic/v0/diagnosis-requests", `v02-ticket12-request-${index}`,
      "diagnostic.diagnosis_request.create", { case_id: caseId, worker_registration_id: registrationId,
        reproduction_bundle_id: bundleId, instruction, expires_at: expiresAt });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    return created.body.diagnosis_request;
  }

  const firstRequest = await createRequest(1, "Analyze only the confirmed missing-SKU behavior.");
  const workspaceResponse = await request(`/diagnostic/v0/diagnosis-requests/${firstRequest.request_id}/workspace`, {
    headers: { authorization: `Agent ${diagnosisWorkerToken}` }
  });
  assert.equal(workspaceResponse.response.status, 200, JSON.stringify(workspaceResponse.body));
  const workspace = workspaceResponse.body;
  assert.equal(workspace.confirmed_failure_specification.failure_specification_id,
    firstRequest.failure_specification.failure_specification_id);
  assert.equal(workspace.agent_revision.revision_id, revisionId);
  assert.equal(workspace.redacted_reproduction_bundle.content.case_id, caseId);
  assert.deepEqual(workspace.trace_references, firstRequest.trace_references);
  assert.equal(workspace.model_provider_credentials_supplied_by_alphonse, false);

  const wrongWorker = await agentCommand(repairWorkerToken, "/diagnostic/v0/diagnosis-proposals",
    "v02-ticket12-wrong-worker", "diagnostic.diagnosis_proposal.submit",
    { request_id: firstRequest.request_id, diagnosis: diagnosis(workspace) });
  assert.equal(wrongWorker.response.status, 403);
  const ownerAsWorker = await ownerCommand("/diagnostic/v0/diagnosis-proposals", "v02-ticket12-owner-output",
    "diagnostic.diagnosis_proposal.submit", { request_id: firstRequest.request_id, diagnosis: diagnosis(workspace) });
  assert.equal(ownerAsWorker.response.status, 401);

  const invalid = diagnosis(workspace);
  invalid.provenance.provider_token = "provider-secret-must-not-persist";
  const rejected = await agentCommand(diagnosisWorkerToken, "/diagnostic/v0/diagnosis-proposals",
    "v02-ticket12-invalid", "diagnostic.diagnosis_proposal.submit",
    { request_id: firstRequest.request_id, diagnosis: invalid });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.error.code, "SENSITIVE_DIAGNOSIS_REJECTED");

  const first = await agentCommand(diagnosisWorkerToken, "/diagnostic/v0/diagnosis-proposals",
    "v02-ticket12-submit-a", "diagnostic.diagnosis_proposal.submit",
    { request_id: firstRequest.request_id, diagnosis: diagnosis(workspace, "customer-model-a") });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  const replay = await agentCommand(diagnosisWorkerToken, "/diagnostic/v0/diagnosis-proposals",
    "v02-ticket12-submit-a", "diagnostic.diagnosis_proposal.submit",
    { request_id: firstRequest.request_id, diagnosis: diagnosis(workspace, "customer-model-a") });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.diagnosis_proposal.proposal_id, first.body.diagnosis_proposal.proposal_id);
  const changedModel = await agentCommand(diagnosisWorkerToken, "/diagnostic/v0/diagnosis-proposals",
    "v02-ticket12-submit-b", "diagnostic.diagnosis_proposal.submit",
    { request_id: firstRequest.request_id, diagnosis: diagnosis(workspace, "customer-model-b") });
  assert.equal(changedModel.response.status, 201, JSON.stringify(changedModel.body));
  assert.notEqual(changedModel.body.diagnosis_proposal.proposal_digest, first.body.diagnosis_proposal.proposal_digest);

  const changedInstructionRequest = await createRequest(2, "Reassess using only contradictory evidence.");
  assert.notEqual(changedInstructionRequest.request_digest, firstRequest.request_digest);
  assert.notEqual(changedInstructionRequest.instruction_digest, firstRequest.instruction_digest);
  const changedWorkspaceResponse = await request(
    `/diagnostic/v0/diagnosis-requests/${changedInstructionRequest.request_id}/workspace`, {
      headers: { authorization: `Agent ${diagnosisWorkerToken}` }
    });
  assert.equal(changedWorkspaceResponse.response.status, 200, JSON.stringify(changedWorkspaceResponse.body));
  const lowQuality = diagnosis(changedWorkspaceResponse.body, "customer-model-a");
  lowQuality.inferences = [];
  lowQuality.hypotheses = [];
  lowQuality.uncertainties = ["No useful causal analysis was produced."];
  lowQuality.recommended_investigation = [];
  const ignored = await agentCommand(diagnosisWorkerToken, "/diagnostic/v0/diagnosis-proposals",
    "v02-ticket12-submit-ignored", "diagnostic.diagnosis_proposal.submit",
    { request_id: changedInstructionRequest.request_id, diagnosis: lowQuality });
  assert.equal(ignored.response.status, 201, JSON.stringify(ignored.body));
  assert.equal(ignored.body.diagnosis_proposal.projection.usefulness, "unreviewed");

  const accepted = await ownerCommand(
    `/diagnostic/v0/diagnosis-proposals/${first.body.diagnosis_proposal.proposal_id}/reviews`,
    "v02-ticket12-accept", "diagnostic.diagnosis_proposal.review", {
      proposal_id: first.body.diagnosis_proposal.proposal_id, decision: "accepted",
      rationale: "Useful direction for Builder investigation; not a truth decision."
    });
  assert.equal(accepted.response.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.diagnosis_proposal.projection.usefulness, "accepted");
  assert.equal(accepted.body.diagnosis_proposal.projection.demonstrated_failure_truth, "unchanged");
  const rejectedReview = await ownerCommand(
    `/diagnostic/v0/diagnosis-proposals/${changedModel.body.diagnosis_proposal.proposal_id}/reviews`,
    "v02-ticket12-reject", "diagnostic.diagnosis_proposal.review", {
      proposal_id: changedModel.body.diagnosis_proposal.proposal_id, decision: "rejected",
      rationale: "Not useful enough; deterministic evidence remains unchanged."
    });
  assert.equal(rejectedReview.body.diagnosis_proposal.projection.usefulness, "rejected");
  assert.equal(ignored.body.diagnosis_proposal.projection.demonstrated_failure_truth, "unchanged");

  const failedRequest = await createRequest(3, "Attempt diagnosis but report customer-worker failure.");
  const failed = await agentCommand(diagnosisWorkerToken,
    `/diagnostic/v0/diagnosis-requests/${failedRequest.request_id}/fail`, "v02-ticket12-fail",
    "diagnostic.diagnosis_request.fail", { request_id: failedRequest.request_id, reason: "customer model unavailable" });
  assert.equal(failed.body.diagnosis_request.projection.state, "failed");
  const expiringRequest = await createRequest(4, "Expire without model output.",
    new Date(Date.now() + 1100).toISOString());
  await new Promise((resolve) => setTimeout(resolve, 1300));
  const expired = await request(`/diagnostic/v0/diagnosis-requests/${expiringRequest.request_id}`);
  assert.equal(expired.body.diagnosis_request.projection.state, "expired");

  const after = (await request(`/diagnostic/v0/cases/${caseId}`)).body.diagnostic_case;
  assert.deepEqual(after, before);
  const dump = compose("exec", "-T", "postgres", "sh", "-lc",
    "PGPASSWORD=local-diagnostic-only pg_dump -U alphonse_diagnostic -d alphonse_diagnostic --data-only").stdout;
  assert.doesNotMatch(dump, /provider-secret-must-not-persist/);
  assert.doesNotMatch(dump, new RegExp(diagnosisWorkerToken));
  assert.equal(sql("alphonse_kernel", "alphonse", "local-development-only", "select count(*) from kernel_runs"), "0");

  passed = true;
  console.log(JSON.stringify({ ticket: "v0.2-12", exact_sources_received: true,
    distinct_diagnostic_worker: true, immutable_model_and_instruction_variants: true,
    invalid_timeout_and_failure_non_blocking: true, builder_accept_reject_ignore: true,
    deterministic_case_unchanged: true, provider_credentials_stored: false,
    independent_verification_claimed: false, automatic_repair: false, kernel_runs_created: 0, aws_activity: false }, null, 2));
} finally {
  if (!passed) {
    try { console.error(compose("logs", "--no-color", "postgres", "diagnostic-bootstrap", "kernel", "n8n-runtime-adapter").stdout); } catch {}
  }
  try { compose("down", "--volumes", "--remove-orphans"); } catch {}
  delete process.env.ALPHONSE_TICKET05_KEEP_STACK;
}
