import { readFile } from "node:fs/promises";

import { signRuntimeEventEnvelope } from "./runtime-event-envelope.js";

const [command, argument] = process.argv.slice(2);
const baseUrl = (process.env.ALPHONSE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const token = process.env.ALPHONSE_TOKEN;

const commands = {
  bootstrap: { method: "GET", path: "/diagnostic/v0/bootstrap", auth: false },
  operations: { method: "GET", path: "/diagnostic/v0/operations", auth: false },
  "adapter-contract": { method: "GET", path: "/diagnostic/v0/runtime-adapter-contract", auth: false },
  "register-workflow": { method: "POST", path: "/diagnostic/v0/agent-workflows", file: true },
  "register-revision": { method: "POST", path: "/diagnostic/v0/agent-revisions", file: true },
  "get-workflow": { method: "GET", path: `/diagnostic/v0/agent-workflows/${encodeURIComponent(argument ?? "")}` },
  "get-revision": { method: "GET", path: `/diagnostic/v0/agent-revisions/${encodeURIComponent(argument ?? "")}` },
  "get-artifact": { method: "GET", path: `/diagnostic/v0/artifacts/${encodeURIComponent(argument ?? "")}` },
  "receive-event": { method: "POST", path: "/diagnostic/v0/runtime-events", file: true, runtimeAuth: true },
  "get-trace": { method: "GET", path: `/diagnostic/v0/external-activity-traces/${encodeURIComponent(argument ?? "")}` },
  "get-event-conflict": { method: "GET", path: `/diagnostic/v0/runtime-event-conflicts/${encodeURIComponent(argument ?? "")}` }
};

function usage() {
  return [
    "Usage: node src/diagnostic-cli.js <command> [argument]",
    "Commands:",
    "  bootstrap",
    "  operations",
    "  adapter-contract",
    "  register-workflow <command-json-file>",
    "  register-revision <command-json-file>",
    "  get-workflow <workflow-id>",
    "  get-revision <revision-id>",
    "  get-artifact <sha256-digest>",
    "  receive-event <envelope-json-file>",
    "  get-trace <trace-id>",
    "  get-event-conflict <conflict-id>",
    "Environment: ALPHONSE_URL, ALPHONSE_TOKEN",
    "Runtime event: ALPHONSE_RUNTIME_ADAPTER_KEY_ID, ALPHONSE_RUNTIME_ADAPTER_SECRET"
  ].join("\n");
}

const selected = commands[command];
if (!selected || (selected.file && !argument) || (!selected.file && selected.auth !== false && !argument)) {
  console.error(usage());
  process.exit(2);
}
if (selected.auth !== false && !selected.runtimeAuth && !token) {
  console.error("ALPHONSE_TOKEN is required for this command.");
  process.exit(2);
}

const headers = { accept: "application/json" };
if (selected.auth !== false && !selected.runtimeAuth) headers.authorization = `Bearer ${token}`;
const options = { method: selected.method, headers };
if (selected.file) {
  headers["content-type"] = "application/json";
  const fileBody = await readFile(argument, "utf8");
  if (selected.runtimeAuth) {
    const keyId = process.env.ALPHONSE_RUNTIME_ADAPTER_KEY_ID;
    const secret = process.env.ALPHONSE_RUNTIME_ADAPTER_SECRET;
    if (!keyId || !secret) {
      console.error("ALPHONSE_RUNTIME_ADAPTER_KEY_ID and ALPHONSE_RUNTIME_ADAPTER_SECRET are required.");
      process.exit(2);
    }
    const envelope = JSON.parse(fileBody);
    const authentication = signRuntimeEventEnvelope(envelope, {
      keyId,
      secret,
      signedAt: process.env.ALPHONSE_RUNTIME_SIGNED_AT ?? new Date().toISOString()
    });
    headers["x-alphonse-runtime-key-id"] = authentication.key_id;
    headers["x-alphonse-runtime-signed-at"] = authentication.signed_at;
    headers["x-alphonse-runtime-signature"] = authentication.signature;
    options.body = JSON.stringify(envelope);
  } else {
    options.body = fileBody;
  }
}

const response = await fetch(`${baseUrl}${selected.path}`, options);
const body = await response.json();
process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
if (!response.ok) process.exit(1);
