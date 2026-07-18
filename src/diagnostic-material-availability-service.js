import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import { canonicalize, deterministicUuid, sha256Digest } from "./canonical-json.js";
import {
  buildDeletionAttemptDocument,
  buildErasureDecisionDocument,
  buildMaterialTombstoneDocument,
  canonicalImpactManifest,
  DIAGNOSTIC_MATERIAL_ERASURE_POLICY,
  DIAGNOSTIC_MATERIAL_ERASURE_POLICY_DIGEST,
  DIAGNOSTIC_PACKAGE_MATERIAL_AVAILABILITY_SCHEMA,
  projectPackageMaterialAvailability,
  validateMaterialDeletionCommand,
  validateMaterialErasureCommand
} from "./diagnostic-material-availability-contracts.js";
import { KernelError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const STAGE_ACTOR = "diagnostic-material-authority:v0.1";
const MATERIAL_LOCK = "diagnostic-material-mutation";

function same(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function iso(value) {
  return new Date(value).toISOString();
}

function boundedString(value, field, maximum = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new KernelError(400, "DIAGNOSTIC_MATERIAL_ERASURE_INPUT_INVALID",
      `${field} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function legacyCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !same(Object.keys(value).sort(), ["command_id", "input", "operation_id"])) {
    throw new KernelError(400, "DIAGNOSTIC_MATERIAL_ERASURE_INPUT_INVALID",
      "Legacy retirement command fields must be exact.");
  }
  if (value.operation_id !== "diagnostic.artifact.retire") {
    throw new KernelError(400, "UNSUPPORTED_OPERATION",
      "operation_id must be diagnostic.artifact.retire.");
  }
  if (!value.input || typeof value.input !== "object" || Array.isArray(value.input)
      || !same(Object.keys(value.input).sort(), ["artifact_digest", "reason"])) {
    throw new KernelError(400, "DIAGNOSTIC_MATERIAL_ERASURE_INPUT_INVALID",
      "Legacy retirement input fields must be exact.");
  }
  const artifactDigest = boundedString(value.input.artifact_digest, "input.artifact_digest", 80);
  if (!DIGEST.test(artifactDigest)) throw new KernelError(400,
    "DIAGNOSTIC_MATERIAL_ERASURE_INPUT_INVALID", "input.artifact_digest must be an exact SHA-256 digest.");
  const commandId = boundedString(value.command_id, "command_id", 160);
  return {
    command_id: commandId,
    operation_id: value.operation_id,
    input: {
      erasure_decision_id: deterministicUuid({ namespace: "legacy-diagnostic-artifact-retirement",
        artifact_digest: artifactDigest }),
      artifact_digest: artifactDigest,
      reason_code: "customer_retention_request",
      reason: boundedString(value.input.reason, "input.reason", 500),
      override_retention_classes: []
    },
    original: structuredClone(value)
  };
}

function materialLockKey(installationId) {
  return `${MATERIAL_LOCK}:${installationId}`;
}

function restrictionError(digest, purpose, restriction) {
  return new KernelError(409, "DIAGNOSTIC_MATERIAL_NOT_AVAILABLE",
    "Diagnostic artifact material is unavailable under a committed erasure decision.", {
      artifact_digest: digest,
      purpose,
      erasure_decision_id: restriction?.erasure_decision_id ?? null,
      material_state: restriction?.state ?? "legacy_deleted"
    });
}

function decisionView(decision, state, attempts = [], tombstone = null) {
  return {
    erasure_decision_id: decision.erasure_decision_id,
    artifact_digest: decision.artifact_digest,
    material_class: decision.material_class,
    reason_code: decision.reason_code,
    reason: decision.reason,
    governing_policy: decision.governing_policy,
    governing_policy_digest: decision.governing_policy_digest,
    override_retention_classes: decision.override_retention_classes,
    impact_manifest: decision.impact_manifest,
    impact_manifest_digest: decision.impact_manifest_digest,
    decision_digest: decision.decision_digest,
    authorized_by: { type: decision.authorized_by_type, id: decision.authorized_by_id },
    authorization: decision.authorization_context,
    requested_at: iso(decision.requested_at),
    material_state: state.state,
    state_revision: String(state.state_revision),
    deletion_attempts: attempts.map((attempt) => ({
      deletion_attempt_id: attempt.deletion_attempt_id,
      outcome: attempt.outcome,
      verification_status: attempt.verification_status,
      error_code: attempt.error_code,
      attempt_digest: attempt.attempt_digest,
      attempted_by: attempt.attempted_by,
      attempted_at: iso(attempt.attempted_at)
    })),
    tombstone: tombstone ? {
      tombstone_digest: tombstone.tombstone_digest,
      document: tombstone.tombstone_document,
      completed_at: iso(tombstone.completed_at)
    } : null,
    authority_granted: "material_access_revocation_only",
    universal_deletion_established: false,
    immutable_decision: true
  };
}

function verifyDecision(decision, state) {
  if (!decision || !state) {
    throw new KernelError(500, "DIAGNOSTIC_MATERIAL_ERASURE_INTEGRITY_VIOLATION",
      "Stored material erasure decision or state is incomplete.");
  }
  const rebuilt = buildErasureDecisionDocument({
    decisionId: decision.erasure_decision_id,
    installationId: decision.installation_id,
    environmentId: decision.environment_id,
    artifactDigest: decision.artifact_digest,
    materialClass: decision.material_class,
    reasonCode: decision.reason_code,
    reason: decision.reason,
    overrideRetentionClasses: decision.override_retention_classes,
    impactManifest: decision.impact_manifest,
    impactManifestDigest: decision.impact_manifest_digest,
    actor: {
      type: decision.authorized_by_type,
      id: decision.authorized_by_id,
      authorization: decision.authorization_context
    },
    requestedAt: decision.requested_at
  });
  if (decision.installation_id !== state.installation_id
      || decision.environment_id !== state.environment_id
      || decision.governing_policy_digest !== DIAGNOSTIC_MATERIAL_ERASURE_POLICY_DIGEST
      || !same(decision.governing_policy, DIAGNOSTIC_MATERIAL_ERASURE_POLICY)
      || sha256Digest(decision.impact_manifest) !== decision.impact_manifest_digest
      || !same(rebuilt.document, decision.decision_document)
      || rebuilt.digest !== decision.decision_digest
      || state.erasure_decision_id !== decision.erasure_decision_id
      || state.artifact_digest !== decision.artifact_digest
      || !["revoked_pending_deletion", "deleted_verified"].includes(state.state)
      || (state.state === "revoked_pending_deletion" && String(state.state_revision) !== "0")
      || (state.state === "deleted_verified" && String(state.state_revision) !== "1")) {
    throw new KernelError(500, "DIAGNOSTIC_MATERIAL_ERASURE_INTEGRITY_VIOLATION",
      "Stored material erasure decision or state does not match its immutable digests.");
  }
  return decision;
}

export function createDiagnosticMaterialAvailabilityService({ database, artifactStore,
  installationId, environmentId }) {
  const { pool } = database;
  const exclusiveContext = new AsyncLocalStorage();
  const exclusiveToken = Object.freeze({ installationId });

  function materialMutationIsExclusive() {
    return exclusiveContext.getStore() === exclusiveToken;
  }

  async function lockMaterialMutation(client) {
    if (materialMutationIsExclusive()) return;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [materialLockKey(installationId)]);
  }

  async function runMaterialMutationExclusive(operation) {
    if (materialMutationIsExclusive()) return operation();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [materialLockKey(installationId)]);
      const result = await exclusiveContext.run(exclusiveToken, operation);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function loadRestriction(client, artifactDigest) {
    const state = (await client.query(
      `SELECT s.*,d.decision_digest FROM diagnostic_material_states s
       JOIN diagnostic_material_erasure_decisions d ON d.erasure_decision_id=s.erasure_decision_id
       WHERE s.installation_id=$1 AND s.artifact_digest=$2`,
      [installationId, artifactDigest]
    )).rows[0];
    if (state) return state;
    const legacy = (await client.query(
      `SELECT artifact_digest,deleted_at FROM diagnostic_artifact_tombstones
       WHERE installation_id=$1 AND artifact_digest=$2`, [installationId, artifactDigest]
    )).rows[0];
    return legacy ? { artifact_digest: artifactDigest, state: "legacy_deleted" } : null;
  }

  async function assertArtifactDigestsAdmissible(client, artifactDigests, purpose) {
    const unique = [...new Set(artifactDigests.filter(Boolean))].sort();
    for (const artifactDigest of unique) {
      const restriction = await loadRestriction(client, artifactDigest);
      if (restriction) throw restrictionError(artifactDigest, purpose, restriction);
    }
    return unique;
  }

  async function withArtifactAccess(artifactDigest, purpose, operation) {
    if (materialMutationIsExclusive()) return operation();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockMaterialMutation(client);
      const restriction = await loadRestriction(client, artifactDigest);
      if (restriction) throw restrictionError(artifactDigest, purpose, restriction);
      const result = await operation();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  function createArtifactAccessGuard() {
    return {
      withReadAccess(artifactDigest, operation) {
        return withArtifactAccess(artifactDigest, "artifact_read", operation);
      },
      withWriteAccess(artifactDigest, operation) {
        return withArtifactAccess(artifactDigest, "artifact_write", operation);
      }
    };
  }

  async function packageArtifactDigests(client, evidencePackageId) {
    const packageRow = (await client.query(
      `SELECT * FROM diagnostic_evidence_packages
       WHERE installation_id=$1 AND environment_id=$2 AND evidence_package_id=$3`,
      [installationId, environmentId, evidencePackageId]
    )).rows[0];
    if (!packageRow) throw new KernelError(404, "DIAGNOSTIC_EVIDENCE_PACKAGE_NOT_FOUND",
      "Diagnostic Evidence Package does not exist.");
    const references = (await client.query(
      `SELECT artifact_digest FROM diagnostic_evidence_package_references
       WHERE installation_id=$1 AND evidence_package_id=$2 AND artifact_digest IS NOT NULL`,
      [installationId, evidencePackageId]
    )).rows.map((row) => row.artifact_digest);
    const bundle = (await client.query(
      `SELECT bundle_artifact_digest FROM diagnostic_independent_verification_bundles
       WHERE installation_id=$1 AND evidence_package_id=$2`, [installationId, evidencePackageId]
    )).rows[0]?.bundle_artifact_digest;
    return { packageRow, artifactDigests: [...new Set([
      packageRow.package_artifact_digest, ...references, bundle
    ].filter(Boolean))].sort() };
  }

  async function assertPackageMaterialAdmissible(client, evidencePackageId, purpose) {
    const state = (await client.query(
      `SELECT * FROM diagnostic_package_material_availability_states
       WHERE installation_id=$1 AND environment_id=$2 AND evidence_package_id=$3`,
      [installationId, environmentId, evidencePackageId]
    )).rows[0];
    if (state) throw new KernelError(409, "DIAGNOSTIC_EVIDENCE_PACKAGE_MATERIAL_UNAVAILABLE",
      "Diagnostic Evidence Package cannot receive new authority because selected material is unavailable.", {
        evidence_package_id: evidencePackageId,
        purpose,
        material_status: state.material_status,
        current_as_of: iso(state.current_as_of)
      });
    const material = await packageArtifactDigests(client, evidencePackageId);
    await assertArtifactDigestsAdmissible(client, material.artifactDigests, purpose);
    return material;
  }

  async function classifyImpact(client, artifactDigest) {
    const artifact = (await client.query(
      `SELECT * FROM diagnostic_artifacts WHERE installation_id=$1 AND artifact_digest=$2`,
      [installationId, artifactDigest]
    )).rows[0];
    if (!artifact) throw new KernelError(404, "DIAGNOSTIC_ERASABLE_ARTIFACT_NOT_FOUND",
      "Diagnostic artifact metadata does not exist.");
    const packageRows = (await client.query(
      `SELECT evidence_package_id,case_id,'package_artifact' AS relationship
       FROM diagnostic_evidence_packages
       WHERE installation_id=$1 AND environment_id=$2 AND package_artifact_digest=$3
       UNION ALL
       SELECT p.evidence_package_id,p.case_id,'selected_artifact' AS relationship
       FROM diagnostic_evidence_packages p
       JOIN diagnostic_evidence_package_references r
         ON r.evidence_package_id=p.evidence_package_id AND r.installation_id=p.installation_id
       WHERE p.installation_id=$1 AND p.environment_id=$2 AND r.artifact_digest=$3
       UNION ALL
       SELECT p.evidence_package_id,p.case_id,'independent_verification_bundle' AS relationship
       FROM diagnostic_evidence_packages p
       JOIN diagnostic_independent_verification_bundles b
         ON b.evidence_package_id=p.evidence_package_id AND b.installation_id=p.installation_id
       WHERE p.installation_id=$1 AND p.environment_id=$2 AND b.bundle_artifact_digest=$3
       ORDER BY evidence_package_id,relationship`, [installationId, environmentId, artifactDigest]
    )).rows;
    const reproduction = (await client.query(
      `SELECT bundle_id,case_id FROM diagnostic_reproduction_bundles
       WHERE installation_id=$1 AND artifact_digest=$2`, [installationId, artifactDigest]
    )).rows[0];
    const stageArchive = (await client.query(
      `SELECT stage_artifact_digest FROM diagnostic_stage_artifact_archives
       WHERE installation_id=$1 AND archive_artifact_digest=$2`, [installationId, artifactDigest]
    )).rows[0];
    if (stageArchive) throw new KernelError(409, "DIAGNOSTIC_STAGE_ARTIFACT_ERASURE_PROHIBITED",
      "Executable stage provenance is not customer evidence and cannot be erased through this policy.");
    const packageMap = new Map();
    for (const row of packageRows) {
      const entry = packageMap.get(row.evidence_package_id) ?? {
        evidence_package_id: row.evidence_package_id, case_id: row.case_id,
        relationships: [], root_material: false
      };
      entry.relationships.push(row.relationship);
      if (row.relationship === "package_artifact") entry.root_material = true;
      packageMap.set(row.evidence_package_id, entry);
    }
    const affectedPackages = [...packageMap.values()].map((entry) => ({
      ...entry, relationships: [...new Set(entry.relationships)].sort()
    })).sort((left, right) => left.evidence_package_id < right.evidence_package_id ? -1 : 1);
    const packageIds = affectedPackages.map((entry) => entry.evidence_package_id);
    const assignments = packageIds.length ? (await client.query(
      `SELECT a.assignment_id,a.evidence_package_id,a.case_id,s.state,s.state_revision,a.assignment_digest
       FROM diagnostic_assignments a JOIN diagnostic_assignment_states s ON s.assignment_id=a.assignment_id
       WHERE a.installation_id=$1 AND a.environment_id=$2 AND a.evidence_package_id=ANY($3::uuid[])
       ORDER BY a.assignment_id`, [installationId, environmentId, packageIds]
    )).rows : [];
    let materialClass;
    if (packageRows.some((row) => row.relationship === "package_artifact")) {
      materialClass = "diagnostic_evidence_package";
    } else if (packageRows.some((row) => row.relationship === "selected_artifact")) {
      materialClass = "package_selected_artifact";
    } else if (packageRows.some((row) => row.relationship === "independent_verification_bundle")) {
      materialClass = "independent_verification_bundle";
    } else if (reproduction) {
      materialClass = "diagnostic_reproduction_bundle";
    } else {
      throw new KernelError(409, "DIAGNOSTIC_ARTIFACT_ERASURE_SCOPE_UNSUPPORTED",
        "Artifact is not governed customer evidence in the supported erasure scope.");
    }
    const retainedRepresentations = ["diagnostic_artifacts.metadata_and_digest"];
    if (affectedPackages.length) retainedRepresentations.push(
      "diagnostic_evidence_packages.immutable_manifests_and_digests");
    if (reproduction) retainedRepresentations.push(
      "diagnostic_reproduction_bundles.immutable_metadata_and_digest");
    if (packageRows.some((row) => row.relationship === "independent_verification_bundle")) {
      retainedRepresentations.push(
        "diagnostic_independent_verification_bundles.immutable_metadata_and_digest");
    }
    return { artifact, materialClass, affectedPackages, assignments, reproduction,
      retainedRepresentations };
  }

  async function enforceRetentionAuthority(client, artifactDigest, overrideClasses, now) {
    const activePins = (await client.query(
      `SELECT pin_id,evidence_package_id,expires_at FROM diagnostic_artifact_retention_pins
       WHERE installation_id=$1 AND artifact_digest=$2 AND expires_at>$3`,
      [installationId, artifactDigest, now]
    )).rows;
    if (activePins.length && !overrideClasses.includes("package_pin")) {
      throw new KernelError(409, "DIAGNOSTIC_MATERIAL_RETENTION_OVERRIDE_REQUIRED",
        "Active package retention pins require an explicit package_pin override.", {
          artifact_digest: artifactDigest, active_pin_count: activePins.length
        });
    }
    const holdRows = (await client.query(
      `SELECT h.*,r.release_document,r.release_digest,r.released_by,r.released_at
       FROM diagnostic_material_retention_holds h
       LEFT JOIN diagnostic_material_retention_hold_releases r ON r.hold_id=h.hold_id
       WHERE h.installation_id=$1 AND h.artifact_digest=$2
         AND (h.expires_at IS NULL OR h.expires_at>$3)
       ORDER BY h.hold_class,h.hold_id`, [installationId, artifactDigest, now]
    )).rows;
    for (const hold of holdRows) {
      const expectedHold = {
        schema_version: "alphonse.diagnostic-material-retention-hold.v0.1",
        hold_id: hold.hold_id,
        artifact_digest: hold.artifact_digest,
        hold_class: hold.hold_class,
        source: { type: hold.source_type, id: hold.source_id },
        expires_at: hold.expires_at ? iso(hold.expires_at) : null,
        created_by: hold.created_by,
        created_at: iso(hold.created_at)
      };
      if (!same(hold.hold_document, expectedHold)
          || sha256Digest(hold.hold_document) !== hold.hold_digest) {
        throw new KernelError(500, "DIAGNOSTIC_MATERIAL_RETENTION_HOLD_INTEGRITY_VIOLATION",
          "Stored material retention hold does not match its immutable digest.", {
            artifact_digest: artifactDigest, hold_id: hold.hold_id
          });
      }
      if (hold.release_document) {
        const expectedRelease = {
          schema_version: "alphonse.diagnostic-material-retention-hold-release.v0.1",
          hold_id: hold.hold_id,
          hold_digest: hold.hold_digest,
          artifact_digest: hold.artifact_digest,
          released_by: hold.released_by,
          released_at: iso(hold.released_at)
        };
        if (!same(hold.release_document, expectedRelease)
            || sha256Digest(hold.release_document) !== hold.release_digest) {
          throw new KernelError(500,
            "DIAGNOSTIC_MATERIAL_RETENTION_HOLD_RELEASE_INTEGRITY_VIOLATION",
            "Stored retention-hold release does not match its exact held material.", {
              artifact_digest: artifactDigest, hold_id: hold.hold_id
            });
        }
      }
    }
    const holds = holdRows.filter((hold) => !hold.release_document);
    const legalHold = holds.find((hold) => hold.hold_class === "legal_hold");
    if (legalHold) throw new KernelError(409, "DIAGNOSTIC_MATERIAL_LEGAL_HOLD_ACTIVE",
      "Active legal hold cannot be overridden by the current material erasure policy.", {
        artifact_digest: artifactDigest, hold_id: legalHold.hold_id
      });
    const missingOverrides = [...new Set(holds.map((hold) => hold.hold_class)
      .filter((holdClass) => !overrideClasses.includes(holdClass)))].sort();
    if (missingOverrides.length) throw new KernelError(409,
      "DIAGNOSTIC_MATERIAL_RETENTION_OVERRIDE_REQUIRED",
      "Active retention grounds require explicit bounded overrides.", {
        artifact_digest: artifactDigest, missing_override_classes: missingOverrides
      });
    return { activePins, holds };
  }

  async function loadDecision(client, decisionId, forUpdate = false) {
    const decision = (await client.query(
      `SELECT * FROM diagnostic_material_erasure_decisions
       WHERE installation_id=$1 AND environment_id=$2 AND erasure_decision_id=$3${forUpdate ? " FOR UPDATE" : ""}`,
      [installationId, environmentId, decisionId]
    )).rows[0];
    if (!decision) throw new KernelError(404, "DIAGNOSTIC_MATERIAL_ERASURE_NOT_FOUND",
      "Material erasure decision does not exist.");
    const state = (await client.query(
      `SELECT * FROM diagnostic_material_states WHERE erasure_decision_id=$1${forUpdate ? " FOR UPDATE" : ""}`,
      [decisionId]
    )).rows[0];
    verifyDecision(decision, state);
    return { decision, state };
  }

  async function materialView(decisionId, client = pool) {
    const { decision, state } = await loadDecision(client, decisionId);
    const attempts = (await client.query(
      `SELECT * FROM diagnostic_material_deletion_attempts
       WHERE erasure_decision_id=$1 ORDER BY attempted_at,deletion_attempt_id`, [decisionId]
    )).rows;
    const tombstone = (await client.query(
      "SELECT * FROM diagnostic_artifact_erasure_tombstones WHERE erasure_decision_id=$1",
      [decisionId]
    )).rows[0] ?? null;
    for (const attempt of attempts) {
      const rebuilt = buildDeletionAttemptDocument({
        attemptId: attempt.deletion_attempt_id,
        decision,
        outcome: attempt.outcome,
        verificationStatus: attempt.verification_status,
        errorCode: attempt.error_code,
        attemptedBy: attempt.attempted_by,
        attemptedAt: attempt.attempted_at
      });
      if (!same(rebuilt.document, attempt.attempt_document)
          || rebuilt.digest !== attempt.attempt_digest
          || attempt.erasure_decision_id !== decisionId
          || attempt.installation_id !== decision.installation_id
          || attempt.artifact_digest !== decision.artifact_digest) {
        throw new KernelError(500, "DIAGNOSTIC_MATERIAL_DELETION_ATTEMPT_INTEGRITY_VIOLATION",
          "Stored material deletion attempt does not match its immutable digest.");
      }
    }
    if (tombstone) {
      const deletionAttempt = attempts.find((entry) =>
        entry.deletion_attempt_id === tombstone.deletion_attempt_id);
      const rebuilt = deletionAttempt ? buildMaterialTombstoneDocument({
        decision,
        deletionAttempt,
        completedAt: tombstone.completed_at
      }) : null;
      if (!rebuilt || !same(rebuilt.document, tombstone.tombstone_document)
          || rebuilt.digest !== tombstone.tombstone_digest
          || tombstone.erasure_decision_id !== decisionId
          || tombstone.installation_id !== decision.installation_id
          || tombstone.environment_id !== decision.environment_id
          || tombstone.artifact_digest !== decision.artifact_digest) {
        throw new KernelError(500, "DIAGNOSTIC_MATERIAL_TOMBSTONE_INTEGRITY_VIOLATION",
          "Stored material tombstone does not match its immutable decision and deletion attempt.");
      }
    }
    if ((state.state === "deleted_verified") !== Boolean(tombstone)) {
      throw new KernelError(500, "DIAGNOSTIC_MATERIAL_ERASURE_INTEGRITY_VIOLATION",
        "Material state and verified local deletion tombstone disagree.");
    }
    return decisionView(decision, state, attempts, tombstone);
  }

  async function commandReplay(client, commandId, acceptedDigest) {
    const existing = (await client.query(
      `SELECT request_digest,result FROM diagnostic_commands
       WHERE installation_id=$1 AND command_id=$2`, [installationId, commandId]
    )).rows[0];
    if (!existing) return null;
    if (existing.request_digest !== acceptedDigest) throw new KernelError(409, "IDEMPOTENCY_CONFLICT",
      "Diagnostic command ID was reused with different material erasure input.", {
        command_id: commandId,
        accepted_request_digest: existing.request_digest,
        received_request_digest: acceptedDigest
      });
    return { replayed: true, result: existing.result };
  }

  async function upsertPackageAvailability(client, packageEntry, decision, now) {
    const current = (await client.query(
      `SELECT * FROM diagnostic_package_material_availability_states
       WHERE evidence_package_id=$1 FOR UPDATE`, [packageEntry.evidence_package_id]
    )).rows[0];
    const prior = current?.projection_document ?? null;
    const projected = projectPackageMaterialAvailability({
      evidencePackageId: packageEntry.evidence_package_id,
      prior,
      erasureDecisionId: decision.erasure_decision_id,
      artifactDigest: decision.artifact_digest,
      rootMaterial: packageEntry.root_material,
      cause: decision.reason_code,
      currentAsOf: now
    });
    const fromRevision = current ? BigInt(current.state_revision) : 0n;
    const eventId = deterministicUuid({ namespace: "diagnostic-package-material-availability-event",
      evidence_package_id: packageEntry.evidence_package_id,
      erasure_decision_id: decision.erasure_decision_id });
    const eventDocument = {
      schema_version: "alphonse.diagnostic-package-material-availability-event.v0.1",
      availability_event_id: eventId,
      evidence_package_id: packageEntry.evidence_package_id,
      erasure_decision_id: decision.erasure_decision_id,
      artifact_digest: decision.artifact_digest,
      relationships: packageEntry.relationships,
      from_revision: String(fromRevision),
      to_revision: String(fromRevision + 1n),
      from_status: current?.material_status ?? "complete",
      to_status: projected.document.material_status,
      execution_eligible: false,
      occurred_at: iso(now)
    };
    await client.query(
      `INSERT INTO diagnostic_package_material_availability_events
        (availability_event_id,installation_id,environment_id,evidence_package_id,
         erasure_decision_id,from_revision,to_revision,from_status,to_status,
         event_document,event_digest,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [eventId, installationId, environmentId, packageEntry.evidence_package_id,
        decision.erasure_decision_id, String(fromRevision), String(fromRevision + 1n),
        current?.material_status ?? "complete", projected.document.material_status,
        eventDocument, sha256Digest(eventDocument), iso(now)]
    );
    if (current) {
      await client.query(
        `UPDATE diagnostic_package_material_availability_states
         SET material_status=$2,projection_document=$3,projection_digest=$4,
             state_revision=state_revision+1,last_event_id=$5,current_as_of=$6,cause=$7
         WHERE evidence_package_id=$1`,
        [packageEntry.evidence_package_id, projected.document.material_status,
          projected.document, projected.digest, eventId, iso(now), decision.reason_code]
      );
    } else {
      await client.query(
        `INSERT INTO diagnostic_package_material_availability_states
          (evidence_package_id,installation_id,environment_id,material_status,execution_eligible,
           integrity_status,cause,projection_document,projection_digest,state_revision,last_event_id,current_as_of)
         VALUES ($1,$2,$3,$4,false,'verified_governed_erasure',$5,$6,$7,1,$8,$9)`,
        [packageEntry.evidence_package_id, installationId, environmentId,
          projected.document.material_status, decision.reason_code, projected.document,
          projected.digest, eventId, iso(now)]
      );
    }
    return projected.document;
  }

  async function requestErasure(value, actor, { legacy = false } = {}) {
    const parsed = legacy ? legacyCommand(value) : validateMaterialErasureCommand(value);
    const requestMaterial = legacy ? parsed.original : value;
    const acceptedDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId,
      command: requestMaterial, actor });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${installationId}:${parsed.command_id}`]);
      const replay = await commandReplay(client, parsed.command_id, acceptedDigest);
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      await lockMaterialMutation(client);
      const existingDecisionId = (await client.query(
        `SELECT artifact_digest,decision_digest FROM diagnostic_material_erasure_decisions
         WHERE installation_id=$1 AND erasure_decision_id=$2`,
        [installationId, parsed.input.erasure_decision_id]
      )).rows[0];
      if (existingDecisionId) throw new KernelError(409,
        "DIAGNOSTIC_MATERIAL_ERASURE_DECISION_ID_CONFLICT",
        "Erasure decision ID is already bound to a different command history.", {
          erasure_decision_id: parsed.input.erasure_decision_id,
          accepted_artifact_digest: existingDecisionId.artifact_digest,
          received_artifact_digest: parsed.input.artifact_digest
        });
      const existingRestriction = await loadRestriction(client, parsed.input.artifact_digest);
      if (existingRestriction) throw restrictionError(parsed.input.artifact_digest,
        "material_erasure_request", existingRestriction);
      const impact = await classifyImpact(client, parsed.input.artifact_digest);
      for (const caseId of [...new Set(impact.affectedPackages.map((entry) => entry.case_id))].sort()) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `diagnostic-assignment-case:${installationId}:${caseId}`
        ]);
      }
      const acceptedAt = new Date().toISOString();
      await enforceRetentionAuthority(client, parsed.input.artifact_digest,
        parsed.input.override_retention_classes, acceptedAt);
      const node = (await client.query(
        "SELECT revision,next_sequence FROM diagnostic_nodes WHERE installation_id=$1 FOR UPDATE",
        [installationId]
      )).rows[0];
      const lockedAssignments = impact.assignments.length ? (await client.query(
        `SELECT a.assignment_id,a.evidence_package_id,a.case_id,a.assignment_digest,
                s.state,s.state_revision,s.last_transition_id
         FROM diagnostic_assignments a JOIN diagnostic_assignment_states s ON s.assignment_id=a.assignment_id
         WHERE a.installation_id=$1 AND a.assignment_id=ANY($2::uuid[])
         ORDER BY a.assignment_id FOR UPDATE OF s`,
        [installationId, impact.assignments.map((entry) => entry.assignment_id)]
      )).rows : [];
      const assignmentImpacts = lockedAssignments.map((entry) => ({
        assignment_id: entry.assignment_id,
        evidence_package_id: entry.evidence_package_id,
        prior_state: entry.state,
        action: entry.state === "unclaimed" ? "expired_unclaimed"
          : entry.state === "claimed" ? "cancelled_claimed" : "already_terminal"
      }));
      const impactManifest = canonicalImpactManifest({
        artifactDigest: parsed.input.artifact_digest,
        materialClass: impact.materialClass,
        affectedPackages: impact.affectedPackages,
        affectedAssignments: assignmentImpacts,
        retainedRepresentations: impact.retainedRepresentations
      });
      const decisionMaterial = buildErasureDecisionDocument({
        decisionId: parsed.input.erasure_decision_id,
        installationId,
        environmentId,
        artifactDigest: parsed.input.artifact_digest,
        materialClass: impact.materialClass,
        reasonCode: parsed.input.reason_code,
        reason: parsed.input.reason,
        overrideRetentionClasses: parsed.input.override_retention_classes,
        impactManifest: impactManifest.document,
        impactManifestDigest: impactManifest.digest,
        actor,
        requestedAt: acceptedAt
      });
      await client.query(
        `INSERT INTO diagnostic_material_erasure_decisions
          (erasure_decision_id,installation_id,environment_id,artifact_digest,material_class,
           reason_code,reason,governing_policy,governing_policy_digest,override_retention_classes,
           impact_manifest,impact_manifest_digest,decision_document,decision_digest,
           authorized_by_type,authorized_by_id,authorization_context,requested_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [parsed.input.erasure_decision_id, installationId, environmentId,
          parsed.input.artifact_digest, impact.materialClass, parsed.input.reason_code,
          parsed.input.reason, DIAGNOSTIC_MATERIAL_ERASURE_POLICY,
          DIAGNOSTIC_MATERIAL_ERASURE_POLICY_DIGEST,
          JSON.stringify(parsed.input.override_retention_classes),
          impactManifest.document, impactManifest.digest, decisionMaterial.document,
          decisionMaterial.digest, actor.type, actor.id, actor.authorization ?? {}, acceptedAt]
      );
      const mainTransitionId = randomUUID();
      const packageAvailability = [];
      const decisionRow = {
        erasure_decision_id: parsed.input.erasure_decision_id,
        artifact_digest: parsed.input.artifact_digest,
        reason_code: parsed.input.reason_code
      };
      for (const packageEntry of impact.affectedPackages) {
        packageAvailability.push(await upsertPackageAvailability(client, packageEntry, decisionRow, acceptedAt));
      }
      const invalidations = [];
      let transitionOffset = 1n;
      for (const assignment of lockedAssignments) {
        const action = assignment.state === "unclaimed" ? "expired_unclaimed"
          : assignment.state === "claimed" ? "cancelled_claimed" : "already_terminal";
        let assignmentTransitionId = null;
        if (action !== "already_terminal") {
          assignmentTransitionId = randomUUID();
          const transitionType = action === "expired_unclaimed"
            ? "diagnostic.assignment.expired" : "diagnostic.assignment.cancelled";
          const commandId = `material-erasure:${parsed.input.erasure_decision_id}:assignment:${assignment.assignment_id}`;
          const commandDigest = sha256Digest({ erasure_decision_id: parsed.input.erasure_decision_id,
            assignment_id: assignment.assignment_id, action });
          const transitionPayload = {
            assignment_id: assignment.assignment_id,
            assignment_digest: assignment.assignment_digest,
            evidence_package_id: assignment.evidence_package_id,
            erasure_decision_id: parsed.input.erasure_decision_id,
            reason: "governed_material_erasure",
            workspace_destruction_required: action === "cancelled_claimed",
            broker_revocation_required: action === "cancelled_claimed"
          };
          await client.query(
            `INSERT INTO diagnostic_commands
              (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,
               authorization_context,result,accepted_at)
             VALUES ($1,$2,$3,'diagnostic.assignment.material_invalidate','service',$4,$5,$6,$7)`,
            [installationId, commandId, commandDigest, STAGE_ACTOR,
              { source_erasure_decision_id: parsed.input.erasure_decision_id },
              { assignment_id: assignment.assignment_id, action }, acceptedAt]
          );
          await client.query(
            `INSERT INTO diagnostic_transitions
              (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,
               transition_type,from_revision,to_revision,command_id,actor_type,actor_id,
               authorization_context,payload,occurred_at)
             VALUES ($1,$2,$3,'diagnostic_assignment',$4,$5,$6,$7,$8,'service',$9,$10,$11,$12)`,
            [assignmentTransitionId, installationId,
              String(BigInt(node.next_sequence) + transitionOffset), assignment.assignment_id,
              transitionType, String(BigInt(assignment.state_revision) + 1n),
              String(BigInt(assignment.state_revision) + 2n), commandId, STAGE_ACTOR,
              { source_erasure_decision_id: parsed.input.erasure_decision_id },
              transitionPayload, acceptedAt]
          );
          const targetState = action === "expired_unclaimed" ? "expired" : "cancelled";
          const updated = await client.query(
            `UPDATE diagnostic_assignment_states
             SET state=$2,state_revision=state_revision+1,last_transition_id=$3,updated_at=$4
             WHERE assignment_id=$1 AND state=$5 AND state_revision=$6`,
            [assignment.assignment_id, targetState, assignmentTransitionId, acceptedAt,
              assignment.state, assignment.state_revision]
          );
          if (updated.rowCount !== 1) throw new KernelError(409,
            "DIAGNOSTIC_MATERIAL_ASSIGNMENT_INVALIDATION_RACE",
            "Assignment state changed before material invalidation could commit.");
          await client.query(
            `INSERT INTO diagnostic_outbox
              (outbox_id,installation_id,transition_id,event_type,payload,created_at)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [randomUUID(), installationId, assignmentTransitionId, transitionType,
              { transition_id: assignmentTransitionId, assignment_id: assignment.assignment_id,
                erasure_decision_id: parsed.input.erasure_decision_id }, acceptedAt]
          );
          transitionOffset += 1n;
        }
        const invalidationId = deterministicUuid({ namespace: "diagnostic-assignment-material-invalidation",
          assignment_id: assignment.assignment_id,
          erasure_decision_id: parsed.input.erasure_decision_id });
        const invalidationDocument = {
          schema_version: "alphonse.diagnostic-assignment-material-invalidation.v0.1",
          invalidation_id: invalidationId,
          assignment_id: assignment.assignment_id,
          assignment_digest: assignment.assignment_digest,
          evidence_package_id: assignment.evidence_package_id,
          erasure_decision_id: parsed.input.erasure_decision_id,
          artifact_digest: parsed.input.artifact_digest,
          prior_state: assignment.state,
          action,
          workspace_destruction_required: action === "cancelled_claimed",
          broker_revocation_required: action === "cancelled_claimed",
          created_at: acceptedAt
        };
        await client.query(
          `INSERT INTO diagnostic_assignment_material_invalidations
            (invalidation_id,installation_id,environment_id,assignment_id,evidence_package_id,
             erasure_decision_id,action,workspace_destruction_required,broker_revocation_required,
             invalidation_document,invalidation_digest,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [invalidationId, installationId, environmentId, assignment.assignment_id,
            assignment.evidence_package_id, parsed.input.erasure_decision_id, action,
            action === "cancelled_claimed", action === "cancelled_claimed", invalidationDocument,
            sha256Digest(invalidationDocument), acceptedAt]
        );
        invalidations.push(invalidationDocument);
      }
      const transition = {
        transition_id: mainTransitionId,
        type: "diagnostic.material_erasure.availability_revoked",
        diagnostic_sequence: String(node.next_sequence),
        from_revision: "0",
        to_revision: "1"
      };
      const result = {
        command_id: parsed.command_id,
        request_digest: acceptedDigest,
        accepted_at: acceptedAt,
        operation_id: parsed.operation_id,
        actor: { type: actor.type, id: actor.id },
        authorization: actor.authorization ?? {},
        material_erasure: {
          erasure_decision_id: parsed.input.erasure_decision_id,
          artifact_digest: parsed.input.artifact_digest,
          material_class: impact.materialClass,
          decision_digest: decisionMaterial.digest,
          impact_manifest_digest: impactManifest.digest,
          material_state: "revoked_pending_deletion",
          physical_deletion: "pending",
          package_availability: packageAvailability,
          assignment_invalidations: invalidations,
          universal_deletion_established: false
        },
        transition
      };
      await client.query(
        `INSERT INTO diagnostic_commands
          (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,
           authorization_context,result,accepted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [installationId, parsed.command_id, acceptedDigest, parsed.operation_id,
          actor.type, actor.id, actor.authorization ?? {}, result, acceptedAt]
      );
      await client.query(
        `INSERT INTO diagnostic_transitions
          (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,
           transition_type,from_revision,to_revision,command_id,actor_type,actor_id,
           authorization_context,payload,occurred_at)
         VALUES ($1,$2,$3,'diagnostic_material_erasure',$4,$5,0,1,$6,$7,$8,$9,$10,$11)`,
        [mainTransitionId, installationId, String(node.next_sequence),
          parsed.input.erasure_decision_id, transition.type, parsed.command_id,
          actor.type, actor.id, actor.authorization ?? {}, {
            erasure_decision_id: parsed.input.erasure_decision_id,
            artifact_digest: parsed.input.artifact_digest,
            decision_digest: decisionMaterial.digest,
            affected_package_ids: impact.affectedPackages.map((entry) => entry.evidence_package_id),
            affected_assignment_ids: lockedAssignments.map((entry) => entry.assignment_id),
            material_access: "revoked", physical_deletion: "pending"
          }, acceptedAt]
      );
      await client.query(
        `INSERT INTO diagnostic_outbox
          (outbox_id,installation_id,transition_id,event_type,payload,created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), installationId, mainTransitionId, transition.type, {
          transition_id: mainTransitionId,
          erasure_decision_id: parsed.input.erasure_decision_id,
          artifact_digest: parsed.input.artifact_digest
        }, acceptedAt]
      );
      await client.query(
        `INSERT INTO diagnostic_material_states
          (erasure_decision_id,installation_id,environment_id,artifact_digest,state,
           state_revision,last_transition_id,updated_at)
         VALUES ($1,$2,$3,$4,'revoked_pending_deletion',0,$5,$6)`,
        [parsed.input.erasure_decision_id, installationId, environmentId,
          parsed.input.artifact_digest, mainTransitionId, acceptedAt]
      );
      await client.query(
        `UPDATE diagnostic_nodes SET revision=revision+$2,next_sequence=next_sequence+$2,updated_at=$3
         WHERE installation_id=$1`, [installationId, String(transitionOffset), acceptedAt]
      );
      await client.query("COMMIT");
      return { replayed: false, result };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function completeErasure(value, actor) {
    const parsed = validateMaterialDeletionCommand(value);
    const acceptedDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId,
      command: value, actor });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${installationId}:${parsed.command_id}`]);
      const replay = await commandReplay(client, parsed.command_id, acceptedDigest);
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      await lockMaterialMutation(client);
      const { decision, state } = await loadDecision(client,
        parsed.input.erasure_decision_id, true);
      const acceptedAt = new Date().toISOString();
      const node = (await client.query(
        "SELECT revision,next_sequence FROM diagnostic_nodes WHERE installation_id=$1 FOR UPDATE",
        [installationId]
      )).rows[0];
      const aggregateRevision = BigInt((await client.query(
        `SELECT COALESCE(MAX(to_revision),0)::text AS revision FROM diagnostic_transitions
         WHERE installation_id=$1 AND aggregate_type='diagnostic_material_erasure' AND aggregate_id=$2`,
        [installationId, decision.erasure_decision_id]
      )).rows[0].revision);
      let attempt = null;
      let tombstone = (await client.query(
        "SELECT * FROM diagnostic_artifact_erasure_tombstones WHERE erasure_decision_id=$1",
        [decision.erasure_decision_id]
      )).rows[0] ?? null;
      let eventType = "diagnostic.material_erasure.deletion_reused";
      let physicalDeletion = "verified_absent";
      if (state.state === "revoked_pending_deletion") {
        const attemptId = randomUUID();
        let deletion;
        let outcome;
        let verificationStatus;
        let errorCode = null;
        try {
          deletion = await artifactStore.deleteJson(decision.artifact_digest);
          outcome = deletion.bytes_deleted ? "deleted" : "already_absent";
          verificationStatus = "verified_absent";
        } catch (error) {
          outcome = "failed";
          verificationStatus = "unverified";
          errorCode = error.code ?? error.name ?? "ARTIFACT_DELETE_FAILED";
        }
        const attemptMaterial = buildDeletionAttemptDocument({
          attemptId,
          decision,
          outcome,
          verificationStatus,
          errorCode,
          attemptedBy: actor.id,
          attemptedAt: acceptedAt
        });
        attempt = (await client.query(
          `INSERT INTO diagnostic_material_deletion_attempts
            (deletion_attempt_id,erasure_decision_id,installation_id,artifact_digest,outcome,
             verification_status,error_code,attempt_document,attempt_digest,attempted_by,attempted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [attemptId, decision.erasure_decision_id, installationId, decision.artifact_digest,
            outcome, verificationStatus, errorCode, attemptMaterial.document,
            attemptMaterial.digest, actor.id, acceptedAt]
        )).rows[0];
        if (verificationStatus === "verified_absent") {
          const tombstoneMaterial = buildMaterialTombstoneDocument({
            decision,
            deletionAttempt: attempt,
            completedAt: acceptedAt
          });
          tombstone = (await client.query(
            `INSERT INTO diagnostic_artifact_erasure_tombstones
              (erasure_decision_id,installation_id,environment_id,artifact_digest,
               deletion_attempt_id,tombstone_document,tombstone_digest,completed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [decision.erasure_decision_id, installationId, environmentId,
              decision.artifact_digest, attempt.deletion_attempt_id, tombstoneMaterial.document,
              tombstoneMaterial.digest, acceptedAt]
          )).rows[0];
          eventType = "diagnostic.material_erasure.deleted_verified";
        } else {
          eventType = "diagnostic.material_erasure.deletion_incomplete";
          physicalDeletion = "incomplete";
        }
      }
      const transitionId = randomUUID();
      const transition = {
        transition_id: transitionId,
        type: eventType,
        diagnostic_sequence: String(node.next_sequence),
        from_revision: String(aggregateRevision),
        to_revision: String(aggregateRevision + 1n)
      };
      const result = {
        command_id: parsed.command_id,
        request_digest: acceptedDigest,
        accepted_at: acceptedAt,
        operation_id: parsed.operation_id,
        actor: { type: actor.type, id: actor.id },
        authorization: actor.authorization ?? {},
        material_erasure: {
          erasure_decision_id: decision.erasure_decision_id,
          artifact_digest: decision.artifact_digest,
          material_state: tombstone ? "deleted_verified" : "revoked_pending_deletion",
          physical_deletion: physicalDeletion,
          deletion_attempt: attempt ? {
            deletion_attempt_id: attempt.deletion_attempt_id,
            outcome: attempt.outcome,
            verification_status: attempt.verification_status,
            error_code: attempt.error_code,
            attempt_digest: attempt.attempt_digest
          } : null,
          tombstone: tombstone ? {
            tombstone_digest: tombstone.tombstone_digest,
            document: tombstone.tombstone_document
          } : null,
          universal_deletion_established: false
        },
        transition
      };
      await client.query(
        `INSERT INTO diagnostic_commands
          (installation_id,command_id,request_digest,operation_id,actor_type,actor_id,
           authorization_context,result,accepted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [installationId, parsed.command_id, acceptedDigest, parsed.operation_id,
          actor.type, actor.id, actor.authorization ?? {}, result, acceptedAt]
      );
      await client.query(
        `INSERT INTO diagnostic_transitions
          (transition_id,installation_id,diagnostic_sequence,aggregate_type,aggregate_id,
           transition_type,from_revision,to_revision,command_id,actor_type,actor_id,
           authorization_context,payload,occurred_at)
         VALUES ($1,$2,$3,'diagnostic_material_erasure',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [transitionId, installationId, String(node.next_sequence), decision.erasure_decision_id,
          eventType, transition.from_revision, transition.to_revision, parsed.command_id,
          actor.type, actor.id, actor.authorization ?? {}, {
            erasure_decision_id: decision.erasure_decision_id,
            artifact_digest: decision.artifact_digest,
            physical_deletion: physicalDeletion,
            deletion_attempt_id: attempt?.deletion_attempt_id ?? null,
            tombstone_digest: tombstone?.tombstone_digest ?? null
          }, acceptedAt]
      );
      await client.query(
        `INSERT INTO diagnostic_outbox
          (outbox_id,installation_id,transition_id,event_type,payload,created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), installationId, transitionId, eventType, {
          transition_id: transitionId,
          erasure_decision_id: decision.erasure_decision_id,
          artifact_digest: decision.artifact_digest,
          physical_deletion: physicalDeletion
        }, acceptedAt]
      );
      if (tombstone && state.state === "revoked_pending_deletion") {
        const advanced = await client.query(
          `UPDATE diagnostic_material_states
           SET state='deleted_verified',state_revision=state_revision+1,last_transition_id=$2,updated_at=$3
           WHERE erasure_decision_id=$1 AND state='revoked_pending_deletion' AND state_revision=$4`,
          [decision.erasure_decision_id, transitionId, acceptedAt, state.state_revision]
        );
        if (advanced.rowCount !== 1) throw new KernelError(409,
          "DIAGNOSTIC_MATERIAL_ERASURE_COMPLETION_RACE",
          "Material state changed before local deletion completion could commit.");
      }
      await client.query(
        `UPDATE diagnostic_nodes SET revision=revision+1,next_sequence=next_sequence+1,updated_at=$2
         WHERE installation_id=$1`, [installationId, acceptedAt]
      );
      await client.query("COMMIT");
      return { replayed: false, result };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function getErasure(decisionId) {
    if (typeof decisionId !== "string" || !UUID.test(decisionId)) throw new KernelError(400,
      "DIAGNOSTIC_MATERIAL_ERASURE_INPUT_INVALID", "erasure_decision_id must be a UUID.");
    return materialView(decisionId);
  }

  async function getPackageAvailability(evidencePackageId) {
    if (typeof evidencePackageId !== "string" || !UUID.test(evidencePackageId)) {
      throw new KernelError(400, "DIAGNOSTIC_MATERIAL_AVAILABILITY_INPUT_INVALID",
        "evidence_package_id must be a UUID.");
    }
    const client = await pool.connect();
    let material;
    try {
      material = await packageArtifactDigests(client, evidencePackageId);
      const state = (await client.query(
        `SELECT * FROM diagnostic_package_material_availability_states
         WHERE evidence_package_id=$1`, [evidencePackageId]
      )).rows[0];
      if (state) {
        const events = (await client.query(
          `SELECT * FROM diagnostic_package_material_availability_events
           WHERE evidence_package_id=$1 ORDER BY to_revision,availability_event_id`,
          [evidencePackageId]
        )).rows;
        let expectedFrom = 0n;
        for (const event of events) {
          const document = event.event_document;
          if (sha256Digest(document) !== event.event_digest
              || document.availability_event_id !== event.availability_event_id
              || document.evidence_package_id !== event.evidence_package_id
              || document.erasure_decision_id !== event.erasure_decision_id
              || document.from_revision !== String(event.from_revision)
              || document.to_revision !== String(event.to_revision)
              || document.from_status !== event.from_status
              || document.to_status !== event.to_status
              || document.occurred_at !== iso(event.occurred_at)
              || BigInt(event.from_revision) !== expectedFrom
              || BigInt(event.to_revision) !== expectedFrom + 1n) {
            throw new KernelError(500,
              "DIAGNOSTIC_PACKAGE_MATERIAL_AVAILABILITY_INTEGRITY_VIOLATION",
              "Stored package material availability history is not a contiguous immutable chain.");
          }
          expectedFrom += 1n;
        }
        if (sha256Digest(state.projection_document) !== state.projection_digest
            || state.projection_document.evidence_package_id !== evidencePackageId
            || state.projection_document.material_status !== state.material_status
            || state.projection_document.execution_eligible !== state.execution_eligible
            || state.projection_document.integrity_status !== state.integrity_status
            || state.projection_document.cause !== state.cause
            || state.projection_document.current_as_of !== iso(state.current_as_of)
            || String(state.state_revision) !== String(expectedFrom)
            || state.last_event_id !== events.at(-1)?.availability_event_id) {
          throw new KernelError(500, "DIAGNOSTIC_PACKAGE_MATERIAL_AVAILABILITY_INTEGRITY_VIOLATION",
            "Stored package material availability does not match its deterministic projection.");
        }
        return state.projection_document;
      }
    } finally {
      client.release();
    }
    const checkedAt = new Date().toISOString();
    const failures = [];
    for (const artifactDigest of material.artifactDigests) {
      try {
        await artifactStore.getBytes(artifactDigest);
      } catch (error) {
        failures.push({ artifact_digest: artifactDigest, code: error.code ?? error.name });
      }
    }
    if (failures.length) {
      return {
        schema_version: DIAGNOSTIC_PACKAGE_MATERIAL_AVAILABILITY_SCHEMA,
        evidence_package_id: evidencePackageId,
        material_status: failures.some((entry) =>
          entry.artifact_digest === material.packageRow.package_artifact_digest)
          ? "material_unavailable" : "partially_unavailable",
        execution_eligible: false,
        integrity_status: "integrity_violation",
        cause: "missing_corrupt_or_unexplained_material",
        failures,
        current_as_of: checkedAt,
        temporal_claim: "current_material_availability_not_historical_package_identity"
      };
    }
    return {
      schema_version: DIAGNOSTIC_PACKAGE_MATERIAL_AVAILABILITY_SCHEMA,
      evidence_package_id: evidencePackageId,
      material_status: "complete",
      execution_eligible: true,
      integrity_status: "verified_present",
      cause: "none",
      verified_artifact_digests: material.artifactDigests,
      current_as_of: checkedAt,
      temporal_claim: "current_material_availability_not_historical_package_identity"
    };
  }

  async function getArtifactRestriction(artifactDigest) {
    if (typeof artifactDigest !== "string" || !DIGEST.test(artifactDigest)) throw new KernelError(400,
      "DIAGNOSTIC_MATERIAL_ERASURE_INPUT_INVALID", "artifact_digest must be an exact SHA-256 digest.");
    const client = await pool.connect();
    try {
      const state = await loadRestriction(client, artifactDigest);
      if (!state) return null;
      if (state.state === "legacy_deleted") return { artifact_digest: artifactDigest,
        material_state: "deleted_verified", legacy: true };
      return materialView(state.erasure_decision_id, client);
    } finally {
      client.release();
    }
  }

  async function retireLegacy(value, actor) {
    const marked = await requestErasure(value, actor, { legacy: true });
    const parsed = legacyCommand(value);
    const completed = await completeErasure({
      command_id: `${parsed.command_id}:complete-material-erasure`,
      operation_id: "diagnostic.material_erasure.complete",
      input: { erasure_decision_id: parsed.input.erasure_decision_id }
    }, actor);
    const tombstone = completed.result.material_erasure.tombstone;
    return {
      replayed: marked.replayed && completed.replayed,
      result: {
        ...marked.result,
        artifact_tombstone: {
          artifact_digest: parsed.input.artifact_digest,
          deletion_reason: parsed.input.reason,
          deleted_by: { type: actor.type, id: actor.id },
          deleted_at: tombstone?.document?.completed_at ?? completed.result.accepted_at,
          bytes_deleted: completed.result.material_erasure.deletion_attempt?.outcome === "deleted",
          retained_identity: true,
          erasure_decision_id: parsed.input.erasure_decision_id,
          tombstone_digest: tombstone?.tombstone_digest ?? null,
          universal_deletion_established: false
        }
      }
    };
  }

  return {
    assertArtifactDigestsAdmissible,
    assertPackageMaterialAdmissible,
    completeErasure,
    createArtifactAccessGuard,
    getArtifactRestriction,
    getErasure,
    getPackageAvailability,
    lockMaterialMutation,
    requestErasure,
    runMaterialMutationExclusive,
    retireLegacy
  };
}
