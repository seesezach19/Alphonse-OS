CREATE TABLE kernel_recovery_cases (
  recovery_case_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  effect_id uuid NOT NULL,
  run_id uuid NOT NULL,
  known_facts jsonb NOT NULL CHECK (jsonb_typeof(known_facts) = 'array'),
  missing_evidence jsonb NOT NULL CHECK (jsonb_typeof(missing_evidence) = 'array'),
  responsible_actor jsonb NOT NULL CHECK (jsonb_typeof(responsible_actor) = 'object'),
  allowed_options jsonb NOT NULL CHECK (jsonb_typeof(allowed_options) = 'array'),
  deadline_at timestamptz NOT NULL,
  opened_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, recovery_case_id),
  UNIQUE (installation_id, environment_id, effect_id),
  FOREIGN KEY (installation_id, environment_id, effect_id)
    REFERENCES kernel_effect_records(installation_id, environment_id, effect_id),
  FOREIGN KEY (installation_id, environment_id, run_id)
    REFERENCES kernel_runs(installation_id, environment_id, run_id)
);

CREATE TABLE kernel_reconciliation_permits (
  reconciliation_permit_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  effect_id uuid NOT NULL,
  permit_document jsonb NOT NULL CHECK (jsonb_typeof(permit_document) = 'object'),
  permit_digest text NOT NULL CHECK (permit_digest ~ '^sha256:[0-9a-f]{64}$'),
  key_id text NOT NULL,
  signature text NOT NULL CHECK (signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, reconciliation_permit_id),
  FOREIGN KEY (installation_id, environment_id, recovery_case_id)
    REFERENCES kernel_recovery_cases(installation_id, environment_id, recovery_case_id),
  FOREIGN KEY (installation_id, environment_id, effect_id)
    REFERENCES kernel_effect_records(installation_id, environment_id, effect_id)
);

CREATE TABLE kernel_reconciliation_records (
  reconciliation_record_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  effect_id uuid NOT NULL,
  reconciliation_permit_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied', 'not_applied')),
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation) = 'object'),
  observation_digest text NOT NULL CHECK (observation_digest ~ '^sha256:[0-9a-f]{64}$'),
  evidence_record_id uuid,
  corrective_work_intent_proposal jsonb,
  recorded_by_principal_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, reconciliation_record_id),
  UNIQUE (installation_id, environment_id, recovery_case_id),
  FOREIGN KEY (installation_id, environment_id, recovery_case_id)
    REFERENCES kernel_recovery_cases(installation_id, environment_id, recovery_case_id),
  FOREIGN KEY (installation_id, environment_id, effect_id)
    REFERENCES kernel_effect_records(installation_id, environment_id, effect_id),
  FOREIGN KEY (installation_id, environment_id, reconciliation_permit_id)
    REFERENCES kernel_reconciliation_permits(installation_id, environment_id, reconciliation_permit_id),
  FOREIGN KEY (installation_id, environment_id, evidence_record_id)
    REFERENCES kernel_evidence_records(installation_id, environment_id, evidence_record_id),
  FOREIGN KEY (installation_id, environment_id, recorded_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_recovery_case_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'reconciling', 'resolved_applied', 'open_not_applied')),
  reconciliation_status text NOT NULL CHECK (reconciliation_status IN ('pending', 'in_progress', 'applied', 'not_applied')),
  reconciliation_record_id uuid,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, recovery_case_id),
  FOREIGN KEY (installation_id, environment_id, recovery_case_id)
    REFERENCES kernel_recovery_cases(installation_id, environment_id, recovery_case_id),
  FOREIGN KEY (installation_id, environment_id, reconciliation_record_id)
    REFERENCES kernel_reconciliation_records(installation_id, environment_id, reconciliation_record_id)
);

CREATE TABLE kernel_reconciliation_failures (
  reconciliation_failure_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  reconciliation_permit_id uuid NOT NULL,
  issue jsonb NOT NULL CHECK (jsonb_typeof(issue) = 'object'),
  recorded_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, reconciliation_failure_id),
  FOREIGN KEY (installation_id, environment_id, recovery_case_id)
    REFERENCES kernel_recovery_cases(installation_id, environment_id, recovery_case_id),
  FOREIGN KEY (installation_id, environment_id, reconciliation_permit_id)
    REFERENCES kernel_reconciliation_permits(installation_id, environment_id, reconciliation_permit_id)
);

CREATE TABLE kernel_reconciliation_permit_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  reconciliation_permit_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('issued', 'consumed', 'expired')),
  consumed_at timestamptz,
  brokered_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, reconciliation_permit_id),
  FOREIGN KEY (installation_id, environment_id, reconciliation_permit_id)
    REFERENCES kernel_reconciliation_permits(installation_id, environment_id, reconciliation_permit_id)
);

ALTER TABLE kernel_effect_states ADD COLUMN was_uncertain boolean NOT NULL DEFAULT false;
ALTER TABLE kernel_effect_states ADD COLUMN recovery_case_id uuid;
ALTER TABLE kernel_effect_records ADD COLUMN effect_request_digest text
  CHECK (effect_request_digest IS NULL OR effect_request_digest ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE kernel_effect_states ADD CONSTRAINT kernel_effect_states_recovery_case_fk
  FOREIGN KEY (installation_id, environment_id, recovery_case_id)
  REFERENCES kernel_recovery_cases(installation_id, environment_id, recovery_case_id);
ALTER TABLE kernel_operational_obligations ADD COLUMN breached_at timestamptz;
ALTER TABLE kernel_operational_obligations ADD COLUMN resolution_detail jsonb;

CREATE INDEX kernel_recovery_case_status_idx
  ON kernel_recovery_case_states (installation_id, environment_id, status, updated_at DESC);

CREATE TRIGGER kernel_recovery_cases_immutable BEFORE UPDATE OR DELETE ON kernel_recovery_cases
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_reconciliation_permits_immutable BEFORE UPDATE OR DELETE ON kernel_reconciliation_permits
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_reconciliation_records_immutable BEFORE UPDATE OR DELETE ON kernel_reconciliation_records
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_reconciliation_failures_immutable BEFORE UPDATE OR DELETE ON kernel_reconciliation_failures
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
