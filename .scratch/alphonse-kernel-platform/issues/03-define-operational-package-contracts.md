# Define Operational Package And Deployment Plan Contracts

Type: prototype
Status: resolved
Blocked by: 02

## Question

What exact declarations, hashes, dependencies, extension points, trust metadata, validation results, and lifecycle transitions must Operational Packages and Deployment Plans expose for deterministic composition without silently breaking active user space?

Prototype asset: [Operational Package And Deployment Plan](../prototypes/operational-package-and-deployment-plan.md)

## Answer

Operational Packages are immutable normalized artifacts identified by stable package ID, mandatory semantic version, authoritative content digest, Kernel publication attestation, typed exports, dependency requirements, explicit extension points, configuration schema, implementation digests, and trust provenance. Export identity likewise separates stable ID, semantic contract version, and authoritative digest.

Deployment Plans resolve every package, import, extension binding, configuration value, credential reference, and capability candidate to exact digests. Plans receive technical review before staged installation; business approval binds only exact authority-bearing changes, followed by separate Capability Activations. Typed advisories can deprecate, policy-block, or security-quarantine exact versions without silently deleting installed state or history.

Prototype: [Operational Package And Deployment Plan](../prototypes/operational-package-and-deployment-plan.md)
