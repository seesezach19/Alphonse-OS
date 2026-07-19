// @ts-check

/**
 * Kernel HTTP routes extracted from the Kernel composition root.
 * Handlers are unchanged; only module boundaries moved.
 */

import { KernelError } from "./errors.js";

/**
 * @param {import("./route-context.js").RouteContext} ctx Composition-root services, config, and createRouteHelpers() result.
 * @returns {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, url: URL) => Promise<boolean>}
 */
export function createKernelRouter(ctx) {
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
    requireDiagnosticVerification, requireDiagnosticPromotion
  } = ctx;

  return async function kernelRouter(request, response, url) {
  if (request.method === "POST" && url.pathname === "/kernel/v0/grant-authority/grants") {
    const service = requireGrantAuthority();
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024),
      "kernel.authority_grant.register");
    return sendCommandResult(response, await service.registerGrant(command, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/grant-authority/readiness-receipts") {
    const service = requireGrantAuthority();
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024),
      "kernel.authority_grant.readiness.record");
    return sendCommandResult(response, await service.recordReadiness(command, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/grant-authority/snapshots") {
    const service = requireGrantAuthority();
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 64 * 1024),
      "kernel.authority_grant.snapshot.publish");
    return sendCommandResult(response, await service.publishSnapshot(command, actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/grant-authority/grants/")) {
    const service = requireGrantAuthority();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { grant_state: await service.getGrantState(
      pathId(url.pathname, "/kernel/v0/grant-authority/grants/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/grant-authority/seal-readiness") {
    const service = requireGrantAuthority();
    authenticateBootstrapOperator(request);
    const body = await readJson(request, 64 * 1024);
    return sendJson(response, 200, await service.assertSealEligible(body.grant_ids));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/bootstrap") {
    const environment = await database.getEnvironment(installationId, environmentId);
    return sendJson(response, 200, {
      status: "healthy",
      protocol: {
        name: "alphonse-kernel-protocol",
        version: PROTOCOL_VERSION,
        discovery: "/kernel/v0/operations"
      },
      environment: serializeEnvironment(environment),
      operations: listOperationDescriptors(),
      butler: { overview: "/kernel/v0/accountable-work/overview", shell: "/butler" },
      diagnostic: {
        available: Boolean(diagnosticService),
        bootstrap: diagnosticService ? "/diagnostic/v0/bootstrap" : null
      }
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/operations") {
    return sendJson(response, 200, { protocol_version: PROTOCOL_VERSION, operations: listOperationDescriptors() });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/operations/")) {
    const operationId = decodeURIComponent(url.pathname.slice("/kernel/v0/operations/".length));
    const descriptor = getOperationDescriptor(operationId);
    if (!descriptor) throw new KernelError(404, "OPERATION_NOT_FOUND", "Operation descriptor does not exist.");
    return sendJson(response, 200, descriptor);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/environments/current") {
    return sendJson(response, 200, serializeEnvironment(await database.getEnvironment(installationId, environmentId)));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/diagnostic-dispatch-authorizations") {
    const service = requireDiagnosticDispatchAuthority();
    const actor = await authenticateDiagnosticOwner(request, "kernel.diagnostic_dispatch.authorize");
    return sendCommandResult(response,
      await service.authorize(await readJson(request, 256 * 1024), actor));
    return true;
  }

  if (request.method === "GET"
      && /^\/kernel\/v0\/diagnostic-dispatch-authorizations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticDispatchAuthority();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_dispatch_authorization:
      await service.getAuthorization(pathId(url.pathname,
        "/kernel/v0/diagnostic-dispatch-authorizations/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/commands") {
    const actor = authenticateBootstrapOperator(request);
    const command = { ...validateProfileUpdateCommand(await readJson(request)), actor };
    const requestDigest = sha256Digest({ installation_id: installationId, environment_id: environmentId, ...command });
    const accepted = await database.executeEnvironmentProfileUpdate(
      installationId,
      environmentId,
      command,
      requestDigest
    );
    return sendJson(response, accepted.replayed ? 200 : 201, accepted.result, {
      "idempotent-replayed": accepted.replayed ? "true" : "false"
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/principals") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.principal.create");
    return sendCommandResult(response, await identityIntent.createPrincipal(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/principals/")) {
    authenticateBootstrapOperator(request);
    const principal = await identityIntent.getPrincipal(pathId(url.pathname, "/kernel/v0/principals/"));
    return sendJson(response, 200, { principal });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/agent-passports") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.agent_passport.issue");
    return sendCommandResult(response, await identityIntent.issuePassport(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/agent-passports/")) {
    authenticateBootstrapOperator(request);
    const passport = await identityIntent.getPassport(pathId(url.pathname, "/kernel/v0/agent-passports/"));
    return sendJson(response, 200, { passport });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/work-intent-proposals") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.work_intent.propose");
    return sendCommandResult(response, await identityIntent.proposeIntent(command, passport));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/work-intent-proposals\/[^/]+\/confirm$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const proposalId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.work_intent.confirm");
    return sendCommandResult(response, await identityIntent.confirmIntent(command, proposalId));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/work-intent-proposals/")) {
    authenticateBootstrapOperator(request);
    const proposal = await identityIntent.getProposal(pathId(url.pathname, "/kernel/v0/work-intent-proposals/"));
    return sendJson(response, 200, { proposal });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/work-intents/")) {
    authenticateBootstrapOperator(request);
    const workIntent = await identityIntent.getWorkIntent(pathId(url.pathname, "/kernel/v0/work-intents/"));
    return sendJson(response, 200, { work_intent: workIntent });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/build-sessions") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.build_session.open");
    return sendCommandResult(response, await identityIntent.openBuildSession(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/build-sessions/")) {
    authenticateBootstrapOperator(request);
    const buildSession = await identityIntent.getBuildSession(pathId(url.pathname, "/kernel/v0/build-sessions/"));
    return sendJson(response, 200, { build_session: buildSession });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/admission/check") {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, await identityIntent.checkAdmission(await readJson(request)));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/context-access-grants") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.context_access_grant.issue");
    return sendCommandResult(response, await contextService.issueGrant(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/context-access-grants/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { context_access_grant: await contextService.getGrant(pathId(url.pathname, "/kernel/v0/context-access-grants/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/context-receipts/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { context_receipt: await contextService.getReceipt(pathId(url.pathname, "/kernel/v0/context-receipts/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-validations") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.package_candidate.validate");
    return sendCommandResult(response, await packageService.validateCandidate(command, passport));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/artifact-attestations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.artifact.trust_attest");
    return sendCommandResult(response, await packageService.attestArtifact(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/artifact-attestations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { artifact_attestation: await packageService.getArtifactAttestation(pathId(url.pathname, "/kernel/v0/artifact-attestations/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/package-validations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { validation_receipt: await packageService.getValidationReceipt(pathId(url.pathname, "/kernel/v0/package-validations/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-simulations") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.package_candidate.simulate");
    return sendCommandResult(response, await packageService.simulate(command, passport));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/package-simulations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { simulation_receipt: await packageService.getSimulationReceipt(pathId(url.pathname, "/kernel/v0/package-simulations/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-versions") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.package_version.publish");
    return sendCommandResult(response, await packageService.publish(command, passport));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/package-versions/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { package_version: await packageService.getPackageVersion(pathId(url.pathname, "/kernel/v0/package-versions/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/trust-policies") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.trust_policy.create");
    return sendCommandResult(response, await packageTrustService.createPolicy(command, actor));
    return true;
  }

  if (request.method === "GET" && /^\/kernel\/v0\/trust-policies\/[^/]+\/versions\/[^/]+$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const parts = url.pathname.split("/");
    return sendJson(response, 200, { trust_policy: await packageTrustService.getPolicy(
      decodeURIComponent(parts.at(-3) ?? ""), decodeURIComponent(parts.at(-1) ?? "")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-imports") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 4 * 1024 * 1024), "kernel.package.import");
    return sendCommandResult(response, await packageTrustService.importPackage(command, actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/package-import-receipts/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { import_receipt: await packageTrustService.getImportReceipt(
      pathId(url.pathname, "/kernel/v0/package-import-receipts/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/quarantined-packages/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { quarantined_package: await packageTrustService.getQuarantinedPackage(
      pathId(url.pathname, "/kernel/v0/quarantined-packages/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/coordinator-bindings") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.coordinator_binding.create");
    return sendCommandResult(response, await environmentCoordination.createBinding(command, actor));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/coordinator-bindings\/[^/]+\/revoke$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const bindingId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.coordinator_binding.revoke");
    return sendCommandResult(response, await environmentCoordination.revokeBinding(command, bindingId, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/coordinator-registration-sync") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.coordinator.register_outbound");
    return sendCommandResult(response, await environmentCoordination.registerOutbound(command, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/promotion-polls") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.promotion.poll_outbound");
    return sendCommandResult(response, await environmentCoordination.pollPromotions(command, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/promotion-requests") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.promotion.request_outbound");
    return sendCommandResult(response, await environmentCoordination.requestPromotion(command, actor));
    return true;
  }

  if (request.method === "GET" && /^\/kernel\/v0\/promotion-proposals\/[^/]+\/resolution$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const proposalId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    return sendJson(response, 200, { promotion_resolution: await environmentCoordination.getResolution(proposalId) });
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/promotion-proposals\/[^/]+\/resolve$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const proposalId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.promotion.resolve_local_plan");
    return sendCommandResult(response, await environmentCoordination.resolveProposal(command, proposalId, actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/promotion-proposals/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { promotion_proposal: await environmentCoordination.getProposal(
      pathId(url.pathname, "/kernel/v0/promotion-proposals/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/promotion-receipts") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.promotion_receipt.create");
    return sendCommandResult(response, await environmentCoordination.localReceipt(command, actor));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/promotion-receipts\/[^/]+\/deliver$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const receiptId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.promotion_receipt.deliver_outbound");
    return sendCommandResult(response, await environmentCoordination.pushReceipt(command, receiptId, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/environment-health-publications") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment_health.publish_outbound");
    return sendCommandResult(response, await supportService.publishHealth(command, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/support-polls") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.support.poll_outbound");
    return sendCommandResult(response, await supportService.pollSupportCases(command, actor));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/support-cases\/[^/]+\/approve$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const supportCaseId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.support_case.approve");
    return sendCommandResult(response, await supportService.approveSupportCase(command, supportCaseId, actor));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/support-passports\/[^/]+\/deliver$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const passportId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.support_passport.deliver_outbound");
    return sendCommandResult(response, await supportService.pushSupportPassport(command, passportId, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/diagnostic-bundles") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.diagnostic_bundle.create");
    return sendCommandResult(response, await supportService.createDiagnostic(command, actor));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/diagnostic-bundles/")) {
    authenticateBootstrapOperator(request);
    const bundleId = pathId(url.pathname, "/kernel/v0/diagnostic-bundles/");
    return sendJson(response, 200, { diagnostic_bundle: await supportService.getDiagnostic(bundleId) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/support-remediation-authorizations") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.support_remediation.authorize");
    return sendCommandResult(response, await supportService.authorizeRemediation(command, actor));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/runtime-hosts\/[^/]+\/quarantine$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const hostId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.runtime_host.quarantine");
    return sendCommandResult(response, await supportService.quarantineHost(command, hostId, actor));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/coordinator-bindings\/[^/]+\/revocation-sync$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const bindingId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.coordinator_binding.revocation_sync");
    return sendCommandResult(response, await supportService.syncBindingRevocation(command, bindingId, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/deployment-plan-validations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.deployment_plan.validate");
    return sendCommandResult(response, await deploymentService.validatePlan(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/deployment-plan-validations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { validation_receipt: await deploymentService.getValidationReceipt(
      pathId(url.pathname, "/kernel/v0/deployment-plan-validations/")) });
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/deployment-plans\/[^/]+\/technical-reviews$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const deploymentPlanId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.deployment_plan.technical_review");
    return sendCommandResult(response, await deploymentService.reviewPlan(command, deploymentPlanId));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/deployment-plans/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { deployment_plan: await deploymentService.getDeploymentPlan(
      pathId(url.pathname, "/kernel/v0/deployment-plans/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/deployment-technical-reviews/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { technical_review: await deploymentService.getTechnicalReview(
      pathId(url.pathname, "/kernel/v0/deployment-technical-reviews/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/deployments") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.deployment.stage");
    return sendCommandResult(response, await deploymentService.stageDeployment(command));
    return true;
  }

  if (request.method === "GET" && /^\/kernel\/v0\/deployments\/[^/]+\/capabilities\/[^/]+\/action-card$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const parts = url.pathname.split("/");
    return sendJson(response, 200, { action_card: await deploymentService.getActionCard(
      decodeURIComponent(parts[4]), decodeURIComponent(parts[6])) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/deployments/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { deployment: await deploymentService.getDeployment(
      pathId(url.pathname, "/kernel/v0/deployments/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/capability-business-approvals") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.capability.business_approve");
    return sendCommandResult(response, await deploymentService.approveCapability(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/capability-business-approvals/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { business_approval: await deploymentService.getBusinessApproval(
      pathId(url.pathname, "/kernel/v0/capability-business-approvals/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/capability-activations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.capability_activation.activate");
    return sendCommandResult(response, await deploymentService.activateCapability(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/capability-activations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { capability_activation: await deploymentService.getCapabilityActivation(
      pathId(url.pathname, "/kernel/v0/capability-activations/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/capability-admission/check") {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, await deploymentService.checkCapabilityAdmission(await readJson(request)));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-compatibility-reports") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.compatibility_analyze");
    return sendCommandResult(response, await upgradeService.createCompatibilityReport(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/upgrade-compatibility-reports/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { compatibility_report: await upgradeService.getCompatibilityReport(
      pathId(url.pathname, "/kernel/v0/upgrade-compatibility-reports/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-activation-policies") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.activation_policy_create");
    return sendCommandResult(response, await upgradeService.createActivationPolicy(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/upgrade-activation-policies/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { upgrade_activation_policy: await upgradeService.getActivationPolicy(
      pathId(url.pathname, "/kernel/v0/upgrade-activation-policies/")) });
    return true;
  }

  if (request.method === "GET" && /^\/kernel\/v0\/upgrade-plans\/[^/]+\/retirement-status$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const upgradePlanId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    return sendJson(response, 200, { retirement_status: await upgradeService.retirementStatus(upgradePlanId) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-plans") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.plan_create");
    return sendCommandResult(response, await upgradeService.createUpgradePlan(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/upgrade-plans/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { upgrade_plan: await upgradeService.getUpgradePlan(
      pathId(url.pathname, "/kernel/v0/upgrade-plans/")) });
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/upgrade-migrations\/[^/]+\/checkpoints$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const migrationRunId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.migration_checkpoint");
    return sendCommandResult(response, await upgradeService.checkpointMigration(command, migrationRunId));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/upgrade-migrations\/[^/]+\/verify$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const migrationRunId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.migration_verify");
    return sendCommandResult(response, await upgradeService.verifyMigration(command, migrationRunId));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-migrations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.migration_start");
    return sendCommandResult(response, await upgradeService.startMigration(command));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/upgrade-migrations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { migration_run: await upgradeService.getMigrationRun(
      pathId(url.pathname, "/kernel/v0/upgrade-migrations/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-canary-attempts") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.canary_evaluate");
    return sendCommandResult(response, await upgradeService.evaluateCanary(command));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-activations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.activate");
    return sendCommandResult(response, await upgradeService.activateUpgrade(command));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-recovery-actions") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.recovery_record");
    return sendCommandResult(response, await upgradeService.recordRecoveryAction(command));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-retirements") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.package_version.retire");
    return sendCommandResult(response, await upgradeService.retirePackage(command));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/handoffs") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.handoff.propose");
    return sendCommandResult(response, await handoffService.propose(command, passport));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/handoffs\/[^/]+\/accept$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const handoffId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.handoff.accept");
    return sendCommandResult(response, await handoffService.accept(command, handoffId, passport));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/handoffs\/[^/]+\/reject$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const handoffId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.handoff.reject");
    return sendCommandResult(response, await handoffService.reject(command, handoffId, passport));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/handoffs/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { handoff: await handoffService.getHandoff(pathId(url.pathname, "/kernel/v0/handoffs/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/workload-grants/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { workload_grant: await handoffService.getGrant(pathId(url.pathname, "/kernel/v0/workload-grants/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/environments/current/execution-epoch/advance") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment.execution_epoch.advance");
    return sendCommandResult(response, await handoffService.advanceEpoch(command));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/restores") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.environment.restore.begin");
    return sendCommandResult(response, await restoreService.begin(command));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/restores\/[^/]+\/projection-rebuild$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const restoreId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment.restore.projection_rebuild");
    return sendCommandResult(response, await restoreService.rebuildProjection(command, restoreId));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/restores\/[^/]+\/verify$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const restoreId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment.restore.verify");
    return sendCommandResult(response, await restoreService.verify(command, restoreId));
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/restores\/[^/]+\/resume$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const restoreId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment.restore.resume");
    return sendCommandResult(response, await restoreService.resume(command, restoreId));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/restores/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { restore: await restoreService.getRestore(pathId(url.pathname, "/kernel/v0/restores/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/data-lifecycle-records") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.data_lifecycle.record");
    return sendCommandResult(response, await restoreService.recordLifecycle(command));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/execution-envelopes") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.execution_envelope.admit");
    return sendCommandResult(response, await executionService.admit(command, passport));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/execution-envelopes/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { execution_envelope: await executionService.getEnvelope(
      pathId(url.pathname, "/kernel/v0/execution-envelopes/")) });
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/runs\/[^/]+\/complete-comparison$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const runId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.run.complete_comparison");
    if (command.input.run_id !== runId) throw new KernelError(409, "RUN_ROUTE_MISMATCH", "Route Run ID must match command input.");
    return sendCommandResult(response, await executionService.completeComparison(command, passport));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/runs/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { run: await executionService.getRun(pathId(url.pathname, "/kernel/v0/runs/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/evidence-records/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_record: await executionService.getEvidence(
      pathId(url.pathname, "/kernel/v0/evidence-records/")) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/effects") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.effect.admit");
    return sendCommandResult(response, await effectService.admitCorrection(command, passport));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/effects/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { effect_record: await effectService.getEffect(
      pathId(url.pathname, "/kernel/v0/effects/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/dispatch-permits/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { dispatch_permit: await effectService.getPermit(
      pathId(url.pathname, "/kernel/v0/dispatch-permits/")) });
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/effects\/[^/]+\/dispatch$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const effectId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.effect.dispatch");
    if (command.input.effect_id !== effectId) {
      throw new KernelError(409, "EFFECT_ROUTE_MISMATCH", "Route Effect ID must match command input.");
    }
    return sendCommandResult(response, await effectService.dispatch(command, passport));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/recovery-cases/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { recovery_case: await recoveryService.getRecoveryCase(
      pathId(url.pathname, "/kernel/v0/recovery-cases/")) });
    return true;
  }

  if (request.method === "POST" && /^\/kernel\/v0\/recovery-cases\/[^/]+\/reconcile$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const recoveryCaseId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.recovery_case.reconcile");
    if (command.input.recovery_case_id !== recoveryCaseId) {
      throw new KernelError(409, "RECOVERY_CASE_ROUTE_MISMATCH", "Route Recovery Case ID must match command input.");
    }
    return sendCommandResult(response, await recoveryService.reconcile(command, passport));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/reconciliation-permits/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { reconciliation_permit: await recoveryService.getReconciliationPermit(
      pathId(url.pathname, "/kernel/v0/reconciliation-permits/")) });
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/commands/")) {
    authenticateBootstrapOperator(request);
    const commandId = decodeURIComponent(url.pathname.slice("/kernel/v0/commands/".length));
    const receipt = await database.getCommandReceipt(installationId, environmentId, commandId);
    if (!receipt) throw new KernelError(404, "COMMAND_NOT_FOUND", "Command receipt does not exist.");
    return sendJson(response, 200, receipt);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/accountable-work/overview") {
    authenticateBootstrapOperator(request);
    const environment = await database.getEnvironment(installationId, environmentId);
    const items = await identityIntent.getAccountableWork();
    for (const item of items) {
      item.context = await contextService.contextForWorkIntent(item.intent.work_intent_id);
      item.package_versions = await packageService.packageVersionsForWorkIntent(item.intent.work_intent_id);
    }
    const deployments = await deploymentService.getButlerProjection();
    const handoffs = await handoffService.getButlerProjection();
    const runs = await executionService.getButlerProjection();
    const effects = await effectService.getButlerProjection();
    const recoveryCases = await recoveryService.getButlerProjection();
    const restore = await restoreService.getLatest();
    const support = await supportService.getButlerProjection();
    return sendJson(response, 200, {
      environment: serializeEnvironment(environment),
      health: "healthy",
      accountable_work: { count: items.length, items },
      deployments: { count: deployments.length, items: deployments },
      handoffs: { count: handoffs.length, items: handoffs },
      runs: { count: runs.length, items: runs },
      effects: { count: effects.length, items: effects },
      recovery_cases: { count: recoveryCases.length, items: recoveryCases },
      support,
      restore: restore ? { ...restore, unresolved_obligations: restore.obligations.filter(
        /** @param {any} item */ (item) => !item.resolved
      ).length } : null,
      authority: "read_only_projection"
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/butler/api/v0/overview") {
    response.writeHead(307, { location: "/kernel/v0/accountable-work/overview" });
    return response.end();
    return true;
  }

    return false;
  };
}
