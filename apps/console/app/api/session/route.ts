import { NextResponse } from "next/server";
import { authenticateConsoleLogin, createConsoleSession, deleteConsoleSession, readConsoleSession } from "../../../lib/session";
import type { ConsoleRole } from "../../../lib/live-types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await readConsoleSession();
  return NextResponse.json(session ? { authenticated: true, ...session } : { authenticated: false },
    { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { role?: ConsoleRole; credential?: string } | null;
  if (!body || !["viewer", "operator", "owner"].includes(body.role ?? "") ||
      typeof body.credential !== "string" || !authenticateConsoleLogin(body.role!, body.credential)) {
    return NextResponse.json({ error: { code: "INVALID_CONSOLE_LOGIN", message: "Role or credential is invalid." } },
      { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const session = await createConsoleSession(body.role!);
  return NextResponse.json({ authenticated: true, ...session }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  await deleteConsoleSession();
  return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
}
