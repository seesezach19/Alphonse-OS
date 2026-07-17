# Use One Observation Per Intake Request

V1 canonical intake accepts one authenticated Principal and Reporting Grant, one signed Diagnostic Observation
Envelope, zero or one bounded detail artifact, and one stream sequence per request. Each request produces one
independent database transaction and one accepted receipt, exact replay, rejection, or conflict. New acceptance
returns 201, exact replay 200, conflicts 409, invalid material 400 or 422, authentication or grant failures 401 or
403, oversize detail 413, and transient pressure or availability failures 429 or 503.

The response binds resulting identity, canonical envelope digest, verified artifact digest, grant and stream,
sequence, status, and authoritative receipt time. A reporter marks its journal entry reported only after validating
that response. Reporters may pipeline a bounded number of requests; journal sequence remains authoritative and
network completion order may temporarily create and later fill stream gaps without cross-request rollback.

When detail exists, its expected digest and media type are signed and its bytes travel with the initial request,
are streamed and independently digested, and commit CAS-first. Exact replay need not resend bytes. Multiple logical
files become one bounded redacted canonical artifact or manifest. Future batching may optimize transport only if
every item retains independent signatures, replay, conflict, receipt, transaction, and explicit partial-result
semantics.
