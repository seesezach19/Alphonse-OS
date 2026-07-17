# Activate Observation Semantics Through Deployed Package Schemas

Core defines the base observation envelope, canonicalization, authentication, digest, timing, sequence, limit,
and rejection protocols, while signed Operational Packages export immutable observation schemas under a
restrictive Core meta-schema. Exact Deployments activate schemas and Observation Reporting Grants authorize
their full identity, version, and digest tuple; intake never accepts adapter-supplied definitions. New semantics
require new versions, receipts retain original bytes and schema references, and projections explicitly pin all
schema digests they interpret. Invalid or unauthorized submissions preserve bounded rejection metadata and a
body digest by default, with payload quarantine available only under explicit encrypted policy.
