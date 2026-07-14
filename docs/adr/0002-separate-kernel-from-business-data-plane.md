---
status: accepted
---

# Separate Kernel from the business data plane

Alphonse Kernel defines and enforces the contracts by which governed context is referenced and used, but it does not store the customer's business context or operational twin. A separate customer-owned Data Plane supplies exact scoped context through stable interfaces, with ALPHONSE_DATA serving as the reference implementation; this keeps Kernel invariants independent of domain schemas and storage providers.
