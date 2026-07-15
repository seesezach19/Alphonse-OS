---
status: accepted
---

# Use Postgres and local content-addressed artifacts

V0.2 runs one PostgreSQL instance with separate Kernel and Diagnostic databases and roles, while a local content-addressed volume stores workflow snapshots, detailed payloads, Reproduction Bundles, patches, and verification artifacts. Retention may remove payload bytes while preserving digest tombstones; storage interfaces remain replaceable, but SQLite, ClickHouse, S3, Kafka, and vector databases are deferred.
