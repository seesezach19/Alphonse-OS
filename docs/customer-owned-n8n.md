# Customer-owned n8n reference runtime

Ticket 03 runs n8n beside Alphonse as a separately operated customer service. The pinned image and named `n8n-customer-data` volume belong to the customer runtime boundary. Alphonse does not read n8n's database or hold provider credentials configured in n8n.

## Local proof

Run:

```powershell
npm run test:v0.2-ticket-03
```

The check builds Alphonse, imports both package workflows through n8n's public CLI, executes the defective inventory workflow through n8n, and inspects the resulting External Activity Trace through Alphonse's public diagnostic API.

The fixture intentionally treats an absent ERP SKU as zero inventory. n8n therefore succeeds while producing a false delay draft. Delivery remains `local_review`; no email, inventory write, AWS action, or other external effect is configured.

## Custody boundary

- Provider credentials remain in customer-owned n8n credential storage.
- The reporting HMAC secret is runtime configuration, never revision material or event payload.
- Routine reporting sends identity, lifecycle, correlation, and a payload digest only.
- Alphonse never queries the n8n database.
- Runtime reachability, reporting reachability, and absence of workflow activity are separate health facts.

The package also runs a narrow authenticated detail adapter beside n8n. Alphonse requests only declared fields for an active Diagnostic Case. Provider credentials and direct n8n database access remain outside Alphonse; package extraction and redaction run before durable bundle storage.

The reference setup is acceptance infrastructure, not a production credential-management prescription.
