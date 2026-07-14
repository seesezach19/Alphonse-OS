# 12 - Distribute Packages Through Portable Trust

**What to build:** After the decisive proof passes, a local registry publishes, discovers, verifies, quarantines, imports, advises, mirrors, and exports the exact inventory Package without becoming Deployment authority.

**Blocked by:** 11 - Pass The Unfamiliar-Builder Production Proof.

**Status:** implemented-and-rehearsed; production inventory publication remains blocked by Ticket 11

- [x] Publisher root delegates a scoped expiring release key; private key remains outside registry storage.
- [x] Atomic publication rejects incomplete or mismatched artifacts.
- [x] Package identity remains stable across registry/mirror location.
- [x] Publication Receipt binds publisher proof, exact artifacts, attestations, and transparency checkpoint.
- [x] Destination independently verifies every transitive dependency under versioned Trust Policy.
- [x] Successful import creates quarantined Package plus immutable Import Receipt, not Deployment.
- [x] Development and production policies can reach different admissibility decisions.
- [x] Signed advisory drives only preapproved local response.
- [x] Offline bundle import verifies equivalently and active operations continue during registry outage.

Controlled-package acceptance passes. Do not publish or describe the inventory Package as production-qualified until Ticket 11 passes.
