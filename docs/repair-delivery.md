# Repair Delivery

Repair delivery converts one immutable provider-neutral Repair Candidate into one inactive target-native candidate. It does not verify, approve, promote, confirm, or roll back the repair.

## Boundary

- Core declares `inspect`, `snapshot`, `candidate`, `candidate-execution`, `review`, `promotion`, `confirmation`, and `rollback` independently.
- A secret-free Repair Delivery Binding selects one exact adapter version, target, external credential binding reference, operation allowlist, and transition policy.
- Ticket 06 permits only `inspect`, `snapshot`, and `candidate`.
- The customer-owned API key remains in the local process environment. PostgreSQL stores only its external binding reference.
- Candidate creation requires the exact current target revision digest and fails before target mutation when the base has drifted.
- The active target is inspected again after candidate creation. Its revision and active state must remain unchanged.
- The base snapshot and inactive candidate representation are retained in content-addressed storage.
- Verification and Owner promotion remain later, independent transitions.

## n8n Adapter

The first-party adapter uses n8n's public API:

- `GET /api/v1/workflows/{id}` for exact target inspection and snapshot.
- `POST /api/v1/workflows` for a new candidate workflow.
- The candidate request omits `active`; the returned workflow must be inactive.
- No activation, publication, confirmation, or rollback method is exported in Ticket 06.

Configure the customer-local Node with:

```text
N8N_REPAIR_DELIVERY_URL=http://n8n:5678/api/v1
N8N_REPAIR_DELIVERY_API_KEY=<customer-owned-api-key>
N8N_REPAIR_DELIVERY_CREDENTIAL_BINDING_REF=customer-secret-store:n8n-repair-v1
```

The binding's `external_credential_binding_ref` must exactly match the configured reference. The key itself must never appear in binding JSON, command bodies, artifacts, receipts, or logs.

## Lifecycle

1. Register the Repair Delivery Binding.
2. Inspect its target and retain the returned target revision digest.
3. Materialize the immutable Repair Candidate using that digest as `expected_base_revision_digest`.
4. Inspect the Repair Delivery record and retained artifacts.
5. Pass the exact inactive candidate to independent verification.

An identical command is replayed. A new command with the same candidate and identical delivery material returns the original immutable receipt. Conflicting reuse fails closed.
