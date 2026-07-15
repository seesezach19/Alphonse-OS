CREATE TABLE diagnostic_nodes (
  installation_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE diagnostic_commands (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 160),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  operation_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  result jsonb NOT NULL,
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, command_id)
);

CREATE TABLE diagnostic_transitions (
  transition_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  diagnostic_sequence bigint NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  transition_type text NOT NULL,
  from_revision bigint NOT NULL,
  to_revision bigint NOT NULL,
  command_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (installation_id, diagnostic_sequence),
  UNIQUE (installation_id, command_id),
  FOREIGN KEY (installation_id, command_id)
    REFERENCES diagnostic_commands(installation_id, command_id)
);

CREATE TABLE diagnostic_outbox (
  outbox_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  transition_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  UNIQUE (installation_id, transition_id),
  FOREIGN KEY (transition_id) REFERENCES diagnostic_transitions(transition_id)
);

CREATE TABLE diagnostic_agent_workflows (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  workflow_id text NOT NULL CHECK (workflow_id ~ '^[a-z][a-z0-9._:-]{2,159}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  objective text NOT NULL CHECK (length(objective) BETWEEN 1 AND 1000),
  external_ref jsonb NOT NULL CHECK (jsonb_typeof(external_ref) = 'object'),
  identity_digest text NOT NULL CHECK (identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, workflow_id)
);

CREATE TABLE diagnostic_artifacts (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  media_type text NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, artifact_digest)
);

CREATE TABLE diagnostic_agent_revisions (
  revision_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  workflow_id text NOT NULL,
  material_digest text NOT NULL CHECK (material_digest ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  runtime jsonb NOT NULL CHECK (jsonb_typeof(runtime) = 'object'),
  nodes jsonb NOT NULL CHECK (jsonb_typeof(nodes) = 'array'),
  model jsonb NOT NULL CHECK (jsonb_typeof(model) = 'object'),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  adapter jsonb NOT NULL CHECK (jsonb_typeof(adapter) = 'object'),
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, material_digest),
  FOREIGN KEY (installation_id, workflow_id)
    REFERENCES diagnostic_agent_workflows(installation_id, workflow_id),
  FOREIGN KEY (installation_id, snapshot_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE INDEX diagnostic_agent_revisions_workflow_idx
  ON diagnostic_agent_revisions (installation_id, workflow_id, created_at, revision_id);

CREATE INDEX diagnostic_transitions_aggregate_idx
  ON diagnostic_transitions (installation_id, aggregate_type, aggregate_id, diagnostic_sequence);

CREATE OR REPLACE FUNCTION diagnostic_reject_immutable_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'diagnostic immutable records cannot be updated or deleted';
END;
$$;

CREATE TRIGGER diagnostic_commands_immutable BEFORE UPDATE OR DELETE ON diagnostic_commands
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_transitions_immutable BEFORE UPDATE OR DELETE ON diagnostic_transitions
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_workflows_immutable BEFORE UPDATE OR DELETE ON diagnostic_agent_workflows
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_artifacts_immutable BEFORE UPDATE OR DELETE ON diagnostic_artifacts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_revisions_immutable BEFORE UPDATE OR DELETE ON diagnostic_agent_revisions
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
