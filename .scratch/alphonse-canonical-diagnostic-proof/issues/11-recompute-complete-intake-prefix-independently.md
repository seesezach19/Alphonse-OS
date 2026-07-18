# 11 - Recompute the complete intake prefix independently

**What to build:** Give a separate read-only verifier enough canonical material to detect omitted eligible receipts and
recompute every deterministic result through the frozen package without asking production code or its database to
validate itself.

**Blocked by:** 10 - Collect and freeze the first deterministic evidence package.

**Status:** complete

- [x] Export every preserved accepted receipt, authenticated conflict, and retained rejection at contiguous positions
      `1..cutoff`. Classify each position as exact material, digest-verified legacy reconstruction, governed-erasure
      tombstone, unavailable legacy material, or missing/corrupt material; never treat a tombstone as the original bytes.
- [x] Include exact grant snapshots and application receipts, signed tokenization receipts and service verification
      identities, schemas, contracts, coverage, and pinned projector, interpreter, evaluator, and selection rules.
- [x] Separate acquisition from verification. A read-only exporter may fetch the sealed bundle, but the verifier runs
      in a separate process and image with no network, credentials, database, Stage Worker, write, packaging,
      assignment, dispatch, tokenization, or model access and writes only its report.
- [x] Preserve the exact source/runtime artifact archives identified by every activated projector, interpreter,
      evaluator, and selector manifest. The verifier hashes those bytes for provenance but implements the business
      rules independently and never imports or executes production stage-worker logic.
- [x] Verify prefix contiguity first, then independently determine eligible inputs instead of trusting production input
      manifests.
- [x] Recompute receipt manifests, coverage, correlation and unresolved relationships, normalized effects,
      evaluation, trigger, case, D0 Claim Envelopes, selected inputs, package semantic digest and ID, CAS wrapper,
      lease release, retention pins, and every deterministic stage identity.
- [x] Report the cryptographic assurance ceiling honestly: independently verify public-key tokenization signatures,
      but report observer and grant HMAC signatures as accepted by their originating service and not independently
      reverified because verifier signing secrets remain excluded.
- [x] Fail verification for an omitted position, unexplained tombstone, omitted eligible receipt, tampered receipt,
      changed rule, changed order, changed cutoff, or changed published output.
- [x] Keep this verification path read-only and observational; it must never emit a production pipeline event or
      authorize assignment creation.
- [x] Emit one immutable D0 report with `authority: none`, `freshness: frozen_historical`, explicit material
      availability, per-stage recomputed/published digests, exact mismatches, limitations, and nonclaims.

The v1 proof detects omissions, deterministic implementation drift, and persisted corruption under the trusted
customer-host threat model. It does not claim resistance to a hostile host or database administrator rewriting the
complete chain; a separately anchored accumulator or transparency log remains future work.

Verified with 260/260 unit tests and a fresh-volume `--through-11` Docker proof. The offline read-only verifier
recomputed 11 deterministic stages, accepted physical input reordering, and failed closed on nine resealed adversarial
bundles covering prefix omission, cutoff substitution, receipt omission/tampering, unexplained erasure, stage-source
tampering, rule drift, semantic-digest substitution, and graph-order substitution. It created no authority effects,
production events, worker run, or model request.
