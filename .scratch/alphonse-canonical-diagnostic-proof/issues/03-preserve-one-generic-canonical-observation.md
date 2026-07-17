# 03 - Preserve one generic canonical observation

**What to build:** Accept and preserve one signed observation through the generic Core protocol, from exact deployed
schema and observer grant through CAS-first storage, immutable receipt, committed intake position, and caller-visible
result semantics. The path must contain no tokenization-specific dependency.

**Blocked by:** 02 - Apply grant state durably before authority becomes effective.

**Status:** complete

- [x] Activate one immutable observation schema by exact ID, version, and digest through an exact Deployment.
- [x] Authenticate an observer-specific HMAC envelope under an effective Reporting Grant and describe the result only
      as authenticated attribution, not exclusive authorship or external truth.
- [x] Validate typed claims and optional bounded detail without parsing opaque artifacts for operational semantics.
- [x] Commit verified detail to local CAS before one Postgres receipt transaction.
- [x] Allocate a contiguous committed intake position only inside the final transaction and preserve receipt,
      transition, coverage update, and outbox event atomically.
- [x] Return new acceptance, exact replay, identity conflict, sequence conflict, validation, authentication, size, and
      transient failure results with their specified status semantics.
- [x] Preserve bounded rejection metadata without automatically retaining arbitrary invalid bodies.
- [x] Demonstrate that observation schemas without equality-token fields can use this path and that Core imports no
      Tokenization Service behavior.
