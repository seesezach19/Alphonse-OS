# 05 - Lease Work to One Customer-Controlled Repair Worker

**What to build:** A customer-controlled Repair Worker claims one bounded Repair Task, receives an ephemeral exact workspace, and submits one immutable Repair Candidate plus targeted regression without gaining promotion authority or surrendering provider credentials.

**Blocked by:** 04 - Reproduce One Confirmed Failure Deterministically.

**Status:** completed

- [x] A typed worker protocol exposes registration, task discovery, lease claim, heartbeat, artifact retrieval, submission, failure, and release operations.
- [x] One Repair Task binds a short-lived Repair Worker Agent Passport, confirmed Work Intent, exact base revision, Reproduction Bundle, allowed operations, artifact limits, and lease epoch.
- [x] Only one worker attempt owns the live lease; expiry or cancellation fences later submission from that attempt.
- [x] Retrying expired or failed work creates a new Repair Task rather than mutating history.
- [x] The worker materializes an ephemeral workspace containing only the exact repair inputs and relevant regression material.
- [x] Alphonse stores no Codex, model-provider, repository, or worker-runtime credential.
- [x] A successful worker submits one immutable candidate, intended behavior change, targeted regression artifact, logs, runtime attribution, and hashes.
- [x] Duplicate identical submission returns the original result; conflicting submission under the same key is rejected.
- [x] Invalid output, timeout, process loss, and stale lease produce visible failed or expired attempts without changing another candidate.
- [x] Repair Worker identity cannot invoke verification authority, Owner authorization, promotion, or rollback.
- [x] Case projection counts only proposed or verification-pending candidates as candidate-available; rejected candidates remain visible without advancing it.
- [x] A replaceable test worker and a documented Codex attachment use the same public protocol.

## Verification

- `npm test` - 126/126 pass.
- `npm run test:v0.2-ticket-04` - reproduction behavior and user space remain intact.
- `npm run test:v0.2-ticket-05` - registration, discovery, lease fencing, retries, ephemeral workspace cleanup, bounded artifact reads, invalid/timeout/process-loss/release/cancellation histories, immutable candidate idempotency, credential exclusion, and Owner-authority denial pass.
