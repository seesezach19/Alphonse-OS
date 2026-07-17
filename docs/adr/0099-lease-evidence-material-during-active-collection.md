# Lease Evidence Material During Active Collection

Deployment readiness calculates
`ordinary_retention_min = pretrigger_observation_horizon + pretrigger_pipeline_retry_horizon + gc_margin` and
`collection_lease_min = collection_window + post_trigger_retry_horizon + gc_margin`. Both retry horizons are the
cumulative maximum scheduling and retry intervals across their applicable stages. Readiness fails when either
configured duration is below its complete sum, even when each interval fits independently. When a Diagnostic Trigger opens a case,
the same transaction creates an Evidence Collection Retention Lease over the proving evaluation inputs and current
correlation-group artifacts. Newly relevant receipts, artifacts, and authenticated provenance dependencies extend the
lease as collection progresses.

The lease is measured from trigger commit and remains valid through deadline processing and maximum stage retry. Package freeze transactionally converts
selected references and their complete authenticated provenance dependency chains into Artifact Retention Pins before
releasing the collection lease. Failed or abandoned collection expires visibly only after its retry horizon. Garbage
collection marks candidates, rechecks ordinary retention, collection leases, package pins, and legal holds under lock,
then deletes and tombstones eligible bytes.
