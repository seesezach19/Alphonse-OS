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
import { createDatabase } from "../src/database.js";
import { createDiagnosticDatabase } from "../src/diagnostic-database.js";
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
      adapter_version: "0.3.0",
      contract_version: "0.3.0"
    }
  });
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
      adapter_version: "0.3.0",
      contract_version: "0.3.0",
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
  const recovered = await onboardingService.get(onboardingId);
  assert.equal(recovered.event_head_digest, headBeforeRestart);
  assert.equal(recovered.active_snapshot_digest, secondDigest);
  assert.equal(recovered.snapshot_history.length, 2);
  assert.equal(recovered.authority.coverage_claim, "not_granted");
  const kernelRuns = await kernelDatabase.pool.query("SELECT count(*) FROM kernel_runs");
  assert.equal(kernelRuns.rows[0].count, "0");

  passed = true;
  console.log(JSON.stringify({
    proof: "coverage-onboarding-snapshot",
    fresh_database: true,
    pause_resume_recovered: true,
    restart_recovered: true,
    provider_reads_total_including_two_captures_and_one_rejected_secret: inventoryReads,
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
