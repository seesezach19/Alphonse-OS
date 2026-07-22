import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const baseUrl = process.env.CONSOLE_PROOF_URL ?? "http://127.0.0.1:43220";
const workflowId = process.env.CONSOLE_PROOF_WORKFLOW_ID;
const workerId = process.env.CONSOLE_PROOF_WORKER_ID;
assert.ok(workflowId, "Console proof workflow ID is required");
assert.ok(workerId, "Console proof worker ID is required");
const credentials = {
  viewer: process.env.ALPHONSE_CONSOLE_VIEWER_LOGIN_SECRET,
  operator: process.env.ALPHONSE_CONSOLE_OPERATOR_LOGIN_SECRET,
  owner: process.env.ALPHONSE_CONSOLE_OWNER_LOGIN_SECRET
};
for (const [role, credential] of Object.entries(credentials)) {
  assert.ok(credential, `${role} Console proof credential is required`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const page = await context.newPage();
const scans = [];

async function accessibility(label) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter((entry) => ["serious", "critical"].includes(entry.impact));
  assert.deepEqual(blocking.map((entry) => ({ id: entry.id, impact: entry.impact,
    nodes: entry.nodes.map((node) => ({ target: node.target, html: node.html,
      failure_summary: node.failureSummary })) })), [],
    `${label} has serious or critical accessibility violations`);
  scans.push({ label, violations: result.violations.map((entry) => ({ id: entry.id, impact: entry.impact,
    nodes: entry.nodes.length })), serious_or_critical: blocking.length });
}

async function signIn(role) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Role").selectOption(role);
  await page.getByLabel("Console credential").fill(credentials[role]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("LIVE · AUTHORITATIVE RECORDS").waitFor();
  await page.getByText("Kernel-backed · no fixture records").waitFor();
  await page.locator(".live-state-good", { hasText: "fresh" }).waitFor();
  assert.equal((await page.locator("body").innerText()).includes("Demo dataset"), false);
}

async function signOut() {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Authoritative live records" }).waitFor();
}

async function invokeControl(viewName, targetId, action, rationale) {
  await page.getByRole("button", { name: viewName }).click();
  const article = page.locator("article.live-panel", { hasText: targetId });
  const form = article.locator("form.live-control");
  await form.getByLabel("Rationale").fill(rationale);
  await form.getByRole("button", { name: action, exact: true }).click();
  const admittedState = action === "quarantine" ? "quarantined" : action === "suspend" ? "suspended"
    : action === "release" ? "available" : "active";
  await article.locator(".live-state", { hasText: admittedState }).waitFor();
}

try {
  await signIn("viewer");
  await accessibility("viewer-overview");
  for (const view of ["Workflows", "Diagnostic cases", "Workers", "Evidence", "System"]) {
    await page.getByRole("button", { name: view }).click();
    await page.locator(".live-content").waitFor();
  }
  assert.ok((await page.locator("body").innerText()).includes("Viewer sessions have no control operations."));
  await page.keyboard.press("Shift+Tab");
  assert.ok(await page.evaluate(() => document.activeElement instanceof HTMLElement));
  await signOut();

  await signIn("operator");
  await invokeControl("Workflows", workflowId, "quarantine", "Browser proof: operator workflow quarantine.");
  await invokeControl("Workers", workerId, "suspend", "Browser proof: operator worker suspension.");
  await accessibility("operator-emergency-controls");
  await signOut();

  await signIn("owner");
  await invokeControl("Workflows", workflowId, "release", "Browser proof: Owner workflow recovery.");
  await invokeControl("Workers", workerId, "resume", "Browser proof: Owner worker recovery.");
  await page.getByRole("button", { name: "Diagnostic cases" }).click();
  await accessibility("owner-case-evidence");
  await page.getByRole("button", { name: "Evidence" }).click();
  await accessibility("owner-evidence-table");
  await signOut();

  process.stdout.write(`${JSON.stringify({ status: "passed", data_mode: "live",
    roles: ["viewer", "operator", "owner"], controls: ["quarantine", "suspend", "release", "resume"],
    accessibility_scans: scans, fixture_records_visible: false }, null, 2)}\n`);
} finally {
  await context.close();
  await browser.close();
}
