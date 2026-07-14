# Define Host Observation And Execution Substrate Adapter

Type: prototype
Status: resolved
Claimed by: Codex
Blocked by: 05

## Question

What signed host observations, process identity, container boundaries, effect-dispatch hooks, heartbeats, resource limits, cancellation checkpoints, and failure signals must a Linux reference substrate expose to Kernel without turning low-level telemetry into business truth?

Prototype asset: [Host Observation And Execution Substrate Adapter](../prototypes/host-observation-and-execution-substrate-adapter.md)

## Answer

The Linux reference substrate is a replaceable enforcement and observation layer. Kernel issues short-lived Workload Grants; the substrate creates exact Workload Instances inside rootless constrained containers, enforces resource/network/filesystem/credential bounds, renews leases, fences stale epochs, and emits signed chained host observations.

Every external effect passes through a one-use Kernel Dispatch Permit and trusted adapter. Host telemetry, process exit, and signed observations remain operational facts rather than business truth. Cancellation, host loss, dispatch uncertainty, and compromise feed existing Run, Effect, evidence, obligation, and recovery lifecycles.

Prototype: [Host Observation And Execution Substrate Adapter](../prototypes/host-observation-and-execution-substrate-adapter.md)
