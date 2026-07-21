---
status: proposed
---

# Govern Agent-Driven Workflow Coverage Onboarding As A Separate Reverse-Specification Lifecycle

Alphonse needs to turn an arbitrary existing n8n workflow into exact, source-controlled coverage configuration. The
workflow already exists, so this is reverse specification rather than workflow construction. An agency-owned agent
should gather evidence and prepare the result, while a named human remains responsible for consequential meaning and
deterministic software remains responsible for compilation and validation.

Existing objects do not own this lifecycle. A Diagnostic Case starts from one behavioral problem and groups failure
investigation and repair. A Build Session attributes package construction but intentionally stores no mutable draft
contents. A Work Intent explains why an agent acts but grants no authority. A Workflow Manifest is the final
repository-owned declaration, not the evidence-gathering workspace that produces it. Reusing any of them as the
onboarding state machine would blur their accepted boundaries.

Coverage Onboarding is therefore a new durable Diagnostic Plane aggregate. It owns append-only lifecycle events for
one exact external workflow selection or one behavior-bearing revision change. Its supporting material is kept small:
the Workflow Discovery Snapshot, Workflow Interpretation Claim, Coverage Review Bundle, Coverage Specification, and
Effect Inventory are immutable content-addressed artifacts or artifact sections; Coverage Ambiguities are typed items
whose current state is projected from append-only events; the Workflow Coverage Capability Projection and future
coverage intervals are derived read models. A revision change opens a linked Coverage Onboarding with
`reason: revision_change`; it is not a separate Change Case object. A Maintenance Work Queue is deferred and is not
part of this aggregate.

The Diagnostic Plane owns source evidence, agent proposals, ambiguity state, review material, compilation records,
and non-authoritative validation results. Kernel Authority Services own a new Coverage Review Approval record. That
record binds a named human Principal, exact Coverage Review Bundle digest, scope, rationale, validity, and Work Intent.
It permits deterministic compilation of that exact reviewed meaning, but grants no source-control proposal, merge,
manifest import, registration, workflow execution, external read credential, repair, verification, promotion,
target-change, or external-effect authority.
An agent cannot submit, synthesize, or inherit this approval. A material evidence, claim, ambiguity, limitation,
fixture, contract, binding, or policy change appends an invalidation event binding the prior bundle and approval,
the changed material, reason, and time. The aggregate then derives `review_required`; the old approval remains
historically visible but is ineligible for further compilation, validation, proposal, import, or registration use.
A later approval must bind a newly assembled review digest.

The compilation and validation pipeline is deterministic and side-effect free. Compilation consumes one exact review
bundle plus its exact approval and emits a Coverage Specification and proposed Workflow Manifest; validation emits a
Coverage Validation Receipt over those exact artifacts. Semantic outputs
contain no wall-clock time or random identity. Execution metadata may record when and where compilation ran without
entering the semantic digests. Identical semantic inputs and compiler identity produce identical output digests.
Compilation never writes source control, registers a workflow, activates a capability, or changes a target. A passing
Coverage Validation Receipt only makes the exact proposal eligible to be offered to a separately authorized
source-control path.

Source-control proposal and landing remain outside the Coverage Review Approval. A repository adapter may propose the
exact validated bytes only under separate repository authority and emits an exact proposal receipt. Merge or landing
is an external source-control decision. Alphonse then imports the exact landed repository revision through a new
immutable Workflow Manifest import boundary that binds repository, commit, tree, path, manifest digest, validated
proposal digest, importer, and validator in a receipt. Coverage Onboarding may request registration only from that
exact import receipt while the review and validation bindings remain valid. The existing low-level Agent Workflow and
Agent Revision registration operations remain unchanged and are not called directly by the onboarding agent.

Agent-produced interpretation distinguishes `observed`, `inferred`, `conflicted`, and `unknown` in machine-readable
claim items with stable IDs, exact evidence references, and explicit unknown reasons. The agent cannot
emit `operator_confirmed`; that status is derived only by joining an exact claim or ambiguity to a valid human
confirmation. A confirmation binds the exact claim or ambiguity digest and chosen disposition; it does not bind the
later bundle that contains it, avoiding a cyclic digest dependency. Observed items require evidence references.
Inferences require supporting evidence and confidence. Conflicts retain all contradictory evidence. Unknowns and
nonblocking ambiguities remain in the final limitations. Every blocking ambiguity must have an attributable
disposition inside the exact review bundle before approval.

Workflow coverage is not a linear maturity state. The product derives an independent capability vector for
`discovered`, `connected`, `revision_bound`, `execution_observed`, `diagnosable`, `behavior_monitored`,
`repair_bound`, `verification_ready`, and `promotion_ready`. Accountable Coverage is a separate commercial projection
over one exact vector, policy version, evidence cutoff, historical gaps, and disclosed limitations. Optional Behavior
Contracts affect `behavior_monitored`; optional destination reconciliation or observation affects evidence basis.
Neither is required merely to discover, bind, or observe a workflow.

The first protocol addition is intentionally narrow. The Workflow Runtime Adapter gains scoped inventory listing;
the Diagnostic Protocol gains Coverage Onboarding, evidence capture, interpretation, review-bundle, compilation,
validation, manifest-import, registration-request, and capability-projection operations; Kernel gains Coverage Review
Approval. Agent Gateway adds no independent operation semantics; it will project exact Work Intent-scoped Kernel and
Diagnostic descriptors when implemented. Coverage Profile extends the finite Operational Package export contract,
which does not support that kind today, while reusing existing package validation and publication operations. Existing
Principal, Agent Passport, Work Intent, Build Session, Agent Workflow and Agent Revision registration, Behavior
Contract, repair, verification, and promotion operations are reused without changing their semantics. Provider
credentials remain inside the adapter boundary, and adapter-returned content is typed untrusted evidence, never agent
instruction or authority.

Production observation SLOs, reconciliation duration, retention schedules, backup targets, MFA, release provenance,
client coverage bundles, Maintenance Agent Runtime certification, Builder Console projection, and unfamiliar-agency
qualification remain required roadmap policies but are deliberately deferred from this domain and compilation slice.
They cannot silently alter the authority, provenance, or digest invariants recorded here.

This choice introduces one new lifecycle aggregate and one new human authority record. That cost is accepted because
it preserves the narrower meanings of Diagnostic Case, Build Session, Work Intent, and Workflow Manifest. Creating a
domain object for every intermediate document was rejected; using conversation state as durable truth was rejected;
letting an agent compile or register unapproved meaning was rejected; and treating Accountable Coverage as an
intermediate readiness stage was rejected.
