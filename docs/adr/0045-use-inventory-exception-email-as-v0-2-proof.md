---
status: accepted
---

# Use inventory exception email as the V0.2 proof

The first n8n proof compares ERP and storefront inventory, classifies fulfillment risk, drafts a customer follow-up with a model, routes it only to local review, and reports execution to Alphonse. A seeded mapping defect converts a missing ERP SKU into zero inventory, producing a successful but false delay email; correct behavior preserves `inventory_unknown` and routes human review, providing a deterministic, consequential, and safe repair target.
