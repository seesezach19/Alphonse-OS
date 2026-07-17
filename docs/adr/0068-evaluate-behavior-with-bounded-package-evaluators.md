# Evaluate Behavior With Bounded Package Evaluators

Core does not implement a general policy language. Signed Operational Packages export bounded deterministic
evaluators, beginning with `count_by_correlation`, and activated Behavior Contracts configure only typed
selectors, enums, comparisons, and thresholds. Evaluation binds exact contracts, evaluator and rules digests,
Correlation Projection, cutoff, matched receipt-backed facts, and source coverage, returning `satisfied`,
`violated`, or `indeterminate`. Proven duplicate committed effects may establish violation despite unrelated
gaps, while inadequate required-source coverage can never establish satisfaction. A deterministic violated
result creates a Diagnostic Trigger and opens or updates a case but grants no authority, causal explanation,
repair permission, or contract mutation.
