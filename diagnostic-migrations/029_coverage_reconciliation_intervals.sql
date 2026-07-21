CREATE TABLE diagnostic_coverage_reconciliation_events (
  event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  event_index bigint NOT NULL CHECK (event_index >= 1),
  cycle_id uuid,
  cycle_index bigint CHECK (cycle_index IS NULL OR cycle_index >= 1),
  event_type text NOT NULL CHECK (event_type IN (
    'cycle_started','page_admitted','cycle_completed','reconciliation_degraded'
  )),
  prior_event_digest text CHECK (prior_event_digest IS NULL OR prior_event_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_digest text NOT NULL CHECK (event_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  actor_type text NOT NULL CHECK (actor_type IN ('agent','service')),
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (installation_id,onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id,onboarding_id),
  UNIQUE (installation_id,onboarding_id,event_index),
  UNIQUE (installation_id,onboarding_id,event_digest)
);

CREATE TABLE diagnostic_coverage_reconciliation_pages (
  page_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  cycle_index bigint NOT NULL CHECK (cycle_index >= 1),
  page_index bigint NOT NULL CHECK (page_index >= 0),
  page_artifact_digest text NOT NULL CHECK (page_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  page_digest text NOT NULL CHECK (page_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_cutoff timestamptz NOT NULL,
  current_cursor_digest text,
  next_cursor text,
  next_cursor_digest text,
  scope_complete boolean NOT NULL,
  execution_count integer NOT NULL CHECK (execution_count >= 0 AND execution_count <= 100),
  admitted_at timestamptz NOT NULL,
  FOREIGN KEY (installation_id,onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id,onboarding_id),
  FOREIGN KEY (installation_id,page_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id,artifact_digest),
  CHECK (current_cursor_digest IS NULL OR current_cursor_digest ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (next_cursor_digest IS NULL OR next_cursor_digest ~ '^sha256:[0-9a-f]{64}$'),
  CHECK ((next_cursor IS NULL) = (next_cursor_digest IS NULL)),
  CHECK (scope_complete = (next_cursor IS NULL)),
  UNIQUE (installation_id,onboarding_id,cycle_id,page_index),
  UNIQUE (installation_id,onboarding_id,cycle_id,page_digest)
);

CREATE TABLE diagnostic_coverage_execution_observations (
  observation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  cycle_index bigint NOT NULL CHECK (cycle_index >= 1),
  page_id uuid NOT NULL REFERENCES diagnostic_coverage_reconciliation_pages(page_id),
  provider_execution_id text NOT NULL,
  observation_digest text NOT NULL CHECK (observation_digest ~ '^sha256:[0-9a-f]{64}$'),
  execution jsonb NOT NULL CHECK (jsonb_typeof(execution) = 'object'),
  observed_at timestamptz NOT NULL,
  FOREIGN KEY (installation_id,onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id,onboarding_id),
  UNIQUE (installation_id,onboarding_id,cycle_id,provider_execution_id),
  UNIQUE (installation_id,onboarding_id,cycle_id,observation_digest)
);

CREATE INDEX diagnostic_coverage_reconciliation_events_idx
  ON diagnostic_coverage_reconciliation_events (installation_id,onboarding_id,event_index);
CREATE INDEX diagnostic_coverage_reconciliation_pages_idx
  ON diagnostic_coverage_reconciliation_pages (installation_id,onboarding_id,cycle_index,page_index);
CREATE INDEX diagnostic_coverage_execution_observations_idx
  ON diagnostic_coverage_execution_observations
  (installation_id,onboarding_id,cycle_index,provider_execution_id);

CREATE TRIGGER diagnostic_coverage_reconciliation_events_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_reconciliation_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_coverage_reconciliation_pages_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_reconciliation_pages
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_coverage_execution_observations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_execution_observations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
