# 15 - Restore Without Duplicating External Work

**What to build:** A local Environment restores PostgreSQL and artifacts from backup, fences every pre-restore worker, rebuilds projections, and reconciles possibly post-backup Effects before authority resumes.

**Blocked by:** 11 - Pass The Unfamiliar-Builder Production Proof.

**Status:** ready-for-agent

- [ ] Encrypted/local backup captures authoritative PostgreSQL state and content-addressed artifacts.
- [ ] Restore starts Environment suspended with a new execution epoch.
- [ ] Workload carrying old epoch cannot obtain Dispatch Permit.
- [ ] Effects possibly occurring after restore point enter explicit reconciliation.
- [ ] Butler shows unresolved restore obligations before reactivation.
- [ ] Transition integrity and artifact digests verify after restore.
- [ ] Projections rebuild to externally equivalent views with visible cursor/health.
- [ ] Typed tombstone, expiration, identity pseudonymization, and full Environment destruction remain distinguishable.
- [ ] Restore drill completes without duplicate external correction.
