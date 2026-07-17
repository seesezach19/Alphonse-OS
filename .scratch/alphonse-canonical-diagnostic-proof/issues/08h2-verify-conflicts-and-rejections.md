# 08H2 - Verify conflicts and rejections

**What to build:** Make every non-accepted intake outcome used by correlation recomputable from a preserved bounded
document, or visibly unavailable when legacy material cannot establish the exact historical document.

**Blocked by:** 08H1 - Verify correlation input authority.

**Status:** complete

- [x] Reconstruct legacy conflict documents from all original hashed fields and require their digest to equal both
      the stored conflict digest and committed outcome digest.
- [x] Reconstruct a legacy rejection only when one exact version-specific candidate uniquely recomputes to the
      committed outcome digest; never normalize malformed historical schema material into a guessed document.
- [x] Add an immutable companion for native bounded conflict/rejection documents without rewriting historical rows.
- [x] Emit versioned conflict documents that bind the accepted conflict ID, scope, authenticated received identity,
      envelope/authentication digests, exact conflict types, accepted receipt IDs, and detection time.
- [x] Emit versioned rejection documents that retain only bounded authentication status, bounded claimed-schema
      classification, raw-body digest/size, reason, and receipt time; never preserve malformed request bodies.
- [x] Enforce the service-level body limit before parsing or inspecting schema material.
- [x] Classify exact legacy material gaps as `CORRELATION_OUTCOME_MATERIAL_UNVERIFIABLE`, not corruption,
      nondeterminism, or a fabricated projection input.
