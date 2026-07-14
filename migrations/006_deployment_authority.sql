CREATE TABLE kernel_deployment_plan_validation_receipts (
  validation_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  composition_digest text NOT NULL CHECK (composition_digest ~ '^sha256:[0-9a-f]{64}$'),
  validator_version text NOT NULL,
  valid boolean NOT NULL,
  checks jsonb NOT NULL CHECK (jsonb_typeof(checks) = 'array'),
  issues jsonb NOT NULL CHECK (jsonb_typeof(issues) = 'array'),
  validated_by_principal_id uuid NOT NULL,
  validated_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, validation_receipt_id),
  FOREIGN KEY (installation_id, environment_id, package_version_id)
    REFERENCES kernel_package_versions(installation_id, environment_id, package_version_id),
  FOREIGN KEY (installation_id, environment_id, validated_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_deployment_plans (
  deployment_plan_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  validation_receipt_id uuid NOT NULL,
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  composition_digest text NOT NULL CHECK (composition_digest ~ '^sha256:[0-9a-f]{64}$'),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object'),
  created_by_principal_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, deployment_plan_id),
  FOREIGN KEY (installation_id, environment_id, package_version_id)
    REFERENCES kernel_package_versions(installation_id, environment_id, package_version_id),
  FOREIGN KEY (installation_id, environment_id, work_intent_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, validation_receipt_id)
    REFERENCES kernel_deployment_plan_validation_receipts(installation_id, environment_id, validation_receipt_id),
  FOREIGN KEY (installation_id, environment_id, created_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_deployment_technical_reviews (
  technical_review_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  deployment_plan_id uuid NOT NULL,
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  decision text NOT NULL CHECK (decision IN ('pass', 'request_changes', 'reject')),
  rationale text NOT NULL CHECK (length(rationale) BETWEEN 1 AND 2000),
  reviewed_by_principal_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, technical_review_id),
  UNIQUE (installation_id, environment_id, deployment_plan_id),
  FOREIGN KEY (installation_id, environment_id, deployment_plan_id)
    REFERENCES kernel_deployment_plans(installation_id, environment_id, deployment_plan_id),
  FOREIGN KEY (installation_id, environment_id, reviewed_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_deployments (
  deployment_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  deployment_plan_id uuid NOT NULL,
  technical_review_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  composition_digest text NOT NULL CHECK (composition_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state = 'staged'),
  staged_by_principal_id uuid NOT NULL,
  staged_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, deployment_id),
  UNIQUE (installation_id, environment_id, deployment_plan_id),
  FOREIGN KEY (installation_id, environment_id, deployment_plan_id)
    REFERENCES kernel_deployment_plans(installation_id, environment_id, deployment_plan_id),
  FOREIGN KEY (installation_id, environment_id, technical_review_id)
    REFERENCES kernel_deployment_technical_reviews(installation_id, environment_id, technical_review_id),
  FOREIGN KEY (installation_id, environment_id, package_version_id)
    REFERENCES kernel_package_versions(installation_id, environment_id, package_version_id),
  FOREIGN KEY (installation_id, environment_id, work_intent_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, staged_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_capability_authority_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  capability_key text NOT NULL,
  current_revision bigint NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  active_activation_id uuid,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, capability_key),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id)
);

CREATE TABLE kernel_capability_business_approvals (
  business_approval_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  deployment_id uuid NOT NULL,
  capability_key text NOT NULL,
  capability_export_id text NOT NULL,
  capability_export_digest text NOT NULL CHECK (capability_export_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_digest text NOT NULL CHECK (authority_digest ~ '^sha256:[0-9a-f]{64}$'),
  approved_against_revision bigint NOT NULL CHECK (approved_against_revision >= 0),
  approved_by_principal_id uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, business_approval_id),
  UNIQUE (installation_id, environment_id, deployment_id, capability_export_id, authority_digest),
  FOREIGN KEY (installation_id, environment_id, deployment_id)
    REFERENCES kernel_deployments(installation_id, environment_id, deployment_id),
  FOREIGN KEY (installation_id, environment_id, approved_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_capability_activations (
  capability_activation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  business_approval_id uuid NOT NULL,
  deployment_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  capability_key text NOT NULL,
  capability_export_id text NOT NULL,
  capability_contract_version text NOT NULL,
  capability_export_digest text NOT NULL CHECK (capability_export_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_digest text NOT NULL CHECK (authority_digest ~ '^sha256:[0-9a-f]{64}$'),
  from_revision bigint NOT NULL CHECK (from_revision >= 0),
  to_revision bigint NOT NULL CHECK (to_revision = from_revision + 1),
  activated_by_principal_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, capability_activation_id),
  UNIQUE (installation_id, environment_id, business_approval_id),
  FOREIGN KEY (installation_id, environment_id, business_approval_id)
    REFERENCES kernel_capability_business_approvals(installation_id, environment_id, business_approval_id),
  FOREIGN KEY (installation_id, environment_id, deployment_id)
    REFERENCES kernel_deployments(installation_id, environment_id, deployment_id),
  FOREIGN KEY (installation_id, environment_id, package_version_id)
    REFERENCES kernel_package_versions(installation_id, environment_id, package_version_id),
  FOREIGN KEY (installation_id, environment_id, activated_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

ALTER TABLE kernel_capability_authority_states
  ADD CONSTRAINT kernel_capability_authority_states_active_fk
  FOREIGN KEY (installation_id, environment_id, active_activation_id)
  REFERENCES kernel_capability_activations(installation_id, environment_id, capability_activation_id);

CREATE INDEX kernel_deployment_plans_work_intent_idx
  ON kernel_deployment_plans (installation_id, environment_id, work_intent_id, created_at);
CREATE INDEX kernel_capability_activations_key_idx
  ON kernel_capability_activations (installation_id, environment_id, capability_key, activated_at);

CREATE TRIGGER kernel_deployment_plan_validation_receipts_immutable BEFORE UPDATE OR DELETE ON kernel_deployment_plan_validation_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_deployment_plans_immutable BEFORE UPDATE OR DELETE ON kernel_deployment_plans
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_deployment_technical_reviews_immutable BEFORE UPDATE OR DELETE ON kernel_deployment_technical_reviews
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_deployments_immutable BEFORE UPDATE OR DELETE ON kernel_deployments
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_capability_business_approvals_immutable BEFORE UPDATE OR DELETE ON kernel_capability_business_approvals
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_capability_activations_immutable BEFORE UPDATE OR DELETE ON kernel_capability_activations
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
