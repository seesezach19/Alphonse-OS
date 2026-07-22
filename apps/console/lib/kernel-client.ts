import { createHash, randomUUID } from "node:crypto";
import type { ConsoleControlRequest, ConsoleRole, ConsoleSnapshot } from "./live-types";

type KernelResult = { status: number; body: unknown };

function kernelUrl(path: string): URL {
  const base = process.env.ALPHONSE_CONSOLE_KERNEL_URL;
  if (!base) throw new Error("Live Console Kernel endpoint is not configured.");
  return new URL(path, `${base.replace(/\/$/, "")}/`);
}

function roleCredential(role: ConsoleRole): string {
  const value = process.env[`ALPHONSE_CONSOLE_${role.toUpperCase()}_KERNEL_TOKEN`];
  if (!value) throw new Error(`Live Console ${role} Kernel credential is not configured.`);
  return value;
}

function authHeaders(role: ConsoleRole, instruction: unknown): Record<string, string> {
  const credential = roleCredential(role);
  if (role === "viewer") return { Authorization: `Viewer ${credential}` };
  if (role === "owner") return { Authorization: `Owner ${credential}` };
  return {
    Authorization: `Operator ${credential}`,
    "x-alphonse-authorization-channel": "console",
    "x-alphonse-instruction-digest": `sha256:${createHash("sha256").update(JSON.stringify(instruction)).digest("hex")}`,
    "x-alphonse-authorized-at": new Date().toISOString()
  };
}

async function requestKernel(role: ConsoleRole, path: string, init: RequestInit = {}): Promise<KernelResult> {
  const instruction = init.body ? JSON.parse(String(init.body)) : { operation_id: "diagnostic.console_snapshot.get" };
  const response = await fetch(kernelUrl(path), {
    ...init, cache: "no-store", signal: AbortSignal.timeout(5000),
    headers: { Accept: "application/json", ...authHeaders(role, instruction), ...init.headers }
  });
  const body = await response.json().catch(() => ({ error: { code: "INVALID_KERNEL_RESPONSE",
    message: "Kernel response was not JSON." } }));
  return { status: response.status, body };
}

export async function getConsoleSnapshot(role: ConsoleRole): Promise<KernelResult & { snapshot?: ConsoleSnapshot }> {
  const result = await requestKernel(role, "/diagnostic/v0/console-snapshot");
  const body = result.body as { console_snapshot?: ConsoleSnapshot };
  return { ...result, snapshot: body.console_snapshot };
}

export async function invokeConsoleControl(role: ConsoleRole, input: ConsoleControlRequest): Promise<KernelResult> {
  const operation = input.action === "suspend" ? "diagnostic.console_worker.suspend"
    : input.action === "resume" ? "diagnostic.console_worker.resume"
      : input.action === "quarantine" ? "diagnostic.console_workflow.quarantine"
        : "diagnostic.console_workflow.release";
  const targetField = input.resource === "worker" ? "agent_principal_id" : "workflow_id";
  const command = {
    command_id: `console:${randomUUID()}`,
    operation_id: operation,
    input: { [targetField]: input.target_id, reason_code: input.reason_code, rationale: input.rationale }
  };
  const resource = input.resource === "worker" ? "workers" : "workflows";
  return requestKernel(role,
    `/diagnostic/v0/console-controls/${resource}/${encodeURIComponent(input.target_id)}/${input.action}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
}
