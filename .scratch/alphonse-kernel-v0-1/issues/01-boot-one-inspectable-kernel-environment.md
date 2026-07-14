# 01 - Boot One Inspectable Kernel Environment

**What to build:** A fresh local checkout starts one customer-controlled Kernel Environment with PostgreSQL, Kernel Protocol discovery, an empty Butler shell, durable command receipts, typed transitions, and a black-box smoke path. Use local Docker only; no AWS activity.

**Blocked by:** None - can start immediately.

**Status:** completed

- [x] One documented local command starts PostgreSQL, Kernel service, and Butler shell.
- [x] Repository is initialized with Git and baseline ignore rules before implementation changes.
- [x] A fresh database migrates and creates one isolated Kernel Environment without manual SQL.
- [x] Kernel Protocol bootstrap exposes health, protocol version, Environment identity, and discoverable public operations.
- [x] Replaying one command ID with the same digest returns the original result; changing the digest rejects.
- [x] One accepted command atomically writes authoritative state, typed transition, receipt, and outbox record.
- [x] Butler shows Environment health and an empty accountable-work inbox through public interfaces.
- [x] A black-box acceptance check proves startup and discovery without inspecting database internals.
- [x] Local shutdown and restart preserve authoritative state.
