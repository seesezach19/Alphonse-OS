import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";

const AUTHORITY = Object.freeze({
  capability: "not_granted",
  execution: "not_granted",
  effect: "not_granted",
  promotion: "not_granted"
});

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_INPUT", `${field} must be an object.`);
  }
  return value;
}

function exactKeys(value, field, keys) {
  const item = object(value, field);
  const expected = new Set(keys);
  const unexpected = Object.keys(item).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !Object.hasOwn(item, key));
  if (unexpected.length || missing.length) {
    throw new KernelError(400, "INVALID_INPUT", `${field} has invalid fields.`, { missing, unexpected });
  }
  return item;
}

function string(value, field, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new KernelError(400, "INVALID_INPUT", `${field} must contain 1 to ${max} characters.`);
  }
  return value.trim();
}

function digest(value, field) {
  const result = string(value, field, 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) {
    throw new KernelError(400, "INVALID_INPUT", `${field} must be an exact SHA-256 digest.`);
  }
  return result;
}

function safeValue(value, field, maxBytes = 256 * 1024) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new KernelError(400, "INVALID_INPUT", `${field} exceeds its size limit.`);
  }
  const pending = [{ item: value, path: field, depth: 0 }];
  while (pending.length) {
    const { item, path, depth } = pending.pop();
    if (!item || typeof item !== "object") continue;
    if (depth > 32) {
      throw new KernelError(400, "INVALID_INPUT", `${field} exceeds its nesting limit.`);
    }
    for (const [key, nested] of Object.entries(item)) {
      if (/(^|_)(secret|password|token|api[_-]?key|private[_-]?key|credential|auth|authorization|cookie|dsn|connection[_-]?string)($|_)/i.test(key)) {
        throw new KernelError(400, "SENSITIVE_METADATA_REJECTED", `${path}.${key} may contain secret material.`);
      }
      pending.push({ item: nested, path: `${path}.${key}`, depth: depth + 1 });
    }
  }
  return value;
}

function validateEnvelope(value, operationId) {
  exactKeys(value, "command", ["command_id", "operation_id", "input"]);
  const commandId = string(value.command_id, "command_id", 160);
  if (value.operation_id !== operationId) {
    throw new KernelError(400, "UNSUPPORTED_OPERATION", `operation_id must be ${operationId}.`);
  }
  return { command_id: commandId, operation_id: operationId, input: object(value.input, "input") };
}

function validateWorkflowCommand(value) {
  const envelope = validateEnvelope(value, "diagnostic.agent_workflow.register");
  const input = exactKeys(envelope.input, "input", ["workflow_id", "display_name", "objective", "external_ref"]);
  const workflowId = string(input.workflow_id, "input.workflow_id", 160);
  if (!/^[a-z][a-z0-9._:-]{2,159}$/.test(workflowId)) {
    throw new KernelError(400, "INVALID_INPUT", "input.workflow_id must be a stable lowercase namespaced identifier.");
  }
  const externalRef = exactKeys(input.external_ref, "input.external_ref", ["system", "workflow_key", "environment"]);
  return {
    ...envelope,
    input: {
      workflow_id: workflowId,
      display_name: string(input.display_name, "input.display_name", 120),
      objective: string(input.objective, "input.objective", 1000),
      external_ref: safeValue({
        system: string(externalRef.system, "input.external_ref.system", 80),
        workflow_key: string(externalRef.workflow_key, "input.external_ref.workflow_key", 200),
        environment: string(externalRef.environment, "input.external_ref.environment", 80)
      }, "input.external_ref", 4096)
    }
  };
}

function validateRevisionCommand(value) {
  const envelope = validateEnvelope(value, "diagnostic.agent_revision.register");
  const input = exactKeys(envelope.input, "input", [
    "workflow_id", "workflow_content", "runtime", "nodes", "model", "configuration", "adapter"
  ]);
  const runtime = exactKeys(input.runtime, "input.runtime", ["runtime_id", "runtime_version", "image_digest"]);
  const model = exactKeys(input.model, "input.model", ["provider", "model", "version"]);
  const adapter = exactKeys(input.adapter, "input.adapter", [
    "adapter_id", "adapter_version", "fingerprint_rules_digest"
  ]);
  if (!Array.isArray(input.nodes) || input.nodes.length === 0 || input.nodes.length > 500) {
    throw new KernelError(400, "INVALID_INPUT", "input.nodes must contain 1 to 500 node fingerprints.");
  }
  const nodes = input.nodes.map((node, index) => {
    const exact = exactKeys(node, `input.nodes[${index}]`, ["node_type", "node_version"]);
    return {
      node_type: string(exact.node_type, `input.nodes[${index}].node_type`, 200),
      node_version: string(exact.node_version, `input.nodes[${index}].node_version`, 100)
    };
  });
  return {
    ...envelope,
    input: safeValue({
      workflow_id: string(input.workflow_id, "input.workflow_id", 160),
      workflow_content: object(input.workflow_content, "input.workflow_content"),
      runtime: {
        runtime_id: string(runtime.runtime_id, "input.runtime.runtime_id", 100),
        runtime_version: string(runtime.runtime_version, "input.runtime.runtime_version", 100),
        image_digest: digest(runtime.image_digest, "input.runtime.image_digest")
      },
      nodes,
      model: {
        provider: string(model.provider, "input.model.provider", 100),
        model: string(model.model, "input.model.model", 160),
        version: string(model.version, "input.model.version", 160)
      },
      configuration: object(input.configuration, "input.configuration"),
      adapter: {
        adapter_id: string(adapter.adapter_id, "input.adapter.adapter_id", 160),
        adapter_version: string(adapter.adapter_version, "input.adapter.adapter_version", 100),
        fingerprint_rules_digest: digest(adapter.fingerprint_rules_digest,
          "input.adapter.fingerprint_rules_digest")
      }
    }, "input")
  };
}

function workflowView(row) {
  return {
    workflow_id: row.workflow_id,
    display_name: row.display_name,
    objective: row.objective,
    external_ref: row.external_ref,
    identity_digest: row.identity_digest,
    created_by: { type: row.created_by_actor_type, id: row.created_by_actor_id },
    created_at: row.created_at,
    authority: { ...AUTHORITY },
    immutable: true
  };
}

function revisionView(row) {
  return {
    revision_id: row.revision_id,
    workflow_id: row.workflow_id,
    material_digest: row.material_digest,
    snapshot_digest: row.snapshot_digest,
    runtime: row.runtime,
    nodes: row.nodes,
    model: row.model,
    configuration: row.configuration,
    adapter: row.adapter,
    created_by: { type: row.created_by_actor_type, id: row.created_by_actor_id },
    created_at: row.created_at,
    authority: { ...AUTHORITY },
    immutable: true
  };
}

export function createDiagnosticService(database, artifactStore, installationId) {
  const { pool, executeCommand } = database;

  function requestDigest(command) {
    return sha256Digest({ installation_id: installationId, ...command });
  }

  async function getWorkflow(workflowId, client = pool) {
    const result = await client.query(
      `SELECT * FROM diagnostic_agent_workflows
       WHERE installation_id=$1 AND workflow_id=$2`, [installationId, workflowId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "AGENT_WORKFLOW_NOT_FOUND", "Agent Workflow does not exist.");
    }
    return workflowView(result.rows[0]);
  }

  async function getRevision(revisionId, client = pool) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revisionId)) {
      throw new KernelError(400, "INVALID_IDENTIFIER", "revision_id must be a UUID.");
    }
    const result = await client.query(
      `SELECT * FROM diagnostic_agent_revisions
       WHERE installation_id=$1 AND revision_id=$2`, [installationId, revisionId]
    );
    if (!result.rows[0]) {
      throw new KernelError(404, "AGENT_REVISION_NOT_FOUND", "Agent Revision does not exist.");
    }
    return revisionView(result.rows[0]);
  }

  async function registerWorkflow(value, actor) {
    const envelope = validateWorkflowCommand(value);
    const command = { ...envelope, actor };
    const identityDigest = sha256Digest(envelope.input);
    return executeCommand({
      installationId,
      command,
      requestDigest: requestDigest(command),
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:workflow:${envelope.input.workflow_id}`
        ]);
        const existing = await client.query(
          `SELECT * FROM diagnostic_agent_workflows
           WHERE installation_id=$1 AND workflow_id=$2 FOR SHARE`,
          [installationId, envelope.input.workflow_id]
        );
        if (existing.rows[0] && existing.rows[0].identity_digest !== identityDigest) {
          throw new KernelError(409, "WORKFLOW_IDENTITY_CONFLICT",
            "Workflow ID is already bound to different immutable identity material.", {
              workflow_id: envelope.input.workflow_id,
              accepted_identity_digest: existing.rows[0].identity_digest,
              received_identity_digest: identityDigest
            });
        }
        let row = existing.rows[0];
        if (!row) {
          const inserted = await client.query(
            `INSERT INTO diagnostic_agent_workflows
              (installation_id,workflow_id,display_name,objective,external_ref,identity_digest,
               created_by_actor_type,created_by_actor_id,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [installationId, envelope.input.workflow_id, envelope.input.display_name, envelope.input.objective,
              envelope.input.external_ref, identityDigest, actor.type, actor.id, acceptedAt]
          );
          row = inserted.rows[0];
        }
        const created = existing.rowCount === 0;
        return {
          aggregateType: "agent_workflow",
          aggregateId: envelope.input.workflow_id,
          transitionType: created ? "diagnostic.agent_workflow.registered" : "diagnostic.agent_workflow.reused",
          fromRevision: created ? 0 : 1,
          toRevision: 1,
          transitionPayload: { identity_digest: identityDigest, created },
          result: { agent_workflow: workflowView(row), created }
        };
      }
    });
  }

  async function registerRevision(value, actor) {
    const envelope = validateRevisionCommand(value);
    const command = { ...envelope, actor };
    const material = envelope.input;
    const materialDigest = sha256Digest(material);
    return executeCommand({
      installationId,
      command,
      requestDigest: requestDigest(command),
      apply: async (client, { acceptedAt }) => {
        await getWorkflow(material.workflow_id, client);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${installationId}:revision:${materialDigest}`
        ]);
        const artifact = await artifactStore.putJson(material);
        const existing = await client.query(
          `SELECT * FROM diagnostic_agent_revisions
           WHERE installation_id=$1 AND material_digest=$2 FOR SHARE`,
          [installationId, materialDigest]
        );
        let row = existing.rows[0];
        if (!row) {
          await client.query(
            `INSERT INTO diagnostic_artifacts
              (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
            [installationId, artifact.artifact_digest, artifact.size_bytes, artifact.media_type,
              artifact.storage_key, acceptedAt]
          );
          const inserted = await client.query(
            `INSERT INTO diagnostic_agent_revisions
              (revision_id,installation_id,workflow_id,material_digest,snapshot_digest,runtime,nodes,model,
               configuration,adapter,created_by_actor_type,created_by_actor_id,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [randomUUID(), installationId, material.workflow_id, materialDigest, artifact.artifact_digest,
              material.runtime, JSON.stringify(material.nodes), material.model, material.configuration, material.adapter,
              actor.type, actor.id, acceptedAt]
          );
          row = inserted.rows[0];
        }
        const created = existing.rowCount === 0;
        return {
          aggregateType: "agent_revision",
          aggregateId: row.revision_id,
          transitionType: created ? "diagnostic.agent_revision.registered" : "diagnostic.agent_revision.reused",
          fromRevision: created ? 0 : 1,
          toRevision: 1,
          transitionPayload: {
            workflow_id: material.workflow_id,
            material_digest: materialDigest,
            snapshot_digest: artifact.artifact_digest,
            created
          },
          result: { agent_revision: revisionView(row), created }
        };
      }
    });
  }

  async function getArtifact(artifactDigest) {
    const result = await pool.query(
      `SELECT * FROM diagnostic_artifacts
       WHERE installation_id=$1 AND artifact_digest=$2`, [installationId, artifactDigest]
    );
    if (!result.rows[0]) throw new KernelError(404, "ARTIFACT_NOT_FOUND", "Artifact does not exist.");
    const stored = await artifactStore.getJson(artifactDigest);
    const row = result.rows[0];
    if (String(row.size_bytes) !== String(stored.artifact.size_bytes) || row.storage_key !== stored.artifact.storage_key) {
      throw new KernelError(409, "ARTIFACT_METADATA_MISMATCH", "Artifact metadata does not match verified bytes.");
    }
    return {
      artifact_digest: artifactDigest,
      size_bytes: String(row.size_bytes),
      media_type: row.media_type,
      verified: true,
      content: stored.content
    };
  }

  return { getArtifact, getRevision, getWorkflow, registerRevision, registerWorkflow };
}
