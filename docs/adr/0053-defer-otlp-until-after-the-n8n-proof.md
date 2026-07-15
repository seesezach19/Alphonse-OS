---
status: accepted
---

# Defer OTLP until after the n8n proof

The V0.2 n8n repair loop uses Runtime Event Envelopes plus on-demand execution retrieval and does not require an OTLP collector. OTLP remains the generic Diagnostic Plane intake direction and becomes the immediate second-runtime portability proof after the n8n loop passes, ensuring n8n assumptions did not leak into core contracts.
