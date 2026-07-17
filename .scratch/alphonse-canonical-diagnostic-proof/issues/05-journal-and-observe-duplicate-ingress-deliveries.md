# 05 - Journal and observe duplicate ingress deliveries

**What to build:** Send two webhook deliveries through the customer ingress boundary while preserving one stable
logical operation, two distinct delivery attempts, and independently reported source observations without placing
Diagnostic Plane in the customer delivery availability path.

**Blocked by:** 03 - Preserve one generic canonical observation; 04 - Tokenize comparison values with verifiable
result receipts.

**Status:** complete

- [x] Commit stable source mapping, Logical Operation Identity, delivery attempt, redacted claims and digests, and
      pending forwarding state in one local durable transaction before forwarding.
- [x] Resolve both fixture deliveries to one opaque logical operation while preserving distinct delivery identities.
- [x] Run forwarding and observation reporting as independent durable loops with independent retry state.
- [x] Propagate the logical-operation context to n8n without exposing raw source identity in diagnostic evidence.
- [x] Produce source identity and delivery equality tokens through exact authorized field roles and cite preserved
      Tokenization Result Receipts.
- [x] Continue forwarding during Diagnostic Plane outage, retain unreported journal entries, and expose backlog,
      retention pressure, and durable loss markers.
- [x] Prevent the Scenario Stimulus from holding reporting credentials or authoring source observations.
- [x] Verify replay and restart do not create a second logical operation or silently drop a delivery attempt.
