# 13 - Promote Across Customer Environments

**What to build:** A local hosted coordinator promotes one exact Package from development to staging to production through signed evidence gates while every target Environment retains local configuration, credentials, review, activation, and execution authority. No AWS activity.

**Blocked by:** 12 - Distribute Packages Through Portable Trust.

**Status:** ready-for-agent

- [ ] Three isolated local Environments register through customer-initiated signed outbound channels.
- [ ] Minimal Environment Descriptor excludes business payloads, credentials, prompts, evidence bodies, and actor activity.
- [ ] Customer Promotion Graph enforces development to staging to production edges and required receipts.
- [ ] Promotion Proposal moves exact Package identity and compatibility evidence, never mutable state or authority.
- [ ] Target independently resolves Deployment Plan with target-local configuration and credential references.
- [ ] Hosted status reaches deployed/activated only from signed target receipts.
- [ ] Missing staging recovery evidence blocks production proposal.
- [ ] Coordinator outage and revocation do not interrupt existing local operations.
