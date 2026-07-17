# Separate Observation Reporting Authority By Principal And Stream

Observation drivers use separate deterministic Principals, dedicated signing keys, and revocable Observation
Reporting Grants rather than one shared reporting credential. Each grant binds an exact adapter version and
digest to permitted observation types, workflow or integration scope, stream, validity, rate, and payload
limits; single-stream grants are preferred. This preserves meaningful provenance and prevents one observer
from impersonating another source class. Acceptance attests only that an authorized observer reported exact
bytes within scope, never that the external claim is true. V1 may use unique HMAC secrets, while asymmetric
signing remains the preferred destination so Kernel retains only public verification material.
