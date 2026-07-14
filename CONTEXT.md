# Alphonse Kernel Domain Context

Alphonse Kernel provides the governed foundation for building agentic operational software.

## Participants

**Builder**:
The primary user of Alphonse Kernel: a human, agent, or collaborating human-agent team that creates and maintains governed business-specific systems on the platform.
_Avoid_: Business Operator, platform internals specialist

**Business Operator**:
A person who uses, supervises, reviews, or intervenes in a business-specific system produced by a Builder without needing to understand Kernel internals.
_Avoid_: Builder, Kernel administrator

## Building

**Operational Package**:
A versioned, composable unit produced by a Builder that declares some combination of business context, integrations, skills, evaluations, capabilities, policies, and operator views against stable Kernel contracts.
_Avoid_: Entire industry vertical, arbitrary plugin, mutable workspace

**Vertical**:
A business- or domain-specific system assembled from one or more Operational Packages and customer configuration. It emerges above the Kernel rather than existing as a Kernel primitive.
_Avoid_: Operational Package, hard-coded Kernel domain

**Builder Toolkit**:
A public, versioned, domain-neutral Operational Package of Skill Exports that helps agents grill decisions, model domains, produce specifications, prototype, author strong skills, implement bounded package work, and review results. Exact toolkit hashes are recorded in Agent Passport and Build Session; toolkit methods grant no authority.
_Avoid_: Hidden system prompt, inventory-specific scaffold, Kernel validator

**Executable Adapter**:
A versioned implementation referenced by an Operational Package and invoked through declared Kernel interfaces under bounded identity, context, credentials, resources, network access, effects, and evidence requirements.
_Avoid_: Installation script, unrestricted plugin, package authority

An Operational Package is declarative and inert during installation. It may reference Executable Adapters, but package installation cannot execute privileged code. Package versions are immutable.

## Platform Boundaries

**Data Plane**:
A customer-owned system that stores, develops, releases, and serves governed business context and operational observations through Kernel-compatible contracts. ALPHONSE_DATA is the reference implementation, not part of the Kernel.
_Avoid_: Kernel state, universal business database

**Context Contract**:
The stable interface through which the Kernel identifies and requests exact, scoped, authority- and freshness-aware context without owning its storage or domain model.
_Avoid_: Context payload, database schema, unrestricted retrieval

Context payload flows directly from Data Plane to the authorized agent/runtime by default under a short-lived Kernel token. Kernel stores the signed delivery receipt only; an optional non-persistent streaming proxy supports runtimes that cannot call Data Plane directly.

Effective context access is the strict intersection of Kernel Context Access Grant and Data Plane disclosure policy. Either plane may deny; neither may override the other.

Context Access Grants are read-only. Context proposal, correction, and publication use separate typed capability operations: Kernel governs request authority, Data Plane independently enforces source/publication policy and stores payload/state, and Kernel retains only signed transition receipts and references.

**Intelligence Plane**:
Replaceable user-space agents that interpret context, interview people, propose packages and abstractions, evaluate behavior, assist operations, diagnose failures, and propose improvements through Kernel contracts.
_Avoid_: Authority Plane, embedded Kernel model, autonomous approval

Intelligence may propose changes but cannot approve itself, activate authority, bypass state transitions, or rewrite evidence and history.

**Kernel Protocol**:
The canonical self-describing interaction contract through which humans, agents, and tools progressively discover objects and operations, inspect state, propose changes, validate, simulate, submit transitions, and observe results.
_Avoid_: MCP server, HTTP API, direct database access

**Operation Descriptor**:
A versioned Kernel Protocol resource declaring one typed operation's schemas, authority and effect class, preconditions, supported modes, idempotency, outcomes, issues, emitted events, and possible next operations.
_Avoid_: Provider tool definition, implementation function, untyped execute command

**Task Tool Projection**:
A bounded transport-specific set of typed operations generated from Operation Descriptors for one agent task. Agents retain a small discovery interface and may progressively request additional relevant operations.
_Avoid_: Entire Kernel tool catalog, canonical protocol, permanent agent authority

**Operation Visibility Policy**:
The rule determining whether an Operation Descriptor is public, visible within an authorized role or scope, or hidden because its existence would disclose sensitive capability or state. Visible operations expose safe availability and blocking information without granting invocation authority.
_Avoid_: Capability authority, security through obscurity, unrestricted catalog disclosure

**Proposal Metadata**:
The shared attribution and integrity contract embedded by every typed proposal, including proposal kind and schema, Principal, Work Intent, exact base references, payload digest, evidence references, and timestamps. It is not a generic proposal payload or lifecycle object.
_Avoid_: Untyped proposal table, domain state machine, mutable payload wrapper

**Simulation Receipt**:
An immutable result declaring whether simulation was deterministic against exact fixtures or snapshots, or observational through authorized live read-only adapters, together with assumptions, fidelity, exact references, Context Receipts, and validator/runtime versions. It grants no authority.
_Avoid_: Execution Envelope, production evidence, effectful dry run

MCP, CLI, SDK, and HTTP surfaces adapt the Kernel Protocol without defining its semantics.

## Agent Identity And Authority

**Principal**:
The stable typed attribution root for a human, agent, or deterministic system recognized by one Kernel Environment. A Principal identifies who or what participated but grants no role, delegation, access, approval, or execution authority.
_Avoid_: Permission, Agent Passport, external login account

**Agent Passport**:
A versioned identity document binding an agent Principal to its sponsor, runtime, model, exact package and skill configuration, environment identity, permitted intent classes, provenance, and validity window. It proves what the agent is; it grants no business authority.
_Avoid_: Capability, delegation, work request

Run failure or cancellation does not automatically suspend an Agent Passport. Repeated failures create supervisory review; only predeclared hard safety violations may trigger an immediate temporary hold, while suspension and revocation remain separate authority decisions.

**Work Intent**:
The exact objective, requested outcome, scope, and constraints explaining why an agent is acting now. Every meaningful agent request binds one Work Intent alongside the Agent Passport.
_Avoid_: Agent identity, permission, low-level action

Conversation may support a proposed Work Intent but cannot silently activate or mutate it. A human explicitly confirms or updates the compact Work Intent artifact before customer context access or effects; provisional intent permits public discovery only.

**Runtime Handoff**:
A governed transfer of active work to a target runtime through an explicit user command, binding exact Work Intent, Package and Skill Exports, context receipts, ledger cursor, and unresolved obligations. Target acceptance creates a signed receipt and closes source task authority in exclusive-transfer mode.
_Avoid_: Conversation copy, shared hidden memory, implicit agent replacement

Agent identity, Work Intent, delegation, capability authority, and execution admission remain separate and independently inspectable.

## Construction Lifecycle

**Build Session**:
A bounded Kernel record attributing package construction to exact Principals and Work Intent, base versions, Context Access Grants, validation history, candidate hash, and expiry without storing mutable draft contents.
_Avoid_: Build Workspace, Operational Package, deployment

**Build Workspace**:
The disposable user-space contents in which Builders and agents create drafts, notes, intermediate generations, and failed experiments during a Build Session.
_Avoid_: Kernel authority state, Package Version, durable business context

**Package Version**:
A published Operational Package identified by stable package ID, mandatory semantic version, and authoritative content and dependency digests. One package ID and semantic version can identify only one digest forever.
_Avoid_: Build Session draft, mutable package, active deployment

**Package Publication Attestation**:
The Kernel Environment signature binding a Package Version's identity, digest, publisher Principal, validator version, and publication time. Local publication receives this automatically; cross-environment import additionally requires a signature trusted by the destination Environment.
_Avoid_: Business approval, Capability Activation, Builder-managed signing ceremony

**Package Advisory**:
An immutable environment decision about one exact Package Version: `deprecated` provides guidance, `policy_blocked` prevents new plans or activations, and `security_compromised` additionally blocks new execution admission and quarantines affected Deployments. It never mutates or deletes package or operational history.
_Avoid_: Package Version status field, silent uninstall, erased deployment

**Skill Export**:
An immutable Package Version export defining one reusable method, its exact instructions and steps, context requirements, typed inputs and outputs, uncertainty behavior, and evaluation contract. It has a stable export ID, explicit semantic contract version, and authoritative digest; Kernel gives it no independent authority lifecycle.
_Avoid_: Mutable prompt, Capability Contract, permanent verification status

**Deployment Plan**:
An immutable, validated composition of exact Package Versions, dependency hashes, customer configuration, and explicit extension bindings proposed for activation in one environment.
_Avoid_: Package Version, mutable dependency resolution, active deployment

**Deployment**:
An exact Package Version composition and customer configuration installed in one Kernel Environment. A Deployment may be staged without granting any capability business authority.
_Avoid_: Deployment Plan, Capability Activation, running process

**Capability Activation**:
The environment-local authority record identifying one exact Capability Contract export from one exact Deployment as active for business use. It does not authorize an arbitrary run.
_Avoid_: Deployment, business approval, Execution Envelope

Package composition uses namespaced exports and declared extension points. Conflicting definitions fail validation; installation order or ambient priority never resolves them. Upgrades create new Deployment Plans and cannot silently alter active behavior.

## Accountability

**Kernel Authority Services**:
The deterministic Kernel functions that own agent identity bindings, delegation, capability review and activation, execution admission, run state, evidence obligations, and recovery state.
_Avoid_: Butler, agent judgment, interaction surface

**Butler**:
The first-party supervisory product that uses Kernel records to help Business Operators hold agents accountable, identify incomplete obligations or failures, coordinate escalation and recovery, and understand whether delegated work was completed properly.
_Avoid_: Authority source, second control plane, autonomous approver

Butler assigns corrective work only by proposing explicit Work Intents that proceed through ordinary delegation, capability, and execution admission. It has no privileged command path into agents or packages.

**Accountability Contract**:
The capability-bound declaration of expected outcomes, terminal states, deadlines, responsible actors, required evidence, failure conditions, escalation, retry and idempotency policy, and available recovery or compensation.
_Avoid_: Butler prompt, monitoring dashboard, implementation-specific log

An effectful capability cannot activate without a valid Accountability Contract.

**Context Access Grant**:
A bounded authorization linking an Agent Passport and Work Intent to permitted customer context subjects, relationships, sensitivity classes, purposes, and validity. It enables progressive governed retrieval without creating a full execution run for every read.
_Avoid_: Capability to create external effects, unrestricted workspace access, public metadata

**Context Receipt**:
An immutable Kernel record for one bounded context delivery under a Context Access Grant, binding the Data Plane, packet hash, item-level exact release or live-query references, authority and freshness claims, retrieval time, and recipient without storing the context payload. Large item manifests may remain external by exact hash.
_Avoid_: Context payload, Context Access Grant, Data Plane record

Data Plane may cache live source observations only under versioned source and authority policy. Cache access never resets source observation time or freshness; delivery discloses observation and cache age, while Kernel never caches payload.

**Context Advisory**:
A signed Data Plane notice that exact context is superseded, withdrawn, or compromised. New use is restricted by policy; pre-effect Runs may block, uncertain effects reconcile, and completed work may enter impact review or recovery through exact Context Receipt links without rewriting history.
_Avoid_: Deleted receipt, retroactive Run mutation, Kernel business judgment

Governance scales with consequence: public contracts are discoverable, customer context requires a Context Access Grant, sensitive or live reads may require explicit read capabilities, and external effects require full execution admission and evidence.

## Execution Records

**Execution Envelope**:
An immutable admission record binding one exact request to active capability authority, Agent Passport, Work Intent, delegation, context and credential references, effect limits, evidence requirements, recovery posture, expiry, and idempotency. One Envelope admits exactly one Run; it is not that Run and proves no effect occurred.
_Avoid_: Capability Activation, Run, execution result

**Run**:
The durable lifecycle container for one execution admitted by an exact Execution Envelope. Its execution status remains separate from the derived Accountability Projection in every interface.
_Avoid_: Execution Envelope, effect evidence, giant result blob

**Accountability Projection**:
The current derived assessment of whether a Run's exact obligations are open, satisfied, breached, under recovery, or accepted as loss. It is displayed alongside, never collapsed into, Run execution status.
_Avoid_: Run status, model confidence, single success boolean

**Effect Record**:
A first-class Run-linked aggregate with immutable identity and attempt facts, append-only status transitions, and a derived current projection for one external effect. Reconciliation may resolve uncertainty while permanently preserving that uncertainty occurred.
_Avoid_: Run status, model claim, implementation log

Every external effect is admitted by Kernel immediately before dispatch. Multiple effects may be batch-admitted only when each exact effect, target, idempotency key, and limit consumption is enumerated atomically; adapters never receive an ambient effect budget.

**Evidence Record**:
An immutable first-class record binding attributed evidence or its external reference and integrity hash to a Run, Effect Record, obligation, or recovery claim.
_Avoid_: Unverified model output, mutable attachment, Run result blob

**Operational Obligation**:
A Run-specific completion requirement derived from an Accountability Contract. Its current state is `open`, `satisfied`, `breached`, or `waived`; overdue is derived from its deadline, and waiver requires an exact human/environment authority decision permitted by the contract.
_Avoid_: Task list item, mutable reminder, Butler judgment

**Operational Escalation**:
An explicit request for human or governed agent intervention when an Operational Obligation, uncertain effect, or recovery decision cannot be resolved normally.
_Avoid_: Generic alert, context discrepancy, privileged Butler command

**Recovery Case**:
A separate governed lifecycle for addressing a breach, uncertain effect, or failed Run through planning, authorization, execution, and a terminal result of recovered, failed, or accepted loss. Accepted loss always requires an explicit human authority decision; recovery never rewrites original history.
_Avoid_: Run retry flag, erased failure, informal operator note

**Kernel Ledger Event**:
An immutable, minimal, secret-free record of one meaningful accepted Kernel transition, containing typed references, integrity hashes, sensitivity labels, and environment sequence without replacing the owning object's state machine.
_Avoid_: Raw payload archive, mutable activity log, universal domain event

**Event Projection**:
The reader-authorized view of a Kernel Ledger Event. It filters protected fields while disclosing that information was omitted, preserving canonical event immutability and scoped visibility.
_Avoid_: Mutated ledger event, unrestricted audit payload

## Deployment

**Kernel Environment**:
One isolated, customer-controlled authority domain containing exact package deployments, identities, delegations, active capabilities, execution admission, run state, accountability, evidence, and recovery state. It may be hosted locally, in customer cloud, or as a managed deployment without changing its semantics.
_Avoid_: Shared cross-customer authority domain, package, physical machine

Packages may be promoted between Kernel Environments, but authority and active state remain local to each environment. Hosted coordination services cannot become hidden authority.

**Execution Substrate**:
The environment-specific implementation that contains workloads, exposes bounded host observations, supplies task context, and executes admitted operations. Linux is the reference Execution Substrate, but it does not define Kernel semantics.
_Avoid_: Kernel Environment, business authority, Operational Package
