# Bind Runtime Observations To Pre-Execution Published Material

Expected runtime identity is established before execution from the exact published provider workflow and
version using a normalizer and node metadata extracted from the pinned runtime image. The immutable Workflow
Attestation Binding includes normalized workflow, Agent Revision, runtime, metadata, normalizer, rules,
dependency, and readiness digests; reporting authority cannot activate without current proof of published and
execution reads, immutable snapshots, successful-execution retention, sufficient read-only scopes, and full
normalization coverage. Unknown semantics fail readiness. Runtime observers independently normalize execution
snapshots under the same artifacts and may only confirm or contradict the binding; no path may promote an
execution-derived digest into the expected revision.
