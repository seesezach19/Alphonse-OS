# Promotion Reconciliation and Rollback

Promotion is an append-only lifecycle. An adapter timeout after a target request is not failure and is not permission to retry.

## States

`authorized -> requested -> applying -> confirmed`

If the adapter response is lost, `applying -> uncertain`. Only `diagnostic.promotion.reconcile` is legal from uncertainty. It performs read-only target inspection and records one of:

- `confirmed`: target behavior matches the exact candidate.
- `failed`: target remains on the pre-change revision.
- `target_mismatch`: target matches neither known state; human review required.

Reconciliation never dispatches the Promotion again. Its idempotency key is independently bound to the Promotion and request material.

## Preserved Evidence

The Promotion retains Owner authorization, expected base, exact candidate and Verification Receipt, rollback artifact, adapter request receipt, missing-confirmation fact, reconciliation receipt, actors, intent-bearing command IDs, and every later event.

## Rollback

Rollback is available only from `confirmed`. It requires a new Owner command, exact current target revision digest, independent idempotency key, immutable pre-change snapshot, adapter request receipt, and read-back confirmation.

Rollback restores the prior executable behavior. A provider may assign a new revision identity to that restored behavior; later changes must inspect and authorize against that new current revision.

## Operations

- `POST /diagnostic/v0/promotions/{promotion_id}/reconcile`
- `POST /diagnostic/v0/promotions/{promotion_id}/rollback`
- `GET /diagnostic/v0/promotions/{promotion_id}`

No operation grants ambient production authority. Credentials remain in the customer-owned external binding.
