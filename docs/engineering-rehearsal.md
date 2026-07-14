# Repeatable Engineering Rehearsal

Run:

```text
npm run rehearse
```

The command performs two sequential clean-state runs. Each run rebuilds the
local services and fixtures, creates separate source and target runtime
passports, and drives the inventory workflow through Kernel Protocol, target
observations, and Butler projections. The rehearsal performs no direct database
setup or authority mutation.

The plain-language input is: "When ERP and storefront inventory disagree,
identify the discrepancy and correct one staging SKU with evidence and safe
recovery." No inventory Operational Package exists at the beginning of either
run.

The journey covers intent confirmation, governed context, Package construction,
validation, deterministic and observational simulation, publication, staging,
technical review, business approval, activation, runtime handoff, comparison,
bounded correction, evidence, injected uncertainty, reconciliation, and
corrective-intent creation.

The negative matrix covers secret material, stale context, wrong runtime
identity, inactive authority, duplicate admission, duplicate dispatch, expired
handoff/delegation, and missing evidence/recovery declarations.

Timing is split into environment setup, deliberate expiry waits, active
automation, and total elapsed time. Human decisions are simulated by the
engineering harness, so measured human attention is zero and is not accepted as
qualification evidence.

## Assertion Boundary

Behavioral assertions use public Kernel Protocol responses, target-system
observations returned through the trusted adapter/reconciliation path, and
Butler read projections. Git state is compared only to report whether running
the rehearsal changed source or schema files. No private database inspection is
used.

## Remaining Qualification Blockers

- Unfamiliar Builder using only public documentation has not run the journey.
- Real Builder and Business Operator attention has not been measured.
- Runtime handoff uses separate protocol identities inside one harness, not two
  independently operated runtime processes.
- The controlled effect targets staging, not an approved production system.
- Not-applied recovery creates the normal corrective Work Intent, but the full
  second authority chain and corrective effect are not executed.
