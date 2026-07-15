# 04 - Reproduce One Confirmed Failure Deterministically

**What to build:** A Builder converts the false delay trace into a Diagnostic Case, confirms expected-versus-actual behavior, and produces an immutable redacted Reproduction Bundle that deterministically demonstrates the original defect.

**Blocked by:** 03 - Observe the Wrong n8n Inventory Execution.

**Status:** ready-for-agent

- [ ] An explicit authenticated failure report creates one Diagnostic Case linked to the exact External Activity Trace and Agent Revision.
- [ ] A human-confirmed Failure Specification records `inventory_unknown -> human_review` as expected and `missing_sku -> zero_inventory -> delay_draft` as actual.
- [ ] Model inference cannot confirm or silently alter the Failure Specification.
- [ ] Alphonse retrieves only the detailed n8n execution information required for the active case through supported APIs.
- [ ] Package-declared extraction and redaction rules remove configured sensitive values before durable artifact storage.
- [ ] One immutable Reproduction Bundle binds the exact revision, specification, redacted inputs, deterministic ERP/storefront/model/review fixtures, assumptions, and integrity hashes.
- [ ] Repeating bundle creation with identical inputs returns the original bundle; changed inputs create a new immutable bundle.
- [ ] The exact original revision reproduces the reported false delay outcome before the case becomes reproducible.
- [ ] Artifact retrieval verifies digest and rejects traversal, substitution, or missing bytes with structured outcomes.
- [ ] Retention can delete selected payload bytes while preserving digest, identity, reason, and time as a tombstone.
- [ ] Rejected or incomplete reproduction attempts remain visible and do not advance the case projection.
- [ ] HTTP and CLI inspection show the case, confirmed specification, bundle references, reproduction result, and legal next operations.
