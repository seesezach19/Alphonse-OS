# Diagnostic Worker execution boundary

Ticket 16 advances one claimed Diagnostic Worker Run through `launching`, `running`, and
`completed` without giving the Worker Kernel, Diagnostic Plane, database, Docker, host, or
provider credentials.

The Diagnostic Plane rechecks material availability, reads the exact content-addressed Evidence
Package, and issues a signed five-minute Model Broker Grant. The grant binds one Worker Run, one
Assignment and package, one input and output schema digest, one model configuration, one Broker
audience, one request, byte budgets, runtime limits, data classification, and denied business-effect
authority. Grant consumption is recorded with an exclusive-create marker in Broker-owned durable
state before the provider adapter runs, so a crash cannot make the grant reusable.

Docker authority stays in the trusted host runner. Kernel and the Diagnostic Plane do not mount a
Docker socket. The runner creates a fresh non-root container with a read-only root, all capabilities
dropped, `no-new-privileges`, exact memory/CPU/PID limits, an exact read-only `/input`, bounded tmpfs
for `/output`, `/tmp`, and `HOME`, and an internal bridge containing only the Worker and Model
Broker. The Worker receives only the signed Broker Grant and Broker URL. It cannot route to general
DNS, internet, LAN, cloud metadata, Kernel, Diagnostic Plane, or a database.

The Worker writes only `/output/diagnosis.json` and waits. The runner injects a scanner from the
same pinned read-only image, recursively uses `lstat` without following links, and returns bytes only
when the complete output tree is one bounded regular file. It then acknowledges collection through
tmpfs and observes a clean, non-OOM exit. This handshake is necessary because Docker intentionally
excludes tmpfs mounts from `docker cp` and unmounts them at process exit. The Diagnostic Plane does
not ingest until it has the signed exit attestation.

Completion verifies the exact start/final container identity, image digest, security configuration,
mount and resource policy, internal-network membership, output scan and raw digest, signed Broker
Receipt, one-request budget, model/configuration binding, closed diagnosis schema, and every cited
claim ID against the frozen package. It stores immutable launch, start, completion, Broker Receipt,
diagnosis, and provenance records before advancing the Worker Run to `completed`.

## Assurance limits

- The reference provider is a deterministic synthetic provider used to prove the execution and
  ingestion boundary. It is not evidence of frontier-model diagnostic quality.
- HMAC signatures establish integrity among components sharing the configured customer-local
  secrets; they do not establish independent third-party authorship.
- Docker inspection and runner attestations assume the trusted Docker host and runner signing key
  are not compromised. This design does not claim containment against a hostile host administrator.
- Provider credentials are injected only into the Broker container in the reference run. Production
  deployments should source them from a Broker-specific secret store rather than command history.
- A completed diagnosis is an authority-free proposal. It does not establish external failure truth,
  authorize repair, or permit a business effect.
