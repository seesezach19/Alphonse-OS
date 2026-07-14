# 14 - Upgrade Without Breaking Active User Space

**What to build:** A second inventory Package Version upgrades through compatibility analysis, migration, deterministic canary, and exact activation while active Runs remain pinned and rollback/forward-repair semantics stay honest.

**Blocked by:** 13 - Promote Across Customer Environments.

**Status:** ready-for-agent

- [ ] Compatibility report compares protocol, exports, schemas, adapters, context, authority, evidence, and recovery semantics.
- [ ] Breaking export installs beside old major version rather than mutating it.
- [ ] Upgrade Plan binds exact versions, dependencies, migration, in-flight Runs, canary, verification, and repair.
- [ ] Package-owned state migration checkpoints, resumes after interruption, and verifies declared invariants.
- [ ] Active Run completes on original Package/Skill/adapter versions.
- [ ] Deterministic canary cohort is reproducible and pauses on failed gates.
- [ ] Authority-equivalent patch may use preapproved policy; changed authority requires fresh business approval.
- [ ] Deployment rollback preserves history; incompatible real-world changes use forward repair or compensation.
- [ ] Old version cannot retire while consumers, Runs, evidence, recovery, or retention reference it.
