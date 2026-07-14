ALTER TABLE kernel_environments
  ADD COLUMN execution_epoch bigint NOT NULL DEFAULT 1 CHECK (execution_epoch > 0);

CREATE TABLE kernel_handoffs (
  handoff_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  source_passport_id uuid NOT NULL,
  source_agent_principal_id uuid NOT NULL,
  target_passport_id uuid NOT NULL,
  target_agent_principal_id uuid NOT NULL,
  target_runtime jsonb NOT NULL CHECK (jsonb_typeof(target_runtime) = 'object'),
  exact_bindings jsonb NOT NULL CHECK (jsonb_typeof(exact_bindings) = 'object'),
  context_receipt_ids jsonb NOT NULL CHECK (jsonb_typeof(context_receipt_ids) = 'array'),
  ledger_cursor bigint NOT NULL CHECK (ledger_cursor >= 0),
  delegation_proposal jsonb NOT NULL CHECK (jsonb_typeof(delegation_proposal) = 'object'),
  open_obligations jsonb NOT NULL CHECK (jsonb_typeof(open_obligations) = 'array'),
  workload_spec jsonb NOT NULL CHECK (jsonb_typeof(workload_spec) = 'object'),
  workload_digest text NOT NULL CHECK (workload_digest ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected')),
  proposed_at timestamptz NOT NULL,
  decided_at timestamptz,
  rejection_reason text,
  UNIQUE (installation_id, environment_id, handoff_id),
  FOREIGN KEY (installation_id, environment_id, work_intent_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, source_passport_id, source_agent_principal_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id, agent_principal_id),
  FOREIGN KEY (installation_id, environment_id, target_passport_id, target_agent_principal_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id, agent_principal_id)
);

CREATE TABLE kernel_delegations (
  delegation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  source_passport_id uuid NOT NULL,
  target_passport_id uuid NOT NULL,
  target_agent_principal_id uuid NOT NULL,
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, delegation_id),
  UNIQUE (installation_id, environment_id, handoff_id),
  FOREIGN KEY (installation_id, environment_id, handoff_id)
    REFERENCES kernel_handoffs(installation_id, environment_id, handoff_id)
);

CREATE TABLE kernel_task_responsibilities (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  responsible_passport_id uuid NOT NULL,
  responsible_agent_principal_id uuid NOT NULL,
  delegation_id uuid,
  revision bigint NOT NULL CHECK (revision >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, work_intent_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, responsible_passport_id, responsible_agent_principal_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id, agent_principal_id),
  FOREIGN KEY (installation_id, environment_id, delegation_id)
    REFERENCES kernel_delegations(installation_id, environment_id, delegation_id)
);

CREATE TABLE kernel_responsibility_transfers (
  transfer_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  delegation_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  from_passport_id uuid NOT NULL,
  to_passport_id uuid NOT NULL,
  from_revision bigint NOT NULL,
  to_revision bigint NOT NULL CHECK (to_revision = from_revision + 1),
  transferred_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, transfer_id),
  UNIQUE (installation_id, environment_id, handoff_id),
  FOREIGN KEY (installation_id, environment_id, handoff_id)
    REFERENCES kernel_handoffs(installation_id, environment_id, handoff_id),
  FOREIGN KEY (installation_id, environment_id, delegation_id)
    REFERENCES kernel_delegations(installation_id, environment_id, delegation_id)
);

CREATE TABLE kernel_workload_grants (
  workload_grant_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  delegation_id uuid NOT NULL,
  execution_epoch bigint NOT NULL CHECK (execution_epoch > 0),
  run_intent text NOT NULL,
  workload_digest text NOT NULL CHECK (workload_digest ~ '^sha256:[0-9a-f]{64}$'),
  adapter text NOT NULL,
  resources jsonb NOT NULL CHECK (jsonb_typeof(resources) = 'object'),
  network jsonb NOT NULL CHECK (jsonb_typeof(network) = 'object'),
  filesystem jsonb NOT NULL CHECK (jsonb_typeof(filesystem) = 'object'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  nonce uuid NOT NULL,
  key_id text NOT NULL,
  grant_document jsonb NOT NULL CHECK (jsonb_typeof(grant_document) = 'object'),
  grant_digest text NOT NULL CHECK (grant_digest ~ '^sha256:[0-9a-f]{64}$'),
  signature text NOT NULL CHECK (signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
  UNIQUE (installation_id, environment_id, workload_grant_id),
  UNIQUE (installation_id, environment_id, handoff_id),
  FOREIGN KEY (installation_id, environment_id, handoff_id)
    REFERENCES kernel_handoffs(installation_id, environment_id, handoff_id),
  FOREIGN KEY (installation_id, environment_id, delegation_id)
    REFERENCES kernel_delegations(installation_id, environment_id, delegation_id)
);

CREATE TABLE kernel_host_observations (
  observation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  workload_grant_id uuid NOT NULL,
  workload_instance_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  observation_type text NOT NULL,
  identity jsonb NOT NULL CHECK (jsonb_typeof(identity) = 'object'),
  observed_at timestamptz NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  previous_observation_digest text,
  observation_digest text NOT NULL CHECK (observation_digest ~ '^sha256:[0-9a-f]{64}$'),
  key_id text NOT NULL,
  signature text NOT NULL CHECK (signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
  UNIQUE (installation_id, environment_id, observation_id),
  UNIQUE (installation_id, environment_id, workload_instance_id, sequence),
  FOREIGN KEY (installation_id, environment_id, workload_grant_id)
    REFERENCES kernel_workload_grants(installation_id, environment_id, workload_grant_id)
);

CREATE INDEX kernel_handoffs_work_intent_idx
  ON kernel_handoffs (installation_id, environment_id, work_intent_id, proposed_at DESC);
CREATE INDEX kernel_host_observations_instance_idx
  ON kernel_host_observations (installation_id, environment_id, workload_instance_id, sequence);

CREATE TRIGGER kernel_delegations_immutable BEFORE UPDATE OR DELETE ON kernel_delegations
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_responsibility_transfers_immutable BEFORE UPDATE OR DELETE ON kernel_responsibility_transfers
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_workload_grants_immutable BEFORE UPDATE OR DELETE ON kernel_workload_grants
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_host_observations_immutable BEFORE UPDATE OR DELETE ON kernel_host_observations
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
