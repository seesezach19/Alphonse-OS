# 08H4 - Prove correlation hardening adversarially

**What to build:** Demonstrate that each Ticket 08 trust boundary fails closed under independent field tampering and
that the nominal proof still produces one replay-stable immutable v0.2 projection from a fresh installation.

**Blocked by:** 08H3 - Bind projector input and artifact identity.

**Status:** complete

- [x] Add field-by-field tests for envelope/receipt duplicates, environment scope, schema bindings, dependency joins,
      signed token documents, conflict documents, rejection documents, and committed outcome bindings.
- [x] Prove canonicalizer, coverage, loader, integrity-verifier, or migration changes alter the projector artifact
      identity while unrelated documentation changes do not.
- [x] Test stored projection corruption, input-history divergence, artifact mismatch, exact replay, and controlled true
      nondeterminism as distinct classifications with no stray projection/conflict writes.
- [x] Test native bounded rejection handling for oversized, invalid JSON, scalar, array, malformed object, and valid
      schema-tuple inputs without persisting raw bodies or unbounded schema material.
- [x] Test exact legacy conflict/rejection reconstruction and explicit unavailable legacy material.
- [x] Run the full unit suite and a fresh Docker `--through-08` proof against the v0.2 registration and artifact.
- [x] Verify ordinary immutable triggers still reject mutation and random projection identity/time remain outside the
      semantic digest.
