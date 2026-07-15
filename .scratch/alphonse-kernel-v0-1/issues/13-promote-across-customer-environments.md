# 13 - Promote Across Customer Environments

**What to build:** A local hosted coordinator promotes one exact Package from development to staging to production through signed evidence gates while every target Environment retains local configuration, credentials, review, activation, and execution authority. No AWS activity.

**Blocked by:** 12 - Distribute Packages Through Portable Trust.

**Status:** implemented

- [x] Three isolated local Environments register through customer-initiated signed outbound channels.
- [x] Minimal Environment Descriptor excludes business payloads, credentials, prompts, evidence bodies, and actor activity.
- [x] Customer Promotion Graph enforces development to staging to production edges and required receipts.
- [x] Promotion Proposal moves exact Package identity and compatibility evidence, never mutable state or authority.
- [x] Target independently resolves Deployment Plan with target-local configuration and credential references.
- [x] Hosted status reaches deployed/activated only from signed target receipts.
- [x] Missing staging recovery evidence blocks production proposal.
- [x] Coordinator outage and revocation do not interrupt existing local operations.
