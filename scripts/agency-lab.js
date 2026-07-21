import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAgencyLabCase } from "../packages/agency-lab/src/case-contract.js";
import { runAgencyLabCase } from "../packages/agency-lab/src/controller.js";
import { createRunWorkspace } from "../packages/agency-lab/src/run-workspace.js";
import {
  buildRunProvenance,
  buildWorkerAssignment,
  writeImmutableJson
} from "../packages/agency-lab/src/run-provenance.js";
import { sha256Digest } from "../src/canonical-json.js";
import { createContentAddressedArtifactStore } from "../src/content-addressed-artifact-store.js";
import { buildReproductionBundle } from "../src/diagnostic-reproduction-contracts.js";
import { normalizeRuntimeEventEnvelope } from "../src/runtime-event-envelope.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIAGNOSIS_INSTRUCTION = "Diagnose the observed operational failure using only assigned worker-visible evidence. " +
  "Return the required structured diagnosis. Do not repair, promote, or create external effects.";

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function repositoryPath(relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Agency Lab path escaped the repository");
  return resolved;
}

function stableUuid(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

async function loadCase(caseFile) {
  const casePath = repositoryPath(caseFile);
  const definition = validateAgencyLabCase(await readJson(casePath));
  const fixture = await readJson(repositoryPath(definition.scenario.input_fixture));
  return { casePath, definition, fixture };
}

function conciseRunReport(definition, result) {
  return {
    status: "failure demonstrated, recovery expectation passed.",
    failure_id: definition.failure_id,
    failure_primitive: definition.failure_primitive,
    expected_response_class: definition.expected_response_class,
    failure_demonstrated: result.failure_demonstrated,
    repaired_passed: result.repaired_passed,
    baseline_invariants: result.invariants.baseline,
    repaired_invariants: result.invariants.repaired
  };
}

function runtimeEvents(definition, fixture, result, revisionId) {
  return fixture.lead_form_events.map((event) => normalizeRuntimeEventEnvelope({
    schema_version: "0.2.0",
    adapter: { adapter_id: "alphonse.n8n.runtime", adapter_version: "0.3.0" },
    workflow_id: `workflow:agency-lab:${definition.domain}`,
    revision_id: revisionId,
    external_execution_id: `n8n-${definition.failure_id.toLowerCase()}-${event.event_id}`,
    event_id: `${definition.failure_id.toLowerCase()}-${event.event_id}-succeeded`,
    event_sequence: 1,
    lifecycle_claim: "succeeded",
    correlation_id: event.submission_id,
    idempotency_key: `runtime-report:${definition.failure_id.toLowerCase()}:${event.event_id}:1`,
    occurred_at: event.received_at,
    payload: {
      digest: sha256Digest({
        event_id: event.event_id,
        submission_id: event.submission_id,
        effects: result.baseline.external_effects.filter((effect) => effect.event_id === event.event_id)
      }),
      reference: null
    }
  }));
}

function externalSnapshot(result) {
  const snapshot = {
    crm_leads: result.baseline.crm_leads.map((lead) => ({
      crm_lead_id: lead.crm_lead_id,
      submission_id: lead.form_submission_id,
      created_from_event_id: lead.created_from_event_id,
      assigned_owner_id: lead.assigned_owner_id,
      qualification: lead.qualification
    })),
    notifications: result.baseline.notifications.map((notification) => ({
      notification_id: notification.notification_id,
      submission_id: notification.form_submission_id,
      created_from_event_id: notification.created_from_event_id,
      to: notification.to
    }))
  };
  for (const field of [
    "context_reads", "routing_decisions", "authoritative_owner_state",
    "source_schema_state", "mapping_observations"
  ]) {
    if (result.baseline[field] !== undefined) snapshot[field] = structuredClone(result.baseline[field]);
  }
  return { ...snapshot, snapshot_digest: sha256Digest(snapshot) };
}

function assertEvidenceRequirements(definition, inboundEvents, effects, snapshot) {
  const evidence = {
    runtime_event: inboundEvents,
    external_effect: effects,
    external_state_snapshot: [snapshot]
  };
  for (const requirement of definition.evidence_requirements) {
    const items = evidence[requirement.kind];
    assert.equal(Array.isArray(items), true, `Unsupported evidence kind ${requirement.kind}`);
    assert.equal(items.length >= requirement.minimum_count, true, `${requirement.evidence_id} count is incomplete`);
    for (const item of items) {
      for (const field of requirement.required_fields) {
        assert.equal(Object.hasOwn(item, field), true, `${requirement.evidence_id}.${field} is missing`);
      }
    }
  }
}

async function readTree(directory) {
  const contents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) contents.push(...await readTree(entryPath));
    else contents.push(await readFile(entryPath, "utf8"));
  }
  return contents;
}

async function packageEvidence(definition, fixture, result) {
  const neutralId = definition.failure_id.toLowerCase();
  const { runId, runRoot, workerRoot, controllerRoot } = await createRunWorkspace();
  const assignmentId = randomUUID();
  const workerRegistrationId = randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(createdAt) + 60 * 60 * 1000).toISOString();
  const caseId = stableUuid(`${definition.failure_id}:case`);
  const revisionId = stableUuid(`${definition.failure_id}:revision`);
  const failureSpecificationId = stableUuid(`${definition.failure_id}:failure-specification`);
  const workflowMaterialDigest = sha256Digest({
    evaluator_id: definition.controller.evaluator_id,
    platform_tags: definition.platform_tags,
    fixture_digest: sha256Digest(fixture)
  });
  const events = runtimeEvents(definition, fixture, result, revisionId);
  const inboundEvents = fixture.lead_form_events.map((event, index) => ({
    event_id: event.event_id,
    event_sequence: index + 1,
    event_type: "lead_form_received",
    submission_id: event.submission_id,
    occurred_at: event.received_at,
    payload_digest: sha256Digest(event)
  }));
  const effects = result.baseline.external_effects.map((effect, index) => {
    const sourceEvent = fixture.lead_form_events.find((event) => event.event_id === effect.event_id);
    return {
      effect_id: `${neutralId}-effect-${String(index + 1).padStart(3, "0")}`,
      ...effect,
      submission_id: effect.submission_id ?? sourceEvent?.submission_id,
      attempt: effect.attempt ?? 1,
      outcome: effect.outcome ?? "confirmed",
      destination_committed: effect.destination_committed ?? true
    };
  });
  const snapshot = externalSnapshot(result);
  assertEvidenceRequirements(definition, inboundEvents, effects, snapshot);

  const actualBehavior = `Observed ${snapshot.crm_leads.length} CRM lead records and ` +
    `${snapshot.notifications.length} notification records after ${inboundEvents.length} inbound delivery.`;
  const failureSpecification = {
    failure_specification_id: failureSpecificationId,
    specification_digest: sha256Digest({ expected: definition.expected_behavior, actual: actualBehavior }),
    expected_behavior: definition.expected_behavior,
    actual_behavior: actualBehavior,
    reproduction_conditions: [
      "Replay the preserved inbound delivery sequence.",
      "Begin from the preserved initial external state.",
      "Use the recorded deterministic integration outcome sequence."
    ],
    targeted_verification: {
      expected_behavior: definition.expected_behavior,
      prohibited_behavior: definition.forbidden_behavior.join(" ")
    }
  };
  const reproductionBundle = buildReproductionBundle({
    caseId,
    revisionId,
    revisionMaterialDigest: workflowMaterialDigest,
    failureSpecification,
    redactedDetail: {
      input: { inbound_events: inboundEvents, lead_payloads: "[REDACTED]" },
      fixtures: { external_effects: effects, external_state_snapshot: snapshot }
    },
    assumptions: [
      "Event and effect identifiers are immutable.",
      "The external state snapshot follows the recorded effect sequence."
    ],
    policyDigest: sha256Digest({ failure_id: definition.failure_id, policy: definition.worker_policy }),
    sourceDetailDigest: sha256Digest({ fixture, baseline: result.baseline }),
    reproduction: {
      status: "demonstrated",
      processed_event_count: result.baseline.processed_event_count,
      observed_external_effect_count: result.baseline.external_effects.length,
      actual_behavior: actualBehavior
    },
    redaction: {
      redacted_paths: ["input.lead_payloads"],
      omitted_paths: ["controller", "fault_injection", "answer_key", "input.lead_payloads.raw"]
    }
  });
  const workerEvidence = {
    schema_version: "0.1.0",
    failure_id: definition.failure_id,
    case_registration: {
      operation_id: "diagnostic.case.report_failure",
      case_id: caseId,
      workflow_id: `workflow:agency-lab:${definition.domain}`,
      revision_id: revisionId,
      workflow_material_digest: workflowMaterialDigest,
      summary: "Observed external state conflicts with the declared business behavior."
    },
    runtime_events: events,
    reproduction_bundle: reproductionBundle,
    authority: {
      evidence_read: "granted", external_effects: "not_granted",
      repair: "not_granted", promotion: "not_granted"
    }
  };
  const answerKey = await readJson(repositoryPath(definition.controller.answer_key_file));
  const workerText = JSON.stringify(workerEvidence);
  for (const prohibited of answerKey.prohibited_worker_terms) {
    assert.equal(workerText.includes(prohibited), false, `worker evidence leaked controller answer: ${prohibited}`);
  }

  const store = createContentAddressedArtifactStore(path.join(workerRoot, "artifacts"));
  const artifact = await store.putJson(workerEvidence);
  const manifest = {
    schema_version: "0.1.0",
    run_id: runId,
    assignment_id: assignmentId,
    worker_registration_id: workerRegistrationId,
    failure_id: definition.failure_id,
    case_id: caseId,
    evidence_artifact_digest: artifact.artifact_digest,
    evidence_file: "evidence.json",
    answer_key_included: false
  };
  const evidenceRecord = await writeImmutableJson(workerRoot, "evidence.json", workerEvidence);
  assert.equal(evidenceRecord.digest, artifact.artifact_digest, "evidence record digest changed while packaging");
  const manifestRecord = await writeImmutableJson(workerRoot, "manifest.json", manifest);
  const assignment = buildWorkerAssignment({
    runId,
    assignmentId,
    workerRegistrationId,
    failureId: definition.failure_id,
    caseId,
    revisionId,
    instructionDigest: sha256Digest({ instruction: DIAGNOSIS_INSTRUCTION }),
    manifestDigest: manifestRecord.digest,
    evidenceArtifactDigest: artifact.artifact_digest,
    assignedArtifactDigests: [artifact.artifact_digest],
    createdAt,
    expiresAt
  });
  const assignmentRecord = await writeImmutableJson(workerRoot, "assignment.json", assignment);
  await writeImmutableJson(controllerRoot, "answer-key.json", answerKey);
  const provenance = buildRunProvenance({
    assignment,
    assignmentDigest: assignmentRecord.digest,
    caseDefinitionDigest: sha256Digest(definition),
    fixtureDigest: sha256Digest(fixture),
    answerKeyDigest: sha256Digest(answerKey)
  });
  const provenanceRecord = await writeImmutableJson(runRoot, "run-provenance.json", provenance);
  const bytes = (await readTree(workerRoot)).join("\n");
  for (const prohibited of answerKey.prohibited_worker_terms) {
    assert.equal(bytes.includes(prohibited), false, `written worker evidence leaked controller answer: ${prohibited}`);
  }
  return {
    status: "case packaged, worker-visible evidence complete, answer key withheld.",
    run_id: runId,
    assignment_id: assignmentId,
    failure_id: definition.failure_id,
    case_id: caseId,
    evidence_artifact_digest: artifact.artifact_digest,
    provenance_digest: provenanceRecord.digest,
    worker_workspace: workerRoot,
    controller_workspace: controllerRoot,
    run_workspace: runRoot,
    answer_key_withheld: true
  };
}

const [operation, caseFile] = process.argv.slice(2);
if (!caseFile || !["run", "package"].includes(operation)) {
  throw new Error("Usage: agency-lab.js <run|package> <case-file>");
}
const { definition, fixture } = await loadCase(caseFile);
const result = runAgencyLabCase(definition, fixture);
const report = operation === "run"
  ? conciseRunReport(definition, result)
  : await packageEvidence(definition, fixture, result);
console.log(JSON.stringify(report, null, 2));
