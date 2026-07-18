import { createHash, randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  citationIndexFromWorkerInput,
  DIAGNOSTIC_BROKER_GRANT_SCHEMA,
  DIAGNOSTIC_BROKER_RECEIPT_SCHEMA,
  DIAGNOSTIC_WORKER_INPUT_SCHEMA,
  DIAGNOSTIC_WORKER_OUTPUT_ENVELOPE_SCHEMA,
  signDiagnosticRuntimeDocument,
  validateDiagnosticOutputFileBoundary,
  validateDiagnosticWorkerOutput,
  verifyBrokerReceipt,
  verifyRunnerAttestation
} from "./diagnostic-worker-execution-contracts.js";
import { KernelError } from "./errors.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ALLOWED_WORKER_ENVIRONMENT = new Set([
  "CODEX_HOME", "DIAGNOSTIC_MODEL_BROKER_URL", "DIAGNOSTIC_SIGNED_BROKER_GRANT_BASE64",
  "HOME", "NODE_VERSION", "PATH", "YARN_VERSION"
]);

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function fail(status, code, message, details = {}) {
  throw new KernelError(status, code, message, details);
}

function exact(value, path, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !same(Object.keys(value).sort(), [...fields].sort())) {
    fail(400, "DIAGNOSTIC_WORKER_EXECUTION_INPUT_INVALID", `${path} fields must be exact.`);
  }
  return value;
}

function uuid(value, path) {
  if (typeof value !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    fail(400, "DIAGNOSTIC_WORKER_EXECUTION_INPUT_INVALID", `${path} must be a UUID.`);
  }
  return value;
}

function parseCommand(value, operationId, inputFields) {
  exact(value, "command", ["command_id", "operation_id", "input"]);
  if (typeof value.command_id !== "string" || !value.command_id
      || value.command_id.length > 160 || value.operation_id !== operationId) {
    fail(400, "DIAGNOSTIC_WORKER_EXECUTION_INPUT_INVALID",
      `Command must use ${operationId} with a bounded command_id.`);
  }
  exact(value.input, "command.input", inputFields);
  return structuredClone(value);
}

function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function iso(value) {
  return new Date(value).toISOString();
}

function exactTmpfsOptions(value, expected) {
  if (typeof value !== "string") return false;
  const options = value.split(",").filter(Boolean);
  return options.length === expected.length && same([...options].sort(), [...expected].sort());
}

function transitionState(client, run, state, nextState, transitionId, at) {
  return client.query(
    `UPDATE diagnostic_worker_run_states
     SET state=$2,state_revision=state_revision+1,last_transition_id=$3,updated_at=$4
     WHERE worker_run_id=$1 AND state=$5 AND state_revision=$6`,
    [run.worker_run_id, nextState, transitionId, at, state.state, state.state_revision]
  ).then((result) => {
    if (result.rowCount !== 1) {
      fail(409, "DIAGNOSTIC_WORKER_RUN_STATE_CONFLICT",
        "Diagnostic Worker Run state changed concurrently.");
    }
  });
}

function validateRuntimeBoundary(attestation, runtimeBoundary, inputDigest, phase,
  startAttestation = null) {
  if (attestation.phase !== phase || attestation.launch_id === undefined
      || attestation.worker_run_id === undefined
      || !same(attestation.runner, runtimeBoundary.runtime.runner)
      || attestation.input_digest !== undefined && attestation.input_digest !== inputDigest
      || !DIGEST.test(attestation.broker_image_digest ?? "")) {
    fail(409, "DIAGNOSTIC_RUNNER_ATTESTATION_BINDING_MISMATCH",
      "Runner attestation does not bind the exact launch boundary.");
  }
  const engine = attestation.runtime_engine;
  if (!engine || engine.kind !== "docker_engine"
      || ["version", "api_version", "operating_system", "architecture", "kernel_version"]
        .some((field) => typeof engine[field] !== "string" || !engine[field])
      || phase === "exited" && !same(engine, startAttestation?.document?.runtime_engine)) {
    fail(409, "DIAGNOSTIC_RUNNER_RUNTIME_INVALID",
      "Runner attestation does not bind one exact Docker runtime across start and exit.");
  }
  const container = attestation.container;
  const security = container?.security;
  const mounts = container?.mounts;
  const resources = container?.resources;
  const expectedResources = runtimeBoundary.resources;
  if (!container || container.image_digest !== runtimeBoundary.runtime.image.digest
      || container.configured_image !== runtimeBoundary.runtime.image.digest
      || security?.user !== "10001:10001" || security.privileged !== false
      || security.read_only_root !== true || security.no_new_privileges !== true
      || !same(security.cap_drop, ["ALL"]) || security.pid_mode !== "private"
      || security.ipc_mode !== "private" || security.uts_mode !== "private"
      || !same(security.devices, []) || security.docker_socket_mounted !== false
      || mounts?.input?.type !== "bind" || mounts.input.read_only !== true
      || mounts.input.destination !== "/input" || mounts.input.content_digest !== inputDigest
      || mounts.output?.type !== "tmpfs" || mounts.output.destination !== "/output"
      || mounts.output.bounded_bytes !== expectedResources.max_output_bytes
      || !exactTmpfsOptions(mounts.output.options, ["rw", "noexec", "nosuid", "nodev",
        `size=${expectedResources.max_output_bytes}`, "mode=0700", "uid=10001", "gid=10001"])
      || mounts.temporary?.type !== "tmpfs" || mounts.home?.type !== "tmpfs"
      || !exactTmpfsOptions(mounts.temporary.options, ["rw", "noexec", "nosuid", "nodev",
        "size=16777216", "mode=0700", "uid=10001", "gid=10001"])
      || !exactTmpfsOptions(mounts.home.options, ["rw", "noexec", "nosuid", "nodev",
        "size=1048576", "mode=0700", "uid=10001", "gid=10001"])
      || mounts.host_workspace_mounted !== false
      || resources?.memory_bytes !== expectedResources.max_memory_bytes
      || resources.nano_cpus !== expectedResources.max_cpus * 1_000_000_000
      || resources.pids_limit !== expectedResources.max_pids
      || !Array.isArray(container.environment_keys)
      || container.environment_keys.some((key) => !ALLOWED_WORKER_ENVIRONMENT.has(key))) {
    fail(409, "DIAGNOSTIC_RUNNER_ISOLATION_INVALID",
      "Runner attestation does not prove the exact closed container boundary.");
  }
  const network = attestation.network;
  const expectedAttachedCount = phase === "started" ? 2 : null;
  if (network?.driver !== "bridge" || network.internal !== true || network.ingress !== false
      || network.general_egress !== false
      || network.allowed_destination !== "diagnostic_model_broker_only"
      || !Array.isArray(network.attached_container_ids)
      || !Array.isArray(network.attached_container_names)
      || network.attached_container_ids.length !== network.attached_container_names.length
      || (expectedAttachedCount !== null
        && network.attached_container_ids.length !== expectedAttachedCount)
      || (phase === "exited"
        && ![1, 2].includes(network.attached_container_ids.length))
      || (phase === "started" && !network.attached_container_names.includes(container.name))
      || (phase === "exited" && network.attached_container_names.length === 2
        && !network.attached_container_names.includes(container.name))
      || !network.attached_container_names.some((name) => name.includes("diagnostic-broker"))
      || !same(network.forbidden_destinations,
        ["general_dns", "internet", "lan", "cloud_metadata", "kernel", "data_plane", "database"])) {
    fail(409, "DIAGNOSTIC_RUNNER_NETWORK_INVALID",
      "Runner attestation does not prove one internal Broker-only network.");
  }
  if (phase === "started" && container.status !== "running") {
    fail(409, "DIAGNOSTIC_RUNNER_NOT_RUNNING",
      "Started attestation must observe the Worker container running.");
  }
  if (phase === "exited" && (container.status !== "exited" || container.exit_code !== 0
      || container.oom_killed !== false || !startAttestation
      || container.container_id !== startAttestation.document.container.container_id
      || attestation.start_attestation_digest !== sha256Digest(startAttestation.signed))) {
    fail(409, "DIAGNOSTIC_RUNNER_EXIT_INVALID",
      "Final attestation does not prove a successful exit of the exact started container.");
  }
}

export function createDiagnosticWorkerExecutionService({ database, artifactStore,
  materialAuthority, installationId, environmentId, brokerGrantSigning,
  brokerReceiptSigning, runnerSigning, consistencyEvaluator = null }) {
  const { pool, executeCommand } = database;

  async function loadRun(client, workerRunId, forUpdate = false) {
    const row = (await client.query(
      `SELECT r.*,s.state,s.state_revision,s.last_transition_id,s.updated_at AS state_updated_at,
              a.assignment_document,a.assignment_policy_activation_id,
              p.policy_document,e.semantic_digest AS package_semantic_digest,
              e.package_artifact_digest
       FROM diagnostic_worker_runs r
       JOIN diagnostic_worker_run_states s ON s.worker_run_id=r.worker_run_id
       JOIN diagnostic_assignments a ON a.assignment_id=r.assignment_id
       JOIN diagnostic_assignment_policy_activations p
         ON p.assignment_policy_activation_id=a.assignment_policy_activation_id
       JOIN diagnostic_evidence_packages e ON e.evidence_package_id=r.evidence_package_id
       WHERE r.installation_id=$1 AND r.environment_id=$2 AND r.worker_run_id=$3
       ${forUpdate ? "FOR UPDATE OF s" : ""}`,
      [installationId, environmentId, workerRunId]
    )).rows[0];
    if (!row) fail(404, "DIAGNOSTIC_WORKER_RUN_NOT_FOUND",
      "Diagnostic Worker Run does not exist.");
    if (sha256Digest(row.worker_run_document) !== row.worker_run_digest
        || row.worker_run_document.worker_run_id !== row.worker_run_id
        || row.worker_run_document.assignment.assignment_digest !== row.assignment_digest
        || row.worker_run_document.assignment.evidence_package_id !== row.evidence_package_id
        || row.worker_run_document.runtime_boundary.runtime_boundary_digest
          !== sha256Digest({
            runtime: row.worker_run_document.runtime_boundary.runtime,
            resources: row.worker_run_document.runtime_boundary.resources,
            data_policy: row.worker_run_document.runtime_boundary.data_policy,
            egress_policy: row.worker_run_document.runtime_boundary.egress_policy
          })) {
      fail(500, "DIAGNOSTIC_WORKER_RUN_INTEGRITY_VIOLATION",
        "Worker Run immutable material failed exact integrity verification.");
    }
    return { run: row, state: {
      state: row.state, state_revision: row.state_revision,
      last_transition_id: row.last_transition_id, updated_at: row.state_updated_at
    } };
  }

  async function authorizeLaunchFenced(value, actor) {
    const parsed = parseCommand(value, "diagnostic.worker_run.launch_authorize", ["worker_run_id"]);
    const workerRunId = uuid(parsed.input.worker_run_id, "command.input.worker_run_id");
    const command = { ...parsed, actor };
    return executeCommand({
      installationId, command,
      requestDigest: sha256Digest({ installation_id: installationId,
        environment_id: environmentId, command }),
      apply: async (client, { acceptedAt, transitionId }) => {
        if (materialAuthority) await materialAuthority.lockMaterialMutation(client);
        const { run, state } = await loadRun(client, workerRunId, true);
        if (state.state !== "claimed_not_launched") fail(409,
          "DIAGNOSTIC_WORKER_RUN_LAUNCH_CONFLICT", "Worker Run was already launched or terminated.");
        if (Date.parse(acceptedAt) >= Date.parse(run.expires_at)) fail(409,
          "DIAGNOSTIC_WORKER_RUN_EXPIRED", "Worker Run expired before launch authorization.");
        if (materialAuthority) await materialAuthority.assertPackageMaterialAdmissible(client,
          run.evidence_package_id, "diagnostic_worker_launch");
        const stored = await artifactStore.getJson(run.package_artifact_digest);
        if (stored.artifact.artifact_digest !== run.package_artifact_digest
            || stored.content.evidence_package_id !== run.evidence_package_id
            || stored.content.semantic_digest !== run.package_semantic_digest
            || sha256Digest(stored.content) !== run.package_artifact_digest) {
          fail(409, "DIAGNOSTIC_WORKER_INPUT_INTEGRITY_VIOLATION",
            "Exact Evidence Package artifact failed launch-time integrity verification.");
        }
        const input = {
          schema_version: DIAGNOSTIC_WORKER_INPUT_SCHEMA,
          worker_run_id: run.worker_run_id,
          assignment: {
            assignment_id: run.assignment_id,
            assignment_digest: run.assignment_digest,
            assignment_policy_activation_id: run.assignment_policy_activation_id,
            instruction: structuredClone(run.policy_document.instruction),
            output_schema: structuredClone(run.policy_document.output_schema)
          },
          evidence_package_artifact: structuredClone(stored.content),
          authority: { diagnosis_proposal: "permitted", external_business_effects: "none" }
        };
        const inputDigest = sha256Digest(input);
        const runtimeBoundary = run.worker_run_document.runtime_boundary;
        if (Buffer.byteLength(canonicalize(input), "utf8") > runtimeBoundary.broker.max_input_units) {
          fail(409, "DIAGNOSTIC_BROKER_INPUT_BUDGET_INSUFFICIENT",
            "Exact assigned package exceeds the authorized Model Broker input budget.");
        }
        const launchId = randomUUID();
        const grantId = randomUUID();
        const expiresAt = new Date(Math.min(Date.parse(run.expires_at),
          Date.parse(acceptedAt) + 5 * 60_000)).toISOString();
        const grant = {
          schema_version: DIAGNOSTIC_BROKER_GRANT_SCHEMA,
          grant_id: grantId,
          launch_id: launchId,
          worker_run_id: run.worker_run_id,
          assignment: {
            assignment_id: run.assignment_id,
            assignment_digest: run.assignment_digest,
            evidence_package_id: run.evidence_package_id,
            evidence_package_semantic_digest: run.package_semantic_digest,
            evidence_package_artifact_digest: run.package_artifact_digest
          },
          input: { input_digest: inputDigest,
            output_schema_digest: sha256Digest(run.policy_document.output_schema) },
          model: structuredClone(runtimeBoundary.model),
          broker: structuredClone(runtimeBoundary.broker),
          resources: structuredClone(runtimeBoundary.resources),
          data_policy: structuredClone(runtimeBoundary.data_policy),
          egress_policy: structuredClone(runtimeBoundary.egress_policy),
          temporal: { not_before: acceptedAt, expires_at: expiresAt },
          authority: { model_requests: 1, diagnosis_proposal: "permitted",
            external_business_effects: "none", repair: "none" }
        };
        const signedGrant = signDiagnosticRuntimeDocument(grant, brokerGrantSigning);
        const consistencyConfiguration = consistencyEvaluator
          ? await consistencyEvaluator.recordLaunchConfiguration(client, {
            run, inputDocument: input, acceptedAt
          }) : null;
        await client.query(
          `INSERT INTO diagnostic_worker_run_launches
            (launch_id,installation_id,environment_id,worker_run_id,worker_run_digest,
             assignment_id,assignment_digest,evidence_package_id,input_document,input_digest,
             broker_grant_id,broker_grant_document,broker_grant_digest,signed_broker_grant,
             signed_broker_grant_digest,runtime_boundary,launch_transition_id,authorized_by_type,
             authorized_by_id,issued_at,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [launchId, installationId, environmentId, run.worker_run_id, run.worker_run_digest,
            run.assignment_id, run.assignment_digest, run.evidence_package_id, input, inputDigest,
            grantId, grant, sha256Digest(grant), signedGrant, sha256Digest(signedGrant),
            runtimeBoundary, transitionId, actor.type, actor.id, acceptedAt, expiresAt]
        );
        await transitionState(client, run, state, "launching", transitionId, acceptedAt);
        return {
          aggregateType: "diagnostic_worker_run", aggregateId: run.worker_run_id,
          transitionType: "diagnostic.worker_run.launch_authorized",
          fromRevision: state.state_revision, toRevision: BigInt(state.state_revision) + 1n,
          transitionPayload: { launch_id: launchId, worker_run_id: run.worker_run_id,
            input_digest: inputDigest, broker_grant_digest: sha256Digest(grant),
            signed_broker_grant_digest: sha256Digest(signedGrant),
            external_business_effect_authority: "none" },
          result: { diagnostic_worker_launch: {
            launch_id: launchId, worker_run_id: run.worker_run_id,
            worker_run_digest: run.worker_run_digest, input_digest: inputDigest,
            worker_input: input, signed_broker_grant: signedGrant,
            runtime_boundary: runtimeBoundary, issued_at: acceptedAt, expires_at: expiresAt,
            consistency_configuration: consistencyConfiguration,
            state: "launching", provider_credential_disclosed: false,
            external_business_effect_authority: "none"
          } }
        };
      }
    });
  }

  async function authorizeLaunch(value, actor) {
    return materialAuthority ? materialAuthority.runMaterialMutationExclusive(() =>
      authorizeLaunchFenced(value, actor)) : authorizeLaunchFenced(value, actor);
  }

  async function recordStarted(value, actor) {
    const parsed = parseCommand(value, "diagnostic.worker_run.started",
      ["worker_run_id", "signed_start_attestation"]);
    const workerRunId = uuid(parsed.input.worker_run_id, "command.input.worker_run_id");
    const verified = verifyRunnerAttestation(parsed.input.signed_start_attestation, runnerSigning);
    const command = { ...parsed, actor };
    return executeCommand({ installationId, command,
      requestDigest: sha256Digest({ installation_id: installationId,
        environment_id: environmentId, command }),
      apply: async (client, { acceptedAt, transitionId }) => {
        const { run, state } = await loadRun(client, workerRunId, true);
        const launch = (await client.query(
          "SELECT * FROM diagnostic_worker_run_launches WHERE worker_run_id=$1", [workerRunId]
        )).rows[0];
        if (!launch || state.state !== "launching"
            || verified.document.launch_id !== launch.launch_id
            || verified.document.worker_run_id !== workerRunId
            || Date.parse(acceptedAt) >= Date.parse(launch.expires_at)) {
          fail(409, "DIAGNOSTIC_WORKER_RUN_START_BINDING_MISMATCH",
            "Started attestation does not bind one current launch.");
        }
        validateRuntimeBoundary(verified.document, launch.runtime_boundary,
          launch.input_digest, "started");
        await client.query(
          `INSERT INTO diagnostic_worker_run_starts
            (launch_id,installation_id,environment_id,worker_run_id,runner_attestation_id,
             attestation_document,signed_attestation,signed_attestation_digest,start_transition_id,
             recorded_by_type,recorded_by_id,recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [launch.launch_id, installationId, environmentId, workerRunId,
            verified.document.attestation_id, verified.document,
            parsed.input.signed_start_attestation, sha256Digest(parsed.input.signed_start_attestation),
            transitionId, actor.type, actor.id, acceptedAt]
        );
        await transitionState(client, run, state, "running", transitionId, acceptedAt);
        return {
          aggregateType: "diagnostic_worker_run", aggregateId: workerRunId,
          transitionType: "diagnostic.worker_run.started",
          fromRevision: state.state_revision, toRevision: BigInt(state.state_revision) + 1n,
          transitionPayload: { launch_id: launch.launch_id, worker_run_id: workerRunId,
            container_id: verified.document.container.container_id,
            signed_attestation_digest: sha256Digest(parsed.input.signed_start_attestation),
            external_business_effect_authority: "none" },
          result: { diagnostic_worker_start: { launch_id: launch.launch_id, worker_run_id: workerRunId,
            state: "running", runtime_provenance: verified.document,
            external_business_effect_authority: "none" } }
        };
      }
    });
  }

  async function complete(value, actor) {
    const parsed = parseCommand(value, "diagnostic.worker_run.complete",
      ["worker_run_id", "signed_final_attestation", "output_bytes_base64"]);
    const workerRunId = uuid(parsed.input.worker_run_id, "command.input.worker_run_id");
    if (typeof parsed.input.output_bytes_base64 !== "string"
        || parsed.input.output_bytes_base64.length > 24 * 1024 * 1024) {
      fail(413, "DIAGNOSTIC_WORKER_OUTPUT_TOO_LARGE", "Worker output encoding exceeds its ceiling.");
    }
    const bytes = Buffer.from(parsed.input.output_bytes_base64, "base64");
    if (bytes.toString("base64") !== parsed.input.output_bytes_base64) {
      fail(400, "DIAGNOSTIC_WORKER_OUTPUT_INVALID", "Worker output must use canonical base64.");
    }
    const verifiedFinal = verifyRunnerAttestation(parsed.input.signed_final_attestation, runnerSigning);
    const command = { ...parsed, actor };
    return executeCommand({ installationId, command,
      requestDigest: sha256Digest({ installation_id: installationId,
        environment_id: environmentId, command }),
      apply: async (client, { acceptedAt, transitionId }) => {
        if (materialAuthority) await materialAuthority.lockMaterialMutation(client);
        const { run, state } = await loadRun(client, workerRunId, true);
        const launch = (await client.query(
          "SELECT * FROM diagnostic_worker_run_launches WHERE worker_run_id=$1", [workerRunId]
        )).rows[0];
        const start = (await client.query(
          "SELECT * FROM diagnostic_worker_run_starts WHERE worker_run_id=$1", [workerRunId]
        )).rows[0];
        if (!launch || !start || state.state !== "running"
            || verifiedFinal.document.launch_id !== launch.launch_id
            || verifiedFinal.document.worker_run_id !== workerRunId) {
          fail(409, "DIAGNOSTIC_WORKER_RUN_COMPLETION_BINDING_MISMATCH",
            "Final attestation does not bind one running launch.");
        }
        if (materialAuthority) await materialAuthority.assertPackageMaterialAdmissible(client,
          run.evidence_package_id, "diagnostic_worker_completion");
        validateRuntimeBoundary(verifiedFinal.document, launch.runtime_boundary,
          launch.input_digest, "exited", { document: start.attestation_document,
            signed: start.signed_attestation });
        const scan = verifiedFinal.document.output_scan;
        const outputDigest = rawDigest(bytes);
        validateDiagnosticOutputFileBoundary(scan, bytes,
          launch.runtime_boundary.resources.max_output_bytes);
        let envelope;
        try { envelope = JSON.parse(bytes.toString("utf8")); } catch {
          fail(400, "DIAGNOSTIC_WORKER_OUTPUT_INVALID", "diagnosis.json must be valid JSON.");
        }
        exact(envelope, "diagnosis.json", [
          "schema_version", "diagnosis", "signed_broker_receipt"
        ]);
        if (envelope.schema_version !== DIAGNOSTIC_WORKER_OUTPUT_ENVELOPE_SCHEMA) {
          fail(400, "DIAGNOSTIC_WORKER_OUTPUT_INVALID", "Worker output envelope is unsupported.");
        }
        const diagnosis = validateDiagnosticWorkerOutput(envelope.diagnosis,
          citationIndexFromWorkerInput(launch.input_document));
        const brokerVerified = verifyBrokerReceipt(envelope.signed_broker_receipt,
          brokerReceiptSigning);
        const receipt = brokerVerified.document;
        if (receipt.schema_version !== DIAGNOSTIC_BROKER_RECEIPT_SCHEMA
            || receipt.grant_id !== launch.broker_grant_id
            || receipt.grant_digest !== launch.signed_broker_grant.document_digest
            || receipt.launch_id !== launch.launch_id || receipt.worker_run_id !== workerRunId
            || receipt.assignment_id !== run.assignment_id
            || receipt.input_digest !== launch.input_digest
            || receipt.diagnosis_digest !== sha256Digest(diagnosis)
            || !same(receipt.model, launch.runtime_boundary.model)
            || receipt.broker?.audience !== launch.runtime_boundary.broker.audience
            || receipt.usage?.requests !== 1
            || receipt.usage.input_units > launch.runtime_boundary.broker.max_input_units
            || receipt.usage.output_units > launch.runtime_boundary.broker.max_output_units
            || receipt.provider_assurance?.credential_location !== "model_broker_only"
            || receipt.authority?.external_business_effects !== "none") {
          fail(409, "DIAGNOSTIC_MODEL_BROKER_RECEIPT_INVALID",
            "Broker receipt does not prove the exact one-request diagnosis boundary.");
        }
        const completionId = randomUUID();
        const diagnosisId = randomUUID();
        await client.query(
          `INSERT INTO diagnostic_worker_run_completions
            (completion_id,launch_id,installation_id,environment_id,worker_run_id,
             final_attestation_document,signed_final_attestation,signed_final_attestation_digest,
             output_file_digest,output_size_bytes,completion_transition_id,exit_code,
             completed_by_type,completed_by_id,completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [completionId, launch.launch_id, installationId, environmentId, workerRunId,
            verifiedFinal.document, parsed.input.signed_final_attestation,
            sha256Digest(parsed.input.signed_final_attestation), outputDigest, bytes.length,
            transitionId, verifiedFinal.document.container.exit_code,
            actor.type, actor.id, acceptedAt]
        );
        await client.query(
          `INSERT INTO diagnostic_worker_run_diagnoses
            (diagnosis_id,installation_id,environment_id,worker_run_id,launch_id,assignment_id,
             evidence_package_id,diagnosis_document,diagnosis_digest,output_file_digest,
             broker_receipt_id,broker_receipt_document,signed_broker_receipt,
             signed_broker_receipt_digest,submitted_by_type,submitted_by_id,submitted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [diagnosisId, installationId, environmentId, workerRunId, launch.launch_id,
            run.assignment_id, run.evidence_package_id, diagnosis, sha256Digest(diagnosis),
            outputDigest, receipt.receipt_id, receipt, envelope.signed_broker_receipt,
            sha256Digest(envelope.signed_broker_receipt), actor.type, actor.id, acceptedAt]
        );
        const consistencyScore = consistencyEvaluator
          ? await consistencyEvaluator.recordDiagnosisScore(client, {
            run,
            launch,
            completion: {
              completion_id: completionId,
              diagnosis_id: diagnosisId,
              diagnosis_digest: sha256Digest(diagnosis),
              output_file_digest: outputDigest,
              completed_at: acceptedAt
            },
            diagnosis,
            brokerReceipt: receipt,
            finalAttestation: verifiedFinal.document
          }) : null;
        await transitionState(client, run, state, "completed", transitionId, acceptedAt);
        return {
          aggregateType: "diagnostic_worker_run", aggregateId: workerRunId,
          transitionType: "diagnostic.worker_run.completed",
          fromRevision: state.state_revision, toRevision: BigInt(state.state_revision) + 1n,
          transitionPayload: { launch_id: launch.launch_id, worker_run_id: workerRunId,
            diagnosis_id: diagnosisId, diagnosis_digest: sha256Digest(diagnosis),
            output_file_digest: outputDigest, broker_receipt_id: receipt.receipt_id,
            external_business_effect_authority: "none" },
          result: { diagnostic_worker_completion: {
            completion_id: completionId, launch_id: launch.launch_id,
            worker_run_id: workerRunId, state: "completed",
            diagnosis: { diagnosis_id: diagnosisId, diagnosis_digest: sha256Digest(diagnosis),
              document: diagnosis, claim_citations_validated: true,
              implementation_location_established: false },
            broker_receipt: { receipt_id: receipt.receipt_id,
              signed_receipt_digest: sha256Digest(envelope.signed_broker_receipt),
              requests: 1, provider_credential_location: "model_broker_only" },
            runtime_provenance: verifiedFinal.document,
            consistency_score: consistencyScore,
            output_file_digest: outputDigest, output_size_bytes: bytes.length,
            external_business_effects: 0, repair_authority: "none"
          } }
        };
      }
    });
  }

  async function getExecutionView(workerRunId) {
    uuid(workerRunId, "worker_run_id");
    const launch = (await pool.query(
      "SELECT * FROM diagnostic_worker_run_launches WHERE worker_run_id=$1", [workerRunId]
    )).rows[0];
    if (!launch) return null;
    const [start, completion, diagnosis, state, consistencyConfiguration, consistencyScore] =
      await Promise.all([
      pool.query("SELECT * FROM diagnostic_worker_run_starts WHERE worker_run_id=$1", [workerRunId])
        .then((result) => result.rows[0] ?? null),
      pool.query("SELECT * FROM diagnostic_worker_run_completions WHERE worker_run_id=$1", [workerRunId])
        .then((result) => result.rows[0] ?? null),
      pool.query("SELECT * FROM diagnostic_worker_run_diagnoses WHERE worker_run_id=$1", [workerRunId])
        .then((result) => result.rows[0] ?? null),
      pool.query("SELECT * FROM diagnostic_worker_run_states WHERE worker_run_id=$1", [workerRunId])
        .then((result) => result.rows[0]),
      pool.query("SELECT * FROM diagnostic_worker_run_configurations WHERE worker_run_id=$1",
        [workerRunId]).then((result) => result.rows[0] ?? null),
      pool.query("SELECT * FROM diagnostic_consistency_scores WHERE worker_run_id=$1",
        [workerRunId]).then((result) => result.rows[0] ?? null)
    ]);
    if (sha256Digest(launch.input_document) !== launch.input_digest
        || sha256Digest(launch.broker_grant_document) !== launch.broker_grant_digest
        || sha256Digest(launch.signed_broker_grant) !== launch.signed_broker_grant_digest
        || start && sha256Digest(start.signed_attestation) !== start.signed_attestation_digest
        || completion && sha256Digest(completion.signed_final_attestation)
          !== completion.signed_final_attestation_digest
        || diagnosis && (sha256Digest(diagnosis.diagnosis_document) !== diagnosis.diagnosis_digest
          || sha256Digest(diagnosis.signed_broker_receipt)
            !== diagnosis.signed_broker_receipt_digest)) {
      fail(500, "DIAGNOSTIC_WORKER_EXECUTION_INTEGRITY_VIOLATION",
        "Stored Worker execution material failed exact digest verification.");
    }
    return {
      launch_id: launch.launch_id,
      state: state.state,
      broker_token_created: true,
      provider_request_created: Boolean(diagnosis),
      model_request_created: Boolean(diagnosis),
      diagnosis_created: Boolean(diagnosis),
      launch: { input_digest: launch.input_digest,
        signed_broker_grant_digest: launch.signed_broker_grant_digest,
        issued_at: iso(launch.issued_at), expires_at: iso(launch.expires_at) },
      start: start ? { attestation_digest: start.signed_attestation_digest,
        runtime_provenance: start.attestation_document } : null,
      completion: completion ? { completion_id: completion.completion_id,
        final_attestation_digest: completion.signed_final_attestation_digest,
        output_file_digest: completion.output_file_digest,
        output_size_bytes: Number(completion.output_size_bytes),
        exit_code: completion.exit_code, completed_at: iso(completion.completed_at) } : null,
      diagnosis: diagnosis ? { diagnosis_id: diagnosis.diagnosis_id,
        diagnosis_digest: diagnosis.diagnosis_digest,
        document: diagnosis.diagnosis_document,
        broker_receipt_id: diagnosis.broker_receipt_id,
        signed_broker_receipt_digest: diagnosis.signed_broker_receipt_digest } : null,
      consistency: consistencyConfiguration ? {
        consistency_test_id: consistencyConfiguration.consistency_test_id,
        configuration_digest: consistencyConfiguration.configuration_digest,
        limitations: consistencyConfiguration.limitation_document.limitations,
        score: consistencyScore ? {
          score_id: consistencyScore.score_id,
          passed: consistencyScore.passed,
          score_digest: consistencyScore.score_digest
        } : null
      } : null,
      external_business_effect_authority: "none"
    };
  }

  return { authorizeLaunch, recordStarted, complete, getExecutionView };
}
