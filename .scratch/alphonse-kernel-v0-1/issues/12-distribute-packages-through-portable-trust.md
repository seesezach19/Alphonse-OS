# 12 - Distribute Packages Through Portable Trust

**What to build:** After the decisive proof passes, a local registry publishes, discovers, verifies, quarantines, imports, advises, mirrors, and exports the exact inventory Package without becoming Deployment authority.

**Blocked by:** 11 - Pass The Unfamiliar-Builder Production Proof.

**Status:** ready-for-agent

- [ ] Publisher root delegates a scoped expiring release key; private key remains outside registry storage.
- [ ] Atomic publication rejects incomplete or mismatched artifacts.
- [ ] Package identity remains stable across registry/mirror location.
- [ ] Publication Receipt binds publisher proof, exact artifacts, attestations, and transparency checkpoint.
- [ ] Destination independently verifies every transitive dependency under versioned Trust Policy.
- [ ] Successful import creates quarantined Package plus immutable Import Receipt, not Deployment.
- [ ] Development and production policies can reach different admissibility decisions.
- [ ] Signed advisory drives only preapproved local response.
- [ ] Offline bundle import verifies equivalently and active operations continue during registry outage.
