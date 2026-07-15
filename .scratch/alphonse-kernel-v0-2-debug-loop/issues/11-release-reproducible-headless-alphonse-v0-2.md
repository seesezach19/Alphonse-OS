# 11 - Release Reproducible Headless Alphonse V0.2

**What to build:** Package the proven headless Debug Loop as a reproducible customer-controlled Alphonse V0.2 release with pinned components, clear custody boundaries, complete regression evidence, and no AWS requirement.

**Blocked by:** 10 - Run the Repeatable Fresh-Install Debug Loop Proof.

**Status:** complete

- [x] Fresh-machine prerequisites and customer-controlled Docker installation are documented and verified from a clean extraction.
- [x] Release pins exact Kernel, Diagnostic Plane, CLI, Verification Runner, adapter package, reference workflow, migration, PostgreSQL, and compatible n8n identities.
- [x] n8n remains a separately operated customer-owned service with its license and product boundary documented; Alphonse does not white-label or redistribute it improperly.
- [x] Release contains no provider credential, generated local secret, customer payload, development database, scratch prototype, or hidden authority path.
- [x] One command or documented short sequence runs the complete V0.2 black-box qualification.
- [x] Qualification includes happy, duplicate, conflict, expired worker, failed verification, stale target, uncertain promotion, reconciliation, and rollback cases.
- [x] Complete V0.1 regression and release qualification remain part of the V0.2 gate.
- [x] Release artifacts, manifests, migrations, documentation, and qualification evidence are content-addressed and reproducible.
- [x] Operator documentation explains data and credential custody, trust assumptions, retention/tombstones, backup expectations, limitations, and recovery posture.
- [x] Public protocol documentation identifies External Activity as ungoverned observation and verification as targeted evidence rather than broad agent certification.
- [x] Installation binds services to safe local interfaces by default and documents deliberate exposure requirements.
- [x] Release performs no AWS activity and requires no managed cloud service.

## Verification

- `npm run release:v0.2:build`: reproducible 186-file archive and content-addressed manifest passed.
- `npm run test:v0.2-ticket-11`: clean extraction, installation, reinstall, workflow import, public inspection, custody, and loopback checks passed.
- `npm run release:v0.2:qualify -- --resume`: all 4 V0.2 gates and all 17 V0.1 qualification suites passed.
- `npm test`: passed 157/157 unit tests.
- V0.2 manifest and qualification evidence SHA-256 sidecars match their files.
- `git diff --check`: clean; no AWS activity or external business effects occurred.
