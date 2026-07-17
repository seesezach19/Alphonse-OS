# Deploy Logical Diagnostic Stages Within One Durable Worker

V1 uses a Diagnostic Plane API for intake and reads, one durable Stage Worker for correlation, effect interpretation,
evaluation, triggering, packaging, and assignment creation, and a Diagnostic Scheduler for deadlines, retries,
expiry, and durable wakeups. Kernel authority, customer observers, and dispatcher, runner, and Model Broker remain
separate deployables because authority, credentials, external observation, or untrusted execution make those
boundaries material.

The API never calls pipeline stages synchronously. The shared worker still consumes committed events through inbox
deduplication and publishes successors through transactional outbox. Every output records the Stage Worker Principal
and a Diagnostic Logical Component Author binding component and rules artifacts, Deployment and package, image, and
input digests. Component provenance is deterministic but is not falsely presented as separately enforced identity.

Postgres roles separate API and intake, pipeline worker, scheduler, read-only verifier, and Kernel authority. The
worker may write only diagnostic stage and outbox records and cannot report external observations, activate governed
configuration, issue dispatch authority, launch containers, or access provider credentials. Later, the same image
may run stage allowlists for independent scaling without changing protocols or records. Replicas remain safe through
deterministic identities, inbox deduplication, and transactional outbox behavior.
