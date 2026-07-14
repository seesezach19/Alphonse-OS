# 06 - Hand Off To A Bounded Linux Runtime

**What to build:** The Builder explicitly hands the active inventory work to a second runtime that accepts exact structured state and launches inside a bounded Linux workload without conversation history.

**Blocked by:** 05 - Stage And Activate Exact Correction Authority.

**Status:** ready-for-agent

- [ ] Hand Off binds target runtime, Work Intent, exact Package/Skill/Capability versions, Context Receipts, ledger cursor, Delegation proposal, and open obligations.
- [ ] Target runtime receives no Builder conversation history or hidden memory.
- [ ] Target acceptance atomically activates target responsibility and closes/narrows source task authority.
- [ ] Kernel issues a short-lived Workload Grant bound to Environment epoch, Run intent, workload digest, adapter, resources, network, filesystem, and expiry.
- [ ] Local Docker Linux workload runs non-root with read-only root, bounded scratch, dropped capabilities, no engine socket, and default-deny network.
- [ ] Lease expiry and Environment epoch fencing block consequential work.
- [ ] Signed host observations identify workload by namespace/cgroup/boot/start identity rather than PID alone.
- [ ] Butler thread shows pending, accepted, expired, and rejected handoff states.
