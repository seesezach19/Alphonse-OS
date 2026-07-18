CREATE TABLE diagnostic_assignment_policy_activations (
  assignment_policy_activation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  deployment_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  package_artifact_digest text NOT NULL CHECK (package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_export_id text NOT NULL,
  policy_document jsonb NOT NULL CHECK (jsonb_typeof(policy_document) = 'object'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  instruction_digest text NOT NULL CHECK (instruction_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_schema_digest text NOT NULL CHECK (output_schema_digest ~ '^sha256:[0-9a-f]{64}$'),
  stage_artifact_manifest jsonb NOT NULL CHECK (jsonb_typeof(stage_artifact_manifest) = 'object'),
  stage_artifact_digest text NOT NULL CHECK (stage_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_rules_digest text NOT NULL CHECK (assignment_rules_digest ~ '^sha256:[0-9a-f]{64}$'),
  activation_document jsonb NOT NULL CHECK (jsonb_typeof(activation_document) = 'object'),
  activation_digest text NOT NULL CHECK (activation_digest ~ '^sha256:[0-9a-f]{64}$'),
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL,
  UNIQUE (installation_id, activation_digest)
);

CREATE TABLE diagnostic_assignment_inbox (
  source_transition_id uuid PRIMARY KEY REFERENCES diagnostic_transitions(transition_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  outbox_id uuid NOT NULL UNIQUE REFERENCES diagnostic_outbox(outbox_id),
  source_event_document jsonb NOT NULL CHECK (jsonb_typeof(source_event_document) = 'object'),
  source_event_digest text NOT NULL CHECK (source_event_digest ~ '^sha256:[0-9a-f]{64}$'),
  delivery_document jsonb NOT NULL CHECK (jsonb_typeof(delivery_document) = 'object'),
  delivery_digest text NOT NULL CHECK (delivery_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('pending','completed','terminal_failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text,
  received_at timestamptz NOT NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK ((status = 'completed' AND completed_at IS NOT NULL AND last_error_code IS NULL)
    OR (status = 'terminal_failed' AND completed_at IS NOT NULL AND last_error_code IS NOT NULL)
    OR (status = 'pending' AND completed_at IS NULL))
);

CREATE TABLE diagnostic_assignments (
  assignment_id uuid PRIMARY KEY,
  assignment_series_id uuid NOT NULL,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  assignment_policy_activation_id uuid NOT NULL
    REFERENCES diagnostic_assignment_policy_activations(assignment_policy_activation_id),
  ordinal bigint NOT NULL CHECK (ordinal >= 1),
  stage_input_digest text NOT NULL CHECK (stage_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_document jsonb NOT NULL CHECK (jsonb_typeof(assignment_document) = 'object'),
  assignment_digest text NOT NULL CHECK (assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  record_document jsonb NOT NULL CHECK (jsonb_typeof(record_document) = 'object'),
  record_digest text NOT NULL CHECK (record_digest ~ '^sha256:[0-9a-f]{64}$'),
  stage_artifact_digest text NOT NULL CHECK (stage_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_rules_digest text NOT NULL CHECK (assignment_rules_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_transition_id uuid NOT NULL UNIQUE REFERENCES diagnostic_transitions(transition_id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, evidence_package_id, assignment_policy_activation_id, ordinal),
  UNIQUE (installation_id, assignment_digest),
  UNIQUE (installation_id, record_digest)
);

CREATE TABLE diagnostic_assignment_states (
  assignment_id uuid PRIMARY KEY REFERENCES diagnostic_assignments(assignment_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  assignment_digest text NOT NULL CHECK (assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('unclaimed','claimed','expired','cancelled')),
  state_revision bigint NOT NULL CHECK (state_revision >= 0),
  last_transition_id uuid NOT NULL REFERENCES diagnostic_transitions(transition_id),
  updated_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_assignment_stage_records (
  stage_record_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  source_transition_id uuid NOT NULL UNIQUE REFERENCES diagnostic_transitions(transition_id),
  source_event_digest text NOT NULL CHECK (source_event_digest ~ '^sha256:[0-9a-f]{64}$'),
  stage_input jsonb NOT NULL CHECK (jsonb_typeof(stage_input) = 'object'),
  stage_input_digest text NOT NULL CHECK (stage_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  stage_artifact_digest text NOT NULL CHECK (stage_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_rules_digest text NOT NULL CHECK (assignment_rules_digest ~ '^sha256:[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('assignment_created','terminal_failure')),
  assignment_id uuid REFERENCES diagnostic_assignments(assignment_id),
  result_document jsonb NOT NULL CHECK (jsonb_typeof(result_document) = 'object'),
  result_digest text NOT NULL CHECK (result_digest ~ '^sha256:[0-9a-f]{64}$'),
  processed_at timestamptz NOT NULL,
  CHECK ((outcome = 'assignment_created' AND assignment_id IS NOT NULL)
    OR (outcome = 'terminal_failure' AND assignment_id IS NULL))
);

CREATE TABLE diagnostic_assignment_nondeterminism_conflicts (
  conflict_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  assignment_id uuid NOT NULL REFERENCES diagnostic_assignments(assignment_id),
  source_transition_id uuid NOT NULL REFERENCES diagnostic_transitions(transition_id),
  stage_input_digest text NOT NULL CHECK (stage_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  accepted_assignment_digest text NOT NULL CHECK (accepted_assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  recomputed_assignment_digest text NOT NULL CHECK (recomputed_assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  conflict_document jsonb NOT NULL CHECK (jsonb_typeof(conflict_document) = 'object'),
  conflict_digest text NOT NULL CHECK (conflict_digest ~ '^sha256:[0-9a-f]{64}$'),
  detected_at timestamptz NOT NULL,
  UNIQUE (assignment_id, recomputed_assignment_digest),
  UNIQUE (installation_id, conflict_digest)
);

CREATE INDEX diagnostic_assignment_inbox_poll_idx
  ON diagnostic_assignment_inbox (status, updated_at, source_transition_id);
CREATE INDEX diagnostic_assignment_package_idx
  ON diagnostic_assignments (installation_id, environment_id, evidence_package_id, ordinal);
CREATE INDEX diagnostic_assignment_state_idx
  ON diagnostic_assignment_states (installation_id, environment_id, state, updated_at, assignment_id);

CREATE TRIGGER diagnostic_assignment_policy_activations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_assignment_policy_activations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_assignments_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_assignments
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_assignment_stage_records_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_assignment_stage_records
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_assignment_nondeterminism_conflicts_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_assignment_nondeterminism_conflicts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION diagnostic_validate_assignment_inbox_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_transition_id <> NEW.source_transition_id
     OR OLD.installation_id <> NEW.installation_id
     OR OLD.environment_id <> NEW.environment_id
     OR OLD.outbox_id <> NEW.outbox_id
     OR OLD.source_event_digest <> NEW.source_event_digest
     OR OLD.delivery_digest <> NEW.delivery_digest
     OR OLD.source_event_document <> NEW.source_event_document
     OR OLD.delivery_document <> NEW.delivery_document
     OR OLD.received_at <> NEW.received_at
     OR NEW.attempt_count < OLD.attempt_count
     OR OLD.status <> 'pending'
     OR NEW.status NOT IN ('pending','completed','terminal_failed') THEN
    RAISE EXCEPTION 'diagnostic assignment inbox identity or state transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER diagnostic_assignment_inbox_guard
  BEFORE UPDATE ON diagnostic_assignment_inbox
  FOR EACH ROW EXECUTE FUNCTION diagnostic_validate_assignment_inbox_update();
CREATE TRIGGER diagnostic_assignment_inbox_no_delete
  BEFORE DELETE ON diagnostic_assignment_inbox
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION diagnostic_validate_assignment_state_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.assignment_id <> NEW.assignment_id
     OR OLD.installation_id <> NEW.installation_id
     OR OLD.environment_id <> NEW.environment_id
     OR OLD.assignment_digest <> NEW.assignment_digest
     OR NEW.state_revision <> OLD.state_revision + 1
     OR NOT ((OLD.state = 'unclaimed' AND NEW.state IN ('claimed','expired','cancelled'))
       OR (OLD.state = 'claimed' AND NEW.state = 'cancelled')) THEN
    RAISE EXCEPTION 'diagnostic assignment state transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER diagnostic_assignment_states_guard
  BEFORE UPDATE ON diagnostic_assignment_states
  FOR EACH ROW EXECUTE FUNCTION diagnostic_validate_assignment_state_update();
CREATE TRIGGER diagnostic_assignment_states_no_delete
  BEFORE DELETE ON diagnostic_assignment_states
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION diagnostic_validate_outbox_publication_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.outbox_id <> NEW.outbox_id
     OR OLD.installation_id <> NEW.installation_id
     OR OLD.transition_id <> NEW.transition_id
     OR OLD.event_type <> NEW.event_type
     OR OLD.payload <> NEW.payload
     OR OLD.created_at <> NEW.created_at
     OR (OLD.published_at IS NOT NULL AND OLD.published_at IS DISTINCT FROM NEW.published_at) THEN
    RAISE EXCEPTION 'diagnostic outbox semantic material is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER diagnostic_outbox_publication_only
  BEFORE UPDATE ON diagnostic_outbox
  FOR EACH ROW EXECUTE FUNCTION diagnostic_validate_outbox_publication_update();
CREATE TRIGGER diagnostic_outbox_no_delete
  BEFORE DELETE ON diagnostic_outbox
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
