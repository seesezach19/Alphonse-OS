---
status: accepted
---

# Use one self-describing Kernel Protocol

Alphonse exposes one canonical, progressively discoverable protocol for inspecting objects, learning allowed transitions, proposing changes, validating, simulating, submitting, and observing results. MCP, CLI, SDK, and HTTP are adapters over this protocol, preventing transport-specific behavior and giving agents structured errors and correction paths without direct database access.
