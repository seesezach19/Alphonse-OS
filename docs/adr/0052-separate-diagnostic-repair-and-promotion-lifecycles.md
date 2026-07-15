---
status: accepted
---

# Separate diagnostic, repair, and promotion lifecycles

Diagnostic Cases, Repair Tasks, Repair Candidates, and target Promotions use separate explicit state machines with append-only transitions and derived projections. Retries create new attempts, candidates are immutable and may be superseded, failed work remains visible, promotion requires its own idempotent target receipt, and resolution requires verified target revision evidence or an explicit human unresolved closure.
