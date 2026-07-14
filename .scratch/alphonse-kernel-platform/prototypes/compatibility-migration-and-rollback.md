# Compatibility Migration And Rollback

Status: rough HITL prototype

## Claim

Builders can upgrade Packages and Deployments without silently breaking active user space when compatibility is machine-described, migrations are explicit lifecycle work, old and new versions coexist, active Runs remain pinned, and rollback is never confused with reversal of real-world effects.

## Compatibility Dimensions

Compatibility is evaluated independently across:

- Kernel Protocol features
- dependencies and exported contracts
- Capability input/output schemas
- configuration schema
- Package-owned operational state schema
- adapter interfaces
- Context and Data Plane contracts
- Skills and operator views
- authority, evidence, and recovery semantics

Semantic version communicates publisher intent. Exact machine-readable contract differences govern behavior.

Each dimension classifies as:

- compatible in place
- migration required
- parallel major version required
- unsupported

## Export Compatibility Contract

Every exported contract declares:

- stable export identity
- schema and behavior version
- unknown-field handling
- open or closed enum handling
- outcome/error compatibility
- behavioral invariants
- effect and idempotency semantics
- authority/evidence semantics
- deprecation window

Default rules:

- additive optional fields are compatible
- removal, rename, or type change is breaking
- tightened input constraints are breaking
- new enum values are breaking unless enum is explicitly open
- changed effect/idempotency semantics are breaking
- changed authority, evidence, or recovery requirements are breaking

Breaking exports install beside old major versions. Existing consumers remain pinned until explicitly migrated.

## Compatibility Report

Kernel computes an immutable report binding:

- exact current and target Package/Deployment digests
- every changed contract and dimension
- consumer/dependency impact
- migration requirements
- trust/advisory state
- active Run impact
- requested authority differences
- supported activation and rollback strategies

An unresolved incompatible dimension prevents target eligibility.

## Upgrade Plan

Kernel resolves an immutable Upgrade Plan containing:

- exact current and target Deployments
- dependency and contract diff
- configuration changes
- ordered migration graph
- affected Capabilities and consumers
- in-flight Run handling
- staging/evaluation requirements
- activation and cohort strategy
- verification window
- rollback or forward-repair path
- retirement conditions

Target Deployment builds beside the active version. Production remains unchanged until an explicit activation transition.

## Migration Declaration

Each migration is an immutable Package artifact declaring:

- source and target versions/digests
- exact state/configuration scope
- preconditions
- deterministic transformation
- idempotency and resume behavior
- checkpoints
- resource/time bounds
- verification conditions
- reversibility classification
- rollback or forward-repair plan

Kernel-owned storage migration cannot perform external effects. Business-data or external-system migration uses normal Capabilities, Runs, Effects, evidence, and recovery.

## State Migration Run

Package state migration is explicit work:

- Kernel authorizes and records lifecycle, checkpoints, receipts, and cutover.
- Owning Data Plane or user-space component transforms payloads.
- Kernel does not ingest business state.
- Source state remains readable during rollback window.
- Target state builds separately where practical.
- Large transformations checkpoint and resume.
- Verification compares counts, hashes, invariants, and representative reads.
- Atomic pointer/Capability switch performs cutover.
- External writes remain declared Effects.

Migration failure before cutover leaves old Deployment active.

## Migration Verification

Every migration declares machine-checkable acceptance criteria:

- source coverage
- transformed-record counts
- invariant checks
- reference integrity
- deterministic sample comparisons
- old/new compatibility reads
- performance and resource bounds
- zero undeclared Effects
- successful resume after injected interruption

Staging uses production-shaped fixtures or privacy-preserving snapshots. Production cutover requires a signed Migration Receipt satisfying all criteria.

## In-Flight Runs

- Every Run remains pinned to original Deployment, Package, Skill, Capability, and adapter versions.
- New activation changes only new admissions.
- Old artifacts remain available until pinned Runs and recovery obligations close.
- Active Runs never silently migrate.
- Unsafe versions may be paused only through explicit local policy.
- Checkpoint migration creates a new Run/handoff with preserved lineage.
- Original Accountability Contract continues governing evidence obligations.

This prevents half-old, half-new execution.

## Upgrade Lifecycle

Normal phases:

planned -> validated -> staged -> migrating -> verified -> canary -> active

Failure is phase-specific:

- pre-cutover failure leaves old Deployment active
- migration interruption resumes from checkpoint
- verification failure leaves target ineligible
- canary failure stops new target admissions
- post-cutover compatible failure may allow Deployment rollback
- post-cutover incompatible state/effects require forward repair or compensation

Every retry is a new attempt linked to original history.

## Progressive Activation

Target activates through deterministic cohorts based on exact:

- Principals
- Work Intent classes
- subjects
- customer-defined routing keys
- reproducible percentage cohorts

Canary uses stricter effect limits and evidence requirements. Old and new versions coexist. Promotion expands only after verification window.

Failed health/evidence gates pause target admissions. Uncertain Effects trigger reconciliation, not automatic rollback. Final cutover waits for old-version obligations and compatibility conditions.

## Authority Equivalence

Kernel computes an Authority Equivalence Receipt comparing:

- effect scope and limits
- context access
- credential bindings
- approval requirements
- evidence obligations
- recovery requirements
- actor/delegation constraints

Exact target activation is always recorded.

Customer policy may preauthorize activation when authority digest is unchanged and technical gates pass. Any authority difference requires fresh business approval.

## Rollback Semantics

Three operations remain distinct:

### Deployment Rollback

Activate a previously verified exact Deployment.

### State Rollback

Restore or switch state only before declared compatibility boundary and after verification.

### Operational Compensation

Reconcile or compensate external effects using new Runs and Effects.

Rollback is a new authority transition, never deletion of upgrade history. Prior version must still satisfy current trust/security policy.

Completed real-world effects are never described as rolled back. Post-cutover incompatible writes generally require forward repair.

## Reversibility Classification

Every upgrade is:

- **Reversible**: deterministic rollback verified
- **Conditionally reversible**: safe only before stated cutover condition
- **Forward-only**: rollback would corrupt state or misrepresent external reality

Forward-only upgrade requires:

- explicit operator warning and approval
- verified backup/checkpoint
- tested forward-repair Capability
- stronger staging evidence
- maintenance/recovery plan
- no misleading rollback control

## Old-Version Retirement

Old versions remain available until:

- dependent Deployments migrate or explicitly accept incompatibility
- no active Runs remain pinned
- no evidence/recovery obligations require old artifacts
- deprecation window expires
- operator reviews impact report
- exact retirement transition is approved

Retirement blocks new admissions but preserves artifacts/history for replay and audit. Garbage collection follows retention after references close.

## Kernel Upgrade Compatibility

- Package declares required Kernel Protocol features, not only minimum version.
- Kernel upgrade preflights installed Deployments and active Runs.
- Unsupported active contracts block upgrade.
- Storage migration uses expand, backfill, verify, contract.
- Kernel reads old/new record formats during transition.
- Runtime workers remain pinned independently from control-plane version.
- Breaking protocol removal requires completed consumer migration and explicit Environment upgrade.
- Hosted coordination may advise; customer controls timing.

## Required Invariants

1. Semantic version never substitutes for exact compatibility analysis.
2. Existing consumers remain pinned until explicit migration.
3. Target Deployment cannot change production before activation.
4. Active Runs never silently change versions.
5. Business payload migration remains outside Kernel storage.
6. External effects never hide inside installation migration.
7. Rollback never erases upgrade history.
8. Real-world effects use compensation/reconciliation, not false rollback.
9. Authority difference always requires fresh business approval.
10. Old artifacts remain while Runs, evidence, recovery, or retention reference them.
11. Forward-only upgrades disclose irreversibility before approval.
12. Breaking Kernel changes cannot silently break active Packages.

## First-Proof Checks

The inventory Package must demonstrate:

1. compatible policy-only update with unchanged authority
2. breaking schema change installing beside old version
3. active Run completing on original version during canary
4. interrupted migration resuming from checkpoint
5. failed verification leaving old Deployment active
6. deterministic canary cohort and pause
7. Authority Equivalence Receipt avoiding unnecessary business approval
8. changed effect scope requiring fresh approval
9. Deployment rollback before point of no return
10. external correction requiring compensation rather than rollback
11. old-version retirement blocked by unresolved obligation
12. Kernel upgrade blocked by unsupported active contract

## Prototype Outcome

Compatibility is an exact contract, not a version-number promise. Upgrade builds a target Deployment beside active user space, migrates state through explicit resumable work, proves behavior in staging and deterministic canaries, preserves version-pinned Runs, and activates only through local authority. Rollback changes software/state only where reality permits; irreversible effects use forward repair and compensation.
