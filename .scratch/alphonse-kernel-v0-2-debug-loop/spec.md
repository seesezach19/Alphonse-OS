# Alphonse Kernel V0.2: Governed Debug Loop for Existing Agent Workflows

Label: ready-for-agent

## Problem Statement

Builders can create capable agents and automations quickly, but operating them reliably remains difficult. When an automation produces a successful-but-wrong result, evidence is fragmented across runtime logs, workflow revisions, model configuration, external systems, conversations, and human memory. The affected agent may explain what it believes happened, but it cannot independently establish the exact revision, reproduce the failure, verify its own repair, or grant itself production authority.

Existing workflow runtimes execute work and hold integration credentials. Coding agents can propose repairs. Observability products can collect telemetry. None of these, alone, provides a provider-neutral and customer-controlled repair lifecycle that answers:

- which exact Agent Workflow and Agent Revision produced the result
- what was expected, what actually happened, and who confirmed the mismatch
- whether the failure can be reproduced from immutable redacted evidence
- which Repair Worker attempted a change under what identity, intent, scope, and lease
- which exact candidate was independently tested
- whether the original failed and the candidate passed the same targeted regression
- who authorized promotion and what target revision became active
- what rollback reference and regression evidence remain afterward
- whether retries, duplicate events, delayed callbacks, and conflicting claims changed the truth

Without this layer, debugging is an informal conversation followed by an ambiently privileged edit. Builders cannot reliably distinguish webhook acceptance from workflow completion, transport retry from a new execution, model confidence from verification, or a proposed repair from a promoted target revision. Customers must either trust opaque automation or manually reconstruct every incident.

Alphonse Kernel V0.1 already provides customer-controlled identity, intent, authority, execution, evidence, recovery, durable commands, and inspectable receipts. V0.2 must add diagnostics and repair without weakening those boundaries, rewriting external activity as governed Kernel Runs, coupling Kernel semantics to n8n, storing customer provider credentials, or prematurely building a broad observability platform.

The decisive proof is intentionally narrow: connect one customer-owned n8n workflow, report one demonstrated successful-but-wrong inventory outcome, reproduce the defect, commission a customer-controlled Repair Worker, independently reject the original and verify an inactive candidate, require explicit human promotion, confirm the resulting target revision, and retain rollback and regression evidence. The complete journey must run headlessly from a fresh documented installation and remain idempotent.

## Solution

Alphonse V0.2 adds a customer-controlled Diagnostic Plane and governed repair lifecycle to the existing Kernel foundation.

A separately operated customer-owned n8n instance remains authoritative for workflow execution, provider integrations, provider credentials, and target-native workflow revisions. The Alphonse Node receives signed minimal Runtime Event Envelopes through a provider-neutral Workflow Runtime Adapter, attributes each external execution to an exact Agent Workflow and Agent Revision, and stores it as an External Activity Trace rather than retroactively claiming Kernel admission.

When a Builder identifies a wrong outcome, Alphonse creates a Diagnostic Case and records a human-confirmed Failure Specification. It pulls only the detailed execution data required for that investigation, redacts it according to package policy, and creates an immutable Reproduction Bundle with deterministic external fixtures and integrity hashes.

A customer-controlled Repair Worker, such as Codex, claims a bounded leased Repair Task under a distinct Agent Passport and Work Intent. The worker receives an ephemeral workspace containing the exact base revision, Reproduction Bundle, repair instructions, and permitted delivery operations. It returns an immutable Repair Candidate, targeted regression artifact, logs, and hashes. Provider authentication remains in the customer's worker and is never stored by Alphonse.

An independent deterministic Verification Runner executes the original and candidate revisions against the same Reproduction Bundle and retained regressions. It emits a signed Verification Receipt. A passing receipt makes the candidate eligible for promotion but grants no promotion authority. The customer Owner explicitly authorizes promotion through a provider-neutral Repair Delivery Adapter, which creates an idempotent target-native promotion receipt, confirms the exact active revision, and retains a rollback reference.

The first Operational Package implements both runtime observation and repair delivery for n8n. It supplies an importable Event Reporter subworkflow built from standard n8n primitives. The reference workflow compares ERP and storefront inventory, classifies fulfillment risk, drafts a customer follow-up, and routes it only to local review. A seeded defect maps a missing ERP SKU to zero inventory and creates a false delay draft. The repaired workflow preserves `inventory_unknown` and routes human review.

The V0.2 product is headless CLI and HTTP first. It proves stable provider-neutral contracts, separate append-only lifecycles, customer custody, independent verification, and explicit authority. A Builder Console, OTLP support, Agent SDK, additional runtimes, Butler integration, and ALPHONSE_DATA can then be added without changing the repair truth model.

## User Stories

1. As a Builder, I want to register an existing Agent Workflow without rebuilding it inside Alphonse, so that adoption is progressive.
2. As a Builder, I want the Agent Workflow to retain a stable identity across target-native revisions, so that its history remains coherent.
3. As a Builder, I want every observed execution attributed to an exact Agent Revision, so that diagnosis never depends on current configuration.
4. As a Builder, I want revision identity to include workflow JSON, runtime image, node versions, model configuration, and declared operational configuration, so that materially different behavior cannot share an identity.
5. As a Builder, I want external workflow activity labeled as an External Activity Trace, so that observation is not misrepresented as governed Kernel execution.
6. As a Builder, I want to report a successful-but-wrong outcome explicitly, so that transport success does not conceal business failure.
7. As a Builder, I want expected and actual behavior recorded separately, so that the repair target is testable.
8. As a Builder, I want to confirm the Failure Specification before repair work starts, so that model inference cannot silently define correctness.
9. As a Builder, I want a Diagnostic Case to group exact traces, revisions, evidence, hypotheses, reproductions, Repair Tasks, candidates, and receipts, so that one problem has one inspectable history.
10. As a Builder, I want failed diagnostic attempts preserved, so that the system does not erase uncertainty or repeat unproductive work invisibly.
11. As a Builder, I want detailed runtime data pulled only after investigation begins, so that routine observation collects minimal customer payload.
12. As a Builder, I want sensitive fields redacted before artifacts become durable, so that diagnosis does not create an unnecessary data copy.
13. As a Builder, I want a Reproduction Bundle to bind exact inputs, fixtures, assumptions, revision identity, and hashes, so that replay is repeatable.
14. As a Builder, I want Reproduction Bundles immutable, so that original and candidate verification cannot silently use different evidence.
15. As a Builder, I want deterministic substitutes for ERP, storefront, email, and model boundaries, so that verification does not depend on changing external systems.
16. As a Builder, I want the seeded missing-SKU failure to reproduce reliably, so that the first proof tests a real semantic defect rather than a synthetic crash.
17. As a Builder, I want the original revision to fail the targeted regression, so that a test cannot pass without demonstrating the reported defect.
18. As a Builder, I want an attached Repair Worker to propose the repair, so that Alphonse remains provider-neutral and does not embed one coding agent.
19. As a Builder, I want to select Codex or another compatible worker, so that repair intelligence is replaceable.
20. As a Builder, I want the Repair Worker to receive a compact explicit Work Intent, so that its objective and constraints are durable outside conversation.
21. As a Builder, I want the Repair Worker to operate under its own Agent Passport, so that diagnosis, repair, verification, and promotion remain attributable.
22. As a Builder, I want each Repair Task leased to one worker attempt, so that abandoned or duplicated workers cannot submit ambiguously.
23. As a Builder, I want an expired lease fenced from later submission, so that stale workers cannot overwrite newer work.
24. As a Builder, I want retries to create new Repair Task attempts, so that retry history remains visible.
25. As a Builder, I want the worker workspace to be ephemeral, so that drafts and customer data do not become ambient platform state.
26. As a Builder, I want the worker to receive only the exact base revision, reproduction evidence, allowed operations, and relevant regressions, so that access is sufficient but bounded.
27. As a Builder, I want provider credentials to remain in my selected Repair Worker, so that Alphonse does not become a model credential vault.
28. As a Builder, I want n8n integration credentials to remain in n8n, so that Alphonse does not duplicate provider security responsibilities.
29. As a Builder, I want every Repair Candidate immutable and bound to its exact base revision, so that verification evidence cannot drift to changed bytes.
30. As a Builder, I want a candidate to include the intended behavior change and targeted verification plan, so that review is understandable.
31. As a Builder, I want the Repair Worker to submit a regression artifact with the candidate, so that every verified repair strengthens future verification.
32. As a Builder, I want multiple candidates to coexist and supersede one another explicitly, so that failed approaches remain inspectable.
33. As a Builder, I want an independent Verification Runner to test candidates, so that the Repair Worker cannot grade its own work.
34. As a Builder, I want verification to run in a disposable deterministic environment, so that state leakage cannot create false passes.
35. As a Builder, I want verification to test both the original and candidate against the same bundle, so that the receipt proves the behavioral difference.
36. As a Builder, I want retained regressions rerun against later candidates, so that repairs do not silently reintroduce prior failures.
37. As a Builder, I want a signed Verification Receipt identifying exact artifacts and runner version, so that the result is independently inspectable.
38. As a Builder, I want a verification pass to create eligibility rather than authority, so that testing cannot deploy a change.
39. As a Builder, I want failed verification to preserve logs and evidence, so that the next repair attempt starts with useful facts.
40. As a Builder, I want the first proof to stop before sending a real customer email, so that the workflow is consequential but safe.
41. As a Customer Owner, I want promotion to require my explicit authenticated command, so that no model can activate its own repair.
42. As a Customer Owner, I want promotion to display the exact base, candidate, verification, target, and rollback references, so that authorization is specific.
43. As a Customer Owner, I want a stale candidate rejected when the target revision changed, so that promotion cannot overwrite newer work.
44. As a Customer Owner, I want target-native promotion used instead of direct database mutation, so that n8n remains authoritative for its own state.
45. As a Customer Owner, I want promotion retries to return the original receipt, so that network uncertainty cannot duplicate target changes.
46. As a Customer Owner, I want conflicting reuse of an idempotency key rejected and recorded, so that changed commands cannot masquerade as retries.
47. As a Customer Owner, I want the exact promoted revision confirmed from n8n, so that command acceptance is not confused with completion.
48. As a Customer Owner, I want a rollback reference captured before promotion, so that the prior target state remains recoverable.
49. As a Customer Owner, I want promotion failure visible as its own lifecycle, so that the Diagnostic Case is not falsely marked resolved.
50. As a Customer Owner, I want to close a case unresolved with explicit rationale, so that unresolved failures cannot disappear through status flattening.
51. As a Customer Owner, I want raw diagnostic artifacts retained under customer control, so that Alphonse does not export sensitive operational data.
52. As a Customer Owner, I want payload bytes deletable under retention policy while digest tombstones remain, so that privacy and historical integrity coexist.
53. As a Customer Owner, I want one local bootstrap Owner for V0.2, so that the first proof avoids premature team administration.
54. As a Customer Owner, I want machine participants to use short-lived identities, so that workers and adapters do not receive permanent ambient authority.
55. As a Customer Owner, I want the Alphonse API bound to loopback by default, so that local installation is not accidentally exposed.
56. As an n8n Operator, I want an importable Event Reporter subworkflow using standard nodes, so that installation requires no custom n8n build.
57. As an n8n Operator, I want event reporting separate from business workflow semantics, so that instrumentation can be reused.
58. As an n8n Operator, I want signed minimal lifecycle events pushed to Alphonse, so that ordinary execution does not replicate complete payloads.
59. As an n8n Operator, I want Alphonse to retrieve detailed execution information through supported APIs, so that it never reads the n8n database directly.
60. As an n8n Operator, I want the adapter to distinguish webhook acceptance from workflow completion, so that accepted requests cannot become phantom successes.
61. As an n8n Operator, I want delayed and out-of-order events retained and reconciled by sequence, so that transport timing does not rewrite history.
62. As an n8n Operator, I want duplicate identical events acknowledged idempotently, so that ordinary webhook retries are safe.
63. As an n8n Operator, I want conflicting claims for one event identity rejected and preserved, so that ambiguity remains visible.
64. As an n8n Operator, I want timestamped HMAC authentication with replay limits, so that event identity is not based on a static shared header alone.
65. As an n8n Operator, I want adapter health and compatibility inspectable, so that stale or broken instrumentation is distinguishable from workflow silence.
66. As an Adapter Builder, I want Workflow Runtime Adapter contracts independent of n8n, so that another runtime can integrate without changing Kernel semantics.
67. As an Adapter Builder, I want Repair Delivery Adapter operations declared individually, so that unsupported inspect, candidate, promote, or rollback behavior cannot be implied.
68. As an Adapter Builder, I want secret-free Repair Delivery Bindings, so that target configuration can be versioned without storing credentials.
69. As an Adapter Builder, I want runtime and repair adapters packaged as Operational Package exports, so that compatibility, mappings, schemas, health checks, and tests travel together.
70. As an Adapter Builder, I want n8n-specific fields translated at the adapter boundary, so that core Diagnostic Plane objects remain provider-neutral.
71. As a Repair Worker, I want a typed claim, heartbeat, submission, and failure protocol, so that I can integrate without privileged database access.
72. As a Repair Worker, I want structured denials and allowed next operations, so that I can recover programmatically from stale leases or invalid candidates.
73. As a Verification Runner, I want no promotion credentials, so that a test process cannot activate what it tests.
74. As a Verification Runner, I want artifact access by immutable digest, so that the tested candidate is exact.
75. As a Platform Maintainer, I want Diagnostic Case, Repair Task, Repair Candidate, and Promotion state machines separated, so that one status cannot flatten distinct truths.
76. As a Platform Maintainer, I want append-only transitions and derived projections, so that current views remain convenient without rewriting history.
77. As a Platform Maintainer, I want diagnostic metadata isolated from Kernel authority data, so that diagnostic compromise cannot silently grant execution authority.
78. As a Platform Maintainer, I want one PostgreSQL deployment with separate Kernel and Diagnostic databases and roles, so that V0.2 remains operable while preserving boundaries.
79. As a Platform Maintainer, I want content-addressed local artifact storage behind a replaceable interface, so that integrity is stable without requiring cloud storage.
80. As a Platform Maintainer, I want all public operations self-describing and available through HTTP and CLI, so that the later Console uses no privileged path.
81. As a Platform Maintainer, I want V0.1 behavior and release qualification to remain passing, so that diagnostics do not break existing user space.
82. As a Platform Maintainer, I want the first proof implemented in the existing modular repository, so that contracts and qualification change atomically.
83. As a Platform Maintainer, I want n8n operated as a separate customer-owned service, so that its license, credentials, and runtime boundary remain explicit.
84. As a prospective Builder, I want to complete the documented proof from fresh local state, so that the product can be evaluated without private knowledge.
85. As a prospective Builder, I want one command or short documented sequence to inspect the final case, receipts, target revision, rollback, and regression, so that the value is immediately visible.
86. As a prospective Builder, I want the same proof repeated without duplicate events, tasks, candidates, or promotions, so that reliability is demonstrated rather than asserted.

## Implementation Decisions

### Product Boundary

- V0.2 implements the first product horizon: one complete reactive Debug Loop for an existing external Agent Workflow.
- The proof is headless. CLI and HTTP operations are product surfaces; the Builder Console follows only after the workflow is proven.
- V0.1 Kernel semantics remain stable. External Activity Traces are observations and never become retroactive Runs or evidence of Kernel admission.
- New work remains in the existing repository but receives explicit Diagnostic Plane, adapter, worker coordination, verification, CLI, and proof boundaries.
- The first external substrate is a separately operated customer-owned n8n instance. Alphonse does not bundle n8n as a white-labeled product or depend on direct access to its database.

### Deployment And Data Boundaries

- One Alphonse Node belongs to one customer trust boundary and may contain multiple Agent Workflows and Kernel Environments.
- The local proof uses Docker, one PostgreSQL server, separate Kernel and Diagnostic databases, and separate least-privilege database roles.
- Kernel authority records remain in the Kernel database. Diagnostic metadata, case state, runtime observations, and artifact references remain in the Diagnostic database.
- A content-addressed local volume stores workflow snapshots, detailed payloads, Reproduction Bundles, candidate files, patches, logs, regression artifacts, and verification evidence.
- Persisted metadata refers to artifacts by digest, size, media type, sensitivity, creation source, and retention state.
- Retention may delete payload bytes but must preserve a tombstone containing digest, identity, deletion reason, and deletion time.
- API and CLI services bind to loopback by default. The proof has one bootstrap Owner Principal and separate short-lived identities for Runtime Adapter, Repair Worker, Verification Runner, and Repair Delivery Adapter.
- Provider credentials used by n8n stay in n8n. Model or repository credentials used by a Repair Worker stay in the customer-controlled worker. Alphonse persists only non-secret credential binding references where required.

### Stable Domain Objects

- Agent Workflow is the durable builder-owned identity for one objective across runtime implementations and revisions.
- Agent Revision is immutable and content-addressed. For n8n it binds canonical workflow JSON, n8n image/version, relevant node types and versions, model declaration, operational configuration fingerprints, and adapter fingerprint rules.
- External Activity Trace is an immutable attributed observation derived from Runtime Event Envelopes and optional pulled detail.
- Runtime Event Envelope is a provider-neutral signed claim binding adapter, workflow, revision, external execution, event identity, sequence, lifecycle claim, correlation, idempotency, timestamp, and payload digest or reference.
- Diagnostic Case groups exact evidence and lifecycle references for one demonstrated problem but grants no authority.
- Failure Specification records confirmed expected behavior, actual behavior, reproduction conditions, and targeted verification criteria.
- Reproduction Bundle is immutable and binds the exact Agent Revision, Failure Specification, redacted inputs, deterministic external fixtures, assumptions, and hashes.
- Repair Task is one immutable leased attempt assigned to one Repair Worker identity and Work Intent.
- Repair Candidate is immutable and binds the case, exact base revision, candidate revision, intended change, regression artifact, and verification plan.
- Verification Receipt is an independently signed result binding runner identity/version, bundle, original revision, candidate revision, regressions, outcomes, logs, and timestamp.
- Promotion is a separate target transition binding Owner authorization, candidate, passing Verification Receipt, target, previous revision, resulting revision, rollback reference, and target receipt.

### Lifecycles

- Diagnostic Case, Repair Task, Repair Candidate, and Promotion use separate append-only transition streams with derived current projections.
- A Diagnostic Case progresses through open, specified, reproducible, repair-in-progress, candidate-available, verified, and resolved states. It may instead close unresolved with explicit Owner rationale. Case projection derives progress from linked objects; it does not mutate their histories.
- A Repair Task progresses through available, leased, submitted, failed, expired, or cancelled. Lease expiry fences the attempt; retries create new tasks.
- A Repair Candidate progresses through proposed, verification-pending, verified, rejected, superseded, or withdrawn. Candidate content never mutates.
- A Promotion progresses through requested, authorized, applying, confirmed, failed, or rolled-back. Verification eligibility and Owner authorization are independent preconditions.
- Case projection counts only proposed or verification-pending candidates as candidate-available. A rejected candidate remains visible but returns the case to reproducible until a new Repair Task begins.
- Resolution requires confirmed target revision evidence after promotion or explicit unresolved closure. Candidate verification alone cannot resolve a case.
- Every state-changing command uses an idempotency key and canonical request digest. Exact retry returns the original result. Same key with different bytes fails with a structured conflict and leaves existing truth unchanged.

### Runtime Observation

- Workflow Runtime Adapters expose typed operations for workflow description, revision resolution, event receipt, supported detail retrieval, supported replay, and health.
- n8n instrumentation initially uses an importable Event Reporter subworkflow made from standard Code, HTTP Request, Error Trigger, and subworkflow nodes. A custom node is deferred.
- Runtime observation uses push-summary and pull-detail. Routine events contain minimal metadata and payload digests/references; detailed execution payload is retrieved only for an authorized Diagnostic Case.
- Runtime Event Envelopes use canonical JSON and timestamped HMAC-SHA256 over the exact body and required authentication context. Verification enforces key binding, timestamp tolerance, body digest, event identity, event sequence, and replay policy.
- Identical duplicate events return the original receipt. Conflicting reuse of event identity, sequence, or idempotency key is rejected and recorded.
- Receipt of an event records only the external claim. Accepted, running, succeeded, failed, cancelled, and other lifecycle claims remain distinct; HTTP acceptance never implies workflow completion.
- Delayed or out-of-order claims remain append-only and produce an honest projection. They cannot erase that uncertainty or contradiction occurred.
- The adapter uses supported n8n APIs and exported workflow representations. It never reads or mutates n8n database tables directly.

### First n8n Workflow

- The reference workflow receives deterministic ERP and storefront inventory fixtures, compares inventory, classifies fulfillment risk, drafts a customer follow-up, and routes the draft to local review only.
- The seeded defect maps an absent ERP SKU to numeric zero. The workflow therefore finishes successfully while producing a false delay draft.
- Correct behavior preserves an explicit `inventory_unknown` state and routes the record to human review without claiming a delay.
- The proof uses deterministic fixtures for ERP, storefront, email/review delivery, and model output. No real customer email or production provider write occurs.
- Exact original and repaired n8n workflow revisions remain available for replay, comparison, rollback, and regression.

### Diagnosis And Reproduction

- V0.2 diagnosis begins only from an explicit human or authenticated agent failure report. Automatic anomaly detection is deferred.
- Failure Specification creation separates factual source references, human-confirmed expected/actual behavior, assumptions, and later model hypotheses.
- The deterministic proof creates the Failure Specification without a model. After it passes, a model-assisted Diagnostic Worker may produce a proposed diagnosis artifact against the same confirmed boundary.
- Reproduction Bundle construction pulls only required detail, applies package-declared extraction and redaction rules, freezes deterministic fixtures, and records omitted data explicitly.
- Bundle creation is idempotent for the same case, specification, source artifacts, policy, and builder version. Changed inputs create a new immutable bundle.
- The original revision must demonstrate the expected failure before the case becomes reproducible and before a Repair Task is offered.

### Repair Workers

- Repair generation is performed by an attached customer-controlled worker, not an embedded Alphonse model runtime.
- The worker protocol exposes typed registration, task discovery, lease claim, heartbeat, artifact retrieval, submission, failure, and release operations.
- A Repair Task binds one Agent Passport, Work Intent, base revision, Reproduction Bundle, allowed tools/operations, artifact limits, lease, and expected outputs.
- The worker materializes an ephemeral workspace and receives no Kernel database, n8n database, promotion credential, or ambient customer filesystem access.
- Worker output includes exact candidate bytes/reference, candidate digest, intended change, targeted regression artifact, logs, tool/runtime attribution, and completion status.
- A worker may create an inactive candidate through a permitted Repair Delivery Adapter operation, but cannot promote it.
- Worker timeout, process loss, invalid output, or stale lease creates a visible failed/expired attempt. It does not mutate a previous candidate or case history.

### Verification

- Verification runs in a process and identity separate from Diagnostic and Repair Workers.
- The runner receives immutable artifacts by digest and operates in a disposable deterministic substrate with no production promotion authority.
- Each verification executes the exact original revision and exact candidate revision against the same Reproduction Bundle.
- Acceptance requires the original to demonstrate the Failure Specification and the candidate to satisfy targeted expected behavior.
- The runner also executes every compatible retained regression for the Agent Workflow. Incompatible regressions are reported explicitly, not silently skipped.
- A Verification Receipt includes per-check outcomes, exact input/output digests, runner and fixture versions, logs/evidence references, and an overall targeted result.
- Passing verification means only that the candidate satisfies the demonstrated Failure Specification and retained targeted regressions. It does not certify overall Agent Workflow quality.
- Verification is idempotent by exact candidate, bundle, regression set, runner version, and command key. Changed dependencies create a new receipt.

### Repair Delivery And Promotion

- Repair Delivery Adapters expose separately declared inspect, snapshot, candidate, candidate-execution, review, promotion, confirmation, and rollback operations.
- Repair Delivery Bindings select exact adapter version, target reference, external credential binding reference, permitted operations, and transition policy. They contain no secrets.
- The trusted first-party n8n Operational Package exports both Workflow Runtime and Repair Delivery Adapters, their schemas, mappings, revision fingerprint rules, redaction defaults, health checks, compatibility declarations, and tests.
- Candidate creation is inactive and target-native. Promotion requires a verified immutable candidate, passing Verification Receipt, unchanged expected target base, explicit Owner authorization, and a unique idempotency key.
- Promotion captures the current target snapshot and rollback reference before applying the candidate.
- Applying a change and confirming the resulting target revision are separate facts. A timeout after request creates an unresolved applying state until reconciliation confirms applied or not applied.
- Blind promotion retry is prohibited when target effect is uncertain. The adapter must reconcile target state first.
- Confirmation records the exact active target revision and target-native receipt/reference. A mismatch fails closed and leaves the case unresolved.
- Rollback is a separate explicit operation and receipt. It never erases the failed promotion or later target history.

### Protocol And Product Surface

- Canonical semantics are defined by self-describing operation contracts. HTTP and CLI adapt those operations without direct database access.
- Operations expose input/output schemas, identity and authority requirements, preconditions, effect class, idempotency behavior, structured outcomes, issues, emitted events, and possible next operations.
- The headless proof exposes workflow registration/inspection, runtime event receipt, failure reporting, Failure Specification confirmation, reproduction creation, worker attachment and task leasing, candidate submission, verification, promotion authorization/application/confirmation, rollback inspection, and final case inspection.
- CLI output is human-readable with an optional structured mode suitable for agents and acceptance tests.
- Structured errors distinguish authentication failure, authorization denial, stale revision, lease conflict, idempotency conflict, invalid transition, unsupported adapter operation, missing artifact, verification failure, promotion uncertainty, and target mismatch.
- The later Builder Console must consume these same operations and projections. It receives no privileged database or authority path.

### Compatibility And Expansion

- Existing V0.1 tests and release qualification remain mandatory regression coverage. V0.2 may reuse canonical JSON, identity, intent, command receipt, idempotency, append-only event, artifact integrity, effect uncertainty, recovery, and protocol-discovery patterns.
- Diagnostic Plane objects remain modular and provider-neutral even when the first adapter is n8n-specific.
- New runtime or delivery adapters must not require n8n fields in core schemas.
- The second-runtime proof adds OTLP transport and a generated TypeScript Agent SDK only after the n8n loop passes.
- Butler and optional ALPHONSE_DATA integrations consume exact Diagnostic and Kernel records later; neither is required to prove V0.2.

## Testing Decisions

- The primary test seam is one black-box journey through public CLI and HTTP boundaries: signed n8n event in; confirmed promoted target revision, rollback reference, regression artifact, and immutable receipts out.
- The acceptance test starts from fresh local state using documented installation steps and customer-owned n8n beside Alphonse Node.
- It imports the Event Reporter and defective inventory workflow, executes the missing-SKU fixture, receives a valid Runtime Event Envelope, and resolves the exact original Agent Revision.
- It proves an identical event retry returns the same receipt, a conflicting event is rejected, a stale signature is rejected, and an out-of-order claim does not rewrite prior history.
- It reports the false delay draft, confirms the Failure Specification, creates a redacted Reproduction Bundle, and proves the original revision fails deterministically.
- It attaches a test Repair Worker through the same public worker protocol used by Codex, leases one task, submits an inactive candidate and regression artifact, and proves stale or duplicate submissions cannot mutate the candidate.
- It independently verifies the exact original and candidate. Acceptance requires the original failure, candidate success, retained regression success, and one signed Verification Receipt.
- It proves passing verification cannot promote the candidate and that the Repair Worker and Verification Runner identities lack promotion authority.
- It performs explicit Owner promotion, confirms the exact n8n target revision, preserves the prior rollback reference, resolves the Diagnostic Case, and exposes complete final state through public inspection.
- It repeats events and commands to prove no duplicate External Activity Trace, Repair Task, Repair Candidate, Verification Receipt, target promotion, or regression artifact is created.
- It injects timeout-after-promotion-request uncertainty and proves the system reconciles target state before any retry, preserving the uncertainty history.
- It runs the complete journey from clean state at least twice and compares normalized observable outcomes for determinism.
- It runs all existing V0.1 tests and release qualification to prove the Diagnostic Plane does not break existing user space.
- Tests assert external behavior, durable records, authority boundaries, and receipts. They do not assert private function calls, table layout, or incidental logging.
- Focused unit tests cover canonical Runtime Event Envelope signing/verification, timestamp and replay rules, revision fingerprinting, redaction, content-addressed artifacts, lifecycle transition legality, lease fencing, idempotency conflicts, adapter mapping, and Verification Receipt construction.
- Adapter contract tests run every Workflow Runtime and Repair Delivery Adapter against shared provider-neutral conformance cases.
- Security tests prove Alphonse stores no n8n/provider token, diagnostic roles cannot mutate Kernel authority records, workers cannot access promotion operations, verifier cannot promote, APIs reject unauthenticated non-public operations, and artifact traversal or digest substitution fails closed.
- Retention tests prove payload deletion removes bytes while preserving digest tombstones and historical references.
- Failure-path tests preserve partial truth for unavailable n8n, unavailable worker, worker timeout, invalid candidate, verification failure, promotion conflict, target mismatch, and uncertain target effect.
- Prior art is the existing V0.1 unit suite, isolated black-box acceptance scripts, repeatable engineering rehearsal, exact effect dispatch tests, timeout/reconciliation tests, environment restore tests, and release qualification.
- No test requires AWS, production email delivery, private external services, or live model nondeterminism.

## Out of Scope

- Automatic anomaly detection or model-only failure declaration
- Broad Agent Workflow evaluation, scoring, certification, or safety claims
- Automatic repair promotion, merge, deployment, rollback, or production effects
- A production Builder Console before the headless loop passes
- OTLP Collector support before the n8n proof
- Public Agent SDK generation before protocol stabilization
- Additional workflow runtimes before the n8n adapter proves the contracts
- Managed hosting, shared multi-tenancy, Kubernetes, or distributed infrastructure
- Teams, SSO, broad RBAC, or complex organization administration
- Butler operator-product integration
- Required ALPHONSE_DATA adoption or business-context ingestion
- Storing n8n integration credentials or Repair Worker provider credentials in Alphonse
- Direct access to n8n database tables
- A custom n8n node
- White-labeling, redistributing, or embedding n8n as the Alphonse product
- Sending a real customer email or changing production inventory
- A public marketplace or untrusted executable adapter installation
- General repository hosting, source-control replacement, or CI platform replacement
- AWS deployment or any AWS-side changes

## Further Notes

- Recommended delivery order: establish Diagnostic Plane persistence and artifact contracts; implement Runtime Event Envelope and adapter conformance; ship the n8n Event Reporter and defective workflow; implement failure/reproduction lifecycle; implement worker leases and candidate submission; implement independent verification; implement Repair Delivery promotion/reconciliation; compose the black-box proof; then add model-assisted diagnosis.
- The implementation should reuse V0.1 patterns where semantics match, especially canonical JSON, command idempotency, immutable receipts, explicit uncertainty, identity/intent separation, public protocol discovery, and black-box acceptance. Reuse contracts and lessons, not old Butler-specific code structure.
- The proof succeeds because it repairs a semantic business error in an execution that the runtime considered successful. This is more representative than repairing a crash and demonstrates why workflow execution logs alone are insufficient.
- Product expansion follows demonstrated demand: first prove one complete repair loop, then prove portability with a second runtime, then add the Builder Console and broader governed development features. Kernel semantics change only when the proof establishes a missing invariant.

### Prototype Finding

The throwaway in-memory terminal prototype answered the state-model question positively. Separate External Activity, Diagnostic Case, Repair Task, Repair Candidate, Verification, and Promotion lifecycles remained understandable across happy path, duplicate/conflicting event delivery, expired worker lease, failed verification, worker self-promotion, stale target revision, uncertain-applied promotion, and uncertain-not-applied promotion.

One projection correction was required: a rejected candidate must remain visible without leaving the case in candidate-available state. The corrected projection returns to reproducible. Legal-action discovery must apply the same preconditions as command execution, including target revision freshness.

Observed invariants:

- identical event replay changed neither revision nor ledger; conflicting replay was rejected
- External Activity remained explicitly distinct from a Kernel Run
- expired worker submission, failed-candidate promotion, and worker authorization were rejected
- target drift invalidated promotion eligibility
- uncertain promotion blocked blind retry
- reconciliation of an applied target resolved the case while preserving uncertainty history
- reconciliation of a non-applied target retained verified-but-unresolved case state
- only confirmed target revision produced resolved case state

The prototype does not prove persistence, concurrency, HMAC implementation, real n8n behavior, or container isolation. Those remain black-box implementation and acceptance concerns.
