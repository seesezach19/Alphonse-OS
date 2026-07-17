import { readFile, rename, writeFile } from "node:fs/promises";

import { createN8nReadinessBinding } from "./canonical-n8n-runtime.js";

const required = ["N8N_API_URL", "N8N_API_KEY", "N8N_PROVIDER_WORKFLOW_ID", "ALPHONSE_WORKFLOW_ID",
  "ALPHONSE_REVISION_ID", "ALPHONSE_REPORTING_GRANT_ID", "KERNEL_API_URL", "KERNEL_READ_TOKEN",
  "N8N_READINESS_EXECUTION_ID", "N8N_RUNTIME_IDENTITY", "N8N_NODE_METADATA_PATH", "N8N_BINDING_PATH"];
for (const field of required) if (!process.env[field]) throw new Error(`${field} is required.`);

async function readJson(url, headers, label, unwrapData = true) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}.`);
  const body = await response.json();
  return unwrapData ? body.data ?? body : body;
}
const n8nHeaders = { "x-n8n-api-key": process.env.N8N_API_KEY };
const kernelHeaders = { authorization: `Bearer ${process.env.KERNEL_READ_TOKEN}` };
const workflow = await readJson(`${process.env.N8N_API_URL}/api/v1/workflows/${encodeURIComponent(
  process.env.N8N_PROVIDER_WORKFLOW_ID)}`, n8nHeaders, "Published workflow read");
const executionProbe = await readJson(`${process.env.N8N_API_URL}/api/v1/executions/${encodeURIComponent(
  process.env.N8N_READINESS_EXECUTION_ID)}?includeData=true`, n8nHeaders, "Retained execution detail read", false);
const revisionResponse = await readJson(`${process.env.KERNEL_API_URL}/diagnostic/v0/agent-revisions/${encodeURIComponent(
  process.env.ALPHONSE_REVISION_ID)}`, kernelHeaders, "Registered Agent Revision read");
const revision = revisionResponse.agent_revision ?? revisionResponse;
const artifactResponse = await readJson(`${process.env.KERNEL_API_URL}/diagnostic/v0/artifacts/${encodeURIComponent(
  revision.snapshot_digest)}`, kernelHeaders, "Registered Agent Revision material read");
const artifact = artifactResponse.artifact ?? artifactResponse;
if (artifact.verified !== true || artifact.artifact_digest !== revision.snapshot_digest) {
  throw new Error("Registered Agent Revision material is not digest-verified.");
}
const metadata = JSON.parse(await readFile(process.env.N8N_NODE_METADATA_PATH, "utf8"));
const binding = createN8nReadinessBinding({ workflow, metadata,
  revision_id: process.env.ALPHONSE_REVISION_ID, workflow_id: process.env.ALPHONSE_WORKFLOW_ID,
  revision_material: artifact.content, execution_probe: executionProbe,
  runtime_identity: JSON.parse(process.env.N8N_RUNTIME_IDENTITY) });
const record = { ...binding, readiness_created_at: new Date().toISOString(),
  reporting_grant_id: process.env.ALPHONSE_REPORTING_GRANT_ID,
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
