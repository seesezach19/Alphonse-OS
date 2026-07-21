import { sha256Digest } from "./canonical-json.js";
import { buildAccountableCoverageProjection, capabilityEvidence,
  validateCoverageVerificationStrategy } from "./coverage-capability-contracts.js";
import { COVERAGE_CAPABILITIES, validateCoverageProfile } from "./coverage-profile-contracts.js";
import { COVERAGE_CAPABILITY_STAGE_ARTIFACT_DIGEST } from "./coverage-capability-artifact.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const gap = (code, detail, blocking = true) => ({ code, detail, blocking });
const limitation = (code, detail) => ({ code, detail, blocking: false });
const evidence = (type, id, digest, observedAt) => ({ evidence_type: type, evidence_id: id,
  evidence_digest: digest, observed_at: new Date(observedAt).toISOString() });
const established = (...items) => capabilityEvidence("established", items, [], []);
const missing = (name, detail) => capabilityEvidence("not_established", [],
  [gap(`coverage.${name}.not_established`, detail)], []);
const unavailable = (name, detail) => capabilityEvidence("unavailable", [],
  [gap(`coverage.${name}.unavailable`, detail)], []);
const indeterminate = (name, items, detail, limitations = []) => capabilityEvidence(
  "indeterminate", items, [gap(`coverage.${name}.indeterminate`, detail)], limitations
);

function referenceDigest(reference) { return reference?.artifact_digest ?? null; }

export function createCoverageCapabilityService({ database, artifactStore,
  coverageOnboardingService, coverageReviewService, coverageCompilationService,
  installationId, environmentId }) {
  const { pool } = database;
  const projector = Object.freeze({ id: "com.alphonse.coverage.capability-projector",
    version: "0.1.0", artifact_digest: COVERAGE_CAPABILITY_STAGE_ARTIFACT_DIGEST });

  async function artifactCreatedAt(artifactDigest) {
    return (await pool.query(
      `SELECT created_at FROM diagnostic_artifacts
       WHERE installation_id=$1 AND artifact_digest=$2`, [installationId, artifactDigest]
    )).rows[0]?.created_at ?? null;
  }

  async function admittedJson(reference) {
    if (!reference) return null;
    const createdAt = await artifactCreatedAt(reference.artifact_digest);
    if (!createdAt) return null;
    const stored = await artifactStore.getJson(reference.artifact_digest);
    return { content: stored.content, created_at: new Date(createdAt).toISOString() };
  }

  async function registeredWorkflow(reference, cutoff) {
    const result = await pool.query(
      `SELECT * FROM diagnostic_agent_workflows
       WHERE installation_id=$1 AND created_at<=$2
         AND external_ref->>'system'=$3 AND external_ref->>'environment'=$4
         AND external_ref->>'workflow_key'=$5
       ORDER BY created_at,workflow_id`,
      [installationId, cutoff, reference.system, reference.environment,
        reference.provider_workflow_id]
    );
    return result.rows;
  }

  async function collect(onboarding) {
    const capabilities = Object.fromEntries(COVERAGE_CAPABILITIES.map((name) =>
      [name, missing(name, "No exact authoritative evidence currently establishes this capability.")]));
    const historicalGaps = [];
    const globalLimitations = [];
    let snapshot = null;
    let snapshotObservedAt = onboarding.opened_at;
    if (onboarding.active_snapshot_digest) {
      const stored = await artifactStore.getJson(onboarding.active_snapshot_digest);
      snapshot = stored.content;
      snapshotObservedAt = onboarding.snapshot_history.find((item) =>
        item.snapshot_digest === onboarding.active_snapshot_digest)?.captured_at ?? onboarding.opened_at;
      capabilities.discovered = established(evidence("workflow_discovery_snapshot",
        onboarding.active_snapshot_digest, onboarding.active_snapshot_digest, snapshotObservedAt));
      const healthEvidence = evidence("runtime_adapter_inventory_health",
        onboarding.active_snapshot_digest, sha256Digest(snapshot.source.health), snapshot.source.observed_at);
      if (snapshot.source.health.status === "healthy") capabilities.connected = established(healthEvidence);
      else if (["degraded", "unknown"].includes(snapshot.source.health.status)) {
        capabilities.connected = indeterminate("connected", [healthEvidence],
          "Adapter inventory health does not establish a healthy scoped connection.",
          [limitation("coverage.connected.inventory_health_limited",
            `Inventory health is ${snapshot.source.health.status}.`)]);
      } else {
        capabilities.connected = unavailable("connected", "Adapter inventory health is unavailable.");
      }
      for (const omission of snapshot.omissions) {
        historicalGaps.push(gap("coverage.discovery.omission",
          `Inventory omission ${omission.code} affected ${omission.count} item(s).`, false));
      }
    } else {
      capabilities.discovered = unavailable("discovered", "No active immutable discovery snapshot exists.");
      capabilities.connected = unavailable("connected", "Connection evidence requires a discovery snapshot.");
    }

    let validation = null;
    let compilation = null;
    let review = null;
    let profile = null;
    let cutoff = snapshot?.source?.source_cutoff ?? snapshotObservedAt;
    if (onboarding.active_validation_id) {
      validation = await coverageCompilationService.getValidation(onboarding.active_validation_id);
      compilation = await coverageCompilationService.getCompilation(validation.compilation_id);
      review = await coverageReviewService.get(compilation.review_bundle_digest);
      cutoff = validation.validated_at;
      if (validation.status === "valid") {
        const storedProfile = await admittedJson(review.content.coverage_profile_reference);
        if (storedProfile) {
          try { profile = validateCoverageProfile(storedProfile.content); }
          catch (error) {
            historicalGaps.push(gap("coverage.profile.invalid",
              `Coverage Profile failed exact validation: ${error.code ?? "COVERAGE_PROFILE_INVALID"}.`));
          }
        } else {
          historicalGaps.push(gap("coverage.profile.unavailable",
            "The exact admitted Coverage Profile artifact is unavailable."));
        }
      } else {
        historicalGaps.push(gap("coverage.validation.invalid",
          "Accountable Coverage policy cannot apply to an invalid Coverage Validation Receipt."));
      }
    } else {
      historicalGaps.push(gap("coverage.validation.unavailable",
        "No active Coverage Validation Receipt exists for the current onboarding material."));
    }

    const workflows = await registeredWorkflow(onboarding.workflow_reference, cutoff);
    let revisions = [];
    if (workflows.length === 1) {
      revisions = (await pool.query(
        `SELECT * FROM diagnostic_agent_revisions
         WHERE installation_id=$1 AND workflow_id=$2 AND created_at<=$3
         ORDER BY created_at,revision_id`, [installationId, workflows[0].workflow_id, cutoff]
      )).rows;
      if (revisions.length === 0) {
        capabilities.revision_bound = missing("revision_bound",
          "The exact registered workflow has no admitted Agent Revision at the cutoff.");
      } else {
        capabilities.revision_bound = indeterminate("revision_bound", [
          evidence("agent_workflow", workflows[0].workflow_id, workflows[0].identity_digest,
            workflows[0].created_at),
          ...revisions.map((row) => evidence("agent_revision", row.revision_id,
            row.material_digest, row.created_at))
        ], "Agent Revisions exist, but no immutable provider Workflow Attestation Binding joins one to the current provider material.");
      }
    } else if (workflows.length > 1) {
      capabilities.revision_bound = indeterminate("revision_bound", workflows.map((row) =>
        evidence("agent_workflow", row.workflow_id, row.identity_digest, row.created_at)),
      "Multiple registered workflow identities match the exact provider reference.");
    }

    if (workflows.length === 1 && revisions.length > 0) {
      const runtimeRows = (await pool.query(
        `SELECT r.receipt_id,r.envelope_digest,r.received_at,r.lifecycle_claim
         FROM diagnostic_runtime_event_receipts r
         JOIN diagnostic_external_activity_traces t ON t.trace_id=r.trace_id
         WHERE r.installation_id=$1 AND t.workflow_id=$2 AND r.received_at<=$3
         ORDER BY r.received_at,r.receipt_id`, [installationId, workflows[0].workflow_id, cutoff]
      )).rows;
      if (runtimeRows.length > 0) {
        capabilities.execution_observed = indeterminate("execution_observed", runtimeRows.map((row) =>
          evidence("runtime_event_receipt", row.receipt_id, row.envelope_digest, row.received_at)),
        "Signed runtime claims exist, but a complete observation basis is not bound at this cutoff.",
        [limitation("coverage.execution_observed.destination_commitment_not_established",
          "Runtime success or acknowledgement never establishes destination commitment.")]);
      } else {
        capabilities.execution_observed = missing("execution_observed",
          "No accepted signed runtime observations exist for the registered workflow at the cutoff.");
      }
    }

    const policyActivations = (await pool.query(
      `SELECT evidence_policy_activation_id,activation_digest,activated_at
       FROM diagnostic_evidence_policy_activations
       WHERE installation_id=$1 AND environment_id=$2 AND activated_at<=$3
       ORDER BY activated_at,evidence_policy_activation_id`, [installationId, environmentId, cutoff]
    )).rows;
    const assignmentActivations = (await pool.query(
      `SELECT assignment_policy_activation_id,activation_digest,activated_at
       FROM diagnostic_assignment_policy_activations
       WHERE installation_id=$1 AND environment_id=$2 AND activated_at<=$3
       ORDER BY activated_at,assignment_policy_activation_id`, [installationId, environmentId, cutoff]
    )).rows;
    if (policyActivations.length && assignmentActivations.length && review) {
      capabilities.diagnosable = indeterminate("diagnosable", [
        ...policyActivations.map((row) => evidence("evidence_policy_activation",
          row.evidence_policy_activation_id, row.activation_digest, row.activated_at)),
        ...assignmentActivations.map((row) => evidence("assignment_policy_activation",
          row.assignment_policy_activation_id, row.activation_digest, row.activated_at))
      ], "Diagnostic policies exist, but no exact workflow-specific evidence route and source-availability binding is admitted.");
    } else {
      capabilities.diagnosable = missing("diagnosable",
        "Exact extraction/redaction, evidence routing, assignment, and required-source availability are not all established.");
    }

    const behaviorReference = review?.content.behavior_contract_references?.[0] ?? null;
    if (!behaviorReference) {
      capabilities.behavior_monitored = unavailable("behavior_monitored",
        "No optional Behavior Contract was admitted for this onboarding.");
    } else {
      const activations = (await pool.query(
        `SELECT activation_id,activation_digest,activated_at FROM diagnostic_interpretation_activations
         WHERE installation_id=$1 AND environment_id=$2 AND behavior_contract_digest=$3
           AND activated_at<=$4 ORDER BY activated_at,activation_id`,
        [installationId, environmentId, behaviorReference.artifact_digest, cutoff]
      )).rows;
      if (!activations.length) {
        capabilities.behavior_monitored = missing("behavior_monitored",
          "The admitted Behavior Contract has no exact active interpreter/evaluator binding at the cutoff.");
      } else {
        capabilities.behavior_monitored = indeterminate("behavior_monitored", activations.map((row) =>
          evidence("interpretation_activation", row.activation_id, row.activation_digest, row.activated_at)),
        "A Behavior Contract is active, but exact workflow source coverage remains unestablished.");
      }
    }

    let repairBinding = null;
    const repairReference = review?.content.repair_binding_reference ?? null;
    if (repairReference && UUID.test(repairReference.reference_id)) {
      repairBinding = (await pool.query(
        `SELECT * FROM diagnostic_repair_delivery_bindings
         WHERE installation_id=$1 AND binding_id=$2 AND binding_digest=$3 AND created_at<=$4`,
        [installationId, repairReference.reference_id, repairReference.artifact_digest, cutoff]
      )).rows[0] ?? null;
    }
    const repairOperations = ["inspect", "snapshot", "candidate", "rollback"];
    if (repairBinding && repairOperations.every((name) => repairBinding.permitted_operations.includes(name))
        && repairBinding.target.system === onboarding.workflow_reference.system
        && repairBinding.target.environment === onboarding.workflow_reference.environment
        && repairBinding.target.target_id === onboarding.workflow_reference.provider_workflow_id) {
      capabilities.repair_bound = established(evidence("repair_delivery_binding",
        repairBinding.binding_id, repairBinding.binding_digest, repairBinding.created_at));
    } else {
      capabilities.repair_bound = missing("repair_bound",
        "No exact target-matched Repair Delivery Binding establishes inspect, snapshot, inactive candidate, and rollback operations.");
    }

    let verificationStrategy = null;
    const strategyReference = review?.content.verification_strategy_reference ?? null;
    const strategyArtifact = await admittedJson(strategyReference);
    if (strategyArtifact) {
      try { verificationStrategy = validateCoverageVerificationStrategy(strategyArtifact.content); }
      catch (error) {
        capabilities.verification_ready = unavailable("verification_ready",
          `The admitted verification strategy is invalid: ${error.code ?? "COVERAGE_CAPABILITY_INPUT_INVALID"}.`);
      }
    }
    if (verificationStrategy) {
      const requiredDigests = [...verificationStrategy.critical_path_fixture_digests,
        ...verificationStrategy.deterministic_stub_digests, ...verificationStrategy.assertion_digests];
      const available = (await pool.query(
        `SELECT artifact_digest FROM diagnostic_artifacts
         WHERE installation_id=$1 AND artifact_digest=ANY($2::text[])`,
        [installationId, requiredDigests]
      )).rows.map((row) => row.artifact_digest);
      const reviewedFixtures = new Set(review.content.fixture_references.map(referenceDigest));
      if (requiredDigests.every((item) => available.includes(item))
          && verificationStrategy.critical_path_fixture_digests.every((item) => reviewedFixtures.has(item))) {
        capabilities.verification_ready = established(evidence("coverage_verification_strategy",
          strategyReference.reference_id, strategyReference.artifact_digest, strategyArtifact.created_at));
      } else {
        capabilities.verification_ready = missing("verification_ready",
          "Verification strategy dependencies are unavailable or its critical fixtures were not admitted for review.");
      }
    } else if (!strategyArtifact) {
      capabilities.verification_ready = unavailable("verification_ready",
        "No exact admitted verification strategy artifact is available.");
    }

    const promotionOperations = ["inspect", "snapshot", "promotion", "confirmation", "rollback"];
    if (repairBinding && capabilities.verification_ready.state === "established"
        && promotionOperations.every((name) => repairBinding.permitted_operations.includes(name))
        && repairBinding.transition_policy.promotion_authority === "owner_only") {
      capabilities.promotion_ready = established(
        evidence("repair_delivery_binding", repairBinding.binding_id,
          repairBinding.binding_digest, repairBinding.created_at),
        ...capabilities.verification_ready.evidence
      );
    } else {
      capabilities.promotion_ready = missing("promotion_ready",
        "Exact verification readiness, target inspection, Owner-only promotion, confirmation, and rollback are not all established.");
    }

    if (profile) {
      const oldestAllowed = Date.parse(cutoff) - profile.maximum_evidence_age_seconds * 1000;
      for (const name of COVERAGE_CAPABILITIES) {
        const current = capabilities[name];
        if (current.state === "established"
            && current.evidence.some((item) => Date.parse(item.observed_at) < oldestAllowed)) {
          capabilities[name] = indeterminate(name, current.evidence,
            `Established evidence exceeds the Coverage Profile's ${profile.maximum_evidence_age_seconds}-second freshness bound.`,
            [...current.limitations, limitation(`coverage.${name}.evidence_stale`,
              "The exact evidence is retained but cannot establish current coverage at this cutoff.")]);
        }
      }
    }

    globalLimitations.push(limitation("coverage.claim.authority_none",
      "Capability and Accountable Coverage projections grant no operational or business authority."));
    let intervalStart = snapshot?.source?.source_cutoff ?? onboarding.opened_at;
    const evidenceCutoff = validation ? { cutoff_type: "coverage_validation",
      cutoff_id: validation.validation_id, cutoff_digest: validation.validation_receipt_digest,
      occurred_at: validation.validated_at } : snapshot ? { cutoff_type: "workflow_discovery_snapshot",
      cutoff_id: onboarding.active_snapshot_digest, cutoff_digest: onboarding.active_snapshot_digest,
      occurred_at: new Date(snapshotObservedAt).toISOString() } : {
      cutoff_type: "coverage_onboarding", cutoff_id: onboarding.onboarding_id,
      cutoff_digest: onboarding.event_head_digest, occurred_at: onboarding.opened_at };
    if (Date.parse(intervalStart) > Date.parse(evidenceCutoff.occurred_at)) {
      historicalGaps.push(gap("coverage.discovery.cutoff_inconsistent",
        "The provider source cutoff is later than the admitted evidence cutoff."));
      intervalStart = evidenceCutoff.occurred_at;
    }
    return { capabilities, historicalGaps, globalLimitations, profile, intervalStart, evidenceCutoff };
  }

  async function get(onboardingId) {
    const onboarding = await coverageOnboardingService.get(onboardingId);
    const collected = await collect(onboarding);
    return buildAccountableCoverageProjection({ onboardingId,
      workflowReference: onboarding.workflow_reference, evidenceCutoff: collected.evidenceCutoff,
      intervalStart: collected.intervalStart, profile: collected.profile,
      capabilities: collected.capabilities, historicalGaps: collected.historicalGaps,
      limitations: collected.globalLimitations, projector });
  }

  return { get, projector: structuredClone(projector) };
}
