# 2026-07-18 Codex App Blind ETL Checkpoint

This directory preserves the exact blind worker package, the Codex app diagnosis copied verbatim from the completed
chat, and the original deterministic score. It was recorded after the answer was produced; none of the controller files
were present in the app workspace.

## Bound run

- Case: `ETL-CURRENCY-001`
- Run: `5288eef8-16b0-43d1-9b0f-3312d2497a00`
- Assignment: `9ed1cc5e-fc82-4805-9129-11736dcc62e6`
- Evidence: `sha256:1c20580515b4f985fff1cf353bb06ed409d37d56a9a163674a981fad3564c307`
- Workflow material: `sha256:d4608153742510c1d5edaaa959c4996754e533045dd0aa125dede1fb1d3ff89a`
- Fixture: `sha256:36bb58a973e79d96665b38fc15fc34ea4471a6cd0bdf82ef4e563133360200fc`
- Answer key: `sha256:a65a651b679ed1a58f86dd6a69e66de0af04740a89e55f5c250f825e1f676d46`
- Surface: Codex app; exact app build and model identifier were not captured
- Authority: diagnosis only; no repair, workflow mutation, or external effects

## Result

The diagnosis correctly identified the currency-scale contract mismatch and its complete affected scope, mechanism,
currency exponents, uncertainty, investigations, and no-action boundary. The original scorer returned 14/15 and formal
`passed: false`; only `required-evidence-covered` failed because the precommitted answer key required two preferred exact
JSON Pointers. All supplied citations resolved.

This checkpoint is intentionally not rewritten or rescored against a changed rubric. It records the evaluator-brittleness
finding alongside the successful diagnosis.

Recompute the original score from the repository root:

```sh
node scripts/smoke-codex-etl.js score \
  smoke-tests/codex-etl/checkpoints/2026-07-18-codex-app/controller/diagnosis.json \
  smoke-tests/codex-etl/checkpoints/2026-07-18-codex-app
```
