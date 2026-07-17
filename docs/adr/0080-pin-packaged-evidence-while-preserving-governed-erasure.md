# Pin Packaged Evidence While Preserving Governed Erasure

Package freeze verifies every selected claims and permitted detail artifact, transactionally creates reference-based
Artifact Retention Pins with exact policies and expiry, and only then accepts the immutable package. Ordinary
diagnostic material may use short configurable retention; selected material remains pinned through applicable case,
diagnosis, review, audit, and legal-hold periods. Garbage collection marks candidates, rechecks pins, deletes bytes,
and records tombstones so it cannot race package creation.

Authorized security, privacy, or legal erasure may override pins. It removes bytes without rewriting receipts or
package manifests and creates an immutable Diagnostic Artifact Tombstone containing decision and deletion provenance,
affected packages, verification status, and known replica or provider limitations. A separate Evidence Material
Availability Projection then reports complete, partially unavailable, or material unavailable. Historical diagnoses
remain bound to their original package, while reproducibility degrades visibly.

Dispatch rechecks material availability. Required erasure expires unclaimed assignments, may cancel active runs,
destroys ephemeral workspaces, revokes broker tokens, and preserves cancellation provenance. Provider-side deletion
limits are stated honestly. Typed claims remain minimal, and low-entropy sensitive identifiers never use unsalted
bare hashes; propagated opaque IDs, scoped tokenization, or encrypted artifacts are required instead.
