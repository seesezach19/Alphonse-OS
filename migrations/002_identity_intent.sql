CREATE TABLE kernel_principals (
  principal_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('human', 'agent', 'system')),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  external_subject text,
  created_by_type text NOT NULL,
  created_by_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, principal_id),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id)
);

CREATE UNIQUE INDEX kernel_principals_external_subject_idx
  ON kernel_principals (installation_id, environment_id, external_subject)
  WHERE external_subject IS NOT NULL;

CREATE TABLE kernel_agent_passports (
  passport_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  sponsor_principal_id uuid NOT NULL,
  runtime jsonb NOT NULL,
  model_configuration jsonb NOT NULL,
  package_skill_configuration jsonb NOT NULL,
  configuration_digest text NOT NULL CHECK (configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  authentication_digest text NOT NULL UNIQUE CHECK (authentication_digest ~ '^sha256:[0-9a-f]{64}$'),
  permitted_intent_classes text[] NOT NULL CHECK (cardinality(permitted_intent_classes) > 0),
  provenance jsonb NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > valid_from),
  issued_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, passport_id),
  UNIQUE (installation_id, environment_id, passport_id, agent_principal_id),
  FOREIGN KEY (installation_id, environment_id, agent_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id),
  FOREIGN KEY (installation_id, environment_id, sponsor_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_work_intent_proposals (
  proposal_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  passport_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  proposed_by_principal_id uuid NOT NULL,
  intent_class text NOT NULL,
  objective text NOT NULL,
  requested_outcome text NOT NULL,
  scope jsonb NOT NULL,
  constraints jsonb NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  proposed_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, proposal_id),
  UNIQUE (installation_id, environment_id, proposal_id, passport_id, agent_principal_id),
  FOREIGN KEY (installation_id, environment_id, passport_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id),
  FOREIGN KEY (installation_id, environment_id, passport_id, agent_principal_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id, agent_principal_id),
  FOREIGN KEY (installation_id, environment_id, agent_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id),
  FOREIGN KEY (installation_id, environment_id, proposed_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_work_intents (
  work_intent_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  passport_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  confirmed_by_principal_id uuid NOT NULL,
  intent_class text NOT NULL,
  objective text NOT NULL,
  requested_outcome text NOT NULL,
  scope jsonb NOT NULL,
  constraints jsonb NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  confirmed_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, work_intent_id),
  UNIQUE (installation_id, environment_id, work_intent_id, passport_id, agent_principal_id),
  UNIQUE (installation_id, environment_id, proposal_id),
  FOREIGN KEY (installation_id, environment_id, proposal_id)
    REFERENCES kernel_work_intent_proposals(installation_id, environment_id, proposal_id),
  FOREIGN KEY (installation_id, environment_id, proposal_id, passport_id, agent_principal_id)
    REFERENCES kernel_work_intent_proposals(installation_id, environment_id, proposal_id, passport_id, agent_principal_id),
  FOREIGN KEY (installation_id, environment_id, passport_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id),
  FOREIGN KEY (installation_id, environment_id, agent_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id),
  FOREIGN KEY (installation_id, environment_id, confirmed_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_build_sessions (
  build_session_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  passport_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  base_references jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  opened_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, build_session_id),
  FOREIGN KEY (installation_id, environment_id, principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id),
  FOREIGN KEY (installation_id, environment_id, passport_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id),
  FOREIGN KEY (installation_id, environment_id, work_intent_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, work_intent_id, passport_id, principal_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id, passport_id, agent_principal_id)
);

CREATE INDEX kernel_build_sessions_work_intent_idx
  ON kernel_build_sessions (installation_id, environment_id, work_intent_id, opened_at);

CREATE FUNCTION kernel_reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable Kernel record cannot be updated or deleted' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER kernel_agent_passports_immutable BEFORE UPDATE OR DELETE ON kernel_agent_passports
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_work_intent_proposals_immutable BEFORE UPDATE OR DELETE ON kernel_work_intent_proposals
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_work_intents_immutable BEFORE UPDATE OR DELETE ON kernel_work_intents
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_build_sessions_immutable BEFORE UPDATE OR DELETE ON kernel_build_sessions
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
