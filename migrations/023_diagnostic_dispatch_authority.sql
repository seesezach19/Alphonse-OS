CREATE TABLE kernel_diagnostic_dispatch_authorizations (
  dispatch_authorization_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  assignment_digest text NOT NULL CHECK (assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  evidence_package_id uuid NOT NULL,
  evidence_package_semantic_digest text NOT NULL
    CHECK (evidence_package_semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  evidence_package_artifact_digest text NOT NULL
    CHECK (evidence_package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_policy_activation_id uuid NOT NULL,
  assignment_policy_activation_digest text NOT NULL
    CHECK (assignment_policy_activation_digest ~ '^sha256:[0-9a-f]{64}$'),
  worker_principal_id uuid NOT NULL,
  worker_passport_id uuid NOT NULL,
  worker_passport_configuration_digest text NOT NULL
    CHECK (worker_passport_configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  worker_run_id uuid NOT NULL UNIQUE,
  dispatcher_type text NOT NULL,
  dispatcher_id text NOT NULL,
  dispatcher_audience text NOT NULL,
  runner_audience text NOT NULL,
  nonce_digest text NOT NULL UNIQUE CHECK (nonce_digest ~ '^sha256:[0-9a-f]{64}$'),
  eligibility_snapshot_digest text NOT NULL
    CHECK (eligibility_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  decision_artifact_digest text NOT NULL
    CHECK (decision_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  authorization_document jsonb NOT NULL CHECK (jsonb_typeof(authorization_document) = 'object'),
  authorization_digest text NOT NULL UNIQUE
    CHECK (authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_authorization jsonb NOT NULL CHECK (jsonb_typeof(signed_authorization) = 'object'),
  signed_authorization_digest text NOT NULL UNIQUE
    CHECK (signed_authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id),
  FOREIGN KEY (installation_id, environment_id, worker_passport_id, worker_principal_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id, agent_principal_id)
);

CREATE INDEX kernel_diagnostic_dispatch_assignment_idx
  ON kernel_diagnostic_dispatch_authorizations
  (installation_id, environment_id, assignment_id, issued_at, dispatch_authorization_id);
CREATE INDEX kernel_diagnostic_dispatch_expiry_idx
  ON kernel_diagnostic_dispatch_authorizations
  (installation_id, environment_id, expires_at, dispatch_authorization_id);

CREATE TRIGGER kernel_diagnostic_dispatch_authorizations_immutable
  BEFORE UPDATE OR DELETE ON kernel_diagnostic_dispatch_authorizations
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
