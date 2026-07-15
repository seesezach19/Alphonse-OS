# 05 - Lease Work to One Customer-Controlled Repair Worker

**What to build:** A customer-controlled Repair Worker claims one bounded Repair Task, receives an ephemeral exact workspace, and submits one immutable Repair Candidate plus targeted regression without gaining promotion authority or surrendering provider credentials.

**Blocked by:** 04 - Reproduce One Confirmed Failure Deterministically.

**Status:** ready-for-agent

- [ ] A typed worker protocol exposes registration, task discovery, lease claim, heartbeat, artifact retrieval, submission, failure, and release operations.
- [ ] One Repair Task binds a short-lived Repair Worker Agent Passport, confirmed Work Intent, exact base revision, Reproduction Bundle, allowed operations, artifact limits, and lease epoch.
- [ ] Only one worker attempt owns the live lease; expiry or cancellation fences later submission from that attempt.
- [ ] Retrying expired or failed work creates a new Repair Task rather than mutating history.
- [ ] The worker materializes an ephemeral workspace containing only the exact repair inputs and relevant regression material.
- [ ] Alphonse stores no Codex, model-provider, repository, or worker-runtime credential.
- [ ] A successful worker submits one immutable candidate, intended behavior change, targeted regression artifact, logs, runtime attribution, and hashes.
- [ ] Duplicate identical submission returns the original result; conflicting submission under the same key is rejected.
- [ ] Invalid output, timeout, process loss, and stale lease produce visible failed or expired attempts without changing another candidate.
- [ ] Repair Worker identity cannot invoke verification authority, Owner authorization, promotion, or rollback.
- [ ] Case projection counts only proposed or verification-pending candidates as candidate-available; rejected candidates remain visible without advancing it.
- [ ] A replaceable test worker and a documented Codex attachment use the same public protocol.
