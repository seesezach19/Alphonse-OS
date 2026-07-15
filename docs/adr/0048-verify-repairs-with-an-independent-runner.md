---
status: accepted
---

# Verify repairs with an independent runner

A deterministic Verification Runner, separate from Diagnostic and Repair Agents, executes each exact Repair Candidate against its Reproduction Bundle and retained targeted regressions in a disposable substrate. It emits a signed Verification Receipt and destroys the environment; a passing receipt makes a candidate eligible for human promotion but neither certifies overall agent quality nor grants promotion authority.
