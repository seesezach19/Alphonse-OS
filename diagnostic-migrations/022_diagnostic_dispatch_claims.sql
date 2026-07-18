CREATE TABLE diagnostic_dispatch_authorization_consumptions (
  dispatch_authorization_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  assignment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_assignments(assignment_id),
  assignment_digest text NOT NULL CHECK (assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  worker_run_id uuid NOT NULL UNIQUE,
  kernel_authorization_digest text NOT NULL UNIQUE
    CHECK (kernel_authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_authorization_digest text NOT NULL UNIQUE
    CHECK (signed_authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  nonce_digest text NOT NULL UNIQUE CHECK (nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  decision_artifact_digest text NOT NULL
    CHECK (decision_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  claim_command_id text NOT NULL,
  consumption_document jsonb NOT NULL CHECK (jsonb_typeof(consumption_document) = 'object'),
  consumption_digest text NOT NULL UNIQUE CHECK (consumption_digest ~ '^sha256:[0-9a-f]{64}$'),
  consumed_by_type text NOT NULL,
  consumed_by_id text NOT NULL,
  consumed_at timestamptz NOT NULL,
  UNIQUE (installation_id, claim_command_id)
);

CREATE TABLE diagnostic_worker_runs (
  worker_run_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  assignment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_assignments(assignment_id),
  assignment_digest text NOT NULL CHECK (assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  dispatch_authorization_id uuid NOT NULL UNIQUE
    REFERENCES diagnostic_dispatch_authorization_consumptions(dispatch_authorization_id),
  worker_principal_id uuid NOT NULL,
  worker_passport_id uuid NOT NULL,
  worker_passport_configuration_digest text NOT NULL
    CHECK (worker_passport_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  worker_run_document jsonb NOT NULL CHECK (jsonb_typeof(worker_run_document) = 'object'),
  worker_run_digest text NOT NULL UNIQUE CHECK (worker_run_digest ~ '^sha256:[0-9a-f]{64}$'),
  claim_transition_id uuid NOT NULL UNIQUE REFERENCES diagnostic_transitions(transition_id) DEFERRABLE INITIALLY DEFERRED,
  claimed_by_type text NOT NULL,
  claimed_by_id text NOT NULL,
  claimed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > claimed_at)
);

CREATE TABLE diagnostic_worker_run_states (
  worker_run_id uuid PRIMARY KEY REFERENCES diagnostic_worker_runs(worker_run_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  worker_run_digest text NOT NULL CHECK (worker_run_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('claimed_not_launched','launching','running','completed','failed','cancelled')),
  state_revision bigint NOT NULL CHECK (state_revision >= 0),
  last_transition_id uuid NOT NULL REFERENCES diagnostic_transitions(transition_id) DEFERRABLE INITIALLY DEFERRED,
  updated_at timestamptz NOT NULL
);

CREATE INDEX diagnostic_worker_runs_assignment_idx
  ON diagnostic_worker_runs (installation_id, environment_id, assignment_id, claimed_at);
CREATE INDEX diagnostic_worker_run_state_idx
  ON diagnostic_worker_run_states (installation_id, environment_id, state, updated_at, worker_run_id);

CREATE TRIGGER diagnostic_dispatch_authorization_consumptions_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_dispatch_authorization_consumptions
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_worker_runs_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_worker_runs
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION diagnostic_validate_worker_run_state_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.worker_run_id <> NEW.worker_run_id
     OR OLD.installation_id <> NEW.installation_id
     OR OLD.environment_id <> NEW.environment_id
     OR OLD.worker_run_digest <> NEW.worker_run_digest
     OR NEW.state_revision <> OLD.state_revision + 1
     OR NOT ((OLD.state = 'claimed_not_launched' AND NEW.state IN ('launching','cancelled'))
       OR (OLD.state = 'launching' AND NEW.state IN ('running','failed','cancelled'))
       OR (OLD.state = 'running' AND NEW.state IN ('completed','failed','cancelled'))) THEN
    RAISE EXCEPTION 'diagnostic worker run state transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER diagnostic_worker_run_states_guard
  BEFORE UPDATE ON diagnostic_worker_run_states
  FOR EACH ROW EXECUTE FUNCTION diagnostic_validate_worker_run_state_update();
CREATE TRIGGER diagnostic_worker_run_states_no_delete
  BEFORE DELETE ON diagnostic_worker_run_states
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
