"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Activity,
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Blocks,
  Bot,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  ExternalLink,
  FileCheck2,
  FileSearch,
  Fingerprint,
  Gauge,
  GitCompareArrows,
  HardDrive,
  Inbox,
  Info,
  KeyRound,
  ListFilter,
  Menu,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelRight,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareActivity,
  UserRound,
  UsersRound,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import {
  artifacts,
  cases,
  services,
  workers,
  workflows,
  type CaseEvent,
  type DiagnosticCase,
  type PageId,
  type Tone,
} from "../lib/demo-data";

const nav = [
  { id: "overview" as const, label: "Overview", icon: Inbox },
  { id: "workflows" as const, label: "Workflows", icon: Workflow },
  { id: "cases" as const, label: "Diagnostic cases", icon: FileSearch },
  { id: "workers" as const, label: "Workers", icon: Bot },
  { id: "evidence" as const, label: "Evidence", icon: Archive },
  { id: "system" as const, label: "System", icon: Server },
];

const moduleLabels = {
  decisions: "Needs decision",
  investigation: "Needs investigation",
  active: "Active repair work",
  freshness: "Workflow freshness",
  outcomes: "Recent outcomes",
  health: "System health",
};

type ModuleId = keyof typeof moduleLabels;
const defaultModules: ModuleId[] = ["decisions", "investigation", "active", "freshness", "outcomes", "health"];

function statusIcon(tone: Tone) {
  if (tone === "good") return CheckCircle2;
  if (tone === "danger") return AlertCircle;
  if (tone === "warning") return Clock3;
  if (tone === "advisory") return Sparkles;
  if (tone === "mint") return CircleDot;
  return Info;
}

function Status({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  const Icon = statusIcon(tone);
  return (
    <span className={`status status-${tone}`}>
      <Icon size={12} aria-hidden="true" />
      {children}
    </span>
  );
}

function Mono({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span className="mono" title={title}>{children}</span>;
}

function IconButton({ label, children, onClick, active = false }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return <button className={`icon-button ${active ? "is-active" : ""}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function AlphonseMark() {
  return (
    <div className="brand-mark">
      <Image src="/logo_transparent.png" alt="Alphonse" width={44} height={42} priority />
    </div>
  );
}

function Sidebar({ page, setPage, open, close }: { page: PageId; setPage: (page: PageId) => void; open: boolean; close: () => void }) {
  return (
    <>
      {open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={close} />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <AlphonseMark />
          <div><strong>Alphonse</strong><span>Operations console</span></div>
          <IconButton label="Close navigation" onClick={close}><PanelLeftClose size={17} /></IconButton>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Operate</p>
          {nav.slice(0, 3).map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={`nav-item ${page === item.id ? "nav-active" : ""}`} onClick={() => { setPage(item.id); close(); }}>
                <Icon size={17} />
                <span>{item.label}</span>
                {item.id === "cases" && <span className="nav-count">3</span>}
              </button>
            );
          })}
          <p className="nav-label nav-label-spaced">Manage</p>
          {nav.slice(3).map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={`nav-item ${page === item.id ? "nav-active" : ""}`} onClick={() => { setPage(item.id); close(); }}>
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="node-identity">
            <div className="node-avatar">LN</div>
            <div><strong>Demo node</strong><span>fixture-backed console</span></div>
          </div>
          <div className="custody-note"><Info size={14} /><span>No live system connection</span></div>
        </div>
      </aside>
    </>
  );
}

function Header({ page, openMenu, openSearch }: { page: PageId; openMenu: () => void; openSearch: () => void }) {
  const label = nav.find((item) => item.id === page)?.label ?? "Overview";
  return (
    <header className="topbar">
      <IconButton label="Open navigation" onClick={openMenu}><Menu size={18} /></IconButton>
      <div className="crumb"><span>local-node</span><ChevronRight size={13} /><strong>{label}</strong></div>
      <button className="search-trigger" onClick={openSearch}>
        <Search size={15} />
        <span>Search cases, workflows, evidence</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="governance-mode" title="Kernel admission and accountability boundaries are active">
        <ShieldCheck size={14} />
        <span>Governance</span>
        <strong>Enforced</strong>
      </div>
      <div className="demo-mode" title="This console is rendering fixture data, not independently observed system state">
        <Box size={14} />
        <span>Demo data</span>
      </div>
      <div className="topbar-health">
        <span>Kernel <em>Fixture</em></span>
        <span>Diagnostic <em>Fixture</em></span>
        <span>n8n <em>Not connected</em></span>
      </div>
      <IconButton label="Console settings"><Settings2 size={17} /></IconButton>
    </header>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

type OpenCase = (caseId: string) => void;

function actorInitials(value: string) {
  const name = value.split("/")[0].trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return `${name[0] ?? "A"}${name.at(-1) ?? "I"}`.toUpperCase();
}

function QueueRow({ item, openCase }: { item: DiagnosticCase; openCase: OpenCase }) {
  return (
    <button className="queue-row" onClick={() => openCase(item.id)}>
      <span className={`queue-indicator status-${item.tone}`} />
      <span className="queue-avatar">{actorInitials(item.responsibility)}</span>
      <span className="queue-main"><strong>{item.title}</strong><span>{item.workflow} · {item.shortId}</span></span>
      <span className="queue-owner"><UserRound size={13} />{item.responsibility}</span>
      <span className="queue-age">{item.age}</span>
      <span className="queue-action">{item.nextAction}<ArrowRight size={14} /></span>
    </button>
  );
}

function ModuleFrame({ id, title, subtitle, children, count, open }: { id: ModuleId; title: string; subtitle: string; children: React.ReactNode; count?: number; open: () => void }) {
  const icons = {
    decisions: ShieldCheck,
    investigation: FileSearch,
    active: Wrench,
    freshness: Activity,
    outcomes: CheckCircle2,
    health: Gauge,
  };
  const Icon = icons[id];
  return (
    <section className={`module module-${id}`}>
      <header className="module-header">
        <div className="module-heading">
          <Icon size={18} />
          <div><h2>{title}</h2><p>{subtitle}</p></div>
        </div>
        <div className="module-header-actions">
          {typeof count === "number" && <span className="module-count">{count}</span>}
          <button onClick={open}>View all <ChevronRight size={14} /></button>
        </div>
      </header>
      {children}
    </section>
  );
}

function Overview({ openCase, setPage, moduleOrder, hiddenModules, customize }: { openCase: OpenCase; setPage: (page: PageId) => void; moduleOrder: ModuleId[]; hiddenModules: ModuleId[]; customize: () => void }) {
  const moduleContent: Record<ModuleId, React.ReactNode> = {
    decisions: (
      <ModuleFrame id="decisions" title="Needs decision" subtitle="Exact states waiting for a human" count={2} open={() => openCase(cases[1].id)}>
        <div className="queue-list"><QueueRow item={cases[1]} openCase={openCase} /><QueueRow item={cases[2]} openCase={openCase} /></div>
      </ModuleFrame>
    ),
    investigation: (
      <ModuleFrame id="investigation" title="Needs investigation" subtitle="Demonstrated issues and stale reporting" count={2} open={() => openCase(cases[0].id)}>
        <div className="queue-list"><QueueRow item={cases[0]} openCase={openCase} /></div>
        <button className="quiet-row" onClick={() => setPage("workflows")}><span className="queue-indicator status-danger" /><span className="queue-avatar">ZB</span><span className="queue-main"><strong>Runtime reporting is stale</strong><span>Renewal reconciliation · 18 minutes beyond policy</span></span><span className="queue-owner"><UserRound size={13} />Zach / Builder</span><span className="queue-age">1 hr</span><span className="queue-action">Inspect integration<ArrowRight size={14} /></span></button>
      </ModuleFrame>
    ),
    active: (
      <ModuleFrame id="active" title="Active repair work" subtitle="Bounded work currently in motion" open={() => setPage("cases")}>
        <div className="empty-state"><Wrench size={20} /><div><strong>No active leases</strong><span>Completed and expired attempts remain in case history.</span></div></div>
      </ModuleFrame>
    ),
    freshness: (
      <ModuleFrame id="freshness" title="Workflow freshness" subtitle="Adapter reporting against declared policy" open={() => setPage("workflows")}>
        <div className="compact-list">
          {workflows.map((workflow) => <button key={workflow.id} onClick={() => setPage("workflows")}><span><i className={`health-dot ${workflow.freshness === "Current" ? "good" : "warning"}`} />{workflow.name}</span><Mono>{workflow.freshness}</Mono></button>)}
        </div>
      </ModuleFrame>
    ),
    outcomes: (
      <ModuleFrame id="outcomes" title="Recent outcomes" subtitle="Completed transitions, not new tasks" open={() => setPage("cases")}>
        <div className="activity-mini">
          <div><Check size={14} /><span><strong>Candidate independently verified</strong><small>Lead qualification · 1 hr ago</small></span></div>
          <div><RefreshCw size={14} /><span><strong>Artifact retention completed</strong><small>CASE-0118 · yesterday</small></span></div>
          <div><GitCompareArrows size={14} /><span><strong>Promotion reconciled as not applied</strong><small>Invoice readiness · 2 days ago</small></span></div>
        </div>
      </ModuleFrame>
    ),
    health: (
      <ModuleFrame id="health" title="System health" subtitle="Independent service signals" open={() => setPage("system")}>
        <div className="health-grid">{services.slice(0, 4).map((service) => <button key={service.name} onClick={() => setPage("system")}><i className={`health-dot ${service.tone}`} /><span><strong>{service.name}</strong><small>{service.latency}</small></span></button>)}</div>
      </ModuleFrame>
    ),
  };

  return (
    <main className="page page-overview">
      <PageHeading eyebrow="Operations / local-node" title="Operational overview" description="Human decisions and exceptions across accountable workflows." actions={<><button className="button button-secondary" onClick={customize}><SlidersHorizontal size={15} />Modules</button><button className="button button-primary" onClick={() => openCase(cases[0].id)}>Open priority case<ArrowRight size={15} /></button></>} />
      <div className="summary-strip">
        <div className="summary-decision"><span className="summary-glyph"><ShieldCheck size={19} /></span><span className="summary-copy"><strong>Needs decision</strong><small>Owner action required</small></span><b>2</b><span className="summary-foot"><small>1 owner action</small><i /></span></div>
        <div className="summary-investigation"><span className="summary-glyph"><FileSearch size={19} /></span><span className="summary-copy"><strong>Needs investigation</strong><small>Stale integrations</small></span><b>2</b><span className="summary-foot"><small>1 stale integration</small><i /></span></div>
        <div className="summary-active"><span className="summary-glyph"><Wrench size={19} /></span><span className="summary-copy"><strong>Active repair work</strong><small>No live leases</small></span><b>0</b><span className="summary-foot"><small>Bounded work in motion</small><i /></span></div>
        <div className="summary-uncertain"><span className="summary-glyph"><AlertCircle size={19} /></span><span className="summary-copy"><strong>Uncertain effects</strong><small>Reconciliation only</small></span><b>1</b><span className="summary-foot"><small>1 reconciliation only</small><i /></span></div>
      </div>
      <div className="module-grid">{moduleOrder.filter((id) => !hiddenModules.includes(id)).map((id) => <div key={id} className={`module-slot module-slot-${id}`}>{moduleContent[id]}</div>)}</div>
    </main>
  );
}

function WorkflowsPage({ openCase }: { openCase: OpenCase }) {
  const [selected, setSelected] = useState(workflows[0]);
  return (
    <main className="page">
      <PageHeading eyebrow="Registry / workflows" title="Agent workflows" description="Stable identities, exact revisions, and external runtime reporting." actions={<button className="button button-primary"><Workflow size={15} />Register workflow</button>} />
      <div className="split-layout">
        <section className="panel table-panel">
          <div className="table-toolbar"><div className="filter-input"><Search size={14} /><input aria-label="Search workflows" placeholder="Filter workflows" /></div><button className="button button-secondary"><ListFilter size={14} />All states<ChevronDown size={13} /></button></div>
          <div className="data-table workflow-table">
            <div className="table-head"><span>Workflow</span><span>Revision</span><span>Last activity</span><span>State</span></div>
            {workflows.map((workflow) => <button key={workflow.id} className={selected.id === workflow.id ? "selected" : ""} onClick={() => setSelected(workflow)}><span className="primary-cell"><strong>{workflow.name}</strong><small>{workflow.runtime} · {workflow.openCases} open cases</small></span><Mono>{workflow.revision}</Mono><span>{workflow.lastActivity}</span><Status tone={workflow.tone}>{workflow.state}</Status></button>)}
          </div>
        </section>
        <aside className="panel detail-panel">
          <div className="detail-header"><div className="detail-icon"><Workflow size={19} /></div><div><p className="eyebrow">Workflow</p><h2>{selected.name}</h2></div><IconButton label="Open external runtime"><ExternalLink size={16} /></IconButton></div>
          <Status tone={selected.tone}>{selected.state}</Status>
          <p className="detail-copy">{selected.objective}</p>
          <dl className="definition-list"><div><dt>Stable identity</dt><dd><Mono>{selected.id}</Mono></dd></div><div><dt>Observed revision</dt><dd><Mono>{selected.revision}</Mono></dd></div><div><dt>Runtime</dt><dd>{selected.runtime}</dd></div><div><dt>Reporting freshness</dt><dd>{selected.freshness}</dd></div></dl>
          <div className="detail-section"><h3>Recent activity</h3><div className="mini-timeline"><div><i className="health-dot mint" /><span><strong>Runtime claim received</strong><small>{selected.lastActivity}</small></span></div><div><i className="health-dot good" /><span><strong>Revision identity matched</strong><small>Exact content preserved</small></span></div></div></div>
          {selected.openCases > 0 && <button className="button button-primary button-wide" onClick={() => openCase(cases.find((item) => item.workflowId === selected.id)?.id ?? cases[0].id)}>View open diagnostic case<ArrowRight size={15} /></button>}
        </aside>
      </div>
    </main>
  );
}

function Lifecycle({ item }: { item: DiagnosticCase }) {
  return <div className="lifecycle" aria-label="Diagnostic lifecycle">{item.stages.map((stage, index) => <div className={`life-stage life-${stage.state}`} key={stage.label}><div className="stage-marker">{stage.state === "complete" ? <Check size={13} /> : stage.state === "uncertain" ? <AlertCircle size={13} /> : <span>{index + 1}</span>}</div><div><strong>{stage.label}</strong><span>{stage.detail}</span></div></div>)}</div>;
}

function EventRow({ event, selected, onSelect }: { event: CaseEvent; selected: boolean; onSelect: () => void }) {
  const Icon = statusIcon(event.tone);
  return (
    <button className={`event-row ${selected ? "event-selected" : ""}`} onClick={onSelect}>
      <div className={`event-icon status-${event.tone}`}><Icon size={14} /></div>
      <div className="event-content"><div><strong>{event.title}</strong><Mono>{event.at}</Mono></div><p>{event.detail}</p><span>{event.actor}</span></div>
      <ChevronRight size={15} className="event-chevron" />
    </button>
  );
}

function CaseInspector({ item, event }: { item: DiagnosticCase; event: CaseEvent }) {
  return (
    <aside className="case-inspector">
      <div className="inspector-heading"><div><p className="eyebrow">Selected event</p><h2>{event.title}</h2></div><Status tone={event.tone}>{event.tone === "advisory" ? "Advisory" : event.tone === "danger" ? "Failure" : event.tone === "good" ? "Confirmed" : "Recorded"}</Status></div>
      <p className="inspector-copy">{event.detail}</p>
      {event.facts && <section className="inspector-section"><h3>What this establishes</h3><ul className="fact-list">{event.facts.map((fact) => <li key={fact}><Check size={13} />{fact}</li>)}</ul></section>}
      {event.operation && <section className="inspector-section"><h3>Operation</h3><div className="code-field"><Mono>{event.operation}</Mono><button title="Copy operation identifier">Copy</button></div></section>}
      {event.evidence && <section className="inspector-section"><h3>Evidence reference</h3><button className="evidence-link"><FileCheck2 size={15} /><Mono>{event.evidence}</Mono><ExternalLink size={13} /></button></section>}
      <section className="inspector-section"><h3>Attribution</h3><dl className="definition-list compact"><div><dt>Actor</dt><dd>{event.actor}</dd></div><div><dt>Occurred</dt><dd>Today, {event.at}</dd></div><div><dt>Case</dt><dd><Mono>{item.shortId}</Mono></dd></div><div><dt>Revision</dt><dd><Mono>{item.revision}</Mono></dd></div></dl></section>
      <div className="integrity-note"><Fingerprint size={16} /><div><strong>Immutable history</strong><span>This event remains available if later states change.</span></div></div>
    </aside>
  );
}

function CasesPage({ selectedId, selectCase, openAction }: { selectedId: string; selectCase: (id: string) => void; openAction: (item: DiagnosticCase) => void }) {
  const item = cases.find((entry) => entry.id === selectedId) ?? cases[0];
  const [eventId, setEventId] = useState(item.events[0].id);
  const selectedEvent = item.events.find((event) => event.id === eventId) ?? item.events[0];
  useEffect(() => setEventId(item.events[0].id), [item.id]);

  return (
    <main className="case-page">
      <div className="case-list-column">
        <div className="case-list-heading"><div><p className="eyebrow">Diagnostic plane</p><h1>Cases</h1></div><IconButton label="Filter cases"><ListFilter size={16} /></IconButton></div>
        <div className="case-filter-tabs"><button className="active">Open <span>3</span></button><button>Resolved</button></div>
        <div className="case-list">{cases.map((entry) => <button className={entry.id === item.id ? "selected" : ""} key={entry.id} onClick={() => selectCase(entry.id)}><div><Mono>{entry.shortId}</Mono><span>{entry.age}</span></div><strong>{entry.title}</strong><p>{entry.workflow}</p><Status tone={entry.tone}>{entry.nextAction}</Status></button>)}</div>
      </div>
      <div className="case-workspace">
        <header className="case-header">
          <div className="case-header-top"><div><p className="eyebrow">{item.shortId} / {item.workflow}</p><h1>{item.title}</h1><p>{item.summary}</p></div><button className="button button-primary" onClick={() => openAction(item)}>{item.nextAction}<ArrowRight size={15} /></button></div>
          <div className="case-meta"><span><UserRound size={13} />{item.responsibility}</span><span><Clock3 size={13} />Open {item.age}</span><span><Fingerprint size={13} /><Mono>{item.revision}</Mono></span></div>
        </header>
        <Lifecycle item={item} />
        <div className="case-truth">
          <div><span>Expected behavior</span><p>{item.expected}</p></div>
          <div><span>Observed behavior</span><p>{item.actual}</p></div>
        </div>
        <section className="timeline-section"><div className="section-heading"><div><h2>Case timeline</h2><p>Observed claims, human truth, repair work, and effects remain separate.</p></div><button className="button button-secondary"><ListFilter size={14} />All events</button></div><div className="event-list">{item.events.map((event) => <EventRow key={event.id} event={event} selected={selectedEvent.id === event.id} onSelect={() => setEventId(event.id)} />)}</div></section>
      </div>
      <CaseInspector item={item} event={selectedEvent} />
    </main>
  );
}

function WorkersPage() {
  return (
    <main className="page">
      <PageHeading eyebrow="Identity / workers" title="Accountable workers" description="Passport identity, declared intent, role separation, and bounded leases." actions={<button className="button button-primary"><KeyRound size={15} />Issue worker passport</button>} />
      <div className="notice"><ShieldCheck size={17} /><div><strong>Human sessions cannot impersonate workers</strong><span>Worker output uses separate agent authentication and declared Work Intent.</span></div></div>
      <section className="panel table-panel">
        <div className="data-table workers-table"><div className="table-head"><span>Worker</span><span>Role</span><span>Passport</span><span>Declared intent</span><span>Lease</span><span>Last seen</span></div>{workers.map((worker) => <button key={worker.id}><span className="worker-cell"><span className="worker-avatar"><Bot size={16} /></span><span><strong>{worker.name}</strong><small><Mono>{worker.id}</Mono></small></span></span><span>{worker.role}</span><Status tone={worker.tone}>{worker.passport}</Status><span>{worker.intent}</span><Mono>{worker.lease}</Mono><span>{worker.seen}</span></button>)}</div>
      </section>
      <div className="two-panels"><section className="panel info-panel"><div className="panel-title"><UsersRound size={17} /><div><h2>Role separation</h2><p>Different responsibilities remain independently attributable.</p></div></div><div className="role-list"><div><span className="role-icon"><Sparkles size={15} /></span><span><strong>Diagnostic Worker</strong><small>Advisory diagnosis; no repair or operational authority.</small></span></div><div><span className="role-icon"><Wrench size={15} /></span><span><strong>Repair Worker</strong><small>Submits bounded candidates against an exact task.</small></span></div><div><span className="role-icon"><ShieldCheck size={15} /></span><span><strong>Verification Runner</strong><small>Independently tests candidate behavior and emits receipts.</small></span></div></div></section><section className="panel info-panel"><div className="panel-title"><KeyRound size={17} /><div><h2>Credential custody</h2><p>Agent tokens appear once at issuance.</p></div></div><dl className="definition-list"><div><dt>Browser storage</dt><dd>None</dd></div><div><dt>Provider credentials</dt><dd>Not accepted</dd></div><div><dt>Passport expiry</dt><dd>Required</dd></div><div><dt>Intent confirmation</dt><dd>Exact revision</dd></div></dl></section></div>
    </main>
  );
}

function EvidencePage() {
  const [query, setQuery] = useState("");
  const filtered = artifacts.filter((artifact) => `${artifact.digest} ${artifact.kind} ${artifact.caseId}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <main className="page">
      <PageHeading eyebrow="Custody / evidence" title="Evidence registry" description="Content-addressed artifacts, immutable references, and explicit retention state." />
      <div className="evidence-summary"><div><HardDrive size={18} /><span><strong>148 KB</strong><small>Available artifact bytes</small></span></div><div><Fingerprint size={18} /><span><strong>27</strong><small>Immutable references</small></span></div><div><Archive size={18} /><span><strong>3</strong><small>Tombstones retained</small></span></div></div>
      <section className="panel table-panel"><div className="table-toolbar"><div className="filter-input"><Search size={14} /><input aria-label="Search evidence" placeholder="Digest, type, or case" value={query} onChange={(event) => setQuery(event.target.value)} /></div><button className="button button-secondary"><ListFilter size={14} />All retention states<ChevronDown size={13} /></button></div><div className="data-table evidence-table"><div className="table-head"><span>Artifact</span><span>Type</span><span>Case</span><span>Size</span><span>Retention state</span><span>Created</span></div>{filtered.map((artifact) => <button key={artifact.digest}><span className="digest-cell"><Box size={15} /><Mono>{artifact.digest}</Mono></span><span>{artifact.kind}</span><Mono>{artifact.caseId}</Mono><span>{artifact.size}</span><Status tone={artifact.tone}>{artifact.state}</Status><span>{artifact.created}</span></button>)}</div></section>
      <div className="notice notice-neutral"><Info size={17} /><div><strong>Retirement deletes bytes, not history</strong><span>Digest tombstones and references remain so past decisions keep their evidentiary shape.</span></div></div>
    </main>
  );
}

function SystemPage() {
  return (
    <main className="page">
      <PageHeading eyebrow="Environment / local-node" title="System" description="Protocol compatibility, custody boundaries, and independent service health." actions={<button className="button button-secondary"><RefreshCw size={15} />Refresh checks</button>} />
      <section className="system-banner"><div><div className="system-mark"><Check size={20} /></div><span><strong>Customer node is operational</strong><small>All required V0.2 services are available and protocol-compatible.</small></span></div><Mono>checked 8 sec ago</Mono></section>
      <div className="service-grid">{services.map((service) => <section className="service-row" key={service.name}><div className="service-icon">{service.name === "PostgreSQL" ? <Database size={18} /> : service.name.includes("store") ? <HardDrive size={18} /> : service.name.includes("adapter") ? <Network size={18} /> : <Server size={18} />}</div><div className="service-main"><strong>{service.name}</strong><span>{service.detail}</span></div><Mono>{service.version}</Mono><span>{service.latency}</span><Status tone={service.tone}>{service.status}</Status><IconButton label={`Inspect ${service.name}`}><ChevronRight size={16} /></IconButton></section>)}</div>
      <div className="two-panels"><section className="panel info-panel"><div className="panel-title"><ShieldCheck size={17} /><div><h2>Custody boundary</h2><p>What stays inside this customer-controlled node.</p></div></div><dl className="definition-list"><div><dt>PostgreSQL</dt><dd>Local container</dd></div><div><dt>Artifact bytes</dt><dd>Local volume</dd></div><div><dt>Owner credentials</dt><dd>Console server only</dd></div><div><dt>Telemetry export</dt><dd>Disabled</dd></div></dl></section><section className="panel info-panel"><div className="panel-title"><Blocks size={17} /><div><h2>Release</h2><p>Qualified package and migration state.</p></div></div><dl className="definition-list"><div><dt>Release</dt><dd><Mono>v0.2.0</Mono></dd></div><div><dt>Manifest</dt><dd><Mono>sha256:722a...f009</Mono></dd></div><div><dt>Migrations</dt><dd>Current</dd></div><div><dt>Qualification</dt><dd><Status tone="good">Passed</Status></dd></div></dl></section></div>
    </main>
  );
}

function SearchOverlay({ close, openCase, setPage }: { close: () => void; openCase: OpenCase; setPage: (page: PageId) => void }) {
  const [query, setQuery] = useState("");
  const entries = [
    ...cases.map((item) => ({ id: item.id, title: item.title, meta: `${item.shortId} · ${item.workflow}`, icon: FileSearch, action: () => openCase(item.id) })),
    ...workflows.map((item) => ({ id: item.id, title: item.name, meta: `${item.revision} · ${item.runtime}`, icon: Workflow, action: () => setPage("workflows") })),
    ...artifacts.map((item) => ({ id: item.digest, title: item.kind, meta: `${item.digest} · ${item.caseId}`, icon: Archive, action: () => setPage("evidence") })),
  ].filter((entry) => `${entry.title} ${entry.meta}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  return <div className="overlay" role="dialog" aria-modal="true" aria-label="Search"><button className="overlay-dismiss" onClick={close} aria-label="Close search" /><div className="search-dialog"><div className="search-box"><Search size={18} /><input autoFocus placeholder="Search exact IDs or readable names" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>Esc</kbd></div><div className="search-results"><p className="nav-label">Results</p>{entries.map((entry) => { const Icon = entry.icon; return <button key={entry.id} onClick={() => { entry.action(); close(); }}><span className="result-icon"><Icon size={16} /></span><span><strong>{entry.title}</strong><small>{entry.meta}</small></span><ArrowRight size={14} /></button>; })}</div><div className="search-footer"><span><kbd>↑↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span>Exact identity remains visible after selection</span></div></div></div>;
}

function ActionDialog({ item, close, accepted }: { item: DiagnosticCase; close: () => void; accepted: (message: string) => void }) {
  const consequential = item.nextAction.includes("promotion") || item.nextAction.includes("Reconcile");
  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="action-title"><button className="overlay-dismiss" onClick={close} aria-label="Close action" /><div className="action-dialog"><header><div><p className="eyebrow">Legal next operation</p><h2 id="action-title">{item.nextAction}</h2></div><IconButton label="Close" onClick={close}><X size={17} /></IconButton></header><div className="action-authority"><ShieldCheck size={17} /><div><strong>{consequential ? "Customer Owner authority" : "Authenticated human confirmation"}</strong><span>Admission remains authoritative on the server.</span></div></div><p>{item.nextActionDetail}</p><dl className="definition-list"><div><dt>Case</dt><dd><Mono>{item.shortId}</Mono></dd></div><div><dt>Workflow revision</dt><dd><Mono>{item.revision}</Mono></dd></div><div><dt>Requested by</dt><dd>{item.responsibility}</dd></div><div><dt>Command identity</dt><dd><Mono>cmd_ui_{Date.now().toString().slice(-7)}</Mono></dd></div></dl>{item.nextAction.includes("Confirm failure") && <div className="truth-preview"><div><span>Expected</span><p>{item.expected}</p></div><div><span>Actual</span><p>{item.actual}</p></div></div>}{consequential && <label className="exact-check"><input type="checkbox" /><span>I reviewed the exact candidate, target identity, verification receipt, and recovery reference.</span></label>}<footer><button className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" onClick={() => accepted(`${item.nextAction} accepted as a simulated prototype transition`)}>{item.nextAction}<ArrowRight size={15} /></button></footer><p className="prototype-note">Prototype only. No Kernel or Diagnostic command will be sent.</p></div></div>;
}

function ModuleDialog({ order, hidden, update, close }: { order: ModuleId[]; hidden: ModuleId[]; update: (order: ModuleId[], hidden: ModuleId[]) => void; close: () => void }) {
  const move = (index: number, direction: -1 | 1) => { const next = [...order]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; update(next, hidden); };
  const toggle = (id: ModuleId) => update(order, hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id]);
  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="module-title"><button className="overlay-dismiss" onClick={close} aria-label="Close module settings" /><div className="module-dialog"><header><div><p className="eyebrow">Local preference</p><h2 id="module-title">Overview modules</h2><p>Reorder or hide modules without changing Kernel state.</p></div><IconButton label="Close" onClick={close}><X size={17} /></IconButton></header><div className="module-options">{order.map((id, index) => <div key={id}><label><input type="checkbox" checked={!hidden.includes(id)} onChange={() => toggle(id)} /><span>{moduleLabels[id]}</span></label><span><IconButton label={`Move ${moduleLabels[id]} up`} onClick={() => move(index, -1)}><ArrowUp size={14} /></IconButton><IconButton label={`Move ${moduleLabels[id]} down`} onClick={() => move(index, 1)}><ArrowDown size={14} /></IconButton></span></div>)}</div><footer><button className="button button-secondary" onClick={() => update(defaultModules, [])}>Reset</button><button className="button button-primary" onClick={close}>Done</button></footer></div></div>;
}

export function ConsoleApp() {
  const [page, setPage] = useState<PageId>("overview");
  const [selectedCase, setSelectedCase] = useState(cases[0].id);
  const [mobileNav, setMobileNav] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionCase, setActionCase] = useState<DiagnosticCase | null>(null);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [moduleOrder, setModuleOrder] = useState<ModuleId[]>(defaultModules);
  const [hiddenModules, setHiddenModules] = useState<ModuleId[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("alphonse-console-modules");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { order: ModuleId[]; hidden: ModuleId[] };
        if (Array.isArray(parsed.order) && parsed.order.length === defaultModules.length) setModuleOrder(parsed.order);
        if (Array.isArray(parsed.hidden)) setHiddenModules(parsed.hidden);
      } catch { /* Ignore invalid local UI preference. */ }
    }
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.key === "Escape") { setSearchOpen(false); setActionCase(null); setModuleOpen(false); setMobileNav(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const updateModules = (order: ModuleId[], hidden: ModuleId[]) => {
    setModuleOrder(order); setHiddenModules(hidden);
    window.localStorage.setItem("alphonse-console-modules", JSON.stringify({ order, hidden }));
  };

  const openCase = (id: string) => { setSelectedCase(id); setPage("cases"); };
  const acceptAction = (message: string) => { setActionCase(null); setToast(message); window.setTimeout(() => setToast(null), 3600); };
  const content = useMemo(() => {
    if (page === "overview") return <Overview openCase={openCase} setPage={setPage} moduleOrder={moduleOrder} hiddenModules={hiddenModules} customize={() => setModuleOpen(true)} />;
    if (page === "workflows") return <WorkflowsPage openCase={openCase} />;
    if (page === "cases") return <CasesPage selectedId={selectedCase} selectCase={setSelectedCase} openAction={setActionCase} />;
    if (page === "workers") return <WorkersPage />;
    if (page === "evidence") return <EvidencePage />;
    return <SystemPage />;
  }, [page, selectedCase, moduleOrder, hiddenModules]);

  return (
    <div className="console-shell">
      <Sidebar page={page} setPage={setPage} open={mobileNav} close={() => setMobileNav(false)} />
      <div className="console-main"><Header page={page} openMenu={() => setMobileNav(true)} openSearch={() => setSearchOpen(true)} />{content}</div>
      {searchOpen && <SearchOverlay close={() => setSearchOpen(false)} openCase={openCase} setPage={setPage} />}
      {actionCase && <ActionDialog item={actionCase} close={() => setActionCase(null)} accepted={acceptAction} />}
      {moduleOpen && <ModuleDialog order={moduleOrder} hidden={hiddenModules} update={updateModules} close={() => setModuleOpen(false)} />}
      {toast && <div className="toast"><CheckCircle2 size={17} /><span>{toast}</span><button onClick={() => setToast(null)} aria-label="Dismiss"><X size={14} /></button></div>}
    </div>
  );
}
