# Require Effect Interpretation Before Behavior Evaluation

Diagnostic effect interpretation is an explicit immutable pipeline stage between correlation and behavior
evaluation. It binds an exact Correlation Projection, relevant request, response, state, and designated-feed
receipts, Integration Behavior Contracts, interpreter artifact and rules, source coverage, and cutoff. Its normalized
effects include operation, destination, logical operation, effect identity, request and resource references, status,
commitment basis, supporting receipts, and limitations.

Direct `destination.effect` observations remain authenticated external claims and must pass through the interpreter.
Every result is classified `diagnostic_derived_external_effect` with `authority: none`; it is neither a governed
Kernel Effect nor execution or authorization proof. New contracts, interpreter versions, or material late state may
create new immutable revisions without changing prior evaluations.

The bounded evaluator receives only the exact Diagnostic Effect Projection, Behavior Contract, and evaluator
artifact and rules. It counts only committed effects whose operation, destination, correlation role, and commitment
basis match the contract. It has no path to raw HTTP status, request artifacts, feed claims, snapshots, or arbitrary
details. Test lineage is receipts to correlation projection to diagnostic effect projection to violated evaluation
to trigger, package, and unclaimed assignment.
