# Alphonse Console V0.1: Accountable Agent Operations

Label: draft-for-review

## Objective

Give Builders and customer Owners one clear surface for understanding, debugging, and governing agent workflows without weakening Alphonse's existing authority boundaries.

The Console should answer five questions quickly:

1. What needs attention?
2. What is known, observed, inferred, or uncertain?
3. Which exact workflow revision, evidence, worker, candidate, and target state are involved?
4. What can legally happen next, and who has authority?
5. What happened after an action was requested?

The Console is a client of Kernel and Diagnostic public operations. It does not become a source of operational truth, execute agents, store provider credentials, infer authority, or mutate databases directly.

## Product Position

Alphonse Console is the operator workspace for accountable agentic operations.

It is not:

- a general observability dashboard;
- an agent chat interface;
- a workflow editor or n8n replacement;
- an autonomous repair agent;
- a second policy or authority engine;
- a low-code automation builder.

V0.1 focuses on the governed Debug Loop already proven headlessly. Broader Kernel capabilities remain discoverable but do not all need custom UI yet.

## Users

### Builder

Connects workflows, investigates wrong outcomes, confirms repair targets with the customer, commissions bounded repair work, reviews advisory diagnosis, and inspects evidence.

### Customer Owner

Reviews exact verified changes, authorizes promotion or rollback, and understands target uncertainty before permitting consequential actions.

### Operator

Maintains the local installation, adapters, retention, release state, and worker connectivity. In V0.1 this may be the same person as the Builder.

Machine participants never use the human Console session. Repair Workers and Diagnostic Workers authenticate through their own Agent Passports and public agent operations.

## Product Principles

### Preserve Separate Truths

Never flatten the lifecycle into one status such as `healthy`, `approved`, or `fixed`. Display these independently:

- external activity observation;
- human-confirmed failure truth;
- deterministic reproduction;
- advisory diagnosis usefulness;
- Repair Task attempt state;
- Repair Candidate state;
- Verification Receipt outcome;
- Owner promotion authorization;
- target application and reconciliation state;
- rollback state.

### Exact Identity Before Friendly Labels

Use readable names first, but keep revision IDs, digests, worker identities, receipt IDs, adapter versions, timestamps, and idempotency results one click away. Labels never replace identity.

### Legal Next Action, Not Generic Buttons

Primary actions come from `legal_next_operations`. The Console explains missing prerequisites, but server admission remains authoritative. Disabled actions state the blocking condition.

### Consequence-Proportional Friction

Reads and local investigation are fast. Failure confirmation, retention, promotion, reconciliation, and rollback receive progressively stronger review. Promotion shows exact candidate, verification, target, expected result, and rollback reference before confirmation.

### Visibility Without Laundry Lists

Overview prioritizes exceptions requiring a human decision. Routine completed activity stays available through filters and history instead of becoming a task.

### Intelligence Is Advisory

Model-assisted diagnosis appears as optional evidence-bound content. Facts, inference, hypotheses, uncertainty, and recommended investigation stay visibly separate. Accepting diagnosis means useful, never verified or true.

## Information Architecture

### 1. Overview

The first screen is a quiet operational inbox, not a marketing dashboard.

Sections:

- **Needs decision:** failure specifications awaiting confirmation, verified candidates awaiting Owner action, uncertain promotions requiring reconciliation, rollback decisions.
- **Needs investigation:** wrong outcomes, failed reproductions, expired or failed worker attempts, rejected verification, stale adapter reporting.
- **Active work:** leased Repair Tasks, running verification, pending target application.
- **System:** Kernel, Diagnostic Plane, adapters, release, and storage health.
- **Recent outcomes:** confirmed promotions, reconciliations, rollbacks, rejected candidates, retired artifacts.

Each row shows object type, workflow, state, age, accountable actor, short reason, and one legal next action. Filters support workflow, state, responsibility, and time.

### 2. Workflows

List registered Agent Workflows with:

- current observed revision;
- runtime and adapter;
- last external activity;
- open Diagnostic Case count;
- instrumentation freshness;
- latest confirmed target revision when available.

Workflow detail has Overview, Revisions, Activity, Cases, and Integration tabs. Revision comparison is structural and digest-aware; it does not claim semantic equivalence.

### 3. Diagnostic Cases

Diagnostic Case is the primary work surface.

#### Header

- workflow and exact affected revision;
- concise failure summary;
- independent lifecycle badges rather than one aggregate status;
- accountable human and machine participants;
- case age and last transition;
- legal next action.

#### Lifecycle Lanes

A compact horizontal or responsive stacked view keeps separate states visible:

1. Observed
2. Failure confirmed
3. Reproduced
4. Diagnosis optional
5. Repair proposed
6. Independently verified
7. Owner authorized
8. Target confirmed

Uncertainty is a first-class branch, not a warning pasted onto success.

#### Timeline

One chronological stream covers observation, human confirmation, reproduction attempts, diagnosis proposals, repair attempts, candidate submissions, verification, authorization, application, reconciliation, and rollback. Each event links to immutable evidence.

#### Inspector

Selecting an event opens a right-side inspector with readable content and exact metadata:

- expected versus actual behavior;
- source trace and revision;
- fixtures, assumptions, redaction, and artifact state;
- diagnosis facts, inference, hypotheses, uncertainty, and usefulness;
- Repair Task scope, lease, worker, attempts, and failures;
- candidate behavior change and regression artifact;
- verification original/candidate outcomes and signed receipt;
- promotion request, idempotency, target result, reconciliation, and rollback.

#### Action Panel

Hand-designed forms cover:

- report wrong outcome;
- confirm Failure Specification;
- create deterministic reproduction;
- create bounded Repair Task;
- accept or reject diagnosis usefulness;
- run independent verification;
- authorize promotion;
- apply authorized promotion;
- reconcile uncertain promotion;
- authorize rollback;
- retire artifact bytes.

Forms use public Operation Descriptors for compatibility and legal availability. The core experience is not a generic JSON Schema renderer.

### 4. Workers

Show Agent Principals, Passport validity, confirmed Work Intent, worker role, assignment, lease, and recent outcomes.

Repair Worker and Diagnostic Worker identities remain distinct. The Console supports Owner-side identity and intent setup, then gives the customer-controlled worker a safe connection handoff. Agent authentication tokens appear only at issuance and never enter browser storage.

No human Console action impersonates a worker or submits worker output.

### 5. Evidence

Search and inspect artifacts, digests, references, retention state, and tombstones. Default views are readable; exact content and metadata are deliberate drill-downs.

Artifact retirement distinguishes:

- bytes available;
- bytes deleted;
- immutable digest tombstone retained;
- historical references preserved.

### 6. System

Show:

- Kernel and Diagnostic protocol versions;
- installation and environment identity;
- service health;
- adapter identity, version, compatibility, and freshness;
- active release manifest and digest;
- PostgreSQL and artifact-store availability;
- customer custody boundaries;
- recent idempotency conflicts and unresolved uncertainty.

Configuration stays minimal. The Console is not a general infrastructure admin panel.

## Dashboard Modules

Overview uses typed modules, but V0.1 avoids unrestricted plugins or query builders.

Initial modules:

- Needs Decision
- Needs Investigation
- Active Repair Work
- Uncertain Effects
- Workflow Freshness
- Recent Outcomes
- System Health

Users may reorder, hide, resize, and filter modules. Layout is interface preference, not Kernel state, and stays in browser-local storage for V0.1.

Custom modules use registered read-only data providers and typed output contracts. Creating a module grants no write authority. Module-triggered commands use the same public operations and confirmations as fixed views.

## VPSCLAW3 Visual Reuse

Use `C:\Users\Zach\Documents\CURSOR\VPSCLAW3\alphonse-app` as the visual and component reference, not as a backend architecture dependency.

### Reuse Directly Or Port Closely

- `src/components/layout/sidebar.tsx`: 15.5rem desktop navigation, grouped sections, mint active rail, workspace identity footer, mobile navigation pattern.
- `src/components/layout/app-header.tsx`: compact 3.25rem header, path context, service status.
- `src/components/layout/page-header.tsx`: restrained page title hierarchy, mono path, short brand rule.
- `src/components/layout/workspace-chrome.tsx`: `WorkspacePage`, 8px `WorkspacePanel`, alerts, stats, filters, empty states.
- `src/components/activity/unified-feed.tsx`: dense chronological event rows and status treatment as the starting point for Case Timeline.
- review queue list/detail interaction as the starting point for Overview decisions and Case inspection.
- dark terminal-mint palette, JetBrains Mono metadata, Lucide icons, compact tables, clear amber/rose/emerald states.

### Adapt Rather Than Copy

- Replace Conversation-first navigation with Overview, Workflows, Cases, Workers, Evidence, System.
- Replace generic `Operator online` with independently reported Kernel, Diagnostic, and adapter health.
- Replace confidence and score summaries with exact lifecycle state, evidence, uncertainty, and authority.
- Replace broad review cards with a timeline plus inspector to avoid nested cards.
- Replace conversational onboarding copy with operational labels and direct state.
- Keep page widths responsive; Case Workspace may use the full available width rather than `max-w-6xl`.

### Do Not Carry Forward

- radial ambient glow layers and decorative background blobs;
- gradient-heavy surfaces and glass as default decoration;
- 12px-16px card radii; Console cards and panels stay at 8px or less;
- terminal window dots where they imply fake window chrome;
- CRT scanlines or visual noise over operational data;
- nested cards inside cards;
- confidence percentages as an authority or routing signal;
- visible prose explaining how to use the interface.

## Interaction Model

### Navigation

Persistent left navigation:

- Overview
- Workflows
- Cases
- Workers
- Evidence
- System

Global search opens workflows, cases, revisions, workers, receipts, promotions, and artifacts by label or exact identifier.

### Visual Language

- near-black `#080907` workspace and `#0e100f` panels;
- mint `#7de7db` for selection, links, and live connectivity only;
- green for confirmed favorable outcomes;
- red for demonstrated failure or rejected admission;
- amber for uncertainty, expiry, or required attention;
- violet reserved for advisory model output, never authority;
- JetBrains Mono for identifiers, metadata, paths, and evidence;
- restrained sans type for readable operational content;
- 8px panel radius, 6px controls, hairline borders;
- no oversized hero type, decorative gradients, or floating page-section cards.

Status never relies on color alone. Every unfamiliar icon has a tooltip.

### Responsive Behavior

Desktop is primary. Tablet is fully functional. Mobile supports inspection, triage, diagnosis review, and simple decisions. Complex promotion and evidence comparison use a full-screen flow instead of compressed side panels.

## Critical Flows

### Investigate A Wrong Outcome

1. Builder selects the exact external trace.
2. Builder reports a wrong outcome.
3. Console shows observed runtime claim separately from reported business failure.
4. Human compares expected and actual behavior and confirms Failure Specification.
5. Builder creates reproduction from declared fixtures and assumptions.
6. Case advances only when reproduction is demonstrated.

### Commission And Verify Repair

1. Console confirms an eligible, distinct Repair Worker with live Passport and matching Work Intent.
2. Builder reviews base revision, bundle, scope, limits, outputs, and lease.
3. Builder creates Repair Task.
4. Console shows attempts, lease, heartbeat, expiry, failure, and candidate.
5. Builder starts independent verification against original, candidate, targeted regression, and retained regressions.
6. Passing verification displays eligibility only.

### Promote Safely

1. Owner opens verified candidate decision.
2. Console shows base, candidate digest, Verification Receipt, current target, expected target, and rollback reference.
3. Owner explicitly authorizes promotion.
4. Application is a separate action and state.
5. Confirmed target resolves the case.
6. Timeout or ambiguity enters `uncertain`; only reconcile is primary, never blind retry.
7. Reconciliation displays applied, not applied, or mismatch.
8. Rollback requires separate exact Owner authorization.

### Review Model-Assisted Diagnosis

1. Builder opens immutable diagnosis proposal.
2. Console separates facts, inference, hypotheses, uncertainty, and investigation.
3. Provenance shows model, runtime, instruction digest, and source digests.
4. Builder accepts or rejects usefulness, or leaves it unreviewed.
5. Case truth and legal repair actions remain unchanged.

## Technical Architecture

### Application Shape

Create `apps/console` as a separate TypeScript application packaged in local Compose.

Use the VPSCLAW3 customer UI stack where it reduces work:

- Next.js 16 and React 19;
- TypeScript;
- Tailwind CSS 4;
- Zod response validation;
- Lucide icons;
- existing layout primitives ported into a small Console design system.

Next route handlers provide the local BFF, making a separate proxy service unnecessary for V0.1. Do not copy VPSCLAW3 business logic, SQLite state, Butler API assumptions, NextAuth customer model, or OpenClaw runtime coupling.

### Trust Boundary

The browser never receives the Kernel bootstrap credential as durable application state. The loopback-only Next server holds configured Owner credentials, exchanges local unlock for an HttpOnly `SameSite=Strict` session cookie, and proxies only declared public operations.

The Console server:

- binds to loopback by default;
- has no database or artifact-filesystem access;
- has no Agent credentials;
- has no provider or n8n credentials;
- adds no operation absent from protocol discovery;
- validates route, method, payload size, and response shape;
- emits no authority of its own.

V0.1 supports one local Owner session. Multi-user identity, SSO, remote access, and broad RBAC are deferred.

### API Consumption

Startup reads:

- `GET /kernel/v0/bootstrap`;
- `GET /diagnostic/v0/bootstrap`;
- `GET /kernel/v0/accountable-work/overview`;
- health and relevant object reads.

Operation Descriptors control discovery, command availability, schema compatibility, and route binding. Domain views remain hand-designed.

Polling defaults:

- active or uncertain work: 2 seconds;
- overview and case lists: 5 seconds;
- system health: 10 seconds;
- completed immutable records: no background polling.

No WebSocket infrastructure is required.

### Command Handling

Every write:

- creates a fresh client command ID;
- displays authority class;
- previews exact consequential inputs;
- preserves command ID through transport retry;
- distinguishes replay from new acceptance;
- invalidates only related reads;
- shows structured denial, conflict, or uncertainty without inventing success;
- links resulting transition and immutable record.

The Console never silently retries a consequential command with a new command ID.

## Required States

Design every screen for:

- loading;
- empty but healthy;
- unavailable service;
- authentication expired;
- incompatible protocol;
- stale observation;
- permission denied;
- idempotent replay;
- idempotency conflict;
- worker expiry or process loss;
- rejected verification;
- uncertain target effect;
- retired artifact bytes;
- malformed or integrity-failed evidence.

## Security Requirements

- Loopback binding by default.
- No direct PostgreSQL or artifact filesystem access.
- No Owner token in local storage, session storage, URLs, logs, analytics, or client bundles.
- No Agent authentication tokens persisted by Console.
- No model-provider or integration credentials accepted by forms.
- CSP disallows remote script execution.
- User content renders as text, never trusted HTML.
- Digests and identifiers validate before requests.
- Consequential confirmations name the exact effect; generic `Confirm` is insufficient.
- No telemetry leaves the customer environment.

## Accessibility

- Full keyboard navigation and visible focus.
- Semantic tables, headings, forms, and dialogs.
- Status uses text and icon as well as color.
- WCAG AA contrast.
- Reduced-motion support.
- No information available only on hover.

## Acceptance Criteria

1. Fresh local release starts Kernel, Diagnostic Plane, Console server, and Console with one documented command.
2. Console uses only public HTTP operations and has no database credentials.
3. Builder finds seeded wrong inventory outcome and exact trace/revision.
4. Builder completes failure confirmation and deterministic reproduction.
5. Builder commissions bounded Repair Task without exposing Agent credentials.
6. Worker lease, failure, expiry, candidate, and evidence stay distinct.
7. Builder runs independent verification and inspects exact outcomes and receipt.
8. Owner authorizes and applies one exact promotion through separate steps.
9. Uncertain promotion offers reconciliation, never blind retry.
10. Owner inspects and authorizes exact rollback separately.
11. Builder accepts, rejects, or ignores diagnosis without changing case truth.
12. Current target, candidate, verification, and promotion versions are never flattened.
13. Reload and restart rebuild client cache from server truth.
14. Duplicate command ID renders as replay, not a second action.
15. Structured denials preserve exact error codes.
16. Overview prioritizes decisions and exceptions without listing routine events as tasks.
17. Desktop, tablet, and mobile have no overlapping or clipped controls.
18. Keyboard-only use completes investigation, verification review, and Owner authorization.
19. Browser storage and client bundles contain no Owner, Agent, provider, or integration credentials.
20. Existing V0.1 and V0.2 headless qualification remains passing.

## Out Of Scope

- Agent chat or hosted Codex/OpenClaw runtime
- In-browser workflow editing
- Automatic diagnosis invocation or repair generation
- Automatic verification, promotion, reconciliation, or rollback
- General observability replacement
- Arbitrary SQL, custom query builder, unrestricted dashboard plugins
- Persisted cross-device layouts
- Multi-user organizations, SSO, SCIM, or broad RBAC
- Remote Internet exposure or managed hosting
- Additional runtime adapters
- ALPHONSE_DATA integration
- Slack-like collaboration or messaging
- Billing, marketplace, and public SaaS onboarding
- AWS deployment or AWS-side changes

## Delivery Slices

### Slice 1: Read-Only Operational Spine

- port VPSCLAW3 shell and visual primitives
- local session and BFF
- protocol bootstrap and compatibility
- Overview
- workflow list/detail
- case list/detail
- lifecycle lanes, timeline, inspector
- system health

### Slice 2: Builder Investigation

- report wrong outcome
- confirm Failure Specification
- create reproduction
- diagnosis usefulness review
- evidence inspection and retirement

### Slice 3: Governed Repair

- worker identity and intent visibility
- Repair Task commission
- attempt and lease visibility
- candidate inspection
- independent verification and receipt

### Slice 4: Owner Effects

- promotion authorization
- separate target application
- uncertain reconciliation
- rollback authorization

### Slice 5: Modular Operations

- typed module registry
- reorder, resize, hide, filter
- local preference persistence
- global search
- responsive and accessibility qualification

## Prototype Questions

1. Do lifecycle lanes plus timeline remain clear without duplicating information?
2. Can the inspector support exact evidence and actions without nested cards?
3. Is uncertainty visually distinct from ordinary failure and success?
4. Can hand-designed forms still use Operation Descriptors for compatibility?
5. Can one Overview prioritize Kernel and Diagnostic work without merging truth models?
6. Does local module customization add enough value for V0.1?

## Recommended Next Step

Prototype Slice 1 with seeded static fixtures matching real V0.2 public projections. Validate Overview and Diagnostic Case workspace at desktop and mobile widths before live API wiring or consequential commands.
