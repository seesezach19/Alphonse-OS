# Alphonse Kernel

Customer-controlled authority and accountability substrate for agentic operations.

Ticket 01 establishes one inspectable local Kernel Environment. It includes PostgreSQL, a self-describing Kernel Protocol, durable idempotent commands, typed transitions, an outbox, and a read-only Butler shell. It performs no AWS activity.

## Prerequisites

- Docker Desktop with Linux containers
- Node.js 22 or newer for local tests

## Start

```powershell
npm run local:up
```

Open:

- Kernel discovery: http://localhost:3000/kernel/v0/bootstrap
- Butler: http://localhost:3000/butler
- Health: http://localhost:3000/healthz
- Reference Data Plane: http://localhost:3100/v0/bootstrap

Butler uses local HTTP Basic authentication. Any username works; the development password is `local-development-bootstrap-token`. Replace this Compose-only credential outside local development.

PostgreSQL migrations and the local Environment bootstrap run automatically. The named Docker volume preserves state across shutdown and restart.

Ticket 01 uses a loopback-only bootstrap credential for its single profile write. Kernel derives the accountable Principal from that credential; callers cannot supply actor identity. Ticket 02 replaces this narrow bootstrap mechanism with durable Principals, Agent Passports, and confirmed Work Intent.

```powershell
npm run local:down
```

## Verify

Fast dependency-free unit checks:

```powershell
npm test
```

Isolated black-box acceptance, including clean bootstrap, command idempotency, receipt/transition/outbox inspection, and restart persistence:

```powershell
npm run test:blackbox
```

The acceptance harness uses its own Compose project, ports, and temporary volume. It removes only those isolated resources when finished.

Ticket 02 identity and intent acceptance:

```powershell
npm run test:ticket-02
```

This proves separate Principals, authority-free Agent Passports, proposed and explicitly confirmed Work Intent, bounded Build Sessions, provisional access denial, structured mismatch/expiry rejection, and Butler accountability projection.

Ticket 03 governed context acceptance:

```powershell
npm run test:ticket-03
```

This proves bounded Context Access Grants, strict Kernel/Data Plane policy intersection, direct inventory delivery, immutable observation time, signed payload-free receipts, freshness and authority projection, deterministic rejection, and restart persistence.

## Public Boundary

`GET /kernel/v0/bootstrap` is the canonical discovery entry point. Its Operation Descriptors define available transports, schemas, authority/effect classes, preconditions, outcomes, idempotency, emitted events, and next operations. HTTP is an adapter over this contract; direct database access is not a platform interface.

Butler reads Kernel state through the canonical `GET /kernel/v0/accountable-work/overview` operation. Its shell has no database access or privileged write path.
