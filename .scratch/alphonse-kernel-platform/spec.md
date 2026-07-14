# Alphonse Kernel V0.1: Agent-Native Operational Package Platform

Label: ready-for-agent

## Problem Statement

Organizations increasingly want humans and replaceable AI agents to build and perform real operational work. Current agent platforms primarily optimize conversation, tool invocation, or provider-specific automation. They do not provide a stable customer-controlled foundation that can answer, with deterministic records:

- who or what acted
- why the work was undertaken
- what exact Package, Skill, model, context, and authority were used
- what external effects were permitted and attempted
- what evidence proves the outcome
- what remains unresolved
- how failure, uncertainty, handoff, upgrade, and recovery are handled

Without this foundation, business logic becomes trapped in conversations, prompts, integration glue, provider credentials, dashboards, and model behavior. Stronger models make these systems more capable but do not make them durable, modular, accountable, or portable.

Builders need a substrate that lets them turn plain-language workflows into reusable operational software without changing platform internals for every domain. Business Operators need useful assistance without becoming approval bottlenecks or reading logs. Customers need control over their data, credentials, environments, and consequential authority. Agents need enough progressive access to succeed without receiving ambient authority.

The first decisive proof is intentionally narrow: an unfamiliar Builder and replaceable agent must transform a plain-language inventory discrepancy workflow into one active accountable Operational Package in under one working day, without modifying Kernel internals. The system must execute one low-risk real effect exactly once, survive injected uncertainty, preserve evidence, coordinate recovery, and hand work to a different runtime without conversation history.

## Solution

Alphonse Kernel is a deterministic customer-controlled authority and accountability substrate for modular agentic operational software.

Builders create immutable, composable Operational Packages containing versioned Skills, schemas, Capabilities, policies, evaluations, adapter references, Accountability Contracts, and Operator Views. Replaceable agents interact through one self-describing Kernel Protocol. A separate customer-owned Data Plane serves governed business context. Linux is the reference Execution Substrate, but Kernel contracts remain substrate-neutral.

Kernel separates identity, intent, delegation, Capability Activation, execution admission, Effects, evidence, accountability, and recovery into independently inspectable records. External effects require exact admission immediately before dispatch. Every effectful Capability declares an Accountability Contract. Runs preserve execution status separately from derived accountability status.

Butler is the first-party operator surface. It organizes Kernel records into exception-focused Accountable Work Threads, exact action cards, evidence, Obligations, Escalations, Recovery Cases, handoffs, and replaceable model explanations. Butler assists but has no privileged authority path.

V0.1 proves the complete vertical slice using inventory discrepancy correction:

1. express and confirm Work Intent
2. discover platform contracts
3. retrieve governed ERP/storefront context
4. construct and validate an Operational Package
5. evaluate and simulate
6. publish and import exact Package Version
7. deploy to staging
8. approve and activate exact Capability
9. hand off to a separate runtime
10. inject timeout-after-dispatch uncertainty
11. reconcile and recover without deleting history
12. perform one approved low-risk production correction
13. inspect final accountability through Butler

The mature architecture includes registry, hosted coordination, environment promotion, compatibility, migration, and portable trust contracts. Their V0 implementations may be local and minimal, but they must preserve the final boundaries so the decisive proof does not create architectural debt.

## User Stories

1. As a Builder, I want to describe a business workflow in plain language, so that I can begin without knowing Kernel internals.
2. As a Builder, I want an agent to propose a compact Work Intent, so that the objective and constraints become explicit.
3. As a Builder, I want to confirm or edit Work Intent before customer context access, so that conversation cannot silently define authority.
4. As a Builder, I want a bounded Build Session, so that construction activity is attributed without placing drafts in Kernel.
5. As a Builder, I want a disposable Build Workspace, so that incomplete experiments cannot affect live behavior.
6. As a Builder, I want a versioned domain-neutral Builder Toolkit, so that strong construction methods are reusable across domains.
7. As a Builder, I want exact Builder Toolkit Skill hashes recorded, so that construction provenance is reproducible.
8. As a Builder, I want agents to discover Kernel operations progressively, so that they receive relevant tools without an enormous permanent catalog.
9. As a Builder, I want public contracts discoverable without full execution admission, so that ordinary construction remains usable.
10. As a Builder, I want structured validation issues with paths and suggested operations, so that agents can correct proposals deterministically.
11. As a Builder, I want Package drafts to remain inert, so that authoring cannot execute privileged code.
12. As a Builder, I want to publish one immutable Package Version, so that reviewed behavior cannot mutate afterward.
13. As a Builder, I want Package identity bound to exact content/dependency digests, so that semantic version cannot hide changed bytes.
14. As a Builder, I want namespaced exports and explicit extension points, so that composition never depends on installation order.
15. As a Builder, I want conflicting Package definitions rejected, so that ambient priority cannot silently change behavior.
16. As a Builder, I want deterministic and observational simulation distinguished, so that simulation fidelity is honest.
17. As a Builder, I want Simulation Receipts, so that assumptions, inputs, runtime, and limitations are inspectable.
18. As a Builder, I want exact dependency closure resolved before Deployment, so that runtime cannot fetch undeclared code.
19. As a Builder, I want a target Deployment staged without granting business authority, so that installation and activation remain separate.
20. As a Builder, I want to build an unfamiliar workflow without changing Kernel code or schema, so that vertical logic remains user space.
21. As a Builder, I want Package upgrades to produce new Deployment Plans, so that active user space cannot change silently.
22. As a Builder, I want machine-readable compatibility reports, so that semantic version is not the only upgrade signal.
23. As a Builder, I want explicit resumable migrations, so that state transformation is observable and recoverable.
24. As a Builder, I want old and new Package versions to coexist, so that breaking consumers can migrate deliberately.
25. As a Builder, I want declarative Operator Views, so that domain workflows feel native without adding domain logic to Butler or Kernel.
26. As a Builder, I want exact Package export/import bundles, so that my work remains portable across registries and disconnected environments.
27. As a Builder, I want a Package Registry to expose contracts, compatibility, risk, and evidence, so that agents can discover useful Packages.
28. As a Builder, I want Package popularity excluded from trust decisions, so that discovery cannot masquerade as safety.
29. As a Builder, I want customer-private and explicitly shared Packages, so that V1 does not require a public marketplace.
30. As a Builder, I want adapter implementations replaceable behind stable contracts, so that infrastructure choices do not define business semantics.
31. As a Business Operator, I want to review the exact authority-bearing Capability, so that approval is informed and bounded.
32. As a Business Operator, I want Deployment and Capability Activation shown separately, so that installed does not imply authorized.
33. As a Business Operator, I want Agent Passport, sponsor, runtime, model, Packages, and Skills inspectable, so that I know what is acting.
34. As a Business Operator, I want Work Intent displayed beside agent identity, so that I know why the agent is acting now.
35. As a Business Operator, I want context authority and freshness visible, so that stale or weak data is not presented as current truth.
36. As a Business Operator, I want exact effect target and limits shown before approval, so that broad authority cannot hide in a friendly interface.
37. As a Business Operator, I want one exception-focused inbox, so that supervision does not become a laundry list.
38. As a Business Operator, I want related symptoms grouped under one Accountable Work Thread, so that I make one coherent decision.
39. As a Business Operator, I want execution and accountability status displayed separately, so that process completion is not confused with obligation completion.
40. As a Business Operator, I want facts, inference, recommendations, and uncertainty separated, so that model explanations remain honest.
41. As a Business Operator, I want every explanation linked to exact records/revisions, so that I can verify it.
42. As a Business Operator, I want exact permitted action cards, so that Butler cannot invent privileged commands.
43. As a Business Operator, I want approval actions authenticated as me, so that Butler never becomes the approving identity.
44. As a Business Operator, I want evidence mapped to exact Obligations, so that completion is objectively understandable.
45. As a Business Operator, I want deadline and responsible actor visible for every open Obligation, so that accountability is actionable.
46. As a Business Operator, I want uncertain Effects clearly distinguished from failed Effects, so that the system does not retry blindly.
47. As a Business Operator, I want a Recovery Case to show known facts, missing evidence, options, and authority requirements, so that recovery is guided.
48. As a Business Operator, I want compensation to create new Effects, so that original history remains truthful.
49. As a Business Operator, I want accepted loss to require explicit human rationale, so that unresolved outcomes cannot disappear.
50. As a Business Operator, I want one-button explicit handoff, so that I can move work between runtimes without hidden memory.
51. As a Business Operator, I want handoff acceptance to transfer responsibility atomically, so that two agents do not retain conflicting authority.
52. As a Business Operator, I want agent and human comments visibly attributed, so that participants cannot be confused.
53. As a Business Operator, I want comments to remain non-authoritative until structured confirmation, so that chat cannot silently change state.
54. As a Business Operator, I want domain-specific read views inside Butler, so that I can understand the workflow without learning Kernel internals.
55. As a Business Operator, I want personal dashboard layouts, so that I can organize visibility without changing authority.
56. As a Business Operator, I want mandatory alerts driven by Accountability Contracts, so that model judgment cannot create fake urgency.
57. As a Business Operator, I want duplicate alerts suppressed, so that important intervention remains visible.
58. As a Business Operator, I want routine progress removed from my mandatory queue, so that assistance reduces attention cost.
59. As a Business Operator, I want to inspect why an item is in my inbox, so that routing remains explainable.
60. As a Business Operator, I want support access scoped and expiring, so that external help does not gain standing authority.
61. As an Agent Runtime, I want one self-describing Kernel Protocol, so that I am not tied to MCP, CLI, HTTP, or one provider.
62. As an Agent Runtime, I want a small discovery interface, so that I can request only relevant typed tools.
63. As an Agent Runtime, I want Operation Descriptors with schemas, preconditions, outcomes, and next operations, so that I can correct failures programmatically.
64. As an Agent Runtime, I want my Agent Passport separate from authority, so that identity does not imply permission.
65. As an Agent Runtime, I want an exact Work Intent on meaningful requests, so that my purpose is durable.
66. As an Agent Runtime, I want bounded Context Access Grants, so that I can retrieve needed customer context progressively.
67. As an Agent Runtime, I want context delivered directly from Data Plane where possible, so that Kernel does not become a payload warehouse.
68. As an Agent Runtime, I want signed Context Receipts, so that the exact authority/freshness used remains attributable.
69. As an Agent Runtime, I want context advisories linked to prior receipts, so that superseded information can trigger impact review without rewriting history.
70. As an Agent Runtime, I want exact Execution Envelopes, so that each Run begins from deterministic admission.
71. As an Agent Runtime, I want structured denial reasons, so that I can request correction instead of guessing.
72. As an Agent Runtime, I want one-use Dispatch Permits, so that external Effects cannot bypass immediate Kernel gating.
73. As an Agent Runtime, I want checkpoint-aware cancellation, so that I can stop safely where possible.
74. As an Agent Runtime, I want resource extension requests, so that legitimate work can continue without ambient unlimited access.
75. As an Agent Runtime, I want effect uncertainty represented explicitly, so that I do not retry non-idempotent operations blindly.
76. As an Agent Runtime, I want structured Evidence submission, so that output can satisfy declared obligations.
77. As an Agent Runtime, I want runtime handoff from exact artifacts and ledger cursor, so that another model can continue without conversation history.
78. As an Agent Runtime, I want public contracts accessible under provisional intent, so that discovery does not require unnecessary ceremony.
79. As an Agent Runtime, I want live customer reads to disclose observation and cache age, so that delivery time does not reset freshness.
80. As an Agent Runtime, I want model confidence excluded from deterministic routing, so that uncertainty does not become hidden authority.
81. As a Kernel Environment Administrator, I want each customer Environment isolated, so that authority never crosses customer or environment boundaries.
82. As a Kernel Environment Administrator, I want local, customer-cloud, and managed deployments to use identical semantics, so that hosting choice does not redefine authority.
83. As a Kernel Environment Administrator, I want PostgreSQL as the authoritative store, so that state transitions and receipts commit atomically.
84. As a Kernel Environment Administrator, I want immutable typed transitions beside explicit lifecycle state, so that history remains complete without one generic event state machine.
85. As a Kernel Environment Administrator, I want idempotent command receipts, so that retries cannot duplicate transitions.
86. As a Kernel Environment Administrator, I want registered Atomic Transaction Contracts, so that Packages can compose exact multi-object invariants without database access.
87. As a Kernel Environment Administrator, I want progressive consistency classes, so that consequence determines transactional cost.
88. As a Kernel Environment Administrator, I want disposable freshness-visible projections, so that operator views can rebuild without changing authority.
89. As a Kernel Environment Administrator, I want append-only integrity chains and checkpoints, so that corruption/tampering becomes detectable.
90. As a Kernel Environment Administrator, I want restored Environments fenced by new execution epoch, so that old workers cannot duplicate real effects.
91. As a Kernel Environment Administrator, I want local authority to continue during hosted outage, so that coordination service is not a kill switch.
92. As a Kernel Environment Administrator, I want a customer-defined promotion graph, so that development, staging, and production use explicit evidence gates.
93. As a Kernel Environment Administrator, I want target Environments to resolve local configuration and credentials, so that promotion never copies authority.
94. As a Kernel Environment Administrator, I want destination Trust Policies, so that registry acceptance cannot decide local trust.
95. As a Kernel Environment Administrator, I want different trust policy by environment, so that production can require stronger evidence than development.
96. As a Kernel Environment Administrator, I want advisories mapped to preapproved local responses, so that registries can warn without deactivating customer authority.
97. As a Kernel Environment Administrator, I want deterministic canary cohorts, so that progressive activation is reproducible.
98. As a Kernel Environment Administrator, I want active Runs pinned during upgrade, so that execution cannot become half-old and half-new.
99. As a Kernel Environment Administrator, I want old artifacts retained while obligations reference them, so that evidence and recovery remain reproducible.
100. As a Kernel Environment Administrator, I want host quarantine and key rotation, so that compromised substrate identity can be fenced.
101. As a Kernel Environment Administrator, I want rootless Linux containment by default, so that trusted V1 adapters still receive least privilege.
102. As a Kernel Environment Administrator, I want default-deny effect-target networking, so that workloads cannot bypass Dispatch Permits.
103. As a Kernel Environment Administrator, I want signed host observations, so that process/resource facts are attributed without becoming business truth.
104. As a Kernel Environment Administrator, I want support bundles explicit and redacted, so that diagnostics do not silently leak business data.
105. As a Publisher, I want a registry-independent Package identity, so that Packages remain portable across mirrors.
106. As a Publisher, I want root identity to delegate scoped release keys, so that CI does not hold unrestricted signing authority.
107. As a Publisher, I want atomic publication, so that incomplete Package Versions never become discoverable.
108. As a Publisher, I want publication receipts, so that registry custody and checks are attributable.
109. As a Publisher, I want immutable deprecation/advisory records, so that history is not rewritten.
110. As a Publisher, I want namespace transfers dual-signed, so that registry administration cannot silently transfer trust.
111. As a Package Consumer, I want every transitive dependency independently verified, so that trusted parents cannot import untrusted code.
112. As a Package Consumer, I want import to create quarantine rather than Deployment, so that authenticity is not confused with authority.
113. As a Package Consumer, I want immutable Import Receipts, so that every trust decision can be reproduced.
114. As a Package Consumer, I want offline bundles verified identically, so that disconnected environments preserve trust semantics.
115. As a Package Consumer, I want locally cached exact artifacts, so that active operations do not depend on registry uptime.
116. As a Hosted Coordinator Operator, I want signed minimal Environment Descriptors, so that I can provide compatibility and health visibility without receiving business payloads.
117. As a Hosted Coordinator Operator, I want receipt-derived promotion status, so that hosted UI cannot claim activation by itself.
118. As a Hosted Coordinator Operator, I want customer-initiated outbound connections, so that customer networks need no permanent inbound administration path.
119. As a Support Operator, I want a temporary Support Passport, so that my access is explicit, scoped, expiring, and locally ledgered.
120. As a Data Plane Operator, I want independent disclosure policy, so that Kernel grants cannot override customer data authority.
121. As a Data Plane Operator, I want typed context releases, live observations, advisories, and signed delivery manifests, so that agents can consume governed context without Kernel owning it.
122. As a Platform Owner, I want the first proof to complete in under eight active hours and under two hours human attention, so that governance does not destroy usability.
123. As a Platform Owner, I want the first proof to use an unfamiliar Builder, so that success does not depend on founder knowledge.
124. As a Platform Owner, I want a separate runtime to accept handoff, so that provider independence is demonstrated rather than asserted.
125. As a Platform Owner, I want one low-risk production Effect after staging recovery succeeds, so that the proof demonstrates business operation rather than only engineering simulation.
126. As a Platform Owner, I want five agent builders to evaluate the proof, so that technical success can be paired with market evidence.

## Implementation Decisions

### Product Objective And Scope

- Alphonse Kernel enables human-agent teams to build, deploy, operate, and evolve modular operational systems without bypassing customer authority.
- Kernel is a wide, domain-neutral substrate. Verticals emerge from Operational Packages and customer configuration.
- The first implementation is constrained to the decisive inventory discrepancy correction proof.
- Mature contracts may receive local/single-node V0 implementations; public marketplace, broad federation, and enterprise scale are deferred.

### Platform Planes

- Kernel owns deterministic authority, admission, lifecycle, accountability, receipts, and typed references.
- Data Plane independently owns business context, operational observations, source authority, publication policy, and payload delivery.
- Intelligence Plane contains replaceable agents/models operating through public contracts.
- Execution Substrate contains workloads and enforces host bounds.
- Butler is a first-party supervisory client, not a second authority plane.
- Hosted coordination and Package Registry remain replaceable services, not runtime roots of authority.

### Core Identity And Authority Model

- Principal, Agent Passport, Work Intent, Delegation, Capability Activation, Context Access Grant, Execution Envelope, and Run remain separate records.
- Agent Passport proves agent configuration/provenance and grants no business authority.
- Conversation may propose Work Intent; explicit confirmation is required before customer context or effects.
- Capability Activation binds exact Capability export from exact Deployment.
- One Execution Envelope admits exactly one Run.
- Corrective work always re-enters through normal Work Intent, authority, admission, and evidence paths.

### Operational Package Model

- Operational Package is declarative and inert during installation.
- Package Version is immutable and identified by stable Package ID, semantic version, authoritative content digest, and dependency digest.
- Namespaced exports and declared extension points define composition.
- Composition conflicts fail validation.
- Skill Export is versioned method plus typed input/output, context, uncertainty, and evaluation contract.
- Accountability Contract is mandatory for effectful Capability activation.
- Operator View exports are declarative in V0.
- Executable Adapters must come from customer or explicitly trusted Builder in V1.

### Build And Publication

- Build Session records attribution, Work Intent, base versions, context grants, validation history, candidate hash, and expiry.
- Build Workspace contents remain outside Kernel.
- Builder Toolkit is a public versioned domain-neutral Package derived from grilling, domain modeling, to-spec, prototype, skill authoring, implementation, and review workflows.
- Validation is deterministic and returns structured issues.
- Simulation Receipt distinguishes deterministic fixtures from observational live reads and grants no authority.
- Publication verifies complete exact artifacts before immutable Package Version becomes discoverable.

### Kernel Protocol

- One canonical self-describing Kernel Protocol defines semantics.
- MCP, CLI, SDK, and HTTP are adapters only.
- Operation Descriptors declare schemas, visibility, authority/effect class, preconditions, modes, idempotency, outcomes, issues, events, and next operations.
- Agents start with a small discovery interface and receive bounded Task Tool Projections.
- Operation Visibility Policy prevents sensitive catalog disclosure without confusing visibility with authority.
- Proposals share attribution/integrity metadata but retain typed domain lifecycles.

### Context Contract

- Effective context access is intersection of Kernel Context Access Grant and Data Plane policy.
- Context payload goes directly from Data Plane to runtime by default.
- Kernel stores payload-free Context Receipt with exact item references, hashes, authority, freshness, provenance, and limitations.
- Cached context preserves original observation time and exposes cache age.
- Context advisory links to exact receipts and triggers policy-defined impact handling without rewriting history.
- Context correction/publication uses separate typed Capabilities and Data Plane policy.

### Execution And Accountability

- Run execution status and Accountability Projection remain separate.
- Every external effect receives its own Effect Record and immediate pre-dispatch Kernel gate.
- Effect adapter never receives ambient effect budget.
- Effect idempotency is exact per business target/action.
- Timeout after possible dispatch creates uncertainty.
- Non-idempotent uncertain Effect cannot retry before reconciliation.
- Evidence Record is immutable and binds exact claim/obligation.
- Operational Obligation state is open, satisfied, breached, or waived; overdue is derived.
- Waiver and accepted loss require exact human/environment authority where contract permits.
- Recovery Case is separate lifecycle and never rewrites source failure.

### Persistence

- PostgreSQL is authoritative.
- Every authoritative record is scoped by Installation and Environment.
- Current lifecycle tables are authoritative for admission.
- Typed append-only transitions preserve history; shared transition envelope provides attribution, ordering, and integrity without becoming a universal reducer.
- Commands store immutable idempotency receipts.
- Same command ID and digest returns original result; different digest conflicts.
- Immutable definitions use authoritative digests; large artifacts use content-addressed object storage.
- Projections are named, versioned, disposable, cursor/freshness-visible, and never used for authority.
- Outbox delivery is at-least-once with idempotent consumers.
- Schema evolution uses expand, backfill, verify, contract; immutable history is decoded by version.

### Atomic Transaction Contracts

- Packages may declare reviewed versioned Atomic Transaction Contracts.
- Runtime cannot invent arbitrary transaction programs.
- Contract defines exact atomic-composable operations, targets, invariants, authority, limits, consistency, and lock order.
- Consistency classes are observational, aggregate-linearized, and invariant-atomic.
- External calls never occur inside Kernel database transaction.

### Restore And Retention

- PostgreSQL point-in-time recovery and content-addressed artifact backups are required.
- Restored Environment starts suspended with new execution epoch.
- Old workers are fenced; possibly post-restore effects reconcile before authority resumes.
- Operational deletion uses typed tombstones.
- Expiration is distinct from deletion.
- Identity display mappings may be deleted while historical attribution becomes pseudonymous.
- Full Environment destruction uses cryptographic erasure under retention/legal policy.

### Execution Substrate

- Linux is reference, not Kernel contract.
- V0 adapter operations cover prepare, start, lease renewal, observation, effect gate, cancellation, exit/evidence collection, and destruction.
- Workload Grant binds Environment epoch, Run, Passport, Deployment, Capability, workload digest, adapter, limits, and expiry.
- Workload Instance identity uses namespace, cgroup, host boot identity, start time, and nonce; PID alone is insufficient.
- Reference container is rootless, non-root, read-only root, constrained mounts, no engine socket, dropped capabilities, seccomp/AppArmor/SELinux where available, cgroup limits, and default-deny network.
- Workload cannot directly reach effect targets.
- One-use Dispatch Permit binds exact Effect Request, target, adapter, idempotency, workload, and expiry.
- Credential broker provides scoped ephemeral credential only after permit.
- Signed host observations are chained and typed, but remain host facts rather than business truth.
- Lease expiry or old Environment epoch blocks Effects immediately.
- Cancellation is cooperative then enforced; possible dispatch creates uncertainty.

### Package Registry And Trust

- Package identity is registry-independent.
- Artifact digest, publisher provenance, registry custody, and destination trust are separate.
- Publisher root delegates scoped expiring release keys; private keys remain outside registry.
- Atomic publication creates immutable Package Version and Publication Receipt.
- Every transitive dependency is independently checked.
- Import creates quarantined local object plus immutable Import Receipt.
- Destination Environment applies immutable versioned Trust Policy.
- Development, staging, and production may use different policies.
- Advisories drive only preapproved local responses.
- Imported artifacts remain usable offline.
- Registry append-only transparency checkpoints provide tamper/equivocation evidence.

### Hosted Coordination And Promotion

- Customer Environment initiates signed outbound communication.
- Environment Descriptor is minimal and excludes business payloads, credentials, prompts, evidence bodies, and actor activity.
- Hosted service coordinates registration, catalogs, advisories, sanitized health, Promotion Proposals, receipts, notifications, and support.
- Hosted identity never implies Kernel identity.
- Customer Promotion Graph defaults development -> staging -> production.
- Promotion moves exact Package identity and receipts, never mutable state, credentials, or authority.
- Target Environment resolves local Deployment Plan and performs local review/approval/activation.
- Hosted promotion status is derived from signed target receipts.
- Hosted outage/termination cannot disable existing local operations.
- Support requires temporary locally issued Support Passport.
- Coordinator Binding is locally revocable and replaceable.

### Compatibility, Migration, And Rollback

- Compatibility is multidimensional across protocol, dependencies, schemas, adapters, context, Skills, views, authority, evidence, and recovery.
- Machine-readable contract diff governs; semantic version communicates intent only.
- Breaking exports install beside old major versions.
- Upgrade Plan binds exact current/target, migration graph, consumers, in-flight Runs, staging, activation, verification, rollback/repair, and retirement.
- State migration is explicit resumable Run; business payload remains outside Kernel.
- Active Runs remain pinned to original versions.
- Deterministic canary cohorts allow progressive activation.
- Authority Equivalence Receipt may permit customer-preapproved activation when authority digest is unchanged.
- Changed authority requires fresh business approval.
- Deployment rollback, state rollback, and operational compensation are separate.
- Forward-only migrations require explicit approval, backup/checkpoint, tested repair, and stronger evidence.
- Old versions remain until consumers, Runs, evidence, recovery, and retention references close.

### Butler V0

- Primary object is Accountable Work Thread.
- Mandatory inbox item requires Kernel-backed approval, Obligation, Escalation, Recovery Case, handoff, or policy exception.
- Deterministic priority uses severity, deadline, impact, and responsibility.
- Model explanation separates Facts, Inference, Recommendation, and Uncertainty.
- Action cards come from Kernel affordances and submit authenticated Principal commands.
- Recovery view coordinates normal recovery paths.
- Runtime handoff binds Work Intent, exact Packages/Skills, Context Receipts, ledger cursor, and obligations.
- Comments remain attributed and non-authoritative until structured confirmation.
- Personal layouts require no authority; shared domain modules are Package Operator Views.
- Butler Agent uses ordinary Passport and may prepare/explain/propose but not approve/activate/satisfy/recover through privilege.
- V0 excludes general messaging parity.

### Decisive Inventory Proof

- Reference workflow compares authoritative ERP inventory with storefront representation.
- Customer-defined policy determines whether correction is appropriate.
- Staging exercises deterministic reads, stale data, conflict, duplicate handling, effect simulation, timeout-after-dispatch, reconciliation, and recovery.
- Qualifying production step is one explicitly approved low-risk reversible correction.
- An unfamiliar Builder uses only public Toolkit, protocol, docs, and source access.
- Runtime handoff uses a different supported runtime and no conversation history.
- Target is under eight active hours and under two hours total human active time.
- Any bypass of Kernel/schema, secret copying, direct authority edit, erased failure, duplicate uncertain Effect, or hidden workflow scaffold fails proof.

## Testing Decisions

### Primary Test Seam

The primary seam is one black-box vertical journey through Kernel Protocol and Butler:

plain-language inventory workflow -> Package construction -> validation/import -> staging Deployment -> context access -> activation/admission -> Linux workload -> gated Effect -> evidence/accountability -> injected uncertainty/recovery -> runtime handoff -> Butler explanation

Tests assert externally observable contracts, receipts, statuses, effects, evidence, and operator affordances. They do not assert private function calls, database implementation details, or model chain-of-thought.

### Controlled Test Systems

- Use controlled ERP and storefront adapters with authoritative fixtures and inspectable effect history.
- Use reference Data Plane with signed context manifests and controllable freshness/advisory behavior.
- Use Linux reference substrate with injectable timeout, host loss, lease expiry, resource breach, and cancellation.
- Use two runtime clients over same Kernel Protocol for handoff proof.
- Use deterministic clock/IDs where necessary without weakening production idempotency behavior.

### Construction Tests

- Plain-language workflow produces explicit confirmed Work Intent.
- Public discovery works under provisional intent.
- Customer context access fails before confirmation/grant.
- Builder Agent creates Package without Kernel/schema changes.
- Package rejects secrets, undeclared effects, missing authority/freshness, missing idempotency/evidence/recovery, and incompatible dependencies.
- Deterministic validation replay is idempotent.
- Simulation Receipt distinguishes deterministic and observational modes.
- Exact Toolkit/Package/Skill hashes are recorded.

### Package And Trust Tests

- Atomic publication rejects missing/mismatched artifact.
- Published bytes cannot mutate under same identity/version.
- Invalid publisher delegation/signature fails.
- Transitive dependency trust is independently evaluated.
- Unknown publisher does not gain automatic trust.
- Development may accept Package that production policy rejects.
- Import creates quarantine and Import Receipt, not Deployment.
- Offline bundle verification matches online import.
- Registry outage does not interrupt active Deployment/Run.
- Advisory freshness and local response are visible.

### Environment And Promotion Tests

- Registration uses signed outbound channel.
- Hosted account identity cannot call Kernel authority operations.
- Promotion Proposal cannot directly deploy/activate target.
- Target resolves local configuration/credential references.
- Missing staging/recovery receipts block production promotion.
- Signed target receipts drive hosted status.
- Hosted outage leaves local authority operational.
- Coordinator Binding revocation leaves local state intact.

### Persistence And Concurrency Tests

- Command retry with same digest returns original result.
- Same command ID with changed digest conflicts.
- Concurrent expected-revision updates produce one valid successor.
- Atomic Transaction Contract commits every participant or none.
- Runtime cannot submit unregistered transaction composition.
- Cross-Environment references fail database-backed contract.
- Projection rebuild reproduces externally equivalent view and exposes cursor.
- Projection outage cannot change authority.
- Outbox duplicate delivery does not duplicate consumer result.
- Transition integrity corruption quarantines affected aggregate.

### Context Tests

- Effective access is strict Kernel/Data Plane intersection.
- Context payload bypasses Kernel storage.
- Receipt binds exact release/live query, authority, freshness, provenance, and recipient.
- Cache access preserves source observation time.
- Stale ERP data blocks pre-effect policy.
- Context advisory links affected Runs without rewriting receipts/history.
- Sensitive fields remain redacted in Butler, summaries, search, and notifications.

### Execution And Effect Tests

- One Envelope creates one Run atomically.
- Duplicate Envelope/Run replay is idempotent.
- Inactive Capability, expired Delegation, wrong Passport, stale Context Receipt, wrong credential revision, or excessive Effect fails admission/gate.
- Workload cannot reach effect target directly.
- Dispatch Permit is exact, expiring, and single use.
- Credential unavailable before permit and revoked after.
- Exact idempotent inventory correction occurs once.
- Timeout after dispatch creates uncertain Effect and Run.
- Blind retry of uncertain non-idempotent Effect is blocked.
- Reconciliation preserves was-uncertain history.
- Compensation creates new Effect linked to original.

### Substrate Tests

- Workload identity does not rely on PID.
- Rootless containment blocks undeclared filesystem, engine socket, capability, network, and persistence access.
- CPU, memory, process, storage, and runtime limits enforce policy.
- Resource extension beyond preapproved bound fails.
- Lease expiry blocks Effect before workload termination.
- New Environment epoch fences old worker.
- Signed observation sequence detects gaps.
- Exit success does not satisfy business Obligation.
- Host loss before dispatch can resume at valid checkpoint.
- Host loss after possible dispatch produces uncertainty.
- Cancellation stops permits, revokes credentials, signals, then kills after grace.
- Host quarantine prevents placement.

### Accountability And Butler Tests

- Run status and Accountability Projection never collapse.
- Mandatory inbox item always links Kernel-backed source.
- Routine progress does not create mandatory operator task.
- Duplicate alerts group into one thread.
- Acknowledgement does not satisfy Obligation.
- Explanations cite exact records and separate fact/inference/recommendation/uncertainty.
- Model confidence cannot approve, route, or satisfy.
- Action card uses current revision and permitted Kernel operation.
- Stale action card conflicts safely.
- Recovery Case exposes allowed options and creates normal corrective authority chain.
- Handoff transfers exact structured state and closes/narrows source authority only after acceptance.
- Agent comments remain non-authoritative.
- Personal dashboard layout change does not touch Kernel authority.
- Domain Operator View cannot introduce undeclared action.
- Operator can explain final outcome without logs/code.

### Upgrade Tests

- Additive compatible change passes report.
- Breaking schema change requires parallel major version/migration.
- Active Run remains pinned during canary.
- Interrupted migration resumes from checkpoint.
- Failed verification leaves old Deployment active.
- Deterministic cohort routing is reproducible.
- Authority-equivalent patch may follow preapproved activation policy.
- Changed Effect/context/credential/evidence authority requires fresh approval.
- Deployment rollback preserves upgrade history.
- Post-effect correction uses compensation, not false rollback.
- Retirement is blocked by active Run or unresolved Obligation.
- Unsupported active Package blocks breaking Kernel upgrade.

### Restore And Security Tests

- Restore creates new execution epoch and suspended Environment.
- Old workers cannot dispatch after restore.
- Potential post-restore Effects enter reconciliation.
- Artifact digests verify after restore.
- Deleting identity mapping pseudonymizes historical attribution.
- Tombstone differs from expiration.
- Support Passport is scoped, read-only by default, expiring, revocable, and ledgered.
- Diagnostic bundle is explicit, redacted, encrypted, and expiring.

### Qualifying Proof

- Automated acceptance uses controlled systems through same black-box seam.
- Qualifying proof uses unfamiliar workflow-aware Builder.
- Workflow-specific work completes under eight active hours.
- Human active time remains under two hours.
- One staging timeout-after-dispatch is reconciled.
- One approved low-risk real production correction is completed and verified.
- Different runtime accepts handoff without conversation history.
- Business Operator explains exact identity, intent, versions, context, authority, Effect, evidence, uncertainty, recovery, and final accountability through Butler.
- Five agent builders review proof; target evidence is three immediately understand value, two request testing, and one supplies real workflow or pays for implementation.

## Out of Scope

- Domain-specific vertical products beyond inventory proof Package.
- Public anonymous publishing.
- Public untrusted executable Package execution.
- Marketplace ratings, rankings, payments, and recommendations.
- General Slack replacement, channels, DMs, presence, calls, or broad file-sharing parity.
- Polished enterprise Butler UI beyond V0 proof.
- Multi-host cluster orchestration.
- Global multi-region authority.
- Registry federation and mandatory public transparency.
- Hardware-backed attestation requirement for V0.
- MicroVM/WASM isolation requirement for V0.
- Full enterprise compliance certification.
- Universal credential vault or OAuth application management inside Kernel.
- Customer business payload storage inside Kernel.
- Model training/fine-tuning platform.
- Provider-specific hidden prompts or runtime-only workflow state.
- Automatic autonomous approval.
- Guaranteed rollback of irreversible real-world effects.
- Production-scale performance optimization before decisive proof.

## Further Notes

- Kernel philosophy follows durable operating-system boundaries: stable contracts, replaceable user space, explicit authority, and never silently breaking active consumers.
- Intelligence improves the system but does not define truth. Models interpret; deterministic software adjudicates.
- Governance scales with consequence. Public discovery should remain easy; business context requires bounded grants; external Effects require full accountability.
- V0 implementation should use one PostgreSQL instance, local content-addressed artifacts, one Linux host, one reference Data Plane, one ERP/storefront adapter pair, two runtime clients, and Butler V0.
- All implementation and proof work remains local Docker/PostgreSQL unless the user separately authorizes AWS activity; no AWS provisioning, credentials, CLI, Terraform application, or API calls are implied by this spec.
- Hosted coordination and registry should initially be thin/local implementations of final contracts rather than independent large products.
- No platform expansion should precede the decisive inventory proof.
- The throwaway decisive-inventory state prototype validated the minimum lifecycle shape and corrected one ambiguity: reconciliation proving an Effect was not applied must remain recovery-open and propose separate corrective work rather than reporting recovery success.
- After this spec, use prototype at the black-box seam, then to-tickets, implement, and code-review.
