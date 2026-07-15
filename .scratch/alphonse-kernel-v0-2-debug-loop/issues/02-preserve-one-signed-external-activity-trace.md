# 02 - Preserve One Signed External Activity Trace

**What to build:** A Workflow Runtime Adapter submits one authenticated Runtime Event Envelope for an external execution, and Alphonse preserves an exact External Activity Trace without claiming that Kernel admitted or governed the work.

**Blocked by:** 01 - Register and Inspect One External Agent Workflow.

**Status:** implemented

- [x] A provider-neutral Workflow Runtime Adapter contract describes workflow identity, revision identity, event receipt, optional detail retrieval, supported replay, and health.
- [x] One timestamped HMAC-SHA256 Runtime Event Envelope binds adapter, workflow, revision, external execution, event identity, sequence, lifecycle claim, correlation, idempotency, timestamp, and payload digest or reference.
- [x] Signature verification uses canonical body bytes, a bounded timestamp window, exact key binding, and replay protection.
- [x] One valid succeeded claim creates an immutable receipt and External Activity Trace through public HTTP and CLI operations.
- [x] An identical retry returns the original receipt without changing revision, trace count, or transition history.
- [x] Conflicting reuse of event identity, sequence, or idempotency key is rejected and preserved as a structured conflict.
- [x] Delayed and out-of-order claims remain append-only and produce an honest current projection.
- [x] HTTP acceptance remains distinct from external workflow completion.
- [x] Routine envelopes contain no full business payload or provider credential.
- [x] Every interface states that the trace is not a Kernel Run, Execution Envelope, or trusted effect evidence.
- [x] Adapter conformance checks prove the contract without n8n-specific fields in core schemas.
