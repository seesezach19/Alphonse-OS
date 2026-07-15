# User-Space Upgrades

Ticket 14 upgrades exact Package and Deployment versions without silently changing active user space.

## Boundary

Semantic version expresses publisher intent; Kernel compares exact protocol, dependency, export, schema, adapter, Context, authority, Evidence, and recovery semantics. Breaking exports install beside the old major version. Existing Runs remain bound to their original Execution Envelope, Package, Skill, Capability Activation, Context Receipts, limits, and obligations.

Kernel records migration lifecycle and receipts only. Package-owned state payloads stay in the owning Data Plane. Upgrade migration cannot perform external effects or store business payloads, credentials, or secrets.

## Lifecycle

1. Compatibility analysis binds exact current and target Deployments, deployment bindings, and every compatibility dimension. Breaking contracts require a strictly newer Package major installed side by side.
2. An immutable Upgrade Plan binds versions, dependency/contract diff, ordered migration checkpoints, pinned in-flight Runs, deterministic canary policy, verification, repair, and retirement conditions.
3. Package-owned migration records Data Plane-signed ordered checkpoints and resumes from the next durable ordinal after interruption.
4. Verification requires a signed receipt binding every declared checkpoint, invariant, acceptance criterion, and zero undeclared Effects.
5. Deterministic canary selection stores routing-key digests, never raw routing keys. Every gate result is Data Plane-signed; failed gates pause target admission.
6. Exact target activation follows a passed canary. Authority-equivalent upgrades require an unexpired immutable policy bound to the exact Compatibility Report and equivalence digest; changed authority requires fresh exact business approval.
7. Recovery distinguishes Deployment rollback, forward repair, and compensation. Forward repair must bind the exact deployed repair Capability; unbound or human remediation is compensation. Conditional rollback is signed and constrained by declared reality and time boundaries. Repair verification binds the exact unresolved action and state revision, preventing receipt reuse across incidents. Incompatible real-world changes cannot be described as rollback, and rollback remains blocked until a signed repair-verification receipt proves compatible reality.
8. Old Package retirement blocks while active consumers, Runs, obligations, handoffs, Evidence, Recovery Cases, upgrade recovery, or retention windows reference it. Activation and Run admission reject retired versions under the same package lock. Artifacts and history remain preserved.

Legacy unsigned migration verifications are invalidated before activation. Their completed checkpoints remain durable; the operator re-attests verification, then reruns the canary. Active historical upgrades are never rewound.

## Local Verification

```powershell
npm run test:ticket-14
```

The isolated Docker acceptance proves side-by-side breaking versions, restart-resumable migration, signed reproducible canary cohorts and pause, original-version Run completion after target activation, report-bound policy and fresh-approval paths, verified repair/rollback semantics, command replay, and retirement blockers. It performs no AWS activity.
