import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { createContextService } from "./context-service.js";
import { createDatabase } from "./database.js";
import { KernelError } from "./errors.js";
import { createIdentityIntentService, validateCommandEnvelope } from "./identity-intent-service.js";
import { getOperationDescriptor, listOperationDescriptors, PROTOCOL_VERSION } from "./operations.js";
import { validateProfileUpdateCommand } from "./validation.js";

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const installationId = process.env.KERNEL_INSTALLATION_ID ?? "00000000-0000-4000-8000-00000000a001";
const installationName = process.env.KERNEL_INSTALLATION_NAME ?? "Local Installation";
const environmentId = process.env.KERNEL_ENVIRONMENT_ID ?? "00000000-0000-4000-8000-000000000001";
const environmentName = process.env.KERNEL_ENVIRONMENT_NAME ?? "Local Development";
const bootstrapToken = process.env.KERNEL_BOOTSTRAP_TOKEN;
const bootstrapPrincipalId = process.env.KERNEL_BOOTSTRAP_PRINCIPAL_ID ?? "local-bootstrap-operator";
const dataPlaneServiceToken = process.env.DATA_PLANE_SERVICE_TOKEN;
const dataPlaneReceiptSecret = process.env.DATA_PLANE_RECEIPT_SECRET;
const dataPlaneId = process.env.DATA_PLANE_ID ?? "reference-data-plane";

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!bootstrapToken) throw new Error("KERNEL_BOOTSTRAP_TOKEN is required.");
if (!dataPlaneServiceToken || !dataPlaneReceiptSecret) throw new Error("Data Plane service credentials are required.");

const database = createDatabase(databaseUrl);
await database.migrate();
await database.bootstrapEnvironment(installationId, installationName, environmentId, environmentName);
const identityIntent = createIdentityIntentService(database, installationId, environmentId, bootstrapPrincipalId);
const contextService = createContextService(database, identityIntent, installationId, environmentId);

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function sendHtml(response, status, html) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new KernelError(413, "REQUEST_TOO_LARGE", "Command body exceeds 64 KiB.");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new KernelError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function serializeEnvironment(environment) {
  return {
    installation_id: environment.installation_id,
    environment_id: environment.environment_id,
    display_name: environment.display_name,
    revision: environment.revision,
    created_at: environment.created_at,
    updated_at: environment.updated_at
  };
}

function authenticateBootstrapOperator(request) {
  const authorization = request.headers.authorization;
  let credential = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  if (authorization?.startsWith("Basic ")) {
    credential = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8").split(":").slice(1).join(":");
  }
  if (!credential) {
    throw new KernelError(401, "AUTHENTICATION_REQUIRED", "Bootstrap operator credential is required.");
  }

  const supplied = Buffer.from(credential, "utf8");
  const expected = Buffer.from(bootstrapToken, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new KernelError(403, "INVALID_BOOTSTRAP_CREDENTIAL", "Bootstrap operator credential is invalid.");
  }

  return { type: "human", id: bootstrapPrincipalId };
}

function sendCommandResult(response, accepted) {
  return sendJson(response, accepted.replayed ? 200 : 201, accepted.result, {
    "idempotent-replayed": accepted.replayed ? "true" : "false"
  });
}

function pathId(pathname, prefix) {
  return decodeURIComponent(pathname.slice(prefix.length));
}

function authenticateDataPlane(request) {
  const supplied = request.headers.authorization?.startsWith("Bearer ")
    ? Buffer.from(request.headers.authorization.slice(7), "utf8") : Buffer.alloc(0);
  const expected = Buffer.from(dataPlaneServiceToken, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new KernelError(403, "DATA_PLANE_AUTHENTICATION_FAILED", "Data Plane service authentication failed.");
  }
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    await database.ping();
    return sendJson(response, 200, { status: "healthy", protocol_version: PROTOCOL_VERSION });
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/bootstrap") {
    const environment = await database.getEnvironment(installationId, environmentId);
    return sendJson(response, 200, {
      status: "healthy",
      protocol: {
        name: "alphonse-kernel-protocol",
        version: PROTOCOL_VERSION,
        discovery: "/kernel/v0/operations"
      },
      environment: serializeEnvironment(environment),
      operations: listOperationDescriptors(),
      butler: { overview: "/kernel/v0/accountable-work/overview", shell: "/butler" }
    });
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/operations") {
    return sendJson(response, 200, { protocol_version: PROTOCOL_VERSION, operations: listOperationDescriptors() });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/operations/")) {
    const operationId = decodeURIComponent(url.pathname.slice("/kernel/v0/operations/".length));
    const descriptor = getOperationDescriptor(operationId);
    if (!descriptor) throw new KernelError(404, "OPERATION_NOT_FOUND", "Operation descriptor does not exist.");
    return sendJson(response, 200, descriptor);
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/environments/current") {
    return sendJson(response, 200, serializeEnvironment(await database.getEnvironment(installationId, environmentId)));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/commands") {
    const actor = authenticateBootstrapOperator(request);
    const command = { ...validateProfileUpdateCommand(await readJson(request)), actor };
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    const accepted = await database.executeEnvironmentProfileUpdate(
      installationId,
      environmentId,
      command,
      requestDigest
    );
    return sendJson(response, accepted.replayed ? 200 : 201, accepted.result, {
      "idempotent-replayed": accepted.replayed ? "true" : "false"
    });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/principals") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.principal.create");
    return sendCommandResult(response, await identityIntent.createPrincipal(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/principals/")) {
    authenticateBootstrapOperator(request);
    const principal = await identityIntent.getPrincipal(pathId(url.pathname, "/kernel/v0/principals/"));
    return sendJson(response, 200, { principal });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/agent-passports") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.agent_passport.issue");
    return sendCommandResult(response, await identityIntent.issuePassport(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/agent-passports/")) {
    authenticateBootstrapOperator(request);
    const passport = await identityIntent.getPassport(pathId(url.pathname, "/kernel/v0/agent-passports/"));
    return sendJson(response, 200, { passport });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/work-intent-proposals") {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Agent ")) throw new KernelError(401, "AGENT_AUTHENTICATION_REQUIRED", "Agent Passport credential is required.");
    const passport = await identityIntent.authenticateAgent(authorization.slice("Agent ".length));
    const command = validateCommandEnvelope(await readJson(request), "kernel.work_intent.propose");
    return sendCommandResult(response, await identityIntent.proposeIntent(command, passport));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/work-intent-proposals\/[^/]+\/confirm$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const proposalId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.work_intent.confirm");
    return sendCommandResult(response, await identityIntent.confirmIntent(command, proposalId));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/work-intent-proposals/")) {
    authenticateBootstrapOperator(request);
    const proposal = await identityIntent.getProposal(pathId(url.pathname, "/kernel/v0/work-intent-proposals/"));
    return sendJson(response, 200, { proposal });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/work-intents/")) {
    authenticateBootstrapOperator(request);
    const workIntent = await identityIntent.getWorkIntent(pathId(url.pathname, "/kernel/v0/work-intents/"));
    return sendJson(response, 200, { work_intent: workIntent });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/build-sessions") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.build_session.open");
    return sendCommandResult(response, await identityIntent.openBuildSession(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/build-sessions/")) {
    authenticateBootstrapOperator(request);
    const buildSession = await identityIntent.getBuildSession(pathId(url.pathname, "/kernel/v0/build-sessions/"));
    return sendJson(response, 200, { build_session: buildSession });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/admission/check") {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, await identityIntent.checkAdmission(await readJson(request)));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/context-access-grants") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.context_access_grant.issue");
    return sendCommandResult(response, await contextService.issueGrant(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/context-access-grants/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { context_access_grant: await contextService.getGrant(pathId(url.pathname, "/kernel/v0/context-access-grants/")) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/context-receipts/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { context_receipt: await contextService.getReceipt(pathId(url.pathname, "/kernel/v0/context-receipts/")) });
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/context/authorize") {
    authenticateDataPlane(request);
    const input = await readJson(request);
    return sendJson(response, 200, await contextService.authorize({ ...input, agent_token: request.headers["x-agent-token"] }));
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/context/receipts") {
    authenticateDataPlane(request);
    const receipt = await readJson(request);
    const signature = request.headers["x-receipt-signature"] ?? "";
    const expected = `hmac-sha256:${createHmac("sha256", dataPlaneReceiptSecret).update(canonicalize(receipt)).digest("hex")}`;
    const suppliedBytes = Buffer.from(signature, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw new KernelError(403, "INVALID_RECEIPT_SIGNATURE", "Context Receipt signature is invalid.");
    }
    return sendCommandResult(response, await contextService.recordReceipt(receipt, signature, dataPlaneId));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/commands/")) {
    authenticateBootstrapOperator(request);
    const commandId = decodeURIComponent(url.pathname.slice("/kernel/v0/commands/".length));
    const receipt = await database.getCommandReceipt(installationId, environmentId, commandId);
    if (!receipt) throw new KernelError(404, "COMMAND_NOT_FOUND", "Command receipt does not exist.");
    return sendJson(response, 200, receipt);
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/accountable-work/overview") {
    authenticateBootstrapOperator(request);
    const environment = await database.getEnvironment(installationId, environmentId);
    const items = await identityIntent.getAccountableWork();
    for (const item of items) item.context = await contextService.contextForWorkIntent(item.intent.work_intent_id);
    return sendJson(response, 200, {
      environment: serializeEnvironment(environment),
      health: "healthy",
      accountable_work: { count: items.length, items },
      authority: "read_only_projection"
    });
  }

  if (request.method === "GET" && url.pathname === "/butler/api/v0/overview") {
    response.writeHead(307, { location: "/kernel/v0/accountable-work/overview" });
    return response.end();
  }

  if (request.method === "GET" && url.pathname === "/butler") {
    try {
      authenticateBootstrapOperator(request);
    } catch (error) {
      if (error instanceof KernelError) {
        response.writeHead(401, { "www-authenticate": 'Basic realm="Alphonse Butler"' });
        return response.end("Authentication required.");
      }
      throw error;
    }
    const items = await identityIntent.getAccountableWork();
    for (const item of items) item.context = await contextService.contextForWorkIntent(item.intent.work_intent_id);
    const threads = items.length === 0 ? "<p>No accountable work.</p>" : items.map((item) =>
      `<article><h2>${escapeHtml(item.identity.agent_name)}</h2><dl><dt>Intent</dt><dd>${escapeHtml(item.intent.objective)}</dd><dt>Intent status</dt><dd>${escapeHtml(item.intent.status)}</dd><dt>Build Session</dt><dd>${escapeHtml(item.build_session.build_session_id)} / ${escapeHtml(item.build_session.status)}</dd><dt>Context authority</dt><dd>${escapeHtml(item.context[0]?.authority ?? "not_granted")}</dd><dt>Context freshness</dt><dd>${escapeHtml(item.context[0]?.latest_receipt?.freshness_claims?.map((claim) => `${claim.source}:${claim.current_age_seconds}s ${claim.status}`).join(", ") ?? "not_observed")}</dd><dt>Redactions</dt><dd>${escapeHtml(item.context[0]?.latest_receipt?.limitations?.fields_redacted?.join(", ") ?? "none")}</dd><dt>Effect authority</dt><dd>${escapeHtml(item.authority.effects)}</dd><dt>Execution authority</dt><dd>${escapeHtml(item.authority.execution)}</dd></dl></article>`
    ).join("");
    return sendHtml(response, 200, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Butler</title>
<style>*{box-sizing:border-box}body{font:16px ui-monospace,SFMono-Regular,Consolas,monospace;width:min(808px,100%);margin:10vh auto;padding:24px;color:#151515;background:#f7f7f3}header{border-bottom:2px solid #151515;padding-bottom:16px}dl{display:grid;grid-template-columns:180px minmax(0,1fr);gap:10px}dt{font-weight:700}dd{overflow-wrap:anywhere}.ok{color:#087830}@media(max-width:540px){body{margin:4vh auto}dl{grid-template-columns:1fr;gap:4px}dd{margin:0 0 12px}}</style></head>
<body><header><strong>BUTLER</strong> / accountable operations</header><main><h1>${escapeHtml(environmentName)}</h1><p>Kernel health: <span class="ok">healthy</span></p><p>${items.length} accountable item(s)</p>${threads}<p>Butler is a read-only supervisory projection. Authority remains in Kernel.</p></main></body></html>`);
  }

  throw new KernelError(404, "ROUTE_NOT_FOUND", "Route does not exist.");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    if (error instanceof KernelError) {
      return sendJson(response, error.status, {
        error: { code: error.code, message: error.message, details: error.details }
      });
    }
    console.error(error);
    sendJson(response, 500, { error: { code: "INTERNAL_ERROR", message: "Unexpected Kernel failure." } });
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Alphonse Kernel ${PROTOCOL_VERSION} listening on ${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(async () => {
    await database.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
