# Throwaway Prototype: Decisive Inventory Proof

## Question

Does the minimum cross-lifecycle state model preserve exact authority and accountability through Package construction, runtime handoff, execution, external Effect, evidence, uncertainty, and recovery while rejecting stale context, duplicate dispatch, and illegal transition ordering?

This is intentionally throwaway. It is an in-memory terminal prototype, not production Kernel code.

## Run

From the ALPHONSE_KERNEL repository:

    node .scratch\alphonse-kernel-platform\prototypes\decisive-inventory-proof\cli.js

## Drive It

The terminal always shows complete relevant state, derived Accountability Projection, recent accepted transitions, invariant status, and currently legal actions.

Useful commands:

    scenario happy
    scenario uncertainty
    scenario not_applied
    scenario stale
    scenario duplicate
    reset
    q

You can also type any action name. Typing a known action when its preconditions are not satisfied should reject it without advancing revision or ledger.

After loading scenario uncertainty, continue manually with:

    reconcile_applied
    submit_evidence
    close_accountability

The important reaction is whether any rejected action should be legal, any legal action should be rejected, or any displayed state feels misleading.

## Verdict

The minimum state model holds at prototype fidelity after one important correction.

Initial reconciliation incorrectly treated a confirmed non-applied Effect as recovered. The corrected model keeps Accountability in recovery, records the breached original Obligation, and permits only a proposed corrective Work Intent through normal authority.

Observed:

- happy path reaches satisfied accountability only after confirmed Effect and evidence
- timeout after dispatch becomes uncertain and opens recovery
- reconciled-applied path preserves uncertainty in ledger before satisfying accountability
- reconciled-not-applied path remains recovery-open and proposes separate corrective work
- stale context blocks admission
- duplicate dispatch changes no revision or ledger state
- invalid transition ordering is rejected

The prototype does not prove persistence, concurrency, cryptography, container containment, or real adapter behavior. Those remain implementation/acceptance concerns at the same black-box seam.
