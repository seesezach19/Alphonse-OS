import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  assignmentView,
  verifyAssignmentCreationMaterial,
  verifyAssignmentRow,
  verifyAssignmentStateHistory
} from "./diagnostic-assignment-persistence.js";
import { DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_DIGEST } from "./diagnostic-dispatch-artifact.js";
import {
  assertDiagnosticDispatchAuthorizationCurrent,
  DIAGNOSTIC_DISPATCH_CONSUMPTION_SCHEMA,
  DIAGNOSTIC_DISPATCH_ELIGIBILITY_SCHEMA,
  DIAGNOSTIC_WORKER_RUN_SCHEMA,
  validateDiagnosticClaimCommand,
  verifySignedDiagnosticDispatchAuthorization
} from "./diagnostic-dispatch-contracts.js";
import { KernelError } from "./errors.js";

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function iso(value) {
  return new Date(value).toISOString();
}

function routeUuid(value, field) {
  if (typeof value !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new KernelError(400, "DIAGNOSTIC_DISPATCH_INPUT_INVALID", `${field} must be a UUID.`);
  }
  return value;
}

function workerRunView(run, state, consumption) {
  const launchState = {
    claimed_not_launched: "not_launched",
    launching: "launching",
    running: "running",
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled"
  }[state.state];
  return {
    worker_run_id: run.worker_run_id,
    worker_run_digest: run.worker_run_digest,
    assignment_id: run.assignment_id,
    assignment_digest: run.assignment_digest,
    evidence_package_id: run.evidence_package_id,
    dispatch_authorization_id: run.dispatch_authorization_id,
    kernel_authorization_digest: consumption.kernel_authorization_digest,
    signed_authorization_digest: consumption.signed_authorization_digest,
    worker: {
      principal_id: run.worker_principal_id,
      passport_id: run.worker_passport_id,
      passport_configuration_digest: run.worker_passport_configuration_digest
    },
    runtime_boundary: run.worker_run_document.runtime_boundary,
    state: {
      current: state.state,
      revision: String(state.state_revision),
      last_transition_id: state.last_transition_id,
      updated_at: iso(state.updated_at)
    },
    claimed_by: { type: run.claimed_by_type, id: run.claimed_by_id },
    claimed_at: iso(run.claimed_at),
    expires_at: iso(run.expires_at),
    launch_state: launchState,
    broker_token_created: state.state !== "claimed_not_launched",
    provider_request_created: state.state === "completed",
    model_request_created: state.state === "completed",
    diagnosis_created: state.state === "completed",
    external_business_effect_authority: "none",
    immutable_run_facts: true
  };
}

export function createDiagnosticDispatchService({ database, installationId, environmentId,
  materialAuthority, signingKeyId, signingSecret, dispatcherAudience, allowedRunnerAudiences }) {
  const { pool } = database;
  if (typeof signingSecret !== "string" || Buffer.byteLength(signingSecret, "utf8") < 32) {
    throw new Error("Diagnostic dispatch verification secret must contain at least 32 bytes.");
  }
  const signing = { keyId: signingKeyId, secret: signingSecret };

  async function loadAssignmentMaterial(client, assignmentId, { forUpdate = false } = {}) {
    const rows = await client.query(
      `SELECT a.*,s.state,s.state_revision,s.last_transition_id,s.updated_at AS state_updated_at
       FROM diagnostic_assignments a JOIN diagnostic_assignment_states s ON s.assignment_id=a.assignment_id
       WHERE a.installation_id=$1 AND a.environment_id=$2 AND a.assignment_id=$3
       ${forUpdate ? "FOR UPDATE OF s" : ""}`,
      [installationId, environmentId, assignmentId]
    );
    const combined = rows.rows[0];
    if (!combined) {
      throw new KernelError(404, "DIAGNOSTIC_ASSIGNMENT_NOT_FOUND",
        "Diagnostic Assignment does not exist.");
    }
    const row = { ...combined };
    const state = {
      assignment_id: combined.assignment_id,
      installation_id: combined.installation_id,
      environment_id: combined.environment_id,
      assignment_digest: combined.assignment_digest,
      state: combined.state,
      state_revision: combined.state_revision,
      last_transition_id: combined.last_transition_id,
      updated_at: combined.state_updated_at
    };
    verifyAssignmentRow(row, state);
    const transitions = (await client.query(
      `SELECT * FROM diagnostic_transitions
       WHERE installation_id=$1 AND aggregate_type='diagnostic_assignment' AND aggregate_id=$2
       ORDER BY diagnostic_sequence`, [installationId, assignmentId]
    )).rows;
    verifyAssignmentStateHistory({ row, state, transitions });
    const creationTransition = transitions.find((entry) =>
      entry.transition_type === "diagnostic.assignment.created");
    const creationCommand = creationTransition ? (await client.query(
      "SELECT * FROM diagnostic_commands WHERE installation_id=$1 AND command_id=$2",
      [installationId, creationTransition.command_id]
    )).rows[0] : null;
    const creationOutboxes = creationTransition ? (await client.query(
      `SELECT * FROM diagnostic_outbox WHERE installation_id=$1 AND transition_id=$2
       AND event_type='diagnostic.assignment.created'`,
      [installationId, creationTransition.transition_id]
    )).rows : [];
    if (creationOutboxes.length !== 1) {
      throw new KernelError(500, "DIAGNOSTIC_ASSIGNMENT_CREATION_HISTORY_INTEGRITY_VIOLATION",
        "Assignment creation must have one immutable outbox record.");
    }
    verifyAssignmentCreationMaterial({ row, state, transition: creationTransition,
      command: creationCommand, outbox: creationOutboxes[0] });
    return { row, state, transitions };
  }

  async function getDispatchEligibilityFenced(assignmentId, { now = new Date() } = {}) {
    routeUuid(assignmentId, "assignment_id");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (materialAuthority) await materialAuthority.lockMaterialMutation(client);
      const material = await loadAssignmentMaterial(client, assignmentId);
      if (material.state.state !== "unclaimed") {
        throw new KernelError(409, "DIAGNOSTIC_DISPATCH_ASSIGNMENT_NOT_ELIGIBLE",
          "Diagnostic Assignment is not unclaimed.", { assignment_state: material.state.state });
      }
      const checkedAt = iso(now);
      if (Date.parse(checkedAt) >= Date.parse(material.row.assignment_document.temporal.expires_at)) {
        throw new KernelError(409, "DIAGNOSTIC_DISPATCH_ASSIGNMENT_EXPIRED",
          "Diagnostic Assignment has expired.");
      }
      if (materialAuthority) {
        await materialAuthority.assertPackageMaterialAdmissible(client,
          material.row.evidence_package_id, "diagnostic_dispatch_authorization");
      }
      const availability = materialAuthority
        ? await materialAuthority.getPackageAvailability(material.row.evidence_package_id)
        : { material_status: "complete", execution_eligible: true,
          integrity_status: "verified_present", current_as_of: checkedAt };
      if (availability.material_status !== "complete" || availability.execution_eligible !== true
          || availability.integrity_status !== "verified_present") {
        throw new KernelError(409, "DIAGNOSTIC_DISPATCH_MATERIAL_UNAVAILABLE",
          "Diagnostic Evidence Package material is not eligible for dispatch.");
      }
      const document = {
        schema_version: DIAGNOSTIC_DISPATCH_ELIGIBILITY_SCHEMA,
        installation_id: installationId,
        environment_id: environmentId,
        assignment: {
          assignment_id: material.row.assignment_id,
          assignment_digest: material.row.assignment_digest,
          state: material.state.state,
          state_revision: String(material.state.state_revision),
          last_transition_id: material.state.last_transition_id,
          evidence_package_id: material.row.evidence_package_id,
          evidence_package_semantic_digest:
            material.row.assignment_document.evidence_package.semantic_digest,
          evidence_package_artifact_digest:
            material.row.assignment_document.evidence_package.package_artifact_digest,
          assignment_policy_activation_id: material.row.assignment_policy_activation_id,
          assignment_policy_activation_digest:
            material.row.assignment_document.assignment_policy.activation_digest,
          assignment_requirements_digest:
            sha256Digest(material.row.assignment_document.work_requirements),
          expires_at: material.row.assignment_document.temporal.expires_at
        },
        material_availability: {
          material_status: availability.material_status,
          execution_eligible: availability.execution_eligible,
          integrity_status: availability.integrity_status,
          current_as_of: availability.current_as_of
        },
        checked_at: checkedAt,
        authority_granted: "none"
      };
      await client.query("COMMIT");
      return {
        eligible: true,
        diagnostic_assignment: assignmentView(material.row, material.state),
        assignment_expires_at: material.row.assignment_document.temporal.expires_at,
        material_availability: availability,
        eligibility_snapshot: document,
        snapshot_digest: sha256Digest(document)
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function getDispatchEligibility(assignmentId, options = {}) {
    return materialAuthority
      ? materialAuthority.runMaterialMutationExclusive(() =>
        getDispatchEligibilityFenced(assignmentId, options))
      : getDispatchEligibilityFenced(assignmentId, options);
  }

  function verifyClaimBindings({ authorization, verified, material, actor }) {
    const assignment = material.row.assignment_document;
    const expectedAssignment = {
      assignment_id: material.row.assignment_id,
      assignment_digest: material.row.assignment_digest,
      evidence_package_id: material.row.evidence_package_id,
      evidence_package_semantic_digest: assignment.evidence_package.semantic_digest,
      evidence_package_artifact_digest: assignment.evidence_package.package_artifact_digest,
      assignment_policy_activation_id: material.row.assignment_policy_activation_id,
      assignment_policy_activation_digest: assignment.assignment_policy.activation_digest
    };
    const runtimeBoundaryDigest = sha256Digest({ runtime: authorization.runtime,
      resources: authorization.resources, data_policy: authorization.data_policy,
      egress_policy: authorization.egress_policy });
    const { configuration_digest: ignoredConfigurationDigest, ...model } = authorization.model;
    const broker = { broker_id: authorization.broker.broker_id,
      policy_id: authorization.broker.policy_id,
      policy_version: authorization.broker.policy_version,
      audience: authorization.broker.audience,
      max_requests: authorization.broker.max_requests,
      max_input_units: authorization.broker.max_input_units,
      max_output_units: authorization.broker.max_output_units,
      access_delivery: authorization.broker.access_delivery };
    if (authorization.installation_id !== installationId
        || authorization.environment_id !== environmentId
        || !same(authorization.assignment, expectedAssignment)
        || authorization.assignment_requirements_digest
          !== sha256Digest(assignment.work_requirements)
        || authorization.runtime_boundary_digest !== runtimeBoundaryDigest
        || authorization.model.configuration_digest !== sha256Digest(model)
        || authorization.broker.policy_digest !== sha256Digest(broker)
        || authorization.decision_artifact_digest
          !== DIAGNOSTIC_DISPATCH_DECISION_ARTIFACT_DIGEST
        || authorization.dispatcher.type !== actor.type
        || authorization.dispatcher.id !== actor.id
        || authorization.dispatcher.audience !== dispatcherAudience
        || authorization.runner_audience !== authorization.runtime.runner.audience
        || !allowedRunnerAudiences.includes(authorization.runner_audience)
        || verified.authorization_digest !== sha256Digest(authorization)) {
      throw new KernelError(409, "DIAGNOSTIC_DISPATCH_AUTHORIZATION_BINDING_MISMATCH",
        "Diagnostic Dispatch Authorization does not bind the exact current claim boundary.");
    }
  }

  async function claimFenced(value, actor, { now = new Date() } = {}) {
    const parsed = validateDiagnosticClaimCommand(value);
    const command = { ...parsed, actor };
    const requestDigest = sha256Digest({ installation_id: installationId,
      environment_id: environmentId, command });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `${installationId}:${parsed.command_id}`
      ]);
      const replay = (await client.query(
        `SELECT request_digest,result FROM diagnostic_commands
         WHERE installation_id=$1 AND command_id=$2`,
        [installationId, parsed.command_id]
      )).rows[0];
      if (replay) {
        if (replay.request_digest !== requestDigest) {
          throw new KernelError(409, "IDEMPOTENCY_CONFLICT",
            "Diagnostic claim command ID was reused with different input.");
        }
        await client.query("COMMIT");
        return { replayed: true, result: replay.result };
      }
      const verified = verifySignedDiagnosticDispatchAuthorization(
        parsed.input.signed_authorization, signing);
      const authorization = verified.document;
      if (parsed.input.assignment_id !== authorization.assignment.assignment_id) {
        throw new KernelError(409, "DIAGNOSTIC_DISPATCH_ASSIGNMENT_MISMATCH",
          "Claim command Assignment does not match the signed authorization.");
      }
      const claimedAt = assertDiagnosticDispatchAuthorizationCurrent(authorization, iso(now));
      if (materialAuthority) await materialAuthority.lockMaterialMutation(client);
      const assignmentIdentity = (await client.query(
        `SELECT case_id FROM diagnostic_assignments
         WHERE installation_id=$1 AND environment_id=$2 AND assignment_id=$3`,
        [installationId, environmentId, parsed.input.assignment_id]
      )).rows[0];
      if (!assignmentIdentity) {
        throw new KernelError(404, "DIAGNOSTIC_ASSIGNMENT_NOT_FOUND",
          "Diagnostic Assignment does not exist.");
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `diagnostic-assignment-case:${installationId}:${assignmentIdentity.case_id}`
      ]);
      const node = (await client.query(
        "SELECT revision,next_sequence FROM diagnostic_nodes WHERE installation_id=$1 FOR UPDATE",
        [installationId]
      )).rows[0];
      const material = await loadAssignmentMaterial(client, parsed.input.assignment_id,
        { forUpdate: true });
      verifyClaimBindings({ authorization, verified, material, actor });
      if (materialAuthority) {
        await materialAuthority.assertPackageMaterialAdmissible(client,
          material.row.evidence_package_id, "diagnostic_assignment_claim");
      }
      if (material.state.state !== "unclaimed") {
        throw new KernelError(409, "DIAGNOSTIC_ASSIGNMENT_CLAIM_CONFLICT",
          "Diagnostic Assignment was already claimed or became terminal.",
          { assignment_state: material.state.state });
      }
      if (Date.parse(claimedAt) >= Date.parse(material.row.assignment_document.temporal.expires_at)) {
        throw new KernelError(409, "DIAGNOSTIC_DISPATCH_ASSIGNMENT_EXPIRED",
          "Diagnostic Assignment expired before claim.");
      }
      const priorConsumption = (await client.query(
        `SELECT dispatch_authorization_id,assignment_id,worker_run_id
         FROM diagnostic_dispatch_authorization_consumptions
         WHERE dispatch_authorization_id=$1 OR nonce_digest=$2 OR worker_run_id=$3`,
        [authorization.authorization_id, authorization.nonce_digest,
          authorization.worker_run.worker_run_id]
      )).rows[0];
      if (priorConsumption) {
        throw new KernelError(409, "DIAGNOSTIC_DISPATCH_AUTHORIZATION_ALREADY_CONSUMED",
          "Diagnostic Dispatch Authorization, nonce, or Worker Run was already consumed.");
      }
      const transitionId = randomUUID();
      const sequence = String(node.next_sequence);
      const consumptionDocument = {
        schema_version: DIAGNOSTIC_DISPATCH_CONSUMPTION_SCHEMA,
        dispatch_authorization_id: authorization.authorization_id,
        kernel_authorization_digest: verified.authorization_digest,
        signed_authorization_digest: verified.signed_digest,
        nonce_digest: authorization.nonce_digest,
        assignment_id: material.row.assignment_id,
        assignment_digest: material.row.assignment_digest,
        worker_run_id: authorization.worker_run.worker_run_id,
        worker_principal_id: authorization.worker.principal_id,
        worker_passport_id: authorization.worker.passport_id,
        dispatcher: { type: actor.type, id: actor.id,
          audience: authorization.dispatcher.audience },
        runner_audience: authorization.runner_audience,
        decision_artifact_digest: authorization.decision_artifact_digest,
        consumed_at: claimedAt,
        authority_effect: "assignment_claim_and_exact_worker_run_binding_only"
      };
      const consumptionDigest = sha256Digest(consumptionDocument);
      const workerRunDocument = {
        schema_version: DIAGNOSTIC_WORKER_RUN_SCHEMA,
        worker_run_id: authorization.worker_run.worker_run_id,
        assignment: structuredClone(authorization.assignment),
        dispatch_authorization: {
          dispatch_authorization_id: authorization.authorization_id,
          authorization_digest: verified.authorization_digest,
          signed_authorization_digest: verified.signed_digest,
          consumption_digest: consumptionDigest
        },
        worker: structuredClone(authorization.worker),
        runtime_boundary: {
          runtime: structuredClone(authorization.runtime),
          model: structuredClone(authorization.model),
          broker: structuredClone(authorization.broker),
          resources: structuredClone(authorization.resources),
          data_policy: structuredClone(authorization.data_policy),
          egress_policy: structuredClone(authorization.egress_policy),
          runtime_boundary_digest: authorization.runtime_boundary_digest
        },
        temporal: {
          claimed_at: claimedAt,
          expires_at: authorization.worker_run.expires_at
        },
        initial_state: "claimed_not_launched",
        authority: {
          diagnostic_worker_run: "authorized",
          assignment_claim: "consumed",
          external_business_effects: "none",
          repair: "none",
          broker_token: "not_created",
          provider_request: "not_created",
          model_request: "not_created",
          container_launch: "not_performed",
          diagnosis: "not_created"
        },
        retry_policy: "new_linked_assignment_and_new_authority_required"
      };
      const workerRunDigest = sha256Digest(workerRunDocument);
      await client.query(
        `INSERT INTO diagnostic_dispatch_authorization_consumptions
          (dispatch_authorization_id,installation_id,environment_id,assignment_id,
           assignment_digest,worker_run_id,kernel_authorization_digest,
           signed_authorization_digest,nonce_digest,decision_artifact_digest,claim_command_id,
           consumption_document,consumption_digest,consumed_by_type,consumed_by_id,consumed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [authorization.authorization_id, installationId, environmentId, material.row.assignment_id,
          material.row.assignment_digest, authorization.worker_run.worker_run_id,
          verified.authorization_digest, verified.signed_digest, authorization.nonce_digest,
          authorization.decision_artifact_digest, parsed.command_id, consumptionDocument,
          consumptionDigest, actor.type, actor.id, claimedAt]
      );
      const run = (await client.query(
        `INSERT INTO diagnostic_worker_runs
          (worker_run_id,installation_id,environment_id,assignment_id,assignment_digest,
           evidence_package_id,dispatch_authorization_id,worker_principal_id,worker_passport_id,
           worker_passport_configuration_digest,worker_run_document,worker_run_digest,
           claim_transition_id,claimed_by_type,claimed_by_id,claimed_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [authorization.worker_run.worker_run_id, installationId, environmentId,
          material.row.assignment_id, material.row.assignment_digest,
          material.row.evidence_package_id, authorization.authorization_id,
          authorization.worker.principal_id, authorization.worker.passport_id,
          authorization.worker.passport_configuration_digest, workerRunDocument, workerRunDigest,
          transitionId, actor.type, actor.id, claimedAt, authorization.worker_run.expires_at]
      )).rows[0];
      const runState = (await client.query(
        `INSERT INTO diagnostic_worker_run_states
          (worker_run_id,installation_id,environment_id,worker_run_digest,state,state_revision,
           last_transition_id,updated_at)
         VALUES ($1,$2,$3,$4,'claimed_not_launched',0,$5,$6) RETURNING *`,
        [run.worker_run_id, installationId, environmentId, workerRunDigest,
          transitionId, claimedAt]
      )).rows[0];
      const transitionPayload = {
        assignment_id: material.row.assignment_id,
        assignment_digest: material.row.assignment_digest,
        evidence_package_id: material.row.evidence_package_id,
        dispatch_authorization_id: authorization.authorization_id,
        dispatch_authorization_digest: verified.authorization_digest,
        worker_run_id: run.worker_run_id,
        worker_run_digest: workerRunDigest,
        worker_principal_id: run.worker_principal_id,
        worker_passport_id: run.worker_passport_id,
        prior_state: "unclaimed",
        state: "claimed",
        container_launch: "not_performed",
        broker_token_created: false,
        model_request_created: false,
        external_business_effect_authority: "none"
      };
      const result = {
        command_id: parsed.command_id,
        request_digest: requestDigest,
        accepted_at: claimedAt,
        operation_id: parsed.operation_id,
        actor: { type: actor.type, id: actor.id },
        authorization: actor.authorization ?? {},
        diagnostic_assignment_claim: {
          dispatch_authorization_id: authorization.authorization_id,
          authorization_digest: verified.authorization_digest,
          consumption_digest: consumptionDigest,
          assignment: {
            assignment_id: material.row.assignment_id,
            assignment_digest: material.row.assignment_digest,
            prior_state: "unclaimed",
            state: "claimed",
            state_revision: String(BigInt(material.state.state_revision) + 1n)
          },
          worker_run: workerRunView(run, runState, {
            kernel_authorization_digest: verified.authorization_digest,
            signed_authorization_digest: verified.signed_digest
          }),
          authority_effect: "assignment_claim_and_exact_worker_run_binding_only",
          container_created: false,
          broker_token_created: false,
          provider_request_created: false,
          model_request_created: false,
          diagnosis_created: false,
          external_business_effect_authority: "none"
        },
        transition: {
          transition_id: transitionId,
          type: "diagnostic.assignment.claimed",
          diagnostic_sequence: sequence,
          from_revision: String(BigInt(material.state.state_revision) + 1n),
          to_revision: String(BigInt(material.state.state_revision) + 2n)
        }
      };
      await client.query(
        `INSERT INTO diagnostic_commands
          (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,
           authorization_context,result,accepted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [installationId, parsed.command_id, requestDigest, parsed.operation_id,
          actor.type, actor.id, actor.authorization ?? {}, result, claimedAt]
      );
      await client.query(
        `INSERT INTO diagnostic_transitions
          (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,
           transition_type,from_revision,to_revision,command_id,actor_type,actor_id,
           authorization_context,payload,occurred_at)
         VALUES ($1,$2,$3,'diagnostic_assignment',$4,'diagnostic.assignment.claimed',$5,$6,
           $7,$8,$9,$10,$11,$12)`,
        [transitionId, installationId, sequence, material.row.assignment_id,
          result.transition.from_revision, result.transition.to_revision, parsed.command_id,
          actor.type, actor.id, actor.authorization ?? {}, transitionPayload, claimedAt]
      );
      const assignmentAdvanced = await client.query(
        `UPDATE diagnostic_assignment_states
         SET state='claimed',state_revision=state_revision+1,last_transition_id=$2,updated_at=$3
         WHERE assignment_id=$1 AND state='unclaimed' AND state_revision=$4`,
        [material.row.assignment_id, transitionId, claimedAt, material.state.state_revision]
      );
      if (assignmentAdvanced.rowCount !== 1) {
        throw new KernelError(409, "DIAGNOSTIC_ASSIGNMENT_CLAIM_CONFLICT",
          "Another claimant or terminal transition won the Assignment race.");
      }
      await client.query(
        `INSERT INTO diagnostic_outbox
          (outbox_id,installation_id,transition_id,event_type,payload,created_at)
         VALUES ($1,$2,$3,'diagnostic.assignment.claimed',$4,$5)`,
        [randomUUID(), installationId, transitionId, {
          transition_id: transitionId,
          assignment_id: material.row.assignment_id,
          worker_run_id: run.worker_run_id,
          dispatch_authorization_id: authorization.authorization_id
        }, claimedAt]
      );
      await client.query(
        `UPDATE diagnostic_nodes SET revision=revision+1,next_sequence=next_sequence+1,updated_at=$2
         WHERE installation_id=$1`, [installationId, claimedAt]
      );
      await client.query("COMMIT");
      return { replayed: false, result };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function claim(value, actor, options = {}) {
    return materialAuthority
      ? materialAuthority.runMaterialMutationExclusive(() => claimFenced(value, actor, options))
      : claimFenced(value, actor, options);
  }

  function verifyWorkerRunMaterial(run, state, consumption, transition, command, outbox) {
    const document = run?.worker_run_document;
    const consumed = consumption?.consumption_document;
    if (!run || !state || !consumption || !transition || !command || !outbox
        || document?.schema_version !== DIAGNOSTIC_WORKER_RUN_SCHEMA
        || consumed?.schema_version !== DIAGNOSTIC_DISPATCH_CONSUMPTION_SCHEMA
        || sha256Digest(document) !== run.worker_run_digest
        || sha256Digest(consumed) !== consumption.consumption_digest
        || document.worker_run_id !== run.worker_run_id
        || document.assignment.assignment_id !== run.assignment_id
        || document.assignment.assignment_digest !== run.assignment_digest
        || document.assignment.evidence_package_id !== run.evidence_package_id
        || document.dispatch_authorization.dispatch_authorization_id
          !== run.dispatch_authorization_id
        || consumed.dispatch_authorization_id !== run.dispatch_authorization_id
        || consumed.assignment_id !== run.assignment_id
        || consumed.assignment_digest !== run.assignment_digest
        || consumed.worker_run_id !== run.worker_run_id
        || consumed.nonce_digest !== consumption.nonce_digest
        || consumed.decision_artifact_digest !== consumption.decision_artifact_digest
        || consumption.kernel_authorization_digest
          !== document.dispatch_authorization.authorization_digest
        || consumption.signed_authorization_digest
          !== document.dispatch_authorization.signed_authorization_digest
        || document.dispatch_authorization.consumption_digest !== consumption.consumption_digest
        || consumption.claim_command_id !== command.command_id
        || consumption.consumed_by_type !== run.claimed_by_type
        || consumption.consumed_by_id !== run.claimed_by_id
        || consumed.dispatcher?.type !== run.claimed_by_type
        || consumed.dispatcher?.id !== run.claimed_by_id
        || iso(consumption.consumed_at) !== iso(run.claimed_at)
        || state.worker_run_id !== run.worker_run_id
        || state.worker_run_digest !== run.worker_run_digest
        || !["claimed_not_launched", "launching", "running", "completed", "failed", "cancelled"]
          .includes(state.state)
        || BigInt(state.state_revision) < 0n
        || (state.state === "claimed_not_launched"
          && (String(state.state_revision) !== "0"
            || state.last_transition_id !== transition.transition_id))
        || (state.state !== "claimed_not_launched" && BigInt(state.state_revision) < 1n)
        || transition.transition_type !== "diagnostic.assignment.claimed"
        || transition.aggregate_type !== "diagnostic_assignment"
        || transition.aggregate_id !== run.assignment_id
        || transition.command_id !== command.command_id
        || transition.payload?.worker_run_id !== run.worker_run_id
        || transition.payload?.dispatch_authorization_id !== run.dispatch_authorization_id
        || command.operation_id !== "diagnostic.assignment.claim"
        || command.result?.diagnostic_assignment_claim?.worker_run?.worker_run_id !== run.worker_run_id
        || outbox.transition_id !== transition.transition_id
        || outbox.event_type !== "diagnostic.assignment.claimed"
        || outbox.payload?.worker_run_id !== run.worker_run_id
        || iso(run.claimed_at) !== iso(transition.occurred_at)
        || (state.state === "claimed_not_launched"
          && iso(state.updated_at) !== iso(transition.occurred_at))) {
      throw new KernelError(500, "DIAGNOSTIC_WORKER_RUN_INTEGRITY_VIOLATION",
        "Stored Diagnostic Worker Run does not match its exact authorization consumption and claim history.");
    }
  }

  async function getWorkerRun(workerRunId) {
    routeUuid(workerRunId, "worker_run_id");
    const run = (await pool.query(
      `SELECT * FROM diagnostic_worker_runs
       WHERE installation_id=$1 AND environment_id=$2 AND worker_run_id=$3`,
      [installationId, environmentId, workerRunId]
    )).rows[0];
    if (!run) {
      throw new KernelError(404, "DIAGNOSTIC_WORKER_RUN_NOT_FOUND",
        "Diagnostic Worker Run does not exist.");
    }
    const [state, consumption, transition] = await Promise.all([
      pool.query("SELECT * FROM diagnostic_worker_run_states WHERE worker_run_id=$1", [workerRunId])
        .then((result) => result.rows[0]),
      pool.query(
        "SELECT * FROM diagnostic_dispatch_authorization_consumptions WHERE worker_run_id=$1",
        [workerRunId]).then((result) => result.rows[0]),
      pool.query("SELECT * FROM diagnostic_transitions WHERE transition_id=$1",
        [run.claim_transition_id]).then((result) => result.rows[0])
    ]);
    const command = transition ? (await pool.query(
      "SELECT * FROM diagnostic_commands WHERE installation_id=$1 AND command_id=$2",
      [installationId, transition.command_id]
    )).rows[0] : null;
    const outboxes = transition ? (await pool.query(
      "SELECT * FROM diagnostic_outbox WHERE installation_id=$1 AND transition_id=$2",
      [installationId, transition.transition_id]
    )).rows : [];
    if (outboxes.length !== 1) {
      throw new KernelError(500, "DIAGNOSTIC_WORKER_RUN_INTEGRITY_VIOLATION",
        "Diagnostic Worker Run claim must have one immutable outbox record.");
    }
    verifyWorkerRunMaterial(run, state, consumption, transition, command, outboxes[0]);
    return workerRunView(run, state, consumption);
  }

  return { claim, getDispatchEligibility, getWorkerRun };
}
