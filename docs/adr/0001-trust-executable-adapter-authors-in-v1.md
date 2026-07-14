---
status: accepted
---

# Trust executable adapter authors in V1

Alphonse Kernel V1 accepts executable adapters only from the customer or another explicitly trusted Builder. It runs them as immutable, permission-bounded OCI artifacts through a substrate-independent adapter contract; public untrusted code execution is deferred because its certification, supply-chain, and isolation requirements would distract from proving the Kernel's construction and governance model.

## Consequences

Declarative packages may be broadly shareable, but executable adapters require explicit trust. Rootless containers are the initial substrate; stronger WASM or microVM isolation may be added without changing package contracts.
