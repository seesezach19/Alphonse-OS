# Decouple Customer Delivery From Diagnostic Reporting

Customer-side ingress commits stable source-to-operation mapping, delivery identity, redacted claims and
digests, and pending forwarding state to a durable Observation Journal before forwarding. Separate persistent
loops forward to the customer runtime and report signed observations in journal sequence, with independent
retry and no transaction spanning journal, runtime, and Diagnostic Plane. Diagnostic outages create visible
backlog, gaps, coverage degradation, and retention-pressure alerts but do not block customer operations by
default; journal or correlation failure blocks untracked forwarding, and silent eviction is forbidden.
Fail-closed diagnostic reporting remains an explicit later deployment policy for exceptional workflows.
