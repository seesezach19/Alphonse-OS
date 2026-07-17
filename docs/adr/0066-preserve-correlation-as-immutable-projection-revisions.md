# Preserve Correlation As Immutable Projection Revisions

Diagnostic correlation is preserved as immutable deterministic projection revisions over an exact monotonic
ingestion cutoff, accepted receipts, contract and correlation dependencies, and projector artifact. Nodes and
edges are canonically ordered; every relationship cites its claim locations and explicit basis, while ambiguity
remains unresolved. Late observations, corrections, retractions, or contract changes create new revisions.
The semantic projection digest excludes random IDs and creation time so identical inputs and projector code
replay identically; a separate record digest binds creation metadata. A mutable latest pointer or rebuildable
query index may aid navigation but never serves as evidence authority.
