import { appendFile, readFile } from "node:fs/promises";
import { statfsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const mode = process.argv[2] ?? "status";
const envPath = path.join(root, ".env.release");
const project = process.env.ALPHONSE_COMPOSE_PROJECT ?? "alphonse-v0-2";
await readFile(envPath, "utf8");

function compose(args) {
  const result = spawnSync("docker", ["compose", "--project-name", project, "--env-file", envPath,
    "-f", path.join(root, "compose.yaml"), ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function confirmation(expected) {
  if (process.env.ALPHONSE_BREAK_GLASS_CONFIRM !== expected
      || !process.env.ALPHONSE_BREAK_GLASS_REASON?.trim()) {
    throw new Error(`Set ALPHONSE_BREAK_GLASS_CONFIRM=${expected} and ALPHONSE_BREAK_GLASS_REASON.`);
  }
  return process.env.ALPHONSE_BREAK_GLASS_REASON.trim();
}

async function record(event, reason) {
  const entry = { schema_version: "alphonse.host-operations-event.v0.1", event,
    reason, occurred_at: new Date().toISOString(), compose_project: project };
  await appendFile(path.join(root, "operations.log"), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

if (mode === "break-glass") {
  const reason = confirmation("FENCE_NEW_WORK");
  compose(["stop", "edge", "console", "n8n", "n8n-runtime-adapter"]);
  console.log(JSON.stringify({ state: "break_glass_fenced", external_runtime_stopped: true,
    browser_access_stopped: true, kernel_host_port: false, event: await record("break_glass_fenced", reason),
    next: "inspect authoritative records through an explicit docker compose exec session; reconcile before recovery" }));
} else if (mode === "recover") {
  const reason = confirmation("RECOVER_AFTER_REVIEW");
  try {
    compose(["up", "-d", "--wait"]);
  } catch (error) {
    const logs = compose(["logs", "--no-color", "n8n"]);
    throw new Error(`${error.message}\nn8n recovery logs:\n${logs}`);
  }
  console.log(JSON.stringify({ state: "services_recovered", event: await record("break_glass_recovered", reason),
    authority_note: "Service recovery does not resolve or retry an uncertain Kernel operation." }));
} else if (mode === "status") {
  const raw = compose(["ps", "--all", "--format", "json"]);
  let services;
  try { services = JSON.parse(raw); } catch {
    services = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  if (!Array.isArray(services)) services = [services];
  const fileSystem = statfsSync(root);
  const freeBytes = Number(fileSystem.bavail) * Number(fileSystem.bsize);
  const warningBytes = Number(process.env.ALPHONSE_DISK_WARN_BYTES ?? 10 * 1024 * 1024 * 1024);
  const unhealthy = services.filter((service) => service.State !== "running" && service.State !== "exited"
    || service.Health && service.Health !== "healthy");
  const status = { state: unhealthy.length ? "attention_required" : "healthy",
    services: services.map((service) => ({ service: service.Service, state: service.State,
      health: service.Health || "not_configured" })),
    disk: { free_bytes: freeBytes, warning_below_bytes: warningBytes,
      state: freeBytes < warningBytes ? "warning" : "healthy" },
    alerts: [...unhealthy.map((service) => `service:${service.Service}:${service.State}:${service.Health}`),
      ...(freeBytes < warningBytes ? ["disk:free_space_below_threshold"] : [])] };
  console.log(JSON.stringify(status));
  if (status.alerts.length) process.exitCode = 2;
} else {
  throw new Error("Usage: node scripts/release-operations.js status|break-glass|recover");
}
