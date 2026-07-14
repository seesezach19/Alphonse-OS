import { KernelError } from "./errors.js";

export function validateProfileUpdateCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KernelError(400, "INVALID_COMMAND", "Command body must be an object.");
  }

  if (typeof value.command_id !== "string" || value.command_id.length < 1 || value.command_id.length > 160) {
    throw new KernelError(400, "INVALID_COMMAND_ID", "command_id must contain 1 to 160 characters.");
  }
  if (value.operation_id !== "kernel.environment.profile.update") {
    throw new KernelError(400, "UNSUPPORTED_OPERATION", "Only kernel.environment.profile.update is available in ticket 01.");
  }
  if (!value.input || typeof value.input.display_name !== "string") {
    throw new KernelError(400, "INVALID_INPUT", "input.display_name is required.");
  }

  const displayName = value.input.display_name.trim();
  if (displayName.length < 1 || displayName.length > 120) {
    throw new KernelError(400, "INVALID_INPUT", "input.display_name must contain 1 to 120 characters.");
  }
  if (!Number.isSafeInteger(value.input.expected_revision) || value.input.expected_revision < 0) {
    throw new KernelError(400, "INVALID_INPUT", "input.expected_revision must be a non-negative safe integer.");
  }

  return {
    command_id: value.command_id,
    operation_id: value.operation_id,
    input: { display_name: displayName, expected_revision: value.input.expected_revision }
  };
}
