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

### Console Prototype

The local Console is a safe guided customer demo built around V0.2-shaped fixture data. It binds to loopback only and performs no Kernel, Diagnostic, n8n, or customer-system writes. A server-side status route separately checks whether the local Kernel, Diagnostic Plane, and an optional n8n instance answer read-only probes; reachability never turns fixture records into live claims.

```powershell
npm install --prefix apps/console
npm run console:dev
```

Open http://127.0.0.1:3200.

The first visit opens a short test guide. A useful five-minute path is:

1. Open the priority case.
2. Compare expected and observed behavior.
3. Select timeline events and inspect what each one establishes.
4. Open the recommended action and preview the simulated transition.
5. Visit **System** to see the explicit boundary between live reachability and fixture service data.

The Kernel probe defaults to `http://127.0.0.1:3000`. To include a local n8n health probe, set its base URL before starting the Console:

```bash
ALPHONSE_CONSOLE_N8N_URL=http://127.0.0.1:45679 npm run console:dev
```

Use `ALPHONSE_CONSOLE_KERNEL_URL` only when the local Kernel is listening at a different address. These variables are read by the Console server and are not exposed to the browser. Keep the Console loopback-bound for this prototype; sharing it to another device needs an authenticated deployment boundary first.

Production and type checks:

```powershell
npm run console:typecheck
npm run console:build
```

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

Local backup and fail-closed restore procedures: [docs/environment-restore.md](docs/environment-restore.md). Restore advances the execution epoch, reconciles ambiguous Effects, rebuilds projections, verifies integrity, then explicitly resumes authority.

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

Ticket 04 package publication acceptance:

```powershell
npm run test:ticket-04
```

This proves exact Builder Toolkit provenance, governed-context binding, structured deterministic validation, fixture and observational Simulation Receipts, atomic immutable publication, and semantic-version byte collision protection. Published packages remain inert until later activation.

Ticket 04 adds the domain-neutral publication substrate. The inventory Package itself is ordinary user-space content: no inventory-specific Kernel route, table, validator branch, or schema is required to publish another compatible Package.

Ticket 05 exact deployment authority acceptance:

```powershell
npm run test:ticket-05
```

This proves exact Deployment Plan validation, all three technical-review decisions, authority-free staging, Kernel-derived Butler action cards, separate business approval and Capability Activation, revision-safe actions, deterministic admission denial, active-authority precheck, and restart persistence. Activation grants Capability authority only; it creates no Execution Envelope, Run, credential delivery, or external effect.

Ticket 06 bounded runtime handoff acceptance:

```powershell
npm run test:ticket-06
```

This proves structured Agent-to-Agent handoff without conversation history, exact Package/Skill/Capability/Context binding, atomic responsibility transfer, immutable Delegation and signed short-lived Workload Grant, all four Butler handoff states, lease expiry, Environment epoch fencing, signed host-observation chaining, and restart persistence. The reference Docker workload runs non-root with read-only root, bounded scratch/resources, dropped capabilities, no mounts or engine socket, and default-deny networking.

A Workload Grant admits exact bytes to a bounded substrate. It never grants external-effect authority. Consequential dispatch remains a later, separate protocol layer.

Ticket 07 accountable inventory comparison acceptance:

```powershell
npm run test:ticket-07
```

This proves independent Delegation and active read Capability validation, exact and idempotent Execution Envelope admission, atomic Run and Obligation creation, structured rejection at every authority boundary, bounded Runtime B execution, immutable Evidence, separately visible execution and accountability status, and exact source links in Butler. The comparison remains read-only and grants no external-effect authority.

Ticket 08 exact staging correction acceptance:

```powershell
npm run test:ticket-08
```

This proves exact correction admission, an immutable Effect Record before dispatch, a signed one-use Dispatch Permit, immediate authority revalidation, scoped credential delivery only to the trusted adapter, an internal-only staging storefront, business-target idempotency, post-write verification Evidence, and separately succeeded/satisfied Run state. The networkless workload never receives a credential or direct target route.

Ticket 09 uncertainty and recovery acceptance:

```powershell
npm run test:ticket-09
```

This injects lost adapter responses both after and before a correction may apply. Kernel records explicit uncertain Effect/Run state, blocks blind redispatch, opens a Recovery Case, issues a one-use read-only Reconciliation Permit, and preserves uncertainty history. Applied reconciliation satisfies original evidence obligations; not-applied reconciliation breaches them and prepares a separate Work Intent for the normal authority chain.

Ticket 10 repeatable engineering rehearsal:

```powershell
npm run rehearse
```

This resets the controlled local stack twice, runs the complete inventory engineering journey through public boundaries, compares normalized observable outcomes, and prints a scorecard. It is an engineering rehearsal, not the unfamiliar-Builder production qualification described in `docs/engineering-rehearsal.md`.

Ticket 11 qualification kit:

```powershell
npm run proof:snapshot
$env:KERNEL_OPERATOR_TOKEN="<operator credential>"
npm run qualify:ticket-11 -- proof/ticket-11-proof.json
```

The verifier requires an unfamiliar human Builder, measured attention, distinct runtime handoff, completed staging recovery, one user-selected approved reversible non-AWS production effect, a Butler-only operator explanation, and five external builder reviews. It fails closed against public Kernel and Butler state. See `docs/unfamiliar-builder-production-proof.md`.

Ticket 12 portable Package trust acceptance:

```powershell
npm run test:ticket-12
```

This proves delegated Ed25519 release identity, scoped expiring Registry access grants, per-registry row-scoped database authority, atomic publication, complete manifest/artifact identity, manifest/release-bound receipts and transparency checkpoints, trusted signed risk attestations, independent transitive verification, mirror-stable identity, Environment-bound comprehensive Trust Policies, Work-Intent/evidence-bound Import Receipts, quarantine without Deployment authority, signed expiring advisory snapshots, replay-safe idempotency, and equivalent offline import during registry outage. Ticket 11 still gates production qualification of the inventory Package. See `docs/portable-package-trust.md`.

Ticket 13 customer Environment promotion acceptance:

```powershell
npm run test:ticket-13
```

This proves three isolated customer Environments coordinate exact Package promotion through signed outbound channels and graph-enforced evidence gates. Configuration, credential references, review, activation, and execution authority remain target-local; hosted status is receipt-derived and grants no authority. Coordinator outage or local revocation does not interrupt existing local operations. See `docs/environment-promotion.md`.

Ticket 14 user-space upgrade acceptance:

```powershell
npm run test:ticket-14
```

This proves exact multidimensional compatibility, side-by-side breaking versions, immutable Upgrade Plans, restart-resumable Package-state migration, deterministic canary pause, original-version Run completion after target activation, authority-equivalent preapproval, fresh approval for changed authority, honest rollback/forward repair, and old-version retirement blockers. See `docs/user-space-upgrades.md`.

Ticket 15 restore acceptance:

```powershell
npm run test:ticket-15
```

This proves encrypted local backup, epoch fencing, projection rebuild, integrity verification, explicit reconciliation of uncertain Effects, and resume without duplicate external work. See `docs/environment-restore.md`.

Ticket 16 governed support acceptance:

```powershell
npm run test:ticket-16
```

This proves signed coarse health, unknown missing heartbeats, exact support requests, customer-issued temporary read-only Support Passports, encrypted redacted diagnostics with immutable access logs, Capability-gated remediation records, host quarantine, and hosted revocation while local authority and history continue. See `docs/support-coordination.md`.

Ticket 17 reproducible V0.1 release:

```powershell
npm run release:build
npm run test:ticket-17
npm run release:qualify
```

This produces a content-addressed deterministic customer bundle, proves its shipped one-command installer from a clean extraction, and composes the complete local non-AWS regression into content-addressed evidence. See `docs/release-v0.1.md`.

V0.2 Ticket 01 external Agent Workflow registration:

```powershell
npm run test:v0.2-ticket-01
```

With the local stack running, inspect the Diagnostic Protocol and use its CLI:

```powershell
$env:ALPHONSE_URL="http://127.0.0.1:3000"
$env:ALPHONSE_TOKEN="local-development-bootstrap-token"
npm run diagnostic:cli -- bootstrap
npm run diagnostic:cli -- operations
npm run diagnostic:cli -- register-workflow path\to\workflow-command.json
npm run diagnostic:cli -- register-revision path\to\revision-command.json
npm run diagnostic:cli -- get-workflow workflow:inventory-follow-up
```

The Diagnostic Plane uses a separate PostgreSQL database and runtime role plus local content-addressed artifact storage. Agent Workflow and exact Agent Revision records are immutable diagnostic identity. They grant no Capability, execution, effect, or promotion authority.

V0.2 Ticket 02 signed external activity observation:

```powershell
npm run test:v0.2-ticket-02
```

This proves canonical timestamped HMAC authentication, exact replay, preserved identity conflicts, append-only out-of-order claims, honest sequence-based projection, and zero Kernel Run creation. See [docs/runtime-event-observation.md](docs/runtime-event-observation.md).

V0.2 Ticket 10 repeatable fresh-install Debug Loop:

```powershell
npm run rehearse:v0.2
```

This runs the confirmed repair and uncertainty/reconciliation journeys twice from isolated clean state, then compares normalized public outcomes. See [docs/v0.2-debug-loop-proof.md](docs/v0.2-debug-loop-proof.md).

V0.2 optional model-assisted diagnosis:

```powershell
npm run test:v0.2-ticket-12
```

This attaches a distinct customer-controlled Diagnostic Worker to exact confirmed evidence. Its immutable proposals may be accepted, rejected, or ignored for usefulness, but never change failure truth or gain repair, verification, promotion, or target authority. Provider credentials remain outside Alphonse. See [docs/optional-model-assisted-diagnosis.md](docs/optional-model-assisted-diagnosis.md).

### Codex + n8n blind ETL smoke lab

The host smoke lab runs a real pinned n8n settlement ETL against a disposable local warehouse, proves a successful
committed load with currency-specific semantic corruption, and packages only bounded evidence for a blind diagnostic
worker. The workflow source, controller answer key, repository source, and repair authority remain outside the worker
package.

```powershell
npm run smoke:codex-etl
npm run smoke:codex-etl:app -- ../ALPHONSE_CODEX_ETL_BLIND_WORKER
```

Open only the exported sibling directory in the Codex app and ask Codex to follow `PROMPT.md`. An authenticated host
Codex CLI can instead run the same package ephemerally with `npm run smoke:codex-etl:codex`. The scorer validates exact
assignment/evidence binding, structured diagnostic fields, resolvable citations, preserved uncertainty, bounded
investigation, and zero actions; it does not classify free prose.

The recorded 2026-07-18 Codex app checkpoint correctly diagnosed the hidden currency-scale defect from blind evidence.
It received 14/15 and formal `passed: false` only because the original hidden rubric required two preferred exact JSON
Pointers even though all five supplied citations resolved and supported the diagnosis. That result remains unchanged as
an evaluator-brittleness finding; future rubrics should precommit typed evidence roles and multiple admissible stable
claim IDs rather than one preferred reasoning path. See [smoke-tests/codex-etl/README.md](smoke-tests/codex-etl/README.md).

V0.2 reproducible headless release:

```powershell
npm run release:v0.2:build
npm run release:v0.2:qualify
```

See [docs/release-v0.2.md](docs/release-v0.2.md) and the packaged `OPERATOR.md` for installation, custody, licensing, retention, recovery, and limitations.

## Public Boundary

`GET /kernel/v0/bootstrap` is the canonical discovery entry point. Its Operation Descriptors define available transports, schemas, authority/effect classes, preconditions, outcomes, idempotency, emitted events, and next operations. HTTP is an adapter over this contract; direct database access is not a platform interface.

`GET /diagnostic/v0/bootstrap` is the separate Diagnostic Protocol discovery entry point when the Diagnostic Plane is configured. HTTP and `diagnostic:cli` are adapters over the same public operations; direct Diagnostic database access is not a platform interface.

## OpenClaw diagnostic workspace

Provision an existing host OpenClaw workspace as a diagnosis-only worker:

```powershell
$env:OPENCLAW_WORKSPACE_DIR="C:\path\to\openclaw-workspace"
$env:OPENCLAW_RUNTIME_KIND="host"
npm run openclaw:provision
```

For a Docker-managed OpenClaw client:

```powershell
$env:OPENCLAW_CLIENT_DIR="C:\path\to\openclaw-client"
$env:OPENCLAW_RUNTIME_KIND="docker"
npm run openclaw:provision
docker compose -f "$env:OPENCLAW_CLIENT_DIR\docker-compose.yml" -f "$env:OPENCLAW_CLIENT_DIR\docker-compose.alphonse.yml" up -d
```

The provisioner keeps model credentials in OpenClaw, installs the workspace-local `alphonse-diagnostic` skill, injects a short-lived Alphonse Agent token through `.env.alphonse`, and leaves one exact diagnosis request ready. The Passport permits only `diagnostic_analysis`; failure truth, evidence mutation, repair, verification, promotion, target changes, and external effects remain ungranted.

The installed helper also reads `.alphonse/diagnostic.env` inside the workspace and verifies the exact request before
provisioning succeeds. A missing assignment fails closed; the worker never substitutes Owner or bootstrap authority.

## Runtime trust modes

- **Governed worker:** exact Agent Passport, isolated runtime, no host administration or Owner credentials.
- **Trusted operator:** agent executes selected Diagnostic Owner operations through an expiring passport. Requests bind
  the sponsoring human, executing agent, channel, instruction digest, and authorization time.

Set `KERNEL_OWNER_TOKEN` separately from `KERNEL_BOOTSTRAP_TOKEN` outside compatibility-only local development. Normal
operator activity uses the Owner credential or an `Operator` passport; worker work uses only `Agent` credentials.

Butler reads Kernel state through the canonical `GET /kernel/v0/accountable-work/overview` operation. Its shell has no database access or privileged write path.
