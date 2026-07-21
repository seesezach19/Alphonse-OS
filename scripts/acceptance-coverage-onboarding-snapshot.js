import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Digest } from "../src/canonical-json.js";
import { createContentAddressedArtifactStore } from "../src/content-addressed-artifact-store.js";
import { WORKFLOW_DISCOVERY_EXCLUDED_FIELDS } from "../src/coverage-onboarding-contracts.js";
import { createCoverageOnboardingService } from "../src/coverage-onboarding-service.js";
import { createCoverageReconciliationService } from "../src/coverage-reconciliation-service.js";
import { createDatabase } from "../src/database.js";
import { createDiagnosticDatabase } from "../src/diagnostic-database.js";
import { KernelError } from "../src/errors.js";
import { createIdentityIntentService } from "../src/identity-intent-service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = `alphonse-coverage-onboarding-${process.pid}`;
const port = "45526";
const installationId = "00000000-0000-4000-8000-00000000a001";
const environmentId = "00000000-0000-4000-8000-000000000001";
const bootstrapSubject = "coverage-onboarding-component-owner";
const agentToken = "coverage-onboarding-agent-token-0000000000000001";
const kernelUrl = `postgresql://alphonse:local-development-only@127.0.0.1:${port}/alphonse_kernel`;
const diagnosticUrl = `postgresql://alphonse_diagnostic:local-diagnostic-only@127.0.0.1:${port}/alphonse_diagnostic`;
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  POSTGRES_PORT: port
};
let passed = false;
let artifactRoot;
let kernelDatabase;
let diagnosticDatabase;

function run(command, args, { allowFailure = false, timeout = 8 * 60_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function compose(...args) {
  return run("docker", ["compose", "-f", "compose.yaml", ...args]);
}

function command(commandId, operationId, input) {
  return { command_id: commandId, operation_id: operationId, input };
}

function candidateMaterial({ name = "Inventory workflow", revision = "revision-1",
  updatedAt = "2026-07-21T16:01:00.000Z" } = {}) {
  return {
    provider_workflow_id: "InventoryDefect1",
    display_name: name,
    active: true,
    created_at: "2026-07-21T16:00:00.000Z",
    updated_at: updatedAt,
    provider_revision_reference: revision,
    tags: [{
      id: "tag-1",
      name: "inventory",
      content_class: "untrusted_provider_metadata",
      instruction_authority: "none"
    }]
  };
}

function inventoryPage({ name, revision, updatedAt, pageSeed = "a" } = {}) {
  const material = candidateMaterial({ name, revision, updatedAt });
  return {
    schema_version: "alphonse.workflow-inventory-page.v0.1",
    scope: {
      scope_id: "n8n:customer-primary",
      provider: "n8n",
      environment: "customer-local",
      scope_basis: "credential_access",
      scope_digest: `sha256:${"1".repeat(64)}`
    },
    candidates: [{
      ...material,
      metadata_digest: sha256Digest(material),
      content_class: "untrusted_provider_metadata",
      instruction_authority: "none",
      omitted_fields: [...WORKFLOW_DISCOVERY_EXCLUDED_FIELDS]
    }],
    page: {
      current_cursor: null,
      next_cursor: null,
      item_count: 1,
      scope_complete: true,
      source_cutoff: "2026-07-21T16:02:00.000Z",
      page_digest: `sha256:${pageSeed.repeat(64)}`
    },
    omissions: [{
      code: "WORKFLOW_CONTENT_EXCLUDED",
      count: 1,
      fields: [...WORKFLOW_DISCOVERY_EXCLUDED_FIELDS]
    }],
    health: { status: "healthy", observed_at: "2026-07-21T16:02:00.000Z", issues: [] },
    authority: "none"
  };
}

function service(identityIntent, artifactStore, inventoryClient) {
  return createCoverageOnboardingService({
    database: diagnosticDatabase,
    artifactStore,
    identityIntent,
    inventoryClient,
    installationId,
    environmentId,
    runtimeAdapter: {
      adapter_id: "alphonse.n8n.runtime",
      adapter_version: "0.4.0",
      contract_version: "0.4.0"
    }
  });
}

function execution(id, overrides = {}) {
  const material = {
    provider_execution_id: String(id),
    provider_workflow_id: "InventoryDefect1",
    provider_status: "success",
    execution_class: "production",
    provider_mode: "webhook",
    retry_of: null,
    retry_success_id: null,
    started_at: "2026-07-21T17:00:00.000Z",
    stopped_at: "2026-07-21T17:00:01.000Z",
    wait_until: null,
    revision: {
      status: "matched",
      provider_workflow_version_id: "revision-2",
      execution_workflow_material_digest: `sha256:${"a".repeat(64)}`,
      binding_digest: `sha256:${"b".repeat(64)}`
    },
    ...overrides
  };
  return { ...material, observation_digest: sha256Digest(material), authority: "none" };
}

function executionHistoryPage({ currentCursor = null, nextCursor = null, pageIndex = 0,
  cutoff, executions, omissions = [] }) {
  const normalized = {
    schema_version: "alphonse.workflow-execution-history-page.v0.1",
    scope: { scope_id: "n8n:customer-primary", provider: "n8n",
      environment: "customer-local", provider_workflow_id: "InventoryDefect1",
      scope_digest: `sha256:${"1".repeat(64)}` },
    executions,
    page: { current_cursor: currentCursor, next_cursor: nextCursor, page_index: pageIndex,
      item_count: executions.length, scope_complete: nextCursor === null, source_cutoff: cutoff },
    omissions,
    health: { status: "healthy", observed_at: cutoff, issues: [] },
    completeness: { basis: "credential_scoped_public_api_cursor_walk",
      embedded_signals_are_completeness_proof: false,
      provider_retention_and_deletion_visible_as_limitations: true },
    authority: "none"
  };
  return { ...normalized, page: { ...normalized.page, page_digest: sha256Digest(normalized) } };
}

function reconciliationCommand(commandId, identity, onboardingId, projection) {
  return {
    schema_version: "alphonse.coverage-reconciliation-command.v0.1",
    command_id: commandId,
    operation_id: "diagnostic.coverage_reconciliation.advance",
    input: { onboarding_id: onboardingId, passport_id: identity.authenticated.passport_id,
      expected_reconciliation_revision: projection.revision,
      expected_cycle_id: projection.active_cycle?.cycle_id ?? null, page_size: 2 }
  };
}

async function openDatabases() {
  kernelDatabase = createDatabase(kernelUrl);
  await kernelDatabase.migrate();
  await kernelDatabase.bootstrapEnvironment(
    installationId, "Coverage Component", environmentId, "Coverage Component", "development"
  );
  diagnosticDatabase = createDiagnosticDatabase(diagnosticUrl);
  await diagnosticDatabase.migrate();
  await diagnosticDatabase.bootstrapNode(installationId);
}

async function closeDatabases() {
  await diagnosticDatabase?.close();
  await kernelDatabase?.close();
  diagnosticDatabase = null;
  kernelDatabase = null;
}

async function seedIdentity(identityIntent) {
  const human = await identityIntent.createPrincipal(command(
    "coverage-human", "kernel.principal.create",
    { principal_type: "human", display_name: "Coverage Owner" }
  ));
  const agent = await identityIntent.createPrincipal(command(
    "coverage-agent", "kernel.principal.create",
    { principal_type: "agent", display_name: "Coverage Agent" }
  ));
  const now = Date.now();
  const passport = await identityIntent.issuePassport(command(
    "coverage-passport", "kernel.agent_passport.issue", {
      agent_principal_id: agent.result.principal.principal_id,
      sponsor_principal_id: human.result.principal.principal_id,
      runtime: { name: "coverage-component", version: "1.0.0" },
      model_configuration: { provider: "fixture", model: "none" },
      package_skill_configuration: { protocol: "coverage-onboarding-v0.1" },
      agent_authentication_token: agentToken,
      permitted_intent_classes: ["workflow_coverage_onboarding"],
      provenance: { component: "coverage-onboarding-acceptance" },
      valid_from: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 60 * 60_000).toISOString()
    }
  ));
  const authenticated = await identityIntent.authenticateAgent(agentToken);
  const proposal = await identityIntent.proposeIntent(command(
    "coverage-intent-proposal", "kernel.work_intent.propose", {
      passport_id: authenticated.passport_id,
      intent_class: "workflow_coverage_onboarding",
      objective: "Freeze exact discovery evidence for one existing n8n workflow.",
      requested_outcome: "One immutable authority-free Workflow Discovery Snapshot.",
      scope: {
        kind: "workflow_coverage_onboarding",
        environment_id: environmentId,
        system: "n8n",
        environment: "customer-local",
        provider_workflow_id: "InventoryDefect1"
      },
      constraints: {
        provider_access_custody: "adapter_only",
        external_effects: "prohibited",
        registration: "prohibited"
      }
    }
  ), authenticated);
  const intent = await identityIntent.confirmIntent(command(
    "coverage-intent-confirm", "kernel.work_intent.confirm", {}
  ), proposal.result.proposal.proposal_id);
  assert.equal(passport.result.passport.passport_id, authenticated.passport_id);
  return {
    authenticated,
    agentPrincipalId: agent.result.principal.principal_id,
    workIntentId: intent.result.work_intent.work_intent_id
  };
}

function openInput(identity) {
  return {
    environment_id: environmentId,
    reason: "initial_coverage",
    prior_onboarding_id: null,
    work_intent_id: identity.workIntentId,
    passport_id: identity.authenticated.passport_id,
    agent_principal_id: identity.agentPrincipalId,
    workflow_reference: {
      system: "n8n", environment: "customer-local", provider_workflow_id: "InventoryDefect1"
    },
    adapter_binding: {
      adapter_id: "alphonse.n8n.runtime",
      adapter_version: "0.4.0",
      contract_version: "0.4.0",
      inventory_scope_id: "n8n:customer-primary",
      inventory_scope_digest: `sha256:${"1".repeat(64)}`
    }
  };
}

function captureInput(identity, onboardingId, revision, page) {
  return {
    onboarding_id: onboardingId,
    passport_id: identity.authenticated.passport_id,
    expected_revision: revision,
    inventory_request: { scope_id: "n8n:customer-primary", page_size: 100, cursor: null },
    selection: {
      provider_workflow_id: "InventoryDefect1",
      expected_scope_digest: page.scope.scope_digest,
      expected_page_digest: page.page.page_digest,
      expected_metadata_digest: page.candidates[0].metadata_digest
    },
    redaction_policy_id: "alphonse.workflow-discovery-redaction.v0.1"
  };
}

compose("down", "--volumes", "--remove-orphans");

try {
  compose("up", "--build", "-d", "--wait", "postgres");
  compose("run", "--rm", "diagnostic-bootstrap");
  artifactRoot = await mkdtemp(path.join(os.tmpdir(), "alphonse-coverage-onboarding-"));
  await openDatabases();
  let identityIntent = createIdentityIntentService(
    kernelDatabase, installationId, environmentId, bootstrapSubject
  );
  const identity = await seedIdentity(identityIntent);
  let page = inventoryPage({ pageSeed: "a" });
  let inventoryReads = 0;
  const inventoryClient = { async list() { inventoryReads += 1; return structuredClone(page); } };
  let historyReads = 0;
  const historyPlan = [];
  const historyClient = { async list(input) {
    historyReads += 1;
    const next = historyPlan.shift();
    assert.ok(next, "unexpected execution-history read");
    return next(input);
  } };
  let artifactStore = createContentAddressedArtifactStore(artifactRoot);
  let onboardingService = service(identityIntent, artifactStore, inventoryClient);

  const opened = await onboardingService.open(command(
    "coverage-open", "diagnostic.coverage_onboarding.open", openInput(identity)
  ), identity.authenticated);
  assert.equal(opened.replayed, false);
  assert.equal(opened.result.coverage_onboarding.revision, 1);
  assert.equal(opened.result.coverage_onboarding.status, "gathering_evidence");
  assert.equal(opened.result.coverage_onboarding.authority.registration, "not_granted");
  const onboardingId = opened.result.coverage_onboarding.onboarding_id;

  const openReplay = await onboardingService.open(command(
    "coverage-open", "diagnostic.coverage_onboarding.open", openInput(identity)
  ), identity.authenticated);
  assert.equal(openReplay.replayed, true);
  await assert.rejects(() => onboardingService.open(command(
    "coverage-open", "diagnostic.coverage_onboarding.open", {
      ...openInput(identity), workflow_reference: {
        ...openInput(identity).workflow_reference, provider_workflow_id: "changed"
      }
    }
  ), identity.authenticated), (error) => error.code === "IDEMPOTENCY_CONFLICT");

  await closeDatabases();
  await openDatabases();
  identityIntent = createIdentityIntentService(kernelDatabase, installationId, environmentId, bootstrapSubject);
  const resumedPassport = await identityIntent.authenticateAgent(agentToken);
  artifactStore = createContentAddressedArtifactStore(artifactRoot);
  onboardingService = service(identityIntent, artifactStore, inventoryClient);
  const resumed = await onboardingService.get(onboardingId);
  assert.equal(resumed.event_head_digest, opened.result.coverage_onboarding.event_head_digest);
  assert.equal(resumed.revision, 1);

  const captureOneCommand = command(
    "coverage-capture-one", "diagnostic.coverage_onboarding.evidence_capture",
    captureInput(identity, onboardingId, 1, page)
  );
  const captured = await onboardingService.captureEvidence(captureOneCommand, resumedPassport);
  assert.equal(captured.result.coverage_onboarding.revision, 2);
  assert.equal(captured.result.coverage_onboarding.status, "interpreting");
  assert.equal(captured.result.workflow_discovery_snapshot.authority, "none");
  assert.equal(captured.result.material_replaced, false);
  const firstDigest = captured.result.workflow_discovery_snapshot.artifact_digest;
  const replay = await onboardingService.captureEvidence(captureOneCommand, resumedPassport);
  assert.equal(replay.replayed, true);
  assert.equal(inventoryReads, 1, "replay must not re-read the provider");
  await assert.rejects(() => onboardingService.captureEvidence({
    ...captureOneCommand,
    input: { ...captureOneCommand.input, expected_revision: 2 }
  }, resumedPassport), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(inventoryReads, 1, "changed command conflict must precede provider access");

  page = inventoryPage({
    name: "Inventory workflow v2",
    revision: "revision-2",
    updatedAt: "2026-07-21T16:03:00.000Z",
    pageSeed: "b"
  });
  const recaptured = await onboardingService.captureEvidence(command(
    "coverage-capture-two", "diagnostic.coverage_onboarding.evidence_capture",
    captureInput(identity, onboardingId, 2, page)
  ), resumedPassport);
  const secondDigest = recaptured.result.workflow_discovery_snapshot.artifact_digest;
  assert.notEqual(secondDigest, firstDigest);
  assert.equal(recaptured.result.material_replaced, true);
  assert.equal(recaptured.result.coverage_onboarding.revision, 3);
  assert.deepEqual(recaptured.result.coverage_onboarding.superseded_snapshot_digests, [firstDigest]);
  assert.equal(recaptured.result.coverage_onboarding.events.at(-1).payload.prior_material_eligible, false);
  assert.equal((await artifactStore.getJson(firstDigest)).content.selected_workflow.display_name,
    "Inventory workflow");
  assert.equal((await artifactStore.getJson(secondDigest)).content.selected_workflow.display_name,
    "Inventory workflow v2");

  let reconciliationService = createCoverageReconciliationService({
    database: diagnosticDatabase, artifactStore, coverageOnboardingService: onboardingService,
    historyClient, installationId, environmentId
  });
  const cutoffOne = "2026-07-21T18:00:00.000Z";
  const cursorOne = "signed-cycle-one-page-one";
  historyPlan.push((input) => {
    assert.equal(input.cursor, null);
    return executionHistoryPage({ cutoff: cutoffOne, nextCursor: cursorOne,
      executions: [execution(101), execution(102, { execution_class: "manual", provider_mode: "manual" })] });
  });
  let projection = await reconciliationService.get(onboardingId);
  const firstPageCommand = reconciliationCommand(
    "coverage-reconcile-cycle-one-page-zero", identity, onboardingId, projection
  );
  const firstPage = await reconciliationService.advance(firstPageCommand, resumedPassport);
  assert.equal(firstPage.result.coverage_reconciliation.status, "backfilling");
  assert.equal(firstPage.result.coverage_reconciliation.current_coverage.state, "unavailable");
  assert.equal((await reconciliationService.advance(firstPageCommand, resumedPassport)).replayed, true);
  assert.equal(historyReads, 1, "command replay must not re-read provider history");

  historyPlan.push((input) => {
    assert.equal(input.cursor, cursorOne);
    return executionHistoryPage({ cutoff: cutoffOne, currentCursor: cursorOne, pageIndex: 1,
      executions: [execution(103, { execution_class: "retry", provider_mode: "retry",
        retry_of: "101" })] });
  });
  projection = firstPage.result.coverage_reconciliation;
  const completed = await reconciliationService.advance(reconciliationCommand(
    "coverage-reconcile-cycle-one-page-one", identity, onboardingId, projection
  ), resumedPassport);
  projection = completed.result.coverage_reconciliation;
  assert.equal(projection.revision, 4);
  assert.equal(projection.current_coverage.state, "active");
  assert.equal(projection.latest_completed_cycle.production_execution_count, 2);
  assert.equal(projection.latest_completed_cycle.matched_revision_execution_count, 2);
  assert.match(projection.reconciler.artifact_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(projection.events.at(-1).payload.limitations.some((item) =>
    item.code === "coverage.reconciliation.non_production_excluded"));

  await new Promise((resolve) => setTimeout(resolve, 5));
  historyPlan.push(() => { throw new KernelError(502, "COVERAGE_RECONCILIATION_READ_FAILED",
    "fixture provider outage"); });
  const outage = await reconciliationService.advance(reconciliationCommand(
    "coverage-reconcile-provider-outage", identity, onboardingId, projection
  ), resumedPassport);
  projection = outage.result.coverage_reconciliation;
  assert.equal(outage.result.degraded, true);
  assert.equal(projection.status, "degraded");
  assert.equal(projection.current_coverage.state, "suspended");
  assert.equal(projection.active_cycle, null);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const cutoffTwo = "2026-07-21T18:10:00.000Z";
  historyPlan.push((input) => {
    assert.equal(input.cursor, null);
    return executionHistoryPage({ cutoff: cutoffTwo,
      executions: [execution(101, { revision: { status: "mismatched",
        provider_workflow_version_id: "revision-drifted",
        execution_workflow_material_digest: `sha256:${"d".repeat(64)}`,
        binding_digest: `sha256:${"b".repeat(64)}` } }),
      execution(103, { execution_class: "retry", provider_mode: "retry", retry_of: "101" })] });
  });
  const drift = await reconciliationService.advance(reconciliationCommand(
    "coverage-reconcile-drift", identity, onboardingId, projection
  ), resumedPassport);
  projection = drift.result.coverage_reconciliation;
  assert.equal(projection.current_coverage.state, "suspended");
  assert.equal(projection.latest_completed_cycle.assessment, "suspended");
  assert.equal(projection.latest_completed_cycle.mismatched_revision_execution_count, 1);
  assert.ok(projection.events.at(-1).payload.gaps.some((item) =>
    item.code === "coverage.reconciliation.revision_drift"));
  assert.ok(projection.events.at(-1).payload.gaps.some((item) =>
    item.code === "coverage.reconciliation.provider_history_absence"));

  await new Promise((resolve) => setTimeout(resolve, 5));
  const cutoffThree = "2026-07-21T18:20:00.000Z";
  historyPlan.push(() => executionHistoryPage({ cutoff: cutoffThree,
    executions: [execution(101),
      execution(103, { execution_class: "retry", provider_mode: "retry", retry_of: "101" })] }));
  const persistentDeletion = await reconciliationService.advance(reconciliationCommand(
    "coverage-reconcile-persistent-deletion", identity, onboardingId, projection
  ), resumedPassport);
  projection = persistentDeletion.result.coverage_reconciliation;
  assert.equal(projection.revision, 11);
  assert.equal(projection.current_coverage.state, "degraded");
  assert.ok(projection.events.at(-1).payload.gaps.some((item) =>
    item.code === "coverage.reconciliation.provider_history_absence"));

  await new Promise((resolve) => setTimeout(resolve, 5));
  const cutoffFour = "2026-07-21T18:30:00.000Z";
  historyPlan.push(() => executionHistoryPage({ cutoff: cutoffFour,
    executions: [execution(101),
      execution(102, { execution_class: "manual", provider_mode: "manual" }),
      execution(103, { execution_class: "retry", provider_mode: "retry", retry_of: "101" })] }));
  const recoveredCoverage = await reconciliationService.advance(reconciliationCommand(
    "coverage-reconcile-recovery", identity, onboardingId, projection
  ), resumedPassport);
  projection = recoveredCoverage.result.coverage_reconciliation;
  assert.equal(projection.revision, 14);
  assert.equal(projection.current_coverage.state, "active");
  assert.equal(projection.latest_completed_cycle.assessment, "active");
  assert.ok(projection.events.at(-1).payload.limitations.some((item) =>
    item.code === "coverage.reconciliation.late_fill"));
  assert.ok(projection.coverage_intervals.some((item) => item.state === "active"));
  assert.ok(projection.coverage_intervals.some((item) => item.state === "suspended"));
  assert.ok(projection.coverage_intervals.every((item) => item.immutable
    && item.end_exclusive && item.interval_digest));
  assert.equal(historyPlan.length, 0);
  assert.equal(historyReads, 6);

  await assert.rejects(() => diagnosticDatabase.pool.query(
    `UPDATE diagnostic_coverage_reconciliation_events SET payload='{}'::jsonb
     WHERE installation_id=$1 AND onboarding_id=$2`, [installationId, onboardingId]
  ), /immutable records cannot be updated or deleted/);
  await assert.rejects(() => diagnosticDatabase.pool.query(
    `DELETE FROM diagnostic_coverage_execution_observations
     WHERE installation_id=$1 AND onboarding_id=$2`, [installationId, onboardingId]
  ), /immutable records cannot be updated or deleted/);

  page = inventoryPage({ name: "Bearer must-not-persist", revision: "revision-3", pageSeed: "c" });
  await assert.rejects(() => onboardingService.captureEvidence(command(
    "coverage-capture-secret", "diagnostic.coverage_onboarding.evidence_capture",
    captureInput(identity, onboardingId, 3, page)
  ), resumedPassport), (error) => error.code === "COVERAGE_ONBOARDING_SENSITIVE_MATERIAL_REJECTED");
  const eventCount = await diagnosticDatabase.pool.query(
    `SELECT count(*) FROM diagnostic_coverage_onboarding_events
     WHERE installation_id=$1 AND onboarding_id=$2`, [installationId, onboardingId]
  );
  const artifactCount = await diagnosticDatabase.pool.query(
    `SELECT count(*) FROM diagnostic_workflow_discovery_snapshots
     WHERE installation_id=$1 AND onboarding_id=$2`, [installationId, onboardingId]
  );
  assert.equal(eventCount.rows[0].count, "3");
  assert.equal(artifactCount.rows[0].count, "2");
  await assert.rejects(() => diagnosticDatabase.pool.query(
    `UPDATE diagnostic_coverage_onboarding_events SET payload='{}'::jsonb
     WHERE installation_id=$1 AND onboarding_id=$2`, [installationId, onboardingId]
  ), /immutable records cannot be updated or deleted/);

  const headBeforeRestart = recaptured.result.coverage_onboarding.event_head_digest;
  await closeDatabases();
  await openDatabases();
  identityIntent = createIdentityIntentService(kernelDatabase, installationId, environmentId, bootstrapSubject);
  artifactStore = createContentAddressedArtifactStore(artifactRoot);
  onboardingService = service(identityIntent, artifactStore, inventoryClient);
  reconciliationService = createCoverageReconciliationService({
    database: diagnosticDatabase, artifactStore, coverageOnboardingService: onboardingService,
    historyClient, installationId, environmentId
  });
  const recovered = await onboardingService.get(onboardingId);
  assert.equal(recovered.event_head_digest, headBeforeRestart);
  assert.equal(recovered.active_snapshot_digest, secondDigest);
  assert.equal(recovered.snapshot_history.length, 2);
  assert.equal(recovered.authority.coverage_claim, "not_granted");
  const recoveredReconciliation = await reconciliationService.get(onboardingId);
  assert.equal(recoveredReconciliation.revision, 14);
  assert.equal(recoveredReconciliation.current_coverage.state, "active");
  assert.equal(recoveredReconciliation.execution_observation_count, 10);
  assert.ok(recoveredReconciliation.coverage_intervals.some((item) => item.state === "suspended"));
  const kernelRuns = await kernelDatabase.pool.query("SELECT count(*) FROM kernel_runs");
  assert.equal(kernelRuns.rows[0].count, "0");

  passed = true;
  console.log(JSON.stringify({
    proof: "coverage-onboarding-snapshot",
    fresh_database: true,
    pause_resume_recovered: true,
    restart_recovered: true,
    provider_reads_total_including_two_captures_and_one_rejected_secret: inventoryReads,
    execution_history_reads: historyReads,
    execution_history_completeness_basis: "credential_scoped_public_api_cursor_walk",
    embedded_signals_are_completeness_proof: false,
    reconciliation_revision: 14,
    immutable_execution_observations: recoveredReconciliation.execution_observation_count,
    provider_outage_suspended_coverage: true,
    revision_drift_suspended_coverage: true,
    completed_reconciliation_reactivated_coverage: true,
    historical_coverage_loss_preserved: true,
    replay_added_provider_reads: false,
    changed_command_conflict_before_provider_read: true,
    immutable_snapshots_preserved: 2,
    stale_snapshot_visible: firstDigest,
    active_snapshot: secondDigest,
    secret_shaped_material_admitted: false,
    kernel_runs_created: 0,
    external_effects: 0,
    registration_authority: false
  }, null, 2));
} finally {
  await closeDatabases().catch(() => {});
  if (artifactRoot) await rm(artifactRoot, { recursive: true, force: true });
  if (!passed) {
    try { console.error(compose("logs", "--no-color", "postgres", "diagnostic-bootstrap").stdout); } catch {}
  }
  try { compose("down", "--volumes", "--remove-orphans"); } catch {}
}
