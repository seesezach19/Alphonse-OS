# Use Gap-Tolerant Observation Stream Sequences

Observation intake accepts unseen sequence numbers without requiring strict contiguity, records compact
missing ranges, and permits later arrivals to fill gaps. Exact identity and digest replay is idempotent;
sequence or observation-identity reuse with conflicting material is rejected and preserved as an intake
conflict. Sequence orders only one stream, while cross-stream relationships require explicit identifiers or
causal references. New stream epochs receive new stream identities, and bounded sequence, rate, and advance
policies prevent pathological gap state. Evidence packages freeze a versioned Stream Coverage Projection at
their cutoff so later arrivals can improve a new package without rewriting prior evidence.
