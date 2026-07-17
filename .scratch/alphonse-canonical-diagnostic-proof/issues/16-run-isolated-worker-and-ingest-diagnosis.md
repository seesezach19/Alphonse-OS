# 16 - Run an isolated worker and ingest one bounded diagnosis

**What to build:** Launch the claimed Worker Run inside a technically enforced container boundary, broker only the
authorized model access, and ingest one schema-valid diagnosis without exposing host credentials or giving the worker
any direct platform write authority.

**Blocked by:** 15 - Authorize and atomically claim one diagnostic assignment.

**Status:** ready-for-agent

- [ ] Launch one fresh non-root container with read-only image, read-only exact input mount, bounded output mount,
      bounded tmpfs, dropped capabilities, no-new-privileges, pinned isolation policy, and resource limits.
- [ ] Mount no host workspace, repository root, user profile, cloud credentials, SSH material, Docker socket, Kernel
      credential, Diagnostic credential, or provider credential.
- [ ] Restrict network access to the Model Broker and deny general DNS, internet, LAN, metadata, Kernel, Diagnostic
      Plane, and database access.
- [ ] Issue a short-lived run-bound broker token enforcing assignment, model, configuration, request, token, time,
      classification, and egress limits while retaining provider credentials outside the worker.
- [ ] Use a neutral multi-value diagnostic taxonomy and worker instructions containing no fixture-specific answer,
      hidden rubric, implementation location, or single-value expected mechanism.
- [ ] After exit, reject links, devices, unexpected files, oversized output, and invalid schema before dispatcher-
      authorized diagnosis submission.
- [ ] Preserve exact run provenance for assignment, package, worker, Passport, image, runtime, policies, mounts,
      network, broker, model limitations, resources, exit, logs, and output digests.
- [ ] Pass Test 2 with a bounded diagnosis identifying delivery-scoped versus logical-operation-scoped idempotency,
      valid citations, unproven implementation location, and zero forbidden effects established by runtime evidence.
