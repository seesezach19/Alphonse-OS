# 04 - Reproduce One Confirmed Failure Deterministically

**What to build:** A Builder converts the false delay trace into a Diagnostic Case, confirms expected-versus-actual behavior, and produces an immutable redacted Reproduction Bundle that deterministically demonstrates the original defect.

**Blocked by:** 03 - Observe the Wrong n8n Inventory Execution.

**Status:** completed

- [x] An explicit authenticated failure report creates one Diagnostic Case linked to the exact External Activity Trace and Agent Revision.
- [x] A human-confirmed Failure Specification records `inventory_unknown -> human_review` as expected and `missing_sku -> zero_inventory -> delay_draft` as actual.
- [x] Model inference cannot confirm or silently alter the Failure Specification.
- [x] Alphonse retrieves only the detailed n8n execution information required for the active case through supported APIs.
- [x] Package-declared extraction and redaction rules remove configured sensitive values before durable artifact storage.
- [x] One immutable Reproduction Bundle binds the exact revision, specification, redacted inputs, deterministic ERP/storefront/model/review fixtures, assumptions, and integrity hashes.
- [x] Repeating bundle creation with identical inputs returns the original bundle; changed inputs create a new immutable bundle.
- [x] The exact original revision reproduces the reported false delay outcome before the case becomes reproducible.
- [x] Artifact retrieval verifies digest and rejects traversal, substitution, or missing bytes with structured outcomes.
- [x] Retention can delete selected payload bytes while preserving digest, identity, reason, and time as a tombstone.
- [x] Rejected or incomplete reproduction attempts remain visible and do not advance the case projection.
- [x] HTTP and CLI inspection show the case, confirmed specification, bundle references, reproduction result, and legal next operations.

## Verification

- `npm test` - 117/117 pass.
- `npm run test:v0.2-ticket-03` - real n8n observation remains intact.
- `npm run test:v0.2-ticket-04` - human specification, minimal detail retrieval, redaction, exact-revision reproduction, attempt visibility, bundle idempotency, retention tombstone, and CLI inspection pass.
