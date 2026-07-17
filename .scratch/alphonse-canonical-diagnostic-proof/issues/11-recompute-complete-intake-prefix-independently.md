# 11 - Recompute the complete intake prefix independently

**What to build:** Give a separate read-only verifier enough canonical material to detect omitted eligible receipts and
recompute every deterministic result through the frozen package without asking production code or its database to
validate itself.

**Blocked by:** 10 - Collect and freeze the first deterministic evidence package.

**Status:** ready-for-agent

- [ ] Export every preserved accepted receipt, authenticated conflict, and retained rejection at contiguous positions
      `1..cutoff`, including exact bytes or immutable erasure tombstone.
- [ ] Include exact grant snapshots and application receipts, signed tokenization receipts and service verification
      identities, schemas, contracts, coverage, and pinned projector, interpreter, evaluator, and selection rules.
- [ ] Run verification in a separate process and image with no database, Stage Worker, write, packaging, assignment,
      dispatch, tokenization, or model access.
- [ ] Verify prefix contiguity first, then independently determine eligible inputs instead of trusting production input
      manifests.
- [ ] Recompute receipt manifests, correlation, unresolved relationships, effects, evaluation, selected inputs,
      package semantic digest, and deterministic stage identities.
- [ ] Fail verification for an omitted position, unexplained tombstone, omitted eligible receipt, tampered receipt,
      changed rule, changed order, changed cutoff, or changed published output.
- [ ] Keep this verification path read-only and observational; it must never emit a production pipeline event or
      authorize assignment creation.
