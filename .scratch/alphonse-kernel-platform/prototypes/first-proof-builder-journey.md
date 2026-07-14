# First-Proof Builder Journey Prototype

Status: rough HITL prototype

## Claim Under Test

An unfamiliar Builder and replaceable frontier agent can transform a plain-language business workflow into one active, accountable Operational Package in less than one working day without modifying Kernel internals, directly editing authority state, or relying on provider-specific hidden behavior.

## Reference Workflow Candidate

**Inventory discrepancy correction**:

```text
When storefront inventory conflicts with authoritative ERP inventory:
1. Retrieve exact live ERP and storefront observations.
2. Apply customer-defined availability/threshold policy.
3. Propose a bounded storefront correction.
4. Obtain required approval.
5. Apply one idempotent correction.
6. Verify the resulting storefront state.
7. Produce evidence and recover safely from uncertainty or failure.
```

Why this workflow:

- familiar enough to verify against reality
- source authority and freshness matter
- deterministic and model-judgment steps separate cleanly
- read and write adapters are understandable
- effect is bounded and reversible in ordinary cases
- duplicate, timeout, stale-data, partial-failure, and uncertain-effect tests are meaningful
- package components can later be reused in other inventory workflows

## Participants

### Builder

A technically capable person who understands the business workflow but has not read Kernel source code, internal database schemas, or implementation-specific state machinery.

### Builder Agent

A frontier agent receiving only:

- Kernel Protocol endpoint/transport
- Agent Passport and Work Intent
- relevant Data Plane binding
- package authoring workspace
- ordinary platform documentation discoverable through Kernel Protocol
- the Builder's plain-language workflow description

### Business Operator

The person authorized to confirm business rules, approve exact authority-bearing changes, and inspect outcomes.

### Runtime Agent

A different supported agent/runtime that receives the published package, exact Skill Export, context grant, and operation tools without inheriting Builder Agent conversation history.

## Builder Toolkit

The Builder Agent receives a public, versioned, domain-neutral Builder Toolkit package derived from Matt Pocock's skill workflow:

- grilling and domain modeling for unresolved decisions
- `grill-with-docs` for existing operational material
- `to-spec` for decision-complete package intent
- `prototype` for concrete contract/behavior tests
- `writing-great-skills` for Skill Export quality
- `implement` for bounded package/adapter work
- `code-review` for defect and risk review

Exact toolkit Skill Export hashes are recorded in Agent Passport and Build Session. Toolkit skills create proposals and artifacts; they grant no authority and do not replace Kernel validation. Inventory-specific prompts or artifacts are forbidden starting state.

## Allowed Starting State

The clock starts with:

- clean customer Kernel Environment running
- customer Data Plane running and bound
- test identities/Passports available
- external credentials already stored in approved credential provider and exposed only as references
- public versioned domain-neutral Builder Toolkit available through normal package/protocol discovery
- ERP and storefront test/staging endpoints reachable
- no inventory-specific Operational Package installed
- no inventory-specific Kernel code
- workflow available only as plain-language description and source-system access

Environment provisioning is tested separately; hiding a prebuilt inventory package or undeclared workflow scaffold invalidates the proof.

## Forbidden Shortcuts

- modifying Kernel source or database schema
- direct SQL/state edits
- manually inserting approval/activation/run/evidence records
- copying secrets into package, prompts, or Kernel
- provider-specific prompt instructions unavailable through package/protocol
- declaring success from agent output without effect/evidence verification
- prebuilding inventory-specific package artifacts before the clock
- resolving failure by deleting/restarting history

## Journey

### 1. Express Work

Builder provides the plain-language workflow, business objective, known systems, and constraints. Builder Agent proposes a compact Work Intent; Builder explicitly confirms or edits it before customer context access. The agent then opens Build Session.

Expected output:

- attributed Work Intent
- Build Session record
- explicit unresolved decisions rather than guessed policy

### 2. Discover Platform

Builder Agent uses the small Kernel Protocol bootstrap interface to discover relevant package, context, validation, simulation, deployment, review, and capability operations. Kernel creates a bounded Task Tool Projection.

Pass condition: no static inventory-specific tool list or internal API knowledge is supplied.

### 3. Discover Business Context

Builder Agent requests bounded context covering:

- ERP inventory authority
- storefront inventory representation
- freshness requirements
- availability threshold policy
- correction approval policy
- evidence and recovery expectations

Data Plane independently authorizes disclosure and delivers signed manifests. Kernel creates Context Receipts.

Builder resolves only decisions unsupported by governed context.

### 4. Construct Package

Inside user-space Build Workspace, Builder Agent authors:

- package manifest
- inventory observation schemas
- Skill Export separating interpretation and deterministic handoff
- evaluation suite and cases
- read capability for inventory comparison
- effectful capability for storefront correction
- Accountability Contract
- trusted adapter references/implementation
- configuration schema
- operator view declaration

Kernel Build Session records base versions, validation receipts, candidate hashes, and final candidate.

### 5. Validate And Correct

Builder Agent submits package candidate validation. Structured issue paths and suggested operations drive corrections until deterministic validation passes.

Required negative checks:

- secret material rejected
- missing authority/freshness rejected
- undeclared effect rejected
- missing idempotency/evidence/recovery rejected
- incompatible dependency/export rejected

### 6. Evaluate And Simulate

Run:

- deterministic historical/fixture evaluations
- stale ERP observation case
- conflicting source case
- duplicate correction case
- observational live read-only simulation
- effect simulation against test endpoint

Simulation Receipt declares exact inputs, fidelity, assumptions, runtime, and results. Simulation grants no authority.

### 7. Publish And Compose

Builder Agent publishes immutable Package Version. Kernel computes digests and publication attestation. Agent resolves exact Deployment Plan with dependency lock, extension bindings, redacted configuration, credential references, and staged capability candidates.

Technical reviewer approves exact plan. Kernel creates staged immutable Deployment.

### 8. Approve And Activate

Business Operator reviews exact authority-bearing change:

- source reads
- context scope
- storefront write target
- credential scopes
- effect count/value limits
- approval rule
- evidence obligations
- recovery options

Business approval binds exact plan/capability exports. Kernel activates exact correction capability separately from deployment.

### 9. Runtime Handoff

A user selects **Hand Off** and a target runtime. Kernel prepares exact Work Intent, Package and Skill Export references, Context Receipts, ledger cursor, and unresolved obligations. A different Runtime Agent accepts without Builder conversation history, receives a new Passport/delegation binding, and source task authority closes.

Pass condition: Runtime Agent operates from package/protocol/context only, proving knowledge is durable and provider-independent.

### 10. Prove Staging Failure Handling

In staging, inject timeout after dispatch so effect outcome is initially unknown.

Required behavior:

- Effect becomes uncertain
- duplicate retry blocked
- Operational Obligation breaches/opens reconciliation under policy
- Butler opens/explains escalation
- corrective Work Intent follows normal authority
- Recovery Case reconciles target state
- retry or compensation uses new Envelope/Run/Effect
- original uncertainty remains in history

### 11. Perform Controlled Production Effect

Only after staging success and failure recovery pass, Business Operator selects one low-risk reversible production discrepancy.

Kernel validates:

- Passport, Work Intent, Delegation
- active exact capability
- fresh Context Receipts
- credential revisions/scopes
- effect limits
- Accountability Contract
- idempotency

Kernel admits one Envelope and atomically creates one Run plus obligations. Exact storefront correction is gated immediately before dispatch. Runtime Agent records effect and verification evidence.

Expected projection:

```text
execution_status: succeeded
accountability_status: satisfied
```

### 12. Inspect Outcome

Business Operator can determine without reading logs/code:

- what Builder and agents proposed
- exact package/deployment/capability versions
- who reviewed/approved/activated
- exact context authority/freshness used
- what effect was admitted/attempted/completed
- evidence satisfying each obligation
- what failed and how recovery resolved it

## Clock

Target: under eight active hours from plain-language workflow to staging success and controlled production effect.

Track separately:

- total elapsed time
- active Builder time
- active Business Operator time
- agent/runtime time
- external waiting time
- environment/setup time before clock

Pausing for external approval or unavailable source is reported, not hidden.

## Required Human Decisions

Humans decide only:

1. unresolved business authority/policy
2. exact technical review
3. exact business approval
4. production effect selection/confirmation
5. any accepted-loss decision

Agents may prepare evidence and recommendations but cannot answer these for humans.

## Acceptance Scorecard

| Measure | Pass |
|---|---|
| Active build-to-effect time | < 8 hours |
| Kernel source/schema changes | 0 |
| Direct authority/database edits | 0 |
| Secret material entering package/Kernel | 0 |
| Provider-specific hidden instructions | 0 |
| Package validation requirements | 100% passed |
| Required deterministic/eval cases | 100% passed |
| Runtime handoff without conversation history | successful |
| Exact authority chain for effect | complete |
| Required evidence obligations | satisfied |
| Duplicate uncertain effect | prevented |
| Injected failure | reconciled/recovered with history intact |
| Business Operator can explain outcome from projections | yes |

Failure of any authority, evidence, idempotency, runtime-handoff, or recovery requirement fails the proof even if the storefront value changes correctly.

## Decisions During Prototype

- Inventory discrepancy correction is the reference workflow because it exercises real authority, freshness, deterministic/model boundaries, bounded effects, evidence, and recovery without making inventory a Kernel primitive.
- The qualifying proof requires one explicitly approved low-risk reversible production effect after staging succeeds; staging alone is an engineering proof, not the complete business-operation proof.
- The eight-hour clock excludes generic environment, identity, and external credential provisioning but includes every workflow-specific model, adapter, package, configuration, evaluation, review, deployment, and effect step. Excluded setup time is reported separately and no workflow-specific scaffold may be hidden before the clock.
- Zach may run the engineering rehearsal, but qualifying product proof requires a technically capable workflow-aware Builder who has not read Kernel source/internal schemas or previously built an Operational Package and receives only public protocol/documentation plus agent assistance.
- Qualifying proof requires explicit one-button exclusive Runtime Handoff to a different runtime surface with no conversation history or hidden memory. Same model is initially acceptable; exact artifacts and Kernel state provide continuity.
- Conversation may propose Work Intent, but the Builder must explicitly confirm or edit the compact artifact before customer context access or effects. Provisional intent permits public discovery only.
- Human questions have no arbitrary count cap, but each must resolve an explicit blocker, include a recommendation, and never repeat settled information. Qualifying proof targets less than two hours total human active time within less than eight hours active end-to-end work.
- Failure injection, reconciliation, and recovery must pass in staging before the Business Operator authorizes the low-risk production effect.
- The qualifying Builder Agent uses a public versioned domain-neutral Builder Toolkit derived from Matt Pocock's workflow. Exact skill hashes are recorded; toolkit skills propose artifacts but grant no authority or bypass Kernel validation.

## Prototype Outcome

The qualifying proof is a falsifiable one-day test: an unfamiliar Builder, assisted by explicit versioned construction skills, begins with only a plain-language inventory correction workflow and generic running infrastructure; builds, validates, evaluates, publishes, deploys, approves, activates, hands off, fails safely in staging, and completes one controlled production effect with exact evidence. No Kernel change, hidden prompt state, direct authority edit, secret copying, or erased failure is permitted.
