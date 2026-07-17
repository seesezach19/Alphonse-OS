# 13 - Revise packages for material late evidence

**What to build:** Preserve frozen packages and diagnoses while allowing deterministically material late evidence to
create a new projection, package revision, and explicit reevaluation opportunity without silently replacing prior
work.

**Blocked by:** 12 - Create the model-free unclaimed diagnostic assignment.

**Status:** ready-for-agent

- [ ] Keep every frozen package, assignment, and diagnosis immutable when later receipts, gap fills, contradictions,
      contract changes, or resolved relationships arrive.
- [ ] Define exact material-change classes and suppress a revision when deterministic selection produces the same
      semantic package digest.
- [ ] Create a new projection and package revision for completed required coverage, connected evidence,
      contradictions, changed evaluation, or resolved relationships under exact policy.
- [ ] Create an immutable `reevaluation_available` record binding old and new package digests, change reason, affected
      assignments and diagnoses, and policy recommendation.
- [ ] Default reevaluation to notification only unless an activated policy or governed request explicitly authorizes
      another assignment.
- [ ] Permit policy to expire and replace an unclaimed assignment while preserving both records and replacement
      linkage.
- [ ] Never substitute a newer package into a claimed assignment or overwrite which package an existing diagnosis
      evaluated.
- [ ] Prove duplicate late events and nonmaterial detail cannot create revision storms.
