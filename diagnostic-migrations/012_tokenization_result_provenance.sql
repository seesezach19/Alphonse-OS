CREATE TABLE tokenization_service_sequences (
  installation_id uuid PRIMARY KEY,
  next_position bigint NOT NULL DEFAULT 1 CHECK (next_position >= 1),
  updated_at timestamptz NOT NULL
);

CREATE TABLE tokenization_grant_activation_snapshots (
  snapshot_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  grant_type text NOT NULL CHECK (grant_type = 'tokenization_use'),
  receiver_service_id text NOT NULL CHECK (receiver_service_id = 'tokenization-service'),
  grant_document jsonb NOT NULL CHECK (jsonb_typeof(grant_document) = 'object'),
  grant_digest text NOT NULL CHECK (grant_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_sequence bigint NOT NULL CHECK (authority_sequence > 0),
  predecessor_snapshot_digest text,
  target_state text NOT NULL CHECK (target_state IN ('active', 'revoked')),
  signed_snapshot_bytes bytea NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_key_id text NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE (installation_id, grant_id, authority_sequence),
  UNIQUE (installation_id, snapshot_digest)
);

CREATE TABLE tokenization_grant_application_receipts (
  application_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES tokenization_grant_activation_snapshots(snapshot_id),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_sequence bigint NOT NULL CHECK (authority_sequence > 0),
  applied_state text NOT NULL CHECK (applied_state IN ('active', 'revoked')),
  service_transaction_id uuid NOT NULL,
  service_transaction_position bigint NOT NULL CHECK (service_transaction_position > 0),
  signed_receipt_bytes bytea NOT NULL,
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  service_key_id text NOT NULL,
  applied_at timestamptz NOT NULL,
  UNIQUE (installation_id, snapshot_digest),
  UNIQUE (installation_id, service_transaction_id),
  UNIQUE (installation_id, receipt_digest)
);

CREATE TABLE tokenization_grant_effective_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  grant_type text NOT NULL CHECK (grant_type = 'tokenization_use'),
  receiver_service_id text NOT NULL CHECK (receiver_service_id = 'tokenization-service'),
  grant_document jsonb NOT NULL CHECK (jsonb_typeof(grant_document) = 'object'),
  grant_digest text NOT NULL CHECK (grant_digest ~ '^sha256:[0-9a-f]{64}$'),
  effective_state text NOT NULL CHECK (effective_state IN ('active', 'revoked')),
  authority_sequence bigint NOT NULL CHECK (authority_sequence > 0),
  snapshot_id uuid NOT NULL REFERENCES tokenization_grant_activation_snapshots(snapshot_id),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  application_receipt_id uuid NOT NULL REFERENCES tokenization_grant_application_receipts(application_receipt_id),
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, grant_id)
);

CREATE TABLE tokenization_grant_application_conflicts (
  conflict_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  snapshot_id uuid,
  claimed_snapshot_digest text NOT NULL CHECK (claimed_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  accepted_snapshot_digest text,
  reason text NOT NULL,
  received_at timestamptz NOT NULL
);

CREATE TABLE tokenization_requests (
  request_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  requester_principal_id text NOT NULL,
  integration_id text NOT NULL,
  field_role text NOT NULL,
  claim_field text NOT NULL,
  namespace text NOT NULL,
  algorithm_version text NOT NULL,
  input_length bigint NOT NULL CHECK (input_length >= 0),
  request_digest text NOT NULL CHECK (request_digest ~ '^hmac-sha256:[0-9a-f]{64}$'),
  accepted_at timestamptz NOT NULL,
  UNIQUE (installation_id, request_digest)
);

CREATE TABLE tokenization_result_receipts (
  result_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES tokenization_requests(request_id),
  grant_id uuid NOT NULL,
  requester_principal_id text NOT NULL,
  integration_id text NOT NULL,
  field_role text NOT NULL,
  claim_field text NOT NULL,
  namespace text NOT NULL,
  algorithm_version text NOT NULL,
  equality_token text NOT NULL,
  input_length bigint NOT NULL CHECK (input_length >= 0),
  collection_window_id text NOT NULL,
  service_id text NOT NULL,
  service_version text NOT NULL,
  service_key_id text NOT NULL,
  signed_receipt_bytes bytea NOT NULL,
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_grant_snapshot_bytes bytea NOT NULL,
  grant_snapshot_digest text NOT NULL CHECK (grant_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_grant_application_receipt_bytes bytea NOT NULL,
  grant_application_receipt_digest text NOT NULL CHECK (grant_application_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  UNIQUE (installation_id, request_id),
  UNIQUE (installation_id, receipt_digest)
);

CREATE TABLE diagnostic_tokenization_result_receipts (
  result_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  request_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  requester_principal_id text NOT NULL,
  integration_id text NOT NULL,
  field_role text NOT NULL,
  claim_field text NOT NULL,
  namespace text NOT NULL,
  algorithm_version text NOT NULL,
  equality_token text NOT NULL,
  input_length bigint NOT NULL CHECK (input_length >= 0),
  collection_window_id text NOT NULL,
  service_id text NOT NULL,
  service_version text NOT NULL,
  service_key_id text NOT NULL,
  signed_receipt_bytes bytea NOT NULL,
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  grant_snapshot_digest text NOT NULL CHECK (grant_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  grant_application_receipt_digest text NOT NULL CHECK (grant_application_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_grant_snapshot_bytes bytea NOT NULL,
  signed_grant_application_receipt_bytes bytea NOT NULL,
  preserved_at timestamptz NOT NULL,
  UNIQUE (installation_id, request_id),
  UNIQUE (installation_id, receipt_digest)
);

CREATE TABLE diagnostic_tokenization_result_conflicts (
  conflict_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  result_receipt_id uuid NOT NULL,
  received_receipt_digest text NOT NULL CHECK (received_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  accepted_receipt_digest text NOT NULL CHECK (accepted_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  reason text NOT NULL,
  detected_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_observation_provenance_dependencies (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  observation_receipt_id uuid NOT NULL REFERENCES diagnostic_observation_receipts(receipt_id),
  dependency_type text NOT NULL CHECK (dependency_type = 'tokenization_result_receipt'),
  dependency_id uuid NOT NULL REFERENCES diagnostic_tokenization_result_receipts(result_receipt_id),
  dependency_digest text NOT NULL CHECK (dependency_digest ~ '^sha256:[0-9a-f]{64}$'),
  PRIMARY KEY (installation_id, observation_receipt_id, dependency_id)
);

CREATE TRIGGER tokenization_requests_immutable BEFORE UPDATE OR DELETE ON tokenization_requests
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER tokenization_results_immutable BEFORE UPDATE OR DELETE ON tokenization_result_receipts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_tokenization_results_immutable BEFORE UPDATE OR DELETE ON diagnostic_tokenization_result_receipts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_tokenization_conflicts_immutable BEFORE UPDATE OR DELETE ON diagnostic_tokenization_result_conflicts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_observation_dependencies_immutable BEFORE UPDATE OR DELETE ON diagnostic_observation_provenance_dependencies
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE TRIGGER tokenization_grant_snapshots_immutable BEFORE UPDATE OR DELETE ON tokenization_grant_activation_snapshots
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER tokenization_grant_applications_immutable BEFORE UPDATE OR DELETE ON tokenization_grant_application_receipts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER tokenization_grant_conflicts_immutable BEFORE UPDATE OR DELETE ON tokenization_grant_application_conflicts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

GRANT USAGE ON SCHEMA public TO alphonse_tokenization;
GRANT SELECT, INSERT, UPDATE ON tokenization_service_sequences TO alphonse_tokenization;
GRANT SELECT, INSERT ON tokenization_grant_activation_snapshots,
  tokenization_grant_application_receipts, tokenization_grant_application_conflicts,
  tokenization_requests, tokenization_result_receipts TO alphonse_tokenization;
GRANT SELECT, INSERT, UPDATE ON tokenization_grant_effective_states TO alphonse_tokenization;
