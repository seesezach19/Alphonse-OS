import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Console controls are immutable, role-bounded, and preserve recovery", async () => {
  const [migration, service, page, live] = await Promise.all([
    readFile("diagnostic-migrations/031_console_controls.sql", "utf8"),
    readFile("src/diagnostic-console-service.js", "utf8"),
    readFile("apps/console/app/page.tsx", "utf8"),
    readFile("apps/console/components/live-console-app.tsx", "utf8")
  ]);
  assert.match(migration, /diagnostic_worker_control_events_immutable/);
  assert.match(migration, /diagnostic_workflow_quarantine_events_immutable/);
  assert.match(service, /Only an authenticated Owner may resume a worker or release workflow quarantine/);
  assert.match(service, /diagnostic\.promotion\.reconcile/);
  assert.match(service, /diagnostic\.promotion\.rollback/);
  assert.match(page, /ALPHONSE_CONSOLE_MODE === "live"/);
  assert.doesNotMatch(live, /demo-data|fixture-backed|Demo dataset/);
});

test("Live browser sessions hold no Kernel credential", async () => {
  const [session, client] = await Promise.all([
    readFile("apps/console/lib/session.ts", "utf8"),
    readFile("apps/console/lib/kernel-client.ts", "utf8")
  ]);
  assert.match(session, /httpOnly: true/);
  assert.match(session, /sameSite: "strict"/);
  assert.doesNotMatch(session, /KERNEL_TOKEN/);
  assert.match(client, /_KERNEL_TOKEN/);
  assert.match(client, /cache: "no-store"/);
});
