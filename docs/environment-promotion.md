# Environment Promotion

Ticket 13 adds hosted coordination without moving customer authority out of an Environment.

## Boundary

The coordinator knows only signed minimal Environment Descriptors, immutable Package identity, compatibility metadata, Promotion Proposals, and signed receipt digests. It receives no credentials, configuration values, prompts, evidence bodies, business payloads, actor activity, approval authority, activation authority, or execution authority.

Each Environment initiates outbound registration, polling, requests, and receipt delivery. Revoking the local Coordinator Binding stops new coordination but does not revoke or alter existing local capability, activation, or execution state.

## Promotion Flow

1. Development, staging, and production register signed minimal descriptors through challenge-response using distinct per-Environment enrollment credentials.
2. The source submits an exact Package identity and signed gate receipts.
3. The customer Promotion Graph admits only configured edges and evidence sets.
4. The coordinator signs an immutable Promotion Proposal for one target Environment.
5. The target polls, verifies the proposal, and resolves configuration and credential references locally.
6. The target signs local transition receipts and delivers them outbound.
7. Hosted status is derived only from verified target receipts. It never grants authority.

Expired proposals are excluded from target polling and cannot be resolved or advance hosted status. Exact retries may still return the original immutable bytes for idempotency.

The default graph requires Package validation and compatibility evidence for development to staging. Staging to production additionally requires staging deployment, activation, and recovery evidence. The graph is configurable with `COORDINATOR_PROMOTION_GRAPH`.

## Local Receipt Semantics

A Promotion Receipt is a signed target-local attestation, not a deployment command. The Kernel derives its subject digest from an existing immutable local Package validation, Simulation, Deployment, active Capability Activation, target plan resolution, or resolved Recovery Case. Caller-supplied claims cannot create evidence. The coordinator cannot create receipts or substitute for local transitions.

## Local Verification

```powershell
npm run test:ticket-13
```

The isolated Docker profile creates three Kernel databases plus a separate coordinator database. Acceptance proves environment isolation, outbound registration, descriptor minimization, both promotion edges, local configuration separation, recovery gating, receipt-derived hosted status, coordinator outage tolerance, and local binding revocation. It performs no AWS activity.
