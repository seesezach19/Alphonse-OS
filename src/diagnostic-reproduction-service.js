import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import {
  applyExtractionAndRedaction,
  buildReproductionBundle,
  validateFailureSpecification
} from "./diagnostic-reproduction-contracts.js";
import { projectDiagnosticCaseWithRepair, projectRepairTask } from "./diagnostic-repair-worker-contracts.js";
import { projectPromotion } from "./diagnostic-promotion-contracts.js";
import { KernelError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const AUTHORITY = Object.freeze({ execution: "not_granted", repair: "not_granted", promotion: "not_granted" });

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_INPUT", `${field} must be an object.`);
  }
  return value;
}

function exact(value, field, keys) {
  object(value, field);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new KernelError(400, "INVALID_INPUT", `${field} fields must be exact.`, { expected, received: actual });
  }
  return value;
}

function string(value, field, maximum = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new KernelError(400, "INVALID_INPUT", `${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function uuid(value, field) {
  const result = string(value, field, 36);
  if (!UUID.test(result)) throw new KernelError(400, "INVALID_IDENTIFIER", `${field} must be a UUID.`);
  return result;
}

function command(value, operationId) {
  const envelope = exact(value, "command", ["command_id", "operation_id", "input"]);
  if (envelope.operation_id !== operationId) {
    throw new KernelError(400, "UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  }
  return {
    command_id: string(envelope.command_id, "command_id", 160),
    operation_id: operationId,
    input: object(envelope.input, "input")
  };
}

function strings(value, field, maximumItems = 20) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumItems) {
    throw new KernelError(400, "INVALID_INPUT", `${field} must be a bounded non-empty array.`);
  }
  return value.map((item, index) => string(item, `${field}[${index}]`, 500));
}

function failureSpecificationView(row) {
  if (!row) return null;
  return {
    failure_specification_id: row.failure_specification_id,
    specification_digest: row.specification_digest,
    expected_behavior: row.expected_behavior,
    actual_behavior: row.actual_behavior,
    reproduction_conditions: row.reproduction_conditions,
    targeted_verification: row.targeted_verification,
    confirmed_by: { type: row.confirmed_by_actor_type, id: row.confirmed_by_actor_id },
    confirmed_at: row.confirmed_at,
    immutable: true
  };
}

function attemptView(row) {
  return {
    attempt_id: row.attempt_id,
    request_material_digest: row.request_material_digest,
    outcome: row.outcome,
    reason_code: row.reason_code,
    source_detail_digest: row.source_detail_digest,
    redaction_policy_digest: row.redaction_policy_digest,
    reproduction_result: row.reproduction_result,
    attempted_at: row.attempted_at,
    immutable: true
  };
}

function bundleView(row) {
  return {
    bundle_id: row.bundle_id,
    failure_specification_id: row.failure_specification_id,
    revision_id: row.revision_id,
    attempt_id: row.attempt_id,
    material_digest: row.material_digest,
    artifact_digest: row.artifact_digest,
    reproduction_status: row.reproduction_status,
    retention_state: row.deleted_at ? "deleted" : "retained",
    created_at: row.created_at,
    immutable: true
  };
}

export function createDiagnosticReproductionService(
  database, artifactStore, installationId, runtimeDetailClient, detailPolicy
) {
  const { pool, executeCommand } = database;
  const policy = exact(detailPolicy, "detail policy", [
    "policy_id", "extract_paths", "redact_paths", "omit_paths", "replacement"
  ]);
  const policyDigest = sha256Digest(policy);

  function requestDigest(envelope) {
    return sha256Digest({ installation_id: installationId, ...envelope });
  }

  async function getCase(caseId, client = pool) {
    uuid(caseId, "case_id");
    const caseResult = await client.query(
      `SELECT * FROM diagnostic_cases WHERE installation_id=$1 AND case_id=$2`, [installationId, caseId]
    );
    const row = caseResult.rows[0];
    if (!row) throw new KernelError(404, "DIAGNOSTIC_CASE_NOT_FOUND", "Diagnostic Case does not exist.");
    const specResult = await client.query(
      `SELECT * FROM diagnostic_failure_specifications WHERE installation_id=$1 AND case_id=$2`,
      [installationId, caseId]
    );
    const attemptResult = await client.query(
      `SELECT * FROM diagnostic_reproduction_attempts
       WHERE installation_id=$1 AND case_id=$2 ORDER BY attempted_at,attempt_id`, [installationId, caseId]
    );
    const bundleResult = await client.query(
      `SELECT b.*,t.deleted_at FROM diagnostic_reproduction_bundles b
       LEFT JOIN diagnostic_artifact_tombstones t
         ON t.installation_id=b.installation_id AND t.artifact_digest=b.artifact_digest
       WHERE b.installation_id=$1 AND b.case_id=$2 ORDER BY b.created_at,b.bundle_id`, [installationId, caseId]
    );
    const transitionResult = await client.query(
      `SELECT transition_id,diagnostic_sequence,transition_type,occurred_at
       FROM diagnostic_transitions WHERE installation_id=$1 AND aggregate_type='diagnostic_case'
         AND aggregate_id=$2 ORDER BY diagnostic_sequence`, [installationId, caseId]
    );
    const taskResult = await client.query(
      `SELECT * FROM diagnostic_repair_tasks
       WHERE installation_id=$1 AND case_id=$2 ORDER BY created_at,task_id`, [installationId, caseId]
    );
    const taskEventResult = await client.query(
      `SELECT e.* FROM diagnostic_repair_task_events e
       JOIN diagnostic_repair_tasks t ON t.task_id=e.task_id
       WHERE e.installation_id=$1 AND t.case_id=$2 ORDER BY e.task_id,e.event_index`, [installationId, caseId]
    );
    const candidateResult = await client.query(
      `SELECT c.*,e.event_type AS current_status
       FROM diagnostic_repair_candidates c
       JOIN LATERAL (
         SELECT event_type FROM diagnostic_repair_candidate_events
         WHERE installation_id=c.installation_id AND candidate_id=c.candidate_id
         ORDER BY event_index DESC LIMIT 1
       ) e ON true
       WHERE c.installation_id=$1 AND c.case_id=$2 ORDER BY c.submitted_at,c.candidate_id`,
      [installationId, caseId]
    );
    const verificationResult = await client.query(
      `SELECT verification_id,candidate_id,delivery_id,verification_request_digest,overall_result,
              receipt_digest,runner_id,runner_version,fixture_version,verified_at
       FROM diagnostic_verification_receipts
       WHERE installation_id=$1 AND case_id=$2 ORDER BY verified_at,verification_id`,
      [installationId, caseId]
    );
    const promotionResult = await client.query(
      `SELECT * FROM diagnostic_promotions
       WHERE installation_id=$1 AND case_id=$2 ORDER BY authorized_at,promotion_id`,
      [installationId, caseId]
    );
    const promotionEventResult = await client.query(
      `SELECT e.* FROM diagnostic_promotion_events e
       JOIN diagnostic_promotions p ON p.promotion_id=e.promotion_id
       WHERE e.installation_id=$1 AND p.case_id=$2 ORDER BY e.promotion_id,e.event_index`,
      [installationId, caseId]
    );
    const failureSpecification = failureSpecificationView(specResult.rows[0]);
    const attempts = attemptResult.rows.map(attemptView);
    const bundles = bundleResult.rows.map(bundleView);
    const tasks = taskResult.rows.map((task) => {
      const events = taskEventResult.rows.filter((event) => event.task_id === task.task_id).map((event) => ({
        event_id: event.event_id,
        event_index: Number(event.event_index),
        lease_epoch: Number(event.lease_epoch),
        event_type: event.event_type,
        reason_code: event.reason_code,
        detail: event.detail,
        lease_expires_at: event.lease_expires_at,
        occurred_at: event.occurred_at,
        immutable: true
      }));
      return {
        task_id: task.task_id,
        worker_registration_id: task.worker_registration_id,
        passport_id: task.passport_id,
        work_intent_id: task.work_intent_id,
        base_revision_id: task.base_revision_id,
        reproduction_bundle_id: task.reproduction_bundle_id,
        previous_task_id: task.previous_task_id,
        lease_epoch: Number(task.lease_epoch),
        task_digest: task.task_digest,
        events,
        projection: projectRepairTask({ lease_epoch: Number(task.lease_epoch) }, events),
        immutable: true
      };
    });
    const candidates = candidateResult.rows.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      task_id: candidate.task_id,
      base_revision_id: candidate.base_revision_id,
      reproduction_bundle_id: candidate.reproduction_bundle_id,
      material_digest: candidate.material_digest,
      intended_behavior_change: candidate.intended_behavior_change,
      artifacts: {
        candidate: candidate.candidate_artifact_digest,
        targeted_regression: candidate.regression_artifact_digest,
        logs: candidate.logs_artifact_digest
      },
      status: candidate.current_status,
      submitted_at: candidate.submitted_at,
      immutable: true
    }));
    const promotions = promotionResult.rows.map((promotion) => {
      const events = promotionEventResult.rows
        .filter((event) => event.promotion_id === promotion.promotion_id)
        .map((event) => ({
          event_index: Number(event.event_index),
          event_type: event.event_type,
          detail: event.detail,
          actor: { type: event.actor_type, id: event.actor_id },
          occurred_at: event.occurred_at,
          immutable: true
        }));
      return {
        promotion_id: promotion.promotion_id,
        candidate_id: promotion.candidate_id,
        verification_id: promotion.verification_id,
        authorization_digest: promotion.authorization_digest,
        expected_target_revision_digest: promotion.expected_target_revision_digest,
        candidate_target_revision_digest: promotion.candidate_target_revision_digest,
        owner: { type: promotion.owner_actor_type, id: promotion.owner_actor_id },
        events,
        projection: projectPromotion(events),
        immutable: true
      };
    });
    return {
      case_id: row.case_id,
      trace_id: row.trace_id,
      workflow_id: row.workflow_id,
      revision_id: row.revision_id,
      summary: row.summary,
      report_digest: row.report_digest,
      reported_by: { type: row.reported_by_actor_type, id: row.reported_by_actor_id },
      reported_at: row.reported_at,
      failure_specification: failureSpecification,
      reproduction_attempts: attempts,
      reproduction_bundles: bundles,
      repair_tasks: tasks,
      repair_candidates: candidates,
      verification_receipts: verificationResult.rows.map((verification) => ({
        verification_id: verification.verification_id,
        candidate_id: verification.candidate_id,
        delivery_id: verification.delivery_id,
        verification_request_digest: verification.verification_request_digest,
        overall_result: verification.overall_result,
        receipt_digest: verification.receipt_digest,
        runner: {
          runner_id: verification.runner_id,
          runner_version: verification.runner_version,
          fixture_version: verification.fixture_version
        },
        verified_at: verification.verified_at,
        immutable: true
      })),
      promotions,
      projection: projectDiagnosticCaseWithRepair({
        failureSpecification, bundles, attempts, tasks, candidates, promotions
      }),
      transitions: transitionResult.rows,
      authority: { ...AUTHORITY }
    };
  }

  async function reportFailure(value, actor) {
    const envelope = command(value, "diagnostic.case.report_failure");
    const input = exact(envelope.input, "input", ["trace_id", "summary"]);
    const normalized = { trace_id: uuid(input.trace_id, "input.trace_id"), summary: string(input.summary, "input.summary") };
    const accepted = { ...envelope, input: normalized, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: requestDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        const traceResult = await client.query(
          `SELECT * FROM diagnostic_external_activity_traces WHERE installation_id=$1 AND trace_id=$2 FOR SHARE`,
          [installationId, normalized.trace_id]
        );
        const trace = traceResult.rows[0];
        if (!trace) throw new KernelError(404, "EXTERNAL_ACTIVITY_TRACE_NOT_FOUND", "External Activity Trace does not exist.");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:diagnostic-case:${normalized.trace_id}`
        ]);
        const reportDigest = sha256Digest({ trace_id: normalized.trace_id, summary: normalized.summary });
        const existing = await client.query(
          `SELECT * FROM diagnostic_cases WHERE installation_id=$1 AND trace_id=$2 FOR SHARE`,
          [installationId, normalized.trace_id]
        );
        if (existing.rows[0] && existing.rows[0].report_digest !== reportDigest) {
          throw new KernelError(409, "DIAGNOSTIC_CASE_IDENTITY_CONFLICT",
            "External Activity Trace is already linked to a different failure report.");
        }
        let row = existing.rows[0];
        if (!row) {
          const inserted = await client.query(
            `INSERT INTO diagnostic_cases
              (case_id,installation_id,trace_id,workflow_id,revision_id,summary,report_digest,
               reported_by_actor_type,reported_by_actor_id,reported_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [randomUUID(), installationId, trace.trace_id, trace.workflow_id, trace.revision_id,
              normalized.summary, reportDigest, actor.type, actor.id, acceptedAt]
          );
          row = inserted.rows[0];
        }
        return {
          aggregateType: "diagnostic_case", aggregateId: row.case_id,
          transitionType: existing.rows[0] ? "diagnostic.case.failure_report_reused" : "diagnostic.case.failure_reported",
          fromRevision: existing.rows[0] ? 1 : 0, toRevision: 1,
          transitionPayload: { trace_id: row.trace_id, revision_id: row.revision_id, report_digest: reportDigest },
          result: { diagnostic_case: await getCase(row.case_id, client), created: !existing.rows[0] }
        };
      }
    });
  }

  async function confirmFailureSpecification(value, actor) {
    const envelope = command(value, "diagnostic.failure_specification.confirm");
    const input = validateFailureSpecification(envelope.input, actor);
    const accepted = { ...envelope, input, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: requestDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        await getCase(input.case_id, client);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:failure-specification:${input.case_id}`
        ]);
        const specificationDigest = sha256Digest(input);
        const existing = await client.query(
          `SELECT * FROM diagnostic_failure_specifications WHERE installation_id=$1 AND case_id=$2 FOR SHARE`,
          [installationId, input.case_id]
        );
        if (existing.rows[0] && existing.rows[0].specification_digest !== specificationDigest) {
          throw new KernelError(409, "FAILURE_SPECIFICATION_IMMUTABLE",
            "Confirmed Failure Specification cannot be altered.");
        }
        let row = existing.rows[0];
        if (!row) {
          const inserted = await client.query(
            `INSERT INTO diagnostic_failure_specifications
              (failure_specification_id,installation_id,case_id,specification_digest,expected_behavior,
               actual_behavior,reproduction_conditions,targeted_verification,confirmed_by_actor_type,
               confirmed_by_actor_id,confirmed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [randomUUID(), installationId, input.case_id, specificationDigest, input.expected_behavior,
              input.actual_behavior, JSON.stringify(input.reproduction_conditions), input.targeted_verification,
              actor.type, actor.id, acceptedAt]
          );
          row = inserted.rows[0];
        }
        return {
          aggregateType: "diagnostic_case", aggregateId: input.case_id,
          transitionType: existing.rows[0]
            ? "diagnostic.failure_specification.reused" : "diagnostic.failure_specification.confirmed",
          fromRevision: 1, toRevision: 2,
          transitionPayload: { failure_specification_id: row.failure_specification_id, specification_digest: specificationDigest },
          result: { failure_specification: failureSpecificationView(row), created: !existing.rows[0] }
        };
      }
    });
  }

  async function createReproduction(value, actor) {
    const envelope = command(value, "diagnostic.reproduction.create");
    const input = exact(envelope.input, "input", ["case_id", "fixture_bindings", "assumptions"]);
    const bindings = exact(input.fixture_bindings, "input.fixture_bindings", ["erp", "storefront", "model", "review"]);
    const normalized = {
      case_id: uuid(input.case_id, "input.case_id"),
      fixture_bindings: Object.fromEntries(Object.entries(bindings).map(([key, item]) => [key, string(item, `fixture_bindings.${key}`, 160)])),
      assumptions: strings(input.assumptions, "input.assumptions")
    };
    const accepted = { ...envelope, input: normalized, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: requestDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        const caseView = await getCase(normalized.case_id, client);
        if (!caseView.failure_specification) {
          throw new KernelError(409, "FAILURE_SPECIFICATION_REQUIRED", "Confirmed Failure Specification is required.");
        }
        const revisionResult = await client.query(
          `SELECT * FROM diagnostic_agent_revisions WHERE installation_id=$1 AND revision_id=$2 FOR SHARE`,
          [installationId, caseView.revision_id]
        );
        const revision = revisionResult.rows[0];
        const requestMaterialDigest = sha256Digest({
          case_id: normalized.case_id,
          specification_digest: caseView.failure_specification.specification_digest,
          revision_material_digest: revision.material_digest,
          fixture_bindings: normalized.fixture_bindings,
          assumptions: normalized.assumptions,
          policy_digest: policyDigest,
          builder_version: "alphonse-reproduction-builder/0.2.0"
        });
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:reproduction:${requestMaterialDigest}`
        ]);
        const existingBundle = await client.query(
          `SELECT b.*,t.deleted_at FROM diagnostic_reproduction_bundles b
           LEFT JOIN diagnostic_artifact_tombstones t
             ON t.installation_id=b.installation_id AND t.artifact_digest=b.artifact_digest
           WHERE b.installation_id=$1 AND b.material_digest=$2 FOR SHARE OF b`,
          [installationId, requestMaterialDigest]
        );
        if (existingBundle.rows[0]) {
          return {
            aggregateType: "diagnostic_case", aggregateId: normalized.case_id,
            transitionType: "diagnostic.reproduction_bundle.reused", fromRevision: 3, toRevision: 3,
            transitionPayload: { bundle_id: existingBundle.rows[0].bundle_id, material_digest: requestMaterialDigest },
            result: { reproduction_attempt: null, reproduction_bundle: bundleView(existingBundle.rows[0]), created: false }
          };
        }
        const existingAttempt = await client.query(
          `SELECT * FROM diagnostic_reproduction_attempts
           WHERE installation_id=$1 AND request_material_digest=$2 FOR SHARE`,
          [installationId, requestMaterialDigest]
        );
        if (existingAttempt.rows[0]) {
          return {
            aggregateType: "diagnostic_case", aggregateId: normalized.case_id,
            transitionType: "diagnostic.reproduction_attempt.reused", fromRevision: 2, toRevision: 2,
            transitionPayload: { attempt_id: existingAttempt.rows[0].attempt_id, outcome: existingAttempt.rows[0].outcome },
            result: { reproduction_attempt: attemptView(existingAttempt.rows[0]), reproduction_bundle: null, created: false }
          };
        }

        let redacted = null;
        let reproduction = null;
        let outcome = "incomplete";
        let reasonCode = "RUNTIME_DETAIL_INCOMPLETE";
        try {
          const traceResult = await client.query(
            `SELECT external_execution_id FROM diagnostic_external_activity_traces
             WHERE installation_id=$1 AND trace_id=$2`, [installationId, caseView.trace_id]
          );
          const externalExecutionId = traceResult.rows[0].external_execution_id;
          const detailResponse = await runtimeDetailClient.retrieveExecutionDetail({
            external_execution_id: externalExecutionId,
            payload_reference: null,
            requested_fields: policy.extract_paths
          });
          if (detailResponse.external_execution_id !== externalExecutionId) {
            throw new KernelError(409, "RUNTIME_DETAIL_IDENTITY_MISMATCH", "Runtime detail identity does not match the case trace.");
          }
          redacted = applyExtractionAndRedaction(detailResponse.detail, policy);
          if (!redacted.content.input || !redacted.content.fixtures || !redacted.content.output) {
            throw new KernelError(422, "RUNTIME_DETAIL_INCOMPLETE", "Required reproduction detail is incomplete.");
          }
          const revisionSnapshot = await artifactStore.getJson(revision.snapshot_digest);
          reproduction = await runtimeDetailClient.reproduce({
            external_execution_id: externalExecutionId,
            revision: {
              revision_id: revision.revision_id,
              material_digest: revision.material_digest,
              snapshot_digest: revision.snapshot_digest
            },
            revision_material: revisionSnapshot.content,
            failure_specification: caseView.failure_specification,
            fixtures: redacted.content.fixtures,
            fixture_bindings: normalized.fixture_bindings
          });
          if (reproduction.status !== "completed" || !DIGEST.test(reproduction.output_digest ?? "")) {
            reasonCode = "REPRODUCTION_INCOMPLETE";
          } else if (reproduction.actual_behavior !== caseView.failure_specification.actual_behavior) {
            outcome = "rejected";
            reasonCode = "ORIGINAL_DEFECT_NOT_DEMONSTRATED";
          } else {
            outcome = "demonstrated";
            reasonCode = "ORIGINAL_DEFECT_DEMONSTRATED";
          }
        } catch (error) {
          reasonCode = error.code ?? "RUNTIME_DETAIL_UNAVAILABLE";
        }

        const attemptId = randomUUID();
        const safeReproduction = reproduction && typeof reproduction === "object" ? {
          status: typeof reproduction.status === "string" && reproduction.status.length <= 40
            ? reproduction.status : "incomplete",
          actual_behavior: typeof reproduction.actual_behavior === "string" ? reproduction.actual_behavior.slice(0, 1000) : null,
          output_digest: DIGEST.test(reproduction.output_digest ?? "") ? reproduction.output_digest : null
        } : { status: "incomplete", actual_behavior: null, output_digest: null };
        const attemptResult = await client.query(
          `INSERT INTO diagnostic_reproduction_attempts
            (attempt_id,installation_id,case_id,request_material_digest,outcome,reason_code,source_detail_digest,
             redaction_policy_digest,reproduction_result,attempted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [attemptId, installationId, normalized.case_id, requestMaterialDigest, outcome, reasonCode,
            redacted?.source_detail_digest ?? null, policyDigest, safeReproduction, acceptedAt]
        );
        if (outcome !== "demonstrated") {
          return {
            aggregateType: "diagnostic_case", aggregateId: normalized.case_id,
            transitionType: `diagnostic.reproduction.${outcome}`,
            fromRevision: 2, toRevision: 2,
            transitionPayload: { attempt_id: attemptId, outcome, reason_code: reasonCode },
            result: { reproduction_attempt: attemptView(attemptResult.rows[0]), reproduction_bundle: null, created: true }
          };
        }

        const bundleContent = buildReproductionBundle({
          caseId: normalized.case_id,
          revisionId: revision.revision_id,
          revisionMaterialDigest: revision.material_digest,
          failureSpecification: caseView.failure_specification,
          redactedDetail: redacted.content,
          assumptions: normalized.assumptions,
          policyDigest,
          sourceDetailDigest: redacted.source_detail_digest,
          redaction: {
            redacted_paths: redacted.redacted_paths,
            omitted_paths: redacted.omitted_paths
          },
          reproduction: { status: "demonstrated", actual_behavior: safeReproduction.actual_behavior,
            output_digest: safeReproduction.output_digest }
        });
        const artifact = await artifactStore.putJson(bundleContent);
        await client.query(
          `INSERT INTO diagnostic_artifacts
            (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
          [installationId, artifact.artifact_digest, artifact.size_bytes, artifact.media_type, artifact.storage_key, acceptedAt]
        );
        const bundleResult = await client.query(
          `INSERT INTO diagnostic_reproduction_bundles
            (bundle_id,installation_id,case_id,failure_specification_id,revision_id,attempt_id,
             material_digest,artifact_digest,reproduction_status,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'demonstrated',$9) RETURNING *,NULL::timestamptz AS deleted_at`,
          [randomUUID(), installationId, normalized.case_id,
            caseView.failure_specification.failure_specification_id, revision.revision_id, attemptId,
            requestMaterialDigest, artifact.artifact_digest, acceptedAt]
        );
        return {
          aggregateType: "diagnostic_case", aggregateId: normalized.case_id,
          transitionType: "diagnostic.reproduction.demonstrated", fromRevision: 2, toRevision: 3,
          transitionPayload: { attempt_id: attemptId, bundle_id: bundleResult.rows[0].bundle_id,
            artifact_digest: artifact.artifact_digest },
          result: {
            reproduction_attempt: attemptView(attemptResult.rows[0]),
            reproduction_bundle: bundleView(bundleResult.rows[0]), created: true
          }
        };
      }
    });
  }

  async function retireArtifact(value, actor) {
    const envelope = command(value, "diagnostic.artifact.retire");
    const input = exact(envelope.input, "input", ["artifact_digest", "reason"]);
    const artifactDigest = string(input.artifact_digest, "input.artifact_digest", 80);
    if (!DIGEST.test(artifactDigest)) throw new KernelError(400, "INVALID_ARTIFACT_DIGEST", "Artifact digest is invalid.");
    const normalized = { artifact_digest: artifactDigest, reason: string(input.reason, "input.reason", 500) };
    const accepted = { ...envelope, input: normalized, actor };
    return executeCommand({
      installationId,
      command: accepted,
      requestDigest: requestDigest(accepted),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:artifact-retirement:${normalized.artifact_digest}`
        ]);
        const artifactResult = await client.query(
          `SELECT a.* FROM diagnostic_artifacts a
           JOIN diagnostic_reproduction_bundles b
             ON b.installation_id=a.installation_id AND b.artifact_digest=a.artifact_digest
           WHERE a.installation_id=$1 AND a.artifact_digest=$2 FOR SHARE`,
          [installationId, normalized.artifact_digest]
        );
        const artifact = artifactResult.rows[0];
        if (!artifact) throw new KernelError(404, "RETIRABLE_ARTIFACT_NOT_FOUND",
          "Only Reproduction Bundle payload bytes can be retired through this operation.");
        const existing = await client.query(
          `SELECT * FROM diagnostic_artifact_tombstones WHERE installation_id=$1 AND artifact_digest=$2 FOR SHARE`,
          [installationId, normalized.artifact_digest]
        );
        let row = existing.rows[0];
        if (!row) {
          const deleted = await artifactStore.deleteJson(normalized.artifact_digest);
          const inserted = await client.query(
            `INSERT INTO diagnostic_artifact_tombstones
              (installation_id,artifact_digest,original_size_bytes,original_media_type,original_storage_key,
               deletion_reason,deleted_by_actor_type,deleted_by_actor_id,deleted_at,bytes_deleted)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [installationId, artifact.artifact_digest, artifact.size_bytes, artifact.media_type, artifact.storage_key,
              normalized.reason, actor.type, actor.id, acceptedAt, deleted.bytes_deleted]
          );
          row = inserted.rows[0];
        }
        const tombstone = {
          artifact_digest: row.artifact_digest,
          original_size_bytes: String(row.original_size_bytes),
          original_media_type: row.original_media_type,
          original_storage_key: row.original_storage_key,
          deletion_reason: row.deletion_reason,
          deleted_by: { type: row.deleted_by_actor_type, id: row.deleted_by_actor_id },
          deleted_at: row.deleted_at,
          bytes_deleted: row.bytes_deleted,
          retained_identity: true
        };
        return {
          aggregateType: "diagnostic_artifact", aggregateId: row.artifact_digest,
          transitionType: existing.rows[0] ? "diagnostic.artifact.tombstone_reused" : "diagnostic.artifact.bytes_retired",
          fromRevision: existing.rows[0] ? 1 : 0, toRevision: 1,
          transitionPayload: { artifact_digest: row.artifact_digest, bytes_deleted: row.bytes_deleted },
          result: { artifact_tombstone: tombstone, created: !existing.rows[0] }
        };
      }
    });
  }

  return { confirmFailureSpecification, createReproduction, getCase, reportFailure, retireArtifact };
}
