# 06 - Bind and attest n8n runtime executions

**What to build:** Establish the expected n8n workflow identity before execution, independently attest both resulting
executions against that binding, and preserve canonical runtime observations without breaking the legacy runtime
reporting surface.

**Blocked by:** 03 - Preserve one generic canonical observation; 05 - Journal and observe duplicate ingress
deliveries.

**Status:** complete

- [x] Read the exact published workflow and provider version before activation and normalize it using pinned runtime
      image metadata, normalizer artifact, rules, dependencies, and defaults.
- [x] Fail readiness for unknown node semantics, unavailable defaults, unresolved dependencies, insufficient
      read-only scopes, missing detail, or inadequate successful-execution retention.
- [x] Bind the normalized digest to the exact Agent Revision before runtime Reporting Grant activation.
- [x] Have the runtime observer independently fetch immutable execution snapshots and report only exact workflow,
      provider version, revision, and normalized-digest matches.
- [x] Preserve two terminal `runtime.execution` observations correlated to the two deliveries and one logical
      operation.
- [x] Turn runtime mismatch into a visible attestation failure that cannot learn or replace the expected digest.
- [x] Translate the legacy runtime endpoint into the canonical receipt path while preserving signed source material,
      translator provenance, missing-field limitations, and legacy-shaped responses.
- [x] Keep existing External Activity Trace reads equivalent through compatibility projections over canonical
      receipts.
