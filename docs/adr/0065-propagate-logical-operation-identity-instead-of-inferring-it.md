# Propagate Logical Operation Identity Instead Of Inferring It

Cross-observer correlation uses an opaque Logical Operation Identity created at the earliest trustworthy
customer-side boundary and propagated unchanged through deliveries, executions, requests, and destination
metadata. A registered issuer may strengthen propagation with a signed Correlation Token that downstream
systems only pass through. When propagation is impossible, a separately governed customer-side tokenization
service may return domain-separated identifiers under narrow scope. Otherwise correlation remains explicitly
unresolved: the Diagnostic Plane does not silently join records by sensitive identifiers, timestamps, or model
similarity, and Kernel never retroactively invents an external logical-operation identity.
