# Independent Repair Verification

Ticket 07 adds one deterministic Verification Runner between inactive candidate delivery and Owner promotion.

## Boundary

- Kernel builds a provider-neutral job from content-addressed original, candidate, Reproduction Bundle, fixture, and regression artifacts.
- The n8n Operational Package translates exact n8n workflow representations into deterministic execution outcomes.
- A fresh child process receives only the exact job and a verification signing identity. It receives no n8n credential, worker credential, Owner token, or promotion operation.
- The temporary workspace is destroyed before Kernel accepts the result.
- Kernel verifies the signed receipt, retains fixture, logs, receipt, and per-check outcomes, then appends `verified` or `rejected` to the candidate lifecycle.

Passing means promotion-eligible only. It does not authorize promotion, mutate the active workflow, resolve the case, or certify general workflow quality.

## Configuration

```text
VERIFICATION_RUNNER_ID=<stable-verifier-uuid>
VERIFICATION_RUNNER_VERSION=0.2.0
VERIFICATION_FIXTURE_VERSION=inventory-v1
VERIFICATION_RUNNER_SIGNING_KEY_ID=<local-key-id>
VERIFICATION_RUNNER_SIGNING_SECRET=<customer-local-secret>
```

The signing secret is process-local and is not persisted in Diagnostic Plane records or artifacts.

## Operations

- `GET /diagnostic/v0/verification-runner-contract`
- `POST /diagnostic/v0/repair-verifications`
- `GET /diagnostic/v0/repair-verifications/{verification_id}`

Creation binds `candidate_id`, `delivery_id`, and `idempotency_key`. Exact retries return the original receipt. Reusing a key against changed dependencies fails closed.

## V0.2 Scope

The first adapter executes the exact n8n inventory workflow Code nodes against the retained missing-SKU fixture. Compatible retained regressions run; incompatible regressions remain visible with an explicit reason. Additional workflow shapes require additional Operational Package verification adapters, not changes to provider-neutral Kernel receipt semantics.
