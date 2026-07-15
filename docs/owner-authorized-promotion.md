# Owner-Authorized Promotion

Promotion is a separate append-only lifecycle. A passing Verification Receipt creates eligibility only. It does not authorize or apply a target change.

## Required sequence

1. An authenticated customer Owner authorizes one exact current verified candidate.
2. Authorization binds the candidate, passing Verification Receipt, delivery, target, adapter, expected target revision, candidate target revision, Owner, and idempotency key.
3. Before any target request, Alphonse reads the current target, rejects drift, stores its exact snapshot, and records the rollback reference and application request.
4. The Repair Delivery Adapter applies the candidate through the target's supported API.
5. The adapter reads the target back and confirms the exact candidate behavior and resulting target revision.
6. Only a confirmed Promotion resolves the Diagnostic Case.

Authorization, application request, and confirmation are distinct immutable facts. Identical retries reuse their original records. Changed material under an existing idempotency key fails closed.

## Authority boundary

Repair Workers, Diagnostic Workers, Verification Runners, Runtime Adapters, and unauthenticated callers cannot authorize or apply promotion. The n8n adapter receives only the exact operation after Owner authorization. It never receives rollback authority in Ticket 08.

Provider credentials remain in the customer-local adapter environment. Alphonse stores only a secret-free credential binding reference.

## Ticket 08 effect boundary

Promotion updates the bound workflow definition. It does not execute the workflow, send email, or create a production inventory effect. Rollback execution and uncertain-result reconciliation are separate Ticket 09 operations.

