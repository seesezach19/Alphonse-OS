# Isolate Diagnostic Workers With Brokered Model Access

Each Diagnostic Worker Run executes as a non-root process in a fresh immutable-image container with read-only
input, bounded output, tmpfs scratch and home, dropped capabilities, no privilege escalation, pinned runtime
policies, resource limits, and no host, repository, credential, Docker, device, or namespace mounts. Network is
denied except to a Model Broker using a short-lived assignment-bound grant; provider credentials and Kernel
access never enter the container. After exit, the dispatcher safely validates the sole expected output before
submitting it under dispatcher authority and preserves exact runtime, mount, policy, resource, log, and output
provenance. This is technically enforced and auditable but does not claim protection from a compromised host or
runtime, which would require later measured or confidential execution.
