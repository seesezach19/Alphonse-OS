CREATE TABLE diagnostic_cases (
  case_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  trace_id uuid NOT NULL REFERENCES diagnostic_external_activity_traces(trace_id),
  workflow_id text NOT NULL,
  revision_id uuid NOT NULL REFERENCES diagnostic_agent_revisions(revision_id),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  report_digest text NOT NULL CHECK (report_digest ~ '^sha256:[0-9a-f]{64}$'),
  reported_by_actor_type text NOT NULL,
  reported_by_actor_id text NOT NULL,
  reported_at timestamptz NOT NULL,
  UNIQUE (installation_id, trace_id)
);

CREATE TABLE diagnostic_failure_specifications (
  failure_specification_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  case_id uuid NOT NULL UNIQUE REFERENCES diagnostic_cases(case_id),
  specification_digest text NOT NULL CHECK (specification_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_behavior text NOT NULL,
  actual_behavior text NOT NULL,
  reproduction_conditions jsonb NOT NULL CHECK (jsonb_typeof(reproduction_conditions) = 'array'),
  targeted_verification jsonb NOT NULL CHECK (jsonb_typeof(targeted_verification) = 'object'),
  confirmed_by_actor_type text NOT NULL CHECK (confirmed_by_actor_type = 'human'),
  confirmed_by_actor_id text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  UNIQUE (installation_id, specification_digest)
);

CREATE TABLE diagnostic_reproduction_attempts (
  attempt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  request_material_digest text NOT NULL CHECK (request_material_digest ~ '^sha256:[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('incomplete','rejected','demonstrated')),
  reason_code text NOT NULL,
  source_detail_digest text CHECK (source_detail_digest IS NULL OR source_detail_digest ~ '^sha256:[0-9a-f]{64}$'),
  redaction_policy_digest text NOT NULL CHECK (redaction_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  reproduction_result jsonb NOT NULL CHECK (jsonb_typeof(reproduction_result) = 'object'),
  attempted_at timestamptz NOT NULL,
  UNIQUE (installation_id, request_material_digest)
);

CREATE TABLE diagnostic_reproduction_bundles (
  bundle_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  failure_specification_id uuid NOT NULL REFERENCES diagnostic_failure_specifications(failure_specification_id),
  revision_id uuid NOT NULL REFERENCES diagnostic_agent_revisions(revision_id),
  attempt_id uuid NOT NULL UNIQUE REFERENCES diagnostic_reproduction_attempts(attempt_id),
  material_digest text NOT NULL CHECK (material_digest ~ '^sha256:[0-9a-f]{64}$'),
  artifact_digest text NOT NULL,
  reproduction_status text NOT NULL CHECK (reproduction_status = 'demonstrated'),
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, material_digest),
  FOREIGN KEY (installation_id, artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_artifact_tombstones (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  artifact_digest text NOT NULL,
  original_size_bytes bigint NOT NULL CHECK (original_size_bytes >= 0),
  original_media_type text NOT NULL,
  original_storage_key text NOT NULL,
  deletion_reason text NOT NULL CHECK (length(deletion_reason) BETWEEN 1 AND 500),
  deleted_by_actor_type text NOT NULL,
  deleted_by_actor_id text NOT NULL,
  deleted_at timestamptz NOT NULL,
  bytes_deleted boolean NOT NULL,
  PRIMARY KEY (installation_id, artifact_digest),
  FOREIGN KEY (installation_id, artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE INDEX diagnostic_cases_workflow_idx
  ON diagnostic_cases (installation_id, workflow_id, reported_at, case_id);
CREATE INDEX diagnostic_reproduction_attempts_case_idx
  ON diagnostic_reproduction_attempts (installation_id, case_id, attempted_at, attempt_id);
CREATE INDEX diagnostic_reproduction_bundles_case_idx
  ON diagnostic_reproduction_bundles (installation_id, case_id, created_at, bundle_id);

CREATE TRIGGER diagnostic_cases_immutable BEFORE UPDATE OR DELETE ON diagnostic_cases
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_failure_specifications_immutable BEFORE UPDATE OR DELETE ON diagnostic_failure_specifications
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_reproduction_attempts_immutable BEFORE UPDATE OR DELETE ON diagnostic_reproduction_attempts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_reproduction_bundles_immutable BEFORE UPDATE OR DELETE ON diagnostic_reproduction_bundles
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_artifact_tombstones_immutable BEFORE UPDATE OR DELETE ON diagnostic_artifact_tombstones
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
