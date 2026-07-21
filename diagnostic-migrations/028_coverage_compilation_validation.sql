ALTER TABLE diagnostic_coverage_onboarding_events
  DROP CONSTRAINT diagnostic_coverage_onboarding_events_event_type_check;
ALTER TABLE diagnostic_coverage_onboarding_events
  ADD CONSTRAINT diagnostic_coverage_onboarding_events_event_type_check CHECK (event_type IN (
    'opened', 'evidence_captured', 'evidence_reused', 'snapshot_replaced',
    'interpretation_submitted', 'ambiguities_projected', 'ambiguity_resolved',
    'review_bundle_created', 'review_invalidated', 'coverage_compiled', 'coverage_validated'
  ));

CREATE TABLE diagnostic_coverage_compilations (
  compilation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  base_onboarding_revision bigint NOT NULL CHECK (base_onboarding_revision >= 5),
  base_event_head_digest text NOT NULL CHECK (base_event_head_digest ~ '^sha256:[0-9a-f]{64}$'),
  review_bundle_digest text NOT NULL CHECK (review_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  approval_id uuid NOT NULL,
  approval_digest text NOT NULL CHECK (approval_digest ~ '^sha256:[0-9a-f]{64}$'),
  review_state_digest text NOT NULL CHECK (review_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  compilation_input jsonb NOT NULL CHECK (jsonb_typeof(compilation_input) = 'object'),
  compilation_input_digest text NOT NULL CHECK (compilation_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  compiler jsonb NOT NULL CHECK (jsonb_typeof(compiler) = 'object'),
  compiler_artifact_digest text NOT NULL CHECK (compiler_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  coverage_specification_digest text NOT NULL CHECK (coverage_specification_digest ~ '^sha256:[0-9a-f]{64}$'),
  workflow_manifest_proposal_digest text NOT NULL CHECK (workflow_manifest_proposal_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_index bigint NOT NULL CHECK (event_index >= 6),
  compiled_by_actor_type text NOT NULL,
  compiled_by_actor_id text NOT NULL,
  compiled_at timestamptz NOT NULL,
  UNIQUE (installation_id, compilation_input_digest, compiler_artifact_digest),
  UNIQUE (installation_id, onboarding_id, event_index),
  FOREIGN KEY (installation_id, onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id, onboarding_id),
  FOREIGN KEY (installation_id, onboarding_id, review_bundle_digest)
    REFERENCES diagnostic_coverage_review_bundles(installation_id, onboarding_id, review_bundle_digest),
  FOREIGN KEY (installation_id, compiler_artifact_digest)
    REFERENCES diagnostic_stage_artifact_archives(installation_id, stage_artifact_digest),
  FOREIGN KEY (installation_id, coverage_specification_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, workflow_manifest_proposal_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_coverage_validations (
  validation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  compilation_id uuid NOT NULL UNIQUE REFERENCES diagnostic_coverage_compilations(compilation_id),
  validation_input_digest text NOT NULL CHECK (validation_input_digest ~ '^sha256:[0-9a-f]{64}$'),
  validator jsonb NOT NULL CHECK (jsonb_typeof(validator) = 'object'),
  validator_artifact_digest text NOT NULL CHECK (validator_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  validation_receipt_digest text NOT NULL CHECK (validation_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('valid', 'invalid')),
  eligible_workflow_manifest_proposal_digest text CHECK (
    eligible_workflow_manifest_proposal_digest IS NULL
    OR eligible_workflow_manifest_proposal_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_index bigint NOT NULL CHECK (event_index >= 7),
  validated_by_actor_type text NOT NULL,
  validated_by_actor_id text NOT NULL,
  validated_at timestamptz NOT NULL,
  UNIQUE (installation_id, validation_input_digest, validator_artifact_digest),
  UNIQUE (installation_id, onboarding_id, event_index),
  FOREIGN KEY (installation_id, onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id, onboarding_id),
  FOREIGN KEY (installation_id, validator_artifact_digest)
    REFERENCES diagnostic_stage_artifact_archives(installation_id, stage_artifact_digest),
  FOREIGN KEY (installation_id, validation_receipt_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, eligible_workflow_manifest_proposal_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  CHECK ((status = 'valid' AND eligible_workflow_manifest_proposal_digest IS NOT NULL)
    OR (status = 'invalid' AND eligible_workflow_manifest_proposal_digest IS NULL))
);

CREATE INDEX diagnostic_coverage_compilation_idx ON diagnostic_coverage_compilations
  (installation_id,onboarding_id,event_index,compilation_input_digest);
CREATE INDEX diagnostic_coverage_validation_idx ON diagnostic_coverage_validations
  (installation_id,onboarding_id,event_index,status);

CREATE TRIGGER diagnostic_coverage_compilations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_compilations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_coverage_validations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_validations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
