# 12 - Create the model-free unclaimed diagnostic assignment

**What to build:** Complete the deterministic platform proof by consuming the frozen-package event directly into one
immutable unclaimed assignment while the independent verifier separately confirms the same lineage for acceptance.

**Blocked by:** 11 - Recompute the complete intake prefix independently. This is implementation and acceptance
sequencing only; production assignment creation must not call or wait for the verifier.

**Status:** complete

- [x] Activate one immutable Assignment Policy binding the exact instruction and neutral output-schema artifacts,
      required Passport class, required worker capabilities, prohibitions, model and runtime requirements, isolation,
      mount, network, resource, expiry, data-classification, and disclosure-policy digests.
- [x] Select and pin the exact Assignment Policy activation ID and digest in the immutable
      `evidence_package.frozen` source transition. Delayed consumers must never resolve whichever policy is active at
      processing time; the mutable outbox row is a delivery hint rather than semantic authority.
- [x] Have the Assignment Service consume the verified frozen-package transition directly through a durable inbox,
      immutable stage-input and stage-result records, one transaction, transition, and outbox semantics.
- [x] Create one deterministic assignment identity scoped by installation, environment, exact package ID and semantic
      digest, exact Assignment Policy activation and digest, and initial ordinal.
- [x] Bind exact case, package, instruction, neutral output schema, Passport class, required worker capabilities,
      prohibitions, model and runtime requirements, isolation, mount, network, resources, data classification,
      disclosure policy, deterministic availability and expiry, and policy digests.
- [x] Keep immutable assignment facts separate from the fenced current-state projection. Create the immutable facts
      with `initial_state: unclaimed`, initialize current state `unclaimed`, and set `authority_granted: none` and
      `granted_capabilities: []` with no worker, dispatch request, authorization, broker token, execution capability,
      provider request, evidence disclosure, or model contact.
- [x] Derive availability from the immutable frozen-package transition time and expiry from that time plus the pinned
      policy TTL; consumer wall-clock time must not enter semantic assignment bytes.
- [x] Make repeated delivery idempotent. Classify changed source material as input-integrity failure, the same
      deterministic identity resolving to a different verified input digest as input-history divergence, and only
      different output from the same exact input, stage artifact, rules, and schema versions as nondeterminism.
- [x] Prove the instruction and output schema are answer-free and neutral: they expose multiple valid mechanism,
      scope, assurance, and uncertainty values while the fixture's expected tuple exists only in the hidden rubric.
- [x] Prove assignment creation still succeeds when the independent verifier is unavailable or has not run.
- [x] Complete model-free Test 1: stimulus exits, deterministic services create the lineage and assignment, verifier
      independently validates it, and no model request exists.
- [x] Preserve existing suites and legacy runtime behavior.
