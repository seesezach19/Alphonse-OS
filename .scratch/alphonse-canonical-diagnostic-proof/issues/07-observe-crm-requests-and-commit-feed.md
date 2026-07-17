# 07 - Observe CRM requests and commit-feed records

**What to build:** Independently preserve the two outbound CRM requests, their transport outcomes, and the mock CRM's
append-only commit-feed records while keeping request acknowledgement separate from destination commitment.

**Blocked by:** 03 - Preserve one generic canonical observation; 04 - Tokenize comparison values with verifiable
result receipts; 05 - Journal and observe duplicate ingress deliveries.

**Status:** ready-for-agent

- [ ] Give request and ledger observers separate Principals, Reporting Grants, keys, streams, and exact CRM scope.
- [ ] Preserve two `destination.request` observations with opaque request identity, logical operation, operation,
      transport result, and idempotency-key equality-token references.
- [ ] Show that each request key equals its corresponding delivery identity and that the two request keys differ,
      without disclosing raw values.
- [ ] Preserve two `destination.effect` observations only from the contract-designated append-only mock CRM ledger,
      each with a stable commit identity.
- [ ] Keep generic HTTP success as request acknowledgement and direct ledger reports as authenticated external claims,
      not normalized committed effects.
- [ ] Optionally preserve a post-commit destination snapshot without making it required for this duplicate-delivery
      proof.
- [ ] Expose stream coverage, gaps, limitations, and exact observer provenance for every CRM role.
- [ ] Verify request retries, observation replay, repeated snapshots, and ledger replay do not create extra receipts or
      normalized effects.
