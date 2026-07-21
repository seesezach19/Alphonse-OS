import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { COVERAGE_RECONCILIATION_STAGE_ARTIFACT_DIGEST } from
  "./coverage-reconciliation-artifact.js";
import {
  assessReconciliationCycle,
  buildCoverageReconciliationEvent,
  projectCoverageReconciliation,
  validateCoverageReconciliationAdvanceCommand,
  validateExecutionHistoryPage
} from "./coverage-reconciliation-contracts.js";
import { KernelError } from "./errors.js";

function actorFor(passport) {
  return { type: "agent", id: passport.agent_principal_id };
}

function requestDigest(installationId, environmentId, command) {
  return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
}

function gap(code, detail) {
  const document = { code, detail, blocking: true };
  return { gap_id: sha256Digest(document), ...document };
}

export function createCoverageExecutionHistoryClient({ baseUrl, token, fetchImpl = fetch }) {
  const endpoint = typeof baseUrl === "string" ? baseUrl.replace(/\/$/, "") : null;
  return {
    async list(input) {
      if (!endpoint || typeof token !== "string" || token.length === 0) {
        throw new KernelError(503, "COVERAGE_RECONCILIATION_CLIENT_UNAVAILABLE",
          "Execution-history adapter access is not configured.");
      }
      let response;
      try {
        response = await fetchImpl(`${endpoint}/v0/execution-history:list`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(input)
        });
      } catch {
        throw new KernelError(502, "COVERAGE_RECONCILIATION_READ_FAILED",
          "Execution-history adapter could not be reached.");
      }
      let body;
      try { body = await response.json(); }
      catch {
        throw new KernelError(502, "COVERAGE_RECONCILIATION_RESPONSE_INVALID",
          "Execution-history adapter returned invalid JSON.");
      }
      if (!response.ok) {
        throw new KernelError(502, "COVERAGE_RECONCILIATION_READ_FAILED",
          "Execution-history adapter rejected the bounded read.", {
            adapter_status: response.status,
            adapter_code: body?.error?.code ?? "UNKNOWN"
          });
      }
      return body;
    }
  };
}

export function createCoverageReconciliationService({ database, artifactStore,
  coverageOnboardingService, historyClient, installationId, environmentId }) {
  const { pool, executeCommand } = database;
  const reconciler = Object.freeze({ id: "com.alphonse.coverage.reconciliation",
    version: "0.1.0", artifact_digest: COVERAGE_RECONCILIATION_STAGE_ARTIFACT_DIGEST });

  function withIdentity(projection) {
    return { ...projection, reconciler };
  }

  async function commandReplay(command, digest) {
    const row = (await pool.query(
      `SELECT request_digest,result FROM diagnostic_commands
       WHERE installation_id=$1 AND command_id=$2`, [installationId, command.command_id]
    )).rows[0];
    if (!row) return null;
    if (row.request_digest !== digest) {
      throw new KernelError(409, "IDEMPOTENCY_CONFLICT",
        "Diagnostic command ID was reused with different input.");
    }
    return { replayed: true, result: row.result };
  }

  async function loadRows(onboardingId, client = pool) {
    const events = await client.query(
      `SELECT * FROM diagnostic_coverage_reconciliation_events
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY event_index`,
      [installationId, onboardingId]);
    const pages = await client.query(
      `SELECT * FROM diagnostic_coverage_reconciliation_pages
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY cycle_index,page_index`,
      [installationId, onboardingId]);
    const observations = await client.query(
      `SELECT * FROM diagnostic_coverage_execution_observations
       WHERE installation_id=$1 AND onboarding_id=$2 ORDER BY cycle_index,provider_execution_id`,
      [installationId, onboardingId]);
    return { eventRows: events.rows, pageRows: pages.rows, observationRows: observations.rows };
  }

  async function loadProjection(onboardingId, client = pool) {
    const onboarding = await coverageOnboardingService.get(onboardingId);
    return withIdentity(projectCoverageReconciliation({ onboarding,
      ...await loadRows(onboardingId, client) }));
  }

  async function appendEvent(client, { current, cycleId, cycleIndex, eventType, payload,
    actor, occurredAt }) {
    const eventId = randomUUID();
    const built = buildCoverageReconciliationEvent({ eventId,
      onboardingId: current.onboarding_id, eventIndex: current.revision + 1,
      cycleId, cycleIndex, eventType, priorEventDigest: current.event_head_digest,
      payload, actor, occurredAt });
    await client.query(
      `INSERT INTO diagnostic_coverage_reconciliation_events
        (event_id,installation_id,onboarding_id,event_index,cycle_id,cycle_index,event_type,
         prior_event_digest,event_digest,payload,actor_type,actor_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [eventId, installationId, current.onboarding_id, built.event_index, cycleId, cycleIndex,
        eventType, built.prior_event_digest, built.event_digest, payload, actor.type, actor.id, occurredAt]
    );
    return built;
  }

  function assertExpected(current, input) {
    if (current.revision !== input.expected_reconciliation_revision) {
      throw new KernelError(409, "COVERAGE_RECONCILIATION_REVISION_CONFLICT",
        "Coverage reconciliation changed before page admission.", {
          expected_revision: input.expected_reconciliation_revision,
          current_revision: current.revision
        });
    }
    if ((current.active_cycle?.cycle_id ?? null) !== input.expected_cycle_id) {
      throw new KernelError(409, "COVERAGE_RECONCILIATION_CYCLE_CONFLICT",
        "Expected cycle does not match the durable active reconciliation cycle.");
    }
  }

  async function recordDegraded({ envelope, command, digest, before, actor, error }) {
    return executeCommand({ installationId, command, requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-reconciliation:${envelope.input.onboarding_id}`
        ]);
        const onboarding = await coverageOnboardingService.get(envelope.input.onboarding_id);
        const current = projectCoverageReconciliation({ onboarding,
          ...await loadRows(envelope.input.onboarding_id, client) });
        assertExpected(current, envelope.input);
        const degradation = gap("coverage.reconciliation.provider_unavailable",
          `Execution-history reconciliation failed closed: ${error.code ?? "PROVIDER_UNAVAILABLE"}.`);
        const payload = { effective_at: acceptedAt,
          reconciler,
          error_code: error.code ?? "COVERAGE_RECONCILIATION_READ_FAILED",
          resume_cursor_digest: current.active_cycle?.next_cursor
            ? sha256Digest(current.active_cycle.next_cursor) : null,
          gaps: [degradation], limitations: [] };
        const built = await appendEvent(client, { current,
          cycleId: current.active_cycle?.cycle_id ?? null,
          cycleIndex: current.active_cycle?.cycle_index ?? null,
          eventType: "reconciliation_degraded", payload, actor, occurredAt: acceptedAt });
        const projection = withIdentity(projectCoverageReconciliation({ onboarding,
          ...await loadRows(envelope.input.onboarding_id, client) }));
        return { aggregateType: "coverage_reconciliation", aggregateId: envelope.input.onboarding_id,
          transitionType: "diagnostic.coverage_reconciliation.degraded",
          fromRevision: before.revision, toRevision: projection.revision,
          transitionPayload: { event_digest: built.event_digest, error_code: payload.error_code },
          result: { coverage_reconciliation: projection, page_receipt: null,
            advanced: false, degraded: true, authority: "none" } };
      } });
  }

  async function advance(value, authenticatedPassport) {
    const envelope = validateCoverageReconciliationAdvanceCommand(value);
    if (envelope.input.passport_id !== authenticatedPassport.passport_id) {
      throw new KernelError(403, "COVERAGE_RECONCILIATION_AUTHENTICATION_MISMATCH",
        "Authenticated Passport does not match reconciliation input.");
    }
    const actor = actorFor(authenticatedPassport);
    const command = { ...envelope, actor };
    const digest = requestDigest(installationId, environmentId, command);
    const replay = await commandReplay(command, digest);
    if (replay) return replay;
    const onboarding = await coverageOnboardingService.get(envelope.input.onboarding_id);
    if (onboarding.agent.passport_id !== authenticatedPassport.passport_id
        || onboarding.agent.agent_principal_id !== authenticatedPassport.agent_principal_id) {
      throw new KernelError(403, "COVERAGE_RECONCILIATION_AUTHENTICATION_MISMATCH",
        "Authenticated Passport does not own this Coverage Onboarding.");
    }
    const before = projectCoverageReconciliation({ onboarding,
      ...await loadRows(envelope.input.onboarding_id) });
    assertExpected(before, envelope.input);
    const adapterRequest = {
      scope_id: onboarding.adapter_binding.inventory_scope_id,
      provider_workflow_id: onboarding.workflow_reference.provider_workflow_id,
      page_size: envelope.input.page_size,
      cursor: before.active_cycle?.next_cursor ?? null
    };
    let untrustedPage;
    try {
      if (!historyClient) throw new KernelError(503, "COVERAGE_RECONCILIATION_CLIENT_UNAVAILABLE",
        "Execution-history adapter access is not configured.");
      untrustedPage = await historyClient.list(adapterRequest);
    } catch (error) {
      if (!(error instanceof KernelError) || error.status < 500) throw error;
      return recordDegraded({ envelope, command, digest, before, actor, error });
    }
    let page;
    try {
      page = validateExecutionHistoryPage(untrustedPage, {
        scope_id: adapterRequest.scope_id,
        provider_workflow_id: adapterRequest.provider_workflow_id,
        environment: onboarding.workflow_reference.environment,
        current_cursor: adapterRequest.cursor,
        page_index: before.active_cycle?.next_page_index ?? 0,
        source_cutoff: before.active_cycle?.source_cutoff ?? null
      });
    } catch (error) {
      if (!(error instanceof KernelError)) throw error;
      const responseError = new KernelError(502, "COVERAGE_RECONCILIATION_RESPONSE_INVALID",
        "Execution-history adapter response failed exact validation.", { cause_code: error.code });
      return recordDegraded({ envelope, command, digest, before, actor, error: responseError });
    }
    const stored = await artifactStore.putJson(page);
    return executeCommand({ installationId, command, requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-reconciliation:${envelope.input.onboarding_id}`
        ]);
        const currentOnboarding = await coverageOnboardingService.get(envelope.input.onboarding_id);
        let current = projectCoverageReconciliation({ onboarding: currentOnboarding,
          ...await loadRows(envelope.input.onboarding_id, client) });
        assertExpected(current, envelope.input);
        const cycleId = current.active_cycle?.cycle_id ?? randomUUID();
        const cycleIndex = current.active_cycle?.cycle_index
          ?? (current.latest_completed_cycle?.cycle_index ?? 0) + 1;
        await client.query(
          `INSERT INTO diagnostic_artifacts
            (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
          [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
            stored.storage_key, acceptedAt]
        );
        if (!current.active_cycle) {
          await appendEvent(client, { current, cycleId, cycleIndex, eventType: "cycle_started",
            payload: { source_cutoff: page.page.source_cutoff,
              scope_digest: page.scope.scope_digest, page_size: envelope.input.page_size },
            actor, occurredAt: acceptedAt });
          current = projectCoverageReconciliation({ onboarding: currentOnboarding,
            ...await loadRows(envelope.input.onboarding_id, client) });
        }
        const pageId = randomUUID();
        const currentCursorDigest = page.page.current_cursor === null
          ? null : sha256Digest(page.page.current_cursor);
        const nextCursorDigest = page.page.next_cursor === null
          ? null : sha256Digest(page.page.next_cursor);
        await client.query(
          `INSERT INTO diagnostic_coverage_reconciliation_pages
            (page_id,installation_id,onboarding_id,cycle_id,cycle_index,page_index,
             page_artifact_digest,page_digest,source_cutoff,current_cursor_digest,next_cursor,
             next_cursor_digest,scope_complete,execution_count,admitted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [pageId, installationId, envelope.input.onboarding_id, cycleId, cycleIndex,
            page.page.page_index, stored.artifact_digest, page.page.page_digest,
            page.page.source_cutoff, currentCursorDigest, page.page.next_cursor,
            nextCursorDigest, page.page.scope_complete, page.executions.length, acceptedAt]
        );
        for (const item of page.executions) {
          await client.query(
            `INSERT INTO diagnostic_coverage_execution_observations
              (observation_id,installation_id,onboarding_id,cycle_id,cycle_index,page_id,
               provider_execution_id,observation_digest,execution,observed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [randomUUID(), installationId, envelope.input.onboarding_id, cycleId, cycleIndex,
              pageId, item.provider_execution_id, item.observation_digest, item, acceptedAt]
          );
        }
        const pagePayload = { page_id: pageId, page_index: page.page.page_index,
          page_artifact_digest: stored.artifact_digest, page_digest: page.page.page_digest,
          source_cutoff: page.page.source_cutoff, execution_count: page.executions.length,
          current_cursor_digest: currentCursorDigest, next_cursor_digest: nextCursorDigest,
          scope_complete: page.page.scope_complete, omissions: page.omissions,
          health: page.health };
        const pageEvent = await appendEvent(client, { current, cycleId, cycleIndex,
          eventType: "page_admitted", payload: pagePayload, actor, occurredAt: acceptedAt });
        current = projectCoverageReconciliation({ onboarding: currentOnboarding,
          ...await loadRows(envelope.input.onboarding_id, client) });
        let completedEvent = null;
        if (page.page.scope_complete) {
          const currentRows = (await client.query(
            `SELECT execution FROM diagnostic_coverage_execution_observations
             WHERE installation_id=$1 AND onboarding_id=$2 AND cycle_id=$3
             ORDER BY provider_execution_id`,
            [installationId, envelope.input.onboarding_id, cycleId]
          )).rows.map((row) => row.execution);
          let previousRows = [];
          let historicalRows = [];
          const previousCycleId = before.latest_completed_cycle?.cycle_id ?? null;
          if (previousCycleId) {
            previousRows = (await client.query(
              `SELECT execution FROM diagnostic_coverage_execution_observations
               WHERE installation_id=$1 AND onboarding_id=$2 AND cycle_id=$3
               ORDER BY provider_execution_id`,
              [installationId, envelope.input.onboarding_id, previousCycleId]
            )).rows.map((row) => row.execution);
            historicalRows = (await client.query(
              `SELECT DISTINCT ON (provider_execution_id) execution
               FROM diagnostic_coverage_execution_observations
               WHERE installation_id=$1 AND onboarding_id=$2 AND cycle_index<$3
               ORDER BY provider_execution_id,cycle_index DESC`,
              [installationId, envelope.input.onboarding_id, cycleIndex]
            )).rows.map((row) => row.execution);
          }
          const pageDigests = (await client.query(
            `SELECT page_digest FROM diagnostic_coverage_reconciliation_pages
             WHERE installation_id=$1 AND onboarding_id=$2 AND cycle_id=$3 ORDER BY page_index`,
            [installationId, envelope.input.onboarding_id, cycleId]
          )).rows.map((row) => row.page_digest);
          const assessment = assessReconciliationCycle({ currentExecutions: currentRows,
            previousExecutions: previousRows, historicalExecutions: historicalRows,
            pageDigests, sourceCutoff: page.page.source_cutoff });
          const completionPayload = { effective_at: acceptedAt, reconciler, ...assessment };
          completedEvent = await appendEvent(client, { current, cycleId, cycleIndex,
            eventType: "cycle_completed", payload: completionPayload, actor, occurredAt: acceptedAt });
        }
        const projection = withIdentity(projectCoverageReconciliation({ onboarding: currentOnboarding,
          ...await loadRows(envelope.input.onboarding_id, client) }));
        return { aggregateType: "coverage_reconciliation",
          aggregateId: envelope.input.onboarding_id,
          transitionType: completedEvent ? "diagnostic.coverage_reconciliation.completed"
            : "diagnostic.coverage_reconciliation.page_admitted",
          fromRevision: before.revision, toRevision: projection.revision,
          transitionPayload: { cycle_id: cycleId, cycle_index: cycleIndex,
            page_event_digest: pageEvent.event_digest,
            completed_event_digest: completedEvent?.event_digest ?? null },
          result: { coverage_reconciliation: projection,
            page_receipt: { page_id: pageId, cycle_id: cycleId, cycle_index: cycleIndex,
              page_index: page.page.page_index, page_artifact_digest: stored.artifact_digest,
              page_digest: page.page.page_digest, source_cutoff: page.page.source_cutoff,
              scope_complete: page.page.scope_complete, authority: "none", immutable: true },
            advanced: true, degraded: false, authority: "none" } };
      } });
  }

  return { advance, get: loadProjection };
}
