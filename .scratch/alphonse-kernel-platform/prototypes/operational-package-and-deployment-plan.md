# Operational Package And Deployment Plan Prototype

Status: rough HITL prototype

## Design Rule

A Builder authors declarations. Kernel computes identity, resolves composition, validates contracts, records decisions, and creates immutable installed state. Package content never grants authority merely by existing or being installed.

## Package Source Shape

```text
inventory.operations/
|-- package.yaml
|-- schemas/
|-- skills/
|-- evaluations/
|-- capabilities/
|-- policies/
|-- views/
`-- adapters/
```

Directories are authoring convention. The canonical Package Version is a normalized content-addressed artifact, not the source directory.

## Authored Manifest Prototype

```yaml
schema_version: alphonse.package_manifest.v0.1

identity:
  package_id: com.alphonse.inventory.operations
  version: 1.2.0
  name: Inventory Operations
  summary: Governed inventory lookup and correction methods.

compatibility:
  kernel_api: ">=0.1 <0.2"

exports:
  schemas:
    - export_id: inventory_item
      contract_version: 1.0.0
      path: schemas/inventory-item.json
  skills:
    - export_id: check_inventory
      contract_version: 1.0.0
      path: skills/check-inventory.yaml
  evaluations:
    - export_id: check_inventory_eval
      contract_version: 1.0.0
      path: evaluations/check-inventory.yaml
  capabilities:
    - export_id: inventory_lookup
      contract_version: 1.0.0
      path: capabilities/inventory-lookup.yaml
    - export_id: inventory_adjustment
      contract_version: 1.0.0
      path: capabilities/inventory-adjustment.yaml
  policies:
    - export_id: inventory_disclosure
      contract_version: 1.0.0
      path: policies/inventory-disclosure.yaml
  views:
    - export_id: inventory_exceptions
      contract_version: 1.0.0
      path: views/inventory-exceptions.yaml
  adapters:
    - export_id: erp_inventory_adapter
      contract_version: 1.0.0
      path: adapters/erp-inventory.yaml

dependencies:
  - package_id: com.alphonse.shared.customer-identity
    version: ">=2.1 <3.0"
    imports:
      - export_id: customer_reference
        contract_version: ">=2.0 <3.0"

extension_points:
  - export_id: inventory_source
    contract_version: 1.0.0
    contract: schemas/inventory-source-adapter.json
    cardinality: one

configuration:
  schema: schemas/configuration.json

trust:
  source_repository: https://example.invalid/inventory.operations
  executable_code: trusted_builder
```

## Kernel-Computed Package Version

```yaml
schema_version: alphonse.package_version.v0.1

package_id: com.alphonse.inventory.operations
declared_version: 1.2.0
artifact_digest: sha256:PACKAGE
manifest_digest: sha256:MANIFEST
publisher_principal_id: principal_builder
published_at: 2026-07-13T16:00:00Z

kernel_api_range: ">=0.1 <0.2"
normalized_exports:
  - export_id: inventory_lookup
    contract_version: 1.0.0
    kind: capability
    contract_digest: sha256:CAPABILITY

dependency_requirements:
  - package_id: com.alphonse.shared.customer-identity
    version_range: ">=2.1 <3.0"

implementation_artifacts:
  - export_id: erp_inventory_adapter
    contract_version: 1.0.0
    kind: oci
    artifact: registry.example/erp-inventory@sha256:IMAGE

provenance:
  source_revision: git:abc123
  build_attestation: sha256:ATTESTATION
  publication_attestation: kernel://attestations/PUBLICATION
  publisher_signature: null

validation_receipt_id: validation_package_123
```

`artifact_digest` is authoritative. Human-readable version supports communication and compatibility rules but never identifies installed bytes by itself.

## Export Rules

Every export has:

- package-scoped stable `export_id`
- one declared kind
- schema version
- canonical content digest
- dependency/import references
- validation receipt

Exports are addressed globally by:

```text
package_id + artifact_digest + export_id + contract_version + export_digest
```

Package Versions own immutable export definitions. Kernel may index exports separately but does not give Skill, Evaluation, Policy, Schema, View, or Adapter exports independent mutation lifecycles.

Capability exports additionally participate in review, business approval, and environment-local activation.

## Dependency Rules

- Builder declares package identity, version range, and imported export IDs.
- Kernel resolver chooses exact Package Version digests.
- Deployment Plan stores exact resolved digests; runtime never resolves ranges.
- Cycles fail validation.
- Missing or incompatible imports fail validation.
- Transitive dependencies are included in the lock.
- Optional behavior must be an explicit feature/binding in the Deployment Plan, never presence-based ambient behavior.
- Installing another package cannot change an existing resolved plan.

## Extension Rules

Every extension point declares:

- stable namespaced ID
- typed contract and digest
- cardinality
- compatibility version
- whether zero bindings are valid
- allowed export kind

Every binding is explicit in the Deployment Plan. Multiple candidates, missing required bindings, incompatible contracts, and duplicate singleton bindings fail validation. Installation order never resolves conflicts.

## Configuration And Secrets

- Package defines configuration schema and deterministic defaults.
- Deployment Plan binds customer configuration values.
- Secret fields contain Credential Binding References only.
- Kernel computes a redacted configuration digest.
- Runtime receives only exact admitted values/references.
- Configuration changes create a new Deployment Plan.

## Deployment Plan Prototype

```yaml
schema_version: alphonse.deployment_plan.v0.1

environment_id: environment_customer_prod
plan_id: deployment_plan_123
base_deployment_id: deployment_122

root_packages:
  - package_id: com.alphonse.inventory.operations
    artifact_digest: sha256:PACKAGE

dependency_lock:
  - package_id: com.alphonse.shared.customer-identity
    artifact_digest: sha256:DEPENDENCY

extension_bindings:
  - extension_point: com.alphonse.inventory.operations/inventory_source@1
    provider: com.customer.erp/erp_inventory_provider@1

configuration_bindings:
  - package_id: com.alphonse.inventory.operations
    redacted_values:
      minimum_available_quantity: 5
    credential_binding_refs:
      - erp.read.inventory

capability_candidates:
  - capability_export: com.alphonse.inventory.operations/inventory_lookup@1
    requested_state: staged

composition_digest: sha256:COMPOSITION
validation_receipt_id: validation_plan_123
created_by_principal_id: principal_builder
work_intent_id: intent_deploy_inventory
created_at: 2026-07-13T17:00:00Z
```

## Deployment Lifecycle

```text
mutable composition draft (Build Workspace)
-> validated immutable Deployment Plan
-> technical review
-> apply as staged Deployment
-> business approval for exact authority-bearing changes
-> immutable Deployment
-> separate capability activation decisions
```

Changing any package, lock, binding, configuration, or candidate creates a new Deployment Plan. Applying a plan never mutates the prior Deployment.

## Validation Receipts

Package and plan validation produce immutable receipts binding:

- validator/kernel API version
- object digest
- dependency and export checks
- extension binding checks
- configuration checks
- trust policy checks
- warnings and errors with stable codes/paths
- validation timestamp

A receipt reports what passed under one validator version. Admission and activation recheck time-sensitive conditions rather than treating validation as permanent truth.

## Trust Metadata

V1 executable adapters require an explicit trusted Builder decision. Local publication receives a Kernel Environment signature automatically. Builder signatures are optional locally; cross-environment imports require a publisher or source-environment signature trusted by the destination Environment. Package trust metadata records publisher, source revision, artifact digest, build attestation, signature references, executable artifact digests, and dependency provenance. Trust metadata proves identity/integrity claims; it does not grant capability authority.

## Compatibility Promise

- Existing Deployment remains unchanged until a new exact plan is applied.
- Package deprecation creates an advisory, not mutation.
- Package revocation blocks new installation/activation and creates an explicit response state for existing Deployments; it does not silently delete them.
- Kernel API incompatibility blocks new plans rather than rewriting packages.
- Rollback means applying a new plan referencing a prior exact composition.

## Decisions During Prototype

- Every Package Version requires stable package ID, semantic version, and authoritative content digest. Reusing one package ID and semantic version for different content is invalid forever; Deployments lock exact digests.
- Every export uses a stable export ID, separate semantic contract version, and authoritative digest. Imports declare contract-version ranges; Deployments lock exact export digests.
- Kernel signs every local Package Version publication automatically. Builder signatures are optional locally; trusted publisher or source-environment signatures are mandatory for cross-environment import and promotion.
- Every Deployment Plan receives exact-plan technical review. Staged installation requires technical approval; business approval binds only exact authority-bearing changes, individually or in an explicit batch, including capability exports, credential scopes, context grants, and effect limits.
- Revocation is typed: deprecation is advisory, policy blocking stops new plans and activations, and security compromise immediately blocks new admission and quarantines affected Deployments. In-flight Runs stop at their next effect gate and escalate; history remains intact until an explicit replacement or rollback plan is applied.

## Prototype Outcome

Operational Packages are immutable, content-addressed, semantically versioned collections of typed exports. Deployment Plans resolve all dependency ranges, extension bindings, configuration, credentials, and capability candidates to exact digests before review. Installation creates staged immutable Deployments; authority arrives only through separate exact capability approvals and activations.
