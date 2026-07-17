# Canonicalize Legacy Runtime Events At The API Boundary

The legacy runtime-event endpoint remains a compatibility facade. It verifies the legacy envelope and HMAC,
applies a pinned deterministic compatibility translation, submits a canonical `runtime.execution` observation,
and returns the legacy response shape. Legacy and native observation protocols therefore share grants, receipts,
sequencing, conflicts, CAS, transitions, projections, packaging, retention, and provenance.

Translation may expose only claims directly signed in the legacy envelope or present in independently verified
detail committed by its digest. Missing observation time, provider version, normalized workflow digest, or
attestation basis remains an explicit limitation. Every canonical receipt preserves the original envelope and
authentication digests, endpoint and protocol version, translator artifact and rules digests, translated-claims
digest, and limitations.

Legacy trace reads become compatibility projections over canonical receipts. Historical migration preserves
original identity and receipt time, records migration provenance, and verifies view equivalence. During cutover,
one stream uses one protocol unless both protocols canonicalize to the same replay identity; otherwise a new
stream declares its predecessor. Compatibility exists at the API boundary, not as a second evidence authority.
