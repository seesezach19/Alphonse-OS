CREATE TABLE diagnostic_grant_activation_snapshots (
  snapshot_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  grant_type text NOT NULL CHECK (grant_type IN ('observation_reporting', 'tokenization_use')),
  receiver_service_id text NOT NULL,
  grant_document jsonb NOT NULL CHECK (jsonb_typeof(grant_document) = 'object'),
  grant_digest text NOT NULL CHECK (grant_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_sequence bigint NOT NULL CHECK (authority_sequence > 0),
  predecessor_snapshot_digest text CHECK (predecessor_snapshot_digest IS NULL OR predecessor_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  target_state text NOT NULL CHECK (target_state IN ('active', 'revoked')),
  signed_snapshot_bytes bytea NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_key_id text NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE (installation_id, grant_id, authority_sequence),
  UNIQUE (installation_id, snapshot_digest)
);

CREATE TABLE diagnostic_grant_application_receipts (
  application_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES diagnostic_grant_activation_snapshots(snapshot_id),
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

CREATE TABLE diagnostic_grant_application_conflicts (
  conflict_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  snapshot_id uuid,
  claimed_snapshot_digest text NOT NULL CHECK (claimed_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  accepted_snapshot_digest text CHECK (accepted_snapshot_digest IS NULL OR accepted_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  reason text NOT NULL,
  received_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_grant_effective_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  grant_type text NOT NULL CHECK (grant_type IN ('observation_reporting', 'tokenization_use')),
  receiver_service_id text NOT NULL,
  grant_document jsonb NOT NULL CHECK (jsonb_typeof(grant_document) = 'object'),
  grant_digest text NOT NULL CHECK (grant_digest ~ '^sha256:[0-9a-f]{64}$'),
  effective_state text NOT NULL CHECK (effective_state IN ('active', 'revoked')),
  authority_sequence bigint NOT NULL CHECK (authority_sequence > 0),
  snapshot_id uuid NOT NULL REFERENCES diagnostic_grant_activation_snapshots(snapshot_id),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  application_receipt_id uuid NOT NULL REFERENCES diagnostic_grant_application_receipts(application_receipt_id),
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, grant_id)
);

CREATE TRIGGER diagnostic_grant_snapshots_immutable BEFORE UPDATE OR DELETE ON diagnostic_grant_activation_snapshots
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_grant_applications_immutable BEFORE UPDATE OR DELETE ON diagnostic_grant_application_receipts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_grant_conflicts_immutable BEFORE UPDATE OR DELETE ON diagnostic_grant_application_conflicts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
