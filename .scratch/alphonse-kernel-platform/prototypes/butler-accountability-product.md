# Butler Accountability Product

Status: rough HITL prototype

## Claim

Butler can make agentic operations understandable, actionable, and collaborative by projecting Kernel accountability into work-centered threads, exception queues, decision packets, recovery coordination, and handoffs without becoming an authority source or manufacturing operator chores.

Product shorthand:

> Slack for accountable agentic operations.

## Product Boundary

Butler is a first-party user-space product over Kernel Protocol and projections.

Butler may:

- display permitted state
- explain and summarize
- notify and route
- prepare decision packets
- propose Work Intents
- relay authenticated Kernel commands
- coordinate handoff and recovery

Butler may not:

- mint identity, Passport, Delegation, or authority
- approve or activate
- directly alter Kernel state
- satisfy evidence or Obligations by assertion
- create privileged recovery paths
- treat model confidence as policy

Every consequential operation remains a canonical Kernel command from an authenticated Principal or authorized agent.

## Accountable Work Thread

Primary unit is accountable work, not chat channel or raw Run.

Thread binds projections of:

- exact Work Intent
- responsible humans and agents
- Package, Skill, Deployment, and Capability versions
- execution status
- separate accountability status
- Runs and Effects
- Evidence Records
- open, satisfied, waived, or breached Obligations
- approvals and activation
- Escalations and Recovery Cases
- handoffs
- attributed conversation

Conversation provides context. Structured Kernel objects remain authoritative.

## Status Model

Thread always displays independently:

- execution status
- accountability status
- authority/activation status
- context/evidence freshness

No single success boolean may flatten them.

Examples:

- Run succeeded; accountability open because evidence pending
- Run failed; accountability satisfied because containment/escalation completed
- Run uncertain; recovery open because Effect requires reconciliation

## Operator Inbox

One exception-focused inbox groups items by Accountable Work Thread.

Mandatory queue item requires Kernel-backed:

- human approval request
- Operational Obligation
- Escalation
- Recovery Case
- explicit handoff
- policy-defined exception

Queue conditions include:

- human decision required
- approval required
- Obligation approaching or breaching deadline
- uncertain Effect
- blocked recovery
- repeated agent stall/failure
- invalidated authority, context, or credential
- handoff awaiting acceptance

Routine progress remains in thread timeline.

Priority is deterministic from severity, deadline, impact, and responsibility. Models explain priority but cannot define authoritative urgency.

## Preventing Operator Task Explosion

Butler:

- deduplicates related symptoms
- groups them under one source thread
- bundles evidence into one decision packet
- recommends one next action
- automatically removes/suppresses items when source state closes
- uses digests for non-urgent information
- measures human attention consumed per workflow

Model suggestions appear as optional insights, not mandatory tasks. Free-form agents cannot manufacture operator queue entries.

## Alerts And Escalation

Accountability Contract declares:

- responsible role
- severity
- response deadline
- notification channels
- fallback/escalation chain
- acknowledgement requirements
- quiet-hours exceptions

Butler sends concise state-change alerts, records delivery/acknowledgement, and escalates only when policy conditions trigger.

Acknowledging an alert never satisfies its underlying Obligation.

User preferences may reduce optional noise but cannot hide mandatory escalation.

## Explanations

Every Butler explanation separates:

- **Facts**: Kernel records, projections, receipts, deadlines
- **Inference**: likely cause or relationship
- **Recommendation**: proposed next action
- **Uncertainty**: missing, conflicting, or stale information

Explanation cites exact source objects and revisions, binds projection cursor, and refreshes when state changes.

Core questions:

- What happened?
- Why is this in my inbox?
- What remains unresolved?
- Who is responsible?
- What actions are permitted?
- What happens if nobody acts?

Model confidence informs wording, never authority or routing.

## Action Cards

Butler receives permitted action affordances from Kernel Protocol. It does not invent them.

Each action card shows:

- exact operation
- affected objects/versions
- authority required
- expected consequence
- evidence/recovery impact
- current revision and expiry

Human action is authenticated and submitted as that Principal directly to Kernel. Butler presents and relays.

Corrective Work Intent remains a proposal until explicitly confirmed.

## Recovery Coordination

Recovery Case view displays:

- original Run/Effect and preserved failure
- known facts and uncertainty
- evidence already collected
- required reconciliation checks
- permitted recovery options
- authority required for each option
- deadlines and responsible actor

Butler may investigate and propose:

- reconcile
- retry after reconciliation
- resume from checkpoint
- compensate
- manual remedy
- accept loss with rationale

Chosen recovery follows normal Work Intent, Capability, Envelope, Run, Effect, evidence, and recovery authority. Original history never changes.

## Handoff

Explicit Hand Off action binds:

- target human, agent, or runtime
- exact Work Intent
- Package, Skill, and Capability versions
- current ledger cursor
- Context Receipts
- open Obligations
- unresolved questions
- proposed Delegation scope and expiry

Handoff remains pending until target accepts. On acceptance, Kernel activates target responsibility and closes or narrows source authority atomically.

Conversation history is optional evidence, never required execution context.

## Domain-Specific Operator Views

Butler core is generic:

- status
- timeline
- obligations
- Effects/evidence
- approvals
- recovery
- handoff
- comments

Operational Packages may export declarative Operator View definitions for domain fields, summaries, comparisons, and permitted actions.

Butler renders only validated version-bound views. Custom executable UI remains sandboxed/high-risk and later scope.

## Conversation

Comments are thread-bound and attributed to exact human/agent identity.

- Human and agent identities are visibly distinct.
- Agent Passport and current scope are inspectable.
- Edits preserve revision history.
- Attachments remain typed external references.
- Summaries bind source cursor and disclose staleness.
- Conversation may propose Work Intent/actions.
- Only structured confirmation changes authority.
- Comments satisfy evidence only through declared Evidence submission.

## Dashboards And Modules

Butler supports personal/team layouts composed from approved projection modules:

- active accountable work
- approvals
- approaching/breached Obligations
- uncertain Effects
- Recovery Cases
- agent/runtime health
- workflow outcome trends
- queue age and human attention

Personal layout changes require no Kernel authority.

Shared/domain modules are versioned Operator View exports through Package review. Module actions still come from Kernel affordances.

Every metric links to source threads/records. Execution and accountability remain separate.

## Visibility And Data Access

Butler queries as current Principal:

- projection fields filtered by role and Environment
- sensitive references redacted
- business payload fetched on demand through Context Grants
- no shadow context database
- search, summaries, exports, and notifications preserve source permissions
- agents explain only records they may access
- cached views expire and revalidate
- support users remain inside temporary Support Passport

Administrator UI does not imply unrestricted business-data access.

## Butler Intelligence

Butler model/runtime is replaceable and uses ordinary Butler Agent Passport.

Allowed:

- read permitted projections
- explain state
- summarize evidence
- identify missing information
- prepare decision packets
- propose corrective Work Intents
- route under declared escalation policy

Forbidden:

- approve
- activate
- mint authority
- alter priority policy
- satisfy Obligations
- execute recovery through privileged path

Codex, OpenClaw, ChatGPT, or another runtime may fill the role through same Package/Skill and Kernel Protocol.

## Butler V0

Build only:

1. exception-focused inbox
2. Accountable Work Thread
3. execution/accountability status
4. Effect/evidence timeline
5. Obligation/deadline panel
6. approval/action cards
7. Recovery Case workflow
8. runtime handoff
9. simple comments
10. minimal modular overview

Later scope:

- general channels and DMs
- presence
- voice/video calls
- broad file sharing
- messaging-platform parity
- polished Slack replacement

## Required Invariants

1. Butler never becomes source of authority.
2. Conversation never substitutes for confirmed Work Intent.
3. Execution and accountability remain separately visible.
4. Mandatory queue items always reference Kernel-backed work.
5. Model suggestion cannot manufacture operator obligation.
6. Every action is exact, revision-bound, attributed, and submitted to Kernel.
7. Recovery never edits original failure.
8. Handoff transfers structured state, not hidden conversation memory.
9. Domain views never add domain logic to Kernel.
10. Butler never creates unrestricted context copies.
11. Agent identity and Passport remain visible.
12. Notifications and acknowledgements never satisfy evidence/Obligations.

## First-Proof Checks

Inventory workflow operator must:

1. understand correction without reading logs
2. inspect source authority/freshness
3. approve exact bounded Effect
4. distinguish Run status from accountability
5. see timeout become uncertainty
6. review one bundled recovery decision packet
7. complete reconciliation/recovery through normal authority
8. hand work to different runtime without conversation history
9. explain final accountability state
10. receive no unnecessary mandatory tasks

## Prototype Outcome

Butler V0 is the minimum accountable operations surface required to prove Kernel. It centers work objects rather than chat, uses an exception-focused inbox, separates facts/inference/recommendations, exposes only Kernel-permitted actions, coordinates recovery and handoff through normal authority, and lets replaceable agents assist without becoming supervisors. This is the narrow first implementation of Slack for accountable agentic operations, not a general messaging clone.
