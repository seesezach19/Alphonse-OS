# 08 - Promote Only Through Owner Authority

**What to build:** The customer Owner explicitly authorizes one verified candidate, the n8n Repair Delivery Adapter applies it once, confirms the exact resulting target revision, preserves rollback reference, and only then resolves the Diagnostic Case.

**Blocked by:** 07 - Independently Verify the Exact Repair.

**Status:** ready-for-agent

- [ ] Promotion is a separate lifecycle from Diagnostic Case, Repair Task, Repair Candidate, and Verification.
- [ ] Authorization binds authenticated Owner, exact candidate, passing Verification Receipt, expected target revision, target, adapter, and unique idempotency key.
- [ ] Repair Worker, Diagnostic Worker, Verification Runner, Runtime Adapter, and unauthenticated callers are denied promotion authority.
- [ ] A failed, unverified, withdrawn, superseded, or stale-base candidate cannot be authorized.
- [ ] Target drift between candidate base and authorization or application rejects promotion without overwriting newer work.
- [ ] The adapter captures exact current target snapshot and rollback reference before requesting the change.
- [ ] Authorization, application request, and target confirmation are distinct durable facts.
- [ ] One successful application confirms the exact candidate revision from n8n through supported APIs.
- [ ] Identical retries return original receipts; conflicting idempotency reuse is rejected.
- [ ] Verification success alone leaves the case verified; only confirmed target revision changes case projection to resolved.
- [ ] Final inspection shows Owner, candidate, verification, previous revision, resulting revision, rollback reference, receipts, and preserved history.
- [ ] No real email or production inventory effect is introduced by promotion.
