# 08 - Project one operation across all observer streams

**What to build:** Deterministically project the independently reported source, runtime, request, and ledger claims
into one immutable inspectable correlation graph at a stable committed cutoff without parsing artifacts or guessing
identity.

**Blocked by:** 06 - Bind and attest n8n runtime executions; 07 - Observe CRM requests and commit-feed records.

**Status:** ready-for-agent

- [ ] Capture a stable contiguous Diagnostic Committed Intake Position cutoff under the installation-local
      finalization lock.
- [ ] Freeze exact receipt, schema, tokenization, correlation registration, contract dependency, projector, and rules
      digests used by the revision.
- [ ] Project one Logical Operation Identity with two delivery, execution, request, and ledger-claim paths using only
      signed typed claims.
- [ ] Derive exact equality edges between each request key and corresponding delivery identity plus inequality between
      the two request keys, with receipt and tokenization provenance.
- [ ] Record every edge basis and supporting claim location; represent missing or ambiguous relationships as
      unresolved rather than guessed.
- [ ] Freeze stream coverage, compact gaps, conflicts, and limitations at the same cutoff.
- [ ] Produce canonical node and edge ordering and the same semantic digest when exact inputs and rules replay.
- [ ] Keep random record identity and creation time outside the semantic projection digest.
