# Codex ETL Smoke Lab

This lab runs a real n8n settlement ETL against a local mock warehouse. The n8n execution and warehouse load succeed,
but an independently computed reconciliation fails for a subset of currencies. A worker package contains the source
contract, runtime outcome, warehouse receipt/state, and reconciliation result. It excludes the workflow source,
controller answer key, repository source, and any repair.

## Run the ETL and package blind evidence

```sh
npm run smoke:codex-etl
```

The command resets only the dedicated `alphonse-codex-etl-smoke` Docker project, imports and publishes the pinned n8n
workflow, submits the synthetic batch, proves the committed warehouse state, and writes a worker-only package beneath
`.smoke/codex-etl/<run-id>/worker`. The n8n and warehouse containers remain running for inspection.

## Run Codex

Wire an authenticated Codex CLI, then run:

```sh
codex login
codex login status
CODEX_BIN=/path/to/codex npm run smoke:codex-etl:codex
```

The harness copies only the worker package to a fresh temporary directory and invokes `codex exec` ephemerally with a
read-only sandbox, approvals disabled, user config/rules ignored, web search disabled, and the exact diagnosis JSON
Schema. It removes the temporary worker directory after the process exits. The controller scores only structured fields
and resolvable JSON Pointer citations; it does not keyword-classify free prose.

Do not mount a personal Codex home into a container or place an API credential in this repository. This is a host smoke
test, not the Ticket 16 credential-free brokered worker proof.

## Run in the Codex app

Export the latest blind package to a new directory outside this repository:

```sh
npm run smoke:codex-etl:app -- /absolute/path/to/new-blind-worker-directory
```

Open only the exported directory in the Codex app, then ask Codex to follow `PROMPT.md`. Do not open the
`ALPHONSE_KERNEL` repository for the blind run because it contains the controller answer key and workflow source.

## Recorded Codex app checkpoint

On 2026-07-18, a fresh Codex app chat received only the exported four-file worker package. Its diagnosis was bound to
the exact assignment and evidence digest and correctly identified:

- a successful workflow with committed bad data;
- a currency-scale contract mismatch affecting JPY and KWD but not USD;
- minor-unit source values and currency exponents USD `2`, JPY `0`, and KWD `3`;
- a suspected normalization transform applying exponent `2` universally;
- two bounded investigations, explicit implementation uncertainty, and no actions.

The immutable original scorer returned 14/15 and formal `passed: false`. All five citations resolved. The only failed
criterion, `required-evidence-covered`, required two preferred exact pointers: the app cited the valid parent
`/workflow_observation` instead of `/workflow_observation/lifecycle_claim`, and cited the stronger committed
`/destination_observation/committed_load/payload/normalized_rows` evidence instead of the preferred sibling
`.../currency_totals`.

The checkpoint is intentionally not rescored against a revised rubric. It demonstrates both successful blind diagnosis
and evaluator brittleness. A future run may precommit typed evidence roles with multiple exact admissible claim IDs while
retaining deterministic identity, provenance, schema, authority, citation-resolution, and no-action gates.

The exact worker package, diagnosis, score, and run digests are preserved in
[`checkpoints/2026-07-18-codex-app`](checkpoints/2026-07-18-codex-app/README.md).

## Score an externally produced diagnosis

```sh
node scripts/smoke-codex-etl.js score /path/to/diagnosis.json
```

## Stop

```sh
npm run smoke:codex-etl:down
```
