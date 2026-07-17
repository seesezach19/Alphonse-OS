CREATE TABLE diagnostic_interpretation_activations (
  activation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  deployment_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  package_artifact_digest text NOT NULL CHECK (package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  integration_export_id text NOT NULL,
  integration_contract jsonb NOT NULL CHECK (jsonb_typeof(integration_contract) = 'object'),
  integration_contract_digest text NOT NULL CHECK (integration_contract_digest ~ '^sha256:[0-9a-f]{64}$'),
  behavior_export_id text NOT NULL,
  behavior_contract jsonb NOT NULL CHECK (jsonb_typeof(behavior_contract) = 'object'),
  behavior_contract_digest text NOT NULL CHECK (behavior_contract_digest ~ '^sha256:[0-9a-f]{64}$'),
  evaluator_export_id text NOT NULL,
  evaluator_document jsonb NOT NULL CHECK (jsonb_typeof(evaluator_document) = 'object'),
  evaluator_digest text NOT NULL CHECK (evaluator_digest ~ '^sha256:[0-9a-f]{64}$'),
  stage_artifact_manifest jsonb NOT NULL CHECK (jsonb_typeof(stage_artifact_manifest) = 'object'),
  stage_artifact_digest text NOT NULL CHECK (stage_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  interpreter_rules_digest text NOT NULL CHECK (interpreter_rules_digest ~ '^sha256:[0-9a-f]{64}$'),
  evaluator_rules_digest text NOT NULL CHECK (evaluator_rules_digest ~ '^sha256:[0-9a-f]{64}$'),
  activation_document jsonb NOT NULL CHECK (jsonb_typeof(activation_document) = 'object'),
  activation_digest text NOT NULL CHECK (activation_digest ~ '^sha256:[0-9a-f]{64}$'),
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL,
  UNIQUE (installation_id, activation_digest)
);

CREATE TABLE diagnostic_effect_projections (
  effect_projection_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  correlation_projection_id uuid NOT NULL REFERENCES diagnostic_correlation_projections(projection_id),
  activation_id uuid NOT NULL REFERENCES diagnostic_interpretation_activations(activation_id),
  logical_operation_id text NOT NULL,
  semantic_projection jsonb NOT NULL CHECK (jsonb_typeof(semantic_projection) = 'object'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  record_document jsonb NOT NULL CHECK (jsonb_typeof(record_document) = 'object'),
  record_digest text NOT NULL CHECK (record_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, correlation_projection_id, activation_id),
  UNIQUE (installation_id, semantic_digest),
  UNIQUE (installation_id, record_digest)
);

CREATE TABLE diagnostic_behavior_evaluations (
  evaluation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  effect_projection_id uuid NOT NULL REFERENCES diagnostic_effect_projections(effect_projection_id),
  activation_id uuid NOT NULL REFERENCES diagnostic_interpretation_activations(activation_id),
  logical_operation_id text NOT NULL,
  semantic_evaluation jsonb NOT NULL CHECK (jsonb_typeof(semantic_evaluation) = 'object'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  record_document jsonb NOT NULL CHECK (jsonb_typeof(record_document) = 'object'),
  record_digest text NOT NULL CHECK (record_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, effect_projection_id, activation_id),
  UNIQUE (installation_id, semantic_digest),
  UNIQUE (installation_id, record_digest)
);

CREATE TABLE diagnostic_behavior_triggers (
  trigger_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  evaluation_id uuid NOT NULL UNIQUE REFERENCES diagnostic_behavior_evaluations(evaluation_id),
  logical_operation_id text NOT NULL,
  trigger_document jsonb NOT NULL CHECK (jsonb_typeof(trigger_document) = 'object'),
  trigger_digest text NOT NULL CHECK (trigger_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, trigger_digest)
);

ALTER TABLE diagnostic_cases
  ALTER COLUMN trace_id DROP NOT NULL,
  ADD COLUMN case_origin text NOT NULL DEFAULT 'explicit_failure_report'
    CHECK (case_origin IN ('explicit_failure_report', 'deterministic_behavior_trigger')),
  ADD COLUMN trigger_id uuid UNIQUE REFERENCES diagnostic_behavior_triggers(trigger_id),
  ADD COLUMN case_document jsonb CHECK (case_document IS NULL OR jsonb_typeof(case_document) = 'object'),
  ADD COLUMN case_digest text CHECK (case_digest IS NULL OR case_digest ~ '^sha256:[0-9a-f]{64}$');

ALTER TABLE diagnostic_cases ADD CONSTRAINT diagnostic_case_origin_material_check CHECK (
  (case_origin = 'explicit_failure_report'
    AND trace_id IS NOT NULL AND trigger_id IS NULL AND case_document IS NULL AND case_digest IS NULL)
  OR
  (case_origin = 'deterministic_behavior_trigger'
    AND trace_id IS NULL AND trigger_id IS NOT NULL AND case_document IS NOT NULL AND case_digest IS NOT NULL)
);

CREATE TABLE diagnostic_claim_envelopes (
  claim_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  claim_type text NOT NULL CHECK (claim_type IN (
    'authenticated_observation',
    'committed_effect_interpretation',
    'behavior_invariant_evaluation',
    'unresolved_conclusion'
  )),
  claim_document jsonb NOT NULL CHECK (jsonb_typeof(claim_document) = 'object'),
  claim_digest text NOT NULL CHECK (claim_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, claim_digest)
);

CREATE INDEX diagnostic_effect_projection_operation_idx
  ON diagnostic_effect_projections (installation_id, logical_operation_id, created_at);
CREATE INDEX diagnostic_behavior_evaluation_operation_idx
  ON diagnostic_behavior_evaluations (installation_id, logical_operation_id, created_at);
CREATE INDEX diagnostic_claim_envelope_case_idx
  ON diagnostic_claim_envelopes (installation_id, case_id, claim_type, claim_id);

CREATE TRIGGER diagnostic_interpretation_activations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_interpretation_activations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_effect_projections_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_effect_projections
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_behavior_evaluations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_behavior_evaluations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_behavior_triggers_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_behavior_triggers
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_claim_envelopes_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_claim_envelopes
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
