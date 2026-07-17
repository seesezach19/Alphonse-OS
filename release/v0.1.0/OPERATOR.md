# Alphonse Kernel V0.1 Operator Guide

## Scope

V0.1 is a customer-controlled local Docker release. It includes Kernel, Butler, the reference Data Plane, reference
runtime/adapter components, registry and coordinator source, and migrations through `022_grant_authority_application.sql`.
The one-command installation starts the local customer control plane and reference inventory integration. Registry and
hosted coordinator deployment require separate customer key enrollment. AWS deployment is not included.

## Prerequisites

- 64-bit machine with at least 4 CPU cores, 8 GB RAM, and 10 GB free disk.
- Docker Desktop 4.x with Linux containers, or Docker Engine 26+ with Compose v2.
- Windows PowerShell 5.1+ for `install-local.ps1`, or a POSIX shell for `install-local.sh`.
- Loopback ports 3000 and 3100 available.

## Install

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-local.ps1
```

Linux/macOS:

```sh
./install-local.sh
```

The installer creates `.env.release` once with random local credentials, then builds and starts the pinned release. It
never overwrites existing credentials. PostgreSQL is not published to the host. Kernel and Data Plane bind only to
loopback.

## Custody

- Customer PostgreSQL is authoritative for Kernel state and remains in the local Docker volume.
- Business data remains in customer systems. The reference Data Plane demonstrates governed reads; it is not a business
  system of record.
- `.env.release` contains local bootstrap, signing, service, and encryption credentials. Restrict access and back it up
  separately from database snapshots.
- Runtime credentials are resolved by the broker under exact permits. Agents and workloads do not receive standing
  connector credentials.
- Coordinator and Registry private keys are not included. Operators generate and custody them before enabling those
  optional surfaces.

## Trust Assumptions

- The customer trusts the pinned container image digests and verifies the release manifest digest.
- Docker Engine, host kernel, filesystem, and local administrator remain inside the trusted computing base.
- Kernel database access is internal implementation authority, not a public platform interface.
- Butler is a projection over Kernel APIs. It has no independent database authority.
- Signed records prove origin and integrity; they do not prove that a compromised host observed reality honestly.

## Backup And Upgrade

Use the documented encrypted backup and fail-closed restore procedure before upgrades. Restore advances the Environment
execution epoch and requires explicit verification, reconciliation, and resume. User-space upgrades preserve pinned
Runs, use resumable migration, deterministic canary gates, and honest rollback or forward repair.

## Support

Support begins with coarse signed health. Diagnostic access requires a customer-approved, read-only, expiring Support
Passport. Diagnostic bundles are explicit, encrypted, redacted, immutable, and access-logged. Remediation still requires
an exact locally active Capability. Revoking the Coordinator Binding immediately ends support access while local history
and authority continue.

## Limitations

- V0.1 is single-customer and local-first; high availability and managed orchestration are not included.
- The bundled inventory Data Plane, storefront, broker, and adapter are reference implementations, not universal ERP or
  commerce connectors.
- Registry and coordinator source are pinned but not started by the default installer.
- No AWS, cloud identity, managed secret store, external observability backend, or provider memory is required or shipped.
- Host administrators can bypass application controls. Production hardening requires customer OS, network, backup,
  secret-store, and incident-response policy.

## Stop

```powershell
docker compose --project-name alphonse-kernel-v0-1 --env-file .env.release -f compose.yaml down
```

Do not add `--volumes` unless permanent local data removal is intended.
