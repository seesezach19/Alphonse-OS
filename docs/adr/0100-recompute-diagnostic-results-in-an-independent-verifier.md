# Recompute Diagnostic Results In An Independent Verifier

Acceptance verification never asks the Stage Worker or a database-side procedure to reproduce its own result. A
role-scoped read API exports an immutable Independent Diagnostic Verification Bundle containing every preserved
intake outcome at contiguous committed positions `1..cutoff`, canonical receipt bytes or exact tombstones, schemas,
contracts, signed tokenization receipts and verification identities, grant snapshots and application receipts,
coverage, and the pinned projector, interpreter, evaluator, selection rules, and published input manifests.

A separate verifier container with its own image and verifier artifact reads only this bundle and independently
verifies prefix completeness, independently determines eligible inputs, and recomputes canonical input digests,
correlation edges and unresolved relationships, normalized effects, evaluation,
selected receipt manifest, package semantic digest, and expected stage identities. It compares recomputed outputs to
published immutable records. It has no database, Stage Worker, write, packaging, dispatch, or model access. Tests
alter receipts, rules, ordering, and cutoffs to ensure mismatches are detected rather than echoed.
