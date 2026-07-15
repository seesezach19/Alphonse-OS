ALTER TABLE kernel_environments
  ADD COLUMN operational_state text NOT NULL DEFAULT 'active'
    CHECK (operational_state IN ('active', 'restore_suspended', 'destroyed')),
  ADD COLUMN restore_generation bigint NOT NULL DEFAULT 0 CHECK (restore_generation >= 0);

CREATE TABLE kernel_restore_sessions (
  restore_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  backup_id text NOT NULL,
  backup_manifest jsonb NOT NULL CHECK (jsonb_typeof(backup_manifest) = 'object'),
  backup_manifest_digest text NOT NULL CHECK (backup_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  restore_point_sequence bigint NOT NULL CHECK (restore_point_sequence >= 0),
  previous_execution_epoch bigint NOT NULL CHECK (previous_execution_epoch > 0),
  execution_epoch bigint NOT NULL CHECK (execution_epoch > previous_execution_epoch),
  status text NOT NULL CHECK (status IN ('suspended', 'reconciling', 'verified', 'resumed')),
  verification jsonb,
  started_at timestamptz NOT NULL,
  verified_at timestamptz,
  resumed_at timestamptz,
  UNIQUE (installation_id, environment_id, restore_id),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id)
);

CREATE TABLE kernel_restore_obligations (
  restore_obligation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  restore_id uuid NOT NULL,
  effect_id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason = 'possibly_applied_after_restore_point'),
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, restore_id, effect_id),
  FOREIGN KEY (installation_id, environment_id, restore_id)
    REFERENCES kernel_restore_sessions(installation_id, environment_id, restore_id),
  FOREIGN KEY (installation_id, environment_id, effect_id)
    REFERENCES kernel_effect_records(installation_id, environment_id, effect_id),
  FOREIGN KEY (installation_id, environment_id, recovery_case_id)
    REFERENCES kernel_recovery_cases(installation_id, environment_id, recovery_case_id)
);

CREATE TABLE kernel_projection_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  projection_name text NOT NULL,
  projection_version text NOT NULL,
  source_cursor bigint NOT NULL CHECK (source_cursor >= 0),
  health text NOT NULL CHECK (health IN ('current', 'delayed', 'rebuilding', 'failed')),
  projection_digest text NOT NULL CHECK (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  generated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, projection_name),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id)
);

CREATE TABLE kernel_data_lifecycle_records (
  lifecycle_record_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  lifecycle_kind text NOT NULL CHECK (lifecycle_kind IN
    ('typed_tombstone', 'authority_expiration', 'identity_pseudonymization', 'environment_destruction')),
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  detail_digest text NOT NULL CHECK (detail_digest ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, lifecycle_record_id),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id)
);

CREATE TRIGGER kernel_restore_obligations_immutable BEFORE UPDATE OR DELETE ON kernel_restore_obligations
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_data_lifecycle_records_immutable BEFORE UPDATE OR DELETE ON kernel_data_lifecycle_records
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
