# Verify The Complete Committed Intake Prefix In V1

The v1 Independent Diagnostic Verification Bundle includes every preserved intake outcome at Diagnostic Committed
Intake Positions `1..cutoff`, not merely the Stage Worker's declared inputs. For each contiguous position it includes
the canonical accepted receipt, authenticated conflict or retained rejection bytes, or an exact governed-erasure
tombstone. It also includes grant and tokenization application state, signed Tokenization Result Receipts and their
exact Grant Activation Snapshots and Grant Application Receipts, service verification identities, schemas, contracts,
coverage, rules artifacts, and published stage input manifests.

The separate verifier first proves position contiguity and cutoff identity, then independently determines which
outcomes are eligible for projection and selection. Only afterward does it compare recomputed correlation, effects,
evaluation, selected manifest, package digest, and stage identities with published records. The privileged verifier
therefore receives broader material than the worker under the customer-controlled v1 proof. Future deployments may
replace full-prefix disclosure with a committed accumulator and verifiable inclusion and exclusion proofs.
