# Host Observation And Execution Substrate Adapter

Status: rough HITL prototype

## Claim

A Linux execution substrate can run replaceable agents and adapters under exact identity, containment, resource, credential, lease, cancellation, and effect-dispatch bounds while exposing signed host facts without turning process telemetry into business truth.

## Responsibility Boundary

### Kernel Decides

- Principal, Passport, Delegation, and Work Intent
- exact Capability authority
- Envelope and Run admission
- effect type, target, limits, and idempotency
- context and credential references
- evidence and recovery obligations
- lifecycle and accountability state

### Substrate Enforces

- exact process/workload identity
- container/process containment
- filesystem, network, resource, and time bounds
- ephemeral credential delivery
- execution leases and Environment fencing
- effect-dispatch gate path
- cancellation and cleanup
- signed host observations

Host observation proves what an attributed substrate observed. It does not prove business outcome. Adapter verification and Evidence Records establish operational meaning.

## Execution Substrate Adapter

Versioned adapter contract exposes:

- prepare_workload
- start_workload
- renew_lease
- observe_workload
- request_effect_gate
- signal_cancel
- collect_exit
- collect_evidence
- destroy_workload

Every Run binds exact adapter identity/version and workload digest.

Docker or Podman on Linux is reference V1. systemd, Kubernetes, ECS, local processes, and other runtimes may implement the same contract later. Kernel does not depend directly on one container engine.

## Workload Grant

Kernel issues a short-lived signed Workload Grant binding:

- Installation and Environment
- current execution epoch
- Envelope and Run
- Passport and Delegation
- Deployment and Capability versions
- workload/image digest
- substrate adapter identity
- resource, network, filesystem, and evidence policy
- credential reference scopes
- issue time, expiry, and nonce

Grant authorizes one bounded workload launch. It does not authorize external Effects.

## Workload Instance Identity

Substrate assigns immutable identity from:

- Workload Grant
- container/process namespace
- cgroup
- host boot identity
- adapter identity
- start time and nonce

PID alone is never identity. Child processes remain inside the constrained workload tree.

Effect requests must prove both valid Workload Grant and currently live Workload Instance.

One Run may use sequential Workload Instances only when resuming from a declared checkpoint and no Effect is uncertain.

## Substrate Descriptor

Each registered host publishes a signed descriptor containing:

- host and adapter identity/version
- Linux/kernel and container runtime
- supported isolation features
- signing-key trust tier
- cgroup/resource capacity
- network, credential, and evidence capabilities
- clock health
- patch/advisory status
- current Environment execution epoch

Deployment declares minimum substrate requirements. Scheduler places workloads only on compatible healthy hosts.

Host quarantine blocks new placement and fences active workloads under policy. Capacity/health are operational observations, not business state.

## Linux Containment Baseline

V1 workload uses:

- rootless container
- non-root user
- read-only root filesystem
- temporary scratch storage
- only declared mounts
- no container-engine socket
- dropped Linux capabilities
- seccomp and AppArmor/SELinux where available
- cgroup CPU, memory, process, and I/O controls
- default-deny network with declared destinations
- no inbound listener unless Capability explicitly requires it
- ephemeral credential delivery
- no undeclared persistence

Public untrusted executable Packages are out of scope. Stronger VM or microVM isolation may be added later.

## Resource Policy

Package declares requested ranges. Deployment Policy sets maximums. Workload Grant receives exact:

- CPU and memory
- process count
- scratch/storage
- I/O and network bytes
- allowed destinations
- wall-clock/runtime
- evidence/log volume
- cost ceiling where measurable

Substrate deterministically throttles, denies, or terminates under policy.

Runtime may request extension. Kernel may grant only within preapproved Deployment and Envelope bounds. Larger expansion requires new authority or admission.

Resource exhaustion is a host fact, not proof the business workflow failed.

## Leases, Heartbeats, And Fencing

Workload receives short renewable lease binding:

- Environment execution epoch
- Run and Workload Instance
- adapter/host
- issue time and expiry
- monotonic sequence

Missing heartbeat marks workload unknown, not failed. Expired lease blocks new effect dispatch immediately.

Workload may finish local computation briefly, then receives graceful cancellation and forced termination.

Network partition may buffer signed observations locally but cannot authorize Effects. Advancing Environment epoch fences every old workload.

## Effect Dispatch Hook

Workload cannot directly reach effect targets.

Flow:

1. Workload submits canonical Effect Request.
2. Substrate binds digest to live Workload Instance and lease.
3. Kernel revalidates authority, limits, freshness, credentials, obligations, cancellation, and idempotency.
4. Kernel creates admitted Effect Record and issues short-lived single-use Dispatch Permit.
5. Credential broker delivers only required scoped credential to trusted effect adapter.
6. Effect adapter dispatches exact request.
7. Substrate records attempt and response observations.
8. Separate verification determines business outcome.

Dispatch Permit binds target, operation, request digest, idempotency key, adapter, Workload Instance, and expiry.

Timeout after dispatch produces uncertainty. It never triggers blind retry.

## Credential Boundary

- Workload receives references/tokens, not standing credentials.
- Broker resolves exact binding only after current grant/permit validation.
- Credential material is scoped, ephemeral, non-persistent, and revoked during cancellation/cleanup.
- Effect adapter receives only credential needed for exact target operation.
- Secrets never enter Kernel ledger, host observations, or ordinary logs.

## Cancellation

Cancellation has two layers:

- cooperative token/checkpoints for orderly runtime exit
- substrate enforcement through graceful signal, deadline, then forced termination

Sequence:

1. Kernel records request and reason.
2. New Effect permits stop.
3. Runtime reaches checkpoint and emits final evidence where possible.
4. Substrate revokes credentials/network.
5. Grace deadline expires and workload is killed.
6. Cleanup observation closes containment.

Cancellation is not rollback. If dispatch may have occurred, Effect becomes uncertain and enters reconciliation.

## Signed Host Observations

Observation envelope binds:

- Environment, host, adapter, and signing key
- execution epoch
- Workload Instance, Run, and optional Effect
- monotonic sequence
- wall and monotonic timestamps
- typed observation and payload digest
- previous observation digest
- signature

Core observation types:

- prepared and started
- heartbeat
- resource/network policy violation
- effect gate requested/received
- cancellation signal
- process exit
- evidence artifact capture
- credential revoke
- cleanup completion

No secrets or business payloads by default.

Signature proves attributed observation, not uncompromised host truth. Trust tier records software-, KMS-, or hardware-backed keys.

## Logs And Evidence

- stdout/stderr are bounded untrusted telemetry
- structured Evidence submissions use declared schemas
- substrate hashes/timestamps captured artifacts
- adapter/business verification supplies outcome meaning
- host observation proves capture, not truth
- sensitive patterns trigger redaction/quarantine
- raw logs remain outside Kernel
- Kernel stores typed references/digests
- evidence/log limits prevent runaway storage
- agent assertions alone cannot satisfy objective evidence obligations

## Failure Signals

Typed host signals:

- preparation/start failure
- process crash
- out-of-memory/resource limit
- execution timeout
- policy violation
- lease loss
- host loss
- operator cancellation
- evidence capture failure
- cleanup failure
- adapter failure
- dispatch uncertainty

Exit code alone never establishes business success/failure.

Host loss before dispatch may resume from checkpoint. Host loss after possible dispatch makes Effect and Run uncertain. Recovery follows the existing corrective Work Intent, new Envelope, new Run path.

## Topology

Same substrate protocol supports:

- local Linux or WSL development
- customer AWS Linux host
- managed single-tenant host
- future multi-host cluster

Reference V1 uses one Linux host daemon plus rootless container runtime.

Local transport may use Unix socket. Remote transport uses mutually authenticated outbound connection. Transport location does not alter authority.

V1 scheduling selects one registered compatible host. Cluster orchestration is later scope.

## Compromised Host Boundary

V1 assumes customer host administrator and Linux kernel are trusted.

Substrate cannot mint Workload Grants or Dispatch Permits. Root compromise can still falsify observations or bypass local containment; signatures do not remove this risk.

Compromise response:

- quarantine host identity
- rotate/revoke substrate signing key
- advance execution epoch
- fence workloads
- mark affected Effects/evidence uncertain
- open reconciliation/recovery
- preserve existing observations

Higher assurance may add TPM attestation, microVMs, external egress/effect proxy, and customer KMS.

## Required Invariants

1. Workload identity is more than PID.
2. Workload Grant never authorizes external Effects.
3. Effect target is unreachable outside trusted dispatch path.
4. Expired lease or old epoch cannot dispatch.
5. Credential material never enters Kernel or ordinary telemetry.
6. Host observation never becomes business truth by itself.
7. Exit code never equals operational success.
8. Cancellation never implies rollback.
9. Possible dispatch creates uncertainty, not blind retry.
10. Runtime cannot increase resource/egress bounds itself.
11. Host compromise is disclosed and triggers reconciliation.
12. Kernel remains independent of container engine and host topology.

## First-Proof Checks

The inventory workflow must demonstrate:

1. exact Workload Grant and Instance identity
2. rootless constrained container launch
3. blocked undeclared filesystem/network access
4. resource limit enforcement
5. expired lease blocking Effect
6. old epoch fencing restored worker
7. credential unavailable before Dispatch Permit
8. exact one-use effect dispatch
9. timeout after dispatch producing uncertainty
10. checkpoint resume only before uncertain Effect
11. graceful then forced cancellation
12. signed observation gap detection
13. structured Evidence separate from logs
14. continued Kernel truth after host loss

## Prototype Outcome

The Linux reference substrate is a replaceable enforcement and observation layer. Kernel issues exact workload identity and authority bounds; rootless containers enforce host constraints; leases and epochs fence stale workers; every external effect passes through a one-use Kernel gate; and signed observations describe host facts without claiming business outcome. Failures map into existing Run, Effect, evidence, obligation, and recovery lifecycles rather than creating a competing truth model.
