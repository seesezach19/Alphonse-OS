# Governed Support Coordination

Ticket 16 lets a hosted coordinator help operate a customer Environment without receiving standing business authority.

## Boundary

- Environment health is signed, coarse, short-lived, and payload-free.
- Missing or expired health is `unknown`; it is never inferred as failure.
- A support request binds one Environment, named support identity, diagnostic scopes, duration, reason, and expiry.
- The customer approves the request locally and supplies a SHA-256 digest of a customer-generated bearer credential.
- The raw credential is never stored by Kernel or sent to the coordinator.
- A Support Passport is read-only, expiring, binding-scoped, and invalid immediately after local binding revocation.
- Hosted coordination receives the signed Passport notice, never the credential or diagnostic content.

## Diagnostics

Diagnostic scopes are `kernel_health`, `runtime_health`, `host_health`, `storage_health`, and `coordination_health`.
Kernel creates only explicitly requested scopes, excludes business payloads, credentials, prompts, and actor activity,
encrypts the immutable bundle with AES-256-GCM, and caps expiry at the Passport expiry. Every successful read appends an
immutable access record. Customer operators can inspect metadata, redaction policy, expiry, and the full access log.

## Remediation

Support access cannot dispatch work. A customer may ledger a remediation authorization only after Kernel revalidates
one exact current business approval and Capability Activation. The authorization starts no Run and causes no external
effect; normal execution and effect protocols still apply.

## Host Quarantine

Quarantine makes a host ineligible for placement, revokes its current key, records a replacement key identity, and
advances the Environment execution epoch. Existing workload grants are fenced by the epoch; new placement is denied by
the substrate admission operation.

## Revocation

Local Coordinator Binding revocation immediately invalidates support access. Outbound revocation sync removes the
Environment descriptor and support visibility from the hosted projection. Local authority, command receipts, support
history, diagnostic metadata, and access records remain customer-owned and available locally.

Run the isolated proof:

```powershell
npm run test:ticket-16
```
