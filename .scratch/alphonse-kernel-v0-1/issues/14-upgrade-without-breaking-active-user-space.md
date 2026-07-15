# 14 - Upgrade Without Breaking Active User Space

**What to build:** A second inventory Package Version upgrades through compatibility analysis, migration, deterministic canary, and exact activation while active Runs remain pinned and rollback/forward-repair semantics stay honest.

**Blocked by:** 13 - Promote Across Customer Environments.

**Status:** implemented

- [x] Compatibility report compares protocol, exports, schemas, adapters, context, authority, evidence, and recovery semantics.
- [x] Breaking export installs beside old major version rather than mutating it.
- [x] Upgrade Plan binds exact versions, dependencies, migration, in-flight Runs, canary, verification, and repair.
- [x] Package-owned state migration checkpoints, resumes after interruption, and verifies declared invariants.
- [x] Active Run completes on original Package/Skill/adapter versions.
- [x] Deterministic canary cohort is reproducible, attested, and pauses on failed gates.
- [x] Authority-equivalent patch requires exact report-bound preapproval policy; changed authority requires fresh business approval.
- [x] Deployment rollback preserves history; incompatible real-world changes require attested forward-repair or compensation verification.
- [x] Old version cannot retire while consumers, Runs, evidence, recovery, or retention reference it.
