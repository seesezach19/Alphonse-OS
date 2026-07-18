# Recompute Diagnostic Results In An Independent Verifier

Acceptance verification never asks the Stage Worker or a database-side procedure to reproduce its own result. A
role-scoped read API exports an immutable Independent Diagnostic Verification Bundle containing every preserved
intake outcome at contiguous committed positions `1..cutoff`, canonical receipt bytes or exact tombstones, schemas,
contracts, signed tokenization receipts and verification identities, grant snapshots and application receipts,
coverage, and the pinned projector, interpreter, evaluator, selection rules, and published input manifests.

Acquisition and verification are separate roles. A read-only exporter fetches and seals the bundle, then exits. A
networkless verifier container with its own image and verifier artifact reads only that bundle and writes only a
report. It has no credentials, database, Stage Worker, write API, packaging, assignment, dispatch, tokenization, or
model access.

The verifier first proves prefix completeness and material availability, then determines eligible inputs from the
raw prefix rather than production manifests. It independently recomputes canonical receipt and dependency manifests,
coverage, correlation edges and unresolved relationships, normalized effects, evaluation, trigger, case, D0 Claim
Envelopes, selected evidence, the package semantic digest and deterministic ID, the CAS wrapper, lease release, and
retention-pin manifests. Published outputs are comparison targets only and never eligibility inputs.

The verifier may use its own versioned canonicalization and protocol primitives, but it never imports, calls, or
executes production projection, interpretation, evaluation, selection, or packaging logic. Exact activated stage
source/runtime archives remain in the bundle so their identities are durable and inspectable; the verifier hashes
them but does not treat them as its implementation.

Because observation and grant acceptance use symmetric HMACs, verifier signing secrets remain excluded. The report
can independently verify canonical bytes, digests, bindings, Diagnostic Plane acceptance receipts, and Ed25519
Tokenization Result Receipts. It must label observer and grant HMACs as accepted by their originating service but not
independently reverified. Process compliance is not upgraded into cryptographic authorship.

Tests alter prefix positions, receipts, dependencies, rules, ordering, cutoffs, every published stage, the package
wrapper, and pins to ensure mismatches are detected rather than echoed. The report is a D0 frozen-historical
observation with no production authority. Under the v1 trusted-host threat model this catches omission, drift, and
corruption; it is not a claim against a hostile host rewriting the complete database and bundle chain.
