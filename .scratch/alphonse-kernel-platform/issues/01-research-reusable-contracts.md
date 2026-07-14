# Research Reusable AIOS And ALPHONSE_DATA Contracts

Type: research
Status: resolved

## Question

Which contracts, validators, state transitions, tests, and vocabulary from AIOS and ALPHONSE_DATA should Alphonse Kernel reuse or adapt without importing obsolete product boundaries?

## Answer

Reuse AIOS's structured validation, proposal/version discipline, exact-version capability lifecycle, credential-reference model, execution admission invariants, tamper checks, idempotency, and their executable test behavior. Keep ALPHONSE_DATA's authority/freshness, context publication, progressive retrieval, evaluation evidence, discrepancy, and source-governance records in the separate Data Plane; Kernel consumes exact typed references and claims rather than its tables.

Do not port OpenClaw workspace layout, provider-specific runtime enums, Butler HTTP/JSON persistence, Supabase table layouts, or duplicated cross-plane concepts. The minimum-object-graph work must assign canonical ownership for Agent Passport, Work Intent, skill versions, verification, escalation, and events.

Research asset: [Reusable AIOS And ALPHONSE_DATA Contract Audit](../research/reusable-contract-audit.md)
