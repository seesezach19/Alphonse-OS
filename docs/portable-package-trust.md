# Portable Package Trust

Ticket 12 separates five claims that must not collapse into one:

1. Publisher identity: an offline root key delegates a scoped, expiring Ed25519 release key.
2. Artifact integrity: the signed manifest binds exact artifact bytes and exact transitive dependencies.
3. Registry custody: a registry-only database role verifies the release, records an append-only checkpoint, and signs a Publication Receipt. It cannot read or mutate Kernel authority tables.
4. Destination trust: an immutable policy is bound to one Environment class and independently pins publishers, registries, attesters, risk classes, advisory freshness, and advisory responses.
5. Operational authority: import creates only an immutable Import Receipt and quarantined Package. It creates no Deployment, approval, activation, credential, Run, or Effect authority.

Package identity is `package_id@semantic_version#manifest_digest+package_artifact_digest`. The signed manifest binds every artifact descriptor, dependency, export, compatibility claim, license, and operational risk profile; verified descriptors bind the bytes. Registry and mirror location are deliberately absent.

## Keys

Publisher root private keys remain outside release and registry storage. Release keys may publish only within delegated namespace, package, action, and time scope. Expiry blocks new publication; a timely signed release with a timely custody receipt remains independently verifiable later.

Registry signing keys attest custody only. They do not attest business approval or grant Kernel authority.

Registry transport uses short-lived HMAC-signed access grants scoped to registry, subject, actions, Package namespaces, and expiry. Download and mirror authorization checks every transitive Package, not only the requested root. A mirror verifies the trusted source's signed snapshot against the exact Package and advisory set, then commits the complete dependency closure and advisories atomically. Primary and mirror processes use separate row-scoped database roles. Transport access remains distinct from publisher provenance and destination trust.

## Import

The destination verifies every node in the exact dependency closure, every artifact digest, publisher delegation, trusted custody receipt, trusted signed risk attestation, compatibility, license, export class, dependency count, effect/context/credential/network requirements, local risk rules, and signed advisory snapshot. Structural or cryptographic failure rejects the command. Policy denial records an immutable denied Import Receipt but creates no quarantine record.

An admissible import requires a confirmed Work Intent, then records one quarantined Package and immutable Import Receipt. The receipt binds actor, Work Intent, bundle, manifests, releases, artifacts, dependency closure, custody receipts, attestations, advisory snapshot, policy, decisions, and evidence digests. Re-import through a mirror or offline bundle reuses the same Package identity and quarantine boundary.

## Advisories

Publishers sign advisories with their pinned root key. A critical advisory can revoke one delegated release key from a stated effective time, and that revocation follows the key across every Package it signed. Registries preserve these records in append-only history and sign bounded-lifetime advisory snapshots. Stale snapshots are visible and deny new import. An advisory cannot invent a response; it selects only the response already configured for its severity in destination-local policy, such as `notify_only` or `block_new_import`.

## Outage Behavior

Offline bundles contain the same signed releases and custody receipts used online. Verification output excludes transport location, so equivalent bytes and policy produce the same verification digest. Kernel import and existing operations do not call the registry and continue while registry services are unavailable.

## Qualification Boundary

`npm run test:ticket-12` is controlled engineering acceptance. Ticket 11 remains the gate for calling the inventory Package production-qualified or distributing it as the decisive proof artifact.
