# 07 - Independently Verify the Exact Repair

**What to build:** An independent deterministic Verification Runner proves the original revision fails and the exact inactive candidate passes the same Reproduction Bundle and retained regressions, then emits a signed receipt that grants eligibility but no promotion authority.

**Blocked by:** 06 - Materialize One Inactive n8n Repair Candidate.

**Status:** completed

- [x] Verification runs under an identity and process distinct from Diagnostic and Repair Workers.
- [x] The runner receives immutable original, candidate, bundle, fixture, and regression artifacts by verified digest.
- [x] Original and candidate execute in disposable deterministic environments against the same Reproduction Bundle.
- [x] Acceptance requires the original to produce the demonstrated false delay outcome and the candidate to preserve `inventory_unknown` and route human review.
- [x] Every compatible retained regression runs; incompatible regressions are reported explicitly rather than skipped silently.
- [x] A deliberately bad candidate receives a failed Verification Receipt and cannot become promotion-eligible.
- [x] A passing receipt binds exact artifacts, per-check outcomes, runner and fixture versions, logs/evidence references, signer, and timestamp.
- [x] Identical verification retry returns the original receipt; changed candidate, bundle, regression set, or runner creates a distinct result.
- [x] Verification failure preserves evidence and leaves the case reproducible for a new Repair Task.
- [x] Passing verification updates eligibility and case projection without resolving the case or mutating n8n active state.
- [x] Verification Runner identity has no candidate-write, promotion, rollback, provider credential, or production effect authority.
- [x] The disposable environment is destroyed after artifacts and receipt are durably recorded.

## Verification

- `npm test` - 141/141 pass.
- `npm run test:v0.2-ticket-07` - fresh Docker proof passes Tickets 05-07, including good and negative-control candidates, retained regressions, signatures, idempotency, isolation, and active-target preservation.
- No AWS activity.
