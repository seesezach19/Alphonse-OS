---
status: accepted
---

# Generalize Butler webhooks into Runtime Event Envelopes

The tested Butler/n8n canonical-body, timestamped HMAC, correlation, idempotency, asynchronous callback, body-hash, and receipt semantics become a provider-neutral Runtime Event Envelope. V0.2 removes legacy static-secret headers, separates acceptance from completion, requires once-only event identity and sequence, preserves conflicting claims, and stores diagnostic payloads outside Kernel while retaining immutable receipts.
