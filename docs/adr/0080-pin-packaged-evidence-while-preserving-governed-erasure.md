# Pin Packaged Evidence While Preserving Governed Erasure

Package freeze verifies every selected claims and permitted detail artifact, transactionally creates reference-based
Artifact Retention Pins with exact policies and expiry, and only then accepts the immutable package. Ordinary
diagnostic material may use short configurable retention; selected material remains pinned through applicable case,
diagnosis, review, audit, and legal-hold periods. Garbage collection marks candidates, rechecks pins, deletes bytes,
and records tombstones so it cannot race package creation.

An authenticated Owner decision may override only the retention classes named by the command. Active legal holds are
not overrideable. Committing the decision immediately revokes reads, writes, package eligibility, and new downstream
authority; physical deletion of the local primary CAS is a separate idempotent follow-up. That ordering makes a crash
before deletion safe and a crash after byte loss recoverable as `already_absent` without pretending the decision never
happened.

Erasure does not rewrite receipts or package manifests. It creates immutable decision, impact, deletion-attempt, and
tombstone documents. A separate Evidence Material Availability Projection reports complete, partially unavailable, or
material unavailable. Historical packages and diagnoses retain their identity, while current reproducibility and
execution eligibility degrade visibly. Missing bytes without a governed decision are an integrity violation, not an
erasure tombstone.

Package freeze, revision, assignment creation, independent verification, dispatch, and claim use the same
installation-local material mutation fence and fail closed on unavailable material. Required erasure expires unclaimed
assignments. A claimed assignment is cancelled with explicit `workspace_destruction_required` and
`broker_revocation_required` obligations; Tickets 15–16 own the worker-side completion attestations.

The tombstone verifies absence only from the named local primary CAS. Backups, unregistered replicas, and bytes already
disclosed to a model or other provider remain `not_verified` or `not_established`; universal deletion is always false.
Typed claims remain minimal, and low-entropy sensitive identifiers never use unsalted bare hashes; propagated opaque
IDs, scoped tokenization, or encrypted artifacts are required instead.
