# Runtime Event Observation

Alphonse receives external workflow lifecycle claims through the provider-neutral Workflow Runtime Adapter contract at `GET /diagnostic/v0/runtime-adapter-contract`.

## Trust Boundary

A Runtime Event creates an External Activity Trace in the Diagnostic Plane. It does not create a Kernel Run or Execution Envelope, prove external completion, or become trusted effect evidence. Provider credentials and full business payloads remain in the external runtime.

## Authentication

The adapter sends:

- `x-alphonse-runtime-key-id`
- `x-alphonse-runtime-signed-at`
- `x-alphonse-runtime-signature`

The signature is `hmac-sha256:<hex>` over these UTF-8 bytes:

```text
alphonse-runtime-event-hmac-v1
<key-id>
<signed-at>
<canonical-envelope-json>
```

Alphonse requires the exact configured adapter ID, adapter version, and key ID. Signatures outside the configured timestamp window fail closed. The HMAC secret is process configuration and is never persisted.

## Envelope

The exact envelope binds adapter, workflow, revision, external execution, event identity, sequence, lifecycle claim, correlation, idempotency, occurrence time, and either a payload digest or opaque detail reference. Unknown fields and inline payloads are rejected.

Lifecycle claims are `accepted`, `running`, `succeeded`, `failed`, or `cancelled`. They remain external claims regardless of HTTP acceptance.

## Replay And Conflicts

An identical authenticated retry returns the original receipt without adding a trace, event, or transition. Reuse of an event ID, idempotency key, or execution sequence with different bytes returns `RUNTIME_EVENT_IDENTITY_CONFLICT` and preserves a separate immutable conflict record.

Trace projection follows the highest external event sequence, not arrival order. Delayed, out-of-order, regressed, and conflicting terminal claims remain visible in history.

## CLI

```powershell
$env:ALPHONSE_URL="http://127.0.0.1:3000"
$env:ALPHONSE_RUNTIME_ADAPTER_KEY_ID="fixture-runtime-key-v1"
$env:ALPHONSE_RUNTIME_ADAPTER_SECRET="<local adapter secret>"
npm run diagnostic:cli -- adapter-contract
npm run diagnostic:cli -- receive-event path\to\runtime-event.json

$env:ALPHONSE_TOKEN="<bootstrap operator token>"
npm run diagnostic:cli -- get-trace <trace-id>
npm run diagnostic:cli -- get-event-conflict <conflict-id>
```
