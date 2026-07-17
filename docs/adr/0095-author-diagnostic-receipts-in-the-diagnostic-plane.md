# Author Diagnostic Receipts In The Diagnostic Plane

Diagnostic Plane intake verifies envelopes and attached detail, computes canonical envelope, artifact, and receipt
digests, establishes authoritative receipt time and committed intake position, and authors the immutable Diagnostic
Observation Receipt. Kernel does not process observation bytes or compute diagnostic receipts.

Kernel publishes signed immutable Observation Grant Activation Snapshots through a dedicated one-way authority feed.
Diagnostic Plane verifies and stores only the exact active or revoked grant projection required for intake and never
reads the general authority database. Snapshot identity, authority sequence, digest, and freshness are bound into
each receipt. Missing, stale, mismatched, or revoked state fails intake closed. Observer HMAC verification material is
provisioned separately from grant authority and never included in the authority snapshot.
