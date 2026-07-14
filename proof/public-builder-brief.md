# Public Builder Brief

## Objective

Build an Operational Package from this workflow:

> When storefront inventory conflicts with authoritative ERP inventory, retrieve
> current observations, apply the customer-defined policy, propose one bounded
> correction, obtain approval, apply it idempotently, verify the result, and
> preserve evidence and recovery history.

## Starting Materials

You may use only:

- running Kernel Protocol endpoint
- running Data Plane endpoint and authorized source access
- public platform documentation
- versioned domain-neutral Builder Toolkit
- package-authoring workspace

Start discovery at `GET /kernel/v0/bootstrap` and `GET /v0/bootstrap`. Operation
Descriptors are authoritative. Ask the Business Operator when business policy
is unresolved; do not infer approval, credential, or recovery policy.

You must not read Kernel source, migrations, internal schemas, prior inventory
artifacts, or another Builder's conversation. Never place credentials in
prompts, Packages, plans, or proof records.

## Pass Boundary

The work must produce public records for confirmed intent, governed context,
immutable Package publication, simulation, staged deployment, exact approval
and activation, distinct-runtime handoff, accountable comparison, staging
uncertainty/recovery, and one user-selected reversible production correction.

The Business Operator, not the Builder Agent, performs required human decisions.
The proof verifier decides qualification from the final packet and public state.
