# Canonical Diagnostic Proof Logic Prototype

THROWAWAY PROTOTYPE.

Question: do the grant-application barriers, signed tokenization receipt dependency, cumulative retention rules,
committed intake prefix, and durable diagnostic stages compose into one deterministic path from stimulus to an
unclaimed assignment without contacting a model?

Run:

```text
npm run prototype:canonical-diagnostics
```

Press `n` to advance the valid path. Use the probe keys to attempt invalid transitions and inspect why they fail.
The prototype keeps all state in memory and does not call Kernel, Postgres, n8n, Docker, or a model.

## Verdict

SUPPORTED by the in-memory model.

- The valid path reaches one immutable `unclaimed` assignment with `authority_none` and no model contact.
- Manifest seal fails before both grant application receipts become effective.
- Cumulative retention failure blocks sealing even when each individual interval fits.
- Observation intake fails until every referenced signed tokenization receipt is preserved.
- Independent verification fails when any committed position from `1..cutoff` is omitted.
- Reporting remains accepted while revocation is pending and rejects after durable service application.

This validates contract composition only. Persistence, concurrency, signatures, crash recovery, and container
isolation still require the black-box implementation tickets.
