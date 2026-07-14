# Agent-Native Kernel Protocol Prototype

Status: rough HITL prototype

## Design Goal

A replaceable agent should enter an unfamiliar Kernel Environment, learn the available object model and valid transitions, construct exact proposals, correct validation failures, simulate safely, submit governed changes, and observe outcomes without database access or provider-specific instructions.

The protocol is semantic. MCP, HTTP, CLI, and SDK surfaces are generated adapters.

## Small Meta-Interface

```text
protocol.describe
catalog.search
resource.get
resource.search
operation.describe
operation.invoke
event.observe
```

These primitives expose a typed operation registry. A transport may project discovered operations as native tools, commands, or endpoints.

Example discovered operations:

```text
build_session.open
package.validate_candidate
package.publish
deployment_plan.resolve
deployment_plan.submit_review
technical_review.record
business_approval.request
business_approval.decide
capability_activation.activate
context_access.request
context.retrieve
execution.admit
run.create
effect.record
evidence.record
recovery.plan
```

There is no untyped `execute`, raw CRUD, SQL, arbitrary patch, or provider-specific operation in the canonical protocol.

## Handshake

```json
{
  "operation_id": "protocol.describe",
  "input": {
    "supported_protocol_versions": ["alphonse.kernel_protocol.v0.1"],
    "client_kind": "agent",
    "client_capabilities": ["json_schema", "event_cursor", "typed_tools"]
  }
}
```

Response includes:

- selected protocol version
- Kernel API version
- environment identity and public metadata
- supported resource kinds
- discovery limits and pagination
- schema dialect
- event cursor behavior
- authentication and Passport requirements
- links to relevant operation descriptors

Public discovery reveals no customer data or authority state.

## Resource Reference

```json
{
  "environment_id": "env_customer_prod",
  "kind": "package_version",
  "id": "com.alphonse.inventory.operations",
  "version": "1.2.0",
  "digest": "sha256:PACKAGE"
}
```

Rules:

- Definitions and decisions use exact version/digest references.
- Mutable projections use stable ID plus optimistic `revision`.
- Authority-bearing operations reject ambiguous `latest` references.
- Search results may return projections; submission must resolve them exactly.

## Operation Descriptor

```json
{
  "operation_id": "package.publish",
  "operation_version": "1.0.0",
  "summary": "Publish one validated package candidate.",
  "authority_class": "governed_transition",
  "input_schema": {"$ref": "kernel://schemas/package.publish.input.v1"},
  "output_schema": {"$ref": "kernel://schemas/package.publish.output.v1"},
  "preconditions": [
    "active_build_session",
    "candidate_validation_passed",
    "publisher_trust_satisfied"
  ],
  "supports": ["validate", "simulate", "submit"],
  "idempotency": "required",
  "expected_revision": "required_when_replacing_projection",
  "possible_outcomes": ["accepted", "rejected", "blocked", "conflict"],
  "emitted_event_kinds": ["package_version.published"],
  "next_operation_ids": ["deployment_plan.resolve"]
}
```

Descriptors are versioned Kernel resources. Agents can inspect exact schemas, examples, preconditions, authority class, side-effect class, idempotency, transitions, possible errors, and recovery operations before invocation.

## Invocation Envelope

```json
{
  "protocol_version": "alphonse.kernel_protocol.v0.1",
  "request_id": "request_123",
  "operation_id": "package.publish",
  "operation_version": "1.0.0",
  "mode": "submit",
  "principal_ref": {"kind": "principal", "id": "principal_builder"},
  "passport_ref": {"kind": "agent_passport", "id": "passport_builder", "version": 4},
  "work_intent_ref": {"kind": "work_intent", "id": "intent_publish_inventory"},
  "idempotency_key": "publish_inventory_1_2_0",
  "expected_revisions": [],
  "input": {
    "build_session_id": "build_session_123",
    "candidate_digest": "sha256:CANDIDATE",
    "validation_receipt_id": "validation_123"
  }
}
```

Identity fields are required according to authority class, not universally. Public description needs no Passport. Customer reads require Passport, Work Intent, and Context Access Grant. Governed transitions additionally require exact authority inputs.

## Modes

### Validate

Pure structural and deterministic precondition evaluation against explicit references. Produces no transition and grants no future success.

### Simulate

Evaluates a proposed operation against a declared snapshot of Kernel state, context receipts, test fixtures, or adapter simulation. It cannot call effectful adapters or mutate authority. Output includes assumptions, exact input references, simulation fidelity, and a receipt.

### Submit

Revalidates current authority and time-sensitive conditions, performs one atomic Kernel transition or creates an explicit pending/blocked state, and emits a receipt plus ledger events.

Simulation and validation receipts are evidence, not authority.

## Response Envelope

```json
{
  "protocol_version": "alphonse.kernel_protocol.v0.1",
  "request_id": "request_123",
  "operation_id": "package.publish",
  "outcome": "blocked",
  "receipt_ref": {"kind": "operation_receipt", "id": "receipt_123"},
  "resources": [],
  "issues": [
    {
      "code": "publisher_trust.missing",
      "path": "input.candidate_digest",
      "severity": "error",
      "message": "Candidate has no valid publication trust decision.",
      "retryable": true,
      "required_condition": "publisher_trust_satisfied"
    }
  ],
  "next_operations": [
    {
      "operation_id": "publisher_trust.request",
      "reason": "Resolve the blocking precondition."
    }
  ],
  "event_cursor": "cursor_456"
}
```

Canonical outcomes:

- `accepted`: transition completed
- `rejected`: input or requested transition is invalid
- `blocked`: valid request lacks a satisfiable current precondition/authority
- `conflict`: expected revision or idempotency claim conflicts
- `pending`: explicit asynchronous work/decision exists

Transport failures remain separate from domain outcomes.

## Structured Issues

Every issue contains stable code, machine path, severity, concise message, retryability, and optional required condition, conflicting reference, or suggested operation. Suggested operations are guidance only and never execute automatically.

Agents correct specific fields or satisfy explicit preconditions rather than interpreting prose logs.

## Proposal Shape

Different proposals retain typed payloads but share metadata:

```json
{
  "proposal_kind": "deployment_plan",
  "proposal_schema_version": "alphonse.deployment_plan.v0.1",
  "subject_ref": {"kind": "kernel_environment", "id": "env_customer_prod"},
  "base_refs": [{"kind": "deployment", "id": "deployment_122", "digest": "sha256:OLD"}],
  "proposed_by_principal_id": "principal_builder",
  "work_intent_id": "intent_deploy_inventory",
  "payload_digest": "sha256:PLAN",
  "evidence_refs": ["validation_plan_123"]
}
```

The common envelope enables generic review/routing. The typed payload preserves domain-specific validation and lifecycle semantics. There is no generic mutable Proposal payload table that replaces explicit object contracts.

## Progressive Discovery

```text
describe environment
-> search relevant resource/operation kinds
-> inspect exact operation descriptor
-> fetch only required resources
-> validate candidate
-> simulate where supported
-> submit exact transition
-> observe receipt/events
```

`catalog.search` ranks exact semantic matches and returns bounded summaries. Full schemas and examples load on demand. Agents do not receive the entire operation catalog or customer graph by default.

## Observation

`event.observe` provides an environment-local, cursor-based stream of meaningful Kernel ledger events:

- at-least-once delivery
- deterministic event ID
- monotonic environment sequence
- resumable cursor
- bounded filters by resource, kind, Work Intent, Run, or time
- payload visibility filtered by the caller's current authority

Consumers deduplicate by event ID. Events report accepted transitions; they do not become a generic replacement for resource state machines.

## Transport Projection

| Canonical concept | MCP | HTTP | CLI/SDK |
|---|---|---|---|
| Operation descriptor | Tool schema/resource | Discovery document | Generated method/help |
| Invocation | Typed tool call | Command request | Method invocation |
| Resource | MCP resource | Resource response | Typed object |
| Event observation | Poll/resource subscription | SSE/poll | Async iterator |

Adapters must preserve operation ID/version, request and receipt identity, canonical outcomes, issues, idempotency, and exact references.

## Decisions During Prototype

- Every agent receives the small meta-interface; transports generate a bounded task-specific typed tool projection from discovered Operation Descriptors and allow progressive expansion.
- Operation visibility is policy-driven. Visible operations disclose safe availability, missing preconditions, and next steps; operations whose existence would leak sensitive customer capability or state remain hidden.
- Proposal is a shared metadata contract embedded by typed proposal objects, not one generic mutable Kernel resource or payload table.
- Simulation declares deterministic or observational fidelity. Observational simulation may use trusted live read-only adapters under normal read authority and creates Context Receipts; neither mode may invoke effectful adapters.
- Event privacy combines permanent write-time minimization of secrets and unnecessary payloads with reader-authorized projections over immutable sensitivity-labelled canonical events.

## Prototype Outcome

Kernel Protocol uses a small bootstrap interface over a versioned typed operation registry. Agents progressively discover safe resources and preconditions, receive bounded Task Tool Projections, validate or simulate without authority, submit exact idempotent transitions, correct structured issues, and observe cursor-based immutable events. Every transport preserves the same semantic operation IDs, references, receipts, outcomes, and authority boundaries.
