export type ConsoleRole = "viewer" | "operator" | "owner";

export type ControlView = {
  state: string;
  event_index: number;
  reason_code: string | null;
  rationale: string | null;
  actor: { type: string; id: string } | null;
  occurred_at: string | null;
  legal_next_operations: string[];
};

export type ConsoleSnapshot = {
  schema_version: "alphonse.console-snapshot.v0.1";
  generated_at: string;
  data_mode: "live";
  source: { system: string; projection: string; authoritative: true; direct_database_authority: false };
  session: { role: ConsoleRole; subject: { type: string; id: string } };
  workflows: Array<Record<string, unknown> & {
    workflow_id: string; display_name: string; objective: string; identity_digest: string;
    revision: null | { revision_id: string; material_digest: string; registered_at: string };
    coverage: { onboarding_state: string; reconciliation_state: string; observed_at: string | null;
      limitations: string[] };
    quarantine: ControlView; case_ids: string[]; legal_next_operations: string[];
  }>;
  cases: Array<Record<string, unknown> & {
    case_id: string; workflow_id: string; revision_id: string; summary: string; state: string;
    reported_at: string; report_digest: string; legal_next_operations: string[];
    expected_behavior: string | null; actual_behavior: string | null;
    lifecycle: Array<{ stage: string; complete: boolean; detail: string }>;
    diagnosis: null | Record<string, unknown>; repair: null | Record<string, unknown>;
    verification: null | Record<string, unknown>; promotion: null | Record<string, unknown>;
    limitations: string[];
  }>;
  workers: Array<Record<string, unknown> & { worker_id: string; worker_kind: string; state?: string;
    effective_state?: string; control?: ControlView }>;
  evidence: Array<{ artifact_digest: string; size_bytes: number; media_type: string;
    created_at: string; availability: "available" | "revoked"; limitation: string | null }>;
  assurances: Array<Record<string, unknown> & { export_id: string; assurance_digest: string;
    case_id: string; workflow_id: string; created_at: string }>;
  limitations: string[];
  legal_next_operations: string[];
};

export type ConsoleSessionState = { authenticated: boolean; role?: ConsoleRole; expires_at?: string };

export type ConsoleControlRequest = {
  resource: "worker" | "workflow";
  target_id: string;
  action: "suspend" | "resume" | "quarantine" | "release";
  reason_code: "emergency_operator_action" | "security_concern" | "unexpected_behavior" | "manual_recovery";
  rationale: string;
};
