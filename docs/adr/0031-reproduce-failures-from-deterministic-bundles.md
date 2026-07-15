---
status: accepted
---

# Reproduce failures from deterministic bundles

Alphonse defaults to reproducing a reported failure from an immutable Reproduction Bundle containing the exact Agent Revision, Failure Specification, redacted inputs, deterministic external-tool fixtures, environment assumptions, and hashes. Repair Candidates run against the same bundle plus narrow neighboring cases in an ephemeral workspace; live-system reproduction is exceptional, read-only first, and explicitly scoped.
