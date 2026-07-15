CREATE TABLE diagnostic_external_activity_traces (
  trace_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  workflow_id text NOT NULL,
  revision_id uuid NOT NULL,
  adapter_id text NOT NULL,
  adapter_version text NOT NULL,
  external_execution_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, adapter_id, external_execution_id),
  FOREIGN KEY (installation_id, workflow_id)
    REFERENCES diagnostic_agent_workflows(installation_id, workflow_id),
  FOREIGN KEY (revision_id)
    REFERENCES diagnostic_agent_revisions(revision_id)
);

CREATE TABLE diagnostic_runtime_event_receipts (
  receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  trace_id uuid NOT NULL REFERENCES diagnostic_external_activity_traces(trace_id),
  event_id text NOT NULL,
  idempotency_key text NOT NULL,
  event_sequence bigint NOT NULL CHECK (event_sequence >= 0),
  lifecycle_claim text NOT NULL CHECK (lifecycle_claim IN ('accepted','running','succeeded','failed','cancelled')),
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  delivery_delay_ms bigint NOT NULL CHECK (delivery_delay_ms >= 0),
  out_of_order boolean NOT NULL,
  payload_digest text CHECK (payload_digest IS NULL OR payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload_reference text,
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  envelope_digest text NOT NULL CHECK (envelope_digest ~ '^sha256:[0-9a-f]{64}$'),
  authentication_key_id text NOT NULL,
  authentication_signed_at timestamptz NOT NULL,
  authentication_signature text NOT NULL CHECK (authentication_signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
  transition_id uuid NOT NULL REFERENCES diagnostic_transitions(transition_id),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  UNIQUE (installation_id, event_id),
  UNIQUE (installation_id, idempotency_key),
  UNIQUE (installation_id, trace_id, event_sequence)
);

CREATE TABLE diagnostic_runtime_event_conflicts (
  conflict_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  conflict_digest text NOT NULL CHECK (conflict_digest ~ '^sha256:[0-9a-f]{64}$'),
  received_envelope_digest text NOT NULL CHECK (received_envelope_digest ~ '^sha256:[0-9a-f]{64}$'),
  received_identity jsonb NOT NULL CHECK (jsonb_typeof(received_identity) = 'object'),
  conflict_types jsonb NOT NULL CHECK (jsonb_typeof(conflict_types) = 'array'),
  accepted_receipt_ids jsonb NOT NULL CHECK (jsonb_typeof(accepted_receipt_ids) = 'array'),
  detected_at timestamptz NOT NULL,
  UNIQUE (installation_id, conflict_digest)
);

CREATE INDEX diagnostic_runtime_events_trace_idx
  ON diagnostic_runtime_event_receipts (installation_id, trace_id, event_sequence, received_at);

CREATE TRIGGER diagnostic_external_activity_traces_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_external_activity_traces
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_runtime_event_receipts_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_runtime_event_receipts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_runtime_event_conflicts_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_runtime_event_conflicts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
