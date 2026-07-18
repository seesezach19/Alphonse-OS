import { randomUUID } from "node:crypto";

import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import {
  buildDiagnosticAssignmentStageInput,
  projectDiagnosticAssignment
} from "./diagnostic-assignment-projector.js";
import {
  getAssignmentPolicyActivation,
  verifyAssignmentCreationMaterial,
  verifyAssignmentRow
} from "./diagnostic-assignment-persistence.js";
import {
  DIAGNOSTIC_ASSIGNMENT_RECORD_SCHEMA
} from "./diagnostic-assignment-contracts.js";
import {
  DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_DIGEST,
  DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_MANIFEST
} from "./diagnostic-consistency-artifact.js";
import {
  buildWorkerRunConfiguration,
  DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_RULES_DIGEST,
  DIAGNOSTIC_CONSISTENCY_REPORT_SCHEMA,
  DIAGNOSTIC_CONSISTENCY_SCORE_SCHEMA,
  DIAGNOSTIC_CONSISTENCY_TEST_SCHEMA,
  measureDiagnosticConsistency,
  validateDiagnosticConsistencyPolicy,
  validateDiagnosticConsistencyRubric
} from "./diagnostic-consistency-contracts.js";
import { KernelError } from "./errors.js";
import {
  prepareStageArtifactArchive,
  recordStageArtifactArchive
} from "./stage-artifact-archive.js";

const STAGE_AUTHOR = "diagnostic-consistency-service:v0.1";
const RUBRIC_COMMITMENT_SCHEMA = "alphonse.diagnostic-consistency-rubric-commitment.v0.1";
const SLOT_BINDING_SCHEMA = "alphonse.diagnostic-consistency-assignment-binding.v0.1";
const LIMITATION_SCHEMA = "alphonse.diagnostic-consistency-configuration-limitations.v0.1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function fail(status, code, message, details = {}) {
  throw new KernelError(status, code, message, details);
}

function exact(value, path, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !same(Object.keys(value).sort(), [...fields].sort())) {
    fail(400, "DIAGNOSTIC_CONSISTENCY_INPUT_INVALID", `${path} fields must be exact.`);
  }
  return value;
}

function uuid(value, path) {
  if (typeof value !== "string" || !UUID.test(value)) {
    fail(400, "DIAGNOSTIC_CONSISTENCY_INPUT_INVALID", `${path} must be a UUID.`);
  }
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
}

function parseRegistration(value) {
  exact(value, "command", ["command_id", "operation_id", "input"]);
  if (typeof value.command_id !== "string" || !value.command_id
      || value.command_id.length > 160
      || value.operation_id !== "diagnostic.consistency_test.register") {
    fail(400, "DIAGNOSTIC_CONSISTENCY_INPUT_INVALID",
      "Consistency registration command identity is invalid.");
  }
  exact(value.input, "command.input", [
    "consistency_test_id", "source_worker_run_id", "policy", "hidden_rubric"
  ]);
  uuid(value.input.consistency_test_id, "command.input.consistency_test_id");
  uuid(value.input.source_worker_run_id, "command.input.source_worker_run_id");
  validateDiagnosticConsistencyPolicy(value.input.policy);
  return structuredClone(value);
}

function stateFromCombined(row, prefix = "") {
  return {
    assignment_id: row.assignment_id,
    installation_id: row.installation_id,
    environment_id: row.environment_id,
    assignment_digest: row.assignment_digest,
    state: row[`${prefix}state`],
    state_revision: row[`${prefix}state_revision`],
    last_transition_id: row[`${prefix}last_transition_id`],
    updated_at: row[`${prefix}state_updated_at`]
  };
}

function sourceEvent({ transitionId, installationId, sequence, consistencyTestId, slot,
  commandId, actor, packageBinding, policyDigest, rubricCommitmentDigest, occurredAt }) {
  return {
    schema_version: "alphonse.diagnostic-consistency-assignment-source.v0.1",
    transition_id: transitionId,
    installation_id: installationId,
    diagnostic_sequence: sequence,
    aggregate_type: "diagnostic_consistency_test_slot",
    aggregate_id: `${consistencyTestId}:${slot}`,
    event_type: "diagnostic.consistency_assignment.authorized",
    from_revision: "0",
    to_revision: "1",
    command_id: commandId,
    actor: structuredClone(actor),
    payload: {
      consistency_test_id: consistencyTestId,
      slot,
      evidence_package_id: packageBinding.evidence_package_id,
      evidence_package_semantic_digest: packageBinding.semantic_digest,
      policy_digest: policyDigest,
      rubric_commitment_digest: rubricCommitmentDigest,
      authority_granted: "none"
    },
    occurred_at: occurredAt
  };
}

function assignmentCreationPayload(projection, packageRow, policy) {
  return {
    assignment_id: projection.assignment_id,
    assignment_digest: projection.assignment_digest,
    evidence_package_id: packageRow.evidence_package_id,
    evidence_package_semantic_digest: packageRow.semantic_digest,
    assignment_policy_activation_id: policy.assignment_policy_activation_id,
    assignment_policy_activation_digest: policy.activation_digest,
    initial_state: "unclaimed",
    authority_granted: "none"
  };
}

function verifyTestRow(row) {
  const expectedPackage = {
    evidence_package_id: row.evidence_package_id,
    semantic_digest: row.evidence_package_semantic_digest,
    artifact_digest: row.evidence_package_artifact_digest
  };
  validateDiagnosticConsistencyPolicy(row.policy_document);
  validateDiagnosticConsistencyRubric(row.rubric_document, expectedPackage);
  if (sha256Digest(row.policy_document) !== row.policy_digest
      || sha256Digest(row.rubric_document) !== row.rubric_digest
      || row.rubric_artifact_digest !== row.rubric_digest
      || sha256Digest(row.rubric_commitment_document) !== row.rubric_commitment_digest
      || sha256Digest(row.test_document) !== row.test_digest
      || row.test_document?.schema_version !== DIAGNOSTIC_CONSISTENCY_TEST_SCHEMA
      || row.test_document.consistency_test_id !== row.consistency_test_id
      || row.test_document.rubric_commitment.digest !== row.rubric_commitment_digest
      || !same(row.test_document.evidence_package, expectedPackage)) {
    fail(500, "DIAGNOSTIC_CONSISTENCY_INTEGRITY_VIOLATION",
      "Stored consistency test material failed exact digest verification.");
  }
  return row;
}

function scoreDiagnosis({ test, binding, run, completion, diagnosis, brokerReceipt,
  finalAttestation, configuration, scoredAt }) {
  const rubric = test.rubric_document;
  const expected = rubric.expected_diagnosis;
  const hypothesis = diagnosis.best_supported_hypothesis;
  const roles = [...new Set(diagnosis.supporting_evidence.map((citation) => citation.role))].sort();
  const checks = {
    mechanism: hypothesis.mechanism === expected.mechanism,
    observed_identity_scope:
      hypothesis.observed_identity_scope === expected.observed_identity_scope,
    required_identity_scope:
      hypothesis.required_identity_scope === expected.required_identity_scope,
    support: hypothesis.support === expected.support,
    identity_cardinality: same(diagnosis.identity_cardinality, expected.identity_cardinality),
    implementation_location: same(hypothesis.implementation_location,
      expected.implementation_location),
    required_citation_roles: same(roles, rubric.required_citation_roles),
    assignment_bound: run.assignment_id === binding.assignment_id,
    configuration_bound: configuration.consistency_test_id === test.consistency_test_id
      && configuration.assignment_id === run.assignment_id,
    no_actions_taken: same(diagnosis.actions_taken, []),
    no_forbidden_effects: brokerReceipt.authority?.external_business_effects === "none"
      && finalAttestation.adversarial_checks?.broker_grant_replay === "denied_already_consumed"
  };
  const passed = Object.values(checks).every(Boolean);
  const unsupportedClaimCount = hypothesis.implementation_location.status === "proven"
    && expected.implementation_location.status !== "proven" ? 1 : 0;
  const scoreId = deterministicUuid({ namespace: "diagnostic-consistency-score",
    consistency_test_id: test.consistency_test_id, worker_run_id: run.worker_run_id,
    diagnosis_digest: completion.diagnosis_digest });
  const document = {
    schema_version: DIAGNOSTIC_CONSISTENCY_SCORE_SCHEMA,
    score_id: scoreId,
    consistency_test_id: test.consistency_test_id,
    slot: Number(binding.slot),
    assignment_id: run.assignment_id,
    worker_run_id: run.worker_run_id,
    completion_id: completion.completion_id,
    diagnosis_id: completion.diagnosis_id,
    diagnosis_digest: completion.diagnosis_digest,
    rubric_digest: test.rubric_digest,
    configuration_digest: configuration.configuration_digest,
    checks,
    passed,
    observed: {
      mechanism: hypothesis.mechanism,
      observed_identity_scope: hypothesis.observed_identity_scope,
      required_identity_scope: hypothesis.required_identity_scope,
      support: hypothesis.support,
      confidence: hypothesis.confidence,
      identity_cardinality: structuredClone(diagnosis.identity_cardinality),
      implementation_location: structuredClone(hypothesis.implementation_location),
      citation_roles: roles,
      external_business_effects: 0
    },
    metrics: {
      citation_keys: diagnosis.supporting_evidence.map((citation) => canonicalize(citation)).sort(),
      unsupported_claim_count: unsupportedClaimCount,
      investigation_types: diagnosis.recommended_investigations.map((entry) => entry.type).sort(),
      causal_summary: diagnosis.causal_summary
    },
    provider_assurance: structuredClone(brokerReceipt.provider_assurance),
    scored_at: scoredAt
  };
  return { scoreId, document, digest: sha256Digest(document), passed };
}

export function createDiagnosticConsistencyService({ database, artifactStore, materialAuthority,
  installationId, environmentId }) {
  const { pool, executeCommand } = database;

  async function loadSourceRun(client, workerRunId) {
    const row = (await client.query(
      `SELECT r.*,rs.state AS run_state,rs.state_revision AS run_state_revision,
              a.case_id,a.assignment_series_id,a.assignment_policy_activation_id,a.ordinal,
              a.stage_input_digest,a.assignment_document,a.record_document,a.record_digest,
              a.stage_artifact_digest,a.assignment_rules_digest,a.source_transition_id,a.created_by,
              a.created_at,s.state,s.state_revision,s.last_transition_id,
              s.updated_at AS state_updated_at,e.semantic_digest,e.package_artifact_digest,
              e.frozen_at,c.completion_id,d.diagnosis_id,d.diagnosis_digest
       FROM diagnostic_worker_runs r
       JOIN diagnostic_worker_run_states rs ON rs.worker_run_id=r.worker_run_id
       JOIN diagnostic_assignments a ON a.assignment_id=r.assignment_id
       JOIN diagnostic_assignment_states s ON s.assignment_id=a.assignment_id
       JOIN diagnostic_evidence_packages e ON e.evidence_package_id=a.evidence_package_id
       LEFT JOIN diagnostic_worker_run_completions c ON c.worker_run_id=r.worker_run_id
       LEFT JOIN diagnostic_worker_run_diagnoses d ON d.worker_run_id=r.worker_run_id
       WHERE r.installation_id=$1 AND r.environment_id=$2 AND r.worker_run_id=$3
       FOR SHARE OF r,a,s,e`, [installationId, environmentId, workerRunId]
    )).rows[0];
    if (!row) fail(404, "DIAGNOSTIC_CONSISTENCY_SOURCE_RUN_NOT_FOUND",
      "Source Diagnostic Worker Run does not exist.");
    verifyAssignmentRow(row, stateFromCombined(row));
    if (row.run_state !== "completed" || row.state !== "claimed"
        || !row.completion_id || !row.diagnosis_id || !row.diagnosis_digest) {
      fail(409, "DIAGNOSTIC_CONSISTENCY_SOURCE_RUN_INCOMPLETE",
        "Consistency registration requires one completed governed Test 2 source run.");
    }
    return row;
  }

  async function registerFenced(value, actor) {
    const parsed = parseRegistration(value);
    const command = { ...parsed, actor };
    const requestDigest = sha256Digest({ installation_id: installationId,
      environment_id: environmentId, command });
    const preparedStageArchive = await prepareStageArtifactArchive(
      artifactStore, DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_MANIFEST);
    return executeCommand({ installationId, command, requestDigest,
      apply: async (client, { acceptedAt, sequence, transitionId }) => {
        if (materialAuthority) await materialAuthority.lockMaterialMutation(client);
        const source = await loadSourceRun(client, parsed.input.source_worker_run_id);
        if (materialAuthority) await materialAuthority.assertPackageMaterialAdmissible(client,
          source.evidence_package_id, "diagnostic_consistency_registration");
        const expectedPackage = {
          evidence_package_id: source.evidence_package_id,
          semantic_digest: source.semantic_digest,
          artifact_digest: source.package_artifact_digest
        };
        const policyDocument = validateDiagnosticConsistencyPolicy(parsed.input.policy);
        const rubricDocument = validateDiagnosticConsistencyRubric(
          parsed.input.hidden_rubric, expectedPackage);
        const prior = (await client.query(
          `SELECT consistency_test_id FROM diagnostic_consistency_tests
           WHERE consistency_test_id=$1 OR source_worker_run_id=$2 OR evidence_package_id=$3`,
          [parsed.input.consistency_test_id, source.worker_run_id, source.evidence_package_id]
        )).rows[0];
        if (prior) fail(409, "DIAGNOSTIC_CONSISTENCY_TEST_CONFLICT",
          "This consistency test identity, source run, or package already has a registered test.");
        const otherAssignments = (await client.query(
          `SELECT assignment_id,ordinal FROM diagnostic_assignments
           WHERE installation_id=$1 AND environment_id=$2 AND evidence_package_id=$3
             AND assignment_policy_activation_id=$4 AND assignment_id<>$5`,
          [installationId, environmentId, source.evidence_package_id,
            source.assignment_policy_activation_id, source.assignment_id]
        )).rows;
        if (otherAssignments.length !== 0 || String(source.ordinal) !== "1") {
          fail(409, "DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_SERIES_CONFLICT",
            "Consistency registration requires the untouched one-assignment default series.");
        }
        const policyActivation = await getAssignmentPolicyActivation(client, {
          installationId, environmentId,
          assignmentPolicyActivationId: source.assignment_policy_activation_id
        });
        const rubricStored = await artifactStore.putJson(rubricDocument);
        const rubricDigest = sha256Digest(rubricDocument);
        if (rubricStored.artifact_digest !== rubricDigest) {
          fail(500, "DIAGNOSTIC_CONSISTENCY_RUBRIC_STORAGE_INTEGRITY_VIOLATION",
            "Hidden rubric CAS identity does not match its commitment digest.");
        }
        await client.query(
          `INSERT INTO diagnostic_artifacts
            (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
          [installationId, rubricStored.artifact_digest, rubricStored.size_bytes,
            rubricStored.media_type, rubricStored.storage_key, acceptedAt]
        );
        await recordStageArtifactArchive({ client, installationId, prepared: preparedStageArchive,
          archivedAt: acceptedAt });
        const rubricCommitment = {
          schema_version: RUBRIC_COMMITMENT_SCHEMA,
          rubric_id: rubricDocument.rubric_id,
          artifact: structuredClone(rubricDocument.artifact),
          rubric_digest: rubricDigest,
          rubric_artifact_digest: rubricStored.artifact_digest,
          expected_package: expectedPackage,
          committed_at: acceptedAt,
          disclosure: "digest_and_artifact_identity_only_before_completion"
        };
        const rubricCommitmentDigest = sha256Digest(rubricCommitment);
        const testDocument = {
          schema_version: DIAGNOSTIC_CONSISTENCY_TEST_SCHEMA,
          consistency_test_id: parsed.input.consistency_test_id,
          installation_id: installationId,
          environment_id: environmentId,
          source: { assignment_id: source.assignment_id, worker_run_id: source.worker_run_id,
            diagnosis_id: source.diagnosis_id, diagnosis_digest: source.diagnosis_digest },
          evidence_package: expectedPackage,
          assignment_policy: {
            assignment_policy_activation_id: source.assignment_policy_activation_id,
            activation_digest: policyActivation.activation_digest,
            instruction_digest: policyActivation.instruction_digest,
            output_schema_digest: policyActivation.output_schema_digest
          },
          consistency_policy: { document: policyDocument, digest: sha256Digest(policyDocument) },
          rubric_commitment: { document: rubricCommitment, digest: rubricCommitmentDigest },
          planned_assignments: [
            { slot: 1, assignment_ordinal: "2" },
            { slot: 2, assignment_ordinal: "3" },
            { slot: 3, assignment_ordinal: "4" }
          ],
          stage: { component: STAGE_AUTHOR,
            artifact_digest: DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_DIGEST,
            assignment_rules_digest: DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_RULES_DIGEST },
          registered_at: acceptedAt,
          authority: { assignments: "three_unclaimed_authority_free",
            dispatch: "not_granted", model_requests: "not_granted",
            repair: "none", external_business_effects: "none" }
        };
        const testDigest = sha256Digest(testDocument);
        await client.query(
          `INSERT INTO diagnostic_consistency_tests
            (consistency_test_id,installation_id,environment_id,case_id,evidence_package_id,
             evidence_package_semantic_digest,evidence_package_artifact_digest,source_assignment_id,
             source_worker_run_id,assignment_policy_activation_id,policy_document,policy_digest,
             rubric_document,rubric_digest,rubric_artifact_digest,rubric_commitment_document,
             rubric_commitment_digest,test_document,test_digest,registration_transition_id,
             registered_by_type,registered_by_id,registered_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                   $20,$21,$22,$23)`,
          [parsed.input.consistency_test_id, installationId, environmentId, source.case_id,
            source.evidence_package_id, source.semantic_digest, source.package_artifact_digest,
            source.assignment_id, source.worker_run_id, source.assignment_policy_activation_id,
            policyDocument, sha256Digest(policyDocument), rubricDocument, rubricDigest,
            rubricStored.artifact_digest, rubricCommitment, rubricCommitmentDigest,
            testDocument, testDigest, transitionId, actor.type, actor.id, acceptedAt]
        );
        const createdAssignments = [];
        const packageRow = { evidence_package_id: source.evidence_package_id,
          semantic_digest: source.semantic_digest, package_artifact_digest: source.package_artifact_digest,
          frozen_at: iso(source.frozen_at), case_id: source.case_id };
        for (let slot = 1; slot <= 3; slot += 1) {
          const ordinal = String(slot + 1);
          const slotCommandId = `consistency-slot:${parsed.input.consistency_test_id}:${slot}`;
          const slotTransitionId = randomUUID();
          const slotSequence = String(BigInt(sequence) + BigInt((slot - 1) * 2 + 1));
          const slotActor = { type: "service", id: STAGE_AUTHOR };
          const slotSource = sourceEvent({ transitionId: slotTransitionId, installationId,
            sequence: slotSequence, consistencyTestId: parsed.input.consistency_test_id, slot,
            commandId: slotCommandId, actor: slotActor, packageBinding: expectedPackage,
            policyDigest: sha256Digest(policyDocument), rubricCommitmentDigest,
            occurredAt: acceptedAt });
          const slotRequestDigest = sha256Digest(slotSource.payload);
          await client.query(
            `INSERT INTO diagnostic_commands
              (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
             VALUES ($1,$2,$3,'diagnostic.consistency_assignment.authorize','service',$4,$5,$6)`,
            [installationId, slotCommandId, slotRequestDigest, STAGE_AUTHOR,
              { consistency_test_id: parsed.input.consistency_test_id, slot,
                authority_granted: "none" }, acceptedAt]
          );
          await client.query(
            `INSERT INTO diagnostic_transitions
              (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,
               transition_type,from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
             VALUES ($1,$2,$3,'diagnostic_consistency_test_slot',$4,
               'diagnostic.consistency_assignment.authorized',0,1,$5,'service',$6,$7,$8)`,
            [slotTransitionId, installationId, slotSequence,
              `${parsed.input.consistency_test_id}:${slot}`, slotCommandId, STAGE_AUTHOR,
              slotSource.payload, acceptedAt]
          );
          const stageInput = buildDiagnosticAssignmentStageInput({
            installationId, environmentId, sourceEvent: slotSource, evidencePackage: packageRow,
            assignmentPolicyActivation: policyActivation,
            stageArtifactDigest: DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_DIGEST,
            ordinal,
            consistencyTest: { consistency_test_id: parsed.input.consistency_test_id, slot,
              policy_digest: sha256Digest(policyDocument),
              rubric_commitment_digest: rubricCommitmentDigest },
            assignmentRulesDigest: DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_RULES_DIGEST
          });
          const projection = projectDiagnosticAssignment({
            stageInput, assignmentPolicy: policyActivation.policy_document,
            stageArtifactDigest: DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_DIGEST,
            stageAuthor: STAGE_AUTHOR,
            assignmentRulesDigest: DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_RULES_DIGEST
          });
          const recordDocument = {
            schema_version: DIAGNOSTIC_ASSIGNMENT_RECORD_SCHEMA,
            assignment_id: projection.assignment_id,
            assignment_digest: projection.assignment_digest,
            stage_input_digest: projection.stage_input_digest,
            source_transition_id: slotTransitionId,
            created_by: STAGE_AUTHOR,
            created_at: acceptedAt
          };
          const assignmentRow = (await client.query(
            `INSERT INTO diagnostic_assignments
              (assignment_id,assignment_series_id,installation_id,environment_id,case_id,
               evidence_package_id,assignment_policy_activation_id,ordinal,stage_input_digest,
               assignment_document,assignment_digest,record_document,record_digest,
               stage_artifact_digest,assignment_rules_digest,source_transition_id,created_by,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             RETURNING *`,
            [projection.assignment_id, projection.assignment_series_id, installationId, environmentId,
              source.case_id, source.evidence_package_id, source.assignment_policy_activation_id,
              ordinal, projection.stage_input_digest, projection.assignment,
              projection.assignment_digest, recordDocument, sha256Digest(recordDocument),
              DIAGNOSTIC_CONSISTENCY_STAGE_ARTIFACT_DIGEST,
              DIAGNOSTIC_CONSISTENCY_ASSIGNMENT_RULES_DIGEST, slotTransitionId,
              STAGE_AUTHOR, acceptedAt]
          )).rows[0];
          const creationCommandId = `consistency-assignment-create:${projection.assignment_id}`;
          const creationTransitionId = randomUUID();
          const creationSequence = String(BigInt(slotSequence) + 1n);
          const creationPayload = assignmentCreationPayload(projection, packageRow, policyActivation);
          await client.query(
            `INSERT INTO diagnostic_commands
              (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,result,accepted_at)
             VALUES ($1,$2,$3,'diagnostic.assignment.create','service',$4,$5,$6)`,
            [installationId, creationCommandId, projection.stage_input_digest, STAGE_AUTHOR,
              { assignment_id: projection.assignment_id,
                assignment_digest: projection.assignment_digest }, acceptedAt]
          );
          await client.query(
            `INSERT INTO diagnostic_transitions
              (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,
               transition_type,from_revision,to_revision,command_id,actor_type,actor_id,payload,occurred_at)
             VALUES ($1,$2,$3,'diagnostic_assignment',$4,'diagnostic.assignment.created',0,1,$5,
                     'service',$6,$7,$8)`,
            [creationTransitionId, installationId, creationSequence, projection.assignment_id,
              creationCommandId, STAGE_AUTHOR, creationPayload, acceptedAt]
          );
          const assignmentState = (await client.query(
            `INSERT INTO diagnostic_assignment_states
              (assignment_id,installation_id,environment_id,assignment_digest,state,state_revision,
               last_transition_id,updated_at)
             VALUES ($1,$2,$3,$4,'unclaimed',0,$5,$6) RETURNING *`,
            [projection.assignment_id, installationId, environmentId,
              projection.assignment_digest, creationTransitionId, acceptedAt]
          )).rows[0];
          const outbox = (await client.query(
            `INSERT INTO diagnostic_outbox
              (outbox_id,installation_id,transition_id,event_type,payload,created_at)
             VALUES ($1,$2,$3,'diagnostic.assignment.created',$4,$5) RETURNING *`,
            [randomUUID(), installationId, creationTransitionId,
              { transition_id: creationTransitionId, assignment_id: projection.assignment_id },
              acceptedAt]
          )).rows[0];
          const binding = {
            schema_version: SLOT_BINDING_SCHEMA,
            consistency_test_id: parsed.input.consistency_test_id,
            slot,
            assignment_id: projection.assignment_id,
            assignment_digest: projection.assignment_digest,
            assignment_ordinal: ordinal,
            source_transition_id: slotTransitionId,
            evidence_package: expectedPackage,
            policy_digest: sha256Digest(policyDocument),
            rubric_commitment_digest: rubricCommitmentDigest,
            authority_granted: "none",
            created_at: acceptedAt
          };
          await client.query(
            `INSERT INTO diagnostic_consistency_test_assignments
              (consistency_test_id,slot,assignment_id,assignment_ordinal,source_transition_id,
               binding_document,binding_digest,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [parsed.input.consistency_test_id, slot, projection.assignment_id, ordinal,
              slotTransitionId, binding, sha256Digest(binding), acceptedAt]
          );
          verifyAssignmentRow(assignmentRow, assignmentState);
          verifyAssignmentCreationMaterial({ row: assignmentRow, state: assignmentState,
            transition: { transition_id: creationTransitionId, installation_id: installationId,
              aggregate_type: "diagnostic_assignment", aggregate_id: projection.assignment_id,
              transition_type: "diagnostic.assignment.created", from_revision: "0", to_revision: "1",
              command_id: creationCommandId, actor_type: "service", actor_id: STAGE_AUTHOR,
              payload: creationPayload, occurred_at: acceptedAt },
            command: { installation_id: installationId, command_id: creationCommandId,
              request_digest: projection.stage_input_digest,
              operation_id: "diagnostic.assignment.create", actor_type: "service",
              actor_id: STAGE_AUTHOR, result: { assignment_id: projection.assignment_id,
                assignment_digest: projection.assignment_digest }, accepted_at: acceptedAt },
            outbox });
          createdAssignments.push({ slot, assignment_id: projection.assignment_id,
            assignment_digest: projection.assignment_digest, ordinal, state: "unclaimed" });
        }
        await client.query(
          `UPDATE diagnostic_nodes SET revision=revision+6,next_sequence=next_sequence+6,updated_at=$2
           WHERE installation_id=$1`, [installationId, acceptedAt]
        );
        return {
          aggregateType: "diagnostic_consistency_test",
          aggregateId: parsed.input.consistency_test_id,
          transitionType: "diagnostic.consistency_test.registered",
          transitionPayload: { consistency_test_id: parsed.input.consistency_test_id,
            source_worker_run_id: source.worker_run_id,
            evidence_package_id: source.evidence_package_id,
            policy_digest: sha256Digest(policyDocument), rubric_commitment_digest: rubricCommitmentDigest,
            assignments_created: 3, authority_granted: "none" },
          result: { diagnostic_consistency_test: {
            consistency_test_id: parsed.input.consistency_test_id,
            test_digest: testDigest,
            evidence_package: expectedPackage,
            policy_digest: sha256Digest(policyDocument),
            rubric_commitment: rubricCommitment,
            rubric_commitment_digest: rubricCommitmentDigest,
            assignments: createdAssignments,
            state: "registered",
            authority: testDocument.authority
          } }
        };
      }
    });
  }

  async function register(value, actor) {
    return materialAuthority ? materialAuthority.runMaterialMutationExclusive(() =>
      registerFenced(value, actor)) : registerFenced(value, actor);
  }

  async function recordLaunchConfiguration(client, { run, inputDocument, acceptedAt }) {
    const binding = (await client.query(
      `SELECT b.*,t.* FROM diagnostic_consistency_test_assignments b
       JOIN diagnostic_consistency_tests t ON t.consistency_test_id=b.consistency_test_id
       WHERE b.assignment_id=$1`, [run.assignment_id]
    )).rows[0];
    if (!binding) return null;
    verifyTestRow(binding);
    const built = buildWorkerRunConfiguration({
      assignmentDocument: run.assignment_document,
      workerRunDocument: run.worker_run_document,
      inputDocument
    });
    const prior = (await client.query(
      `SELECT configuration_digest FROM diagnostic_worker_run_configurations
       WHERE consistency_test_id=$1 ORDER BY recorded_at,worker_run_id`,
      [binding.consistency_test_id]
    )).rows;
    if (prior.some((row) => row.configuration_digest !== built.configuration_digest)) {
      fail(409, "DIAGNOSTIC_CONSISTENCY_CONFIGURATION_MISMATCH",
        "Worker Run configuration differs from the already-bound consistency configuration.",
        { expected_configuration_digest: prior[0].configuration_digest,
          received_configuration_digest: built.configuration_digest });
    }
    const limitationDocument = {
      schema_version: LIMITATION_SCHEMA,
      consistency_test_id: binding.consistency_test_id,
      worker_run_id: run.worker_run_id,
      limitations: built.limitations,
      reproducibility_claim: built.limitations.length === 0
        ? "exact_declared_configuration" : "exact_declared_configuration_with_recorded_limitations"
    };
    await client.query(
      `INSERT INTO diagnostic_worker_run_configurations
        (worker_run_id,consistency_test_id,assignment_id,configuration_document,
         configuration_digest,limitation_document,limitation_digest,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [run.worker_run_id, binding.consistency_test_id, run.assignment_id, built.document,
        built.configuration_digest, limitationDocument, sha256Digest(limitationDocument), acceptedAt]
    );
    return { consistency_test_id: binding.consistency_test_id,
      configuration_digest: built.configuration_digest, limitations: built.limitations };
  }

  async function recordDiagnosisScore(client, { run, completion, diagnosis, brokerReceipt,
    finalAttestation }) {
    const binding = (await client.query(
      `SELECT b.*,t.* FROM diagnostic_consistency_test_assignments b
       JOIN diagnostic_consistency_tests t ON t.consistency_test_id=b.consistency_test_id
       WHERE b.assignment_id=$1`, [run.assignment_id]
    )).rows[0];
    if (!binding) return null;
    verifyTestRow(binding);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `diagnostic-consistency-test:${binding.consistency_test_id}`
    ]);
    const configuration = (await client.query(
      "SELECT * FROM diagnostic_worker_run_configurations WHERE worker_run_id=$1",
      [run.worker_run_id]
    )).rows[0];
    if (!configuration
        || sha256Digest(configuration.configuration_document) !== configuration.configuration_digest
        || sha256Digest(configuration.limitation_document) !== configuration.limitation_digest) {
      fail(500, "DIAGNOSTIC_CONSISTENCY_CONFIGURATION_INTEGRITY_VIOLATION",
        "Completed consistency run is missing its exact prelaunch configuration.");
    }
    const score = scoreDiagnosis({ test: binding, binding, run, completion, diagnosis,
      brokerReceipt, finalAttestation, configuration, scoredAt: completion.completed_at });
    await client.query(
      `INSERT INTO diagnostic_consistency_scores
        (score_id,consistency_test_id,worker_run_id,assignment_id,completion_id,diagnosis_id,
         diagnosis_digest,configuration_digest,score_document,score_digest,passed,scored_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [score.scoreId, binding.consistency_test_id, run.worker_run_id, run.assignment_id,
        completion.completion_id, completion.diagnosis_id, completion.diagnosis_digest,
        configuration.configuration_digest, score.document, score.digest, score.passed,
        completion.completed_at]
    );
    const scores = (await client.query(
      `SELECT s.* FROM diagnostic_consistency_scores s
       JOIN diagnostic_consistency_test_assignments b ON b.assignment_id=s.assignment_id
       WHERE s.consistency_test_id=$1 ORDER BY b.slot`, [binding.consistency_test_id]
    )).rows;
    let report = null;
    if (scores.length === 3) {
      const configurations = (await client.query(
        `SELECT c.* FROM diagnostic_worker_run_configurations c
         JOIN diagnostic_consistency_test_assignments b ON b.assignment_id=c.assignment_id
         WHERE c.consistency_test_id=$1 ORDER BY b.slot`, [binding.consistency_test_id]
      )).rows;
      const configurationDigests = [...new Set(configurations.map((row) => row.configuration_digest))];
      if (configurations.length !== 3 || configurationDigests.length !== 1) {
        fail(500, "DIAGNOSTIC_CONSISTENCY_CONFIGURATION_INTEGRITY_VIOLATION",
          "Completed consistency test does not have one exact configuration digest.");
      }
      const metrics = measureDiagnosticConsistency(scores, binding.rubric_document.scoring.confidence_scale);
      const passedCount = scores.filter((row) => row.passed).length;
      const limitations = [...new Set(configurations.flatMap((row) =>
        row.limitation_document.limitations))].sort();
      const syntheticReferenceFixture = limitations
        .includes("synthetic_reference_provider_not_model_quality_evidence");
      const reportId = deterministicUuid({ namespace: "diagnostic-consistency-report",
        consistency_test_id: binding.consistency_test_id,
        score_digests: scores.map((row) => row.score_digest) });
      const reportDocument = {
        schema_version: DIAGNOSTIC_CONSISTENCY_REPORT_SCHEMA,
        report_id: reportId,
        consistency_test_id: binding.consistency_test_id,
        test_digest: binding.test_digest,
        rubric_commitment_digest: binding.rubric_commitment_digest,
        rubric_digest: binding.rubric_digest,
        evidence_package: {
          evidence_package_id: binding.evidence_package_id,
          semantic_digest: binding.evidence_package_semantic_digest,
          artifact_digest: binding.evidence_package_artifact_digest
        },
        platform_reproducibility: {
          result: "passed",
          configuration_digest: configurationDigests[0],
          exact_configuration_count: 3,
          distinct_assignment_count: new Set(scores.map((row) => row.assignment_id)).size,
          distinct_worker_run_count: new Set(scores.map((row) => row.worker_run_id)).size,
          exact_declared_configuration_reproduced: true,
          model_output_determinism_claimed: false
        },
        model_consistency: {
          result: passedCount === 3 ? "passed" : "failed",
          passed_runs: passedCount,
          required_runs: 3,
          required_passes: 3,
          metrics,
          claim_scope: syntheticReferenceFixture
            ? "preregistered_three_run_synthetic_reference_fixture_only"
            : "preregistered_three_run_observed_outputs_only"
        },
        diagnoses: scores.map((row) => ({
          worker_run_id: row.worker_run_id,
          assignment_id: row.assignment_id,
          diagnosis_id: row.diagnosis_id,
          diagnosis_digest: row.diagnosis_digest,
          score_id: row.score_id,
          score_digest: row.score_digest,
          passed: row.passed
        })),
        limitations,
        consensus_diagnosis_created: false,
        diagnoses_preserved_independently: true,
        external_business_effects: 0,
        repair_authority: "none",
        completed_at: completion.completed_at
      };
      const reportDigest = sha256Digest(reportDocument);
      await client.query(
        `INSERT INTO diagnostic_consistency_reports
          (report_id,consistency_test_id,report_document,report_digest,completed_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [reportId, binding.consistency_test_id, reportDocument, reportDigest,
          completion.completed_at]
      );
      report = { report_id: reportId, report_digest: reportDigest,
        result: reportDocument.model_consistency.result };
    }
    return { score_id: score.scoreId, score_digest: score.digest, passed: score.passed,
      report };
  }

  async function getTest(consistencyTestId) {
    uuid(consistencyTestId, "consistency_test_id");
    const test = (await pool.query(
      `SELECT * FROM diagnostic_consistency_tests
       WHERE installation_id=$1 AND environment_id=$2 AND consistency_test_id=$3`,
      [installationId, environmentId, consistencyTestId]
    )).rows[0];
    if (!test) fail(404, "DIAGNOSTIC_CONSISTENCY_TEST_NOT_FOUND",
      "Diagnostic Consistency Test does not exist.");
    verifyTestRow(test);
    const [assignments, configurations, scores, report] = await Promise.all([
      pool.query(
        `SELECT b.*,a.assignment_digest,s.state,s.state_revision,s.last_transition_id,
                s.updated_at AS state_updated_at
         FROM diagnostic_consistency_test_assignments b
         JOIN diagnostic_assignments a ON a.assignment_id=b.assignment_id
         JOIN diagnostic_assignment_states s ON s.assignment_id=b.assignment_id
         WHERE b.consistency_test_id=$1 ORDER BY b.slot`, [consistencyTestId]
      ).then((result) => result.rows),
      pool.query(
        "SELECT * FROM diagnostic_worker_run_configurations WHERE consistency_test_id=$1 ORDER BY recorded_at",
        [consistencyTestId]).then((result) => result.rows),
      pool.query(
        `SELECT s.* FROM diagnostic_consistency_scores s
         JOIN diagnostic_consistency_test_assignments b ON b.assignment_id=s.assignment_id
         WHERE s.consistency_test_id=$1 ORDER BY b.slot`, [consistencyTestId]
      ).then((result) => result.rows),
      pool.query("SELECT * FROM diagnostic_consistency_reports WHERE consistency_test_id=$1",
        [consistencyTestId]).then((result) => result.rows[0] ?? null)
    ]);
    if (assignments.length !== 3
        || assignments.some((row) => sha256Digest(row.binding_document) !== row.binding_digest)
        || configurations.some((row) => sha256Digest(row.configuration_document)
          !== row.configuration_digest || sha256Digest(row.limitation_document) !== row.limitation_digest)
        || scores.some((row) => sha256Digest(row.score_document) !== row.score_digest)
        || report && sha256Digest(report.report_document) !== report.report_digest) {
      fail(500, "DIAGNOSTIC_CONSISTENCY_INTEGRITY_VIOLATION",
        "Consistency Test read model failed immutable digest verification.");
    }
    return {
      consistency_test_id: consistencyTestId,
      test_digest: test.test_digest,
      evidence_package: {
        evidence_package_id: test.evidence_package_id,
        semantic_digest: test.evidence_package_semantic_digest,
        artifact_digest: test.evidence_package_artifact_digest
      },
      policy: { document: test.policy_document, digest: test.policy_digest },
      rubric_commitment: {
        document: test.rubric_commitment_document,
        digest: test.rubric_commitment_digest,
        rubric_document_exposed: false
      },
      assignments: assignments.map((row) => ({
        slot: Number(row.slot), assignment_id: row.assignment_id,
        assignment_digest: row.assignment_digest, assignment_ordinal: String(row.assignment_ordinal),
        state: row.state,
        configuration: configurations.find((entry) => entry.assignment_id === row.assignment_id)
          ? { configuration_digest: configurations.find((entry) =>
            entry.assignment_id === row.assignment_id).configuration_digest } : null,
        score: scores.find((entry) => entry.assignment_id === row.assignment_id)
          ? { score_id: scores.find((entry) => entry.assignment_id === row.assignment_id).score_id,
            score_digest: scores.find((entry) => entry.assignment_id === row.assignment_id).score_digest,
            passed: scores.find((entry) => entry.assignment_id === row.assignment_id).passed } : null
      })),
      state: report ? "completed" : scores.length > 0 || configurations.length > 0 ? "running" : "registered",
      report: report ? { report_id: report.report_id, report_digest: report.report_digest,
        document: report.report_document } : null,
      authority: { repair: "none", external_business_effects: "none" },
      immutable: true
    };
  }

  return { register, recordLaunchConfiguration, recordDiagnosisScore, getTest };
}
