CREATE TABLE kernel_authority_grants (
  grant_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_type text NOT NULL CHECK (grant_type IN ('observation_reporting', 'tokenization_use')),
  receiver_service_id text NOT NULL,
  grant_document jsonb NOT NULL CHECK (jsonb_typeof(grant_document) = 'object'),
  grant_digest text NOT NULL CHECK (grant_digest ~ '^sha256:[0-9a-f]{64}$'),
  registered_by_actor_id text NOT NULL,
  registered_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, grant_digest)
);

CREATE TABLE kernel_authority_grant_readiness_receipts (
  readiness_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES kernel_authority_grants(grant_id),
  readiness_receipt jsonb NOT NULL CHECK (jsonb_typeof(readiness_receipt) = 'object'),
  readiness_receipt_digest text NOT NULL CHECK (readiness_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  readiness_status text NOT NULL CHECK (readiness_status IN ('ready', 'failed')),
  recorded_by_actor_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, grant_id, readiness_receipt_digest)
);

CREATE TABLE kernel_authority_grant_snapshots (
  snapshot_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES kernel_authority_grants(grant_id),
  grant_type text NOT NULL CHECK (grant_type IN ('observation_reporting', 'tokenization_use')),
  receiver_service_id text NOT NULL,
  grant_document jsonb NOT NULL CHECK (jsonb_typeof(grant_document) = 'object'),
  grant_digest text NOT NULL CHECK (grant_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_sequence bigint NOT NULL CHECK (authority_sequence > 0),
  predecessor_snapshot_digest text CHECK (predecessor_snapshot_digest IS NULL OR predecessor_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  target_state text NOT NULL CHECK (target_state IN ('active', 'revoked')),
  signed_snapshot_bytes bytea NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  signing_key_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  published_by_actor_id text NOT NULL,
  published_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, grant_id, authority_sequence),
  UNIQUE (installation_id, environment_id, snapshot_digest)
);

CREATE TABLE kernel_authority_grant_application_receipts (
  application_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES kernel_authority_grants(grant_id),
  snapshot_id uuid NOT NULL REFERENCES kernel_authority_grant_snapshots(snapshot_id),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  receiver_service_id text NOT NULL,
  authority_sequence bigint NOT NULL CHECK (authority_sequence > 0),
  target_state text NOT NULL CHECK (target_state IN ('active', 'revoked')),
  service_transaction_id uuid NOT NULL,
  service_transaction_position bigint NOT NULL CHECK (service_transaction_position > 0),
  signed_receipt_bytes bytea NOT NULL,
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  verification_key_id text NOT NULL,
  applied_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, snapshot_digest),
  UNIQUE (installation_id, environment_id, receiver_service_id, service_transaction_id),
  UNIQUE (installation_id, environment_id, receipt_digest)
);

CREATE TABLE kernel_authority_grant_application_conflicts (
  conflict_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  application_receipt_id uuid,
  claimed_receipt_digest text NOT NULL CHECK (claimed_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  accepted_receipt_digest text CHECK (accepted_receipt_digest IS NULL OR accepted_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  reason text NOT NULL,
  received_at timestamptz NOT NULL
);

CREATE TABLE kernel_authority_grant_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES kernel_authority_grants(grant_id),
  desired_state text NOT NULL CHECK (desired_state IN ('inactive', 'activation_pending', 'active', 'revocation_pending', 'revoked')),
  effective_state text NOT NULL CHECK (effective_state IN ('inactive', 'active_effective', 'revoked_effective')),
  latest_readiness_receipt_id uuid REFERENCES kernel_authority_grant_readiness_receipts(readiness_receipt_id),
  latest_snapshot_id uuid REFERENCES kernel_authority_grant_snapshots(snapshot_id),
  latest_snapshot_digest text CHECK (latest_snapshot_digest IS NULL OR latest_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  latest_authority_sequence bigint NOT NULL DEFAULT 0 CHECK (latest_authority_sequence >= 0),
  effective_snapshot_id uuid REFERENCES kernel_authority_grant_snapshots(snapshot_id),
  effective_application_receipt_id uuid REFERENCES kernel_authority_grant_application_receipts(application_receipt_id),
  effective_at timestamptz,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, grant_id)
);

CREATE INDEX kernel_authority_grant_state_idx
  ON kernel_authority_grant_states(installation_id, environment_id, effective_state);

CREATE TRIGGER kernel_authority_grants_immutable BEFORE UPDATE OR DELETE ON kernel_authority_grants
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_authority_readiness_immutable BEFORE UPDATE OR DELETE ON kernel_authority_grant_readiness_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_authority_snapshots_immutable BEFORE UPDATE OR DELETE ON kernel_authority_grant_snapshots
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_authority_applications_immutable BEFORE UPDATE OR DELETE ON kernel_authority_grant_application_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_authority_conflicts_immutable BEFORE UPDATE OR DELETE ON kernel_authority_grant_application_conflicts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
