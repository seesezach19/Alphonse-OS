CREATE TABLE diagnostic_repair_worker_registrations (
  registration_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  passport_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  work_intent_digest text NOT NULL CHECK (work_intent_digest ~ '^sha256:[0-9a-f]{64}$'),
  work_intent_scope jsonb NOT NULL CHECK (jsonb_typeof(work_intent_scope) = 'object'),
  work_intent_constraints jsonb NOT NULL CHECK (jsonb_typeof(work_intent_constraints) = 'object'),
  passport_expires_at timestamptz NOT NULL,
  protocol_version text NOT NULL CHECK (protocol_version = '0.2.0'),
  runtime_attribution jsonb NOT NULL CHECK (jsonb_typeof(runtime_attribution) = 'object'),
  registration_digest text NOT NULL CHECK (registration_digest ~ '^sha256:[0-9a-f]{64}$'),
  registered_at timestamptz NOT NULL,
  UNIQUE (installation_id, passport_id, work_intent_id)
);

CREATE TABLE diagnostic_repair_tasks (
  task_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  worker_registration_id uuid NOT NULL REFERENCES diagnostic_repair_worker_registrations(registration_id),
  passport_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  work_intent_digest text NOT NULL CHECK (work_intent_digest ~ '^sha256:[0-9a-f]{64}$'),
  base_revision_id uuid NOT NULL REFERENCES diagnostic_agent_revisions(revision_id),
  base_revision_artifact_digest text NOT NULL,
  reproduction_bundle_id uuid NOT NULL REFERENCES diagnostic_reproduction_bundles(bundle_id),
  reproduction_bundle_artifact_digest text NOT NULL,
  previous_task_id uuid REFERENCES diagnostic_repair_tasks(task_id),
  allowed_operations jsonb NOT NULL CHECK (jsonb_typeof(allowed_operations) = 'array'),
  artifact_limits jsonb NOT NULL CHECK (jsonb_typeof(artifact_limits) = 'object'),
  expected_outputs jsonb NOT NULL CHECK (jsonb_typeof(expected_outputs) = 'array'),
  lease_duration_seconds integer NOT NULL CHECK (lease_duration_seconds BETWEEN 5 AND 3600),
  lease_epoch bigint NOT NULL CHECK (lease_epoch >= 1),
  task_digest text NOT NULL CHECK (task_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (installation_id, base_revision_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, reproduction_bundle_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_repair_task_events (
  event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  task_id uuid NOT NULL REFERENCES diagnostic_repair_tasks(task_id),
  event_index bigint NOT NULL CHECK (event_index >= 1),
  lease_epoch bigint NOT NULL CHECK (lease_epoch >= 1),
  event_type text NOT NULL CHECK (event_type IN
    ('available','leased','heartbeat','submitted','failed','released','cancelled','expired')),
  reason_code text NOT NULL,
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  lease_expires_at timestamptz,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (installation_id, task_id, event_index)
);

CREATE TABLE diagnostic_repair_candidates (
  candidate_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  task_id uuid NOT NULL UNIQUE REFERENCES diagnostic_repair_tasks(task_id),
  worker_registration_id uuid NOT NULL REFERENCES diagnostic_repair_worker_registrations(registration_id),
  lease_epoch bigint NOT NULL CHECK (lease_epoch >= 1),
  base_revision_id uuid NOT NULL REFERENCES diagnostic_agent_revisions(revision_id),
  reproduction_bundle_id uuid NOT NULL REFERENCES diagnostic_reproduction_bundles(bundle_id),
  material_digest text NOT NULL CHECK (material_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_artifact_digest text NOT NULL,
  regression_artifact_digest text NOT NULL,
  logs_artifact_digest text NOT NULL,
  intended_behavior_change text NOT NULL CHECK (length(intended_behavior_change) BETWEEN 1 AND 2000),
  runtime_attribution jsonb NOT NULL CHECK (jsonb_typeof(runtime_attribution) = 'object'),
  initial_status text NOT NULL CHECK (initial_status = 'proposed'),
  submitted_by_agent_principal_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  FOREIGN KEY (installation_id, candidate_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, regression_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, logs_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_repair_candidate_events (
  event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  candidate_id uuid NOT NULL REFERENCES diagnostic_repair_candidates(candidate_id),
  event_index bigint NOT NULL CHECK (event_index >= 1),
  event_type text NOT NULL CHECK (event_type IN
    ('proposed','verification_pending','verified','rejected','superseded','withdrawn')),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (installation_id, candidate_id, event_index)
);

CREATE INDEX diagnostic_repair_tasks_case_idx
  ON diagnostic_repair_tasks (installation_id, case_id, created_at, task_id);
CREATE INDEX diagnostic_repair_tasks_worker_idx
  ON diagnostic_repair_tasks (installation_id, worker_registration_id, created_at, task_id);
CREATE INDEX diagnostic_repair_task_events_task_idx
  ON diagnostic_repair_task_events (installation_id, task_id, event_index);
CREATE INDEX diagnostic_repair_candidates_case_idx
  ON diagnostic_repair_candidates (installation_id, case_id, submitted_at, candidate_id);
CREATE INDEX diagnostic_repair_candidate_events_candidate_idx
  ON diagnostic_repair_candidate_events (installation_id, candidate_id, event_index);

CREATE TRIGGER diagnostic_repair_worker_registrations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_repair_worker_registrations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_repair_tasks_immutable BEFORE UPDATE OR DELETE ON diagnostic_repair_tasks
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_repair_task_events_immutable BEFORE UPDATE OR DELETE ON diagnostic_repair_task_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_repair_candidates_immutable BEFORE UPDATE OR DELETE ON diagnostic_repair_candidates
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_repair_candidate_events_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_repair_candidate_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
