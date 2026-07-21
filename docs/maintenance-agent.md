# Bounded Maintenance Agent

The certified Maintenance Agent profile composes the existing diagnostic and repair
protocols without granting a model or agent production authority. Kernel owns identity,
scope, leases, admission, and durable state. A replaceable diagnostic worker may submit
one closed-schema diagnosis from frozen evidence; a separately registered repair worker
may submit only an inactive provider-neutral candidate. A distinct disposable verifier
decides repair eligibility. Only an authenticated named human may authorize promotion or
rollback through the Repair Delivery Adapter.

The public read surfaces are:

- `GET /diagnostic/v0/maintenance-agent-profile`
- `GET /diagnostic/v0/maintenance-work-queue`
- `POST /diagnostic/v0/maintenance-assurances`
- `GET /diagnostic/v0/maintenance-assurances/{export_id}`

The work queue is a projection over durable Diagnostic Assignments and Repair Tasks; it
grants no authority. The immutable Maintenance Assurance export binds one exact
assignment, diagnosis, candidate, delivery, verification receipt, and Promotion. Its
human-readable form keeps supported facts, interpretation, limitations, authorization,
effects, and recovery separate. The export digest covers the normalized machine document
and is verified again on every read.

## Live proof

```powershell
npm run proof:maintenance
```

The isolated Compose proof uses the public n8n API against the real local canonical lead
workflow. It demonstrates two deliveries for one logical operation, submits the exact
logical-operation deduplication patch as an inactive candidate, independently verifies
the original failure and repaired behavior, and then exercises named-human promotion,
apply-then-timeout reconciliation, and rollback. It also proves invalid worker output is
recorded without a candidate, Kernel restart preserves queue state, broker replay is
denied, and agents cause zero external business effects.

Provider credentials remain at the n8n adapter edge. The Kernel receives only a secret-free
credential binding reference. The reference model provider is synthetic, the static-data
deduplication policy remains pilot-scoped, and one local workflow does not establish
universal connector or model reliability.
