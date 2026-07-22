"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConsoleControlRequest, ConsoleRole, ConsoleSessionState, ConsoleSnapshot } from "../lib/live-types";

type ViewId = "overview" | "workflows" | "cases" | "workers" | "evidence" | "system";
type LoadState = "loading" | "fresh" | "stale" | "unavailable";

const views: Array<{ id: ViewId; label: string }> = [
  { id: "overview", label: "Overview" }, { id: "workflows", label: "Workflows" },
  { id: "cases", label: "Diagnostic cases" }, { id: "workers", label: "Workers" },
  { id: "evidence", label: "Evidence" }, { id: "system", label: "System" }
];

function short(value: unknown, length = 18) {
  if (typeof value !== "string") return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function date(value: unknown) {
  if (typeof value !== "string") return "Unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : parsed.toLocaleString();
}

function State({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`live-state live-state-${tone}`}>{children}</span>;
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return <details className="live-details"><summary>{label}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}

function Login({ onAuthenticated }: { onAuthenticated: (session: ConsoleSessionState) => void }) {
  const [role, setRole] = useState<ConsoleRole>("viewer");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    const response = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, credential }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error?.message ?? "Authentication failed.");
    setCredential(""); onAuthenticated(body);
  }
  return <main className="live-auth">
    <section aria-labelledby="live-sign-in-title">
      <p className="live-kicker">Alphonse Operations Console</p>
      <h1 id="live-sign-in-title">Authoritative live records</h1>
      <p>Sign in with a Console role. Browser sessions are signed and HttpOnly; Kernel credentials stay server-side.</p>
      <form onSubmit={submit}>
        <label>Role<select value={role} onChange={(event) => setRole(event.target.value as ConsoleRole)}>
          <option value="viewer">Viewer</option><option value="operator">Operator</option><option value="owner">Owner</option>
        </select></label>
        <label>Console credential<input aria-label="Console credential" type="password" autoComplete="current-password"
          value={credential} onChange={(event) => setCredential(event.target.value)} required /></label>
        {error && <p role="alert" className="live-error">{error}</p>}
        <button className="live-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="live-boundary">This surface reads Kernel and Diagnostic projections. It owns no workflow or case truth.</p>
    </section>
  </main>;
}

function ControlPanel({ role, resource, targetId, currentState, onAdmitted }: {
  role: ConsoleRole; resource: "worker" | "workflow"; targetId: string; currentState: string;
  onAdmitted: (message: string) => Promise<void>;
}) {
  const blocked = resource === "worker" ? currentState === "suspended" : currentState === "quarantined";
  const action = resource === "worker" ? (blocked ? "resume" : "suspend") : (blocked ? "release" : "quarantine");
  const [reason, setReason] = useState<ConsoleControlRequest["reason_code"]>("emergency_operator_action");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const forbidden = role === "viewer" || (blocked && role !== "owner");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const response = await fetch("/api/console/actions", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource, target_id: targetId, action, reason_code: reason, rationale }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setMessage(body.error?.message ?? "Kernel did not admit the control.");
    setRationale(""); setMessage("Control admitted by the Kernel."); await onAdmitted(`${action} admitted`);
  }
  if (forbidden) return <p className="live-boundary">{role === "viewer" ? "Viewer: read-only session."
    : "Only an Owner may resume or release an emergency control."}</p>;
  return <form className="live-control" onSubmit={submit}>
    <strong>{action[0].toUpperCase() + action.slice(1)}</strong>
    <label>Reason<select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
      <option value="emergency_operator_action">Emergency operator action</option>
      <option value="security_concern">Security concern</option><option value="unexpected_behavior">Unexpected behavior</option>
      <option value="manual_recovery">Manual recovery</option>
    </select></label>
    <label>Rationale<input value={rationale} onChange={(event) => setRationale(event.target.value)}
      minLength={1} maxLength={1000} required /></label>
    <button className={blocked ? "live-primary" : "live-danger"} disabled={busy}>{busy ? "Awaiting admission…" : action}</button>
    {message && <span role="status">{message}</span>}
  </form>;
}

function Overview({ snapshot }: { snapshot: ConsoleSnapshot }) {
  const quarantined = snapshot.workflows.filter((item) => item.quarantine.state === "quarantined").length;
  const suspended = snapshot.workers.filter((item) => item.control?.state === "suspended").length;
  const uncertain = snapshot.cases.filter((item) => item.promotion &&
    (item.promotion as Record<string, unknown>).state === "uncertain").length;
  return <>
    <div className="live-metrics">
      <article><span>Workflows</span><strong>{snapshot.workflows.length}</strong><small>{quarantined} quarantined</small></article>
      <article><span>Diagnostic cases</span><strong>{snapshot.cases.length}</strong><small>{uncertain} uncertain</small></article>
      <article><span>Workers</span><strong>{snapshot.workers.length}</strong><small>{suspended} suspended</small></article>
      <article><span>Evidence records</span><strong>{snapshot.evidence.length}</strong><small>{snapshot.evidence.filter((item) => item.availability === "revoked").length} revoked</small></article>
    </div>
    <section className="live-panel"><h2>Attention and recovery</h2>
      {[...snapshot.workflows.filter((item) => item.quarantine.state === "quarantined").map((item) =>
        <p key={item.workflow_id}><State tone="danger">Quarantined</State> {item.display_name} <code>{item.workflow_id}</code></p>),
      ...snapshot.cases.filter((item) => item.state === "uncertain").map((item) =>
        <p key={item.case_id}><State tone="warning">Uncertain</State> {item.summary} <code>{item.case_id}</code></p>)]}
      {!quarantined && !uncertain && <p className="live-muted">No admitted quarantine or uncertain Promotion requires attention.</p>}
    </section>
    <section className="live-panel"><h2>Snapshot limitations</h2><ul>{snapshot.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
  </>;
}

function Workflows({ snapshot, refresh }: { snapshot: ConsoleSnapshot; refresh: () => Promise<void> }) {
  return <div className="live-list">{snapshot.workflows.map((item) => <article className="live-panel" key={item.workflow_id}>
    <div className="live-title"><div><h2>{item.display_name}</h2><code>{item.workflow_id}</code></div>
      <State tone={item.quarantine.state === "quarantined" ? "danger" : "good"}>{item.quarantine.state}</State></div>
    <p>{item.objective}</p>
    <dl><div><dt>Revision</dt><dd>{item.revision?.revision_id ?? "Unavailable"}</dd></div>
      <div><dt>Material digest</dt><dd title={item.revision?.material_digest}>{short(item.revision?.material_digest)}</dd></div>
      <div><dt>Coverage</dt><dd>{item.coverage.onboarding_state} / {item.coverage.reconciliation_state}</dd></div>
      <div><dt>Cases</dt><dd>{item.case_ids.length}</dd></div></dl>
    {item.coverage.limitations.map((value) => <p className="live-warning" key={value}>{value}</p>)}
    <JsonDetails label="Exact identity and legal operations" value={{ identity_digest: item.identity_digest,
      legal_next_operations: item.legal_next_operations, quarantine: item.quarantine }} />
    <ControlPanel role={snapshot.session.role} resource="workflow" targetId={item.workflow_id}
      currentState={item.quarantine.state} onAdmitted={async () => refresh()} />
  </article>)}</div>;
}

function Cases({ snapshot }: { snapshot: ConsoleSnapshot }) {
  return <div className="live-list">{snapshot.cases.map((item) => <article className="live-panel" key={item.case_id}>
    <div className="live-title"><div><h2>{item.summary}</h2><code>{item.case_id}</code></div>
      <State tone={item.state === "uncertain" || item.state === "quarantined" ? "warning" : "neutral"}>{item.state}</State></div>
    <p>Workflow <code>{item.workflow_id}</code> · revision <code>{item.revision_id}</code></p>
    <div className="live-truth"><div><span>Expected</span><p>{item.expected_behavior ?? "Not confirmed"}</p></div>
      <div><span>Actual</span><p>{item.actual_behavior ?? "Not confirmed"}</p></div></div>
    <ol className="live-lifecycle">{item.lifecycle.map((stage) => <li key={stage.stage}
      className={stage.complete ? "complete" : ""}><span>{stage.complete ? "✓" : "·"}</span><div><strong>{stage.stage}</strong><small>{stage.detail}</small></div></li>)}</ol>
    {item.repair && <p><State tone="warning">Repair proposal — not applied</State></p>}
    {item.limitations.map((value) => <p className="live-warning" key={value}>{value}</p>)}
    <JsonDetails label="Diagnosis, repair, verification, Promotion, and recovery evidence"
      value={{ report_digest: item.report_digest, diagnosis: item.diagnosis, repair: item.repair,
        verification: item.verification, promotion: item.promotion, legal_next_operations: item.legal_next_operations }} />
  </article>)}</div>;
}

function Workers({ snapshot, refresh }: { snapshot: ConsoleSnapshot; refresh: () => Promise<void> }) {
  return <div className="live-list">{snapshot.workers.map((item) => <article className="live-panel" key={`${item.worker_kind}:${item.worker_id}`}>
    <div className="live-title"><div><h2>{item.worker_kind.replaceAll("_", " ")}</h2><code>{item.worker_id}</code></div>
      <State tone={(item.effective_state ?? item.state) === "suspended" ? "danger" : "neutral"}>
        {item.effective_state ?? item.state ?? "recorded"}</State></div>
    <JsonDetails label="Identity, lease, evidence, and authority" value={item} />
    {item.worker_kind === "repair_worker" && item.control && <ControlPanel role={snapshot.session.role} resource="worker"
      targetId={item.worker_id} currentState={item.control.state} onAdmitted={async () => refresh()} />}
  </article>)}</div>;
}

function Evidence({ snapshot }: { snapshot: ConsoleSnapshot }) {
  return <section className="live-panel live-table-wrap"><h2>Content-addressed evidence</h2><table><thead><tr>
    <th>Digest</th><th>Type</th><th>Bytes</th><th>Availability</th><th>Recorded</th></tr></thead><tbody>
    {snapshot.evidence.map((item) => <tr key={item.artifact_digest}><td><code title={item.artifact_digest}>{short(item.artifact_digest, 26)}</code></td>
      <td>{item.media_type}</td><td>{item.size_bytes}</td><td><State tone={item.availability === "revoked" ? "danger" : "good"}>{item.availability}</State>
        {item.limitation && <small>{item.limitation}</small>}</td><td>{date(item.created_at)}</td></tr>)}</tbody></table></section>;
}

function System({ snapshot }: { snapshot: ConsoleSnapshot }) {
  return <div className="live-list"><section className="live-panel"><h2>Authority boundary</h2>
    <dl><div><dt>Source</dt><dd>{snapshot.source.system}</dd></div><div><dt>Projection</dt><dd>{snapshot.source.projection}</dd></div>
      <div><dt>Authoritative</dt><dd>{String(snapshot.source.authoritative)}</dd></div>
      <div><dt>Console database authority</dt><dd>{String(snapshot.source.direct_database_authority)}</dd></div>
      <div><dt>Session subject</dt><dd>{snapshot.session.subject.id}</dd></div></dl></section>
    <section className="live-panel"><h2>Maintenance assurances</h2>{snapshot.assurances.map((item) => <p key={item.export_id}>
      <code>{item.export_id}</code> · {item.workflow_id} · <span title={item.assurance_digest}>{short(item.assurance_digest)}</span></p>)}
      {!snapshot.assurances.length && <p className="live-muted">No immutable assurance export is recorded.</p>}</section>
    <section className="live-panel"><h2>Session legal operations</h2><ul>{snapshot.legal_next_operations.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
      {!snapshot.legal_next_operations.length && <p className="live-muted">Viewer sessions have no control operations.</p>}</section></div>;
}

export function LiveConsoleApp() {
  const [session, setSession] = useState<ConsoleSessionState | null>(null);
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("overview");
  const refresh = useCallback(async () => {
    setLoadState((state) => snapshot ? "stale" : state === "fresh" ? "stale" : "loading"); setError(null);
    const response = await fetch("/api/console/snapshot", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) { setLoadState("unavailable"); setError(body.error?.message ?? "Authoritative snapshot unavailable."); return; }
    setSnapshot(body.console_snapshot); setLoadState("fresh");
  }, [snapshot]);
  useEffect(() => { fetch("/api/session", { cache: "no-store" }).then((response) => response.json())
    .then((body) => { setSession(body); if (body.authenticated) return refresh(); setLoadState("loading"); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ageState = useMemo(() => snapshot && Date.now() - Date.parse(snapshot.generated_at) > 60_000 ? "stale" : loadState,
    [snapshot, loadState]);
  async function signOut() { await fetch("/api/session", { method: "DELETE" }); setSession({ authenticated: false }); setSnapshot(null); }
  if (!session) return <main className="live-loading" aria-busy="true">Loading Console session…</main>;
  if (!session.authenticated) return <Login onAuthenticated={(value) => { setSession(value); setSnapshot(null);
    setLoadState("loading"); setTimeout(() => void refresh(), 0); }} />;
  return <div className="live-shell">
    <aside><div className="live-brand"><strong>Alphonse</strong><span>Operations console</span></div>
      <nav aria-label="Console views">{views.map((item) => <button key={item.id} aria-current={view === item.id ? "page" : undefined}
        onClick={() => setView(item.id)}>{item.label}</button>)}</nav>
      <div className="live-sidebar-boundary"><strong>Live mode</strong><span>Kernel-backed · no fixture records</span></div></aside>
    <main><header><div><span className="live-kicker">Authoritative projection</span><h1>{views.find((item) => item.id === view)?.label}</h1></div>
      <div className="live-header-meta"><State tone={ageState === "fresh" ? "good" : ageState === "stale" ? "warning" : "danger"}>{ageState}</State>
        <span>{snapshot ? date(snapshot.generated_at) : "Awaiting snapshot"}</span><State>{session.role}</State>
        <button onClick={() => void refresh()}>Refresh</button><button onClick={() => void signOut()}>Sign out</button></div></header>
      <div className="live-content">
        <div className="live-mode-banner"><strong>LIVE · AUTHORITATIVE RECORDS</strong><span>Success appears only after Kernel admission. Proposals and uncertainty remain labeled.</span></div>
        {error && <div className="live-unavailable" role="alert"><strong>Authoritative source unavailable</strong><span>{error}</span>
          {snapshot && <small>Showing the last snapshot as stale; no control is presented as successful.</small>}</div>}
        {!snapshot && loadState === "loading" && <p aria-busy="true">Loading customer-safe Kernel records…</p>}
        {!snapshot && loadState === "unavailable" && <button className="live-primary" onClick={() => void refresh()}>Retry</button>}
        {snapshot && view === "overview" && <Overview snapshot={snapshot} />}
        {snapshot && view === "workflows" && <Workflows snapshot={snapshot} refresh={refresh} />}
        {snapshot && view === "cases" && <Cases snapshot={snapshot} />}
        {snapshot && view === "workers" && <Workers snapshot={snapshot} refresh={refresh} />}
        {snapshot && view === "evidence" && <Evidence snapshot={snapshot} />}
        {snapshot && view === "system" && <System snapshot={snapshot} />}
      </div>
    </main>
  </div>;
}
