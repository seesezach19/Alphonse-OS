import assert from "node:assert/strict";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  buildCoverageReviewApproval,
  buildCoverageReviewBundle,
  COVERAGE_REVIEW_AUTHORITY_DENIED,
  COVERAGE_REVIEW_AUTHORITY_GRANTED,
  validateCoverageReviewApproveCommand,
  validateCoverageReviewBundleCreateCommand
} from "../../src/coverage-review-contracts.js";

const ids = {
  onboarding: "00000000-0000-4000-8000-000000000801",
  intent: "00000000-0000-4000-8000-000000000802",
  approval: "00000000-0000-4000-8000-000000000803",
  principal: "00000000-0000-4000-8000-000000000804"
};
const snapshotDigest = `sha256:${"a".repeat(64)}`;
const interpretationDigest = `sha256:${"b".repeat(64)}`;
const eventDigest = `sha256:${"c".repeat(64)}`;

function state() {
  return {
    onboarding_id: ids.onboarding,
    revision: 4,
    event_head_digest: eventDigest,
    status: "reviewable",
    review_eligible: true,
    active_snapshot_digest: snapshotDigest,
    active_interpretation_digest: interpretationDigest,
    workflow_reference: { system: "n8n", environment: "customer", provider_workflow_id: "wf-1" },
    adapter_binding: { adapter_id: "n8n", adapter_version: "1", contract_version: "0.1",
      inventory_scope_id: "customer-main", inventory_scope_digest: `sha256:${"d".repeat(64)}` },
    work_intent: { work_intent_id: ids.intent, work_intent_digest: `sha256:${"e".repeat(64)}` },
    ambiguities: [],
    limitations: []
  };
}

function input() {
  return {
    onboarding_id: ids.onboarding,
    expected_revision: 4,
    expected_event_head_digest: eventDigest,
    snapshot_digest: snapshotDigest,
    interpretation_digest: interpretationDigest,
    integration_contract_references: [],
    behavior_contract_references: [],
    fixture_references: [],
    repair_binding_reference: null,
    verification_strategy_reference: null,
    coverage_profile_reference: null
  };
}

const snapshot = {
  schema_version: "alphonse.workflow-discovery-snapshot.v0.1",
  onboarding_id: ids.onboarding,
  provenance: { selected_metadata_digest: `sha256:${"f".repeat(64)}` },
  redaction: { policy_id: "alphonse.workflow-discovery-redaction.v0.1", excluded_fields: ["credentials"] }
};
const interpretation = {
  schema_version: "alphonse.workflow-interpretation-claim.v0.1",
  onboarding_id: ids.onboarding,
  snapshot_digest: snapshotDigest,
  claims: [{ claim_id: "objective.primary", kind: "objective", status: "observed",
    statement: "Process one exact customer workflow.", evidence_references: [], confidence: null,
    conflicting_evidence_references: [], unknown_reason: null, limitations: [] }]
};

test("review bundle command is closed and bundle bytes are deterministic", () => {
  const command = { command_id: "bundle-1",
    operation_id: "diagnostic.coverage_review_bundle.create", input: input() };
  assert.deepEqual(validateCoverageReviewBundleCreateCommand(command), command);
  assert.throws(() => validateCoverageReviewBundleCreateCommand({ ...command,
    input: { ...command.input, execution_authority: true } }), /fields must be exact/);
  const first = buildCoverageReviewBundle({ onboarding: state(), snapshot, interpretation, input: input() });
  const second = buildCoverageReviewBundle({ onboarding: state(), snapshot, interpretation, input: input() });
  assert.deepEqual(first, second);
  assert.equal(sha256Digest(first.document), sha256Digest(second.document));
  assert.equal(first.document.authority, "none");
  assert.equal(first.document.promotion_conditions.status, "not_established");
  const changedInput = { ...input(), fixture_references: [{ reference_kind: "fixture",
    reference_id: "edge-case", artifact_digest: `sha256:${"9".repeat(64)}` }] };
  const changed = buildCoverageReviewBundle({ onboarding: state(), snapshot, interpretation,
    input: changedInput });
  assert.notEqual(sha256Digest(first.document), sha256Digest(changed.document));
});

test("approval binds exact review state and rejects authority expansion", () => {
  const built = buildCoverageReviewBundle({ onboarding: state(), snapshot, interpretation, input: input() });
  const reviewBundleDigest = sha256Digest(built.document);
  const awaiting = { ...state(), revision: 5, status: "awaiting_approval", review_eligible: false,
    event_head_digest: `sha256:${"1".repeat(64)}`, active_review_bundle_digest: reviewBundleDigest };
  const approvalInput = {
    onboarding_id: ids.onboarding,
    review_bundle_digest: reviewBundleDigest,
    expected_review_state: { onboarding_revision: 5, event_head_digest: awaiting.event_head_digest,
      status: "awaiting_approval" },
    work_intent_id: ids.intent,
    scope: { kind: "exact_workflow_and_review_digest", onboarding_id: ids.onboarding,
      workflow_reference_digest: built.document.workflow_reference_digest, review_bundle_digest: reviewBundleDigest },
    rationale: "The exact review bundle is acceptable for compilation.",
    valid_until: "2026-07-22T19:00:00.000Z",
    authority_granted: [...COVERAGE_REVIEW_AUTHORITY_GRANTED],
    authority_denied: [...COVERAGE_REVIEW_AUTHORITY_DENIED]
  };
  const command = { command_id: "approval-1", operation_id: "kernel.coverage_review.approve",
    input: approvalInput };
  assert.deepEqual(validateCoverageReviewApproveCommand(command), command);
  assert.throws(() => validateCoverageReviewApproveCommand({ ...command, input: { ...approvalInput,
    authority_granted: [...COVERAGE_REVIEW_AUTHORITY_GRANTED, "workflow_execution"] } }),
  /exact fixed contract/);
  const approval = buildCoverageReviewApproval({ approvalId: ids.approval,
    bundleState: { review_bundle: { review_bundle_digest: reviewBundleDigest,
      workflow_reference_digest: built.document.workflow_reference_digest, onboarding_id: ids.onboarding },
    onboarding: awaiting }, workIntent: { work_intent_id: ids.intent,
      payload_digest: awaiting.work_intent.work_intent_digest }, input: approvalInput,
    principalId: ids.principal, executedBy: { type: "human", id: "owner" },
    issuedAt: "2026-07-21T19:00:00.000Z" });
  assert.equal(approval.document.principal_id, ids.principal);
  assert.deepEqual(approval.document.authority_granted, COVERAGE_REVIEW_AUTHORITY_GRANTED);
  assert.ok(approval.document.authority_denied.includes("external_effect"));
});
