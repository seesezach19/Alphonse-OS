import { createHmac, createPublicKey, timingSafeEqual } from "node:crypto";
import http from "node:http";

import { canonicalize, sha256Digest } from "./canonical-json.js";
import { createContentAddressedArtifactStore } from "./content-addressed-artifact-store.js";
import {
  createCoverageInventoryClient,
  createCoverageOnboardingService
} from "./coverage-onboarding-service.js";
import { createWorkflowInterpretationService } from "./workflow-interpretation-service.js";
import { createCoverageReviewService } from "./coverage-review-service.js";
import { createCoverageReviewApprovalService } from "./coverage-review-approval-service.js";
import { createCoverageCompilationService } from "./coverage-compilation-service.js";
import { createCoverageCapabilityService } from "./coverage-capability-service.js";
import {
  createCoverageExecutionHistoryClient,
  createCoverageReconciliationService
} from "./coverage-reconciliation-service.js";
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
import { createDiagnosticConsoleService } from "./diagnostic-console-service.js";
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
import { createDiagnosticDispatchAuthorizationService } from "./diagnostic-dispatch-authorization-service.js";
import { createDiagnosticDispatchService } from "./diagnostic-dispatch-service.js";
import { createDiagnosticWorkerExecutionService } from "./diagnostic-worker-execution-service.js";
import { createDiagnosticConsistencyService } from "./diagnostic-consistency-service.js";
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
import {
  getWorkflowRuntimeAdapterContract,
  WORKFLOW_RUNTIME_ADAPTER_CONTRACT_VERSION
} from "./workflow-runtime-adapter-contract.js";
import { getRepairDeliveryAdapterContract } from "./repair-delivery-adapter-contract.js";
import { getVerificationRunnerContract } from "./diagnostic-verification-contracts.js";
import { createVerificationRunnerClient } from "./verification-runner-client.js";
import { createMaintenanceAssuranceService } from "./maintenance-assurance-service.js";

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
const diagnosticConsoleViewerToken = process.env.DIAGNOSTIC_CONSOLE_VIEWER_TOKEN;
const diagnosticConsoleViewerPrincipalId = process.env.DIAGNOSTIC_CONSOLE_VIEWER_PRINCIPAL_ID
  ?? "console-viewer";
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
const diagnosticDispatchSigningKeyId = process.env.KERNEL_DIAGNOSTIC_DISPATCH_SIGNING_KEY_ID
  ?? "local-diagnostic-dispatch-key-v1";
const diagnosticDispatchSigningSecret = process.env.KERNEL_DIAGNOSTIC_DISPATCH_SIGNING_SECRET;
const diagnosticDispatcherAudience = process.env.DIAGNOSTIC_DISPATCHER_AUDIENCE
  ?? "diagnostic-dispatcher:v0.1";
const diagnosticRunnerAudiences = JSON.parse(process.env.DIAGNOSTIC_RUNNER_AUDIENCES
  ?? JSON.stringify(["diagnostic-runner:v0.1"]));
const diagnosticBrokerGrantSigningKeyId = process.env.DIAGNOSTIC_MODEL_BROKER_GRANT_KEY_ID
  ?? "local-diagnostic-broker-grant-key-v1";
const diagnosticBrokerGrantSigningSecret =
  process.env.DIAGNOSTIC_MODEL_BROKER_GRANT_SIGNING_SECRET;
const diagnosticBrokerReceiptKeyId = process.env.DIAGNOSTIC_MODEL_BROKER_RECEIPT_KEY_ID
  ?? "local-diagnostic-broker-receipt-key-v1";
const diagnosticBrokerReceiptSecret = process.env.DIAGNOSTIC_MODEL_BROKER_RECEIPT_SECRET;
const diagnosticRunnerAttestationKeyId = process.env.DIAGNOSTIC_RUNNER_ATTESTATION_KEY_ID
  ?? "local-diagnostic-runner-attestation-key-v1";
const diagnosticRunnerAttestationSecret = process.env.DIAGNOSTIC_RUNNER_ATTESTATION_SECRET;

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
let diagnosticDispatchService = null;
let diagnosticDispatchAuthorizationService = null;
let diagnosticWorkerExecutionService = null;
let diagnosticConsistencyService = null;
let coverageOnboardingService = null;
let workflowInterpretationService = null;
let coverageReviewService = null;
let coverageReviewApprovalService = null;
let coverageCompilationService = null;
let coverageCapabilityService = null;
let coverageReconciliationService = null;
let maintenanceAssuranceService = null;
let diagnosticConsoleService = null;
if (diagnosticDatabaseUrl) {
  if (!diagnosticRuntimeAdapterId || !diagnosticRuntimeAdapterVersion || !diagnosticRuntimeAdapterKeyId
      || !diagnosticRuntimeAdapterSecret) {
    throw new Error("Diagnostic Runtime Adapter binding is required when the Diagnostic Plane is configured.");
  }
  if (!diagnosticDispatchSigningSecret) {
    throw new Error("Diagnostic dispatch signing configuration is required with the Diagnostic Plane.");
  }
  if (!diagnosticBrokerGrantSigningSecret || !diagnosticBrokerReceiptSecret
      || !diagnosticRunnerAttestationSecret) {
    throw new Error("Diagnostic Worker execution signing configuration is required with the Diagnostic Plane.");
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
  maintenanceAssuranceService = createMaintenanceAssuranceService({
    database: diagnosticDatabase, installationId
  });
  diagnosticConsoleService = createDiagnosticConsoleService({
    database: diagnosticDatabase, installationId,
    reproductionReader: diagnosticReproductionService
  });
  coverageOnboardingService = createCoverageOnboardingService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    identityIntent,
    inventoryClient: diagnosticRuntimeDetailUrl && diagnosticRuntimeDetailToken
      ? createCoverageInventoryClient({
        baseUrl: diagnosticRuntimeDetailUrl,
        token: diagnosticRuntimeDetailToken
      })
      : null,
    installationId,
    environmentId,
    runtimeAdapter: {
      adapter_id: diagnosticRuntimeAdapterId,
      adapter_version: diagnosticRuntimeAdapterVersion,
      contract_version: WORKFLOW_RUNTIME_ADAPTER_CONTRACT_VERSION
    }
  });
  workflowInterpretationService = createWorkflowInterpretationService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    identityIntent,
    coverageOnboardingService,
    installationId,
    environmentId
  });
  coverageReviewService = createCoverageReviewService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    coverageOnboardingService,
    installationId,
    environmentId
  });
  coverageReviewApprovalService = createCoverageReviewApprovalService({
    database,
    identityIntent,
    coverageReviewService,
    installationId,
    environmentId
  });
  coverageCompilationService = createCoverageCompilationService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    coverageOnboardingService,
    coverageReviewService,
    coverageReviewApprovalService,
    installationId,
    environmentId
  });
  coverageCapabilityService = createCoverageCapabilityService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    coverageOnboardingService,
    coverageReviewService,
    coverageCompilationService,
    installationId,
    environmentId
  });
  coverageReconciliationService = createCoverageReconciliationService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    coverageOnboardingService,
    historyClient: diagnosticRuntimeDetailUrl && diagnosticRuntimeDetailToken
      ? createCoverageExecutionHistoryClient({
        baseUrl: diagnosticRuntimeDetailUrl,
        token: diagnosticRuntimeDetailToken
      })
      : null,
    installationId,
    environmentId
  });
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
    diagnosticDatabase, diagnosticArtifactStore, installationId, identityIntent,
    diagnosticConsoleService
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
      credentialBindingRef: n8nRepairDeliveryCredentialBindingRef,
      maintenanceControl: diagnosticConsoleService
    });
    diagnosticPromotionService = createDiagnosticPromotionService({
      database: diagnosticDatabase,
      artifactStore: diagnosticArtifactStore,
      installationId,
      adapter: repairDeliveryAdapter,
      adapterManifest: N8N_REPAIR_DELIVERY_ADAPTER_MANIFEST,
      credentialBindingRef: n8nRepairDeliveryCredentialBindingRef,
      maintenanceControl: diagnosticConsoleService
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
  diagnosticDispatchService = createDiagnosticDispatchService({
    database: diagnosticDatabase,
    installationId,
    environmentId,
    materialAuthority: diagnosticMaterialAvailabilityService,
    signingKeyId: diagnosticDispatchSigningKeyId,
    signingSecret: diagnosticDispatchSigningSecret,
    dispatcherAudience: diagnosticDispatcherAudience,
    allowedRunnerAudiences: diagnosticRunnerAudiences
  });
  diagnosticConsistencyService = createDiagnosticConsistencyService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    materialAuthority: diagnosticMaterialAvailabilityService,
    installationId,
    environmentId
  });
  diagnosticWorkerExecutionService = createDiagnosticWorkerExecutionService({
    database: diagnosticDatabase,
    artifactStore: diagnosticArtifactStore,
    materialAuthority: diagnosticMaterialAvailabilityService,
    installationId,
    environmentId,
    brokerGrantSigning: {
      keyId: diagnosticBrokerGrantSigningKeyId,
      secret: diagnosticBrokerGrantSigningSecret
    },
    brokerReceiptSigning: {
      keyId: diagnosticBrokerReceiptKeyId,
      secret: diagnosticBrokerReceiptSecret
    },
    runnerSigning: {
      keyId: diagnosticRunnerAttestationKeyId,
      secret: diagnosticRunnerAttestationSecret
    },
    consistencyEvaluator: diagnosticConsistencyService
  });
  diagnosticDispatchAuthorizationService = createDiagnosticDispatchAuthorizationService({
    database,
    identityIntent,
    eligibilityReader: diagnosticDispatchService,
    installationId,
    environmentId,
    signingKeyId: diagnosticDispatchSigningKeyId,
    signingSecret: diagnosticDispatchSigningSecret,
    dispatcherAudience: diagnosticDispatcherAudience,
    allowedRunnerAudiences: diagnosticRunnerAudiences
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

import {
  createRouteHelpers, writeError
} from "./http-helpers.js";
import { createKernelRouter } from "./kernel-router.js";
import { createDiagnosticRouter } from "./diagnostic-router.js";
import { createSupportRouter } from "./support-router.js";
import { createRouteContext } from "./route-context.js";

const routeHelpers = createRouteHelpers({
  ownerToken, bootstrapPrincipalId, identityIntent,
  diagnosticConsoleViewerToken, diagnosticConsoleViewerPrincipalId,
  dataPlaneServiceToken, substrateServiceToken, brokerServiceToken,
  diagnosticService, diagnosticDatabase, diagnosticRuntimeService,
  diagnosticReproductionService, grantAuthorityService,
  diagnosticGrantApplicationService, diagnosticObservationService,
  diagnosticTokenizationProofService, diagnosticCorrelationService,
  diagnosticEffectEvaluationService, diagnosticEvidencePackageService,
  diagnosticMaterialAvailabilityService, diagnosticAssignmentService,
  diagnosticDispatchService, diagnosticWorkerExecutionService,
  diagnosticConsistencyService, diagnosticDispatchAuthorizationService,
  diagnosticIndependentVerificationService, diagnosticRepairWorkerService,
  diagnosticDiagnosisService, diagnosticRepairDeliveryService,
  diagnosticVerificationService, diagnosticPromotionService,
  coverageOnboardingService, workflowInterpretationService, coverageReviewService,
  coverageReviewApprovalService, coverageCompilationService, coverageCapabilityService,
  coverageReconciliationService, maintenanceAssuranceService, diagnosticConsoleService
});

const routeContext = createRouteContext({
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
  coverageOnboardingService, workflowInterpretationService, coverageReviewService,
  coverageReviewApprovalService, coverageCompilationService, coverageCapabilityService,
  coverageReconciliationService,
  maintenanceAssuranceService, diagnosticConsoleService,
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
  ...routeHelpers
});

const kernelRouter = createKernelRouter(routeContext);
const diagnosticRouter = createDiagnosticRouter(routeContext);
const supportRouter = createSupportRouter(routeContext);

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  if (await kernelRouter(request, response, url)) return;
  if (await diagnosticRouter(request, response, url)) return;
  if (await supportRouter(request, response, url)) return;
  throw new KernelError(404, "ROUTE_NOT_FOUND", "Route does not exist.");
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => writeError(response, error, CoordinationContractError));
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
