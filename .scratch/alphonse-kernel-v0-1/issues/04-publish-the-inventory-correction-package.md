# 04 - Publish The Inventory Correction Package

**What to build:** A Builder Agent uses the versioned Builder Toolkit and governed inventory context to construct, validate, simulate, and publish one immutable Inventory Correction Operational Package without changing Kernel internals.

**Blocked by:** 03 - Retrieve Governed Inventory Context.

**Status:** ready-for-agent

- [ ] Builder Toolkit is represented as an exact versioned Skill Export set recorded in Passport and Build Session.
- [ ] Inventory Package declares schemas, comparison Skill, read Capability, correction Capability, evaluations, adapter references, Operator View, and Accountability Contract.
- [ ] Deterministic validation rejects secrets, undeclared effects, missing freshness/authority, missing idempotency/evidence/recovery, and incompatible exports.
- [ ] Structured issues identify exact proposal paths and supported correction operations.
- [ ] Deterministic fixture evaluation and observational read-only simulation produce explicit Simulation Receipts.
- [ ] Publication verifies every artifact and commits one immutable Package Version with exact content/dependency digest.
- [ ] Same Package identity and semantic version cannot identify changed bytes.
- [ ] Completing the Package requires zero Kernel source or schema changes.
