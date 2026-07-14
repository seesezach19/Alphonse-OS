---
status: accepted
---

# Make package composition explicit and immutable

Operational Packages compose through exact dependency locks, namespaced exports, and declared extension points into immutable Deployment Plans. Conflicts fail validation, installation order cannot provide hidden override behavior, and upgrades produce new proposals rather than changing active deployments; this protects existing user space as the Kernel and package ecosystem evolve.
