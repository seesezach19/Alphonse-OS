# 17 - Release Reproducible Alphonse Kernel V0.1

**What to build:** Package the proven local platform as a reproducible customer-controlled V0.1 release with one-command installation, complete black-box regression, upgrade/restore/support evidence, and clear boundaries. No AWS deployment is included.

**Blocked by:** 14 - Upgrade Without Breaking Active User Space; 16 - Coordinate Support Without Standing Authority.

**Status:** implemented

- [x] Fresh local machine prerequisites and one-command Docker installation are documented.
- [x] Release pins exact Kernel, Butler, Data Plane, substrate, registry, coordinator, Package, and migration versions.
- [x] Fresh install passes complete inventory happy, stale, duplicate, uncertainty, recovery, handoff, and accountability regression.
- [x] Upgrade from previous release passes pinned-Run, migration, canary, and rollback/repair checks.
- [x] Backup/restore, worker fencing, support access, and coordinator-outage checks pass.
- [x] Release contains no secrets, hidden workflow scaffold, direct database authority path, or provider-specific required memory.
- [x] Operator documentation explains data/credential custody, trust assumptions, limitations, and non-AWS deployment boundary.
- [x] Release artifacts and acceptance evidence are content-addressed and reproducible.
