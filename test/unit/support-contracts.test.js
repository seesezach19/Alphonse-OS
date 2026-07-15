import assert from "node:assert/strict";
import test from "node:test";

import { assertCoordinatorBindingRevocation, assertEnvironmentHealth, assertSupportCaseRequest,
  assertSupportPassportNotice } from "../../src/coordination-contracts.js";

const id = (suffix) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const window = { issued_at: "2030-01-01T00:00:00.000Z", expires_at: "2030-01-01T00:05:00.000Z" };

test("coarse health contains only bounded status and counters", () => {
  const health = assertEnvironmentHealth({ schema_version: "alphonse.environment_health.v0.1",
    coordinator_id: "coordinator:local", customer_id: "customer:one", environment_id: id("1"), binding_id: id("2"),
    status: "degraded", counters: { outbox_lag: 1, unresolved_obligations: 2, quarantined_hosts: 0,
      restore_suspended: false }, ...window });
  assert.equal(health.status, "degraded");
  assert.throws(() => assertEnvironmentHealth({ ...health, business_payload: { inventory: 12 } }));
});

test("support request and notice bind identity, scope, duration, environment, and read-only authority", () => {
  const request = assertSupportCaseRequest({ schema_version: "alphonse.support_case_request.v0.1",
    support_case_id: id("3"), coordinator_id: "coordinator:local", customer_id: "customer:one",
    environment_id: id("1"), support_identity: { provider: "alphonse", subject: "support-7", display_name: "Support" },
    diagnostic_scopes: ["kernel_health", "host_health"], requested_duration_seconds: 900,
    reason: "Investigate stale heartbeat.", ...window });
  const notice = assertSupportPassportNotice({ schema_version: "alphonse.support_passport_notice.v0.1",
    support_passport_id: id("4"), support_case_id: request.support_case_id, customer_id: request.customer_id,
    environment_id: request.environment_id, support_identity: request.support_identity,
    diagnostic_scopes: request.diagnostic_scopes, access_class: "diagnostics_read_only", ...window });
  assert.equal(notice.access_class, "diagnostics_read_only");
  assert.throws(() => assertSupportPassportNotice({ ...notice, access_class: "administrator" }));
});

test("binding revocation is exact signed coordination state", () => {
  const revocation = assertCoordinatorBindingRevocation({ schema_version: "alphonse.coordinator_binding_revocation.v0.1",
    revocation_id: id("5"), coordinator_id: "coordinator:local", customer_id: "customer:one",
    environment_id: id("1"), binding_id: id("2"), reason: "Customer disconnected support.", ...window });
  assert.equal(revocation.binding_id, id("2"));
});
