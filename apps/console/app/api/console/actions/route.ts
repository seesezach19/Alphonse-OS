import { NextResponse } from "next/server";
import { invokeConsoleControl } from "../../../../lib/kernel-client";
import { readConsoleSession } from "../../../../lib/session";
import type { ConsoleControlRequest } from "../../../../lib/live-types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await readConsoleSession();
  if (!session) return NextResponse.json({ error: { code: "CONSOLE_SESSION_REQUIRED",
    message: "Sign in to invoke an admitted control." } }, { status: 401 });
  const input = await request.json().catch(() => null) as ConsoleControlRequest | null;
  if (!input || !["worker", "workflow"].includes(input.resource) ||
      !["suspend", "resume", "quarantine", "release"].includes(input.action) ||
      typeof input.target_id !== "string" || typeof input.rationale !== "string") {
    return NextResponse.json({ error: { code: "INVALID_CONSOLE_ACTION", message: "Control input is invalid." } },
      { status: 400 });
  }
  try {
    const result = await invokeConsoleControl(session.role, input);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: { code: "KERNEL_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Kernel request failed." } }, { status: 503 });
  }
}
