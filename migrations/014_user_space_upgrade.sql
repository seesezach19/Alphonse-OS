CREATE TABLE kernel_upgrade_compatibility_reports (
  compatibility_report_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  current_deployment_id uuid NOT NULL,
  target_deployment_id uuid NOT NULL,
  current_package_version_id uuid NOT NULL,
  target_package_version_id uuid NOT NULL,
  capability_export_id text NOT NULL,
  source_activation_id uuid,
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  report_digest text NOT NULL CHECK (report_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, compatibility_report_id),
  UNIQUE (installation_id, environment_id, current_deployment_id, target_deployment_id, capability_export_id),
  FOREIGN KEY (installation_id, environment_id, current_deployment_id)
    REFERENCES kernel_deployments(installation_id, environment_id, deployment_id),
  FOREIGN KEY (installation_id, environment_id, target_deployment_id)
    REFERENCES kernel_deployments(installation_id, environment_id, deployment_id),
  FOREIGN KEY (installation_id, environment_id, current_package_version_id)
    REFERENCES kernel_package_versions(installation_id, environment_id, package_version_id),
  FOREIGN KEY (installation_id, environment_id, target_package_version_id)
    REFERENCES kernel_package_versions(installation_id, environment_id, package_version_id)
);

CREATE TABLE kernel_upgrade_plans (
  upgrade_plan_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  compatibility_report_id uuid NOT NULL,
  current_deployment_id uuid NOT NULL,
  target_deployment_id uuid NOT NULL,
  current_package_version_id uuid NOT NULL,
  target_package_version_id uuid NOT NULL,
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, upgrade_plan_id),
  UNIQUE (installation_id, environment_id, compatibility_report_id),
  FOREIGN KEY (installation_id, environment_id, compatibility_report_id)
    REFERENCES kernel_upgrade_compatibility_reports(installation_id, environment_id, compatibility_report_id),
  FOREIGN KEY (installation_id, environment_id, current_deployment_id)
    REFERENCES kernel_deployments(installation_id, environment_id, deployment_id),
  FOREIGN KEY (installation_id, environment_id, target_deployment_id)
    REFERENCES kernel_deployments(installation_id, environment_id, deployment_id)
);

CREATE TABLE kernel_upgrade_plan_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  upgrade_plan_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('planned','migrating','verified','canary_paused','canary_passed',
    'active','rolled_back','repair_required','retired')),
  revision bigint NOT NULL CHECK (revision >= 0),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, upgrade_plan_id),
  FOREIGN KEY (installation_id, environment_id, upgrade_plan_id)
    REFERENCES kernel_upgrade_plans(installation_id, environment_id, upgrade_plan_id)
);

CREATE TABLE kernel_upgrade_migration_runs (
  migration_run_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  upgrade_plan_id uuid NOT NULL,
  declaration_digest text NOT NULL CHECK (declaration_digest ~ '^sha256:[0-9a-f]{64}$'),
  started_by_actor_id text NOT NULL,
  started_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, migration_run_id),
  UNIQUE (installation_id, environment_id, upgrade_plan_id),
  FOREIGN KEY (installation_id, environment_id, upgrade_plan_id)
    REFERENCES kernel_upgrade_plans(installation_id, environment_id, upgrade_plan_id)
);

CREATE TABLE kernel_upgrade_migration_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  migration_run_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('running','checkpointed','verified','failed')),
  next_checkpoint integer NOT NULL CHECK (next_checkpoint >= 0),
  revision bigint NOT NULL CHECK (revision >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, migration_run_id),
  FOREIGN KEY (installation_id, environment_id, migration_run_id)
    REFERENCES kernel_upgrade_migration_runs(installation_id, environment_id, migration_run_id)
);

CREATE TABLE kernel_upgrade_migration_checkpoints (
  migration_checkpoint_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  migration_run_id uuid NOT NULL,
  checkpoint_ordinal integer NOT NULL CHECK (checkpoint_ordinal >= 0),
  checkpoint_name text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  output_digest text NOT NULL CHECK (output_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_count bigint NOT NULL CHECK (source_count >= 0),
  target_count bigint NOT NULL CHECK (target_count >= 0),
  invariants jsonb NOT NULL CHECK (jsonb_typeof(invariants) = 'object'),
  checkpoint_digest text NOT NULL CHECK (checkpoint_digest ~ '^sha256:[0-9a-f]{64}$'),
  recorded_by_actor_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, migration_checkpoint_id),
  UNIQUE (installation_id, environment_id, migration_run_id, checkpoint_ordinal),
  FOREIGN KEY (installation_id, environment_id, migration_run_id)
    REFERENCES kernel_upgrade_migration_runs(installation_id, environment_id, migration_run_id)
);

CREATE TABLE kernel_upgrade_migration_verifications (
  migration_verification_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  migration_run_id uuid NOT NULL,
  verification jsonb NOT NULL CHECK (jsonb_typeof(verification) = 'object'),
  verification_digest text NOT NULL CHECK (verification_digest ~ '^sha256:[0-9a-f]{64}$'),
  verified_by_actor_id text NOT NULL,
  verified_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, migration_verification_id),
  UNIQUE (installation_id, environment_id, migration_run_id),
  FOREIGN KEY (installation_id, environment_id, migration_run_id)
    REFERENCES kernel_upgrade_migration_runs(installation_id, environment_id, migration_run_id)
);

CREATE TABLE kernel_upgrade_canary_attempts (
  canary_attempt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  upgrade_plan_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  assignment_receipt jsonb NOT NULL CHECK (jsonb_typeof(assignment_receipt) = 'object'),
  assignment_digest text NOT NULL CHECK (assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  gate_results jsonb NOT NULL CHECK (jsonb_typeof(gate_results) = 'object'),
  outcome text NOT NULL CHECK (outcome IN ('passed','paused')),
  evaluated_by_actor_id text NOT NULL,
  evaluated_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, canary_attempt_id),
  UNIQUE (installation_id, environment_id, upgrade_plan_id, attempt_number),
  FOREIGN KEY (installation_id, environment_id, upgrade_plan_id)
    REFERENCES kernel_upgrade_plans(installation_id, environment_id, upgrade_plan_id)
);

CREATE TABLE kernel_upgrade_activations (
  upgrade_activation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  upgrade_plan_id uuid NOT NULL,
  source_activation_id uuid,
  target_activation_id uuid NOT NULL,
  business_approval_id uuid NOT NULL,
  approval_basis text NOT NULL CHECK (approval_basis IN ('preapproved_authority_equivalent','fresh_business_approval')),
  authority_equivalence_digest text NOT NULL CHECK (authority_equivalence_digest ~ '^sha256:[0-9a-f]{64}$'),
  activated_by_actor_id text NOT NULL,
  activated_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, upgrade_activation_id),
  UNIQUE (installation_id, environment_id, upgrade_plan_id),
  FOREIGN KEY (installation_id, environment_id, upgrade_plan_id)
    REFERENCES kernel_upgrade_plans(installation_id, environment_id, upgrade_plan_id),
  FOREIGN KEY (installation_id, environment_id, target_activation_id)
    REFERENCES kernel_capability_activations(installation_id, environment_id, capability_activation_id),
  FOREIGN KEY (installation_id, environment_id, business_approval_id)
    REFERENCES kernel_capability_business_approvals(installation_id, environment_id, business_approval_id)
);

CREATE TABLE kernel_upgrade_recovery_actions (
  upgrade_recovery_action_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  upgrade_plan_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('deployment_rollback','forward_repair','compensation')),
  real_world_change text NOT NULL CHECK (real_world_change IN ('none','compatible','incompatible')),
  reference_digest text NOT NULL CHECK (reference_digest ~ '^sha256:[0-9a-f]{64}$'),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  recorded_by_actor_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, upgrade_recovery_action_id),
  FOREIGN KEY (installation_id, environment_id, upgrade_plan_id)
    REFERENCES kernel_upgrade_plans(installation_id, environment_id, upgrade_plan_id)
);

CREATE TABLE kernel_package_retirements (
  package_retirement_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  upgrade_plan_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  reference_snapshot jsonb NOT NULL CHECK (jsonb_typeof(reference_snapshot) = 'object'),
  approved_by_actor_id text NOT NULL,
  retired_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, package_retirement_id),
  UNIQUE (installation_id, environment_id, package_version_id),
  FOREIGN KEY (installation_id, environment_id, upgrade_plan_id)
    REFERENCES kernel_upgrade_plans(installation_id, environment_id, upgrade_plan_id),
  FOREIGN KEY (installation_id, environment_id, package_version_id)
    REFERENCES kernel_package_versions(installation_id, environment_id, package_version_id)
);

CREATE INDEX kernel_upgrade_plan_state_idx
  ON kernel_upgrade_plan_states (installation_id, environment_id, state, updated_at DESC);
CREATE INDEX kernel_upgrade_checkpoint_idx
  ON kernel_upgrade_migration_checkpoints (installation_id, environment_id, migration_run_id, checkpoint_ordinal);

CREATE TRIGGER kernel_upgrade_compatibility_reports_immutable BEFORE UPDATE OR DELETE ON kernel_upgrade_compatibility_reports
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_upgrade_plans_immutable BEFORE UPDATE OR DELETE ON kernel_upgrade_plans
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_upgrade_migration_runs_immutable BEFORE UPDATE OR DELETE ON kernel_upgrade_migration_runs
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_upgrade_migration_checkpoints_immutable BEFORE UPDATE OR DELETE ON kernel_upgrade_migration_checkpoints
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_upgrade_migration_verifications_immutable BEFORE UPDATE OR DELETE ON kernel_upgrade_migration_verifications
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_upgrade_canary_attempts_immutable BEFORE UPDATE OR DELETE ON kernel_upgrade_canary_attempts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_upgrade_activations_immutable BEFORE UPDATE OR DELETE ON kernel_upgrade_activations
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_upgrade_recovery_actions_immutable BEFORE UPDATE OR DELETE ON kernel_upgrade_recovery_actions
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_package_retirements_immutable BEFORE UPDATE OR DELETE ON kernel_package_retirements
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
