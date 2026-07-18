# Diagnostic Material Availability And Erasure

Ticket 14 preserves immutable diagnostic history while allowing an authenticated Owner to revoke and remove sensitive
artifact bytes. The authority boundary is deliberately narrow: the decision controls material availability in this
Diagnostic Plane; it does not rewrite historical receipts, packages, diagnoses, or external copies.

## State And Ordering

1. The request validates the artifact class, active pins, retention holds, affected packages, and assignments under the
   installation-local material mutation fence.
2. The committed decision immediately changes the artifact to `revoked_pending_deletion`, projects affected packages as
   `partially_unavailable` or `material_unavailable`, and invalidates affected assignments.
3. Reads and writes of that digest fail closed even while the physical bytes still exist.
4. A separate idempotent completion removes the local CAS object, verifies absence, records a deletion attempt, and
   advances the state to `deleted_verified` with an immutable tombstone.

If the process stops before step 4, access remains revoked and completion can resume. If bytes disappear after the
decision but before the database transaction completes, retry records `already_absent` and seals the same explicit
local-absence result. A failed deletion leaves access revoked and records an unverified attempt for later retry.

## Retention And Legal Holds

Package pins and active case, diagnosis, review, audit, or worker-run holds require exact named overrides. The command
cannot supply unknown or duplicate override classes. An active legal hold always rejects erasure; it is not another
override token.

## Availability And Authority

Package material availability is a temporal projection separate from immutable package identity:

- `complete` means every currently selected artifact is present and digest-verified.
- `partially_unavailable` means non-root selected or verification material was governedly erased.
- `material_unavailable` means the package artifact itself was governedly erased.
- Missing or corrupt bytes without a governed decision produce `integrity_violation`, not a synthetic tombstone.

Unavailable packages cannot create new revisions, assignments, independent verification bundles, dispatch authority,
or later claim authority. Unclaimed assignments expire in the revocation transaction. Claimed assignments are
cancelled with explicit workspace-destruction and broker-token-revocation requirements; Tickets 15–16 must execute and
attest those worker-side obligations.

## What The Tombstone Proves

The tombstone binds the decision, policy, impact manifest, artifact digest, deletion attempt, retained metadata, and
verified absence from `local_primary_cas`. It explicitly leaves backups, unregistered replicas, and prior model or
provider disclosures unverified. `universal_deletion_established` is always false.

Run the fresh-volume adversarial proof with:

```powershell
npm run test:canonical-proof:ticket-14
```
