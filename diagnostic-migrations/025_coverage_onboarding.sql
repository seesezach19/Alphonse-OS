CREATE TABLE diagnostic_coverage_onboardings (
  onboarding_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('initial_coverage', 'revision_change')),
  prior_onboarding_id uuid,
  workflow_reference jsonb NOT NULL CHECK (jsonb_typeof(workflow_reference) = 'object'),
  workflow_reference_digest text NOT NULL CHECK (workflow_reference_digest ~ '^sha256:[0-9a-f]{64}$'),
  work_intent_id uuid NOT NULL,
  work_intent_digest text NOT NULL CHECK (work_intent_digest ~ '^sha256:[0-9a-f]{64}$'),
  passport_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  adapter_binding jsonb NOT NULL CHECK (jsonb_typeof(adapter_binding) = 'object'),
  adapter_binding_digest text NOT NULL CHECK (adapter_binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  identity_digest text NOT NULL CHECK (identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  opened_by_actor_type text NOT NULL,
  opened_by_actor_id text NOT NULL,
  opened_at timestamptz NOT NULL,
  UNIQUE (installation_id, onboarding_id),
  FOREIGN KEY (installation_id, prior_onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id, onboarding_id)
);

CREATE TABLE diagnostic_coverage_onboarding_events (
  event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  event_index bigint NOT NULL CHECK (event_index >= 1),
  event_type text NOT NULL CHECK (event_type IN (
    'opened', 'evidence_captured', 'evidence_reused', 'snapshot_replaced'
  )),
  prior_event_digest text CHECK (prior_event_digest IS NULL OR prior_event_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_digest text NOT NULL CHECK (event_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (installation_id, onboarding_id, event_index),
  UNIQUE (installation_id, event_digest),
  FOREIGN KEY (installation_id, onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id, onboarding_id)
);

CREATE TABLE diagnostic_workflow_discovery_snapshots (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_scope_digest text NOT NULL CHECK (source_scope_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_page_digest text NOT NULL CHECK (source_page_digest ~ '^sha256:[0-9a-f]{64}$'),
  selected_metadata_digest text NOT NULL CHECK (selected_metadata_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_index bigint NOT NULL CHECK (event_index >= 2),
  captured_by_actor_type text NOT NULL,
  captured_by_actor_id text NOT NULL,
  captured_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, onboarding_id, snapshot_digest),
  UNIQUE (installation_id, onboarding_id, event_index),
  FOREIGN KEY (installation_id, onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id, onboarding_id),
  FOREIGN KEY (installation_id, snapshot_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE INDEX diagnostic_coverage_onboarding_workflow_idx
  ON diagnostic_coverage_onboardings
  (installation_id, environment_id, workflow_reference_digest, opened_at, onboarding_id);

CREATE INDEX diagnostic_coverage_onboarding_identity_idx
  ON diagnostic_coverage_onboardings (installation_id, identity_digest, opened_at);

CREATE INDEX diagnostic_coverage_onboarding_events_idx
  ON diagnostic_coverage_onboarding_events
  (installation_id, onboarding_id, event_index);

CREATE TRIGGER diagnostic_coverage_onboardings_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_onboardings
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE TRIGGER diagnostic_coverage_onboarding_events_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_onboarding_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE TRIGGER diagnostic_workflow_discovery_snapshots_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_workflow_discovery_snapshots
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
