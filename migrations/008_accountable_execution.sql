ALTER TABLE kernel_context_access_grants ADD COLUMN delegation_id uuid;
ALTER TABLE kernel_context_access_grants
  DROP CONSTRAINT kernel_context_access_grants_installation_id_environment__fkey1;
ALTER TABLE kernel_context_access_grants ADD CONSTRAINT kernel_context_access_grants_work_intent_fk
  FOREIGN KEY (installation_id, environment_id, work_intent_id)
  REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id);
ALTER TABLE kernel_context_access_grants ADD CONSTRAINT kernel_context_access_grants_delegation_fk
  FOREIGN KEY (installation_id, environment_id, delegation_id)
  REFERENCES kernel_delegations(installation_id, environment_id, delegation_id);

CREATE TABLE kernel_execution_envelopes (
  envelope_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 160),
  admission_digest text NOT NULL CHECK (admission_digest ~ '^sha256:[0-9a-f]{64}$'),
  envelope_digest text NOT NULL CHECK (envelope_digest ~ '^sha256:[0-9a-f]{64}$'),
  passport_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  delegation_id uuid NOT NULL,
  capability_activation_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  skill_binding jsonb NOT NULL CHECK (jsonb_typeof(skill_binding) = 'object'),
  context_receipt_ids jsonb NOT NULL CHECK (jsonb_typeof(context_receipt_ids) = 'array'),
  limits jsonb NOT NULL CHECK (jsonb_typeof(limits) = 'object'),
  evidence_requirements jsonb NOT NULL CHECK (jsonb_typeof(evidence_requirements) = 'array'),
  expires_at timestamptz NOT NULL,
  admitted_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, envelope_id),
  UNIQUE (installation_id, environment_id, idempotency_key),
  FOREIGN KEY (installation_id, environment_id, passport_id, agent_principal_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id, agent_principal_id),
  FOREIGN KEY (installation_id, environment_id, work_intent_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, delegation_id)
    REFERENCES kernel_delegations(installation_id, environment_id, delegation_id),
  FOREIGN KEY (installation_id, environment_id, capability_activation_id)
    REFERENCES kernel_capability_activations(installation_id, environment_id, capability_activation_id),
  FOREIGN KEY (installation_id, environment_id, package_version_id)
    REFERENCES kernel_package_versions(installation_id, environment_id, package_version_id)
);

CREATE TABLE kernel_runs (
  run_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  envelope_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, run_id),
  UNIQUE (installation_id, environment_id, envelope_id),
  FOREIGN KEY (installation_id, environment_id, envelope_id)
    REFERENCES kernel_execution_envelopes(installation_id, environment_id, envelope_id)
);

CREATE TABLE kernel_evidence_records (
  evidence_record_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  run_id uuid NOT NULL,
  envelope_id uuid NOT NULL,
  evidence_document jsonb NOT NULL CHECK (jsonb_typeof(evidence_document) = 'object'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_links jsonb NOT NULL CHECK (jsonb_typeof(source_links) = 'array'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  recorded_by_principal_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, evidence_record_id),
  UNIQUE (installation_id, environment_id, run_id),
  FOREIGN KEY (installation_id, environment_id, run_id)
    REFERENCES kernel_runs(installation_id, environment_id, run_id),
  FOREIGN KEY (installation_id, environment_id, envelope_id)
    REFERENCES kernel_execution_envelopes(installation_id, environment_id, envelope_id),
  FOREIGN KEY (installation_id, environment_id, recorded_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_run_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  run_id uuid NOT NULL,
  execution_status text NOT NULL CHECK (execution_status IN ('admitted', 'completed', 'failed')),
  accountability_status text NOT NULL CHECK (accountability_status IN ('pending', 'satisfied', 'breached')),
  result_digest text,
  evidence_record_id uuid,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, run_id),
  FOREIGN KEY (installation_id, environment_id, run_id)
    REFERENCES kernel_runs(installation_id, environment_id, run_id),
  FOREIGN KEY (installation_id, environment_id, evidence_record_id)
    REFERENCES kernel_evidence_records(installation_id, environment_id, evidence_record_id)
);

CREATE TABLE kernel_operational_obligations (
  obligation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  run_id uuid NOT NULL,
  obligation_key text NOT NULL,
  requirement text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'satisfied', 'breached')),
  deadline_at timestamptz NOT NULL,
  evidence_record_id uuid,
  created_at timestamptz NOT NULL,
  satisfied_at timestamptz,
  UNIQUE (installation_id, environment_id, obligation_id),
  UNIQUE (installation_id, environment_id, run_id, obligation_key),
  FOREIGN KEY (installation_id, environment_id, run_id)
    REFERENCES kernel_runs(installation_id, environment_id, run_id),
  FOREIGN KEY (installation_id, environment_id, evidence_record_id)
    REFERENCES kernel_evidence_records(installation_id, environment_id, evidence_record_id)
);

CREATE INDEX kernel_runs_created_idx ON kernel_runs (installation_id, environment_id, created_at DESC);
CREATE INDEX kernel_obligations_status_idx
  ON kernel_operational_obligations (installation_id, environment_id, status, deadline_at);

CREATE TRIGGER kernel_execution_envelopes_immutable BEFORE UPDATE OR DELETE ON kernel_execution_envelopes
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_runs_immutable BEFORE UPDATE OR DELETE ON kernel_runs
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_evidence_records_immutable BEFORE UPDATE OR DELETE ON kernel_evidence_records
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
