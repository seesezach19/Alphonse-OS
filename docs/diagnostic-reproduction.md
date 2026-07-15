# Diagnostic reproduction

Ticket 04 turns an explicit wrong-outcome report into deterministic evidence without granting repair or promotion authority.

## Flow

1. An authenticated Builder reports one exact External Activity Trace.
2. A human confirms expected behavior, actual behavior, reproduction conditions, and targeted verification.
3. Alphonse requests only package-declared fields from the customer-owned runtime detail adapter.
4. Package policy extracts required fields, removes declared omissions, and redacts sensitive paths before storage.
5. The adapter verifies the exact revision snapshot digest and executes the original deterministic fixture behavior.
6. Demonstrated failure creates one immutable content-addressed Reproduction Bundle. Incomplete and rejected attempts remain visible without advancing the case.

The case becomes `reproducible` only when the exact original revision demonstrates the confirmed actual behavior. This grants no execution, repair, or promotion authority.

## Retention

Only Reproduction Bundle payload bytes are eligible for Ticket 04 retirement. Retirement deletes exact content-addressed bytes and preserves an immutable tombstone containing digest, original storage metadata, actor, reason, time, and deletion outcome.

Run the proof:

```powershell
npm run test:v0.2-ticket-04
```
