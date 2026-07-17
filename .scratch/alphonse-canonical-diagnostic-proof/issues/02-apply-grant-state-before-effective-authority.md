# 02 - Apply grant state durably before authority becomes effective

**What to build:** Make one generic authority protocol carry desired grant state from Kernel to a receiving service,
prove durable application through a signed receipt, and expose effective activation or revocation only after Kernel
verifies that receipt.

**Blocked by:** 01 - Lock the stimulus-only canonical-diagnostics acceptance seam.

**Status:** completed

- [x] Register grants as inactive and prevent readiness failure from publishing activatable desired state.
- [x] Publish signed activation snapshots through a one-way authority feed without giving receivers general Kernel
      database access.
- [x] Have the receiving service apply each snapshot transactionally and sign an application receipt binding service,
      snapshot, authority sequence, predecessor, target state, local transaction identity, and application time.
- [x] Accept application receipts through a private Kernel endpoint and preserve the exact verified bytes.
- [x] Record `active_effective` or `revoked_effective` only after service identity, signature, snapshot, ordering, state,
      and transaction bindings verify.
- [x] Keep prior authority effective while revocation is pending; reject new use beginning at durable revocation
      application without invalidating historical receipts.
- [x] Prevent deployment sealing and stimulus until every required grant has a verified application receipt.
- [x] Prove replay, conflict, stale snapshot, missing application, out-of-order authority, and receiver outage behavior.
