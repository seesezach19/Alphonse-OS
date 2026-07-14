# Reusable AIOS And ALPHONSE_DATA Contract Audit

## Conclusion

Reuse semantics, validation shapes, state-machine invariants, and executable test vectors. Do not transplant either repository as the Kernel. AIOS is coupled to Butler/OpenClaw/workspace-era boundaries; ALPHONSE_DATA correctly remains a separate Data Plane whose canonical records cross into Kernel only through typed references and claims.

## Adapt Into Kernel

### Structured validation

Reuse the versioned schema constants, pure `validate` functions, throwing `assert` wrappers, and structured issues containing stable code, path, message, and severity from `AIOS/packages/workspace-kit/src/development-contracts.js` and `AIOS/packages/capability-manifest/src/index.js`.

Kernel should preserve these properties while publishing new `alphonse.kernel.*` schemas:

- exact supported schema version
- deterministic validation
- machine-correctable issue paths
- warnings that do not silently become authority
- nested revalidation at every trust boundary

### Proposal and version discipline

Adapt from Builder proposal storage and the capability registry:

- proposal artifacts cannot claim live authority
- every accepted change creates a monotonically increasing exact version
- optimistic base-version checks reject stale updates
- old decisions remain bound to old versions
- persisted material is revalidated instead of trusting stored flags
- immutable bundle hashes bind reviewed content

### Capability authority lifecycle

Adapt the tested separation in `capability-registry-service.js`:

```text
proposal -> technical review -> business approval -> eligibility -> activation
```

Preserve these invariants:

- technical review is not business approval
- approval targets one exact version
- approval does not activate
- activation does not authorize a run
- current and active versions remain separately visible
- revocation deactivates affected authority without erasing history
- eligibility is derived, never manually asserted

### Credential binding references

Adapt `credential-binding-registry.js` semantics:

- store metadata and external secret references, never secret material
- bind exact scopes and package/capability version
- use optimistic binding revisions
- make revocation irreversible for that binding identity
- recheck health and exact revision at execution admission

The JSON persistence implementation is not reusable.

### Execution admission

Adapt `execution-envelope-service.js` as the starting test specification:

- exact active capability version
- Agent Passport, Work Intent, actor, and delegation bindings
- exact credential binding revisions
- effect limits
- evidence plan
- recovery or compensation plan
- expiry
- idempotency claim and request hash
- revalidation immediately before run creation
- immutable authority-bearing admission record

Preserve the existing boundary: an admitted envelope is not a run and proves no external effect.

### Integrity and transition tests

Port test behavior, not storage fixtures:

- identical idempotent replay succeeds; conflicting reuse fails
- stale proposals and stale decisions fail without mutation
- tampered authority records fail load
- undeclared effects and incomplete evidence fail admission
- revoked credentials cannot be resurrected
- missing authority produces explicit blocked state

## Keep In ALPHONSE_DATA

These remain Data Plane responsibilities and should cross through the future Context Contract:

- source systems, source policies, snapshots, tombstones, and credential rejection
- authority rules, freshness, deterministic integration health, and heartbeats
- context subjects, typed links, record versions, discrepancies, and immutable releases
- source review and human publication
- context packet compilation and progressive retrieval
- context-sensitive skill and evaluation evidence
- temporal contracts
- interpretive corrections and context proposals
- RLS, customer workspace storage, and Supabase RPC implementation

Kernel should consume exact IDs, hashes, release identities, authority/freshness claims, access decisions, and evidence references. It should not consume ALPHONSE_DATA table layouts as its contract.

## Reuse As Design Patterns Only

- `builder-compiler`: preserve agreed-input -> proposal-only output and typed artifact handoff; replace workspace Markdown/OpenClaw output with Build Session and Operational Package objects.
- `workspace-kit`: preserve typed links, proposal authority rejection, and validation style; do not import filesystem scanning, generated OpenClaw indexes, or mutable workspace-object assumptions.
- `capability-manifest`: preserve reads, writes, effects, credentials, tests, evidence, and rollback declarations; remove provider-specific runtime enums and lifecycle status from the package-authored manifest.
- Butler HTTP routes: useful behavioral examples, not the canonical Kernel Protocol.
- Butler JSON stores: prototypes only; do not port as authority persistence.
- Supabase RPCs: preserve typed, idempotent transition boundaries; do not make Postgres functions the cross-plane protocol.
- portable workspace artifacts: useful precedent for hashed exports/import proposals, but Operational Packages require a new package-native contract.

## Ownership Collisions For The Object-Graph Ticket

Ticket 02 must assign one canonical owner for each collision:

| Concept | Recommended owner | Other-plane behavior |
|---|---|---|
| Agent Passport and delegation | Kernel | Data Plane references identity |
| Work Intent | Kernel | Data Plane receives intent reference for packet compilation |
| Human/customer identity | Kernel Environment or external identity provider | Data Plane maps membership references |
| Skill definition/version | Operational Package | Data Plane stores context/evaluation evidence references |
| Skill verification | Derived across package hash, Data Plane evidence, and runtime configuration | Neither side stores an unqualified permanent boolean |
| Context release | Data Plane | Kernel binds exact release identity/hash |
| Capability authority | Kernel | Package proposes; Data Plane grants nothing |
| Context discrepancy/escalation | Data Plane | Kernel may reference it as context evidence |
| Operational obligation/escalation | Kernel | Butler interprets and coordinates |
| Context event | Data Plane | Kernel ledger references only relevant outcomes |
| Authority/run/effect event | Kernel | Data Plane may consume attributed references |

Avoid one universal `Actor`, `Escalation`, or `Workspace Event` table spanning both planes. Shared identifiers and typed references are sufficient.

## Verification

- AIOS: all package and service tests passed, 112 total.
- ALPHONSE_DATA: 5 verification-workflow tests passed; static verification found 17 migrations, 8 rollback-safe SQL checks, and generated types.
- ALPHONSE_DATA database behavior was not rerun because the local Supabase stack was unavailable. Full release verification remains outstanding.
