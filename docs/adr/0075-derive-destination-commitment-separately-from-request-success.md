# Derive Destination Commitment Separately From Request Success

Request observers report transport and response facts but cannot claim destination commitment. State observers
report scoped resources, snapshots, audit data, freshness, consistency, and coverage. A deterministic
contract-bound interpreter derives immutable Diagnostic Effect Projections with explicit `committed`,
`not_committed`, `ambiguous`, or `unknown` status and commitment basis. Direct `destination.effect` intake is
limited to grants bound to a contract-designated append-only commit or audit feed with stable event identity;
generic HTTP success is acknowledgement only. Behavior evaluators count only committed projections using bases
their exact contract permits, and these diagnostic projections remain distinct from governed Effect Records.
