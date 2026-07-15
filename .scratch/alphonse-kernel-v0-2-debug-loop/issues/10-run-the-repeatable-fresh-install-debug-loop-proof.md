# 10 - Run the Repeatable Fresh-Install Debug Loop Proof

**What to build:** A fresh local installation executes the complete n8n Debug Loop twice through public boundaries and produces equivalent inspectable outcomes while preserving all V0.1 behavior.

**Blocked by:** 09 - Reconcile Uncertain Promotion Without Blind Retry.

**Status:** complete

- [x] One documented local sequence starts customer-owned n8n and Alphonse Node from clean state without manual database work.
- [x] The proof imports the Event Reporter and defective inventory workflow, runs the missing-SKU fixture, and attributes one successful-but-wrong trace to the exact revision.
- [x] It reports and confirms the failure, builds the redacted Reproduction Bundle, and proves the original defect.
- [x] It leases a Repair Task through the public worker protocol, submits an inactive repaired candidate and regression, and independently verifies it.
- [x] It requires Owner promotion, confirms exact target revision, preserves rollback reference, and resolves the case.
- [x] It injects and reconciles timeout-after-promotion uncertainty without duplicate target change.
- [x] Event, command, task, candidate, verification, promotion, and artifact retries create no duplicate accepted truth.
- [x] Authentication denial, conflicting event, expired lease, bad candidate, worker self-promotion, stale target, and target mismatch fail closed.
- [x] Running from clean state twice produces equivalent normalized receipts, projections, artifacts, and final target behavior.
- [x] One public inspection command or short sequence explains the final case without direct database access or private logs.
- [x] Complete V0.1 unit, black-box, rehearsal, upgrade, restore, support, and release qualification remain green.
- [x] The proof uses no AWS, real customer email, production inventory write, private hosted dependency, or live model nondeterminism.

## Verification

- `npm run rehearse:v0.2`: passed two clean-state runs with equivalent normalized public outcomes.
- `npm run release:qualify -- --resume`: passed all 17 V0.1 qualification suites.
- `npm test`: passed 152/152 unit tests.
- `git diff --check`: clean.
