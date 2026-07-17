# Make Evidence Role Completion Contract-Specific

Core defines no universal required-observation list. An exact deployed Evidence Selection Policy references the
Behavior Contract, Integration Behavior Contract, bounded evaluator, acceptable commitment bases, required roles,
role-completion predicates, source coverage, and optional corroboration. Cardinality is relational where possible:
every matched effect must have its required request, execution, and delivery ancestors rather than encoding a
platform-wide count of two.

The duplicate-delivery proof requires distinct source deliveries for one logical operation, terminal runtime
executions, destination requests, designated append-only ledger commit observations, explicit correlation paths,
and adequate contributing-stream coverage. Because the mock CRM Integration Behavior Contract designates its
ledger as a commit feed, a destination snapshot is optional corroboration. Its absence neither delays freeze nor
degrades completeness, and a late snapshot creates a revision only if it contradicts the feed or materially changes
interpretation.

Ambiguous-write policies instead require contract-approved reconciliation evidence observed after the uncertain
request with exact query scope, correlation, consistency window, freshness, pagination, and completeness semantics.
Without it the effect remains ambiguous and deadline packaging reports the missing role. This minimizes latency and
disclosure while preserving the evidence each invariant actually needs.
