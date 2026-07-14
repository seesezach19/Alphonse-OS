# Define Kernel Persistence And Projection Model

Type: prototype
Status: resolved
Claimed by: Codex
Blocked by: 03, 05, 06

## Question

What transactional persistence, append-only transition records, immutable definition storage, derived projections, integrity checks, idempotency boundaries, and environment isolation are required to implement the minimum Kernel object graph without turning one generic event stream into every domain state machine?

Prototype asset: [Kernel Persistence And Projection Model](../prototypes/kernel-persistence-and-projection-model.md)

## Answer

Kernel uses PostgreSQL as a hybrid authoritative store: explicit transactional lifecycle tables govern current authority, typed append-only transitions preserve history, immutable definitions use authoritative content digests, command and Atomic Transaction receipts enforce idempotency, and an at-least-once outbox drives disposable freshness-visible projections.

Every operation declares a progressive consistency class. Cross-object atomicity is available only through published, deployed, and activated Atomic Transaction Contracts; runtime agents cannot invent transaction programs or access storage internals. Environment boundaries are enforced through compound relational constraints and scoped sessions without schema-per-Environment complexity. External calls never occur in a Kernel transaction, and restore fences execution until external effects are reconciled.

Prototype: [Kernel Persistence And Projection Model](../prototypes/kernel-persistence-and-projection-model.md)
