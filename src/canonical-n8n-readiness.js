import { readFile, rename, writeFile } from "node:fs/promises";

import { createN8nReadinessBinding } from "./canonical-n8n-runtime.js";

const required = ["N8N_API_URL", "N8N_API_KEY", "N8N_PROVIDER_WORKFLOW_ID", "ALPHONSE_WORKFLOW_ID",
  "ALPHONSE_REVISION_ID", "N8N_RUNTIME_IMAGE_DIGEST", "N8N_NODE_METADATA_PATH", "N8N_BINDING_PATH"];
for (const field of required) if (!process.env[field]) throw new Error(`${field} is required.`);

const response = await fetch(`${process.env.N8N_API_URL}/api/v1/workflows/${encodeURIComponent(
  process.env.N8N_PROVIDER_WORKFLOW_ID)}`, { headers: { "x-n8n-api-key": process.env.N8N_API_KEY } });
if (!response.ok) throw new Error(`Published workflow read failed with HTTP ${response.status}.`);
const body = await response.json();
const workflow = body.data ?? body;
const metadata = JSON.parse(await readFile(process.env.N8N_NODE_METADATA_PATH, "utf8"));
const binding = createN8nReadinessBinding({ workflow, metadata,
  revision_id: process.env.ALPHONSE_REVISION_ID, workflow_id: process.env.ALPHONSE_WORKFLOW_ID,
  runtime_image_digest: process.env.N8N_RUNTIME_IMAGE_DIGEST,
  scopes: String(process.env.N8N_READ_ONLY_SCOPES ?? "").split(",").filter(Boolean),
  successful_execution_retention: process.env.N8N_SUCCESS_EXECUTION_RETENTION === "true" });
const record = { ...binding, readiness_created_at: new Date().toISOString(),
  expected_identity_source: "pre_execution_published_workflow_read", execution_derived_expected_identity: false };
try {
  const existing = JSON.parse(await readFile(process.env.N8N_BINDING_PATH, "utf8"));
  if (existing.binding_digest !== binding.binding_digest) {
    throw new Error("A different immutable pre-execution binding already exists.");
  }
  process.stdout.write(`${JSON.stringify({ ...existing, replayed: true })}\n`);
  process.exit(0);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const temporary = `${process.env.N8N_BINDING_PATH}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
await rename(temporary, process.env.N8N_BINDING_PATH);
process.stdout.write(`${JSON.stringify(record)}\n`);
