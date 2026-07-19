import { NextResponse } from "next/server";
import type { ConnectionProbe, ConsoleConnectionStatus } from "../../../lib/connection-status";

export const dynamic = "force-dynamic";

async function probe(baseUrl: string | undefined, path: string, name: string): Promise<ConnectionProbe> {
  if (!baseUrl) {
    return { state: "not_configured", label: "Not configured", detail: `${name} has no console endpoint configured` };
  }

  try {
    const response = await fetch(new URL(path, `${baseUrl.replace(/\/$/, "")}/`), {
      cache: "no-store",
      signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) {
      return { state: "unavailable", label: "Unavailable", detail: `${name} returned HTTP ${response.status}` };
    }
    return { state: "reachable", label: "Reachable", detail: `${name} answered its read-only probe` };
  } catch {
    return { state: "unavailable", label: "Unavailable", detail: `${name} did not answer within the local timeout` };
  }
}

export async function GET() {
  const kernelUrl = process.env.ALPHONSE_CONSOLE_KERNEL_URL ?? "http://127.0.0.1:3000";
  const n8nUrl = process.env.ALPHONSE_CONSOLE_N8N_URL;
  const [kernel, diagnostic, n8n] = await Promise.all([
    probe(kernelUrl, "/healthz", "Kernel"),
    probe(kernelUrl, "/diagnostic/v0/bootstrap", "Diagnostic Plane"),
    probe(n8nUrl, "/healthz", "n8n"),
  ]);

  const status: ConsoleConnectionStatus = {
    schema_version: "alphonse.console.connection-status.v0.1",
    checked_at: new Date().toISOString(),
    data_mode: "fixture",
    kernel,
    diagnostic,
    n8n,
  };

  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
