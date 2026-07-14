# Define The Kernel And Data Plane Context Contract

Type: prototype
Status: resolved
Blocked by: 02

## Question

What exact references, authority and freshness claims, access grants, retrieval bounds, release identities, and evidence must cross between Kernel and a customer-owned Data Plane without making Kernel own business context?

Prototype asset: [Kernel And Data Plane Context Contract](../prototypes/kernel-data-plane-context-contract.md)

## Answer

Kernel issues bounded read-only Context Access Grants and short-lived tokens tied to exact Principal, Passport, Work Intent, purpose, subject/link/sensitivity/freshness constraints, and retrieval limits. Effective access is the strict intersection of Kernel grant and Data Plane policy. Data Plane delivers payload directly to the runtime by default and signs a delivery manifest containing exact item references, hashes, authority, freshness, provenance, discrepancies, sensitivity, and limitations.

Kernel stores one payload-free Context Receipt per bounded delivery with item-level claims. Caching preserves original observation time; advisories propagate by exact receipt linkage without rewriting history. Context proposal, correction, and publication use separate typed capability operations under both Kernel request authority and Data Plane publication/source policy.

Prototype: [Kernel And Data Plane Context Contract](../prototypes/kernel-data-plane-context-contract.md)
