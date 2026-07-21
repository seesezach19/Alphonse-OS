CREATE TABLE kernel_coverage_review_approvals (
  approval_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  onboarding_id uuid NOT NULL,
  review_bundle_digest text NOT NULL CHECK (review_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  review_state jsonb NOT NULL CHECK (jsonb_typeof(review_state) = 'object'),
  review_state_digest text NOT NULL CHECK (review_state_digest ~ '^sha256:[0-9a-f]{64}$'),
  work_intent_id uuid NOT NULL,
  work_intent_digest text NOT NULL CHECK (work_intent_digest ~ '^sha256:[0-9a-f]{64}$'),
  approval_scope jsonb NOT NULL CHECK (jsonb_typeof(approval_scope) = 'object'),
  rationale text NOT NULL CHECK (length(rationale) BETWEEN 1 AND 2000),
  authority_granted jsonb NOT NULL CHECK (jsonb_typeof(authority_granted) = 'array'),
  authority_denied jsonb NOT NULL CHECK (jsonb_typeof(authority_denied) = 'array'),
  principal_id uuid NOT NULL,
  executed_by_actor_type text NOT NULL,
  executed_by_actor_id text NOT NULL,
  approval_document jsonb NOT NULL CHECK (jsonb_typeof(approval_document) = 'object'),
  approval_digest text NOT NULL CHECK (approval_digest ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  valid_until timestamptz,
  UNIQUE (installation_id, environment_id, approval_id),
  UNIQUE (installation_id, environment_id, review_bundle_digest, approval_digest),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id),
  FOREIGN KEY (installation_id, environment_id, work_intent_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id),
  CHECK (valid_until IS NULL OR valid_until > issued_at)
);

CREATE INDEX kernel_coverage_review_approval_idx
  ON kernel_coverage_review_approvals
  (installation_id, environment_id, onboarding_id, review_bundle_digest, issued_at);

CREATE TRIGGER kernel_coverage_review_approvals_immutable
  BEFORE UPDATE OR DELETE ON kernel_coverage_review_approvals
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
