# Correlate Source Deliveries With Scoped Identity Tokens

Workers receive identity equivalence rather than raw customer identity. A `source.delivery` claim carries an opaque
Logical Operation Identity, distinct delivery identity, scoped Source Identity Token and tokenization version,
`stable_source_identity_mapping` basis, and mapping provenance including journal sequence and record digest. This
proves that distinct deliveries resolved to one stable source identity and operation through the durable journal.

Tokenization is customer-side, nonreversible, versioned, and scoped by installation, environment, source binding,
and identifier namespace. It is domain-separated across customers and integrations and remains pseudonymous
sensitive metadata. Bare hashes of low-entropy identifiers are prohibited, and observers never receive the
tokenization secret. Provider delivery identities are similarly scoped when they may disclose sensitive material.

Raw source identity may exist only in independently encrypted detail when exact schema, Reporting Grant, redaction,
selection, access, and retention policy permit it. Worker packages exclude it by default and record the reason when
selected. Selected bytes become retention-pinned until governed erasure. The inspectable chain is scoped source
token to mapping receipt to opaque logical operation to distinct delivery attempts.
