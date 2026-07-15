# Customer-Controlled Repair Workers

Alphonse commissions repair intelligence; it does not host it. A Repair Worker may be Codex, another coding agent, or a deterministic test process. Every worker uses the same Diagnostic Protocol.

## Boundary

- The customer creates a short-lived Agent Passport and confirms a `repair_work` Work Intent in Kernel.
- The worker authenticates with its Agent token and registers the Passport and Work Intent with the Diagnostic Plane.
- A customer operator creates one immutable Repair Task from one demonstrated Reproduction Bundle.
- The worker claims the task, retrieves only the two task-bound artifacts, and materializes a disposable workspace.
- The worker submits candidate bytes, a targeted regression, logs, runtime attribution, and an intended behavior change.
- Alphonse hashes and stores accepted artifacts. It never receives the worker's model, Codex, source-control, or repository credential.
- Repair Worker authority excludes independent verification, Owner authorization, promotion, and rollback.

Tasks are immutable attempts. Release, failure, cancellation, or lease expiry fences later submission. Retrying creates a new task with a new task ID and lease epoch.

## Public Operations

The worker-facing sequence is:

1. `diagnostic.repair_worker.register`
2. `diagnostic.repair_task.discover`
3. `diagnostic.repair_task.claim`
4. `diagnostic.repair_workspace_artifact.get`
5. `diagnostic.repair_task.heartbeat`
6. `diagnostic.repair_candidate.submit`, `diagnostic.repair_task.fail`, or `diagnostic.repair_task.release`

Customer operations create, inspect, and cancel tasks. They use the same HTTP and CLI contracts and have no hidden database path.

## Codex Attachment

Codex runs in the customer's environment with customer-owned authentication. Do not place Codex or provider tokens in command JSON.

Set these only in the local Codex process:

```powershell
$env:ALPHONSE_URL = "http://127.0.0.1:3000"
$env:ALPHONSE_AGENT_TOKEN = "<short-lived Agent Passport token>"
```

Register and discover work:

```powershell
node src/diagnostic-cli.js register-repair-worker worker-registration.json
node src/diagnostic-cli.js discover-repair-tasks
node src/diagnostic-cli.js claim-repair-task claim-command.json
```

The reusable `RepairWorkerClient` in `src/repair-worker-client.js` performs those same calls. Its `withWorkspace` helper retrieves exact artifacts into a private temporary directory and deletes the directory in `finally`, including worker failure.

The Codex prompt should contain the task objective and instruct Codex to read only the materialized workspace, implement the intended repair, add the targeted regression, and return structured output matching `diagnostic.repair_candidate.submit`. Verification and promotion remain separate processes.

## Failure Semantics

- Invalid output terminates the attempt visibly without creating a candidate.
- Missing heartbeat does not grant an extension; elapsed lease time projects as expired.
- Wrong task, worker, or lease epoch fails closed.
- Identical command retry returns the original receipt. Reusing its command ID with changed bytes returns `IDEMPOTENCY_CONFLICT`.
- A second candidate for the same task must be byte-identical or returns `REPAIR_CANDIDATE_CONFLICT`.
