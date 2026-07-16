# ADR 0060: Attest n8n executions outside affected workflows

## Status

Accepted.

## Decision

Affected n8n workflows do not possess the Runtime Event signing secret and cannot submit lifecycle,
workflow, revision, correlation, or payload claims for signing.

An n8n workflow may nominate only its numeric execution ID. The customer-controlled runtime adapter:

1. retrieves that execution through the n8n API using an adapter-held credential;
2. confirms the returned execution ID and provider workflow ID;
3. resolves the provider workflow through an adapter-owned Alphonse workflow and revision binding;
4. derives lifecycle and timestamps from the observed terminal execution record;
5. constructs and signs the Runtime Event Envelope; and
6. submits the signed envelope to Kernel.

The resulting signature attests that the adapter observed a matching n8n execution record. It does not
establish business success, effect truth, payload correctness, or Kernel authority.

## Consequences

- Compromised workflow code cannot forge signed Runtime Event Envelopes.
- A workflow can nominate real execution IDs and cause redundant lookups, so the adapter must deduplicate
  requests and enforce rate limits.
- Pending observation is currently process-local. Durable recovery and startup reconciliation are required
  before this path is production-ready.
- n8n API custody and workflow-to-revision bindings become explicit adapter configuration.
