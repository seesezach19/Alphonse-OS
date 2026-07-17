# Keep Diagnostic Intake And Read Surfaces Private

Public provider traffic terminates at a customer ingress adapter that authenticates webhooks, limits traffic,
journals durably, maps logical operations, forwards under policy, and reports evidence asynchronously. It has no
Diagnostic Plane read authority. The Diagnostic Plane API remains reachable only through a private service network,
customer VPC or cluster, Unix socket, or authenticated private tunnel.

Observation intake, operator and verifier reads, and internal administration use separate listeners or network
policy even when implemented by one API container. Reachability to intake grants no package, case, artifact, or
assignment read access. Read roles and artifact scope are independently authorized. Diagnostic workers receive exact
read-only mounts and never browse these APIs directly.

Remote observers require both private authenticated transport such as mTLS or WireGuard and an exact Reporting Grant
with signed envelopes. Transport identity, Principal, grant, key, adapter binding, and stream must agree; transport
credentials never expand reporting scope. Freshness, replay, schema, grant, rate, size, audit, rotation, allowlist,
and rejected-body controls remain mandatory on private networks. Hosted internet routing may terminate at an mTLS
gateway, but the evidence API does not become a general public endpoint.
