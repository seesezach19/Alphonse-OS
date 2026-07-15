# 09 - Reconcile Uncertain Promotion Without Blind Retry

**What to build:** When the n8n promotion response is lost after request, Alphonse records uncertainty, blocks blind redispatch, reconciles target reality, and preserves distinct applied, not-applied, and rollback outcomes.

**Blocked by:** 08 - Promote Only Through Owner Authority.

**Status:** complete

- [x] An injected timeout after the adapter may have applied a candidate leaves Promotion in an explicit uncertain state.
- [x] The uncertain state preserves Owner authorization, expected base, candidate, rollback reference, request receipt, and missing confirmation.
- [x] Reusing the apply command while uncertain cannot dispatch a second target change.
- [x] Reconciliation uses a separately permitted read-only adapter operation to inspect exact target revision.
- [x] If target matches the candidate, reconciliation confirms Promotion and resolves the case while preserving that uncertainty occurred.
- [x] If target remains on the prior revision, reconciliation records failed/not-applied Promotion and leaves the verified case unresolved.
- [x] If target matches neither expected nor candidate revision, reconciliation records target mismatch and requires explicit human review.
- [x] Reconciliation retries are idempotent and conflicting claims cannot overwrite accepted reality.
- [x] Rollback is a separate explicit Owner-authorized operation with its own target precondition and receipt.
- [x] Rollback never erases the original promotion request, uncertainty, confirmation, or later target history.
- [x] Public inspection distinguishes requested, authorized, applying, uncertain, confirmed, failed, and rolled-back Promotion truth.
- [x] Black-box checks cover uncertain-applied, uncertain-not-applied, mismatch, duplicate, and rollback paths.

Verification: `npm test` passes 152/152. `npm run test:v0.2-ticket-09` passes the chained local Docker proof for uncertain-applied, uncertain-not-applied, target mismatch, blocked blind redispatch, idempotent reconciliation, Owner-authorized rollback, preserved history, and no AWS activity. `npm run test:v0.2-ticket-08` remains green.
