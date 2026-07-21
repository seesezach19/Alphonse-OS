import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  assertNoSensitiveMaterial,
  buildCoverageOnboardingEvent,
  buildWorkflowDiscoverySnapshot,
  projectCoverageOnboarding,
  validateCoverageEvidenceCaptureCommand,
  validateCoverageOnboardingOpenCommand,
  validateWorkflowInventoryPage,
  WORKFLOW_DISCOVERY_EXCLUDED_FIELDS
} from "../../src/coverage-onboarding-contracts.js";
import { createCoverageInventoryClient } from "../../src/coverage-onboarding-service.js";

const ids = {
  environment: "00000000-0000-4000-8000-000000000001",
  onboarding: "00000000-0000-4000-8000-000000000601",
  workIntent: "00000000-0000-4000-8000-000000000602",
  passport: "00000000-0000-4000-8000-000000000603",
  agent: "00000000-0000-4000-8000-000000000604"
};
const scopeDigest = `sha256:${"a".repeat(64)}`;
const pageDigest = `sha256:${"b".repeat(64)}`;

function metadata(name = "Inventory workflow") {
  return {
    provider_workflow_id: "InventoryDefect1",
    display_name: name,
    active: true,
    created_at: "2026-07-21T16:00:00.000Z",
    updated_at: "2026-07-21T16:01:00.000Z",
    provider_revision_reference: "revision-1",
    tags: [{
      id: "tag-1",
      name: "inventory",
      content_class: "untrusted_provider_metadata",
      instruction_authority: "none"
    }]
  };
}

function inventoryPage(name = "Inventory workflow") {
  const material = metadata(name);
  return {
    schema_version: "alphonse.workflow-inventory-page.v0.1",
    scope: {
      scope_id: "n8n:customer-primary",
      provider: "n8n",
      environment: "customer-local",
      scope_basis: "credential_access",
      scope_digest: scopeDigest
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
      page_digest: pageDigest
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

function openCommand() {
  return {
    command_id: "coverage-open-1",
    operation_id: "diagnostic.coverage_onboarding.open",
    input: {
      environment_id: ids.environment,
      reason: "initial_coverage",
      prior_onboarding_id: null,
      work_intent_id: ids.workIntent,
      passport_id: ids.passport,
      agent_principal_id: ids.agent,
      workflow_reference: {
        system: "n8n", environment: "customer-local", provider_workflow_id: "InventoryDefect1"
      },
      adapter_binding: {
        adapter_id: "alphonse.n8n.runtime",
        adapter_version: "0.3.0",
        contract_version: "0.3.0",
        inventory_scope_id: "n8n:customer-primary",
        inventory_scope_digest: scopeDigest
      }
    }
  };
}

function evidenceCommand(page = inventoryPage()) {
  return {
    command_id: "coverage-capture-1",
    operation_id: "diagnostic.coverage_onboarding.evidence_capture",
    input: {
      onboarding_id: ids.onboarding,
      passport_id: ids.passport,
      expected_revision: 1,
      inventory_request: { scope_id: "n8n:customer-primary", page_size: 100, cursor: null },
      selection: {
        provider_workflow_id: "InventoryDefect1",
        expected_scope_digest: scopeDigest,
        expected_page_digest: page.page.page_digest,
        expected_metadata_digest: page.candidates[0].metadata_digest
      },
      redaction_policy_id: "alphonse.workflow-discovery-redaction.v0.1"
    }
  };
}

function onboarding() {
  return {
    onboarding_id: ids.onboarding,
    workflow_reference: openCommand().input.workflow_reference,
    adapter_binding: openCommand().input.adapter_binding,
    adapter_binding_digest: sha256Digest(openCommand().input.adapter_binding)
  };
}

test("Coverage Onboarding commands are closed, identity-bound, and authority-free", () => {
  assert.deepEqual(validateCoverageOnboardingOpenCommand(openCommand()), openCommand());
  assert.deepEqual(validateCoverageEvidenceCaptureCommand(evidenceCommand()), evidenceCommand());
  assert.throws(() => validateCoverageOnboardingOpenCommand({
    ...openCommand(), input: { ...openCommand().input, register: true }
  }), /fields must be exact/);
  assert.throws(() => validateCoverageOnboardingOpenCommand({
    ...openCommand(), input: { ...openCommand().input, reason: "revision_change" }
  }), /requires one prior onboarding/);
  assert.throws(() => validateCoverageEvidenceCaptureCommand({
    ...evidenceCommand(), input: { ...evidenceCommand().input, redaction_policy_id: "caller-controlled" }
  }), /unsupported/);
});

test("inventory response validation independently verifies metadata and exact trust markers", () => {
  const page = inventoryPage();
  assert.deepEqual(validateWorkflowInventoryPage(page), page);
  assert.throws(() => validateWorkflowInventoryPage({
    ...page,
    candidates: [{ ...page.candidates[0], metadata_digest: `sha256:${"f".repeat(64)}` }]
  }), /does not match exact metadata/);
  assert.throws(() => validateWorkflowInventoryPage({
    ...page,
    candidates: [{ ...page.candidates[0], instruction_authority: "instructions" }]
  }), /outside the discovery contract/);
  assert.throws(() => validateWorkflowInventoryPage({ ...page, provider_api_key: "must-not-persist" }),
    /fields must be exact/);
});

test("discovery snapshot freezes only selected metadata, digest provenance, and explicit redaction", () => {
  const page = inventoryPage();
  const snapshot = buildWorkflowDiscoverySnapshot({
    onboarding: onboarding(), input: evidenceCommand(page).input, inventory: page
  });
  assert.equal(snapshot.schema_version, "alphonse.workflow-discovery-snapshot.v0.1");
  assert.equal(snapshot.selected_workflow.metadata_digest, page.candidates[0].metadata_digest);
  assert.equal(snapshot.source.page_digest, pageDigest);
  assert.equal(snapshot.source.inventory_request.current_cursor_digest, null);
  assert.equal(snapshot.authority, "none");
  assert.equal(snapshot.redaction.provider_credentials_received, false);
  assert.deepEqual(snapshot.redaction.excluded_fields, WORKFLOW_DISCOVERY_EXCLUDED_FIELDS);
  assert.equal(Object.hasOwn(snapshot.selected_workflow, "nodes"), false);
  assert.equal(Object.hasOwn(snapshot.source.inventory_request, "cursor"), false);
  assert.throws(() => buildWorkflowDiscoverySnapshot({
    onboarding: onboarding(),
    input: { ...evidenceCommand(page).input,
      selection: { ...evidenceCommand(page).input.selection, expected_page_digest: `sha256:${"c".repeat(64)}` } },
    inventory: page
  }), /provenance/);
});

test("secret-shaped provider material is rejected before it can become a snapshot", () => {
  assert.throws(() => assertNoSensitiveMaterial({ display_name: "Bearer private-value" }),
    /secret-shaped material/);
  const hostile = inventoryPage("Bearer private-value");
  assert.throws(() => buildWorkflowDiscoverySnapshot({
    onboarding: onboarding(), input: evidenceCommand(hostile).input, inventory: hostile
  }), /secret-shaped material/);
});

test("append-only projection verifies its digest chain and visibly supersedes prior material", () => {
  const row = {
    onboarding_id: ids.onboarding,
    installation_id: "00000000-0000-4000-8000-00000000a001",
    environment_id: ids.environment,
    reason: "initial_coverage",
    prior_onboarding_id: null,
    workflow_reference: openCommand().input.workflow_reference,
    work_intent_id: ids.workIntent,
    work_intent_digest: `sha256:${"d".repeat(64)}`,
    passport_id: ids.passport,
    agent_principal_id: ids.agent,
    adapter_binding: openCommand().input.adapter_binding,
    identity_digest: `sha256:${"e".repeat(64)}`,
    opened_at: "2026-07-21T16:00:00.000Z"
  };
  const actor = { type: "agent", id: ids.agent };
  const first = buildCoverageOnboardingEvent({
    eventId: "00000000-0000-4000-8000-000000000611",
    onboardingId: ids.onboarding,
    eventIndex: 1,
    eventType: "opened",
    priorEventDigest: null,
    payload: { identity_digest: row.identity_digest },
    actor,
    occurredAt: row.opened_at
  });
  const second = buildCoverageOnboardingEvent({
    eventId: "00000000-0000-4000-8000-000000000612",
    onboardingId: ids.onboarding,
    eventIndex: 2,
    eventType: "evidence_captured",
    priorEventDigest: first.event_digest,
    payload: {
      snapshot_digest: `sha256:${"1".repeat(64)}`,
      source_scope_digest: `sha256:${"3".repeat(64)}`,
      source_page_digest: `sha256:${"4".repeat(64)}`,
      selected_metadata_digest: `sha256:${"5".repeat(64)}`
    },
    actor,
    occurredAt: "2026-07-21T16:01:00.000Z"
  });
  const third = buildCoverageOnboardingEvent({
    eventId: "00000000-0000-4000-8000-000000000613",
    onboardingId: ids.onboarding,
    eventIndex: 3,
    eventType: "snapshot_replaced",
    priorEventDigest: second.event_digest,
    payload: {
      snapshot_digest: `sha256:${"2".repeat(64)}`,
      prior_snapshot_digest: `sha256:${"1".repeat(64)}`,
      source_scope_digest: `sha256:${"3".repeat(64)}`,
      source_page_digest: `sha256:${"6".repeat(64)}`,
      selected_metadata_digest: `sha256:${"7".repeat(64)}`
    },
    actor,
    occurredAt: "2026-07-21T16:02:00.000Z"
  });
  const rows = [first, second, third].map((built) => ({
    ...built.document,
    actor_type: built.document.actor.type,
    actor_id: built.document.actor.id,
    event_digest: built.event_digest
  }));
  const snapshots = [
    {
      snapshot_digest: `sha256:${"1".repeat(64)}`,
      source_scope_digest: `sha256:${"3".repeat(64)}`,
      source_page_digest: `sha256:${"4".repeat(64)}`,
      selected_metadata_digest: `sha256:${"5".repeat(64)}`,
      event_index: 2,
      captured_by_actor_type: "agent",
      captured_by_actor_id: ids.agent,
      captured_at: "2026-07-21T16:01:00.000Z"
    },
    {
      snapshot_digest: `sha256:${"2".repeat(64)}`,
      source_scope_digest: `sha256:${"3".repeat(64)}`,
      source_page_digest: `sha256:${"6".repeat(64)}`,
      selected_metadata_digest: `sha256:${"7".repeat(64)}`,
      event_index: 3,
      captured_by_actor_type: "agent",
      captured_by_actor_id: ids.agent,
      captured_at: "2026-07-21T16:02:00.000Z"
    }
  ];
  const projection = projectCoverageOnboarding(row, rows, snapshots);
  assert.equal(projection.revision, 3);
  assert.equal(projection.active_snapshot_digest, `sha256:${"2".repeat(64)}`);
  assert.deepEqual(projection.superseded_snapshot_digests, [`sha256:${"1".repeat(64)}`]);
  assert.equal(projection.status, "interpreting");
  assert.equal(projection.authority.registration, "not_granted");
  assert.throws(() => projectCoverageOnboarding(row, [rows[0], {
    ...rows[1], prior_event_digest: `sha256:${"9".repeat(64)}`
  }]), /discontinuous/);
});

test("inventory client keeps the adapter token at the HTTP edge", async () => {
  let observed;
  const page = inventoryPage();
  const client = createCoverageInventoryClient({
    baseUrl: "http://adapter.test",
    token: "adapter-edge-only-token",
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return { ok: true, status: 200, async json() { return page; } };
    }
  });
  assert.deepEqual(await client.list({ scope_id: "n8n:customer-primary", page_size: 100, cursor: null }), page);
  assert.equal(observed.options.headers.authorization, "Bearer adapter-edge-only-token");
  assert.equal(JSON.stringify(await client.list({
    scope_id: "n8n:customer-primary", page_size: 100, cursor: null
  })).includes("adapter-edge-only-token"), false);
});
