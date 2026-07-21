import { randomUUID } from "node:crypto";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import {
  buildCoverageCompilation,
  buildCoverageValidation,
  COVERAGE_COMPILER_ID,
  COVERAGE_COMPILER_VERSION,
  COVERAGE_VALIDATOR_ID,
  COVERAGE_VALIDATOR_VERSION,
  validateCoverageCompileCommand,
  validateCoverageValidateCommand
} from "./coverage-compilation-contracts.js";
import {
  COVERAGE_COMPILATION_STAGE_ARTIFACT_DIGEST,
  COVERAGE_COMPILATION_STAGE_ARTIFACT_MANIFEST
} from "./coverage-compilation-artifact.js";
import { KernelError } from "./errors.js";
import { prepareStageArtifactArchive, recordStageArtifactArchive } from "./stage-artifact-archive.js";

function requestDigest(installationId, environmentId, command) {
  return sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
}

function actorFor(passport) { return { type: "agent", id: passport.agent_principal_id }; }

export function createCoverageCompilationService({ database, artifactStore, coverageOnboardingService,
  coverageReviewService, coverageReviewApprovalService, installationId, environmentId }) {
  const { pool, executeCommand } = database;
  const coverageInternal = coverageOnboardingService?.internal;
  if (!coverageInternal) throw new Error("Coverage Onboarding internal persistence seam is required.");
  const compiler = Object.freeze({ id: COVERAGE_COMPILER_ID, version: COVERAGE_COMPILER_VERSION,
    artifact_digest: COVERAGE_COMPILATION_STAGE_ARTIFACT_DIGEST });
  const validator = Object.freeze({ id: COVERAGE_VALIDATOR_ID, version: COVERAGE_VALIDATOR_VERSION,
    artifact_digest: COVERAGE_COMPILATION_STAGE_ARTIFACT_DIGEST });

  async function commandReplay(command, digest) {
    const existing = await pool.query(
      `SELECT request_digest,result FROM diagnostic_commands
       WHERE installation_id=$1 AND command_id=$2`, [installationId, command.command_id]
    );
    if (!existing.rows[0]) return null;
    if (existing.rows[0].request_digest !== digest) {
      throw new KernelError(409, "IDEMPOTENCY_CONFLICT",
        "Diagnostic command ID was reused with different input.");
    }
    return { replayed: true, result: existing.rows[0].result };
  }

  function assertAgent(onboarding, passport) {
    if (onboarding.environment_id !== environmentId
        || onboarding.agent.passport_id !== passport.passport_id
        || onboarding.agent.agent_principal_id !== passport.agent_principal_id) {
      throw new KernelError(403, "COVERAGE_COMPILATION_AGENT_MISMATCH",
        "Authenticated Passport does not match the exact Coverage Onboarding agent.");
    }
  }

  async function compilationRow(compilationId, client = pool) {
    const row = (await client.query(
      `SELECT * FROM diagnostic_coverage_compilations
       WHERE installation_id=$1 AND compilation_id=$2`, [installationId, compilationId]
    )).rows[0];
    if (!row) throw new KernelError(404, "COVERAGE_COMPILATION_NOT_FOUND",
      "Coverage compilation does not exist.");
    return row;
  }

  async function compilationMaterial(row) {
    const [specification, manifest] = await Promise.all([
      artifactStore.getJson(row.coverage_specification_digest),
      artifactStore.getJson(row.workflow_manifest_proposal_digest)
    ]);
    if (sha256Digest(row.compilation_input) !== row.compilation_input_digest
        || row.compilation_input.review_bundle_digest !== row.review_bundle_digest
        || row.compilation_input.approval_id !== row.approval_id
        || row.compilation_input.approval_digest !== row.approval_digest
        || row.compilation_input.review_state_digest !== row.review_state_digest
        || canonicalize(row.compilation_input.compiler) !== canonicalize(row.compiler)
        || row.compiler.artifact_digest !== row.compiler_artifact_digest
        || specification.artifact.artifact_digest !== row.coverage_specification_digest
        || sha256Digest(specification.content) !== row.coverage_specification_digest
        || manifest.artifact.artifact_digest !== row.workflow_manifest_proposal_digest
        || sha256Digest(manifest.content) !== row.workflow_manifest_proposal_digest) {
      throw new KernelError(500, "COVERAGE_COMPILATION_INTEGRITY_VIOLATION",
        "Coverage compilation row and verified semantic artifacts do not match.");
    }
    return { compilation_input: row.compilation_input,
      compilation_input_digest: row.compilation_input_digest,
      coverage_specification: specification.content,
      coverage_specification_digest: row.coverage_specification_digest,
      workflow_manifest_proposal: manifest.content,
      workflow_manifest_proposal_digest: row.workflow_manifest_proposal_digest };
  }

  function compilationView(row, material) {
    return {
      compilation_id: row.compilation_id,
      onboarding_id: row.onboarding_id,
      review_bundle_digest: row.review_bundle_digest,
      approval_id: row.approval_id,
      approval_digest: row.approval_digest,
      review_state_digest: row.review_state_digest,
      compilation_input: material.compilation_input,
      compilation_input_digest: material.compilation_input_digest,
      compiler: row.compiler,
      coverage_specification_digest: material.coverage_specification_digest,
      workflow_manifest_proposal_digest: material.workflow_manifest_proposal_digest,
      coverage_specification: material.coverage_specification,
      workflow_manifest_proposal: material.workflow_manifest_proposal,
      compiled_by: { type: row.compiled_by_actor_type, id: row.compiled_by_actor_id },
      compiled_at: new Date(row.compiled_at).toISOString(),
      side_effects: "none",
      authority: "none",
      immutable: true
    };
  }

  async function getCompilation(compilationId, client = pool) {
    const row = await compilationRow(compilationId, client);
    return compilationView(row, await compilationMaterial(row));
  }

  async function validationRow(validationId, client = pool) {
    const row = (await client.query(
      `SELECT * FROM diagnostic_coverage_validations
       WHERE installation_id=$1 AND validation_id=$2`, [installationId, validationId]
    )).rows[0];
    if (!row) throw new KernelError(404, "COVERAGE_VALIDATION_NOT_FOUND",
      "Coverage validation does not exist.");
    return row;
  }

  async function validationView(row) {
    const stored = await artifactStore.getJson(row.validation_receipt_digest);
    if (stored.artifact.artifact_digest !== row.validation_receipt_digest
        || sha256Digest(stored.content) !== row.validation_receipt_digest
        || stored.content.status !== row.status
        || canonicalize(stored.content.validator) !== canonicalize(row.validator)
        || row.validator.artifact_digest !== row.validator_artifact_digest
        || stored.content.workflow_manifest_proposal_digest
          !== row.eligible_workflow_manifest_proposal_digest) {
      throw new KernelError(500, "COVERAGE_VALIDATION_INTEGRITY_VIOLATION",
        "Coverage validation row and verified receipt bytes do not match.");
    }
    return {
      validation_id: row.validation_id,
      compilation_id: row.compilation_id,
      onboarding_id: row.onboarding_id,
      validation_input_digest: row.validation_input_digest,
      validation_receipt_digest: row.validation_receipt_digest,
      validator: row.validator,
      status: row.status,
      workflow_manifest_proposal_digest: row.eligible_workflow_manifest_proposal_digest,
      receipt: stored.content,
      validated_by: { type: row.validated_by_actor_type, id: row.validated_by_actor_id },
      validated_at: new Date(row.validated_at).toISOString(),
      registration_request_eligible: false,
      authority: "none",
      immutable: true
    };
  }

  async function getValidation(validationId) {
    return validationView(await validationRow(validationId));
  }

  async function compile(value, authenticatedPassport) {
    const envelope = validateCoverageCompileCommand(value);
    if (canonicalize(envelope.input.compiler) !== canonicalize(compiler)) {
      throw new KernelError(409, "COVERAGE_COMPILER_IDENTITY_MISMATCH",
        "Compilation command must bind the exact active compiler implementation identity.");
    }
    const actor = actorFor(authenticatedPassport);
    const command = { ...envelope, actor };
    const digest = requestDigest(installationId, environmentId, command);
    const replay = await commandReplay(command, digest);
    if (replay) return replay;
    const onboarding = await coverageInternal.loadOnboarding(envelope.input.onboarding_id);
    assertAgent(onboarding, authenticatedPassport);
    const approval = await coverageReviewApprovalService.assertEligible(
      envelope.input.approval_id, envelope.input.review_bundle_digest);
    const reviewBundle = await coverageReviewService.get(envelope.input.review_bundle_digest);
    const built = buildCoverageCompilation({ reviewBundle, approval, input: envelope.input, compiler });
    const [storedSpecification, storedManifest, preparedStageArchive] = await Promise.all([
      artifactStore.putJson(built.coverage_specification),
      artifactStore.putJson(built.workflow_manifest_proposal),
      prepareStageArtifactArchive(artifactStore, COVERAGE_COMPILATION_STAGE_ARTIFACT_MANIFEST)
    ]);
    const compilationId = randomUUID();
    return executeCommand({
      installationId,
      command,
      requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-onboarding:${onboarding.onboarding_id}`
        ]);
        const current = await coverageInternal.loadOnboarding(onboarding.onboarding_id, client);
        assertAgent(current, authenticatedPassport);
        if (current.active_review_bundle_digest !== envelope.input.review_bundle_digest) {
          throw new KernelError(409, "COVERAGE_COMPILATION_REVIEW_STALE",
            "Coverage compilation requires the exact active Review Bundle.");
        }
        const currentApproval = await coverageReviewApprovalService.assertEligible(
          envelope.input.approval_id, envelope.input.review_bundle_digest);
        buildCoverageCompilation({ reviewBundle, approval: currentApproval, input: envelope.input, compiler });
        const reused = (await client.query(
          `SELECT * FROM diagnostic_coverage_compilations
           WHERE installation_id=$1 AND compilation_input_digest=$2 AND compiler_artifact_digest=$3`,
          [installationId, built.compilation_input_digest, compiler.artifact_digest]
        )).rows[0];
        if (reused) {
          const material = await compilationMaterial(reused);
          return { aggregateType: "coverage_compilation", aggregateId: reused.compilation_id,
            transitionType: "diagnostic.coverage_compilation.reused", fromRevision: current.revision,
            toRevision: current.revision, transitionPayload: {
              compilation_input_digest: built.compilation_input_digest },
            result: { coverage_onboarding: current,
              coverage_compilation: compilationView(reused, material), created: false } };
        }
        await recordStageArtifactArchive({ client, installationId, prepared: preparedStageArchive,
          archivedAt: acceptedAt });
        for (const stored of [storedSpecification, storedManifest]) {
          await client.query(
            `INSERT INTO diagnostic_artifacts
              (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
            [installationId, stored.artifact_digest, stored.size_bytes, stored.media_type,
              stored.storage_key, acceptedAt]
          );
        }
        const eventIndex = current.revision + 1;
        await client.query(
          `INSERT INTO diagnostic_coverage_compilations
            (compilation_id,installation_id,onboarding_id,base_onboarding_revision,
             base_event_head_digest,review_bundle_digest,approval_id,approval_digest,review_state_digest,
             compilation_input,compilation_input_digest,compiler,compiler_artifact_digest,
             coverage_specification_digest,workflow_manifest_proposal_digest,event_index,
             compiled_by_actor_type,compiled_by_actor_id,compiled_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [compilationId, installationId, current.onboarding_id, current.revision,
            current.event_head_digest, envelope.input.review_bundle_digest, currentApproval.approval_id,
            currentApproval.approval_digest, currentApproval.review_state_digest, built.compilation_input,
            built.compilation_input_digest, compiler, compiler.artifact_digest,
            storedSpecification.artifact_digest, storedManifest.artifact_digest, eventIndex,
            actor.type, actor.id, acceptedAt]
        );
        const payload = { compilation_id: compilationId,
          compilation_input_digest: built.compilation_input_digest,
          compiler_artifact_digest: compiler.artifact_digest,
          coverage_specification_digest: storedSpecification.artifact_digest,
          workflow_manifest_proposal_digest: storedManifest.artifact_digest,
          review_bundle_digest: envelope.input.review_bundle_digest,
          approval_digest: currentApproval.approval_digest,
          authority: "none" };
        await coverageInternal.appendEvent(client, { onboardingId: current.onboarding_id, eventIndex,
          eventType: "coverage_compiled", priorEventDigest: current.event_head_digest,
          payload, actor, occurredAt: acceptedAt });
        const projection = await coverageInternal.loadOnboarding(current.onboarding_id, client);
        const row = await compilationRow(compilationId, client);
        return { aggregateType: "coverage_compilation", aggregateId: compilationId,
          transitionType: "diagnostic.coverage_specification.compiled", fromRevision: current.revision,
          toRevision: projection.revision, transitionPayload: payload,
          result: { coverage_onboarding: projection,
            coverage_compilation: compilationView(row, built), created: true } };
      }
    });
  }

  async function validate(value, authenticatedPassport) {
    const envelope = validateCoverageValidateCommand(value);
    if (canonicalize(envelope.input.validator) !== canonicalize(validator)) {
      throw new KernelError(409, "COVERAGE_VALIDATOR_IDENTITY_MISMATCH",
        "Validation command must bind the exact active validator implementation identity.");
    }
    const actor = actorFor(authenticatedPassport);
    const command = { ...envelope, actor };
    const digest = requestDigest(installationId, environmentId, command);
    const replay = await commandReplay(command, digest);
    if (replay) return replay;
    const onboarding = await coverageInternal.loadOnboarding(envelope.input.onboarding_id);
    assertAgent(onboarding, authenticatedPassport);
    const row = await compilationRow(envelope.input.compilation_id);
    const material = await compilationMaterial(row);
    if (row.onboarding_id !== envelope.input.onboarding_id
        || material.compilation_input_digest !== envelope.input.compilation_input_digest
        || material.coverage_specification_digest !== envelope.input.coverage_specification_digest
        || material.workflow_manifest_proposal_digest !== envelope.input.workflow_manifest_proposal_digest) {
      throw new KernelError(409, "COVERAGE_VALIDATION_INPUT_CONFLICT",
        "Validation input must bind one exact immutable compilation and both semantic artifacts.");
    }
    const approval = await coverageReviewApprovalService.assertEligible(row.approval_id,
      row.review_bundle_digest);
    const reviewBundle = await coverageReviewService.get(row.review_bundle_digest);
    const built = buildCoverageValidation({ compilation: material, reviewBundle, approval, validator });
    const [storedReceipt, preparedStageArchive] = await Promise.all([
      artifactStore.putJson(built.receipt),
      prepareStageArtifactArchive(artifactStore, COVERAGE_COMPILATION_STAGE_ARTIFACT_MANIFEST)
    ]);
    const validationId = randomUUID();
    return executeCommand({ installationId, command, requestDigest: digest,
      apply: async (client, { acceptedAt }) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${installationId}:coverage-onboarding:${onboarding.onboarding_id}`
        ]);
        const current = await coverageInternal.loadOnboarding(onboarding.onboarding_id, client);
        assertAgent(current, authenticatedPassport);
        if (current.active_compilation_id !== row.compilation_id
            || current.active_review_bundle_digest !== row.review_bundle_digest) {
          throw new KernelError(409, "COVERAGE_VALIDATION_COMPILATION_STALE",
            "Coverage validation requires the exact active compilation and Review Bundle.");
        }
        await coverageReviewApprovalService.assertEligible(row.approval_id, row.review_bundle_digest);
        const reused = (await client.query(
          `SELECT * FROM diagnostic_coverage_validations WHERE installation_id=$1 AND compilation_id=$2`,
          [installationId, row.compilation_id]
        )).rows[0];
        if (reused) {
          return { aggregateType: "coverage_validation", aggregateId: reused.validation_id,
            transitionType: "diagnostic.coverage_validation.reused", fromRevision: current.revision,
            toRevision: current.revision, transitionPayload: {
              validation_input_digest: built.validation_input_digest },
            result: { coverage_onboarding: current,
              coverage_validation: await validationView(reused), created: false } };
        }
        await recordStageArtifactArchive({ client, installationId, prepared: preparedStageArchive,
          archivedAt: acceptedAt });
        await client.query(
          `INSERT INTO diagnostic_artifacts
            (installation_id,artifact_digest,size_bytes,media_type,storage_key,created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (installation_id,artifact_digest) DO NOTHING`,
          [installationId, storedReceipt.artifact_digest, storedReceipt.size_bytes,
            storedReceipt.media_type, storedReceipt.storage_key, acceptedAt]
        );
        const eventIndex = current.revision + 1;
        await client.query(
          `INSERT INTO diagnostic_coverage_validations
            (validation_id,installation_id,onboarding_id,compilation_id,validation_input_digest,
             validator,validator_artifact_digest,validation_receipt_digest,status,
             eligible_workflow_manifest_proposal_digest,event_index,validated_by_actor_type,
             validated_by_actor_id,validated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [validationId, installationId, current.onboarding_id, row.compilation_id,
            built.validation_input_digest, validator, validator.artifact_digest,
            storedReceipt.artifact_digest, built.receipt.status,
            built.receipt.workflow_manifest_proposal_digest, eventIndex, actor.type, actor.id, acceptedAt]
        );
        const payload = { validation_id: validationId, compilation_id: row.compilation_id,
          validation_input_digest: built.validation_input_digest,
          validator_artifact_digest: validator.artifact_digest,
          validation_receipt_digest: storedReceipt.artifact_digest,
          status: built.receipt.status,
          workflow_manifest_proposal_digest: built.receipt.workflow_manifest_proposal_digest,
          registration_request_eligible: false,
          authority: "none" };
        await coverageInternal.appendEvent(client, { onboardingId: current.onboarding_id, eventIndex,
          eventType: "coverage_validated", priorEventDigest: current.event_head_digest,
          payload, actor, occurredAt: acceptedAt });
        const projection = await coverageInternal.loadOnboarding(current.onboarding_id, client);
        const inserted = await validationRow(validationId, client);
        return { aggregateType: "coverage_validation", aggregateId: validationId,
          transitionType: "diagnostic.coverage_specification.validated", fromRevision: current.revision,
          toRevision: projection.revision, transitionPayload: payload,
          result: { coverage_onboarding: projection,
            coverage_validation: await validationView(inserted), created: true } };
      }
    });
  }

  return { compile, validate, getCompilation, getValidation,
    compiler: structuredClone(compiler), validator: structuredClone(validator) };
}
