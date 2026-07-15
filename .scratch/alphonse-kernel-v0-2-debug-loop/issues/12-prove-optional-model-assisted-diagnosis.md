# 12 - Prove Optional Model-Assisted Diagnosis

**What to build:** A customer-controlled Diagnostic Worker proposes a useful diagnosis from the same confirmed artifacts used by the deterministic proof without gaining authority to declare failure, modify evidence, commission repair, verify, or promote.

**Blocked by:** 10 - Run the Repeatable Fresh-Install Debug Loop Proof. This optional ticket does not block 11 - Release Reproducible Headless Alphonse V0.2.

**Status:** complete

- [x] A separately identified Diagnostic Worker receives the confirmed Failure Specification, exact trace references, Agent Revision, and redacted Reproduction Bundle.
- [x] The worker runs under a bounded Work Intent and short-lived Agent Passport distinct from affected workflow, Repair Worker, Verification Runner, and Owner.
- [x] Model-provider credentials remain in the customer-controlled worker and are never stored by Alphonse.
- [x] Output separates source-backed facts, inference, hypotheses, uncertainty, recommended investigation, and artifact references.
- [x] The diagnosis is an immutable proposal with exact model/runtime/instruction/artifact provenance.
- [x] Affected workflow output cannot be accepted as independent diagnosis merely because the same model produced it.
- [x] The worker cannot confirm or alter the Failure Specification, Reproduction Bundle, Repair Task, candidate, Verification Receipt, Promotion, or target state.
- [x] Repeating the worker with changed model or instructions creates a distinct proposal rather than mutating prior diagnosis.
- [x] Diagnostic Worker timeout, invalid output, or low-quality proposal leaves the deterministic Debug Loop fully usable.
- [x] A Builder can accept, reject, or ignore the proposal without changing demonstrated failure truth or authority.
- [x] The deterministic proof remains the acceptance baseline; model assistance is evaluated for usefulness, not correctness authority.
- [x] No automatic anomaly detection, broad agent score, certification, or automatic repair is introduced.

**Verification:** `npm run test:v0.2-ticket-12`; `npm test`; `npm run release:v0.2:build`; `git diff --check`. No AWS activity.
