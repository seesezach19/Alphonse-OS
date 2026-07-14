ALTER TABLE kernel_run_states DROP CONSTRAINT kernel_run_states_execution_status_check;
ALTER TABLE kernel_run_states ADD CONSTRAINT kernel_run_states_execution_status_check
  CHECK (execution_status IN ('admitted', 'completed', 'succeeded', 'failed', 'uncertain'));

CREATE TABLE kernel_effect_records (
  effect_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  run_id uuid NOT NULL,
  envelope_id uuid NOT NULL,
  effect_idempotency_key text NOT NULL CHECK (length(effect_idempotency_key) BETWEEN 1 AND 200),
  effect_request jsonb NOT NULL CHECK (jsonb_typeof(effect_request) = 'object'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  capability_activation_id uuid NOT NULL,
  workload_grant_id uuid NOT NULL,
  context_receipt_ids jsonb NOT NULL CHECK (jsonb_typeof(context_receipt_ids) = 'array'),
  target jsonb NOT NULL CHECK (jsonb_typeof(target) = 'object'),
  action text NOT NULL,
  requested_value jsonb NOT NULL CHECK (jsonb_typeof(requested_value) = 'object'),
  limits jsonb NOT NULL CHECK (jsonb_typeof(limits) = 'object'),
  credential_binding jsonb NOT NULL CHECK (jsonb_typeof(credential_binding) = 'object'),
  adapter_binding jsonb NOT NULL CHECK (jsonb_typeof(adapter_binding) = 'object'),
  evidence_requirements jsonb NOT NULL CHECK (jsonb_typeof(evidence_requirements) = 'array'),
  recovery_posture jsonb NOT NULL CHECK (jsonb_typeof(recovery_posture) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, effect_id),
  UNIQUE (installation_id, environment_id, run_id),
  UNIQUE (installation_id, environment_id, effect_idempotency_key),
  FOREIGN KEY (installation_id, environment_id, run_id)
    REFERENCES kernel_runs(installation_id, environment_id, run_id),
  FOREIGN KEY (installation_id, environment_id, envelope_id)
    REFERENCES kernel_execution_envelopes(installation_id, environment_id, envelope_id),
  FOREIGN KEY (installation_id, environment_id, capability_activation_id)
    REFERENCES kernel_capability_activations(installation_id, environment_id, capability_activation_id),
  FOREIGN KEY (installation_id, environment_id, workload_grant_id)
    REFERENCES kernel_workload_grants(installation_id, environment_id, workload_grant_id)
);

CREATE TABLE kernel_effect_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  effect_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('admitted', 'dispatching', 'succeeded', 'failed', 'uncertain')),
  evidence_record_id uuid,
  dispatch_started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, effect_id),
  FOREIGN KEY (installation_id, environment_id, effect_id)
    REFERENCES kernel_effect_records(installation_id, environment_id, effect_id),
  FOREIGN KEY (installation_id, environment_id, evidence_record_id)
    REFERENCES kernel_evidence_records(installation_id, environment_id, evidence_record_id)
);

CREATE TABLE kernel_dispatch_permits (
  permit_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  effect_id uuid NOT NULL,
  run_id uuid NOT NULL,
  workload_grant_id uuid NOT NULL,
  permit_document jsonb NOT NULL CHECK (jsonb_typeof(permit_document) = 'object'),
  permit_digest text NOT NULL CHECK (permit_digest ~ '^sha256:[0-9a-f]{64}$'),
  key_id text NOT NULL,
  signature text NOT NULL CHECK (signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, permit_id),
  UNIQUE (installation_id, environment_id, effect_id),
  FOREIGN KEY (installation_id, environment_id, effect_id)
    REFERENCES kernel_effect_records(installation_id, environment_id, effect_id),
  FOREIGN KEY (installation_id, environment_id, run_id)
    REFERENCES kernel_runs(installation_id, environment_id, run_id),
  FOREIGN KEY (installation_id, environment_id, workload_grant_id)
    REFERENCES kernel_workload_grants(installation_id, environment_id, workload_grant_id)
);

CREATE TABLE kernel_dispatch_permit_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('issued', 'consumed', 'expired')),
  consumed_at timestamptz,
  brokered_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, permit_id),
  FOREIGN KEY (installation_id, environment_id, permit_id)
    REFERENCES kernel_dispatch_permits(installation_id, environment_id, permit_id)
);

CREATE INDEX kernel_effect_status_idx ON kernel_effect_states (installation_id, environment_id, status, updated_at DESC);
CREATE INDEX kernel_dispatch_permit_expiry_idx ON kernel_dispatch_permits (installation_id, environment_id, expires_at);

CREATE TRIGGER kernel_effect_records_immutable BEFORE UPDATE OR DELETE ON kernel_effect_records
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_dispatch_permits_immutable BEFORE UPDATE OR DELETE ON kernel_dispatch_permits
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
