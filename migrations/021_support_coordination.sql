CREATE TABLE kernel_environment_health_publications (
  health_publication_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  signed_health jsonb NOT NULL CHECK (jsonb_typeof(signed_health) = 'object'),
  health_digest text NOT NULL CHECK (health_digest ~ '^sha256:[0-9a-f]{64}$'),
  published_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, health_digest)
);

CREATE TABLE kernel_received_support_cases (
  support_case_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  signed_request jsonb NOT NULL CHECK (jsonb_typeof(signed_request) = 'object'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, support_case_id),
  UNIQUE (installation_id, environment_id, request_digest)
);

CREATE TABLE kernel_support_case_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  support_case_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('requested', 'approved', 'declined', 'cancelled')),
  revision bigint NOT NULL CHECK (revision >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, support_case_id),
  FOREIGN KEY (installation_id, environment_id, support_case_id)
    REFERENCES kernel_received_support_cases(installation_id, environment_id, support_case_id)
);

CREATE TABLE kernel_support_passports (
  support_passport_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  support_case_id uuid NOT NULL,
  authentication_digest text NOT NULL CHECK (authentication_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_notice jsonb NOT NULL CHECK (jsonb_typeof(signed_notice) = 'object'),
  notice_digest text NOT NULL CHECK (notice_digest ~ '^sha256:[0-9a-f]{64}$'),
  issued_by_actor_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, authentication_digest),
  UNIQUE (installation_id, environment_id, support_case_id)
);

CREATE TABLE kernel_support_passport_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  support_passport_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'revoked')),
  revision bigint NOT NULL CHECK (revision >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, support_passport_id),
  FOREIGN KEY (support_passport_id) REFERENCES kernel_support_passports(support_passport_id)
);

CREATE TABLE kernel_diagnostic_bundles (
  diagnostic_bundle_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  support_passport_id uuid NOT NULL REFERENCES kernel_support_passports(support_passport_id),
  diagnostic_scopes jsonb NOT NULL CHECK (jsonb_typeof(diagnostic_scopes) = 'array'),
  ciphertext text NOT NULL,
  initialization_vector text NOT NULL,
  authentication_tag text NOT NULL,
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  redaction_manifest jsonb NOT NULL CHECK (jsonb_typeof(redaction_manifest) = 'object'),
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE kernel_diagnostic_access_records (
  access_record_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  diagnostic_bundle_id uuid NOT NULL REFERENCES kernel_diagnostic_bundles(diagnostic_bundle_id),
  support_passport_id uuid NOT NULL REFERENCES kernel_support_passports(support_passport_id),
  support_identity jsonb NOT NULL CHECK (jsonb_typeof(support_identity) = 'object'),
  accessed_at timestamptz NOT NULL
);

CREATE TABLE kernel_support_remediation_authorizations (
  remediation_authorization_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  support_passport_id uuid NOT NULL REFERENCES kernel_support_passports(support_passport_id),
  capability_admission jsonb NOT NULL CHECK (jsonb_typeof(capability_admission) = 'object'),
  requested_action jsonb NOT NULL CHECK (jsonb_typeof(requested_action) = 'object'),
  authorized_by_actor_id text NOT NULL,
  authorized_at timestamptz NOT NULL
);

CREATE TABLE kernel_host_security_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  host_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'quarantined')),
  placement_eligible boolean NOT NULL,
  current_key_id text NOT NULL,
  revoked_key_id text,
  revision bigint NOT NULL CHECK (revision >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, host_id)
);

CREATE TABLE kernel_host_key_events (
  host_key_event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  host_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('registered', 'revoked_and_rotated')),
  prior_key_id text,
  replacement_key_id text NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE TABLE kernel_coordinator_revocation_deliveries (
  revocation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  signed_revocation jsonb NOT NULL CHECK (jsonb_typeof(signed_revocation) = 'object'),
  revocation_digest text NOT NULL CHECK (revocation_digest ~ '^sha256:[0-9a-f]{64}$'),
  delivered_at timestamptz NOT NULL
);

CREATE INDEX kernel_support_cases_state_idx ON kernel_support_case_states(installation_id, environment_id, state);
CREATE INDEX kernel_diagnostic_bundle_expiry_idx ON kernel_diagnostic_bundles(installation_id, environment_id, expires_at);
CREATE INDEX kernel_diagnostic_access_bundle_idx ON kernel_diagnostic_access_records(diagnostic_bundle_id, accessed_at);

CREATE TRIGGER kernel_health_publications_immutable BEFORE UPDATE OR DELETE ON kernel_environment_health_publications
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_received_support_cases_immutable BEFORE UPDATE OR DELETE ON kernel_received_support_cases
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_support_passports_immutable BEFORE UPDATE OR DELETE ON kernel_support_passports
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_diagnostic_bundles_immutable BEFORE UPDATE OR DELETE ON kernel_diagnostic_bundles
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_diagnostic_access_records_immutable BEFORE UPDATE OR DELETE ON kernel_diagnostic_access_records
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_support_remediation_immutable BEFORE UPDATE OR DELETE ON kernel_support_remediation_authorizations
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_host_key_events_immutable BEFORE UPDATE OR DELETE ON kernel_host_key_events
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_coordinator_revocation_deliveries_immutable BEFORE UPDATE OR DELETE ON kernel_coordinator_revocation_deliveries
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
