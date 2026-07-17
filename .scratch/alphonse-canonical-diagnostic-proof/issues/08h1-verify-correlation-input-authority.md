# 08H1 - Verify correlation input authority

**What to build:** Make every correlation input either derived from authenticated canonical material or rejected as
an integrity violation. Denormalized database columns remain indexes and consistency checks, never alternate
semantic authority.

**Blocked by:** 08 - Project one operation across all observer streams.

**Status:** complete

- [x] Decode the preserved envelope bytes without replacement, validate the exact envelope schema, require canonical
      bytes, recompute the envelope digest, and require the JSONB envelope to match those bytes.
- [x] Derive observation type, installation/environment, principal, grant, key, stream, sequence, workflow,
      integration, schema, detail binding, claims, limitations, and dependency IDs from the verified envelope.
- [x] Verify every duplicated receipt row and immutable Diagnostic Observation Receipt field against the envelope,
      committed intake outcome, receipt time, authority flags, grant snapshot, and transition binding.
- [x] Verify schema activation installation/environment, observation type, and exact signed schema tuple. Exclude
      unbound convenience fields from semantic manifests rather than treating them as provenance.
- [x] Require the signed envelope dependency IDs and preserved dependency join to be one exact duplicate-free set.
- [x] Reverify every signed Tokenization Result Receipt, Grant Activation Snapshot, and Grant Application Receipt;
      require exact dependency digests and row/document bindings; derive equality-token inputs only from signed bytes.
- [x] Preserve the observer-HMAC boundary: correlation trusts the immutable Diagnostic Plane acceptance receipt and
      does not gain observer signing secrets or re-evaluate historical freshness.
- [x] Fail before projection persistence or nondeterminism recording on any accepted-receipt or provenance mismatch.
