# Project Identifier Equality With Scoped Exact-Value Tokens

The duplicate-delivery diagnosis requires equality relationships, not raw delivery identities or idempotency keys.
A dedicated customer-side tokenization service issues Exact-Value Equality Tokens in an integration-specific
idempotency comparison namespace. The source observer may tokenize only its designated delivery-identity field; the
destination request observer may tokenize only its designated idempotency-key field. Neither receives tokenization
secrets or arbitrary tokenization authority. Separate Tokenization Use Grants, not Observation Reporting Grants,
bind those exact field roles, namespace, version, collection window, size, rate, and service scope.

For exact-string integration semantics, tokenization consumes exact length-delimited bytes without trimming, case
folding, Unicode normalization, or implicit coercion. Tokens are domain-separated by customer, environment,
integration, and purpose; rate-limited and audited against oracle attacks; pinned by deployment and collection
window; and treated as pseudonymous sensitive metadata. Different tokenization versions yield unresolved equality
unless an exact governed bridge exists.

The pinned projector may derive only cited equality relationships: each request key equals its delivery identity,
the request keys differ, and both deliveries share one Logical Operation Identity. Every edge binds receipt digests,
token namespace and version, service binding, Integration Behavior Contract, projector, and rules. It does not label
the key choice defective, identify implementation location, prescribe the correct key, or claim causality. Disclosure
policy may expose scoped tokens or only resulting edges. Projection establishes equality; the worker determines its
diagnostic significance.
