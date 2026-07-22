import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { ConsoleRole } from "./live-types";

const COOKIE_NAME = "alphonse_console_session";
const SESSION_SECONDS = 8 * 60 * 60;

type Session = { role: ConsoleRole; expires_at: string };

function secret(): string {
  const value = process.env.ALPHONSE_CONSOLE_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("Live Console session signing is not configured.");
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function equal(left: string, right: string): boolean {
  const supplied = Buffer.from(left, "utf8");
  const expected = Buffer.from(right, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function authenticateConsoleLogin(role: ConsoleRole, credential: string): boolean {
  const configured = process.env[`ALPHONSE_CONSOLE_${role.toUpperCase()}_LOGIN_SECRET`];
  return Boolean(configured && credential && equal(credential, configured));
}

export async function createConsoleSession(role: ConsoleRole): Promise<Session> {
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000);
  const session: Session = { role, expires_at: expires.toISOString() };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  (await cookies()).set(COOKIE_NAME, `${payload}.${signature(payload)}`, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    path: "/", expires
  });
  return session;
}

export async function deleteConsoleSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export async function readConsoleSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [payload, suppliedSignature, ...extra] = raw.split(".");
  if (!payload || !suppliedSignature || extra.length || !equal(suppliedSignature, signature(payload))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Session>;
    if (!["viewer", "operator", "owner"].includes(value.role ?? "") ||
        typeof value.expires_at !== "string" || Date.parse(value.expires_at) <= Date.now()) return null;
    return value as Session;
  } catch {
    return null;
  }
}

export async function requireConsoleSession(): Promise<Session> {
  const value = await readConsoleSession();
  if (!value) throw new Error("CONSOLE_SESSION_REQUIRED");
  return value;
}
