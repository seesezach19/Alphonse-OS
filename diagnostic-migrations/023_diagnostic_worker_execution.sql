CREATE TABLE diagnostic_worker_run_launches (
  launch_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  worker_run_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_runs(worker_run_id),
  worker_run_digest text NOT NULL CHECK (worker_run_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_id uuid NOT NULL REFERENCES diagnostic_assignments(assignment_id),
  assignment_digest text NOT NULL CHECK (assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  input_document jsonb NOT NULL CHECK (jsonb_typeof(input_document) = 'object'),
  input_digest text NOT NULL UNIQUE CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  broker_grant_id uuid NOT NULL UNIQUE,
  broker_grant_document jsonb NOT NULL CHECK (jsonb_typeof(broker_grant_document) = 'object'),
  broker_grant_digest text NOT NULL UNIQUE CHECK (broker_grant_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_broker_grant jsonb NOT NULL CHECK (jsonb_typeof(signed_broker_grant) = 'object'),
  signed_broker_grant_digest text NOT NULL UNIQUE
    CHECK (signed_broker_grant_digest ~ '^sha256:[0-9a-f]{64}$'),
  runtime_boundary jsonb NOT NULL CHECK (jsonb_typeof(runtime_boundary) = 'object'),
  launch_transition_id uuid NOT NULL UNIQUE
    REFERENCES diagnostic_transitions(transition_id) DEFERRABLE INITIALLY DEFERRED,
  authorized_by_type text NOT NULL,
  authorized_by_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at)
);

CREATE TABLE diagnostic_worker_run_starts (
  launch_id uuid PRIMARY KEY REFERENCES diagnostic_worker_run_launches(launch_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  worker_run_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_runs(worker_run_id),
  runner_attestation_id uuid NOT NULL UNIQUE,
  attestation_document jsonb NOT NULL CHECK (jsonb_typeof(attestation_document) = 'object'),
  signed_attestation jsonb NOT NULL CHECK (jsonb_typeof(signed_attestation) = 'object'),
  signed_attestation_digest text NOT NULL UNIQUE
    CHECK (signed_attestation_digest ~ '^sha256:[0-9a-f]{64}$'),
  start_transition_id uuid NOT NULL UNIQUE
    REFERENCES diagnostic_transitions(transition_id) DEFERRABLE INITIALLY DEFERRED,
  recorded_by_type text NOT NULL,
  recorded_by_id text NOT NULL,
  recorded_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_worker_run_completions (
  completion_id uuid PRIMARY KEY,
  launch_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_run_launches(launch_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  worker_run_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_runs(worker_run_id),
  final_attestation_document jsonb NOT NULL
    CHECK (jsonb_typeof(final_attestation_document) = 'object'),
  signed_final_attestation jsonb NOT NULL
    CHECK (jsonb_typeof(signed_final_attestation) = 'object'),
  signed_final_attestation_digest text NOT NULL UNIQUE
    CHECK (signed_final_attestation_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_file_digest text NOT NULL UNIQUE CHECK (output_file_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_size_bytes bigint NOT NULL CHECK (output_size_bytes > 0),
  completion_transition_id uuid NOT NULL UNIQUE
    REFERENCES diagnostic_transitions(transition_id) DEFERRABLE INITIALLY DEFERRED,
  exit_code integer NOT NULL,
  completed_by_type text NOT NULL,
  completed_by_id text NOT NULL,
  completed_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_worker_run_diagnoses (
  diagnosis_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  worker_run_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_runs(worker_run_id),
  launch_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_run_launches(launch_id),
  assignment_id uuid NOT NULL REFERENCES diagnostic_assignments(assignment_id),
  evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  diagnosis_document jsonb NOT NULL CHECK (jsonb_typeof(diagnosis_document) = 'object'),
  diagnosis_digest text NOT NULL UNIQUE CHECK (diagnosis_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_file_digest text NOT NULL UNIQUE CHECK (output_file_digest ~ '^sha256:[0-9a-f]{64}$'),
  broker_receipt_id uuid NOT NULL UNIQUE,
  broker_receipt_document jsonb NOT NULL CHECK (jsonb_typeof(broker_receipt_document) = 'object'),
  signed_broker_receipt jsonb NOT NULL CHECK (jsonb_typeof(signed_broker_receipt) = 'object'),
  signed_broker_receipt_digest text NOT NULL UNIQUE
    CHECK (signed_broker_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  submitted_by_type text NOT NULL,
  submitted_by_id text NOT NULL,
  submitted_at timestamptz NOT NULL
);

CREATE INDEX diagnostic_worker_run_launch_state_idx
  ON diagnostic_worker_run_launches (installation_id, environment_id, issued_at, worker_run_id);
CREATE INDEX diagnostic_worker_run_diagnosis_assignment_idx
  ON diagnostic_worker_run_diagnoses (installation_id, environment_id, assignment_id, submitted_at);

CREATE TRIGGER diagnostic_worker_run_launches_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_worker_run_launches
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_worker_run_starts_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_worker_run_starts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_worker_run_completions_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_worker_run_completions
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_worker_run_diagnoses_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_worker_run_diagnoses
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
