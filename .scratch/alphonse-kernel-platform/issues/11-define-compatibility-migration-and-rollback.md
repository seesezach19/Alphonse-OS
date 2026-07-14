# Define Compatibility Migration And Rollback

Type: prototype
Status: resolved
Claimed by: Codex
Blocked by: 05, 08

## Question

What compatibility contracts, migration declarations, staging checks, state transformations, rollback plans, and failure boundaries let Builders upgrade Package Versions and Deployments without silently breaking active user space or pretending irreversible effects can be rolled back?

Prototype asset: [Compatibility Migration And Rollback](../prototypes/compatibility-migration-and-rollback.md)

## Answer

Compatibility is a machine-readable multidimensional contract rather than a semantic-version promise. Target Deployments build beside active user space, exact consumers and Runs remain version-pinned, Package state transforms through explicit resumable Migration Runs, and production activation proceeds through deterministic cohorts and verification gates.

Authority-equivalent upgrades may use customer-preapproved activation policy; changed authority requires fresh business approval. Deployment rollback, state rollback, and operational compensation remain distinct. Forward-only migrations disclose irreversibility and require tested repair. Old versions retire only after all consumers, Runs, evidence, and recovery references close.

Prototype: [Compatibility Migration And Rollback](../prototypes/compatibility-migration-and-rollback.md)
