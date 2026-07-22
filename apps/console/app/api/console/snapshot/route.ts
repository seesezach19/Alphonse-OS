import { NextResponse } from "next/server";
import { getConsoleSnapshot } from "../../../../lib/kernel-client";
import { readConsoleSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readConsoleSession();
  if (!session) return NextResponse.json({ error: { code: "CONSOLE_SESSION_REQUIRED",
    message: "Sign in to read live records." } }, { status: 401 });
  try {
    const result = await getConsoleSnapshot(session.role);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: { code: "KERNEL_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Kernel request failed." } }, { status: 503 });
  }
}
