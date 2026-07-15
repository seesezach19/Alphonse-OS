---
status: accepted
---

# Use n8n as the first external substrate

V0.2 uses a separately operated, customer-owned n8n instance as its first external workflow substrate, reusing the signed asynchronous dispatch, correlation, idempotency, customer-held credential, append-only trace, and trace-to-regression lessons proven in VPSCLAW3. Alphonse reimplements those boundaries through Kernel and the Diagnostic Plane rather than porting the old Butler implementation or coupling product semantics to n8n.
