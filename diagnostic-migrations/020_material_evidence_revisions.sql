ALTER TABLE diagnostic_evidence_packages
  DROP CONSTRAINT diagnostic_evidence_packages_freeze_reason_check;
ALTER TABLE diagnostic_evidence_packages
  ADD CONSTRAINT diagnostic_evidence_packages_freeze_reason_check
  CHECK (freeze_reason IN (
    'required_sources_complete','collection_deadline','material_late_evidence','governed_reinterpretation'
  ));

ALTER TABLE diagnostic_evidence_packages
  ADD COLUMN predecessor_evidence_package_id uuid REFERENCES diagnostic_evidence_packages(evidence_package_id),
  ADD COLUMN package_material jsonb CHECK (package_material IS NULL OR jsonb_typeof(package_material) = 'object'),
  ADD COLUMN package_material_digest text CHECK (
    package_material_digest IS NULL OR package_material_digest ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN correlation_projection_id uuid REFERENCES diagnostic_correlation_projections(projection_id),
  ADD COLUMN effect_projection_id uuid REFERENCES diagnostic_effect_projections(effect_projection_id),
  ADD COLUMN evaluation_id uuid REFERENCES diagnostic_behavior_evaluations(evaluation_id),
  ADD COLUMN assessment_kind text CHECK (
    assessment_kind IS NULL OR assessment_kind IN ('initial_freeze','late_evidence','governed_reinterpretation')),
  ADD COLUMN assignment_policy_activation_id uuid
    REFERENCES diagnostic_assignment_policy_activations(assignment_policy_activation_id),
  ADD CONSTRAINT diagnostic_evidence_package_revision_material_check CHECK (
    (package_material IS NULL AND package_material_digest IS NULL AND correlation_projection_id IS NULL
      AND effect_projection_id IS NULL AND evaluation_id IS NULL AND assessment_kind IS NULL)
    OR
    (package_material IS NOT NULL AND package_material_digest IS NOT NULL AND correlation_projection_id IS NOT NULL
      AND effect_projection_id IS NOT NULL AND evaluation_id IS NOT NULL AND assessment_kind IS NOT NULL
      AND ((revision_number = 1 AND predecessor_evidence_package_id IS NULL)
        OR (revision_number > 1 AND predecessor_evidence_package_id IS NOT NULL)))
  );

ALTER TABLE diagnostic_assignment_stage_records
  DROP CONSTRAINT diagnostic_assignment_stage_records_outcome_check,
  DROP CONSTRAINT diagnostic_assignment_stage_records_check;
ALTER TABLE diagnostic_assignment_stage_records
  ADD CONSTRAINT diagnostic_assignment_stage_records_outcome_check
    CHECK (outcome IN ('assignment_created','replacement_not_performed','terminal_failure')),
  ADD CONSTRAINT diagnostic_assignment_stage_records_outcome_material_check CHECK (
    (outcome = 'assignment_created' AND assignment_id IS NOT NULL)
    OR (outcome IN ('replacement_not_performed','terminal_failure') AND assignment_id IS NULL)
  );

CREATE INDEX diagnostic_evidence_package_material_idx
  ON diagnostic_evidence_packages (installation_id,case_id,package_material_digest,revision_number);

CREATE TABLE diagnostic_evidence_package_references (
  evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  reference_digest text NOT NULL CHECK (reference_digest ~ '^sha256:[0-9a-f]{64}$'),
  artifact_digest text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (evidence_package_id,reference_type,reference_id),
  FOREIGN KEY (installation_id,artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id,artifact_digest)
);

CREATE TABLE diagnostic_evidence_revision_monitors (
  case_id uuid PRIMARY KEY REFERENCES diagnostic_cases(case_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  registration_id uuid NOT NULL REFERENCES diagnostic_correlation_registrations(registration_id),
  logical_operation_id text NOT NULL,
  interpretation_activation_id uuid NOT NULL REFERENCES diagnostic_interpretation_activations(activation_id),
  evidence_policy_activation_id uuid NOT NULL
    REFERENCES diagnostic_evidence_policy_activations(evidence_policy_activation_id),
  assignment_policy_activation_id uuid
    REFERENCES diagnostic_assignment_policy_activations(assignment_policy_activation_id),
  current_evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  current_package_material_digest text NOT NULL CHECK (
    current_package_material_digest ~ '^sha256:[0-9a-f]{64}$'),
  last_assessed_cutoff bigint NOT NULL CHECK (last_assessed_cutoff >= 1),
  monitor_revision bigint NOT NULL CHECK (monitor_revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_evidence_revision_assessments (
  assessment_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  predecessor_evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  resulting_evidence_package_id uuid REFERENCES diagnostic_evidence_packages(evidence_package_id),
  assessment_kind text NOT NULL CHECK (assessment_kind IN ('late_evidence','governed_reinterpretation')),
  interpretation_activation_id uuid NOT NULL REFERENCES diagnostic_interpretation_activations(activation_id),
  candidate_cutoff bigint NOT NULL CHECK (candidate_cutoff >= 1),
  previous_material_digest text NOT NULL CHECK (previous_material_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_material jsonb NOT NULL CHECK (jsonb_typeof(candidate_material) = 'object'),
  candidate_material_digest text NOT NULL CHECK (candidate_material_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_projection_id uuid NOT NULL REFERENCES diagnostic_correlation_projections(projection_id),
  candidate_effect_projection_id uuid NOT NULL REFERENCES diagnostic_effect_projections(effect_projection_id),
  candidate_evaluation_id uuid NOT NULL REFERENCES diagnostic_behavior_evaluations(evaluation_id),
  outcome text NOT NULL CHECK (outcome IN ('nonmaterial','revision_created')),
  material_change_classes jsonb NOT NULL CHECK (jsonb_typeof(material_change_classes) = 'array'),
  recommended_action text NOT NULL CHECK (recommended_action IN ('notify_only','replace_unclaimed')),
  rules_digest text NOT NULL CHECK (rules_digest ~ '^sha256:[0-9a-f]{64}$'),
  assessment_document jsonb NOT NULL CHECK (jsonb_typeof(assessment_document) = 'object'),
  assessment_digest text NOT NULL CHECK (assessment_digest ~ '^sha256:[0-9a-f]{64}$'),
  assessed_at timestamptz NOT NULL,
  UNIQUE (case_id,candidate_cutoff,interpretation_activation_id,assessment_kind),
  UNIQUE (installation_id,assessment_digest),
  CHECK ((outcome = 'revision_created' AND resulting_evidence_package_id IS NOT NULL)
    OR (outcome = 'nonmaterial' AND resulting_evidence_package_id IS NULL))
);

CREATE TABLE diagnostic_reevaluation_notices (
  reevaluation_notice_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  assessment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_evidence_revision_assessments(assessment_id),
  predecessor_evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  successor_evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  known_affected_assignments jsonb NOT NULL CHECK (jsonb_typeof(known_affected_assignments) = 'array'),
  known_affected_diagnoses jsonb NOT NULL CHECK (jsonb_typeof(known_affected_diagnoses) = 'array'),
  recommended_action text NOT NULL CHECK (recommended_action IN ('notify_only','replace_unclaimed')),
  notice_document jsonb NOT NULL CHECK (jsonb_typeof(notice_document) = 'object'),
  notice_digest text NOT NULL CHECK (notice_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id,notice_digest)
);

CREATE TABLE diagnostic_assignment_replacements (
  replacement_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  reevaluation_notice_id uuid NOT NULL UNIQUE REFERENCES diagnostic_reevaluation_notices(reevaluation_notice_id),
  replaced_assignment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_assignments(assignment_id),
  replacement_assignment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_assignments(assignment_id),
  predecessor_evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  successor_evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  assignment_policy_activation_id uuid NOT NULL
    REFERENCES diagnostic_assignment_policy_activations(assignment_policy_activation_id),
  replacement_document jsonb NOT NULL CHECK (jsonb_typeof(replacement_document) = 'object'),
  replacement_digest text NOT NULL CHECK (replacement_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id,replacement_digest)
);

CREATE INDEX diagnostic_evidence_revision_monitor_poll_idx
  ON diagnostic_evidence_revision_monitors (installation_id,environment_id,last_assessed_cutoff,case_id);
CREATE INDEX diagnostic_reevaluation_case_idx
  ON diagnostic_reevaluation_notices (installation_id,environment_id,case_id,created_at);

CREATE OR REPLACE FUNCTION diagnostic_validate_evidence_revision_monitor_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.case_id <> NEW.case_id
     OR OLD.installation_id <> NEW.installation_id
     OR OLD.environment_id <> NEW.environment_id
     OR OLD.registration_id <> NEW.registration_id
     OR OLD.logical_operation_id <> NEW.logical_operation_id
     OR OLD.interpretation_activation_id <> NEW.interpretation_activation_id
     OR OLD.evidence_policy_activation_id <> NEW.evidence_policy_activation_id
     OR OLD.assignment_policy_activation_id IS DISTINCT FROM NEW.assignment_policy_activation_id
     OR OLD.created_at <> NEW.created_at
     OR NEW.monitor_revision <> OLD.monitor_revision + 1
     OR NEW.last_assessed_cutoff < OLD.last_assessed_cutoff THEN
    RAISE EXCEPTION 'diagnostic evidence revision monitor transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER diagnostic_evidence_revision_monitors_guard
  BEFORE UPDATE ON diagnostic_evidence_revision_monitors
  FOR EACH ROW EXECUTE FUNCTION diagnostic_validate_evidence_revision_monitor_update();
CREATE TRIGGER diagnostic_evidence_revision_monitors_no_delete
  BEFORE DELETE ON diagnostic_evidence_revision_monitors
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE TRIGGER diagnostic_evidence_package_references_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_evidence_package_references
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_evidence_revision_assessments_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_evidence_revision_assessments
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_reevaluation_notices_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_reevaluation_notices
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_assignment_replacements_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_assignment_replacements
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
