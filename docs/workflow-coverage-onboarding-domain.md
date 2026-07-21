# Workflow Coverage Onboarding Domain And Compilation Contract

Issue #3 defines the documentation boundary for agent-driven reverse specification of existing n8n workflows. It
adds no implementation code and changes no existing authority, diagnostic, repair, verification, or promotion
semantics.

## Current-State Map

| Concern | Existing contract and evidence | Decision for onboarding |
| --- | --- | --- |
| Workflow identity | Diagnostic workflow registration accepts stable identity, objective, and external reference (`src/diagnostic-service.js:77-98`, `src/diagnostic-service.js:211-260`). | Reuse for the approved final registration; it is not the discovery workspace. |
| Exact revision | Revision registration closes over workflow content, runtime, nodes, model, configuration, adapter identity, and content-addressed snapshot (`src/diagnostic-service.js:100-145`, `src/diagnostic-service.js:262-320`). | Reuse after approved compilation. Extend revision closure in later n8n work without changing registration meaning here. |
| Workflow Manifest | Repository-owned configuration must be immutable after import and excludes secrets and live authority (`CONTEXT.md:26-29`, ADR 0028). No Workflow Manifest object or import operation exists today; current workflow and revision registration accept raw material directly (`src/diagnostic-service.js:77-145`, `src/diagnostic-service.js:211-320`). Package candidate validation, digest, and receipt handling provide patterns but are not a manifest-import seam (`src/package-service.js:197-259`, `src/package-service.js:555-588`, `src/package-service.js:722-803`). | Compilation emits a proposal only. Add an immutable landed-revision import receipt and an onboarding-specific registration request; onboarding must not call raw registration directly. No draft becomes a Package Version. |
| Work attribution | Agent Passport identifies the runtime but grants no authority; Work Intent binds objective, scope, and constraints; Build Session attributes construction without storing drafts (`CONTEXT.md:524-545`, `src/identity-intent-service.js:259-361`, `src/identity-intent-service.js:364-416`). | Reuse all three. None becomes the onboarding lifecycle owner. |
| Human intent confirmation | A human confirms a compact Work Intent, which still grants no authority (`src/identity-intent-service.js:315-349`). | Reuse for why the agent is working. Add a separate exact Coverage Review Approval for consequential workflow meaning. |
| Diagnostic Case | A Diagnostic Case groups evidence and repair for one behavioral problem (`CONTEXT.md:631-653`, `src/diagnostic-router.js:583-602`). | Do not reuse for routine onboarding. A failing calibration may separately open a Diagnostic Case later. |
| Agent proposals | Diagnosis Requests bind exact artifacts and scoped workers; Diagnosis Proposals separate facts, inferences, hypotheses, uncertainty, provenance, and human usefulness review (`src/diagnostic-diagnosis-service.js:195-288`, `src/diagnostic-diagnosis-service.js:291-355`, `src/diagnostic-diagnosis-contracts.js:91-153`). | Reuse the provenance and assignment pattern, not the failure-specific objects or truth semantics. |
| Runtime adapter | The provider-neutral contract describes one known workflow, resolves its revision, receives events, optionally retrieves detail or replays, and reports health (`src/workflow-runtime-adapter-contract.js:13-108`). | Extend with scoped inventory listing. Existing single-workflow operations remain unchanged. |
| n8n discovery | The current fixture API reads one exact workflow and has no inventory route (`packages/n8n-operational-package/src/detail-adapter-server.js:283-344`). Readiness requires manually supplied provider workflow, Alphonse workflow, revision, grant, and execution identifiers (`src/canonical-n8n-readiness.js:5-38`). | Inventory discovery and selection are genuinely missing. Discovery never activates coverage. |
| n8n observation | The current observer polls only execution IDs previously nominated through its internal signal endpoint and keeps pending state locally (`src/canonical-n8n-observer.js:24-27`, `src/canonical-n8n-observer.js:108-123`, `src/canonical-n8n-observer.js:136-161`). | Complete cursor-based reconciliation and durable intervals are separate follow-on work. This issue defines only their capability boundary. |
| Contracts and policy | Reference deployment code manually constructs Integration Behavior Contract, Behavior Contract, evidence selection, and retention exports (`scripts/canonical-proof-deployment-fixture.js:245-363`). Behavior Contracts are already optional (`CONTEXT.md:659-681`). Package validation accepts a finite export-kind set and currently rejects `coverage_profile` as unknown (`src/package-service.js:21`, `src/package-service.js:237-240`). | Reuse exact contract exports. Extend the Operational Package export contract with versioned `coverage_profile` validation while reusing package validation and publication operations; no contract becomes mandatory. |
| Repair and verification | Repair Task/Candidate, delivery binding, Verification Receipt, promotion, reconciliation, and rollback are separate existing lifecycles (`src/diagnostic-router.js:682-887`, ADRs 0048 and 0052). | Onboarding records bindings and readiness references only. It does not change or collapse these lifecycles. |
| Protocol discovery | Kernel and Diagnostic Protocols already publish typed Operation Descriptors and durable next operations (`src/operations.js:72-143`, `src/diagnostic-operations.js:191-234`). ADR 0022 defines Agent Gateway as a bounded projection, but no Gateway implementation exists in this repository. | New canonical operations follow the descriptor pattern. Gateway and Builder Console may later project them without becoming stores or authority paths; this slice does not claim those projections exist. |

## Concept Decisions

| Proposed concept | Decision | Reason |
| --- | --- | --- |
| Onboarding work container | **New aggregate: Coverage Onboarding.** | Diagnostic Case is failure-specific; Build Session is construction attribution without drafts. One durable aggregate is required for pause/resume, review invalidation, and exact registration linkage. |
| Immutable discovery snapshot | **Immutable CAS artifact: Workflow Discovery Snapshot.** | It is evidence, not an aggregate or Workflow Manifest. |
| Interpretation claim | **Immutable proposal artifact: Workflow Interpretation Claim.** | Reuse Proposal Metadata and diagnosis provenance patterns; do not reuse the failure-specific Diagnosis Proposal. |
| Typed ambiguity | **Typed item within Coverage Onboarding with append-only resolution events.** | It needs durable blocking state but not an independently addressable aggregate. |
| Operator confirmation | **Reuse Work Intent confirmation; add attributable confirmation and ambiguity-resolution event payloads; add Coverage Review Approval.** | Work Intent confirmation binds agent purpose, append-only Coverage Onboarding events bind exact human dispositions, and the Kernel approval separately binds the final review bytes. The event payloads are not independent aggregates or authority records. |
| Digest-bound review bundle | **Immutable CAS artifact: Coverage Review Bundle.** | Review material is content, while approval is a separate authority record. |
| Coverage specification | **Immutable deterministic artifact.** | It is an intermediate compiler output derived from exact approved review material and remains distinct from the emitted Workflow Manifest proposal. |
| Deterministic validation report | **New receipt type: Coverage Validation Receipt.** | It binds exact input, tool identities, checks, issues, limitations, and output digest but grants no authority. |
| Agency coverage profile | **Extend Operational Package exports with `coverage_profile`; reuse the Package Version lifecycle.** | The current validator does not support this kind. The extension reuses package versioning, digest, dependency, validation, and publication semantics and never stores credentials or blanket approvals. |
| Coverage capability projection | **Derived read model.** | Independent capabilities must not become one mutable lifecycle stage. |
| Coverage interval | **Deferred derived projection.** | Interval storage depends on complete reconciliation and gap policy; it is not needed to prove compilation. |
| Change Case | **Reuse Coverage Onboarding with `reason: revision_change`.** | A linked new onboarding preserves exact history without another case type. |
| Effect Inventory | **Required Coverage Specification section.** | It declares possible effects and evidence limitations but is not an observed Effect or aggregate. |
| Maintenance Work Queue | **Deferred.** | Queue and lease policy belongs to Maintenance Agent Runtime orchestration, not onboarding compilation. |

Only Coverage Onboarding and Coverage Review Approval are new durable domain records in this slice. Everything else
is an artifact, artifact section, receipt, package export, or projection.

## Authority And Plane Ownership

| Plane or participant | May | Must not |
| --- | --- | --- |
| Workflow Runtime Adapter | Use its own scoped provider credential; list and read provider workflow material; return typed evidence and omissions. | Expose the provider credential; approve interpretation; create authority; claim destination commitment. |
| Maintenance Agent | Propose Work Intent; invoke scoped discovery; submit evidence-linked interpretation; identify ambiguity; request review and compilation. | Emit human confirmation; alter evidence; add tools or scope from workflow content; register or activate unapproved material. |
| Diagnostic Plane | Persist onboarding events and immutable artifacts; validate provenance; project ambiguity and capability state; execute deterministic compilation. | Grant business authority; treat agent conclusions as observations; promote repairs or change workflow targets. |
| Human Principal | Confirm Work Intent; resolve ambiguity; approve one exact Coverage Review Bundle with rationale and scope. | Override integrity, secret, exact-reference, or deterministic-validation failures. |
| Kernel Authority Services | Authenticate Principals; retain Work Intent and Coverage Review Approval; enforce exact digest, scope, and validity at compilation. | Store mutable drafts, infer approval from conversation, or treat review approval as repository or registration authority. |
| Compiler and validator | Produce byte-stable semantic outputs and structured issues from exact inputs. | Read ambient state; invent missing meaning; write source control; register, activate, repair, verify, or promote. |
| Builder Console | When implemented, project the same protocol operations for human review. | Become a parallel store or privileged authority path. |

Provider workflow names, descriptions, notes, code, execution material, node parameters, and linked documentation are
untrusted evidence. They cannot change instructions, operation schemas, tool availability, scopes, approval rules, or
compiler behavior.

## Coverage Onboarding Lifecycle

The aggregate uses append-only events and a derived current projection. Repeated commands with the same id and exact
request digest are idempotent; retries with changed bytes conflict.

1. `opened` binds installation, environment, external workflow reference, reason, Work Intent, agent Principal, and
   adapter binding.
2. `evidence_captured` binds one Workflow Discovery Snapshot digest. A newer material snapshot appends a new event;
   it never mutates the prior artifact.
3. `interpretation_submitted` binds one Workflow Interpretation Claim digest produced from the exact active snapshot.
4. `ambiguities_projected` records typed blocking and nonblocking items. Resolutions append named-human events.
5. `review_bundle_created` binds the exact claims, dispositions, Effect Inventory, limitations, policies, contracts,
   fixtures, and bindings presented to the human.
6. `review_approved` references a valid Kernel Coverage Review Approval for that exact bundle digest.
7. `compiled` binds exact Coverage Specification and Workflow Manifest proposal digests plus compiler identity.
8. `validated` binds a passing Coverage Validation Receipt. Invalid results remain visible and cannot advance.
9. `source_control_proposed` binds an exact repository proposal receipt created under separate repository authority.
10. `manifest_imported` binds an immutable import receipt for the exact landed repository commit, tree, path, manifest
    digest, and validated proposal digest.
11. `registration_requested` invokes the onboarding-specific registration boundary with the exact import, review, and
    validation receipts; that boundary may reuse the existing workflow and revision registration services internally.
12. `registered` binds the resulting workflow, revision, manifest import, and registration receipt references.

Terminal projections are `registered`, `cancelled`, and `superseded`. Material change after approval appends an
invalidation event binding the previous bundle and approval digests, changed material, reason, and time. The event
derives `review_required` and makes the old approval and its downstream compilation, validation, proposal, import,
and registration material ineligible for further use without deleting any record. A later review creates a new
bundle and approval. A behavior-bearing revision change opens a linked aggregate rather than reopening the
registered one.

## Draft Contract Shapes

These outlines are decision documents, not executable schemas. Subsequent implementation tickets must publish exact
JSON Schemas through Operation Descriptors and validate hostile input at runtime.

### Workflow Interpretation Claim

```yaml
schema_version: alphonse.workflow-interpretation-claim.v0.1
onboarding_id: uuid
snapshot_digest: sha256
proposal_metadata:
  proposal_kind: workflow_interpretation_claim
  principal_id: uuid
  work_intent_id: uuid
  work_intent_digest: sha256
  exact_base_references:
    onboarding_revision: nonnegative-integer
    snapshot_digest: sha256
  payload_digest: sha256 # digest of the claims array
  evidence_references: [{ artifact_digest: sha256, json_pointer: string }]
  proposed_at: date-time
claims:
  - claim_id: stable-string
    kind: objective | consequence | integration | effect | dependency | limitation
    status: observed | inferred | conflicted | unknown
    statement: bounded-string
    evidence_references: [artifact-digest-and-json-pointer]
    confidence: low | medium | high | null
    conflicting_evidence_references: []
    unknown_reason: bounded-string | null
    limitations: []
provenance:
  passport_id: uuid
  instruction_digest: sha256
  model: { provider: string, model: string, version: string }
  runtime: { name: string, version: string }
  input_artifact_digests: [sha256]
supersedes_interpretation_digest: sha256 | null
authority: none
```

An agent submission cannot contain `operator_confirmed`. That status is derived only from a valid human confirmation
joined to an exact claim or ambiguity digest. `payload_digest` covers canonical claim bytes rather than its containing
envelope, so it is not self-referential. The immutable artifact store supplies the whole-envelope digest. Unknown
claims require `unknown_reason`; observed claims require evidence and no confidence; inferred claims require evidence
and confidence; conflicted claims retain both supporting and conflicting references. A changed interpretation creates
a new artifact with `supersedes_interpretation_digest`; it never edits prior claims.

### Coverage Ambiguity, Confirmation, And Resolution

```yaml
ambiguity:
  schema_version: alphonse.coverage-ambiguity.v0.1
  ambiguity_id: stable-string
  onboarding_id: uuid
  source_interpretation_digest: sha256
  kind: objective | consequence | evidence | effect | privacy | fixture | repair | promotion | rollback
  claim_references: [claim-id]
  question: bounded-string
  blocking: boolean
  choices: [{ choice_id: stable-string, meaning: bounded-string }]
  evidence_references: []
  initial_status: open
confirmation:
  schema_version: alphonse.coverage-confirmation.v0.1
  confirmation_id: uuid
  onboarding_id: uuid
  subject: { type: claim | ambiguity, id: stable-string, digest: sha256 }
  disposition: accepted | rejected | selected_choice | supplied_value | accepted_unknown
  choice_id: stable-string | null
  supplied_value: bounded-typed-value | null
  principal_id: uuid
  work_intent_id: uuid
  scope: exact-workflow | exact-revision | exact-profile-version
  rationale: bounded-string
  confirmed_at: date-time
  authority: human_confirmation_only
resolution:
  schema_version: alphonse.coverage-ambiguity-resolution.v0.1
  resolution_id: uuid
  onboarding_id: uuid
  ambiguity_id: stable-string
  ambiguity_digest: sha256
  confirmation_id: uuid
  confirmation_digest: sha256
  status: resolved | accepted_nonblocking_unknown
```

Confirmations and resolutions bind exact existing material; they do not refer to the later review bundle that embeds
their digests. This removes the ambiguity-resolution/review-bundle digest cycle. `accepted_unknown` is permitted only
for a nonblocking ambiguity and must remain visible in review limitations. A blocking ambiguity requires a `resolved`
disposition before bundle creation.

### Coverage Review Bundle And Approval

```yaml
review_bundle:
  schema_version: alphonse.coverage-review-bundle.v0.1
  onboarding_id: uuid
  onboarding_revision: nonnegative-integer
  status: reviewable
  workflow_reference: { system: string, environment: string, provider_workflow_id: string }
  snapshot_digest: sha256
  interpretation_digest: sha256
  confirmation_digests: [sha256]
  ambiguity_dispositions:
    - { ambiguity_id: stable-string, ambiguity_digest: sha256, resolution_digest: sha256, status: resolved | accepted_nonblocking_unknown }
  objective_and_consequences: {}
  effect_inventory: []
  unknowns: [{ subject_reference: exact-reference, reason: bounded-string, blocking: false }]
  limitations: []
  redaction_policy_reference: exact-reference
  integration_contract_references: []
  behavior_contract_references: []
  fixture_references: []
  repair_binding_reference: exact-reference | null
  verification_strategy_reference: exact-reference | null
  promotion_conditions: {}
  rollback_assumptions: {}
  coverage_profile_reference: exact-version-reference | null
approval:
  schema_version: alphonse.coverage-review-approval.v0.1
  approval_id: uuid
  review_bundle_digest: sha256
  principal_id: uuid
  work_intent_id: uuid
  work_intent_digest: sha256
  scope: exact-workflow-and-review-digest
  rationale: bounded-string
  issued_at: date-time
  valid_until: date-time | null
  authority_granted: [compile_exact_bundle]
  authority_denied: [source_control, manifest_import, registration, provider_credential, workflow_execution, repair, verification, promotion, external_effect]
```

The immutable bundle's `status: reviewable` means all blocking ambiguities have exact resolution digests; it is not an
approval state. Current approval eligibility is derived from the onboarding event stream and validity window rather
than mutated into either artifact.

### Review Invalidation And Current Status

```yaml
review_invalidation_event:
  schema_version: alphonse.coverage-review-invalidation-event.v0.1
  event_id: uuid
  onboarding_id: uuid
  onboarding_revision: nonnegative-integer
  prior_review_bundle_digest: sha256
  prior_approval: { approval_id: uuid, approval_digest: sha256 }
  trigger: snapshot_replaced | interpretation_superseded | ambiguity_changed | limitation_changed | fixture_changed | contract_changed | binding_changed | policy_changed
  prior_material_digest: sha256
  replacement_material_digest: sha256
  reason: bounded-string
  invalidated_at: date-time
  eligibility_revoked: [compilation, validation, source_control_proposal, manifest_import, registration]
  authority: none
coverage_onboarding_projection:
  schema_version: alphonse.coverage-onboarding-projection.v0.1
  onboarding_id: uuid
  revision: nonnegative-integer
  status: opened | gathering_evidence | interpreting | resolving_ambiguity | reviewable | approved | review_required | compiled | validated | source_control_proposed | manifest_imported | registered | cancelled | superseded
  active_snapshot_digest: sha256 | null
  active_interpretation_digest: sha256 | null
  active_review_bundle_digest: sha256 | null
  active_approval: { approval_id: uuid, approval_digest: sha256 } | null
  latest_invalidation_event_digest: sha256 | null
  blocking_ambiguity_ids: [stable-string]
  unresolved_nonblocking_ambiguity_ids: [stable-string]
  unknowns: [{ subject_reference: exact-reference, reason: bounded-string }]
  legal_next_operations: [operation-id]
```

The append-only invalidation event revokes eligibility within this onboarding aggregate; it grants no authority and
does not erase or mutate the Kernel approval. Compilation must bind a projection revision and event-head digest whose
derived status is `approved`. Any later material event changes that head and makes the compilation input stale.

### Coverage Specification, Compilation, And Validation

```yaml
compilation_input:
  schema_version: alphonse.coverage-compilation-input.v0.1
  onboarding_id: uuid
  review_bundle_digest: sha256
  approval_id: uuid
  approval_digest: sha256
  review_state: { onboarding_revision: nonnegative-integer, event_head_digest: sha256, status: approved }
  base_manifest_reference: exact-reference | null
  compiler: { id: namespaced-string, version: semver, artifact_digest: sha256 }
coverage_specification:
  schema_version: alphonse.coverage-specification.v0.1
  compilation_input_digest: sha256
  review_bundle_digest: sha256
  approval_digest: sha256
  workflow_identity: {}
  revision_closure: {}
  effect_inventory: []
  evidence_and_redaction_policy: {}
  capability_prerequisites: {}
  unknowns: []
  limitations: []
  contract_references: []
  fixture_references: []
  adapter_and_binding_references: []
workflow_manifest_proposal:
  schema_version: alphonse.workflow-manifest.v0.1
  semantic_material: deterministic-object
validation_receipt:
  schema_version: alphonse.coverage-validation-receipt.v0.1
  compilation_input_digest: sha256
  coverage_specification_digest: sha256
  review_bundle_digest: sha256
  approval_digest: sha256
  review_state_digest: sha256
  compiler: { id: string, version: string, artifact_digest: sha256 }
  validator: { id: string, version: string, artifact_digest: sha256 }
  checks: [{ check_id: namespaced-string, status: passed | failed | not_applicable, evidence_references: [] }]
  issues: [{ code: namespaced-string, severity: error | warning, path: json-pointer, message: bounded-string }]
  unknowns: [{ path: json-pointer, reason: bounded-string, blocking: boolean }]
  limitations: []
  workflow_manifest_proposal_digest: sha256 | null
  status: valid | invalid
  authority: none
repository_proposal_receipt:
  schema_version: alphonse.repository-proposal-receipt.v0.1
  receipt_id: exact-external-reference
  repository: exact-repository-reference
  base_revision: exact-commit
  proposal_reference: exact-branch-or-pull-request-reference
  proposed_manifest_path: repository-relative-path
  proposed_manifest_digest: sha256
  coverage_validation_receipt_digest: sha256
  repository_actor_reference: exact-external-reference
  proposed_at: date-time
  status: proposed
  authority: none
workflow_manifest_import_receipt:
  schema_version: alphonse.workflow-manifest-import-receipt.v0.1
  repository: exact-repository-reference
  landed_commit: exact-commit
  landed_tree: exact-tree
  manifest_path: repository-relative-path
  manifest_digest: sha256
  workflow_manifest_proposal_digest: sha256
  coverage_validation_receipt_digest: sha256
  importer: { principal_id: uuid, implementation_digest: sha256 }
  validator: { id: string, version: string, artifact_digest: sha256 }
  imported_at: date-time
  status: imported | rejected
  authority: none
```

Timestamps and invocation IDs belong to the compilation execution receipt, not semantic output. Same semantic input,
approved review-state digest, and compiler identity must produce the same Coverage Specification and Workflow Manifest
proposal digests. Artifact and receipt digests are computed over canonical whole-document bytes and stored alongside,
not recursively inside, the document they identify.

## Capability Vector

| Capability | Minimum evidence | Does not imply |
| --- | --- | --- |
| `discovered` | Immutable provider inventory entry and discovery snapshot reference. | Credential readiness, revision identity, monitoring, or coverage. |
| `connected` | Scoped adapter binding can perform declared reads and reports bounded health. | Exact revision or complete execution observation. |
| `revision_bound` | Exact Agent Revision and immutable Workflow Attestation Binding match published provider material. | Runtime completeness or business correctness. |
| `execution_observed` | Accepted signed runtime observations under the bound revision plus the declared completeness basis. | Destination commitment or diagnosis readiness. |
| `diagnosable` | Exact extraction/redaction policy, evidence route, assignment boundary, and required source availability are ready. | Behavior monitoring, correct diagnosis, or repair. |
| `behavior_monitored` | Exact optional Behavior Contract, evaluator, required evidence roles, and source coverage are active. | Universal correctness; an indeterminate result remains possible. |
| `repair_bound` | Exact Repair Delivery Binding supports required inspect, snapshot, candidate, and rollback operations. | Candidate validity, verification, or promotion authority. |
| `verification_ready` | Exact critical-path fixture, deterministic stubs, runner, assertions, and prohibited-effects policy are usable. | Passing verification or broad workflow quality. |
| `promotion_ready` | Verification readiness plus exact target inspection, promotion, reconciliation, named-human approval path, and rollback binding. | Authorization for any candidate or successful target application. |

Accountable Coverage is derived from an exact vector, policy version, time interval, evidence cutoff, gaps, and
limitations. A policy may require a subset appropriate to the workflow's consequence. The projection must never imply
that an unavailable capability is present or that runtime acknowledgement proves destination commitment.

Future Coverage Intervals are half-open time ranges over one exact derived vector, policy version, limitation set,
and reason. They are projections from immutable readiness, observation, drift, suspension, and recovery events; they
are not a mutable aggregate. Their storage and reconciliation policy are deferred.

## Operation Mapping

Kernel and Diagnostic Protocol operation IDs remain canonical. Agent Gateway has no independent operation semantics and
no implementation in the current repository; ADR 0022 defines it as a future bounded projection of the same Operation
Descriptors. It must preserve operation IDs, schemas, preconditions, authority classes, denials, and receipts while
allow-listing only the operations relevant to one exact Work Intent. Operational Packages contribute versioned adapter
and policy contracts, not authority or a parallel protocol.

### Exact existing operations

| Surface | Onboarding need | Exact existing operations | Reuse constraint |
| --- | --- | --- | --- |
| Kernel Protocol | Discover protocol and safe next actions | `kernel.protocol.bootstrap.get`, `kernel.operation.catalog.list`, `kernel.operation.descriptor.get` | Descriptor visibility grants no invocation authority. |
| Kernel Protocol | Attribute the agent | `kernel.principal.create`, `kernel.principal.get`, `kernel.agent_passport.issue`, `kernel.agent_passport.get` | Identity and Passport remain separate from Work Intent and authority. |
| Kernel Protocol | Bind why the agent is acting | `kernel.work_intent.propose`, `kernel.work_intent.confirm`, `kernel.work_intent.get` | Confirmation binds purpose; it does not approve workflow meaning. |
| Kernel Protocol | Attribute construction | `kernel.build_session.open`, `kernel.build_session.get` | Build Session stores attribution and exact references, not onboarding drafts. |
| Kernel Protocol | Validate and publish a Coverage Profile after its export contract exists | `kernel.package_candidate.validate`, `kernel.package_validation_receipt.get`, `kernel.package_candidate.simulate`, `kernel.package_simulation_receipt.get`, `kernel.package_version.publish`, `kernel.package_version.get` | Current validation rejects `coverage_profile`; the export schema and validator must be extended before these operations can be reused. |
| Diagnostic Protocol | Discover adapter contract | `diagnostic.workflow_runtime_adapter.contract.get` | The current contract describes one known workflow and has no inventory capability. |
| Diagnostic Protocol | Register and inspect final workflow material | `diagnostic.agent_workflow.register`, `diagnostic.agent_workflow.get`, `diagnostic.agent_revision.register`, `diagnostic.agent_revision.get`, `diagnostic.artifact.get` | Registration operations remain low-level primitives; Coverage Onboarding may reuse them only inside its landed-manifest import gate. |
| Diagnostic Protocol | Receive and inspect runtime claims after readiness | `diagnostic.runtime_event.receive`, `diagnostic.external_activity_trace.get`, `diagnostic.runtime_event_conflict.get` | Accepted claims remain attributed observations, not external truth. |
| Diagnostic Protocol | Evaluate optional behavior | `diagnostic.interpretation_activation.activate`, `diagnostic.interpretation_activation.get`, `diagnostic.effect_evaluation.process`, `diagnostic.effect_projection.get`, `diagnostic.behavior_evaluation.get`, `diagnostic.trigger.get` | Optional Behavior Contracts and source-coverage rules remain unchanged. |
| Diagnostic Protocol | Preserve repair, verification, promotion, reconciliation, and rollback boundaries | `diagnostic.repair_candidate.get`, `diagnostic.repair_delivery_binding.register`, `diagnostic.repair_delivery_binding.get`, `diagnostic.repair_delivery_target.inspect`, `diagnostic.repair_delivery.materialize`, `diagnostic.repair_delivery.get`, `diagnostic.repair_verification.create`, `diagnostic.repair_verification.get`, `diagnostic.promotion.authorize`, `diagnostic.promotion.apply`, `diagnostic.promotion.reconcile`, `diagnostic.promotion.rollback`, `diagnostic.promotion.get` | Onboarding records exact readiness references only and never invokes these lifecycles. |
| Operational Package | Resolve one known workflow and runtime readiness | `runtime_adapter.workflow_identity.describe`, `runtime_adapter.revision_identity.resolve`, `runtime_adapter.execution_detail.retrieve`, `runtime_adapter.health.get` | Adapter operations run behind the adapter-held provider credential and return typed untrusted evidence and omissions. |

### Required contract extensions without a new canonical protocol operation

| Surface | Extension | Reason |
| --- | --- | --- |
| Operational Package | Add a versioned `coverage_profile` export schema and validator to Package Candidate validation. | Package Version identity, validation receipts, simulation, publication, and dependency semantics are reusable, but the current finite export-kind set rejects the proposed profile. |
| Agent Gateway | Project the exact Kernel and Diagnostic descriptors listed below into a Work Intent-scoped task tool set. | Gateway is an ergonomic projection, not a system of record; it must not rename operations, merge plane semantics, hold provider credentials, or create ambient access. |

### Genuinely missing operations

| Canonical surface | Exact proposed operations | Authority/effect boundary | Agent Gateway treatment |
| --- | --- | --- | --- |
| Operational Package adapter | `runtime_adapter.workflow_inventory.list` | Adapter-held scoped credential; read-only and cursor-bound; returns typed untrusted metadata, omissions, and source cutoff. | Never projected with provider credentials; invoked through bounded evidence capture. |
| Diagnostic Protocol | `diagnostic.coverage_onboarding.open`, `diagnostic.coverage_onboarding.get` | Confirmed Work Intent and scoped agent attribution; creates or reads one durable non-authoritative lifecycle. | Project only for the exact onboarding Work Intent and aggregate. |
| Diagnostic Protocol | `diagnostic.coverage_onboarding.evidence_capture` | Invokes exact adapter reads and freezes a Workflow Discovery Snapshot; cannot register or activate. | Project without exposing adapter credentials or raw ambient tools. |
| Diagnostic Protocol | `diagnostic.coverage_interpretation.submit` | Scoped agent Principal whose Passport and confirmed Work Intent bind the exact onboarding; exact snapshot provenance; human-confirmation fields prohibited. | Project only with the exact Work Intent, onboarding, and schema. |
| Diagnostic Protocol | `diagnostic.coverage_ambiguity.resolve` | Named human Principal; append-only confirmation bound to the exact ambiguity digest, chosen disposition, scope, rationale, and time; grants no business authority. | Human-facing projection only; never exposed as an agent confirmation tool. |
| Diagnostic Protocol | `diagnostic.coverage_review_bundle.create`, `diagnostic.coverage_review_bundle.get` | Deterministic assembly from exact evidence, claims, ambiguity dispositions, and policy references. | Create is projected only after blocking ambiguity checks pass; get is scope-filtered. |
| Kernel Protocol | `kernel.coverage_review.approve`, `kernel.coverage_review.get` | Named human Principal only; exact bundle digest; narrowly grants deterministic compilation eligibility. | Human-facing approval projection only; never exposed to the onboarding agent. |
| Diagnostic Protocol | `diagnostic.coverage_specification.compile`, `diagnostic.coverage_specification.get` | Deterministic, side-effect-free compiler; exact valid approval required; emits artifacts only. | Agent may request compilation but cannot supply or synthesize approval. |
| Diagnostic Protocol | `diagnostic.coverage_specification.validate` | Deterministic checks and receipt; no source-control, registration, or activation authority. | Project as a bounded deterministic operation. |
| Diagnostic Protocol | `diagnostic.workflow_manifest.import`, `diagnostic.workflow_manifest.get` | Read-only repository import under scoped importer identity; binds exact landed commit, tree, path, manifest and validated proposal digests in an immutable receipt. | Not an ambient repository tool; projection accepts exact landed references only. |
| Diagnostic Protocol | `diagnostic.coverage_registration.request` | Requires one exact valid review approval, validation receipt, and matching landed-manifest import receipt; may invoke existing workflow and revision registration internally but grants no activation or business authority. | Project only after deterministic preconditions expose eligibility. |
| Diagnostic Protocol | `diagnostic.workflow_coverage_capabilities.get` | Read-only projection with exact evidence, limitations, cutoff, and policy identity. | Safe read projection; unavailable capabilities and omitted evidence remain explicit. |

Ambiguity is projected and resolved through Coverage Onboarding events rather than a standalone ambiguity service.
Material-changing onboarding operations deterministically append the invalidation event when an active approval or
downstream artifact exists; no caller-controlled invalidation operation is added.
Source-control proposal creation is an adapter outside Kernel authority; it consumes the exact validated proposal and
produces its own repository receipt under separate repository authority. Merge or landing remains an external
source-control decision. Automatic source write, merge, and registration from unlanded proposal bytes are not
authorized by this slice.

## Deferred Production Policies

The following remain roadmap requirements but do not block the domain and compilation proof:

- observation latency SLO and degradation threshold;
- reconciliation/backfill duration and gap policy implementation;
- retention schedules and governed deletion implementation;
- backup RPO, restore RTO, and off-host custody;
- MFA and human-role hardening;
- signed releases, SBOM, provenance, compatibility, migration, and rollback policy;
- read-only client coverage bundles;
- Codex Maintenance Agent Runtime certification and Maintenance Work Queue;
- Builder Console onboarding projection;
- unfamiliar-agency production qualification.

None may weaken the exact-reference, provenance, separation-of-authority, approval-digest, deterministic-compilation,
or truthful-capability invariants defined here.
