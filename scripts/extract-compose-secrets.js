/**
 * Convert hardcoded local secrets in compose.yaml to ${ENV:-default} form
 * and emit .env.example. Distinct values of a colliding key get unique env names;
 * shared values keep one shared name.
 */
import { readFileSync, writeFileSync } from "node:fs";

const composePath = new URL("../compose.yaml", import.meta.url);
const lines = readFileSync(composePath, "utf8").split(/\n/);
/** @type {Map<string, string>} */
const defaults = new Map();
/** @type {Map<string, Set<string>>} */
const valueSets = new Map();
/** @type {Map<string, Map<string, string>>} */
const envNamesByKeyValue = new Map();

const nonServiceKeys = new Set([
  "services", "networks", "volumes", "configs", "secrets", "name", "include", "extensions"
]);

function isSecretLine(key, value) {
  if (value.startsWith("${")) return false;
  if (key.includes("PRIVATE_KEY")) return true;
  if (/(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|CREDENTIAL)$/.test(key)) return true;
  if (/^(local-|MC4CAQAw|ed25519-)/.test(value)) return true;
  return false;
}

for (const line of lines) {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]+):\s*(.+?)\s*$/);
  if (!match) continue;
  const [, key, value] = match;
  if (!isSecretLine(key, value)) continue;
  if (!valueSets.has(key)) valueSets.set(key, new Set());
  valueSets.get(key).add(value);
}

function envNameFor(service, key, value) {
  const values = valueSets.get(key);
  if (!values || values.size <= 1) return key;
  if (!envNamesByKeyValue.has(key)) envNamesByKeyValue.set(key, new Map());
  const byValue = envNamesByKeyValue.get(key);
  if (byValue.has(value)) return byValue.get(value);
  if (byValue.size === 0) {
    byValue.set(value, key);
    return key;
  }
  const slug = service.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase();
  const name = `${slug}_${key}`;
  byValue.set(value, name);
  return name;
}

function remember(name, value) {
  defaults.set(name, value);
}

function rewriteDatabaseUrl(value, service) {
  const patterns = [
    ["alphonse_diagnostic", "DIAGNOSTIC_DATABASE_PASSWORD"],
    ["alphonse_tokenization", "TOKENIZATION_DATABASE_PASSWORD"],
    ["alphonse_ingress", "INGRESS_DATABASE_PASSWORD"],
    ["alphonse_crm", "CRM_DATABASE_PASSWORD"],
    ["alphonse", "POSTGRES_PASSWORD"]
  ];
  let next = value;
  for (const [user, baseKey] of patterns) {
    const regex = new RegExp(`postgresql://${user}:([^@]+)@`);
    next = next.replace(regex, (_m, password) => {
      const envName = envNameFor(service, baseKey, password);
      remember(envName, password);
      return `postgresql://${user}:\${${envName}:-${password}}@`;
    });
  }
  return next;
}

let inServices = false;
let currentService = "root";
const out = [];
for (const line of lines) {
  if (/^services:\s*$/.test(line)) {
    inServices = true;
    out.push(line);
    continue;
  }
  if (/^(networks|volumes|configs|secrets):\s*$/.test(line)) {
    inServices = false;
  }
  if (inServices && /^  [a-z0-9-]+:\s*$/.test(line)) {
    const name = line.trim().replace(":", "");
    if (!nonServiceKeys.has(name)) currentService = name;
  }

  const match = line.match(/^(\s*)([A-Z][A-Z0-9_]+):\s*(.+?)\s*$/);
  if (!match) {
    out.push(line);
    continue;
  }
  const [, indent, key, value] = match;

  if (value.startsWith("postgresql://") && !value.includes("${")) {
    out.push(`${indent}${key}: ${rewriteDatabaseUrl(value, currentService)}`);
    continue;
  }

  if (!isSecretLine(key, value)) {
    out.push(line);
    continue;
  }

  if (key.endsWith("_KEY_ID") && !key.includes("PRIVATE") && !value.startsWith("local-")) {
    out.push(line);
    continue;
  }

  const envName = envNameFor(currentService, key, value);
  remember(envName, value);
  out.push(`${indent}${key}: \${${envName}:-${value}}`);
}

writeFileSync(composePath, out.join("\n"));
const example = [
  "# Local-development defaults for docker compose.",
  "# Copy to .env to override. Compose falls back to :-defaults inline in compose.yaml.",
  "# Values are intentionally non-production.",
  "",
  ...[...defaults.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`),
  ""
].join("\n");
writeFileSync(new URL("../.env.example", import.meta.url), example);
console.log(`Wrote ${defaults.size} defaults to .env.example`);
