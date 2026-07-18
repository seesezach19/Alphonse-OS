# 15 - Authorize and atomically claim one diagnostic assignment

**What to build:** Let Kernel authorize one exact eligible worker and runtime proposal, then atomically bind that
authority to the unclaimed Diagnostic Assignment and one Worker Run without launching untrusted code yet.

**Blocked by:** 12 - Create the model-free unclaimed diagnostic assignment; 14 - Erase evidence and enforce material
availability.

**Status:** complete

- [x] Accept a dispatch candidate binding assignment and package digests, worker Principal and Passport, Worker Run,
      image, isolation, mount, network, model, broker, resources, classification, egress, and expiry.
- [x] Have Kernel verify assignment state and expiry, exact digests, active Passport scope, zero external-effect
      authority, runner controls, data and model policy, resource ceilings, and evidence availability.
- [x] Issue one short-lived, audience-bound, single-use Diagnostic Dispatch Authorization containing an unguessable
      nonce and every authorized runtime boundary.
- [x] Keep Kernel authority state limited to Diagnostic Plane identifiers and digests rather than evidence bytes.
- [x] Atomically consume authorization, transition assignment `unclaimed -> claimed`, and create the exact Worker Run
      record through the Diagnostic Plane claim endpoint.
- [x] Permit only one competing claimant and make stale, replayed, expired, mismatched, or already-consumed authority
      fail before any launch or broker access.
- [x] Require a new immutable assignment and authority decision for retry rather than returning work to `unclaimed`.
- [x] Confirm this checkpoint creates no container, model-broker token, provider request, or diagnosis.

Acceptance: `npm run test:canonical-proof:ticket-15` passes on fresh Docker volumes, including the material-fence race,
two otherwise-valid competing authorizations, exactly one immutable consumption and Worker Run, stale and tampered
authority denial, idempotent command replay, immutable records, and zero launch/model/broker/diagnosis effects.
