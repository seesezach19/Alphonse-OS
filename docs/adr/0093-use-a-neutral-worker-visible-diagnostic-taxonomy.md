# Use A Neutral Worker-Visible Diagnostic Taxonomy

The worker-visible output schema uses one reusable Diagnostic Mechanism Taxonomy with multiple valid mechanism
categories, observed and required scopes, evidence statuses, and implementation-location states. It cannot contain
single-value enums, fixture-specific descriptions, or an expected structured tuple. The exact expected mechanism for
an acceptance case exists only in the preregistered hidden verifier rubric.

Leakage validation covers every worker-visible byte, including instructions, schemas, policy labels, IDs, filenames,
mount manifests, and descriptions. Validation is structural as well as textual: schema cardinality, defaults,
examples, conditional branches, and required fields must not narrow the worker to the hidden answer. Free prose may
explain a diagnosis but cannot replace structured fields and exact citations.
