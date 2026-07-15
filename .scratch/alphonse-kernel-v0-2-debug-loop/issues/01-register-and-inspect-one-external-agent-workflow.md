# 01 - Register and Inspect One External Agent Workflow

**What to build:** A Builder registers one existing external Agent Workflow and inspects its exact immutable Agent Revision through public Alphonse operations, establishing the customer-controlled Diagnostic Plane without changing V0.1 Kernel authority semantics.

**Blocked by:** None - can start immediately.

**Status:** implemented

- [x] One fresh local Alphonse Node creates a separate Diagnostic database and least-privilege role beside the existing Kernel database.
- [x] A Builder can register the stable inventory follow-up Agent Workflow through a public operation and inspect the resulting record through HTTP and CLI.
- [x] A Builder can register one exact Agent Revision bound to canonical workflow content, runtime, node, model, configuration, and adapter fingerprints.
- [x] Equivalent revision material returns the original immutable identity; changed material creates a different revision identity.
- [x] Revision snapshots are stored through a content-addressed artifact boundary and verified by digest on retrieval.
- [x] Caller-supplied current or active labels cannot mutate an existing Agent Revision.
- [x] Diagnostic objects cannot grant Capability, execution, effect, or promotion authority.
- [x] Public discovery describes the workflow and revision operations, schemas, preconditions, outcomes, idempotency, and possible next operations.
- [x] Direct database access is unnecessary for registration or inspection.
- [x] Existing V0.1 unit and black-box tests remain green.
