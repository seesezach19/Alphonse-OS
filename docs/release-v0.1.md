# Alphonse Kernel V0.1 Release

V0.1 packages the proven local platform as a reproducible customer-controlled Docker release. It performs no AWS
activity and requires no model-provider account or provider memory.

## Build

```powershell
npm run release:build
```

The builder normalizes text line endings, sorts paths, fixes archive timestamps and modes, verifies release policy, and
writes a content-addressed USTAR archive plus manifest to `dist/`. A second in-memory build must match byte-for-byte.
The manifest pins every component source digest, all 21 migrations, exact npm dependencies, and immutable Node and
PostgreSQL image digests.

## Install Proof

```powershell
npm run test:ticket-17
```

This extracts the built archive into a clean temporary directory and runs the shipped installer. It verifies generated
credentials, Kernel, Butler, Data Plane, pinned images, absent PostgreSQL host exposure, disabled adapter test controls,
and cleanup. The customer command is documented in the included `OPERATOR.md`.

## Complete Qualification

```powershell
npm run release:qualify
```

Qualification runs unit checks, clean bootstrap, Tickets 02-09, repeatability rehearsal, and Tickets 12-17. Together
these cover happy/stale/duplicate inventory behavior, uncertainty and recovery, handoff, accountability, portable trust,
coordinator outage, pinned-Run upgrade, migration, canary, rollback/repair, backup/restore, worker fencing, and temporary
support. Successful qualification writes deterministic content-addressed evidence to `dist/`.

Ticket 14 upgrades the pinned reference inventory user-space baseline from Package `1.0.0` to `2.0.0`/`2.1.0`. V0.1
does not claim an in-place upgrade from an earlier publicly shipped Kernel binary; no such release exists.

## Release Boundary

Included: runtime source, reference workload, migrations, operator documentation, installers, exact dependency locks,
release spec, and upgrade baseline.

Excluded: test fixtures, `.scratch`, proof drafts, conversation/context scaffolds, generated credentials, local databases,
AWS deployment, and provider-specific memory. PostgreSQL remains an internal implementation detail with no host port in
the release composition. Registry and coordinator source are pinned but require separate customer-controlled key
enrollment and are not started by the default installer.
