# Use A Serialized Committed Prefix For Diagnostic Cutoffs

V1 assigns every durably preserved accepted receipt, authenticated conflict, or retained rejection one contiguous
installation-local Diagnostic Committed Intake Position. Intake finalization acquires one transaction-scoped
installation lock, performs final replay and conflict checks, allocates the next position from transactional state,
persists the outcome and outbox, advances the counter, and holds the lock through commit. Rollback restores the
counter, so no uncommitted allocation can enter a cutoff.

A projection or package cutoff is the highest committed position captured while holding the same lock. All intake
outcomes at or below it form a stable committed prefix; future commits receive greater positions. Observer stream
sequences still describe only observer emission order. Acceptance covers concurrent finalization, reversed arrival,
rollback, conflict, and cutoff capture to prove stable prefix semantics.
