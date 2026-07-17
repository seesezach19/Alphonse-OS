# Drive Projections From Signed Typed Observation Claims

Deterministic diagnostic projections consume only schema-validated typed claims carried in signed Diagnostic
Observation Envelopes. Sensitive or provider-specific detail is normalized and redacted adapter-side, stored
as a separately content-addressed artifact, and reserved for investigation rather than projection parsing.
The authentication preimage binds a domain separator, Principal, Reporting Grant, key, signing time, and
canonical envelope; the Diagnostic Plane independently computes envelope, artifact, and complete receipt
digests plus authoritative receipt time. Claimed occurrence, observation, and signing times remain distinct
from first-party receipt time. This prevents arbitrary artifact extraction from becoming hidden operational
logic while preserving investigative depth.
