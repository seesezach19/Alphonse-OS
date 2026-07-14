# Hosted Coordination And Environment Promotion

Status: rough HITL prototype

## Claim

A hosted Alphonse service can make customer Environments discoverable, supportable, observable, and easy to promote between without becoming an authority dependency or receiving implicit access to customer operations.

Hosted Alphonse proposes and coordinates. Customer Kernel validates and commits.

## Responsibility Boundary

### Hosted Coordination Owns

- commercial account, billing, and support contacts
- Coordinator Bindings and verified Environment registrations
- signed package/update catalogs and compatibility advisories
- Promotion Proposals and receipt-derived promotion status
- sanitized health summaries and notification routing
- support case coordination and encrypted diagnostic-bundle handling
- coordination audit records

### Customer Kernel Exclusively Owns

- Principals, Passports, Delegations, and Work Intents
- Package installation and Deployment state
- technical review, business approval, and Capability activation
- Envelopes, Runs, Effects, and idempotency
- evidence, Operational Obligations, and Recovery Cases
- credentials, secrets, business context, and detailed operational records

Hosted account identity never implies Kernel identity or authority. Hosted state never substitutes for local authoritative state.

## Coordinator Binding

Each Environment locally stores a replaceable Coordinator Binding containing:

- coordinator endpoint and public identity key
- Environment and Installation identities exposed to that coordinator
- metadata disclosure scope
- catalog and promotion scope
- health and notification scope
- support coordination scope
- binding issue time, expiry, and key-rotation policy

The customer Kernel creates, narrows, rotates, expires, or revokes this binding. Removing it cannot alter installed Packages, authority, Runs, evidence, or recovery.

V1 permits one active hosted Coordinator Binding. The protocol does not assume that coordinator is permanently unique and may support multiple coordinators later.

## Registration And Connectivity

The Environment generates and retains its installation signing key. Registration uses challenge-response to bind the Environment identity and public key to a hosted account.

Customer Environment initiates all normal communication:

```text
Customer Kernel
  -> signed registration / heartbeat / coordination receipts
  <- signed catalogs / advisories / Promotion Proposals
```

- Communication uses an outbound authenticated channel.
- Messages bind coordinator, installation, Environment, sequence/nonce, issue time, and expiry.
- No permanent inbound administration port is required.
- Hosted service cannot mint Kernel identities or Passports.
- A support tunnel requires explicit local approval, is time-bounded, and is read-only by default.

## Environment Descriptor

The Environment computes and signs a minimal descriptor:

- Installation and Environment identifiers
- customer-controlled display label
- class: development, staging, or production
- Kernel build, protocol, and storage-schema compatibility versions
- public signing key and current execution epoch
- installed Package and Deployment digests required for compatibility
- supported adapter contract versions
- coarse health and last-contact timestamp

The descriptor excludes actor activity, business payloads, credentials, prompts, Run contents, evidence bodies, and detailed operational events.

Hosted registration states are:

```text
pending -> verified -> active -> suspended | retired
```

These states affect hosted coordination only. They cannot suspend or retire local Kernel authority.

## Environment Promotion Graph

The customer defines permitted promotion edges and required evidence. The default graph is:

```text
development -> staging -> production
```

Each edge may require signed receipts for:

- Package validation
- deterministic evaluations
- simulation fidelity and outcomes
- protocol/dependency compatibility
- source provenance
- staged Deployment
- required failure injection and recovery
- technical review
- customer-defined release policy

Hosted service checks proposal completeness and explains missing gates. The target Kernel independently verifies every receipt and applies target-local policy.

Skipping a required edge or gate requires an exact local exception with actor, reason, scope, expiry, and approval. The exception remains visible in history.

## Promotion Semantics

Promotion moves immutable identity, not mutable state:

1. Source publishes an exact Package Version and attestations.
2. Hosted service creates a signed Promotion Proposal.
3. Target Environment pulls and verifies the proposal.
4. Target Kernel independently resolves an exact Deployment Plan.
5. Resolution binds target-local configuration, credential references, policies, adapters, and Capability candidates.
6. Local technical review and business approval proceed normally.
7. Target Kernel deploys and activates exact Capabilities separately.
8. Target returns signed coordination receipts.

A Promotion Proposal contains:

- exact Package and artifact digests
- dependency lock
- source publication attestations
- compatibility requirements and results
- declared change summary
- required target configuration schema, never values
- required promotion-gate receipts
- proposal identity, issuer, target, issue time, and expiry

Promotion never copies credentials, secrets, business context, authority, active Capability state, mutable records, or source Environment configuration values.

## Promotion Status

Hosted status is a receipt-derived projection:

```text
proposed
discovered
target_validation_failed
awaiting_local_review
deployed
partially_activated
activated
declined
expired
superseded
```

Hosted service cannot assert `deployed` or `activated` without a signed target Kernel receipt binding exact digests and revisions. Status always exposes receipt freshness.

Hosted service may compare sanitized configuration fingerprints and schemas to identify drift. Configuration values remain local, and drift detection cannot overwrite target configuration.

## Update Discovery

Hosted service returns signed, digest-specific advisories containing:

- available compatible Package or Kernel versions
- dependency and protocol compatibility
- migration requirements
- security classification
- change summary
- evaluation and publication evidence
- recommended promotion path

Rules:

- Hosted service cannot force Package or Kernel updates.
- Local policy may automate download and staging.
- Production deployment and activation remain local authority transitions.
- A critical advisory blocks local work only when a customer previously configured a local trust policy authorizing that response.
- Hosted service cannot silently revoke Capability authority.

Package registry signing, distribution trust tiers, and revocation mechanics are specified separately. Compatibility migration and rollback are also separate contracts.

## Hosted Health Visibility

Environment computes and signs a coarse Health Summary with:

- Kernel and database availability
- projection and outbox lag
- worker execution epoch/fencing status
- Package and protocol compatibility
- adapter and Data Plane reachability categories
- backup/restore readiness
- unresolved Operational Obligation counts by severity
- source cursor and summary freshness

Hosted status is one of `healthy`, `degraded`, `blocked`, or `unknown`. Missing or expired heartbeat means unknown, not failed.

Hosted service does not receive Run contents, evidence bodies, business records, actor activity, secret endpoints, or detailed logs by default.

## Support Coordination

A support case may originate in the hosted service or customer Environment. It binds:

- exact Environment
- sanitized Health Summaries
- reported problem and requested support scope
- proposed diagnostic categories
- requested duration and expiry
- customer-visible support identities

Customer Kernel issues a temporary Support Passport. It is read-only by default and grants no standing access. Any remediation requires an exact locally approved Capability. Production write support may require customer-defined two-person approval.

Every support observation and action is written to the customer Kernel ledger. Closing, expiring, or revoking the case immediately removes access.

Detailed diagnostics leave the Environment only through an explicit redacted support bundle. The bundle is immutable, encrypted, scoped to the case, access-logged, and automatically expires.

Hosted service coordinates expertise; customer Kernel controls support authority.

## Hosted Outage And Termination

Customer Environment remains operational when hosted coordination is unavailable:

- existing local authority and active Capabilities remain valid
- Runs, Effects, evidence, obligations, and recovery continue locally
- runtime execution never depends on hosted token introspection
- cached signed catalogs remain usable until their declared expiry
- new update discovery, promotion coordination, and hosted support pause
- local health remains visible while hosted health becomes unknown

Billing interruption, hosted outage, or service termination cannot remotely disable customer operations. Termination removes hosted coordination, updates, and support; it does not brick installed Operational Packages.

## Deployment Topologies

The same protocol supports:

- local customer Kernel
- customer-owned cloud Kernel
- Alphonse-managed single-tenant Kernel

No topology receives a privileged Kernel Protocol path. In managed infrastructure, the customer retains Kernel root administrator authority and hosted operators still require Support Passports.

Infrastructure custody is disclosed as a separate trust dimension from logical authority. Customer-controlled signing and KMS keys are preferred. External signed checkpoints can expose privileged storage tampering. Higher-assurance customers may select customer-owned infrastructure.

## Portability

- Coordinator Binding is locally revocable and replaceable.
- Signed Promotion Proposals, receipts, advisories, and support records are exportable.
- Hosted account deletion follows declared retention and deletion policy.
- Removing hosted coordination leaves Kernel state intact.
- No hosted-only token is required to interpret customer Kernel records.

## Required Invariants

1. Hosted identity never grants Kernel authority.
2. Hosted status never substitutes for customer Kernel state.
3. Promotion never copies mutable authority, secrets, or business payloads.
4. Target Environment resolves and authorizes its own Deployment Plan.
5. Hosted service cannot claim deployment or activation without a signed target receipt.
6. Normal hosted communication requires no permanent inbound administration path.
7. Support access is locally issued, scoped, expiring, and ledgered.
8. Hosted outage cannot stop already authorized customer operations.
9. Coordinator removal cannot alter local authority or history.
10. Infrastructure custody is disclosed separately from logical authority.

## First-Proof Checks

The reference inventory Package must demonstrate:

1. Registration of development, staging, and production Environments through outbound signed channels.
2. Promotion of one exact Package digest across the customer Promotion Graph.
3. Local resolution of distinct configuration and credential references in each target.
4. Rejection when required staging recovery evidence is missing.
5. Signed target receipts producing truthful hosted promotion status.
6. Continued production operation during simulated hosted outage.
7. One read-only support case with explicit Support Passport and expiring redacted bundle.
8. Coordinator revocation without damage to installed Package or local history.

## Prototype Outcome

Hosted Alphonse is a replaceable coordination plane over autonomous customer Kernel Environments. It registers public Environment identity, distributes signed catalogs and Promotion Proposals, displays sanitized receipt-derived health and promotion state, and coordinates temporary support. Exact Package identity moves between Environments, while configuration, credentials, authority, execution, evidence, and recovery remain local. The hosted service increases usability and supportability without becoming a hidden root of operational authority.
