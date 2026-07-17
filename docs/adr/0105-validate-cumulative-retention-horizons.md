# Validate Cumulative Retention Horizons

Retention readiness uses exact cumulative critical-path formulas. Define `pretrigger_observation_horizon` as the
maximum configured delay from earliest relevant external occurrence through required observation receipt, and
`pretrigger_pipeline_retry_horizon` as the sum of maximum retry and scheduling delays through correlation, effect
interpretation, evaluation, and trigger commit. Ordinary retention must be at least their sum plus `gc_margin`.

From trigger commit, Evidence Collection Retention Lease duration must be at least `collection_window` plus the sum
of maximum retry and scheduling delays through collection completion and package freeze plus `gc_margin`. Package
pins replace the lease atomically at freeze. Readiness rejects a policy when each individual interval fits but the
applicable sum does not. Boundary, overflow, configuration-change, and garbage-collection race tests use the same
formula artifact and digest activated for the Deployment.
