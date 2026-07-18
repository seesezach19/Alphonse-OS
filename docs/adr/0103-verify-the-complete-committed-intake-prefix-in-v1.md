# Verify The Complete Committed Intake Prefix In V1

The v1 Independent Diagnostic Verification Bundle includes every intake outcome at Diagnostic Committed Intake
Positions `1..cutoff`, not merely the Stage Worker's declared inputs. Every position has one explicit material state:
`exact_material`, `verified_legacy_reconstruction`, `governed_erasure_tombstone`,
`unavailable_legacy_material`, or `missing_or_corrupt_material`. A tombstone proves governed absence, not the original
bytes, and unavailable required material makes the semantic result unverifiable rather than silently excluded.

The bundle separates `independent_inputs` from `published_outputs_to_compare`. Inputs include exact accepted receipts,
conflict/rejection material, duplicated storage bindings, grant and tokenization application state, signed
Tokenization Result Receipts and public verification identities, schemas, contracts, policies, coverage inputs, and
durably archived activated stage artifacts. Published manifests and outputs are comparison targets and may not be
used to derive eligibility.

The offline verifier first proves position contiguity, uniqueness, canonical ordering, cutoff identity, and material
availability, then independently determines which outcomes are eligible for projection and selection. Physical order
of set-like bundle arrays is normalized, while missing, duplicated, or noncanonical published ordering fails. Only
after recomputation does it compare every deterministic stage and package/release record with published material.

The acquisition role therefore receives broader material than the worker under the customer-controlled v1 proof.
The sealed full-prefix bundle is never exposed to a model, worker workspace, ordinary logs, or assignment. Future
deployments may replace full-prefix disclosure with a separately anchored committed accumulator and verifiable
inclusion and exclusion proofs.
