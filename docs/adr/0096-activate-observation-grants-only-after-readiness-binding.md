# Activate Observation Grants Only After Readiness Binding

Setup follows one auditable authority order: register immutable packages, schemas, contracts, Deployments, observers,
and inactive grants; enter readiness pending; complete provider and retention readiness; create the exact Workflow
Attestation Binding and readiness receipt; publish the desired Observation Grant Activation Snapshot; durably apply
it in Diagnostic Plane; verify the signed Observation Grant Application Receipt; record `active_effective`; seal the
deployment manifest; relinquish orchestrator credentials; then permit stimulus.

Inactive grants reject intake. Readiness failure cannot activate a grant. Every transition uses monotonic authority
sequence and exact predecessor digests so acceptance verifies ordering from records rather than timestamps. Runtime
observations may only confirm or contradict the pre-execution binding and can never create or alter it.

Revocation remains pending until Diagnostic Plane durably applies the signed revocation snapshot. It becomes
effective at that application transaction, after which new intake fails closed. Historically accepted receipts remain
valid under the state effective when they were committed.
