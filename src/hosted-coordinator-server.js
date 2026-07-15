import http from "node:http";
import pg from "pg";

import { CoordinationContractError } from "./coordination-contracts.js";
import { CoordinatorError, createHostedCoordinatorService, validatePromotionGraph } from "./hosted-coordinator-service.js";

const { Pool } = pg;
const port = Number(process.env.COORDINATOR_PORT ?? 3600);
const databaseUrl = process.env.COORDINATOR_DATABASE_URL;
const coordinatorId = process.env.COORDINATOR_ID ?? "coordinator:local";
const customerId = process.env.COORDINATOR_CUSTOMER_ID ?? "customer:demo";
const privateKey = process.env.COORDINATOR_PRIVATE_KEY;
const enrollmentTokens = JSON.parse(process.env.COORDINATOR_ENROLLMENT_TOKENS ?? "{}");
const accountToken = process.env.COORDINATOR_ACCOUNT_TOKEN;
const promotionGraph = validatePromotionGraph(JSON.parse(process.env.COORDINATOR_PROMOTION_GRAPH ?? JSON.stringify({
  "development:staging": ["package_validation", "compatibility"],
  "staging:production": ["staging_deployed", "staging_activated", "staging_recovery"]
})));

if (!databaseUrl || !privateKey || Object.keys(enrollmentTokens).length < 1 || !accountToken) {
  throw new Error("Coordinator database, signing key, per-Environment enrollment tokens, and account token are required.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const coordinator = createHostedCoordinatorService(pool, { coordinatorId, customerId, privateKey, promotionGraph });
await coordinator.migrate();

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function body(request, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new CoordinatorError(413, "REQUEST_TOO_LARGE", "Coordinator request exceeds 1 MiB.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CoordinatorError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function authenticate(request, expected, code) {
  if (typeof expected !== "string" || expected.length < 1
      || request.headers.authorization !== `Bearer ${expected}`) {
    throw new CoordinatorError(403, code, "Hosted account authentication failed.");
  }
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/healthz") {
    await pool.query("SELECT 1");
    return send(response, 200, { status: "healthy", coordinator_id: coordinatorId,
      coordinator_public_key: coordinator.publicKey, deployment_authority: false });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/registration-challenges") {
    const input = await body(request);
    authenticate(request, enrollmentTokens[input?.environment_id], "ENROLLMENT_AUTHENTICATION_FAILED");
    return send(response, 201, { challenge: await coordinator.issueRegistrationChallenge(input) });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/registrations") {
    return send(response, 201, { registration: await coordinator.registerEnvironment(await body(request)) });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/promotion-requests") {
    return send(response, 201, { promotion_proposal: await coordinator.submitPromotion(await body(request)) });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/promotion-polls") {
    return send(response, 200, { promotion_proposals: await coordinator.pollPromotions(await body(request)) });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/promotion-receipts") {
    return send(response, 201, { promotion_status: await coordinator.recordPromotionReceipt(await body(request)) });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/environment-health") {
    return send(response, 201, { environment_health: await coordinator.recordEnvironmentHealth(await body(request)) });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/support-polls") {
    return send(response, 200, { support_cases: await coordinator.pollSupportCases(await body(request)) });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/support-passport-notices") {
    return send(response, 201, { support_case: await coordinator.recordSupportPassportNotice(await body(request)) });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/binding-revocations") {
    return send(response, 200, { environment: await coordinator.recordBindingRevocation(await body(request)) });
  }
  if (request.method === "POST" && url.pathname === "/coordinator/v0/support-cases") {
    authenticate(request, accountToken, "ACCOUNT_AUTHENTICATION_FAILED");
    return send(response, 201, { support_case: await coordinator.createSupportCase(await body(request)) });
  }
  if (request.method === "GET" && url.pathname.startsWith("/coordinator/v0/support-cases/")) {
    authenticate(request, accountToken, "ACCOUNT_AUTHENTICATION_FAILED");
    const supportCaseId = decodeURIComponent(url.pathname.slice("/coordinator/v0/support-cases/".length));
    return send(response, 200, { support_case: await coordinator.getSupportCase(supportCaseId) });
  }
  if (request.method === "GET" && url.pathname.startsWith("/coordinator/v0/promotion-status/")) {
    authenticate(request, accountToken, "ACCOUNT_AUTHENTICATION_FAILED");
    const proposalId = decodeURIComponent(url.pathname.slice("/coordinator/v0/promotion-status/".length));
    return send(response, 200, { promotion_status: await coordinator.getPromotionStatus(proposalId) });
  }
  if (request.method === "GET" && url.pathname === "/coordinator/v0/environments") {
    authenticate(request, accountToken, "ACCOUNT_AUTHENTICATION_FAILED");
    return send(response, 200, { environments: await coordinator.listEnvironments() });
  }
  if (request.method === "GET" && url.pathname.startsWith("/coordinator/v0/environments/")) {
    authenticate(request, accountToken, "ACCOUNT_AUTHENTICATION_FAILED");
    const environmentId = decodeURIComponent(url.pathname.slice("/coordinator/v0/environments/".length));
    return send(response, 200, { environment: await coordinator.getEnvironment(environmentId) });
  }
  if (request.method === "GET" && url.pathname === "/coordinator/v0/promotion-graph") {
    authenticate(request, accountToken, "ACCOUNT_AUTHENTICATION_FAILED");
    return send(response, 200, { promotion_graph: coordinator.getPromotionGraph() });
  }
  throw new CoordinatorError(404, "ROUTE_NOT_FOUND", "Coordinator route does not exist.");
}

const server = http.createServer((request, response) => {
  route(request, response).catch((cause) => {
    if (cause instanceof CoordinatorError) {
      return send(response, cause.status, { error: { code: cause.code, message: cause.message, details: cause.details } });
    }
    if (cause instanceof CoordinationContractError) {
      return send(response, cause.code === "INVALID_COORDINATION_SIGNATURE" ? 403 : 400,
        { error: { code: cause.code, message: cause.message, details: {} } });
    }
    console.error(cause);
    return send(response, 500, { error: { code: "INTERNAL_ERROR", message: "Coordinator request failed." } });
  });
});

server.listen(port, "0.0.0.0", () => console.log(`Hosted coordinator listening on ${port}`));

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
