# Define The Agent-Native Kernel Protocol

Type: prototype
Status: resolved
Blocked by: 02

## Question

What canonical resources, discovery operations, proposal flow, validation responses, simulations, submissions, and observations let replaceable agents build and operate naturally without direct database access or transport-specific semantics?

Prototype asset: [Agent-Native Kernel Protocol](../prototypes/agent-native-kernel-protocol.md)

## Answer

Kernel Protocol consists of a small bootstrap interface over self-describing versioned resources and Operation Descriptors. Agents progressively discover authorized functionality, receive bounded task-specific typed tool projections, inspect exact schemas and preconditions, validate or simulate without gaining authority, submit idempotent typed transitions, correct structured issues, and observe cursor-based immutable events.

Typed proposals embed shared Proposal Metadata rather than entering a generic payload lifecycle. Simulation distinguishes reproducible deterministic runs from authorized observational live reads. Event storage permanently minimizes secrets and unnecessary data, while reader-specific projections preserve scoped visibility. MCP, HTTP, CLI, and SDK adapters must preserve canonical operation IDs, references, receipts, outcomes, and authority semantics.

Prototype: [Agent-Native Kernel Protocol](../prototypes/agent-native-kernel-protocol.md)
