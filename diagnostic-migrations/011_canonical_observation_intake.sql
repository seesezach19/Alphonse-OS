CREATE TABLE diagnostic_observation_schema_activations (
  activation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  deployment_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  package_artifact_digest text NOT NULL CHECK (package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  schema_id text NOT NULL,
  schema_version text NOT NULL,
  schema_digest text NOT NULL CHECK (schema_digest ~ '^sha256:[0-9a-f]{64}$'),
  observation_type text NOT NULL,
  schema_artifact jsonb NOT NULL CHECK (jsonb_typeof(schema_artifact) = 'object'),
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, deployment_id, schema_id, schema_version, schema_digest),
  UNIQUE (installation_id, environment_id, schema_id, schema_version, schema_digest)
);

CREATE TABLE diagnostic_intake_prefixes (
  installation_id uuid PRIMARY KEY REFERENCES diagnostic_nodes(installation_id),
  next_position bigint NOT NULL DEFAULT 1 CHECK (next_position >= 1),
  updated_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_observation_stream_coverage (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  grant_id uuid NOT NULL,
  stream_id text NOT NULL,
  highest_sequence_seen bigint NOT NULL CHECK (highest_sequence_seen >= 1),
  contiguous_through bigint NOT NULL CHECK (contiguous_through >= 0),
  received_ranges jsonb NOT NULL CHECK (jsonb_typeof(received_ranges) = 'array'),
  missing_ranges jsonb NOT NULL CHECK (jsonb_typeof(missing_ranges) = 'array'),
  coverage_status text NOT NULL CHECK (coverage_status IN ('incomplete', 'complete_through_high_water')),
  last_received_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, grant_id, stream_id)
);

CREATE TABLE diagnostic_observation_receipts (
  receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  intake_position bigint NOT NULL,
  observation_id uuid NOT NULL,
  principal_id text NOT NULL,
  grant_id uuid NOT NULL,
  key_id text NOT NULL,
  stream_id text NOT NULL,
  stream_sequence bigint NOT NULL CHECK (stream_sequence >= 1),
  observation_type text NOT NULL,
  schema_id text NOT NULL,
  schema_version text NOT NULL,
  schema_digest text NOT NULL CHECK (schema_digest ~ '^sha256:[0-9a-f]{64}$'),
  schema_activation_id uuid NOT NULL REFERENCES diagnostic_observation_schema_activations(activation_id),
  workflow_id text,
  integration_id text,
  envelope jsonb NOT NULL CHECK (jsonb_typeof(envelope) = 'object'),
  envelope_bytes bytea NOT NULL,
  envelope_digest text NOT NULL CHECK (envelope_digest ~ '^sha256:[0-9a-f]{64}$'),
  detail_artifact_digest text,
  authentication jsonb NOT NULL CHECK (jsonb_typeof(authentication) = 'object'),
  grant_snapshot_digest text NOT NULL CHECK (grant_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  attribution text NOT NULL CHECK (attribution = 'authenticated_under_observer_specific_grant'),
  external_truth_established boolean NOT NULL CHECK (external_truth_established = false),
  exclusive_authorship_established boolean NOT NULL CHECK (exclusive_authorship_established = false),
  received_at timestamptz NOT NULL,
  transition_id uuid NOT NULL REFERENCES diagnostic_transitions(transition_id),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  UNIQUE (installation_id, intake_position),
  UNIQUE (installation_id, observation_id),
  UNIQUE (installation_id, grant_id, stream_id, stream_sequence),
  UNIQUE (installation_id, receipt_digest),
  FOREIGN KEY (installation_id, detail_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_observation_conflicts (
  conflict_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  intake_position bigint NOT NULL,
  received_observation_id uuid NOT NULL,
  received_grant_id uuid NOT NULL,
  received_stream_id text NOT NULL,
  received_stream_sequence bigint NOT NULL,
  received_envelope_digest text NOT NULL CHECK (received_envelope_digest ~ '^sha256:[0-9a-f]{64}$'),
  conflict_types jsonb NOT NULL CHECK (jsonb_typeof(conflict_types) = 'array'),
  accepted_receipt_ids jsonb NOT NULL CHECK (jsonb_typeof(accepted_receipt_ids) = 'array'),
  detected_at timestamptz NOT NULL,
  conflict_digest text NOT NULL CHECK (conflict_digest ~ '^sha256:[0-9a-f]{64}$'),
  UNIQUE (installation_id, intake_position),
  UNIQUE (installation_id, conflict_digest)
);

CREATE TABLE diagnostic_observation_rejections (
  rejection_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  intake_position bigint NOT NULL,
  authenticated_principal_id text,
  authenticated_grant_id uuid,
  claimed_schema_id text,
  claimed_schema_version text,
  claimed_schema_digest text,
  body_digest text NOT NULL CHECK (body_digest ~ '^sha256:[0-9a-f]{64}$'),
  body_size_bytes bigint NOT NULL CHECK (body_size_bytes >= 0),
  reason_code text NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE (installation_id, intake_position)
);

CREATE TABLE diagnostic_intake_outcomes (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  intake_position bigint NOT NULL,
  outcome_type text NOT NULL CHECK (outcome_type IN ('accepted', 'conflict', 'rejected')),
  outcome_id uuid NOT NULL,
  outcome_digest text NOT NULL CHECK (outcome_digest ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, intake_position)
);

CREATE INDEX diagnostic_observation_receipts_stream_idx
  ON diagnostic_observation_receipts (installation_id, grant_id, stream_id, stream_sequence);
CREATE INDEX diagnostic_observation_receipts_operation_idx
  ON diagnostic_observation_receipts (installation_id, ((envelope->'claims'->>'logical_operation_id')));

CREATE TRIGGER diagnostic_observation_schema_activations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_observation_schema_activations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_observation_receipts_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_observation_receipts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_observation_conflicts_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_observation_conflicts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_observation_rejections_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_observation_rejections
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_intake_outcomes_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_intake_outcomes
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

INSERT INTO diagnostic_intake_prefixes (installation_id, next_position, updated_at)
SELECT installation_id, 1, now() FROM diagnostic_nodes
ON CONFLICT (installation_id) DO NOTHING;
