# 07 - Independently Verify the Exact Repair

**What to build:** An independent deterministic Verification Runner proves the original revision fails and the exact inactive candidate passes the same Reproduction Bundle and retained regressions, then emits a signed receipt that grants eligibility but no promotion authority.

**Blocked by:** 06 - Materialize One Inactive n8n Repair Candidate.

**Status:** ready-for-agent

- [ ] Verification runs under an identity and process distinct from Diagnostic and Repair Workers.
- [ ] The runner receives immutable original, candidate, bundle, fixture, and regression artifacts by verified digest.
- [ ] Original and candidate execute in disposable deterministic environments against the same Reproduction Bundle.
- [ ] Acceptance requires the original to produce the demonstrated false delay outcome and the candidate to preserve `inventory_unknown` and route human review.
- [ ] Every compatible retained regression runs; incompatible regressions are reported explicitly rather than skipped silently.
- [ ] A deliberately bad candidate receives a failed Verification Receipt and cannot become promotion-eligible.
- [ ] A passing receipt binds exact artifacts, per-check outcomes, runner and fixture versions, logs/evidence references, signer, and timestamp.
- [ ] Identical verification retry returns the original receipt; changed candidate, bundle, regression set, or runner creates a distinct result.
- [ ] Verification failure preserves evidence and leaves the case reproducible for a new Repair Task.
- [ ] Passing verification updates eligibility and case projection without resolving the case or mutating n8n active state.
- [ ] Verification Runner identity has no candidate-write, promotion, rollback, provider credential, or production effect authority.
- [ ] The disposable environment is destroyed after artifacts and receipt are durably recorded.
