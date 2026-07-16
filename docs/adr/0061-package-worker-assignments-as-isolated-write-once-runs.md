# ADR 0061: Package worker assignments as isolated write-once runs

- Status: accepted
- Date: 2026-07-16

## Decision

Each Agency Lab worker assignment receives a generated UUID run directory. The worker package contains a write-once assignment record binding the exact manifest and evidence digest. A controller-only write-once provenance record additionally binds the case definition, fixture, answer key, and worker assignment digests.

Run records describe one packaging event. Later lifecycle changes append distinct records; they do not rewrite the packaged assignment or provenance record.

## Consequences

- Caller-controlled failure identifiers remain metadata and never select directories.
- Concurrent assignments cannot share a run directory.
- Evidence and controller material can be attributed to the exact assignment that exposed them.
- Write-once behavior is enforced by exclusive file creation inside a generated directory. It is not protection against a machine owner deliberately modifying files outside Kernel.
