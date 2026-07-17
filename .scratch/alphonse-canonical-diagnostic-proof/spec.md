# Alphonse Kernel: Canonical Diagnostic Observation Proof

Label: ready-for-agent

## Problem Statement

Alphonse can already receive signed n8n runtime events, preserve external activity, package curated Agency Lab
evidence, and assign bounded diagnostic work. The current reverse test proved that a frontier worker can diagnose a
delivery-scoped idempotency defect when given strong evidence. It also exposed the central weakness: the scenario
controller still inspected runtime and destination state, correlated records, assembled evidence, and wrote the
worker workspace. The worker diagnosis was useful, but the platform did not independently produce the epistemic
position that made the diagnosis defensible.

This leaves several product claims weaker than they appear:

- accepted runtime reports prove authenticated self-reporting, not independently interpreted external effects
- existing runtime traces and Agency Lab packages follow different replay, provenance, correlation, and retention paths
- a successful HTTP response can be mistaken for a committed destination effect
- mutable or controller-curated evidence can make a correct diagnosis impossible to reproduce independently
- one broad test controller can know the defect, construct the evidence, and then judge the answer
- raw customer identifiers and idempotency keys can leak merely to establish equality
- assignment creation, model disclosure, worker execution, and external authority are not yet separated precisely
- instruction-only worker isolation cannot prove that a worker inspected only the assigned package

The product needs one narrow proof where the controller becomes stimulus-only. A privileged Test Orchestrator may
prepare and seal the environment, but it must exit before the scenario starts. A separate Scenario Stimulus may send
two webhook deliveries, but it must have no read or evidence-authoring path. Customer-side observers must report
what they independently observe. First-party deterministic Diagnostic Plane services must preserve, correlate,
interpret, evaluate, select, and package that evidence. The Assignment Service must create an immutable unclaimed
Diagnostic Assignment without granting execution authority. Only then may Kernel authorize an isolated worker.

The decisive scenario is one duplicate lead-form operation delivered twice. The defective n8n workflow supplies a
different delivery-scoped idempotency key to the mock CRM for each delivery. The CRM uses exact-string idempotency,
so both requests commit and two leads are created for one logical operation. The worker must infer this supported
mechanism from bounded evidence without receiving raw customer identities, raw idempotency keys, hidden fault labels,
controller-authored facts, workflow source, or an expected diagnosis.

## Solution

Build one customer-controlled canonical diagnostic observation vertical slice around the duplicate-delivery case.

A public-edge Customer Ingress Adapter authenticates the two source deliveries. Before forwarding, it durably maps
the stable source identity to one opaque Logical Operation Identity, records each distinct delivery attempt in an
Observation Journal, and marks forwarding pending. Independent forwarder and reporter loops then send work to n8n
and signed observations to the private Diagnostic Plane. Diagnostic unavailability delays evidence but does not
normally block customer delivery after the journal commit.

The private Diagnostic Plane accepts one signed Diagnostic Observation Envelope per request. Each observer has its
own deterministic Principal, Observation Reporting Grant, HMAC key, schema scope, stream, and sequence namespace.
Intake verifies exact deployed schema identity, grant scope, signature, canonical envelope digest, bounded detail,
stream replay, conflicts, and CAS durability before committing an immutable Diagnostic Observation Receipt. Receipt
acceptance proves observer-specific authenticated attribution under a grant, not exclusive authorship or external
truth; the Diagnostic Plane HMAC verifier necessarily retains signing capability.

Five exact first-party observation schemas cover the proof: `source.delivery`, `runtime.execution`,
`destination.request`, `destination.effect`, and `destination.snapshot`. The existing runtime-event endpoint becomes
a compatibility facade that verifies the legacy envelope and deterministically translates only signed or
digest-committed fields into canonical `runtime.execution` intake. Existing External Activity Trace reads become
compatibility projections over canonical receipts.

Customer-side tokenization exposes equality without raw identifiers. Two source deliveries carry distinct opaque
delivery identities, one shared Logical Operation Identity, and one shared scoped Source Identity Token. Source and
destination observers receive narrowly authorized Exact-Value Equality Tokens for delivery identity and
idempotency-key fields. A deterministic Correlation Projection may establish that each request key equals its
delivery identity, that the two request keys differ, and that both deliveries belong to one operation. It may not
label that relationship defective or causal.

Governed contracts supply interpretation, not incident answers. The Behavior Contract declares only that committed
CRM-create effects per Logical Operation Identity must be at most one. The Integration Behavior Contract declares
the mock CRM's exact-string idempotency and append-only ledger commit semantics. Restrictive schemas prevent either
contract from embedding retries, observed key scope, incident identities, root cause, or expected diagnosis.

The Diagnostic Plane runs a durable event-driven state machine. Immutable receipts produce a Correlation Projection.
A contract-bound effect interpreter converts request, state, and designated-feed claims into a Diagnostic Effect
Projection whose status is `committed`, `not_committed`, `ambiguous`, or `unknown`. A bounded
`count_by_correlation` evaluator may count only normalized committed effects with permitted commitment bases. A
violated evaluation creates a deterministic Diagnostic Trigger and case. Evidence collection freezes on required
source completion or a durable first-party deadline.

The deterministic Evidence Selection Policy starts from the exact violated evaluation, traverses only permitted typed
edges, includes contradictions, unresolved relationships, coverage, conflicts, and exact interpretation
dependencies, applies redaction, pins selected artifacts, and freezes an immutable Diagnostic Evidence Package. Its
manifest explicitly separates governed interpretation dependencies, authenticated observations, deterministic
derived facts, and coverage and limitations. The Assignment Service then creates one immutable unclaimed Diagnostic
Assignment. Assignment creation grants no authority.

The proof is staged. Test 1 ends at assignment creation with no model contact. Test 2 asks Kernel to authorize one
exact worker, then runs it in a fresh container with read-only input, bounded output, temporary scratch, no provider
credential, no general network, and model access only through a run-bound Model Broker. Test 3 uses an explicit
Diagnostic Consistency Test Policy to create three fresh assignments over the same frozen package and requires all
three structured diagnoses to identify the supported scope mismatch without unsupported implementation claims.

## User Stories

1. As a Builder, I want Kernel evidence assembled without controller curation, so that a diagnosis is independently defensible.
2. As a Builder, I want the same evidence chain reproducible from immutable receipts, so that debugging does not depend on current database state.
3. As a Builder, I want external observations distinguished from Kernel authority truth, so that telemetry cannot silently grant authority.
4. As a Builder, I want two source deliveries mapped to one Logical Operation Identity, so that retries are distinguishable from new business work.
5. As a Builder, I want delivery, execution, request, and resource identities preserved separately, so that one identifier cannot flatten the workflow.
6. As a Builder, I want correlation based on explicit propagated identities, so that models do not guess joins from names, email addresses, or timestamps.
7. As a Builder, I want unresolved correlation reported explicitly, so that missing identity cannot become a confident edge.
8. As a Builder, I want request success separated from destination commitment, so that HTTP acknowledgement does not become effect truth.
9. As a Builder, I want designated provider commit feeds interpreted through exact contracts, so that feed claims are normalized deterministically.
10. As a Builder, I want ambiguous writes to remain ambiguous without reconciliation evidence, so that retries do not hide uncertain state.
11. As a Builder, I want a generic count invariant for one logical operation, so that duplicate committed effects open a case automatically.
12. As a Builder, I want Behavior Contracts to state outcomes without embedding root causes, so that diagnosis remains an inference from evidence.
13. As a Builder, I want Integration Behavior Contracts to describe provider semantics without defining workflow mappings, so that configuration cannot leak the answer.
14. As a Builder, I want a Diagnostic Trigger created deterministically, so that repeated projections do not open duplicate cases.
15. As a Builder, I want evidence collection to wait for required roles or a durable deadline, so that asynchronous observers do not create arbitrary package timing.
16. As a Builder, I want an evidence package to disclose why each receipt was selected, so that bounded evidence is inspectable rather than mysterious.
17. As a Builder, I want contradictory observations included through deterministic policy, so that minimization cannot become confirmation bias.
18. As a Builder, I want stream gaps and missing roles visible, so that incomplete evidence lowers confidence honestly.
19. As a Builder, I want late evidence to create a new package revision only when material, so that frozen diagnoses never drift silently.
20. As a Builder, I want historical diagnoses remain bound to exact packages, so that later evidence cannot rewrite prior reasoning.
21. As a Customer Owner, I want each observer to have its own Principal, grant, key, stream, and scope, so that provenance is technically meaningful.
22. As a Customer Owner, I want the webhook observer unable to report CRM effects, so that one adapter cannot impersonate another evidence source.
23. As a Customer Owner, I want observer authorization prove reporting scope rather than truthfulness, so that trust labels remain honest.
24. As a Customer Owner, I want revocation stop future reporting without invalidating historical receipts, so that key lifecycle does not rewrite history.
25. As a Customer Owner, I want gap-tolerant streams, so that one lost report does not halt all later diagnostic evidence.
26. As a Customer Owner, I want exact replays return the existing receipt, so that reporter retries are safe.
27. As a Customer Owner, I want sequence and identity reuse with changed bytes preserved as conflicts, so that tampering or corruption remains visible.
28. As a Customer Owner, I want canonical receipt time established by the Diagnostic Plane, so that observer clocks do not become first-party facts.
29. As a Customer Owner, I want sensitive detail redacted before submission, so that the Diagnostic Plane does not become a raw business-data archive.
30. As a Customer Owner, I want low-entropy identifiers protected from dictionary attacks, so that digests do not leak customer data.
31. As a Customer Owner, I want source identity equality shown without raw submission IDs, so that workers receive only necessary identity information.
32. As a Customer Owner, I want idempotency-key equality shown without raw keys, so that diagnosis does not disclose operational key material.
33. As a Customer Owner, I want tokenization scoped by installation, environment, integration, and purpose, so that identifiers cannot correlate across unintended domains.
34. As a Customer Owner, I want tokenization audited and rate-limited, so that it cannot become an identifier-guessing oracle.
35. As a Customer Owner, I want raw identity detail encrypted and selected only under exact policy, so that disclosure remains exceptional.
36. As a Customer Owner, I want package-selected artifacts retained through review and audit, so that diagnoses remain inspectable.
37. As a Customer Owner, I want governed erasure remain possible, so that immutability does not make sensitive bytes immortal.
38. As a Customer Owner, I want erasure leave immutable tombstones and limitations, so that privacy does not rewrite history invisibly.
39. As a Customer Owner, I want active worker runs cancelled when policy-driven erasure requires it, so that deleted material is not retained in temporary workspaces.
40. As a Customer Owner, I want provider-retention limitations stated honestly, so that local deletion is not misrepresented as universal deletion.
41. As an Adapter Builder, I want one canonical observation protocol, so that every evidence source follows the same replay, conflict, storage, and retention semantics.
42. As an Adapter Builder, I want observation schemas supplied by exact Operational Package artifacts, so that adapters cannot invent semantics at intake.
43. As an Adapter Builder, I want grants authorize exact schema ID, version, and digest, so that matching names cannot substitute changed definitions.
44. As an Adapter Builder, I want unknown schemas fail closed with bounded rejection records, so that invalid input is auditable without retaining arbitrary bodies.
45. As an Adapter Builder, I want one observation per request, so that atomicity and retries remain unambiguous.
46. As an Adapter Builder, I want bounded request pipelining, so that reporting throughput does not require batch semantics.
47. As an Adapter Builder, I want one optional detail artifact committed CAS-first, so that accepted receipts never reference missing bytes.
48. As an Adapter Builder, I want exact replay permitted without resending detail bytes, so that retries remain efficient.
49. As an Adapter Builder, I want a compatibility path for existing runtime envelopes, so that current integrations continue working.
50. As an Adapter Builder, I want compatibility translation preserve original envelope and translator provenance, so that migration remains auditable.
51. As an Adapter Builder, I want missing legacy fields remain explicit limitations, so that translation cannot invent attestation claims.
52. As an n8n Operator, I want the exact published workflow bound before execution, so that runtime evidence can confirm or contradict a known revision.
53. As an n8n Operator, I want normalization use metadata from the pinned runtime image, so that provider defaults are not handwritten per workflow.
54. As an n8n Operator, I want unknown node semantics fail readiness, so that unsupported behavior cannot receive an attested binding.
55. As an n8n Operator, I want successful execution snapshots retained and independently read, so that attestation does not trust the affected workflow.
56. As an n8n Operator, I want runtime mismatch open an attestation failure rather than update the expected digest, so that execution cannot define expectation.
57. As an n8n Operator, I want workflow changes require a new Agent Revision and readiness binding, so that material drift remains visible.
58. As an Operations Engineer, I want customer delivery journaled before forwarding, so that no operation proceeds without correlation provenance.
59. As an Operations Engineer, I want forwarding and reporting handled by independent durable loops, so that Diagnostic Plane outages do not normally block business work.
60. As an Operations Engineer, I want unreported journal depth and age monitored, so that evidence backlog is visible.
61. As an Operations Engineer, I want journal pressure never silently discard evidence, so that retention exhaustion becomes an explicit operational incident.
62. As an Operations Engineer, I want each diagnostic stage process committed events idempotently, so that retries cannot duplicate projections or assignments.
63. As an Operations Engineer, I want one deterministic identity producing different content treated as critical nondeterminism, so that the platform cannot choose arbitrary truth.
64. As an Operations Engineer, I want failed transitions visible with bounded errors and replay eligibility, so that poison events do not disappear into an opaque queue.
65. As an Operations Engineer, I want outbox events carry references and digests rather than business artifacts, so that messaging does not become a second evidence store.
66. As an Operations Engineer, I want private intake, read, and administration surfaces separated, so that network reachability does not imply broad access.
67. As an Operations Engineer, I want signed envelopes required on private networks, so that network trust never replaces durable provenance.
68. As an Operations Engineer, I want separate database roles for API, worker, scheduler, verifier, and Kernel, so that deployment boundaries remain meaningful.
69. As an Operations Engineer, I want one coherent Stage Worker in v1, so that durable logical separation does not require six microservices.
70. As an Operations Engineer, I want stage allowlists supported later, so that the same records can scale into isolated workers without protocol changes.
71. As a Diagnostic Worker, I want one exact read-only evidence package, so that my reasoning is bounded and reproducible.
72. As a Diagnostic Worker, I want structured causal output fields, so that consistency can be measured without comparing prose.
73. As a Diagnostic Worker, I want evidence references resolve within my package, so that every factual claim is inspectable.
74. As a Diagnostic Worker, I want missing evidence disclosed, so that I can distinguish uncertainty from absence.
75. As a Diagnostic Worker, I want no repair or external-effect tools, so that diagnosis cannot become an ambiently privileged workflow.
76. As a Diagnostic Worker, I want model access without provider credentials in my container, so that credentials remain customer-controlled.
77. As a Dispatcher, I want assignment creation grant no authority, so that available work cannot launch itself.
78. As a Dispatcher, I want Kernel verify the exact worker, Passport, model, image, isolation, network, data, and resource proposal, so that dispatch is specific.
79. As a Dispatcher, I want one short-lived single-use authorization per Worker Run, so that stale authority cannot launch duplicate work.
80. As a Dispatcher, I want Diagnostic Plane claim be atomic, so that competing dispatch attempts cannot run one assignment twice.
81. As a Dispatcher, I want retries require a new linked assignment and authority decision, so that failed work remains attributable.
82. As a Platform Maintainer, I want the Test Orchestrator exit before stimulus, so that privileged setup cannot curate incident evidence.
83. As a Platform Maintainer, I want Scenario Stimulus access only the webhook endpoint, so that the test input cannot inspect its own result.
84. As a Platform Maintainer, I want the Acceptance Verifier read only public APIs, so that hidden assertions cannot influence tested state.
85. As a Platform Maintainer, I want the runtime supervisor hold no evidence-authoring credential, so that process sequencing cannot manufacture success.
86. As a Platform Maintainer, I want Test 1 contact no model, so that deterministic platform failures are isolated from model behavior.
87. As a Platform Maintainer, I want Test 2 reuse the exact Test 1 package, so that worker execution cannot quietly change evidence.
88. As a Platform Maintainer, I want Test 3 run three independent assignments with one fixed configuration digest, so that model consistency is measured fairly.
89. As a Platform Maintainer, I want the hidden rubric committed before dispatch, so that scoring cannot change after responses are seen.
90. As a Platform Maintainer, I want 3/3 structured diagnoses pass, so that the first consistency claim is strict and understandable.
91. As a Platform Maintainer, I want platform reproducibility reported separately from model consistency, so that deterministic and probabilistic behavior are not conflated.
92. As a Platform Maintainer, I want all three diagnoses preserved separately, so that no consensus rewrite erases variance.
93. As a prospective customer, I want to see Kernel produce a useful assignment from ordinary webhook traffic, so that the platform value does not depend on a human evidence curator.
94. As a prospective customer, I want a blind worker identify the delivery-scoped idempotency mechanism, so that the platform demonstrates actionable specificity.
95. As a prospective customer, I want the worker avoid claiming an unseen workflow node, so that the diagnosis respects its epistemic boundary.
96. As a prospective customer, I want zero forbidden worker effects proven by runtime enforcement, so that `actions_taken: []` is not the only safety evidence.
97. As a Diagnostic Worker, I want a neutral mechanism taxonomy with several valid values, so that my output schema does not reveal the expected diagnosis.
98. As a Customer Owner, I want HMAC attribution described honestly, so that shared-secret verification is not misrepresented as exclusive authorship.
99. As a Platform Maintainer, I want Diagnostic Plane intake consume signed grant snapshots without authority-database access, so that receipt ownership stays in the correct plane.
100. As a Platform Maintainer, I want grants activate only after readiness binding, so that execution evidence cannot define its own expected revision.
101. As a Customer Owner, I want tokenization use separately authorized from observation reporting, so that observers cannot access an arbitrary equality oracle.
102. As a Platform Maintainer, I want cutoffs identify a stable committed prefix across concurrent streams, so that projection inputs cannot change after freeze.
103. As a Customer Owner, I want active evidence collection retain early artifacts, so that delayed observers cannot race ordinary garbage collection.
104. As an Acceptance Verifier, I want exact canonical inputs exposed for independent recomputation, so that the Stage Worker never validates itself.
105. As a Tokenization Service Operator, I want applied grant state and signed result-receipt transport, so that equality claims are independently verifiable.
106. As a Platform Maintainer, I want grant publication acknowledged only after durable application, so that configured and effective authority cannot diverge.
107. As an Acceptance Verifier, I want every committed intake outcome through cutoff, so that omitted eligible receipts are detectable.
108. As a Customer Owner, I want controller exclusion claims limited to a trusted-host model, so that container manifests are not overstated as hostile-host proof.
109. As an Operations Engineer, I want cumulative retention formulas, so that individually valid intervals cannot produce an invalid total horizon.
110. As a Platform Maintainer, I want every authoritative ADR referenced by the spec, so that implementation does not miss later corrections.
111. As a Customer Owner, I want agent judgment compressed into temporal evidence-linked claims without granting
     authority, so that changing-world intelligence remains useful, inspectable, and honest about uncertainty.

## Implementation Decisions

### Product And Proof Boundary

- Implement one customer-controlled installation and environment. Retain explicit installation, environment,
  binding, schema, contract, grant, and stream identities in every protocol.
- Use the existing repository and extend the current Diagnostic Plane, Kernel, n8n Operational Package, Agency Lab,
  Postgres, CAS, and black-box acceptance infrastructure.
- The primary product proof is stimulus-only canonical evidence construction, not generic observability or repair.
- Preserve the existing v0.2 behavior and release path. Canonical diagnostics extend rather than reinterpret governed
  Kernel Runs, Effects, existing repair authority, or release qualification.
- The hidden defect remains delivery-scoped idempotency for one duplicate lead-form operation. The controller answer
  key never enters contracts, observations, packages, assignments, or worker mounts.

### Plane And Authority Ownership

- Customer adapters report observations to the Diagnostic Plane.
- First-party deterministic Diagnostic Services preserve, correlate, interpret, evaluate, package, and create
  unclaimed assignments.
- Kernel Authority Services own Principals, Agent Passports, Observation Reporting Grants, governed configuration
  activation, and Diagnostic Dispatch Authorizations.
- Diagnostic Plane intake, not Kernel, verifies observation bytes and authors Diagnostic Observation Receipts.
- Kernel supplies exact active grant state only through signed Observation Grant Activation Snapshots on a dedicated
  one-way authority feed. Diagnostic Plane receives no general Kernel authority-database access.
- Diagnostic Plane records remain non-authoritative observations or deterministic diagnostic derivations.
- Kernel authority state stores only Diagnostic Plane identities and digests when adjudicating governed actions; it
  does not copy observation or evidence bytes.
- Assignment creation describes available work and grants no execution, model disclosure, credential, or resource
  authority.

### Epistemic And Intelligent Processing Boundary

- Use D0 for closed deterministic computation, D1 for deterministic computation over a frozen retrieved snapshot,
  A1 for bounded agent interpretation over frozen evidence, and A2 for separately governed open-world investigation.
  `NOT_ESTABLISHED` is a claim-support outcome, not a processing profile.
- Preserve one minimal Claim Envelope over existing immutable records rather than creating a second evidence store.
  It binds a typed proposition, production profile, evidence and prior-claim references, verification results,
  asserted and effective support, evidence status, temporal scope, limitations, supersession, and authority decision.
- Agent confidence and sign-off are attributed interpretation metadata. Software alone computes effective assurance
  and permitted consequence from admissibility, completeness, freshness, source independence, risk, scope, and
  approvals.
- Keep event or valid time, observation or retrieval time, system acceptance time, assessment time, and freshness or
  expiry distinct. New evidence creates immutable superseding revisions rather than rewriting historical evidence.
- Govern changing-world retrieval through bounded connectors that preserve exact source identity, bytes or digest,
  retrieval time, and freshness. Diagnostic workers do not gain general network or execution authority.

### Acceptance Principals

- Test Orchestrator registers immutable packages, schemas, contracts, Deployments, observers, and inactive Reporting
  and Tokenization Use Grants after the trusted bootstrap launcher starts the Compose environment.
- Readiness enters `readiness_pending`, completes exact provider and retention checks, and creates the Workflow
  Attestation Binding plus readiness receipt.
- Kernel publishes signed desired-state Observation and Tokenization Grant Activation Snapshots only after binding.
- Diagnostic Plane and Tokenization Service durably apply their exact snapshots and return signed application
  receipts. Grant activation becomes effective at those application transactions; Kernel records
  `active_effective` only after verifying the receipts.
- The Test Orchestrator may seal the manifest, relinquish credentials, and exit only after every required application
  receipt is verified. Stimulus cannot start earlier.
- Authority transitions carry monotonic sequence and predecessor digests. Acceptance verifies record order rather
  than comparing timestamps.
- The sealed manifest binds image, Deployment, contract, schema, normalizer, projector, evaluator, and policy digests.
- Scenario Stimulus is a separate one-shot Principal and container with a short-lived token, exactly two allowed
  requests, and access only to the Customer Ingress Adapter. It records transport responses and exits.
- Acceptance Verifier starts only after stimulus destruction. It has read-only access to triggers, cases,
  projections, packages, assignments, runs, diagnoses, receipts, and audit records through public read APIs.
- A one-shot trusted bootstrap launcher starts the Compose environment and is outside the in-test Principal model.
  Scenario sequencing then uses one-shot dependencies and a runtime supervisor with no Docker socket, secret-store
  authority, host mounts, observation, evidence, assignment, worker, or authority credential.
- Separate tokens, mounts, networks, and containers prevent role inheritance.
- Observer HMAC keys are provisioned outside the orchestrator, stimulus, Acceptance Verifier, and runtime supervisor.
  Environment and mount manifests establish configured exclusion only under a trusted customer-host and Docker-daemon
  threat model. They do not prove exclusion against a hostile host or bootstrap launcher.

### Observation Schemas And Activation

- Core owns the base envelope, canonical JSON, authentication preimage, envelope and receipt digests, timestamp and
  sequence primitives, size limits, and rejected-intake semantics.
- Signed Operational Packages export immutable schema artifacts under a restrictive Core meta-schema.
- An exact Deployment activates schema ID, version, and digest for one installation and environment.
- Observation Reporting Grants authorize exact schema tuples; matching name and version with a different digest
  fails closed.
- V1 implements only `source.delivery`, `runtime.execution`, `destination.request`, `destination.effect`, and
  `destination.snapshot`.
- `destination.contract` is not an observation. Integration Behavior Contracts are governed configuration.
- Unknown or unauthorized schemas create bounded Rejected Intake Records. Invalid bodies are not retained by default.
- Existing receipts are never rewritten or silently upcast when schemas evolve.

### Signed Observation Envelope

- Every schema permits only the typed claims relevant to that observer. Claims required for deterministic
  correlation or evaluation must be in the signed envelope rather than parsed later from opaque detail.
- The signature preimage binds a domain separator, Principal, grant, key, signed time, and canonical envelope JSON.
- The envelope carries observation identity and type, exact schema, adapter binding, installation and environment,
  workflow or integration scope, logical-operation and role-specific identities, occurred and observed times,
  limitations, redaction, stream, sequence, and optional detail digest and media type.
- Diagnostic Plane establishes authoritative `received_at`. Observer `occurred_at`, `observed_at`, and `signed_at`
  remain attributed claims with distinct meanings.
- Diagnostic Plane intake computes the canonical envelope digest, verifies optional detail, records authentication,
  assigns the committed intake position, and authors the receipt digest binding provenance and receipt time. Kernel
  never processes observation bytes or computes Diagnostic Observation Receipts.
- Kernel publishes signed immutable Observation Grant Activation Snapshots through a dedicated one-way authority
  feed. Diagnostic Plane stores only this exact grant projection and never reads the general authority database.
- Diagnostic Plane applies each activation or revocation snapshot in one durable transaction and signs an
  Observation Grant Application Receipt binding snapshot digest, authority sequence, applied state, service
  verification identity, transaction position, and application time.
- Diagnostic Plane and Tokenization Service submit one signed application receipt to Kernel through private
  `POST /authority/v0/grant-application-receipts`. Kernel validates the registered service Principal, signature,
  snapshot digest, authority sequence, predecessor, target state, and service transaction identity, then preserves
  the exact receipt bytes and records the effective authority transition.
- Grant activation becomes effective at that application transaction. Kernel records `active_effective` only after
  verifying the application receipt; manifest seal and stimulus delivery wait for that state.
- Intake binds grant-snapshot identity, digest, authority sequence, and freshness to every receipt and fails closed
  when the snapshot is stale, missing, mismatched, or revoked.
- Accepted receipt means an authorized observer reported exact bytes under an active grant. It does not assert that
  the reported external claim is true. Under HMAC it also does not prove exclusive observer authorship.

### Intake API And Result Semantics

- Add canonical `POST /diagnostic/v0/observations` on the private intake surface.
- Add canonical `POST /diagnostic/v0/tokenization-result-receipts` on a separate private service-authenticated
  intake surface. It accepts one exact signed Tokenization Result Receipt and no observation envelope.
- Accept one signed envelope and zero or one bounded attached detail artifact per request.
- New acceptance returns `201`; exact replay returns `200`; identity or sequence conflict returns `409`; malformed
  envelope returns `400`; schema validation failure returns `422`; authentication or grant failure returns `401` or
  `403`; oversize detail returns `413`; transient pressure or availability returns `429` or `503`.
- An Observation Intake Result binds receipt or conflict identity, envelope digest, verified artifact digest, grant,
  stream, sequence, accepted or replayed status, and authoritative receipt time.
- Reporters mark journal entries reported only after validating the result.
- Reporters may pipeline a bounded number of requests. Sequence remains journal order; completion order may create
  temporary gaps without changing semantics.
- Detail bytes accompany the first submission and are streamed into bounded temporary storage. Exact replay may omit
  bytes after the existing receipt and CAS object are verified.
- Several logical files must become one bounded redacted canonical artifact or manifest.

### CAS-First Intake And Persistence

- Stream detail into bounded temporary storage, enforce media and size policy, compute its digest, and compare it to
  the signed reference.
- Commit detail durably to the deterministic CAS key before opening the receipt transaction.
- Local CAS commitment uses a same-filesystem temporary file, flush, atomic rename, directory flush, and refusal to
  overwrite an existing digest path with different material.
- Final intake persistence acquires one installation-local transaction lock, rechecks replay and conflict identity,
  allocates the next contiguous Diagnostic Committed Intake Position from transactional state, inserts the preserved
  outcome and artifact metadata, updates coverage, records transitions, writes outbox, advances the counter, and
  holds the lock through commit.
- Accepted receipts, authenticated conflicts, and retained rejections receive committed intake positions. Rollback
  rolls back the position advance, so no uncommitted allocation appears in a cutoff.
- An accepted receipt may never reference a missing CAS object. A CAS object without a database row is an acceptable
  temporary orphan.
- Delayed mark-and-sweep garbage collection scans every immutable reference and pending upload after a conservative
  grace period.
- Garbage collection rechecks ordinary retention, active Evidence Collection Retention Leases, Artifact Retention
  Pins, and legal holds under lock before deletion and tombstoning.

### Reporting Grants And Streams

- Every deployed observer has a stable deterministic Principal, separate Observation Reporting Grant, dedicated
  HMAC key, and preferably one stream.
- A grant binds Principal, installation, environment, exact adapter binding and digest, allowed observation schemas,
  workflow or integration scope, stream, validity, key, rate, and payload limits.
- The webhook observer cannot report CRM observations; n8n cannot report source or destination state; the CRM
  observer reports only its bound integration roles.
- Revocation begins as `revocation_pending`. The previously applied state remains effective until Diagnostic Plane
  durably applies the signed revocation snapshot. Reports committed before that transaction remain historically
  valid; later reports fail closed. Kernel records `revoked_effective` only after verifying the application receipt.
- Key rotation preserves exact historical key and grant attribution.
- HMAC provides observer-specific authenticated attribution. The Diagnostic Plane verification-key holder can also
  sign, so v1 does not claim exclusive authorship. Asymmetric signing remains the path to that stronger claim.
- Test controllers possess no observer key. A separate local provisioning boundary delivers observer and Diagnostic
  Plane intake-verifier copies without exposing secrets in orchestrator, stimulus, Acceptance Verifier, or supervisor
  state.
- The one-shot key-provisioning job returns only key ID and an immutable provisioning receipt. The Test Orchestrator
  references that key ID when registering the inactive grant; Diagnostic Plane maps it to verification material in a
  separate secret store.
- Per `(grant_id, stream_id)`, exact sequence, observation identity, and digest replay returns the existing receipt.
- Reused sequence or observation identity with changed material produces a preserved rejected conflict.
- A new sequence above the high-water mark is accepted and records a compact missing range. Late arrivals shrink or
  split gaps without mutating prior receipts.
- Stream Coverage Projection records high-water mark, contiguous-through, received ranges, missing ranges, status,
  and last receipt time at an exact cutoff.
- Sequence orders only one stream. It does not prove cross-stream time, causality, or completeness.
- Stream sequence advance, integer bounds, request rate, and payload limits prevent pathological gap creation.

### Customer Ingress And Observation Journal

- Before forwarding, the Customer Ingress Adapter performs one local durable transaction that resolves or creates
  the Logical Operation Identity, inserts a distinct delivery attempt, stores redacted claims and digests, and marks
  forwarding pending.
- A uniqueness constraint over source binding and stable source-operation identity ensures redeliveries reuse the
  same Logical Operation Identity.
- Failure to commit the local journal or identity mapping fails the ingress attempt. Diagnostic Plane unavailability
  does not normally block forwarding after journal commitment.
- Independent forwarder and reporter loops consume the journal. No transaction spans journal, n8n, and Diagnostic
  Plane.
- The forwarder propagates the logical-operation token, follows exact retry policy, records attempts and responses,
  and reuses one forwarding identity for retries of one uncertain send.
- The reporter converts journal records into signed typed observations in journal order, retries independently,
  stores accepted receipt identities, and resumes after outages.
- Monitor oldest unreported age, unreported count, disk use, retry rate, last accepted sequence, and projected
  retention exhaustion.
- Journal pressure never silently discards unreported records. Emergency loss creates a durable loss marker and
  high-severity coverage alert.
- Raw payloads needed for forwarding are encrypted and short-lived. Durable journal state retains only normalized
  claims, digests, status, and correlation material.

### Identity Minimization And Correlation

- The earliest trustworthy customer boundary creates one opaque Logical Operation Identity and propagates it
  unchanged. Retries share it; deliveries, executions, requests, and resources have distinct identities.
- A Source Identity Token represents stable source equality only inside one installation, environment, source
  binding, and namespace. It is nonreversible, versioned, domain-separated, and treated as sensitive pseudonymous
  metadata.
- A Source Identity Mapping Receipt binds the token to the Logical Operation Identity, mapping service, source
  binding, journal sequence, and journal record digest before forwarding.
- `source.delivery` exposes opaque logical-operation, delivery, source-token, correlation-basis, and mapping
  provenance claims. Raw customer source identity is excluded by default.
- A dedicated customer-side tokenization service issues Exact-Value Equality Tokens over exact length-delimited
  bytes for the integration-specific idempotency comparison namespace.
- The Tokenization Service runs as its own Principal and holds domain-separated secrets unavailable to observers and
  Diagnostic Plane.
- Kernel issues separate Tokenization Use Grants; Observation Reporting Grants never authorize tokenization.
- A Tokenization Use Grant binds requester Principal, installation, environment, integration, exact field role,
  namespace and algorithm version, byte limit, collection window, rate limit, and service binding.
- Kernel publishes signed Tokenization Grant Activation Snapshots through a dedicated one-way authority feed. The
  Tokenization Service durably applies each activation or revocation snapshot and signs a Tokenization Grant
  Application Receipt. Activation or revocation becomes effective at that application transaction, and Kernel
  records the effective state only after verifying the receipt.
- Source and destination observers may tokenize only their designated delivery-identity and idempotency-key fields.
- Every successful call creates a Tokenization Result Receipt binding service and requester, grant, field role,
  namespace, version, result token, timing, and bounded request provenance without raw input or an unsalted digest.
- Each result receipt binds the exact Tokenization Grant Activation Snapshot and Tokenization Grant Application
  Receipt identities and digests under which the request was accepted.
- The Tokenization Service signs each result receipt with its registered asymmetric service identity and submits the
  exact signed result receipt, Grant Activation Snapshot, and Grant Application Receipt bytes to the canonical private
  Diagnostic Plane receipt endpoint before any observation cites it.
- Diagnostic Plane validates the Kernel signature on the Grant Activation Snapshot, the Tokenization Service signature
  and bindings on the Grant Application Receipt, service identity and public-key registration, effective applied grant,
  result-receipt signature and digest, requester, field role, namespace and version, collection window, rate and byte
  limits, and token. It then preserves the complete signed proof chain immutably. Exact replay returns the existing
  receipt; changed material under a reused identity returns conflict.
- Observation claims cite the exact Tokenization Result Receipt identity and digest. Observation intake accepts the
  reference only when the preserved receipt exists and every cited Principal, grant, field, namespace, version, and
  token matches the observation claim.
- Exact-string tokenization performs no trimming, folding, Unicode normalization, or coercion.
- Different tokenization versions produce unresolved equality unless an exact governed bridge exists.
- Correlation never silently uses email, company name, time proximity, arbitrary payload parsing, or model similarity.

### Immutable Correlation Projection

- A Correlation Projection is an immutable deterministic artifact over an exact Diagnostic Committed Intake Position
  cutoff, receipt-set manifest, contract and registration digests, and projector artifact and rules.
- Cutoff capture acquires the same installation-local finalization lock and records the highest committed position.
  All preserved intake outcomes at or below it form a stable committed prefix; future commits receive higher
  positions. A database sequence allocated before commit is not a valid cutoff mechanism.
- It canonically orders nodes and edges. Every edge records correlation basis and exact supporting claim locations.
- For this case, it may derive only that each request key equals its corresponding delivery identity, the two request
  keys differ, and both deliveries share one logical operation.
- It may not call the relationship defective, identify a responsible workflow node, prescribe a key, or assert cause.
- Ambiguous or absent identity becomes an unresolved relationship, never a guessed edge.
- Retractions and corrections are new observations. Late receipts and contract changes create new revisions.
- Semantic projection digest excludes random IDs and creation time; a separate record digest binds creation metadata.
- Mutable graph indexes and latest pointers are disposable navigation aids and never evidence authority.

### Contracts And Leakage Controls

- The Behavior Contract permits only exact workflow and destination scope, logical-operation correlation role, CRM
  create operation, committed status, less-than-or-equal comparison, and threshold one.
- The Integration Behavior Contract permits only exact-string key location and comparison, matching-key behavior,
  append-only ledger identity, commit-record semantics, consistency window, and reconciliation behavior.
- Neither contract may contain retries, delivery-key selection, incident IDs, observed key counts, root cause,
  expected diagnosis, or workflow implementation location.
- Contract schemas use `additionalProperties: false` and prohibit arbitrary notes, metadata, defect paths, and
  implementation descriptions.
- IDs, display names, fixture names, comments, policy labels, schema descriptions, and filenames are neutral.
- Package provenance distinguishes contract owner and registration from observation, projection, evaluation, and
  packaging authorship.

### Diagnostic Effect Projection And Evaluation

- The effect interpreter consumes one exact Correlation Projection, relevant request, response, state, and
  designated-feed receipts, Integration Behavior Contracts, coverage, cutoff, and interpreter artifact and rules.
- It emits immutable normalized effects with logical operation, destination, operation, effect identity, request and
  resource references, status, commitment basis, supporting receipt digests, and limitations.
- Status is exactly `committed`, `not_committed`, `ambiguous`, or `unknown`.
- Every result is classified `diagnostic_derived_external_effect` with `authority: none`.
- Generic HTTP success means acknowledged unless the exact Integration Behavior Contract says it is durable commit
  acknowledgement.
- Direct `destination.effect` intake is allowed only for a contract-designated append-only commit or audit feed with
  a dedicated grant and stable event identity. It still passes through the interpreter.
- The bounded evaluator consumes only the exact Diagnostic Effect Projection, Behavior Contract, and evaluator
  artifact and rules.
- It has no code path to raw requests, response statuses, effect-feed claims, snapshots, or arbitrary detail.
- It counts only committed effects whose operation, destination, correlation role, and commitment basis match.
- Evaluation result is `satisfied`, `violated`, or `indeterminate`. Violation may be proven despite unrelated gaps;
  satisfaction requires adequate required-source coverage.
- Trigger identity derives deterministically from contract, correlation group, and proving evaluation evidence.

### Durable Diagnostic Pipeline

- Implement the stage order: observation accepted, correlation projection created, Diagnostic Effect Projection
  created, Behavior Evaluation Record created, Diagnostic Trigger created, evidence collection ready, Diagnostic
  Evidence Package frozen, Diagnostic Assignment created.
- Required-source completion or the durable scheduler emits evidence collection readiness.
- Every stage uses one local transaction: inbox deduplication, exact input load, deterministic identity and content,
  immutable insert or verification, transition record, outbox insert, commit.
- Outbox publication and consumption are at least once. Consumers tolerate duplicate and out-of-order delivery and
  load canonical inputs instead of trusting message payload ordering.
- Matching deterministic identity and digest returns the existing result. Matching identity with changed digest is a
  critical nondeterminism conflict and visibly halts that transition.
- Transition status is `pending`, `processing`, `succeeded`, `retryable_failed`, or `failed_transition`.
- Failure records bind stage, source event, input and code digests, bounded error, attempts, timing, next retry,
  terminal state, and governed replay eligibility.
- Code or policy changes create new immutable stage revisions rather than mutating failed history.

### Evidence Collection And Packaging

- Evidence role requirements are contract- and policy-specific, not a universal Core checklist.
- Deployment readiness computes cumulative retention from exact policy artifacts. Define
  `ordinary_retention_min = pretrigger_observation_horizon + pretrigger_pipeline_retry_horizon + gc_margin`, where
  `pretrigger_observation_horizon` is the maximum configured delay from earliest relevant external occurrence through
  receipt of every required observation, and the retry horizon is the cumulative maximum scheduling and retry time
  through correlation, effect interpretation, evaluation, and trigger creation.
- Define `collection_lease_min = collection_window + post_trigger_retry_horizon + gc_margin`, where the post-trigger
  horizon is the cumulative maximum scheduling and retry time through collection, packaging, and assignment.
  Collection lease duration is measured from Diagnostic Trigger commit.
- Readiness fails when configured retention is below either cumulative result, even when every individual interval
  would fit independently.
- Diagnostic Trigger creation transactionally creates an Evidence Collection Retention Lease over proving evaluation
  inputs and current correlation-group artifacts. Newly relevant material extends the lease during collection.
- The lease lasts through collection deadline and maximum stage retry. Package freeze converts selected references to
  Artifact Retention Pins before releasing the lease; failed collection expires only after its retry horizon.
- Duplicate-delivery completion requires source deliveries, terminal runtime executions, destination requests,
  designated ledger commits, explicit correlation paths, and adequate coverage for all contributing streams.
- Cardinality is relational: every matched committed effect must have the required request, execution, and delivery
  ancestors.
- Destination snapshot is optional corroboration for this case. Its absence does not delay freeze or mark the package
  incomplete. A late snapshot creates a revision only when contradictory or materially interpretive.
- Ambiguous-write policies may require a post-request state observation with exact query scope, correlation,
  consistency, freshness, pagination, and completeness.
- Evidence Selection starts from the violated evaluation and matched committed effects, not a general operation-ID
  search.
- Selection follows only policy-allowed inbound typed edges, includes required ancestors, unresolved relationships,
  gaps, conflicts, coverage, and contradictions, and pins all interpretation dependencies by digest.
- When a selected observation or derived equality edge cites a Tokenization Result Receipt, selection follows the
  complete authenticated provenance dependency chain: signed result receipt, Tokenization Service verification
  identity, Tokenization Grant Activation Snapshot, and Tokenization Grant Application Receipt. These records are
  labeled `authenticated_provenance_dependency`, not observations or governed interpretation.
- Manifest classes are `governed_interpretation_dependencies`, `authenticated_observations`,
  `deterministic_derived_facts`, and `coverage_and_limitations`.
- Within `authenticated_observations`, a distinct `authenticated_provenance_dependencies` collection holds these proof
  records so their supporting role cannot be confused with observer claims.
- Disclosure accounting records why each receipt was selected, omitted detail classes and reasons, excluded related
  counts by type, unresolved relationships, and source completeness.
- No model selects initial evidence. Agents may request more evidence, but deterministic policy and governed authority
  decide whether a new package revision is produced.
- Freeze uses a Diagnostic Committed Intake Position cutoff and reason `required_sources_complete` or
  `collection_deadline`.
- Late observations never mutate a frozen package, projection, assignment, or diagnosis.

### Retention, Availability, And Erasure

- Package freeze verifies every selected claim, permitted detail artifact, and authenticated provenance dependency
  before acceptance.
- Transactionally create reference-based Artifact Retention Pins for every selected object and its complete proof
  dependencies with exact policy and expiry. Ordinary GC cannot select pinned objects.
- Unselected diagnostic objects use short configurable retention. Package-selected objects remain pinned through
  case, diagnosis, review, audit, and legal-hold retention.
- Governed security, privacy, or legal erasure may override pins without rewriting receipts or package manifests.
- Erasure produces an immutable Diagnostic Artifact Tombstone with digest, policy, reason, authorizing Principal and
  decision, request and completion times, verification, affected packages, and replica or provider limitations.
- Evidence Material Availability Projection reports `complete`, `partially_unavailable`, or `material_unavailable`.
- Existing diagnoses remain historical; their reproducibility degrades visibly and they are never silently rescored.
- Dispatch rechecks material availability. Required erasure expires unclaimed assignments, may cancel active runs,
  destroys ephemeral workspaces, and revokes broker tokens under exact policy.

### Runtime Attestation And Compatibility

- Before activation, readiness reads the exact published n8n workflow and provider version, pinned runtime image,
  node metadata, normalizer and rules, defaults, dependencies, and subworkflows and computes the normalized digest.
- Bind that digest to one exact Agent Revision before any Reporting Grant becomes active.
- Readiness verifies published workflow reads, immutable execution reads with detail, successful execution retention,
  read-only scopes, runtime identity, and complete normalizer coverage.
- Unknown node types, unavailable defaults, unsupported community nodes, dynamic unresolved dependencies, unknown
  expressions, or unidentified published versions fail readiness.
- Runtime observer independently reads each immutable execution snapshot, applies the same pinned normalizer, and may
  report accepted `runtime.execution` only on exact workflow, provider version, and digest match.
- Mismatch creates an attestation-failure diagnostic record and never learns or replaces the expected digest.
- Existing `POST /diagnostic/v0/runtime-events` verifies the legacy envelope and HMAC, runs a deterministic
  compatibility translator, submits canonical `runtime.execution`, and returns a legacy-shaped response.
- Translation exposes only fields directly signed or present in independently verified digest-committed detail.
- Canonical receipts preserve legacy envelope, authentication, endpoint, protocol, translator artifact and rules,
  translated claims, and limitation digests.
- Existing External Activity Trace reads become compatibility projections over canonical receipts rather than a
  separate evidence authority.

### Assignment And Dispatch Authority

- Diagnostic Plane Assignment Service creates one immutable `unclaimed` assignment under activated policy.
- It binds case, exact package, instruction, output schema, required Passport class, capabilities and prohibitions,
  model and runtime requirements, isolation and mount policies, network policy, resources, expiry, and assignment
  policy digest.
- It contains `authority_granted: none` and attaches no worker, model credential, or execution capability.
- Dispatcher proposes exact assignment and package digests, worker Principal and active Passport, Worker Run ID,
  image and isolation, model and broker policy, resources, data classification, egress, and expiry to Kernel.
- Kernel verifies assignment state, every digest, Passport scope, zero external-effect authority, runner controls,
  data residency, resource bounds, evidence availability, and authorization conflicts.
- Kernel issues a short-lived single-use Diagnostic Dispatch Authorization bound to one assignment, worker, run,
  runtime, model, broker, resource policy, dispatcher and runner audience, nonce, and validity.
- Dispatcher presents authorization to the Diagnostic Plane claim endpoint. Diagnostic Plane atomically transitions
  `unclaimed` to `claimed` and creates the Worker Run.
- Only the successful claimant may acquire the run-scoped broker token. Authorization is consumed once.
- Assignments never return to unclaimed. Retry creates a new linked assignment and new authority decision.

### Worker Isolation And Model Broker

- Every Worker Run uses a fresh container with read-only `/input`, bounded writable `/output`, bounded tmpfs `/tmp`,
  and read-only image root.
- HOME and CODEX_HOME are ephemeral under tmpfs. Never mount the user profile, repository, workspace, SSH material,
  cloud credentials, provider credentials, database credentials, or Docker socket.
- Run non-root, drop all capabilities, enable no-new-privileges, pin seccomp and available LSM policy, deny devices and
  host namespaces, and enforce PID, CPU, memory, wall-time, storage, and output limits.
- Pin container image by digest.
- Worker receives no provider API key or Codex login profile. It can reach only the internal Model Broker.
- Broker grant is short-lived and bound to assignment, Worker Run, model, configuration, request and token budgets,
  expiry, audience, network policy, and evidence classification.
- No general DNS, internet, LAN, metadata service, Kernel API, Diagnostic API, or database access is available.
- Worker writes only expected `diagnosis.json`. After exit, dispatcher opens without following links, rejects
  unexpected or oversized output, validates exact schema, computes digests, and submits under dispatcher authority.
- Run provenance includes assignment, package, worker, Passport, image, runtime, isolation, mounts, environment,
  network, broker, model, limits, timing, exit, resource use, log digests, and output validation.
- Claims are limited honestly: isolation is technically enforced and auditable but not cryptographic proof against a
  compromised host or runtime.

### Diagnostic Output And Consistency

- Diagnosis output uses one neutral reusable Diagnostic Mechanism Taxonomy with several valid mechanism categories,
  observed and required identity scopes, evidence statuses, and implementation-location states.
- Worker-visible schema may not contain single-value enums, fixture-specific examples, defaults, descriptions, or
  conditional branches that narrow the response to the expected tuple.
- The expected category `identity_scope_mismatch`, observed scope `delivery`, required scope `logical_operation`, and
  implementation location `not_proven` exist only in the preregistered hidden rubric.
- Leakage validation covers every worker-visible byte, including instructions, schemas, policy labels, IDs,
  filenames, mount manifests, descriptions, examples, defaults, and conditional schema branches.
- It includes observed facts, primary hypothesis, confidence, alternatives, exact citations, missing evidence,
  recommended investigation, and actions taken.
- Test 3 is authorized by an exact Diagnostic Consistency Test Policy despite the normal one-assignment default.
- Three assignments bind one package, instruction, output schema, model snapshot claim, reasoning and sampling
  settings, limits, image, isolation, mount, broker, and tool policy.
- A Worker Run Configuration Digest excludes only assignment, run, worker, ephemeral credential, and timestamps.
- If model snapshot or seed cannot be verified, record that limitation and narrow the reproducibility claim.
- Hidden verifier rubric, artifact, version, expected package digest, and rubric digest are committed before dispatch
  and remain inaccessible to workers.
- Each diagnosis is scored independently. There is no majority rewrite or synthesized consensus diagnosis.

### Deployment Shape

- Use Docker Compose, one Postgres deployment with logically separate Kernel authority and Diagnostic Plane state,
  and local filesystem CAS.
- Deploy one Diagnostic Plane API container for intake and role-scoped reads, one durable Stage Worker image, one
  scheduler process, separate Kernel authority service, separate Tokenization Service, separate observer containers,
  and separate dispatcher, runner, and Model Broker.
- Use dedicated one-way authority feeds for Observation and Tokenization Grant Activation Snapshots. Each receiving
  service exposes only the narrow signed application-receipt return path needed for Kernel to verify effective state.
- A trusted one-shot bootstrap launcher may control Docker Compose and secret installation. The later runtime
  supervisor has no Docker socket, secret-store authority, host mounts, or diagnostic and authority credentials.
- Use a one-shot local HMAC key-provisioning job that installs one copy into the observer secret mount and one into the
  Diagnostic Plane verifier store, exposes only key IDs and provisioning receipts, and exits before orchestration.
- Diagnostic API never invokes pipeline stages synchronously.
- The shared Stage Worker records both its runtime service Principal and deterministic logical component provenance,
  including component, version, artifact, rules, package, Deployment, image, and input digests.
- Do not claim separately enforced component Principals inside one worker process.
- Separate Postgres roles for intake/API, pipeline worker, scheduler, read-only verifier, and Kernel authority.
- Stage Worker cannot report external observations, activate contracts, issue dispatch authority, launch workers, or
  access provider/model credentials.
- Support future stage allowlists in the same image without requiring them for v1.

### Network Shape

- Customer Ingress Adapter is the public edge and has no Diagnostic Plane read access.
- Diagnostic observation intake, read APIs, and internal administration remain private and separately authorized,
  even when one API container provides separate listeners.
- Local observers use private container networking plus signed envelopes.
- Signature, freshness, replay, schema, rate, size, audit, and rotation controls remain mandatory on private networks.
- Worker containers do not call Diagnostic Plane reads; dispatcher mounts exact evidence and submits validated output.

### Independent Verification Surface

- Add a role-scoped read API that exports one immutable Independent Diagnostic Verification Bundle for an exact
  package or stage lineage.
- The bundle contains every preserved accepted receipt, authenticated conflict, and retained rejection at every
  contiguous Diagnostic Committed Intake Position from `1..cutoff`, including exact canonical bytes or an immutable
  erasure tombstone. It is not limited to inputs selected by the production Stage Worker.
- It also contains exact schemas, contracts, signed Tokenization Result Receipt bytes and Tokenization Service
  verification identities, Observation and Tokenization Grant Activation Snapshots and Application Receipts, stream
  coverage, projector, interpreter, evaluator and selection rule artifacts, and published canonical input manifests.
- The API returns inputs and published results; it does not call the Stage Worker or return a precomputed verifier
  answer.
- Acceptance Verifier runs in a separate container and code path with its own image and verifier artifact digest.
- The verifier first checks that positions `1..cutoff` are complete and contiguous, then independently determines
  which outcomes are eligible under the pinned rules. Any omitted position, unexplained tombstone, or eligible input
  absent from a published stage manifest fails verification.
- The verifier independently recomputes canonical input digests, correlation edges and unresolved relationships,
  normalized effects, evaluation result, selected receipt manifest, package semantic digest, and deterministic stage
  identities, then compares them with published immutable records.
- The verifier has no database, Stage Worker, write, packaging, dispatch, tokenization, or model access.
- Shared protocol and canonicalization primitives may be reused, but projection, interpretation, evaluation, and
  selection recomputation must not delegate to the production Stage Worker implementation.

## Testing Decisions

### Primary Test Seam

- The primary seam is one Docker-backed black-box acceptance harness using the public Customer Ingress Adapter and
  public read-only Diagnostic and Kernel APIs.
- The harness is staged but reuses one exact evidence package throughout.
- It may sequence containers and compare hidden assertions, but it cannot read databases, inspect n8n or CRM directly,
  construct observations, write evidence, invoke packaging, or trigger processing through reads.
- It obtains only the Independent Diagnostic Verification Bundle and independently recomputes published semantic
  outputs; a Stage Worker reproduction endpoint is prohibited.
- Existing black-box acceptance scripts are the prior art. Existing signed runtime intake, Postgres migrations, CAS,
  n8n package fixtures, and Agency Lab output contracts are reused where their semantics remain valid.

### Test 1: Assignment Creation

- First create the failing black-box acceptance harness. It sends two deliveries, disables all controller access,
  and waits through read-only APIs for assignment, visible failed transition, or deadline.
- Test Orchestrator must seal readiness and exit before stimulus.
- Scenario Stimulus must send exactly two requests and be destroyed before verification.
- Assert audit order is registration of inactive material and grants, readiness pending, readiness success, Workflow
  Attestation Binding, desired-state snapshot publication, durable Diagnostic Plane and Tokenization Service
  application receipts, Kernel `active_effective`, manifest seal, orchestrator exit, then stimulus. Verify monotonic
  authority sequence and predecessor digests, not timestamps.
- Assert published workflow binding existed before grant activation and both execution snapshots match it.
- Assert all required canonical observations were authenticated under expected observer-specific grants, keys, and
  schemas. Do not claim exclusive HMAC authorship.
- Assert orchestrator, stimulus, verifier, and runtime-supervisor environment and mount manifests contain no observer
  HMAC or Tokenization Service secret. Treat this as configured exclusion under the trusted customer-host and Docker-
  daemon threat model, not proof against a hostile host or bootstrap launcher.
- Assert every Tokenization Result Receipt and its exact signed Grant Activation Snapshot and Grant Application
  Receipt were submitted, validated, and preserved before the referencing observation was accepted, and that the
  verifier receives the complete proof chain and service verification identity.
- Assert two distinct deliveries map to one Logical Operation Identity.
- Assert request-key equality tokens map to their respective delivery identities and differ across deliveries.
- Assert two designated ledger claims produce two interpreted committed effects.
- Assert coverage is adequate for every contributing stream.
- Assert a separate verifier process obtains the Independent Diagnostic Verification Bundle and independently
  verifies every committed intake outcome from `1..cutoff`, determines eligible inputs, and recomputes receipt
  manifests, correlation, effect interpretation, evaluation, selection, and package semantic digests without
  database or Stage Worker access.
- Assert Behavior Evaluation Record is violated and the deterministic trigger opened one case.
- Assert every worker-visible artifact, including contracts, instructions, output schemas, filenames, IDs, labels,
  defaults, examples, descriptions, and conditional branches, contains no fixture-specific answer material.
- Assert the worker-visible Diagnostic Mechanism Taxonomy contains multiple valid categories and scopes; the expected
  tuple exists only in the preregistered hidden rubric.
- Assert package includes required evidence classes, exact dependencies, disclosure accounting, and no raw source IDs
  or idempotency keys.
- Assert selected artifacts exist, validate by digest, and have retention pins.
- Assert active collection material has Evidence Collection Retention Leases before package freeze and selected
  material, including tokenization provenance dependencies, converts atomically to package pins.
- Assert package cutoff reason is `required_sources_complete` and its Diagnostic Committed Intake Position identifies
  one stable committed prefix.
- Assert exactly one immutable unclaimed assignment exists with `authority_granted: none` and exact bindings.
- Assert orchestrator, stimulus, verifier, and runtime supervisor authored zero observations, projections, effects,
  evaluations, packages, or assignments.
- Assert no dispatch request, authorization, claim, Worker Run, broker token, or model request exists.

### Test 2: Governed Worker

- Reuse the exact frozen Test 1 package.
- Submit one exact dispatch candidate and verify Kernel authorization inputs and decision.
- Atomically claim the assignment and prove authorization single use.
- Launch one isolated worker with exact mounts, image, network, resources, and broker policy.
- Assert worker cannot access host workspace, credentials, Docker, Diagnostic APIs, Kernel APIs, LAN, metadata, or
  general internet.
- Assert only the broker is reachable and provider credentials never enter the container.
- Assert only one bounded diagnosis file is accepted and validated.
- Assert dispatcher/runtime provenance, rather than self-report alone, establishes zero forbidden effects.
- Assert diagnosis identifies delivery-scoped versus logical-operation-scoped idempotency, cites exact package
  material, and marks implementation location not proven.

### Test 3: Diagnostic Consistency

- Commit hidden structured rubric before dispatch.
- Create three fresh assignments under an explicit Diagnostic Consistency Test Policy against the same package.
- Assert identical Worker Run Configuration Digests and record any unverifiable model snapshot or seed limitation.
- Require 3/3 diagnoses to identify the scope mismatch, distinguish two deliveries from one operation, cite source,
  request, interpreted effect, projection, and contract material, resolve every citation, avoid unsupported node
  claims, remain assignment-bound, and produce no forbidden effects.
- Report platform reproducibility separately from model consistency.
- Measure confidence variance, evidence-selection overlap, unsupported-claim count, recommended-investigation
  convergence, and prose divergence without requiring identical prose.
- Preserve all three immutable diagnoses independently.

### Focused Contract And Unit Tests

- Test canonical JSON and signature preimage stability across key ordering and supported data forms.
- Test every observation schema, exact digest activation, `additionalProperties: false`, and prohibited answer fields.
- Test the neutral Diagnostic Mechanism Taxonomy has multiple valid values and leaks no hidden rubric through enums,
  defaults, examples, descriptions, conditions, instructions, IDs, labels, or filenames.
- Test grant scope, expiry, revocation, key rotation, rate, size, stream, and observation-type enforcement.
- Test inactive grants reject intake, readiness failure prevents activation, signed grant snapshots arrive in exact
  authority order, and stale or revoked snapshots fail intake without general authority-database access.
- Test activation cannot become effective or permit manifest seal before a valid durable application receipt. Test
  revocation remains pending before application, then rejects all later intake at the application transaction.
- Test HMAC claims remain authenticated attribution only and runtime manifests show configured controller-key
  exclusion under the stated trusted-host threat model.
- Test exact replay, sequence conflicts, identity conflicts, gap creation, late gap fill, bounded sequence advance, and
  stream epochs.
- Test CAS-first crash windows, orphan handling, response-loss replay, outbox repeat, and garbage-collection races.
- Test concurrent intake commits, reversed completion, rollback, conflicts, and cutoff capture produce one contiguous
  stable committed prefix with no uncommitted position.
- Test ingress journal atomicity, stable source mapping, distinct delivery attempts, forward/report independence,
  outage backlog, and loss markers.
- Test Tokenization Use Grant isolation from Reporting Grants, exact-byte semantics, namespace separation, version
  mismatch, field authorization, byte limits, collection window, rate limits, and no raw input audit.
- Test Tokenization Grant Activation Snapshot application and revocation barriers. Test signed result-receipt
  submission, exact replay, identity conflict, invalid signature, unknown service identity, missing receipt reference,
  missing or mismatched grant proof, every observation-to-receipt field mismatch, dependency selection, lease and pin
  conversion, ordinary-GC exclusion, governed erasure tombstones, and availability degradation.
- Test correlation canonical ordering, deterministic digest replay, unresolved relationships, invalid copied operation
  IDs, and nondeterminism conflicts.
- Test direct feed claims remain uncountable before effect interpretation.
- Test HTTP success remains acknowledgement unless the contract explicitly permits commit acknowledgement.
- Test committed, not committed, ambiguous, and unknown effect outcomes.
- Test evaluator has no raw-observation input path and returns indeterminate under inadequate satisfaction coverage.
- Test deterministic trigger deduplication and case update on new evaluation revisions.
- Test role completion, durable deadline, optional snapshot behavior, contradictory late evidence, and identical-package
  suppression.
- Test exact cumulative ordinary-retention and collection-lease formulas, collection lease creation and extension,
  delayed observers, retry horizon, lease-to-pin conversion, and GC recheck races. Include a configuration where every
  individual interval fits but the applicable sum does not and require readiness failure.
- Test deterministic package selection, disclosure accounting, redaction, artifact pins, GC exclusion, tombstones, and
  availability projection.
- Test assignment immutability, expiry, one-way claim, replacement, retry linkage, and zero implied authority.
- Test dispatch authorization mismatch, expiry, audience, nonce, single use, atomic claim, stale conflict, and broker
  eligibility.
- Test worker output symlink, extra file, device, oversize, invalid schema, timeout, OOM, and cancellation rejection.
- Test legacy runtime translation equivalence, limitation preservation, migration provenance, and no execution-derived
  expectation promotion.
- Test published workflow and execution snapshot normalize identically; changed material, unknown node metadata,
  missing retention, missing detail, or changed normalizer fails readiness.
- Test Independent Diagnostic Verification Bundle completeness across every committed position `1..cutoff` and
  separate recomputation. Omitted positions, unexplained tombstones, omitted eligible inputs, tampered signed
  tokenization receipts, rules, ordering, cutoffs, effects, evaluations, and package manifests must produce mismatches
  rather than echoed success.

### Test Quality Rules

- Prefer externally visible state transitions, HTTP contracts, immutable digests, provenance, and denial behavior over
  implementation-private assertions.
- Use the black-box seam for the complete product claim and focused tests for hard-to-observe failure branches.
- Every retry and failure-path test checks both returned result and absence of duplicated immutable records.
- Deterministic artifacts must compare by semantic digest, excluding random IDs and nondeterministic timestamps where
  specified.
- No test may pass by reading a controller answer from worker-visible material.
- Full existing unit and v0.2 acceptance suites remain passing to enforce never-break-user-space behavior.

## Out of Scope

- hosted multi-tenancy and tenant administration
- remote observers and remote customer deployment management
- internet-facing evidence API or public evidence gateway
- mTLS, WireGuard, certificate authority, and certificate lifecycle implementation
- asymmetric observer signing and key-distribution infrastructure
- provider adapter marketplace
- providers other than n8n and the mock CRM
- intake batching, streaming, or batch-level transactions
- public Agent SDK, ASDK, or MCP surface
- generalized rules, policy DSL, JSONPath predicates, embedded expressions, or user-supplied evaluator code
- arbitrary Operational Package executable code
- automatic contract discovery or activation from adapter claims
- fuzzy correlation, model-selected joins, entity resolution, or vector search
- generic destination export or universal snapshot requirement
- distributed CAS, object storage, Kafka, ClickHouse, or additional databases
- cryptographic host, container, or confidential-computing attestation
- hostile-host or hostile-Docker-daemon key-custody proof
- committed-prefix accumulators, Merkle proofs, and selective verifier disclosure
- repair generation, repair delivery, promotion, rollback, or external business-effect execution in this proof
- production-grade hosted Model Broker implementation beyond the local narrow proof
- statistical reliability claims beyond the preregistered three-run consistency experiment
- console redesign or Grafana-style observability features

## Further Notes

- The central product claim is: Kernel does not make the model smarter; it gives the model a defensible epistemic
  position from which specific diagnosis becomes justified.
- The governing trust statement is: accepted observation proves authorized reporting of exact bytes, not external
  truth. Deterministic interpretation may establish reproducible derived facts, not Kernel authority.
- The proof's clean chain is: contract explains semantics, observations reveal events and identities, deterministic
  projections establish relationships and commitment, bounded evaluation proves invariant violation, and the worker
  infers diagnostic significance.
- Compatibility remains at the API boundary, not in the evidence architecture.
- Customer operations continue through ordinary Diagnostic Plane outages, while evidence loss remains visible,
  bounded, and recoverable.
- The first implementation artifact is the failing Test 1 black-box harness. Every later implementation slice closes
  one reason that fixed test cannot yet reach an unclaimed assignment.
- ADRs 0062 through 0106 and the project domain glossary are authoritative for terminology and hard boundaries.
