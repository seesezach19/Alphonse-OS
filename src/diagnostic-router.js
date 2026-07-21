// @ts-check

/**
 * Diagnostic Plane HTTP routes extracted from the Kernel composition root.
 * Handlers are unchanged; only module boundaries moved.
 */

import { KernelError } from "./errors.js";

/**
 * @param {import("./route-context.js").RouteContext} ctx Composition-root services, config, and createRouteHelpers() result.
 * @returns {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, url: URL) => Promise<boolean>}
 */
export function createDiagnosticRouter(ctx) {
  const {
    database, identityIntent, grantAuthorityService, contextService, packageService,
    packageTrustService, deploymentService, upgradeService, handoffService, executionService,
    recoveryService, restoreService, effectService, environmentCoordination, supportService,
    diagnosticDatabase, diagnosticService, diagnosticRuntimeService, diagnosticReproductionService,
    diagnosticRepairWorkerService, diagnosticDiagnosisService, diagnosticRepairDeliveryService,
    diagnosticVerificationService, diagnosticPromotionService, diagnosticArtifactStore,
    diagnosticGrantApplicationService, diagnosticObservationService, diagnosticTokenizationProofService,
    diagnosticCorrelationService, diagnosticEffectEvaluationService, diagnosticEvidencePackageService,
    diagnosticIndependentVerificationService, diagnosticAssignmentService,
    diagnosticMaterialAvailabilityService, diagnosticDispatchService,
    diagnosticDispatchAuthorizationService, diagnosticWorkerExecutionService,
    diagnosticConsistencyService,
    installationId, environmentId, environmentName,
    grantAuthorityFeedToken, grantApplicationReceiptServiceToken, diagnosticTokenizationResultToken,
    dataPlaneReceiptSecret, dataPlaneId,
    diagnosticRuntimeAdapterId, diagnosticRuntimeAdapterVersion, diagnosticRuntimeAdapterKeyId,
    PROTOCOL_VERSION, DIAGNOSTIC_PROTOCOL_VERSION,
    listOperationDescriptors, getOperationDescriptor,
    listDiagnosticOperationDescriptors, getDiagnosticOperationDescriptor,
    getWorkflowRuntimeAdapterContract, getRepairDeliveryAdapterContract, getVerificationRunnerContract,
    validateCommandEnvelope, validateProfileUpdateCommand,
    canonicalize, sha256Digest, createHmac, createPublicKey,
    sendJson, sendHtml, readJson, sendCommandResult, pathId, requireRouteTaskMatch,
    serializeEnvironment, escapeHtml, observationAuthentication,
    authenticateBootstrapOperator, authenticateDiagnosticOwner, authenticatePrivateService,
    authenticateDataPlane, authenticateSubstrate, authenticateBroker, authenticateAgent,
    requireDiagnosticPlane, requireDiagnosticRuntime, requireDiagnosticReproduction,
    requireGrantAuthority, requireDiagnosticGrantApplication, requireDiagnosticObservation,
    requireDiagnosticTokenizationProof, requireDiagnosticCorrelation, requireDiagnosticEffectEvaluation,
    requireDiagnosticEvidencePackaging, requireDiagnosticMaterialAvailability, requireDiagnosticAssignment,
    requireDiagnosticDispatch, requireDiagnosticWorkerExecution, requireDiagnosticConsistency,
    requireDiagnosticDispatchAuthority, requireIndependentDiagnosticVerification,
    requireDiagnosticRepairWorker, requireDiagnosticDiagnosis, requireDiagnosticRepairDelivery,
    requireDiagnosticVerification, requireDiagnosticPromotion, requireCoverageOnboarding,
    requireWorkflowInterpretation
  } = ctx;

  return async function diagnosticRouter(request, response, url) {
  if (request.method === "GET" && /^\/diagnostic\/v0\/grant-projections\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticGrantApplication();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { grant_projection: await service.getEffectiveState(
      environmentId, pathId(url.pathname, "/diagnostic/v0/grant-projections/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/observation-schema-activations") {
    const service = requireDiagnosticObservation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.observation_schema.activate");
    const body = await readJson(request, 64 * 1024);
    return sendCommandResult(response, await service.activateSchema(body, actor.id));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/observations") {
    const service = requireDiagnosticObservation();
    const body = await readJson(request, 2 * 1024 * 1024);
    const envelopeBytes = body.envelope_bytes ?? canonicalize(body.envelope);
    return sendCommandResult(response, await service.receiveObservation({
      envelope_bytes: envelopeBytes,
      authentication: observationAuthentication(request, body),
      detail_base64: body.detail_base64 ?? null
    }));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/tokenization-result-receipts\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticTokenizationProof();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { tokenization_result_receipt: await service.getResultReceipt(
      pathId(url.pathname, "/diagnostic/v0/tokenization-result-receipts/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/intake-prefix") {
    const service = requireDiagnosticObservation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { intake_prefix: await service.getIntakePrefix() });
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/observation-receipts\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticObservation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { observation_receipt: await service.getReceipt(
      pathId(url.pathname, "/diagnostic/v0/observation-receipts/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/correlation-registrations") {
    const service = requireDiagnosticCorrelation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.correlation_registration.register");
    const body = await readJson(request, 64 * 1024);
    return sendCommandResult(response, await service.register(body, actor.id));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/correlation-registrations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticCorrelation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { correlation_registration: await service.getRegistration(
      pathId(url.pathname, "/diagnostic/v0/correlation-registrations/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/correlation-projections") {
    const service = requireDiagnosticCorrelation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.correlation_projection.create");
    const body = await readJson(request, 64 * 1024);
    return sendCommandResult(response, await service.createProjection(body, actor.id));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/correlation-projections\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticCorrelation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { correlation_projection: await service.getProjection(
      pathId(url.pathname, "/diagnostic/v0/correlation-projections/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/interpretation-activations") {
    const service = requireDiagnosticEffectEvaluation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.interpretation_activation.activate");
    return sendCommandResult(response, await service.activate(await readJson(request, 64 * 1024), actor.id));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/interpretation-activations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { interpretation_activation: await service.getActivation(
      pathId(url.pathname, "/diagnostic/v0/interpretation-activations/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/effect-evaluations") {
    const service = requireDiagnosticEffectEvaluation();
    await authenticateDiagnosticOwner(request, "diagnostic.effect_evaluation.process");
    return sendCommandResult(response, await service.process(await readJson(request, 64 * 1024)));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/effect-projections\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_effect_projection: await service.getEffectProjection(
      pathId(url.pathname, "/diagnostic/v0/effect-projections/")) });
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/behavior-evaluations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { behavior_evaluation: await service.getEvaluation(
      pathId(url.pathname, "/diagnostic/v0/behavior-evaluations/")) });
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/diagnostic-triggers\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_trigger: await service.getTrigger(
      pathId(url.pathname, "/diagnostic/v0/diagnostic-triggers/")) });
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/claim-envelopes\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { claim_envelope: await service.getClaim(
      pathId(url.pathname, "/diagnostic/v0/claim-envelopes/")) });
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/deterministic-cases\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_case: await service.getDeterministicCase(
      pathId(url.pathname, "/diagnostic/v0/deterministic-cases/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/evidence-policy-activations") {
    const service = requireDiagnosticEvidencePackaging();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.evidence_policy_activation.activate");
    return sendCommandResult(response, await service.activatePolicy(await readJson(request, 64 * 1024), actor.id));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/evidence-policy-activations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEvidencePackaging();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_policy_activation: await service.getPolicyActivation(
      pathId(url.pathname, "/diagnostic/v0/evidence-policy-activations/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/evidence-collections/process") {
    const service = requireDiagnosticEvidencePackaging();
    await authenticateDiagnosticOwner(request, "diagnostic.evidence_collection.process");
    return sendCommandResult(response, await service.processCollection(await readJson(request, 64 * 1024)));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/evidence-collections\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEvidencePackaging();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_collection: await service.getCollection(
      pathId(url.pathname, "/diagnostic/v0/evidence-collections/")) });
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/evidence-packages\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEvidencePackaging();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_package: await service.getPackage(
      pathId(url.pathname, "/diagnostic/v0/evidence-packages/")) });
    return true;
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/evidence-packages\/[^/]+\/material-availability$/.test(url.pathname)) {
    const service = requireDiagnosticMaterialAvailability();
    authenticateBootstrapOperator(request);
    const evidencePackageId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    return sendJson(response, 200, { material_availability:
      await service.getPackageAvailability(evidencePackageId) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/material-erasures") {
    const service = requireDiagnosticMaterialAvailability();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.material_erasure.request");
    return sendCommandResult(response,
      await service.requestErasure(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/material-erasures\/[^/]+\/complete$/.test(url.pathname)) {
    const service = requireDiagnosticMaterialAvailability();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.material_erasure.complete");
    const body = await readJson(request, 64 * 1024);
    const decisionId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.erasure_decision_id !== decisionId) {
      throw new KernelError(409, "DIAGNOSTIC_MATERIAL_ERASURE_ROUTE_MISMATCH",
        "Route erasure decision ID must match command input.");
    }
    return sendCommandResult(response, await service.completeErasure(body, actor));
    return true;
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/material-erasures\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticMaterialAvailability();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { material_erasure: await service.getErasure(
      pathId(url.pathname, "/diagnostic/v0/material-erasures/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/evidence-revisions/process") {
    const service = requireDiagnosticEvidencePackaging();
    await authenticateDiagnosticOwner(request, "diagnostic.evidence_revision.process");
    return sendCommandResult(response, await service.processRevision(await readJson(request, 64 * 1024)));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/evidence-revisions\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEvidencePackaging();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_revision: await service.getRevisionStatus(
      pathId(url.pathname, "/diagnostic/v0/evidence-revisions/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/assignment-policy-activations") {
    const service = requireDiagnosticAssignment();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.assignment_policy_activation.activate");
    return sendCommandResult(response, await service.activatePolicy(await readJson(request, 64 * 1024), actor.id));
    return true;
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/assignment-policy-activations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { assignment_policy_activation: await service.getPolicyActivation(
      pathId(url.pathname, "/diagnostic/v0/assignment-policy-activations/")) });
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/assignments\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_assignment: await service.getAssignment(
      pathId(url.pathname, "/diagnostic/v0/assignments/")) });
    return true;
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/assignments\/[^/]+\/claim$/.test(url.pathname)) {
    const service = requireDiagnosticDispatch();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.assignment.claim");
    const body = await readJson(request, 256 * 1024);
    const assignmentId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.assignment_id !== assignmentId) {
      throw new KernelError(409, "DIAGNOSTIC_DISPATCH_ASSIGNMENT_ROUTE_MISMATCH",
        "Route Assignment ID must match the claim command input.");
    }
    return sendCommandResult(response, await service.claim(body, actor));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/worker-runs\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticDispatch();
    authenticateBootstrapOperator(request);
    const workerRunId = pathId(url.pathname, "/diagnostic/v0/worker-runs/");
    const workerRun = await service.getWorkerRun(workerRunId);
    const execution = diagnosticWorkerExecutionService
      ? await diagnosticWorkerExecutionService.getExecutionView(workerRunId) : null;
    return sendJson(response, 200, { diagnostic_worker_run: execution
      ? { ...workerRun, launch_state: execution.state, broker_token_created: true,
        provider_request_created: execution.provider_request_created,
        model_request_created: execution.model_request_created,
        diagnosis_created: execution.diagnosis_created, execution }
      : workerRun });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/consistency-tests") {
    const service = requireDiagnosticConsistency();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.consistency_test.register");
    const body = await readJson(request, 512 * 1024);
    return sendCommandResult(response, await service.register(body, actor));
    return true;
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/consistency-tests\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticConsistency();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_consistency_test: await service.getTest(
      pathId(url.pathname, "/diagnostic/v0/consistency-tests/")) });
    return true;
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/worker-runs\/[^/]+\/launch-authorizations$/.test(url.pathname)) {
    const service = requireDiagnosticWorkerExecution();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.worker_run.launch_authorize");
    const body = await readJson(request, 256 * 1024);
    const workerRunId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.worker_run_id !== workerRunId) {
      throw new KernelError(409, "DIAGNOSTIC_WORKER_RUN_ROUTE_MISMATCH",
        "Route Worker Run ID must match command input.");
    }
    return sendCommandResult(response, await service.authorizeLaunch(body, actor));
    return true;
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/worker-runs\/[^/]+\/started$/.test(url.pathname)) {
    const service = requireDiagnosticWorkerExecution();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.worker_run.started");
    const body = await readJson(request, 512 * 1024);
    const workerRunId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.worker_run_id !== workerRunId) {
      throw new KernelError(409, "DIAGNOSTIC_WORKER_RUN_ROUTE_MISMATCH",
        "Route Worker Run ID must match command input.");
    }
    return sendCommandResult(response, await service.recordStarted(body, actor));
    return true;
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/worker-runs\/[^/]+\/completions$/.test(url.pathname)) {
    const service = requireDiagnosticWorkerExecution();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.worker_run.complete");
    const body = await readJson(request, 24 * 1024 * 1024);
    const workerRunId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.worker_run_id !== workerRunId) {
      throw new KernelError(409, "DIAGNOSTIC_WORKER_RUN_ROUTE_MISMATCH",
        "Route Worker Run ID must match command input.");
    }
    return sendCommandResult(response, await service.complete(body, actor));
    return true;
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/evidence-packages\/[^/]+\/assignment$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    const evidencePackageId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    return sendJson(response, 200, { diagnostic_assignment: await service.getAssignmentForPackage(
      evidencePackageId) });
    return true;
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/evidence-packages\/[^/]+\/assignment-status$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    const evidencePackageId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    return sendJson(response, 200, { assignment_processing: await service.getProcessingStatusForPackage(
      evidencePackageId) });
    return true;
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/assignment-verification-material\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { assignment_verification_material: await service.getVerificationMaterial(
      pathId(url.pathname, "/diagnostic/v0/assignment-verification-material/")) });
    return true;
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/independent-verification-bundles\/[^/]+$/.test(url.pathname)) {
    const service = requireIndependentDiagnosticVerification();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { independent_verification_bundle: await service.getBundle(
      pathId(url.pathname, "/diagnostic/v0/independent-verification-bundles/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/bootstrap") {
    requireDiagnosticPlane();
    const node = await diagnosticDatabase.getNode(installationId);
    return sendJson(response, 200, {
      status: "healthy",
      protocol: {
        name: "alphonse-diagnostic-protocol",
        version: DIAGNOSTIC_PROTOCOL_VERSION,
        discovery: "/diagnostic/v0/operations"
      },
      node: {
        installation_id: node.installation_id,
        revision: node.revision,
        database_boundary: "separate_least_privilege_database",
        artifact_boundary: "content_addressed_local_storage",
        authority_granted: false,
        runtime_adapter_binding: diagnosticRuntimeService ? {
          adapter_id: diagnosticRuntimeAdapterId,
          adapter_version: diagnosticRuntimeAdapterVersion,
          key_id: diagnosticRuntimeAdapterKeyId,
          secret_persisted: false
        } : null
      },
      operations: listDiagnosticOperationDescriptors()
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/operations") {
    requireDiagnosticPlane();
    return sendJson(response, 200, {
      protocol_version: DIAGNOSTIC_PROTOCOL_VERSION,
      operations: listDiagnosticOperationDescriptors()
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/runtime-adapter-contract") {
    requireDiagnosticPlane();
    return sendJson(response, 200, getWorkflowRuntimeAdapterContract());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/repair-delivery-adapter-contract") {
    requireDiagnosticPlane();
    return sendJson(response, 200, getRepairDeliveryAdapterContract());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/verification-runner-contract") {
    requireDiagnosticPlane();
    return sendJson(response, 200, getVerificationRunnerContract());
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/operations/")) {
    requireDiagnosticPlane();
    const operationId = pathId(url.pathname, "/diagnostic/v0/operations/");
    const descriptor = getDiagnosticOperationDescriptor(operationId);
    if (!descriptor) throw new KernelError(404, "OPERATION_NOT_FOUND", "Diagnostic operation does not exist.");
    return sendJson(response, 200, descriptor);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/coverage-onboardings") {
    const service = requireCoverageOnboarding();
    const passport = await authenticateAgent(request);
    return sendCommandResult(response,
      await service.open(await readJson(request, 64 * 1024), passport));
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/coverage-onboardings\/[^/]+\/evidence-captures$/.test(url.pathname)) {
    const service = requireCoverageOnboarding();
    const passport = await authenticateAgent(request);
    const body = await readJson(request, 64 * 1024);
    const onboardingId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.onboarding_id !== onboardingId) {
      throw new KernelError(409, "COVERAGE_ONBOARDING_ROUTE_MISMATCH",
        "Route onboarding ID must match evidence capture input.");
    }
    return sendCommandResult(response, await service.captureEvidence(body, passport));
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/coverage-onboardings\/[^/]+\/interpretation-assignments$/.test(url.pathname)) {
    const service = requireWorkflowInterpretation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.coverage_interpretation.assign");
    const body = await readJson(request, 1024 * 1024);
    const onboardingId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.onboarding_id !== onboardingId) {
      throw new KernelError(409, "COVERAGE_ONBOARDING_ROUTE_MISMATCH",
        "Route onboarding ID must match Interpretation Assignment input.");
    }
    return sendCommandResult(response, await service.assign(body, actor));
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/coverage-onboardings\/[^/]+\/interpretations$/.test(url.pathname)) {
    const service = requireWorkflowInterpretation();
    const passport = await authenticateAgent(request);
    const body = await readJson(request, 2 * 1024 * 1024);
    const onboardingId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.onboarding_id !== onboardingId) {
      throw new KernelError(409, "COVERAGE_ONBOARDING_ROUTE_MISMATCH",
        "Route onboarding ID must match Interpretation submission input.");
    }
    return sendCommandResult(response, await service.submit(body, passport));
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/coverage-onboardings\/[^/]+\/ambiguity-resolutions$/.test(url.pathname)) {
    const service = requireWorkflowInterpretation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.coverage_ambiguity.resolve");
    const body = await readJson(request, 256 * 1024);
    const onboardingId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.onboarding_id !== onboardingId) {
      throw new KernelError(409, "COVERAGE_ONBOARDING_ROUTE_MISMATCH",
        "Route onboarding ID must match Coverage Ambiguity resolution input.");
    }
    return sendCommandResult(response, await service.resolveAmbiguity(body, actor));
  }

  if (request.method === "GET"
      && url.pathname.startsWith("/diagnostic/v0/coverage-interpretation-assignments/")) {
    const service = requireWorkflowInterpretation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { coverage_interpretation_assignment: await service.getAssignment(
      pathId(url.pathname, "/diagnostic/v0/coverage-interpretation-assignments/")
    ) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/coverage-onboardings/")) {
    const service = requireCoverageOnboarding();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { coverage_onboarding: await service.get(
      pathId(url.pathname, "/diagnostic/v0/coverage-onboardings/")
    ) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/agent-workflows") {
    const service = requireDiagnosticPlane();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.agent_workflow.register");
    return sendCommandResult(response, await service.registerWorkflow(await readJson(request, 512 * 1024), actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/agent-workflows/")) {
    const service = requireDiagnosticPlane();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      agent_workflow: await service.getWorkflow(pathId(url.pathname, "/diagnostic/v0/agent-workflows/"))
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/agent-revisions") {
    const service = requireDiagnosticPlane();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.agent_revision.register");
    return sendCommandResult(response, await service.registerRevision(await readJson(request, 512 * 1024), actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/agent-revisions/")) {
    const service = requireDiagnosticPlane();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      agent_revision: await service.getRevision(pathId(url.pathname, "/diagnostic/v0/agent-revisions/"))
    });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/artifacts/")) {
    const service = requireDiagnosticPlane();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      artifact: await service.getArtifact(pathId(url.pathname, "/diagnostic/v0/artifacts/"))
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/runtime-events") {
    const service = requireDiagnosticRuntime();
    const accepted = await service.receiveEvent(await readJson(request, 64 * 1024), {
      key_id: request.headers["x-alphonse-runtime-key-id"],
      signed_at: request.headers["x-alphonse-runtime-signed-at"],
      signature: request.headers["x-alphonse-runtime-signature"]
    });
    return sendJson(response, accepted.replayed ? 200 : 201, accepted.result, {
      "idempotent-replayed": accepted.replayed ? "true" : "false"
    });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/external-activity-traces/")) {
    const service = requireDiagnosticRuntime();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      external_activity_trace: await service.getTrace(
        pathId(url.pathname, "/diagnostic/v0/external-activity-traces/")
      )
    });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/runtime-event-conflicts/")) {
    const service = requireDiagnosticRuntime();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      runtime_event_conflict: await service.getConflict(
        pathId(url.pathname, "/diagnostic/v0/runtime-event-conflicts/")
      )
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/cases") {
    const service = requireDiagnosticReproduction();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.case.report_failure");
    return sendCommandResult(response, await service.reportFailure(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/failure-specifications") {
    const service = requireDiagnosticReproduction();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.failure_specification.confirm");
    return sendCommandResult(response,
      await service.confirmFailureSpecification(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/reproductions") {
    const service = requireDiagnosticReproduction();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.reproduction.create");
    return sendCommandResult(response, await service.createReproduction(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-workers") {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    return sendCommandResult(response, await service.registerWorker(await readJson(request, 64 * 1024), passport));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/diagnosis-workers") {
    const service = requireDiagnosticDiagnosis();
    const passport = await authenticateAgent(request);
    return sendCommandResult(response, await service.registerWorker(await readJson(request, 64 * 1024), passport));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/diagnosis-requests") {
    const service = requireDiagnosticDiagnosis();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.diagnosis_request.create");
    return sendCommandResult(response, await service.createRequest(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/diagnosis-requests\/[^/]+\/workspace$/.test(url.pathname)) {
    const service = requireDiagnosticDiagnosis();
    const passport = await authenticateAgent(request);
    return sendJson(response, 200, await service.getWorkspace(
      decodeURIComponent(url.pathname.split("/").at(-2) ?? ""), passport
    ));
    return true;
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/diagnosis-requests\/[^/]+\/fail$/.test(url.pathname)) {
    const service = requireDiagnosticDiagnosis();
    const passport = await authenticateAgent(request);
    const body = await readJson(request, 64 * 1024);
    if (body?.input?.request_id !== decodeURIComponent(url.pathname.split("/").at(-2) ?? "")) {
      throw new KernelError(409, "DIAGNOSIS_REQUEST_ROUTE_MISMATCH", "Route request ID must match command input.");
    }
    return sendCommandResult(response, await service.failRequest(body, passport));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/diagnosis-proposals") {
    const service = requireDiagnosticDiagnosis();
    const passport = await authenticateAgent(request);
    return sendCommandResult(response, await service.submitProposal(await readJson(request, 512 * 1024), passport));
    return true;
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/diagnosis-proposals\/[^/]+\/reviews$/.test(url.pathname)) {
    const service = requireDiagnosticDiagnosis();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.diagnosis_proposal.review");
    const body = await readJson(request, 64 * 1024);
    if (body?.input?.proposal_id !== decodeURIComponent(url.pathname.split("/").at(-2) ?? "")) {
      throw new KernelError(409, "DIAGNOSIS_PROPOSAL_ROUTE_MISMATCH", "Route proposal ID must match command input.");
    }
    return sendCommandResult(response, await service.reviewProposal(body, actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/diagnosis-requests/")) {
    const service = requireDiagnosticDiagnosis();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnosis_request: await service.getRequest(
      pathId(url.pathname, "/diagnostic/v0/diagnosis-requests/")
    ) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/diagnosis-proposals/")) {
    const service = requireDiagnosticDiagnosis();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnosis_proposal: await service.getProposal(
      pathId(url.pathname, "/diagnostic/v0/diagnosis-proposals/")
    ) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-tasks") {
    const service = requireDiagnosticRepairWorker();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_task.create");
    return sendCommandResult(response, await service.createTask(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/repair-tasks") {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    return sendJson(response, 200, await service.discoverTasks(passport));
    return true;
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/claim$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.claimTask(body, passport));
    return true;
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/heartbeat$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.heartbeat(body, passport));
    return true;
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/fail$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.failTask(body, passport));
    return true;
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/release$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.releaseTask(body, passport));
    return true;
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/cancel$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_task.cancel");
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.cancelTask(body, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-candidates") {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    return sendCommandResult(response,
      await service.submitCandidate(await readJson(request, 7 * 1024 * 1024), passport));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/artifacts\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const parts = url.pathname.split("/");
    return sendJson(response, 200, await service.retrieveArtifact(
      decodeURIComponent(parts.at(-3) ?? ""), decodeURIComponent(parts.at(-1) ?? ""), passport
    ));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-tasks/")) {
    const service = requireDiagnosticRepairWorker();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_task: await service.getTask(pathId(url.pathname, "/diagnostic/v0/repair-tasks/"))
    });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-candidates/")) {
    const service = requireDiagnosticRepairWorker();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_candidate: await service.getCandidate(pathId(url.pathname, "/diagnostic/v0/repair-candidates/"))
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-delivery-bindings") {
    const service = requireDiagnosticRepairDelivery();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_delivery_binding.register");
    return sendCommandResult(response, await service.registerBinding(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/repair-delivery-bindings\/[^/]+\/target$/.test(url.pathname)) {
    const service = requireDiagnosticRepairDelivery();
    authenticateBootstrapOperator(request);
    const bindingId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    return sendJson(response, 200, await service.inspectTarget(bindingId));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-delivery-bindings/")) {
    const service = requireDiagnosticRepairDelivery();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_delivery_binding: await service.getBinding(
        pathId(url.pathname, "/diagnostic/v0/repair-delivery-bindings/")
      )
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-deliveries") {
    const service = requireDiagnosticRepairDelivery();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_delivery.materialize");
    return sendCommandResult(response,
      await service.materializeCandidate(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-deliveries/")) {
    const service = requireDiagnosticRepairDelivery();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_delivery: await service.getDelivery(pathId(url.pathname, "/diagnostic/v0/repair-deliveries/"))
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-verifications") {
    const service = requireDiagnosticVerification();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_verification.create");
    return sendCommandResult(response,
      await service.createVerification(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-verifications/")) {
    const service = requireDiagnosticVerification();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_verification: await service.getVerification(
        pathId(url.pathname, "/diagnostic/v0/repair-verifications/")
      )
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/promotions") {
    const service = requireDiagnosticPromotion();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.promotion.authorize");
    return sendCommandResult(response,
      await service.authorizePromotion(await readJson(request, 64 * 1024), actor));
    return true;
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/promotions\/[^/]+\/apply$/.test(url.pathname)) {
    const service = requireDiagnosticPromotion();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.promotion.apply");
    const body = await readJson(request, 64 * 1024);
    const promotionId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    if (body?.input?.promotion_id !== promotionId) {
      throw new KernelError(409, "PROMOTION_ROUTE_MISMATCH",
        "Route Promotion ID must match command input.");
    }
    return sendCommandResult(response, await service.applyPromotion(body, actor));
    return true;
  }

  if (request.method === "POST" &&
      /^\/diagnostic\/v0\/promotions\/[^/]+\/(reconcile|rollback)$/.test(url.pathname)) {
    const service = requireDiagnosticPromotion();
    const operationId = url.pathname.endsWith("/reconcile")
      ? "diagnostic.promotion.reconcile" : "diagnostic.promotion.rollback";
    const actor = await authenticateDiagnosticOwner(request, operationId);
    const body = await readJson(request, 64 * 1024);
    const segments = url.pathname.split("/");
    const promotionId = decodeURIComponent(segments.at(-2) ?? "");
    if (body?.input?.promotion_id !== promotionId) {
      throw new KernelError(409, "PROMOTION_ROUTE_MISMATCH",
        "Route Promotion ID must match command input.");
    }
    return sendCommandResult(response, segments.at(-1) === "reconcile"
      ? await service.reconcilePromotion(body, actor)
      : await service.rollbackPromotion(body, actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/promotions/")) {
    const service = requireDiagnosticPromotion();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      promotion: await service.getPromotion(pathId(url.pathname, "/diagnostic/v0/promotions/"))
    });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/cases/")) {
    const service = requireDiagnosticReproduction();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      diagnostic_case: await service.getCase(pathId(url.pathname, "/diagnostic/v0/cases/"))
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/artifact-retirements") {
    const service = requireDiagnosticReproduction();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.artifact.retire");
    return sendCommandResult(response, await service.retireArtifact(await readJson(request, 64 * 1024), actor));
    return true;
  }

    return false;
  };
}
