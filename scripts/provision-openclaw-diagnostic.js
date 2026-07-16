import { randomBytes, randomUUID } from "node:crypto";
import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suppliedClientDir = process.env.OPENCLAW_CLIENT_DIR ?? process.argv[2];
const suppliedWorkspaceDir = process.env.OPENCLAW_WORKSPACE_DIR;
if (!suppliedClientDir && !suppliedWorkspaceDir) {
  throw new Error("Set OPENCLAW_WORKSPACE_DIR or OPENCLAW_CLIENT_DIR.");
}
const clientDir = suppliedClientDir ? path.resolve(suppliedClientDir) : null;
const workspaceDir = path.resolve(suppliedWorkspaceDir ?? path.join(clientDir, "workspace"));
const openclawConfigPath = clientDir ? path.join(clientDir, "config", "openclaw.json") : null;
const runtimeKind = process.env.OPENCLAW_RUNTIME_KIND ?? "host";
if (!new Set(["host", "docker"]).has(runtimeKind)) {
  throw new Error("OPENCLAW_RUNTIME_KIND must be host or docker.");
}
const project = process.env.ALPHONSE_OPENCLAW_PROJECT ?? "alphonse-openclaw-lab";
const kernelPort = process.env.ALPHONSE_OPENCLAW_KERNEL_PORT ?? "43240";
const postgresPort = process.env.ALPHONSE_OPENCLAW_POSTGRES_PORT ?? "45540";
const n8nPort = process.env.ALPHONSE_OPENCLAW_N8N_PORT ?? "45690";
const baseUrl = `http://127.0.0.1:${kernelPort}`;
const runtimeBaseUrl = process.env.OPENCLAW_ALPHONSE_URL ??
  (runtimeKind === "docker" ? `http://host.docker.internal:${kernelPort}` : baseUrl);
const ownerToken = process.env.ALPHONSE_OWNER_TOKEN ?? randomBytes(32).toString("hex");
const ownerHeaders = { authorization: `Owner ${ownerToken}`, "content-type": "application/json" };
const runId = randomUUID();

function runSeed() {
  const result = spawnSync(process.execPath, ["scripts/acceptance-v0.2-ticket-04.js"], {
    cwd: root,
    env: {
      ...process.env,
      ALPHONSE_ACCEPTANCE_URL: baseUrl,
      ALPHONSE_ACCEPTANCE_PROJECT: project,
      ALPHONSE_ACCEPTANCE_KERNEL_PORT: kernelPort,
      ALPHONSE_ACCEPTANCE_POSTGRES_PORT: postgresPort,
      ALPHONSE_ACCEPTANCE_N8N_PORT: n8nPort,
      ALPHONSE_OWNER_TOKEN: ownerToken,
      ALPHONSE_TICKET04_KEEP_STACK: "1"
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 12 * 60_000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Diagnostic seed failed.\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

async function request(route, { method = "GET", headers = ownerHeaders, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${payload?.error?.code ?? `HTTP_${response.status}`}: ` +
      `${payload?.error?.message ?? "Alphonse provisioning request failed."}`);
  }
  return payload;
}

function envelope(operationId, input, suffix) {
  return { command_id: `openclaw-lab-${suffix}-${runId}`, operation_id: operationId, input };
}

async function ownerCommand(route, operationId, input, suffix) {
  return request(route, { method: "POST", body: envelope(operationId, input, suffix) });
}

async function agentCommand(token, route, operationId, input, suffix) {
  return request(route, {
    method: "POST",
    headers: { authorization: `Agent ${token}`, "content-type": "application/json" },
    body: envelope(operationId, input, suffix)
  });
}

async function assertClientLayout() {
  await mkdir(workspaceDir, { recursive: true });
}

async function configuredModel() {
  if (process.env.OPENCLAW_MODEL) return process.env.OPENCLAW_MODEL;
  if (clientDir) {
    try {
      const config = JSON.parse(await readFile(openclawConfigPath, "utf8"));
      return config?.agents?.defaults?.model ?? "openclaw/default";
    } catch {}
  }
  return "openclaw/default";
}

async function installWorkspace({ token, requestId }) {
  const skillSource = path.join(root, "packages", "openclaw-diagnostic-workspace", "skill");
  const skillTarget = path.join(workspaceDir, "skills", "alphonse-diagnostic");
  await mkdir(path.dirname(skillTarget), { recursive: true });
  await cp(skillSource, skillTarget, { recursive: true, force: true });
  const connectionDirectory = path.join(workspaceDir, ".alphonse");
  const connectionFile = path.join(connectionDirectory, "diagnostic.env");
  await mkdir(connectionDirectory, { recursive: true });
  const model = await configuredModel();
  const provider = model.includes("/") ? model.split("/", 1)[0] : "openclaw";
  await writeFile(path.join(workspaceDir, "ALPHONSE.md"), [
    "# Alphonse Assignment",
    "",
    "This workspace is attached to one diagnosis-only Alphonse request.",
    "Use the `alphonse-diagnostic` skill. Alphonse remains authoritative for identity, intent, scope, and history.",
    "Do not attempt repair, verification, promotion, target changes, or external effects.",
    ""
  ].join("\n"), "utf8");
  const connection = [
    `ALPHONSE_URL=${runtimeBaseUrl}`,
    `ALPHONSE_AGENT_TOKEN=${token}`,
    `ALPHONSE_DIAGNOSIS_REQUEST_ID=${requestId}`,
    `ALPHONSE_MODEL_PROVIDER=${provider}`,
    `ALPHONSE_MODEL_ID=${model}`,
    "ALPHONSE_MODEL_VERSION=workspace-config",
    `OPENCLAW_VERSION=${process.env.OPENCLAW_VERSION ?? "local-runtime"}`,
    ""
  ].join("\n");
  await writeFile(connectionFile, connection, "utf8");
  await chmod(connectionFile, 0o600).catch(() => {});
  if (clientDir) {
    await writeFile(path.join(clientDir, ".env.alphonse"), connection, "utf8");
    if (runtimeKind === "docker") {
      await writeFile(path.join(clientDir, "docker-compose.alphonse.yml"), [
        "services:",
        "  openclaw:",
        "    env_file:",
        "      - .env.alphonse",
        ""
      ].join("\n"), "utf8");
    }
  }
  return { connectionFile, model };
}

function verifyAttachment({ token, requestId, skillTarget }) {
  const helper = path.join(skillTarget, "scripts", "alphonse-diagnostic.mjs");
  const result = spawnSync(process.execPath, [helper, "workspace"], {
    cwd: workspaceDir,
    env: {
      ...process.env,
      ALPHONSE_URL: baseUrl,
      ALPHONSE_AGENT_TOKEN: token,
      ALPHONSE_DIAGNOSIS_REQUEST_ID: requestId
    },
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`OpenClaw attachment verification failed: ${result.stderr}`);
  const workspace = JSON.parse(result.stdout);
  if (workspace?.diagnosis_request?.request_id !== requestId) {
    throw new Error("OpenClaw attachment returned a different diagnosis request.");
  }
  return new Date().toISOString();
}

await assertClientLayout();
const seed = runSeed();
const now = Date.now();
const sponsor = await ownerCommand("/kernel/v0/principals", "kernel.principal.create", {
  principal_type: "human",
  display_name: "OpenClaw Lab Owner"
}, "sponsor");
const agent = await ownerCommand("/kernel/v0/principals", "kernel.principal.create", {
  principal_type: "agent",
  display_name: "OpenClaw Diagnostic Worker"
}, "agent");
const agentToken = randomBytes(32).toString("hex");
const passport = await ownerCommand("/kernel/v0/agent-passports", "kernel.agent_passport.issue", {
  agent_principal_id: agent.principal.principal_id,
  sponsor_principal_id: sponsor.principal.principal_id,
  runtime: { kind: "customer-controlled", version: "openclaw-local" },
  model_configuration: { provider: "customer-selected", provider_custody: "openclaw-auth-profile-only" },
  package_skill_configuration: { protocol: "alphonse-diagnostic-worker-0.2.0" },
  agent_authentication_token: agentToken,
  permitted_intent_classes: ["diagnostic_analysis"],
  provenance: { source: "openclaw-local-provisioner" },
  valid_from: new Date(now - 60_000).toISOString(),
  expires_at: new Date(now + 8 * 60 * 60_000).toISOString()
}, "passport");
const intentProposal = await agentCommand(agentToken, "/kernel/v0/work-intent-proposals",
  "kernel.work_intent.propose", {
    passport_id: passport.passport.passport_id,
    intent_class: "diagnostic_analysis",
    objective: "Propose an advisory diagnosis from exact confirmed sources.",
    requested_outcome: "Return structured hypotheses and recommended investigation only.",
    scope: {
      case_id: seed.case_id,
      revision_id: seed.revision_id,
      reproduction_bundle_id: seed.reproduction_bundle_id
    },
    constraints: {
      no_failure_declaration: true,
      no_evidence_mutation: true,
      no_repair_commission: true,
      no_verification: true,
      no_promotion: true,
      no_external_effects: true
    }
  }, "intent-proposal");
const intent = await ownerCommand(
  `/kernel/v0/work-intent-proposals/${intentProposal.proposal.proposal_id}/confirm`,
  "kernel.work_intent.confirm", {}, "intent-confirm");
const registration = await agentCommand(agentToken, "/diagnostic/v0/diagnosis-workers",
  "diagnostic.diagnosis_worker.register", {
    passport_id: passport.passport.passport_id,
    work_intent_id: intent.work_intent.work_intent_id,
    protocol_version: "0.2.0",
    runtime_attribution: {
      worker_kind: "openclaw-diagnostic-worker",
      runtime_version: "local-image",
      attachment_version: "0.2.0"
    }
  }, "worker-register");
const diagnosisRequest = await ownerCommand("/diagnostic/v0/diagnosis-requests",
  "diagnostic.diagnosis_request.create", {
    case_id: seed.case_id,
    worker_registration_id: registration.diagnosis_worker.registration_id,
    reproduction_bundle_id: seed.reproduction_bundle_id,
    instruction: "Analyze only the confirmed missing-SKU behavior. Separate facts from inference and propose investigation, not repair.",
    expires_at: new Date(now + 45 * 60_000).toISOString()
  }, "diagnosis-request");

const installed = await installWorkspace({ token: agentToken, requestId: diagnosisRequest.diagnosis_request.request_id });
const skillTarget = path.join(workspaceDir, "skills", "alphonse-diagnostic");
const attachmentVerifiedAt = verifyAttachment({
  token: agentToken,
  requestId: diagnosisRequest.diagnosis_request.request_id,
  skillTarget
});
const attachmentManifest = {
  schema_version: "0.1.0",
  compose_project: project,
  kernel_url: baseUrl,
  case_id: seed.case_id,
  revision_id: seed.revision_id,
  reproduction_bundle_id: seed.reproduction_bundle_id,
  passport_id: passport.passport.passport_id,
  work_intent_id: intent.work_intent.work_intent_id,
  worker_registration_id: registration.diagnosis_worker.registration_id,
  diagnosis_request_id: diagnosisRequest.diagnosis_request.request_id,
  attachment_verified_at: attachmentVerifiedAt,
  runtime_kind: runtimeKind,
  runtime_url: runtimeBaseUrl,
  connection_file: path.relative(workspaceDir, installed.connectionFile),
  authority: registration.diagnosis_worker.authority,
  model_provider_credentials_stored: registration.diagnosis_worker.model_provider_credentials_stored
};
await writeFile(path.join(workspaceDir, ".alphonse", "attachment.json"),
  `${JSON.stringify(attachmentManifest, null, 2)}\n`, "utf8");
if (clientDir) {
  await writeFile(path.join(clientDir, "alphonse-workspace.json"),
    `${JSON.stringify(attachmentManifest, null, 2)}\n`, "utf8");
}

process.stdout.write(`${JSON.stringify({
  provisioned: true,
  client_directory: clientDir,
  workspace_directory: workspaceDir,
  compose_project: project,
  kernel_url: baseUrl,
  diagnosis_request_id: diagnosisRequest.diagnosis_request.request_id,
  attachment_verified_at: attachmentVerifiedAt,
  passport_intent_classes: ["diagnostic_analysis"],
  model_provider_credentials_stored: false,
  aws_activity: false
}, null, 2)}\n`);
