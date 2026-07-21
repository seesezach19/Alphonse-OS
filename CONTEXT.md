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

**Coverage Onboarding**:
A durable Diagnostic Plane reverse-specification lifecycle for one exact external workflow selection or behavior-bearing revision change. It binds discovered source evidence, agent interpretation, unresolved ambiguity, human review, deterministic compilation, validation, and resulting registration references without granting workflow, repair, verification, promotion, or external-effect authority.
_Avoid_: Diagnostic Case, Build Session, workflow builder, mutable chat state

**Workflow Discovery Snapshot**:
An immutable content-addressed Coverage Onboarding artifact containing the exact provider workflow material and metadata returned by scoped Workflow Runtime Adapter reads, together with source, adapter, retrieval time, omissions, redaction, and digest provenance. It contains observations, not agent conclusions, and grants no coverage or authority.
_Avoid_: Workflow Manifest, Agent Revision, inventory cache, interpretation

**Workflow Interpretation Claim**:
An immutable agent proposal about one exact Workflow Discovery Snapshot whose items distinguish observed facts, inferences, conflicts, and unknowns and cite exact evidence. Human confirmation is a separate record and can never be authored or implied by the agent claim.
_Avoid_: Diagnostic Proposal, observed fact, Behavior Contract, human approval

**Coverage Ambiguity**:
A typed Coverage Onboarding item identifying one consequential question that evidence and deterministic rules cannot resolve. Blocking ambiguity prevents review approval or compilation; resolution is append-only and binds a named human, the exact ambiguity digest and chosen disposition, scope, rationale, and time. The resulting resolution digest is included in the later Coverage Review Bundle.
_Avoid_: Free-form TODO, model uncertainty score, silent default, Diagnostic Trigger

**Coverage Review Bundle**:
An immutable content-addressed artifact consolidating one exact workflow objective, consequences, evidence-linked claims, ambiguity dispositions, Effect Inventory, limitations, redaction, optional contracts, fixtures, repair and verification bindings, promotion conditions, and rollback assumptions for human review.
_Avoid_: Workflow Manifest, mutable form, approval record, chat summary

**Coverage Review Approval**:
A Kernel authority record binding one named human Principal to one exact Coverage Review Bundle digest, scope, rationale, and validity. It permits deterministic compilation of that exact reviewed meaning only; source-control proposal, merge, manifest import, registration, activation, workflow execution, repair, verification, promotion, credential, and external-effect authority remain separate.
_Avoid_: Work Intent confirmation, Capability Activation, deployment approval, blanket sign-off

**Coverage Specification**:
An immutable deterministic compilation artifact derived from one approved Coverage Review Bundle. It contains rigid workflow identity, revision closure, evidence policy, Effect Inventory, capability prerequisites, limitations, redaction, fixtures, adapter bindings, and optional contracts but no secrets or live authority. It is an intermediate output of the deterministic compilation pipeline and remains distinct from the emitted Workflow Manifest proposal.
_Avoid_: Workflow Manifest, agent prose, approval record, active coverage state

**Coverage Validation Receipt**:
An immutable deterministic result binding one exact Coverage Specification, compiler and validator identities, checks, issues, limitations, and exact Workflow Manifest proposal digest. A passing result permits the exact proposal to be offered to a separately authorized source-control path; only a later immutable import of the landed repository revision can make onboarding registration eligible. It grants no source-control, registration, activation, execution, repair, verification, or promotion authority.
_Avoid_: Coverage Review Approval, Package Validation Receipt, readiness projection, success claim

**Coverage Profile**:
A versioned Operational Package export containing explicitly scoped reusable onboarding defaults such as approved integration semantics, consequence classifications, redaction policy, fixture strategies, and verification strategies. Reuse records the exact profile version and never carries human confirmation beyond its declared scope.
_Avoid_: Customer credential, mutable agency settings, universal approval, active policy

**Effect Inventory**:
The Coverage Specification section enumerating consequential external operations with destination, operation, data class, reversibility, retry and idempotency behavior, expected response, available evidence basis, optional reconciliation, and remaining uncertainty. It declares possible effects and evidence limits; it does not prove an effect occurred.
_Avoid_: Diagnostic Effect Projection, Effect Record, destination observer, workflow node list

**Workflow Coverage Capability Projection**:
A deterministic read model deriving independently evidenced workflow capabilities and limitations for `discovered`, `connected`, `revision_bound`, `execution_observed`, `diagnosable`, `behavior_monitored`, `repair_bound`, `verification_ready`, and `promotion_ready`. It grants no authority and is not a lifecycle ladder.
_Avoid_: Coverage stage, Capability Activation, overall health score, mutable checklist

**Accountable Coverage Claim**:
A time-bounded commercial projection over one exact Workflow Coverage Capability Projection, coverage policy version, evidence cutoff, limitations, and any historical gap. It never means universal correctness and cannot hide unavailable capabilities or unknown destination state.
_Avoid_: Capability stage, SLA by implication, certification, current-health boolean

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
A retention-controlled private system that stores attributed agent traces, model and tool interactions, timing,
errors, and debugging artifacts outside Kernel authority state. Public customer traffic terminates at adapters;
observation intake, role-scoped reads, and pipeline administration use separately authorized private network
surfaces. Network trust never replaces signed reporting identity. Its records are untrusted observations unless
separately admitted as exact evidence.
_Avoid_: Kernel ledger, Data Plane, trusted evidence store, authority source

Adapters report observations to the Diagnostic Plane. First-party deterministic Diagnostic Services preserve,
correlate, and package them. Kernel Authority Services grant reporting authority and reference immutable
diagnostic evidence when adjudicating governed actions; they do not absorb diagnostic observations into
authority state.

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

**Diagnostic Assignment**:
An immutable request for one bounded diagnostic attempt against one exact Diagnostic Evidence Package,
instruction and output contract, worker eligibility class, isolation and mount policy, network and capability
limits, resources, and expiry. It describes required authority but grants none; retry creates a linked new
assignment, and an assignment never returns to `unclaimed` after claim.
_Avoid_: Mutable queue item, Agent Passport, worker run, ambient diagnostic access

**Diagnostic Dispatch Authorization**:
A short-lived single-use Kernel authority record permitting one dispatcher and runner audience to claim one exact
unclaimed Diagnostic Assignment for one proposed Worker Run, worker Principal and Passport, package, model and
broker policy, image and isolation configuration, data classification, egress destination, resource ceilings, and
validity window. It stores Diagnostic Plane references and digests rather than evidence bytes and grants no external
business-effect authority.
_Avoid_: Diagnostic Assignment, reusable runner token, model credential, worker Passport

**Diagnostic Worker Run**:
One isolated execution of a claimed Diagnostic Assignment by an eligible worker Principal. It binds exact
worker, Passport, model, runtime, container, workspace, mount, policy, and output provenance without changing
the assignment or package.
_Avoid_: Diagnostic Assignment, reusable workspace, diagnosis artifact

**Model Broker**:
A customer-controlled service that exchanges a short-lived Worker Run-bound grant for narrowly permitted model
requests while retaining provider credentials outside the worker container. It enforces model, configuration,
budget, expiry, audience, network, and evidence-classification limits and grants no Kernel or business authority.
_Avoid_: Provider credential mount, general network proxy, Kernel credential, ambient Codex login profile

**Diagnostic Reevaluation Notice**:
An immutable record that a materially changed evidence package may affect prior assignments or diagnoses. It
does not launch a worker unless an exact deployed policy or governed request separately authorizes reevaluation.
_Avoid_: Silent diagnosis replacement, automatic mutable retry, current-result pointer

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

**Observation Reporting Grant**:
A revocable Kernel authority record permitting one deterministic Principal and dedicated signing key to report
specific observation types for an exact installation, environment, adapter binding, workflow or integration,
and stream within bounded time, rate, and payload limits. Acceptance proves reporting authorization for exact
bytes, not truthfulness. Historical receipts retain their original grant and key attribution after revocation
or rotation. V1 HMAC verification provides observer-specific authenticated attribution but not exclusive authorship,
because the verification key holder can also sign; controller exclusion from key custody is proven separately.
_Avoid_: Shared adapter credential, evidence truth, Integration Behavior Contract, ambient telemetry access

**Observation Grant Activation Snapshot**:
A signed immutable Kernel authority export containing the exact active or revoked Observation Reporting Grant
identities, digests, key references, scopes, validity, authority sequence, and freshness limit required by Diagnostic
Plane intake. Diagnostic Plane consumes it through a one-way authority feed and never reads the general authority
database; stale or missing grant state fails intake closed.
_Avoid_: General Kernel database access, observer secret, mutable permission cache, evidence receipt

**Observation Grant Application Receipt**:
A signed immutable Diagnostic Plane record proving one exact Observation Grant Activation Snapshot was durably
applied at a local authority sequence and first-party time. Grant activation or revocation becomes effective at that
application transaction; Kernel records the effective state only after verifying this receipt, and deployment sealing
waits for it.
Diagnostic Plane submits the exact signed receipt through Kernel's private grant-application receipt endpoint.
Kernel validates service identity, signature, snapshot, authority sequence, predecessor, target state, and service
transaction identity before preserving the receipt bytes.
_Avoid_: Reporting Grant, observation receipt, publication acknowledgement without durable application

**Observation Stream**:
The ordered emission namespace of one observer under an Observation Reporting Grant. Sequence establishes
only emission order within that stream; it establishes neither cross-stream time, causality, nor completeness.
Redeployment or reset creates a new stream identity rather than silently restarting sequence.
_Avoid_: Global event order, causal graph, complete source history

**Observation Journal**:
A customer-side durable adapter log that commits source identity mapping, logical operation, delivery attempt,
redacted claims and digests, and pending forwarding state before customer delivery. Independent forwarder and
reporter loops consume it, so Diagnostic Plane outages degrade visible coverage without normally blocking
customer operations. Silent loss is prohibited.
_Avoid_: Diagnostic Plane receipt store, distributed transaction, transient retry queue, raw payload archive

**Test Orchestrator**:
A privileged one-shot acceptance-test Principal that registers exact inactive test material and grants, requests
readiness, waits for Workflow Attestation Binding, then requests activation, records the ordered Sealed Deployment
Manifest, relinquishes credentials, and exits before scenario stimulus. It has no observation, evidence-packaging,
assignment, or worker-output authority and no observer-key custody.
_Avoid_: Scenario controller, evidence author, long-lived test administrator

**Scenario Stimulus**:
A separate one-shot acceptance-test Principal permitted only to submit a bounded set of source requests to the
customer ingress endpoint. It reports no observations, receives no internal read authority, records only transport
responses, and is destroyed before verification begins. The ingress observer journals and reports the deliveries.
_Avoid_: Ingress observer, test controller, evidence fixture writer

**Acceptance Verifier**:
A read-only acceptance-test Principal that starts after Scenario Stimulus destruction and checks immutable
diagnostic artifacts, provenance, diagnoses, and hidden expected assertions without any path to author or mutate
tested system state. It may judge the proof but cannot participate in producing it.
_Avoid_: Diagnostic Packager, dispatcher, worker, controller-authored evidence

**Sealed Deployment Manifest**:
An immutable acceptance-test artifact binding the exact image, Deployment, contract, schema, normalizer,
projector, evaluator, and policy digests proven ready before the Test Orchestrator exits. It establishes the test
environment inputs but is not an observation or evidence package.
_Avoid_: Runtime observation, mutable readiness dashboard, post-execution revision binding

**Runtime Evidence Compatibility Translator**:
A deterministic versioned boundary that verifies a legacy runtime envelope and authentication context, maps only
signed or digest-committed material into canonical `runtime.execution` claims, and submits those claims through
canonical observation intake. It preserves the original protocol, envelope, authentication, translator, rules,
and limitation digests and never invents absent attestation or timing claims.
_Avoid_: Second runtime evidence store, lossy migration shim, inferred attestation, legacy truth source

**Diagnostic Consistency Test Policy**:
An exact deployed policy authorizing multiple independent Diagnostic Assignments over one frozen evidence package
for a preregistered repeatability experiment. It fixes the worker-visible inputs and runtime configuration, binds a
hidden structured rubric before dispatch, and evaluates each immutable diagnosis independently without synthesizing
or majority-rewriting the results.
_Avoid_: Production retry policy, consensus diagnosis, prose equality test, post-hoc scoring rubric

**Diagnostic Mechanism Taxonomy**:
A neutral reusable worker-visible output vocabulary containing multiple mechanism categories, identity scopes,
evidence statuses, and implementation-location states applicable across diagnostic cases. It contains no
fixture-specific expected tuple; the exact expected structured diagnosis exists only in the preregistered hidden
rubric.
_Avoid_: Answer key, single-value enum, case-specific output schema, free-form replacement for citations

**Assignment-Creation Acceptance Proof**:
The deterministic first stage of the duplicate-delivery black-box acceptance test. After a Test Orchestrator seals
the environment and exits and Scenario Stimulus sends two bounded deliveries and exits, first-party services alone
must ingest, project, interpret, evaluate, trigger, package, and create one immutable unclaimed Diagnostic Assignment.
The read-only verifier confirms provenance and explicitly confirms that no worker, broker grant, or model request
exists.
_Avoid_: Diagnostic consistency test, model evaluation, controller-built evidence, database inspection

The first canonical-observation vertical proof is one customer-controlled Docker Compose installation using
Postgres, local filesystem CAS, private networks, unique observer HMAC keys and grants, n8n, a public local ingress
adapter, mock CRM commit ledger, five exact observation schemas, pre-execution revision binding, and one exact
projector, effect interpreter, evaluator, collection policy, package, assignment, dispatcher, isolated runner, and
Model Broker path. Hosted tenancy, remote observers, public evidence gateways, mTLS, asymmetric signing, batching,
SDK and MCP surfaces, generalized policy languages, arbitrary package code, additional providers, cryptographic host
attestation, and distributed CAS are deferred without removing their identity and protocol extension points.

**Diagnostic Stage Transition**:
An immutable, inbox-deduplicated record of one local deterministic pipeline stage loading exact inputs, computing an
identity and content digest, inserting or verifying one result, and committing its next outbox event. Lifecycle is
`pending`, `processing`, `succeeded`, `retryable_failed`, or `failed_transition`. Repeating one identity with different
content is a critical nondeterminism conflict and halts visibly.
_Avoid_: Distributed transaction, opaque dead-letter item, mutable job row, synchronous request chain

**Diagnostic Logical Component Author**:
The deterministic component provenance attached to a Diagnostic Plane stage output within the shared first-party
Stage Worker boundary. It binds component identity, version, artifact and rules digests, exact package and Deployment,
worker image, and input event and artifact digests. It is not represented as an independently enforced service
Principal when the same process can execute multiple components.
_Avoid_: Separate security principal, observer identity, Kernel authority, cosmetic microservice attribution

**Worker Run Configuration Digest**:
A semantic digest over all fixed inputs of a diagnostic consistency experiment, including package, instructions,
output schema, model claim, reasoning and sampling settings, limits, image, isolation, mount, broker, and tool
policies. Assignment, run, worker, ephemeral credential, and timestamp identities are excluded. Unverifiable model
snapshot or seed properties remain explicit limitations.
_Avoid_: Worker Run ID, provider reproducibility guarantee, diagnosis digest

**Artifact Retention Pin**:
A governed reference record preventing ordinary garbage collection of claims or permitted detail artifacts selected
by a Diagnostic Evidence Package through its applicable case, diagnosis, review, audit, or legal-hold retention.
Pins reference CAS objects rather than copying them and may be overridden only by an authorized security, privacy,
or legal erasure decision.
_Avoid_: Permanent storage guarantee, package copy, legal hold itself

**Diagnostic Artifact Tombstone**:
An immutable record left after governed artifact-byte erasure that preserves the digest, exact policy and decision,
reason, authorizing Principal, request and completion times, deletion verification, affected packages, and known
replica or provider limitations. It never rewrites the original receipt or package.
_Avoid_: Deleted receipt, proof all copies ceased to exist, mutable package manifest

**Evidence Material Availability Projection**:
A mutable rebuildable projection reporting whether an immutable Diagnostic Evidence Package is `complete`,
`partially_unavailable`, or `material_unavailable` after retention or governed erasure. Availability changes may
degrade reproducibility but never silently delete, rewrite, or rescore historical diagnoses.
_Avoid_: Package revision, evidence completeness at freeze, diagnosis validity

**Logical Operation Identity**:
A stable opaque customer-side identity for one intended operational act across distinct deliveries,
executions, requests, and destination resources. It is created at the earliest trustworthy boundary and
propagated unchanged across retries. Kernel may verify or report its absence but cannot invent it retroactively.
_Avoid_: Delivery ID, execution ID, inferred entity match, Kernel case ID

**Source Identity Token**:
A nonreversible versioned customer-side token representing equality of one stable source identity only within an
exact installation, environment, source binding, and identifier namespace. It is domain-separated across customers
and integrations, treated as pseudonymous sensitive metadata, and generated without exposing tokenization secrets
to observers. It supports deterministic redelivery mapping without disclosing the customer identifier.
_Avoid_: Bare identifier hash, anonymous data, global customer identity, cross-integration join key

**Exact-Value Equality Token**:
A pseudonymous token produced by a dedicated customer-side tokenization service over exact length-delimited bytes
within one customer, environment, integration, and comparison-purpose namespace. Narrow Tokenization Use Grants permit
tokenization only of designated fields and expose no secret or arbitrary oracle. Matching versioned tokens permit a
deterministic projection to establish equality or inequality without disclosing the original values.
_Avoid_: Raw idempotency key, general hashing API, normalized string comparison, cross-domain join key

**Tokenization Use Grant**:
A separate Kernel authority record permitting one exact observer Principal to ask one customer-side Tokenization
Service to tokenize only a designated field role under one integration, namespace, algorithm version, collection
window, byte limit, and rate limit. It grants no observation-reporting or arbitrary tokenization authority.
_Avoid_: Observation Reporting Grant, tokenization secret, general hashing endpoint, cross-domain correlation grant

**Tokenization Grant Activation Snapshot**:
A signed immutable Kernel authority export containing the exact desired active or revoked Tokenization Use Grant
state, service binding and verification identity, authority sequence, and freshness required by one Tokenization
Service. The service receives it through a dedicated one-way authority feed and never reads the Kernel database.
_Avoid_: Observation grant snapshot, tokenization secret, general authority cache

**Tokenization Grant Application Receipt**:
A signed immutable Tokenization Service record proving one exact Tokenization Grant Activation Snapshot was durably
applied. Tokenization activation or revocation becomes effective at this application transaction; Kernel records the
effective state only after verifying the receipt, and deployment sealing waits for it.
The Tokenization Service submits the exact signed receipt through Kernel's private grant-application receipt
endpoint under the same service-identity, signature, snapshot, ordering, target-state, and transaction checks.
_Avoid_: Tokenization Result Receipt, Tokenization Use Grant, best-effort configuration acknowledgement

**Tokenization Result Receipt**:
An immutable customer-side Tokenization Service record binding service and requester Principals, Tokenization Use
Grant, exact Grant Activation Snapshot and Grant Application Receipt, field role, namespace and version, result token,
timing, and bounded request provenance without retaining raw input or an unsalted digest of low-entropy material.
Observation claims cite its identity and digest.
_Avoid_: Raw identifier record, Diagnostic Observation Receipt, anonymous token, oracle log

The Tokenization Service signs every Tokenization Result Receipt with its registered asymmetric service identity and
submits the exact signed result receipt, Grant Activation Snapshot, and Grant Application Receipt bytes through
canonical private Diagnostic Plane receipt intake before any observation may cite it. Diagnostic Plane validates the
complete Kernel-to-service grant proof, service identity, effective grant application, field scope, token and digest,
preserves the proof chain immutably, and rejects missing, mismatched, revoked, or unapplied references.

**Source Identity Mapping Receipt**:
A customer-side durable journal record binding one scoped Source Identity Token to one opaque Logical Operation
Identity, exact mapping service and version, source binding, journal sequence, and record digest before forwarding.
`source.delivery` observations cite it as mapping provenance; the receipt establishes an attributed mapping claim,
not external business truth.
_Avoid_: Diagnostic Observation Receipt, raw submission identifier, inferred correlation edge

**Correlation Token**:
A signed propagation artifact binding a Logical Operation Identity to its installation, environment,
namespace, issuer, and validity. Downstream systems pass it unchanged; observers do not receive the issuer's
private key or a shared pseudonymization secret.
_Avoid_: Observer credential, bearer authority for effects, cross-customer tracking identifier

**Stream Coverage Projection**:
A versioned, cutoff-bound derivation of received and missing ranges for one Observation Stream. It reports
source coverage limitations without mutating accepted receipts or invalidating unrelated evidence; later
arrivals may support a newer evidence package without changing an existing one.
_Avoid_: Evidence truth score, strict delivery queue, cross-stream ordering

**Diagnostic Committed Intake Position**:
A contiguous installation-local position assigned to every durably preserved intake outcome while holding one
transaction-scoped finalization lock through commit. Rollback also rolls back the position advance, so every cutoff
identifies a stable committed prefix across observer streams. It establishes inclusion order, not external time or
causality.
_Avoid_: Postgres sequence allocation, observer stream sequence, wall-clock cutoff, causal order

**Correlation Projection**:
An immutable deterministic Diagnostic Plane revision deriving canonically ordered entities, typed
relationships, unresolved relationships, and facts from an exact ingestion cutoff, receipt set, interpretation
dependencies, and projector version. Its semantic digest excludes random identity and creation time; its
record digest binds provenance metadata. Query indexes are disposable and never evidence authority.
_Avoid_: Mutable graph database, inferred fuzzy join, current-state evidence, Accountability Projection

**Evidence Selection Policy**:
An immutable versioned policy defining the allowed typed-edge traversal, required source roles, contradiction
and unresolved-relationship inclusion, acceptable commitment bases, role-completion predicates, source-coverage
requirements, optional corroboration, detail classes, redaction, and disclosure accounting used to derive one
Diagnostic Evidence Package from an exact evaluation and projection. Required roles are contract-specific and may
be relational: every matched effect must have the required request, execution, and delivery ancestors. It contains
no model-selected rules or universal evidence checklist.
_Avoid_: Search prompt, arbitrary graph neighborhood, hidden filter, artifact JSONPath

**Diagnostic Evidence Package**:
An immutable content-addressed Diagnostic Plane artifact derived from one exact evaluation by an Evidence
Selection Policy. It preserves an inspectable correlation path, supporting and contradictory receipt-backed
claims, unresolved relationships, coverage and conflicts, exact interpretation dependencies, and disclosure
accounting. Its manifest separates `governed_interpretation_dependencies`, `authenticated_observations`,
`deterministic_derived_facts`, and `coverage_and_limitations`. Governed contracts explain interpretation but
cannot encode incident facts or expected diagnosis; observations supply claims; deterministic services derive
facts; the packager introduces none. It is intentionally bounded and does not claim exhaustive or causal coverage.
_Avoid_: Reproduction Bundle, causal proof, complete data export, controller-authored workspace

When a selected observation or equality edge depends on tokenization, the package includes and retention-pins the
signed Tokenization Result Receipt, service verification identity, Grant Activation Snapshot, and Grant Application
Receipt as `authenticated_provenance_dependency` records in a distinct `authenticated_provenance_dependencies`
collection under `authenticated_observations`. They support authenticated observations but are not themselves
observations or governed interpretation.

**Evidence Collection Retention Lease**:
A temporary governed retention reference created with a Diagnostic Trigger over proving inputs and extended to newly
relevant correlation-group material while a case collects evidence. It lasts through the collection deadline,
maximum stage-retry horizon, and garbage-collection margin, then converts selected material to package pins or
expires visibly.
_Avoid_: Permanent package pin, ordinary retention policy, legal hold, mutable evidence package

Ordinary retention must satisfy `pretrigger_observation_horizon + pretrigger_pipeline_retry_horizon + gc_margin`.
Collection lease duration from trigger commit must satisfy `collection_window + post_trigger_retry_horizon +
gc_margin`. Readiness evaluates the sums, not each interval independently.

**Independent Diagnostic Verification Bundle**:
An immutable privileged read-API export containing every preserved intake outcome and exact bytes or tombstone from
Diagnostic Committed Intake Position `1..cutoff`, plus schemas, contracts, grant application state, signed
tokenization receipts and service verification identities, rules artifacts, and published input manifests. A
separate verifier checks prefix contiguity and independently determines eligible inputs before recomputing projection,
effect interpretation, evaluation, and package semantic digests without database or Stage Worker access.
_Avoid_: Precomputed verification answer, database dump, Stage Worker self-check, hidden rubric

Late observations never mutate a Diagnostic Evidence Package, its projection, assignment, or bound diagnosis.
Policy-defined material changes may create a newer package revision; identical deterministic content creates no
revision, and historical diagnoses remain bound to their original packages.

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

**Diagnostic Effect Projection**:
An immutable deterministic Diagnostic Plane assessment of an external effect as `committed`, `not_committed`,
`ambiguous`, or `unknown`, binding exact request, state or designated effect-feed receipts, Integration Behavior
Contract, interpreter and rules, correlation, and coverage limitations. Commitment basis is explicit; generic
external claims remain non-authoritative. Every result is classified `diagnostic_derived_external_effect` with
`authority: none`; direct designated-feed observations still require interpretation before evaluation. Generic
transport success is only acknowledgement unless the exact contract defines it as durable commitment.
_Avoid_: Kernel Effect Record, HTTP success, observer self-certification, mutable destination status

**Diagnostic Case**:
A builder-facing investigation that groups exact traces, Runs, revisions, hypotheses, reproductions, evaluations, and fix verification for one behavioral problem. It may propose changes but grants no authority and does not repair business consequences.
_Avoid_: Recovery Case, Accountable Work Thread, alert, mutable Run

A deterministically triggered case begins in `collecting_evidence`. Diagnosis assignment becomes available only
after required diagnostic source roles complete under exact policy or a durable first-party collection deadline
freezes partial evidence at an exact Diagnostic Committed Intake Position cutoff.

One Diagnostic Assignment binds one package, instruction contract, worker authority boundary, and reproducible
attempt. Later package revisions create Diagnostic Reevaluation Notices rather than silently replacing active
assignments or historical diagnoses.

**Diagnostic Trigger**:
An explicit human or agent failure report, structured runtime/tool failure, Kernel accountability or Effect state, or external business mismatch that initiates diagnosis. Model-detected anomaly alone may suggest review but cannot declare failure.
_Avoid_: Model confidence threshold, unexplained alert, inferred business failure

A violated Behavior Evaluation Record may deterministically create a Diagnostic Trigger keyed by exact
contract, correlation group, and proving evidence. Later evaluation revisions attach to the existing case
rather than duplicating the same demonstrated violation.

**Failure Specification**:
A Diagnostic Case-bound statement of demonstrated expected-versus-actual behavior, reproduction conditions, and targeted repair verification. It supports fixing one known problem without claiming to evaluate overall agent quality.
_Avoid_: Behavior Contract, general agent score, Accountability Contract

**Reproduction Bundle**:
An immutable Diagnostic Case artifact binding an exact Agent Revision, Failure Specification, redacted inputs, deterministic tool fixtures, environment assumptions, and integrity hashes for replay in an ephemeral workspace.
_Avoid_: Production payload archive, mutable test workspace, Operational Package

**Behavior Contract**:
An optional versioned declaration for builders who want proactive workflow monitoring against selected outcomes, invariants, prohibited behavior, or performance boundaries. It grants no authority and is not required for onboarding, diagnosis, or repair.
_Avoid_: Accountability Contract, Capability Contract, model rubric, authority policy

**Behavior Evaluation Record**:
An immutable deterministic Diagnostic Plane result binding an exact Behavior Contract, bounded evaluator,
Diagnostic Effect Projection, correlation group, threshold, and source coverage. The evaluator may count only
normalized effects whose status is `committed` and whose operation, destination, correlation role, and commitment
basis satisfy the contract; it cannot read raw requests, responses, snapshots, feed claims, or arbitrary detail.
Its result is `satisfied`, `violated`, or `indeterminate`; insufficient required-source coverage can never produce
`satisfied`, while independently proven prohibited effects may establish `violated` despite unrelated gaps.
_Avoid_: Model score, causal diagnosis, authority decision, generic policy execution

**Integration Behavior Contract**:
An immutable, versioned, environment-attributed declaration of external integration semantics needed to
interpret observations deterministically, such as idempotency comparison, commit behavior, and resource
identity. Observations reference its exact identity and digest; adapter reports cannot create or mutate it.
_Avoid_: Observation, provider documentation link, credential, Behavior Contract

**Contract Discovery Evidence**:
Adapter-submitted provider metadata, documentation, or observed behavior offered to support an Integration
Behavior Contract. It remains a diagnostic observation or contract candidate until governed registration
makes an exact contract version authoritative configuration.
_Avoid_: Registered Integration Behavior Contract, adapter-defined authority, automatic contract activation

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

**Workflow Attestation Binding**:
An immutable pre-execution environment binding between one exact Agent Revision and one published provider
workflow version normalized under pinned runtime image, node metadata, dependency, normalizer, and rules
digests. A short-lived readiness receipt must establish required read access, execution-snapshot retention, and
normalization coverage before its Reporting Grant activates. Runtime observations may confirm or contradict the
binding but can never create, learn, or replace its expected digest.
_Avoid_: Execution-derived expectation, workflow ID-only attribution, mutable adapter cache, deployment draft

**Runtime Event Envelope**:
A provider-neutral signed observation from a Workflow Runtime Adapter binding exact adapter, workflow, revision, external execution, event identity and sequence, lifecycle claim, correlation, idempotency, timestamp, and payload digest or reference. Receipt preserves the claim but does not make it Kernel execution truth.
_Avoid_: Run transition, raw webhook payload, trusted external effect evidence

**Diagnostic Observation Envelope**:
A schema-versioned signed report containing only the typed claims one authorized observer may make, together
with exact stream, identity, correlation, timing, limitation, redaction, and optional detail-artifact binding.
Typed claims drive deterministic projections; opaque artifacts never do.
_Avoid_: Provider payload archive, arbitrary JSON facts, Diagnostic Observation Receipt, external truth

**Observation Schema Export**:
An immutable signed Operational Package artifact conforming to the Core observation meta-schema and defining
one exact observation type's typed claims, correlation roles, allowed detail media, and compatibility metadata.
An exact Deployment activates it and Observation Reporting Grants authorize its full identity, version, and
digest tuple; adapters cannot submit or redefine schemas at intake.
_Avoid_: Runtime schema upload, adapter-owned semantics, mutable validator, provider payload schema

**Diagnostic Observation Receipt**:
An immutable first-party record authored by Diagnostic Plane intake, binding the accepted Diagnostic Observation
Envelope, authenticated Principal attribution, Reporting Grant and key, exact Observation Grant Activation Snapshot,
authentication context, canonical envelope and detail digests, Diagnostic Committed Intake Position, and
authoritative receipt time. It proves what exact bytes intake accepted under which reporting attribution and grant,
and when; HMAC does not prove exclusive observer authorship, and the receipt does not prove the external claim true.
Governed retention or erasure may
remove sensitive envelope or detail bytes while preserving receipt identity, provenance, digests, and an immutable
tombstone, so receipt immutability does not imply immortal sensitive material.
_Avoid_: External effect truth, Kernel Run evidence, mutable telemetry row

**Observation Intake Result**:
The independently retryable outcome of submitting one signed Diagnostic Observation Envelope with zero or one
bounded detail artifact. It is exactly one newly accepted receipt, exact replay, bounded rejection, or identity or
sequence conflict and binds the canonical envelope and verified artifact digests, grant, stream, sequence,
authoritative receipt time, and resulting record identity.
_Avoid_: Batch acknowledgement, journal commit, observer truth attestation, cross-observation transaction

**Diagnostic Artifact**:
An immutable content-addressed object durably verified before any accepted Diagnostic Plane record references
its metadata. Stored but unreferenced objects are recoverable garbage, not observations or evidence; accepted
records must never reference missing artifact bytes.
_Avoid_: Mutable file path, accepted receipt, orphan as evidence, external payload authority

**Rejected Intake Record**:
A bounded immutable Diagnostic Plane audit record preserving authenticated attribution when available,
claimed schema tuple, received body digest and size, receipt time, and rejection reason without retaining
arbitrary invalid bytes by default. Encrypted quarantine requires explicit policy.
_Avoid_: Accepted observation, unrestricted dead-letter payload, evidence receipt

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

Diagnostic Effect Projections describe externally observed activity that did not execute under Kernel admission;
they never become or masquerade as governed Effect Records.

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
