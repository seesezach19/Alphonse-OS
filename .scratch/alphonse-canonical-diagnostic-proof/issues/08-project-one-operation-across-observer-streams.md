# 08 - Project one operation across all observer streams

**What to build:** Deterministically project the independently reported source, runtime, request, and ledger claims
into one immutable inspectable correlation graph at a stable committed cutoff without parsing artifacts or guessing
identity.

**Blocked by:** 06 - Bind and attest n8n runtime executions; 07 - Observe CRM requests and commit-feed records.

**Status:** complete

The nominal Ticket 08 proof completed at `a73bfdb`, but later adversarial review found five input-authority and
replay-classification gaps. Ticket 08 is not an admissible dependency for Ticket 09 until checkpoints 08H1 through
08H4 pass. Existing v0.1 registrations and projections remain immutable historical records; hardening creates a new
projector/registration/input/projection version rather than silently upgrading them.

- [x] Capture a stable contiguous Diagnostic Committed Intake Position cutoff under the installation-local
      finalization lock.
- [x] Freeze exact receipt, schema, tokenization, correlation registration, contract dependency, projector, and rules
      digests used by the revision.
- [x] Project one Logical Operation Identity with two delivery, execution, request, and ledger-claim paths using only
      signed typed claims.
- [x] Derive exact equality edges between each request key and corresponding delivery identity plus inequality between
      the two request keys, with receipt and tokenization provenance.
- [x] Record every edge basis and supporting claim location; represent missing or ambiguous relationships as
      unresolved rather than guessed.
- [x] Freeze stream coverage, compact gaps, conflicts, and limitations at the same cutoff.
- [x] Produce canonical node and edge ordering and the same semantic digest when exact inputs and rules replay.
- [x] Keep random record identity and creation time outside the semantic projection digest.
- [x] Complete 08H1 accepted-receipt authority and token-provenance verification.
- [x] Complete 08H2 conflict/rejection document integrity and conservative legacy-material handling.
- [x] Complete 08H3 normalized projector-input identity, transitive artifact identity, and replay classification.
- [x] Complete 08H4 adversarial unit coverage and a fresh Docker Ticket 08 proof.
