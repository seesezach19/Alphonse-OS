# 01 - Lock the stimulus-only canonical-diagnostics acceptance seam

**What to build:** Create the black-box proof boundary that separates trusted bootstrap, setup orchestration, bounded
stimulus, deterministic platform work, and read-only verification. The first checkpoint should expose the first
missing platform capability without letting a controller manufacture evidence or contact a model.

**Blocked by:** None - can start immediately.

**Status:** completed

- [x] Represent bootstrap, Test Orchestrator, Scenario Stimulus, runtime supervisor, and Acceptance Verifier as
      separately scoped processes with distinct credentials, mounts, and network access.
- [x] Require setup orchestration to register inactive material, wait for readiness, seal a deployment manifest,
      relinquish credentials, and exit before stimulus begins.
- [x] Permit stimulus to send exactly two ingress requests and author no observation, projection, package, assignment,
      worker output, or hidden assertion.
- [x] Give the verifier only role-scoped read APIs and hidden assertions, with no database, evidence-authoring,
      packaging, assignment, dispatch, or model authority.
- [x] State controller-key exclusion as configured enforcement under the trusted-host and trusted-Docker-daemon
      threat model.
- [x] Add an opt-in black-box harness that stops at a named unmet stage and confirms no model request exists.
- [x] Keep the default test suite passing while the opt-in proof remains incomplete.
