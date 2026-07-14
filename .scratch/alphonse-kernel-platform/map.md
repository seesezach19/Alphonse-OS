# Define Alphonse Kernel And Its Agent-Native Builder Model

Label: `wayfinder:map`

## Destination

A decision-complete specification for Alphonse Kernel's platform objective and agent-native building model, ready for `to-spec`. It must define what Kernel guarantees, what Builders control, how modular Operational Packages are constructed and composed, how replaceable intelligence interfaces with the system, and how the first decisive proof is evaluated.

## Notes

Planning only; implementation begins after `to-spec` and ticketing. Use `grill-with-docs` and domain modeling for human decisions. Treat `CONTEXT.md` and accepted ADRs as starting doctrine. Audit AIOS and ALPHONSE_DATA as evidence sources without importing their obsolete product boundaries.

Objective: enable human-agent teams to build, deploy, and evolve modular operational systems that understand customer context and perform accountable business work without bypassing customer authority.

First proof: an unfamiliar Builder and replaceable agent progress from a plain-language workflow to one active, accountable Operational Package in under one day without modifying Kernel internals.

## Decisions so far

- [Research Reusable AIOS And ALPHONSE_DATA Contracts](issues/01-research-reusable-contracts.md) - reuse tested invariants and transition behavior; replace workspace/provider/storage implementations and resolve cross-plane ownership through typed references.
- [Prototype The Minimum Kernel Object Graph](issues/02-prototype-minimum-kernel-object-graph.md) - Kernel owns immutable definitions, exact authority, and append-only operational truth; domain meaning, intelligence, payloads, secrets, telemetry, and UI remain outside through typed boundaries.
- [Define Operational Package And Deployment Plan Contracts](issues/03-define-operational-package-contracts.md) - packages and exports combine stable semantic identity with authoritative digests; exact resolved plans create staged Deployments while authority and typed revocation remain separate.
- [Define The Agent-Native Kernel Protocol](issues/04-define-agent-native-kernel-protocol.md) - a small discovery interface progressively generates bounded typed tools over canonical operations, structured outcomes, simulation receipts, and privacy-preserving event observation.
- [Define The Accountability And Execution Lifecycle](issues/05-define-accountability-execution-lifecycle.md) - one exact authority chain governs one Envelope and Run, every effect is gated, execution and accountability remain separate, and recovery/corrective work preserve original history.
- [Define The Kernel And Data Plane Context Contract](issues/06-define-context-contract.md) - Kernel grants bounded purpose-specific access while Data Plane independently authorizes and directly delivers signed authority/freshness-qualified context; Kernel retains payload-free receipts.
- [Prototype The First-Proof Builder Journey](issues/07-prototype-first-proof-builder-journey.md) - an unfamiliar Builder uses a versioned Builder Toolkit to create and hand off an inventory package, prove staging recovery, and complete one accountable production effect within explicit time and shortcut constraints.
- [Define Kernel Persistence And Projection Model](issues/08-define-kernel-persistence-and-projections.md) - PostgreSQL combines explicit lifecycle state, typed immutable transitions, registered atomic composition, idempotent receipts, and disposable projections under enforced Environment boundaries.
- [Define Hosted Coordination And Environment Promotion](issues/09-define-hosted-coordination-and-environment-promotion.md) - a replaceable hosted coordinator distributes signed proposals and visibility while customer Environments retain authority and promote exact Packages through local evidence gates.
- [Define Package Registry And Trust Distribution](issues/10-define-package-registry-and-trust-distribution.md) - immutable portable Packages combine publisher provenance and registry receipts with destination-controlled transitive trust, advisories, offline import, and transparency checkpoints.
- [Define Compatibility Migration And Rollback](issues/11-define-compatibility-migration-and-rollback.md) - exact compatibility reports, side-by-side Deployments, resumable migrations, pinned Runs, progressive activation, and honest compensation protect active user space.
- [Define Host Observation And Execution Substrate Adapter](issues/12-define-host-observation-and-substrate-adapter.md) - replaceable Linux adapters enforce exact workload identity, containment, fencing, dispatch permits, and signed observations without treating telemetry as business truth.
- [Define Butler Accountability Product](issues/13-define-butler-accountability-product.md) - exception-focused Accountable Work Threads make execution, obligations, evidence, recovery, and handoff understandable without granting Butler privileged authority.

## Not yet specified


## Out of scope

- Production implementation during this map.
- Domain-specific vertical products.
- Public untrusted executable packages in V1.
- Marketplace mechanics.
- Polished end-user interfaces beyond the minimum Butler V0 proof surface.
