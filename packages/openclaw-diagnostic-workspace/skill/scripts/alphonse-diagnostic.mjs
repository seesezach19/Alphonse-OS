import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ANALYSIS_KEYS = Object.freeze([
  "facts", "inferences", "hypotheses", "uncertainties", "recommended_investigation",
  "artifact_references"
]);
const SENSITIVE_KEY = /(secret|password|token|credential|private[_-]?key|authorization|cookie)/i;
const CONFIDENCE = new Set(["low", "medium", "high"]);

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function exactKeys(value, expected, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalize(actual) !== canonicalize(wanted)) {
    throw new Error(`${field} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function rejectSensitiveKeys(value, field = "analysis", depth = 0) {
  if (depth > 24) throw new Error(`${field} exceeds maximum nesting depth.`);
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new Error(`${field}.${key} contains credential-like material.`);
    rejectSensitiveKeys(nested, `${field}.${key}`, depth + 1);
  }
}

function validateAnalysis(analysis) {
  exactKeys(analysis, ANALYSIS_KEYS, "analysis");
  rejectSensitiveKeys(analysis);
  for (const key of ANALYSIS_KEYS) {
    if (!Array.isArray(analysis[key])) throw new Error(`analysis.${key} must be an array.`);
  }
  if (analysis.facts.length < 1) throw new Error("analysis.facts requires at least one source-backed fact.");
  for (const hypothesis of analysis.hypotheses) {
    if (!CONFIDENCE.has(hypothesis?.confidence)) {
      throw new Error("Each hypothesis confidence must be low, medium, or high.");
    }
  }
  return structuredClone(analysis);
}

export function buildDiagnosis(workspace, analysis, environment = process.env) {
  const checked = validateAnalysis(analysis);
  const request = workspace?.diagnosis_request;
  if (!request) throw new Error("Workspace is missing diagnosis_request.");
  const inputDigests = request.input_artifact_digests;
  if (!Array.isArray(inputDigests) || inputDigests.length < 1) {
    throw new Error("Workspace is missing input artifact digests.");
  }
  return {
    ...checked,
    provenance: {
      model: {
        provider: environment.ALPHONSE_MODEL_PROVIDER ?? "openclaw-customer-controlled",
        model: environment.ALPHONSE_MODEL_ID ?? "openclaw/default",
        version: environment.ALPHONSE_MODEL_VERSION ?? "unversioned"
      },
      runtime: {
        name: "openclaw",
        version: environment.OPENCLAW_VERSION ?? "unknown"
      },
      instruction_digest: required(request.instruction_digest, "diagnosis_request.instruction_digest"),
      input_artifact_digests: [...inputDigests]
    }
  };
}

export function stableCommandId(prefix, material) {
  const digest = createHash("sha256").update(canonicalize(material)).digest("hex").slice(0, 32);
  return `openclaw-${prefix}-${digest}`;
}

function parseEnvironmentFile(content) {
  const allowed = new Set([
    "ALPHONSE_URL", "ALPHONSE_AGENT_TOKEN", "ALPHONSE_DIAGNOSIS_REQUEST_ID",
    "ALPHONSE_MODEL_PROVIDER", "ALPHONSE_MODEL_ID", "ALPHONSE_MODEL_VERSION", "OPENCLAW_VERSION"
  ]);
  const parsed = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("Alphonse connection file contains an invalid line.");
    const key = line.slice(0, separator).trim();
    if (!allowed.has(key)) throw new Error(`Alphonse connection file contains unsupported key ${key}.`);
    parsed[key] = line.slice(separator + 1);
  }
  return parsed;
}

export async function loadConnectionEnvironment(environment = process.env) {
  if (environment.ALPHONSE_URL && environment.ALPHONSE_AGENT_TOKEN &&
      environment.ALPHONSE_DIAGNOSIS_REQUEST_ID) return { ...environment };
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const connectionFile = environment.ALPHONSE_CONNECTION_FILE
    ?? path.join(workspaceRoot, ".alphonse", "diagnostic.env");
  let content;
  try {
    content = await readFile(connectionFile, "utf8");
  } catch {
    throw new Error(`Assigned Alphonse connection is unavailable at ${connectionFile}. ` +
      "Do not use Owner or bootstrap credentials as a fallback.");
  }
  return { ...parseEnvironmentFile(content), ...environment };
}

async function configuration(environment = process.env) {
  const loaded = await loadConnectionEnvironment(environment);
  return {
    baseUrl: required(loaded.ALPHONSE_URL, "ALPHONSE_URL").replace(/\/$/, ""),
    token: required(loaded.ALPHONSE_AGENT_TOKEN, "ALPHONSE_AGENT_TOKEN"),
    requestId: required(loaded.ALPHONSE_DIAGNOSIS_REQUEST_ID, "ALPHONSE_DIAGNOSIS_REQUEST_ID")
  };
}

async function request(path, { method = "GET", body } = {}) {
  const config = await configuration();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Agent ${config.token}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    const message = payload?.error?.message ?? "Alphonse request failed.";
    throw new Error(`${code}: ${message}`);
  }
  return payload;
}

async function getWorkspace(requestId) {
  return request(`/diagnostic/v0/diagnosis-requests/${encodeURIComponent(requestId)}/workspace`);
}

async function main() {
  const [command, argument, requestOverride] = process.argv.slice(2);
  const config = await configuration();
  const requestId = requestOverride ?? config.requestId;
  if (command === "workspace") {
    process.stdout.write(`${JSON.stringify(await getWorkspace(argument ?? requestId), null, 2)}\n`);
    return;
  }
  if (command === "submit") {
    if (!argument) throw new Error("Usage: alphonse-diagnostic.mjs submit <analysis-json-file> [request-id]");
    const workspace = await getWorkspace(requestId);
    const analysis = JSON.parse(await readFile(argument, "utf8"));
    const diagnosis = buildDiagnosis(workspace, analysis);
    const envelope = {
      command_id: stableCommandId("diagnosis", { requestId, diagnosis }),
      operation_id: "diagnostic.diagnosis_proposal.submit",
      input: { request_id: requestId, diagnosis }
    };
    process.stdout.write(`${JSON.stringify(await request("/diagnostic/v0/diagnosis-proposals", {
      method: "POST", body: envelope
    }), null, 2)}\n`);
    return;
  }
  if (command === "fail") {
    const reason = required(argument, "failure reason");
    const envelope = {
      command_id: stableCommandId("diagnosis-failure", { requestId, reason }),
      operation_id: "diagnostic.diagnosis_request.fail",
      input: { request_id: requestId, reason }
    };
    process.stdout.write(`${JSON.stringify(await request(
      `/diagnostic/v0/diagnosis-requests/${encodeURIComponent(requestId)}/fail`,
      { method: "POST", body: envelope }
    ), null, 2)}\n`);
    return;
  }
  throw new Error("Usage: alphonse-diagnostic.mjs <workspace|submit|fail> [argument] [request-id]");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown diagnostic client error."}\n`);
    process.exitCode = 1;
  });
}
