/**
 * Mechanical extractor: split src/server.js into http-helpers + three routers.
 * Run: node scripts/split-server-routers.js --apply
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const serverPath = path.join(root, "src", "server.js");
const source = readFileSync(serverPath, "utf8");
const lines = source.split(/\r?\n/);
const apply = process.argv.includes("--apply");

function findLine(predicate, from = 0) {
  for (let i = from; i < lines.length; i += 1) {
    if (predicate(lines[i], i)) return i;
  }
  return -1;
}

const routeStart = findLine((line) => line.startsWith("async function route("));
const routeEnd = findLine((line, i) => i > routeStart && line === "}");
const helpersStart = findLine((line) => line.startsWith("function sendJson("));
const escapeHtmlStart = findLine((line) => line.startsWith("function escapeHtml("), routeEnd);
const escapeHtmlEnd = findLine((line, i) => i > escapeHtmlStart && line === "}");
const bootstrapStart = findLine((line) => line.startsWith("const server = http.createServer"));
const compositionEnd = helpersStart; // exclusive

function extractIfBlocks() {
  const blocks = [];
  let i = routeStart + 1;
  while (i < routeEnd && (lines[i].trim() === "" || lines[i].includes("const url ="))) i += 1;
  while (i < routeEnd) {
    if (lines[i].trim() === "") { i += 1; continue; }
    if (lines[i].startsWith("  throw new KernelError(404")) break;
    if (!lines[i].startsWith("  if (")) {
      throw new Error(`Unexpected route body at ${i + 1}: ${lines[i]}`);
    }
    const start = i;
    let braceLine = i;
    while (braceLine < routeEnd && !lines[braceLine].includes("{")) braceLine += 1;
    let depth = 0;
    let j = braceLine;
    for (; j <= routeEnd; j += 1) {
      depth += (lines[j].match(/\{/g) ?? []).length;
      depth -= (lines[j].match(/\}/g) ?? []).length;
      if (j > braceLine && depth === 0) break;
    }
    const blockLines = lines.slice(start, j + 1);
    blocks.push({ start, end: j, text: blockLines.join("\n"), lines: blockLines });
    i = j + 1;
  }
  return blocks;
}

function classify(blockText) {
  if (/url\.pathname\s*===\s*"\/healthz"/.test(blockText)) return "support";
  // Match both string literals ("/kernel/v0/...") and regex escapes (\/kernel\/v0\/).
  if (/\/kernel\/v0\//.test(blockText) || /\\\/kernel\\\/v0\\\//.test(blockText)) return "kernel";
  if ((/\/diagnostic\/v0\//.test(blockText) || /\\\/diagnostic\\\/v0\\\//.test(blockText))
      && !/\/diagnostic\/internal\//.test(blockText)
      && !/\\\/diagnostic\\\/internal\\\//.test(blockText)) {
    return "diagnostic";
  }
  return "support";
}

/** Insert `return true;` before the closing brace of a top-level if block. */
function withReturnTrue(blockLines) {
  const out = [...blockLines];
  // closing brace is last line, typically "  }"
  const last = out.length - 1;
  if (out[last].trim() !== "}") throw new Error(`Block does not end with }: ${out[last]}`);
  // Find last non-empty content before closing brace
  out.splice(last, 0, "    return true;");
  return out;
}

const blocks = extractIfBlocks();
const buckets = { kernel: [], diagnostic: [], support: [] };
for (const block of blocks) {
  buckets[classify(block.text)].push(block);
}
console.log(`blocks=${blocks.length} kernel=${buckets.kernel.length} diagnostic=${buckets.diagnostic.length} support=${buckets.support.length}`);

if (!apply) {
  mkdirSync(path.join(root, ".scratch"), { recursive: true });
  writeFileSync(path.join(root, ".scratch", "split-server-preview.json"), JSON.stringify({
    counts: {
      total: blocks.length,
      kernel: buckets.kernel.length,
      diagnostic: buckets.diagnostic.length,
      support: buckets.support.length
    }
  }, null, 2));
  console.log("Dry run only. Pass --apply to write files.");
  process.exit(0);
}

const composition = lines.slice(0, compositionEnd).join("\n").replace(/\s+$/, "");
const bootstrap = lines.slice(bootstrapStart).join("\n");

const httpHelpers = `// @ts-check

import { timingSafeEqual } from "node:crypto";

import { KernelError } from "./errors.js";
import { authorizeTrustedOperator, directOwnerActor } from "./trusted-operator.js";

/**
 * Shared HTTP and route helpers for the Kernel / Diagnostic / Support routers.
 * Auth and availability guards bind services through createRouteHelpers (ADR 0107).
 */

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {string} html
 */
export function sendHtml(response, status, html) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {number} [limit]
 */
export async function readJson(request, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw new KernelError(413, "REQUEST_TOO_LARGE", \`Command body exceeds \${Math.floor(limit / 1024)} KiB.\`);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new KernelError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {{ replayed: boolean, result: unknown }} accepted
 */
export function sendCommandResult(response, accepted) {
  return sendJson(response, accepted.replayed ? 200 : 201, accepted.result, {
    "idempotent-replayed": accepted.replayed ? "true" : "false"
  });
}

/**
 * @param {string} pathname
 * @param {string} prefix
 */
export function pathId(pathname, prefix) {
  return decodeURIComponent(pathname.slice(prefix.length));
}

/**
 * @param {string} pathname
 * @param {any} body
 */
export function requireRouteTaskMatch(pathname, body) {
  const routeTaskId = decodeURIComponent(pathname.split("/").at(-2) ?? "");
  if (body?.input?.task_id !== routeTaskId) {
    throw new KernelError(409, "REPAIR_TASK_ROUTE_MISMATCH", "Route Repair Task ID must match command input.");
  }
  return body;
}

/**
 * @param {any} environment
 */
export function serializeEnvironment(environment) {
  return {
    installation_id: environment.installation_id,
    environment_id: environment.environment_id,
    display_name: environment.display_name,
    environment_class: environment.environment_class,
    revision: environment.revision,
    execution_epoch: environment.execution_epoch,
    operational_state: environment.operational_state,
    restore_generation: environment.restore_generation,
    created_at: environment.created_at,
    updated_at: environment.updated_at
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {any} body
 */
export function observationAuthentication(request, body) {
  return body.authentication ?? {
    principal_id: request.headers["x-observation-principal-id"],
    grant_id: request.headers["x-observation-grant-id"],
    key_id: request.headers["x-observation-key-id"],
    signed_at: request.headers["x-observation-signed-at"],
    signature: request.headers["x-observation-signature"]
  };
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {unknown} error
 * @param {typeof import("./coordination-contracts.js").CoordinationContractError} CoordinationContractError
 */
export function writeError(response, error, CoordinationContractError) {
  if (error instanceof KernelError) {
    return sendJson(response, error.status, {
      error: { code: error.code, message: error.message, details: error.details }
    });
  }
  if (error instanceof CoordinationContractError) {
    return sendJson(response, error.code === "INVALID_COORDINATION_SIGNATURE" ? 403 : 400,
      { error: { code: error.code, message: error.message, details: {} } });
  }
  console.error(error);
  sendJson(response, 500, { error: { code: "INTERNAL_ERROR", message: "Unexpected Kernel failure." } });
}

/**
 * Bind auth and diagnostic-plane availability guards to the live composition root.
 * @param {any} deps
 */
export function createRouteHelpers(deps) {
  const {
    ownerToken, bootstrapPrincipalId, identityIntent,
    dataPlaneServiceToken, substrateServiceToken, brokerServiceToken,
    diagnosticService, diagnosticDatabase, diagnosticRuntimeService,
    diagnosticReproductionService, grantAuthorityService,
    diagnosticGrantApplicationService, diagnosticObservationService,
    diagnosticTokenizationProofService, diagnosticCorrelationService,
    diagnosticEffectEvaluationService, diagnosticEvidencePackageService,
    diagnosticMaterialAvailabilityService, diagnosticAssignmentService,
    diagnosticDispatchService, diagnosticWorkerExecutionService,
    diagnosticConsistencyService, diagnosticDispatchAuthorizationService,
    diagnosticIndependentVerificationService, diagnosticRepairWorkerService,
    diagnosticDiagnosisService, diagnosticRepairDeliveryService,
    diagnosticVerificationService, diagnosticPromotionService
  } = deps;

  function authenticateBootstrapOperator(request) {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Agent ")) {
      throw new KernelError(403, "OWNER_AUTHORITY_REQUIRED",
        "Agent Passports cannot invoke customer Owner operations.");
    }
    let credential = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
    if (authorization?.startsWith("Owner ")) {
      credential = authorization.slice("Owner ".length);
    }
    if (authorization?.startsWith("Basic ")) {
      credential = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8").split(":").slice(1).join(":");
    }
    if (!credential) {
      throw new KernelError(401, "AUTHENTICATION_REQUIRED", "Bootstrap operator credential is required.");
    }
    const supplied = Buffer.from(credential, "utf8");
    const expected = Buffer.from(ownerToken, "utf8");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new KernelError(403, "INVALID_BOOTSTRAP_CREDENTIAL", "Bootstrap operator credential is invalid.");
    }
    return { type: "human", id: bootstrapPrincipalId };
  }

  async function authenticateDiagnosticOwner(request, operationId) {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Operator ")) {
      const passport = await identityIntent.authenticateAgent(authorization.slice("Operator ".length));
      return authorizeTrustedOperator(passport, operationId, request.headers).actor;
    }
    return directOwnerActor(authenticateBootstrapOperator(request));
  }

  function authenticatePrivateService(request, expectedToken, code) {
    if (!expectedToken) throw new KernelError(503, \`\${code}_UNAVAILABLE\`, "Private service authentication is not configured.");
    const suppliedValue = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice("Bearer ".length) : "";
    const supplied = Buffer.from(suppliedValue, "utf8");
    const expected = Buffer.from(expectedToken, "utf8");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new KernelError(403, code, "Private service authentication failed.");
    }
    return { type: "service", id: code === "GRANT_AUTHORITY_FEED_AUTHENTICATION_FAILED"
      ? "kernel-grant-authority-feed" : "diagnostic-plane" };
  }

  function authenticateDataPlane(request) {
    const supplied = request.headers.authorization?.startsWith("Bearer ")
      ? Buffer.from(request.headers.authorization.slice(7), "utf8") : Buffer.alloc(0);
    const expected = Buffer.from(dataPlaneServiceToken, "utf8");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new KernelError(403, "DATA_PLANE_AUTHENTICATION_FAILED", "Data Plane service authentication failed.");
    }
  }

  function authenticateSubstrate(request) {
    const supplied = request.headers.authorization?.startsWith("Bearer ")
      ? Buffer.from(request.headers.authorization.slice(7), "utf8") : Buffer.alloc(0);
    const expected = Buffer.from(substrateServiceToken, "utf8");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new KernelError(403, "SUBSTRATE_AUTHENTICATION_FAILED", "Runtime substrate authentication failed.");
    }
  }

  function authenticateBroker(request) {
    const supplied = request.headers.authorization?.startsWith("Bearer ")
      ? Buffer.from(request.headers.authorization.slice(7), "utf8") : Buffer.alloc(0);
    const expected = Buffer.from(brokerServiceToken, "utf8");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new KernelError(403, "BROKER_AUTHENTICATION_REQUIRED", "Credential broker authentication failed.");
    }
  }

  async function authenticateAgent(request) {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Agent ")) {
      throw new KernelError(401, "AGENT_AUTHENTICATION_REQUIRED", "Agent Passport credential is required.");
    }
    return identityIntent.authenticateAgent(authorization.slice("Agent ".length));
  }

  function requireOr(service, statusCode, code, message) {
    if (!service) throw new KernelError(statusCode, code, message);
    return service;
  }

  return {
    sendJson, sendHtml, readJson, sendCommandResult, pathId, requireRouteTaskMatch,
    serializeEnvironment, escapeHtml, observationAuthentication,
    authenticateBootstrapOperator, authenticateDiagnosticOwner, authenticatePrivateService,
    authenticateDataPlane, authenticateSubstrate, authenticateBroker, authenticateAgent,
    requireDiagnosticPlane: () => requireOr(diagnosticService && diagnosticDatabase ? diagnosticService : null, 503,
      "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic Plane is not configured for this Node."),
    requireDiagnosticRuntime: () => requireOr(diagnosticRuntimeService, 503, "DIAGNOSTIC_RUNTIME_UNAVAILABLE",
      "Diagnostic Runtime intake is not configured."),
    requireDiagnosticReproduction: () => requireOr(diagnosticReproductionService, 503, "DIAGNOSTIC_PLANE_UNAVAILABLE",
      "Diagnostic reproduction is not configured."),
    requireGrantAuthority: () => requireOr(grantAuthorityService, 503, "GRANT_AUTHORITY_UNAVAILABLE",
      "Grant authority protocol is not configured."),
    requireDiagnosticGrantApplication: () => requireOr(diagnosticGrantApplicationService, 503,
      "GRANT_APPLICATION_RECEIVER_UNAVAILABLE", "Diagnostic grant receiver is not configured."),
    requireDiagnosticObservation: () => requireOr(diagnosticObservationService, 503, "OBSERVATION_INTAKE_UNAVAILABLE",
      "Canonical observation intake is not configured."),
    requireDiagnosticTokenizationProof: () => requireOr(diagnosticTokenizationProofService, 503,
      "TOKENIZATION_PROOF_UNAVAILABLE", "Tokenization Result Receipt verification is not configured."),
    requireDiagnosticCorrelation: () => requireOr(diagnosticCorrelationService, 503,
      "CORRELATION_PROJECTION_UNAVAILABLE", "Deterministic correlation projection is not configured."),
    requireDiagnosticEffectEvaluation: () => requireOr(diagnosticEffectEvaluationService, 503,
      "DIAGNOSTIC_EFFECT_EVALUATION_UNAVAILABLE",
      "Deterministic effect interpretation and behavior evaluation are not configured."),
    requireDiagnosticEvidencePackaging: () => requireOr(diagnosticEvidencePackageService, 503,
      "DIAGNOSTIC_EVIDENCE_PACKAGING_UNAVAILABLE",
      "Deterministic evidence collection and packaging are not configured."),
    requireDiagnosticMaterialAvailability: () => requireOr(diagnosticMaterialAvailabilityService, 503,
      "DIAGNOSTIC_MATERIAL_AUTHORITY_UNAVAILABLE",
      "Diagnostic material availability and erasure authority is not configured."),
    requireDiagnosticAssignment: () => requireOr(diagnosticAssignmentService, 503,
      "DIAGNOSTIC_ASSIGNMENT_SERVICE_UNAVAILABLE", "Diagnostic Assignment Service is not configured."),
    requireDiagnosticDispatch: () => requireOr(diagnosticDispatchService, 503,
      "DIAGNOSTIC_DISPATCH_SERVICE_UNAVAILABLE", "Diagnostic dispatch and claim service is not configured."),
    requireDiagnosticWorkerExecution: () => requireOr(diagnosticWorkerExecutionService, 503,
      "DIAGNOSTIC_WORKER_EXECUTION_UNAVAILABLE", "Diagnostic Worker execution is not configured."),
    requireDiagnosticConsistency: () => requireOr(diagnosticConsistencyService, 503,
      "DIAGNOSTIC_CONSISTENCY_SERVICE_UNAVAILABLE", "Diagnostic Consistency Test service is not configured."),
    requireDiagnosticDispatchAuthority: () => requireOr(diagnosticDispatchAuthorizationService, 503,
      "DIAGNOSTIC_DISPATCH_AUTHORITY_UNAVAILABLE", "Kernel Diagnostic Dispatch Authority is not configured."),
    requireIndependentDiagnosticVerification: () => requireOr(diagnosticIndependentVerificationService, 503,
      "INDEPENDENT_DIAGNOSTIC_VERIFICATION_UNAVAILABLE", "Independent diagnostic verification is not configured."),
    requireDiagnosticRepairWorker: () => requireOr(diagnosticRepairWorkerService, 503, "DIAGNOSTIC_PLANE_UNAVAILABLE",
      "Diagnostic repair workers are not configured."),
    requireDiagnosticDiagnosis: () => requireOr(diagnosticDiagnosisService, 503, "DIAGNOSTIC_PLANE_UNAVAILABLE",
      "Diagnostic workers are not configured."),
    requireDiagnosticRepairDelivery: () => requireOr(diagnosticRepairDeliveryService, 503,
      "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic repair delivery is not configured."),
    requireDiagnosticVerification: () => requireOr(diagnosticVerificationService, 503,
      "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic verification is not configured."),
    requireDiagnosticPromotion: () => requireOr(diagnosticPromotionService, 503, "DIAGNOSTIC_PLANE_UNAVAILABLE",
      "Diagnostic promotion is not configured.")
  };
}
`;

function routerSource(name, factoryName, bucketBlocks) {
  const body = bucketBlocks.map((block) => withReturnTrue(block.lines).join("\n")).join("\n\n");
  return `/**
 * ${name} HTTP routes extracted from the Kernel composition root.
 * Handlers are unchanged; only module boundaries moved.
 */

import { KernelError } from "./errors.js";

/**
 * @param {any} ctx Composition-root services, config, and createRouteHelpers() result.
 * @returns {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, url: URL) => Promise<boolean>}
 */
export function ${factoryName}(ctx) {
  const {
    database, identityIntent, grantAuthorityService, contextService, packageService,
    packageTrustService, deploymentService, upgradeService, handoffService, executionService,
    recoveryService, restoreService, effectService, environmentCoordination, supportService,
    diagnosticDatabase, diagnosticService, diagnosticRuntimeService, diagnosticReproductionService,
    diagnosticRepairWorkerService, diagnosticDiagnosisService, diagnosticRepairDeliveryService,
    diagnosticVerificationService, diagnosticPromotionService, diagnosticArtifactStore,
    diagnosticGrantApplicationService, diagnosticObservationService, diagnosticTokenizationProofService,
    diagnosticCorrelationService, diagnosticEffectEvaluationService, diagnosticEvidencePackageService,
    diagnosticIndependentVerificationService, diagnosticAssignmentService,
    diagnosticMaterialAvailabilityService, diagnosticDispatchService,
    diagnosticDispatchAuthorizationService, diagnosticWorkerExecutionService,
    diagnosticConsistencyService,
    installationId, environmentId, environmentName,
    grantAuthorityFeedToken, grantApplicationReceiptServiceToken, diagnosticTokenizationResultToken,
    dataPlaneReceiptSecret, dataPlaneId,
    diagnosticRuntimeAdapterId, diagnosticRuntimeAdapterVersion, diagnosticRuntimeAdapterKeyId,
    PROTOCOL_VERSION, DIAGNOSTIC_PROTOCOL_VERSION,
    listOperationDescriptors, getOperationDescriptor,
    listDiagnosticOperationDescriptors, getDiagnosticOperationDescriptor,
    getWorkflowRuntimeAdapterContract, getRepairDeliveryAdapterContract, getVerificationRunnerContract,
    validateCommandEnvelope, validateProfileUpdateCommand,
    canonicalize, sha256Digest, createHmac, createPublicKey,
    sendJson, sendHtml, readJson, sendCommandResult, pathId, requireRouteTaskMatch,
    serializeEnvironment, escapeHtml, observationAuthentication,
    authenticateBootstrapOperator, authenticateDiagnosticOwner, authenticatePrivateService,
    authenticateDataPlane, authenticateSubstrate, authenticateBroker, authenticateAgent,
    requireDiagnosticPlane, requireDiagnosticRuntime, requireDiagnosticReproduction,
    requireGrantAuthority, requireDiagnosticGrantApplication, requireDiagnosticObservation,
    requireDiagnosticTokenizationProof, requireDiagnosticCorrelation, requireDiagnosticEffectEvaluation,
    requireDiagnosticEvidencePackaging, requireDiagnosticMaterialAvailability, requireDiagnosticAssignment,
    requireDiagnosticDispatch, requireDiagnosticWorkerExecution, requireDiagnosticConsistency,
    requireDiagnosticDispatchAuthority, requireIndependentDiagnosticVerification,
    requireDiagnosticRepairWorker, requireDiagnosticDiagnosis, requireDiagnosticRepairDelivery,
    requireDiagnosticVerification, requireDiagnosticPromotion
  } = ctx;

  return async function ${factoryName.replace(/^create/, "").replace(/Router$/, "Router").replace(/^./, (c) => c.toLowerCase()) === factoryName
    ? "route" : factoryName.replace("create", "").replace(/^[A-Z]/, (c) => c.toLowerCase())}(request, response, url) {
${body}

    return false;
  };
}
`;
}

// Fix the mangled function naming in routerSource - I'll rewrite that part cleanly
function buildRouter(fileTitle, exportName, handlerName, bucketBlocks) {
  const body = bucketBlocks.map((block) => withReturnTrue(block.lines).join("\n")).join("\n\n");
  return `/**
 * ${fileTitle} HTTP routes extracted from the Kernel composition root.
 * Handlers are unchanged; only module boundaries moved.
 */

import { KernelError } from "./errors.js";

/**
 * @param {any} ctx Composition-root services, config, and createRouteHelpers() result.
 * @returns {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, url: URL) => Promise<boolean>}
 */
export function ${exportName}(ctx) {
  const {
    database, identityIntent, grantAuthorityService, contextService, packageService,
    packageTrustService, deploymentService, upgradeService, handoffService, executionService,
    recoveryService, restoreService, effectService, environmentCoordination, supportService,
    diagnosticDatabase, diagnosticService, diagnosticRuntimeService, diagnosticReproductionService,
    diagnosticRepairWorkerService, diagnosticDiagnosisService, diagnosticRepairDeliveryService,
    diagnosticVerificationService, diagnosticPromotionService, diagnosticArtifactStore,
    diagnosticGrantApplicationService, diagnosticObservationService, diagnosticTokenizationProofService,
    diagnosticCorrelationService, diagnosticEffectEvaluationService, diagnosticEvidencePackageService,
    diagnosticIndependentVerificationService, diagnosticAssignmentService,
    diagnosticMaterialAvailabilityService, diagnosticDispatchService,
    diagnosticDispatchAuthorizationService, diagnosticWorkerExecutionService,
    diagnosticConsistencyService,
    installationId, environmentId, environmentName,
    grantAuthorityFeedToken, grantApplicationReceiptServiceToken, diagnosticTokenizationResultToken,
    dataPlaneReceiptSecret, dataPlaneId,
    diagnosticRuntimeAdapterId, diagnosticRuntimeAdapterVersion, diagnosticRuntimeAdapterKeyId,
    PROTOCOL_VERSION, DIAGNOSTIC_PROTOCOL_VERSION,
    listOperationDescriptors, getOperationDescriptor,
    listDiagnosticOperationDescriptors, getDiagnosticOperationDescriptor,
    getWorkflowRuntimeAdapterContract, getRepairDeliveryAdapterContract, getVerificationRunnerContract,
    validateCommandEnvelope, validateProfileUpdateCommand,
    canonicalize, sha256Digest, createHmac, createPublicKey,
    sendJson, sendHtml, readJson, sendCommandResult, pathId, requireRouteTaskMatch,
    serializeEnvironment, escapeHtml, observationAuthentication,
    authenticateBootstrapOperator, authenticateDiagnosticOwner, authenticatePrivateService,
    authenticateDataPlane, authenticateSubstrate, authenticateBroker, authenticateAgent,
    requireDiagnosticPlane, requireDiagnosticRuntime, requireDiagnosticReproduction,
    requireGrantAuthority, requireDiagnosticGrantApplication, requireDiagnosticObservation,
    requireDiagnosticTokenizationProof, requireDiagnosticCorrelation, requireDiagnosticEffectEvaluation,
    requireDiagnosticEvidencePackaging, requireDiagnosticMaterialAvailability, requireDiagnosticAssignment,
    requireDiagnosticDispatch, requireDiagnosticWorkerExecution, requireDiagnosticConsistency,
    requireDiagnosticDispatchAuthority, requireIndependentDiagnosticVerification,
    requireDiagnosticRepairWorker, requireDiagnosticDiagnosis, requireDiagnosticRepairDelivery,
    requireDiagnosticVerification, requireDiagnosticPromotion
  } = ctx;

  return async function ${handlerName}(request, response, url) {
${body}

    return false;
  };
}
`;
}

const newServerTail = `
import {
  createRouteHelpers, sendJson, writeError
} from "./http-helpers.js";
import { createKernelRouter } from "./kernel-router.js";
import { createDiagnosticRouter } from "./diagnostic-router.js";
import { createSupportRouter } from "./support-router.js";

const routeHelpers = createRouteHelpers({
  ownerToken, bootstrapPrincipalId, identityIntent,
  dataPlaneServiceToken, substrateServiceToken, brokerServiceToken,
  diagnosticService, diagnosticDatabase, diagnosticRuntimeService,
  diagnosticReproductionService, grantAuthorityService,
  diagnosticGrantApplicationService, diagnosticObservationService,
  diagnosticTokenizationProofService, diagnosticCorrelationService,
  diagnosticEffectEvaluationService, diagnosticEvidencePackageService,
  diagnosticMaterialAvailabilityService, diagnosticAssignmentService,
  diagnosticDispatchService, diagnosticWorkerExecutionService,
  diagnosticConsistencyService, diagnosticDispatchAuthorizationService,
  diagnosticIndependentVerificationService, diagnosticRepairWorkerService,
  diagnosticDiagnosisService, diagnosticRepairDeliveryService,
  diagnosticVerificationService, diagnosticPromotionService
});

const routeContext = {
  database, identityIntent, grantAuthorityService, contextService, packageService,
  packageTrustService, deploymentService, upgradeService, handoffService, executionService,
  recoveryService, restoreService, effectService, environmentCoordination, supportService,
  diagnosticDatabase, diagnosticService, diagnosticRuntimeService, diagnosticReproductionService,
  diagnosticRepairWorkerService, diagnosticDiagnosisService, diagnosticRepairDeliveryService,
  diagnosticVerificationService, diagnosticPromotionService, diagnosticArtifactStore,
  diagnosticGrantApplicationService, diagnosticObservationService, diagnosticTokenizationProofService,
  diagnosticCorrelationService, diagnosticEffectEvaluationService, diagnosticEvidencePackageService,
  diagnosticIndependentVerificationService, diagnosticAssignmentService,
  diagnosticMaterialAvailabilityService, diagnosticDispatchService,
  diagnosticDispatchAuthorizationService, diagnosticWorkerExecutionService,
  diagnosticConsistencyService,
  installationId, environmentId, environmentName,
  grantAuthorityFeedToken, grantApplicationReceiptServiceToken, diagnosticTokenizationResultToken,
  dataPlaneReceiptSecret, dataPlaneId,
  diagnosticRuntimeAdapterId, diagnosticRuntimeAdapterVersion, diagnosticRuntimeAdapterKeyId,
  PROTOCOL_VERSION, DIAGNOSTIC_PROTOCOL_VERSION,
  listOperationDescriptors, getOperationDescriptor,
  listDiagnosticOperationDescriptors, getDiagnosticOperationDescriptor,
  getWorkflowRuntimeAdapterContract, getRepairDeliveryAdapterContract, getVerificationRunnerContract,
  validateCommandEnvelope, validateProfileUpdateCommand,
  canonicalize, sha256Digest, createHmac, createPublicKey,
  ...routeHelpers
};

const kernelRouter = createKernelRouter(routeContext);
const diagnosticRouter = createDiagnosticRouter(routeContext);
const supportRouter = createSupportRouter(routeContext);

async function route(request, response) {
  const url = new URL(request.url, \`http://\${request.headers.host ?? "localhost"}\`);
  if (await kernelRouter(request, response, url)) return;
  if (await diagnosticRouter(request, response, url)) return;
  if (await supportRouter(request, response, url)) return;
  throw new KernelError(404, "ROUTE_NOT_FOUND", "Route does not exist.");
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => writeError(response, error, CoordinationContractError));
});

server.listen(port, "0.0.0.0", () => {
  console.log(\`Alphonse Kernel \${PROTOCOL_VERSION} listening on \${port}\`);
});

async function shutdown(signal) {
  console.log(\`Received \${signal}; shutting down.\`);
  server.close(async () => {
    if (diagnosticDatabase) await diagnosticDatabase.close();
    await database.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
`;

// Strip unused crypto timingSafeEqual from server imports if only helpers needed it —
// server still imports createHmac, createPublicKey from node:crypto for routeContext.
let compositionFixed = composition;
if (!compositionFixed.includes('from "node:crypto"')) {
  // keep
}

writeFileSync(path.join(root, "src", "http-helpers.js"), httpHelpers);
writeFileSync(path.join(root, "src", "kernel-router.js"),
  buildRouter("Kernel", "createKernelRouter", "kernelRouter", buckets.kernel));
writeFileSync(path.join(root, "src", "diagnostic-router.js"),
  buildRouter("Diagnostic Plane", "createDiagnosticRouter", "diagnosticRouter", buckets.diagnostic));
writeFileSync(path.join(root, "src", "support-router.js"),
  buildRouter("Support / internal / Butler", "createSupportRouter", "supportRouter", buckets.support));

// Composition root: drop timingSafeEqual if only used by helpers; keep createHmac, createPublicKey
compositionFixed = compositionFixed.replace(
  'import { createHmac, createPublicKey, timingSafeEqual } from "node:crypto";',
  'import { createHmac, createPublicKey } from "node:crypto";'
);
// Drop authorizeTrustedOperator / directOwnerActor from server — now only in http-helpers
compositionFixed = compositionFixed.replace(
  '\nimport { authorizeTrustedOperator, directOwnerActor } from "./trusted-operator.js";',
  ""
);

writeFileSync(serverPath, `${compositionFixed}\n${newServerTail}`);
console.log("Wrote http-helpers.js, kernel-router.js, diagnostic-router.js, support-router.js, and slimmed server.js");
console.log(`server.js lines: ${readFileSync(serverPath, "utf8").split(/\r?\n/).length}`);
