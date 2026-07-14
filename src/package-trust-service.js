import { randomUUID } from "node:crypto";

import { sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import { PortableTrustError, verifyImportBundle } from "./portable-trust.js";

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_INPUT", `${label} must be an object.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new KernelError(400, "INVALID_INPUT", `${label} must be a non-empty string.`);
  }
  return value;
}

function validatePolicy(policy) {
  object(policy, "Trust Policy");
  if (policy.schema_version !== "alphonse.trust_policy.v0.1") {
    throw new KernelError(400, "UNSUPPORTED_TRUST_POLICY", "Trust Policy schema is unsupported.");
  }
  string(policy.policy_id, "policy_id");
  if (!Number.isSafeInteger(policy.version) || policy.version < 1) {
    throw new KernelError(400, "INVALID_TRUST_POLICY", "Trust Policy version must be a positive integer.");
  }
  string(policy.environment_class, "environment_class");
  for (const field of ["allowed_registries", "pinned_publishers", "allowed_risk_classes",
    "required_attestation_types", "trusted_attesters", "allowed_export_kinds", "allowed_licenses",
    "allowed_kernel_api_compatibility", "allowed_effect_classes", "allowed_context_classes",
    "allowed_credential_classes", "allowed_network_classes"]) {
    if (!Array.isArray(policy[field])) throw new KernelError(400, "INVALID_TRUST_POLICY", `${field} must be an array.`);
  }
  object(policy.advisory_responses, "advisory_responses");
  string(policy.risk_classification_attestation_type, "risk_classification_attestation_type");
  if (!Number.isSafeInteger(policy.max_advisory_snapshot_age_seconds)
      || policy.max_advisory_snapshot_age_seconds < 1) {
    throw new KernelError(400, "INVALID_TRUST_POLICY", "Advisory snapshot age must be bounded.");
  }
  if (!Number.isSafeInteger(policy.maximum_dependency_count) || policy.maximum_dependency_count < 0) {
    throw new KernelError(400, "INVALID_TRUST_POLICY", "Dependency count must be bounded.");
  }
  const responses = new Set(["notify_only", "block_new_import"]);
  for (const [severity, response] of Object.entries(policy.advisory_responses)) {
    if (!["low", "moderate", "high", "critical"].includes(severity) || !responses.has(response)) {
      throw new KernelError(400, "INVALID_TRUST_POLICY", "Advisory responses must use supported severity actions.");
    }
  }
  if (/PRIVATE KEY|ed25519-pkcs8:/i.test(JSON.stringify(policy))) {
    throw new KernelError(400, "PRIVATE_KEY_PROHIBITED", "Trust Policy cannot contain private key material.");
  }
  return policy;
}

function serializePolicy(row) {
  return {
    policy_id: row.policy_id,
    version: row.version,
    environment_class: row.environment_class,
    policy_document: row.policy_document,
    policy_digest: row.policy_digest,
    created_by_actor_id: row.created_by_actor_id,
    created_at: new Date(row.created_at).toISOString(),
    immutable: true
  };
}

function serializeReceipt(row) {
  return {
    import_receipt_id: row.import_receipt_id,
    policy_id: row.policy_id,
    policy_version: row.policy_version,
    importer_actor_id: row.importer_actor_id,
    work_intent_id: row.work_intent_id,
    transport: row.transport,
    package_identity: row.package_identity,
    bundle_digest: row.bundle_digest,
    evidence_digest: row.evidence_digest,
    advisory_snapshot_digest: row.advisory_snapshot_digest,
    verification_digest: row.verification_digest,
    admissible: row.admissible,
    verification_result: row.verification_result,
    quarantine_id: row.quarantine_id,
    imported_at: new Date(row.imported_at).toISOString(),
    immutable: true,
    deployment_created: false,
    capability_authority_granted: false
  };
}

function serializeQuarantine(row) {
  return {
    quarantine_id: row.quarantine_id,
    package_id: row.package_id,
    semantic_version: row.semantic_version,
    package_artifact_digest: row.package_artifact_digest,
    package_identity: row.package_identity,
    bundle_digest: row.bundle_digest,
    state: row.state,
    quarantined_at: new Date(row.quarantined_at).toISOString(),
    deployment_id: null,
    capability_authority_granted: false,
    immutable: true
  };
}

export function createPackageTrustService(database, installationId, environmentId, environmentClass) {
  const { pool, executeCommand } = database;

  async function createPolicy(envelope, actor) {
    const policy = validatePolicy(envelope.input.policy);
    if (policy.environment_class !== environmentClass) {
      throw new KernelError(409, "TRUST_POLICY_ENVIRONMENT_MISMATCH",
        `This Kernel Environment is bound to ${environmentClass}.`);
    }
    if (envelope.input.policy_id !== undefined || envelope.input.version !== undefined) {
      throw new KernelError(400, "INVALID_INPUT", "Policy identity must live inside the signed policy document.");
    }
    const command = { ...envelope, actor };
    const policyDigest = sha256Digest(policy);
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    return executeCommand({
      installationId,
      environmentId,
      command,
      requestDigest,
      apply: async (client, { acceptedAt }) => {
        const existing = await client.query(
          `SELECT policy_digest FROM kernel_trust_policies
           WHERE installation_id=$1 AND environment_id=$2 AND policy_id=$3 AND version=$4`,
          [installationId, environmentId, policy.policy_id, policy.version]
        );
        if (existing.rows[0]) {
          throw new KernelError(409, "TRUST_POLICY_VERSION_EXISTS",
            "Trust Policy identity and version are already immutable.", {
              accepted_policy_digest: existing.rows[0].policy_digest,
              received_policy_digest: policyDigest
            });
        }
        await client.query(
          `INSERT INTO kernel_trust_policies
           (installation_id,environment_id,policy_id,version,environment_class,policy_document,
            policy_digest,created_by_actor_id,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [installationId, environmentId, policy.policy_id, policy.version, policy.environment_class,
            JSON.stringify(policy), policyDigest, actor.id, acceptedAt]
        );
        const record = { policy_id: policy.policy_id, version: policy.version,
          environment_class: policy.environment_class, policy_document: policy, policy_digest: policyDigest,
          created_by_actor_id: actor.id, created_at: acceptedAt, immutable: true };
        return {
          aggregateType: "trust_policy",
          aggregateId: `${policy.policy_id}:${policy.version}`,
          transitionType: "kernel.trust_policy.created",
          transitionPayload: { policy_id: policy.policy_id, version: policy.version, policy_digest: policyDigest },
          result: { trust_policy: record }
        };
      }
    });
  }

  async function getPolicy(policyId, version) {
    const numericVersion = Number(version);
    const result = await pool.query(
      `SELECT * FROM kernel_trust_policies
       WHERE installation_id=$1 AND environment_id=$2 AND policy_id=$3 AND version=$4`,
      [installationId, environmentId, policyId, numericVersion]
    );
    if (!result.rows[0]) throw new KernelError(404, "TRUST_POLICY_NOT_FOUND", "Trust Policy does not exist.");
    return serializePolicy(result.rows[0]);
  }

  async function importPackage(envelope, actor) {
    const input = object(envelope.input, "input");
    const command = { ...envelope, actor };
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    const replay = await database.getCommandReceipt(installationId, environmentId, envelope.command_id);
    if (replay) {
      if (replay.request_digest !== requestDigest) {
        throw new KernelError(409, "IDEMPOTENCY_CONFLICT", "Command ID was already used with different input.", {
          command_id: envelope.command_id,
          accepted_request_digest: replay.request_digest,
          received_request_digest: requestDigest
        });
      }
      return { replayed: true, result: replay.result };
    }
    const transport = string(input.transport, "transport");
    if (!["registry", "mirror", "offline_bundle"].includes(transport)) {
      throw new KernelError(400, "INVALID_TRANSPORT", "Import transport is unsupported.");
    }
    const policyRecord = await getPolicy(string(input.policy_id, "policy_id"), input.policy_version);
    if (policyRecord.environment_class !== environmentClass) {
      throw new KernelError(409, "TRUST_POLICY_ENVIRONMENT_MISMATCH",
        "Trust Policy does not belong to this Kernel Environment class.");
    }
    const workIntentId = string(input.work_intent_id, "work_intent_id");
    const workIntent = await pool.query(
      `SELECT work_intent_id FROM kernel_work_intents
       WHERE installation_id=$1 AND environment_id=$2 AND work_intent_id=$3`,
      [installationId, environmentId, workIntentId]
    );
    if (!workIntent.rows[0]) {
      throw new KernelError(409, "WORK_INTENT_NOT_CONFIRMED", "Import requires a confirmed local Work Intent.");
    }
    let verification;
    try {
      verification = verifyImportBundle(object(input.bundle, "bundle"), policyRecord.policy_document, { transport });
    } catch (error) {
      if (error instanceof PortableTrustError) {
        throw new KernelError(409, error.code, error.message, error.details);
      }
      throw error;
    }
    const bundleDigest = sha256Digest(input.bundle);
    const evidenceDigest = sha256Digest(verification.evidence);
    const advisorySnapshotDigest = verification.evidence.advisory_snapshot.snapshot_digest;
    const importReceiptId = randomUUID();
    return executeCommand({
      installationId,
      environmentId,
      command,
      requestDigest,
      apply: async (client, { acceptedAt }) => {
        let quarantine = null;
        if (verification.admissible) {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
            `quarantine:${installationId}:${environmentId}:${verification.package_identity}`
          ]);
          const existing = await client.query(
            `SELECT * FROM kernel_quarantined_packages
             WHERE installation_id=$1 AND environment_id=$2 AND package_identity=$3`,
            [installationId, environmentId, verification.package_identity]
          );
          if (existing.rows[0]) {
            quarantine = existing.rows[0];
          } else {
            const manifest = input.bundle.root.release.manifest;
            const quarantineId = randomUUID();
            await client.query(
              `INSERT INTO kernel_quarantined_packages
               (quarantine_id,installation_id,environment_id,package_id,semantic_version,package_artifact_digest,
                package_identity,bundle,bundle_digest,state,quarantined_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'quarantined',$10)`,
              [quarantineId, installationId, environmentId, manifest.package_id, manifest.semantic_version,
                manifest.package_artifact_digest, verification.package_identity, JSON.stringify(input.bundle),
                bundleDigest, acceptedAt]
            );
            quarantine = { quarantine_id: quarantineId, package_id: manifest.package_id,
              semantic_version: manifest.semantic_version, package_artifact_digest: manifest.package_artifact_digest,
              package_identity: verification.package_identity, bundle_digest: bundleDigest, state: "quarantined",
              quarantined_at: acceptedAt };
          }
        }
        await client.query(
          `INSERT INTO kernel_package_import_receipts
           (import_receipt_id,installation_id,environment_id,policy_id,policy_version,importer_actor_id,work_intent_id,
            transport,package_identity,bundle_digest,evidence_digest,advisory_snapshot_digest,verification_digest,
            admissible,verification_result,quarantine_id,imported_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [importReceiptId, installationId, environmentId, policyRecord.policy_id, policyRecord.version, actor.id,
            workIntentId, transport, verification.package_identity, bundleDigest, evidenceDigest,
            advisorySnapshotDigest, verification.verification_digest, verification.admissible,
            JSON.stringify(verification), quarantine?.quarantine_id ?? null, acceptedAt]
        );
        const receipt = { import_receipt_id: importReceiptId, policy_id: policyRecord.policy_id,
          policy_version: policyRecord.version, importer_actor_id: actor.id, work_intent_id: workIntentId, transport,
          package_identity: verification.package_identity, bundle_digest: bundleDigest, evidence_digest: evidenceDigest,
          advisory_snapshot_digest: advisorySnapshotDigest, verification_digest: verification.verification_digest,
          admissible: verification.admissible, verification_result: verification,
          quarantine_id: quarantine?.quarantine_id ?? null, imported_at: acceptedAt, immutable: true,
          deployment_created: false, capability_authority_granted: false };
        return {
          aggregateType: "package_import_receipt",
          aggregateId: importReceiptId,
          transitionType: verification.admissible ? "kernel.package.quarantined" : "kernel.package_import.denied",
          transitionPayload: { package_identity: verification.package_identity,
            verification_digest: verification.verification_digest, policy_id: policyRecord.policy_id,
            policy_version: policyRecord.version, work_intent_id: workIntentId },
          result: { import_receipt: receipt,
            quarantined_package: quarantine ? serializeQuarantine(quarantine) : null }
        };
      }
    });
  }

  async function getImportReceipt(id) {
    const result = await pool.query(
      `SELECT * FROM kernel_package_import_receipts
       WHERE installation_id=$1 AND environment_id=$2 AND import_receipt_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "IMPORT_RECEIPT_NOT_FOUND", "Import Receipt does not exist.");
    return serializeReceipt(result.rows[0]);
  }

  async function getQuarantinedPackage(id) {
    const result = await pool.query(
      `SELECT * FROM kernel_quarantined_packages
       WHERE installation_id=$1 AND environment_id=$2 AND quarantine_id=$3`,
      [installationId, environmentId, id]
    );
    if (!result.rows[0]) throw new KernelError(404, "QUARANTINED_PACKAGE_NOT_FOUND", "Quarantined Package does not exist.");
    return serializeQuarantine(result.rows[0]);
  }

  return { createPolicy, getPolicy, importPackage, getImportReceipt, getQuarantinedPackage };
}
