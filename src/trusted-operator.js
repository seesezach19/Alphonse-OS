import { KernelError } from "./errors.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CHANNELS = new Set(["console", "openclaw_chat", "api"]);

function required(value, field, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new KernelError(400, "INVALID_OPERATOR_AUTHORIZATION", `${field} is required.`);
  }
  return value.trim();
}

export function trustedOperatorOperations(passport) {
  if (!passport?.permitted_intent_classes?.includes("trusted_operator")) return [];
  const configuration = passport.package_skill_configuration;
  if (configuration?.protocol !== "alphonse-trusted-operator-0.2.0" ||
      !Array.isArray(configuration.operator_operations)) return [];
  return [...new Set(configuration.operator_operations.filter((item) => typeof item === "string"))];
}

export function authorizeTrustedOperator(passport, operationId, headers) {
  if (!trustedOperatorOperations(passport).includes(operationId)) {
    throw new KernelError(403, "OPERATOR_OPERATION_NOT_GRANTED",
      "Trusted Operator Passport does not grant this operation.", { operation_id: operationId });
  }
  const channel = required(headers["x-alphonse-authorization-channel"],
    "x-alphonse-authorization-channel", 40);
  if (!CHANNELS.has(channel)) {
    throw new KernelError(400, "INVALID_OPERATOR_AUTHORIZATION",
      "Authorization channel must be console, openclaw_chat, or api.");
  }
  const instructionDigest = required(headers["x-alphonse-instruction-digest"],
    "x-alphonse-instruction-digest", 80);
  if (!DIGEST.test(instructionDigest)) {
    throw new KernelError(400, "INVALID_OPERATOR_AUTHORIZATION",
      "Instruction digest must be a SHA-256 digest.");
  }
  const suppliedAt = required(headers["x-alphonse-authorized-at"], "x-alphonse-authorized-at", 80);
  const timestamp = Date.parse(suppliedAt);
  if (!Number.isFinite(timestamp)) {
    throw new KernelError(400, "INVALID_OPERATOR_AUTHORIZATION",
      "Authorization time must be an ISO timestamp.");
  }
  const sponsor = { type: "human", id: passport.sponsor_principal_id };
  const executor = { type: "agent", id: passport.agent_principal_id };
  return {
    actor: {
      ...executor,
      authorization: {
        mode: "trusted_operator",
        operator_passport_id: passport.passport_id,
        requested_by: sponsor,
        authorized_by: sponsor,
        executed_by: executor,
        channel,
        instruction_digest: instructionDigest,
        authorized_at: new Date(timestamp).toISOString(),
        operation_id: operationId
      }
    },
    passport
  };
}

export function directOwnerActor(actor) {
  return {
    ...actor,
    authorization: {
      mode: "direct_owner",
      requested_by: actor,
      authorized_by: actor,
      executed_by: actor,
      channel: "owner_api",
      instruction_digest: null,
      authorized_at: null
    }
  };
}

export function isAuthorizedOwner(actor) {
  return actor?.type === "human" || actor?.authorization?.mode === "trusted_operator";
}
