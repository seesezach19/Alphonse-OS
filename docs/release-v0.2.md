# Alphonse V0.2 Headless Release

V0.2 packages the proven governed Debug Loop as a reproducible customer-controlled Docker release. It performs no AWS
activity and requires no managed cloud or model-provider account.

## Build

```powershell
npm run release:v0.2:build
```

The builder normalizes text line endings, sorts paths, fixes archive timestamps and modes, applies release policy, and
writes a content-addressed USTAR archive plus manifest to `dist/`. Repeated builds must match byte-for-byte.

## Clean Extraction

```powershell
npm run test:v0.2-ticket-11
```

This extracts the archive into a clean temporary directory, runs the shipped installer, verifies generated credentials,
loopback-only ports, absent PostgreSQL exposure, disabled adapter fault controls, pinned images, workflow importability,
public Kernel and Diagnostic protocols, and cleanup.

## Complete Qualification

```powershell
npm run release:v0.2:qualify
```

The gate runs V0.2 release policy and clean extraction, the complete repeatable Debug Loop, and the complete V0.1 release
qualification. Successful qualification writes content-addressed V0.2 evidence to `dist/`.

## Product Boundary

The archive includes Alphonse source, migrations, CLI, verification runner, adapter source and manifests, workflow JSON,
operator documentation, installers, dependency locks, and exact image references. It does not contain n8n binaries,
credentials, customer payloads, development databases, test suites, scratch files, AWS deployment, or model memory.

The reference composition pulls the pinned upstream n8n image under customer custody. Review the current official n8n
license before use: https://docs.n8n.io/sustainable-use-license/
