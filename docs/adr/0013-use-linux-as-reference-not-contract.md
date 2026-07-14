---
status: accepted
---

# Use Linux as the reference execution substrate, not the contract

Linux is the initial Execution Substrate because its containers, namespaces, cgroups, seccomp controls, filesystem observations, process attribution, service supervision, and mounts provide the required implementation primitives. Kernel Protocol and package contracts remain OS-neutral so Windows and macOS can participate through adapters, virtualized Linux, or future native substrates without changing business semantics.
