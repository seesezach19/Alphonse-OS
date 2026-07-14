CREATE TABLE kernel_installations (
  installation_id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kernel_environments (
  installation_id uuid NOT NULL REFERENCES kernel_installations(installation_id),
  environment_id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, environment_id)
);

CREATE TABLE kernel_commands (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 160),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  operation_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  result jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, environment_id, command_id),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id)
);

CREATE TABLE kernel_transitions (
  transition_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  environment_sequence bigint NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  transition_type text NOT NULL,
  from_revision bigint NOT NULL,
  to_revision bigint NOT NULL,
  command_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, environment_id, transition_id),
  UNIQUE (installation_id, environment_id, environment_sequence),
  UNIQUE (installation_id, environment_id, command_id),
  FOREIGN KEY (installation_id, environment_id, command_id)
    REFERENCES kernel_commands(installation_id, environment_id, command_id)
);

CREATE TABLE kernel_outbox (
  outbox_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  transition_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (installation_id, environment_id, transition_id),
  FOREIGN KEY (installation_id, environment_id, transition_id)
    REFERENCES kernel_transitions(installation_id, environment_id, transition_id)
);

CREATE INDEX kernel_transitions_aggregate_idx
  ON kernel_transitions (installation_id, environment_id, aggregate_type, aggregate_id, environment_sequence);

CREATE INDEX kernel_outbox_pending_idx
  ON kernel_outbox (installation_id, environment_id, created_at)
  WHERE published_at IS NULL;
