import { canonicalize, sha256Digest } from "./canonical-json.js";
import { assertNoSensitiveMaterial } from "./coverage-onboarding-contracts.js";
import { KernelError } from "./errors.js";

export const COVERAGE_RECONCILIATION_SCHEMA_VERSION = "alphonse.coverage-reconciliation.v0.1";
export const COVERAGE_RECONCILIATION_COMMAND_SCHEMA_VERSION =
  "alphonse.coverage-reconciliation-command.v0.1";
export const COVERAGE_INTERVAL_SCHEMA_VERSION = "alphonse.coverage-interval.v0.1";
export const EXECUTION_HISTORY_PAGE_SCHEMA_VERSION =
  "alphonse.workflow-execution-history-page.v0.1";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STABLE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const STATES = ["active", "degraded", "suspended", "unavailable"];
const EVENTS = ["cycle_started", "page_admitted", "cycle_completed", "reconciliation_degraded"];
const EXECUTION_CLASSES = ["production", "retry", "manual", "test", "unknown"];
const REVISION_STATES = ["matched", "mismatched", "unavailable"];
const PROVIDER_STATUSES = ["success", "error", "crashed", "canceled", "new", "running", "waiting"];

function fail(message, code = "COVERAGE_RECONCILIATION_INPUT_INVALID") {
  throw new KernelError(400, code, message);
}

function exact(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || canonicalize(Object.keys(value).sort()) !== canonicalize([...keys].sort())) {
    fail(`${field} fields must be exact.`);
  }
  return value;
}

function string(value, field, maximum = 500, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
      || (pattern && !pattern.test(value))) fail(`${field} is invalid.`);
  return value;
}

function nullableString(value, field, maximum = 500) {
  return value === null ? null : string(value, field, maximum);
}

function dateTime(value, field) {
  string(value, field, 100);
  if (!Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) {
    fail(`${field} must be canonical UTC.`);
  }
  return value;
}

function digest(value, field) { return string(value, field, 80, DIGEST); }

export function validateCoverageReconciliationAdvanceCommand(value) {
  const envelope = exact(value, "command", ["schema_version", "command_id", "operation_id", "input"]);
  if (envelope.schema_version !== COVERAGE_RECONCILIATION_COMMAND_SCHEMA_VERSION
      || envelope.operation_id !== "diagnostic.coverage_reconciliation.advance") {
    fail("Coverage reconciliation command identity is invalid.");
  }
  string(envelope.command_id, "command.command_id", 160, STABLE);
  const input = exact(envelope.input, "command.input", ["onboarding_id", "passport_id",
    "expected_reconciliation_revision", "expected_cycle_id", "page_size"]);
  string(input.onboarding_id, "command.input.onboarding_id", 100, UUID);
  string(input.passport_id, "command.input.passport_id", 100, UUID);
  if (!Number.isSafeInteger(input.expected_reconciliation_revision)
      || input.expected_reconciliation_revision < 0
      || (input.expected_cycle_id !== null && !UUID.test(input.expected_cycle_id ?? ""))
      || !Number.isSafeInteger(input.page_size) || input.page_size < 1 || input.page_size > 100) {
    fail("Coverage reconciliation revision, cycle, or page size is invalid.");
  }
  return structuredClone(envelope);
}

function workflowReference(value, field) {
  const input = exact(value, field, ["system", "environment", "provider_workflow_id"]);
  return { system: string(input.system, `${field}.system`, 80, STABLE),
    environment: string(input.environment, `${field}.environment`, 80, STABLE),
    provider_workflow_id: string(input.provider_workflow_id,
      `${field}.provider_workflow_id`, 200) };
}

function execution(value, index) {
  const field = `page.executions[${index}]`;
  const input = exact(value, field, ["provider_execution_id", "provider_workflow_id",
    "provider_status", "execution_class", "provider_mode", "retry_of", "retry_success_id",
    "started_at", "stopped_at", "wait_until", "revision", "observation_digest", "authority"]);
  const revision = exact(input.revision, `${field}.revision`, ["status",
    "provider_workflow_version_id", "execution_workflow_material_digest", "binding_digest"]);
  if (!PROVIDER_STATUSES.includes(input.provider_status)
      || !EXECUTION_CLASSES.includes(input.execution_class)
      || !REVISION_STATES.includes(revision.status) || input.authority !== "none") {
    fail(`${field} status, class, revision state, or authority is invalid.`);
  }
  const document = {
    provider_execution_id: string(input.provider_execution_id, `${field}.provider_execution_id`, 200),
    provider_workflow_id: string(input.provider_workflow_id, `${field}.provider_workflow_id`, 200),
    provider_status: input.provider_status,
    execution_class: input.execution_class,
    provider_mode: string(input.provider_mode, `${field}.provider_mode`, 80),
    retry_of: nullableString(input.retry_of, `${field}.retry_of`, 200),
    retry_success_id: nullableString(input.retry_success_id, `${field}.retry_success_id`, 200),
    started_at: dateTime(input.started_at, `${field}.started_at`),
    stopped_at: input.stopped_at === null ? null : dateTime(input.stopped_at, `${field}.stopped_at`),
    wait_until: input.wait_until === null ? null : dateTime(input.wait_until, `${field}.wait_until`),
    revision: {
      status: revision.status,
      provider_workflow_version_id: nullableString(revision.provider_workflow_version_id,
        `${field}.revision.provider_workflow_version_id`, 200),
      execution_workflow_material_digest: revision.execution_workflow_material_digest === null
        ? null : digest(revision.execution_workflow_material_digest,
          `${field}.revision.execution_workflow_material_digest`),
      binding_digest: revision.binding_digest === null ? null
        : digest(revision.binding_digest, `${field}.revision.binding_digest`)
    }
  };
  if (digest(input.observation_digest, `${field}.observation_digest`) !== sha256Digest(document)) {
    fail(`${field}.observation_digest does not match exact normalized execution material.`);
  }
  return { ...document, observation_digest: input.observation_digest, authority: "none" };
}

export function validateExecutionHistoryPage(value, expected) {
  const page = exact(value, "page", ["schema_version", "scope", "executions", "page",
    "omissions", "health", "completeness", "authority"]);
  if (page.schema_version !== EXECUTION_HISTORY_PAGE_SCHEMA_VERSION || page.authority !== "none") {
    fail("Execution-history page schema or authority is invalid.");
  }
  const scope = exact(page.scope, "page.scope", ["scope_id", "provider", "environment",
    "provider_workflow_id", "scope_digest"]);
  if (scope.provider !== "n8n" || scope.scope_id !== expected.scope_id
      || scope.provider_workflow_id !== expected.provider_workflow_id
      || scope.environment !== expected.environment) {
    fail("Execution-history page scope does not match the exact onboarding adapter binding.",
      "COVERAGE_RECONCILIATION_SCOPE_CONFLICT");
  }
  string(scope.scope_digest, "page.scope.scope_digest", 80, DIGEST);
  const pagination = exact(page.page, "page.page", ["current_cursor", "next_cursor", "page_index",
    "item_count", "scope_complete", "source_cutoff", "page_digest"]);
  if (pagination.current_cursor !== expected.current_cursor
      || pagination.page_index !== expected.page_index
      || !Number.isSafeInteger(pagination.item_count) || pagination.item_count < 0
      || pagination.item_count > 100 || typeof pagination.scope_complete !== "boolean"
      || (pagination.scope_complete !== (pagination.next_cursor === null))) {
    fail("Execution-history pagination conflicts with durable reconciliation state.",
      "COVERAGE_RECONCILIATION_PAGE_CONFLICT");
  }
  nullableString(pagination.next_cursor, "page.page.next_cursor", 4096);
  dateTime(pagination.source_cutoff, "page.page.source_cutoff");
  digest(pagination.page_digest, "page.page.page_digest");
  if (expected.source_cutoff !== null && pagination.source_cutoff !== expected.source_cutoff) {
    fail("Execution-history source cutoff changed within one cursor walk.",
      "COVERAGE_RECONCILIATION_CUTOFF_CONFLICT");
  }
  if (!Array.isArray(page.executions) || page.executions.length !== pagination.item_count) {
    fail("Execution-history item count does not match its execution array.");
  }
  const executions = page.executions.map(execution);
  if (executions.some((item) => item.provider_workflow_id !== expected.provider_workflow_id)
      || new Set(executions.map((item) => item.provider_execution_id)).size !== executions.length) {
    fail("Execution-history page contains cross-workflow or duplicate execution identities.");
  }
  if (!Array.isArray(page.omissions) || !Array.isArray(page.health?.issues)) {
    fail("Execution-history omissions and health issues must be arrays.");
  }
  const omissions = page.omissions.map((item, index) => {
    const checked = exact(item, `page.omissions[${index}]`, ["code", "count"]);
    if (!Number.isSafeInteger(checked.count) || checked.count < 1) fail("Omission count is invalid.");
    return { code: string(checked.code, `page.omissions[${index}].code`, 160, STABLE),
      count: checked.count };
  });
  const health = exact(page.health, "page.health", ["status", "observed_at", "issues"]);
  if (!["healthy", "degraded", "unavailable", "unknown"].includes(health.status)) {
    fail("Execution-history health status is invalid.");
  }
  const completeness = exact(page.completeness, "page.completeness", ["basis",
    "embedded_signals_are_completeness_proof", "provider_retention_and_deletion_visible_as_limitations"]);
  if (completeness.basis !== "credential_scoped_public_api_cursor_walk"
      || completeness.embedded_signals_are_completeness_proof !== false
      || completeness.provider_retention_and_deletion_visible_as_limitations !== true) {
    fail("Execution-history completeness boundary is invalid.");
  }
  const normalized = { schema_version: EXECUTION_HISTORY_PAGE_SCHEMA_VERSION,
    scope: { scope_id: scope.scope_id, provider: "n8n", environment: scope.environment,
      provider_workflow_id: scope.provider_workflow_id, scope_digest: scope.scope_digest },
    executions, page: { current_cursor: pagination.current_cursor,
      next_cursor: pagination.next_cursor, page_index: pagination.page_index,
      item_count: pagination.item_count, scope_complete: pagination.scope_complete,
      source_cutoff: pagination.source_cutoff, page_digest: pagination.page_digest },
    omissions, health: { status: health.status,
      observed_at: dateTime(health.observed_at, "page.health.observed_at"),
      issues: health.issues.map((item, index) => string(item, `page.health.issues[${index}]`, 500)) },
    completeness: { ...completeness }, authority: "none" };
  const pageDigestMaterial = { ...normalized,
    page: { ...normalized.page } };
  delete pageDigestMaterial.page.page_digest;
  if (pagination.page_digest !== sha256Digest(pageDigestMaterial)) {
    fail("Execution-history page digest does not match the exact normalized page.",
      "COVERAGE_RECONCILIATION_PAGE_DIGEST_INVALID");
  }
  assertNoSensitiveMaterial(normalized, "coverage_reconciliation_page", 4 * 1024 * 1024);
  return normalized;
}

export function buildCoverageReconciliationEvent({ eventId, onboardingId, eventIndex,
  cycleId, cycleIndex, eventType, priorEventDigest, payload, actor, occurredAt }) {
  string(eventId, "event.event_id", 100, UUID);
  string(onboardingId, "event.onboarding_id", 100, UUID);
  if (!Number.isSafeInteger(eventIndex) || eventIndex < 1 || !EVENTS.includes(eventType)
      || (cycleId !== null && !UUID.test(cycleId))
      || (cycleIndex !== null && (!Number.isSafeInteger(cycleIndex) || cycleIndex < 1))) {
    fail("Coverage reconciliation event identity is invalid.");
  }
  if ((eventIndex === 1) !== (priorEventDigest === null)) {
    fail("Coverage reconciliation event chain is invalid.");
  }
  if (priorEventDigest !== null) digest(priorEventDigest, "event.prior_event_digest");
  const checkedActor = exact(actor, "event.actor", ["type", "id"]);
  if (!['agent', 'service'].includes(checkedActor.type)) fail("Coverage reconciliation actor is invalid.");
  const material = { schema_version: "alphonse.coverage-reconciliation-event.v0.1",
    event_id: eventId, onboarding_id: onboardingId, event_index: eventIndex,
    cycle_id: cycleId, cycle_index: cycleIndex, event_type: eventType,
    prior_event_digest: priorEventDigest, payload: structuredClone(payload),
    actor: { type: checkedActor.type, id: string(checkedActor.id, "event.actor.id", 200) },
    occurred_at: dateTime(occurredAt, "event.occurred_at") };
  assertNoSensitiveMaterial(material, "coverage_reconciliation_event", 1024 * 1024);
  return { ...material, event_digest: sha256Digest(material) };
}

function disclosure(kind, value) {
  const document = exact(value, kind, ["code", "detail", "blocking"]);
  if (typeof document.blocking !== "boolean") fail(`${kind}.blocking must be boolean.`);
  const normalized = { code: string(document.code, `${kind}.code`, 160, STABLE),
    detail: string(document.detail, `${kind}.detail`, 1000), blocking: document.blocking };
  return { [`${kind}_id`]: sha256Digest(normalized), ...normalized };
}

export function assessReconciliationCycle({ currentExecutions, previousExecutions = [],
  historicalExecutions = previousExecutions, pageDigests, sourceCutoff }) {
  const current = currentExecutions.map((item, index) => execution(item, index));
  const previous = previousExecutions.map((item, index) => execution(item, index));
  const historical = historicalExecutions.map((item, index) => execution(item, index));
  const currentIds = new Set(current.map((item) => item.provider_execution_id));
  const previousIds = new Set(previous.map((item) => item.provider_execution_id));
  const historicalIds = new Set(historical.map((item) => item.provider_execution_id));
  const production = current.filter((item) => ["production", "retry"].includes(item.execution_class));
  const gaps = [];
  const limitations = [
    disclosure("limitation", { code: "coverage.reconciliation.provider_retention_bounded",
      detail: "Completeness covers only execution history retained and returned by the credential-scoped provider API.",
      blocking: false }),
    disclosure("limitation", { code: "coverage.reconciliation.signals_are_hints",
      detail: "Embedded workflow execution signals are hints and are never used as completeness proof.",
      blocking: false })
  ];
  const missing = [...historicalIds].filter((id) => !currentIds.has(id));
  if (missing.length) gaps.push(disclosure("gap", { code: "coverage.reconciliation.provider_history_absence",
    detail: `${missing.length} previously observed execution(s) are absent from the current complete provider walk.`,
    blocking: true }));
  const previousLatestStart = previous.length > 0
    ? Math.max(...previous.map((prior) => Date.parse(prior.started_at))) : null;
  const late = current.filter((item) => !previousIds.has(item.provider_execution_id)
    && previous.length > 0 && (historicalIds.has(item.provider_execution_id)
      || Date.parse(item.started_at) <= previousLatestStart));
  if (late.length) limitations.push(disclosure("limitation", { code: "coverage.reconciliation.late_fill",
    detail: `${late.length} execution(s) filled history only in a later complete reconciliation.`,
    blocking: false }));
  const unknown = current.filter((item) => item.execution_class === "unknown");
  if (unknown.length) gaps.push(disclosure("gap", { code: "coverage.reconciliation.execution_class_unknown",
    detail: `${unknown.length} execution(s) have an unclassified provider mode.`, blocking: true }));
  const nonterminal = production.filter((item) => ["new", "running", "waiting"].includes(item.provider_status));
  if (nonterminal.length) gaps.push(disclosure("gap", { code: "coverage.reconciliation.production_execution_incomplete",
    detail: `${nonterminal.length} production execution(s) are not terminal at the fixed cutoff.`, blocking: true }));
  const unavailable = production.filter((item) => item.revision.status === "unavailable");
  if (unavailable.length) gaps.push(disclosure("gap", { code: "coverage.reconciliation.revision_evidence_unavailable",
    detail: `${unavailable.length} production execution(s) lack exact behavior-bearing revision evidence.`,
    blocking: true }));
  const mismatched = production.filter((item) => item.revision.status === "mismatched");
  if (mismatched.length) gaps.push(disclosure("gap", { code: "coverage.reconciliation.revision_drift",
    detail: `${mismatched.length} production execution(s) contradict the bound behavior-bearing revision.`,
    blocking: true }));
  const excluded = current.filter((item) => ["manual", "test"].includes(item.execution_class));
  if (excluded.length) limitations.push(disclosure("limitation", {
    code: "coverage.reconciliation.non_production_excluded",
    detail: `${excluded.length} manual or test execution(s) remain visible but do not establish production coverage.`,
    blocking: false }));
  const assessment = mismatched.length ? "suspended" : gaps.length ? "degraded" : "active";
  const material = { source_cutoff: dateTime(sourceCutoff, "cycle.source_cutoff"),
    page_digests: pageDigests.map((item, index) => digest(item, `cycle.page_digests[${index}]`)),
    execution_digests: current.map((item) => item.observation_digest).sort(),
    production_execution_count: production.length,
    matched_revision_execution_count: production.filter((item) => item.revision.status === "matched").length,
    mismatched_revision_execution_count: mismatched.length,
    unavailable_revision_execution_count: unavailable.length,
    excluded_non_production_count: excluded.length,
    assessment, gaps, limitations };
  return { ...material, cycle_digest: sha256Digest(material) };
}

function eventFromRow(row) {
  return buildCoverageReconciliationEvent({ eventId: row.event_id, onboardingId: row.onboarding_id,
    eventIndex: Number(row.event_index), cycleId: row.cycle_id,
    cycleIndex: row.cycle_index === null ? null : Number(row.cycle_index), eventType: row.event_type,
    priorEventDigest: row.prior_event_digest, payload: row.payload,
    actor: { type: row.actor_type, id: row.actor_id },
    occurredAt: new Date(row.occurred_at).toISOString() });
}

function interval({ onboardingId, startsAt, endsAt, state, basisEventDigest, gaps, limitations }) {
  const document = { schema_version: COVERAGE_INTERVAL_SCHEMA_VERSION,
    onboarding_id: onboardingId, starts_at: startsAt, ends_at: endsAt, end_exclusive: true,
    state, basis_event_digest: basisEventDigest,
    gap_ids: gaps.map((item) => item.gap_id).sort(),
    limitation_ids: limitations.map((item) => item.limitation_id).sort(), authority: "none" };
  return { ...document, interval_digest: sha256Digest(document), immutable: true };
}

export function projectCoverageReconciliation({ onboarding, eventRows = [], pageRows = [],
  observationRows = [] }) {
  const events = eventRows.map(eventFromRow);
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].event_index !== index + 1
        || events[index].prior_event_digest !== (events[index - 1]?.event_digest ?? null)
        || events[index].event_digest !== eventRows[index].event_digest) {
      throw new KernelError(500, "COVERAGE_RECONCILIATION_INTEGRITY_VIOLATION",
        "Coverage reconciliation event chain is invalid.");
    }
  }
  const cycleStarts = events.filter((item) => item.event_type === "cycle_started");
  const completed = events.filter((item) => item.event_type === "cycle_completed");
  const latestStarted = cycleStarts.at(-1) ?? null;
  const latestComplete = completed.at(-1) ?? null;
  const activeCycle = latestStarted
    && !completed.some((item) => item.cycle_id === latestStarted.cycle_id
      && item.event_index > latestStarted.event_index) ? latestStarted : null;
  const activePages = activeCycle ? pageRows.filter((row) => row.cycle_id === activeCycle.cycle_id) : [];
  const transitions = events.filter((item) => ["cycle_completed", "reconciliation_degraded"]
    .includes(item.event_type)).map((item) => ({ event: item,
    state: item.event_type === "cycle_completed" ? item.payload.assessment : "suspended",
    effective_at: item.payload.effective_at,
    gaps: item.payload.gaps ?? [], limitations: item.payload.limitations ?? [] }))
    .sort((left, right) => Date.parse(left.effective_at) - Date.parse(right.effective_at)
      || left.event.event_index - right.event.event_index);
  const intervals = [];
  let startsAt = new Date(onboarding.opened_at).toISOString();
  let state = "unavailable";
  let basisEventDigest = onboarding.event_head_digest;
  let gaps = [];
  let limitations = [];
  for (const transition of transitions) {
    if (Date.parse(transition.effective_at) > Date.parse(startsAt)) {
      intervals.push(interval({ onboardingId: onboarding.onboarding_id, startsAt,
        endsAt: transition.effective_at, state, basisEventDigest, gaps, limitations }));
    }
    startsAt = transition.effective_at;
    state = transition.state;
    basisEventDigest = transition.event.event_digest;
    gaps = transition.gaps;
    limitations = transition.limitations;
  }
  const current = { starts_at: startsAt, ends_at: null, state,
    basis_event_digest: basisEventDigest, gap_ids: gaps.map((item) => item.gap_id).sort(),
    limitation_ids: limitations.map((item) => item.limitation_id).sort(), open: true,
    authority: "none" };
  const projection = {
    schema_version: COVERAGE_RECONCILIATION_SCHEMA_VERSION,
    onboarding_id: onboarding.onboarding_id,
    workflow_reference: workflowReference(onboarding.workflow_reference, "workflow_reference"),
    revision: events.length,
    event_head_digest: events.at(-1)?.event_digest ?? null,
    status: events.at(-1)?.event_type === "reconciliation_degraded"
      ? (activeCycle ? "degraded_backfill" : "degraded")
      : activeCycle ? "backfilling" : latestComplete ? "reconciled" : "not_started",
    active_cycle: activeCycle ? { cycle_id: activeCycle.cycle_id,
      cycle_index: activeCycle.cycle_index,
      source_cutoff: activeCycle.payload.source_cutoff ?? activePages[0]?.source_cutoff ?? null,
      next_page_index: activePages.length,
      next_cursor: activePages.at(-1)?.next_cursor ?? null } : null,
    latest_completed_cycle: latestComplete ? { cycle_id: latestComplete.cycle_id,
      cycle_index: latestComplete.cycle_index, cycle_digest: latestComplete.payload.cycle_digest,
      source_cutoff: latestComplete.payload.source_cutoff,
      assessment: latestComplete.payload.assessment,
      production_execution_count: latestComplete.payload.production_execution_count,
      matched_revision_execution_count: latestComplete.payload.matched_revision_execution_count,
      mismatched_revision_execution_count: latestComplete.payload.mismatched_revision_execution_count,
      unavailable_revision_execution_count: latestComplete.payload.unavailable_revision_execution_count } : null,
    coverage_intervals: intervals,
    current_coverage: current,
    event_count: events.length,
    page_count: pageRows.length,
    execution_observation_count: observationRows.length,
    events,
    legal_next_operations: ["diagnostic.coverage_reconciliation.advance",
      "diagnostic.coverage_reconciliation.get"],
    authority: "none",
    immutable_history: true
  };
  assertNoSensitiveMaterial(projection, "coverage_reconciliation_projection", 8 * 1024 * 1024);
  return projection;
}
