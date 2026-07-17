# 12 - Create the model-free unclaimed diagnostic assignment

**What to build:** Complete the deterministic platform proof by consuming the frozen-package event directly into one
immutable unclaimed assignment while the independent verifier separately confirms the same lineage for acceptance.

**Blocked by:** 11 - Recompute the complete intake prefix independently. This is implementation and acceptance
sequencing only; production assignment creation must not call or wait for the verifier.

**Status:** ready-for-agent

- [ ] Have the Assignment Service consume `evidence_package.frozen` directly through inbox, immutable stage record,
      transaction, transition, and outbox semantics.
- [ ] Create one deterministic assignment identity from package digest, assignment policy digest, and initial ordinal.
- [ ] Bind exact case, package, instruction, neutral output schema, Passport class, capabilities, prohibitions, model,
      runtime, isolation, mount, network, resource, expiry, and policy digests.
- [ ] Set status `unclaimed` and `authority_granted: none` with no worker, dispatch request, authorization, broker token,
      execution capability, or model disclosure.
- [ ] Make repeated delivery idempotent and changed output under the same deterministic identity a visible
      nondeterminism conflict.
- [ ] Prove assignment creation still succeeds when the independent verifier is unavailable or has not run.
- [ ] Complete model-free Test 1: stimulus exits, deterministic services create the lineage and assignment, verifier
      independently validates it, and no model request exists.
- [ ] Preserve existing suites and legacy runtime behavior.
