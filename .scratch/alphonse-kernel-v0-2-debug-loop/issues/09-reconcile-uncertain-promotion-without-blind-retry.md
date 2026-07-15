# 09 - Reconcile Uncertain Promotion Without Blind Retry

**What to build:** When the n8n promotion response is lost after request, Alphonse records uncertainty, blocks blind redispatch, reconciles target reality, and preserves distinct applied, not-applied, and rollback outcomes.

**Blocked by:** 08 - Promote Only Through Owner Authority.

**Status:** ready-for-agent

- [ ] An injected timeout after the adapter may have applied a candidate leaves Promotion in an explicit uncertain state.
- [ ] The uncertain state preserves Owner authorization, expected base, candidate, rollback reference, request receipt, and missing confirmation.
- [ ] Reusing the apply command while uncertain cannot dispatch a second target change.
- [ ] Reconciliation uses a separately permitted read-only adapter operation to inspect exact target revision.
- [ ] If target matches the candidate, reconciliation confirms Promotion and resolves the case while preserving that uncertainty occurred.
- [ ] If target remains on the prior revision, reconciliation records failed/not-applied Promotion and leaves the verified case unresolved.
- [ ] If target matches neither expected nor candidate revision, reconciliation records target mismatch and requires explicit human review.
- [ ] Reconciliation retries are idempotent and conflicting claims cannot overwrite accepted reality.
- [ ] Rollback is a separate explicit Owner-authorized operation with its own target precondition and receipt.
- [ ] Rollback never erases the original promotion request, uncertainty, confirmation, or later target history.
- [ ] Public inspection distinguishes requested, authorized, applying, uncertain, confirmed, failed, and rolled-back Promotion truth.
- [ ] Black-box checks cover uncertain-applied, uncertain-not-applied, mismatch, duplicate, and rollback paths.
