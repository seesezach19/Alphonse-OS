# Alphonse V0.2 Single-Tenant Operator Guide

## Release boundary

This archive installs one customer-controlled Alphonse Node, authenticated live Operations Console, PostgreSQL,
Diagnostic Plane, n8n adapter, and optional reference n8n runtime. It is a single-host design-partner release, not a
hosted service, high-availability system, Kubernetes distribution, enterprise SSO product, or compliance certification.

Alphonse does not redistribute n8n. Compose pulls the pinned upstream image for the customer. n8n remains a separately
operated customer service and the customer-owned system of authority for its workflows, integrations, credentials, and native revision state. Review its
current license before business use: https://docs.n8n.io/sustainable-use-license/

## Prerequisites and verified inputs

- 64-bit Linux host or Docker Desktop Linux containers with at least 4 CPU cores, 8 GB RAM, and 12 GB free disk.
- Docker Engine 26+ and Compose v2; OpenSSL 3+; a POSIX shell or Windows PowerShell.
- Loopback port 3443 free, or set `ALPHONSE_HTTPS_PORT`.
- The release archive, manifest, SHA-256 files, SPDX 2.3 SBOM, in-toto/SLSA provenance, and qualification evidence.

Before extraction, compare the archive digest to the signed delivery channel. After extraction, verify sidecars:

```sh
sha256sum -c alphonse-v0.2.0-manifest.sha256
sha256sum -c alphonse-v0.2.0-sbom.spdx.sha256
sha256sum -c alphonse-v0.2.0-provenance.intoto.sha256
```

The manifest pins every payload byte and base image digest. The provenance binds the archive digest to those source
materials. The SBOM inventories application dependencies and images; it is evidence, not a claim that no future CVE
exists. Re-run the documented vulnerability gates immediately before each deployment.

## One-command install

Linux/macOS:

```sh
./install-local.sh
```

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-local.ps1
```

The installer generates `.env.release` with restrictive permissions, creates a local TLS identity, admits the bounded
Console Operator Passport, builds pinned targets, and waits for health. Re-running it preserves existing credentials,
TLS identity, database volumes, and command receipts. It never uses `local-*` development credentials.

Open `https://localhost:3443` (or the configured port). Verify the certificate fingerprint before trusting it. The
generated certificate is only for loopback qualification; replace `.tls/tls.crt` and `.tls/tls.key` with a
customer-issued identity before any approved network exposure.

Viewer, Operator, and Owner login secrets are in `.env.release`. Viewer reads authoritative projections. Operator can
suspend workers and quarantine workflows under an exact Passport. Only Owner can restore either. The browser receives
none of the Kernel credentials: signed HttpOnly strict-site sessions and the Console server mediate every request.

## Network and secret custody

Only the TLS edge binds a host port, and only to `127.0.0.1`. Kernel, Console, PostgreSQL, n8n, and the adapter expose no
host ports. Internal control and data networks have no external route; only the provider-edge network permits the n8n
boundary to reach customer-approved services. Containers use read-only roots, dropped capabilities, and
`no-new-privileges` where their upstream initialization permits it.

`.env.release` is the runtime secret store for this reference release. Keep it outside release artifacts and backup it
under separate access control. Provider credentials remain at the adapter/n8n edge and never enter the release archive,
Kernel records, Console browser, model prompt, SBOM, provenance, or qualification evidence. The Kernel records a
secret-free binding reference only. Model-provider credentials remain in the selected worker/broker edge.

Host administrators and Docker administrators remain trusted and can bypass application controls. Host firewall,
disk encryption, OS patching, physical security, certificate issuance, and off-host backup custody remain customer
responsibilities.

## Health, capacity, and break glass

Run:

```sh
node scripts/release-operations.js status
```

This reports exact Compose health and filesystem free space. The default disk warning is 10 GiB; override
`ALPHONSE_DISK_WARN_BYTES` only through an approved capacity policy. Route nonzero status, unhealthy containers, backup
failure, certificate expiry, and disk warnings to the design-partner support channel.

To fence new work during an incident:

```sh
ALPHONSE_BREAK_GLASS_CONFIRM=FENCE_NEW_WORK \
ALPHONSE_BREAK_GLASS_REASON="incident reference" \
node scripts/release-operations.js break-glass
```

This stops browser access, n8n, and the adapter while leaving the unexposed Kernel/PostgreSQL evidence boundary available
for an explicit local inspection. It does not reconcile uncertainty or authorize a retry. After an Owner confirms target
state and all legal next operations:

```sh
ALPHONSE_BREAK_GLASS_CONFIRM=RECOVER_AFTER_REVIEW \
ALPHONSE_BREAK_GLASS_REASON="review reference" \
node scripts/release-operations.js recover
```

Both host actions append a restrictive local `operations.log`. Kernel operations remain the source of authority;
the host log is incident evidence, not a parallel authorization ledger.

## Encrypted backup and populated restore

The design-partner target is RPO at most 24 hours and RTO at most 60 minutes. Schedule one encrypted backup at least
daily and before every upgrade or configuration change. Monitor its completion and copy the bundle off-host under an
independent retention policy. The qualification drill measures its actual restore time; the target is not a guarantee
under arbitrary hardware, database size, or incident conditions.

```sh
node scripts/release-backup-restore.js create backups/node.json
node scripts/release-backup-restore.js verify backups/node.json
```

The AES-256-GCM bundle authenticates both Kernel and Diagnostic PostgreSQL dumps plus diagnostic artifacts, n8n adapter
state, and customer-owned reference n8n state. Its manifest binds the exact environment sequence, execution epoch,
record digests, availability metadata, and store bytes. Keep `KERNEL_BACKUP_KEY` separately from copied bundles.

Restore is deliberately fenced:

```sh
node scripts/release-backup-restore.js restore backups/node.json
```

The tool verifies the encrypted manifest before replacing bytes, restores original database ownership, advances the
execution epoch, and starts in `restore_suspended`. An Owner must then invoke, in order:

1. `kernel.environment.restore.begin` with the exact manifest and digest.
2. `kernel.environment.restore.projection_rebuild`.
3. Read-only reconciliation for every ambiguous external effect.
4. `kernel.environment.restore.verify` with every retained artifact digest.
5. `kernel.environment.restore.resume` only after all checks and recovery obligations pass.

Never retry an ambiguous effect during restore. Backup/restore preserves admitted authority records, receipts, artifact
availability, workflow quarantine, and legal next operations; it does not infer current external target state.

## Upgrade and rollback

Compatibility is exact to the release manifest and migration lists. Before upgrade: verify the new archive and sidecars,
record current health, create an encrypted backup, export its manifest digest, and stop at any unresolved Promotion,
Recovery Case, quarantine, revocation, or disk alert. Use the same Compose project name so volumes remain customer-bound.

Migrations are forward-only and idempotent. A failed upgrade remains fenced. Rollback means reinstalling the previously
verified release bytes and restoring the matching pre-upgrade encrypted bundle; it is not a down-migration. Reconcile
the target before retrying anything that might have applied. An uncertain promotion must be reconciled read-only before
rollback or a new apply command.

## Retention and erasure

Retain daily bundles for 30 days by default, weekly bundles for 90 days only if the customer policy permits, and delete
expired bundles plus separately held keys through the customer backup system. Diagnostic metadata is append-only.
Governed erasure first revokes application access and package eligibility, then deletes local bytes idempotently while
preserving the decision and digest tombstone. A digest tombstone proves absence only from the local primary store; it
does not prove deletion from backups, replicas, or material already disclosed to a provider. Active legal holds win.

## Protocol meaning and limitations

- External Activity is an authenticated observation, not proof that an external effect occurred.
- Passing targeted verification is not a broad certification of an agent or workflow.
- Repair and verification grant no Promotion authority. Named-human authorization remains exact to candidate, receipt,
  target, base revision, and recovery reference.
- The Console projects Kernel truth; it owns no database, workflow, case, or decision truth.
- Fault-injection controls are disabled in release composition.
- The reference n8n runtime is a local proof substrate. A production n8n deployment needs a customer-issued API
  credential, retention policy, supported provider backup, and approved connector/network boundary.
- The release is not highly available. Hardware loss between backups can exceed the RPO, and large restores can exceed
  the RTO. Qualification on an isolated fresh extraction is not universal hardware or compliance certification.

Stop without deleting state:

```sh
docker compose --project-name alphonse-v0-2 --env-file .env.release -f compose.yaml down
```

Do not add `--volumes` unless permanent deletion of customer-controlled state is explicitly approved and separately
recoverable.
