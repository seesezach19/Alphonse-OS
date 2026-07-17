# Freeze Diagnostic Evidence On Completion Or Durable Deadline

A deterministically triggered Diagnostic Case enters `collecting_evidence` and freezes its first evidence
package when policy-defined required roles and stream coverage complete or when a durable deadline derived from
the trigger's first-party receipt time expires. Freeze captures one transactionally consistent Diagnostic Plane
ingestion cutoff and records `required_sources_complete` or `collection_deadline`; deadline packages explicitly
preserve missing roles and partial coverage. Late observations never mutate packages, projections, assignments,
or diagnoses. Policy-defined material changes may create a new package revision and reevaluation path, while
identical deterministic package content produces no revision.
