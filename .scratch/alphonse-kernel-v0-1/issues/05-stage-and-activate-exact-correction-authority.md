# 05 - Stage And Activate Exact Correction Authority

**What to build:** A Business Operator reviews one exact inventory Deployment Plan, stages it without authority, then separately approves and activates the bounded correction Capability through Butler.

**Blocked by:** 04 - Publish The Inventory Correction Package.

**Status:** ready-for-agent

- [ ] Deployment Plan binds exact Package/dependency digests, configuration schema, adapter references, and Capability candidates.
- [ ] Validation rejects conflicts, unresolved dependencies, and undeclared extension behavior.
- [ ] Staged Deployment grants no business Capability authority.
- [ ] Technical review records pass, request-changes, or reject against exact version.
- [ ] Butler action card shows source reads, write target, credential scope, limits, evidence, recovery, and current revision.
- [ ] Business approval and Capability Activation are separate exact transitions.
- [ ] Inactive, wrong-version, stale-action, or unapproved Capability cannot admit execution.
- [ ] Butler visibly distinguishes Package, Deployment, approval, and activation states.
