ALTER TABLE diagnostic_worker_run_diagnoses
  DROP CONSTRAINT diagnostic_worker_run_diagnoses_diagnosis_digest_key;

CREATE INDEX diagnostic_worker_run_diagnosis_digest_idx
  ON diagnostic_worker_run_diagnoses (diagnosis_digest, submitted_at, worker_run_id);

CREATE TABLE diagnostic_consistency_tests (
  consistency_test_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  evidence_package_semantic_digest text NOT NULL CHECK (evidence_package_semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  evidence_package_artifact_digest text NOT NULL CHECK (evidence_package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_assignment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_assignments(assignment_id),
  source_worker_run_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_runs(worker_run_id),
  assignment_policy_activation_id uuid NOT NULL
    REFERENCES diagnostic_assignment_policy_activations(assignment_policy_activation_id),
  policy_document jsonb NOT NULL CHECK (jsonb_typeof(policy_document) = 'object'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  rubric_document jsonb NOT NULL CHECK (jsonb_typeof(rubric_document) = 'object'),
  rubric_digest text NOT NULL UNIQUE CHECK (rubric_digest ~ '^sha256:[0-9a-f]{64}$'),
  rubric_artifact_digest text NOT NULL UNIQUE CHECK (rubric_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  rubric_commitment_document jsonb NOT NULL CHECK (jsonb_typeof(rubric_commitment_document) = 'object'),
  rubric_commitment_digest text NOT NULL UNIQUE CHECK (rubric_commitment_digest ~ '^sha256:[0-9a-f]{64}$'),
  test_document jsonb NOT NULL CHECK (jsonb_typeof(test_document) = 'object'),
  test_digest text NOT NULL UNIQUE CHECK (test_digest ~ '^sha256:[0-9a-f]{64}$'),
  registration_transition_id uuid NOT NULL UNIQUE
    REFERENCES diagnostic_transitions(transition_id) DEFERRABLE INITIALLY DEFERRED,
  registered_by_type text NOT NULL,
  registered_by_id text NOT NULL,
  registered_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_consistency_test_assignments (
  consistency_test_id uuid NOT NULL REFERENCES diagnostic_consistency_tests(consistency_test_id),
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  assignment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_assignments(assignment_id),
  assignment_ordinal bigint NOT NULL CHECK (assignment_ordinal BETWEEN 2 AND 4),
  source_transition_id uuid NOT NULL UNIQUE REFERENCES diagnostic_transitions(transition_id),
  binding_document jsonb NOT NULL CHECK (jsonb_typeof(binding_document) = 'object'),
  binding_digest text NOT NULL UNIQUE CHECK (binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (consistency_test_id, slot),
  UNIQUE (consistency_test_id, assignment_ordinal)
);

CREATE TABLE diagnostic_worker_run_configurations (
  worker_run_id uuid PRIMARY KEY REFERENCES diagnostic_worker_runs(worker_run_id),
  consistency_test_id uuid NOT NULL REFERENCES diagnostic_consistency_tests(consistency_test_id),
  assignment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_assignments(assignment_id),
  configuration_document jsonb NOT NULL CHECK (jsonb_typeof(configuration_document) = 'object'),
  configuration_digest text NOT NULL CHECK (configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  limitation_document jsonb NOT NULL CHECK (jsonb_typeof(limitation_document) = 'object'),
  limitation_digest text NOT NULL CHECK (limitation_digest ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL,
  UNIQUE (consistency_test_id, configuration_digest, assignment_id)
);

CREATE TABLE diagnostic_consistency_scores (
  score_id uuid PRIMARY KEY,
  consistency_test_id uuid NOT NULL REFERENCES diagnostic_consistency_tests(consistency_test_id),
  worker_run_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_runs(worker_run_id),
  assignment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_assignments(assignment_id),
  completion_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_run_completions(completion_id),
  diagnosis_id uuid NOT NULL UNIQUE REFERENCES diagnostic_worker_run_diagnoses(diagnosis_id),
  diagnosis_digest text NOT NULL CHECK (diagnosis_digest ~ '^sha256:[0-9a-f]{64}$'),
  configuration_digest text NOT NULL CHECK (configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  score_document jsonb NOT NULL CHECK (jsonb_typeof(score_document) = 'object'),
  score_digest text NOT NULL UNIQUE CHECK (score_digest ~ '^sha256:[0-9a-f]{64}$'),
  passed boolean NOT NULL,
  scored_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_consistency_reports (
  report_id uuid PRIMARY KEY,
  consistency_test_id uuid NOT NULL UNIQUE REFERENCES diagnostic_consistency_tests(consistency_test_id),
  report_document jsonb NOT NULL CHECK (jsonb_typeof(report_document) = 'object'),
  report_digest text NOT NULL UNIQUE CHECK (report_digest ~ '^sha256:[0-9a-f]{64}$'),
  completed_at timestamptz NOT NULL
);

CREATE INDEX diagnostic_consistency_assignment_lookup_idx
  ON diagnostic_consistency_test_assignments (assignment_id, consistency_test_id, slot);
CREATE INDEX diagnostic_consistency_score_test_idx
  ON diagnostic_consistency_scores (consistency_test_id, scored_at, worker_run_id);

CREATE TRIGGER diagnostic_consistency_tests_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_consistency_tests
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_consistency_test_assignments_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_consistency_test_assignments
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_worker_run_configurations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_worker_run_configurations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_consistency_scores_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_consistency_scores
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_consistency_reports_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_consistency_reports
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
