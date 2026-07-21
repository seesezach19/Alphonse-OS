# Alphonse Kernel

Customer-controlled evidence, governance, and debugging for agentic operations.

Alphonse Kernel sits beside automation runtimes such as n8n and AI workers such as
Codex or OpenClaw. It gives them a durable operational boundary: exact identity,
bounded authority, immutable evidence, deterministic failure detection, and visible
recovery state.

Kernel does not make an agent smarter. It gives the agent a defensible evidentiary
position from which a specific diagnosis is justified.

> **Project status:** active local-first prototype. The architecture and acceptance
> proofs are substantial, but this repository is not yet a production security or
> compliance product.

## Why It Exists

An automation can report success while the business outcome is wrong. Logs may prove
that code ran, but not that the intended state was reached. Retries can duplicate
external effects. Stale context can produce valid-looking decisions. A capable model
can investigate these failures, but only if it receives trustworthy, bounded evidence
and cannot silently expand its own authority.

Alphonse addresses that gap by separating four concerns:

- **Observation:** scoped adapters report what they saw.
- **Interpretation:** deterministic services correlate observations and evaluate exact contracts.
- **Authority:** Kernel decides who may inspect, execute, repair, or promote.
- **Intelligence:** replaceable agents diagnose or propose work within those boundaries.

The core rule is simple: **models interpret; software adjudicates.**

## What It Does

```text
Customer systems and automation runtimes
        |
        v
Scoped observer adapters
        |
        v
Immutable observation receipts and artifacts
        |
        v
Correlation projection -> effect interpretation -> behavior evaluation
        |
        v
Diagnostic case -> bounded evidence package -> diagnostic assignment
        |
        v
Authority-gated worker -> diagnosis -> governed repair and recovery
```

Kernel is designed to:

- preserve exact workflow, actor, intent, environment, and revision identity;
- admit typed observations under narrow reporting grants;
- retain immutable receipts, conflicts, sequence gaps, and content-addressed artifacts;
- correlate deliveries, executions, requests, and external effects without fuzzy joins;
- distinguish transport success from destination commitment;
- evaluate small deterministic behavior contracts before involving a model;
- package only relevant evidence, limitations, and provenance for a worker;
- keep diagnosis, repair, verification, promotion, and external-effect authority separate;
- preserve uncertainty and reconciliation instead of blindly retrying ambiguous writes.

## Reference Proof

The current canonical proof uses a deliberately brittle lead-ingestion workflow:

1. One logical form submission arrives through two webhook deliveries.
2. n8n executes both deliveries successfully.
3. Each CRM request uses its unique delivery identity as its idempotency key.
4. The mock CRM append-only ledger records two committed leads.
5. Kernel correlates both delivery attempts to one opaque logical operation.
6. A governed contract requires at most one committed CRM create per logical operation.
7. The deterministic evaluator records `2 > 1` and opens one immutable Diagnostic Case.

The deterministic pipeline proves the invariant violation. It does **not** claim the
root cause, name an unseen workflow node, or grant repair authority. Root cause remains
`NOT_ESTABLISHED` until a separately bounded diagnostic worker evaluates the evidence.

This proof is intentionally stronger than a controller assembling a convenient prompt:
observer services create the receipts, first-party deterministic services create the
projections, and the scenario controller contributes stimulus only.

Run the proof:

```powershell
npm run test:canonical-proof:ticket-09
```

## Trust Model

- Customer credentials remain with the runtime or edge adapter that already uses them.
- Kernel authority state and Diagnostic Plane evidence state are logically separated.
- Each observer receives a distinct Principal, reporting grant, stream, and key.
- An accepted receipt means an authorized observer reported exact bytes within scope;
  it does not automatically make the external claim true.
- External outcomes become diagnostic facts only through pinned contracts and
  deterministic interpretation.
- Derived diagnostic effects carry `authority: none`; they are not Kernel execution
  effects or permission to act.
- HMAC is used in the local v1 proof. It proves authentication under an observer-specific
  key, not exclusive authorship against a verifier that also holds that symmetric key.
- The local Docker proof assumes a trusted host. Container and credential separation are
  enforced within that boundary, not cryptographically attested against a hostile host.

See the [architecture decisions](docs/adr/) for the detailed contracts and threat-model
tradeoffs.

## Current Scope

### Implemented

- local customer-controlled Docker deployment;
- PostgreSQL-backed Kernel and Diagnostic Plane state;
- Principals, Agent Passports, intent, capabilities, approvals, and activation;
- immutable Runs, Effects, evidence, uncertainty, reconciliation, and recovery;
- n8n workflow registration, runtime observation, repair delivery, verification, and promotion;
- canonical observation grants, intake, replay/conflict handling, and local CAS artifacts;
- durable ingress journal and separately scoped source, runtime, request, and ledger observers;
- pre-execution n8n revision binding;
- deterministic cross-stream correlation projection;
- durable workflow coverage discovery, evidence-linked interpretation, exact human review approval,
  and deterministic authority-free Coverage Specification compilation and validation;
- integration and behavior contracts, committed-effect interpretation, invariant evaluation,
  and automatic Diagnostic Case creation;
- read-only Butler and a fixture-backed Operations Console;
- OpenClaw and Codex diagnostic-worker experiments;
- deterministic unit, black-box, fresh-install, replay, recovery, and rehearsal tests.

### Proven Diagnostic Vertical

The canonical diagnostic vertical implements this governed sequence:

1. deterministic evidence collection and package freezing;
2. independent prefix and projection verification;
3. immutable, authority-free diagnostic assignment creation;
4. separate dispatch authorization and atomic claim;
5. isolated worker execution through a narrow model broker;
6. diagnosis ingestion and a three-run consistency proof.

### Not The Goal

Alphonse is not another workflow builder, model wrapper, credential vault, or general
observability dashboard. n8n, provider APIs, existing business systems, and tools such
as Grafana keep their native responsibilities. Kernel supplies the missing accountability
and authority layer across them.

## Quick Start

### Prerequisites

- Docker Desktop with Linux containers
- Node.js 22 or newer

Install dependencies and run the fast test suite:

```powershell
npm install
npm test
```

Start the local environment:

```powershell
npm run local:up
```

Open:

- Kernel discovery: [http://localhost:3000/kernel/v0/bootstrap](http://localhost:3000/kernel/v0/bootstrap)
- Diagnostic discovery: [http://localhost:3000/diagnostic/v0/bootstrap](http://localhost:3000/diagnostic/v0/bootstrap)
- Butler: [http://localhost:3000/butler](http://localhost:3000/butler)
- Health: [http://localhost:3000/healthz](http://localhost:3000/healthz)
- Reference Data Plane: [http://localhost:3100/v0/bootstrap](http://localhost:3100/v0/bootstrap)

The local Butler shell uses HTTP Basic authentication. Any username works; the
Compose-only development password is `local-development-bootstrap-token`. Replace all
development credentials outside this local environment.

Stop the environment with:

```powershell
npm run local:down
```

## Operations Console

The Console is a guided, fixture-backed product surface. It demonstrates case review,
timeline evidence, expected-versus-observed behavior, authority boundaries, and system
status without mutating Kernel or customer systems.

```powershell
npm install --prefix apps/console
npm run console:dev
```

Open [http://127.0.0.1:3200](http://127.0.0.1:3200).

Live reachability probes are labeled separately from fixture service data. The Console
binds to loopback and should remain local until it has an authenticated deployment
boundary.

```powershell
npm run console:typecheck
npm run console:build
```

## Verification

Useful checkpoints:

```powershell
npm test                                  # dependency-free unit suite
npm run test:blackbox                     # clean bootstrap, replay, persistence
npm run test:canonical-proof:ticket-09    # canonical observation-to-case proof
npm run rehearse:v0.2                     # repeatable diagnosis/repair/recovery loop
npm run release:v0.2:qualify              # headless release qualification
```

Acceptance harnesses use isolated Compose projects, ports, and temporary volumes. They
remove only their own resources when complete.

## Repository Map

| Path | Purpose |
| --- | --- |
| `src/` | Kernel, Diagnostic Plane, protocol, and service implementation |
| `migrations/` | Kernel authority and operational state |
| `diagnostic-migrations/` | Diagnostic receipts, projections, cases, and artifacts |
| `packages/n8n-operational-package/` | n8n runtime, repair, and verification integration |
| `apps/console/` | Local Operations Console |
| `agency-lab/` | Deliberately brittle automation scenarios |
| `smoke-tests/` | Blind-worker comparison experiments |
| `scripts/` | Acceptance, rehearsal, release, and lab harnesses |
| `docs/` | Product contracts, operating guides, and architecture decisions |
| `verifier/` | Independent verification support |

## Design Principles

- Never break user space: version contracts and preserve historical meaning.
- Keep business systems authoritative for their own state.
- Attach authority, freshness, provenance, and limitations to data.
- Prefer immutable receipts and rebuildable projections over mutable truth tables.
- Treat retries, uncertainty, and recovery as first-class operational states.
- Keep credentials at the edges and grant capabilities, not ambient access.
- Give agents maximum useful context without unnecessary disclosure or authority.
- Make the generic foundation strong; let users build vertical workflows on top.

## Further Reading

- [V0.2 product direction](docs/v0.2-debug-loop-product-direction.md)
- [Debug-loop proof](docs/v0.2-debug-loop-proof.md)
- [Runtime event observation](docs/runtime-event-observation.md)
- [Optional model-assisted diagnosis](docs/optional-model-assisted-diagnosis.md)
- [Independent verification](docs/independent-verification.md)
- [Dispatch authority](docs/diagnostic-dispatch-authority.md)
- [Worker execution boundary](docs/diagnostic-worker-execution.md)
- [Restore and recovery](docs/environment-restore.md)

## Public Protocol Boundary

`GET /kernel/v0/bootstrap` is the canonical Kernel discovery entry point.
`GET /diagnostic/v0/bootstrap` is the separate Diagnostic Protocol entry point.
Their operation descriptors define transports, schemas, preconditions, authority and
effect classes, outcomes, idempotency, emitted events, and available next operations.

HTTP and the CLI are adapters over those public contracts. Direct database access is
not a platform interface.
