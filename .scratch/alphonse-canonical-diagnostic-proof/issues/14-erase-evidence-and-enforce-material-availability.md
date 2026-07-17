# 14 - Erase evidence visibly and enforce material availability

**What to build:** Allow governed erasure to remove sensitive evidence bytes without rewriting history, then make
availability changes constrain assignments, dispatch, and active work through explicit safety state.

**Blocked by:** 12 - Create the model-free unclaimed diagnostic assignment.

**Status:** ready-for-agent

- [ ] Keep package-selected artifacts retention-pinned through active case, diagnosis, review, audit, and legal-hold
      policy while allowing explicitly authorized erasure to override pins.
- [ ] Delete bytes through mark, locked recheck, delete, and tombstone semantics that cannot race package freeze or
      ordinary garbage collection.
- [ ] Preserve immutable tombstones binding artifact digest, governing policy, reason, authority decision, timing,
      verification status, affected packages, and replica or provider limitations.
- [ ] Project package material availability as `complete`, `partially_unavailable`, or `material_unavailable` without
      rewriting the package manifest or historical diagnosis.
- [ ] Recheck exact material availability before dispatch and prevent unavailable packages from receiving new
      execution authority.
- [ ] Expire affected unclaimed assignments and preserve explicit replacement or cancellation provenance.
- [ ] Define cancellation, workspace destruction, and broker-token revocation behavior for erasure during active work.
- [ ] Record honestly that bytes already disclosed to a model provider remain subject to that provider's enforceable
      retention limits.
