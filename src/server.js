import { createHmac, createPublicKey, timingSafeEqual } from "node:crypto";
import http from "node:http";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { createContentAddressedArtifactStore } from "./content-addressed-artifact-store.js";
import { createContextService } from "./context-service.js";
import { createDatabase } from "./database.js";
import { createDeploymentService } from "./deployment-service.js";
import { createDiagnosticDatabase } from "./diagnostic-database.js";
import { createDiagnosticRuntimeService } from "./diagnostic-runtime-service.js";
import { createDiagnosticReproductionService } from "./diagnostic-reproduction-service.js";
import { createDiagnosticRepairWorkerService } from "./diagnostic-repair-worker-service.js";
import { createDiagnosticDiagnosisService } from "./diagnostic-diagnosis-service.js";
import { createDiagnosticRepairDeliveryService } from "./diagnostic-repair-delivery-service.js";
import { createDiagnosticVerificationService } from "./diagnostic-verification-service.js";
import { createDiagnosticPromotionService } from "./diagnostic-promotion-service.js";
import {
  DIAGNOSTIC_PROTOCOL_VERSION,
  getDiagnosticOperationDescriptor,
  listDiagnosticOperationDescriptors
} from "./diagnostic-operations.js";
import { createDiagnosticService } from "./diagnostic-service.js";
import { createEffectService } from "./effect-service.js";
import { createEnvironmentCoordinationService } from "./environment-coordination-service.js";
import { CoordinationContractError } from "./coordination-contracts.js";
import { createExecutionService } from "./execution-service.js";
import { KernelError } from "./errors.js";
import { createIdentityIntentService, validateCommandEnvelope } from "./identity-intent-service.js";
import { createHandoffService } from "./handoff-service.js";
import { createGrantAuthorityService } from "./grant-authority-service.js";
import { createDiagnosticGrantApplicationService } from "./diagnostic-grant-application-service.js";
import { createDiagnosticObservationService } from "./diagnostic-observation-service.js";
import { createDiagnosticTokenizationProofService } from "./diagnostic-tokenization-proof-service.js";
import { createDiagnosticCorrelationService } from "./diagnostic-correlation-service.js";
import { createDiagnosticEffectEvaluationService } from "./diagnostic-effect-evaluation-service.js";
import { createDiagnosticEvidencePackageService } from "./diagnostic-evidence-package-service.js";
import { createIndependentDiagnosticVerificationService } from "./independent-diagnostic-verification-service.js";
import { createDiagnosticAssignmentService } from "./diagnostic-assignment-service.js";
import { createDiagnosticMaterialAvailabilityService } from "./diagnostic-material-availability-service.js";
import { createLegacyRuntimeCompatibility } from "./legacy-runtime-compatibility.js";
import { getOperationDescriptor, listOperationDescriptors, PROTOCOL_VERSION } from "./operations.js";
import { createPackageService } from "./package-service.js";
import { createPackageTrustService } from "./package-trust-service.js";
import { createRecoveryService } from "./recovery-service.js";
import { createRestoreService } from "./restore-service.js";
import { createRuntimeDetailClient } from "./runtime-detail-client.js";
import { createSupportService } from "./support-service.js";
import { createUpgradeService } from "./upgrade-service.js";
import { validateProfileUpdateCommand } from "./validation.js";
import { getWorkflowRuntimeAdapterContract } from "./workflow-runtime-adapter-contract.js";
import { getRepairDeliveryAdapterContract } from "./repair-delivery-adapter-contract.js";
import { getVerificationRunnerContract } from "./diagnostic-verification-contracts.js";
import { createVerificationRunnerClient } from "./verification-runner-client.js";
import { authorizeTrustedOperator, directOwnerActor } from "./trusted-operator.js";

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const diagnosticDatabaseUrl = process.env.DIAGNOSTIC_DATABASE_URL;
const diagnosticArtifactRoot = process.env.DIAGNOSTIC_ARTIFACT_ROOT ?? "/tmp/alphonse-diagnostic-artifacts";
const diagnosticRuntimeAdapterId = process.env.DIAGNOSTIC_RUNTIME_ADAPTER_ID;
const diagnosticRuntimeAdapterVersion = process.env.DIAGNOSTIC_RUNTIME_ADAPTER_VERSION;
const diagnosticRuntimeAdapterKeyId = process.env.DIAGNOSTIC_RUNTIME_ADAPTER_KEY_ID;
const diagnosticRuntimeAdapterSecret = process.env.DIAGNOSTIC_RUNTIME_ADAPTER_SECRET;
const diagnosticRuntimeTimestampToleranceSeconds = Number(
  process.env.DIAGNOSTIC_RUNTIME_TIMESTAMP_TOLERANCE_SECONDS ?? 300
);
const diagnosticRuntimeDetailUrl = process.env.DIAGNOSTIC_RUNTIME_DETAIL_URL;
const diagnosticRuntimeDetailToken = process.env.DIAGNOSTIC_RUNTIME_DETAIL_TOKEN;
const n8nRepairDeliveryUrl = process.env.N8N_REPAIR_DELIVERY_URL;
const n8nRepairDeliveryApiKey = process.env.N8N_REPAIR_DELIVERY_API_KEY;
const n8nRepairDeliveryCredentialBindingRef = process.env.N8N_REPAIR_DELIVERY_CREDENTIAL_BINDING_REF;
const n8nRepairDeliveryTimeoutMs = Number(process.env.N8N_REPAIR_DELIVERY_TIMEOUT_MS ?? 5_000);
const verificationRunnerId = process.env.VERIFICATION_RUNNER_ID
  ?? "00000000-0000-4000-8000-000000000700";
const verificationRunnerVersion = process.env.VERIFICATION_RUNNER_VERSION ?? "0.2.0";
const verificationFixtureVersion = process.env.VERIFICATION_FIXTURE_VERSION ?? "inventory-v1";
const verificationSigningKeyId = process.env.VERIFICATION_RUNNER_SIGNING_KEY_ID
  ?? "local-verification-runner-key-v1";
const verificationSigningSecret = process.env.VERIFICATION_RUNNER_SIGNING_SECRET;
const diagnosticRuntimeDetailPolicy = JSON.parse(process.env.DIAGNOSTIC_RUNTIME_DETAIL_POLICY ?? JSON.stringify({
  policy_id: "diagnostic-detail-not-configured",
  extract_paths: ["detail"],
  redact_paths: [],
  omit_paths: ["unconfigured"],
  replacement: "[REDACTED]"
}));
const installationId = process.env.KERNEL_INSTALLATION_ID ?? "00000000-0000-4000-8000-00000000a001";
const installationName = process.env.KERNEL_INSTALLATION_NAME ?? "Local Installation";
const environmentId = process.env.KERNEL_ENVIRONMENT_ID ?? "00000000-0000-4000-8000-000000000001";
const environmentName = process.env.KERNEL_ENVIRONMENT_NAME ?? "Local Development";
const environmentClass = process.env.KERNEL_ENVIRONMENT_CLASS ?? "development";
const bootstrapToken = process.env.KERNEL_BOOTSTRAP_TOKEN;
const ownerToken = process.env.KERNEL_OWNER_TOKEN ?? bootstrapToken;
const bootstrapPrincipalId = process.env.KERNEL_BOOTSTRAP_PRINCIPAL_ID ?? "local-bootstrap-operator";
const dataPlaneServiceToken = process.env.DATA_PLANE_SERVICE_TOKEN;
const dataPlaneReceiptSecret = process.env.DATA_PLANE_RECEIPT_SECRET;
const dataPlaneId = process.env.DATA_PLANE_ID ?? "reference-data-plane";
const packageSigningSecret = process.env.KERNEL_PACKAGE_SIGNING_SECRET;
const packageSigningKeyId = process.env.KERNEL_PACKAGE_SIGNING_KEY_ID ?? "local-package-signing-key-v1";
const packageVerificationKeys = JSON.parse(process.env.KERNEL_PACKAGE_VERIFICATION_KEYS ?? "{}");
const workloadGrantSecret = process.env.KERNEL_WORKLOAD_GRANT_SIGNING_SECRET;
const workloadGrantKeyId = process.env.KERNEL_WORKLOAD_GRANT_SIGNING_KEY_ID ?? "local-workload-grant-key-v1";
const substrateServiceToken = process.env.SUBSTRATE_SERVICE_TOKEN;
const substrateObservationSecret = process.env.SUBSTRATE_OBSERVATION_SECRET;
const substrateObservationKeyId = process.env.SUBSTRATE_OBSERVATION_KEY_ID ?? "local-substrate-observation-key-v1";
const dispatchPermitSecret = process.env.DISPATCH_PERMIT_SIGNING_SECRET;
const dispatchPermitKeyId = process.env.DISPATCH_PERMIT_SIGNING_KEY_ID ?? "local-dispatch-permit-key-v1";
const trustedAdapterUrl = process.env.TRUSTED_ADAPTER_URL;
const kernelAdapterToken = process.env.KERNEL_ADAPTER_TOKEN;
const brokerServiceToken = process.env.BROKER_SERVICE_TOKEN;
const adapterDispatchTimeoutMs = Number(process.env.ADAPTER_DISPATCH_TIMEOUT_MS ?? 2_000);
const environmentCoordinationPrivateKey = process.env.KERNEL_COORDINATION_PRIVATE_KEY;
const coordinatorEnrollmentToken = process.env.COORDINATOR_ENROLLMENT_TOKEN;
const supportDiagnosticSecret = process.env.KERNEL_SUPPORT_DIAGNOSTIC_SECRET;
const grantSnapshotSigningKeyId = process.env.KERNEL_GRANT_SNAPSHOT_SIGNING_KEY_ID;
const grantSnapshotSigningSecret = process.env.KERNEL_GRANT_SNAPSHOT_SIGNING_SECRET;
const diagnosticGrantApplicationKeyId = process.env.DIAGNOSTIC_GRANT_APPLICATION_SIGNING_KEY_ID;
const diagnosticGrantApplicationSecret = process.env.DIAGNOSTIC_GRANT_APPLICATION_SIGNING_SECRET;
const grantAuthorityFeedToken = process.env.GRANT_AUTHORITY_FEED_TOKEN;
const grantApplicationReceiptServiceToken = process.env.GRANT_APPLICATION_RECEIPT_SERVICE_TOKEN;
const diagnosticObserverKeys = JSON.parse(process.env.DIAGNOSTIC_OBSERVER_KEYS ?? "{}");
const diagnosticRuntimeCompatibilityConfig = process.env.DIAGNOSTIC_RUNTIME_COMPATIBILITY_CONFIG
  ? JSON.parse(process.env.DIAGNOSTIC_RUNTIME_COMPATIBILITY_CONFIG)
  : null;
const tokenizationGrantApplicationKeyId = process.env.TOKENIZATION_GRANT_APPLICATION_SIGNING_KEY_ID;
const tokenizationGrantApplicationSecret = process.env.TOKENIZATION_GRANT_APPLICATION_SIGNING_SECRET;
const tokenizationServiceKeyId = process.env.TOKENIZATION_SERVICE_SIGNING_KEY_ID;
const tokenizationServicePublicKeyDer = process.env.TOKENIZATION_SERVICE_PUBLIC_KEY_DER_BASE64;
const diagnosticTokenizationResultToken = process.env.DIAGNOSTIC_TOKENIZATION_RESULT_TOKEN;

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!bootstrapToken) throw new Error("KERNEL_BOOTSTRAP_TOKEN is required.");
if (!dataPlaneServiceToken || !dataPlaneReceiptSecret) throw new Error("Data Plane service credentials are required.");
if (!packageSigningSecret) throw new Error("KERNEL_PACKAGE_SIGNING_SECRET is required.");
if (!workloadGrantSecret || !substrateServiceToken || !substrateObservationSecret) throw new Error("Runtime substrate credentials are required.");
if (!dispatchPermitSecret || !trustedAdapterUrl || !kernelAdapterToken || !brokerServiceToken) {
  throw new Error("Effect dispatch plane configuration is required.");
}
if (!supportDiagnosticSecret) throw new Error("KERNEL_SUPPORT_DIAGNOSTIC_SECRET is required.");

const database = createDatabase(databaseUrl);
await database.migrate();
await database.bootstrapEnvironment(installationId, installationName, environmentId, environmentName, environmentClass);
let diagnosticDatabase = null;
let diagnosticService = null;
let diagnosticRuntimeService = null;
let diagnosticReproductionService = null;
let diagnosticRepairWorkerService = null;
let diagnosticDiagnosisService = null;
let diagnosticRepairDeliveryService = null;
let diagnosticVerificationService = null;
let diagnosticPromotionService = null;
let diagnosticArtifactStore = null;
let diagnosticGrantApplicationService = null;
let diagnosticObservationService = null;
let diagnosticTokenizationProofService = null;
let diagnosticCorrelationService = null;
let diagnosticEffectEvaluationService = null;
let diagnosticEvidencePackageService = null;
let diagnosticIndependentVerificationService = null;
let diagnosticAssignmentService = null;
let diagnosticMaterialAvailabilityService = null;
if (diagnosticDatabaseUrl) {
  if (!diagnosticRuntimeAdapterId || !diagnosticRuntimeAdapterVersion || !diagnosticRuntimeAdapterKeyId
      || !diagnosticRuntimeAdapterSecret) {
    throw new Error("Diagnostic Runtime Adapter binding is required when the Diagnostic Plane is configured.");
  }
  diagnosticDatabase = createDiagnosticDatabase(diagnosticDatabaseUrl);
  await diagnosticDatabase.migrate();
  await diagnosticDatabase.bootstrapNode(installationId);
  diagnosticArtifactStore = createContentAddressedArtifactStore(diagnosticArtifactRoot);
  diagnosticMaterialAvailabilityService = createDiagnosticMaterialAvailabilityService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    installationId,
    environmentId
  });
  diagnosticArtifactStore.setMaterialGuard(
    diagnosticMaterialAvailabilityService.createArtifactAccessGuard()
  );
  diagnosticService = createDiagnosticService(
    diagnosticDatabase, diagnosticArtifactStore, installationId, diagnosticMaterialAvailabilityService
  );
  const canonicalCompatibility = diagnosticRuntimeCompatibilityConfig
    ? createLegacyRuntimeCompatibility({
      ...diagnosticRuntimeCompatibilityConfig,
      installationId,
      environmentId,
      secret: diagnosticObserverKeys[diagnosticRuntimeCompatibilityConfig.keyId]
    }, async (input) => {
      if (!diagnosticObservationService) {
        throw new KernelError(503, "CANONICAL_OBSERVATION_INTAKE_UNAVAILABLE",
          "Canonical observation intake is not configured.");
      }
      return diagnosticObservationService.receiveObservation(input);
    })
    : null;
  diagnosticRuntimeService = createDiagnosticRuntimeService(diagnosticDatabase, installationId, {
    adapter_id: diagnosticRuntimeAdapterId,
    adapter_version: diagnosticRuntimeAdapterVersion,
    key_id: diagnosticRuntimeAdapterKeyId,
    secret: diagnosticRuntimeAdapterSecret
  }, { timestampToleranceSeconds: diagnosticRuntimeTimestampToleranceSeconds, canonicalCompatibility });
  const unavailableDetailClient = {
    async retrieveExecutionDetail() {
      throw new KernelError(503, "RUNTIME_DETAIL_UNAVAILABLE", "Runtime detail adapter is not configured.");
    },
    async reproduce() {
      throw new KernelError(503, "RUNTIME_DETAIL_UNAVAILABLE", "Runtime reproduction adapter is not configured.");
    }
  };
  diagnosticReproductionService = createDiagnosticReproductionService(
    diagnosticDatabase,
    diagnosticArtifactStore,
    installationId,
    diagnosticRuntimeDetailUrl && diagnosticRuntimeDetailToken
      ? createRuntimeDetailClient({ baseUrl: diagnosticRuntimeDetailUrl, token: diagnosticRuntimeDetailToken })
      : unavailableDetailClient,
    diagnosticRuntimeDetailPolicy,
    diagnosticMaterialAvailabilityService
  );
}
const identityIntent = createIdentityIntentService(database, installationId, environmentId, bootstrapPrincipalId);
const grantAuthorityConfigured = grantSnapshotSigningKeyId && grantSnapshotSigningSecret
  && diagnosticGrantApplicationKeyId && diagnosticGrantApplicationSecret;
const grantAuthorityService = grantAuthorityConfigured
  ? createGrantAuthorityService(database, installationId, environmentId, {
    snapshotKeyId: grantSnapshotSigningKeyId,
    snapshotSecret: grantSnapshotSigningSecret,
    applicationKeys: {
      "diagnostic-plane": {
        keyId: diagnosticGrantApplicationKeyId,
        secret: diagnosticGrantApplicationSecret
      },
      ...(tokenizationGrantApplicationKeyId && tokenizationGrantApplicationSecret ? {
        "tokenization-service": {
          keyId: tokenizationGrantApplicationKeyId,
          secret: tokenizationGrantApplicationSecret
        }
      } : {})
    }
  })
  : null;
if (diagnosticDatabase) {
  if (grantAuthorityConfigured) {
    diagnosticGrantApplicationService = createDiagnosticGrantApplicationService(
      diagnosticDatabase, installationId, {
        serviceId: "diagnostic-plane",
        authorityKey: { keyId: grantSnapshotSigningKeyId, secret: grantSnapshotSigningSecret },
        applicationKey: { keyId: diagnosticGrantApplicationKeyId, secret: diagnosticGrantApplicationSecret }
      }
    );
  }
  diagnosticRepairWorkerService = createDiagnosticRepairWorkerService(
    diagnosticDatabase, diagnosticArtifactStore, installationId, identityIntent
  );
  diagnosticDiagnosisService = createDiagnosticDiagnosisService(
    diagnosticDatabase, diagnosticArtifactStore, installationId, identityIntent
  );
  const repairDeliveryConfigured = n8nRepairDeliveryUrl && n8nRepairDeliveryApiKey &&
    n8nRepairDeliveryCredentialBindingRef;
  if (repairDeliveryConfigured) {
    const {
      createN8nRepairDeliveryAdapter,
      N8N_REPAIR_DELIVERY_ADAPTER_MANIFEST
    } = await import("../packages/n8n-operational-package/src/repair-delivery-adapter.js");
    const repairDeliveryAdapter = createN8nRepairDeliveryAdapter({
      baseUrl: n8nRepairDeliveryUrl, apiKey: n8nRepairDeliveryApiKey,
      requestTimeoutMs: n8nRepairDeliveryTimeoutMs
    });
    await repairDeliveryAdapter.checkHealth();
    diagnosticRepairDeliveryService = createDiagnosticRepairDeliveryService({
      database: diagnosticDatabase,
      artifactStore: diagnosticArtifactStore,
      installationId,
      adapter: repairDeliveryAdapter,
      adapterManifest: N8N_REPAIR_DELIVERY_ADAPTER_MANIFEST,
      credentialBindingRef: n8nRepairDeliveryCredentialBindingRef
    });
    diagnosticPromotionService = createDiagnosticPromotionService({
      database: diagnosticDatabase,
      artifactStore: diagnosticArtifactStore,
      installationId,
      adapter: repairDeliveryAdapter,
      adapterManifest: N8N_REPAIR_DELIVERY_ADAPTER_MANIFEST,
      credentialBindingRef: n8nRepairDeliveryCredentialBindingRef
    });
  }
  diagnosticVerificationService = createDiagnosticVerificationService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    installationId,
    runnerClient: verificationSigningSecret ? createVerificationRunnerClient({
      keyId: verificationSigningKeyId,
      signingSecret: verificationSigningSecret
    }) : null,
    runner: {
      runner_id: verificationRunnerId,
      runner_version: verificationRunnerVersion,
      fixture_version: verificationFixtureVersion
    }
  });
  if (tokenizationServiceKeyId && tokenizationServicePublicKeyDer
      && grantSnapshotSigningKeyId && grantSnapshotSigningSecret
      && tokenizationGrantApplicationKeyId && tokenizationGrantApplicationSecret) {
    diagnosticTokenizationProofService = createDiagnosticTokenizationProofService(
      diagnosticDatabase, installationId, environmentId, {
        serviceKeyId: tokenizationServiceKeyId,
        servicePublicKey: createPublicKey({
          key: Buffer.from(tokenizationServicePublicKeyDer, "base64"), format: "der", type: "spki"
        }),
        authorityKey: { keyId: grantSnapshotSigningKeyId, secret: grantSnapshotSigningSecret },
        applicationKey: {
          keyId: tokenizationGrantApplicationKeyId,
          secret: tokenizationGrantApplicationSecret
        }
      }
    );
  }
}
const contextService = createContextService(database, identityIntent, installationId, environmentId);
const packageService = createPackageService(database, identityIntent, contextService, installationId, environmentId,
  packageSigningSecret, packageSigningKeyId, dataPlaneReceiptSecret, dataPlaneId, packageVerificationKeys);
const packageTrustService = createPackageTrustService(database, installationId, environmentId, environmentClass);
const deploymentService = createDeploymentService(database, identityIntent, packageService, installationId, environmentId);
if (diagnosticDatabase && diagnosticArtifactStore) {
  const resolveDeployedExports = async (deploymentId, exportIds) => {
    const deployment = await deploymentService.getDeployment(deploymentId);
    const packageVersion = await packageService.getPackageVersion(deployment.package_version_id);
    const exports = new Map();
    for (const exportId of exportIds) {
      const exported = packageVersion.candidate.exports.find((entry) => entry.export_id === exportId);
      if (!exported) {
        throw new KernelError(404, "DEPLOYED_DIAGNOSTIC_EXPORT_NOT_FOUND",
          "Deployment does not contain a requested diagnostic export.", { export_id: exportId });
      }
      exports.set(exportId, exported);
    }
    return {
      deployment_id: deployment.deployment_id,
      package_version_id: packageVersion.package_version_id,
      package_artifact_digest: packageVersion.artifact_digest,
      exports
    };
  };
  diagnosticObservationService = createDiagnosticObservationService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    installationId,
    environmentId,
    observerKeys: diagnosticObserverKeys,
    dependencyValidator: diagnosticTokenizationProofService,
    async resolveDeployedSchema(deploymentId, schemaExportId) {
      const deployment = await deploymentService.getDeployment(deploymentId);
      const packageVersion = await packageService.getPackageVersion(deployment.package_version_id);
      const exported = packageVersion.candidate.exports.find((entry) => entry.export_id === schemaExportId);
      if (!exported) {
        throw new KernelError(404, "DEPLOYED_OBSERVATION_SCHEMA_NOT_FOUND",
          "Deployment does not contain the requested Schema export.");
      }
      return {
        deployment_id: deployment.deployment_id,
        package_version_id: packageVersion.package_version_id,
        package_artifact_digest: packageVersion.artifact_digest,
        export_record: { ...exported, export_digest: sha256Digest(exported.content) }
      };
    }
  });
  diagnosticCorrelationService = createDiagnosticCorrelationService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    installationId,
    environmentId,
    tokenizationVerifier: diagnosticTokenizationProofService,
    async resolveDeployment(deploymentId) {
      const deployment = await deploymentService.getDeployment(deploymentId);
      const packageVersion = await packageService.getPackageVersion(deployment.package_version_id);
      return {
        deployment_id: deployment.deployment_id,
        package_version_id: packageVersion.package_version_id,
        package_artifact_digest: packageVersion.artifact_digest,
        package_manifest_digest: packageVersion.manifest_digest,
        package_dependency_digest: packageVersion.dependency_digest
      };
    }
  });
  diagnosticEffectEvaluationService = createDiagnosticEffectEvaluationService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    installationId,
    environmentId,
    correlationReader: diagnosticCorrelationService,
    resolveDeploymentExports: resolveDeployedExports
  });
  diagnosticIndependentVerificationService = createIndependentDiagnosticVerificationService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    installationId,
    environmentId,
    tokenizationVerificationIdentity: {
      service_key_id: tokenizationServiceKeyId ?? null,
      public_key_der_base64: tokenizationServicePublicKeyDer ?? null
    },
    resolveDeploymentExports: resolveDeployedExports,
    materialAuthority: diagnosticMaterialAvailabilityService
  });
  diagnosticEvidencePackageService = createDiagnosticEvidencePackageService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    installationId,
    environmentId,
    correlationReader: diagnosticCorrelationService,
    effectReader: diagnosticEffectEvaluationService,
    verificationBundleWriter: diagnosticIndependentVerificationService,
    resolveDeploymentExports: resolveDeployedExports,
    materialAuthority: diagnosticMaterialAvailabilityService
  });
  diagnosticAssignmentService = createDiagnosticAssignmentService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    installationId,
    environmentId,
    packageReader: diagnosticEvidencePackageService,
    resolveDeploymentExports: resolveDeployedExports,
    materialAuthority: diagnosticMaterialAvailabilityService
  });
  diagnosticEvidencePackageService.startRevisionMonitor();
  diagnosticAssignmentService.start();
}
const upgradeService = createUpgradeService(database, identityIntent, packageService, deploymentService,
  installationId, environmentId, dataPlaneReceiptSecret);
const handoffService = createHandoffService(database, identityIntent, contextService, packageService, deploymentService,
  installationId, environmentId, workloadGrantSecret, workloadGrantKeyId, substrateObservationSecret, substrateObservationKeyId);
const executionService = createExecutionService(database, identityIntent, packageService, deploymentService,
  installationId, environmentId);
const recoveryService = createRecoveryService(database, contextService, executionService, installationId, environmentId,
  dispatchPermitSecret, dispatchPermitKeyId, trustedAdapterUrl, kernelAdapterToken);
const restoreService = createRestoreService(database, identityIntent, recoveryService, installationId, environmentId);
const effectService = createEffectService(database, identityIntent, contextService, packageService, deploymentService,
  handoffService, executionService, installationId, environmentId, dispatchPermitSecret, dispatchPermitKeyId,
  trustedAdapterUrl, kernelAdapterToken, recoveryService, adapterDispatchTimeoutMs);
const environmentCoordination = createEnvironmentCoordinationService(database, {
  installationId, environmentId, environmentClass, environmentPrivateKey: environmentCoordinationPrivateKey,
  coordinatorEnrollmentToken, kernelBuild: process.env.KERNEL_BUILD ?? "0.1.0", protocolVersion: PROTOCOL_VERSION
});
const supportService = createSupportService(database, deploymentService, {
  installationId, environmentId, environmentPrivateKey: environmentCoordinationPrivateKey,
  diagnosticSecret: supportDiagnosticSecret
});

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function sendHtml(response, status, html) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

async function readJson(request, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw new KernelError(413, "REQUEST_TOO_LARGE", `Command body exceeds ${Math.floor(limit / 1024)} KiB.`);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new KernelError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function serializeEnvironment(environment) {
  return {
    installation_id: environment.installation_id,
    environment_id: environment.environment_id,
    display_name: environment.display_name,
    environment_class: environment.environment_class,
    revision: environment.revision,
    execution_epoch: environment.execution_epoch,
    operational_state: environment.operational_state,
    restore_generation: environment.restore_generation,
    created_at: environment.created_at,
    updated_at: environment.updated_at
  };
}

function authenticateBootstrapOperator(request) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Agent ")) {
    throw new KernelError(403, "OWNER_AUTHORITY_REQUIRED",
      "Agent Passports cannot invoke customer Owner operations.");
  }
  let credential = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  if (authorization?.startsWith("Owner ")) {
    credential = authorization.slice("Owner ".length);
  }
  if (authorization?.startsWith("Basic ")) {
    credential = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8").split(":").slice(1).join(":");
  }
  if (!credential) {
    throw new KernelError(401, "AUTHENTICATION_REQUIRED", "Bootstrap operator credential is required.");
  }

  const supplied = Buffer.from(credential, "utf8");
  const expected = Buffer.from(ownerToken, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new KernelError(403, "INVALID_BOOTSTRAP_CREDENTIAL", "Bootstrap operator credential is invalid.");
  }

  return { type: "human", id: bootstrapPrincipalId };
}

async function authenticateDiagnosticOwner(request, operationId) {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Operator ")) {
    const passport = await identityIntent.authenticateAgent(authorization.slice("Operator ".length));
    return authorizeTrustedOperator(passport, operationId, request.headers).actor;
  }
  return directOwnerActor(authenticateBootstrapOperator(request));
}

function sendCommandResult(response, accepted) {
  return sendJson(response, accepted.replayed ? 200 : 201, accepted.result, {
    "idempotent-replayed": accepted.replayed ? "true" : "false"
  });
}

function pathId(pathname, prefix) {
  return decodeURIComponent(pathname.slice(prefix.length));
}

function requireRouteTaskMatch(pathname, body) {
  const routeTaskId = decodeURIComponent(pathname.split("/").at(-2));
  if (body?.input?.task_id !== routeTaskId) {
    throw new KernelError(409, "REPAIR_TASK_ROUTE_MISMATCH", "Route Repair Task ID must match command input.");
  }
  return body;
}

function requireDiagnosticPlane() {
  if (!diagnosticService || !diagnosticDatabase) {
    throw new KernelError(503, "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic Plane is not configured for this Node.");
  }
  return diagnosticService;
}

function requireDiagnosticRuntime() {
  if (!diagnosticRuntimeService) {
    throw new KernelError(503, "DIAGNOSTIC_RUNTIME_UNAVAILABLE", "Diagnostic Runtime intake is not configured.");
  }
  return diagnosticRuntimeService;
}

function requireDiagnosticReproduction() {
  if (!diagnosticReproductionService) {
    throw new KernelError(503, "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic reproduction is not configured.");
  }
  return diagnosticReproductionService;
}

function requireGrantAuthority() {
  if (!grantAuthorityService) {
    throw new KernelError(503, "GRANT_AUTHORITY_UNAVAILABLE", "Grant authority protocol is not configured.");
  }
  return grantAuthorityService;
}

function requireDiagnosticGrantApplication() {
  if (!diagnosticGrantApplicationService) {
    throw new KernelError(503, "GRANT_APPLICATION_RECEIVER_UNAVAILABLE", "Diagnostic grant receiver is not configured.");
  }
  return diagnosticGrantApplicationService;
}

function requireDiagnosticObservation() {
  if (!diagnosticObservationService) {
    throw new KernelError(503, "OBSERVATION_INTAKE_UNAVAILABLE", "Canonical observation intake is not configured.");
  }
  return diagnosticObservationService;
}

function requireDiagnosticTokenizationProof() {
  if (!diagnosticTokenizationProofService) {
    throw new KernelError(503, "TOKENIZATION_PROOF_UNAVAILABLE",
      "Tokenization Result Receipt verification is not configured.");
  }
  return diagnosticTokenizationProofService;
}

function requireDiagnosticCorrelation() {
  if (!diagnosticCorrelationService) {
    throw new KernelError(503, "CORRELATION_PROJECTION_UNAVAILABLE",
      "Deterministic correlation projection is not configured.");
  }
  return diagnosticCorrelationService;
}

function requireDiagnosticEffectEvaluation() {
  if (!diagnosticEffectEvaluationService) {
    throw new KernelError(503, "DIAGNOSTIC_EFFECT_EVALUATION_UNAVAILABLE",
      "Deterministic effect interpretation and behavior evaluation are not configured.");
  }
  return diagnosticEffectEvaluationService;
}

function requireDiagnosticEvidencePackaging() {
  if (!diagnosticEvidencePackageService) {
    throw new KernelError(503, "DIAGNOSTIC_EVIDENCE_PACKAGING_UNAVAILABLE",
      "Deterministic evidence collection and packaging are not configured.");
  }
  return diagnosticEvidencePackageService;
}

function requireDiagnosticMaterialAvailability() {
  if (!diagnosticMaterialAvailabilityService) {
    throw new KernelError(503, "DIAGNOSTIC_MATERIAL_AUTHORITY_UNAVAILABLE",
      "Diagnostic material availability and erasure authority is not configured.");
  }
  return diagnosticMaterialAvailabilityService;
}

function requireDiagnosticAssignment() {
  if (!diagnosticAssignmentService) {
    throw new KernelError(503, "DIAGNOSTIC_ASSIGNMENT_SERVICE_UNAVAILABLE",
      "Diagnostic Assignment Service is not configured.");
  }
  return diagnosticAssignmentService;
}

function requireIndependentDiagnosticVerification() {
  if (!diagnosticIndependentVerificationService) {
    throw new KernelError(503, "INDEPENDENT_DIAGNOSTIC_VERIFICATION_UNAVAILABLE",
      "Independent diagnostic verification is not configured.");
  }
  return diagnosticIndependentVerificationService;
}

function observationAuthentication(request, body) {
  return body.authentication ?? {
    principal_id: request.headers["x-observation-principal-id"],
    grant_id: request.headers["x-observation-grant-id"],
    key_id: request.headers["x-observation-key-id"],
    signed_at: request.headers["x-observation-signed-at"],
    signature: request.headers["x-observation-signature"]
  };
}

function authenticatePrivateService(request, expectedToken, code) {
  if (!expectedToken) throw new KernelError(503, `${code}_UNAVAILABLE`, "Private service authentication is not configured.");
  const suppliedValue = request.headers.authorization?.startsWith("Bearer ")
    ? request.headers.authorization.slice("Bearer ".length) : "";
  const supplied = Buffer.from(suppliedValue, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new KernelError(403, code, "Private service authentication failed.");
  }
  return { type: "service", id: code === "GRANT_AUTHORITY_FEED_AUTHENTICATION_FAILED"
    ? "kernel-grant-authority-feed" : "diagnostic-plane" };
}

function requireDiagnosticRepairWorker() {
  if (!diagnosticRepairWorkerService) {
    throw new KernelError(503, "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic repair workers are not configured.");
  }
  return diagnosticRepairWorkerService;
}

function requireDiagnosticDiagnosis() {
  if (!diagnosticDiagnosisService) {
    throw new KernelError(503, "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic workers are not configured.");
  }
  return diagnosticDiagnosisService;
}

function requireDiagnosticRepairDelivery() {
  if (!diagnosticRepairDeliveryService) {
    throw new KernelError(503, "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic repair delivery is not configured.");
  }
  return diagnosticRepairDeliveryService;
}

function requireDiagnosticVerification() {
  if (!diagnosticVerificationService) {
    throw new KernelError(503, "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic verification is not configured.");
  }
  return diagnosticVerificationService;
}

function requireDiagnosticPromotion() {
  if (!diagnosticPromotionService) {
    throw new KernelError(503, "DIAGNOSTIC_PLANE_UNAVAILABLE", "Diagnostic promotion is not configured.");
  }
  return diagnosticPromotionService;
}

function authenticateDataPlane(request) {
  const supplied = request.headers.authorization?.startsWith("Bearer ")
    ? Buffer.from(request.headers.authorization.slice(7), "utf8") : Buffer.alloc(0);
  const expected = Buffer.from(dataPlaneServiceToken, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new KernelError(403, "DATA_PLANE_AUTHENTICATION_FAILED", "Data Plane service authentication failed.");
  }
}

function authenticateSubstrate(request) {
  const supplied = request.headers.authorization?.startsWith("Bearer ")
    ? Buffer.from(request.headers.authorization.slice(7), "utf8") : Buffer.alloc(0);
  const expected = Buffer.from(substrateServiceToken, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new KernelError(403, "SUBSTRATE_AUTHENTICATION_FAILED", "Runtime substrate authentication failed.");
  }
}

function authenticateBroker(request) {
  const supplied = request.headers.authorization?.startsWith("Bearer ")
    ? Buffer.from(request.headers.authorization.slice(7), "utf8") : Buffer.alloc(0);
  const expected = Buffer.from(brokerServiceToken, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new KernelError(403, "BROKER_AUTHENTICATION_REQUIRED", "Credential broker authentication failed.");
  }
}

async function authenticateAgent(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Agent ")) throw new KernelError(401, "AGENT_AUTHENTICATION_REQUIRED", "Agent Passport credential is required.");
  return identityIntent.authenticateAgent(authorization.slice("Agent ".length));
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

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
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/grant-authority/grants") {
    const service = requireGrantAuthority();
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024),
      "kernel.authority_grant.register");
    return sendCommandResult(response, await service.registerGrant(command, actor));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/grant-authority/readiness-receipts") {
    const service = requireGrantAuthority();
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024),
      "kernel.authority_grant.readiness.record");
    return sendCommandResult(response, await service.recordReadiness(command, actor));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/grant-authority/snapshots") {
    const service = requireGrantAuthority();
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 64 * 1024),
      "kernel.authority_grant.snapshot.publish");
    return sendCommandResult(response, await service.publishSnapshot(command, actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/grant-authority/grants/")) {
    const service = requireGrantAuthority();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { grant_state: await service.getGrantState(
      pathId(url.pathname, "/kernel/v0/grant-authority/grants/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/grant-authority/seal-readiness") {
    const service = requireGrantAuthority();
    authenticateBootstrapOperator(request);
    const body = await readJson(request, 64 * 1024);
    return sendJson(response, 200, await service.assertSealEligible(body.grant_ids));
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/internal/v0/grant-activation-snapshots") {
    const service = requireDiagnosticGrantApplication();
    authenticatePrivateService(request, grantAuthorityFeedToken,
      "GRANT_AUTHORITY_FEED_AUTHENTICATION_FAILED");
    const body = await readJson(request, 256 * 1024);
    const accepted = await service.applySnapshot(body.signed_snapshot_bytes);
    return sendCommandResult(response, accepted);
  }

  if (request.method === "POST" && url.pathname === "/authority/v0/grant-application-receipts") {
    const service = requireGrantAuthority();
    const actor = authenticatePrivateService(request, grantApplicationReceiptServiceToken,
      "GRANT_APPLICATION_RECEIPT_AUTHENTICATION_FAILED");
    const body = await readJson(request, 256 * 1024);
    return sendCommandResult(response, await service.acceptApplicationReceipt(body.signed_receipt_bytes, actor));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/grant-projections\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticGrantApplication();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { grant_projection: await service.getEffectiveState(
      environmentId, pathId(url.pathname, "/diagnostic/v0/grant-projections/")) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/observation-schema-activations") {
    const service = requireDiagnosticObservation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.observation_schema.activate");
    const body = await readJson(request, 64 * 1024);
    return sendCommandResult(response, await service.activateSchema(body, actor.id));
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
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/internal/v0/tokenization-result-receipts") {
    const service = requireDiagnosticTokenizationProof();
    authenticatePrivateService(request, diagnosticTokenizationResultToken,
      "TOKENIZATION_RESULT_SERVICE_AUTHENTICATION_FAILED");
    const body = await readJson(request, 256 * 1024);
    return sendCommandResult(response, await service.preserveResultReceipt(body));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/tokenization-result-receipts\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticTokenizationProof();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { tokenization_result_receipt: await service.getResultReceipt(
      pathId(url.pathname, "/diagnostic/v0/tokenization-result-receipts/")) });
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/intake-prefix") {
    const service = requireDiagnosticObservation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { intake_prefix: await service.getIntakePrefix() });
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/observation-receipts\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticObservation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { observation_receipt: await service.getReceipt(
      pathId(url.pathname, "/diagnostic/v0/observation-receipts/")) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/correlation-registrations") {
    const service = requireDiagnosticCorrelation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.correlation_registration.register");
    const body = await readJson(request, 64 * 1024);
    return sendCommandResult(response, await service.register(body, actor.id));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/correlation-registrations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticCorrelation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { correlation_registration: await service.getRegistration(
      pathId(url.pathname, "/diagnostic/v0/correlation-registrations/")) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/correlation-projections") {
    const service = requireDiagnosticCorrelation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.correlation_projection.create");
    const body = await readJson(request, 64 * 1024);
    return sendCommandResult(response, await service.createProjection(body, actor.id));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/correlation-projections\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticCorrelation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { correlation_projection: await service.getProjection(
      pathId(url.pathname, "/diagnostic/v0/correlation-projections/")) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/interpretation-activations") {
    const service = requireDiagnosticEffectEvaluation();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.interpretation_activation.activate");
    return sendCommandResult(response, await service.activate(await readJson(request, 64 * 1024), actor.id));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/interpretation-activations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { interpretation_activation: await service.getActivation(
      pathId(url.pathname, "/diagnostic/v0/interpretation-activations/")) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/effect-evaluations") {
    const service = requireDiagnosticEffectEvaluation();
    await authenticateDiagnosticOwner(request, "diagnostic.effect_evaluation.process");
    return sendCommandResult(response, await service.process(await readJson(request, 64 * 1024)));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/effect-projections\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_effect_projection: await service.getEffectProjection(
      pathId(url.pathname, "/diagnostic/v0/effect-projections/")) });
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/behavior-evaluations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { behavior_evaluation: await service.getEvaluation(
      pathId(url.pathname, "/diagnostic/v0/behavior-evaluations/")) });
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/diagnostic-triggers\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_trigger: await service.getTrigger(
      pathId(url.pathname, "/diagnostic/v0/diagnostic-triggers/")) });
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/claim-envelopes\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { claim_envelope: await service.getClaim(
      pathId(url.pathname, "/diagnostic/v0/claim-envelopes/")) });
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/deterministic-cases\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEffectEvaluation();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_case: await service.getDeterministicCase(
      pathId(url.pathname, "/diagnostic/v0/deterministic-cases/")) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/evidence-policy-activations") {
    const service = requireDiagnosticEvidencePackaging();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.evidence_policy_activation.activate");
    return sendCommandResult(response, await service.activatePolicy(await readJson(request, 64 * 1024), actor.id));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/evidence-policy-activations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEvidencePackaging();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_policy_activation: await service.getPolicyActivation(
      pathId(url.pathname, "/diagnostic/v0/evidence-policy-activations/")) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/evidence-collections/process") {
    const service = requireDiagnosticEvidencePackaging();
    await authenticateDiagnosticOwner(request, "diagnostic.evidence_collection.process");
    return sendCommandResult(response, await service.processCollection(await readJson(request, 64 * 1024)));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/evidence-collections\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEvidencePackaging();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_collection: await service.getCollection(
      pathId(url.pathname, "/diagnostic/v0/evidence-collections/")) });
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/evidence-packages\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEvidencePackaging();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_package: await service.getPackage(
      pathId(url.pathname, "/diagnostic/v0/evidence-packages/")) });
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/evidence-packages\/[^/]+\/material-availability$/.test(url.pathname)) {
    const service = requireDiagnosticMaterialAvailability();
    authenticateBootstrapOperator(request);
    const evidencePackageId = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(response, 200, { material_availability:
      await service.getPackageAvailability(evidencePackageId) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/material-erasures") {
    const service = requireDiagnosticMaterialAvailability();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.material_erasure.request");
    return sendCommandResult(response,
      await service.requestErasure(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "POST"
      && /^\/diagnostic\/v0\/material-erasures\/[^/]+\/complete$/.test(url.pathname)) {
    const service = requireDiagnosticMaterialAvailability();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.material_erasure.complete");
    const body = await readJson(request, 64 * 1024);
    const decisionId = decodeURIComponent(url.pathname.split("/").at(-2));
    if (body?.input?.erasure_decision_id !== decisionId) {
      throw new KernelError(409, "DIAGNOSTIC_MATERIAL_ERASURE_ROUTE_MISMATCH",
        "Route erasure decision ID must match command input.");
    }
    return sendCommandResult(response, await service.completeErasure(body, actor));
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/material-erasures\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticMaterialAvailability();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { material_erasure: await service.getErasure(
      pathId(url.pathname, "/diagnostic/v0/material-erasures/")) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/evidence-revisions/process") {
    const service = requireDiagnosticEvidencePackaging();
    await authenticateDiagnosticOwner(request, "diagnostic.evidence_revision.process");
    return sendCommandResult(response, await service.processRevision(await readJson(request, 64 * 1024)));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/evidence-revisions\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticEvidencePackaging();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_revision: await service.getRevisionStatus(
      pathId(url.pathname, "/diagnostic/v0/evidence-revisions/")) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/assignment-policy-activations") {
    const service = requireDiagnosticAssignment();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.assignment_policy_activation.activate");
    return sendCommandResult(response, await service.activatePolicy(await readJson(request, 64 * 1024), actor.id));
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/assignment-policy-activations\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { assignment_policy_activation: await service.getPolicyActivation(
      pathId(url.pathname, "/diagnostic/v0/assignment-policy-activations/")) });
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/assignments\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnostic_assignment: await service.getAssignment(
      pathId(url.pathname, "/diagnostic/v0/assignments/")) });
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/evidence-packages\/[^/]+\/assignment$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    const evidencePackageId = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(response, 200, { diagnostic_assignment: await service.getAssignmentForPackage(
      evidencePackageId) });
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/evidence-packages\/[^/]+\/assignment-status$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    const evidencePackageId = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(response, 200, { assignment_processing: await service.getProcessingStatusForPackage(
      evidencePackageId) });
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/assignment-verification-material\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticAssignment();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { assignment_verification_material: await service.getVerificationMaterial(
      pathId(url.pathname, "/diagnostic/v0/assignment-verification-material/")) });
  }

  if (request.method === "GET"
      && /^\/diagnostic\/v0\/independent-verification-bundles\/[^/]+$/.test(url.pathname)) {
    const service = requireIndependentDiagnosticVerification();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { independent_verification_bundle: await service.getBundle(
      pathId(url.pathname, "/diagnostic/v0/independent-verification-bundles/")) });
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
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/operations") {
    requireDiagnosticPlane();
    return sendJson(response, 200, {
      protocol_version: DIAGNOSTIC_PROTOCOL_VERSION,
      operations: listDiagnosticOperationDescriptors()
    });
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/runtime-adapter-contract") {
    requireDiagnosticPlane();
    return sendJson(response, 200, getWorkflowRuntimeAdapterContract());
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/repair-delivery-adapter-contract") {
    requireDiagnosticPlane();
    return sendJson(response, 200, getRepairDeliveryAdapterContract());
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/verification-runner-contract") {
    requireDiagnosticPlane();
    return sendJson(response, 200, getVerificationRunnerContract());
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/operations/")) {
    requireDiagnosticPlane();
    const operationId = pathId(url.pathname, "/diagnostic/v0/operations/");
    const descriptor = getDiagnosticOperationDescriptor(operationId);
    if (!descriptor) throw new KernelError(404, "OPERATION_NOT_FOUND", "Diagnostic operation does not exist.");
    return sendJson(response, 200, descriptor);
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/agent-workflows") {
    const service = requireDiagnosticPlane();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.agent_workflow.register");
    return sendCommandResult(response, await service.registerWorkflow(await readJson(request, 512 * 1024), actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/agent-workflows/")) {
    const service = requireDiagnosticPlane();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      agent_workflow: await service.getWorkflow(pathId(url.pathname, "/diagnostic/v0/agent-workflows/"))
    });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/agent-revisions") {
    const service = requireDiagnosticPlane();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.agent_revision.register");
    return sendCommandResult(response, await service.registerRevision(await readJson(request, 512 * 1024), actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/agent-revisions/")) {
    const service = requireDiagnosticPlane();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      agent_revision: await service.getRevision(pathId(url.pathname, "/diagnostic/v0/agent-revisions/"))
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/artifacts/")) {
    const service = requireDiagnosticPlane();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      artifact: await service.getArtifact(pathId(url.pathname, "/diagnostic/v0/artifacts/"))
    });
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
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/external-activity-traces/")) {
    const service = requireDiagnosticRuntime();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      external_activity_trace: await service.getTrace(
        pathId(url.pathname, "/diagnostic/v0/external-activity-traces/")
      )
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/runtime-event-conflicts/")) {
    const service = requireDiagnosticRuntime();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      runtime_event_conflict: await service.getConflict(
        pathId(url.pathname, "/diagnostic/v0/runtime-event-conflicts/")
      )
    });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/cases") {
    const service = requireDiagnosticReproduction();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.case.report_failure");
    return sendCommandResult(response, await service.reportFailure(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/failure-specifications") {
    const service = requireDiagnosticReproduction();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.failure_specification.confirm");
    return sendCommandResult(response,
      await service.confirmFailureSpecification(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/reproductions") {
    const service = requireDiagnosticReproduction();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.reproduction.create");
    return sendCommandResult(response, await service.createReproduction(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-workers") {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    return sendCommandResult(response, await service.registerWorker(await readJson(request, 64 * 1024), passport));
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/diagnosis-workers") {
    const service = requireDiagnosticDiagnosis();
    const passport = await authenticateAgent(request);
    return sendCommandResult(response, await service.registerWorker(await readJson(request, 64 * 1024), passport));
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/diagnosis-requests") {
    const service = requireDiagnosticDiagnosis();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.diagnosis_request.create");
    return sendCommandResult(response, await service.createRequest(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/diagnosis-requests\/[^/]+\/workspace$/.test(url.pathname)) {
    const service = requireDiagnosticDiagnosis();
    const passport = await authenticateAgent(request);
    return sendJson(response, 200, await service.getWorkspace(
      decodeURIComponent(url.pathname.split("/").at(-2)), passport
    ));
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/diagnosis-requests\/[^/]+\/fail$/.test(url.pathname)) {
    const service = requireDiagnosticDiagnosis();
    const passport = await authenticateAgent(request);
    const body = await readJson(request, 64 * 1024);
    if (body?.input?.request_id !== decodeURIComponent(url.pathname.split("/").at(-2))) {
      throw new KernelError(409, "DIAGNOSIS_REQUEST_ROUTE_MISMATCH", "Route request ID must match command input.");
    }
    return sendCommandResult(response, await service.failRequest(body, passport));
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/diagnosis-proposals") {
    const service = requireDiagnosticDiagnosis();
    const passport = await authenticateAgent(request);
    return sendCommandResult(response, await service.submitProposal(await readJson(request, 512 * 1024), passport));
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/diagnosis-proposals\/[^/]+\/reviews$/.test(url.pathname)) {
    const service = requireDiagnosticDiagnosis();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.diagnosis_proposal.review");
    const body = await readJson(request, 64 * 1024);
    if (body?.input?.proposal_id !== decodeURIComponent(url.pathname.split("/").at(-2))) {
      throw new KernelError(409, "DIAGNOSIS_PROPOSAL_ROUTE_MISMATCH", "Route proposal ID must match command input.");
    }
    return sendCommandResult(response, await service.reviewProposal(body, actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/diagnosis-requests/")) {
    const service = requireDiagnosticDiagnosis();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnosis_request: await service.getRequest(
      pathId(url.pathname, "/diagnostic/v0/diagnosis-requests/")
    ) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/diagnosis-proposals/")) {
    const service = requireDiagnosticDiagnosis();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { diagnosis_proposal: await service.getProposal(
      pathId(url.pathname, "/diagnostic/v0/diagnosis-proposals/")
    ) });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-tasks") {
    const service = requireDiagnosticRepairWorker();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_task.create");
    return sendCommandResult(response, await service.createTask(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "GET" && url.pathname === "/diagnostic/v0/repair-tasks") {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    return sendJson(response, 200, await service.discoverTasks(passport));
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/claim$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.claimTask(body, passport));
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/heartbeat$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.heartbeat(body, passport));
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/fail$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.failTask(body, passport));
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/release$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.releaseTask(body, passport));
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/cancel$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_task.cancel");
    const body = requireRouteTaskMatch(url.pathname, await readJson(request, 64 * 1024));
    return sendCommandResult(response, await service.cancelTask(body, actor));
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-candidates") {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    return sendCommandResult(response,
      await service.submitCandidate(await readJson(request, 7 * 1024 * 1024), passport));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/repair-tasks\/[^/]+\/artifacts\/[^/]+$/.test(url.pathname)) {
    const service = requireDiagnosticRepairWorker();
    const passport = await authenticateAgent(request);
    const parts = url.pathname.split("/");
    return sendJson(response, 200, await service.retrieveArtifact(
      decodeURIComponent(parts.at(-3)), decodeURIComponent(parts.at(-1)), passport
    ));
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-tasks/")) {
    const service = requireDiagnosticRepairWorker();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_task: await service.getTask(pathId(url.pathname, "/diagnostic/v0/repair-tasks/"))
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-candidates/")) {
    const service = requireDiagnosticRepairWorker();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_candidate: await service.getCandidate(pathId(url.pathname, "/diagnostic/v0/repair-candidates/"))
    });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-delivery-bindings") {
    const service = requireDiagnosticRepairDelivery();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_delivery_binding.register");
    return sendCommandResult(response, await service.registerBinding(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "GET" && /^\/diagnostic\/v0\/repair-delivery-bindings\/[^/]+\/target$/.test(url.pathname)) {
    const service = requireDiagnosticRepairDelivery();
    authenticateBootstrapOperator(request);
    const bindingId = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(response, 200, await service.inspectTarget(bindingId));
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-delivery-bindings/")) {
    const service = requireDiagnosticRepairDelivery();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_delivery_binding: await service.getBinding(
        pathId(url.pathname, "/diagnostic/v0/repair-delivery-bindings/")
      )
    });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-deliveries") {
    const service = requireDiagnosticRepairDelivery();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_delivery.materialize");
    return sendCommandResult(response,
      await service.materializeCandidate(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-deliveries/")) {
    const service = requireDiagnosticRepairDelivery();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_delivery: await service.getDelivery(pathId(url.pathname, "/diagnostic/v0/repair-deliveries/"))
    });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/repair-verifications") {
    const service = requireDiagnosticVerification();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.repair_verification.create");
    return sendCommandResult(response,
      await service.createVerification(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/repair-verifications/")) {
    const service = requireDiagnosticVerification();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      repair_verification: await service.getVerification(
        pathId(url.pathname, "/diagnostic/v0/repair-verifications/")
      )
    });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/promotions") {
    const service = requireDiagnosticPromotion();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.promotion.authorize");
    return sendCommandResult(response,
      await service.authorizePromotion(await readJson(request, 64 * 1024), actor));
  }

  if (request.method === "POST" && /^\/diagnostic\/v0\/promotions\/[^/]+\/apply$/.test(url.pathname)) {
    const service = requireDiagnosticPromotion();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.promotion.apply");
    const body = await readJson(request, 64 * 1024);
    const promotionId = decodeURIComponent(url.pathname.split("/").at(-2));
    if (body?.input?.promotion_id !== promotionId) {
      throw new KernelError(409, "PROMOTION_ROUTE_MISMATCH",
        "Route Promotion ID must match command input.");
    }
    return sendCommandResult(response, await service.applyPromotion(body, actor));
  }

  if (request.method === "POST" &&
      /^\/diagnostic\/v0\/promotions\/[^/]+\/(reconcile|rollback)$/.test(url.pathname)) {
    const service = requireDiagnosticPromotion();
    const operationId = url.pathname.endsWith("/reconcile")
      ? "diagnostic.promotion.reconcile" : "diagnostic.promotion.rollback";
    const actor = await authenticateDiagnosticOwner(request, operationId);
    const body = await readJson(request, 64 * 1024);
    const segments = url.pathname.split("/");
    const promotionId = decodeURIComponent(segments.at(-2));
    if (body?.input?.promotion_id !== promotionId) {
      throw new KernelError(409, "PROMOTION_ROUTE_MISMATCH",
        "Route Promotion ID must match command input.");
    }
    return sendCommandResult(response, segments.at(-1) === "reconcile"
      ? await service.reconcilePromotion(body, actor)
      : await service.rollbackPromotion(body, actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/promotions/")) {
    const service = requireDiagnosticPromotion();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      promotion: await service.getPromotion(pathId(url.pathname, "/diagnostic/v0/promotions/"))
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/diagnostic/v0/cases/")) {
    const service = requireDiagnosticReproduction();
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, {
      diagnostic_case: await service.getCase(pathId(url.pathname, "/diagnostic/v0/cases/"))
    });
  }

  if (request.method === "POST" && url.pathname === "/diagnostic/v0/artifact-retirements") {
    const service = requireDiagnosticReproduction();
    const actor = await authenticateDiagnosticOwner(request, "diagnostic.artifact.retire");
    return sendCommandResult(response, await service.retireArtifact(await readJson(request, 64 * 1024), actor));
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
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/operations") {
    return sendJson(response, 200, { protocol_version: PROTOCOL_VERSION, operations: listOperationDescriptors() });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/operations/")) {
    const operationId = decodeURIComponent(url.pathname.slice("/kernel/v0/operations/".length));
    const descriptor = getOperationDescriptor(operationId);
    if (!descriptor) throw new KernelError(404, "OPERATION_NOT_FOUND", "Operation descriptor does not exist.");
    return sendJson(response, 200, descriptor);
  }

  if (request.method === "GET" && url.pathname === "/kernel/v0/environments/current") {
    return sendJson(response, 200, serializeEnvironment(await database.getEnvironment(installationId, environmentId)));
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
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/principals") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.principal.create");
    return sendCommandResult(response, await identityIntent.createPrincipal(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/principals/")) {
    authenticateBootstrapOperator(request);
    const principal = await identityIntent.getPrincipal(pathId(url.pathname, "/kernel/v0/principals/"));
    return sendJson(response, 200, { principal });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/agent-passports") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.agent_passport.issue");
    return sendCommandResult(response, await identityIntent.issuePassport(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/agent-passports/")) {
    authenticateBootstrapOperator(request);
    const passport = await identityIntent.getPassport(pathId(url.pathname, "/kernel/v0/agent-passports/"));
    return sendJson(response, 200, { passport });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/work-intent-proposals") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.work_intent.propose");
    return sendCommandResult(response, await identityIntent.proposeIntent(command, passport));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/work-intent-proposals\/[^/]+\/confirm$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const proposalId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.work_intent.confirm");
    return sendCommandResult(response, await identityIntent.confirmIntent(command, proposalId));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/work-intent-proposals/")) {
    authenticateBootstrapOperator(request);
    const proposal = await identityIntent.getProposal(pathId(url.pathname, "/kernel/v0/work-intent-proposals/"));
    return sendJson(response, 200, { proposal });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/work-intents/")) {
    authenticateBootstrapOperator(request);
    const workIntent = await identityIntent.getWorkIntent(pathId(url.pathname, "/kernel/v0/work-intents/"));
    return sendJson(response, 200, { work_intent: workIntent });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/build-sessions") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.build_session.open");
    return sendCommandResult(response, await identityIntent.openBuildSession(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/build-sessions/")) {
    authenticateBootstrapOperator(request);
    const buildSession = await identityIntent.getBuildSession(pathId(url.pathname, "/kernel/v0/build-sessions/"));
    return sendJson(response, 200, { build_session: buildSession });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/admission/check") {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, await identityIntent.checkAdmission(await readJson(request)));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/context-access-grants") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.context_access_grant.issue");
    return sendCommandResult(response, await contextService.issueGrant(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/context-access-grants/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { context_access_grant: await contextService.getGrant(pathId(url.pathname, "/kernel/v0/context-access-grants/")) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/context-receipts/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { context_receipt: await contextService.getReceipt(pathId(url.pathname, "/kernel/v0/context-receipts/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-validations") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.package_candidate.validate");
    return sendCommandResult(response, await packageService.validateCandidate(command, passport));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/artifact-attestations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.artifact.trust_attest");
    return sendCommandResult(response, await packageService.attestArtifact(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/artifact-attestations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { artifact_attestation: await packageService.getArtifactAttestation(pathId(url.pathname, "/kernel/v0/artifact-attestations/")) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/package-validations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { validation_receipt: await packageService.getValidationReceipt(pathId(url.pathname, "/kernel/v0/package-validations/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-simulations") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.package_candidate.simulate");
    return sendCommandResult(response, await packageService.simulate(command, passport));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/package-simulations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { simulation_receipt: await packageService.getSimulationReceipt(pathId(url.pathname, "/kernel/v0/package-simulations/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-versions") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.package_version.publish");
    return sendCommandResult(response, await packageService.publish(command, passport));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/package-versions/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { package_version: await packageService.getPackageVersion(pathId(url.pathname, "/kernel/v0/package-versions/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/trust-policies") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.trust_policy.create");
    return sendCommandResult(response, await packageTrustService.createPolicy(command, actor));
  }

  if (request.method === "GET" && /^\/kernel\/v0\/trust-policies\/[^/]+\/versions\/[^/]+$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const parts = url.pathname.split("/");
    return sendJson(response, 200, { trust_policy: await packageTrustService.getPolicy(
      decodeURIComponent(parts.at(-3)), decodeURIComponent(parts.at(-1))) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-imports") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 4 * 1024 * 1024), "kernel.package.import");
    return sendCommandResult(response, await packageTrustService.importPackage(command, actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/package-import-receipts/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { import_receipt: await packageTrustService.getImportReceipt(
      pathId(url.pathname, "/kernel/v0/package-import-receipts/")) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/quarantined-packages/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { quarantined_package: await packageTrustService.getQuarantinedPackage(
      pathId(url.pathname, "/kernel/v0/quarantined-packages/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/coordinator-bindings") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.coordinator_binding.create");
    return sendCommandResult(response, await environmentCoordination.createBinding(command, actor));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/coordinator-bindings\/[^/]+\/revoke$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const bindingId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.coordinator_binding.revoke");
    return sendCommandResult(response, await environmentCoordination.revokeBinding(command, bindingId, actor));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/coordinator-registration-sync") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.coordinator.register_outbound");
    return sendCommandResult(response, await environmentCoordination.registerOutbound(command, actor));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/promotion-polls") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.promotion.poll_outbound");
    return sendCommandResult(response, await environmentCoordination.pollPromotions(command, actor));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/promotion-requests") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.promotion.request_outbound");
    return sendCommandResult(response, await environmentCoordination.requestPromotion(command, actor));
  }

  if (request.method === "GET" && /^\/kernel\/v0\/promotion-proposals\/[^/]+\/resolution$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const proposalId = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(response, 200, { promotion_resolution: await environmentCoordination.getResolution(proposalId) });
  }

  if (request.method === "POST" && /^\/kernel\/v0\/promotion-proposals\/[^/]+\/resolve$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const proposalId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.promotion.resolve_local_plan");
    return sendCommandResult(response, await environmentCoordination.resolveProposal(command, proposalId, actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/promotion-proposals/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { promotion_proposal: await environmentCoordination.getProposal(
      pathId(url.pathname, "/kernel/v0/promotion-proposals/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/promotion-receipts") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.promotion_receipt.create");
    return sendCommandResult(response, await environmentCoordination.localReceipt(command, actor));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/promotion-receipts\/[^/]+\/deliver$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const receiptId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.promotion_receipt.deliver_outbound");
    return sendCommandResult(response, await environmentCoordination.pushReceipt(command, receiptId, actor));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/environment-health-publications") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment_health.publish_outbound");
    return sendCommandResult(response, await supportService.publishHealth(command, actor));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/support-polls") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.support.poll_outbound");
    return sendCommandResult(response, await supportService.pollSupportCases(command, actor));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/support-cases\/[^/]+\/approve$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const supportCaseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.support_case.approve");
    return sendCommandResult(response, await supportService.approveSupportCase(command, supportCaseId, actor));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/support-passports\/[^/]+\/deliver$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const passportId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.support_passport.deliver_outbound");
    return sendCommandResult(response, await supportService.pushSupportPassport(command, passportId, actor));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/diagnostic-bundles") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.diagnostic_bundle.create");
    return sendCommandResult(response, await supportService.createDiagnostic(command, actor));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/diagnostic-bundles/")) {
    authenticateBootstrapOperator(request);
    const bundleId = pathId(url.pathname, "/kernel/v0/diagnostic-bundles/");
    return sendJson(response, 200, { diagnostic_bundle: await supportService.getDiagnostic(bundleId) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/support/v0/diagnostic-bundles/")) {
    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith("Support ")) throw new KernelError(403, "SUPPORT_AUTHENTICATION_FAILED", "Support Passport credential required.");
    const bundleId = pathId(url.pathname, "/support/v0/diagnostic-bundles/");
    return sendJson(response, 200, await supportService.readDiagnostic(bundleId, authorization.slice("Support ".length)));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/support-remediation-authorizations") {
    const actor = authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.support_remediation.authorize");
    return sendCommandResult(response, await supportService.authorizeRemediation(command, actor));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/runtime-hosts\/[^/]+\/quarantine$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const hostId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.runtime_host.quarantine");
    return sendCommandResult(response, await supportService.quarantineHost(command, hostId, actor));
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/runtime-hosts/placement-admission") {
    authenticateSubstrate(request);
    return sendJson(response, 200, await supportService.checkHostPlacement(await readJson(request)));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/coordinator-bindings\/[^/]+\/revocation-sync$/.test(url.pathname)) {
    const actor = authenticateBootstrapOperator(request);
    const bindingId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.coordinator_binding.revocation_sync");
    return sendCommandResult(response, await supportService.syncBindingRevocation(command, bindingId, actor));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/deployment-plan-validations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 512 * 1024), "kernel.deployment_plan.validate");
    return sendCommandResult(response, await deploymentService.validatePlan(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/deployment-plan-validations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { validation_receipt: await deploymentService.getValidationReceipt(
      pathId(url.pathname, "/kernel/v0/deployment-plan-validations/")) });
  }

  if (request.method === "POST" && /^\/kernel\/v0\/deployment-plans\/[^/]+\/technical-reviews$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const deploymentPlanId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.deployment_plan.technical_review");
    return sendCommandResult(response, await deploymentService.reviewPlan(command, deploymentPlanId));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/deployment-plans/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { deployment_plan: await deploymentService.getDeploymentPlan(
      pathId(url.pathname, "/kernel/v0/deployment-plans/")) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/deployment-technical-reviews/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { technical_review: await deploymentService.getTechnicalReview(
      pathId(url.pathname, "/kernel/v0/deployment-technical-reviews/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/deployments") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.deployment.stage");
    return sendCommandResult(response, await deploymentService.stageDeployment(command));
  }

  if (request.method === "GET" && /^\/kernel\/v0\/deployments\/[^/]+\/capabilities\/[^/]+\/action-card$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const parts = url.pathname.split("/");
    return sendJson(response, 200, { action_card: await deploymentService.getActionCard(
      decodeURIComponent(parts[4]), decodeURIComponent(parts[6])) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/deployments/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { deployment: await deploymentService.getDeployment(
      pathId(url.pathname, "/kernel/v0/deployments/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/capability-business-approvals") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.capability.business_approve");
    return sendCommandResult(response, await deploymentService.approveCapability(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/capability-business-approvals/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { business_approval: await deploymentService.getBusinessApproval(
      pathId(url.pathname, "/kernel/v0/capability-business-approvals/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/capability-activations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.capability_activation.activate");
    return sendCommandResult(response, await deploymentService.activateCapability(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/capability-activations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { capability_activation: await deploymentService.getCapabilityActivation(
      pathId(url.pathname, "/kernel/v0/capability-activations/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/capability-admission/check") {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, await deploymentService.checkCapabilityAdmission(await readJson(request)));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-compatibility-reports") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.compatibility_analyze");
    return sendCommandResult(response, await upgradeService.createCompatibilityReport(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/upgrade-compatibility-reports/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { compatibility_report: await upgradeService.getCompatibilityReport(
      pathId(url.pathname, "/kernel/v0/upgrade-compatibility-reports/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-activation-policies") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.activation_policy_create");
    return sendCommandResult(response, await upgradeService.createActivationPolicy(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/upgrade-activation-policies/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { upgrade_activation_policy: await upgradeService.getActivationPolicy(
      pathId(url.pathname, "/kernel/v0/upgrade-activation-policies/")) });
  }

  if (request.method === "GET" && /^\/kernel\/v0\/upgrade-plans\/[^/]+\/retirement-status$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const upgradePlanId = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(response, 200, { retirement_status: await upgradeService.retirementStatus(upgradePlanId) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-plans") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.plan_create");
    return sendCommandResult(response, await upgradeService.createUpgradePlan(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/upgrade-plans/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { upgrade_plan: await upgradeService.getUpgradePlan(
      pathId(url.pathname, "/kernel/v0/upgrade-plans/")) });
  }

  if (request.method === "POST" && /^\/kernel\/v0\/upgrade-migrations\/[^/]+\/checkpoints$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const migrationRunId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.migration_checkpoint");
    return sendCommandResult(response, await upgradeService.checkpointMigration(command, migrationRunId));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/upgrade-migrations\/[^/]+\/verify$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const migrationRunId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.migration_verify");
    return sendCommandResult(response, await upgradeService.verifyMigration(command, migrationRunId));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-migrations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.migration_start");
    return sendCommandResult(response, await upgradeService.startMigration(command));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/upgrade-migrations/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { migration_run: await upgradeService.getMigrationRun(
      pathId(url.pathname, "/kernel/v0/upgrade-migrations/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-canary-attempts") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.canary_evaluate");
    return sendCommandResult(response, await upgradeService.evaluateCanary(command));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-activations") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.activate");
    return sendCommandResult(response, await upgradeService.activateUpgrade(command));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/upgrade-recovery-actions") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.upgrade.recovery_record");
    return sendCommandResult(response, await upgradeService.recordRecoveryAction(command));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/package-retirements") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.package_version.retire");
    return sendCommandResult(response, await upgradeService.retirePackage(command));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/handoffs") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.handoff.propose");
    return sendCommandResult(response, await handoffService.propose(command, passport));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/handoffs\/[^/]+\/accept$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const handoffId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.handoff.accept");
    return sendCommandResult(response, await handoffService.accept(command, handoffId, passport));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/handoffs\/[^/]+\/reject$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const handoffId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.handoff.reject");
    return sendCommandResult(response, await handoffService.reject(command, handoffId, passport));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/handoffs/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { handoff: await handoffService.getHandoff(pathId(url.pathname, "/kernel/v0/handoffs/")) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/workload-grants/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { workload_grant: await handoffService.getGrant(pathId(url.pathname, "/kernel/v0/workload-grants/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/environments/current/execution-epoch/advance") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment.execution_epoch.advance");
    return sendCommandResult(response, await handoffService.advanceEpoch(command));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/restores") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.environment.restore.begin");
    return sendCommandResult(response, await restoreService.begin(command));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/restores\/[^/]+\/projection-rebuild$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const restoreId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment.restore.projection_rebuild");
    return sendCommandResult(response, await restoreService.rebuildProjection(command, restoreId));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/restores\/[^/]+\/verify$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const restoreId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment.restore.verify");
    return sendCommandResult(response, await restoreService.verify(command, restoreId));
  }

  if (request.method === "POST" && /^\/kernel\/v0\/restores\/[^/]+\/resume$/.test(url.pathname)) {
    authenticateBootstrapOperator(request);
    const restoreId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request), "kernel.environment.restore.resume");
    return sendCommandResult(response, await restoreService.resume(command, restoreId));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/restores/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { restore: await restoreService.getRestore(pathId(url.pathname, "/kernel/v0/restores/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/data-lifecycle-records") {
    authenticateBootstrapOperator(request);
    const command = validateCommandEnvelope(await readJson(request), "kernel.data_lifecycle.record");
    return sendCommandResult(response, await restoreService.recordLifecycle(command));
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/workloads/admission") {
    authenticateSubstrate(request);
    return sendJson(response, 200, await handoffService.checkWorkloadGate(await readJson(request)));
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/workloads/observations") {
    authenticateSubstrate(request);
    return sendCommandResult(response, await handoffService.recordObservation(await readJson(request)));
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/execution-envelopes") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.execution_envelope.admit");
    return sendCommandResult(response, await executionService.admit(command, passport));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/execution-envelopes/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { execution_envelope: await executionService.getEnvelope(
      pathId(url.pathname, "/kernel/v0/execution-envelopes/")) });
  }

  if (request.method === "POST" && /^\/kernel\/v0\/runs\/[^/]+\/complete-comparison$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const runId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.run.complete_comparison");
    if (command.input.run_id !== runId) throw new KernelError(409, "RUN_ROUTE_MISMATCH", "Route Run ID must match command input.");
    return sendCommandResult(response, await executionService.completeComparison(command, passport));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/runs/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { run: await executionService.getRun(pathId(url.pathname, "/kernel/v0/runs/")) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/evidence-records/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { evidence_record: await executionService.getEvidence(
      pathId(url.pathname, "/kernel/v0/evidence-records/")) });
  }

  if (request.method === "POST" && url.pathname === "/kernel/v0/effects") {
    const passport = await authenticateAgent(request);
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.effect.admit");
    return sendCommandResult(response, await effectService.admitCorrection(command, passport));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/effects/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { effect_record: await effectService.getEffect(
      pathId(url.pathname, "/kernel/v0/effects/")) });
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/dispatch-permits/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { dispatch_permit: await effectService.getPermit(
      pathId(url.pathname, "/kernel/v0/dispatch-permits/")) });
  }

  if (request.method === "POST" && /^\/kernel\/v0\/effects\/[^/]+\/dispatch$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const effectId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.effect.dispatch");
    if (command.input.effect_id !== effectId) {
      throw new KernelError(409, "EFFECT_ROUTE_MISMATCH", "Route Effect ID must match command input.");
    }
    return sendCommandResult(response, await effectService.dispatch(command, passport));
  }

  if (request.method === "POST" && /^\/internal\/v0\/dispatch-permits\/[^/]+\/credential-delivery$/.test(url.pathname)) {
    authenticateBroker(request);
    const permitId = decodeURIComponent(url.pathname.split("/").at(-2));
    const input = await readJson(request);
    const accepted = await effectService.authorizeCredentialDelivery(permitId, input.permit_digest);
    return sendJson(response, accepted.replayed ? 200 : 201, accepted.result);
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/recovery-cases/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { recovery_case: await recoveryService.getRecoveryCase(
      pathId(url.pathname, "/kernel/v0/recovery-cases/")) });
  }

  if (request.method === "POST" && /^\/kernel\/v0\/recovery-cases\/[^/]+\/reconcile$/.test(url.pathname)) {
    const passport = await authenticateAgent(request);
    const recoveryCaseId = decodeURIComponent(url.pathname.split("/").at(-2));
    const command = validateCommandEnvelope(await readJson(request, 256 * 1024), "kernel.recovery_case.reconcile");
    if (command.input.recovery_case_id !== recoveryCaseId) {
      throw new KernelError(409, "RECOVERY_CASE_ROUTE_MISMATCH", "Route Recovery Case ID must match command input.");
    }
    return sendCommandResult(response, await recoveryService.reconcile(command, passport));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/reconciliation-permits/")) {
    authenticateBootstrapOperator(request);
    return sendJson(response, 200, { reconciliation_permit: await recoveryService.getReconciliationPermit(
      pathId(url.pathname, "/kernel/v0/reconciliation-permits/")) });
  }

  if (request.method === "POST"
    && /^\/internal\/v0\/reconciliation-permits\/[^/]+\/credential-delivery$/.test(url.pathname)) {
    authenticateBroker(request);
    const permitId = decodeURIComponent(url.pathname.split("/").at(-2));
    const input = await readJson(request);
    const accepted = await recoveryService.authorizeCredentialDelivery(permitId, input.permit_digest);
    return sendJson(response, accepted.replayed ? 200 : 201, accepted.result);
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/context/authorize") {
    authenticateDataPlane(request);
    const input = await readJson(request);
    return sendJson(response, 200, await contextService.authorize({ ...input, agent_token: request.headers["x-agent-token"] }));
  }

  if (request.method === "POST" && url.pathname === "/internal/v0/context/receipts") {
    authenticateDataPlane(request);
    const receipt = await readJson(request);
    const signature = request.headers["x-receipt-signature"] ?? "";
    const expected = `hmac-sha256:${createHmac("sha256", dataPlaneReceiptSecret).update(canonicalize(receipt)).digest("hex")}`;
    const suppliedBytes = Buffer.from(signature, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw new KernelError(403, "INVALID_RECEIPT_SIGNATURE", "Context Receipt signature is invalid.");
    }
    return sendCommandResult(response, await contextService.recordReceipt(receipt, signature, dataPlaneId));
  }

  if (request.method === "GET" && url.pathname.startsWith("/kernel/v0/commands/")) {
    authenticateBootstrapOperator(request);
    const commandId = decodeURIComponent(url.pathname.slice("/kernel/v0/commands/".length));
    const receipt = await database.getCommandReceipt(installationId, environmentId, commandId);
    if (!receipt) throw new KernelError(404, "COMMAND_NOT_FOUND", "Command receipt does not exist.");
    return sendJson(response, 200, receipt);
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
      restore: restore ? { ...restore, unresolved_obligations: restore.obligations.filter((item) => !item.resolved).length } : null,
      authority: "read_only_projection"
    });
  }

  if (request.method === "GET" && url.pathname === "/butler/api/v0/overview") {
    response.writeHead(307, { location: "/kernel/v0/accountable-work/overview" });
    return response.end();
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
    const threads = items.length === 0 ? "<p>No accountable work.</p>" : items.map((item) =>
      `<article><h2>${escapeHtml(item.identity.agent_name)}</h2><dl><dt>Intent</dt><dd>${escapeHtml(item.intent.objective)}</dd><dt>Intent status</dt><dd>${escapeHtml(item.intent.status)}</dd><dt>Build Session</dt><dd>${escapeHtml(item.build_session.build_session_id)} / ${escapeHtml(item.build_session.status)}</dd><dt>Published package</dt><dd>${escapeHtml(item.package_versions[0] ? `${item.package_versions[0].package_id}@${item.package_versions[0].semantic_version} / ${item.package_versions[0].artifact_digest}` : "not_published")}</dd><dt>Package authority</dt><dd>${escapeHtml(item.package_versions[0]?.authority_granted ? "granted" : "not_granted")}</dd><dt>Context authority</dt><dd>${escapeHtml(item.context[0]?.authority ?? "not_granted")}</dd><dt>Context freshness</dt><dd>${escapeHtml(item.context[0]?.latest_receipt?.freshness_claims?.map((claim) => `${claim.source}:${claim.current_age_seconds}s ${claim.status}`).join(", ") ?? "not_observed")}</dd><dt>Redactions</dt><dd>${escapeHtml(item.context[0]?.latest_receipt?.limitations?.fields_redacted?.join(", ") ?? "none")}</dd><dt>Effect authority</dt><dd>${escapeHtml(item.authority.effects)}</dd><dt>Execution authority</dt><dd>${escapeHtml(item.authority.execution)}</dd></dl></article>`
    ).join("");
    const deploymentRows = deployments.length === 0 ? "<p>No staged deployments.</p>" : deployments.map((deployment) =>
      deployment.action_cards.map((card) => `<article><h2>${escapeHtml(card.affected_objects.capability_export_id)}</h2><dl><dt>Package</dt><dd>${escapeHtml(card.states.package)} / ${escapeHtml(card.affected_objects.package_artifact_digest)}</dd><dt>Deployment</dt><dd>${escapeHtml(card.states.deployment)} / ${escapeHtml(card.affected_objects.deployment_id)}</dd><dt>Technical review</dt><dd>${escapeHtml(card.states.technical_review)}</dd><dt>Business approval</dt><dd>${escapeHtml(card.states.business_approval)}</dd><dt>Capability activation</dt><dd>${escapeHtml(card.states.capability_activation)}</dd><dt>Source reads</dt><dd>${escapeHtml(card.source_reads.sources.join(", "))}</dd><dt>Write target</dt><dd>${escapeHtml(card.write_target.map((effect) => `${effect.system}/${effect.target}:${effect.action}`).join(", "))}</dd><dt>Credential scope</dt><dd>${escapeHtml(card.credential_scope ? `${card.credential_scope.binding_ref}@${card.credential_scope.revision} / ${card.credential_scope.scopes.join(", ")}` : "not_required")}</dd><dt>Limits</dt><dd>${escapeHtml(JSON.stringify(card.limits))}</dd><dt>Evidence</dt><dd>${escapeHtml(card.evidence.required.join(", "))}</dd><dt>Recovery</dt><dd>${escapeHtml(`${card.recovery.strategy}; ${card.recovery.uncertainty}`)}</dd><dt>Current revision</dt><dd>${escapeHtml(card.current_revision)}</dd><dt>Permitted action</dt><dd>${escapeHtml(card.operation_id)}</dd></dl></article>`).join("")
    ).join("");
    const handoffRows = handoffs.length === 0 ? "<p>No runtime handoffs.</p>" : handoffs.map((handoff) =>
      `<article><h2>${escapeHtml(handoff.state)}</h2><dl><dt>Work Intent</dt><dd>${escapeHtml(handoff.work_intent_id)}</dd><dt>Source</dt><dd>${escapeHtml(handoff.source_passport_id)}</dd><dt>Target</dt><dd>${escapeHtml(handoff.target_passport_id)}</dd><dt>Ledger cursor</dt><dd>${escapeHtml(handoff.ledger_cursor)}</dd><dt>Workload</dt><dd>${escapeHtml(handoff.workload_digest)}</dd><dt>Ambient memory</dt><dd>not received</dd></dl></article>`).join("");
    const runRows = runs.length === 0 ? "<p>No admitted Runs.</p>" : runs.map((run) =>
      `<article><h2>${escapeHtml(run.run_id)}</h2><dl><dt>Execution</dt><dd>${escapeHtml(run.execution.status)}</dd><dt>Accountability</dt><dd>${escapeHtml(run.accountability.status)}</dd><dt>Envelope</dt><dd>${escapeHtml(run.envelope_id)}</dd><dt>Capability</dt><dd>${escapeHtml(run.bindings.capability_activation_id)}</dd><dt>Skill</dt><dd>${escapeHtml(`${run.bindings.skill.export_id}@${run.bindings.skill.contract_version}`)}</dd><dt>Context Receipts</dt><dd>${escapeHtml(run.bindings.context_receipt_ids.join(", "))}</dd><dt>Obligations</dt><dd>${escapeHtml(run.accountability.obligations.map((item) => `${item.requirement}:${item.status}`).join(", "))}</dd><dt>Evidence</dt><dd>${escapeHtml(run.evidence?.evidence_record_id ?? "not_recorded")}</dd><dt>Source links</dt><dd>${escapeHtml(run.evidence?.source_links.map((link) => `${link.context_receipt_id}/${link.source}/${link.subject}/${link.item_hash}`).join(", ") ?? "none")}</dd></dl></article>`).join("");
    const effectRows = effects.length === 0 ? "<p>No external Effects.</p>" : effects.map((effect) =>
      `<article><h2>${escapeHtml(effect.effect_id)}</h2><dl><dt>Exact action</dt><dd>${escapeHtml(`${effect.action} ${effect.target.resource}/${effect.target.subject} -> ${JSON.stringify(effect.requested_value)}`)}</dd><dt>Execution</dt><dd>${escapeHtml(effect.execution_status)}</dd><dt>Accountability</dt><dd>${escapeHtml(effect.accountability_status)}</dd><dt>Capability</dt><dd>${escapeHtml(effect.authority.capability_activation_id)}</dd><dt>Workload</dt><dd>${escapeHtml(effect.authority.workload_grant_id)}</dd><dt>Credential</dt><dd>${escapeHtml(`${effect.authority.credential_binding.binding_ref}@${effect.authority.credential_binding.revision} / ${effect.authority.credential_binding.scopes.join(", ")}`)}</dd><dt>Context</dt><dd>${escapeHtml(effect.authority.context_receipt_ids.join(", "))}</dd><dt>Permit</dt><dd>${escapeHtml(`${effect.permit.permit_id} / ${effect.permit.status}`)}</dd><dt>Evidence</dt><dd>${escapeHtml(effect.evidence?.evidence_record_id ?? "not_recorded")}</dd><dt>Source links</dt><dd>${escapeHtml(effect.evidence?.source_links.map((link) => `${link.context_receipt_id}/${link.source}/${link.subject}/${link.item_hash}`).join(", ") ?? "none")}</dd><dt>Outcome</dt><dd>${escapeHtml(effect.evidence?.outcome ?? "pending")}</dd><dt>Recovery</dt><dd>${escapeHtml(`${effect.recovery.strategy}; ${effect.recovery.uncertainty}`)}</dd></dl></article>`).join("");
    const recoveryRows = recoveryCases.length === 0 ? "<p>No Recovery Cases.</p>" : recoveryCases.map((item) =>
      `<article><h2>${escapeHtml(item.recovery_case_id)}</h2><dl><dt>Status</dt><dd>${escapeHtml(item.status)}</dd><dt>Reconciliation</dt><dd>${escapeHtml(item.reconciliation_status)}</dd><dt>Original Effect</dt><dd>${escapeHtml(item.effect_id)}</dd><dt>Known facts</dt><dd>${escapeHtml(item.known_facts.map((fact) => fact.fact).join(", "))}</dd><dt>Missing evidence</dt><dd>${escapeHtml(item.missing_evidence.join(", "))}</dd><dt>Deadline</dt><dd>${escapeHtml(item.deadline_at)}</dd><dt>Responsible actor</dt><dd>${escapeHtml(`${item.responsible_actor.type}:${item.responsible_actor.principal_id}`)}</dd><dt>Allowed options</dt><dd>${escapeHtml(item.allowed_options.map((option) => option.option).join(", "))}</dd><dt>History</dt><dd>was_uncertain</dd></dl></article>`).join("");
    return sendHtml(response, 200, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Butler</title>
<style>*{box-sizing:border-box}body{font:16px ui-monospace,SFMono-Regular,Consolas,monospace;width:min(808px,100%);margin:10vh auto;padding:24px;color:#151515;background:#f7f7f3}header{border-bottom:2px solid #151515;padding-bottom:16px}dl{display:grid;grid-template-columns:180px minmax(0,1fr);gap:10px}dt{font-weight:700}dd{overflow-wrap:anywhere}.ok{color:#087830}@media(max-width:540px){body{margin:4vh auto}dl{grid-template-columns:1fr;gap:4px}dd{margin:0 0 12px}}</style></head>
<body><header><strong>BUTLER</strong> / accountable operations</header><main><h1>${escapeHtml(environmentName)}</h1><p>Kernel health: <span class="ok">healthy</span></p><p>Environment authority: ${escapeHtml((await database.getEnvironment(installationId, environmentId)).operational_state)}</p><p>Restore: ${escapeHtml(restore ? `${restore.status}; ${restore.obligations.filter((item) => !item.resolved).length} unresolved obligation(s)` : "none")}</p><p>${items.length} accountable item(s)</p>${threads}<h1>Deployment authority</h1>${deploymentRows}<h1>Runtime handoffs</h1>${handoffRows}<h1>Runs and accountability</h1>${runRows}<h1>Effects</h1>${effectRows}<h1>Recovery Cases</h1>${recoveryRows}<p>Butler derives permitted actions from Kernel state. Execution and accountability remain independently visible.</p></main></body></html>`);
  }

  throw new KernelError(404, "ROUTE_NOT_FOUND", "Route does not exist.");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    if (error instanceof KernelError) {
      return sendJson(response, error.status, {
        error: { code: error.code, message: error.message, details: error.details }
      });
    }
    if (error instanceof CoordinationContractError) {
      return sendJson(response, error.code === "INVALID_COORDINATION_SIGNATURE" ? 403 : 400,
        { error: { code: error.code, message: error.message, details: {} } });
    }
    console.error(error);
    sendJson(response, 500, { error: { code: "INTERNAL_ERROR", message: "Unexpected Kernel failure." } });
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Alphonse Kernel ${PROTOCOL_VERSION} listening on ${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(async () => {
    if (diagnosticDatabase) await diagnosticDatabase.close();
    await database.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
