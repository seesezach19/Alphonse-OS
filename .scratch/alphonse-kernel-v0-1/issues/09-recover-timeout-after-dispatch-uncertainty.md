# 09 - Recover Timeout-After-Dispatch Uncertainty

**What to build:** The staging correction deliberately loses its response after dispatch; Kernel prevents duplicate correction, Butler exposes uncertainty, and governed reconciliation resolves whether the effect occurred without erasing failure history.

**Blocked by:** 08 - Dispatch One Staging Correction Exactly Once.

**Status:** ready-for-agent

- [ ] Test adapter injects timeout after the target may have applied the correction.
- [ ] Effect and Run become uncertain while original dispatch facts remain immutable.
- [ ] Duplicate dispatch/retry is rejected until reconciliation.
- [ ] Recovery Case shows known facts, missing evidence, deadline, responsible actor, and allowed options.
- [ ] Reconciled-applied path records verification evidence and may satisfy original obligation.
- [ ] Reconciled-not-applied path remains recovery-open, records breached obligation, and proposes separate corrective Work Intent.
- [ ] Corrective work follows normal Delegation, Capability, Envelope, Run, Effect, and evidence authority.
- [ ] Butler preserves was-uncertain history after terminal reconciliation.
