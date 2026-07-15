# 03 - Observe the Wrong n8n Inventory Execution

**What to build:** A customer-owned n8n instance runs the deterministic inventory follow-up workflow, finishes successfully with a false delay draft, and reports the exact execution to Alphonse through the trusted first-party n8n Operational Package.

**Blocked by:** 02 - Preserve One Signed External Activity Trace.

**Status:** completed

- [x] Documented local setup starts n8n as a separately operated customer-owned service beside Alphonse Node.
- [x] The first-party n8n Operational Package exports a conforming Workflow Runtime Adapter with version, compatibility, mappings, fingerprint rules, health checks, and tests.
- [x] An importable Event Reporter subworkflow uses only standard n8n Code, HTTP Request, Error Trigger, and subworkflow primitives.
- [x] The reference workflow compares deterministic ERP and storefront fixtures, classifies risk, drafts a follow-up, and routes it only to local review.
- [x] The seeded mapping defect converts a missing ERP SKU into zero inventory and produces a false delay draft while n8n reports successful completion.
- [x] The reported trace resolves to the exact defective workflow JSON, n8n/runtime identity, node versions, model declaration, and configuration fingerprint.
- [x] Alphonse stores no n8n integration credential; credential custody remains in n8n.
- [x] Detailed execution data is not pushed during routine reporting.
- [x] Adapter health distinguishes broken reporting from absence of workflow executions.
- [x] No real customer email, inventory write, AWS action, or direct n8n database access occurs.
- [x] A black-box check starts from imported workflows and ends with an inspectable successful-but-wrong External Activity Trace.

## Verification

- `npm test` - 110/110 pass.
- `npm run test:v0.2-ticket-02` - prior signed-trace behavior remains intact.
- `npm run test:v0.2-ticket-03` - two workflows imported into real n8n 2.25.7; successful-but-wrong trace preserved; zero Kernel Runs or external effects.
