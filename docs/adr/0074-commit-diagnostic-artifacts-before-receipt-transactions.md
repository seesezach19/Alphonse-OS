# Commit Diagnostic Artifacts Before Receipt Transactions

Observation intake durably commits bounded, verified detail bytes to deterministic content-addressed storage
before beginning the authoritative Postgres transaction. That transaction rechecks replay and conflict identity
under stream lock, inserts artifact metadata and immutable receipt, updates rebuildable coverage state, and
records diagnostic transitions and outbox events. A crash may leave an unreferenced CAS orphan, but accepted
database state can never reference missing bytes. HTTP retries return exact receipts, outbox delivery is
at-least-once with consumer deduplication, and delayed mark-and-sweep garbage collection considers every
immutable reference plus pending-upload protection rather than mutable navigation pointers.
