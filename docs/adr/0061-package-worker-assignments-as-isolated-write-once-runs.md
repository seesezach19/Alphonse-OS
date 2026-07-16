# ADR 0061: Package worker assignments as isolated write-once runs

- Status: accepted
- Date: 2026-07-16

## Decision

Each Agency Lab worker assignment receives a generated UUID run directory. The worker package contains a write-once assignment record binding the exact worker registration, instruction, manifest, assigned artifact digests, evidence digest, creation time, and expiry. A controller-only write-once provenance record additionally binds the case definition, fixture, answer key, and worker assignment digests.

A diagnosis returns its assignment ID and evidence artifact digest. Scoring reads the original run workspace and verifies the complete assignment, manifest, evidence, and controller provenance chain. Scoring never regenerates an evidence package. Provenance mismatch is unscorable rather than a lower diagnosis-quality score.

Run records describe one packaging event. Later lifecycle changes append distinct records; they do not rewrite the packaged assignment or provenance record.

## Consequences

- Caller-controlled failure identifiers remain metadata and never select directories.
- Concurrent assignments cannot share a run directory.
- Evidence and controller material can be attributed to the exact assignment that exposed them.
- Write-once behavior is enforced by exclusive file creation inside a generated directory. It is not protection against a machine owner deliberately modifying files outside Kernel.
