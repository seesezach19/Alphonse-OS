import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { sha256Digest } from "../../src/canonical-json.js";
import {
  assertEnvironmentDescriptor,
  assertPromotionProposal,
  assertPromotionReceipt,
  publicCoordinationKey,
  signCoordinationDocument,
  verifyCoordinationEnvelope
} from "../../src/coordination-contracts.js";
import { validatePromotionGraph } from "../../src/hosted-coordinator-service.js";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return { privateKey: pair.privateKey, publicKey: publicCoordinationKey(pair.publicKey) };
}

function descriptor(key) {
  return {
    schema_version: "alphonse.environment_descriptor.v0.1",
    coordinator_id: "coordinator:local",
    installation_id: "00000000-0000-4000-8000-00000000a001",
    environment_id: "00000000-0000-4000-8000-000000000001",
    display_label: "Customer Development",
    environment_class: "development",
    kernel_build: "0.1.0",
    protocol_version: "0.1.0",
    storage_schema_version: "013_environment_promotion.sql",
    signing_key_id: sha256Digest(key.publicKey),
    signing_public_key: key.publicKey,
    execution_epoch: "1",
    package_identities: [],
    deployment_digests: [],
    adapter_contract_versions: ["reference-adapter@0.1"],
    health: { status: "healthy", outbox_lag: 0, unresolved_obligations: 0 },
    issued_at: "2030-01-01T10:00:00.000Z",
    expires_at: "2030-01-01T10:05:00.000Z"
  };
}

function proposal() {
  return {
    schema_version: "alphonse.promotion_proposal.v0.1",
    proposal_id: "proposal-1",
    customer_id: "customer:demo",
    source_environment_id: "00000000-0000-4000-8000-000000000001",
    target_environment_id: "00000000-0000-4000-8000-000000000002",
    source_class: "development",
    target_class: "staging",
    package_identity: `com.alphonse.inventory@1.0.0#${sha256Digest("manifest")}+${sha256Digest("artifact")}`,
    manifest_digest: sha256Digest("manifest"),
    package_artifact_digest: sha256Digest("artifact"),
    dependency_lock: [],
    source_receipt_digests: [sha256Digest("publication")],
    compatibility: { kernel_protocol: ">=0.1 <0.2", storage_schema: ">=12 <14",
      adapter_contracts: ["reference-adapter@0.1"], result: "compatible" },
    change_summary: "Promote exact inventory correction Package.",
    required_configuration_schema: { required: ["storefront_system"], properties: {
      storefront_system: { type: "string" }
    } },
    gate_receipts: [{ type: "package_validation", receipt_id: "receipt-validation",
      receipt_digest: sha256Digest("validation"), issuer_environment_id: "00000000-0000-4000-8000-000000000001" }],
    issued_at: "2030-01-01T10:00:00.000Z",
    expires_at: "2030-01-01T11:00:00.000Z"
  };
}

test("minimal Environment Descriptor signs and verifies without operational payload", () => {
  const key = keys();
  const document = assertEnvironmentDescriptor(descriptor(key));
  const envelope = signCoordinationDocument(document, key.privateKey);
  assert.deepEqual(verifyCoordinationEnvelope(envelope, key.publicKey, assertEnvironmentDescriptor), document);
  assert.doesNotMatch(JSON.stringify(document), /prompt|credential|evidence_body|actor_activity|business_payload/i);
});

test("Environment Descriptor rejects additional sensitive or behavioral fields", () => {
  const key = keys();
  assert.throws(() => assertEnvironmentDescriptor({ ...descriptor(key), prompt: "hidden process" }), /field/i);
  const withSecret = descriptor(key);
  withSecret.health = { ...withSecret.health, access_token: "secret" };
  assert.throws(() => assertEnvironmentDescriptor(withSecret), /field|secret|prohibited/i);
});

test("Promotion Proposal carries exact identity and evidence but no mutable state or authority", () => {
  const coordinator = keys();
  const document = assertPromotionProposal(proposal());
  const envelope = signCoordinationDocument(document, coordinator.privateKey);
  assert.deepEqual(verifyCoordinationEnvelope(envelope, coordinator.publicKey, assertPromotionProposal), document);
  assert.throws(() => assertPromotionProposal({ ...document, active_capability: true }), /field/i);
  assert.throws(() => assertPromotionProposal({ ...document, credential_value: "secret" }), /field|secret/i);
});

test("target promotion receipts bind exact proposal and local reference digest", () => {
  const target = keys();
  const document = assertPromotionReceipt({
    schema_version: "alphonse.promotion_receipt.v0.1",
    receipt_id: "receipt-target-1",
    proposal_id: "proposal-1",
    environment_id: "00000000-0000-4000-8000-000000000002",
    environment_class: "staging",
    receipt_type: "deployed",
    package_identity: proposal().package_identity,
    subject_digest: sha256Digest("deployment"),
    local_reference_digest: sha256Digest({ deployment_id: "local-only" }),
    outcome: "succeeded",
    issued_at: "2030-01-01T10:30:00.000Z"
  });
  const envelope = signCoordinationDocument(document, target.privateKey);
  assert.deepEqual(verifyCoordinationEnvelope(envelope, target.publicKey, assertPromotionReceipt), document);
  const tampered = structuredClone(envelope);
  tampered.document.receipt_type = "activated";
  assert.throws(() => verifyCoordinationEnvelope(tampered, target.publicKey, assertPromotionReceipt), /signature/i);
});

test("customer Promotion Graph may strengthen but cannot bypass the required sequence", () => {
  assert.deepEqual(validatePromotionGraph({
    "development:staging": ["package_validation", "compatibility", "technical_review"],
    "staging:production": ["staging_deployed", "staging_activated", "staging_recovery"]
  }), {
    "development:staging": ["package_validation", "compatibility", "technical_review"],
    "staging:production": ["staging_deployed", "staging_activated", "staging_recovery"]
  });
  assert.throws(() => validatePromotionGraph({
    "development:production": [],
    "development:staging": ["package_validation", "compatibility"],
    "staging:production": ["staging_deployed", "staging_activated", "staging_recovery"]
  }), /edge/i);
  assert.throws(() => validatePromotionGraph({
    "development:staging": ["package_validation"],
    "staging:production": ["staging_deployed", "staging_activated", "staging_recovery"]
  }), /required gate/i);
});
