# 14 - Erase evidence visibly and enforce material availability

**What to build:** Allow governed erasure to remove sensitive evidence bytes without rewriting history, then make
availability changes constrain assignments, dispatch, and active work through explicit safety state.

**Blocked by:** 12 - Create the model-free unclaimed diagnostic assignment.

**Status:** complete

- [x] Keep package-selected artifacts retention-pinned through active case, diagnosis, review, and audit policy while
      requiring exact explicit overrides. Active legal holds fail closed and cannot be overridden by this policy.
- [x] Revoke material access at the committed decision, then delete local CAS bytes through a locked, idempotent
      follow-up and immutable tombstone that cannot race package freeze, revision, assignment creation, or
      ordinary garbage collection.
- [x] Preserve immutable tombstones binding artifact digest, governing policy, reason, authority decision, timing,
      verification status, affected packages, and replica or provider limitations.
- [x] Project package material availability as `complete`, `partially_unavailable`, or `material_unavailable` without
      rewriting the package manifest or historical diagnosis.
- [x] Recheck exact material availability before package reads that can create assignment, revision, verification, or
      later execution authority. Tickets 15–16 must retain this guard at claim and active-run boundaries.
- [x] Expire affected unclaimed assignments and preserve explicit replacement or cancellation provenance.
- [x] Define claimed-assignment cancellation as requiring workspace destruction and broker-token revocation. The
      active worker mechanisms that perform and attest those effects remain a Ticket 15–16 implementation handoff.
- [x] Record honestly that bytes already disclosed to a model provider remain subject to that provider's enforceable
      retention limits.

Acceptance: `npm run test:canonical-proof:ticket-14` passes from a fresh Docker volume and includes retention-pin and
legal-hold refusal, revocation-before-deletion, unexplained byte-loss classification, unclaimed assignment expiry,
blocked verifier/revision authority, normal deletion, crash recovery after prior byte loss, idempotent replay, and
explicitly false universal-deletion claims.
