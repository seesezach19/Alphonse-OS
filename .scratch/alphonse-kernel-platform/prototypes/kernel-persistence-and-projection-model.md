# Kernel Persistence And Projection Model

Status: rough HITL prototype

## Claim

Kernel can preserve exact authority, immutable history, deterministic concurrency, and useful agent/operator visibility in PostgreSQL without treating one generic event stream as every domain state machine.

## Persistence Shape

Kernel uses a hybrid transactional model:

```text
Validated command
  -> authoritative lifecycle state
  -> immutable typed transition
  -> command/transaction receipt
  -> outbox record
  -> asynchronous projections and subscribers
```

All authoritative writes for one admitted command commit atomically. Current lifecycle state is authoritative for decisions. The transition ledger preserves history. Projections are disposable views. The outbox distributes committed facts.

## PostgreSQL Boundaries

PostgreSQL is the authoritative Kernel store. Each Kernel Installation may choose shared or dedicated physical infrastructure, but the logical isolation contract is invariant.

Every authoritative record is bound to:

- `installation_id`
- `environment_id`

Composite primary keys, unique constraints, and foreign keys include the environment boundary where necessary. A database session is scoped to one Environment, with row-level security as defense-in-depth. Authority, Runs, Effects, credential references, and Context Receipts cannot cross Environment boundaries.

Immutable Package definitions may be reused by digest. Promotion creates a new exact Deployment in the target Environment; mutable state is never moved between Environments.

## Authoritative Record Families

### Immutable Definitions

Canonical manifests and contracts remain in PostgreSQL. Large code, Skill Export, evaluation, and adapter artifacts use content-addressed object storage.

Kernel records:

- authoritative content digest
- canonicalization version
- size and media type
- storage reference
- publication attestation
- semantic version as a non-authoritative human label

Publication verifies every artifact before committing a Package Version. Definitions never update in place. Uncommitted uploads remain staged and may be garbage-collected.

### Lifecycle State

Each Kernel aggregate has an explicit current-state table and registered state machine. Examples include Deployment, Capability, Envelope, Run, Effect, Operational Obligation, and Recovery Case.

Lifecycle tables contain the exact current revision and state needed for deterministic command admission. They are not caches or projections.

### Transition Ledger

One shared `kernel_transition` envelope provides:

- environment and aggregate identity
- aggregate revision
- command and transaction identity
- actor and authority references
- commit cursor and deterministic position
- timestamp
- previous transition digest and transition digest

Typed lifecycle records such as `run_transition`, `capability_transition`, and `obligation_transition` preserve explicit domain meaning. The shared envelope is not a generic JSON reducer and does not define lifecycle behavior.

### Command And Transaction Receipts

Every state-changing command supplies:

- `environment_id`
- `command_id`
- actor/Passport reference
- operation identity and version
- canonical request digest

The resulting receipt binds the original request digest, outcome, affected revisions, transitions, and commit cursor.

Rules:

- same command ID and same digest returns the original result
- same command ID and different digest rejects as an idempotency conflict
- database retries cannot duplicate a transition
- Effect dispatch uses a separate Effect idempotency boundary

## Command Transaction

One admitted command atomically:

1. resolves its registered operation contract
2. validates Environment, identity, Work Intent, authority, and expected revisions
3. applies the operation's consistency class
4. writes typed lifecycle state and transitions
5. writes command or Atomic Transaction receipt
6. writes outbox records
7. commits or changes nothing

Kernel never calls the Data Plane, credential provider, adapter, agent, or other external system while holding the transaction. Long-running work is represented through Runs, Effects, Operational Obligations, and recovery.

## Consistency Classes

Each registered operation declares a minimum consistency class during publication. Runtime callers cannot weaken it, and Kernel may promote it.

### Observational

Read-only operation. It may use a projection or replica when its response discloses cursor, freshness, and health.

### Aggregate-Linearized

Single-aggregate mutation using row locking, expected revision, database constraints, and idempotent command receipt.

### Invariant-Atomic

Authority changes, admission, or approved multi-object invariants use PostgreSQL serializable isolation with internal retries under the same idempotency key.

## Atomic Transaction Contract

Operational Packages may declare a versioned Atomic Transaction Contract during publication. It defines:

- exact atomic-composable operation versions
- allowed object types and relationship constraints
- invariant protected by atomicity
- required authority and Work Intent bindings
- parameter schema and limits
- consistency class
- deterministic lock ordering rules
- receipt and transition obligations

Publication validates the contract. Deployment binds its exact version. Capability activation grants authority to invoke it. Runtime callers provide only permitted object identities and parameters; they cannot create a transaction program dynamically.

Kernel resolves the complete operation set, rejects cross-Environment targets and external effects, locks in deterministic order, commits all typed transitions atomically, and returns one receipt containing before/after revisions.

This is a Kernel composition protocol, not arbitrary SQL or a distributed transaction protocol. Frequent cross-object coordination that does not protect an immediate invariant remains an explicit asynchronous lifecycle.

## Integrity And Concurrency

- Ledger writer roles cannot update or delete transitions.
- Aggregate revisions are monotonic.
- Commands carry expected revisions where concurrency is visible to the caller.
- Unique constraints enforce idempotency and semantic uniqueness.
- Each transition digest covers canonical content and the previous transition digest.
- Definition digests are verified on authoritative load.
- Projection rebuild verifies sequence and digest continuity.
- Corruption quarantines the affected aggregate and authority fails closed.
- Periodic signed checkpoints may anchor environment integrity outside the primary database.

## Outbox And Ordering

Delivery is at-least-once, never represented as exactly-once.

Each Environment has an ordered commit cursor. All transitions from one atomic transaction share a `commit_id` and have deterministic positions. Events include stable event IDs and authoritative object revisions.

Consumers checkpoint cursors and deduplicate event IDs. Ordering is guaranteed within the relevant Environment and aggregate, not globally across installations. A consumer cannot mutate authority through an event; it must submit a new validated command.

Delivered outbox records may be compacted under retention policy. The transition ledger remains the rebuild source during its retention boundary.

## Projections

Named, versioned projections provide agent and operator views. They are built asynchronously from committed transitions and may be deleted and rebuilt.

Every projection exposes:

- projection name and version
- source commit cursor
- relevant aggregate revisions
- health: current, delayed, rebuilding, or failed
- generated timestamp

Authority-changing commands read lifecycle state directly, never projections. Projection failure cannot change authority. Kernel projections contain Kernel metadata and typed Data Plane references, not business payloads.

## Schema Evolution

- Every definition and transition carries schema version.
- Immutable history is never rewritten by migration.
- Versioned decoders interpret historical records.
- Canonicalization version participates in content identity.
- Database migrations use expand, backfill, verify, then contract.
- New projection versions build beside old versions before an atomic reader switch.
- Kernel writes a new format only after active readers support it.
- Unsupported breaking changes require an explicit Environment upgrade.

## Backup, Restore, And Fencing

Kernel uses encrypted PostgreSQL point-in-time recovery and versioned or replicated artifact storage with digest verification.

A restore never implies reversal of external business effects. Every restored Environment:

1. starts suspended
2. receives a new execution epoch
3. fences workers from the prior epoch
4. marks potentially post-restore Runs and Effects for reconciliation
5. exposes unresolved Operational Obligations through Butler
6. resumes authority only after explicit recovery validation

Restore drills verify the database, artifacts, transition integrity, projections, worker fencing, and external-effect reconciliation.

## Retention And Deletion

Records are immutable within the declared retention boundary, not necessarily retained forever.

- Kernel minimizes personal and business payloads.
- Identity display data remains in replaceable mappings.
- Deleting a user mapping leaves historical attribution pseudonymous.
- Operational deletion creates a typed tombstone rather than silently rewriting history.
- Expiration revokes authority but is distinct from deletion.
- Environment/customer retention policy applies within legal and accountability requirements.
- Full Environment destruction uses cryptographic erasure and leaves only a minimal non-sensitive deletion receipt where required.

## Degraded Operation

If the primary authoritative store is unavailable:

- authority changes and Effect dispatch stop
- cached projections remain read-only and disclose stale/unavailable status
- agents may draft local artifacts but cannot claim validation, approval, activation, or execution
- read replicas cannot admit commands
- recovery revalidates pending requests against current authority and revisions rather than blindly replaying them

Kernel fails closed for consequences while remaining useful for preparation.

## Required Invariants

1. No committed authority change exists without its immutable transition and receipt.
2. No transition exists without the corresponding committed authoritative state.
3. One idempotency identity cannot represent two request digests.
4. One aggregate revision has at most one successor.
5. No authoritative reference crosses an Environment boundary.
6. No projection participates in authority admission.
7. No external call occurs inside a Kernel database transaction.
8. No runtime caller can invent or weaken an Atomic Transaction Contract.
9. Restore cannot resume external execution without a new epoch and reconciliation.
10. Historical records are never silently mutated or deleted.

## Prototype Outcome

The minimum Kernel persistence model is a PostgreSQL-backed hybrid: explicit transactional lifecycle state for deterministic authority, typed append-only transitions for accountability, immutable content-addressed definitions, idempotent command and atomic-transaction receipts, at-least-once outbox delivery, and disposable freshness-visible projections. Environment boundaries are enforced logically and may be strengthened physically. Atomic composition is registered and reviewed before runtime. External work remains outside database transactions and is governed through execution and recovery lifecycles.
