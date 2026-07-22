# Workflow Selection Rubric

Select one existing customer-owned n8n workflow. Every hard gate must pass before scoring. This is a target-admission
rubric, not permission to access or change a customer system.

## Hard Gates

- The agency has a real client and written client consent for this exact workflow and evidence collection.
- The workflow already exists in the customer's n8n installation; the pilot is maintenance, not greenfield building.
- The customer retains n8n/provider credentials at the adapter edge.
- Managed TLS is installed and the release is not exposed through its self-signed loopback reference identity.
- A pre-pilot encrypted backup and exact target rollback reference have both been tested.
- The target effect is low-risk, bounded, observable, reversible, and requires a named Owner authorization.
- The workflow is not responsible for money movement, credential migration, legal/safety decisions, irreversible
  deletion, high-availability service, or unbounded personal/sensitive data.
- Reconciliation can determine applied/not-applied/target-mismatch without redispatching the effect.

Any failed or unknown hard gate is `reject` until resolved.

## Scored Preference

Score each item 0, 1, or 2. Require at least 12/16 after all hard gates pass.

- Business relevance: cosmetic (0), useful (1), meaningful but bounded (2).
- Incident availability: hypothetical (0), reproducible only (1), recent real incident available (2).
- Expected behavior: informal (0), partly stated (1), exact and client-approved (2).
- Evidence quality: logs only (0), mixed observations (1), independent destination evidence (2).
- Reversibility: manual/uncertain (0), documented (1), tested exact rollback (2).
- Blast radius: many subjects (0), small batch (1), one subject/operation (2).
- Operator ownership: unclear (0), available (1), named Owner scheduled (2).
- Client assurance value: unknown (0), interested (1), committed review/use case (2).

Prefer a workflow where n8n reports success but the bounded business outcome can be wrong—for example, duplicate
lead creation, stale routing, or incorrect low-risk notification state—with a destination-side observation and a
safe inactive candidate path. Do not manufacture an incident in production merely to satisfy the pilot.
