---
status: accepted
---

# Use generic repair delivery contracts

Repair Candidates reach external targets through versioned Repair Delivery Adapters configured by secret-free Repair Delivery Bindings. Adapters declare supported inspect, snapshot, candidate, execution, review, promotion, and rollback operations; each operation receives separate Kernel authority and an idempotent receipt, while target-native revisions remain authoritative and unsupported operations remain unavailable.
