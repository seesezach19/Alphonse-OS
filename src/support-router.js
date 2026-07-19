// @ts-check

/**
 * Support / internal / Butler HTTP routes extracted from the Kernel composition root.
 * Handlers are unchanged; only module boundaries moved.
 */

import { KernelError } from "./errors.js";

/**
 * @param {import("./route-context.js").RouteContext} ctx Composition-root services, config, and createRouteHelpers() result.
 * @returns {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, url: URL) => Promise<boolean>}
 */
export function createSupportRouter(ctx) {
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
    canonicalize, sha256Digest, createHmac, createPublicKey, timingSafeEqual,
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

  return async function supportRouter(request, response, url) {
  if (request.method === "GET" && url.pathname === "/healthz") {
    await database.ping();
    if (diagnosticDatabase) await diagnosticDatabase.ping();
    return sendJson(response, 200, {
      status: "healthy",
      protocol_version: PROTOCOL_VERSION,
      diagnostic_plane: diagnosticDatabase ? "healthy" : "not_configured",
      diagnostic_runtime: diagnosticRuntimeService ? "healthy" : "not_configured",
      diagnostic_repair_delivery: diagnosticRepairDeliveryService ? "healthy" : "not_configured",
      grant_authority: grantAuthorityService ? "healthy" : "not_configured",
      diagnostic_grant_receiver: diagnosticGrantApplicationService ? "healthy" : "not_configured",
      canonical_observation_intake: diagnosticObservationService ? "healthy" : "not_configured",
      tokenization_proof_registry: diagnosticTokenizationProofService ? "healthy" : "not_configured",
      correlation_projection: diagnosticCorrelationService ? "healthy" : "not_configured",
      effect_evaluation: diagnosticEffectEvaluationService ? "healthy" : "not_configured",
      evidence_packaging: diagnosticEvidencePackageService ? "healthy" : "not_configured"
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/internal/v0/grant-activation-snapshots") {
    const service = requireDiagnosticGrantApplication();
    authenticatePrivateService(request, grantAuthorityFeedToken,
      "GRANT_AUTHORITY_FEED_AUTHENTICATION_FAILED");
    const body = await readJson(request, 256 * 1024);
    const accepted = await service.applySnapshot(body.signed_snapshot_bytes);
    return sendCommandResult(response, accepted);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/authority/v0/grant-application-receipts") {
    const service = requireGrantAuthority();
    const actor = authenticatePrivateService(request, grantApplicationReceiptServiceToken,
      "GRANT_APPLICATION_RECEIPT_AUTHENTICATION_FAILED");
    const body = await readJson(request, 256 * 1024);
    return sendCommandResult(response, await service.acceptApplicationReceipt(body.signed_receipt_bytes, actor));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/internal/v0/tokenization-result-receipts") {
    const service = requireDiagnosticTokenizationProof();
    authenticatePrivateService(request, diagnosticTokenizationResultToken,
      "TOKENIZATION_RESULT_SERVICE_AUTHENTICATION_FAILED");
    const body = await readJson(request, 256 * 1024);
    return sendCommandResult(response, await service.preserveResultReceipt(body));
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/support/v0/diagnostic-bundles/")) {
    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith("Support ")) throw new KernelError(403, "SUPPORT_AUTHENTICATION_FAILED", "Support Passport credential required.");
    const bundleId = pathId(url.pathname, "/support/v0/diagnostic-bundles/");
    return sendJson(response, 200, await supportService.readDiagnostic(bundleId, authorization.slice("Support ".length)));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/runtime-hosts/placement-admission") {
    authenticateSubstrate(request);
    return sendJson(response, 200, await supportService.checkHostPlacement(await readJson(request)));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/workloads/admission") {
    authenticateSubstrate(request);
    return sendJson(response, 200, await handoffService.checkWorkloadGate(await readJson(request)));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/workloads/observations") {
    authenticateSubstrate(request);
    return sendCommandResult(response, await handoffService.recordObservation(await readJson(request)));
    return true;
  }

  if (request.method === "POST" && /^\/internal\/v0\/dispatch-permits\/[^/]+\/credential-delivery$/.test(url.pathname)) {
    authenticateBroker(request);
    const permitId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const input = await readJson(request);
    const accepted = await effectService.authorizeCredentialDelivery(permitId, input.permit_digest);
    return sendJson(response, accepted.replayed ? 200 : 201, accepted.result);
    return true;
  }

  if (request.method === "POST"
    && /^\/internal\/v0\/reconciliation-permits\/[^/]+\/credential-delivery$/.test(url.pathname)) {
    authenticateBroker(request);
    const permitId = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
    const input = await readJson(request);
    const accepted = await recoveryService.authorizeCredentialDelivery(permitId, input.permit_digest);
    return sendJson(response, accepted.replayed ? 200 : 201, accepted.result);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/context/authorize") {
    authenticateDataPlane(request);
    const input = await readJson(request);
    return sendJson(response, 200, await contextService.authorize({ ...input, agent_token: request.headers["x-agent-token"] }));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/context/receipts") {
    authenticateDataPlane(request);
    const receipt = await readJson(request);
    const signatureHeader = request.headers["x-receipt-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] ?? "" : signatureHeader ?? "";
    const expected = `hmac-sha256:${createHmac("sha256", dataPlaneReceiptSecret).update(canonicalize(receipt)).digest("hex")}`;
    const suppliedBytes = Buffer.from(signature, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw new KernelError(403, "INVALID_RECEIPT_SIGNATURE", "Context Receipt signature is invalid.");
    }
    return sendCommandResult(response, await contextService.recordReceipt(receipt, signature, dataPlaneId));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/butler") {
    try {
      authenticateBootstrapOperator(request);
    } catch (error) {
      if (error instanceof KernelError) {
        response.writeHead(401, { "www-authenticate": 'Basic realm="Alphonse Butler"' });
        return response.end("Authentication required.");
      }
      throw error;
    }
    /** @type {any[]} */
    const items = await identityIntent.getAccountableWork();
    for (const item of items) {
      item.context = await contextService.contextForWorkIntent(item.intent.work_intent_id);
      item.package_versions = await packageService.packageVersionsForWorkIntent(item.intent.work_intent_id);
    }
    /** @type {any[]} */
    const deployments = await deploymentService.getButlerProjection();
    /** @type {any[]} */
    const handoffs = await handoffService.getButlerProjection();
    /** @type {any[]} */
    const runs = await executionService.getButlerProjection();
    /** @type {any[]} */
    const effects = await effectService.getButlerProjection();
    /** @type {any[]} */
    const recoveryCases = await recoveryService.getButlerProjection();
    const restore = await restoreService.getLatest();
    const threads = items.length === 0 ? "<p>No accountable work.</p>" : items.map((item) =>
      `<article><h2>${escapeHtml(item.identity.agent_name)}</h2><dl><dt>Intent</dt><dd>${escapeHtml(item.intent.objective)}</dd><dt>Intent status</dt><dd>${escapeHtml(item.intent.status)}</dd><dt>Build Session</dt><dd>${escapeHtml(item.build_session.build_session_id)} / ${escapeHtml(item.build_session.status)}</dd><dt>Published package</dt><dd>${escapeHtml(item.package_versions[0] ? `${item.package_versions[0].package_id}@${item.package_versions[0].semantic_version} / ${item.package_versions[0].artifact_digest}` : "not_published")}</dd><dt>Package authority</dt><dd>${escapeHtml(item.package_versions[0]?.authority_granted ? "granted" : "not_granted")}</dd><dt>Context authority</dt><dd>${escapeHtml(item.context[0]?.authority ?? "not_granted")}</dd><dt>Context freshness</dt><dd>${escapeHtml(item.context[0]?.latest_receipt?.freshness_claims?.map(/** @param {any} claim */ (claim) => `${claim.source}:${claim.current_age_seconds}s ${claim.status}`).join(", ") ?? "not_observed")}</dd><dt>Redactions</dt><dd>${escapeHtml(item.context[0]?.latest_receipt?.limitations?.fields_redacted?.join(", ") ?? "none")}</dd><dt>Effect authority</dt><dd>${escapeHtml(item.authority.effects)}</dd><dt>Execution authority</dt><dd>${escapeHtml(item.authority.execution)}</dd></dl></article>`
    ).join("");
    const deploymentRows = deployments.length === 0 ? "<p>No staged deployments.</p>" : deployments.map((deployment) =>
      deployment.action_cards.map(/** @param {any} card */ (card) => `<article><h2>${escapeHtml(card.affected_objects.capability_export_id)}</h2><dl><dt>Package</dt><dd>${escapeHtml(card.states.package)} / ${escapeHtml(card.affected_objects.package_artifact_digest)}</dd><dt>Deployment</dt><dd>${escapeHtml(card.states.deployment)} / ${escapeHtml(card.affected_objects.deployment_id)}</dd><dt>Technical review</dt><dd>${escapeHtml(card.states.technical_review)}</dd><dt>Business approval</dt><dd>${escapeHtml(card.states.business_approval)}</dd><dt>Capability activation</dt><dd>${escapeHtml(card.states.capability_activation)}</dd><dt>Source reads</dt><dd>${escapeHtml(card.source_reads.sources.join(", "))}</dd><dt>Write target</dt><dd>${escapeHtml(card.write_target.map(/** @param {any} effect */ (effect) => `${effect.system}/${effect.target}:${effect.action}`).join(", "))}</dd><dt>Credential scope</dt><dd>${escapeHtml(card.credential_scope ? `${card.credential_scope.binding_ref}@${card.credential_scope.revision} / ${card.credential_scope.scopes.join(", ")}` : "not_required")}</dd><dt>Limits</dt><dd>${escapeHtml(JSON.stringify(card.limits))}</dd><dt>Evidence</dt><dd>${escapeHtml(card.evidence.required.join(", "))}</dd><dt>Recovery</dt><dd>${escapeHtml(`${card.recovery.strategy}; ${card.recovery.uncertainty}`)}</dd><dt>Current revision</dt><dd>${escapeHtml(card.current_revision)}</dd><dt>Permitted action</dt><dd>${escapeHtml(card.operation_id)}</dd></dl></article>`).join("")
    ).join("");
    const handoffRows = handoffs.length === 0 ? "<p>No runtime handoffs.</p>" : handoffs.map((handoff) =>
      `<article><h2>${escapeHtml(handoff.state)}</h2><dl><dt>Work Intent</dt><dd>${escapeHtml(handoff.work_intent_id)}</dd><dt>Source</dt><dd>${escapeHtml(handoff.source_passport_id)}</dd><dt>Target</dt><dd>${escapeHtml(handoff.target_passport_id)}</dd><dt>Ledger cursor</dt><dd>${escapeHtml(handoff.ledger_cursor)}</dd><dt>Workload</dt><dd>${escapeHtml(handoff.workload_digest)}</dd><dt>Ambient memory</dt><dd>not received</dd></dl></article>`).join("");
    const runRows = runs.length === 0 ? "<p>No admitted Runs.</p>" : runs.map((run) =>
      `<article><h2>${escapeHtml(run.run_id)}</h2><dl><dt>Execution</dt><dd>${escapeHtml(run.execution.status)}</dd><dt>Accountability</dt><dd>${escapeHtml(run.accountability.status)}</dd><dt>Envelope</dt><dd>${escapeHtml(run.envelope_id)}</dd><dt>Capability</dt><dd>${escapeHtml(run.bindings.capability_activation_id)}</dd><dt>Skill</dt><dd>${escapeHtml(`${run.bindings.skill.export_id}@${run.bindings.skill.contract_version}`)}</dd><dt>Context Receipts</dt><dd>${escapeHtml(run.bindings.context_receipt_ids.join(", "))}</dd><dt>Obligations</dt><dd>${escapeHtml(run.accountability.obligations.map(/** @param {any} item */ (item) => `${item.requirement}:${item.status}`).join(", "))}</dd><dt>Evidence</dt><dd>${escapeHtml(run.evidence?.evidence_record_id ?? "not_recorded")}</dd><dt>Source links</dt><dd>${escapeHtml(run.evidence?.source_links.map(/** @param {any} link */ (link) => `${link.context_receipt_id}/${link.source}/${link.subject}/${link.item_hash}`).join(", ") ?? "none")}</dd></dl></article>`).join("");
    const effectRows = effects.length === 0 ? "<p>No external Effects.</p>" : effects.map((effect) =>
      `<article><h2>${escapeHtml(effect.effect_id)}</h2><dl><dt>Exact action</dt><dd>${escapeHtml(`${effect.action} ${effect.target.resource}/${effect.target.subject} -> ${JSON.stringify(effect.requested_value)}`)}</dd><dt>Execution</dt><dd>${escapeHtml(effect.execution_status)}</dd><dt>Accountability</dt><dd>${escapeHtml(effect.accountability_status)}</dd><dt>Capability</dt><dd>${escapeHtml(effect.authority.capability_activation_id)}</dd><dt>Workload</dt><dd>${escapeHtml(effect.authority.workload_grant_id)}</dd><dt>Credential</dt><dd>${escapeHtml(`${effect.authority.credential_binding.binding_ref}@${effect.authority.credential_binding.revision} / ${effect.authority.credential_binding.scopes.join(", ")}`)}</dd><dt>Context</dt><dd>${escapeHtml(effect.authority.context_receipt_ids.join(", "))}</dd><dt>Permit</dt><dd>${escapeHtml(`${effect.permit.permit_id} / ${effect.permit.status}`)}</dd><dt>Evidence</dt><dd>${escapeHtml(effect.evidence?.evidence_record_id ?? "not_recorded")}</dd><dt>Source links</dt><dd>${escapeHtml(effect.evidence?.source_links.map(/** @param {any} link */ (link) => `${link.context_receipt_id}/${link.source}/${link.subject}/${link.item_hash}`).join(", ") ?? "none")}</dd><dt>Outcome</dt><dd>${escapeHtml(effect.evidence?.outcome ?? "pending")}</dd><dt>Recovery</dt><dd>${escapeHtml(`${effect.recovery.strategy}; ${effect.recovery.uncertainty}`)}</dd></dl></article>`).join("");
    const recoveryRows = recoveryCases.length === 0 ? "<p>No Recovery Cases.</p>" : recoveryCases.map((item) =>
      `<article><h2>${escapeHtml(item.recovery_case_id)}</h2><dl><dt>Status</dt><dd>${escapeHtml(item.status)}</dd><dt>Reconciliation</dt><dd>${escapeHtml(item.reconciliation_status)}</dd><dt>Original Effect</dt><dd>${escapeHtml(item.effect_id)}</dd><dt>Known facts</dt><dd>${escapeHtml(item.known_facts.map(/** @param {any} fact */ (fact) => fact.fact).join(", "))}</dd><dt>Missing evidence</dt><dd>${escapeHtml(item.missing_evidence.join(", "))}</dd><dt>Deadline</dt><dd>${escapeHtml(item.deadline_at)}</dd><dt>Responsible actor</dt><dd>${escapeHtml(`${item.responsible_actor.type}:${item.responsible_actor.principal_id}`)}</dd><dt>Allowed options</dt><dd>${escapeHtml(item.allowed_options.map(/** @param {any} option */ (option) => option.option).join(", "))}</dd><dt>History</dt><dd>was_uncertain</dd></dl></article>`).join("");
    return sendHtml(response, 200, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Butler</title>
<style>*{box-sizing:border-box}body{font:16px ui-monospace,SFMono-Regular,Consolas,monospace;width:min(808px,100%);margin:10vh auto;padding:24px;color:#151515;background:#f7f7f3}header{border-bottom:2px solid #151515;padding-bottom:16px}dl{display:grid;grid-template-columns:180px minmax(0,1fr);gap:10px}dt{font-weight:700}dd{overflow-wrap:anywhere}.ok{color:#087830}@media(max-width:540px){body{margin:4vh auto}dl{grid-template-columns:1fr;gap:4px}dd{margin:0 0 12px}}</style></head>
<body><header><strong>BUTLER</strong> / accountable operations</header><main><h1>${escapeHtml(environmentName)}</h1><p>Kernel health: <span class="ok">healthy</span></p><p>Environment authority: ${escapeHtml((await database.getEnvironment(installationId, environmentId)).operational_state)}</p><p>Restore: ${escapeHtml(restore ? `${restore.status}; ${restore.obligations.filter(/** @param {any} item */ (item) => !item.resolved).length} unresolved obligation(s)` : "none")}</p><p>${items.length} accountable item(s)</p>${threads}<h1>Deployment authority</h1>${deploymentRows}<h1>Runtime handoffs</h1>${handoffRows}<h1>Runs and accountability</h1>${runRows}<h1>Effects</h1>${effectRows}<h1>Recovery Cases</h1>${recoveryRows}<p>Butler derives permitted actions from Kernel state. Execution and accountability remain independently visible.</p></main></body></html>`);
    return true;
  }

    return false;
  };
}
