# Limit V1 HMAC Claims To Authenticated Attribution

V1 uses a unique HMAC key, Principal, Observation Reporting Grant, and stream per observer. Because an HMAC verifier
also possesses signing capability, an accepted receipt cannot prove exclusive observer authorship. It proves only
that Diagnostic Plane intake authenticated the envelope under the expected observer-specific grant and key and that
the accepted bytes are preserved exactly.

Observer keys are provisioned by the trusted one-shot bootstrap launcher outside the in-test Principal model. It
installs one copy in the observer secret mount and one in the Diagnostic Plane verifier store, returning only key
identity and a provisioning receipt. The Test Orchestrator, Scenario Stimulus, Acceptance Verifier, and runtime
supervisor receive no key mount or secret-store authority. Their environment and mount manifests establish configured
exclusion only under the trusted customer-host and Docker-daemon threat model. The proof does not claim the bootstrap
launcher, host, provisioner, or Diagnostic Plane verification-key holder could not forge a report. Exclusive
authorship requires future asymmetric signing or stronger isolated key custody.
