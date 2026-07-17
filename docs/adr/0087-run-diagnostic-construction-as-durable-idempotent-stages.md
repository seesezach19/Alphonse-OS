# Run Diagnostic Construction As Durable Idempotent Stages

Canonical observation acceptance starts a durable event-driven state machine: observation accepted, correlation
projection created, diagnostic effect projection created, behavior evaluation created, diagnostic trigger created,
evidence collection ready, evidence package frozen, and diagnostic assignment created. Collection readiness comes
from required-source completion or a durable deadline scheduler. No synchronous request or distributed transaction
spans these stages.

Each stage uses one local transaction to deduplicate the input through an inbox, load exact immutable inputs,
compute deterministic output identity and content, insert or verify the immutable result, record transition, and
write the next outbox event. Publication and consumption are at least once. Repeated identity and digest returns the
existing result; repeated identity with different content is a critical visible nondeterminism conflict. New code,
contract, or policy digests create new revisions without rewriting history.

Transitions expose pending, processing, succeeded, retryable failed, or failed transition. Failure records bind
stage, source event, input and code digests, safe error, attempts, timing, retry state, and governed replay eligibility.
Transient failures use bounded backoff; deterministic failures and exhausted retries remain visible rather than
entering an opaque dead-letter queue. Consumers tolerate duplicate and out-of-order events, load canonical inputs,
and receive only references and digests. Read-only verification polls until assignment, visible failed transition,
or deadline and never triggers work through reads.
