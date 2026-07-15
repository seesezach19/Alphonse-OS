# 08 - Promote Only Through Owner Authority

**What to build:** The customer Owner explicitly authorizes one verified candidate, the n8n Repair Delivery Adapter applies it once, confirms the exact resulting target revision, preserves rollback reference, and only then resolves the Diagnostic Case.

**Blocked by:** 07 - Independently Verify the Exact Repair.

**Status:** completed

- [x] Promotion is a separate lifecycle from Diagnostic Case, Repair Task, Repair Candidate, and Verification.
- [x] Authorization binds authenticated Owner, exact candidate, passing Verification Receipt, expected target revision, target, adapter, and unique idempotency key.
- [x] Repair Worker, Diagnostic Worker, Verification Runner, Runtime Adapter, and unauthenticated callers are denied promotion authority.
- [x] A failed, unverified, withdrawn, superseded, or stale-base candidate cannot be authorized.
- [x] Target drift between candidate base and authorization or application rejects promotion without overwriting newer work.
- [x] The adapter captures exact current target snapshot and rollback reference before requesting the change.
- [x] Authorization, application request, and target confirmation are distinct durable facts.
- [x] One successful application confirms the exact candidate revision from n8n through supported APIs.
- [x] Identical retries return original receipts; conflicting idempotency reuse is rejected.
- [x] Verification success alone leaves the case verified; only confirmed target revision changes case projection to resolved.
- [x] Final inspection shows Owner, candidate, verification, previous revision, resulting revision, rollback reference, receipts, and preserved history.
- [x] No real email or production inventory effect is introduced by promotion.

Verification: `npm test` passes 148/148. `npm run test:v0.2-ticket-08` passes the chained Tickets 05-08 local Docker proof with one target update, exact read-back confirmation, preserved rollback snapshot, no provider credentials in Alphonse, no external business execution, and no AWS activity.
