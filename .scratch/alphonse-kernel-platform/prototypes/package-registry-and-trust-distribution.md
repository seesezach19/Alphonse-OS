# Package Registry And Trust Distribution

Status: rough HITL prototype

## Claim

Operational Packages can be discovered and distributed through registries while artifact integrity, publisher provenance, registry custody, and destination trust remain separate proofs. Registry acceptance never grants Deployment or activation authority.

## Trust Layers

1. **Artifact integrity**: a digest identifies exact manifest and artifact bytes.
2. **Publisher provenance**: a signature proves an authorized release key signed those bytes.
3. **Registry custody**: a publication receipt proves what the registry accepted, checked, and served.
4. **Destination trust**: each Environment decides whether the exact Package, publisher, registry, evidence, dependencies, and requested risk are acceptable.

These proofs never grant technical review, business approval, Deployment, Capability activation, credential access, context access, or execution authority.

Core rule: signed does not mean safe, approved, deployed, or active.

## V1 Scope

Registry supports:

- customer-private Packages
- publisher-team Packages
- explicitly shared partner Packages
- Alphonse-curated Packages

Anonymous publishing, arbitrary public executable uploads, ratings, reviews, payments, recommendations, and marketplace ranking are out of scope.

## Registry Metadata

Registry indexes:

- globally unique Package identity
- publisher namespace and human-readable name
- immutable Package Version digest
- publisher identity and signing-key reference
- manifest and artifact digests
- exported Capabilities, Skills, schemas, views, and adapters
- dependencies and compatibility ranges
- protocol and Kernel compatibility
- evaluation, build, and security attestations
- license and usage constraints
- artifact risk classes
- release, deprecation, removal, and advisory status
- publication/update timestamps

Search labels, descriptions, channels, and tags are non-authoritative. The signed Package manifest remains self-contained and portable.

## Package Identity And Namespace

Authoritative package identity is globally unique and independent of registry hostname. Registry location is distribution, not identity.

- Human namespace/name is bound to publisher identity.
- Namespace cannot be silently reassigned or recycled after account closure.
- Transfer requires old and new publisher signatures plus registry receipt.
- If old signing authority is unavailable, a new Package identity is required.
- Mirrors preserve Package, Version, and publisher identity.

Mutable channels such as stable, preview, or latest point to exact immutable digests. They never become Deployment identity.

## Publisher Identity

A Publisher Identity contains:

- stable publisher identifier and root public key
- verified organization/account metadata
- release-key delegations
- key rotation and revocation history
- namespace ownership

Publisher root delegates scoped, expiring release-signing keys. Delegation binds publisher, release key, Package/namespace scope, permitted actions, issue time, expiry, and revocation authority.

Private keys remain in publisher-controlled KMS/signing infrastructure. Registry never escrows them. CI/build agents sign only through narrowly delegated release identities.

A Package Version signature binds Package identity, semantic version, canonical manifest digest, complete artifact digest set, dependencies, publisher/release-key identity, delegation, and issue time.

Root rotation and compromise produce explicit signed continuity or revocation records. History is never rewritten.

## Artifact Classes

1. **Declarative**: schemas, manifests, documentation
2. **Interpreted content**: Skills, prompts, evaluations
3. **Sandboxed modules**: views and UI extensions
4. **Executable**: adapters, workers, runtime code

Each class receives progressively stronger publication, Trust Policy, sandbox, and review requirements. A publisher cannot classify content below detected risk.

## Attestations

Typed attestations may cover build provenance, source revision, SBOM, malware, vulnerabilities, tests, model/Skill evaluations, compatibility, and reproducibility.

Every attestation binds issuer/signature, predicate type/schema, subject digest, result/evidence, issue time, and expiry.

Registry scans are evidence, not guarantees. Destination Trust Policy decides sufficiency.

## Atomic Publication

1. Publisher uploads staged content-addressed artifacts.
2. Registry verifies digest, size, media type, and manifest membership.
3. Required scans and attestations complete.
4. Publisher signs final canonical manifest.
5. Registry validates identity, delegation, signature, namespace, and completeness.
6. Registry atomically commits immutable Package Version and signed Publication Receipt.
7. Discovery exposes it only after commit.

Missing or mismatched artifacts reject publication. Same digest may deduplicate storage. Published bytes never change.

Deprecation, removal, channel movement, or advisory creates a new signed status record. History remains unchanged.

## Publication Receipt

Receipt binds:

- registry identity
- Package and Package Version
- manifest/artifact digests
- publisher identity and signature chain observed
- attestations and scans observed
- registry transparency checkpoint
- publication time

It proves registry custody and checks, not destination trust.

## Discovery

Discovery queries by exported contracts, compatibility, publisher/trust eligibility, required context/credentials/adapters, artifact/effect risk, evidence, and advisory state.

Popularity is not trust. Search metadata is non-authoritative. Agents may propose candidates/imports but cannot approve Trust Policy exceptions.

## Distribution Authorization

Registry access and destination trust remain separate:

- Access determines who may discover/download.
- Signatures and Trust Policy determine admissibility.
- Access never implies trust.
- Trust never implies download permission.

Private sharing grants bind organization, Package scope, actions, and expiry. Agents receive short-lived scoped download tokens.

Revoking access stops future retrieval but cannot erase valid local cache. License obligations are explicit metadata, not Kernel authority.

## Dependency Resolution

Manifests may declare compatibility ranges. Import resolution creates one exact dependency closure by digest.

Every transitive dependency is independently checked for Package/publisher identity, namespace, signature/delegation, registry receipt, Trust Policy, compatibility, advisories, and required attestations.

Parent trust never transfers to dependencies. Cycles, namespace substitution, undeclared runtime downloads, and unresolved ranges are rejected.

Deployment binds the exact closure. Dependency changes require new Import Receipt and Deployment Plan.

## Destination Trust Policy

Each Environment owns immutable, versioned policy covering:

- allowed registries/mirrors
- pinned publishers and delegated keys
- permitted namespaces
- allowed export/artifact classes
- executable and sandbox restrictions
- dependency and license rules
- required attestations/freshness
- vulnerability/advisory thresholds
- maximum effect, context, credential, and network risk
- signature/evidence requirements

Development, staging, and production may differ. Deny overrides allow. Runtime callers cannot weaken policy. Policy changes never rewrite historical Import Receipts.

## Import Protocol

Target Environment:

1. receives exact Package identity
2. resolves exact dependency closure
3. downloads to quarantine or loads offline bundle
4. verifies every digest
5. verifies publisher signature/delegation and key validity at signing time
6. verifies registry receipts and transparency checkpoints
7. verifies compatibility, attestations, advisories, and revocations
8. evaluates exact destination Trust Policy
9. records immutable Import Receipt

Unknown publisher/key never gains automatic trust-on-first-use. Customer explicitly pins or approves scoped trust.

Successful import means exact content is authentic and locally admissible for review. It does not mean deployed or active.

## Import Receipt

Import Receipt binds:

- Package and exact dependency closure
- artifact digests
- publisher identities, delegations, and signatures
- registry receipts/checkpoints
- attestations and advisory snapshot
- Trust Policy identity/version
- every allow, deny, warning, and exception
- importing actor/agent and Work Intent
- import time and result

## Advisories And Revocation

A signed Advisory binds issuer/authority type, exact affected scope, severity/evidence, compromise effective time, remediation, superseding safe version, and issue/expiry timestamps.

Destination policy selects response:

- notify only
- block new import
- block new Deployment
- suspend new admission or Effects
- require emergency review

Registry cannot directly deactivate customer Capabilities. Automatic local suspension requires previously approved customer policy.

Disconnected Environments expose advisory freshness. Stale security status cannot appear current.

## Availability, Mirroring, And Offline Import

- Imported artifacts are cached locally by digest.
- Existing Deployments/Runs never require registry availability.
- Mirrors may serve exact bytes; publisher provenance remains unchanged.
- Registry outage pauses discovery/import, not operations.
- Runtime never depends on registry token introspection.

Offline bundle includes manifest, artifacts, signatures/delegations, attestations, Publication Receipt, advisory snapshot/freshness, and exact dependency closure. Offline import performs the same verification.

Local garbage collection removes only content unreferenced by Deployment, Run, evidence, recovery, legal hold, or retention policy.

## Registry Transparency

Append-only registry log covers:

- publisher key/delegation changes
- namespace ownership/transfer
- Package publication
- channel/deprecation/removal changes
- advisories and revocations
- registry signing-key rotation

Registry issues signed checkpoints. Publication and Import Receipts bind the observed checkpoint.

V1 may use private organization-scoped logs. Public transparency and independent monitors may come later. Checkpoints provide tamper/equivocation evidence without granting registry authority.

## Required Invariants

1. Package identity is independent of registry location.
2. Published Package Version bytes never change.
3. Signature proves provenance, not safety or authority.
4. Registry acceptance never grants destination trust.
5. Destination trust never grants Deployment or activation.
6. Parent trust never transfers to dependencies.
7. Runtime agents cannot weaken Trust Policy.
8. Advisory response is customer policy, not registry command.
9. Existing operations do not depend on registry availability.
10. Removal/revocation never rewrite history.
11. Private-key custody remains outside registry.
12. Every import is reproducible from receipt and exact digests.

## First-Proof Checks

The inventory Package must demonstrate:

1. publication under delegated release key
2. rejection of missing/mismatched artifact
3. exact dependency closure and transitive verification
4. development acceptance and production rejection under different policies
5. quarantined import before Deployment review
6. complete Import Receipt
7. advisory response under preapproved policy
8. continued operation during registry outage
9. equivalent offline import
10. transparency checkpoint in publication/import receipts

## Prototype Outcome

Package Registry is a portable content-addressed distribution and evidence service. Publishers control signing keys, registries prove custody/checks, and customer Environments independently decide trust. Exact Packages work offline and across mirrors. Registry status, signatures, scans, and advisories inform local policy but never become Deployment or execution authority.
