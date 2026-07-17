CREATE TABLE diagnostic_correlation_registrations (
  registration_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  deployment_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  package_artifact_digest text NOT NULL CHECK (package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  package_manifest_digest text NOT NULL CHECK (package_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  package_dependency_digest text NOT NULL CHECK (package_dependency_digest ~ '^sha256:[0-9a-f]{64}$'),
  workflow_id text NOT NULL,
  revision_id uuid NOT NULL REFERENCES diagnostic_agent_revisions(revision_id),
  revision_snapshot_digest text NOT NULL CHECK (revision_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  integration_id text NOT NULL,
  contract_document jsonb NOT NULL CHECK (jsonb_typeof(contract_document) = 'object'),
  contract_digest text NOT NULL CHECK (contract_digest ~ '^sha256:[0-9a-f]{64}$'),
  contract_dependency_digests jsonb NOT NULL CHECK (jsonb_typeof(contract_dependency_digests) = 'array'),
  projector_id text NOT NULL,
  projector_version text NOT NULL,
  projector_artifact_digest text NOT NULL CHECK (projector_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  projector_rules_digest text NOT NULL CHECK (projector_rules_digest ~ '^sha256:[0-9a-f]{64}$'),
  registration_document jsonb NOT NULL CHECK (jsonb_typeof(registration_document) = 'object'),
  registration_digest text NOT NULL CHECK (registration_digest ~ '^sha256:[0-9a-f]{64}$'),
  registered_by text NOT NULL,
  registered_at timestamptz NOT NULL,
  UNIQUE (installation_id, registration_digest),
  FOREIGN KEY (installation_id, workflow_id)
    REFERENCES diagnostic_agent_workflows(installation_id, workflow_id),
  FOREIGN KEY (installation_id, revision_snapshot_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_correlation_projections (
  projection_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  registration_id uuid NOT NULL REFERENCES diagnostic_correlation_registrations(registration_id),
  logical_operation_id text NOT NULL,
  committed_intake_cutoff bigint NOT NULL CHECK (committed_intake_cutoff >= 1),
  revision_number bigint NOT NULL CHECK (revision_number >= 1),
  semantic_projection jsonb NOT NULL CHECK (jsonb_typeof(semantic_projection) = 'object'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  record_document jsonb NOT NULL CHECK (jsonb_typeof(record_document) = 'object'),
  record_digest text NOT NULL CHECK (record_digest ~ '^sha256:[0-9a-f]{64}$'),
  requested_by text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, registration_id, logical_operation_id, committed_intake_cutoff),
  UNIQUE (installation_id, registration_id, logical_operation_id, revision_number),
  UNIQUE (installation_id, semantic_digest),
  UNIQUE (installation_id, record_digest)
);

CREATE TABLE diagnostic_correlation_projection_conflicts (
  conflict_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  registration_id uuid NOT NULL REFERENCES diagnostic_correlation_registrations(registration_id),
  logical_operation_id text NOT NULL,
  committed_intake_cutoff bigint NOT NULL CHECK (committed_intake_cutoff >= 1),
  accepted_projection_id uuid NOT NULL REFERENCES diagnostic_correlation_projections(projection_id),
  accepted_semantic_digest text NOT NULL CHECK (accepted_semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  received_semantic_digest text NOT NULL CHECK (received_semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  detected_at timestamptz NOT NULL
);

CREATE INDEX diagnostic_correlation_projection_operation_idx
  ON diagnostic_correlation_projections
    (installation_id, registration_id, logical_operation_id, committed_intake_cutoff);

CREATE TRIGGER diagnostic_correlation_registrations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_correlation_registrations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_correlation_projections_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_correlation_projections
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_correlation_projection_conflicts_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_correlation_projection_conflicts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
