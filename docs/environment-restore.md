# Local Environment Backup and Restore

The local backup is one authenticated AES-256-GCM bundle containing a PostgreSQL custom dump and every file in the content-addressed artifact directory. The encryption key remains outside the bundle and Kernel database.

## Create a backup

Stop state-changing workload first, then run:

```powershell
$env:KERNEL_BACKUP_KEY = '<32-byte-base64-key>'
$env:KERNEL_ARTIFACT_DIR = '.local/artifacts'
npm run backup:local -- .local/backups/environment.json
```

Artifact filenames use `sha256-<hex>` on Windows. Their manifest identities remain `sha256:<hex>`.

## Restore bytes

Keep PostgreSQL running, stop Kernel and Data Plane, then restore:

```powershell
docker compose stop kernel data-plane
$env:KERNEL_BACKUP_KEY = '<same-key>'
npm run restore:local -- .local/backups/environment.json
docker compose up -d --wait kernel data-plane
```

The restore tool pre-fences the database before Kernel restarts. It advances the execution epoch and leaves authority `restore_suspended`. Submit the bundle manifest and digest to `kernel.environment.restore.begin`; Kernel then materializes the restore session and reconciliation obligations before any authority can resume.

1. Suspends the Environment.
2. Advances the execution epoch, fencing every old Workload Grant.
3. Converts every admitted, dispatching, or uncertain restored Effect into a Recovery Case.
4. Exposes unresolved restore obligations through Butler.
5. Requires read-only target reconciliation, projection rebuild, transition/artifact verification, and explicit resume.

Never retry an ambiguous external Effect during restore. Reconcile target state first; any correction is separate new work with new authority.

## Verification

Run the destructive isolated drill:

```powershell
npm run test:ticket-15
```

The drill retains the external storefront across database restore and proves the original correction is not emitted twice.

## Retention semantics

Kernel records four distinct lifecycle meanings: `typed_tombstone`, `authority_expiration`, `identity_pseudonymization`, and `environment_destruction`. They are not aliases. Full production erasure still requires deletion of database, artifact, backup, and encryption-key custody outside Kernel.
