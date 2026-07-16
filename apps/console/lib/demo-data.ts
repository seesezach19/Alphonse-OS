export type PageId = "overview" | "workflows" | "cases" | "workers" | "evidence" | "system";
export type Tone = "neutral" | "mint" | "good" | "warning" | "danger" | "advisory";

export type Workflow = {
  id: string;
  name: string;
  objective: string;
  runtime: string;
  revision: string;
  state: string;
  tone: Tone;
  lastActivity: string;
  openCases: number;
  freshness: string;
};

export type CaseEvent = {
  id: string;
  at: string;
  title: string;
  detail: string;
  actor: string;
  tone: Tone;
  evidence?: string;
  operation?: string;
  facts?: string[];
};

export type DiagnosticCase = {
  id: string;
  shortId: string;
  title: string;
  workflow: string;
  workflowId: string;
  revision: string;
  age: string;
  responsibility: string;
  summary: string;
  nextAction: string;
  nextActionDetail: string;
  tone: Tone;
  stages: Array<{ label: string; state: "complete" | "current" | "pending" | "uncertain"; detail: string }>;
  expected: string;
  actual: string;
  events: CaseEvent[];
};

export const workflows: Workflow[] = [
  {
    id: "inventory-follow-up",
    name: "Inventory exception follow-up",
    objective: "Draft accurate customer follow-up when storefront inventory diverges from ERP stock.",
    runtime: "n8n 2.7.3",
    revision: "rev_7f91c2",
    state: "Needs investigation",
    tone: "danger",
    lastActivity: "4 min ago",
    openCases: 1,
    freshness: "Current",
  },
  {
    id: "invoice-readiness",
    name: "Invoice readiness review",
    objective: "Collect job evidence and route complete invoice packets to human review.",
    runtime: "n8n 2.7.3",
    revision: "rev_10e5a8",
    state: "Operating",
    tone: "good",
    lastActivity: "11 min ago",
    openCases: 0,
    freshness: "Current",
  },
  {
    id: "lead-qualification",
    name: "Inbound lead qualification",
    objective: "Structure inbound requests and prepare an evidence-backed routing recommendation.",
    runtime: "OpenClaw 0.18",
    revision: "rev_889ad4",
    state: "Candidate verified",
    tone: "warning",
    lastActivity: "38 min ago",
    openCases: 1,
    freshness: "Current",
  },
  {
    id: "renewal-reconciliation",
    name: "Renewal reconciliation",
    objective: "Compare contract, billing, and account state before renewal outreach.",
    runtime: "Codex worker",
    revision: "rev_43aa09",
    state: "Reporting stale",
    tone: "warning",
    lastActivity: "2 hr ago",
    openCases: 1,
    freshness: "18 min late",
  },
];

export const cases: DiagnosticCase[] = [
  {
    id: "6ff71c8e-17c9-4f2c-a721-91754dbb2e2a",
    shortId: "CASE-0142",
    title: "Email claimed unavailable SKU was in stock",
    workflow: "Inventory exception follow-up",
    workflowId: "inventory-follow-up",
    revision: "rev_7f91c2",
    age: "34 min",
    responsibility: "Zach / Builder",
    summary: "Customer received a delay notice even though ERP showed 38 available units at evaluation time.",
    nextAction: "Confirm failure specification",
    nextActionDetail: "Record the expected and actual behavior as immutable human-confirmed truth before reproduction.",
    tone: "danger",
    stages: [
      { label: "Observed", state: "complete", detail: "External failure claim preserved" },
      { label: "Failure confirmed", state: "current", detail: "Human confirmation required" },
      { label: "Reproduced", state: "pending", detail: "Not started" },
      { label: "Diagnosis", state: "pending", detail: "Optional" },
      { label: "Repair proposed", state: "pending", detail: "No candidate" },
      { label: "Verified", state: "pending", detail: "No receipt" },
      { label: "Authorized", state: "pending", detail: "Owner only" },
      { label: "Target confirmed", state: "pending", detail: "No effect requested" },
    ],
    expected: "When ERP available quantity is at least 12, draft an in-stock response and do not claim a fulfillment delay.",
    actual: "The workflow drafted a delay notice despite ERP available quantity being 38.",
    events: [
      {
        id: "evt-142-5",
        at: "14:26:08",
        title: "Failure report opened",
        detail: "Builder reported the external outcome as inconsistent with business policy.",
        actor: "Zach / Builder",
        tone: "danger",
        operation: "diagnostic.case.report_failure",
        evidence: "trace_01K0QVB4PM",
        facts: ["Report is attributed to an authenticated Builder.", "Report does not establish failure truth by itself."],
      },
      {
        id: "evt-142-4",
        at: "14:23:51",
        title: "Workflow claimed success",
        detail: "External runtime reported completion and preserved an output reference.",
        actor: "n8n runtime adapter",
        tone: "neutral",
        operation: "diagnostic.runtime_event.receive",
        evidence: "sha256:11d82c...b9a7",
        facts: ["Runtime claim: succeeded", "HTTP acceptance does not grant Kernel authority."],
      },
      {
        id: "evt-142-3",
        at: "14:23:49",
        title: "Customer email drafted",
        detail: "Draft contained an inventory-delay statement for SKU AX-1844.",
        actor: "Inventory follow-up agent",
        tone: "danger",
        evidence: "artifact:email-draft-8412",
        facts: ["No email was automatically sent.", "Draft was routed to human review."],
      },
      {
        id: "evt-142-2",
        at: "14:23:47",
        title: "ERP inventory context read",
        detail: "Available quantity 38; allocated quantity 6; snapshot age 72 seconds.",
        actor: "Inventory connector",
        tone: "good",
        evidence: "sha256:903e13...52c1",
        facts: ["Source authority: ERP inventory export", "Freshness policy: under 5 minutes"],
      },
      {
        id: "evt-142-1",
        at: "14:23:44",
        title: "Execution accepted",
        detail: "Exact workflow revision and correlation identity were preserved.",
        actor: "n8n runtime adapter",
        tone: "mint",
        evidence: "execution:n8n-82917",
      },
    ],
  },
  {
    id: "577b56d1-62ec-47d9-9e5b-acde8d914f32",
    shortId: "CASE-0139",
    title: "Lead routing candidate awaiting owner decision",
    workflow: "Inbound lead qualification",
    workflowId: "lead-qualification",
    revision: "rev_889ad4",
    age: "2 hr",
    responsibility: "Morgan / Owner",
    summary: "Repair candidate passed exact failure and retained regression verification.",
    nextAction: "Review promotion authorization",
    nextActionDetail: "Inspect the candidate, independent verification receipt, exact target, and rollback reference.",
    tone: "warning",
    expected: "Route government-sector leads to the public-sector queue when evidence identifies a government entity.",
    actual: "A county procurement request was routed to the general commercial queue.",
    stages: [
      { label: "Observed", state: "complete", detail: "Trace retained" },
      { label: "Failure confirmed", state: "complete", detail: "Morgan confirmed" },
      { label: "Reproduced", state: "complete", detail: "Defect demonstrated" },
      { label: "Diagnosis", state: "complete", detail: "Useful, advisory" },
      { label: "Repair proposed", state: "complete", detail: "Candidate retained" },
      { label: "Verified", state: "complete", detail: "Receipt valid" },
      { label: "Authorized", state: "current", detail: "Owner decision required" },
      { label: "Target confirmed", state: "pending", detail: "No effect requested" },
    ],
    events: [
      { id: "evt-139-3", at: "12:58:11", title: "Independent verification passed", detail: "Original defect failed; candidate passed targeted and retained regressions.", actor: "Verification runner", tone: "good", evidence: "receipt:vrf_8a221", facts: ["Runner identity differs from Repair Worker.", "Passing verification grants eligibility, not authority."] },
      { id: "evt-139-2", at: "12:44:03", title: "Repair candidate submitted", detail: "Candidate changes government-entity evidence mapping and preserves the base revision.", actor: "Repair Worker rw-03", tone: "mint", evidence: "sha256:c43bb1...990c" },
      { id: "evt-139-1", at: "11:51:17", title: "Failure reproduced", detail: "Deterministic bundle demonstrated the incorrect queue selection.", actor: "Diagnostic Plane", tone: "danger", evidence: "sha256:4a0d71...7112" },
    ],
  },
  {
    id: "c9d95d1a-45f4-4171-a62f-215ec34f2c48",
    shortId: "CASE-0134",
    title: "Promotion result is uncertain",
    workflow: "Renewal reconciliation",
    workflowId: "renewal-reconciliation",
    revision: "rev_43aa09",
    age: "7 hr",
    responsibility: "Zach / Builder",
    summary: "Target adapter timed out after accepting the promotion request; application state is unknown.",
    nextAction: "Reconcile target state",
    nextActionDetail: "Query the target using the existing promotion identity. Do not retry application blindly.",
    tone: "warning",
    expected: "Use current contract state before composing renewal outreach.",
    actual: "Workflow used a retired contract snapshot for one account.",
    stages: [
      { label: "Observed", state: "complete", detail: "Trace retained" },
      { label: "Failure confirmed", state: "complete", detail: "Confirmed" },
      { label: "Reproduced", state: "complete", detail: "Demonstrated" },
      { label: "Diagnosis", state: "complete", detail: "Not requested" },
      { label: "Repair proposed", state: "complete", detail: "Candidate retained" },
      { label: "Verified", state: "complete", detail: "Passed" },
      { label: "Authorized", state: "complete", detail: "Owner authorized" },
      { label: "Target confirmed", state: "uncertain", detail: "Reconciliation required" },
    ],
    events: [
      { id: "evt-134-3", at: "08:31:22", title: "Application result uncertain", detail: "Adapter timed out after target acknowledgement boundary.", actor: "Promotion adapter", tone: "warning", evidence: "promotion:prm_7781", facts: ["Do not issue a new promotion command.", "Reconciliation is the only legal next operation."] },
      { id: "evt-134-2", at: "08:30:51", title: "Promotion application requested", detail: "Existing Owner authorization bound to exact candidate and target.", actor: "Zach / Builder", tone: "mint", evidence: "authorization:auth_9e10" },
      { id: "evt-134-1", at: "08:12:07", title: "Owner authorized promotion", detail: "Authorization preserved independently from target application.", actor: "Morgan / Owner", tone: "good", evidence: "sha256:9c20aa...c317" },
    ],
  },
];

export const workers = [
  { id: "rw-03", name: "Repair Worker 03", role: "Repair", passport: "Valid", intent: "Repair bounded workflow defects", lease: "CASE-0139 / released", seen: "6 min ago", tone: "good" as Tone },
  { id: "dw-01", name: "Diagnostic Worker 01", role: "Diagnosis", passport: "Valid", intent: "Produce evidence-bound diagnosis", lease: "Unassigned", seen: "18 min ago", tone: "advisory" as Tone },
  { id: "vr-01", name: "Verification Runner", role: "Verification", passport: "Valid", intent: "Independently test exact candidates", lease: "CASE-0139 / complete", seen: "1 hr ago", tone: "good" as Tone },
  { id: "rw-legacy", name: "Legacy Repair Worker", role: "Repair", passport: "Expired", intent: "No current intent", lease: "Unassigned", seen: "12 days ago", tone: "warning" as Tone },
];

export const artifacts = [
  { digest: "sha256:11d82c...b9a7", kind: "Runtime output", caseId: "CASE-0142", size: "14.2 KB", state: "Available", created: "34 min ago", tone: "neutral" as Tone },
  { digest: "sha256:903e13...52c1", kind: "ERP context", caseId: "CASE-0142", size: "4.8 KB", state: "Available", created: "34 min ago", tone: "good" as Tone },
  { digest: "sha256:c43bb1...990c", kind: "Repair candidate", caseId: "CASE-0139", size: "38.1 KB", state: "Available", created: "2 hr ago", tone: "mint" as Tone },
  { digest: "sha256:4a0d71...7112", kind: "Reproduction bundle", caseId: "CASE-0139", size: "91.6 KB", state: "Available", created: "3 hr ago", tone: "danger" as Tone },
  { digest: "sha256:fd03a9...ee12", kind: "Retired diagnosis input", caseId: "CASE-0118", size: "0 B", state: "Tombstone retained", created: "28 days ago", tone: "warning" as Tone },
];

export const services = [
  { name: "Kernel", version: "0.1.0", status: "Simulated", detail: "Fixture: authority and accountability operations", latency: "Demo", tone: "neutral" as Tone },
  { name: "Diagnostic Plane", version: "0.2.0", status: "Simulated", detail: "Fixture: debug loop and immutable evidence", latency: "Demo", tone: "neutral" as Tone },
  { name: "n8n runtime adapter", version: "0.2.0", status: "Simulated", detail: "Fixture: runtime reporting", latency: "Demo", tone: "neutral" as Tone },
  { name: "Repair delivery adapter", version: "0.2.0", status: "Simulated", detail: "Fixture: customer-controlled n8n delivery", latency: "Demo", tone: "neutral" as Tone },
  { name: "PostgreSQL", version: "16.4", status: "Simulated", detail: "Fixture: customer node and local custody", latency: "Demo", tone: "neutral" as Tone },
  { name: "Artifact store", version: "content-v1", status: "Simulated", detail: "Fixture: local content-addressed storage", latency: "Demo", tone: "neutral" as Tone },
];
