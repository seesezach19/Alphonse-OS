# Alphonse V0.2 Design-Partner Pilot

This packet is the complete public starting material for one cold unfamiliar-operator qualification. The operator
must not receive repository access, internal schemas, migrations, prior session transcripts, or private setup notes.
The qualified release archive is identified in `pilot-plan.json`; verify its manifest, SBOM, provenance, and archive
digests before installation.

The pilot is not complete merely because this packet builds or the local qualification is green. Completion requires
one real agency, one real client workflow, a real incident, one independently verified Owner-authorized live repair,
a client-useful assurance bundle, and the agency's pre-agreed paid-retention decision.

## Roles

- Unfamiliar Operator: installs and operates from this packet only; records attention and friction.
- Agency Owner: selects the workflow, signs the pilot terms, and performs named-Owner decisions.
- Client Owner: consents to the target and reviews the final assurance bundle and limitations.
- Repair Worker: proposes an inactive repair candidate; it cannot verify or promote.
- Independent Verifier: tests exact original/candidate artifacts; it cannot promote.
- Alphonse support: may explain public documentation and coordinate recovery, but receives no standing customer
  credential or authority.

## Before The Clock Starts

1. Apply every hard gate in `WORKFLOW-SELECTION.md`. Reject rather than waive a failed gate.
2. Have the agency and client complete `PILOT-AGREEMENT.md` before access or installation. A partner-specific copy of
   `pilot-plan.json` must change `status` to `partner_precommitted`; record its SHA-256 digest.
3. Install a managed TLS certificate, generate customer-held credentials, establish a tested encrypted backup, and
   retain the target's exact rollback reference.
4. Give the unfamiliar operator only this packet, the pinned release archive and sidecars, the live Console URL, and
   separately delivered role credentials. Never place credentials in the packet or evidence JSON.
5. Start the workflow clock and human-attention clock when the operator receives the materials.

## Cold Journey

The operator performs these steps in this exact order and records one public evidence reference and completion time
for each in `pilot-evidence.template.json`:

1. `install` — follow `RELEASE-OPERATOR.md`; verify TLS, health, role boundaries, disk status, and backup readiness.
2. `onboard` — discover and select the approved existing n8n workflow; compile and approve exact coverage without
   granting execution authority.
3. `observe` — wait for or safely reproduce the agreed real behavioral incident. Transport success alone is not a
   business-success claim.
4. `diagnose` — freeze evidence and dispatch only a bounded diagnostic assignment. Preserve uncertainty and limits.
5. `repair` — create one inactive target-native candidate. The Repair Worker receives no promotion authority.
6. `verify` — use the distinct verifier on the exact candidate, original defect, and retained regressions.
7. `authorize` — the named customer Owner reviews candidate, verification, exact target/base, and recovery reference.
8. `target_confirm` — apply once, then confirm exact target state. If the result is uncertain, reconcile read-only
   before any retry. Use separately authorized rollback when required.
9. `assurance_export` — export the exact evidence and limitations, then have the real client review it.

Use the Console for role-appropriate work and the public Kernel/Diagnostic operations for exact identifiers. Direct
SQL, hidden repository scripts, test-only adapter controls, copied secrets, or an erased failure history disqualify the
session. A documentation gap is a finding: stop, record it as an undocumented step, fix the public packet, reset the
environment, and rerun with a different unfamiliar operator. Qualification permits zero undocumented steps.

## Friction Record

For every interruption, record the journey step, start/end time, whether human attention was active, the exact public
material consulted, the observed error/code, and the resolution. Separate environment/setup time, agent runtime,
external waits, and human attention. Do not round all elapsed time into "operator time."

## Qualification

From a source checkout, the packet itself can be checked without external facts:

```text
node scripts/build-pilot-packet.js
node scripts/qualify-design-partner-pilot.js pilot/v0.2.0/pilot-plan.json
```

For the real session, run against an untracked partner-specific plan and evidence file:

```text
node scripts/qualify-design-partner-pilot.js /path/to/precommitted-plan.json /path/to/pilot-evidence.json
```

`qualified: true` is the only closure result. A prepared packet, simulated operator, local fixture, pending payment
decision, verbal interest, or unpaid continuation does not close the commercial gate.
