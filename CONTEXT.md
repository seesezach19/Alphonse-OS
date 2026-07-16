# Alphonse Kernel Domain Context

Alphonse Kernel provides the governed foundation for building agentic operational software.

> Several displayed trust signals currently prove formatting or self-reporting rather than independently observed truth.

Every trust-bearing product label must identify whether it comes from structural validation, worker declaration,
fixture evaluation, or independent observation.

## Participants

**Builder**:
The primary user of Alphonse Kernel: a human, agent, or collaborating human-agent team that creates and maintains governed business-specific systems on the platform.
_Avoid_: Business Operator, platform internals specialist

**Business Operator**:
A person who uses, supervises, reviews, or intervenes in a business-specific system produced by a Builder without needing to understand Kernel internals.
_Avoid_: Builder, Kernel administrator

## Building

**Agent Workflow**:
A stable builder-owned identity for one repeatable operational objective implemented by one or more agents, deterministic workers, tools, and integrations. It organizes revisions, behavior, diagnostics, environments, and governance mappings but grants no authority.
_Avoid_: Agent, Agent Revision, Work Intent, Capability Contract

**Workflow Manifest**:
The repository-owned versioned declaration of one Agent Workflow's identity, revision inputs, diagnostic policy, verification fixtures, environment mappings, and optional Behavior Contracts and governance mappings. Imported manifests are immutable; secrets and runtime authority are excluded.
_Avoid_: Dashboard configuration, Operational Package, secret store, live authority state

**Operational Package**:
A versioned, composable unit produced by a Builder that declares some combination of business context, integrations, skills, evaluations, capabilities, policies, and operator views against stable Kernel contracts.
_Avoid_: Entire industry vertical, arbitrary plugin, mutable workspace

**Vertical**:
A business- or domain-specific system assembled from one or more Operational Packages and customer configuration. It emerges above the Kernel rather than existing as a Kernel primitive.
_Avoid_: Operational Package, hard-coded Kernel domain

**Builder Toolkit**:
A public, versioned, domain-neutral Operational Package of Skill Exports that helps agents grill decisions, model domains, produce specifications, prototype, author strong skills, implement bounded package work, and review results. Exact toolkit hashes are recorded in Agent Passport and Build Session; toolkit methods grant no authority.
_Avoid_: Hidden system prompt, inventory-specific scaffold, Kernel validator

**Builder Console**:
The human-oriented product surface for Agent Workflows, revisions, integrations, traces, Diagnostic Cases, Failure Specifications, reproduction, repair verification, and Repair Candidates. It uses public protocols and grants no privileged authority.
_Avoid_: Butler, Kernel administration console, authority source

**Executable Adapter**:
A versioned implementation referenced by an Operational Package and invoked through declared Kernel interfaces under bounded identity, context, credentials, resources, network access, effects, and evidence requirements.
_Avoid_: Installation script, unrestricted plugin, package authority

An Operational Package is declarative and inert during installation. It may reference Executable Adapters, but package installation cannot execute privileged code. Package versions are immutable.

Operational Packages may export Workflow Runtime Adapters and Repair Delivery Adapters together with configuration schemas, event mappings, revision fingerprint rules, redaction defaults, reproduction extraction rules, health checks, compatibility declarations, and contract tests. Adapter execution remains separately trusted and admitted.

## Platform Boundaries

**Data Plane**:
A customer-owned system that stores, develops, releases, and serves governed business context and operational observations through Kernel-compatible contracts. ALPHONSE_DATA is the reference implementation, not part of the Kernel.
_Avoid_: Kernel state, universal business database

The Data Plane is an optional companion for workflows whose reliability depends on governed context authority, freshness, typed relationships, or reproducible snapshots. Core diagnostic and governance value cannot require business-data ingestion or migration.

**Diagnostic Plane**:
A retention-controlled system that stores attributed agent traces, model and tool interactions, timing, errors, and debugging artifacts outside Kernel authority state. Its records are untrusted observations unless separately admitted as exact evidence.
_Avoid_: Kernel ledger, Data Plane, trusted evidence store, authority source

Diagnostic collection, raw storage, and Diagnostic Agent execution remain inside a customer-controlled boundary by default. Managed hosting must preserve equivalent per-customer isolation; hosted coordination receives only minimal metadata unless the customer explicitly authorizes redacted payload transfer.

**Diagnostic Profile**:
The versioned Alphonse semantic contract applied to provider-neutral telemetry, defining required attribution, revision, workflow, privacy, and correlation fields without making an external telemetry standard part of Kernel semantics.
_Avoid_: Kernel Protocol, provider trace schema, raw OTLP payload

**Diagnostic Protocol**:
The self-describing interaction contract for traces, Diagnostic Cases, reproductions, evaluations, and Repair Candidates. It grants no Kernel authority and keeps diagnostic claims distinct from governed execution truth.
_Avoid_: Kernel Protocol, raw telemetry query API, authority plane

**Agent Gateway**:
The agent-facing projection that composes bounded task operations from Kernel and Diagnostic Protocols without merging their semantics or authority. It is an ergonomic interface, not a system of record.
_Avoid_: Kernel Protocol, authority proxy, permanent tool catalog

**Alphonse Agent SDK**:
An optional thin, protocol-derived integration library for instrumenting Agent Workflows and invoking diagnostic and governed operations with correct revision, correlation, redaction, idempotency, and evidence semantics. It is not an agent framework or canonical protocol.
_Avoid_: ASDK, agent runtime, Kernel Protocol, required platform dependency

**Agent Revision**:
An immutable identity for the available code, model configuration, instructions, Skills, tools, dependencies, policies, and Package references that produced agent behavior. Secrets and live context payloads are excluded and referenced separately.
_Avoid_: Agent Passport, mutable agent configuration, deployment environment

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

**Diagnostic Agent**:
A replaceable Intelligence Plane agent with a separate identity and bounded workspace that investigates Diagnostic Cases, reproduces failures, and produces Failure Specifications and Reproduction Bundles. The affected customer agent may self-report but cannot adjudicate its own behavior or certify a fix.
_Avoid_: Kernel validator, original customer agent, autonomous approver

**Repair Worker**:
A replaceable customer-selected coding agent that receives an exact source revision and Reproduction Bundle in a bounded workspace and proposes a patch plus targeted regression artifact. It has a separate Agent Passport and cannot verify, approve, merge, deploy, or expand its own authority.
_Avoid_: Diagnostic Agent, affected customer agent, proprietary Alphonse coding model

**Repair Task**:
An immutable leased handoff binding a Diagnostic Case, Failure Specification, Reproduction Bundle, exact base revision, permitted workspace operations, resource limits, expected outputs, and expiry for one Repair Worker attempt.
_Avoid_: Work Intent, Repair Candidate, ambient coding-agent prompt

**Verification Runner**:
A deterministic system Principal that executes an exact Repair Candidate against its Reproduction Bundle and retained targeted regressions in a disposable substrate, then emits a signed Verification Receipt. It cannot alter the candidate or authorize promotion.
_Avoid_: Repair Worker, Diagnostic Agent, model evaluator, deployment authority

**Verification Receipt**:
An immutable signed result binding exact candidate, runner, fixtures, assertions, environment, outputs, and limitations. Passing establishes targeted repair eligibility but grants no promotion authority.
_Avoid_: Repair Candidate, broad agent certification, deployment approval

Diagnostic Agents may autonomously detect, correlate, reproduce, hypothesize, and commission bounded repair work. Source writes, sensitive access, material spending, deployment, Behavior Contract changes, and authority changes remain separately policy-gated or human-authorized.

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

Agent-facing and human-facing products invoke the same typed underlying operations. Agent-native operations expose schemas, preconditions, structured denials, exact references, idempotency, safe next operations, resumable cursors, and durable artifacts without depending on conversation history.

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

**External Activity Trace**:
An attributed, immutable Diagnostic Plane observation imported from an agent system that did not execute under Kernel admission. It supports diagnosis and migration into governance but proves neither enforcement nor external effect.
_Avoid_: Observed Run, Run, trusted evidence, retroactive governance

**Diagnostic Case**:
A builder-facing investigation that groups exact traces, Runs, revisions, hypotheses, reproductions, evaluations, and fix verification for one behavioral problem. It may propose changes but grants no authority and does not repair business consequences.
_Avoid_: Recovery Case, Accountable Work Thread, alert, mutable Run

**Diagnostic Trigger**:
An explicit human or agent failure report, structured runtime/tool failure, Kernel accountability or Effect state, or external business mismatch that initiates diagnosis. Model-detected anomaly alone may suggest review but cannot declare failure.
_Avoid_: Model confidence threshold, unexplained alert, inferred business failure

**Failure Specification**:
A Diagnostic Case-bound statement of demonstrated expected-versus-actual behavior, reproduction conditions, and targeted repair verification. It supports fixing one known problem without claiming to evaluate overall agent quality.
_Avoid_: Behavior Contract, general agent score, Accountability Contract

**Reproduction Bundle**:
An immutable Diagnostic Case artifact binding an exact Agent Revision, Failure Specification, redacted inputs, deterministic tool fixtures, environment assumptions, and integrity hashes for replay in an ephemeral workspace.
_Avoid_: Production payload archive, mutable test workspace, Operational Package

**Behavior Contract**:
An optional versioned declaration for builders who want proactive workflow monitoring against selected outcomes, invariants, prohibited behavior, or performance boundaries. It grants no authority and is not required for onboarding, diagnosis, or repair.
_Avoid_: Accountability Contract, Capability Contract, model rubric, authority policy

**Repair Candidate**:
A non-authoritative proposed change binding one Diagnostic Case and exact base Agent Revision to a candidate revision, expected behavior change, targeted verification plan, and verification results. It cannot mutate source, approve itself, or promote itself.
_Avoid_: Production fix, mutable agent configuration, Deployment Plan

**Repair Delivery Adapter**:
A versioned target-specific implementation of generic inspect, snapshot, candidate, execution, review, promotion, and rollback operations for a repair destination. It declares supported operations and translates without deciding repair validity or authority.
_Avoid_: Repair Worker, deployment authority, platform-specific core logic

**Repair Delivery Binding**:
The Workflow Manifest configuration binding a Repair Delivery Adapter version to an exact target reference, external credential binding, permitted operations, and transition policies. It contains no secrets and cannot grant operations unsupported by the adapter.
_Avoid_: Credential, Repair Candidate, ambient write access

**Workflow Runtime Adapter**:
A versioned external-substrate integration that describes workflow and revision identity, receives or retrieves execution observations, requests supported replay, and reports runtime health through typed contracts. It never defines Alphonse workflow semantics or reads an external runtime database directly.
_Avoid_: Repair Delivery Adapter, Kernel execution substrate, direct database integration

**Runtime Event Envelope**:
A provider-neutral signed observation from a Workflow Runtime Adapter binding exact adapter, workflow, revision, external execution, event identity and sequence, lifecycle claim, correlation, idempotency, timestamp, and payload digest or reference. Receipt preserves the claim but does not make it Kernel execution truth.
_Avoid_: Run transition, raw webhook payload, trusted external effect evidence

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

**Alphonse Node**:
The initial customer-controlled deployable product unit containing diagnostic intake and storage, Kernel authority services, Agent Gateway, Builder Console, diagnostic orchestration, bounded repair workspaces, metadata storage, and content-addressed artifacts. Its internal boundaries remain replaceable even when shipped as one Docker deployment.
_Avoid_: Kernel Environment, hosted control plane, Kubernetes cluster, monolithic semantic boundary

One Alphonse Node belongs to one customer trust boundary and may contain many Agent Workflows and multiple independently authoritative Kernel Environments. V1 does not share one Node database or authority domain across customers.

**Kernel Environment**:
One isolated, customer-controlled authority domain containing exact package deployments, identities, delegations, active capabilities, execution admission, run state, accountability, evidence, and recovery state. It may be hosted locally, in customer cloud, or as a managed deployment without changing its semantics.
_Avoid_: Shared cross-customer authority domain, package, physical machine

Packages may be promoted between Kernel Environments, but authority and active state remain local to each environment. Hosted coordination services cannot become hidden authority.

**Execution Substrate**:
The environment-specific implementation that contains workloads, exposes bounded host observations, supplies task context, and executes admitted operations. Linux is the reference Execution Substrate, but it does not define Kernel semantics.
_Avoid_: Kernel Environment, business authority, Operational Package
