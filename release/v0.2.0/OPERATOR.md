# Alphonse V0.2 Headless Operator Guide

## Scope

V0.2 is a customer-controlled Docker release of the governed Debug Loop. It runs the Alphonse Node, Diagnostic Plane,
CLI source, local verification runner, n8n Operational Package, PostgreSQL, and an optional reference n8n service. It
requires no AWS account, managed cloud service, or model-provider account.

Alphonse does not include or redistribute n8n software. The reference composition pulls the pinned upstream n8n image
for the customer. n8n remains a separately operated customer service and system of authority for its workflows,
integrations, credentials, and native revision state. Review n8n's current license before business use:
https://docs.n8n.io/sustainable-use-license/

## Prerequisites

- 64-bit machine with at least 4 CPU cores, 8 GB RAM, and 12 GB free disk.
- Docker Desktop 4.x with Linux containers, or Docker Engine 26+ with Compose v2.
- Windows PowerShell 5.1+ for `install-local.ps1`, or a POSIX shell for `install-local.sh`.
- Loopback ports 3000 and 5678 available.

## Install

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-local.ps1
```

Linux/macOS:

```sh
./install-local.sh
```

The installer creates `.env.release` once with random local credentials, then builds and starts the pinned composition.
It never overwrites existing credentials. PostgreSQL, the runtime adapter, and internal service surfaces have no host
ports. Kernel and n8n bind only to `127.0.0.1`.

## Reference Workflows

The archive contains importable workflow JSON but does not mutate n8n automatically. Import through n8n's supported CLI:

```powershell
docker compose --project-name alphonse-v0-2 --env-file .env.release -f compose.yaml exec -T n8n n8n import:workflow --input=/package/workflows/alphonse-event-reporter.json
docker compose --project-name alphonse-v0-2 --env-file .env.release -f compose.yaml exec -T n8n n8n import:workflow --input=/package/workflows/inventory-follow-up-defective.json
```

The workflow is a deterministic local demonstration. It routes output to local review and performs no email or inventory
effect. Register a real workflow revision and configure its exact reporting identity before using Runtime Events.

## Inspection

Read `KERNEL_OWNER_TOKEN` from `.env.release`, then set:

```powershell
$env:ALPHONSE_URL="http://127.0.0.1:3000"
$env:ALPHONSE_TOKEN="<owner-token>"
npm run diagnostic:cli -- get-case <case-id>
npm run diagnostic:cli -- get-promotion <promotion-id>
```

These are public protocol calls. Do not inspect or modify PostgreSQL directly.

## Custody And Trust

- PostgreSQL and content-addressed artifact volumes remain under customer host and Docker custody.
- `.env.release` contains local Owner, HMAC, signing, encryption, adapter, and database credentials. Restrict it to the
  operator account and back it up separately from database and artifact snapshots.
- n8n provider credentials remain only in customer-owned n8n. Alphonse persists a secret-free credential binding
  reference, not the provider credential.
- Repair Worker model credentials remain in the customer-selected worker. They are not stored by Alphonse.
- Routine Runtime Events contain identity and digests, not full business payloads. Detailed data is retrieved only for an
  active case, redacted by package policy, then stored in customer-controlled artifacts.
- The customer trusts pinned image digests, Docker Engine, the host kernel, filesystem, and local administrator.
- Host administrators can bypass application controls. Network exposure, host hardening, backups, and incident response
  remain customer responsibilities.

## Retention, Backup, And Recovery

Diagnostic metadata is append-only. A governed erasure decision revokes application access and package execution
eligibility before local artifact deletion. Physical deletion is an idempotent follow-up that preserves the decision,
digest identity, impact, deletion attempts, and a location-specific digest tombstone. Active legal holds cannot be overridden.
Missing bytes without a governed decision are reported as an integrity violation rather than silently normalized.

A verified tombstone establishes absence only from the local primary content-addressed store. It does not prove erasure
from backups, unregistered replicas, or material already disclosed to a model or other provider. Those limits remain
explicit, and the protocol does not claim universal deletion.

Back up both PostgreSQL and the `diagnostic-artifacts` volume before upgrades. Keep `.env.release` separately. A database
backup without matching artifacts is incomplete. Promotion preserves a rollback snapshot; uncertain promotion must be
reconciled read-only before any new apply attempt. Rollback requires a separate authenticated Owner command.

## Protocol Meaning

- External Activity is an authenticated observation from an external runtime. It is not a governed Kernel Run and does
  not prove the external effect occurred.
- Verification proves only the demonstrated failure and retained targeted regressions for exact artifacts. It is not a
  broad certification of an agent or workflow.
- Repair Worker submission and passing verification grant no promotion authority. Promotion remains an explicit Owner
  transition against an exact target revision.
- A Diagnostic Consistency Test commits one hidden rubric before dispatch, requires three separately authorized Worker
  Runs over one exact package and configuration digest, preserves their diagnoses independently, and reports platform
  reproducibility separately from model consistency. It grants no repair or external-effect authority.

## Limitations

- V0.2 is local-first, single-customer, headless, and not highly available.
- The included detail and repair-delivery adapter is a reference implementation for the deterministic proof. Its
  fault-injection controls are disabled in this release. Production n8n integration must use supported n8n APIs and a
  customer-issued API credential under customer custody.
- The reference n8n Code node reads reporting configuration from its process environment. Treat all installed workflows
  as trusted code or replace this setup with a customer-approved credential mechanism.
- Automatic anomaly detection, model-assisted diagnosis, automatic promotion, OTLP, SDKs, and a Console are not included.
- The canonical three-run consistency proof uses a deterministic synthetic reference provider. It validates package,
  runtime, configuration, rubric, ingestion, and scoring boundaries; it is not frontier-model quality or statistical
  reliability evidence. Provider-unverified snapshot and seed controls remain explicit report limitations.
- No real customer email, production inventory write, AWS operation, or other external business effect is configured.

## Stop

```powershell
docker compose --project-name alphonse-v0-2 --env-file .env.release -f compose.yaml down
```

Do not add `--volumes` unless permanent deletion of customer-controlled state is intended.
