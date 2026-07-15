# Throwaway Prototype: V0.2 Debug Loop State Model

## Question

Can separate External Activity, Diagnostic Case, Repair Task, Repair Candidate,
Verification, and Promotion lifecycles preserve understandable truth through
duplicates, expired workers, failed verification, stale targets, and uncertain
promotion?

This is an in-memory throwaway terminal prototype. It is not production code,
does not call n8n, and does not prove persistence, concurrency, cryptography, or
container isolation.

## Run

From the ALPHONSE_KERNEL repository:

    node .scratch\alphonse-kernel-v0-2-debug-loop\prototype\cli.cjs

Useful commands:

    scenario happy
    scenario duplicate_event
    scenario expired_worker
    scenario failed_verification
    scenario worker_self_promotion
    scenario stale_target
    scenario uncertain_applied
    scenario uncertain_not_applied

Each action prints the complete relevant state, derived case projection, legal
next actions, transition ledger, and invariant violations.

Run one scenario non-interactively:

    node .scratch\alphonse-kernel-v0-2-debug-loop\prototype\cli.cjs uncertain_applied

## Verdict

The separated lifecycle model holds at prototype fidelity after one projection
correction. Rejected candidates remain visible but return the Diagnostic Case to
`reproducible`; they do not leave it at `candidate_available`. Legal-action
discovery also applies target-revision freshness before offering promotion.

Observed:

- duplicate delivery changes no revision or ledger state
- conflicting delivery is rejected without changing accepted truth
- External Activity never appears as a Kernel Run
- expired workers cannot submit
- failed candidates cannot be promoted
- workers cannot authorize promotion
- a target revision change invalidates candidate promotion
- uncertain promotion blocks blind retry
- reconciliation can confirm applied or not applied without erasing uncertainty
- a case resolves only after confirmed target revision

All eight scenarios complete without invariant violations. The prototype does
not prove persistence, concurrency, HMAC implementation, real n8n behavior, or
container isolation. Those remain implementation and black-box acceptance work.
