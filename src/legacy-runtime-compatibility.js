import { deterministicUuid, sha256Digest } from "./canonical-json.js";
import { KernelError } from "./errors.js";
import { createSignedObservation } from "./observation-contracts.js";

export function createLegacyRuntimeCompatibility(config, receiveObservation) {
  const required = ["principalId", "grantId", "keyId", "secret", "installationId", "environmentId",
    "streamId", "schema", "adapterBinding"];
  if (required.some((field) => !config?.[field]) || typeof receiveObservation !== "function") {
    throw new Error("Complete legacy runtime compatibility configuration is required.");
  }
  const translator = {
    translator_id: "alphonse.legacy_runtime.canonical",
    translator_version: "0.1.0",
    translator_artifact_digest: sha256Digest({ module: "legacy-runtime-compatibility", version: "0.1.0" }),
    translator_rules_digest: sha256Digest({ source: "signed-legacy-envelope-only", missing_fields: "limitations" })
  };

  function translate(verified) {
    const source = verified.envelope;
    const claims = {
      external_execution_id: source.external_execution_id,
      event_id: source.event_id,
      event_sequence: String(source.event_sequence),
      lifecycle: source.lifecycle_claim,
      logical_operation_id: source.correlation_id,
      revision_id: source.revision_id,
      payload_reference_present: source.payload.reference !== null,
      legacy_envelope_digest: verified.envelope_digest,
      legacy_authentication_key_id: verified.authentication.key_id,
      legacy_authentication_signed_at: verified.authentication.signed_at,
      legacy_authentication_signature_digest: sha256Digest(verified.authentication.signature),
      ...translator
    };
    if (source.payload.digest) claims.payload_digest = source.payload.digest;
    const envelope = {
      schema_version: "0.1.0",
      observation_id: deterministicUuid({ namespace: "legacy-runtime-observation", event_id: source.event_id }),
      observation_type: "runtime.execution",
      schema: config.schema,
      principal_id: config.principalId,
      grant_id: config.grantId,
      key_id: config.keyId,
      installation_id: config.installationId,
      environment_id: config.environmentId,
      adapter_binding: config.adapterBinding,
      stream_id: config.streamId,
      sequence: String(BigInt(source.event_sequence) + 1n),
      workflow_id: source.workflow_id,
      integration_id: null,
      occurred_at: source.occurred_at,
      observed_at: verified.authentication.signed_at,
      claims,
      limitations: [
        "legacy_protocol_translation",
        "observer_capture_time_unavailable_signed_at_used",
        "provider_workflow_version_unavailable",
        "normalized_workflow_digest_unavailable",
        "attestation_basis_not_expanded"
      ],
      redaction: {
        policy_id: "redaction:legacy-runtime-claims-only",
        policy_digest: sha256Digest({ policy: "legacy-runtime-claims-only", version: "0.1.0" })
      },
      detail: null,
      provenance_dependencies: []
    };
    const signed = createSignedObservation(envelope, { keyId: config.keyId, secret: config.secret });
    return { envelope, signed, translator };
  }

  async function receive(verified) {
    const translated = translate(verified);
    const accepted = await receiveObservation({
      envelope_bytes: translated.signed.bytes,
      authentication: translated.signed.authentication,
      detail_base64: null
    });
    const receipt = accepted?.result?.observation_receipt;
    if (!receipt?.receipt_id) {
      throw new KernelError(502, "LEGACY_RUNTIME_CANONICAL_RECEIPT_MISSING",
        "Canonical runtime compatibility intake did not return a receipt.");
    }
    return { ...translated, canonical_receipt: receipt, replayed: accepted.replayed === true };
  }

  return { receive, translate, translator };
}
