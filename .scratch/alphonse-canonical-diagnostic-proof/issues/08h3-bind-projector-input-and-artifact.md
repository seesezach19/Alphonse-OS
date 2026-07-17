# 08H3 - Bind projector input and artifact identity

**What to build:** Give a correlation projection one exact normalized input identity and an artifact identity covering
the transitive executed semantics that load, verify, normalize, canonicalize, project, and classify replay.

**Blocked by:** 08H2 - Verify conflicts and rejections.

**Status:** complete

- [x] Build one canonical `alphonse.correlation-projector-input.v0.2` document containing only fully verified
      registration scope, cutoff, intake outcomes, observations, receipts, schemas, token provenance, conflicts, and
      rejections; record its digest in the semantic projection and immutable projection record.
- [x] Replace the single-file projector hash with a deterministic transitive artifact manifest covering the exact
      source, canonicalization, coverage, integrity, token-proof, SQL-loader, lockfile, and migration material used by
      the running projection path.
- [x] Mechanically verify that the manifest contains the complete local module closure of the projection entrypoints.
- [x] Bump projector, registration, input, and projection versions. Keep relationship-rule identity unchanged unless
      relationship semantics actually change.
- [x] Keep v0.1 registrations/projections readable and immutable while refusing to produce new projections through a
      registration whose artifact/input/projection identities differ from the running v0.2 implementation.
- [x] Verify an existing projection's semantic and record digests before comparing it with current material.
- [x] Distinguish existing-record corruption, verified-input history divergence, artifact mismatch, unavailable
      material, and true nondeterminism. True nondeterminism requires the same exact input and artifact identities.
