import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  advanceAcceptanceState,
  assertStimulusResult,
  assertVerifierResult,
  createAcceptanceState,
  emptyAuthorship,
  missingCapability
} from "./canonical-diagnostic-proof-seam.js";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Role input and output paths are required.");

const input = JSON.parse(await readFile(inputPath, "utf8"));
const role = process.env.CANONICAL_PROOF_ROLE;
if (!role || role !== input.role) throw new Error("Role environment does not match mounted input.");
if (process.env.CANONICAL_PROOF_CREDENTIAL_IDS !== input.manifest.credentials.join(",")) {
  throw new Error("Role credential environment does not match its sealed manifest.");
}

const processRecord = {
  role,
  pid: process.pid,
  process_instance_id: randomUUID(),
  credentials: input.manifest.credentials,
  mounts: input.manifest.mounts,
  network: input.manifest.network,
  docker_socket: input.manifest.docker_socket,
  secret_store: input.manifest.secret_store
};

let result;
if (role === "trusted_bootstrap") {
  result = {
    process: processRecord,
    status: "completed",
    bootstrap_receipt: {
      trusted_host: true,
      docker_daemon: "trusted",
      claim: "configured_exclusion_not_host_attestation"
    }
  };
} else if (role === "runtime_supervisor") {
  result = {
    process: processRecord,
    status: "completed",
    sequence: ["trusted_bootstrap", "test_orchestrator"],
    authority: "none"
  };
} else if (role === "test_orchestrator") {
  if (!input.payload.bootstrap_receipt?.trusted_host) throw new Error("Trusted bootstrap receipt required.");
  let state = createAcceptanceState();
  state = advanceAcceptanceState(state, { type: "bootstrap.completed" });
  state = advanceAcceptanceState(state, { type: "orchestrator.inactive_material_registered" });
  state = advanceAcceptanceState(state, { type: "orchestrator.readiness_confirmed" });
  if (!input.payload.grant_application_receipts) {
    result = {
      process: processRecord,
      status: "blocked",
      missing_capability: missingCapability(state),
      acceptance_state: state,
      manifest_sealed: false,
      credentials_relinquished: false
    };
  } else {
    state = advanceAcceptanceState(state, { type: "orchestrator.grant_applications_verified" });
    state = advanceAcceptanceState(state, { type: "orchestrator.manifest_sealed" });
    state = advanceAcceptanceState(state, { type: "orchestrator.exited" });
    result = {
      process: processRecord,
      status: "completed",
      acceptance_state: state,
      manifest_sealed: true,
      credentials_relinquished: true
    };
  }
} else if (role === "scenario_stimulus") {
  if (!input.payload.manifest_sealed || !input.payload.orchestrator_exited) {
    throw new Error("Sealed manifest and orchestrator exit are required before stimulus.");
  }
  const stimulus = {
    request_count: input.payload.requests.length,
    route: "/agency-lab/lead-ingress",
    transport_responses: input.payload.requests.map(() => ({ status: 202 })),
    authored: emptyAuthorship()
  };
  assertStimulusResult(stimulus);
  result = { process: processRecord, status: "completed", stimulus };
} else if (role === "acceptance_verifier") {
  const verification = {
    read_only: true,
    reads: ["diagnostic-status", "kernel-audit"],
    writes: [],
    model_requests: 0
  };
  assertVerifierResult(verification);
  result = { process: processRecord, status: "completed", verification };
} else {
  throw new Error(`Unsupported acceptance role process: ${role}`);
}

await writeFile(outputPath, JSON.stringify(result), "utf8");
