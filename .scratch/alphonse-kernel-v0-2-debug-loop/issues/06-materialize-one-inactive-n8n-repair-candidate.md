# 06 - Materialize One Inactive n8n Repair Candidate

**What to build:** The n8n Repair Delivery Adapter converts the worker's generic Repair Candidate into one exact inactive target-native candidate while preserving the active workflow and a pre-change snapshot.

**Blocked by:** 05 - Lease Work to One Customer-Controlled Repair Worker.

**Status:** ready-for-agent

- [ ] A provider-neutral Repair Delivery Adapter contract declares supported inspect, snapshot, candidate, candidate-execution, review, promotion, confirmation, and rollback operations independently.
- [ ] A secret-free Repair Delivery Binding selects the exact n8n adapter version, target reference, external credential binding reference, permitted operations, and transition policy.
- [ ] The first-party n8n Operational Package exports a conforming Repair Delivery Adapter without adding n8n fields to core Diagnostic Plane schemas.
- [ ] Adapter inspection resolves the current exact n8n target revision through supported APIs.
- [ ] Candidate creation requires the expected base revision and rejects target drift before changing target state.
- [ ] The worker's repair preserves `inventory_unknown` and routes human review instead of drafting a false delay message.
- [ ] One inactive target-native candidate is materialized and attributed to the immutable Alphonse Repair Candidate.
- [ ] Creating the candidate does not activate, publish over, or otherwise mutate the currently active n8n workflow.
- [ ] The prior target snapshot and exact candidate representation are retained by content digest.
- [ ] Identical candidate-delivery retry returns the original receipt; conflicting retry fails closed.
- [ ] The adapter receives no Owner promotion authority and exposes unsupported operations as unavailable.
- [ ] Public inspection shows exact base, inactive candidate, target references, adapter version, receipts, and legal next operations.
