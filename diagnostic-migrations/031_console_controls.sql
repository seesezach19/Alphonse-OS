CREATE TABLE diagnostic_worker_control_events (
  event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  agent_principal_id uuid NOT NULL,
  event_index bigint NOT NULL CHECK (event_index >= 1),
  event_type text NOT NULL CHECK (event_type IN ('suspended','resumed')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'emergency_operator_action','security_concern','unexpected_behavior','manual_recovery'
  )),
  rationale text NOT NULL CHECK (length(rationale) BETWEEN 1 AND 1000),
  authorization_record jsonb NOT NULL CHECK (jsonb_typeof(authorization_record) = 'object'),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (installation_id, agent_principal_id, event_index)
);

CREATE TABLE diagnostic_workflow_quarantine_events (
  event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  workflow_id text NOT NULL,
  event_index bigint NOT NULL CHECK (event_index >= 1),
  event_type text NOT NULL CHECK (event_type IN ('quarantined','released')),
  reason_code text NOT NULL CHECK (reason_code IN (
    'emergency_operator_action','security_concern','unexpected_behavior','manual_recovery'
  )),
  rationale text NOT NULL CHECK (length(rationale) BETWEEN 1 AND 1000),
  authorization_record jsonb NOT NULL CHECK (jsonb_typeof(authorization_record) = 'object'),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (installation_id, workflow_id, event_index),
  FOREIGN KEY (installation_id, workflow_id)
    REFERENCES diagnostic_agent_workflows(installation_id, workflow_id)
);

CREATE INDEX diagnostic_worker_control_current_idx
  ON diagnostic_worker_control_events (installation_id, agent_principal_id, event_index DESC);
CREATE INDEX diagnostic_workflow_quarantine_current_idx
  ON diagnostic_workflow_quarantine_events (installation_id, workflow_id, event_index DESC);

CREATE TRIGGER diagnostic_worker_control_events_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_worker_control_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_workflow_quarantine_events_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_workflow_quarantine_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
