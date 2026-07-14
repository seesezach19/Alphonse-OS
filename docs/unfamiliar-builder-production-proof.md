# Unfamiliar-Builder Production Proof

Status: qualification kit implemented; proof not yet passed.

Ticket 11 requires external facts that automation cannot honestly manufacture:
an unfamiliar human Builder, measured attention, a user-selected real effect,
an operator explanation, and five external builder reviews.

## Prepare

1. Select a technically capable Builder who has not read Kernel source/internal
   schemas and has not built an Operational Package.
2. Give the Builder an isolated workspace containing only `proof/public-builder-brief.md`,
   public platform documentation, and the versioned Builder Toolkit. Do not
   expose this repository or prior inventory artifacts.
3. Start a clean local Kernel/Data Plane and confirm Butler contains no inventory
   Package.
4. Run `npm run proof:snapshot` as the operator. Record both digests in the proof
   packet and repeat after the workflow.
5. Copy `proof/ticket-11-proof.template.json` to a session-specific untracked
   proof packet. The template is deliberately non-qualifying until real facts
   replace every placeholder.

## Run

- Start workflow and human-attention clocks when the plain-language workflow is
  given to the Builder.
- Permit only public protocol, documentation, Toolkit, running environment, and
  authorized source-system access.
- Record human attention separately from agent runtime, waits, and environment
  setup.
- Require a distinct target runtime/passport with no conversation history.
- Inject and resolve staging timeout-after-dispatch before considering
  production authority.

The user must select a real, low-risk, reversible non-AWS production target and
exact effect. Deployment authority binds `effect_limits[].system`; effect
admission rejects any different system. The trusted adapter and credential
binding must be separately reviewed for that exact target. No production action
occurs merely by running the qualification verifier.

## Explain And Review

From Butler alone, the Business Operator records explanations for identity,
intent, versions, context, authority, effect, evidence, uncertainty, recovery,
and final accountability.

Five distinct external agent builders then review the proof. Each review records
what they understood, requested tests, whether they would supply a workflow, and
whether they would pay for workflow implementation. AI subagents do not count as
these market reviews.

## Verify

Set the operator credential outside the packet, then run:

```text
KERNEL_OPERATOR_TOKEN=<credential>
npm run qualify:ticket-11 -- proof/ticket-11-proof.json
```

The verifier checks packet integrity and exact public Handoff, Recovery Case,
Effect, Run, Evidence, and Butler projections. `qualified: true` is the only pass
result. Direct SQL, authority bypass, hidden scaffolding, secret copying,
duplicate uncertain effects, erased failure history, or missing external proof
fails qualification.
