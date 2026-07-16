# ADR 0060: Attest n8n executions outside affected workflows

## Status

Accepted.

## Decision

Affected n8n workflows do not possess the Runtime Event signing secret and cannot submit lifecycle,
workflow, revision, correlation, or payload claims for signing.

An n8n workflow may nominate only its numeric execution ID. The customer-controlled runtime adapter:

1. retrieves that execution through the n8n API using an adapter-held credential;
2. confirms the returned execution ID and provider workflow ID;
3. fingerprints the execution-time workflow snapshot under pinned fingerprint rules;
4. requires that fingerprint to match the adapter-owned Alphonse revision binding;
5. derives lifecycle and timestamps from the observed terminal execution record;
6. constructs and signs the Runtime Event Envelope; and
7. submits the signed envelope to Kernel.

Changing behavior-bearing workflow material under the same provider workflow ID causes attestation rejection.
There is no fallback to revision attribution from workflow ID alone. Provider workflow version is preserved when
the execution snapshot supplies it.

Fingerprint rules expand pinned n8n parameter defaults before hashing. This makes imported material and its
execution snapshot equivalent when n8n serializes omitted defaults explicitly, while changes to those values
still change the fingerprint. These defaults are part of the Operational Package fingerprint rules.

The resulting signature attests that the adapter observed a matching n8n execution record. It does not
establish business success, effect truth, payload correctness, or Kernel authority.

## Consequences

- Compromised workflow code cannot forge signed Runtime Event Envelopes.
- A workflow can nominate real execution IDs and cause redundant lookups, so the adapter must deduplicate
  requests and enforce rate limits.
- Pending observation is currently process-local. Durable recovery and startup reconciliation are required
  before this path is production-ready.
- n8n API custody and workflow-to-revision bindings become explicit adapter configuration.
