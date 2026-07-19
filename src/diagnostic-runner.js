// @ts-check

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  DIAGNOSTIC_RUNNER_ATTESTATION_SCHEMA,
  signDiagnosticRuntimeDocument
} from "./diagnostic-worker-execution-contracts.js";

/**
 * Shapes below describe runner wiring; Docker inspect payloads and launch
 * documents stay loosely typed as untrusted external material. Runtime
 * digest/image checks remain authoritative (ADR 0107).
 *
 * @typedef {{ keyId: string, secret: string }} DiagnosticSigningMaterial
 * @typedef {{
 *   inputDigest: string,
 *   maxOutputBytes: number,
 *   temporaryBytes: number,
 *   homeBytes: number
 * }} ContainerFactExpectations
 * @typedef {{
 *   launch: any,
 *   workerImageReference: string,
 *   brokerImageReference: string,
 *   brokerGrantSigning: DiagnosticSigningMaterial,
 *   brokerReceiptSigning: DiagnosticSigningMaterial,
 *   runnerSigning: DiagnosticSigningMaterial,
 *   providerCredential: string,
 *   onStarted?: (attestation: any) => void | Promise<void>
 * }} RunDiagnosticWorkerOptions
 */

/**
 * @param {string[]} args
 * @param {{ allowFailure?: boolean, timeout?: number }} [options]
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function docker(args, { allowFailure = false, timeout = 60_000 } = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8", windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw result.error ?? new Error(`docker ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

/**
 * @param {Buffer | string} bytes
 * @returns {string}
 */
function rawDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * @param {"container" | "network" | "image"} kind
 * @param {string} reference
 * @returns {any}
 */
function inspect(kind, reference) {
  const result = docker([kind, "inspect", reference]);
  return JSON.parse(result.stdout)[0];
}

/**
 * @param {string} reference
 * @returns {string}
 */
function exactImageDigest(reference) {
  return docker(["image", "inspect", "--format", "{{.Id}}", reference]).stdout.trim();
}

/**
 * Bind broker-owned state to the trusted runner so cleanup does not depend on a host's
 * particular non-root UID. Root and non-POSIX runners retain a fixed non-root identity.
 * @param {number | undefined} [uid]
 * @param {number | undefined} [gid]
 * @returns {string}
 */
export function diagnosticBrokerContainerUser(
  uid = typeof process.getuid === "function" ? process.getuid() : undefined,
  gid = typeof process.getgid === "function" ? process.getgid() : undefined
) {
  if (typeof uid === "number" && Number.isSafeInteger(uid) && uid > 0
      && typeof gid === "number" && Number.isSafeInteger(gid) && gid > 0) {
    return `${uid}:${gid}`;
  }
  return "1000:1000";
}

/**
 * @returns {Record<string, string>}
 */
function runtimeEngineFacts() {
  const server = JSON.parse(docker(["version", "--format", "{{json .Server}}"])
    .stdout.trim());
  return {
    kind: "docker_engine",
    version: server.Version,
    api_version: server.ApiVersion,
    operating_system: server.Os,
    architecture: server.Arch,
    kernel_version: server.KernelVersion
  };
}

/**
 * @param {any} network
 * @returns {Record<string, unknown>}
 */
function networkFacts(network) {
  return {
    network_id: network.Id,
    name: network.Name,
    driver: network.Driver,
    internal: network.Internal,
    attachable: network.Attachable,
    ingress: network.Ingress,
    attached_container_ids: Object.keys(network.Containers ?? {}).sort(),
    attached_container_names: Object.values(network.Containers ?? {})
      .map((entry) => /** @type {{ Name: string }} */ (entry).Name).sort(),
    general_egress: false,
    allowed_destination: "diagnostic_model_broker_only",
    forbidden_destinations: [
      "general_dns", "internet", "lan", "cloud_metadata", "kernel", "data_plane", "database"
    ]
  };
}

/**
 * @param {any} container
 * @param {ContainerFactExpectations} expected
 * @returns {Record<string, unknown>}
 */
function containerFacts(container, expected) {
  const host = container.HostConfig;
  const config = container.Config;
  const mounts = /** @type {Array<{ Source: string, Destination: string, Type?: string, RW?: boolean }>} */ (
    container.Mounts ?? []
  );
  return {
    container_id: container.Id,
    name: container.Name.replace(/^\//, ""),
    image_digest: container.Image,
    configured_image: config.Image,
    created_at: container.Created,
    started_at: container.State.StartedAt,
    status: container.State.Status,
    security: {
      user: config.User,
      privileged: host.Privileged,
      read_only_root: host.ReadonlyRootfs,
      no_new_privileges: host.SecurityOpt.includes("no-new-privileges:true"),
      cap_drop: [...(host.CapDrop ?? [])].sort(),
      pid_mode: host.PidMode || "private",
      ipc_mode: host.IpcMode || "private",
      uts_mode: host.UTSMode || "private",
      devices: (host.Devices ?? []).map((/** @type {{ PathOnHost: string }} */ entry) => entry.PathOnHost),
      docker_socket_mounted: mounts.some((entry) => entry.Source === "/var/run/docker.sock")
    },
    mounts: {
      input: {
        type: mounts.find((entry) => entry.Destination === "/input")?.Type,
        read_only: mounts.find((entry) => entry.Destination === "/input")?.RW === false,
        destination: "/input",
        content_digest: expected.inputDigest
      },
      output: { type: host.Tmpfs?.["/output"] ? "tmpfs" : "absent", destination: "/output",
        bounded_bytes: expected.maxOutputBytes, options: host.Tmpfs?.["/output"] ?? null },
      temporary: { type: host.Tmpfs?.["/tmp"] ? "tmpfs" : "absent", destination: "/tmp",
        bounded_bytes: expected.temporaryBytes, options: host.Tmpfs?.["/tmp"] ?? null },
      home: { type: host.Tmpfs?.["/home/worker"] ? "tmpfs" : "absent",
        destination: "/home/worker", bounded_bytes: expected.homeBytes,
        options: host.Tmpfs?.["/home/worker"] ?? null },
      host_workspace_mounted: mounts.some((entry) =>
        !["/input"].includes(entry.Destination))
    },
    resources: {
      memory_bytes: host.Memory,
      nano_cpus: host.NanoCpus,
      pids_limit: host.PidsLimit
    },
    environment_keys: (config.Env ?? []).map((/** @type {string} */ entry) => entry.split("=", 1)[0]).sort()
  };
}

/**
 * @param {string} containerName
 * @param {number} maximumBytes
 */
function collectContainerOutput(containerName, maximumBytes) {
  const program = `const f=require('node:fs'),p=require('node:path');
    const entries=[];
    function visit(dir,relative=''){for(const name of f.readdirSync(dir).sort()){
      const absolute=p.join(dir,name),child=relative?p.posix.join(relative,name):name,s=f.lstatSync(absolute);
      const type=s.isFile()?'regular_file':s.isDirectory()?'directory':s.isSymbolicLink()?'symbolic_link':
        s.isBlockDevice()?'block_device':s.isCharacterDevice()?'character_device':s.isSocket()?'socket':'other';
      entries.push({path:child,type,size_bytes:s.size});if(s.isDirectory())visit(absolute,child);}}
    visit('/output');
    const file=entries.find(e=>e.path==='diagnosis.json'&&e.type==='regular_file');
    const bytes=file&&entries.length===1&&file.size_bytes<=${maximumBytes}
      ?f.readFileSync('/output/diagnosis.json'):null;
    process.stdout.write(JSON.stringify({entries,output_bytes_base64:bytes?bytes.toString('base64'):null}));`;
  const result = docker(["exec", containerName, "node", "-e", program], { timeout: 10_000 });
  const collected = JSON.parse(result.stdout);
  const bytes = collected.output_bytes_base64
    ? Buffer.from(collected.output_bytes_base64, "base64") : null;
  return {
    entries: collected.entries,
    sole_expected_regular_file: collected.entries.length === 1
      && collected.entries[0].path === "diagnosis.json"
      && collected.entries[0].type === "regular_file",
    total_size_bytes: collected.entries.reduce(
      (/** @type {number} */ sum, /** @type {{ type: string, size_bytes: number }} */ entry) => sum +
      (entry.type === "regular_file" ? entry.size_bytes : 0), 0),
    maximum_size_bytes: maximumBytes,
    diagnosis_file_digest: bytes ? rawDigest(bytes) : null,
    output_bytes_base64: collected.output_bytes_base64
  };
}

/**
 * @param {Record<string, unknown>} document
 * @param {DiagnosticSigningMaterial} signing
 */
function signedAttestation(document, signing) {
  return signDiagnosticRuntimeDocument({
    schema_version: DIAGNOSTIC_RUNNER_ATTESTATION_SCHEMA,
    ...document
  }, signing);
}

/**
 * @param {{
 *   launch: any,
 *   inputDirectory: string,
 *   networkName: string,
 *   containerName: string
 * }} options
 * @returns {string[]}
 */
export function diagnosticWorkerCreateArguments({ launch, inputDirectory, networkName,
  containerName }) {
  const runtime = launch.runtime_boundary;
  const resources = runtime.resources;
  const grant = Buffer.from(canonicalize(launch.signed_broker_grant), "utf8").toString("base64url");
  return ["create", "--name", containerName,
    "--label", `alphonse.worker_run_id=${launch.worker_run_id}`,
    "--label", `alphonse.launch_id=${launch.launch_id}`,
    "--user", "10001:10001", "--read-only",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--network", networkName,
    "--memory", String(resources.max_memory_bytes),
    "--cpus", String(resources.max_cpus),
    "--pids-limit", String(resources.max_pids),
    "--tmpfs", `/output:rw,noexec,nosuid,nodev,size=${resources.max_output_bytes},mode=0700,uid=10001,gid=10001`,
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16777216,mode=0700,uid=10001,gid=10001",
    "--tmpfs", "/home/worker:rw,noexec,nosuid,nodev,size=1048576,mode=0700,uid=10001,gid=10001",
    "--mount", `type=bind,src=${inputDirectory},dst=/input,readonly,bind-propagation=rprivate`,
    "--env", "HOME=/home/worker", "--env", "CODEX_HOME=/home/worker",
    "--env", "DIAGNOSTIC_MODEL_BROKER_URL=http://model-broker:3900",
    "--env", `DIAGNOSTIC_SIGNED_BROKER_GRANT_BASE64=${grant}`,
    runtime.runtime.image.digest];
}

/**
 * Runs one authorized diagnostic worker with an isolated broker and records
 * start/final runner attestations. Callers pass `onStarted` to observe the
 * signed start attestation before the worker finishes.
 *
 * @param {RunDiagnosticWorkerOptions} options
 */
export async function runDiagnosticWorker({ launch, workerImageReference, brokerImageReference,
  brokerGrantSigning, brokerReceiptSigning, runnerSigning, providerCredential,
  onStarted = async (_attestation) => {} }) {
  if (exactImageDigest(workerImageReference) !== launch.runtime_boundary.runtime.image.digest) {
    throw new Error("Local diagnostic Worker image does not match the authorized image digest.");
  }
  const brokerImageDigest = exactImageDigest(brokerImageReference);
  const runtimeEngine = runtimeEngineFacts();
  const suffix = launch.worker_run_id.slice(0, 8);
  const networkName = `alphonse-diagnostic-${suffix}-${process.pid}`;
  const workerName = `alphonse-diagnostic-worker-${suffix}-${process.pid}`;
  const brokerName = `alphonse-diagnostic-broker-${suffix}-${process.pid}`;
  const directory = await mkdtemp(path.join(os.tmpdir(), `alphonse-diagnostic-${suffix}-`));
  const inputDirectory = path.join(directory, "input");
  const brokerStateDirectory = path.join(directory, "broker-state");
  await mkdir(inputDirectory);
  await mkdir(brokerStateDirectory);
  await chmod(inputDirectory, 0o755);
  await chmod(brokerStateDirectory, 0o777);
  await writeFile(path.join(inputDirectory, "input.json"),
    `${canonicalize(launch.worker_input)}\n`, { mode: 0o444 });

  let startAttestation = null;
  try {
    docker(["network", "create", "--internal", "--driver", "bridge",
      "--label", `alphonse.worker_run_id=${launch.worker_run_id}`, networkName]);
    docker(["run", "--detach", "--name", brokerName,
      "--label", `alphonse.worker_run_id=${launch.worker_run_id}`,
      "--network", networkName, "--network-alias", "model-broker",
      "--user", diagnosticBrokerContainerUser(), "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true", "--pids-limit", "64",
      "--memory", "134217728", "--cpus", "0.5",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16777216",
      "--mount", `type=bind,src=${brokerStateDirectory},dst=/var/lib/alphonse-model-broker`,
      "--env", "DIAGNOSTIC_MODEL_BROKER_PORT=3900",
      "--env", `DIAGNOSTIC_MODEL_BROKER_AUDIENCE=${launch.runtime_boundary.broker.audience}`,
      "--env", "DIAGNOSTIC_MODEL_BROKER_STATE_ROOT=/var/lib/alphonse-model-broker",
      "--env", `DIAGNOSTIC_MODEL_BROKER_GRANT_KEY_ID=${brokerGrantSigning.keyId}`,
      "--env", `DIAGNOSTIC_MODEL_BROKER_GRANT_SIGNING_SECRET=${brokerGrantSigning.secret}`,
      "--env", `DIAGNOSTIC_MODEL_BROKER_RECEIPT_KEY_ID=${brokerReceiptSigning.keyId}`,
      "--env", `DIAGNOSTIC_MODEL_BROKER_RECEIPT_SECRET=${brokerReceiptSigning.secret}`,
      "--env", `DIAGNOSTIC_REFERENCE_PROVIDER_CREDENTIAL=${providerCredential}`,
      brokerImageDigest, "node", "src/diagnostic-model-broker-server.js"]);
    let brokerHealthy = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const health = docker(["exec", brokerName, "node", "-e",
        "fetch('http://127.0.0.1:3900/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
      { allowFailure: true, timeout: 5_000 });
      if (health.status === 0) { brokerHealthy = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!brokerHealthy) throw new Error("Diagnostic Model Broker did not become healthy.");

    const createArgs = diagnosticWorkerCreateArguments({ launch, inputDirectory,
      networkName, containerName: workerName });
    docker(createArgs);
    docker(["start", workerName]);
    const startedContainer = inspect("container", workerName);
    const startedNetwork = inspect("network", networkName);
    const expected = { inputDigest: launch.input_digest,
      maxOutputBytes: launch.runtime_boundary.resources.max_output_bytes,
      temporaryBytes: 16 * 1024 * 1024, homeBytes: 1024 * 1024 };
    startAttestation = signedAttestation({
      attestation_id: randomUUID(), phase: "started", launch_id: launch.launch_id,
      worker_run_id: launch.worker_run_id,
      runner: structuredClone(launch.runtime_boundary.runtime.runner),
      runtime_engine: runtimeEngine,
      broker_image_digest: brokerImageDigest,
      container: containerFacts(startedContainer, expected),
      network: networkFacts(startedNetwork),
      input_digest: launch.input_digest,
      observed_at: new Date().toISOString(),
      authority: { docker_host: "trusted_runner_only", external_business_effects: "none" }
    }, runnerSigning);
    await onStarted(startAttestation);

    let outputReady = false;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const currentLogs = docker(["logs", workerName], { allowFailure: true });
      if ((currentLogs.stdout ?? "").includes('"event":"worker_output_written"')) {
        outputReady = true;
        break;
      }
      const current = inspect("container", workerName);
      if (!current.State.Running) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!outputReady) throw new Error("Diagnostic Worker did not produce its bounded output.");
    const output = collectContainerOutput(workerName,
      launch.runtime_boundary.resources.max_output_bytes);
    docker(["exec", workerName, "node", "-e",
      "require('node:fs').writeFileSync('/tmp/runner-output-collected','ack',{mode:0o600})"]);
    const wait = docker(["wait", workerName], {
      timeout: launch.runtime_boundary.resources.max_runtime_seconds * 1000 + 10_000
    });
    const exitCode = Number(wait.stdout.trim());
    const replayPayload = JSON.stringify({
      signed_broker_grant: launch.signed_broker_grant,
      input: launch.worker_input
    });
    await writeFile(path.join(brokerStateDirectory, "replay-probe.json"), replayPayload,
      { mode: 0o644 });
    const replayProbe = docker(["exec", brokerName, "node", "-e",
      `const v=JSON.parse(require('node:fs').readFileSync('/var/lib/alphonse-model-broker/replay-probe.json','utf8'));
       fetch('http://127.0.0.1:3900/v0/diagnose',{method:'POST',headers:{'content-type':'application/json',authorization:'BrokerGrant '+v.signed_broker_grant.document_digest},body:JSON.stringify(v)})
       .then(async r=>{const b=await r.json();process.stdout.write(JSON.stringify({status:r.status,code:b.error?.code}));process.exit(r.status===409&&b.error?.code==='MODEL_BROKER_GRANT_ALREADY_CONSUMED'?0:1)})
       .catch(()=>process.exit(2))`], { allowFailure: true, timeout: 10_000 });
    const brokerGrantReplayDenied = replayProbe.status === 0;
    const finalContainer = inspect("container", workerName);
    const finalNetwork = inspect("network", networkName);
    const logs = docker(["logs", workerName], { allowFailure: true });
    const brokerLogs = docker(["logs", brokerName], { allowFailure: true });
    const finalAttestation = signedAttestation({
      attestation_id: randomUUID(), phase: "exited", launch_id: launch.launch_id,
      worker_run_id: launch.worker_run_id,
      runner: structuredClone(launch.runtime_boundary.runtime.runner),
      runtime_engine: runtimeEngine,
      start_attestation_digest: sha256Digest(startAttestation),
      broker_image_digest: brokerImageDigest,
      container: {
        ...containerFacts(finalContainer, expected),
        exit_code: exitCode,
        oom_killed: finalContainer.State.OOMKilled,
        finished_at: finalContainer.State.FinishedAt
      },
      network: networkFacts(finalNetwork),
      output_scan: {
        entries: output.entries,
        sole_expected_regular_file: output.sole_expected_regular_file,
        total_size_bytes: output.total_size_bytes,
        maximum_size_bytes: output.maximum_size_bytes,
        diagnosis_file_digest: output.diagnosis_file_digest
      },
      logs: {
        worker_stdout_digest: sha256Digest(Buffer.from(logs.stdout ?? "", "utf8")),
        worker_stdout_size_bytes: Buffer.byteLength(logs.stdout ?? "", "utf8"),
        worker_stderr_digest: sha256Digest(Buffer.from(logs.stderr ?? "", "utf8")),
        worker_stderr_size_bytes: Buffer.byteLength(logs.stderr ?? "", "utf8"),
        broker_stdout_digest: sha256Digest(Buffer.from(brokerLogs.stdout ?? "", "utf8")),
        broker_stdout_size_bytes: Buffer.byteLength(brokerLogs.stdout ?? "", "utf8"),
        broker_stderr_digest: sha256Digest(Buffer.from(brokerLogs.stderr ?? "", "utf8")),
        broker_stderr_size_bytes: Buffer.byteLength(brokerLogs.stderr ?? "", "utf8")
      },
      adversarial_checks: {
        broker_grant_replay: brokerGrantReplayDenied ? "denied_already_consumed" : "unexpected"
      },
      observed_at: new Date().toISOString(),
      authority: { docker_host: "trusted_runner_only", external_business_effects: "none" }
    }, runnerSigning);
    return {
      signed_start_attestation: startAttestation,
      signed_final_attestation: finalAttestation,
      output_bytes_base64: output.output_bytes_base64,
      broker_grant_replay_denied: brokerGrantReplayDenied,
      broker_grant_replay_probe: { status: replayProbe.status,
        stdout: replayProbe.stdout, stderr: replayProbe.stderr },
      worker_stdout: logs.stdout,
      worker_stderr: logs.stderr
    };
  } finally {
    docker(["rm", "--force", workerName], { allowFailure: true });
    docker(["rm", "--force", brokerName], { allowFailure: true });
    docker(["network", "rm", networkName], { allowFailure: true });
    await rm(directory, { recursive: true, force: true });
  }
}
